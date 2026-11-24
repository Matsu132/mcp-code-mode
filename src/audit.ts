import {openSync, closeSync, constants} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

export type AuditEvent = {
  requestId: string;
  subject: string;
  id: string;
  status: 'success' | 'failed' | 'denied' | 'timeout' | 'cancelled';
  durationMs: number;
  kind?: 'execution' | 'tool_call' | 'policy_update' | 'server_update' | 'settings_update' | 'oauth_connect' | 'oauth_disconnect';
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

  metrics(subject?:string) {
    const now=Date.now();
    this.prune(now);
    const row=this.database.prepare(`
      SELECT COUNT(*) AS runs,
             COUNT(CASE WHEN status='success' THEN 1 END) AS successes,
             AVG(duration_ms) AS averageMs
      FROM audit WHERE kind='execution' AND event_time>=? AND (? IS NULL OR subject=?)
    `).get(this.cutoff(now),subject??null,subject??null);
    return {
      runs:Number(row?.runs??0),
      successes:Number(row?.successes??0),
      averageMs:row?.averageMs===null?null:Number(row?.averageMs??0),
      retentionDays:this.retentionDays,
    };
  }

  page(query:string,limit:number,offset:number) {
    const now=Date.now();
    this.prune(now);
    const filter=`event_time>=? AND (
      ?='' OR instr(lower(request_id || ' ' || subject || ' ' || tool_id || ' ' || status || ' ' || kind),lower(?))>0
    )`;
    const values=[this.cutoff(now),query,query] as const;
    const count=this.database.prepare(`SELECT COUNT(*) AS total FROM audit WHERE ${filter}`).get(...values);
    const events=this.database.prepare(`
      SELECT sequence,event_time,request_id AS requestId,subject,tool_id AS id,status,duration_ms AS durationMs,kind
      FROM audit WHERE ${filter} ORDER BY sequence DESC LIMIT ? OFFSET ?
    `).all(...values,limit,offset).map(({event_time,...event})=>({
      ...event,
      serverId:event.kind==='tool_call'?String(event.id).split('.',1)[0]||null:
        (event.kind==='oauth_connect'||event.kind==='oauth_disconnect')?event.id:null,
      startedAt:new Date(Number(event_time)-Number(event.durationMs)).toISOString(),
      time:new Date(Number(event_time)).toISOString(),
    }));
    return {total:Number(count?.total??0),events,limit,offset};
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
