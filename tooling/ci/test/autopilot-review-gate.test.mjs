// autopilot-review-gate.test.mjs — which PRs need an independent review
// (tooling/autopilot/review-paths.mjs + review-paths.json) and the workflow that labels
// them (.github/workflows/review-gate.yml). Lane autopilot-reviews,
// row O-REVIEWS-DEPEND-ON-THE-LAPTOP.
//
// Run:  node --test "tooling/ci/test/autopilot-review-gate.test.mjs"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, decideLabels, globToRegExp, CLASSES } from '../../autopilot/review-paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'tooling/autopilot/review-paths.mjs');
const WF = readFileSync(join(ROOT, '.github/workflows/review-gate.yml'), 'utf8');

describe('the classes', () => {
  const one = {
    auth: ['packages/auth_supabase/lib/src/session_store.dart', 'services/platform/src/routes/native-auth.ts', 'apps/subscriptiontracker/lib/features/auth/turnstile_gate.dart'],
    money: ['packages/purchases/lib/src/chassis_billing.dart', 'services/platform/src/routes/checkout.ts', 'services/platform/src/lib/mor/grant.ts'],
    'user-data': ['services/platform/migrations/0024_new.sql', 'services/_shared/src/erasure.ts', 'apps/subscriptiontracker/lib/features/settings/data_export_screen.dart'],
    api: ['services/subscriptiontracker-api/src/routes/items.ts', 'contracts/entitlement/bundle.json', 'services/platform/src/routes/calendar.ts'],
  };
  const labelled = (cls) => {
    for (const f of one[cls]) {
      assert.ok(classify([f]).classes.includes(cls), `${f} should be ${cls}`);
      assert.deepEqual(decideLabels({ files: [f] }).add, ['needs-review'], f);
    }
  };
  test('🔴 an auth fixture is labelled needs-review', () => labelled('auth'));
  test('🔴 a money fixture is labelled needs-review', () => labelled('money'));
  test('🔴 a user-data fixture is labelled needs-review', () => labelled('user-data'));
  test('🔴 an api fixture is labelled needs-review', () => labelled('api'));
  test('🔴 a docs-only (or tooling-only) PR is NOT labelled', () => {
    for (const files of [['docs/ci/README.md', 'docs/autopilot/contract.md'], ['tooling/ci/land-next.mjs', 'tooling/ci/test/consent-anon-id.test.mjs'], ['apps/subscriptiontracker/lib/features/home/home_screen.dart']]) {
      const d = decideLabels({ files });
      assert.deepEqual(d.add, [], files.join(','));
      assert.match(d.why, /no review class/);
    }
  });
  test('the four classes exist and each glob compiles; `subscription` alone is not money', () => {
    assert.deepEqual(Object.keys(CLASSES).sort(), ['api', 'auth', 'money', 'user-data']);
    for (const globs of Object.values(CLASSES)) for (const g of globs) assert.ok(globToRegExp(g) instanceof RegExp, g);
    assert.deepEqual(classify(['apps/subscriptiontracker/lib/main.dart']).classes, []);
    assert.equal(globToRegExp('a/**/b.ts').test('a/b.ts'), true);
    assert.equal(globToRegExp('a/*/b.ts').test('a/x/y/b.ts'), false);
  });
});

describe('the label decision', () => {
  test('🔴 an unreadable or capped file list → needs-review (fail closed)', () => {
    assert.deepEqual(decideLabels({ files: null }).add, ['needs-review']);
    assert.deepEqual(decideLabels({ files: ['docs/x.md'], complete: false }).add, ['needs-review']);
  });
  test('🔴 synchronize removes review:approve and review:changes (a verdict is pinned to its head)', () => {
    const d = decideLabels({ files: ['docs/x.md'], labels: ['needs-review', 'review:approve', 'review:changes', 'land-ok'], synchronize: true });
    assert.deepEqual(d.remove, ['review:approve', 'review:changes']);
    assert.deepEqual(decideLabels({ files: ['docs/x.md'], labels: ['review:approve'] }).remove, [], 'not on opened/reopened');
  });
  test('🔴 needs-review is NEVER removed here, and never added twice', () => {
    const d = decideLabels({ files: ['docs/x.md'], labels: ['needs-review'], synchronize: true });
    assert.ok(!d.remove.includes('needs-review'));
    assert.deepEqual(decideLabels({ files: ['contracts/x.json'], labels: ['needs-review'] }).add, []);
  });
  test('the CLI decides from a file list and writes nothing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rg-'));
    try {
      writeFileSync(join(tmp, 'f.json'), JSON.stringify(['services/platform/src/routes/money.ts']));
      const r = spawnSync(process.execPath, [SCRIPT, '--files', join(tmp, 'f.json'), '--labels', 'review:changes', '--synchronize'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /money/);
      assert.match(r.stdout, /add: needs-review/);
      assert.match(r.stdout, /remove: review:changes/);
      const u = spawnSync(process.execPath, [SCRIPT, '--pr', '1'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
      assert.equal(u.status, 2, 'no token, no repo → usage');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('.github/workflows/review-gate.yml never runs the PR’s code', () => {
  test('pull_request_target on opened, synchronize, reopened, ready_for_review, with the zizmor ignore and a why', () => {
    assert.match(WF, /# zizmor: ignore\[dangerous-triggers\]\n\s+# why:[^\n]+\n(?:\s+#[^\n]*\n)*\s+pull_request_target:\n\s+types: \[opened, synchronize, reopened, ready_for_review\]/);
  });
  test('🔴 the checkout names main and persists no credential', () => {
    assert.match(WF, /uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+\n\s+with:\n\s+persist-credentials: false\n\s+ref: main\n/);
    assert.doesNotMatch(WF, /ref: \$\{\{/);
  });
  test('🔴 nothing from the event reaches a run: except the PR number', () => {
    const exprs = [...WF.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);
    const allowed = new Set(['github.token', 'github.event.pull_request.number']);
    for (const e of exprs) assert.ok(allowed.has(e), `expression ${e} reaches the workflow`);
    for (const line of WF.split('\n').filter((l) => /^\s+run:/.test(l))) assert.doesNotMatch(line, /\$\{\{/, line);
  });
  test('least privilege: permissions {} at the top; the job holds pull-requests: write and contents: read, each with a why', () => {
    assert.match(WF, /^permissions: \{\}$/m);
    assert.match(WF, /# why:[^\n]+\n\s+pull-requests: write\n\s+# why:[^\n]+\n\s+contents: read\n/);
    assert.doesNotMatch(WF, /^\s+(issues|actions|checks|statuses): write/m);
  });
});
