import { describe, expect, it, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadDotEnv } from './load-env.js';

const KEYS = ['LE_A', 'LE_B', 'LE_C', 'LE_QUOTED', 'LE_EXISTING'];
afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

function writeEnv(contents: string): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'le-')), '.env');
  fs.writeFileSync(p, contents);
  return p;
}

describe('loadDotEnv', () => {
  it('sets KEY=VALUE pairs, ignores comments and blanks, strips quotes', () => {
    const p = writeEnv('# comment\nLE_A=hello\n\nLE_B = world \nLE_QUOTED="a b c"\n');
    loadDotEnv(p);
    expect(process.env.LE_A).toBe('hello');
    expect(process.env.LE_B).toBe('world');
    expect(process.env.LE_QUOTED).toBe('a b c');
  });

  it('does not override an already-set key', () => {
    process.env.LE_EXISTING = 'keep';
    const p = writeEnv('LE_EXISTING=overwrite\n');
    loadDotEnv(p);
    expect(process.env.LE_EXISTING).toBe('keep');
  });

  it('is a no-op when the file is missing', () => {
    expect(() => loadDotEnv('/no/such/file/.env')).not.toThrow();
  });
});
