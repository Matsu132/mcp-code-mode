import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {catalogBenchmark,syntheticBenchmark} from './benchmark.js';
import {Broker} from './broker.js';
import {Upstreams} from './upstreams.js';
import {DelegatedOAuth} from './upstream-oauth.js';
import {defaults,executionSettings} from './execution-settings.js';
import {ExecutionQueue} from './execution-queue.js';
import {executeIsolated as execute} from './isolated.js';
import {Management} from './management.js';
import {createAuth,permitted,type Principal} from './auth.js';
import {adminPage} from './admin.js';
const statePath=process.env.STATE_PATH??'state.json';
const management=await Management.open(statePath);
const auth=createAuth(process.env,subject=>management.roles.enrollment(subject));
const broker=new Broker();
const delegated=DelegatedOAuth.fromEnvironment(process.env,statePath);
const upstreams=await Upstreams.open(process.env.CONFIG_PATH??'config.json',process.env.UPSTREAMS_PATH??statePath+'.servers.json',broker,delegated);
await upstreams.refresh();
const interval=setInterval(()=>void upstreams.refresh().catch(()=>console.error(JSON.stringify({event:'refresh_failed'}))),60000);
interval.unref();
const wrap=(v:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(v)}]});
let limits=management.execution??defaults(process.env);
const executionQueue=new ExecutionQueue(limits.concurrency,limits.queueSize,limits.queueWaitMs);
const delegatedConnections=new ExecutionQueue(16,32,3000);
const exactId=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const oauthCommand=z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('connect'),id:exactId,browser:z.string().max(100)}),
  z.strictObject({action:z.literal('disconnect'),id:exactId}),
]);
const oauthCallback=z.strictObject({code:z.string().max(4096),state:z.string().max(100),browser:z.string().max(100)});
const can=(principal:Principal,operation:'read'|'execute'|'manage',id?:string)=>
  management.roles.permits(principal.id,principal.admin===true,operation,id);
const allowed=(principal:Principal,id:string,operation:'read'|'execute'='read')=>
  can(principal,operation,id)&&permitted(principal,id)&&management.allowed(principal.id,id);
const delegatedAvailable=(id:string)=>upstreams.delegated().some(item=>item.allow.some(name=>item.id+'.'+name===id));
const mayConnect=(principal:Principal,id:string)=>
  upstreams.delegated().some(server=>server.id===id && server.allow.some(name=>
    allowed(principal,id+'.'+name) || allowed(principal,id+'.'+name,'execute'),
  ));

