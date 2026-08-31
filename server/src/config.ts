import os from 'node:os';
import path from 'node:path';

export interface AiConfig {
  apiKey: string | null;
  model: string;
  categorizeModel: string;
  monthlyCapUsdCents: number;
  usdBrlFallbackRate: number;
  webSearch: boolean;
  webSearchMaxUses: number;
}

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  frontendDistDir: string;
  ai: AiConfig;
}

const AI_MODEL_DEFAULT = 'claude-sonnet-5';
const AI_CATEGORIZE_MODEL_DEFAULT = 'claude-haiku-4-5';
const AI_MONTHLY_CAP_USD_CENTS_DEFAULT = 400;
const USD_BRL_FALLBACK_DEFAULT = 5.4;
const AI_WEB_SEARCH_MAX_DEFAULT = 3;

/** The "AI is off" config: used by `buildApp` when no `aiConfig` is passed. */
export const NOT_CONFIGURED_AI: AiConfig = {
  apiKey: null,
  model: AI_MODEL_DEFAULT,
  categorizeModel: AI_CATEGORIZE_MODEL_DEFAULT,
  monthlyCapUsdCents: AI_MONTHLY_CAP_USD_CENTS_DEFAULT,
  usdBrlFallbackRate: USD_BRL_FALLBACK_DEFAULT,
  webSearch: true,
  webSearchMaxUses: AI_WEB_SEARCH_MAX_DEFAULT,
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir =
    env.FUMARENDE_DATA_DIR ??
    path.join(os.homedir(), 'Library', 'Application Support', 'fumarende');

  return {
    port: Number(env.FUMARENDE_PORT ?? 4173),
    dataDir,
    dbPath: path.join(dataDir, 'fumarende.db'),
    backupDir: path.join(dataDir, 'backups'),
    frontendDistDir:
      env.FUMARENDE_FRONTEND_DIST ??
      path.join(process.cwd(), '..', 'frontend', 'dist'),
    ai: {
      apiKey: env.ANTHROPIC_API_KEY || null, // empty string counts as "not configured"
      model: env.FUMARENDE_AI_MODEL ?? AI_MODEL_DEFAULT,
      categorizeModel: env.FUMARENDE_AI_CATEGORIZE_MODEL ?? AI_CATEGORIZE_MODEL_DEFAULT,
      monthlyCapUsdCents: Number(
        env.FUMARENDE_AI_MONTHLY_CAP_USD_CENTS ?? AI_MONTHLY_CAP_USD_CENTS_DEFAULT,
      ),
      usdBrlFallbackRate: Number(env.FUMARENDE_USD_BRL_FALLBACK ?? USD_BRL_FALLBACK_DEFAULT),
      webSearch: !['off', 'false', '0'].includes(
        (env.FUMARENDE_AI_WEB_SEARCH ?? 'on').toLowerCase(),
      ),
      webSearchMaxUses: Number(env.FUMARENDE_AI_WEB_SEARCH_MAX ?? AI_WEB_SEARCH_MAX_DEFAULT),
    },
  };
}
