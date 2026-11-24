import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {Broker,type Entry} from './broker.js';
import {ExecutionQueue} from './execution-queue.js';
import {executeIsolated as execute} from './isolated.js';
import {Management} from './management.js';
import {transpile} from './types.js';
import {createAuth,permitted} from './auth.js';
import {adminPage} from './admin.js';
const config=z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),url:z.string().url(),tokenEnv:z.string().optional(),allow:z.array(z.string())})).parse(JSON.parse(await readFile(process.env.CONFIG_PATH??'config.json','utf8')));
const auth=createAuth(process.env);
const management=await Management.open(process.env.STATE_PATH??'state.json');
const broker=new Broker();
const clients: {c:(typeof config)[number];client:Client}[]=[];
for(const c of config){
  const url=new URL(c.url);
  if(url.username||url.password||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw Error('Trusted HTTPS URL required');
  const upstreamToken=c.tokenEnv?process.env[c.tokenEnv]:undefined;
  if(c.tokenEnv&&!upstreamToken)throw Error('Missing upstream token');
  const client=new Client({name:'mcp-code-mode',version:'0.1.0'});
  await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{redirect:'error',headers:upstreamToken?{Authorization:'Bearer '+upstreamToken}:{}}}));
  clients.push({c,client});
}
async function refresh(){const entries:Entry[]=[];for(const {c,client} of clients){let cursor:string|undefined;let pages=0;do{if(++pages>100)throw Error('Too many pages');const page=await client.listTools({cursor}, {timeout:10000});for(const t of page.tools)if(c.allow.includes(t.name))entries.push({id:c.id+'.'+t.name,name:t.name,description:t.description??'',inputSchema:t.inputSchema,client});cursor=page.nextCursor;}while(cursor);}broker.replace(entries);}
await refresh();
let refreshing=false;
const interval=setInterval(()=>{if(refreshing)return;refreshing=true;void refresh().catch(()=>{broker.replace([]);console.error(JSON.stringify({event:'refresh_failed'}));}).finally(()=>refreshing=false);},60000);interval.unref();
const wrap=(v:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(v)}]});
const executionQueue=new ExecutionQueue(
  z.coerce.number().int().min(1).max(16).parse(process.env.EXECUTION_CONCURRENCY??4),
  z.coerce.number().int().min(0).max(128).parse(process.env.EXECUTION_QUEUE_SIZE??8),
  z.coerce.number().int().min(100).max(15000).parse(process.env.EXECUTION_QUEUE_WAIT_MS??5000),
);
let active=0;
const http=createServer(async(req,res)=>{
  const requestId=randomUUID();
  const allowedHost=process.env.ALLOWED_HOST??'127.0.0.1:'+String(process.env.PORT??3000);
  if(req.headers.host!==allowedHost){res.writeHead(403).end();return;}
  if(req.headers.origin&&req.headers.origin!==process.env.ALLOWED_ORIGIN){res.writeHead(403).end();return;}
  if(req.method==='GET'&&auth.metadata&&['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(req.url??'')){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(auth.metadata));return;}
  if(req.url==='/admin'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}).end(adminPage);return;}
  if(!['/mcp','/admin/catalog','/admin/state'].includes(req.url??'')||(req.url==='/mcp'?req.method!=='POST':req.url==='/admin/state'?!['GET','PUT'].includes(req.method??''):req.method!=='GET')){res.writeHead(405).end();return;}
  if(active>=32){res.writeHead(429).end();return;}active++;
  let server:McpServer|undefined;
  try{
    const principal=await auth.authenticate(req.headers.authorization??'');
    if(!principal){const challenge=auth.metadata?'Bearer resource_metadata="'+new URL('/.well-known/oauth-protected-resource/mcp',auth.metadata.resource).href+'"':'Bearer';res.writeHead(401,{'WWW-Authenticate':challenge}).end();return;}
    const bootstrapAdmin=principal.admin===true;
    const roles=()=>management.roles;
    if(roles().disabled(principal.id,bootstrapAdmin)){res.writeHead(403).end();return;}
    const can=(operation:'read'|'execute'|'manage',id?:string)=>roles().permits(principal.id,bootstrapAdmin,operation,id);
    const allowed=(id:string,operation:'read'|'execute'='read')=>can(operation,id)&&permitted(principal,id)&&management.allowed(principal.id,id);
    if(req.url==='/admin/state'&&!can('manage')){res.writeHead(403).end();return;}
    if(req.url==='/admin/state'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(management.view()));return;}
    if(req.url==='/admin/catalog'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({subject:principal.id,tools:broker.search('',id=>allowed(id))}));return;}
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413).end();return;}chunks.push(chunk);}
    if(req.url==='/admin/state'){await management.update(JSON.parse(Buffer.concat(chunks).toString()));management.record({requestId,subject:principal.id,id:'',status:'success',durationMs:0,kind:'policy_update'});res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(management.view()));return;}
    server=new McpServer({name:'mcp-code-mode',version:'0.1.0'});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    server.tool('search','Search allowed upstream tools',{query:z.string().max(200)},async({query})=>wrap(broker.search(query,id=>allowed(id))));
    server.tool('describe','Get schema and TypeScript declaration',{id:z.string().max(300)},async({id})=>{if(!allowed(id))throw Error('Unknown or denied tool');return wrap(broker.describe(id));});
    const connection=new AbortController();
    res.once('close',()=>connection.abort());
    server.tool('execute','Execute JavaScript or TypeScript async body. Use mcp.call(id,args); return required data.',{code:z.string().max(32768),language:z.enum(['javascript','typescript']).optional()},async({code,language},{signal:requestSignal})=>{
      if(!can('execute')){
        management.record({requestId,subject:principal.id,id:'',status:'denied',durationMs:0});
        throw Error('Execution denied');
      }
      const executionSignal=AbortSignal.any([requestSignal,connection.signal]);
      return wrap(await executionQueue.run(executionSignal,()=>execute(language==='typescript'?transpile(code):code,{call:async(id,args,signal)=>{
        if(!allowed(id,'execute')){
          management.record({requestId,subject:principal.id,id,status:'denied',durationMs:0});
          throw Error('Unknown or denied tool');
        }
        const start=Date.now();
        try{
          const result=await broker.call(id,args,signal);
          management.record({requestId,subject:principal.id,id,status:'success',durationMs:Date.now()-start});
          return result;
        }catch(error){
          const status=signal.aborted?'timeout':'failed';
          management.record({requestId,subject:principal.id,id,status,durationMs:Date.now()-start});
          throw error;
        }
      }},{signal:executionSignal})));
    });
    await server.connect(transport);await transport.handleRequest(req,res,JSON.parse(Buffer.concat(chunks).toString()));
  }catch{if(!res.headersSent)res.writeHead(400).end();else res.end();}
  finally{active--;await server?.close();}
});
http.requestTimeout=20000;http.headersTimeout=10000;
http.listen(Number(process.env.PORT??3000),process.env.BIND_HOST??'127.0.0.1');
