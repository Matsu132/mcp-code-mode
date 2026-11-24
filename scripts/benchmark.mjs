import {readFile} from 'node:fs/promises';
import {getEncoding} from 'js-tiktoken';
const catalog=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):Array.from({length:100},(_,i)=>({name:'tool_'+i,description:'Read item '+i,inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}}));
if(!Array.isArray(catalog)||!catalog.length)throw Error('Nonempty catalog required');
const schema=(name,description,properties)=>({name,description,inputSchema:{type:'object',properties}});
const gateway=[schema('search','Search allowed upstream tools',{query:{type:'string'}}),schema('describe','Get schema and TypeScript declaration',{id:{type:'string'}}),schema('execute','Execute JavaScript or TypeScript',{code:{type:'string'},language:{enum:['javascript','typescript']}})];
for(const encoding of ['cl100k_base','o200k_base']){
const enc=getEncoding(encoding);const count=x=>enc.encode(JSON.stringify(x)).length;
const full=count(catalog),progressive=count(gateway)+count(catalog.slice(0,3));
console.log(JSON.stringify({encoding,tools:catalog.length,fullCatalogTokens:full,progressiveExampleTokens:progressive,reduction:1-progressive/full,note:'Serialized JSON token counts; synthetic example, excludes protocol framing, prompts and execution results.'},null,2));}
