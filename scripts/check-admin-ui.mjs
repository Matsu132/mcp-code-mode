import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, writeFile, rm, cp, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const project = resolve(import.meta.dirname,'..');
const temporary = await mkdtemp(join(tmpdir(),'mcp-ui-'));
const children = [];
const screenshots = process.env.UI_SCREENSHOTS_DIR;
const processes = (args,cwd,env) => {
  const child = spawn(process.execPath,args,{cwd,env:{...process.env,...env},stdio:['ignore','ignore','inherit']});
  children.push(child);
  return child;
};
async function openPort(server) {
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return server.address().port;
}
async function freePort() {
  const server = createServer();
  const port = await openPort(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function ready(url) {
  for (let attempts=0; attempts<100; attempts++) {
    const response = await fetch(url,{signal:AbortSignal.timeout(300)}).catch(() => null);
    if(response) return;
    await delay(50);
  }
  throw Error('Service did not start');
}

const upstream = createServer(async (req,res) => {
  const mcp = new McpServer({name:'inventory-fixture',version:'1.0.0'});
  mcp.tool('count','Read the number of inventory items',{}, async () => ({content:[{type:'text',text:'3'}]}));
  const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req,res);
  } finally { await mcp.close(); }
});
let browser;
try {
  const upstreamPort = await openPort(upstream);
  const config = join(temporary,'config.json');
  await writeFile(config,JSON.stringify([{id:'inventory',url:`http://127.0.0.1:${upstreamPort}/mcp`,allow:['count']}]));
  const gatewayPort = await freePort();
  const adminPort = await freePort();
  const token = 'ui-fixture-local-credential-0123456789';
  const base = `http://127.0.0.1:${gatewayPort}`;
  const admin = `http://127.0.0.1:${adminPort}`;
  processes(['dist/index.js'],project,{PORT:gatewayPort,STATE_PATH:join(temporary,'state.json'),CONFIG_PATH:config,GATEWAY_TOKEN:token});
  const standalone = join(project,'apps/admin/.next/standalone');
  await cp(join(project,'apps/admin/.next/static'),join(standalone,'.next/static'),{recursive:true});
  processes(['server.js'],standalone,{PORT:adminPort,HOSTNAME:'127.0.0.1',GATEWAY_URL:base});
  await Promise.all([ready(base+'/admin/state'),ready(admin)]);
  browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  await page.goto(admin);
  await page.getByLabel('Access token').fill('invalid-token');
  await page.getByRole('button',{name:'Load catalog'}).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(),/Authentication|denied|failed|invalid/i);
  await page.getByLabel('Access token').fill(token);
  await page.getByRole('button',{name:'Load catalog'}).click();
  await page.getByText('inventory.count',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Access token').inputValue(),'');
  if (screenshots) {
    await mkdir(screenshots,{recursive:true});
    await page.screenshot({path:join(screenshots,'admin-dashboard.png'),fullPage:true});
  }
  await page.getByRole('button',{name:'Toggle color mode'}).click();
  await page.setViewportSize({width:400,height:850});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true);
  await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'Tools'}).click();
  await page.getByRole('heading',{name:'Tools',exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('link',{name:'管理',exact:true}).click();
  await page.getByLabel('Administrator access token').fill(token);
  await page.getByRole('button',{name:'読み込み'}).click();
  await page.getByRole('button',{name:'追加',exact:true}).click();
  await page.getByLabel('Subject',{exact:true}).fill('fixture-viewer');
  await page.getByLabel('Allowed tool IDs (comma separated)').fill('inventory.count');
  const [saved] = await Promise.all([
    page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='PUT'),
    page.getByRole('button',{name:'保存',exact:true}).click(),
  ]);
  assert.equal(saved.status(),200);
  await page.reload();
  await page.getByLabel('Administrator access token').fill(token);
  await page.getByRole('button',{name:'読み込み'}).click();
  const subject = page.getByLabel('Subject',{exact:true});
  await subject.waitFor();
  assert.equal(await subject.inputValue(),'fixture-viewer');
  await page.getByText('success',{exact:true}).waitFor();
  await page.getByLabel('Administrator access token').blur();
  if (screenshots) await page.screenshot({path:join(screenshots,'admin-policy-audit.png'),fullPage:true});
  assert.deepEqual(pageErrors,[]);
  console.log('Browser smoke check passed: invalid authentication, catalog, token clearing, dark-mode toggle, mobile navigation, policy save and reload, audit log.');
} finally {
  await browser?.close();
  const exits = children.filter(p=>p.exitCode===null&&p.signalCode===null).map(p=>{
    const exit = once(p,'exit');
    p.kill();
    return exit;
  });
  await Promise.all(exits);
  upstream.closeAllConnections();
  upstream.close();
  await rm(temporary,{recursive:true,force:true});
}
