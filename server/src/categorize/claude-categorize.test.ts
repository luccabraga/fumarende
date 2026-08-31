import { describe, expect, it, vi } from 'vitest';
import { claudeCategorize } from './claude-categorize.js';
import type { AiConfig } from '../config.js';

const CFG: AiConfig = {
  apiKey: 'sk',
  model: 'claude-sonnet-5',
  categorizeModel: 'claude-haiku-4-5',
  monthlyCapUsdCents: 400,
  usdBrlFallbackRate: 5.4,
};

function reply(text: string, usage = { input_tokens: 40, output_tokens: 12 }) {
  return vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text }], usage }), { status: 200 }),
    ) as unknown as typeof fetch;
}

describe('claudeCategorize', () => {
  it('uses the categorize model and parses a clean JSON reply', async () => {
    const f = reply('{"category":"Transporte","confidence":"high","keyword":"uber"}');
    const out = await claudeCategorize(CFG, 'UBER *TRIP', f);
    expect(out.guess).toEqual({ category: 'Transporte', confidence: 'high', keyword: 'uber' });
    expect(out.inputTokens).toBe(40);

    const init = (f as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1];
    expect(JSON.parse(init.body).model).toBe('claude-haiku-4-5');
  });

  it('strips a ```json fence', async () => {
    const f = reply('```json\n{"category":"Delivery","confidence":"high","keyword":"ifood"}\n```');
    expect((await claudeCategorize(CFG, 'IFOOD', f)).guess.category).toBe('Delivery');
  });

  it('returns a null/low guess for an unparseable or off-list reply', async () => {
    expect((await claudeCategorize(CFG, 'x', reply('not json'))).guess).toEqual({
      category: null,
      confidence: 'low',
      keyword: null,
    });
    expect(
      (await claudeCategorize(CFG, 'x', reply('{"category":"Bogus","confidence":"high","keyword":"z"}')))
        .guess.category,
    ).toBeNull();
  });

  it('propagates an upstream error', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response('err', { status: 500 })) as unknown as typeof fetch;
    await expect(claudeCategorize(CFG, 'x', f)).rejects.toThrow();
  });
});
