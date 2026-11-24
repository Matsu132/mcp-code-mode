import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import type {Broker} from './broker.js';

const message = z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('call'),seq:z.number().int().min(1).max(20),id:z.string().max(300),args:z.unknown()}),
  z.strictObject({type:z.literal('result'),value:z.unknown()}),
  z.strictObject({type:z.literal('error')}),
]);

export async function executeIsolated(
  code:string,
  broker:Pick<Broker,'call'>,
  limits:{timeoutMs?:number;signal?:AbortSignal} = {},
):Promise<unknown> {
  if (Buffer.byteLength(code)>32768) throw Error('Code too large');
  const {signal} = limits;
  signal?.throwIfAborted();
  const timeout = Math.min(15000,Math.max(1,limits.timeoutMs??15000));
  return new Promise((resolve,reject) => {
    const child = fork(fileURLToPath(new URL('./sandbox-child.js',import.meta.url)),[],{
      env:{},
      execArgv:['--max-old-space-size=64','--permission','--allow-fs-read='+fileURLToPath(new URL('../',import.meta.url))],
      stdio:['ignore','ignore','ignore','ipc'],
    });
    const controller = new AbortController();
    const seen = new Set<number>();
    let outcome:{error:Error|null;value?:unknown}|undefined;
    const finish = (error:Error|null,value?:unknown) => {
      if (outcome) return;
      outcome = {error,value};
      clearTimeout(timer);
      signal?.removeEventListener('abort',cancel);
      controller.abort();
      child.kill('SIGKILL');
    };
    const cancel = () => finish(Error('Sandbox execution cancelled'));
    const timer = setTimeout(() => finish(Error('Sandbox deadline exceeded')),timeout);
    signal?.addEventListener('abort',cancel,{once:true});
    child.on('error',() => finish(Error('Sandbox process failed')));
    child.once('close',() => {
      finish(Error('Sandbox exited'));
      if (outcome?.error) reject(outcome.error);
      else resolve(outcome?.value);
    });
    child.on('message', raw => {
      if (outcome) return;
      const parsed = message.safeParse(raw);
      if (!parsed.success) return finish(Error('Invalid sandbox message'));
      const item = parsed.data;
      if (item.type==='error') return finish(Error('Sandbox execution failed'));
      if (item.type==='result') {
        if (Buffer.byteLength(JSON.stringify(item.value??null))>65536) return finish(Error('Output too large'));
        return finish(null,item.value??null);
      }
      if (seen.has(item.seq) || seen.size>=20 || Buffer.byteLength(JSON.stringify(item.args??null))>65536) {
        return finish(Error('Call budget exceeded'));
      }
      seen.add(item.seq);
      const reply = (result:{result:string}|{error:true}) => {
        if (outcome || !child.connected) return;
        child.send({type:'reply',seq:item.seq,...result}, error => {
          if (error) finish(Error('Sandbox IPC failed'));
        });
      };
      void broker.call(item.id,item.args,controller.signal).then(result => reply({result}),() => reply({error:true}));
    });
    child.send({type:'start',code,timeout}, error => {
      if (error) finish(Error('Sandbox IPC failed'));
    });
  });
}
