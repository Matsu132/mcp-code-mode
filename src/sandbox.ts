import { getQuickJS } from 'quickjs-emscripten';
import type { Broker } from './broker.js';
export async function execute(code: string, broker: Pick<Broker,'call'>, limits: {timeoutMs?:number} = {}): Promise<unknown> {
  if (Buffer.byteLength(code)>32768) throw new Error('Code too large');
  const q = await getQuickJS(); const runtime = q.newRuntime();
  runtime.setMemoryLimit(32*1024*1024); runtime.setMaxStackSize(512*1024);
  const timeoutMs=Math.min(15000,Math.max(1,limits.timeoutMs??15000));
  const deadline = Date.now()+timeoutMs;
  runtime.setInterruptHandler(()=>Date.now()>deadline);
  const vm = runtime.newContext(); const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeoutMs);
  const pending = new Set<Promise<void>>(); let calls=0;
  try {
    const call = vm.newFunction('call', (id,args)=>{
      const deferred = vm.newPromise();
      const task = (async()=>{
        try {
          if (++calls>20 || controller.signal.aborted) throw new Error('Call budget exceeded');
          const toolId=vm.getString(id), raw=vm.getString(args);
          if(Buffer.byteLength(toolId)>300||Buffer.byteLength(raw)>65536)throw Error('Input budget exceeded');
          const result = await broker.call(toolId,JSON.parse(raw),controller.signal);
          if (!controller.signal.aborted) { const h=vm.newString(result); deferred.resolve(h); h.dispose(); }
        } catch { if (!controller.signal.aborted) { const h=vm.newString('Tool call failed or denied'); deferred.reject(h); h.dispose(); } }
      })();
      pending.add(task); void task.finally(()=>pending.delete(task));
      return deferred.handle;
    });
    vm.setProp(vm.global,'__call',call); call.dispose();
    const result = vm.evalCode('globalThis.mcp = Object.freeze({call: async (id,args) => JSON.parse(await __call(id,JSON.stringify(args)))}); (async()=>{'+code+'\n})()');
    const promise = vm.unwrapResult(result);
    try {
      const resolved = vm.resolvePromise(promise);
      let done=false; void resolved.then(()=>{done=true;});
      while (!done && !controller.signal.aborted && Date.now()<deadline) {
        const jobs=runtime.executePendingJobs(); if (jobs.error) { jobs.error.dispose(); throw new Error('Sandbox job failed'); }
        await new Promise(r=>setTimeout(r,5));
      }
      if (!done) throw new Error('Execution timed out');
      const value=vm.unwrapResult(await resolved);
      try { const output=vm.dump(value); const json=JSON.stringify(output); if (json && Buffer.byteLength(json)>65536) throw new Error('Output too large'); return output ?? null; } finally {value.dispose();}
    } finally {promise.dispose();}
  } finally {
    controller.abort(); clearTimeout(timer);
    // Pending broker calls cannot access the VM after abort.
    await Promise.allSettled([...pending]);
    vm.dispose(); runtime.dispose();
  }
}
