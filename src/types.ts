import ts from 'typescript';
export function transpile(code:string):string {
  if(Buffer.byteLength(code)>32768) throw Error('Code too large');
  const result=ts.transpileModule('async function __entry(){\n'+code+'\n}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true});
  if(result.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error)) throw Error('Invalid TypeScript syntax');
  return result.outputText+'\nreturn await __entry();';
}
export function schemaType(value:unknown,depth=0):string {
  if(depth>8||!value||typeof value!=='object')return 'unknown';
  const s=value as Record<string,unknown>;
  if(s.$ref||s.oneOf||s.anyOf||s.allOf)return 'unknown';
  if(s.type==='string'||s.type==='boolean')return s.type;
  if(s.type==='number'||s.type==='integer')return 'number';
  if(s.type==='null')return 'null';
  if(s.type==='array')return 'Array<'+schemaType(s.items,depth+1)+'>';
  if(s.type==='object'&&s.properties&&typeof s.properties==='object'){
    const required=Array.isArray(s.required)?s.required:[];
    return '{ '+Object.entries(s.properties).slice(0,100).map(([k,v])=>JSON.stringify(k)+(required.includes(k)?'':'?')+': '+schemaType(v,depth+1)).join('; ')+' }';
  }return 'unknown';
}
export function declaration(id:string,schema:unknown){return 'declare const mcp: { call(id: '+JSON.stringify(id)+', args: '+schemaType(schema)+'): Promise<unknown> };';}
