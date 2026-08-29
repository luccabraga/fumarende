/**
 * Every table that holds user data. Auth (`app_settings`, `sessions`),
 * schema (`schema_migrations`), and SQLite internals (`sqlite_sequence`)
 * are deliberately excluded from export / import / wipe / diagnostics.
 */
export const DATA_TABLES = [
  'income',
  'exchange_contracts',
  'expenses',
  'fixed_expenses',
  'emergency_fund_entries',
  'savings_monthly_targets',
  'goals',
  'special_projects',
  'category_rules',
  'ptax_rate_cache',
  'dollar_quotes',
  'ai_analyses',
  'claude_api_calls',
  'monthly_close',
] as const;

export type DataTable = (typeof DATA_TABLES)[number];
