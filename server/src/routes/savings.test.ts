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

describe('savings routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/emergency-fund' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('records a deposit and a withdrawal with the right signs', async () => {
    const { app, sessionCookie } = await authedApp();

    await app.inject({
      method: 'POST',
      url: '/api/emergency-fund',
      cookies: { session: sessionCookie },
      payload: { kind: 'deposit', date: '2026-06-01', amountCents: 700_000 },
    });
    await app.inject({
      method: 'POST',
      url: '/api/emergency-fund',
      cookies: { session: sessionCookie },
      payload: { kind: 'withdrawal', date: '2026-06-10', amountCents: 200_000 },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/emergency-fund',
      cookies: { session: sessionCookie },
    });
    const entries = listRes.json();
    expect(entries).toHaveLength(2);
    expect(entries.reduce((s: number, e: { amountCents: number }) => s + e.amountCents, 0)).toBe(
      500_000,
    );
    await app.close();
  });

  it('rejects a bad kind or a non-positive amount', async () => {
    const { app, sessionCookie } = await authedApp();
    const badKind = await app.inject({
      method: 'POST',
      url: '/api/emergency-fund',
      cookies: { session: sessionCookie },
      payload: { kind: 'x', date: '2026-06-01', amountCents: 100 },
    });
    expect(badKind.statusCode).toBe(400);

    const badAmount = await app.inject({
      method: 'POST',
      url: '/api/emergency-fund',
      cookies: { session: sessionCookie },
      payload: { kind: 'deposit', date: '2026-06-01', amountCents: 0 },
    });
    expect(badAmount.statusCode).toBe(400);
    await app.close();
  });

  it('deletes an entry', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/emergency-fund',
      cookies: { session: sessionCookie },
      payload: { kind: 'deposit', date: '2026-06-01', amountCents: 100 },
    });
    const { id } = createRes.json();
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/emergency-fund/${id}`,
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(delRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/emergency-fund',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);
    await app.close();
  });

  it('returns and updates a monthly savings target', async () => {
    const { app, sessionCookie } = await authedApp();

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/savings-target/2026-08',
      cookies: { session: sessionCookie },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toMatchObject({ month: '2026-08', pctOrFixed: 'pct' });

    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/savings-target/2026-08',
      cookies: { session: sessionCookie },
      payload: { pctOrFixed: 'fixed', fixedValueCents: 120_000 },
    });
    expect(putRes.json()).toMatchObject({ pctOrFixed: 'fixed', targetCents: 120_000 });
    await app.close();
  });

  it('rejects a malformed month or bad pctOrFixed', async () => {
    const { app, sessionCookie } = await authedApp();
    const badMonth = await app.inject({
      method: 'GET',
      url: '/api/savings-target/2026-8',
      cookies: { session: sessionCookie },
    });
    expect(badMonth.statusCode).toBe(400);

    const badCfg = await app.inject({
      method: 'PUT',
      url: '/api/savings-target/2026-08',
      cookies: { session: sessionCookie },
      payload: { pctOrFixed: 'weekly' },
    });
    expect(badCfg.statusCode).toBe(400);
    await app.close();
  });
});
