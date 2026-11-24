import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionQueue} from '../dist/execution-queue.js';
import {executeIsolated} from '../dist/isolated.js';

test('execution queue bounds work, rejects excess, and wakes in arrival order', async () => {
  const queue = new ExecutionQueue(1,2,1000);
  const signal = new AbortController().signal;
  const running = Promise.withResolvers();
  const order = [];
  const first = queue.run(signal,() => running.promise);
  const second = queue.run(signal,async () => order.push(2));
  const third = queue.run(signal,async () => order.push(3));
  await assert.rejects(queue.run(signal,async () => order.push(4)),/queue is full/);
  assert.deepEqual(order,[]);
  running.resolve();
  await Promise.all([first,second,third]);
  assert.deepEqual(order,[2,3]);
});

test('cancelled queued work frees its position before starting', async () => {
  const queue = new ExecutionQueue(1,1,1000);
  const owner = new AbortController();
  const cancelled = new AbortController();
  const running = Promise.withResolvers();
  const first = queue.run(owner.signal,() => running.promise);
  const blocked = queue.run(cancelled.signal,async () => assert.fail('cancelled task started'));
  cancelled.abort();
  await assert.rejects(blocked,/cancelled/);
  const replacement = queue.run(owner.signal,async () => 2);
  running.resolve();
  await first;
  assert.equal(await replacement,2);
});

test('cancelling an execution aborts its pending upstream call and reaps the worker', async () => {
  const controller = new AbortController();
  const invoked = Promise.withResolvers();
  const stopped = Promise.withResolvers();
  const execution = executeIsolated("return await mcp.call('demo.read',{});",{
    call:(_id,_args,signal) => {
      invoked.resolve();
      return new Promise((_,reject) => signal.addEventListener('abort',()=>{
        stopped.resolve();
        reject(Error('Upstream cancelled'));
      },{once:true}));
    },
  },{signal:controller.signal,timeoutMs:3000});
  const rejected = assert.rejects(execution,/cancelled/);
  await invoked.promise;
  controller.abort();
  await stopped.promise;
  await rejected;
});

test('execution burst remains within configured concurrency while limits change',async()=>{
  const queue = new ExecutionQueue(2,48,2000);
  const signal = new AbortController().signal;
  let current=0;
  let peak=0;
  const jobs=Array.from({length:48},(_,i)=>queue.run(signal,async()=>{
    peak=Math.max(peak,++current);
    try{await delay(2);return i;}finally{current--;}
  }));
  queue.configure(4,32,2000);
  assert.deepEqual(await Promise.all(jobs),Array.from({length:48},(_,i)=>i));
  assert.equal(peak,4);
});
