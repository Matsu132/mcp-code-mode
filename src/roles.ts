import {z} from 'zod';

const roleId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const toolId = z.string().min(1).max(300);

export const customRole = z.object({
  id:roleId,
  read:z.boolean(),
  execute:z.boolean(),
  manage:z.boolean(),
  servers:z.array(toolId).max(1000),
  tools:z.array(toolId).max(1000),
}).strict();

export const roleAssignment = z.object({
  subject:z.string().min(1).max(300),
  role:roleId,
  disabled:z.boolean(),
  enrollmentAllow:z.array(toolId).max(1000).optional(),
}).strict();

type Role = z.infer<typeof customRole>;
type Assignment = z.infer<typeof roleAssignment>;
type Operation = 'read' | 'execute' | 'manage';

const builtins = [
  {id:'admin',read:true,execute:true,manage:true,servers:['*'],tools:['*']},
  {id:'operator',read:true,execute:true,manage:false,servers:['*'],tools:['*']},
  {id:'viewer',read:true,execute:false,manage:false,servers:['*'],tools:['*']},
] satisfies Role[];

export class RolePolicy {
  private readonly roles:Map<string,Role>;
  private readonly assignments:Map<string,Assignment>;

  constructor(roles:Role[], assignments:Assignment[]) {
    this.roles = new Map(builtins.map(role => [role.id,role]));
    this.assignments = new Map();
    for (const role of roles) {
      if (this.roles.has(role.id)) throw Error('Duplicate or reserved role ID');
      this.roles.set(role.id,role);
    }
    for (const assignment of assignments) {
      if (this.assignments.has(assignment.subject)) throw Error('Duplicate role assignment');
      if (!this.roles.has(assignment.role)) throw Error('Unknown role');
      this.assignments.set(assignment.subject,assignment);
    }
  }

  permits(subject:string, bootstrapAdmin:boolean, operation:Operation, tool?:string):boolean {
    if (bootstrapAdmin) return true;
    const assignment = this.assignments.get(subject);
    if (!assignment) return operation !== 'manage';
    if (assignment.disabled) return false;
    const role = this.roles.get(assignment.role);
    if (!role?.[operation]) return false;
    if (tool === undefined) return true;
    const server = tool.split('.',1)[0];
    return (role.servers.includes('*') || role.servers.includes(server))
      && (role.tools.includes('*') || role.tools.includes(tool));
  }

  enrollment(subject:string) {
    return this.assignments.get(subject)?.enrollmentAllow;
  }

  disabled(subject:string, bootstrapAdmin:boolean) {
    return !bootstrapAdmin && this.assignments.get(subject)?.disabled === true;
  }
}
