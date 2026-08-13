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
});
