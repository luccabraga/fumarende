import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';

const SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000; // ~1 year

export function createSession(db: Database.Database): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString();

  db.prepare(
    'INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)',
  ).run(token, now.toISOString(), expiresAt);

  return { token, expiresAt };
}

export function verifySession(db: Database.Database, token: string): boolean {
  const row = db
    .prepare('SELECT expires_at FROM sessions WHERE token = ?')
    .get(token) as { expires_at: string } | undefined;

  if (!row) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

export function deleteSession(db: Database.Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
