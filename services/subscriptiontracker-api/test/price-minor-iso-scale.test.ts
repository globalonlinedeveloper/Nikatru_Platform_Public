import { describe, it, expect } from 'vitest';
import { SUBLY_MIGRATIONS, SqliteD1 } from './harness';
import migration0010 from '../migrations/0010_price_minor_iso_scale.sql?raw';
import { LEGACY_SCALE_CODES, MINOR_UNIT_DIGITS } from '../../../contracts/currency/iso4217.js';

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-03 · PR #1174 lead ruling 1(c), review finding 2. Migration 0010
// rewrites `price_minor` stored at the legacy two-digit scale to its currency's
// ISO scale, for the 24 LEGACY_SCALE_CODES only, from the REAL `price`. Proven
// here against the real engine: the rows it must move, the rows it must not,
// `price` untouched, no row lost, and a second application a no-op.
// ─────────────────────────────────────────────────────────────────────────────

const BEFORE = SUBLY_MIGRATIONS.filter((m) => m !== migration0010);

function seeded(): SqliteD1 {
  const db = new SqliteD1(BEFORE);
  const sub = db.db.prepare(
    'INSERT INTO subscriptions (id, user_id, name, price, currency, price_minor) VALUES (?, ?, ?, ?, ?, ?)',
  );
  sub.run('krw-legacy', 'u', 'x', 14900, 'KRW', 1490000); // Scenario A
  sub.run('krw-new', 'u', 'x', 14900, 'KRW', 14900); // already ISO
  sub.run('bhd-legacy', 'u', 'x', 2.5, 'BHD', 250);
  sub.run('clf-legacy', 'u', 'x', 1.2345, 'CLF', 123);
  sub.run('usd', 'u', 'x', 19.99, 'USD', 1999); // scale unchanged
  sub.run('jpy', 'u', 'x', 649, 'JPY', 649); // legacy client already knew JPY
  sub.run('krw-null', 'u', 'x', 14900, 'KRW', null); // no exact form: left alone
  sub.run('krw-other', 'u', 'x', 14900, 'KRW', 7); // neither scale: not guessed at
  db.db
    .prepare(
      `INSERT INTO price_change (id, subscription_id, user_id, old_price, new_price, old_price_minor,
         new_price_minor, old_currency, new_currency, changed_at) VALUES (?, ?, 'u', ?, ?, ?, ?, ?, ?, '2026-09-01T00:00:00Z')`,
    )
    .run('pc1', 'krw-legacy', 9900, 2.5, 990000, 250, 'KRW', 'BHD');
  return db;
}

const subs = (db: SqliteD1) =>
  Object.fromEntries(db.rows('SELECT id, price, price_minor FROM subscriptions').map((r) => [r.id, r]));

describe('migration 0010 — price_minor at the ISO 4217 scale', () => {
  it('🔴 Scenario A: a KRW row price=14900, price_minor=1490000 becomes 14900; BHD 250 → 2500; CLF 123 → 12345', () => {
    const db = seeded();
    db.db.exec(migration0010);
    const s = subs(db);
    expect(s['krw-legacy']).toEqual({ id: 'krw-legacy', price: 14900, price_minor: 14900 });
    expect(s['bhd-legacy'].price_minor).toBe(2500);
    expect(s['clf-legacy'].price_minor).toBe(12345);
    expect(db.rows('SELECT old_price_minor, new_price_minor FROM price_change')).toEqual([
      { old_price_minor: 9900, new_price_minor: 2500 },
    ]);
  });

  it('touches nothing else: ISO-scale rows, unchanged-scale codes, NULL and neither-scale values, and `price`', () => {
    const db = seeded();
    const before = subs(db);
    db.db.exec(migration0010);
    const after = subs(db);
    for (const id of ['krw-new', 'usd', 'jpy', 'krw-null', 'krw-other']) expect(after[id], id).toEqual(before[id]);
    for (const id of Object.keys(before)) expect(after[id].price, id).toBe(before[id].price);
    expect(db.count('subscriptions')).toBe(8);
    expect(db.count('price_change')).toBe(1);
  });

  it('is replay-safe: a second application changes nothing', () => {
    const db = seeded();
    db.db.exec(migration0010);
    const once = JSON.stringify([db.rows('SELECT * FROM subscriptions ORDER BY id'), db.rows('SELECT * FROM price_change')]);
    db.db.exec(migration0010);
    const twice = JSON.stringify([db.rows('SELECT * FROM subscriptions ORDER BY id'), db.rows('SELECT * FROM price_change')]);
    expect(twice).toBe(once);
  });

  it('its code lists are exactly iso4217.js LEGACY_SCALE_CODES, each under its own ISO digits', () => {
    const code = migration0010.replace(/--[^\n]*/g, '');
    const found: string[] = [];
    const statements = code.split(';').filter((s) => /\bUPDATE\b/.test(s));
    expect(statements.length).toBe(9);
    for (const stmt of statements) {
      const factor = Number(/ROUND\(\w+ \* (\d+)\) AS INTEGER\)\s+WHERE/.exec(stmt)?.[1]);
      const codes = [...(/IN \(([^)]*)\)/.exec(stmt)?.[1] ?? '').matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]);
      expect(codes.length, stmt).toBeGreaterThan(0);
      for (const c of codes) expect(10 ** MINOR_UNIT_DIGITS[c], `${c} in ${stmt}`).toBe(factor);
      found.push(...codes);
    }
    // Each code appears in three statements (subscriptions, old_*, new_*).
    expect([...new Set(found)].sort()).toEqual([...LEGACY_SCALE_CODES]);
    expect(found.length).toBe(LEGACY_SCALE_CODES.length * 3);
  });
});
