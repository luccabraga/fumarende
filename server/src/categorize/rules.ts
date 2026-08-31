import type Database from 'better-sqlite3';
import { isCategory } from './categories.js';

export interface CategoryRule {
  id: number;
  keyword: string;
  category: string;
}

export function listRules(db: Database.Database): CategoryRule[] {
  return db
    .prepare(
      'SELECT id, keyword, category FROM category_rules WHERE deleted_at IS NULL ORDER BY id',
    )
    .all() as CategoryRule[];
}

export function addRule(db: Database.Database, keyword: string, category: string): CategoryRule {
  const kw = keyword.trim().toLowerCase();
  if (kw === '') throw new Error('keyword is required');
  if (!isCategory(category)) throw new Error(`unknown category: ${category}`);

  const existing = db
    .prepare(
      'SELECT id, keyword, category FROM category_rules WHERE deleted_at IS NULL AND keyword = ? AND category = ?',
    )
    .get(kw, category) as CategoryRule | undefined;
  if (existing) return existing;

  const id = Number(
    db
      .prepare('INSERT INTO category_rules (keyword, category) VALUES (?, ?)')
      .run(kw, category).lastInsertRowid,
  );
  return { id, keyword: kw, category };
}

export function deleteRule(db: Database.Database, id: number): void {
  db.prepare('UPDATE category_rules SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
    new Date().toISOString(),
    id,
  );
}

/**
 * First rule (by `id ASC` order) whose lowercased `keyword` is a
 * substring of `description`; `null` when none match.
 */
export function matchRule(rules: CategoryRule[], description: string): CategoryRule | null {
  const hay = description.toLowerCase();
  for (const r of rules) {
    const kw = r.keyword.toLowerCase();
    if (kw !== '' && hay.includes(kw)) return r;
  }
  return null;
}
