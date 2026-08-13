import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { getSetting, setSetting } from './settings.js';

describe('settings', () => {
  it('returns undefined for an unset key', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(getSetting(db, 'password_hash')).toBeUndefined();
  });

  it('round-trips a value through setSetting/getSetting', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    setSetting(db, 'password_hash', 'abc:def');
    expect(getSetting(db, 'password_hash')).toBe('abc:def');
  });

  it('overwrites an existing value', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    setSetting(db, 'password_hash', 'first');
    setSetting(db, 'password_hash', 'second');
    expect(getSetting(db, 'password_hash')).toBe('second');
  });
});
