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

describe('dollar-quote routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/dollar-quotes' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('upserts a month and lists it, then replaces it', async () => {
    const { app, sessionCookie } = await authedApp();

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-06',
      cookies: { session: sessionCookie },
      payload: { rate: 5.1, salaryUsdCents: 500_000 },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toEqual({ month: '2026-06', rate: 5.1, salaryUsdCents: 500_000 });

    await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-06',
      cookies: { session: sessionCookie },
      payload: { rate: 5.35 },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/dollar-quotes',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toEqual([{ month: '2026-06', rate: 5.35, salaryUsdCents: null }]);
    await app.close();
  });

  it('rejects a malformed month or a non-positive rate', async () => {
    const { app, sessionCookie } = await authedApp();
    const badMonth = await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-6',
      cookies: { session: sessionCookie },
      payload: { rate: 5 },
    });
    expect(badMonth.statusCode).toBe(400);

    const badRate = await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-07',
      cookies: { session: sessionCookie },
      payload: { rate: 0 },
    });
    expect(badRate.statusCode).toBe(400);
    await app.close();
  });

  it('deletes a month, tolerating an empty JSON body', async () => {
    const { app, sessionCookie } = await authedApp();
    await app.inject({
      method: 'PUT',
      url: '/api/dollar-quotes/2026-06',
      cookies: { session: sessionCookie },
      payload: { rate: 5.1 },
    });

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/dollar-quotes/2026-06',
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(delRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/dollar-quotes',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);
    await app.close();
  });
});
