import type { Migration } from '../migrate.js';

export const migration003: Migration = {
  id: '003_ai',
  sql: `
    CREATE TABLE claude_api_calls (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at     TEXT    NOT NULL,
      endpoint       TEXT    NOT NULL,
      model          TEXT    NOT NULL,
      input_tokens   INTEGER NOT NULL DEFAULT 0,
      output_tokens  INTEGER NOT NULL DEFAULT 0,
      cost_usd_cents INTEGER NOT NULL DEFAULT 0,
      status         TEXT    NOT NULL,
      error_message  TEXT
    );

    CREATE TABLE ai_analyses (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at         TEXT    NOT NULL,
      kind               TEXT    NOT NULL,
      snapshot_json      TEXT    NOT NULL,
      response_md        TEXT    NOT NULL,
      claude_api_call_id INTEGER NOT NULL
    );
  `,
};
