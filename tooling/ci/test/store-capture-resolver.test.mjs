// ─────────────────────────────────────────────────────────────────────────────
// store-capture-resolver.test.mjs — the failing cases for the store capture's
// stamp (tooling/e2e/app-version-stamp.mjs `captureStamp`) and for the
// `store-capture` resolver it feeds (tooling/ops/check-prod-provenance.mjs,
// declared in tooling/prod-provenance.json). Both born 2026-09-23.
//
// WHY THIS EXISTS. store-screenshots.yml drives the real app against
// production, and until 2026-09-23 it passed no APP_VERSION at all: its Linux
// job wrote two consent rows stamped `dev` (run 35818960378) that no resolver
// could attribute. The capture now stamps `cap-<run_number>-<sha7>`, DERIVED
// from the Actions default env, and the monitor accepts such a row only when a
// store-screenshots.yml run with that number exists at that sha. A narrow,
// witnessed resolver is only worth anything if it can still REFUSE, which is
// what every 🔴 case below is for.
//
// ⚠️ THE TRADE THESE CASES DO NOT CHECK. Accepting a cap row means a capture's
// residue no longer reds this monitor. That is paid for in tooling/e2e/purge.mjs
// (the capture job's always() purge deletes by anon_id AND by stamp, and
// hard-fails on an id it cannot resolve) — a different file and workflow.
//
// Every monitor case runs the REAL monitor against the REAL register through
// the offline `--rows-file` / `--runs-file` / `--capture-runs-file` fixture
// mode. Nothing here writes to production, or reads it.
//
// Run:  node --single-threaded --test tooling/ci/test/store-capture-resolver.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureStamp,
  captureStampRefusal,
  E2E_RUN_SHAPE,
  STORE_CAPTURE_SHAPE,
  REHEARSAL_SHAPE,
} from '../../e2e/app-version-stamp.mjs';
import { makeStoreCaptureResolver } from '../../ops/check-prod-provenance.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MONITOR = join(REPO, 'tooling', 'ops', 'check-prod-provenance.mjs');
const REGISTER = join(REPO, 'tooling', 'prod-provenance.json');

/** A real run of the released-build lane, so the PRIMARY resolver is live and
 *  every case below is about what happens AFTER it refuses. */
const RUNS = [{ run_number: 101, head_sha: 'e138f5be72555ab717d0391e771b40c0883d9fab' }];
/** One store-screenshots.yml run, still in progress: the ops-watch-during-capture case. */
const CAPTURE_SHA = '40c07871a2b3c4d5e6f708192a3b4c5d6e7f8091';
const CAPTURE_RUNS = [{ run_number: 57, head_sha: CAPTURE_SHA, status: 'in_progress', conclusion: null }];

/** The env every step of a store-screenshots.yml run carries by default. */
const ACTIONS_ENV = {
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_NUMBER: '57',
  GITHUB_SHA: CAPTURE_SHA,
  GITHUB_WORKFLOW_REF: 'nikatru/Nikatru_Platform_Public/.github/workflows/store-screenshots.yml@refs/heads/main',
};

/** Spawn the monitor offline. `captureRuns: null` passes no
 *  --capture-runs-file at all (the inert rule: an empty witness set). */
