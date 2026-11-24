import AjvModule from 'ajv';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
const Ajv = AjvModule.default;
export type Entry = { id: string; name: string; description: string; inputSchema: object; client: Client };
export class Broker {
  private entries = new Map<string, Entry>();
  add(entry: Entry) { if (this.entries.has(entry.id)) throw new Error('Duplicate tool'); this.entries.set(entry.id, entry); }
  search(query: string) { const q = query.toLowerCase(); return [...this.entries.values()].filter(e => (e.id+' '+e.description).toLowerCase().includes(q)).slice(0, 30).map(({id,description})=>({id,description:description.slice(0,500)})); }
  describe(id: string) { const e = this.entries.get(id); if (!e) throw new Error('Unknown or denied tool'); return {id:e.id,inputSchema:e.inputSchema,description:e.description}; }
  async call(id: string, args: unknown, signal: AbortSignal) {
    const e = this.entries.get(id); if (!e) throw new Error('Unknown or denied tool');
    if (signal.aborted) throw new Error('Execution expired');
    const validate = new Ajv({strict:false,allErrors:false}).compile(e.inputSchema);
    if (!validate(args)) throw new Error('Invalid arguments');
    console.error(JSON.stringify({event:'tool_call',id}));
    const result = await e.client.callTool({name:e.name,arguments:args as Record<string,unknown>},undefined,{signal,timeout:10000});
    const json = JSON.stringify(result); if (Buffer.byteLength(json)>262144) throw new Error('Tool result too large'); return json;
  }
}
