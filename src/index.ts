import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { Broker } from './broker.js';
import { execute } from './sandbox.js';
const config = z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),url:z.string().url(),tokenEnv:z.string().optional(),allow:z.array(z.string())})).parse(JSON.parse(await readFile(process.env.CONFIG_PATH??'config.json','utf8')));
const token=process.env.GATEWAY_TOKEN;
if (!token || token.length<32) throw new Error('GATEWAY_TOKEN must be at least 32 characters');
const broker=new Broker();
for (const c of config) {
  const url=new URL(c.url);
  if (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('HTTPS required');
  const upstreamToken=c.tokenEnv?process.env[c.tokenEnv]:undefined;
  if (c.tokenEnv&&!upstreamToken) throw new Error('Missing upstream token');
  const client=new Client({name:'mcp-code-mode',version:'0.1.0'});
  await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:upstreamToken?{Authorization:'Bearer '+upstreamToken}:{}}}));
  let cursor:string|undefined;
  do { const page=await client.listTools({cursor}); for(const t of page.tools) if(c.allow.includes(t.name)) broker.add({id:c.id+'.'+t.name,name:t.name,description:t.description??'',inputSchema:t.inputSchema,client}); cursor=page.nextCursor; } while(cursor);
}
const wrap=(v:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(v)}]});
let active=0;
createServer(async(req,res)=>{
  const expected=Buffer.from('Bearer '+token); const actual=Buffer.from(req.headers.authorization??'');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.writeHead(401).end();return;}
  if(req.url!=='/mcp'||req.method!=='POST'){res.writeHead(405).end();return;}
  if(req.headers.origin && req.headers.origin!==process.env.ALLOWED_ORIGIN){res.writeHead(403).end();return;}
  if(active>=4){res.writeHead(429).end();return;} active++;
  const server=new McpServer({name:'mcp-code-mode',version:'0.1.0'});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
  server.tool('search','Search allowed upstream tools',{query:z.string().max(200)},async({query})=>wrap(broker.search(query)));
  server.tool('describe','Get JSON Schema for a tool',{id:z.string().max(300)},async({id})=>wrap(broker.describe(id)));
  server.tool('execute','Execute JavaScript async function body; use await mcp.call(id,args). Return only required data.',{code:z.string().max(32768)},async({code})=>wrap(await execute(code,broker)));
  try {
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413).end();return;}chunks.push(chunk);}
    await server.connect(transport);
    await transport.handleRequest(req,res,JSON.parse(Buffer.concat(chunks).toString()));
  } catch {if(!res.headersSent)res.writeHead(400).end();else res.end();}
  finally {active--;await server.close();}
}).listen(Number(process.env.PORT??3000),'127.0.0.1');
