import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';

async function authedApp() {
  const app = await buildApp(new Database(':memory:'));
  const setupRes = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { password: 'test-password' },
  });
  const sessionCookie = setupRes.cookies.find((c) => c.name === 'session')!.value;
  return { app, sessionCookie };
}

describe('dashboard route', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/dashboard' })).statusCode).toBe(401);
    await app.close();
  });

  it('returns a summary shape when authenticated', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
      cookies: { session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.month).toMatch(/^\d{4}-\d{2}$/);
    expect(body.income).toHaveProperty('currentCents');
    expect(Array.isArray(body.alerts)).toBe(true);
    expect(body.evolution).toHaveLength(6);
    await app.close();
  });

  it('accepts a ?month= query and rejects a malformed one', async () => {
    const { app, sessionCookie } = await authedApp();

    const ok = await app.inject({
      method: 'GET',
      url: '/api/dashboard?month=2026-06',
      cookies: { session: sessionCookie },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().month).toBe('2026-06');

    const bad = await app.inject({
      method: 'GET',
      url: '/api/dashboard?month=2026-6',
      cookies: { session: sessionCookie },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});
