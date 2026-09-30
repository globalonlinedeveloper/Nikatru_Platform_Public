// ─────────────────────────────────────────────────────────────────────────────
// migration-numbers.test.mjs — tooling/ci/migration-numbers.mjs, the limb
// tooling/ci/check-migrations.mjs runs (⏱ 2026-09-30, ADR no.NNN, third review
// of #1070): one migration number per migrations directory.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { duplicateMigrationNumbers } from '../migration-numbers.mjs';

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

  test('🔴 the REAL guard, on a copy of the real migrations: green as the tree is, red with a second 0021', () => {
    const root = mkdtempSync(join(tmpdir(), 'mignum-'));
    try {
      for (const rel of ['services/platform', 'services/subscriptiontracker-api']) {
        cpSync(join(REPO, rel, 'migrations'), join(root, rel, 'migrations'), { recursive: true });
        cpSync(join(REPO, rel, 'wrangler.jsonc'), join(root, rel, 'wrangler.jsonc'));
      }
      cpSync(join(REPO, 'tooling', 'bricks'), join(root, 'tooling', 'bricks'), {
        recursive: true,
        filter: (src) => !/node_modules/.test(src),
      });
      const run = () => spawnSync(process.execPath, [join(REPO, 'tooling/ci/check-migrations.mjs')], { cwd: root, encoding: 'utf8' });
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
});
