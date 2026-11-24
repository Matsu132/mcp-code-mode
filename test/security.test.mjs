import {test} from 'node:test';import assert from 'node:assert/strict';import {execute} from '../dist/sandbox.js';
const broker={call:async()=>JSON.stringify({ok:true})};
test('interrupt infinite loop',async()=>assert.rejects(execute('while(true){}',broker,{timeoutMs:100})));
test('reject oversized code',async()=>assert.rejects(execute(' '.repeat(32769),broker)));
test('parallel isolated executions',async()=>{const results=await Promise.all(Array.from({length:8},(_,i)=>execute('globalThis.secret='+i+'; return secret;',broker)));assert.deepEqual(results,[0,1,2,3,4,5,6,7]);});
test('reject oversized tool arguments',async()=>assert.rejects(execute("return await mcp.call('x',{s:'a'.repeat(70000)});",broker)));
