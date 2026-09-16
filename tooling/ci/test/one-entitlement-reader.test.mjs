// ─────────────────────────────────────────────────────────────────────────────
// one-entitlement-reader.test.mjs — assert-one-entitlement-reader.mjs must be
// able to FAIL, in every direction it claims to look.
//
// ⚠️ REAL-TREE MUTATIONS FIRST (2026-09-10, on the real worktree, green control
// before, restore re-verified green after — recorded in PR #617's body):
//   OR-A  the pre-move private reader restored in the per-app route  -> exit 1
//         (limb 1: an undeclared `entitlements` read; limb 2: `is_pro: isPro`)
//   OR-B  a second `SELECT … FROM entitlements` added to receipts.ts  -> exit 1
//         (limb 1: count 2, declared 1)
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-one-entitlement-reader.mjs');

const READER = 'services/_shared/src/entitlement-read.ts';
const API_ROUTE = 'services/subscriptiontracker-api/src/routes/entitlements.ts';
const PLATFORM_ROUTE = 'services/platform/src/routes/entitlements.ts';
const RECEIPTS = 'services/platform/src/routes/receipts.ts';
const CANCEL = 'services/platform/src/routes/cancellation.ts';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-oer-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** A throwaway copy of the REAL subject trees — copied, never authored.
 *  Narrowed to the three src/ trees: copying services/ whole drags node_modules. */
const DIRS = ['services/_shared/src', 'services/platform/src', 'services/subscriptiontracker-api/src'];
function tree(mutate = () => {}) {
  const dir = join(TMP, `t${seq++}`);
  for (const rel of DIRS) {
    const from = join(REPO, rel);
    if (!existsSync(from)) continue;
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    cpSync(from, join(dir, rel), { recursive: true });
  }
  mutate(dir);
  return dir;
}
function run(dir) {
  const r = spawnSync(process.execPath, [GUARD, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
function editText(dir, rel, fn) {
  const p = join(dir, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, `the mutation of ${rel} changed nothing — the anchor moved`);
  writeFileSync(p, after);
}

describe('assert-one-entitlement-reader — one reader, mounted everywhere', () => {
  test('GREEN CONTROL — the real tree passes and names what it counted', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /census: \d+ money-table read\(s\) across \d+ file\(s\), every one declared/);
    assert.match(r.out, /2 carrier\(s\) import and call readProductEntitlement/);
  });

  test('OR-A — the private reader restored in the per-app route is a SECOND READER', () => {
    const r = run(
      tree((d) =>
        editText(d, API_ROUTE, (s) =>
          s.replace(
            "export default app;",
            `const rows = await allRows(c.env.PLATFORM_DB.prepare(\`SELECT entitlement FROM entitlements WHERE user_id = ?\`).bind(userId));
const isPro = rows.length > 0;
export const legacy = { is_pro: isPro };
export default app;`,
          ),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /carries 1 read\(s\) of `entitlements`|is NOT declared/);
    assert.match(r.out, /is_pro: isPro/);
  });

  test('OR-B — a second `FROM entitlements` in a declared route is count drift', () => {
    const r = run(
      tree((d) =>
        editText(d, RECEIPTS, (s) => `${s}\nexport const second = 'SELECT 1 FROM entitlements LIMIT 1';\n`),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /receipts\.ts carries 2 read\(s\) of `entitlements`; DECLARED says 1/);
  });

  test('a money-table read in a file nobody declared is refused, naming the file', () => {
    const r = run(
      tree((d) => {
        writeFileSync(
          join(d, 'services/platform/src/lib/stray.ts'),
          "export const q = 'SELECT user_id FROM bundle_grants WHERE user_id = ?';\n",
        );
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lib\/stray\.ts reads a money table \(bundle_grants×1\) and is NOT declared/);
  });

  test('a declared read that VANISHED is a stale row, not a pass', () => {
    const r = run(tree((d) => rmSync(join(d, CANCEL))));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /DECLARED names services\/platform\/src\/routes\/cancellation\.ts \(lookup\)[^\n]*the file does not exist/);
  });

  test('the bundle branch dropped from the reader is caught twice — census AND union', () => {
    const r = run(
      tree((d) =>
        editText(d, READER, (s) => s.replace(/\bFROM bundle_grants g\b/, 'FROM bundle_grants_gone g')),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /entitlement-read\.ts carries 1 read\(s\) of `bundle_grants`; DECLARED says 2/);
  });

  test('a reader whose union is no longer `appPro || bundlePro` is refused', () => {
    const r = run(
      tree((d) => editText(d, READER, (s) => s.replace('is_pro: appPro || bundlePro,', 'is_pro: appPro,'))),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the union is not a union/);
  });

  test('a carrier that stops importing the reader is refused', () => {
    const r = run(
      tree((d) =>
        editText(d, API_ROUTE, (s) =>
          s.replace(/import \{[^}]*\} from '\.\.\/\.\.\/\.\.\/_shared\/src\/entitlement-read';/, 'const readProductEntitlement = async () => ({ kind: "unknown_product" as const });'),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /entitlements\.ts does not import from services\/_shared\/src\/entitlement-read\.ts/);
  });

  test('a carrier that imports the reader and never CALLS it is refused', () => {
    const r = run(
      tree((d) =>
        editText(d, PLATFORM_ROUTE, (s) =>
          s.replace('const read = await readProductEntitlement(', 'const read = await (async (..._a: unknown[]) => ({ kind: "unknown_product" as const }))('),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /platform\/src\/routes\/entitlements\.ts imports the reader and never CALLS readProductEntitlement/);
  });

  test('a second decision in a carrier — `is_pro: true` — is refused even with the reader mounted', () => {
    const r = run(
      tree((d) => editText(d, PLATFORM_ROUTE, (s) => s.replace('is_pro: read.is_pro,', 'is_pro: true,'))),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /spells `is_pro: true` — an access decision outside/);
  });

  test('COVERAGE LOST — the reader file deleted', () => {
    const r = run(tree((d) => rmSync(join(d, READER))));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — services\/_shared\/src\/entitlement-read\.ts does not exist/);
  });

  test('COVERAGE LOST — no services/ at all', () => {
    const dir = join(TMP, `t${seq++}`);
    mkdirSync(dir, { recursive: true });
    const r = run(dir);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — services\/ does not exist/);
  });

  test('COVERAGE LOST — only one carrier found', () => {
    const r = run(tree((d) => rmSync(join(d, 'services/subscriptiontracker-api'), { recursive: true })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — 1 carrier\(s\) matched/);
  });
});
