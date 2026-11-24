import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {closeSync,constants,openSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

export class OAuthVault {
  private readonly database:DatabaseSync;

  constructor(path:string,private readonly key:Buffer) {
    if (key.length!==32) throw Error('UPSTREAM_OAUTH_KEY must decode to 32 bytes');
    closeSync(openSync(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600));
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS delegated_oauth (
        subject TEXT NOT NULL, server TEXT NOT NULL, payload BLOB NOT NULL,
        PRIMARY KEY (subject,server)
      ) STRICT;
    `);
  }

  read(subject:string,server:string,binding:string):unknown {
    const data = this.database.prepare('SELECT payload FROM delegated_oauth WHERE subject=? AND server=?').get(subject,server);
    if (!data) return undefined;
    const payload = Buffer.from(data.payload as Uint8Array);
    const decipher = createDecipheriv('aes-256-gcm',this.key,payload.subarray(0,12));
    decipher.setAAD(Buffer.from(JSON.stringify([subject,server,binding])));
    decipher.setAuthTag(payload.subarray(12,28));
    try {
      const plain = Buffer.concat([decipher.update(payload.subarray(28)),decipher.final()]);
      return JSON.parse(plain.toString());
    } catch {
      throw Error('OAuth credentials cannot be decrypted');
    }
  }

  write(subject:string,server:string,binding:string,value:unknown) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm',this.key,nonce);
    cipher.setAAD(Buffer.from(JSON.stringify([subject,server,binding])));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    const payload = Buffer.concat([nonce,cipher.getAuthTag(),encrypted]);
    this.database.prepare(`
      INSERT INTO delegated_oauth(subject,server,payload) VALUES(?,?,?)
      ON CONFLICT(subject,server) DO UPDATE SET payload=excluded.payload
    `).run(subject,server,payload);
  }

  delete(subject:string,server:string) {
    this.database.prepare('DELETE FROM delegated_oauth WHERE subject=? AND server=?').run(subject,server);
  }

  close() { this.database.close(); }
}
