import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';

function freshDb() {
  return new Database(':memory:');
}

describe('auth routes', () => {
  it('status reports passwordSet: false before setup', async () => {
    const app = await buildApp(freshDb());
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.json()).toEqual({ passwordSet: false, authenticated: false });
    await app.close();
  });

  it('setup sets the password, creates a session, and rejects a second setup', async () => {
    const app = await buildApp(freshDb());

    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'first-run-password' },
    });
    expect(setupRes.statusCode).toBe(200);
    expect(setupRes.cookies.some((c) => c.name === 'session')).toBe(true);

    const secondSetupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'anything' },
    });
    expect(secondSetupRes.statusCode).toBe(409);

    await app.close();
  });

  it('rejects a setup password shorter than 8 characters', async () => {
    for (const password of ['', 'short', '1234567']) {
      const app = await buildApp(freshDb());

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { password },
      });
      expect(res.statusCode, `password=${JSON.stringify(password)}`).toBe(400);
      expect(res.json().error).toContain('at least 8 characters');
      expect(res.cookies.some((c) => c.name === 'session')).toBe(false);

      // The rejected attempt must not have consumed the one-shot setup.
      const statusRes = await app.inject({ method: 'GET', url: '/api/auth/status' });
      expect(statusRes.json()).toEqual({ passwordSet: false, authenticated: false });

      await app.close();
    }
  });

  it('rejects a setup body with a missing or non-string password', async () => {
    const app = await buildApp(freshDb());

    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {},
    });
    expect(missing.statusCode).toBe(400);

    const nonString = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 12345678 },
    });
    expect(nonString.statusCode).toBe(400);

    await app.close();
  });

  it('accepts a setup password of exactly 8 characters', async () => {
    const app = await buildApp(freshDb());

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: '12345678' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.some((c) => c.name === 'session')).toBe(true);

    await app.close();
  });

  it('login succeeds with the right password and fails with the wrong one', async () => {
    const app = await buildApp(freshDb());
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'correct-password' },
    });

    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'wrong-password' },
    });
    expect(badLogin.statusCode).toBe(401);

    const goodLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'correct-password' },
    });
    expect(goodLogin.statusCode).toBe(200);
    expect(goodLogin.cookies.some((c) => c.name === 'session')).toBe(true);

    await app.close();
  });

  it('a protected route requires a valid session cookie', async () => {
    const app = await buildApp(freshDb());
    app.get(
      '/api/protected-test-route',
      { preHandler: (await import('./require-auth.js')).requireAuth(app.dbForTests) },
      async () => ({ secret: true }),
    );

    const noCookie = await app.inject({ method: 'GET', url: '/api/protected-test-route' });
    expect(noCookie.statusCode).toBe(401);

    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { password: 'correct-password' },
    });
    const sessionCookie = setupRes.cookies.find((c) => c.name === 'session')!;

    const withCookie = await app.inject({
      method: 'GET',
      url: '/api/protected-test-route',
      cookies: { session: sessionCookie.value },
    });
    expect(withCookie.statusCode).toBe(200);

    await app.close();
  });
});
