import { describe, expect, it, vi } from 'vitest';
import { callClaude, ClaudeNotConfiguredError, ClaudeUpstreamError } from './client.js';
import type { AiConfig } from '../config.js';

const CFG: AiConfig = {
  apiKey: 'sk-test',
  model: 'claude-sonnet-5',
  categorizeModel: 'claude-haiku-4-5',
  monthlyCapUsdCents: 400,
  usdBrlFallbackRate: 5.4,
  webSearch: true,
  webSearchMaxUses: 3,
};

function okResponse() {
  return new Response(
    JSON.stringify({
      content: [
        { type: 'text', text: 'Olá' },
        { type: 'text', text: ' mundo' },
      ],
      usage: { input_tokens: 12, output_tokens: 5 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('callClaude', () => {
  it('throws ClaudeNotConfiguredError and never fetches when apiKey is null', async () => {
    const fetchImpl = vi.fn();
    await expect(
      callClaude(
        { ...CFG, apiKey: null },
        { system: 's', user: 'u' },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(ClaudeNotConfiguredError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts to the messages endpoint with the right headers/body and parses text + usage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const res = await callClaude(
      CFG,
      { system: 'sys', user: 'ask', maxTokens: 900 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(res).toEqual({ text: 'Olá mundo', inputTokens: 12, outputTokens: 5 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('sk-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'claude-sonnet-5',
      max_tokens: 900,
      system: 'sys',
      messages: [{ role: 'user', content: 'ask' }],
    });
  });

  it('maps a non-2xx response to ClaudeUpstreamError with the status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }));
    const err = await callClaude(CFG, { system: 's', user: 'u' }, fetchImpl as unknown as typeof fetch).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ClaudeUpstreamError);
    expect(err.httpStatus).toBe(429);
  });

  it('maps a network throw to ClaudeUpstreamError with httpStatus null', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const err = await callClaude(CFG, { system: 's', user: 'u' }, fetchImpl as unknown as typeof fetch).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ClaudeUpstreamError);
    expect(err.httpStatus).toBeNull();
  });

  it('passes a content-block array straight through as the message content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());
    const blocks = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'QQ==' } },
      { type: 'text', text: 'extraia' },
    ];
    await callClaude(CFG, { system: 'sys', user: blocks }, fetchImpl as unknown as typeof fetch);
    const body = JSON.parse((fetchImpl.mock.calls[0] as [string, { body: string }])[1].body);
    expect(body.messages).toEqual([{ role: 'user', content: blocks }]);
  });
});