async function readBody(req:AsyncIterable<Buffer>) {
  const chunks:Buffer[]=[];
  let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>65536) return undefined;
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}
const allowedHost=process.env.ALLOWED_HOST??'127.0.0.1:'+String(process.env.PORT??3000);
const allowedHosts=new Set([allowedHost,...(process.env.ADDITIONAL_ALLOWED_HOSTS??'').split(',').map(host=>host.trim()).filter(Boolean)]);
let active=0;
const http=createServer(async(req,res)=>{
  const requestId=randomUUID();
  if(!req.headers.host||!allowedHosts.has(req.headers.host)){res.writeHead(403).end();return;}
  if(req.headers.origin&&req.headers.origin!==process.env.ALLOWED_ORIGIN){res.writeHead(403).end();return;}
  if(req.method==='GET'&&req.url==='/health'){res.writeHead(204,{'Cache-Control':'no-store'}).end();return;}
  if(req.method==='GET'&&auth.metadata&&['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(req.url??'')){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(auth.metadata));return;}
  if(req.url==='/admin'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}).end(adminPage);return;}
  const [path,query='']=(req.url??'').split('?',2);
  const params=new URLSearchParams(query);
  const method=req.method??'';
  const methods:Record<string,string[]> = {
    '/mcp':['POST'],
    '/admin/catalog':['GET'],
    '/admin/state':['GET','PUT'],
    '/admin/audit':['GET'],
    '/admin/settings':['GET','PUT'],
    '/admin/benchmarks':['GET'],
    '/admin/upstreams':['GET','PUT'],
    '/admin/upstreams/test':['POST'],
    '/admin/upstreams/refresh':['POST'],
    '/oauth/connections':['GET','POST'],
    '/oauth/callback':['POST'],
  };
  if(!Object.hasOwn(methods,path)||!methods[path].includes(method)){res.writeHead(405).end();return;}
  const pagination=z.object({q:z.string().max(200).default(''),offset:z.coerce.number().int().min(0).max(1000000).default(0),limit:z.coerce.number().int().min(1).max(100).default(50)});
  const json=(data:unknown)=>res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(data));
  if(active>=32){res.writeHead(429).end();return;}active++;
  let server:McpServer|undefined;
  const connection=new AbortController();
  res.once('close',()=>connection.abort());
  const sessions=new Map<string,Promise<Awaited<ReturnType<Upstreams['openDelegated']>>|undefined>>();
  try{
    if(path==='/oauth/callback'){
      if(!delegated){res.writeHead(404).end();return;}
      const body=await readBody(req);
      if(body===undefined){res.writeHead(413).end();return;}
      const {state,code,browser}=oauthCallback.parse(body);
      const completed=await delegated.complete(state,code,browser,(subject,id)=>{
        const principal=auth.principalFor(subject);
        return !!principal && !management.roles.disabled(principal.id,principal.admin===true) && mayConnect(principal,id);
      });
      management.record({requestId,subject:completed.subject,id:completed.id,status:'success',durationMs:0,kind:'oauth_connect'});
      json({connected:true});return;
    }
    const principal=await auth.authenticate(req.headers.authorization??'');
    if(!principal){const challenge=auth.metadata?'Bearer resource_metadata="'+new URL('/.well-known/oauth-protected-resource/mcp',auth.metadata.resource).href+'"':'Bearer';res.writeHead(401,{'WWW-Authenticate':challenge}).end();return;}
    if(management.roles.disabled(principal.id,principal.admin===true)){res.writeHead(403).end();return;}
    const permittedTool=(id:string,operation:'read'|'execute'='read')=>allowed(principal,id,operation);
    const openSession=(id:string)=>{
      const existing=sessions.get(id);
      if(existing)return existing;
      const session=delegatedConnections.run(connection.signal,async()=>{
        const token=await delegated?.accessToken(principal.id,id);
        if(!token||!mayConnect(principal,id))return undefined;
        return upstreams.openDelegated(id,token);
      }).catch(()=>undefined);
      sessions.set(id,session);
      return session;
    };
    const requestCatalog=async()=>{
      if(!delegated)return broker;
      const users=await Promise.all(upstreams.delegated().filter(item=>item.allow.some(name=>
        permittedTool(item.id+'.'+name),
      )).map(item=>openSession(item.id)));
      const catalog=broker.snapshot();
      for(const user of users)for(const entry of user?.entries??[])if(delegatedAvailable(entry.id))catalog.add(entry);
      return catalog;
    };
    const describe=async(id:string)=>{
      if(!permittedTool(id))throw Error('Unknown or denied tool');
      const [upstreamId]=id.split('.',1);
      if(!delegated?.reserves(upstreamId))return broker.describe(id);
      const session=await openSession(upstreamId);
      if(!delegatedAvailable(id)||!permittedTool(id))throw Error('Unknown or denied tool');
      const temporary=new Broker();
      temporary.replace(session?.entries??[]);
      return temporary.describe(id);
    };
    if(path.startsWith('/admin/')&&path!=='/admin/catalog'&&!can(principal,'manage')){res.writeHead(403).end();return;}
    if(path==='/admin/state'&&method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(management.view()));return;}
    if(path==='/admin/audit'){
      const {q,limit,offset}=pagination.parse(Object.fromEntries(params));
      json(management.events(q,limit,offset));return;
    }
    if(path==='/admin/settings'&&method==='GET'){json(limits);return;}
    if(path==='/admin/benchmarks'){
      const entries=(await requestCatalog()).catalog(id=>permittedTool(id)).map(({id,description,inputSchema})=>({
        name:id,description,inputSchema,
      }));
      json({synthetic:syntheticBenchmark(),catalog:catalogBenchmark(entries),latency:management.metrics(principal.id)});
      return;
    }
    if(path==='/admin/catalog'){
      const id=params.get('tool');
      if(id!==null){json(await describe(z.string().min(1).max(300).parse(id)));return;}
      const {q,limit,offset}=pagination.parse(Object.fromEntries(params));
      const entries=(await requestCatalog()).catalog(id=>permittedTool(id));
      const term=q.trim().toLowerCase();
      const matching=entries.filter(entry=>(entry.id+' '+entry.description).toLowerCase().includes(term));
      matching.sort((a,b)=>a.id.localeCompare(b.id));
      json({
        subject:principal.id,
        tools:matching.slice(offset,offset+limit).map(({id,description})=>({id,description:description.slice(0,500)})),
        total:matching.length,
        visibleTools:entries.length,
        visibleServers:new Set(entries.map(entry=>entry.id.split('.',1)[0])).size,
        executions:management.metrics(can(principal,'manage')?undefined:principal.id),
      });
      return;
    }
    if(path==='/admin/upstreams'&&method==='GET'){json(upstreams.view());return;}
    if(path==='/admin/upstreams/refresh'){await upstreams.refresh();json(upstreams.view());return;}
    if(path==='/oauth/connections'&&method==='GET'){
      json(upstreams.delegated(true)
        .map(item=>({id:item.id,canConnect:mayConnect(principal,item.id),status:delegated?.status(principal.id,item.id)??'disconnected'}))
        .filter(item=>item.canConnect||item.status!=='disconnected'));
      return;
    }
    const body=await readBody(req);
    if(body===undefined){res.writeHead(413).end();return;}
    if(path==='/admin/settings'){
      const updated=executionSettings.parse(body);
      await management.update({execution:updated});
      limits=updated;
      executionQueue.configure(updated.concurrency,updated.queueSize,updated.queueWaitMs);
      management.record({requestId,subject:principal.id,id:'',status:'success',durationMs:0,kind:'settings_update'});
      json(limits);return;
    }
    if(path==='/admin/state'){
      const settings=z.strictObject({rules:z.unknown().optional(),roles:z.unknown().optional(),assignments:z.unknown().optional()}).parse(body);
      await management.update(settings);
      management.record({requestId,subject:principal.id,id:'',status:'success',durationMs:0,kind:'policy_update'});
      json(management.view());return;
    }
    if(path==='/admin/upstreams'){
      await upstreams.update(body);
      management.record({requestId,subject:principal.id,id:'',status:'success',durationMs:0,kind:'server_update'});
      json(upstreams.view());return;
    }
    if(path==='/admin/upstreams/test'){json(await upstreams.test(body));return;}
    if(path==='/oauth/connections'){
      if(!delegated){res.writeHead(404).end();return;}
      const command=oauthCommand.parse(body);
      if(command.action==='disconnect'){
        const result=await delegated.disconnect(principal.id,command.id);
        management.record({requestId,subject:principal.id,id:command.id,status:'success',durationMs:0,kind:'oauth_disconnect'});
        json(result);return;
      }
      if(!mayConnect(principal,command.id)){res.writeHead(403).end();return;}
      json(await delegated.start(principal.id,command.id,command.browser));return;
    }
    server=new McpServer({name:'mcp-code-mode',version:'0.1.0'});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    server.tool('search','Search allowed upstream tools',{query:z.string().max(200)},async({query})=>wrap((await requestCatalog()).search(query,id=>permittedTool(id))));
    server.tool('describe','Get schema and TypeScript declaration',{id:z.string().max(300)},async({id})=>wrap(await describe(id)));
    server.tool('execute','Execute JavaScript or TypeScript async body. Use mcp.call(id,args); return required data.',{code:z.string().max(32768),language:z.enum(['javascript','typescript']).optional()},async({code,language},{signal:requestSignal})=>{
      const started=Date.now();
      if(!can(principal,'execute')){
        management.record({requestId,subject:principal.id,id:'',status:'denied',durationMs:0,kind:'execution'});
        throw Error('Execution denied');
      }
      const executionSignal=AbortSignal.any([requestSignal,connection.signal]);
      try {
        const result=await executionQueue.run(executionSignal,()=>execute(code,{call:async(id,args,signal)=>{
        if(!permittedTool(id,'execute')){
          management.record({requestId,subject:principal.id,id,status:'denied',durationMs:0});
          throw Error('Unknown or denied tool');
        }
        const start=Date.now();
        try{
          let target=broker;
          const [upstreamId]=id.split('.',1);
          if(delegated?.reserves(upstreamId)){
            const session=await openSession(upstreamId);
            if(!delegatedAvailable(id)||!permittedTool(id,'execute'))throw Error('Unknown or denied tool');
            target=new Broker();
            target.replace(session?.entries??[]);
          }
          const result=await target.call(id,args,signal);
          const status=(JSON.parse(result) as {isError?:boolean}).isError?'failed':'success';
          management.record({requestId,subject:principal.id,id,status,durationMs:Date.now()-start});
          return result;
        }catch(error){
          const status=signal.aborted
            ? (signal.reason instanceof Error&&signal.reason.message.includes('deadline')?'timeout':'cancelled')
            : 'failed';
          management.record({requestId,subject:principal.id,id,status,durationMs:Date.now()-start});
          throw error;
        }
        }},{signal:executionSignal,timeoutMs:limits.timeoutMs,language}));
        management.record({requestId,subject:principal.id,id:'',status:'success',durationMs:Date.now()-started,kind:'execution'});
        return wrap(result);
      } catch (error) {
        const status=executionSignal.aborted?'cancelled':error instanceof Error&&error.message.includes('deadline')?'timeout':'failed';
        management.record({requestId,subject:principal.id,id:'',status,durationMs:Date.now()-started,kind:'execution'});
        throw error;
      }
    });
    await server.connect(transport);await transport.handleRequest(req,res,body);
  }catch{if(!res.headersSent)res.writeHead(400).end();else res.end();}
  finally{
    connection.abort();
    try {
      await Promise.allSettled([server?.close(),...[...sessions.values()].map(async session=>(await session)?.close())]);
    } finally {
      active--;
    }
  }
});
http.requestTimeout=20000;http.headersTimeout=10000;
http.listen(Number(process.env.PORT??3000),process.env.BIND_HOST??'127.0.0.1');
