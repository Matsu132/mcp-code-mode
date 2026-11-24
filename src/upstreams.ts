import {randomUUID} from 'node:crypto';
import {readFile,open,rename,rm} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {z} from 'zod';
import {Broker,type Entry} from './broker.js';
import type {DelegatedOAuth} from './upstream-oauth.js';
import {upstreamNetwork,validateEndpoint} from './upstream-network.js';

const credentialName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/);
const upstream = z.strictObject({
  id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  url:z.string().url().max(2048),
  tokenEnv:credentialName.optional(),
  allow:z.array(z.string().min(1).max(235)).max(500),
  enabled:z.boolean().default(true),
});
const registrySchema = z.array(upstream).max(32);
const bindingsSchema = z.array(z.strictObject({url:z.string().url(),tokenEnv:credentialName})).max(100);
type Upstream = z.infer<typeof upstream>;
type Network = ReturnType<typeof upstreamNetwork>;
type Runtime = {client:Client;network:Network;entries:Entry[];tools:string[]};
type State = 'ready'|'disabled'|'checking'|'error';

export class Upstreams {
  private readonly connections = new Map<string,Runtime>();
  private readonly statuses = new Map<string,State>();
  private busy = false;

  private constructor(
    private configs:Upstream[],
    private readonly path:string,
    private readonly trustedUrls:Set<string>,
    private readonly credentialBindings:Set<string>,
    private readonly broker:Broker,
    private readonly oauth?:DelegatedOAuth,
  ) {}

