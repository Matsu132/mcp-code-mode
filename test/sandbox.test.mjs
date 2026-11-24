import {test} from 'node:test';import assert from 'node:assert/strict';import {execute} from '../dist/sandbox.js';
const broker={call:async(id,args)=>JSON.stringify({id,args})};
test('combines calls',async()=>assert.deepEqual(await execute("const a=await mcp.call('demo.read',{x:1}); return a.args.x+1;",broker),2));
test('no host globals',async()=>assert.deepEqual(await execute("return [typeof process,typeof require,typeof fetch];",broker),['undefined','undefined','undefined']));
test('denied call',async()=>assert.rejects(execute("return await mcp.call('denied',{});",{call:async()=>{throw Error('denied')}})));

test('abandoned tool calls release QuickJS resources without waiting for the broker', {timeout:2000}, async () => {
  const late = Promise.withResolvers();
  let signal;
  const broker = {call: (_id, _args, callSignal) => {
    signal = callSignal;
    return late.promise;
  }};
  try {
    assert.equal(await execute("void mcp.call('demo.read', {}); return 1;", broker, {timeoutMs:500}), 1);
    assert.equal(signal?.aborted, true);
  } finally {
    late.resolve('{}');
  }
  assert.equal(await execute('return 2;', broker), 2);
});
