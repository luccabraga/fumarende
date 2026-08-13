import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from './app.js';

describe('buildApp', () => {
  it('responds to GET /api/health with ok: true', async () => {
    const app = await buildApp(new Database(':memory:'));
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});

describe('static frontend serving', () => {
  it('serves index.html at / and falls back to it for unknown client routes', async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fumarende-dist-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html>fumarende</html>');

    const app = await buildApp(new Database(':memory:'), distDir);

    const rootRes = await app.inject({ method: 'GET', url: '/' });
    expect(rootRes.statusCode).toBe(200);
    expect(rootRes.body).toContain('fumarende');

    const fallbackRes = await app.inject({ method: 'GET', url: '/receitas' });
    expect(fallbackRes.statusCode).toBe(200);
    expect(fallbackRes.body).toContain('fumarende');

    await app.close();
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('returns JSON 404 for unmatched /api routes even when no dist dir is configured', async () => {
    const app = await buildApp(new Database(':memory:'));

    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });

    await app.close();
  });

  it('returns JSON 404 for unmatched /api routes when a dist dir is configured', async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fumarende-dist-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html>fumarende</html>');

    const app = await buildApp(new Database(':memory:'), distDir);

    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not found' });

    await app.close();
    fs.rmSync(distDir, { recursive: true, force: true });
  });
});
