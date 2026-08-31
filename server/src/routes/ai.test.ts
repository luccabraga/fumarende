import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';

async function authedApp(aiConfig?: Parameters<typeof buildApp>[3]) {
  const app = await buildApp(new Database(':memory:'), undefined, undefined, aiConfig);
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { password: 'test-password' },
  });
  const session = setup.cookies.find((c) => c.name === 'session')!.value;
  return { app, session };
}

describe('AI routes (no key configured)', () => {
  it('401s without a session', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/ai/status' })).statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/ai/status reports configured:false', async () => {
    const { app, session } = await authedApp();
    const res = await app.inject({ method: 'GET', url: '/api/ai/status', cookies: { session } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ configured: false, capUsdCents: 400 });
    await app.close();
  });

  it('POST /api/ai/analyses -> 503 when not configured, 400 on a bad kind', async () => {
    const { app, session } = await authedApp();
    const notConfigured = await app.inject({
      method: 'POST',
      url: '/api/ai/analyses',
      cookies: { session },
      payload: { kind: 'diagnostico' },
    });
    expect(notConfigured.statusCode).toBe(503);

    const badKind = await app.inject({
      method: 'POST',
      url: '/api/ai/analyses',
      cookies: { session },
      payload: { kind: 'nope' },
    });
    expect(badKind.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/ai/analyses -> 200 [] and rejects limit=0', async () => {
    const { app, session } = await authedApp();
    expect(
      (await app.inject({ method: 'GET', url: '/api/ai/analyses', cookies: { session } })).json(),
    ).toEqual([]);
    expect(
      (await app.inject({ method: 'GET', url: '/api/ai/analyses?limit=0', cookies: { session } }))
        .statusCode,
    ).toBe(400);
    await app.close();
  });

  it('GET /api/ai/status includes webSearch; GET /api/ai/usage returns the shape', async () => {
    const { app, session } = await authedApp();
    const status = await app.inject({ method: 'GET', url: '/api/ai/status', cookies: { session } });
    expect(typeof status.json().webSearch).toBe('boolean');

    const usage = await app.inject({ method: 'GET', url: '/api/ai/usage', cookies: { session } });
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({ byEndpoint: [], recent: [], capUsdCents: 400 });
    await app.close();
  });

  it('GET /api/ai/usage is 401 without a session', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/ai/usage' })).statusCode).toBe(401);
    await app.close();
  });

  it('POST /api/ai/analyses accepts a webSearch flag (still 503 with no key)', async () => {
    const { app, session } = await authedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/ai/analyses',
      cookies: { session },
      payload: { kind: 'cambio', webSearch: true },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
