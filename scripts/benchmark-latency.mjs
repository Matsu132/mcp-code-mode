import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {executeIsolated} from '../dist/isolated.js';

const calls=4;
const rounds=5;
const mockCall=async()=>{await delay(20);return JSON.stringify({ok:true});};
const sample=async(task)=>{
  const values=[];
  for(let i=0;i<rounds;i++){
    const started=performance.now();
    await task();
    values.push(performance.now()-started);
  }
  values.sort((a,b)=>a-b);
  return {medianMs:values[Math.floor(values.length/2)],maxMs:values.at(-1)};
};
const broker={call:mockCall};
const directSequential=await sample(async()=>{for(let i=0;i<calls;i++)await mockCall();});
const directParallel=await sample(()=>Promise.all(Array.from({length:calls},mockCall)));
const sandboxSequential=await sample(()=>executeIsolated(`for(let i=0;i<${calls};i++)await mcp.call('fixture.read',{});return true;`,broker));
const sandboxParallel=await sample(()=>executeIsolated(`await Promise.all(Array.from({length:${calls}},()=>mcp.call('fixture.read',{})));return true;`,broker));
console.log(JSON.stringify({
  source:'local_mock',calls,rounds,syntheticUpstreamDelayMs:20,
  directSequential,directParallel,sandboxSequential,sandboxParallel,
  note:'Local broker and worker measurements. Excludes remote HTTP, model and client overhead.',
},null,2));
