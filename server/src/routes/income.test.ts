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

describe('income routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/income' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates and lists income entries when authenticated', async () => {
    const { app, sessionCookie } = await authedApp();

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 300000 },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.id).toBeTypeOf('number');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/income',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(1);
    expect(listRes.json()[0]).toMatchObject({ date: '2026-08-10', amountBrlCents: 300000 });

    await app.close();
  });

  it('rejects a non-positive amountBrlCents', async () => {
    const { app, sessionCookie } = await authedApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 0 },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('accepts a valid integer amountUsdCents', async () => {
    const { app, sessionCookie } = await authedApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 300000, amountUsdCents: 60000 },
    });
    expect(res.statusCode).toBe(201);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/income',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()[0]).toMatchObject({ amountUsdCents: 60000 });

    await app.close();
  });

  it('rejects a non-integer or non-numeric amountUsdCents', async () => {
    const { app, sessionCookie } = await authedApp();

    for (const amountUsdCents of [12.75, 'abc', true, {}]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/income',
        cookies: { session: sessionCookie },
        payload: { date: '2026-08-10', amountBrlCents: 300000, amountUsdCents },
      });
      expect(res.statusCode, `amountUsdCents=${JSON.stringify(amountUsdCents)}`).toBe(400);
    }

    // Nothing should have been stored.
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/income',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);

    await app.close();
  });

  it('allows an omitted or null amountUsdCents', async () => {
    const { app, sessionCookie } = await authedApp();

    const nullRes = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 300000, amountUsdCents: null },
    });
    expect(nullRes.statusCode).toBe(201);

    const omittedRes = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-11', amountBrlCents: 400000 },
    });
    expect(omittedRes.statusCode).toBe(201);

    await app.close();
  });

  it('rejects a non-integer exchangeContractId', async () => {
    const { app, sessionCookie } = await authedApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 300000, exchangeContractId: 1.5 },
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('soft-deletes an entry so it no longer appears in the list', async () => {
    const { app, sessionCookie } = await authedApp();

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 100 },
    });
    const { id } = createRes.json();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/income/${id}`,
      cookies: { session: sessionCookie },
    });
    expect(deleteRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/income',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);

    await app.close();
  });

  it('deletes when the client sends an empty body with a JSON content-type', async () => {
    // This is exactly what the browser's fetch wrapper used to send on every
    // request. Fastify's default JSON parser rejects it with
    // FST_ERR_CTP_EMPTY_JSON_BODY before the route runs.
    const { app, sessionCookie } = await authedApp();

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/income',
      cookies: { session: sessionCookie },
      payload: { date: '2026-08-10', amountBrlCents: 100 },
    });
    const { id } = createRes.json();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/income/${id}`,
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(deleteRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/income',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);

    await app.close();
  });
});
