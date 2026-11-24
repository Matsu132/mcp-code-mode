import {readFile} from 'node:fs/promises';
const catalog=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):Array.from({length:100},(_,i)=>({name:'tool_'+i,description:'Read item '+i,inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}}));
const gateway=[{name:'search',description:'Search tools'},{name:'describe',description:'Get schema'},{name:'execute',description:'Execute code'}];
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
const full=bytes(catalog), progressive=bytes(gateway)+bytes(catalog.slice(0,3));
console.log(JSON.stringify({tools:catalog.length,fullCatalogBytes:full,progressiveExampleBytes:progressive,byteReduction:1-progressive/full,note:'Serialized bytes, NOT token counts; excludes messages and results.'},null,2));
