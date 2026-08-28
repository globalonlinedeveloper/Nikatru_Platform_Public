// ─────────────────────────────────────────────────────────────────────────────
// e2e-run-resolver.test.mjs — the failing cases for the `e2e-run` resolver and
// for `alsoResolves`, both added 2026-08-28 in tooling/prod-provenance.json and
// tooling/ops/check-prod-provenance.mjs.
//
// WHY THIS EXISTS. From 2026-08-28 .github/workflows/e2e.yml stamps
// `--dart-define=APP_VERSION=e2e-<run_number>-<sha7>` so that the nightly's
// live-verification rows stop landing in production as `dev`. Those rows fail
// `released-build` by construction, so ops-watch would have gone red every
// morning for a row the harness legitimately wrote. The fix is a SEPARATE,
// NARROW resolver rather than a widened `released-build` — and a narrow resolver
// is only worth anything if it can still REFUSE, which is what every case below
// is for. `released-build` widened to "anything with a `+` or a `-`" would pass
// the accept case here and fail every reject case; that is the whole test.
//
// ⚠️ THE TRADE THESE CASES DO NOT AND CANNOT CHECK. Accepting `e2e-*` means
// residue from a crashed nightly no longer reds this monitor. That is paid for
// in tooling/e2e/purge.mjs, which hard-fails the nightly at the moment it cannot
// identify the consent row it was told to delete — a different file, a different
// workflow, and not observable from here. It is named so nobody reads a green
// row below as "the residue would still be caught by this reader".
//
// Every case runs the REAL monitor against the REAL register through the offline
// `--rows-file` / `--runs-file` fixture mode. The one thing a test of B-17 must
// never do is write to production, which is the requirement under test.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MONITOR = join(REPO, 'tooling', 'ops', 'check-prod-provenance.mjs');
const REGISTER = join(REPO, 'tooling', 'prod-provenance.json');

/** The same shape prod-provenance.test.mjs uses: a real run of the released-build
 *  lane, so the PRIMARY resolver is live and the cases below are genuinely about
 *  what happens AFTER it refuses. */
const RUNS = [{ run_number: 101, head_sha: 'e138f5be72555ab717d0391e771b40c0883d9fab' }];

function run(rowsByTable, runs = RUNS) {
  const dir = mkdtempSync(join(tmpdir(), 'nikatru-e2e-run-'));
  try {
    const f = (name, v) => {
      const p = join(dir, name);
      writeFileSync(p, JSON.stringify(v));
      return p;
    };
    return spawnSync(
      process.execPath,
      [MONITOR, '--root', REPO, '--rows-file', f('rows.json', rowsByTable), '--runs-file', f('runs.json', runs)],
      { cwd: REPO, encoding: 'utf8' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const consent = (marker, n = 1) => ({ consent_artifacts: [{ marker, n }] });

// ── the register declares what the monitor executes ─────────────────────────
describe('the register and the implementation name the same thing', () => {
  const register = JSON.parse(readFileSync(REGISTER, 'utf8'));

  test('`e2e-run` is a declared resolver, so the gate limb can recognise it', () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(register.resolvers, 'e2e-run'),
      'assert-prod-provenance.mjs fails any rule naming a resolver the register does not define',
    );
  });

  test('consent_artifacts keeps `released-build` as its PRIMARY resolver', () => {
    // 🔴 NOT DECORATION. assert-prod-provenance.mjs limb 5 — the anti-downgrade
    // limb — fails any table carrying an `app_version` column whose `resolver`
    // is not `released-build`. Moving `e2e-run` into that field would swap the
    // strongest marker in the schema for a shape check on the one table this
    // repository has already had residue in.
    assert.equal(register.tables.consent_artifacts.resolver, 'released-build');
    assert.deepEqual(register.tables.consent_artifacts.alsoResolves, ['e2e-run']);
  });

  test('NOTHING ELSE carries alsoResolves — the addition stays narrow', () => {
    const carriers = Object.entries(register.tables)
      .filter(([, r]) => Array.isArray(r.alsoResolves) && r.alsoResolves.length > 0)
      .map(([name]) => name);
    assert.deepEqual(
      carriers,
      ['consent_artifacts'],
      'a second resolver is a value this monitor will no longer go red for; each one needs its own argument',
    );
  });

  test('`events` is NOT given the e2e exemption, though it also carries app_version', () => {
    // The suite declines analytics, so the events rail is off for the nightly.
    // If that ever changes, an events row IS unremoved residue — purge.mjs does
    // not delete from `events` — and this monitor going red is correct.
    assert.equal(register.tables.events.alsoResolves, undefined);
  });
});

// ── ACCEPT ──────────────────────────────────────────────────────────────────
describe('e2e-run ACCEPTS the stamp e2e.yml actually produces', () => {
  test('a well-formed e2e-<run>-<sha7> row resolves and the run is green', () => {
    const r = run(consent('e2e-742-6fad3a3'));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /consent_artifacts\s+1 row\(s\), 0 unattributable/);
  });

  test('and it is PRINTED, never a silent pass', () => {
    // An acceptance on the weaker footing announces itself, the same way the
    // deployment witness does. This is what keeps a crashed nightly's residue
    // visible in the monitor's log after it stops being red.
    const r = run(consent('e2e-742-6fad3a3', 3));
    assert.match(r.stdout, /second-resolver acceptance/);
    assert.match(r.stdout, /3 row\(s\).*e2e-742-6fad3a3/);
    assert.match(r.stdout, /accepted by the narrower `e2e-run`/);
  });

  test('a real released build still resolves on the PRIMARY rule, not this one', () => {
    const r = run(consent('1.0.101+e138f5b'));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /second-resolver acceptance/);
  });

  test('the widest value it can produce fits inside the Worker\'s 32-char bind', () => {
    // events.ts:378 binds `str(body?.app_version, 32)`, which returns NULL — not
    // a truncation — above 32. 9 digits is assert-app-versioning.mjs's ceiling.
    const widest = 'e2e-999999999-6fad3a3';
    assert.equal(widest.length, 21);
    assert.ok(widest.length <= 32);
    assert.equal(run(consent(widest)).status, 0);
  });
});

