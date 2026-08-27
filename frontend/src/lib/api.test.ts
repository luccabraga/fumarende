import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIncome, deleteIncome } from './api.js';

function stubFetch(body: unknown, status: number) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api request helper', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not send a JSON Content-Type on a bodyless request', async () => {
    const fetchMock = stubFetch({ ok: true }, 200);

    await deleteIncome(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/income/1');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has('Content-Type')).toBe(false);
  });

  it('sends a JSON Content-Type when there is a body', async () => {
    const fetchMock = stubFetch({ id: 1 }, 201);

    await createIncome({ date: '2026-08-27', amountBrlCents: 1000, description: null });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });
});
