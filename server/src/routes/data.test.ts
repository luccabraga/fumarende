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

const addIncome = (app: Awaited<ReturnType<typeof authedApp>>['app'], cookie: string) =>
  app.inject({
    method: 'POST',
    url: '/api/income',
    cookies: { session: cookie },
    payload: { date: '2026-06-01', amountBrlCents: 500000 },
  });

describe('data routes', () => {
  it('rejects unauthenticated diagnostics', async () => {
    const app = await buildApp(new Database(':memory:'));
    expect((await app.inject({ method: 'GET', url: '/api/data/diagnostics' })).statusCode).toBe(401);
    await app.close();
  });

  it('exports with an attachment header and a tables object', async () => {
    const { app, sessionCookie } = await authedApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/data/export',
      cookies: { session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment; filename="fumarende-');
    expect(res.json().tables).toBeTypeOf('object');
    await app.close();
  });

  it('round-trips export -> wipe -> import over HTTP', async () => {
    const { app, sessionCookie } = await authedApp();
    await addIncome(app, sessionCookie);

    const snapshot = (
      await app.inject({
        method: 'GET',
        url: '/api/data/export',
        cookies: { session: sessionCookie },
      })
    ).json();

    await app.inject({
      method: 'POST',
      url: '/api/data/wipe',
      cookies: { session: sessionCookie },
      payload: { confirm: 'APAGAR TUDO' },
    });
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/income', cookies: { session: sessionCookie } })
      ).json(),
    ).toHaveLength(0);

    const importRes = await app.inject({
      method: 'POST',
      url: '/api/data/import',
      cookies: { session: sessionCookie },
      payload: snapshot,
    });
    expect(importRes.json()).toMatchObject({ backupPath: null, imported: { income: 1 } });
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/income', cookies: { session: sessionCookie } })
      ).json(),
    ).toHaveLength(1);
    await app.close();
  });

  it('rejects a wrong confirmation phrase and a bad import payload', async () => {
    const { app, sessionCookie } = await authedApp();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/data/wipe',
          cookies: { session: sessionCookie },
          payload: { confirm: 'nope' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/data/import',
          cookies: { session: sessionCookie },
          payload: { version: 1, tables: { nope: [] } },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it('seeds test data behind the phrase gate', async () => {
    const { app, sessionCookie } = await authedApp();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/data/seed-test',
          cookies: { session: sessionCookie },
          payload: { confirm: 'wrong' },
        })
      ).statusCode,
    ).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/data/seed-test',
      cookies: { session: sessionCookie },
      payload: { confirm: 'APAGAR TUDO' },
    });
    expect(ok.json()).toMatchObject({ seeded: true });
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/income', cookies: { session: sessionCookie } })
      ).json().length,
    ).toBeGreaterThan(0);
    await app.close();
  });

  it('marks and unmarks a month reviewed', async () => {
    const { app, sessionCookie } = await authedApp();
    await addIncome(app, sessionCookie);

    let list = (
      await app.inject({
        method: 'GET',
        url: '/api/monthly-close',
        cookies: { session: sessionCookie },
      })
    ).json();
    expect(list.find((r: { month: string }) => r.month === '2026-06')).toMatchObject({
      reviewed: false,
    });

    const put = await app.inject({
      method: 'PUT',
      url: '/api/monthly-close/2026-06',
      cookies: { session: sessionCookie },
    });
    expect(put.json()).toMatchObject({ month: '2026-06', reviewed: true });

    list = (
      await app.inject({
        method: 'GET',
        url: '/api/monthly-close',
        cookies: { session: sessionCookie },
      })
    ).json();
    expect(list.find((r: { month: string }) => r.month === '2026-06').reviewed).toBe(true);

    await app.inject({
      method: 'DELETE',
      url: '/api/monthly-close/2026-06',
      cookies: { session: sessionCookie },
      headers: { 'content-type': 'application/json' },
    });
    list = (
      await app.inject({
        method: 'GET',
        url: '/api/monthly-close',
        cookies: { session: sessionCookie },
      })
    ).json();
    expect(list.find((r: { month: string }) => r.month === '2026-06').reviewed).toBe(false);

    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/monthly-close/2026-6',
          cookies: { session: sessionCookie },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});
