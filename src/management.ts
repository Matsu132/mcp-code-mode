import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AuditLog,type AuditEvent} from './audit.js';
const policy=z.object({rules:z.array(z.object({subject:z.string().min(1).max(300),allow:z.array(z.string().max(300)).max(1000)})).max(1000)}).strict();
type Policy=z.infer<typeof policy>;
export class Management{
 private state:Policy={rules:[]};private writing=false;
 private constructor(private path:string,private audit:AuditLog){}
 static async open(path:string){let state:Policy={rules:[]};try{state=policy.parse(JSON.parse(await readFile(path,'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}const retention=z.coerce.number().int().min(1).max(3650).parse(process.env.AUDIT_RETENTION_DAYS??30);const m=new Management(path,new AuditLog(process.env.AUDIT_PATH??path+'.audit.sqlite',retention));m.state=state;return m;}
 allowed(subject:string,id:string){const rule=this.state.rules.find(r=>r.subject===subject);return !rule||rule.allow.includes('*')||rule.allow.includes(id);}
 view(){return {rules:this.state.rules,audit:this.audit.recent()};}
 async update(raw:unknown){const next=policy.parse(raw);if(new Set(next.rules.map(r=>r.subject)).size!==next.rules.length)throw Error('Duplicate subject');if(this.writing)throw Error('Concurrent update');this.writing=true;try{const tmp=this.path+'.'+randomUUID();await writeFile(tmp,JSON.stringify(next),{mode:0o600,flag:'wx'});await rename(tmp,this.path);this.state=next;}finally{this.writing=false;}}
 record(event:AuditEvent){
   try{this.audit.record(event);}catch{console.error(JSON.stringify({event:'audit_write_failed',requestId:event.requestId}));}
   console.error(JSON.stringify({event:event.kind??'tool_call',...event,time:new Date().toISOString()}));
 }
}
