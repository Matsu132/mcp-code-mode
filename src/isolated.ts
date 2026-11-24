import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import type {Broker} from './broker.js';
const message=z.discriminatedUnion('type',[z.object({type:z.literal('call'),seq:z.number().int().min(1).max(20),id:z.string().max(300),args:z.unknown()}),z.object({type:z.literal('result'),value:z.unknown()}),z.object({type:z.literal('error')})]);
export async function executeIsolated(code:string,broker:Pick<Broker,'call'>,limits:{timeoutMs?:number}={}):Promise<unknown>{
  if(Buffer.byteLength(code)>32768)throw Error('Code too large');
  const timeout=Math.min(15000,Math.max(1,limits.timeoutMs??15000));
  return new Promise((resolve,reject)=>{
    const child=fork(fileURLToPath(new URL('./sandbox-child.js',import.meta.url)),[],{env:{},execArgv:['--max-old-space-size=64','--permission','--allow-fs-read='+fileURLToPath(new URL('../',import.meta.url))],stdio:['ignore','ignore','ignore','ipc']});
    const controller=new AbortController();let done=false;const seen=new Set<number>();
    const finish=(error:Error|null,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);controller.abort();child.kill('SIGKILL');if(error)reject(error);else resolve(value);};
    const timer=setTimeout(()=>finish(Error('Sandbox deadline exceeded')),timeout);
    child.on('error',()=>finish(Error('Sandbox process failed')));
    child.on('exit',()=>finish(Error('Sandbox exited')));
    child.on('message',raw=>{if(done)return;const m=message.safeParse(raw);if(!m.success){finish(Error('Invalid sandbox message'));return;}const v=m.data;
      if(v.type==='error'){finish(Error('Sandbox execution failed'));return;}
      if(v.type==='result'){if(Buffer.byteLength(JSON.stringify(v.value??null))>65536)finish(Error('Output too large'));else finish(null,v.value??null);return;}
      if(seen.has(v.seq)||seen.size>=20||Buffer.byteLength(JSON.stringify(v.args??null))>65536){finish(Error('Call budget exceeded'));return;}seen.add(v.seq);
      void broker.call(v.id,v.args,controller.signal).then(result=>{if(!done&&child.connected)child.send({type:'reply',seq:v.seq,result},()=>{});},()=>{if(!done&&child.connected)child.send({type:'reply',seq:v.seq,error:true},()=>{});});
    });
    child.send({type:'start',code,timeout},()=>{});
  });
}
