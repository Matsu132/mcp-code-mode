import {readFile} from 'node:fs/promises';
import {estimateTokens,syntheticBenchmark} from '../dist/benchmark.js';

const catalogPath=process.argv[2];
if (!catalogPath) {
  console.log(JSON.stringify(syntheticBenchmark(),null,2));
} else {
  const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
  if (!Array.isArray(catalog) || !catalog.length || catalog.some(tool =>
    !tool || typeof tool.name!=='string' || !tool.name || !tool.inputSchema ||
    typeof tool.inputSchema!=='object' || Array.isArray(tool.inputSchema)
  )) throw Error('Expected a nonempty JSON array of MCP tool definitions with names and input schemas');
  console.log(JSON.stringify(estimateTokens('supplied_catalog',catalog),null,2));
}
