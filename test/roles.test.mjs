import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RolePolicy} from '../dist/roles.js';

test('roles separate management, execution and discovery', () => {
  const policy = new RolePolicy([], [
    {subject:'viewer-id',role:'viewer',disabled:false},
    {subject:'operator-id',role:'operator',disabled:false},
    {subject:'administrator-id',role:'admin',disabled:false},
  ]);
  assert.equal(policy.permits('viewer-id',false,'read','demo.read'),true);
  assert.equal(policy.permits('viewer-id',false,'execute','demo.read'),false);
  assert.equal(policy.permits('operator-id',false,'execute','demo.read'),true);
  assert.equal(policy.permits('operator-id',false,'manage'),false);
  assert.equal(policy.permits('administrator-id',false,'manage'),true);
  assert.equal(policy.permits('unknown-id',false,'manage'),false);
});

test('custom roles intersect server and tool scopes and reject invalid assignments', () => {
  const role = {id:'reporting',read:true,execute:true,manage:false,servers:['demo'],tools:['demo.read','other.read']};
  const policy = new RolePolicy([role],[
    {subject:'reporter',role:'reporting',disabled:false},
    {subject:'suspended',role:'reporting',disabled:true},
  ]);
  assert.equal(policy.permits('reporter',false,'execute','demo.read'),true);
  assert.equal(policy.permits('reporter',false,'execute','demo.write'),false);
  assert.equal(policy.permits('reporter',false,'execute','other.read'),false);
  assert.equal(policy.permits('suspended',false,'read','demo.read'),false);
  assert.equal(policy.disabled('suspended',false),true);
  assert.throws(()=>new RolePolicy([{...role,id:'admin'}],[]),/reserved role/);
  assert.throws(()=>new RolePolicy([],[{subject:'x',role:'missing',disabled:false}]),/Unknown role/);
});