// ── REJECT ──────────────────────────────────────────────────────────────────
describe('e2e-run REFUSES everything the register was written against', () => {
  // 🔴 THE FOUR NAMED IN tooling/prod-provenance.json's `released-build` entry,
  // re-asserted against the SECOND resolver. A widening of `released-build` to
  // "contains a + or a -" would have passed the accept cases above and would
  // fail here, which is exactly why these are the cases.
  for (const [label, marker] of [
    ['the dart-define default `dev`', 'dev'],
    ["C-6's live-probe literal", 'c6-localprobe'],
    ['the empty string (NULL in D1 reads as this)', ''],
  ]) {
    test(`${label} is unattributable`, () => {
      const r = run(consent(marker, 6));
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /consent_artifacts: 6 row\(s\)/);
    });
  }

  test('a NULL marker is unattributable', () => {
    // D1 returns SQL NULL as JSON null from a GROUP BY, so this is the shape a
    // row written with an over-long app_version really arrives in — and the
    // register calls NULL worse than `dev`, because it carries no information.
    const r = run({ consent_artifacts: [{ marker: null, n: 6 }] });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /consent_artifacts: 6 row\(s\)/);
  });

  // NEAR MISSES. Each is one character or one convention away from the accept
  // case above, and each is a value a careless resolver would have taken.
  for (const [label, marker] of [
    ['no run number', 'e2e--6fad3a3'],
    ['bare prefix', 'e2e'],
    ['prefix and run only', 'e2e-742'],
    ['upper-case sha (GITHUB_SHA is lower-case)', 'e2e-742-6FAD3A3'],
    ['a full 40-char sha — the value that would be stored as NULL', 'e2e-742-6fad3a3e5c1b9a8d7f60e2c4b1a39d8f7e6c5b4a'],
    ['six sha chars, not seven', 'e2e-742-6fad3a'],
    ['eight sha chars, not seven', 'e2e-742-6fad3a3f'],
    ['non-hex in the sha', 'e2e-742-6fad3ag'],
    ['ten digits — past assert-app-versioning.mjs\'s MAX_RUN_DIGITS', 'e2e-1234567890-6fad3a3'],
    ['a released-build shape wearing the prefix', 'e2e-1.0.101+e138f5b'],
    ['leading whitespace', ' e2e-742-6fad3a3'],
    ['trailing text', 'e2e-742-6fad3a3-extra'],
    ['the prefix upper-cased', 'E2E-742-6fad3a3'],
    ['a different lane borrowing the convention', 'ci-742-6fad3a3'],
  ]) {
    test(`NEAR MISS — ${label}: \`${marker}\` does not resolve`, () => {
      const r = run(consent(marker, 2));
      assert.equal(r.status, 1, `\`${marker}\` was ACCEPTED\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /consent_artifacts: 2 row\(s\)/);
      assert.doesNotMatch(r.stdout, /second-resolver acceptance/);
    });
  }

  test('the refusal reported is the PRIMARY rule\'s, so the message still names the real standard', () => {
    // A row that fails both must not be reported as "not an e2e stamp" — the
    // question anyone reading an ops-watch failure is asking is why it is not a
    // released build.
    const r = run(consent('dev'));
    assert.match(r.stderr, /not the shape a shipped build produces/);
    assert.match(r.stderr, /resolver `released-build`/);
  });

  test('the exemption does not leak to another table', () => {
    const r = run({ events: [{ marker: 'e2e-742-6fad3a3', n: 5 }] });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /events: 5 row\(s\)/);
  });
});

// ── `alsoResolves` ITSELF ───────────────────────────────────────────────────
// A MUTATED COPY OF THE REAL TREE, never the tree itself and never a hand-built
// fixture. Both halves matter here:
//   · the copy, because `node --test` runs test FILES IN PARALLEL and
//     prod-provenance.test.mjs reads the same register — mutating the real file
//     in place would make one suite's result depend on another's timing, which
//     is the shared-mutable-state failure this repository has already paid for
//     once in tooling/ci/assert-guard-coverage.mjs's ratchet;
//   · the REAL contents, because a fixture you write encodes the same
//     misunderstanding as the guard you write (assert-seams-wired.mjs shipped
//     with six passing fixture tests against a broken version).
// Only what this reader actually opens in offline mode is copied: the register,
// the migrations it enumerates from, and the four resolver contexts.
describe('alsoResolves refuses to be half-applied', () => {
  function realRoot() {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-also-'));
    mkdirSync(join(root, 'tooling', 'legal'), { recursive: true });
    mkdirSync(join(root, 'catalog'), { recursive: true });
    cpSync(REGISTER, join(root, 'tooling', 'prod-provenance.json'));
    cpSync(join(REPO, 'tooling/legal/provider-register.json'), join(root, 'tooling/legal/provider-register.json'));
    cpSync(join(REPO, 'catalog/apps.json'), join(root, 'catalog/apps.json'));
    // migration-tables.mjs enumerates the schema; cronJobNames() walks the
    // Worker source for `export const <NAME>_JOB`.
    cpSync(join(REPO, 'services/platform/migrations'), join(root, 'services/platform/migrations'), { recursive: true });
    cpSync(join(REPO, 'services/platform/src'), join(root, 'services/platform/src'), { recursive: true });
    // releaseLines() reads apps/*/pubspec.yaml and nothing else under apps/.
    for (const e of readdirSync(join(REPO, 'apps'), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const src = join(REPO, 'apps', e.name, 'pubspec.yaml');
      if (!existsSync(src)) continue;
      mkdirSync(join(root, 'apps', e.name), { recursive: true });
      cpSync(src, join(root, 'apps', e.name, 'pubspec.yaml'));
    }
    return root;
  }

  function withRegister(mutate, marker) {
    const root = realRoot();
    try {
      const regPath = join(root, 'tooling', 'prod-provenance.json');
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      mutate(reg);
      writeFileSync(regPath, JSON.stringify(reg, null, 2));
      const f = (name, v) => {
        const p = join(root, name);
        writeFileSync(p, JSON.stringify(v));
        return p;
      };
      return spawnSync(
        process.execPath,
        [
          MONITOR, '--root', root,
          '--rows-file', f('rows.json', consent(marker)),
          '--runs-file', f('runs.json', RUNS),
        ],
        { cwd: REPO, encoding: 'utf8' },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('the unmutated copy is GREEN — otherwise every case below would pass for the wrong reason', () => {
    // The control. A copy missing something the reader opens fails as COULD NOT
    // LOOK (exit 2), which would make the two mutations below unfalsifiable.
    const r = withRegister(() => {}, 'e2e-742-6fad3a3');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /second-resolver acceptance/);
  });

  test('THE MUTATION THAT PROVES THE ACCEPT CASE IS NOT VACUOUS: drop alsoResolves and the e2e row goes red', () => {
    const r = withRegister((reg) => {
      delete reg.tables.consent_artifacts.alsoResolves;
    }, 'e2e-742-6fad3a3');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /not the shape a shipped build produces/);
  });

  test('a second resolver this reader cannot execute is COULD NOT LOOK, never a silent skip', () => {
    // Exit 2, not 1. A quietly ignored `alsoResolves` would report the rows as
    // unattributable for a rule nobody applied — "I looked and it was fine" in
    // the shape of a finding, which is the one direction that weakens without
    // announcing itself.
    const r = withRegister((reg) => {
      reg.tables.consent_artifacts.alsoResolves = ['no-such-resolver'];
    }, 'e2e-742-6fad3a3');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /COULD NOT LOOK/);
    assert.match(r.stderr, /no-such-resolver/);
  });
});
