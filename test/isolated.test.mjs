import {test} from 'node:test';import assert from 'node:assert/strict';import {executeIsolated} from '../dist/isolated.js';
const broker={call:async()=>JSON.stringify({ok:true})};
test('child execution and IPC',async()=>assert.equal(await executeIsolated("return (await mcp.call('x',{})).ok;",broker),true));
test('child timeout',async()=>assert.rejects(executeIsolated('while(true){}',broker,{timeoutMs:200})));
test('four concurrent children',async()=>assert.deepEqual(await Promise.all([1,2,3,4].map(i=>executeIsolated('return '+i,broker))),[1,2,3,4]));
test('isolated worker transpiles TypeScript',async()=>assert.equal(await executeIsolated('const n: number = 3; return n;',broker,{language:'typescript'}),3));
test('worker rejects a heap allocation above the QuickJS limit',async()=>assert.rejects(executeIsolated('return new ArrayBuffer(64*1024*1024).byteLength;',broker),/failed/));
test('worker has no host filesystem or network APIs',async()=>assert.deepEqual(await executeIsolated("return [typeof process, typeof require, typeof fetch];",broker),['undefined','undefined','undefined']));
