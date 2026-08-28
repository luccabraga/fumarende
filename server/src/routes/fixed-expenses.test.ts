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

const validBody = {
  description: 'Aluguel',
  amountCents: 280_000,
  category: 'Moradia',
  type: 'essencial',
  paymentMethod: 'Pix',
};

describe('fixed-expense routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/fixed-expenses' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates and lists templates', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().id).toBeTypeOf('number');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/fixed-expenses',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(1);
    await app.close();
  });

  it('deletes a template', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    const { id } = createRes.json();
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/fixed-expenses/${id}`,
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(delRes.statusCode).toBe(200);
    await app.close();
  });

  it('applies templates to a month, idempotently', async () => {
    const { app, sessionCookie } = await authedApp();
    await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });

    const first = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses/apply',
      cookies: { session: sessionCookie },
      payload: { month: '2026-08' },
    });
    expect(first.json()).toEqual({ created: 1 });

    const second = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses/apply',
      cookies: { session: sessionCookie },
      payload: { month: '2026-08' },
    });
    expect(second.json()).toEqual({ created: 0 });
    await app.close();
  });

  it('rejects a malformed month on apply', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/fixed-expenses/apply',
      cookies: { session: sessionCookie },
      payload: { month: 'bad' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
