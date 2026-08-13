import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupDatabase } from './backup.js';

describe('backupDatabase', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fumarende-backup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies the db file into backupDir with a timestamped name', () => {
    const dbPath = path.join(tmpDir, 'fumarende.db');
    fs.writeFileSync(dbPath, 'fake-db-contents');
    const backupDir = path.join(tmpDir, 'backups');

    const backupPath = backupDatabase(dbPath, backupDir);

    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.readFileSync(backupPath, 'utf-8')).toBe('fake-db-contents');
    expect(path.dirname(backupPath)).toBe(backupDir);
  });

  it('creates backupDir if it does not exist yet', () => {
    const dbPath = path.join(tmpDir, 'fumarende.db');
    fs.writeFileSync(dbPath, 'x');
    const backupDir = path.join(tmpDir, 'nested', 'backups');

    backupDatabase(dbPath, backupDir);

    expect(fs.existsSync(backupDir)).toBe(true);
  });
});
