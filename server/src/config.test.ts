import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('derives dbPath and backupDir from dataDir', () => {
    const config = loadConfig({ FUMARENDE_DATA_DIR: '/tmp/fumarende-test' });
    expect(config.dataDir).toBe('/tmp/fumarende-test');
    expect(config.dbPath).toBe(path.join('/tmp/fumarende-test', 'fumarende.db'));
    expect(config.backupDir).toBe(path.join('/tmp/fumarende-test', 'backups'));
  });

  it('defaults port to 4173 when FUMARENDE_PORT is unset', () => {
    const config = loadConfig({});
    expect(config.port).toBe(4173);
  });

  it('reads FUMARENDE_PORT when set', () => {
    const config = loadConfig({ FUMARENDE_PORT: '5000' });
    expect(config.port).toBe(5000);
  });
});
