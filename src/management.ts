import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
const policy=z.object({rules:z.array(z.object({subject:z.string().min(1).max(300),allow:z.array(z.string().max(300)).max(1000)})).max(1000)}).strict();
type Policy=z.infer<typeof policy>;
type Audit={requestId:string;subject:string;id:string;status:string;durationMs:number};
export class Management{
 private state:Policy={rules:[]};private audit:(Audit&{time:string})[]=[];private writing=false;
 private constructor(private path:string){}
 static async open(path:string){const m=new Management(path);try{m.state=policy.parse(JSON.parse(await readFile(path,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}return m;}
 allowed(subject:string,id:string){const rule=this.state.rules.find(r=>r.subject===subject);return !rule||rule.allow.includes('*')||rule.allow.includes(id);}
 view(){return {rules:this.state.rules,audit:[...this.audit].reverse()};}
 async update(raw:unknown){const next=policy.parse(raw);if(new Set(next.rules.map(r=>r.subject)).size!==next.rules.length)throw Error('Duplicate subject');if(this.writing)throw Error('Concurrent update');this.writing=true;try{const tmp=this.path+'.'+randomUUID();await writeFile(tmp,JSON.stringify(next),{mode:0o600,flag:'wx'});await rename(tmp,this.path);this.state=next;}finally{this.writing=false;}}
 record(event:Audit){const row={...event,time:new Date().toISOString()};this.audit.push(row);if(this.audit.length>1000)this.audit.shift();console.error(JSON.stringify({event:'tool_call',...row}));}
}
