import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import {
  createTarget,
  listTargets,
  updateTarget,
  addToTarget,
  softDeleteTarget,
  type TargetTable,
} from './targets.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

const TABLES: TargetTable[] = ['goals', 'special_projects'];

describe.each(TABLES)('target data layer (%s)', (table) => {
  it('creates then lists a row with the right fields', () => {
    const db = freshDb();
    const id = createTarget(db, table, {
      name: 'PS5',
      targetCents: 400_000,
      currentCents: 50_000,
      targetDate: '2026-12-01',
    });
    const [row] = listTargets(db, table);
    expect(row).toMatchObject({
      id,
      name: 'PS5',
      targetCents: 400_000,
      currentCents: 50_000,
      targetDate: '2026-12-01',
      status: 'active',
    });
  });

  it('rejects a blank name, non-positive target, or negative current', () => {
    const db = freshDb();
    expect(() => createTarget(db, table, { name: '  ', targetCents: 1000 })).toThrow();
    expect(() => createTarget(db, table, { name: 'x', targetCents: 0 })).toThrow();
    expect(() =>
      createTarget(db, table, { name: 'x', targetCents: 1000, currentCents: -1 }),
    ).toThrow();
  });

  it('lists newest first', () => {
    const db = freshDb();
    createTarget(db, table, { name: 'A', targetCents: 100 });
    createTarget(db, table, { name: 'B', targetCents: 100 });
    expect(listTargets(db, table).map((t) => t.name)).toEqual(['B', 'A']);
  });

  it('updates provided keys and no-ops on an empty patch', () => {
    const db = freshDb();
    const id = createTarget(db, table, { name: 'Trip', targetCents: 100_000 });
    updateTarget(db, table, id, { currentCents: 5_000, name: 'Big Trip' });
    updateTarget(db, table, id, {});
    expect(listTargets(db, table)[0]).toMatchObject({ name: 'Big Trip', currentCents: 5_000 });
  });

  it('addToTarget increments current; a non-positive delta throws', () => {
    const db = freshDb();
    const id = createTarget(db, table, { name: 'Bike', targetCents: 100_000, currentCents: 1_000 });
    addToTarget(db, table, id, 2_000);
    expect(listTargets(db, table)[0].currentCents).toBe(3_000);
    expect(() => addToTarget(db, table, id, 0)).toThrow();
    expect(() => addToTarget(db, table, id, -1)).toThrow();
  });

  it('excludes soft-deleted rows', () => {
    const db = freshDb();
    const id = createTarget(db, table, { name: 'Gone', targetCents: 100 });
    softDeleteTarget(db, table, id);
    expect(listTargets(db, table)).toHaveLength(0);
  });
});

describe('notes handling differs by table', () => {
  it('goals always reports notes as null', () => {
    const db = freshDb();
    createTarget(db, 'goals', { name: 'x', targetCents: 100, notes: 'ignored' });
    expect(listTargets(db, 'goals')[0].notes).toBeNull();
  });

  it('special_projects round-trips notes', () => {
    const db = freshDb();
    createTarget(db, 'special_projects', {
      name: 'Apto',
      targetCents: 100,
      notes: 'liberdade',
    });
    expect(listTargets(db, 'special_projects')[0].notes).toBe('liberdade');
  });
});

it('rejects an unknown table name', () => {
  const db = freshDb();
  // @ts-expect-error deliberate bad input
  expect(() => listTargets(db, 'drop_table')).toThrow();
});
