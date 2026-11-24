import {test} from 'node:test';import assert from 'node:assert/strict';
import {transpile,schemaType} from '../dist/types.js';import {execute} from '../dist/sandbox.js';import {createAuth,permitted} from '../dist/auth.js';import {Broker} from '../dist/broker.js';
test('typescript executes',async()=>assert.equal(await execute(transpile('const n: number = 2; return n+1;'),{call:async()=>''}),3));
test('schema types',()=>assert.equal(schemaType({type:'object',properties:{x:{type:'string'}},required:['x']}),'{ "x": string }'));
test('auth and policy',async()=>{const token='a'.repeat(32);const a=createAuth({GATEWAY_TOKEN:token});assert.equal(await a.authenticate('Bearer wrong'),null);assert.equal((await a.authenticate('Bearer '+token)).id,'operator');assert.equal(permitted({id:'x',allow:['a.read']},'a.write'),false);});
test('search and replacement',()=>{const b=new Broker();b.add({id:'a.read',name:'read',description:'list items',inputSchema:{},client:{}});assert.equal(b.search('list').length,1);assert.equal(b.search('list',()=>false).length,0);b.replace([]);assert.equal(b.search('').length,0);});
test('broker rejects invalid schema args',async()=>{const b=new Broker();b.add({id:'a.read',name:'read',description:'',inputSchema:{type:'object',required:['x']},client:{}});await assert.rejects(b.call('a.read',{},new AbortController().signal));});
