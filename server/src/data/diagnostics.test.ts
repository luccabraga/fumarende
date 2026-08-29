import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate.js';
import { diagnostics } from './diagnostics.js';

describe('diagnostics', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fumarende-diag-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('counts non-deleted rows, lists migrations, and has no fs data without paths', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO income (date, amount_brl_cents) VALUES ('2026-06-01', 100)").run();
    db.prepare(
      "INSERT INTO income (date, amount_brl_cents, deleted_at) VALUES ('2026-06-02', 200, 'x')",
    ).run();

    const d = diagnostics(db);
    expect(d.rowCounts.income).toBe(1); // the soft-deleted row is not counted
    expect(d.migrations).toEqual(['001_initial_schema', '002_dollar_quotes', '003_ai']);
    expect(d.dbSizeBytes).toBe(0);
    expect(d.lastBackup).toBeNull();
    expect(d.backupCount).toBe(0);
  });

  it('reports db size and backup count when given real paths', () => {
    const dbPath = path.join(tmp, 'fumarende.db');
    const db = new Database(dbPath);
    runMigrations(db);
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir);
    fs.writeFileSync(path.join(backupDir, 'fumarende-2026-06-01.db'), 'x');

    const d = diagnostics(db, { dbPath, backupDir });
    expect(d.dbSizeBytes).toBeGreaterThan(0);
    expect(d.backupCount).toBe(1);
    expect(d.lastBackup).not.toBeNull();
  });
});
