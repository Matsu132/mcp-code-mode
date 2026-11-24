import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {discoverAuthorizationServerMetadata,discoverOAuthProtectedResourceMetadata} from '@modelcontextprotocol/sdk/client/auth.js';
import {z} from 'zod';
import {OAuthVault} from './oauth-vault.js';
import {upstreamNetwork,validateEndpoint} from './upstream-network.js';

const keyName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/);
const configSchema = z.array(z.strictObject({
  id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  url:z.string().url(),
  issuer:z.string().url(),
  clientId:z.string().min(1).max(2048).optional(),
  clientSecretEnv:keyName.optional(),
  scope:z.string().max(1024).optional(),
  revocationEndpoint:z.string().url().optional(),
})).max(32);
type Config = z.infer<typeof configSchema>[number];
const tokensSchema = z.object({
  access_token:z.string().min(1).max(16384).regex(/^[\x21-\x7E]+$/),
  token_type:z.string().regex(/^bearer$/i),
  expires_in:z.number().int().min(1).max(31536000).optional(),
  refresh_token:z.string().min(1).max(16384).optional(),
});
const registrationSchema = z.object({
  client_id:z.string().min(1).max(2048),
  client_secret:z.string().max(4096).optional(),
  token_endpoint_auth_method:z.enum(['none','client_secret_basic','client_secret_post']).optional(),
});
type Registration = z.infer<typeof registrationSchema>;
const endpointsSchema = z.strictObject({authorization:z.string().url(),token:z.string().url(),resource:z.string().url(),revocation:z.string().url().optional()});
type Endpoints = z.infer<typeof endpointsSchema>;
const recordSchema = z.strictObject({
  tokens:tokensSchema,
  registration:registrationSchema,
  endpoints:endpointsSchema,
  expiresAt:z.number().nullable(),
});
type Credential = z.infer<typeof recordSchema>;
type Pending = {
  subject:string;id:string;binding:string;browser:Buffer;verifier:string;expires:number;
  endpoints:Endpoints;registration:Registration;
};
type Network = ReturnType<typeof upstreamNetwork>;

const random = () => randomBytes(32).toString('base64url');
const digest = (value:string) => createHash('sha256').update(value).digest();
const opaque = /^[A-Za-z0-9_-]{43}$/;

function issuerEndpoint(config:Config,raw:string) {
  const url = validateEndpoint(raw,false);
  if (url.origin!==new URL(config.issuer).origin) throw Error('OAuth endpoint must use the configured issuer origin');
  return url;
}

function binding(config:Config) {
  return JSON.stringify([config.url,config.issuer,config.clientId,config.clientSecretEnv,config.scope,config.revocationEndpoint]);
}

export class DelegatedOAuth {
  private readonly pending = new Map<string,Pending>();
  private readonly locks = new Map<string,Promise<unknown>>();
  private readonly configs:Map<string,Config>;

  constructor(
    options:unknown,
    private readonly redirect:URL,
    private readonly vault:OAuthVault,
    private readonly network:(url:URL,trusted:boolean)=>Network = upstreamNetwork,
  ) {
    const configs = configSchema.parse(options);
    this.configs = new Map(configs.map(config=>[config.id,config]));
    if (this.configs.size!==configs.length) throw Error('Duplicate OAuth upstream');
    for (const config of configs) {
      validateEndpoint(config.url,false);
      validateEndpoint(config.issuer,false);
      if (config.revocationEndpoint) issuerEndpoint(config,config.revocationEndpoint);
      if (config.clientSecretEnv && !config.clientId) throw Error('OAuth client secret requires a client ID');
      if (config.clientSecretEnv && !process.env[config.clientSecretEnv]) throw Error('Missing delegated OAuth client secret');
    }
  }

  static fromEnvironment(env:NodeJS.ProcessEnv,statePath:string) {
    if (!env.UPSTREAM_OAUTH_CONFIG) return undefined;
    const callback = new URL(z.string().url().parse(env.UPSTREAM_OAUTH_REDIRECT_URL));
    if (callback.pathname!=='/api/oauth/callback' || callback.username || callback.password || callback.search || callback.hash ||
      (callback.protocol!=='https:' && !(callback.protocol==='http:' && ['127.0.0.1','localhost'].includes(callback.hostname)))) {
      throw Error('Invalid upstream OAuth callback URL');
    }
    const key = Buffer.from(z.string().regex(opaque).parse(env.UPSTREAM_OAUTH_KEY),'base64url');
    return new DelegatedOAuth(
      JSON.parse(env.UPSTREAM_OAUTH_CONFIG),callback,new OAuthVault(env.UPSTREAM_OAUTH_PATH??statePath+'.oauth.sqlite',key),
    );
  }

  isDelegated(server:{id:string;url:string}) {
    const config = this.configs.get(server.id);
    return !!config && new URL(config.url).href===new URL(server.url).href;
  }

  reserves(id:string) { return this.configs.has(id); }

