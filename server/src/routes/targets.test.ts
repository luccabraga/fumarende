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

const BASE_PATHS = ['/api/goals', '/api/special-projects'];

describe.each(BASE_PATHS)('target routes (%s)', (base) => {
  it('rejects unauthenticated GET', async () => {
    const app = await buildApp(new Database(':memory:'));
    const res = await app.inject({ method: 'GET', url: base });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('creates and lists a target', async () => {
    const { app, sessionCookie } = await authedApp();
    const createRes = await app.inject({
      method: 'POST',
      url: base,
      cookies: { session: sessionCookie },
      payload: { name: 'PS5', targetCents: 400_000, targetDate: '2026-12-01' },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().id).toBeTypeOf('number');

    const listRes = await app.inject({
      method: 'GET',
      url: base,
      cookies: { session: sessionCookie },
    });
    expect(listRes.json()).toHaveLength(1);
    expect(listRes.json()[0]).toMatchObject({ name: 'PS5', targetCents: 400_000 });
    await app.close();
  });

  it('rejects a blank name or non-positive target', async () => {
    const { app, sessionCookie } = await authedApp();
    const a = await app.inject({
      method: 'POST',
      url: base,
      cookies: { session: sessionCookie },
      payload: { name: '  ', targetCents: 1000 },
    });
    expect(a.statusCode).toBe(400);
    const b = await app.inject({
      method: 'POST',
      url: base,
      cookies: { session: sessionCookie },
      payload: { name: 'x', targetCents: 0 },
    });
    expect(b.statusCode).toBe(400);
    await app.close();
  });

  it('patches current via PATCH and via /add', async () => {
    const { app, sessionCookie } = await authedApp();
    const { id } = (
      await app.inject({
        method: 'POST',
        url: base,
        cookies: { session: sessionCookie },
        payload: { name: 'Trip', targetCents: 100_000, currentCents: 1_000 },
      })
    ).json();

    await app.inject({
      method: 'PATCH',
      url: `${base}/${id}`,
      cookies: { session: sessionCookie },
      payload: { currentCents: 9_000 },
    });
    let list = (
      await app.inject({ method: 'GET', url: base, cookies: { session: sessionCookie } })
    ).json();
    expect(list[0].currentCents).toBe(9_000);

    await app.inject({
      method: 'POST',
      url: `${base}/${id}/add`,
      cookies: { session: sessionCookie },
      payload: { deltaCents: 1_000 },
    });
    list = (
      await app.inject({ method: 'GET', url: base, cookies: { session: sessionCookie } })
    ).json();
    expect(list[0].currentCents).toBe(10_000);

    const bad = await app.inject({
      method: 'POST',
      url: `${base}/${id}/add`,
      cookies: { session: sessionCookie },
      payload: { deltaCents: 0 },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('soft-deletes, tolerating an empty JSON body', async () => {
    const { app, sessionCookie } = await authedApp();
    const { id } = (
      await app.inject({
        method: 'POST',
        url: base,
        cookies: { session: sessionCookie },
        payload: { name: 'Gone', targetCents: 100 },
      })
    ).json();

    const delRes = await app.inject({
      method: 'DELETE',
      url: `${base}/${id}`,
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    expect(delRes.statusCode).toBe(200);
    const list = (
      await app.inject({ method: 'GET', url: base, cookies: { session: sessionCookie } })
    ).json();
    expect(list).toHaveLength(0);
    await app.close();
  });
});

it('round-trips notes on /api/special-projects only', async () => {
  const { app, sessionCookie } = await authedApp();
  await app.inject({
    method: 'POST',
    url: '/api/special-projects',
    cookies: { session: sessionCookie },
    payload: { name: 'Apto', targetCents: 100, notes: 'liberdade' },
  });
  const list = (
    await app.inject({
      method: 'GET',
      url: '/api/special-projects',
      cookies: { session: sessionCookie },
    })
  ).json();
  expect(list[0].notes).toBe('liberdade');
  await app.close();
});