function run(rowsByTable, { runs = RUNS, captureRuns = CAPTURE_RUNS, root = REPO } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nikatru-store-capture-'));
  try {
    const f = (name, v) => {
      const p = join(dir, name);
      writeFileSync(p, JSON.stringify(v));
      return p;
    };
    const args = [MONITOR, '--root', root, '--rows-file', f('rows.json', rowsByTable), '--runs-file', f('runs.json', runs)];
    if (captureRuns !== null) args.push('--capture-runs-file', f('capture-runs.json', captureRuns));
    return spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const consent = (marker, n = 1) => ({ consent_artifacts: [{ marker, n }] });

// ── the stamp ───────────────────────────────────────────────────────────────
describe('captureStamp derives the stamp and refuses everything else', () => {
  test('it derives cap-57-40c0787 from a store-screenshots.yml Actions env, and ignores a local value there', () => {
    assert.equal(captureStamp(ACTIONS_ENV), 'cap-57-40c0787');
    // Inside Actions the derived value wins; a rehearsal value set in the env is never read.
    assert.equal(captureStamp({ ...ACTIONS_ENV, STORE_CAPTURE_APP_VERSION: 'rehearsal-1790000000' }), 'cap-57-40c0787');
    // GITHUB_SHA is lower-case in practice; an upper-case one still yields the lower-case shape.
    assert.equal(captureStamp({ ...ACTIONS_ENV, GITHUB_SHA: CAPTURE_SHA.toUpperCase() }), 'cap-57-40c0787');
  });

  test('🔴 outside Actions with no STORE_CAPTURE_APP_VERSION it is null, and the refusal names both variables', () => {
    assert.equal(captureStamp({}), null);
    const why = captureStampRefusal({});
    assert.match(why, /STORE_CAPTURE_APP_VERSION/);
    assert.match(why, /GITHUB_RUN_NUMBER/);
    assert.match(why, /APP_VERSION=cap-/);
  });

  test('🔴 it is null when GITHUB_WORKFLOW_REF names another workflow, even with a rehearsal value set', () => {
    // Another workflow's run number would witness nothing (or, worse, the wrong run).
    const e2e = { ...ACTIONS_ENV, GITHUB_WORKFLOW_REF: 'nikatru/Nikatru_Platform_Public/.github/workflows/e2e.yml@refs/heads/main' };
    assert.equal(captureStamp(e2e), null);
    assert.match(captureStampRefusal(e2e), /GITHUB_WORKFLOW_REF=.*e2e\.yml/);
    // 🔴 a rehearsal stamp is a LOCAL value only: inside Actions it is never accepted.
    assert.equal(captureStamp({ ...e2e, STORE_CAPTURE_APP_VERSION: 'rehearsal-1790000000' }), null);
    assert.equal(captureStamp({ ...ACTIONS_ENV, GITHUB_RUN_NUMBER: undefined, STORE_CAPTURE_APP_VERSION: 'rehearsal-1790000000' }), null);
  });

  test('🔴 locally it refuses a hand-set cap-* and `dev`, and accepts only rehearsal-<10 digits>', () => {
    // A local cap-* would borrow a real run's witness: refused.
    assert.equal(captureStamp({ STORE_CAPTURE_APP_VERSION: 'cap-57-40c0787' }), null);
    assert.match(captureStampRefusal({ STORE_CAPTURE_APP_VERSION: 'cap-57-40c0787' }), /borrow a real run's witness/);
    assert.equal(captureStamp({ STORE_CAPTURE_APP_VERSION: 'dev' }), null);
    assert.equal(captureStamp({ STORE_CAPTURE_APP_VERSION: 'rehearsal-179000000' }), null);
    assert.equal(captureStamp({ STORE_CAPTURE_APP_VERSION: 'rehearsal-1790000000' }), 'rehearsal-1790000000');
  });

  test('every stamp it can produce fits the Worker\'s 32-char bind and matches its shape', () => {
    // events.ts binds `str(body?.app_version, 32)`, which stores NULL — not a truncation — above 32.
    const widest = captureStamp({ ...ACTIONS_ENV, GITHUB_RUN_NUMBER: '999999999' });
    assert.equal(widest, 'cap-999999999-40c0787');
    assert.ok(widest.length <= 32);
    assert.match(widest, STORE_CAPTURE_SHAPE);
    assert.ok('rehearsal-9999999999'.length <= 32);
    assert.match('rehearsal-9999999999', REHEARSAL_SHAPE);
    // Ten digits is past assert-app-versioning.mjs's MAX_RUN_DIGITS: refused, never truncated.
    assert.equal(captureStamp({ ...ACTIONS_ENV, GITHUB_RUN_NUMBER: '1234567890' }), null);
  });
});

// ── the monitor NAMES a witnessed stamp, and since 2026-09-25 REFUSES it ─────
// ⏱ 2026-09-25 (capsand-b) — these two cases asserted exit 0 until today. The
// capture now reaches the sandbox Workers (docs/ci/store-screenshots.md, section
// "Backend"), so a production consent row a capture run witnesses means a
// sandbox lane wrote production: a FINDING. The resolver still has to WITNESS the
// value for the finding to name its run, which is what the second case keeps.
describe('store-capture: a witnessed cap-* consent row in production is a FINDING', () => {
  test('🔴 PP1: a cap-57-40c0787 consent row with a matching capture run exits 1, "a sandbox lane wrote production"', () => {
    const r = run(consent('cap-57-40c0787', 2));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /consent_artifacts: 2 row\(s\) — a sandbox lane wrote production: cap-57-40c0787 \(run 57\)/);
    assert.doesNotMatch(r.stdout, /second-resolver acceptance/);
  });

  test('🔴 an IN-PROGRESS capture run\'s row is a finding too, and the witness still names the run', () => {
    const r = run(consent('cap-57-40c0787'));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /a sandbox lane wrote production: cap-57-40c0787 \(run 57\)/);
    assert.match(r.stdout, /store-capture-witnessed stamp accepted: cap-57-40c0787 ← store-screenshots\.yml run 57 \(in_progress\/-\)/);
  });
});

// ── the monitor REFUSES ─────────────────────────────────────────────────────
describe('store-capture REFUSES what no capture run witnesses', () => {
  test('🔴 the wrong run number is unattributable', () => {
    const r = run(consent('cap-58-40c0787', 2));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /consent_artifacts: 2 row\(s\)/);
    assert.doesNotMatch(r.stdout, /store-capture-witnessed/);
  });

  test('🔴 the right run number at the wrong sha is unattributable', () => {
    const r = run(consent('cap-57-40c0788', 2));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /consent_artifacts: 2 row\(s\)/);
    assert.doesNotMatch(r.stdout, /store-capture-witnessed/);
  });

  test('🔴 `dev` is still unattributable with capture runs present', () => {
    const r = run(consent('dev', 2));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /consent_artifacts: 2 row\(s\)/);
    assert.match(r.stderr, /not the shape a shipped build produces/);
  });

  test('🔴 an EMPTY capture-run set refuses every cap value (fail-closed), given or by the inert rule', () => {
    const empty = run(consent('cap-57-40c0787', 2), { captureRuns: [] });
    assert.equal(empty.status, 1, empty.stdout + empty.stderr);
    assert.match(empty.stderr, /consent_artifacts: 2 row\(s\)/);
    // No --capture-runs-file beside a --runs-file: the capture set is inert, never live, never invented.
    const inert = run(consent('cap-57-40c0787', 2), { captureRuns: null });
    assert.equal(inert.status, 1, inert.stdout + inert.stderr);
    assert.match(inert.stderr, /consent_artifacts: 2 row\(s\)/);
    const fn = makeStoreCaptureResolver([]);
    assert.match(fn('cap-57-40c0787'), /witnessed by nothing/);
  });

  test('🔴 an e2e-* stamp is not a store capture\'s (unit, via the export)', () => {
    const fn = makeStoreCaptureResolver(CAPTURE_RUNS);
    assert.match(fn('e2e-101-e138f5b'), /is not the shape store-screenshots\.yml stamps/);
    assert.match(fn(''), /no app_version at all/);
    assert.match(fn(null), /no app_version at all/);
  });

  test('🔴 a cap-* stamp is not the nightly\'s: the e2e-run shape refuses it', () => {
    assert.doesNotMatch('cap-57-40c0787', E2E_RUN_SHAPE);
    // With no capture run to witness it, the e2e-run resolver alone must not take it.
    const r = run(consent('cap-57-40c0787'), { captureRuns: [] });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /accepted by the narrower `e2e-run`/);
  });

  test('🔴 a rehearsal-* stamp is deliberately unwitnessable', () => {
    const noted = [];
    const fn = makeStoreCaptureResolver(CAPTURE_RUNS, (n) => noted.push(n));
    assert.match(fn('rehearsal-1790000000'), /is not the shape store-screenshots\.yml stamps/);
    assert.deepEqual(noted, []);
    const r = run(consent('rehearsal-1790000000', 3));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /consent_artifacts: 3 row\(s\)/);
  });

  test('🔴 A CAPTURE RUN NEVER LENDS ITS (number, sha) TO released-build: 1.0.57+40c0787 stays red', () => {
    // Run 57 exists ONLY in the capture set. If the two sets were ever merged,
    // a release-shaped value at a capture run's number and sha would resolve.
    const r = run(consent('1.0.57+40c0787', 2));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /consent_artifacts: 2 row\(s\)/);
    assert.doesNotMatch(r.stdout, /store-capture-witnessed/);
    assert.doesNotMatch(r.stdout, /second-resolver acceptance/);
  });

  test('the offline banner names --capture-runs-file, so a fixture run can never pass for a real one', () => {
    const r = run(consent('cap-57-40c0787'));
    assert.match(r.stdout, /OFFLINE FIXTURE MODE — .*--capture-runs-file is set/);
  });
});

