import {readFile} from 'node:fs/promises';
import {getEncoding} from 'js-tiktoken';

const catalogPath = process.argv[2];
const catalog = catalogPath
  ? JSON.parse(await readFile(catalogPath,'utf8'))
  : Array.from({length:1000}, (_, i) => ({
      name: 'tool_' + i,
      description: 'Read item ' + i,
      inputSchema: {type:'object',properties:{id:{type:'string'}},required:['id']},
    }));

if (!Array.isArray(catalog) || !catalog.length || catalog.some(tool =>
  !tool || typeof tool.name !== 'string' || !tool.name || !tool.inputSchema ||
  typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)
)) throw Error('Expected a nonempty JSON array of MCP tool definitions with names and input schemas');

const schema = (name, description, properties, required) => ({
  name,description,inputSchema:{type:'object',properties,required},
});
const gateway = [
  schema('search','Search allowed upstream tools',{query:{type:'string',maxLength:200}},['query']),
  schema('describe','Get schema and TypeScript declaration',{id:{type:'string',maxLength:300}},['id']),
  schema('execute','Execute JavaScript or TypeScript async body. Use mcp.call(id,args); return required data.',{
    code:{type:'string',maxLength:32768},language:{type:'string',enum:['javascript','typescript']},
  },['code']),
];

const sizes = [...new Set([10,30,100,300,1000].filter(n => n < catalog.length).concat(catalog.length))];
const call = (name, args) => ({name,arguments:args});
const argumentsExample = catalogPath ? {} : {id:'example'};
const result = {
  source:catalogPath?'supplied_catalog':'synthetic',
  note:'Serialized JSON token estimate for one illustrative task. Omits results, generated TypeScript declarations, model prompts and protocol framing. Supplied catalogs use empty sample arguments.',
  comparisons:[],
};

for (const encoding of ['cl100k_base','o200k_base']) {
  const tokenizer = getEncoding(encoding);
  const count = value => tokenizer.encode(JSON.stringify(value),[],[]).length;
  const catalogTokens = count(gateway);
  for (const tools of sizes) {
    const subset = catalog.slice(0,tools);
    const [selected] = subset;
    const matches = subset.slice(0,3).map(({name,description}) => ({id:name,description:description??''}));
    const direct = count(subset) + count(call(selected.name,argumentsExample));
    const search = count(call('search',{query:selected.name})) + count(matches);
    const describe = count(call('describe',{id:selected.name})) + count(selected);
    const execute = count(call('execute',{
      language:'javascript',
      code:`return await mcp.call(${JSON.stringify(selected.name)}, ${JSON.stringify(argumentsExample)});`,
    }));
    const codeMode = catalogTokens + search + describe + execute;
    result.comparisons.push({
      encoding,tools,directTokens:direct,codeModeTokens:codeMode,gatewayDefinitionTokens:catalogTokens,
      searchTokens:search,describeTokens:describe,executeTokens:execute,reduction:1-codeMode/direct,
    });
  }
}
console.log(JSON.stringify(result,null,2));
