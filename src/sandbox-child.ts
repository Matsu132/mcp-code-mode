import {z} from 'zod';
import {execute} from './sandbox.js';

const sequence = z.number().int().min(1).max(20);
const message = z.union([
  z.strictObject({type:z.literal('start'),code:z.string().max(32768),timeout:z.number().int().min(1).max(15000),language:z.enum(['javascript','typescript'])}),
  z.strictObject({type:z.literal('reply'),seq:sequence,result:z.string().max(262144)}),
  z.strictObject({type:z.literal('reply'),seq:sequence,error:z.literal(true)}),
]);

let seq = 0;
let started = false;
const pending = new Map<number,{resolve:(result:string)=>void;reject:(error:Error)=>void}>();
process.on('message', (raw:unknown) => {
  const parsed = message.safeParse(raw);
  if (!parsed.success) return process.exit(1);
  const item = parsed.data;
  if (item.type==='reply') {
    const call = pending.get(item.seq);
    if (!call) return process.exit(1);
    pending.delete(item.seq);
    if ('error' in item) call.reject(Error('Denied'));
    else call.resolve(item.result);
    return;
  }
  if (started) return process.exit(1);
  started = true;
  const code = item.language==='typescript'
    ? import('./types.js').then(({transpile})=>transpile(item.code))
    : Promise.resolve(item.code);
  void code.then(source=>execute(source,{
    call:(id,args) => new Promise<string>((resolve,reject) => {
      const n = ++seq;
      pending.set(n,{resolve,reject});
      process.send?.({type:'call',seq:n,id,args}, error => {
        if (error) {
          pending.delete(n);
          reject(Error('Sandbox IPC failed'));
        }
      });
    }),
  },{timeoutMs:item.timeout})).then(
    value => process.send?.({type:'result',value}),
    () => process.send?.({type:'error'}),
  );
});
