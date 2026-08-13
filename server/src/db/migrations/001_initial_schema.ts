import type { Migration } from '../migrate.js';

export const migration001: Migration = {
  id: '001_initial_schema',
  sql: `
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE exchange_contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount_usd_cents INTEGER NOT NULL,
      ptax_rate REAL,
      contracted_rate REAL,
      iof_cents INTEGER NOT NULL DEFAULT 0,
      bank_fee_cents INTEGER NOT NULL DEFAULT 0,
      net_brl_cents INTEGER NOT NULL,
      institution TEXT,
      operation_type TEXT,
      source_pdf_ref TEXT,
      notes TEXT,
      deleted_at TEXT
    );

    CREATE TABLE income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount_brl_cents INTEGER NOT NULL,
      amount_usd_cents INTEGER,
      description TEXT,
      source TEXT,
      exchange_contract_id INTEGER REFERENCES exchange_contracts(id),
      notes TEXT,
      deleted_at TEXT
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      installment_number INTEGER,
      installment_total INTEGER,
      installment_group_id TEXT,
      notes TEXT,
      deleted_at TEXT
    );

    CREATE TABLE fixed_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE emergency_fund_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      notes TEXT,
      deleted_at TEXT
    );

    CREATE TABLE savings_monthly_targets (
      month TEXT PRIMARY KEY,
      pct_or_fixed TEXT NOT NULL,
      pct_value INTEGER,
      fixed_value_cents INTEGER,
      target_cents INTEGER NOT NULL DEFAULT 0,
      rollover_cents INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_cents INTEGER NOT NULL,
      current_cents INTEGER NOT NULL DEFAULT 0,
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      deleted_at TEXT
    );

    CREATE TABLE special_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_cents INTEGER NOT NULL,
      current_cents INTEGER NOT NULL DEFAULT 0,
      target_date TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      deleted_at TEXT
    );

    CREATE TABLE category_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      category TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE ptax_rate_cache (
      date TEXT PRIMARY KEY,
      rate REAL NOT NULL
    );

    CREATE TABLE monthly_close (
      month TEXT PRIMARY KEY,
      reviewed_at TEXT NOT NULL
    );
  `,
};
