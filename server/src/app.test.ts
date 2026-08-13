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
