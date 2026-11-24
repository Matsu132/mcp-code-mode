import {readFile,rename,rm,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AuditLog,type AuditEvent} from './audit.js';
import {executionSettings} from './execution-settings.js';
import {RolePolicy,customRole,roleAssignment} from './roles.js';

const rule = z.object({subject:z.string().min(1).max(300),allow:z.array(z.string().max(300)).max(1000)}).strict();
const policy = z.object({
  rules:z.array(rule).max(1000),
  roles:z.array(customRole).max(100),
  assignments:z.array(roleAssignment).max(1000),
  execution:executionSettings.optional(),
}).strict();
const savedPolicy = policy.extend({roles:policy.shape.roles.default([]),assignments:policy.shape.assignments.default([])});
const updatePolicy = policy.partial().refine(value => Object.values(value).some(v => v !== undefined));
type Policy = z.infer<typeof policy>;

export class PolicyConflict extends Error {}

export class Management {
  private state:Policy;
  private writing = false;
  private revision = randomUUID();
  private rolePolicy:RolePolicy;

  get roles() { return this.rolePolicy; }

  private constructor(private path:string,private audit:AuditLog,state:Policy) {
    this.state = state;
    this.rolePolicy = new RolePolicy(state.roles,state.assignments);
  }

  static async open(path:string) {
    let state:Policy = {rules:[],roles:[],assignments:[]};
    try {
      state = savedPolicy.parse(JSON.parse(await readFile(path,'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const retention = z.coerce.number().int().min(1).max(3650).parse(process.env.AUDIT_RETENTION_DAYS??30);
    const audit = new AuditLog(process.env.AUDIT_PATH??path+'.audit.sqlite',retention);
    return new Management(path,audit,state);
  }

  allowed(subject:string,id:string) {
    const rule = this.state.rules.find(r => r.subject === subject);
    return !rule || rule.allow.includes('*') || rule.allow.includes(id);
  }

  view() {
    return {...this.state,revision:this.revision,audit:this.audit.recent()};
  }

  get execution() { return this.state.execution; }

  metrics(subject?:string) { return this.audit.metrics(subject); }

  events(query:string,limit:number,offset:number) { return this.audit.page(query,limit,offset); }

  async update(raw:unknown,revision?:string) {
    if (revision!==undefined&&(this.writing||revision!==this.revision)) throw new PolicyConflict();
    if (this.writing) throw Error('Concurrent update');
    const patch = updatePolicy.parse(raw);
    const next = policy.parse({...this.state,...patch});
    if (new Set(next.rules.map(r => r.subject)).size !== next.rules.length) throw Error('Duplicate subject');
    const roles = new RolePolicy(next.roles,next.assignments);
    this.writing = true;
    const tmp = this.path+'.'+randomUUID();
    let created = false;
    try {
      await writeFile(tmp,JSON.stringify(next),{mode:0o600,flag:'wx'});
      created = true;
      await rename(tmp,this.path);
      this.state = next;
      this.rolePolicy = roles;
      if(revision!==undefined)this.revision=randomUUID();
    } finally {
      this.writing = false;
      if (created) await rm(tmp,{force:true});
    }
  }

  record(event:AuditEvent) {
    try {
      this.audit.record(event);
    } catch {
      console.error(JSON.stringify({event:'audit_write_failed',requestId:event.requestId}));
    }
    console.error(JSON.stringify({event:event.kind??'tool_call',...event,time:new Date().toISOString()}));
  }
}
