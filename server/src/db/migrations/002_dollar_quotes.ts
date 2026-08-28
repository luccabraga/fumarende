import type { Migration } from '../migrate.js';

export const migration002: Migration = {
  id: '002_dollar_quotes',
  sql: `
    CREATE TABLE dollar_quotes (
      month TEXT PRIMARY KEY,        -- YYYY-MM
      rate REAL NOT NULL,           -- USD/BRL, e.g. 5.12
      salary_usd_cents INTEGER,     -- optional
      deleted_at TEXT
    );
  `,
};
