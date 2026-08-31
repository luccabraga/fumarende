import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('derives dbPath and backupDir from dataDir', () => {
    const config = loadConfig({ FUMARENDE_DATA_DIR: '/tmp/fumarende-test' });
    expect(config.dataDir).toBe('/tmp/fumarende-test');
    expect(config.dbPath).toBe(path.join('/tmp/fumarende-test', 'fumarende.db'));
    expect(config.backupDir).toBe(path.join('/tmp/fumarende-test', 'backups'));
  });

  it('defaults port to 4173 when FUMARENDE_PORT is unset', () => {
    const config = loadConfig({});
    expect(config.port).toBe(4173);
  });

  it('reads FUMARENDE_PORT when set', () => {
    const config = loadConfig({ FUMARENDE_PORT: '5000' });
    expect(config.port).toBe(5000);
  });

  it('populates config.ai from env with defaults', () => {
    const c = loadConfig({});
    expect(c.ai).toEqual({
      apiKey: null,
      model: 'claude-sonnet-5',
      categorizeModel: 'claude-haiku-4-5',
      monthlyCapUsdCents: 400,
      usdBrlFallbackRate: 5.4,
      webSearch: true,
      webSearchMaxUses: 3,
    });
  });

  it('treats an empty ANTHROPIC_API_KEY as not configured', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: '' }).ai.apiKey).toBeNull();
  });

  it('parses the web-search kill switch', () => {
    for (const v of ['off', 'false', '0', 'OFF']) {
      expect(loadConfig({ FUMARENDE_AI_WEB_SEARCH: v }).ai.webSearch).toBe(false);
    }
    expect(loadConfig({ FUMARENDE_AI_WEB_SEARCH: 'on' }).ai.webSearch).toBe(true);
    expect(loadConfig({}).ai.webSearch).toBe(true);
  });

  it('reads the AI env vars when set', () => {
    const c = loadConfig({
      ANTHROPIC_API_KEY: 'sk-test',
      FUMARENDE_AI_MODEL: 'claude-opus-5',
      FUMARENDE_AI_CATEGORIZE_MODEL: 'claude-sonnet-5',
      FUMARENDE_AI_MONTHLY_CAP_USD_CENTS: '1000',
      FUMARENDE_USD_BRL_FALLBACK: '5.9',
      FUMARENDE_AI_WEB_SEARCH: 'off',
      FUMARENDE_AI_WEB_SEARCH_MAX: '5',
    });
    expect(c.ai).toEqual({
      apiKey: 'sk-test',
      model: 'claude-opus-5',
      categorizeModel: 'claude-sonnet-5',
      monthlyCapUsdCents: 1000,
      usdBrlFallbackRate: 5.9,
      webSearch: false,
      webSearchMaxUses: 5,
    });
  });
});
