import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuditLog} from '../dist/audit.js';

test('audit metadata survives close and reopen with private file permissions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-audit-'));
  const path = join(dir, 'audit.sqlite');
  try {
    const audit = new AuditLog(path, 30);
    const event = {requestId:'req-1',subject:'alice',id:'inventory.list',status:'denied',durationMs:0};
    audit.record({...event, args:{secret:'example'}});
    audit.close();
    const reopened = new AuditLog(path, 30);
    try {
      const [{time, ...row}] = reopened.recent();
      assert.deepEqual(row, {...event,kind:'tool_call'});
      assert.ok(Number.isFinite(Date.parse(time)));
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    } finally {
      reopened.close();
    }
  } finally {
    await rm(dir, {recursive:true,force:true});
  }
});