  static async open(configPath:string,statePath:string,broker:Broker,oauth?:DelegatedOAuth) {
    const seed = registrySchema.parse(JSON.parse(await readFile(configPath,'utf8')));
    const urls = new Set(seed.map(server=>validateEndpoint(server.url,true).href));
    const attached = seed.flatMap(server=>server.tokenEnv?[{url:server.url,tokenEnv:server.tokenEnv}]:[]);
    const environment = bindingsSchema.parse(JSON.parse(process.env.UPSTREAM_CREDENTIALS??'[]'));
    const bindings = new Set([...attached,...environment].map(binding=>
      JSON.stringify([validateEndpoint(binding.url,urls.has(new URL(binding.url).href)).href,binding.tokenEnv]),
    ));
    let configs = seed;
    try {
      configs = registrySchema.parse(JSON.parse(await readFile(statePath,'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;
    }
    const manager = new Upstreams(configs,statePath,urls,bindings,broker,oauth);
    manager.validate(configs);
    return manager;
  }

  private trusted(url:string) {
    return this.trustedUrls.has(new URL(url).href);
  }

  private validate(configs:Upstream[]) {
    const ids = new Set<string>();
    for (const config of configs) {
      if (ids.has(config.id)) throw Error('Duplicate server ID');
      ids.add(config.id);
      const url = validateEndpoint(config.url,this.trusted(config.url));
      if (this.oauth?.reserves(config.id) && (!this.oauth.isDelegated(config) || config.tokenEnv)) {
        throw Error('Invalid delegated OAuth binding');
      }
      if (config.tokenEnv && !this.credentialBindings.has(JSON.stringify([url.href,config.tokenEnv]))) {
        throw Error('Credential is not bound to the endpoint');
      }
    }
  }

  view() {
    return this.configs.map(config=>({
      ...config,
      authMode:this.oauth?.isDelegated(config)?'delegated':'shared',
      status:config.enabled?(this.oauth?.isDelegated(config)?'delegated':this.statuses.get(config.id)??'checking'):'disabled',
      tools:this.connections.get(config.id)?.tools??[],
    }));
  }

  delegated(includeDisabled=false) {
    return this.configs.filter(config=>(includeDisabled||config.enabled) && this.oauth?.isDelegated(config));
  }

  async openDelegated(id:string,token:string) {
    const config = this.delegated().find(item=>item.id===id);
    if (!config) throw Error('Delegated upstream unavailable');
    const runtime = await this.connect(config,token);
    const active = this.delegated().find(item=>item.id===id);
    if (active!==config) {
      await this.disconnect(runtime);
      throw Error('Delegated upstream configuration changed');
    }
    return {entries:runtime.entries,close:()=>this.disconnect(runtime)};
  }

  private async disconnect(runtime:Runtime) {
    await Promise.allSettled([runtime.client.close(),runtime.network.close()]);
  }

  private async list(config:Upstream,runtime:Runtime,signal:AbortSignal) {
    const entries:Entry[] = [];
    const tools = new Set<string>();
    let cursor:string|undefined;
    let pages=0;
    do {
      if (++pages>100) throw Error('Upstream catalog page limit exceeded');
      const page = await runtime.client.listTools({cursor},{signal,timeout:5000});
      for (const tool of page.tools) {
        if (tools.has(tool.name)) throw Error('Duplicate upstream tool');
        tools.add(tool.name);
        if (tools.size>5000) throw Error('Upstream catalog limit exceeded');
        if (config.allow.includes(tool.name)) entries.push({
          id:config.id+'.'+tool.name,
          name:tool.name,
          description:tool.description??'',
          inputSchema:tool.inputSchema,
          client:runtime.client,
        });
      }
      if (cursor && page.nextCursor===cursor) throw Error('Upstream cursor did not advance');
      cursor = page.nextCursor;
    } while (cursor);
    runtime.entries = entries;
    runtime.tools = [...tools].sort();
  }

  private async connect(config:Upstream,delegatedToken?:string) {
    const trusted = delegatedToken===undefined && this.trusted(config.url);
    const url = validateEndpoint(config.url,trusted);
    const token = delegatedToken??(config.tokenEnv?process.env[config.tokenEnv]:undefined);
    if (config.tokenEnv && !token) throw Error('Missing bound upstream credential');
    const network = upstreamNetwork(url,trusted);
    const client = new Client({name:'mcp-code-mode',version:'0.1.0'});
    const runtime:Runtime = {client,network,entries:[],tools:[]};
    const signal = AbortSignal.timeout(10000);
    try {
      await client.connect(new StreamableHTTPClientTransport(url,{
        fetch:network.fetch,
        requestInit:{headers:token?{Authorization:'Bearer '+token}:{}},
      }),{signal,timeout:5000});
      await this.list(config,runtime,signal);
      return runtime;
    } catch (error) {
      await this.disconnect(runtime);
      throw error;
    }
  }

  private publish() {
    this.broker.replace([...this.connections.values()].flatMap(connection=>connection.entries));
  }

  async refresh() {
    if (this.busy) return;
    this.busy = true;
    try {
      await Promise.all(this.configs.filter(config=>config.enabled&&!this.oauth?.isDelegated(config)).map(async config=>{
        const existing = this.connections.get(config.id);
        try {
          if (existing) await this.list(config,existing,AbortSignal.timeout(10000));
          else this.connections.set(config.id,await this.connect(config));
          this.statuses.set(config.id,'ready');
        } catch {
          this.connections.delete(config.id);
          this.statuses.set(config.id,'error');
          if (existing) await this.disconnect(existing);
        }
      }));
      this.publish();
    } finally {
      this.busy = false;
    }
  }

  async test(raw:unknown) {
    const config = upstream.parse(raw);
    this.validate([config]);
    if (this.oauth?.isDelegated(config)) return {status:'delegated',tools:[]};
    try {
      const runtime = await this.connect(config);
      try {
        return {status:'ready',tools:runtime.tools};
      } finally {
        await this.disconnect(runtime);
      }
    } catch {
      return {status:'error',tools:[]};
    }
  }

  async update(input:unknown) {
    if (this.busy) throw Error('Upstream registry is busy');
    const next = registrySchema.parse(input);
    this.validate(next);
    this.busy = true;
    const temporary = this.path+'.'+randomUUID();
    let created = false;
    try {
      const file = await open(temporary,'wx',0o600);
      created = true;
      try { await file.writeFile(JSON.stringify(next)); }
      finally { await file.close(); }
      await rename(temporary,this.path);
      const old = new Map(this.configs.map(config=>[config.id,config]));
      const nextById = new Map(next.map(config=>[config.id,config]));
      const closed:Promise<void>[] = [];
      for (const [id,config] of old) {
        if (JSON.stringify(config)===JSON.stringify(nextById.get(id))) continue;
        const runtime = this.connections.get(id);
        this.connections.delete(id);
        this.statuses.delete(id);
        if (runtime) closed.push(this.disconnect(runtime));
      }
      this.configs = next;
      this.publish();
      await Promise.all(closed);
    } finally {
      this.busy = false;
      if (created) await rm(temporary,{force:true});
    }
    void this.refresh().catch(()=>console.error(JSON.stringify({event:'refresh_failed'})));
  }
}