  private config(id:string) {
    const config = this.configs.get(id);
    if (!config) throw Error('OAuth upstream unavailable');
    return config;
  }

  private async using<T>(url:URL,task:(network:Network)=>Promise<T>) {
    const network = this.network(url,false);
    try { return await task(network); }
    finally { await network.close(); }
  }

  private async discovery(config:Config) {
    const server = new URL(config.url);
    const issuer = new URL(config.issuer);
    const resource = await this.using(server,network=>discoverOAuthProtectedResourceMetadata(server,{},network.fetch));
    if (!resource || new URL(resource.resource).href!==server.href ||
      !resource.authorization_servers?.some(value=>new URL(value).href===issuer.href)) {
      throw Error('Unapproved upstream authorization issuer');
    }
    return this.using(issuer,async network => {
      const metadata = await discoverAuthorizationServerMetadata(issuer,{fetchFn:network.fetch});
      if (!metadata || new URL(metadata.issuer).href!==issuer.href || !metadata.code_challenge_methods_supported?.includes('S256')) {
        throw Error('Issuer metadata or S256 support missing');
      }
      const revocation = config.revocationEndpoint??('revocation_endpoint' in metadata?metadata.revocation_endpoint:undefined);
      const endpoints = {
        authorization:issuerEndpoint(config,metadata.authorization_endpoint).href,
        resource:resource.resource,
        token:issuerEndpoint(config,metadata.token_endpoint).href,
        revocation:revocation?issuerEndpoint(config,revocation).href:undefined,
      };
      return {resource:resource.resource,endpoints,metadata};
    });
  }

  async start(subject:string,id:string,browser:string) {
    if (!opaque.test(browser)) throw Error('Invalid browser binding');
    return this.exclusive(subject,id,()=>this.begin(subject,id,browser));
  }

  private async begin(subject:string,id:string,browser:string) {
    const config = this.config(id);
    const {resource,endpoints,metadata} = await this.discovery(config);
    let previous;
    try { previous = this.credential(subject,config); }
    catch { /* A fresh grant may replace credentials after a key or binding change. */ }
    let registration:Registration;
    if (config.clientId) {
      const secret = config.clientSecretEnv?process.env[config.clientSecretEnv]:undefined;
      const methods = metadata.token_endpoint_auth_methods_supported??['client_secret_basic'];
      if (secret && !methods.includes('client_secret_basic') && !methods.includes('client_secret_post')) {
        throw Error('No supported client authentication method');
      }
      registration = {
        client_id:config.clientId,
        client_secret:secret,
        token_endpoint_auth_method:secret?(methods.includes('client_secret_basic')?'client_secret_basic':'client_secret_post'):'none',
      };
    } else if (previous) registration = previous.registration;
    else if (metadata.registration_endpoint) {
      registration = await this.using(new URL(config.issuer),async network => {
        const response = await network.fetch(issuerEndpoint(config,metadata.registration_endpoint!),{
          method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({
            client_name:'MCP Code Mode Gateway',redirect_uris:[this.redirect.href],
            grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none',
          }),
        });
        if (!response.ok) throw Error('OAuth dynamic registration failed');
        return registrationSchema.parse(await readJson(response));
      });
    } else throw Error('Issuer requires a pre-registered client');

    const now = Date.now();
    for (const [state,item] of this.pending) {
      if (item.expires<=now || (item.subject===subject && item.id===id)) this.pending.delete(state);
    }
    if (this.pending.size>=256) throw Error('Too many pending OAuth connections');
    const state = random();
    const verifier = random();
    this.pending.set(state,{
      subject,id,binding:binding(config),browser:digest(browser),verifier,expires:now+600_000,endpoints,registration,
    });
    const authorization = new URL(endpoints.authorization);
    authorization.search = new URLSearchParams({
      response_type:'code',client_id:registration.client_id,redirect_uri:this.redirect.href,
      code_challenge:digest(verifier).toString('base64url'),code_challenge_method:'S256',state,resource,
      ...(config.scope?{scope:config.scope}:{}),
    }).toString();
    return {authorizationUrl:authorization.href};
  }

  async complete(state:string,code:string,browser:string,allowed:(subject:string,id:string)=>boolean) {
    if (!opaque.test(state) || !opaque.test(browser) || !code || code.length>4096) throw Error('Invalid OAuth callback');
    const pending = this.pending.get(state);
    if (!pending || pending.expires<=Date.now() || !timingSafeEqual(pending.browser,digest(browser))) {
      throw Error('Invalid OAuth state or browser binding');
    }
    const config = this.config(pending.id);
    await this.exclusive(pending.subject,pending.id,async () => {
      if (this.pending.get(state)!==pending || pending.expires<=Date.now()) throw Error('Invalid OAuth state');
      this.pending.delete(state);
      if (pending.binding!==binding(config) || !allowed(pending.subject,pending.id)) throw Error('OAuth connection no longer permitted');
      const tokens = await this.exchange(config,pending.endpoints.token,pending.registration,{
        grant_type:'authorization_code',code,redirect_uri:this.redirect.href,code_verifier:pending.verifier,
        resource:pending.endpoints.resource,
      });
      this.store(pending.subject,config,{tokens,registration:pending.registration,endpoints:pending.endpoints,expiresAt:expiry(tokens)});
    });
    return {subject:pending.subject,id:pending.id};
  }

