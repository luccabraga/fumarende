import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';

async function authed() {
  const app = await buildApp(new Database(':memory:'));
  const s = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { password: 'test-password' },
  });
  return { app, session: s.cookies.find((c) => c.name === 'session')!.value };
}

describe('category-rules routes', () => {
  it('401 without a session', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/category-rules' })).statusCode).toBe(401);
    await app.close();
  });

  it('CRUD round-trip', async () => {
    const { app, session } = await authed();

    const created = await app.inject({
      method: 'POST',
      url: '/api/category-rules',
      cookies: { session },
      payload: { keyword: 'Uber', category: 'Transporte' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json()).toMatchObject({ keyword: 'uber', category: 'Transporte' });

    const list = await app.inject({ method: 'GET', url: '/api/category-rules', cookies: { session } });
    expect(list.json()).toHaveLength(1);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/category-rules/${id}`,
      cookies: { session },
    });
    expect(del.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/category-rules', cookies: { session } })).json(),
    ).toHaveLength(0);
    await app.close();
  });

  it('400 on blank keyword or unknown category', async () => {
    const { app, session } = await authed();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/category-rules',
          cookies: { session },
          payload: { keyword: '  ', category: 'Transporte' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/category-rules',
          cookies: { session },
          payload: { keyword: 'x', category: 'Bogus' },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});
