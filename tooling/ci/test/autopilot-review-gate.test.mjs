// autopilot-review-gate.test.mjs — which PRs need an independent review
// (tooling/autopilot/review-paths.mjs + review-paths.json) and the workflow that labels
// them (.github/workflows/review-gate.yml). Lane autopilot-reviews,
// row O-REVIEWS-DEPEND-ON-THE-LAPTOP.
//
// Run:  node --test "tooling/ci/test/autopilot-review-gate.test.mjs"
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  test('🔴 one REAL tracked file from each directory the review of #1171 found unclassed is classed (finding 3)', () => {
    const real = {
      money: ['services/platform/src/lib/receipts/apple.ts', 'services/platform/src/lib/receipts/google.ts', 'services/platform/src/lib/receipts/verifiers.ts', 'packages/core/lib/src/money/money.dart', 'packages/core/lib/src/money/fx_rates.dart'],
      auth: ['services/platform/src/lib/token-crypto.ts', 'services/platform/src/lib/provider-revoke.ts'],
      'user-data': ['services/platform/src/backup/dump.ts', 'services/platform/src/adapters/mail/resend.ts'],
      api: ['services/platform/src/index.ts', 'services/platform/src/lib/body.ts', 'services/platform/src/lib/d1.ts', 'services/platform/src/lib/request-log.ts', 'services/platform/src/scheduled.ts', 'services/platform/src/backup/index.ts', 'services/edge-shield/src/index.ts', 'services/platform/migrations/0001_entitlements.sql'],
    };
    for (const [cls, files] of Object.entries(real)) {
      for (const f of files) {
        assert.ok(existsSync(join(ROOT, f)), `${f} is not a real file any more: re-point this control at its successor`);
        assert.ok(classify([f]).classes.includes(cls), `${f} should be ${cls}, got ${classify([f]).classes.join(',') || 'nothing'}`);
      }
    }
    assert.ok(classify(['services/platform/queries/x.sql']).classes.includes('api'), 'Worker queries are api');
  });
  // The brick's backend template: `{{/needs_backend}}` holds a `/`, so the path is the REAL tracked one, never hand-typed.
  const BRICK_API = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';
  test('🔴 the Worker configs, the edge rate-limit rule and the brick backend template are classed (round 2 of #1171, finding 1)', () => {
    const real = {
      'services/platform/wrangler.jsonc': ['api', 'auth'],
      'services/edge-shield/wrangler.jsonc': ['api'],
      'tooling/edge-ratelimit-rule.json': ['auth'],
      'tooling/ops/edge-ratelimit-rule.mjs': ['auth'],
      [`${BRICK_API}/src/middleware/auth.ts`]: ['auth', 'api'],
      [`${BRICK_API}/src/routes/account.ts`]: ['api'],
    };
    for (const [f, classes] of Object.entries(real)) {
      assert.ok(existsSync(join(ROOT, f)), `${f} is not a real file any more: re-point this control at its successor`);
      for (const cls of classes) assert.ok(classify([f]).classes.includes(cls), `${f} should be ${cls}, got ${classify([f]).classes.join(',') || 'nothing'}`);
    }
  });
  // NOT_REVIEWED: what may sit under services/ or the brick's *-api template OUTSIDE every class. Each entry says why.
  const NOT_REVIEWED = [
    ['**/test/**', 'a test changes no deployed behaviour; the code it tests is classed'],
    ['**/README.md', 'prose'],
    // A dependency bump is not an auth, money, user-data or API change in the sense of the owner rule of 2026-09-29;
    // supply-chain risk is held by osv-scanner and CI, and classing these would queue every Dependabot bump behind the
    // reviewer and stall keeping deps current (lead ruling on #1171 round 2, item 2).
    ['**/package.json', 'dependency manifest: osv-scanner and CI hold it'],
    ['**/package-lock.json', 'lockfile: osv-scanner and CI hold it'],
    ['**/tsconfig.json', 'type-check config, no runtime effect'],
    ['**/vitest.config.ts', 'test-runner config, no runtime effect'],
    ['**/.dev.vars.example', 'a local-dev example, never deployed'],
  ].map(([g]) => globToRegExp(g));
  test('🔴 every TRACKED file under services/ and the brick *-api template is classed or on NOT_REVIEWED', () => {
    const tracked = execFileSync('git', ['ls-files', '-z', '--', 'services', `${BRICK_API}`], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
    assert.ok(tracked.some((f) => f.startsWith('services/platform/')), 'the sweep read services/');
    assert.ok(tracked.some((f) => f.startsWith(`${BRICK_API}/`)), 'the sweep read the brick template');
    const unclassed = tracked.filter((f) => !classify([f]).classes.length && !NOT_REVIEWED.some((r) => r.test(f)));
    assert.deepEqual(unclassed, [], `unclassed and not on NOT_REVIEWED: ${unclassed.join(', ')}`);
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
  test('🔴 the synchronize case runs its own step WITH `--synchronize` (stale verdict labels are removed on a new head)', () => {
    const steps = WF.split(/\n(?=\s+- name:)/);
    const sync = steps.filter((st) => /if: github\.event\.action == 'synchronize'/.test(st));
    assert.equal(sync.length, 1, 'exactly one step is chosen on synchronize');
    assert.match(sync[0], /run: node tooling\/autopilot\/review-paths\.mjs --pr "\$PR_NUMBER" --synchronize\s*$/);
    const other = steps.filter((st) => /if: github\.event\.action != 'synchronize'/.test(st));
    assert.equal(other.length, 1);
    assert.doesNotMatch(other[0], /--synchronize/);
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
