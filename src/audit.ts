import {openSync, closeSync, constants} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

export type AuditEvent = {
  requestId: string;
  subject: string;
  id: string;
  status: 'success' | 'failed' | 'denied' | 'timeout';
  durationMs: number;
  kind?: 'tool_call' | 'policy_update';
};

export class AuditLog {
  private readonly database: DatabaseSync;
  private nextPrune = 0;

  constructor(path: string, private readonly retentionDays: number) {
    closeSync(openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600));
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_time INTEGER NOT NULL,
        request_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        kind TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS audit_event_time ON audit(event_time);
    `);
    this.prune(Date.now());
  }

  private cutoff(now: number) {
    return now - this.retentionDays * 86_400_000;
  }

  private prune(now: number) {
    if (now < this.nextPrune) return;
    this.database.prepare('DELETE FROM audit WHERE event_time < ?').run(this.cutoff(now));
    this.nextPrune = now + 3_600_000;
  }

  record(event: AuditEvent) {
    const now = Date.now();
    this.database.prepare(`
      INSERT INTO audit(event_time, request_id, subject, tool_id, status, duration_ms, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(now, event.requestId, event.subject, event.id, event.status, event.durationMs, event.kind ?? 'tool_call');
    this.prune(now);
  }

  recent() {
    const now = Date.now();
    this.prune(now);
    return this.database.prepare(`
      SELECT event_time, request_id AS requestId, subject, tool_id AS id,
             status, duration_ms AS durationMs, kind
      FROM audit WHERE event_time >= ? ORDER BY sequence DESC LIMIT 1000
    `).all(this.cutoff(now)).map(({event_time, ...event}) => ({
      ...event,
      time: new Date(Number(event_time)).toISOString(),
    }));
  }

  close() {
    this.database.close();
  }
}
