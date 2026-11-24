import AjvModule from 'ajv';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {declaration} from './types.js';
const Ajv = AjvModule.default;
export type Entry = { id: string; name: string; description: string; inputSchema: object; client: Client };
export class Broker {
  private entries = new Map<string, Entry>();
  add(entry: Entry) { if(this.entries.has(entry.id))throw Error('Duplicate tool');this.entries.set(entry.id,entry); }
  replace(entries:Entry[]){const next=new Map<string,Entry>();for(const e of entries){if(next.has(e.id))throw Error('Duplicate tool');next.set(e.id,e);}this.entries=next;}
  search(query:string,allowed:(id:string)=>boolean=()=>true){
    const words=query.toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.entries.values()].filter(e=>allowed(e.id)).map(e=>({e,score:words.reduce((n,w)=>n+(e.id.toLowerCase().includes(w)?3:0)+(e.description.toLowerCase().includes(w)?1:0),0)})).filter(x=>!words.length||x.score>0).sort((a,b)=>b.score-a.score||a.e.id.localeCompare(b.e.id)).slice(0,30).map(({e:{id,description}})=>({id,description:description.slice(0,500)}));
  }
  describe(id:string){const e=this.entries.get(id);if(!e)throw Error('Unknown or denied tool');return {id,inputSchema:e.inputSchema,description:e.description,typescript:declaration(id,e.inputSchema)};}
  async call(id:string,args:unknown,signal:AbortSignal){
    const e=this.entries.get(id);if(!e)throw Error('Unknown or denied tool');
    if(signal.aborted)throw Error('Execution expired');
    if(!args||typeof args!=='object'||Array.isArray(args)||Buffer.byteLength(JSON.stringify(args))>65536)throw Error('Invalid arguments');
    const validate=new Ajv({strict:false,allErrors:false}).compile(e.inputSchema);
    if(!validate(args))throw Error('Invalid arguments');
    const result=await e.client.callTool({name:e.name,arguments:args as Record<string,unknown>},undefined,{signal,timeout:10000});
    const json=JSON.stringify(result);if(Buffer.byteLength(json)>262144)throw Error('Tool result too large');return json;
  }
}
