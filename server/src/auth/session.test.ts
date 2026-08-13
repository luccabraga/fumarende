import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { createSession, deleteSession, verifySession } from './session.js';

describe('sessions', () => {
  it('a newly created session verifies as valid', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const { token } = createSession(db);
    expect(verifySession(db, token)).toBe(true);
  });

  it('an unknown token does not verify', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(verifySession(db, 'not-a-real-token')).toBe(false);
  });

  it('a deleted session no longer verifies', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const { token } = createSession(db);
    deleteSession(db, token);
    expect(verifySession(db, token)).toBe(false);
  });

  it('an expired session does not verify', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const { token } = createSession(db);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      token,
    );
    expect(verifySession(db, token)).toBe(false);
  });
});
