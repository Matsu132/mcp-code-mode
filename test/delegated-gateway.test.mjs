import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {SignJWT,exportJWK,generateKeyPair} from 'jose';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

async function listen(server) {
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return server.address().port;
}

test('authenticated users keep separate OAuth sessions, catalogs and tool results', {timeout:20000}, async t => {
  const issuer = 'https://identity.fixture.test';
  const audience = 'https://gateway.fixture.test/mcp';
  const resource = 'https://resource.fixture.test/mcp';
  const {publicKey,privateKey} = await generateKeyPair('ES256');
  const jwk = {...await exportJWK(publicKey),kid:'fixture-key',alg:'ES256'};
  const jwt = (subject,aud=audience) => new SignJWT({}).setProtectedHeader({alg:'ES256',kid:jwk.kid})
    .setIssuer(issuer).setAudience(aud).setSubject(subject).setExpirationTime('5m').sign(privateKey);
  const tokens = await Promise.all(['alice','bob','viewer','admin','unknown'].map(subject=>jwt(subject)));
  const [alice,bob,viewer,admin,unknown] = tokens;
  const upstream = createServer(async (req,res) => {
    const user = /^Bearer upstream-(alice|bob)$/.exec(req.headers.authorization??'')?.[1];
    if (!user) return res.writeHead(401).end();
    const mcp = new McpServer({name:'private-'+user,version:'1.0.0'});
    mcp.tool(user+'_read',{},async()=>({content:[{type:'text',text:user+' private result'}]}));
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req,res);
    } finally { await mcp.close(); }
  });
  const upstreamPort = await listen(upstream);
  t.after(()=>{upstream.closeAllConnections();upstream.close();});
  const reserved = createServer();
  const port = await listen(reserved);
  await new Promise(resolve=>reserved.close(resolve));
  const directory = await mkdtemp(join(tmpdir(),'mcp-delegated-http-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const config = join(directory,'config.json');
  await writeFile(config,JSON.stringify([{id:'private',url:resource,allow:['alice_read','bob_read']}]));
  const child = spawn(process.execPath,['--import','./test/fixtures/delegated-network.mjs','dist/index.js'],{
    env:{
      PORT:String(port),CONFIG_PATH:config,STATE_PATH:join(directory,'state.json'),
      FIXTURE_MCP:`http://127.0.0.1:${upstreamPort}/mcp`,FIXTURE_JWK:JSON.stringify(jwk),
      OAUTH_CONFIG:JSON.stringify({
        issuer,jwks:issuer+'/jwks',resource:audience,
        users:['alice','bob','viewer','admin'].map(sub=>({sub,allow:['*']})),
      }),
      ADMIN_SUBJECTS:'admin',
      UPSTREAM_OAUTH_CONFIG:JSON.stringify([{id:'private',url:resource,issuer:'https://authorization.fixture.test',clientId:'gateway-fixture'}]),
      UPSTREAM_OAUTH_KEY:randomBytes(32).toString('base64url'),
      UPSTREAM_OAUTH_REDIRECT_URL:'https://gateway.fixture.test/api/oauth/callback',
    },
    stdio:'ignore',
  });
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill();await exit;}
  });
  const base=`http://127.0.0.1:${port}`;
  const headers = token => ({Authorization:'Bearer '+token,'Content-Type':'application/json'});
  const get = async (path,token) => fetch(base+path,{headers:headers(token)});
  const send = (path,token,body,method='POST') => fetch(base+path,{method,headers:headers(token),body:JSON.stringify(body)});
  let ready;
  for(let attempt=0;attempt<100;attempt++){
    ready=await fetch(base+'/.well-known/oauth-protected-resource/mcp',{signal:AbortSignal.timeout(300)}).catch(()=>undefined);
    if(ready||child.exitCode!==null)break;
    await delay(50);
  }
  assert.equal(ready?.status,200);
  assert.equal((await ready.json()).resource,audience);
  assert.equal((await get('/admin/upstreams',alice)).status,403);
  assert.equal((await get('/admin/catalog',unknown)).status,401);
  assert.equal((await get('/admin/catalog',await jwt('alice','https://other.fixture.test/mcp'))).status,401);
  assert.equal((await send('/admin/state',viewer,{assignments:[]},'PUT')).status,403);
  assert.equal((await send('/admin/state',admin,{assignments:[{subject:'viewer',role:'viewer',disabled:false}]},'PUT')).status,200);
  assert.equal((await send('/admin/state',viewer,{assignments:[]},'PUT')).status,403);

  const connect = async (token,user) => {
    const browser = randomBytes(32).toString('base64url');
    const initiated = await send('/oauth/connections',token,{action:'connect',id:'private',browser});
    assert.equal(initiated.status,200);
    const auth = new URL((await initiated.json()).authorizationUrl);
    assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
    const result = await send('/oauth/callback','',{browser,state:auth.searchParams.get('state'),code:user});
    assert.equal(result.status,200);
  };
  await connect(alice,'alice');
  const before = await get('/oauth/connections',bob);
  assert.equal((await before.json())[0].status,'disconnected');
  await connect(bob,'bob');

  const client = async token => {
    const session = new Client({name:'delegated-fixture',version:'1.0.0'});
    t.after(()=>session.close());
    await session.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:headers(token)}}));
    return (name,args)=>session.callTool({name,arguments:args});
  };
  const [callAlice,callBob,callViewer] = await Promise.all([client(alice),client(bob),client(viewer)]);
  const search = async call => JSON.parse((await call('search',{query:'read'})).content[0].text).map(tool=>tool.id);
  assert.deepEqual(await search(callAlice),['private.alice_read']);
  assert.deepEqual(await search(callBob),['private.bob_read']);
  assert.deepEqual(await search(callViewer),[]);
  assert.equal((await callAlice('describe',{id:'private.bob_read'})).isError,true);
  assert.equal((await callViewer('execute',{code:'return 1;'})).isError,true);
  const execute = (call,user)=>call('execute',{code:`return (await mcp.call("private.${user}_read",{})).content[0].text;`});
  const [aliceResult,bobResult] = await Promise.all([execute(callAlice,'alice'),execute(callBob,'bob')]);
  assert.equal(JSON.parse(aliceResult.content[0].text),'alice private result');
  assert.equal(JSON.parse(bobResult.content[0].text),'bob private result');
  assert.equal((await execute(callAlice,'bob')).isError,true);
  assert.equal((await send('/oauth/connections',alice,{action:'disconnect',id:'private'})).status,200);
  assert.deepEqual(await search(callAlice),[]);
  assert.deepEqual(await search(callBob),['private.bob_read']);
});
