// ─────────────────────────────────────────────────────────────────────────────
// no-secret-defines.test.mjs — assert-no-secret-defines.mjs must be able to FAIL.
//
// 🔴 THE REAL-TREE RUN CAME FIRST. Eight mutations against a full COPY of this
// repository, 2026-08-03, all eight caught and all eight restored
// byte-identically with the tree green again:
//
//   1. `--dart-define=PADDLE_API_KEY=${{ secrets.PADDLE_API_KEY }}` added to
//      deploy-web.yml's real release build ⇒ exit 1 naming the file and line.
//   2. `--dart-define=APP_ENV=production` DELETED while its entry stayed ⇒
//      exit 1. This is the direction guards forget, and it is why a name cannot
//      be pre-approved.
//   3. an entry's `residual` blanked ⇒ exit 1.
//   4. `inputs` emptied ⇒ COVERAGE LOST, not eight loud first-direction
//      failures that look like the guard working.
//   5. the register deleted ⇒ COVERAGE LOST.
//   6. THE REACH SELF-CHECK: the shared parser's job-key matcher narrowed so
//      hyphenated jobs (`deploy-web`!) drop out ⇒ COVERAGE LOST naming
//      APP_ENV and APP_VERSION as present in the text and absent from the
//      parsed scan. A COUNT-vs-count check was written here first and DELETED:
//      every define in this tree sits alone on its own continuation line, so
//      folded and unfolded counts are always equal and it had no failing input.
//   7. a COMMENT mentioning a `--dart-define` ⇒ exit 0. `deploy-workers.yml`
//      really carries one, and counting it would demand an entry for a define
//      nobody passes.
//   8. `--dart-define-from-file` ⇒ exit 0 with the gap PRINTED — the guard can
//      see the filename and not the keys, and says so rather than implying
//      coverage.
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
const GUARD = join(CI_DIR, 'assert-no-secret-defines.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-defines-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

function fixture({ workflows, register }) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    writeFileSync(join(root, '.github', 'workflows', name), body);
  }
  if (register !== null) {
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'publishable-inputs.json'), JSON.stringify(register, null, 2));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** The real shape: a folded `run: >` release build. */
const lane = (defines) => `name: Deploy Web
on:
  push:
    branches: [main]

jobs:
  deploy-web:
    runs-on: ubuntu-24.04
    steps:
      - name: Build web
        run: >
          flutter build web --release
${defines.map((d) => `          --dart-define=${d}\n`).join('')}`;

const entry = (n) => [n, { reason: `${n} may be read by anyone.`, residual: `${n} still costs something.` }];
const reg = (names) => ({ inputs: Object.fromEntries(names.map(entry)) });

