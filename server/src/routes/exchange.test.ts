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
  date: '2026-08-05',
  institution: 'Banco Inter',
  operationType: 'compra',
  amountUsdCents: 500_000,
  contractedRate: 5.0994,
  ptaxRate: 5.12,
  iofCents: 65_318,
  bankFeeCents: 3_000,
};

describe('exchange-contract routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/exchange-contracts' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates and lists contracts when authenticated', async () => {
    const { app, sessionCookie } = await authedApp();

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/exchange-contracts',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().id).toBeTypeOf('number');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/exchange-contracts',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(1);
    expect(listRes.json()[0]).toMatchObject({ institution: 'Banco Inter', netBrlCents: 2_481_382 });

    await app.close();
  });

  it('rejects a non-positive amountUsdCents', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/exchange-contracts',
      cookies: { session: sessionCookie },
      payload: { ...validBody, amountUsdCents: 0 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects an invalid operationType', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/exchange-contracts',
      cookies: { session: sessionCookie },
      payload: { ...validBody, operationType: 'sideways' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a non-numeric contractedRate', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/exchange-contracts',
      cookies: { session: sessionCookie },
      payload: { ...validBody, contractedRate: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('accepts an omitted ptaxRate / iofCents / bankFeeCents', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/exchange-contracts',
      cookies: { session: sessionCookie },
      payload: {
        date: '2026-08-05',
        institution: 'Wise',
        operationType: 'compra',
        amountUsdCents: 100_000,
        contractedRate: 5.0,
      },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it('soft-deletes a contract so it leaves the list', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/exchange-contracts',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    const { id } = createRes.json();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/exchange-contracts/${id}`,
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(deleteRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/exchange-contracts',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);

    await app.close();
  });
});
