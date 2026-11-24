import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress,validateEndpoint} from '../dist/upstream-network.js';

test('admin-managed endpoint policy requires TLS and public IP addresses', () => {
  assert.equal(publicAddress('8.8.8.8'),true);
  assert.equal(publicAddress('2606:4700::1111'),true);
  for (const address of ['127.0.0.1','169.254.169.254','10.1.2.3','100.64.0.1','192.0.2.1','::1','fc00::1','fec0::1','::ffff:127.0.0.1']) {
    assert.equal(publicAddress(address),false,address);
  }
  assert.throws(()=>validateEndpoint('http://127.0.0.1:9000/mcp',false));
  assert.throws(()=>validateEndpoint('https://127.0.0.1/mcp',false));
  assert.throws(()=>validateEndpoint('https://example.invalid/mcp?token=fixture',false));
  assert.throws(()=>validateEndpoint('https://example.invalid/mcp#fragment',false));
  assert.equal(validateEndpoint('https://example.invalid/mcp',false).protocol,'https:');
  assert.equal(validateEndpoint('http://127.0.0.1:9000/mcp',true).hostname,'127.0.0.1');
});
