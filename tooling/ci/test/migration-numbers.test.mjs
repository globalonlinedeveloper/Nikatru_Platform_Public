// ─────────────────────────────────────────────────────────────────────────────
// migration-numbers.test.mjs — duplicateMigrationNumbers (tooling/ci/migration-tables.mjs), the limb
// tooling/ci/check-migrations.mjs runs (⏱ 2026-09-30, ADR no.NNN, third review
// of #1070): one migration number per migrations directory. ⏱ 2026-10-01 (fourth
// review): the number is compared numerically, and every DECLARED migrations_dir
// is scanned, whatever its name.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplicateMigrationNumbers } from '../migration-tables.mjs';

const REPO = join(import.meta.dirname, '..', '..', '..');

describe('migration numbers — one per directory', () => {
  test('🔴 RED CONTROL: two 0021_* files in one directory are refused', () => {
    const dups = duplicateMigrationNumbers([
      'services/platform/migrations/0020_reminders.sql',
      'services/platform/migrations/0021_ext_link_floor.sql',
      'services/platform/migrations/0021_native_attest.sql',
    ]);
    assert.deepEqual(dups, [
      { dir: 'services/platform/migrations', number: '0021', files: ['0021_ext_link_floor.sql', '0021_native_attest.sql'] },
    ]);
  });

  test('🔴 RED CONTROL: 0021_a and 21_b are ONE number, compared numerically (fourth review of #1070)', () => {
    assert.deepEqual(
      duplicateMigrationNumbers([
        'services/platform/migrations/0021_a.sql',
        'services/platform/migrations/21_b.sql',
        'services/platform/migrations/0210_c.sql',
      ]),
      [{ dir: 'services/platform/migrations', number: '0021', files: ['0021_a.sql', '21_b.sql'] }],
    );
  });

  test('GREEN: one file named twice (two scans reached it) is not a duplicate; groups sort by number, not text', () => {
    assert.deepEqual(
      duplicateMigrationNumbers([
        'services/platform/migrations/0021_a.sql',
        'services\\platform\\migrations\\0021_a.sql',
      ]),
      [],
    );
    const dups = duplicateMigrationNumbers([
      'd/100_a.sql', 'd/0100_b.sql',
      'd/9_a.sql', 'd/0009_b.sql',
    ]);
    assert.deepEqual(dups.map((g) => g.number), ['0009', '0100']);
  });

  test('GREEN: distinct numbers, the same number in two DIFFERENT directories, and Windows separators', () => {
    assert.deepEqual(
      duplicateMigrationNumbers([
        'services/platform/migrations/0021_a.sql',
        'services/platform/migrations/0022_b.sql',
        'services/subscriptiontracker-api/migrations/0021_c.sql',
        'services\\platform\\migrations\\0023_d.sql',
      ]),
      [],
    );
  });

  /** A copy of the real migration sets and their wrangler configs, and a runner of the REAL guard over it. */
  const copyTree = () => {
    const root = mkdtempSync(join(tmpdir(), 'mignum-'));
    for (const rel of ['services/platform', 'services/subscriptiontracker-api']) {
      cpSync(join(REPO, rel, 'migrations'), join(root, rel, 'migrations'), { recursive: true });
      cpSync(join(REPO, rel, 'wrangler.jsonc'), join(root, rel, 'wrangler.jsonc'));
    }
    cpSync(join(REPO, 'tooling', 'bricks'), join(root, 'tooling', 'bricks'), {
      recursive: true,
      filter: (src) => !/node_modules/.test(src),
    });
    const run = () => spawnSync(process.execPath, [join(REPO, 'tooling/ci/check-migrations.mjs')], { cwd: root, encoding: 'utf8' });
    return { root, run };
  };

  test('🔴 the REAL guard, on a copy of the real migrations: green as the tree is, red with a second 0001', () => {
    const { root, run } = copyTree();
    try {
      const green = run();
      assert.equal(green.status, 0, green.stdout + green.stderr);
      writeFileSync(join(root, 'services/platform/migrations/0001_second.sql'), 'CREATE TABLE IF NOT EXISTS x (a TEXT);\n');
      const red = run();
      assert.equal(red.status, 1, red.stdout + red.stderr);
      assert.match(red.stderr, /migration number 0001 is claimed by 2 files/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 the REAL guard: `1_second.sql` beside `0001_*.sql` is the same number 1, and is refused', () => {
    const { root, run } = copyTree();
    try {
      writeFileSync(join(root, 'services/platform/migrations/1_second.sql'), 'CREATE TABLE IF NOT EXISTS x (a TEXT);\n');
      const red = run();
      assert.equal(red.status, 1, red.stdout + red.stderr);
      assert.match(red.stderr, /services\/platform\/migrations: migration number 0001 is claimed by 2 files \(0001_[^,]+\.sql, 1_second\.sql\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 the REAL guard reads each config\'s DECLARED migrations_dir, not only directories named `migrations`', () => {
    const { root, run } = copyTree();
    try {
      // A second database on the platform Worker whose migrations live in `schema-extra/`.
      const cfg = join(root, 'services/platform/wrangler.jsonc');
      const text = readFileSync(cfg, 'utf8');
      const at = text.indexOf('"d1_databases": [');
      assert.notEqual(at, -1, 'services/platform/wrangler.jsonc no longer declares d1_databases — this fixture is reading the wrong thing');
      const cut = at + '"d1_databases": ['.length;
      writeFileSync(
        cfg,
        `${text.slice(0, cut)}\n    { "binding": "EXTRA_DB", "database_name": "extra_db", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "schema-extra" },${text.slice(cut)}`,
      );
      mkdirSync(join(root, 'services/platform/schema-extra'));
      writeFileSync(join(root, 'services/platform/schema-extra/0001_a.sql'), 'CREATE TABLE IF NOT EXISTS a (x TEXT);\n');
      const green = run();
      assert.equal(green.status, 0, green.stdout + green.stderr);
      assert.match(green.stdout, /migration file\(s\) clean/);

      // The duplicate and the destructive statement are both in the declared directory, and both are seen.
      writeFileSync(join(root, 'services/platform/schema-extra/01_b.sql'), 'DROP TABLE a;\n');
      const red = run();
      assert.equal(red.status, 1, red.stdout + red.stderr);
      assert.match(red.stderr, /services\/platform\/schema-extra: migration number 0001 is claimed by 2 files \(0001_a\.sql, 01_b\.sql\)/);
      assert.match(red.stderr, /services\/platform\/schema-extra\/01_b\.sql:1 {2}BANNED DROP TABLE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('🔴 the REAL guard: a declared migrations_dir that does not exist is COVERAGE LOST (exit 2), never green', () => {
    const { root, run } = copyTree();
    try {
      const cfg = join(root, 'services/platform/wrangler.jsonc');
      const text = readFileSync(cfg, 'utf8');
      const cut = text.indexOf('"d1_databases": [') + '"d1_databases": ['.length;
      writeFileSync(cfg, `${text.slice(0, cut)}\n    { "binding": "GONE_DB", "database_name": "gone", "database_id": "x", "migrations_dir": "no-such-dir" },${text.slice(cut)}`);
      const r = run();
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /COVERAGE LOST — services\/platform\/wrangler\.jsonc declares migrations_dir services\/platform\/no-such-dir, which is not a directory/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
