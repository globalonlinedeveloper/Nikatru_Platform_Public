// ─────────────────────────────────────────────────────────────────────────────
// web-cache-policy.test.mjs — assert-web-cache-policy.mjs must be able to FAIL.
//
// 🔴 THE REAL-TREE RUN CAME FIRST. Eight mutations against a full COPY of this
// repository, 2026-08-03, all eight caught and restored byte-identically:
//
//   1. apps/subly/web/_headers deleted ⇒ exit 1.
//   2. `/flutter_bootstrap.js` given `max-age=3600, must-revalidate` ⇒ exit 1.
//      This is the case the requirement is named after, and the message says
//      why `must-revalidate` beside a long max-age is not a revalidation.
//   3. the `/index.html` rule removed ⇒ exit 1.
//   4. the rules COMMENTED OUT ⇒ exit 1. Prose about caching is not a policy —
//      the same shape as a commented-out build step keeping a guard green.
//   5. the BRICK template's _headers deleted ⇒ exit 1. That is the file whose
//      absence reaches every future app.
//   6. the brick web path broken in the guard ⇒ COVERAGE LOST.
//   7. a single `/*` rule with `max-age=0` covering all three entry points ⇒
//      exit 0. The guard resolves wildcards; it does not demand a spelling.
//   8. `assets/*` staying `immutable` ⇒ exit 0. Hashed output is the opposite
//      case and must never fire, or the guard is switched off within a day.
//
// ⚠️ The stage document's live measurement (`max-age=14400` on
// flutter_bootstrap.js, 2026-07-29) is UNVERIFIED and is motivation only.
// Every assertion here is against the DECLARED file, so it fails offline.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-web-cache-policy.mjs');
const BRICK_WEB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/web';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-cache-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const GOOD = `# a real policy
/
  Cache-Control: public, max-age=0, must-revalidate
/index.html
  Cache-Control: public, max-age=0, must-revalidate
/flutter_bootstrap.js
  Cache-Control: public, max-age=0, must-revalidate
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

function fixture({ app = GOOD, brick = GOOD } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, 'apps', 'subly', 'web'), { recursive: true });
  mkdirSync(join(root, BRICK_WEB), { recursive: true });
  writeFileSync(join(root, 'apps', 'subly', 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, BRICK_WEB, 'index.html'), '<html></html>');
  if (app !== null) writeFileSync(join(root, 'apps', 'subly', 'web', '_headers'), app);
  if (brick !== null) writeFileSync(join(root, BRICK_WEB, '_headers'), brick);
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('assert-web-cache-policy', () => {
  test('passes when every web output declares a revalidating entry-point policy', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /2 web output directory\(ies\)/);
  });

  test('FAILS when an app web directory has no _headers at all', () => {
    const { code, out } = run(fixture({ app: null }));
    assert.equal(code, 1);
    assert.match(out, /apps\/subly\/web\/_headers does not exist/);
    assert.match(out, /NOTHING in this repository chooses a cache policy/);
  });

  test('FAILS when the BRICK template has no _headers — the defect every future app inherits', () => {
    const { code, out } = run(fixture({ brick: null }));
    assert.equal(code, 1);
    assert.match(out, /__brick__/);
  });

  test('FAILS when _headers is empty', () => {
    const { code, out } = run(fixture({ app: '   \n' }));
    assert.equal(code, 1);
    assert.match(out, /is empty/);
  });

  test('FAILS when the file is only comments — prose about caching is not a policy', () => {
    const { code, out } = run(fixture({ app: '# we cache the entry points for zero seconds\n# /index.html max-age=0\n' }));
    assert.equal(code, 1);
    assert.match(out, /declares no rule at all outside comments/);
  });

  // The case the requirement is named after.
  test('FAILS when flutter_bootstrap.js carries a real max-age', () => {
    const { code, out } = run(fixture({ app: GOOD.replace('/flutter_bootstrap.js\n  Cache-Control: public, max-age=0, must-revalidate', '/flutter_bootstrap.js\n  Cache-Control: public, max-age=14400') }));
    assert.equal(code, 1);
    assert.match(out, /covering "\/flutter_bootstrap\.js"\) is "public, max-age=14400"/);
    assert.match(out, /governs what happens once the response is STALE/);
  });

  test('FAILS when an entry point has no rule covering it', () => {
    const { code, out } = run(fixture({ app: GOOD.replace('/index.html\n  Cache-Control: public, max-age=0, must-revalidate\n', '') }));
    assert.equal(code, 1);
    assert.match(out, /no rule covering "\/index\.html"/);
  });

  test('FAILS when a rule exists but sets no Cache-Control at all', () => {
    const { code, out } = run(fixture({ app: '/\n  X-Frame-Options: DENY\n/index.html\n  X-Frame-Options: DENY\n/flutter_bootstrap.js\n  X-Frame-Options: DENY\n' }));
    assert.equal(code, 1);
    assert.match(out, /sets no Cache-Control/);
  });

  test('`must-revalidate` ALONE, with a long max-age, is not a revalidation', () => {
    const { code, out } = run(fixture({ app: '/*\n  Cache-Control: public, max-age=86400, must-revalidate\n' }));
    assert.equal(code, 1);
    assert.match(out, /must be revalidated/);
  });

  // ── what must NOT fire ────────────────────────────────────────────────────
  test('a single `/*` rule with max-age=0 covers every entry point and PASSES', () => {
    const { code, out } = run(fixture({ app: '/*\n  Cache-Control: public, max-age=0, must-revalidate\n' }));
    assert.equal(code, 0, out);
  });

  test('`no-store` and `no-cache` are accepted spellings', () => {
    const { code, out } = run(fixture({ app: '/*\n  Cache-Control: no-store\n' }));
    assert.equal(code, 0, out);
  });

  test('hashed output under assets/ staying immutable does NOT fire', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
  });

  test('an exact rule wins over a wildcard that would also match', () => {
    const app = `/*
  Cache-Control: public, max-age=31536000, immutable
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/flutter_bootstrap.js
  Cache-Control: no-cache
`;
    const { code, out } = run(fixture({ app }));
    assert.equal(code, 0, out);
  });

  test('the LONGEST matching wildcard is the one that governs', () => {
    const app = `/*
  Cache-Control: public, max-age=0, must-revalidate
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
    const { code, out } = run(fixture({ app }));
    assert.equal(code, 0, out);
  });

  // ── coverage self-check ───────────────────────────────────────────────────
  test('COVERAGE LOST when there is no web output directory anywhere', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /found no web output directory/);
  });

  test('COVERAGE LOST when the brick template is not in the scan', () => {
    const root = join(TMP, `nobrick${seq++}`);
    mkdirSync(join(root, 'apps', 'subly', 'web'), { recursive: true });
    writeFileSync(join(root, 'apps', 'subly', 'web', '_headers'), GOOD);
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /is not in the scan/);
    assert.match(out, /one wrong line/);
  });
});
