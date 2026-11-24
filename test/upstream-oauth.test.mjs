import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {OAuthVault} from '../dist/oauth-vault.js';
import {DelegatedOAuth} from '../dist/upstream-oauth.js';

const resource = 'https://mcp.example.test/mcp';
const issuer = 'https://issuer.example.test';
const callback = new URL('https://gateway.example.test/api/oauth/callback');
const browser = () => randomBytes(32).toString('base64url');
const config = {id:'inventory',url:resource,issuer,scope:'inventory.read'};

test('delegated OAuth binds PKCE to browser and subject, encrypts credentials, serializes refresh, and revokes', async () => {
  const dir = await mkdtemp(join(tmpdir(),'mcp-oauth-'));
  const path = join(dir,'oauth.sqlite');
  const key = randomBytes(32);
  let vault = new OAuthVault(path,key);
  const expected = new Map();
  let registrations = 0;
  let refreshes = 0;
  const revocations = [];
  const network = origin=>({
    close:async()=>{},
    fetch:async(input,init)=>{
      const url = new URL(input);
      assert.equal(url.origin,origin.origin);
      if (url.pathname==='/.well-known/oauth-protected-resource/mcp') {
        return Response.json({resource,authorization_servers:[issuer]});
      }
      if (url.pathname==='/.well-known/oauth-authorization-server') {
        return Response.json({
          issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',
          registration_endpoint:issuer+'/register',revocation_endpoint:issuer+'/revoke',
          response_types_supported:['code'],code_challenge_methods_supported:['S256'],
          token_endpoint_auth_methods_supported:['none'],
        });
      }
      assert.equal(init.method,'POST');
      if (url.pathname==='/register') {
        const request = JSON.parse(init.body);
        assert.deepEqual(request.redirect_uris,[callback.href]);
        return Response.json({client_id:'client-'+(++registrations),token_endpoint_auth_method:'none'});
      }
      const form = new URLSearchParams(init.body);
      if (url.pathname==='/revoke') {
        revocations.push(form.get('token'));
        return new Response(null,{status:200});
      }
      assert.equal(url.pathname,'/token');
      assert.equal(form.get('resource'),resource);
      if (form.get('grant_type')==='authorization_code') {
        const user = form.get('code');
        const challenge = createHash('sha256').update(form.get('code_verifier')).digest('base64url');
        assert.equal(challenge,expected.get(user));
        assert.equal(form.get('redirect_uri'),callback.href);
        return Response.json({access_token:user+'-initial-token',refresh_token:user+'-refresh-token',token_type:'Bearer',expires_in:user==='alice'?1:3600});
      }
      assert.equal(form.get('grant_type'),'refresh_token');
      assert.equal(form.get('refresh_token'),'alice-refresh-token');
      refreshes++;
      return Response.json({access_token:'alice-renewed-token',token_type:'Bearer',expires_in:3600});
    },
  });
  const manager = () => new DelegatedOAuth([config],callback,vault,network);
  let oauth = manager();
  const start = async (subject,nonce) => {
    const {authorizationUrl} = await oauth.start(subject,'inventory',nonce);
    const url = new URL(authorizationUrl);
    assert.equal(url.origin,issuer);
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');
    assert.equal(url.searchParams.get('resource'),resource);
    expected.set(subject,url.searchParams.get('code_challenge'));
    return url.searchParams.get('state');
  };
  const allowed=(subject,id)=>['alice','bob'].includes(subject)&&id==='inventory';
  try {
    const aliceBrowser = browser();
    const bobBrowser = browser();
    const [alice,bob] = await Promise.all([start('alice',aliceBrowser),start('bob',bobBrowser)]);
    assert.notEqual(alice,bob);
    assert.equal(registrations,2);
    await assert.rejects(oauth.complete(alice,'alice',bobBrowser,allowed),/browser binding/);
    await oauth.complete(alice,'alice',aliceBrowser,allowed);
    await oauth.complete(bob,'bob',bobBrowser,allowed);
    await assert.rejects(oauth.complete(alice,'alice',aliceBrowser,allowed),/Invalid OAuth state/);
    assert.equal(oauth.status('carol','inventory'),'disconnected');
    assert.equal(await oauth.accessToken('carol','inventory'),undefined);
    assert.deepEqual(await Promise.all([
      oauth.accessToken('alice','inventory'),oauth.accessToken('alice','inventory'),oauth.accessToken('bob','inventory'),
    ]),['alice-renewed-token','alice-renewed-token','bob-initial-token']);
    assert.equal(refreshes,1);

    const stored = await readFile(path);
    for (const token of ['alice-renewed-token','alice-refresh-token','bob-initial-token','bob-refresh-token']) {
      assert.equal(stored.includes(token),false);
    }
    vault.close();
    vault = new OAuthVault(path,key);
    oauth = manager();
    assert.equal(await oauth.accessToken('alice','inventory'),'alice-renewed-token');
    assert.deepEqual(await oauth.disconnect('alice','inventory'),{revoked:true});
    assert.deepEqual(revocations,['alice-refresh-token']);
    assert.equal(await oauth.accessToken('alice','inventory'),undefined);
    assert.equal(await oauth.accessToken('bob','inventory'),'bob-initial-token');

    const noLongerAllowed = await start('alice',aliceBrowser);
    await assert.rejects(oauth.complete(noLongerAllowed,'alice',aliceBrowser,()=>false),/no longer permitted/);
    assert.equal(oauth.status('alice','inventory'),'disconnected');
  } finally {
    vault.close();
    await rm(dir,{recursive:true,force:true});
  }
});