  status(subject:string,id:string) {
    const config = this.config(id);
    try {
      const credential = this.credential(subject,config);
      if (!credential) return 'disconnected';
      if (credential.expiresAt!==null && credential.expiresAt<=Date.now() && !credential.tokens.refresh_token) return 'expired';
      return 'connected';
    } catch {
      return 'unavailable';
    }
  }

  async accessToken(subject:string,id:string) {
    const config = this.config(id);
    return this.exclusive(subject,id,async () => {
      const credential = this.credential(subject,config);
      if (!credential) return undefined;
      const {tokens,expiresAt,registration,endpoints} = credential;
      if (expiresAt===null || expiresAt>Date.now()+30_000) return tokens.access_token;
      if (!tokens.refresh_token) return expiresAt>Date.now()?tokens.access_token:undefined;
      const refreshed = await this.exchange(config,endpoints.token,registration,{
        grant_type:'refresh_token',refresh_token:tokens.refresh_token,resource:endpoints.resource,
      });
      const next = {...refreshed,refresh_token:refreshed.refresh_token??tokens.refresh_token};
      this.store(subject,config,{...credential,tokens:next,expiresAt:expiry(refreshed)});
      return refreshed.access_token;
    });
  }

  async disconnect(subject:string,id:string) {
    const config = this.config(id);
    return this.exclusive(subject,id,async () => {
      for (const [state,item] of this.pending) if (item.subject===subject && item.id===id) this.pending.delete(state);
      let credential;
      try { credential = this.credential(subject,config); }
      catch { /* Local deletion remains available after a key or binding change. */ }
      this.vault.delete(subject,id);
      const revocation = credential?.endpoints.revocation;
      if (!credential || !revocation) return {revoked:false};
      try {
        const {tokens,registration} = credential;
        await this.submit(config,revocation,registration,{
          token:tokens.refresh_token??tokens.access_token,
          token_type_hint:tokens.refresh_token?'refresh_token':'access_token',
        });
        return {revoked:true};
      } catch {
        return {revoked:false};
      }
    });
  }

  private credential(subject:string,config:Config) {
    const value = this.vault.read(subject,config.id,binding(config));
    return value===undefined ? undefined : recordSchema.parse(value);
  }

  private store(subject:string,config:Config,credential:Credential) {
    this.vault.write(subject,config.id,binding(config),credential);
  }

  private async exclusive<T>(subject:string,id:string,task:()=>Promise<T>) {
    const key = JSON.stringify([subject,id]);
    const previous = this.locks.get(key);
    const operation = (previous??Promise.resolve()).catch(()=>{}).then(task);
    this.locks.set(key,operation);
    try { return await operation; }
    finally { if (this.locks.get(key)===operation) this.locks.delete(key); }
  }

  private async exchange(config:Config,endpoint:string,registration:Registration,form:Record<string,string>) {
    const payload = await this.submit(config,endpoint,registration,form,true);
    return tokensSchema.parse(payload);
  }

  private async submit(config:Config,endpoint:string,registration:Registration,form:Record<string,string>,json=false) {
    const url = issuerEndpoint(config,endpoint);
    const body = new URLSearchParams(form);
    const headers = new Headers({'Accept':'application/json','Content-Type':'application/x-www-form-urlencoded'});
    const method = registration.token_endpoint_auth_method??'none';
    const secret = config.clientSecretEnv?process.env[config.clientSecretEnv]:registration.client_secret;
    if (method==='client_secret_basic' && secret) {
      const formEncode = (value:string) => new URLSearchParams({value}).toString().slice(6);
      headers.set('Authorization','Basic '+Buffer.from(formEncode(registration.client_id)+':'+formEncode(secret)).toString('base64'));
    } else {
      body.set('client_id',registration.client_id);
      if (method==='client_secret_post' && secret) body.set('client_secret',secret);
    }
    return this.using(url,async network => {
      const response = await network.fetch(url,{method:'POST',headers,body});
      if (!response.ok) throw Error('Issuer rejected OAuth request');
      if (json) return readJson(response);
      await response.body?.cancel();
    });
  }
}

const expiry = (tokens:z.infer<typeof tokensSchema>) =>
  tokens.expires_in===undefined ? null : Date.now()+1000*tokens.expires_in;

async function readJson(response:Response) {
  const read = response.body?.getReader();
  if (!read) throw Error('Empty OAuth response');
  const chunks:Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await read.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size>65536) throw Error('OAuth response too large');
      chunks.push(Buffer.from(chunk.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally {
    await read.cancel();
  }
}
