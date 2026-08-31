import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';
import { addRule } from '../categorize/rules.js';

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
  date: '2026-08-01',
  description: 'Mercado',
  amountCents: 10_000,
  category: 'Alimentação',
  type: 'essencial',
  paymentMethod: 'Débito',
};

describe('expense routes', () => {
  it('rejects unauthenticated requests', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: '/api/expenses' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates a one-off expense and lists it', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().ids).toHaveLength(1);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(1);
    await app.close();
  });

  it('creates an installment purchase as N rows', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: { ...validBody, amountCents: 40_000, installmentTotal: 4 },
    });
    expect(createRes.json().ids).toHaveLength(4);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(4);
    await app.close();
  });

  it('rejects an invalid type', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: { ...validBody, type: 'x' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('deletes a single expense by id', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: validBody,
    });
    const [id] = createRes.json().ids;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/expenses/${id}`,
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(delRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(0);
    await app.close();
  });

  it('fills a blank category from a matching rule on create', async () => {
    const { app, sessionCookie } = await authedApp();
    addRule(app.dbForTests, 'uber', 'Transporte');

    const res = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: { ...validBody, category: '', description: 'UBER *TRIP SP' },
    });
    expect(res.statusCode).toBe(201);
    const list = (
      await app.inject({ method: 'GET', url: '/api/expenses', cookies: { session: sessionCookie } })
    ).json();
    expect(list[0].category).toBe('Transporte');
    await app.close();
  });

  it('leaves the category blank when nothing matches and no key is set', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: { ...validBody, category: '', description: 'loja desconhecida' },
    });
    expect(res.statusCode).toBe(201);
    const list = (
      await app.inject({ method: 'GET', url: '/api/expenses', cookies: { session: sessionCookie } })
    ).json();
    expect(list[0].category).toBe('');
    await app.close();
  });

  it('applies one rule result to every installment row', async () => {
    const { app, sessionCookie } = await authedApp();
    addRule(app.dbForTests, 'tênis', 'Vestuário');
    await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: {
        ...validBody,
        category: '',
        description: 'Tênis Nike',
        amountCents: 30_000,
        installmentTotal: 3,
      },
    });
    const list = (
      await app.inject({ method: 'GET', url: '/api/expenses', cookies: { session: sessionCookie } })
    ).json();
    expect(list).toHaveLength(3);
    expect(list.every((e: { category: string }) => e.category === 'Vestuário')).toBe(true);
    await app.close();
  });

  it('categorize-pending sweeps blank rows and reports counts', async () => {
    const { app, sessionCookie } = await authedApp();
    for (const _ of [0, 1]) {
      await app.inject({
        method: 'POST',
        url: '/api/expenses',
        cookies: { session: sessionCookie },
        payload: { ...validBody, category: '', description: 'PADARIA CENTRAL' },
      });
    }
    addRule(app.dbForTests, 'padaria', 'Alimentação');

    const res = await app.inject({
      method: 'POST',
      url: '/api/expenses/categorize-pending',
      cookies: { session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2, stillPending: 0, stoppedAtCap: false });
    await app.close();
  });

  it('deletes a whole installment group', async () => {
    const { app, sessionCookie } = await authedApp();
    await app.inject({
      method: 'POST',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
      payload: { ...validBody, amountCents: 30_000, installmentTotal: 3 },
    });
    const listBefore = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    const groupId = listBefore.json()[0].installmentGroupId;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/expenses/group/${groupId}`,
      cookies: { session: sessionCookie },
    });
    expect(delRes.statusCode).toBe(200);

    const listAfter = await app.inject({
      method: 'GET',
      url: '/api/expenses',
      cookies: { session: sessionCookie },
    });
    expect(listAfter.json()).toHaveLength(0);
    await app.close();
  });
});
