import {execute} from './sandbox.js';
let seq=0;let started=false;
const pending=new Map<number,{resolve:(s:string)=>void;reject:(e:Error)=>void}>();
process.on('message',(raw:unknown)=>{
 const m=raw as {type:string;code?:string;timeout?:number;seq?:number;result?:string;error?:boolean};
 if(m.type==='reply'&&typeof m.seq==='number'){const p=pending.get(m.seq);pending.delete(m.seq);if(p){if(m.error)p.reject(Error('Denied'));else p.resolve(m.result??'null');}return;}
 if(m.type!=='start'||started||typeof m.code!=='string')return;started=true;
 void execute(m.code,{call:(id,args)=>new Promise<string>((resolve,reject)=>{const n=++seq;pending.set(n,{resolve,reject});process.send?.({type:'call',seq:n,id,args});})},{timeoutMs:m.timeout}).then(value=>process.send?.({type:'result',value}),()=>process.send?.({type:'error'}));
});