// ── `alsoResolves` ITSELF ───────────────────────────────────────────────────
// A MUTATED COPY OF THE REAL TREE (the e2e-run-resolver.test.mjs realRoot()
// pattern), never the tree itself: node --test runs files in parallel, and
// prod-provenance.test.mjs reads the same register.
describe('the register is what makes store-capture apply', () => {
  function realRoot() {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-capture-also-'));
    mkdirSync(join(root, 'tooling', 'legal'), { recursive: true });
    mkdirSync(join(root, 'catalog'), { recursive: true });
    cpSync(REGISTER, join(root, 'tooling', 'prod-provenance.json'));
    cpSync(join(REPO, 'tooling/legal/provider-register.json'), join(root, 'tooling/legal/provider-register.json'));
    cpSync(join(REPO, 'catalog/apps.json'), join(root, 'catalog/apps.json'));
    // releaseLanes() reads the channel register even offline.
    cpSync(join(REPO, 'tooling/channel-register.json'), join(root, 'tooling/channel-register.json'));
    cpSync(join(REPO, 'services/platform/migrations'), join(root, 'services/platform/migrations'), { recursive: true });
    cpSync(join(REPO, 'services/platform/src'), join(root, 'services/platform/src'), { recursive: true });
    for (const e of readdirSync(join(REPO, 'apps'), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const src = join(REPO, 'apps', e.name, 'pubspec.yaml');
      if (!existsSync(src)) continue;
      mkdirSync(join(root, 'apps', e.name), { recursive: true });
      cpSync(src, join(root, 'apps', e.name, 'pubspec.yaml'));
    }
    return root;
  }

  // ⏱ 2026-09-25 — the control was "green" until the witnessed row became a
  // finding (PP1 above). It is now "red for the sandbox reason", and the mutation
  // must turn it red for the SHAPE reason instead.
  test('🔴 drop store-capture from consent_artifacts.alsoResolves and the same cap row goes red on its shape (control: the unmutated copy names the sandbox)', () => {
    const root = realRoot();
    try {
      const control = run(consent('cap-57-40c0787'), { root });
      assert.equal(control.status, 1, `the unmutated copy must report the sandbox finding, or the mutation below proves nothing\n${control.stdout}${control.stderr}`);
      assert.match(control.stderr, /a sandbox lane wrote production: cap-57-40c0787/);
      const regPath = join(root, 'tooling', 'prod-provenance.json');
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      reg.tables.consent_artifacts.alsoResolves = reg.tables.consent_artifacts.alsoResolves.filter((id) => id !== 'store-capture');
      writeFileSync(regPath, JSON.stringify(reg, null, 2));
      const r = run(consent('cap-57-40c0787'), { root });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /not the shape a shipped build produces/);
      assert.doesNotMatch(r.stderr, /a sandbox lane wrote production/);
      assert.doesNotMatch(r.stdout, /store-capture-witnessed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
