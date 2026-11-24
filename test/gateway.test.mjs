import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

test('HTTP gateway connects to MCP, executes allowed calls and persists administrator changes', {timeout:20000}, async t => {
  const upstream = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer fixture-upstream') {
      res.writeHead(401).end();
      return;
    }
    const server = new McpServer({name:'inventory-fixture',version:'1.0.0'});
    server.tool('count', {}, async () => ({content:[{type:'text',text:'3'}]}));
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    try {
      await server.connect(transport);
      await transport.handleRequest(req,res);
    } finally {
      await server.close();
    }
  });
  const upstreamPort = await listen(upstream);
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const dir = await mkdtemp(join(tmpdir(),'mcp-gateway-'));
  t.after(() => rm(dir,{force:true,recursive:true}));
  const config = join(dir,'config.json');
  await writeFile(config,JSON.stringify([{id:'inventory',url:`http://127.0.0.1:${upstreamPort}/mcp`,tokenEnv:'FIXTURE_TOKEN',allow:['count']}]));
  const reserved = createServer();
  const port = await listen(reserved);
  await new Promise(resolve => reserved.close(resolve));
  const gateway = new URL(`http://127.0.0.1:${port}`);
  const headers = {Authorization:`Bearer ${'test-gateway-token-'.repeat(3)}`};
  const child = spawn(process.execPath,['dist/index.js'],{
    env:{PORT:String(port),CONFIG_PATH:config,STATE_PATH:join(dir,'state.json'),GATEWAY_TOKEN:headers.Authorization.slice(7),FIXTURE_TOKEN:'fixture-upstream'},
    stdio:'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child,'exit');
      child.kill();
      await exit;
    }
  });
  const state = new URL('/admin/state',gateway);
  let ready;
  for (let attempt=0; attempt<100; attempt++) {
    ready = await fetch(state,{signal:AbortSignal.timeout(300)}).catch(() => undefined);
    if (ready || child.exitCode !== null) break;
    await delay(50);
  }
  assert.equal(ready?.status,401);

  const client = new Client({name:'fixture-client',version:'1.0.0'});
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp',gateway),{requestInit:{headers}}));
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(),['describe','execute','search']);
  const call = (name,args) => client.callTool({name,arguments:args});
  const tools = await call('search',{query:'count'});
  assert.equal(JSON.parse(tools.content[0].text)[0].id,'inventory.count');
  const execute = () => call('execute',{code:"return (await mcp.call('inventory.count',{})).content[0].text;"});
  assert.equal(JSON.parse((await execute()).content[0].text),'3');

  const updated = await fetch(state,{
    method:'PUT',
    headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({rules:[{subject:'operator',allow:[]}]}),
  });
  assert.equal(updated.status,200);
  assert.equal((await execute()).isError,true);
  const response = await fetch(state,{headers});
  assert.equal(response.status,200);
  const {audit} = await response.json();
  assert.deepEqual(audit.map(({kind,status}) => [kind,status]),[
    ['tool_call','denied'],['policy_update','success'],['tool_call','success'],
  ]);
});
