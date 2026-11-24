import {test} from 'node:test';import assert from 'node:assert/strict';import {executeIsolated} from '../dist/isolated.js';
const broker={call:async()=>JSON.stringify({ok:true})};
test('child execution and IPC',async()=>assert.equal(await executeIsolated("return (await mcp.call('x',{})).ok;",broker),true));
test('child timeout',async()=>assert.rejects(executeIsolated('while(true){}',broker,{timeoutMs:200})));
test('four concurrent children',async()=>assert.deepEqual(await Promise.all([1,2,3,4].map(i=>executeIsolated('return '+i,broker))),[1,2,3,4]));