describe('assert-no-secret-defines', () => {
  test('passes when the shipped set and the declared set are the same set', () => {
    const root = fixture({
      workflows: { 'deploy-web.yml': lane(['APP_ENV=production', 'GLITCHTIP_DSN=${{ secrets.GLITCHTIP_DSN }}']) },
      register: reg(['APP_ENV', 'GLITCHTIP_DSN']),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /set equality holds/);
  });

  test('FAILS on a define no entry covers', () => {
    const root = fixture({
      workflows: { 'deploy-web.yml': lane(['APP_ENV=production', 'PADDLE_API_KEY=${{ secrets.PADDLE_API_KEY }}']) },
      register: reg(['APP_ENV']),
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /PADDLE_API_KEY is compiled into a build/);
    assert.match(out, /describes where the value was KEPT, not where it ends up/);
  });

  // ── the direction guards forget ───────────────────────────────────────────
  test('FAILS on an entry no workflow passes — a name cannot be pre-approved', () => {
    const root = fixture({
      workflows: { 'deploy-web.yml': lane(['APP_ENV=production']) },
      register: reg(['APP_ENV', 'STRIPE_SECRET_KEY']),
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /declares "STRIPE_SECRET_KEY" and no workflow passes it/);
    assert.match(out, /permission granted before the question is asked/);
  });

  test('FAILS on an entry with no reason', () => {
    const root = fixture({
      workflows: { 'deploy-web.yml': lane(['APP_ENV=production']) },
      register: { inputs: { APP_ENV: { reason: '', residual: 'x' } } },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /has no `reason`/);
  });

  test('FAILS on an entry with no residual', () => {
    const root = fixture({
      workflows: { 'deploy-web.yml': lane(['APP_ENV=production']) },
      register: { inputs: { APP_ENV: { reason: 'x', residual: '   ' } } },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /has no `residual`/);
    assert.match(out, /waved through/);
  });

  // ── the fold, which is what makes the scan honest ─────────────────────────
  test('reads a FOLDED `run: >` build — the shape every release lane here uses', () => {
    const root = fixture({
      workflows: { 'deploy-web.yml': lane(['A=1', 'B=2', 'C=3', 'D=4']) },
      register: reg(['A', 'B', 'C', 'D']),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /4 `--dart-define` occurrence\(s\) over 4 distinct name\(s\)/);
  });

  test('reads a `run: |` build with shell continuations — the e2e.yml shape', () => {
    const root = fixture({
      workflows: {
        'e2e.yml': `name: E2E
on:
  schedule:
    - cron: '0 6 * * *'

jobs:
  e2e:
    runs-on: ubuntu-24.04
    steps:
      - name: Drive
        run: |
          flutter drive --target=integration_test/app_test.dart \\
            --dart-define=E2E_EMAIL="$E2E_EMAIL" \\
            --dart-define=E2E_PASSWORD="$E2E_PASSWORD"
`,
      },
      register: reg(['E2E_EMAIL', 'E2E_PASSWORD']),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /over 2 distinct name\(s\)/);
  });

  test('a COMMENT mentioning a --dart-define demands no entry', () => {
    const root = fixture({
      workflows: {
        'deploy-web.yml': lane(['APP_ENV=production']),
        'deploy-workers.yml': `name: Workers
on:
  push:
jobs:
  deploy:
    runs-on: ubuntu-24.04
    steps:
      # deploy-web.yml passes the same value as a --dart-define=LEGACY_TOKEN=x
      - run: npx wrangler deploy
`,
      },
      register: reg(['APP_ENV']),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('--dart-define-from-file PRINTS the gap rather than implying coverage', () => {
    const root = fixture({
      workflows: { 'deploy-web.yml': lane(['APP_ENV=production', 'from-file-placeholder=x']).replace('--dart-define=from-file-placeholder=x', '--dart-define-from-file=secrets.json') },
      register: reg(['APP_ENV']),
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, /dart-define-from-file/);
    assert.match(out, /does NOT cover it/);
  });

  // ── the coverage self-checks ──────────────────────────────────────────────
  test('COVERAGE LOST when the register does not exist', () => {
    const root = fixture({ workflows: { 'deploy-web.yml': lane(['APP_ENV=production']) }, register: null });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /does not exist/);
  });

  test('COVERAGE LOST when `inputs` is emptied — not a pile of first-direction failures', () => {
    const root = fixture({ workflows: { 'deploy-web.yml': lane(['APP_ENV=production']) }, register: { inputs: {} } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /declares ZERO inputs/);
  });

  test('COVERAGE LOST when the register has no `inputs` object at all', () => {
    const root = fixture({ workflows: { 'deploy-web.yml': lane(['APP_ENV=production']) }, register: { notInputs: {} } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /no `inputs` object/);
  });

  test('COVERAGE LOST when a define is in the text but outside every parsed job', () => {
    const root = fixture({
      workflows: {
        'stray.yml': `name: Stray
on:
  workflow_dispatch:

# no jobs: key at all, so the parsed set is empty while the text still carries the define
x-build: flutter build web --dart-define=APP_ENV=production
jobs:
  real:
    runs-on: ubuntu-24.04
    steps:
      - run: flutter build web --dart-define=GLITCHTIP_DSN=x
`,
      },
      register: reg(['APP_ENV', 'GLITCHTIP_DSN']),
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /appear in the workflow text and NOT in the parsed job scan/);
    assert.match(out, /APP_ENV/);
  });

  test('COVERAGE LOST when there are no workflows to read', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'publishable-inputs.json'), JSON.stringify(reg(['APP_ENV'])));
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});
