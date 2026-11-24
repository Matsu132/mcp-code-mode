import {getEncoding} from 'js-tiktoken';

export type BenchmarkTool = {name:string;description?:string;inputSchema:object};

const schema = (name:string,description:string,properties:object,required:string[]) => ({
  name,description,inputSchema:{type:'object',properties,required},
});
const gateway = [
  schema('search','Search allowed upstream tools',{query:{type:'string',maxLength:200}},['query']),
  schema('describe','Get schema and TypeScript declaration',{id:{type:'string',maxLength:300}},['id']),
  schema('execute','Execute JavaScript or TypeScript async body. Use mcp.call(id,args); return required data.',{
    code:{type:'string',maxLength:32768},language:{type:'string',enum:['javascript','typescript']},
  },['code']),
];
const synthetic = Array.from({length:1000},(_,i)=>({
  name:'tool_'+i,description:'Read item '+i,
  inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']},
}));
const encodings = ['cl100k_base','o200k_base'] as const;
const cachedEncodings = new Map<(typeof encodings)[number],ReturnType<typeof getEncoding>>();
const call = (name:string,args:object) => ({name,arguments:args});

export function estimateTokens(
  source:'synthetic'|'catalog'|'supplied_catalog',
  catalog:BenchmarkTool[]=synthetic,
) {
  if(!catalog.length)throw Error('Nonempty catalog required');
  const sizes = [...new Set([10,30,100,300,1000].filter(n=>n<catalog.length).concat(catalog.length))];
  const argumentsExample = source==='synthetic'?{id:'example'}:{};
  const comparisons = encodings.flatMap(encoding=>{
    let tokenizer = cachedEncodings.get(encoding);
    if (!tokenizer) {
      tokenizer = getEncoding(encoding);
      cachedEncodings.set(encoding,tokenizer);
    }
    const enc = tokenizer;
    const count = (value:unknown) => enc.encode(JSON.stringify(value),[],[]).length;
    const catalogTokens = count(gateway);
    return sizes.map(tools=>{
      const subset = catalog.slice(0,tools);
      const selected = subset[0];
      const matches = subset.slice(0,3).map(({name,description})=>({id:name,description:description??''}));
      const direct = count(subset)+count(call(selected.name,argumentsExample));
      const search = count(call('search',{query:selected.name}))+count(matches);
      const describe = count(call('describe',{id:selected.name}))+count(selected);
      const execute = count(call('execute',{
        language:'javascript',
        code:`return await mcp.call(${JSON.stringify(selected.name)}, ${JSON.stringify(argumentsExample)});`,
      }));
      const codeMode = catalogTokens+search+describe+execute;
      return {
        encoding,tools,directTokens:direct,codeModeTokens:codeMode,gatewayDefinitionTokens:catalogTokens,
        searchTokens:search,describeTokens:describe,executeTokens:execute,reduction:1-codeMode/direct,
      };
    });
  });
  return {
    source,
    note:'Serialized JSON estimate for one illustrative task. Omits results, generated TypeScript declarations, model prompts and protocol framing.',
    comparisons,
  };
}

let baseline:ReturnType<typeof estimateTokens>|undefined;
export function syntheticBenchmark() { return baseline??=estimateTokens('synthetic'); }

export function catalogBenchmark(entries:BenchmarkTool[]) {
  let bytes=0;
  const sample:BenchmarkTool[]=[];
  for (const tool of entries.slice(0,1000)) {
    bytes+=Buffer.byteLength(JSON.stringify(tool));
    if(bytes>256*1024)break;
    sample.push(tool);
  }
  return sample.length ? {totalTools:entries.length,sampledTools:sample.length,...estimateTokens('catalog',sample)} : null;
}
