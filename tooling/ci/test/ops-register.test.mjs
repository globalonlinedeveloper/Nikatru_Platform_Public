// ─────────────────────────────────────────────────────────────────────────────
// ops-register.test.mjs — assert-ops-register.mjs must be able to FAIL.
//
// [pipeline O-1] the operations register is complete, bounded, and still
// describes the tree it claims to describe · [O-8] cannot-revert needs a named
// mitigation that is itself a row · [O-13] every past-tense claim expires ·
// [O-14] the access intersection is computed over two independently written
// lists · [O-11] every expiring thing has a date or a named gap · [O-20] Day 0
// prints pending and is never fabricated.
//
// ⚠️ REAL-TREE MUTATIONS, RE-RUN FROM SCRATCH ON 2026-08-02 against a COPY of
// this worktree (the earlier claim in this header was inherited from an agent
// that died before verifying anything, so none of it was trusted). Fifteen for
// this guard, each: baseline green -> mutate -> exit 1 with the intended message
// -> restore FROM MEMORY -> byte-compare -> re-verify green. A crash or a
// SyntaxError is explicitly NOT counted as a catch. A fixture you wrote encodes
// the same misunderstanding as the guard you wrote — assert-seams-wired.mjs
// shipped with a check that could not fail while all six of its fixture tests
// passed.
//
//   M1  a workflow a duty row anchors at is deleted        -> COVERAGE LOST
//   M2  a new workflow with no duty row                    -> "has NO `duty` row"
//   M3  triggers.crons emptied in the anchored config      -> COVERAGE LOST
//   M4  the DELEGATED hostname register is deleted         -> COVERAGE LOST
//   M5  the delegate exists but its `hosts` array is empty -> COVERAGE LOST
//   M6  the delegate stops seeing a deployed custom domain -> "is not among the"
//   M7  a row names a reader that does not exist           -> "which is not in the tree"
//   M8  lastDrill backdated to 2020 against a 120d cadence -> "the same fact expires"
//   M9  cannot-revert row loses its mitigation             -> "no named `mitigation`"
//   M10 a free-text access provider                        -> "not in the fixed vocabulary"
//   M11 _requiredCoverage.ids emptied                      -> COVERAGE LOST
//   M12 degradedUntil backdated                            -> "has PASSED and the gap is still open"
//   M13 a duty row anchored at a workflow that is gone     -> COVERAGE LOST
//   M14 the register itself deleted                        -> COVERAGE LOST
//   M15 a recovery path widened until it needs the very
//       provider its failure row takes down                -> "THE RESPONSE PATH
//                                                             DEPENDS ON THE THING
//                                                             THAT IS DOWN"
//   15/15 caught, none crashed, every restore byte-identical and green again.
//
// ── [14]O-3 / O-11 / O-17 · REAL-TREE MUTATIONS RUN 2026-08-06 ──────────────
// 🔴 THE FALSIFIER WAS TRUE AND THE GUARD WAS GREEN, and it was one defect three
// times: an acceptance limb whose domain is empty. O-3's cadence limb queried NO
// record (it checked that a row NAMED one); O-11's lead-window arithmetic had
// executed ZERO times across twelve rows, every one `expires: null`; O-17's
// deleting-job limb ranged over ZERO stores out of nineteen. All three printed ok.
//
// O-3 NEEDED NO SYNTHETIC NEGATIVE TEST — THE TREE PROVIDES IT. Measured on the
// owner's laptop while the old guard exited 0:
//     ClaudeTranscriptBackup  LastRun 2026-08-06 02:00:01  LastTaskResult 1
//     NikatruProjectBackup    LastRun 2026-08-06 02:30:01  LastTaskResult 1
//     NIKATRU daily backup    LastRun 2026-08-06 10:00:01  LastTaskResult 0
// The repaired guard queries Task Scheduler and reddens on the first two while
// passing the third — one substrate, opposite outcomes, which is the argument
// this requirement was written on.
//
// Ten further mutations against the COMMITTED register (each: mutate -> run ->
// intended message -> restore from the pre-mutation buffer -> byte-compare).
// ⚠️ NOT `git checkout --`: the change under test was uncommitted, so checkout
// would have reverted the work instead of the mutation. 10/10 caught, none
// crashed, restore byte-identical (sha256 eac7da12…), guard back to its
// baseline of exactly the two failing laptop duties.
//
//   N1  a 13th `expires: null` row                -> "and the ceiling is 12"
//   N2  `expiryKnownAt` stripped from origin-ca   -> "must carry `expiryKnownAt`"
//   N3  a 4th `period-undeclared` row             -> "and the ceiling is 3"
//       ⚠️ THE CEILING IS NOW 2, ratcheted 2026-08-09 when the signup KV's
//       period was declared (365 days) and its row moved to `rule: ttl`. N3 was
//       re-run against the new number the same day — signup row flipped back to
//       `period-undeclared` -> "3 retention row(s) carry `rule: period-undeclared`
//       and the ceiling is 2", problem count 3 -> 4, restored byte-identical and
//       back to 3. The ratchet is not decoration: leaving a cap at its old value
//       after a gap closes lets the closed gap fund a new one silently.
//   N4  the signup KV declares a period, no job   -> "`rule: period` with no `deletingJob`"
//   N5  `recordQuery` deleted from e2e.yml's row  -> "no `mechanism.recordQuery.reader`"
//   N6  a 6th duty declared `unreachable`         -> "and the ceiling is 5"
//   N7  EVERY scheduled duty `unreachable`        -> COVERAGE LOST
//   N8  every `expiring` row deleted              -> COVERAGE LOST
//   N9  a Windows task name that does not exist   -> "DOES NOT EXIST: no scheduled
//       (the `missing` path, against the real host)   task named …"
//   N10 a declared reader no row uses             -> "is declared and no row uses it"
//
// 🔴 AND ONE FOUND BY THE HARNESS ITSELF, worth more than any of the ten: on the
// first pass the probe's 15 s timeout was shorter than a COLD `powershell` start
// plus the ScheduledTasks module autoload. It did not crash — it reported
// `unreadable`, and THE GUARD EXITED 0 WITH TWO FAILING DUTIES ON THE MACHINE.
// That is this limb's own defect returning as a timeout. Local probes now get
// their own 90 s ceiling, separate from the 15 s network one.
//
// ── THE LEAD-WINDOW LIMB, REAL-TREE MUTATIONS RUN 2026-08-04 ─────────────────
// Same protocol, against this worktree's own tooling/ops/register.json, each
// restored with `git checkout --` and re-verified green (`git status` clean,
// guard exit 0). A stack trace is NOT counted as a catch — every one of these
// printed the guard's own intended message.
//
//   S1  `degradedLeadDays` stripped from the live row  -> "no positive integer
//                                                          `degradedLeadDays`"
//   S2  degradedUntil moved to 2026-08-10, inside the
//       row's own 14-day window                        -> exit 1, "FIRES IN 6
//                                                          DAY(S), inside its own
//                                                          14-day lead window"
//   S3  degradedUntil backdated to 2026-07-01          -> exit 1, "has PASSED …
//                                                          It went red 14 day(s)
//                                                          before this"
//   S4  the tripwire disarmed entirely (both keys      -> exit 1, "\"Never done\"
//       removed)                                          must cost something",
//                                                          and the printed count
//                                                          fell to `0 dated
//                                                          tripwire(s) armed`
//   4/4 caught. S4 is the one that matters most: it proves the COUNT moves, so
//   an empty tripwire domain cannot pass as a clean register.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  evaluate,
  evaluateRunRecords,
  classifyRunRecord,
  cadenceDays,
  parseJsonc,
  findWranglerConfigs,
  stripComments,
  DURABLE_ID,
  readScheduledTaskProbe,
  classifyScheduledTaskRow,
  formatTaskResult,
  classifyGlitchtipChecks,
  classifyRunHistoryAnswer,
  combineLimbProbes,
  describeNarrowing,
  dispatchTargetsFromSource,
  checkTimerTargetsAgainstDispatcher,
  deriveUnreadableCeiling,
} from '../assert-ops-register.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-ops-register.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ops-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const NOW = Date.parse('2026-08-02T00:00:00Z');

/** The smallest register that PASSES, so every mutation below is proven to fail
 *  for its own reason rather than for a defect it inherited from the fixture. */
function baseRegister() {
  return {
    _kinds: ['surface', 'duty', 'expiring', 'recovery-path', 'revert', 'retention', 'review', 'failure-mode'],
    _providers: ['github', 'google', 'cloudflare', 'laptop', 'oci'],
    // [14]O-4. Kept to the three substrates the fixture rows actually reach: an
    // unexercised key is an error, on purpose, so this map cannot accumulate
    // mappings about nothing while looking like coverage.
    _substrateHosts: { 'github-actions': 'github', 'windows-task-scheduler': 'laptop', 'glitchtip-heartbeat': 'oci' },
    _maxCadenceDays: { surface: 7, duty: 31, expiring: 180, 'recovery-path': 180, revert: 365, retention: 365, review: 120, 'failure-mode': 365 },
    // [14]O-3/O-11/O-17. The four ceilings are set to the fixture's own state,
    // not to the real register's, so a test that adds one more null expiry or
    // one more undeclared period trips the ratchet rather than sailing past it.
    // `_recordReaders` is read by evaluateRunRecords (which main() calls), never
    // by evaluate(), so it matters only to the SPAWNED fixture roots below.
    _recordReaders: {
      _maxUnreachable: 1,
      _maxUnreadable: 1,
      _windowMultiplier: 1.5,
      'github-run-history': { queries: 'the newest successful scheduled run', needs: 'GITHUB_TOKEN' },
      unreachable: { queries: 'nothing', needs: 'n/a' },
    },
    _expiryCoverage: { _maxNull: 1 },
    _retentionCoverage: { _maxUndeclared: 1 },
    _requiredCoverage: { ids: ['recovery.bundles'] },
    rows: [
      {
        id: 'duty.workflow.ci.yml',
        kind: 'duty',
        what: 'the gate',
        detector: 'a red check',
        response: 'fix before merge',
        cadence: 'trigger',
        trigger: 'every push',
        mechanism: { substrate: 'github-actions', anchor: '.github/workflows/ci.yml', record: 'run history', failingValue: 'conclusion = failure', readBy: 'branch protection' },
        accessProviders: ['github'],
        source: 'verified',
      },
      {
        id: 'recovery.bundles',
        kind: 'recovery-path',
        what: 'restore from the offsite bundles',
        detector: 'this row',
        response: 'follow the runbook',
        cadence: '120d',
        lastDrill: '2026-07-26',
        mechanism: { substrate: 'google-drive', anchor: 'Private/runbooks/backup-liveness.md', record: 'a dated file', failingValue: 'a stale date', readBy: 'the backup script' },
        accessProviders: ['google'],
        source: 'verified',
      },
      {
        id: 'failure.laptop',
        kind: 'failure-mode',
        what: 'the laptop is gone',
        detector: 'self-evident',
        response: 'recovery.bundles',
        cadence: '365d',
        lastDone: '2026-07-26',
        takesDown: ['laptop'],
        respondsVia: 'recovery.bundles',
        // 🔴 DELIBERATELY `nikatru/` WHILE THE ROW ABOVE IS `Private/`. `OUTSIDE_CI` holds TWO
        // prefixes, and the `unverifiableAnchors` assertion below counts 2 — so this fixture is
        // the only thing making that count span BOTH branches. With both rows on one prefix the
        // other branch would be exercised by nothing and could be deleted in silence, which is
        // this repo's most repeated defect (a check that quietly stopped checking). One fixture
        // per prefix costs nothing and is not a new stored test.
        mechanism: { substrate: 'google-drive', anchor: 'nikatru/OWNER_QUEUE.md', record: 'a dated file', failingValue: 'an intersection', readBy: 'this guard' },
        accessProviders: ['google'],
        source: 'verified',
      },
      // [14]O-4's domain is duties ON A CLOCK, and the three rows above are not
      // on one. Appended (never inserted) so every rows[N] index above still
      // points where its test thinks it does, and anchored OUTSIDE Private/ and
      // nikatru/ so the unverifiableAnchors count assertion is untouched.
      {
        id: 'duty.laptop.backup',
        kind: 'duty',
        what: 'the 8-hourly offsite bundle push',
        detector: 'a heartbeat monitor on another host',
        response: 'run it by hand and read its log',
        cadence: '8h',
        mechanism: {
          substrate: 'windows-task-scheduler',
          anchor: 'renovate.json',
          record: 'LastTaskResult + the heartbeat monitor',
          failingValue: 'the heartbeat not arriving inside its grace window',
          readBy: 'the monitor, from outside the laptop',
        },
        absenceWatcher: {
          substrate: 'glitchtip-heartbeat',
          what: 'heartbeat monitor 6, on a host the laptop cannot take down',
          signal: 'no POST inside the interval -> Down -> the alert rule -> email',
          margin: 'interval 12h against an 8h cadence = 1.5x, so one late run is not an alarm',
          downTransitionDrill: {
            date: '2026-07-30',
            how: 'shrank the window and enqueued the PRODUCTION check task, then restored it',
            evidence: 'delivery record 4133761a-4c83-48eb-88e0-7af79aa2e8cc at 08:56:23Z',
          },
        },
        accessProviders: ['laptop'],
        source: 'verified',
      },
    ],
  };
}

/** The one scheduled duty, by name rather than by index. */
const sched = (r) => r.rows.find((x) => x.id === 'duty.laptop.backup');

const tree = { workflows: ['ci.yml'], paths: new Set(['.github/workflows/ci.yml', 'renovate.json']) };
const run = (reg) => evaluate(reg, tree, NOW);
const messages = (reg) => run(reg).errors.join(' | ');

describe('assert-ops-register — the fixture itself must be green, or nothing below means anything', () => {
  test('the base register passes', () => {
    assert.deepEqual(run(baseRegister()).errors, []);
  });
});

describe('assert-ops-register — cadence is bounded and its escape hatches cost something', () => {
  test('a duration above the per-kind stage maximum FAILS', () => {
    const r = baseRegister();
    r.rows[1].cadence = '3650d';
    assert.match(messages(r), /exceeds the stage maximum/);
  });

  test('`on-demand` with no `why` FAILS — the word that disabled the staleness limb per row', () => {
    const r = baseRegister();
    r.rows[0].cadence = 'on-demand';
    delete r.rows[0].trigger;
    assert.match(messages(r), /with no `why`/);
  });

  test('`on-demand` WITH a why passes, and is counted so shrinking coverage is visible', () => {
    const r = baseRegister();
    r.rows[0].cadence = 'on-demand';
    r.rows[0].why = 'submission is event-driven; the walkability half runs on every push';
    delete r.rows[0].trigger;
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.onDemand, 1);
  });

  test('`trigger` with no named event FAILS', () => {
    const r = baseRegister();
    delete r.rows[0].trigger;
    assert.match(messages(r), /no named `trigger` event/);
  });

  test('an unparseable cadence FAILS rather than being treated as absent', () => {
    const r = baseRegister();
    r.rows[0].cadence = 'sometimes';
    assert.match(messages(r), /must be a duration/);
  });

  test('cadenceDays converts hours and days and refuses everything else', () => {
    assert.equal(cadenceDays('8h'), 1 / 3);
    assert.equal(cadenceDays('120d'), 120);
    assert.equal(cadenceDays('0d'), null);
    assert.equal(cadenceDays('on-demand'), null);
    assert.equal(cadenceDays(undefined), null);
  });
});

describe('assert-ops-register — O-13: a past-tense claim expires', () => {
  test('a drill older than its own cadence FAILS', () => {
    const r = baseRegister();
    r.rows[1].lastDrill = '2020-01-01';
    assert.match(messages(r), /the same fact expires/);
  });

  test('a drill dated in the FUTURE fails — a drill that has not happened cannot be dated', () => {
    const r = baseRegister();
    r.rows[1].lastDrill = '2099-01-01';
    assert.match(messages(r), /is in the FUTURE/);
  });

  test('a null drill date with neither an ownerGap nor a dated tripwire FAILS', () => {
    const r = baseRegister();
    r.rows[1].lastDrill = null;
    assert.match(messages(r), /"Never done" must cost something/);
  });

  test('a null drill date WITH an ownerGap passes and is printed, never blocking', () => {
    const r = baseRegister();
    r.rows[1].lastDrill = null;
    r.rows[1].ownerGated = true;
    r.rows[1].ownerGap = 'only a human performs a drill; this one never has been';
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.gaps.length, 1);
  });

  test('omitting the date KEY entirely fails — that is how a claim becomes true forever', () => {
    const r = baseRegister();
    delete r.rows[1].lastDrill;
    assert.match(messages(r), /must carry `lastDrill`/);
  });
});

describe('assert-ops-register — O-8: cannot-revert needs a mitigation that can itself go stale', () => {
  const withRevert = (extra) => {
    const r = baseRegister();
    r.rows.push({
      id: 'revert.client',
      kind: 'revert',
      what: 'a shipped binary',
      detector: 'the mitigation must be a row',
      response: 'ship forward',
      cadence: '365d',
      lastDone: null,
      ownerGated: true,
      ownerGap: 'nothing has shipped yet',
      path: 'cannot-revert',
      mechanism: { substrate: 'app-stores', anchor: 'renovate.json', record: 'the tracks', failingValue: 'no recall', readBy: 'nothing' },
      accessProviders: ['cloudflare'],
      source: 'verified',
      ...extra,
    });
    return r;
  };

  test('cannot-revert with no mitigation FAILS', () => {
    assert.match(messages(withRevert({})), /no named `mitigation`/);
  });

  test('a mitigation naming a row that does not exist FAILS', () => {
    assert.match(messages(withRevert({ mitigation: 'revert.imaginary' })), /is not a row in this register/);
  });

  test('a mitigation with no cadence of its own FAILS — that is what makes it a sentence again', () => {
    const r = withRevert({ mitigation: 'recovery.bundles' });
    assert.match(messages(r), /is kind `recovery-path`, not `revert`/);
  });

  test('a real mitigation row passes, and the cannot-revert COUNT is printed', () => {
    const r = withRevert({ mitigation: 'revert.mitigation.force-update' });
    r.rows.push({
      id: 'revert.mitigation.force-update',
      kind: 'revert',
      what: 'the force-update kill switch',
      detector: 'its own cadence',
      response: 'raise the minimum version',
      cadence: '365d',
      lastDone: '2026-07-26',
      path: 'config minimum version',
      mechanism: { substrate: 'cloudflare-worker-route', anchor: 'renovate.json', record: 'the config payload', failingValue: 'a client that does not pick it up', readBy: 'nothing yet' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.cannotRevert, 1);
  });
});

describe('assert-ops-register — O-14: the intersection is over TWO independently written lists', () => {
  test('a response path that needs the downed provider FAILS', () => {
    const r = baseRegister();
    r.rows[1].accessProviders = ['google', 'laptop'];
    assert.match(messages(r), /THE RESPONSE PATH DEPENDS ON THE THING THAT IS DOWN/);
  });

  test('the SAME clash produced from the failure row instead FAILS identically', () => {
    const r = baseRegister();
    r.rows[2].takesDown = ['google'];
    assert.match(messages(r), /THE RESPONSE PATH DEPENDS ON THE THING THAT IS DOWN/);
  });

  test('a respondsVia that is not a recovery-path FAILS', () => {
    const r = baseRegister();
    r.rows[2].respondsVia = 'duty.workflow.ci.yml';
    assert.match(messages(r), /is kind `duty`, not `recovery-path`/);
  });

  test('an empty accessProviders FAILS as "cannot be checked", never passes', () => {
    const r = baseRegister();
    r.rows[1].accessProviders = [];
    assert.match(messages(r), /cannot be checked against any failure/);
  });

  test('a provider outside the fixed vocabulary FAILS — free text makes the intersection uncomputable', () => {
    const r = baseRegister();
    r.rows[1].accessProviders = ['Google LLC'];
    assert.match(messages(r), /not in the fixed vocabulary/);
  });

  test('a failure with no takesDown FAILS', () => {
    const r = baseRegister();
    delete r.rows[2].takesDown;
    assert.match(messages(r), /must name the providers it `takesDown`/);
  });
});

describe('assert-ops-register — mechanism, source and the Private/ blind spot', () => {
  test('an anchor that is not in the tree FAILS', () => {
    const r = baseRegister();
    r.rows[0].mechanism.anchor = '.github/workflows/gone.yml';
    assert.match(messages(r), /is not in the tree/);
  });

  test('an anchor under Private/ is ACCEPTED and COUNTED, because CI cannot read it', () => {
    const v = run(baseRegister());
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.unverifiableAnchors, 2);
  });

  test('a mechanism with no reachable failing value FAILS', () => {
    const r = baseRegister();
    r.rows[0].mechanism.failingValue = '';
    assert.match(messages(r), /`mechanism.failingValue` is empty/);
  });

  test('`source: unverified` with no reason FAILS, and with one is counted', () => {
    const r = baseRegister();
    r.rows[1].source = 'unverified';
    assert.match(messages(r), /with no `unverifiedWhy`/);
    r.rows[1].unverifiedWhy = 'corroborated only by this repo\'s own runbook';
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.unverified, 1);
  });

  test('a source that is neither verified nor unverified FAILS', () => {
    const r = baseRegister();
    r.rows[1].source = 'probably';
    assert.match(messages(r), /must be `verified` or `unverified`/);
  });

  test('`ownerGated` with no `ownerGap` FAILS — a gap nobody describes is a waiver', () => {
    const r = baseRegister();
    r.rows[1].ownerGated = true;
    assert.match(messages(r), /with no `ownerGap`/);
  });
});

describe('assert-ops-register — the dated tripwire cannot rot', () => {
  /** A well-formed tripwire, so each mutation below fails for its own reason. */
  const withTripwire = (extra = {}) => {
    const r = baseRegister();
    Object.assign(r.rows[1], {
      degradedUntil: '2099-01-01',
      degradedWhy: 'another stage owns the fix',
      degradedLeadDays: 14,
      ...extra,
    });
    return r;
  };

  test('a degradedUntil in the past FAILS', () => {
    assert.match(messages(withTripwire({ degradedUntil: '2020-01-01' })), /has PASSED and the gap is still open/);
  });

  test('the PASSED message says the row already went red, and refuses the date-moving exit', () => {
    const m = messages(withTripwire({ degradedUntil: '2020-01-01' }));
    assert.match(m, /went red 14 day\(s\) before this/);
    assert.match(m, /Moving the date is the one move this field exists to refuse/);
  });

  test('a degradedUntil far in the future PRINTS and does not block', () => {
    const v = run(withTripwire());
    assert.deepEqual(v.errors, []);
    assert.equal(v.prints.filter((p) => p.includes('DEGRADED')).length, 1);
  });

  test('the print says how many days remain before it goes RED, not just the final date', () => {
    // A signal that never changes is a signal nobody reads: the row this limb
    // was written for printed the identical line at T-27 and at T-1.
    const v = run(withTripwire());
    assert.match(v.prints.find((p) => p.includes('DEGRADED')), /Goes RED in \d+ day\(s\) \(14-day lead window\)/);
  });

  // ── THE LIMB THIS FILE GAINED ON 2026-08-04 ───────────────────────────────
  test('INSIDE the lead window it goes RED, with time still left to act', () => {
    // NOW is 2026-08-02 in this suite; 10 days out sits inside a 14-day window.
    const m = messages(withTripwire({ degradedUntil: '2026-08-12', degradedLeadDays: 14 }));
    assert.match(m, /FIRES IN \d+ DAY\(S\)/);
    assert.match(m, /inside its own 14-day lead window/);
  });

  test('OUTSIDE the lead window it does not block — the warning is a window, not a second deadline', () => {
    const v = run(withTripwire({ degradedUntil: '2026-08-12', degradedLeadDays: 3 }));
    assert.deepEqual(v.errors, []);
  });

  test('the red message names the gap AND the recorded response, so it is actionable', () => {
    const m = messages(withTripwire({ degradedUntil: '2026-08-12' }));
    assert.match(m, /THE GAP: another stage owns the fix/);
    assert.match(m, /THE RESPONSE ON RECORD:/);
  });

  test('a degradedUntil with NO lead window FAILS — this is the shape that detonated', () => {
    const r = baseRegister();
    r.rows[1].degradedUntil = '2099-01-01';
    r.rows[1].degradedWhy = 'another stage owns the fix';
    assert.match(messages(r), /no positive integer `degradedLeadDays`/);
  });

  test('a zero or negative lead window is not a lead window', () => {
    assert.match(messages(withTripwire({ degradedLeadDays: 0 })), /no positive integer `degradedLeadDays`/);
    assert.match(messages(withTripwire({ degradedLeadDays: -5 })), /no positive integer `degradedLeadDays`/);
  });

  test('a non-integer lead window is refused', () => {
    assert.match(messages(withTripwire({ degradedLeadDays: 14.5 })), /no positive integer `degradedLeadDays`/);
    assert.match(messages(withTripwire({ degradedLeadDays: '14' })), /no positive integer `degradedLeadDays`/);
  });

  test('a degradedUntil with no reason FAILS — a deadline with no reason is one somebody extends', () => {
    const r = baseRegister();
    r.rows[1].degradedUntil = '2099-01-01';
    r.rows[1].degradedLeadDays = 14;
    assert.match(messages(r), /with no `degradedWhy`/);
  });

  test('armed tripwires are COUNTED, so zero and one cannot read alike', () => {
    // An empty domain that prints nothing is this repo's most repeated defect.
    assert.equal(run(withTripwire()).stats.datedTripwires, 1);
    assert.equal(run(baseRegister()).stats.datedTripwires, 0);
  });
});

describe('assert-ops-register — O-11 expiring and O-20 review', () => {
  const withExpiring = (extra) => {
    const r = baseRegister();
    r.rows.push({
      id: 'expiring.domain',
      kind: 'expiring',
      what: 'a domain registration',
      detector: 'this row',
      response: 'renew it',
      cadence: '180d',
      leadDays: 30,
      expires: null,
      // [14]O-11, 2026-08-06: the price of the null tolerance. Not optional in
      // the fixture either — a fixture that opts out of the field under test is
      // how a guard ships with a check its own tests never exercise.
      expiryKnownAt: 'the registrar console',
      ownerGated: true,
      ownerGap: 'console-only',
      mechanism: { substrate: 'cloudflare-registrar', anchor: 'Private/runbooks/operations.md', record: 'the console', failingValue: 'auto-renew off', readBy: 'nothing yet' },
      accessProviders: ['cloudflare'],
      source: 'verified',
      ...extra,
    });
    return r;
  };

  test('an expiry inside its own lead window FAILS', () => {
    const soon = new Date(NOW + 5 * 86_400_000).toISOString().slice(0, 10);
    assert.match(messages(withExpiring({ expires: soon, ownerGated: false, ownerGap: undefined })), /inside its own 30-day lead window/);
  });

  test('an expiry in the past FAILS', () => {
    assert.match(messages(withExpiring({ expires: '2020-01-01', ownerGated: false, ownerGap: undefined })), /is in the PAST/);
  });

  test('an expiry comfortably beyond the lead window passes', () => {
    const far = new Date(NOW + 300 * 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(run(withExpiring({ expires: far, ownerGated: false, ownerGap: undefined })).errors, []);
  });

  test('a null expiry with no ownerGap and no satisfiedBy FAILS', () => {
    assert.match(messages(withExpiring({ ownerGated: false, ownerGap: undefined })), /An unknown expiry is a gap, not an absence/);
  });

  test('a leadDays of zero FAILS — a lead time is what makes an expiry actionable', () => {
    assert.match(messages(withExpiring({ leadDays: 0 })), /`leadDays` must be a positive integer/);
  });

  test('`satisfiedBy` whose duty no longer clears the margin FAILS — the silent re-arming', () => {
    const r = withExpiring({ ownerGated: false, ownerGap: undefined, satisfiedBy: 'duty.slow', windowDays: 180 });
    r.rows.push({
      id: 'duty.slow',
      kind: 'duty',
      what: 'a backup that used to run every 8 hours and now runs monthly',
      detector: 'a heartbeat',
      response: 'run it',
      cadence: '30d',
      mechanism: { substrate: 'windows-task-scheduler', anchor: 'Private/runbooks/backup-liveness.md', record: 'LastTaskResult', failingValue: '!= 0', readBy: 'a monitor' },
      accessProviders: ['laptop'],
      source: 'verified',
    });
    assert.match(messages(r), /no longer satisfies this by construction/);
  });

  test('a review row PRINTS Day 0 pending and never invents a date', () => {
    const r = baseRegister();
    r.rows.push({
      id: 'review.kill-or-keep',
      kind: 'review',
      what: 'the 90-day kill-or-keep review',
      detector: 'this row',
      response: 'keep, change, or withdraw',
      cadence: 'trigger',
      trigger: 'the paywall going live',
      dayCount: 90,
      day0: null,
      outcomes: { keep: 'no action', kill: 'execute the retirement contract' },
      ownerGated: true,
      ownerGap: 'gates all revenue',
      mechanism: { substrate: 'owner-decision', anchor: 'nikatru/OWNER_QUEUE.md', record: 'the decisions log', failingValue: 'day 90 with no review', readBy: 'this guard' },
      accessProviders: ['github'],
      source: 'verified',
    });
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.match(v.prints.join(' '), /Day 0 PENDING/);
  });

  test('once Day 0 exists and the day count has elapsed with no review, it FAILS', () => {
    const r = baseRegister();
    r.rows.push({
      id: 'review.kill-or-keep',
      kind: 'review',
      what: 'the 90-day kill-or-keep review',
      detector: 'this row',
      response: 'keep, change, or withdraw',
      cadence: '120d',
      dayCount: 90,
      day0: '2025-01-01',
      outcomes: { keep: 'no action', kill: 'withdraw' },
      mechanism: { substrate: 'owner-decision', anchor: 'nikatru/OWNER_QUEUE.md', record: 'the decisions log', failingValue: 'day 90 with no review', readBy: 'this guard' },
      accessProviders: ['github'],
      source: 'verified',
    });
    assert.match(messages(r), /has passed with no recorded review/);
  });

  test('a review with fewer than two outcomes FAILS', () => {
    const r = baseRegister();
    r.rows.push({
      id: 'review.one-way',
      kind: 'review',
      what: 'a review that can only say yes',
      detector: 'this row',
      response: 'keep',
      cadence: 'trigger',
      trigger: 'never',
      dayCount: 90,
      day0: null,
      ownerGated: true,
      ownerGap: 'pending',
      outcomes: { keep: 'no action' },
      mechanism: { substrate: 'owner-decision', anchor: 'nikatru/OWNER_QUEUE.md', record: 'x', failingValue: 'y', readBy: 'z' },
      accessProviders: ['github'],
      source: 'verified',
    });
    assert.match(messages(r), /at least two named actions/);
  });
});

describe('assert-ops-register — retention rules, whose DOMAIN is assert-retention-coverage\'s', () => {
  const withRetention = (extra) => {
    const r = baseRegister();
    r.rows.push({
      id: 'retention.d1.x',
      kind: 'retention',
      store: 'd1:x:y',
      what: 'a table',
      detector: 'the retention guard',
      response: 'n/a',
      cadence: '365d',
      rule: 'keep',
      keepWhy: 'it is the purchase record',
      mechanism: { substrate: 'cloudflare-d1', anchor: 'renovate.json', record: 'the table', failingValue: 'n/a', readBy: 'the retention guard' },
      accessProviders: ['cloudflare'],
      source: 'verified',
      ...extra,
    });
    return r;
  };

  test('`keep` with no written reason FAILS', () => {
    assert.match(messages(withRetention({ keepWhy: undefined })), /with no `keepWhy`/);
  });

  test('an unknown rule FAILS', () => {
    assert.match(messages(withRetention({ rule: 'forever' })), /`rule` must be one of/);
  });

  test('`period` with no periodDays FAILS', () => {
    assert.match(messages(withRetention({ rule: 'period', keepWhy: undefined })), /needs a positive integer `periodDays`/);
  });

  test('`period-undeclared` that is not owner-gated FAILS — an undeclared period is a gap somebody owns', () => {
    assert.match(messages(withRetention({ rule: 'period-undeclared', keepWhy: undefined })), /must be `ownerGated`/);
  });

  test('a retention row with no store FAILS', () => {
    assert.match(messages(withRetention({ store: '' })), /must name the `store` it covers/);
  });
});

// ── [14]O-10 · a cadence is a claim until something reads it ────────────────
// ⚠️ MUTATION-PROVEN ON THE REAL TREE FIRST (2026-08-03), and the run found a
// defect in the guard: repointing `duty.workflow.build-platforms.yml`'s
// `readBy` at `assert-e2e-proof-fresh.mjs` returned exit 0, because that
// guard's HEADER names `build-platforms.yml` four times while explaining why it
// is a sibling. A comment satisfied a check about behaviour. Comments are
// stripped now, and the last case below is that exact input.
describe('assert-ops-register — O-10: a cadence must be READ, not merely declared', () => {
  const scheduled = (over = {}) => {
    const reg = baseRegister();
    reg.rows.push({
      id: 'duty.workflow.nightly.yml',
      kind: 'duty',
      what: 'a nightly proof',
      detector: 'a guard',
      response: 'fix it',
      cadence: '1d',
      mechanism: {
        substrate: 'github-actions',
        anchor: '.github/workflows/nightly.yml',
        record: 'run history',
        failingValue: 'no scheduled success',
        readBy: 'tooling/ci/assert-nightly-fresh.mjs',
        ...over.mechanism,
      },
      // [14]O-4 applies to this row too — it is on a clock. Given the same
      // shape the real build-platforms.yml and e2e.yml rows have: a push-driven
      // reader on the very provider that runs the schedule, which is a real gap
      // and is declared as one rather than dressed up as an off-host watcher.
      absenceWatcher: {
        substrate: 'github-actions',
        what: 'a push-triggered freshness guard on the same provider as the schedule',
        ownerGated: true,
        gap: 'an off-host absence signal needs a monitor only the owner can create',
      },
      accessProviders: ['github'],
      source: 'verified',
      ...over.row,
    });
    return reg;
  };
  const withReader = (src) =>
    evaluate(
      scheduled(),
      {
        workflows: ['ci.yml', 'nightly.yml'],
        paths: new Set([...tree.paths, '.github/workflows/nightly.yml', 'tooling/ci/assert-nightly-fresh.mjs']),
        readerSource: new Map([['tooling/ci/assert-nightly-fresh.mjs', src]]),
      },
      NOW,
    );

  test('PASSES when the named reader exists and names the workflow in code', () => {
    const v = withReader("const WORKFLOW = 'nightly.yml';");
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
    assert.ok(v.prints.some((p) => /O-10 — 1 scheduled workflow duty/.test(p)));
  });

  test('🔴 FAILS when `readBy` is a SENTENCE rather than a file that exists', () => {
    const v = evaluate(
      scheduled({ mechanism: { readBy: 'somebody remembering to look' } }),
      { workflows: ['ci.yml', 'nightly.yml'], paths: new Set([...tree.paths, '.github/workflows/nightly.yml']), readerSource: new Map() },
      NOW,
    );
    assert.match(v.errors.join(' | '), /names no in-tree file that exists/);
  });

  test('a declared `freshnessGap` PRINTS instead, and never blocks', () => {
    const v = evaluate(
      scheduled({ mechanism: { readBy: 'nothing yet' }, row: { freshnessGap: 'needs a monitor only the owner can create' } }),
      { workflows: ['ci.yml', 'nightly.yml'], paths: new Set([...tree.paths, '.github/workflows/nightly.yml']), readerSource: new Map() },
      NOW,
    );
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
    assert.match(v.prints.join(' | '), /has NO in-tree freshness reader: needs a monitor/);
  });

  test('🔴 FAILS when the reader exists but names ANOTHER workflow', () => {
    const v = withReader("const WORKFLOW = 'some-other.yml';");
    assert.match(v.errors.join(' | '), /never mentions `nightly\.yml`/);
  });

  test('🔴 a COMMENT naming the workflow does not count — the real-tree defect', () => {
    const v = withReader("// this is the sibling of the guard that watches nightly.yml\nconst WORKFLOW = 'some-other.yml';");
    assert.match(v.errors.join(' | '), /never mentions `nightly\.yml`/);
  });

  test('a `trigger` duty owes no reader — it has no timer that can die', () => {
    const reg = scheduled({ row: { cadence: 'trigger', trigger: 'on push' }, mechanism: { readBy: 'a red check' } });
    const v = evaluate(
      reg,
      { workflows: ['ci.yml', 'nightly.yml'], paths: new Set([...tree.paths, '.github/workflows/nightly.yml']), readerSource: new Map() },
      NOW,
    );
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
  });
});

// ── [14]O-7 · a deploy is not trusted until the live surface agrees ──────────
// ⚠️ MUTATION-PROVEN ON THE REAL TREE FIRST: renaming the smoke invocation in
// `.github/workflows/deploy-web.yml` produced
// "deploy-web records a deployment for `subly-web` and never probes it".
describe('assert-ops-register — O-7: every recorded deployment is probed', () => {
  const withJobs = (deployJobs, exemptions) => {
    const reg = baseRegister();
    if (exemptions) reg._deploySmokeExemptions = exemptions;
    return evaluate(reg, { ...tree, deployJobs }, NOW);
  };

  test('PASSES when the job that records also probes', () => {
    const v = withJobs([{ workflow: 'deploy-web.yml', job: 'deploy-web', environment: 'subly-web', smokes: 1 }]);
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
    assert.match(v.prints.join(' | '), /1 deploy job\(s\) derived .*1 probe the surface they ship/);
  });

  test('🔴 FAILS when a job records a deployment and probes nothing', () => {
    const v = withJobs([{ workflow: 'deploy-web.yml', job: 'deploy-web', environment: 'subly-web', smokes: 0 }]);
    assert.match(v.errors.join(' | '), /records a deployment for `subly-web` and never probes it/);
  });

  test('🔴 a smoke in a SIBLING job does not cover this one', () => {
    // deploy-workers.yml ships two independent Workers; a file-level check would
    // certify both while touching one.
    const v = withJobs([
      { workflow: 'deploy-workers.yml', job: 'platform', environment: 'platform', smokes: 1 },
      { workflow: 'deploy-workers.yml', job: 'subly-api', environment: 'subly-api', smokes: 0 },
    ]);
    assert.match(v.errors.join(' | '), /records a deployment for `subly-api`/);
    assert.doesNotMatch(v.errors.join(' | '), /`platform`/);
  });

  test('a WRITTEN exemption prints instead of failing', () => {
    const v = withJobs([{ workflow: 'sites/nikatru', job: '(no job)', environment: 'site:nikatru', smokes: 0 }], {
      'site:nikatru': 'Cloudflare Git integration; covered by the external prober.',
    });
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
    assert.match(v.prints.join(' | '), /exempt: Cloudflare Git integration/);
  });

  test('an EMPTY exemption is not an exemption', () => {
    const v = withJobs([{ workflow: 'sites/x', job: '(no job)', environment: 'site:x', smokes: 0 }], { 'site:x': '   ' });
    assert.match(v.errors.join(' | '), /records a deployment for `site:x`/);
  });

  test('the exemption COUNT ignores the block\'s own prose keys', () => {
    // `0 exemptions` and `3 exemptions` must not read alike, and `_why` is not
    // an exemption.
    const v = withJobs([{ workflow: 'sites/x', job: '(no job)', environment: 'site:x', smokes: 0 }], {
      _why: ['a paragraph'],
      'site:x': 'covered by the prober',
    });
    assert.match(v.prints.join(' | '), /1 written exemption\(s\)/);
  });
});

describe('assert-ops-register — structural refusals', () => {
  test('a register with no rows is refused', () => {
    const r = baseRegister();
    r.rows = [];
    assert.match(run(r).errors.join(' '), /non-empty array/);
  });

  test('duplicate ids are refused — one of them is never read', () => {
    const r = baseRegister();
    r.rows.push({ ...r.rows[0] });
    assert.match(messages(r), /duplicate row id/);
  });

  test('an unknown kind is refused rather than skipped', () => {
    const r = baseRegister();
    r.rows[0].kind = 'vibes';
    assert.match(messages(r), /is not one of/);
  });

  test('a missing top-level key is refused', () => {
    const r = baseRegister();
    delete r._providers;
    assert.match(run(r).errors.join(' '), /has no `_providers`/);
  });

  test('a workflow with no duty row anchored at it FAILS', () => {
    const v = evaluate(baseRegister(), { workflows: ['ci.yml', 'brand-new.yml'], paths: tree.paths }, NOW);
    assert.match(v.errors.join(' '), /has NO `duty` row anchored at it/);
  });
});

describe('assert-ops-register — the helpers it depends on', () => {
  test('parseJsonc strips comments without eating the // inside a URL', () => {
    const o = parseJsonc('{\n// a comment\n"u": "https://x.example/y", /* block */ "n": 1,\n}');
    assert.equal(o.u, 'https://x.example/y');
    assert.equal(o.n, 1);
  });

  test('findWranglerConfigs separates live configs from the brick TEMPLATE', () => {
    const root = join(TMP, `w${seq++}`);
    mkdirSync(join(root, 'services/a'), { recursive: true });
    mkdirSync(join(root, 'tooling/bricks/app/__brick__/svc'), { recursive: true });
    writeFileSync(join(root, 'services/a/wrangler.jsonc'), '{}');
    writeFileSync(join(root, 'tooling/bricks/app/__brick__/svc/wrangler.jsonc'), '{}');
    const { found, excluded } = findWranglerConfigs(root);
    assert.deepEqual(found, ['services/a/wrangler.jsonc']);
    assert.equal(excluded.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 `stripComments` WAS A REGEX PAIR, AND IT SWALLOWED 103 LINES OF A REAL FILE.
//
// Measured 2026-08-07 against the committed tree. The old body ran the block
// regex FIRST and only then blanked `//` lines:
//
//     s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(...))
//
// so a `/*` sitting INSIDE a line comment was read as a block opener.
// tooling/ci/assert-ceiling-budget.mjs:32 is
//
//     //   3. every `const NAME = <number>` in services/*/src/ is annotated
//
// and the `/*` in `services/*/src/` opened a phantom block that ran to the next
// `*/` — blanking lines 32–134, INCLUDING the real code at :121
// `const CEILINGS = 'tooling/ceilings.json';`. Pre-fix, over that file:
//   raw includes 'ceilings.json' = true · stripped includes 'ceilings.json' = FALSE.
//
// [14]O-10 feeds this function's output to `readerSrc.includes(wfFile)`, so a
// reader whose only mention of its workflow lived in a swallowed region is
// reported as never mentioning it — a FALSE VERDICT from a guard that reads.
// Exactly the family assert-platform-register.mjs already paid for, where
// `app.use('/v1/plan/*', …)` hid 5 of 12 route mounts.
//
// THE FIX IS NOT A BETTER REGEX. Comments, strings and regex literals are one
// grammar and must be walked in ONE pass; this now delegates to
// text-reductions.mjs's `stripSourceComments`, which is the tokenizer nine
// guards already share, rather than becoming a fourth hand-rolled copy.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — stripComments is a tokenizer, not a pair of regexes', () => {
  test('🔴 a `/*` inside a LINE comment does not open a block', () => {
    const src = ['// scan services/*/src/ for ceilings', "const CEILINGS = 'tooling/ceilings.json';", 'let after = 1; /* real */ let tail = 2;'].join('\n');
    const out = stripComments(src);
    assert.match(out, /ceilings\.json/, 'the line comment ended at the newline; the code below it is code');
    assert.match(out, /let tail = 2;/, 'and everything up to the next `*/` was NOT swallowed');
    assert.doesNotMatch(out, /scan services/, 'the line comment itself is still gone');
  });

  test('🔴 THE REAL FILE: assert-ceiling-budget.mjs keeps its ceilings.json constant', () => {
    // The tree is the fixture. A fixture I wrote encodes the same
    // misunderstanding as the function I wrote; this one does not.
    const real = readFileSync(join(CI_DIR, 'assert-ceiling-budget.mjs'), 'utf8');
    assert.ok(real.includes("const CEILINGS = 'tooling/ceilings.json';"), 'premise: the constant is really there');
    assert.match(stripComments(real), /const CEILINGS = 'tooling\/ceilings\.json';/);
  });

  test('a `//` inside a string literal does not start a comment', () => {
    // ⚠️ `'https://x'` is NOT the falsifying input — the old regex required the
    // `//` to follow whitespace or a line start, and in `https://` it follows a
    // colon, so that probe passed against the broken function. An assertion that
    // cannot fail inflates coverage. A SPACE before the `//` is what fires it.
    const out = stripComments("bad('run node guard.mjs // then read it'); const n = 1;");
    assert.match(out, /then read it/, 'the message is a string, not a comment');
    assert.match(out, /const n = 1;/, 'and the statement after it is still code');
  });

  test('a `/*` inside a string literal does not open a block', () => {
    // The assert-platform-register.mjs defect, verbatim: a Hono route path whose
    // wildcard reads as a block opener, closed by a `*/` inside a LATER string.
    const out = stripComments(
      ["app.use('/v1/plan/*', platformAuth);", "app.route('/v1', cancellation);", "const note = 'the span closes here */';"].join('\n'),
    );
    assert.match(out, /cancellation/, 'the route after the `/*`-bearing path must survive');
    assert.match(out, /\/v1\/plan\/\*/);
  });

  test('a real block comment is still stripped', () => {
    const out = stripComments('/* app.route(ghost); */ real();');
    assert.doesNotMatch(out, /ghost/);
    assert.match(out, /real\(\);/);
  });

  test('a real line comment is still stripped — full-line and trailing', () => {
    assert.doesNotMatch(stripComments('// app.route(ghost);\nreal();'), /ghost/);
    assert.match(stripComments('// app.route(ghost);\nreal();'), /real\(\);/);
    assert.doesNotMatch(stripComments('real(); // ghost\n'), /ghost/);
  });

  test('the extension decides the comment grammar — and both grammars in the register REDUCE', () => {
    // An extension text-reductions.mjs does not know is returned VERBATIM. Every
    // `mechanism.readBy` in the real register is .mjs or .yml; assert both are
    // really reduced, so "unknown extension = identity" can never become a
    // silent no-op here without this test going red.
    const yaml = "on:\n  push:\n# ghost-workflow.yml\n    branches: ['main'] # ghost-trailing\n";
    const outY = stripComments(yaml, '.yml');
    assert.doesNotMatch(outY, /ghost-workflow\.yml/, '.yml must be read with `#` comments');
    assert.doesNotMatch(outY, /ghost-trailing/);
    assert.match(outY, /branches: \['main'\]/);
    assert.doesNotMatch(stripComments('// ghost\nreal();', '.mjs'), /ghost/);
  });
});

describe('assert-ops-register — [14]O-3 · the record-query limb, whose domain must never be empty', () => {
  // 🔴 WHAT THIS SUITE IS ABOUT. Until 2026-08-06 the cadence limb checked that
  // a duty row NAMED a `record`, a `readBy` and a `failingValue` — three
  // assertions about prose — while ClaudeTranscriptBackup and NikatruProjectBackup
  // returned LastTaskResult = 1 every night and this guard exited 0. The
  // acceptance asks for "a query against that mechanism's own record"; the real
  // negative test is the tree itself, and it is recorded in this file's footer.
  // What is exercised here is the CLASSIFICATION and the anti-vacuity rules,
  // which no probe can demonstrate.
  const NOW3 = Date.parse('2026-08-06T12:00:00Z');
  const readers = () => ({
    _maxUnreachable: 1,
    _maxUnreadable: 1,
    _windowMultiplier: 1.5,
    'windows-scheduled-task': { queries: 'Get-ScheduledTaskInfo', needs: 'win32' },
    unreachable: { queries: 'nothing', needs: 'n/a' },
  });
  const duty = (id, cadence, recordQuery) => ({
    id,
    kind: 'duty',
    what: 'a scheduled duty',
    detector: 'x',
    response: 'y',
    cadence,
    mechanism: { substrate: 'windows-task-scheduler', anchor: 'renovate.json', record: 'r', failingValue: 'f', readBy: 'b', recordQuery },
  });
  const reg3 = (rows, over = {}) => ({ _recordReaders: { ...readers(), ...over }, rows });
  const two = () => [
    duty('duty.win', '1d', { reader: 'windows-scheduled-task', task: 'T' }),
    duty('duty.box', '1d', { reader: 'unreachable', why: 'on a host nothing here can reach' }),
  ];
  const probesOf = (o) => new Map(Object.entries(o));

  test('a reachable record with a fresh SUCCESS passes, and the pass is counted', () => {
    const r = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 3_600_000, detail: 'ok' } }), NOW3);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.pass, 1);
  });

  test('🔴 THE REAL TREE\'S CASE: a reachable record whose only result is a FAILURE is RED, not stale-but-tolerated', () => {
    const r = evaluateRunRecords(
      reg3(two()),
      probesOf({ 'duty.win': { lastSuccessMs: NaN, detail: 'LastTaskResult = 1 at 2026-08-06T02:00:01Z.' } }),
      NOW3,
    );
    assert.match(r.errors.join(' | '), /duty\.win — its record IS reachable and holds NO SUCCESSFUL RUN AT ALL/);
  });

  test('a success OUTSIDE the 1.5x window is RED, and one INSIDE it is not — the margin is real', () => {
    const stale = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 37 * 3_600_000, detail: 'd' } }), NOW3);
    assert.match(stale.errors.join(' | '), /newest SUCCESSFUL run is 37\.0h old, outside its own window \[1d x 1\.5 = 36\.0h\]/);
    const fresh = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 35 * 3_600_000, detail: 'd' } }), NOW3);
    assert.deepEqual(fresh.errors, []);
  });

  test('a reader that could not run here PRINTS and never fails — "I could not tell" is not "it is fine", and not a build break either', () => {
    const r = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { unreadable: true, why: 'this runner is linux' } }), NOW3);
    assert.deepEqual(r.errors, []);
    assert.match(r.prints.join(' | '), /could not run here: this runner is linux/);
    assert.match(r.prints.join(' | '), /🔴 THE RECORD-QUERY LIMB ANSWERED ZERO QUERIES ON THIS RUN/);
  });

  // ── the held observation, which is what makes the verdict bind PER ROW ─────
  // 🔴 THE DEFECT THIS REPLACES, MEASURED. `_maxUnreadable` counts how many
  // readers are dark; it cannot see WHICH. On the Linux runner exactly 2 of 13
  // rows go unreadable against a ceiling of 7, so the ceiling never approaches —
  // and one of those 2 is the Windows backup, which is genuinely failing. The
  // guard was green because the only broken duty was the one nobody looked at.
  const OBS_FAIL = { verdict: 'fail', at: '2026-08-06T02:00:01Z', detail: 'LastTaskResult 4294770688 (0xFFFD0000) — not 0.' };
  const heldRows = (lastObserved) => {
    const rows = two();
    rows[0].mechanism.recordQuery = { reader: 'windows-scheduled-task', task: 'T', ...(lastObserved ? { lastObserved } : {}) };
    return rows;
  };
  const dark = { unreadable: true, why: 'this runner is linux' };

  test('🔴 THE HEADLINE: a dark reader on a row LAST SEEN FAILING is an ERROR, while the identical dark reader on a row holding nothing still only prints', () => {
    const held = evaluateRunRecords(reg3(heldRows(OBS_FAIL)), probesOf({ 'duty.win': dark }), NOW3);
    assert.match(held.errors.join(' | '), /duty\.win — reader `windows-scheduled-task` could not run here: this runner is linux AND the register holds its last readable observation as FAILING/);
    assert.match(held.errors.join(' | '), /4294770688/, 'the held evidence travels with the verdict, so the reader is not asked to take it on trust');
    assert.equal(held.stats.unreadable, 0, 'a known-bad row that went dark is counted as FAILING, not as unreadable');

    const unheld = evaluateRunRecords(reg3(heldRows(null)), probesOf({ 'duty.win': dark }), NOW3);
    assert.deepEqual(unheld.errors, [], 'SAME probe, SAME ceiling: without a held failure this is still "I could not tell"');
  });

  test('a held PASS does not redden a dark reader — the field is a memory of what was read, not a switch that fails the row', () => {
    const rows = heldRows({ verdict: 'pass', at: '2026-08-06T02:00:01Z', detail: 'LastTaskResult 0 at 02:00:01 UTC.' });
    const r = evaluateRunRecords(reg3(rows), probesOf({ 'duty.win': dark }), NOW3);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.unreadable, 1);
  });

  // ── C-6, applied to the sticky-fail branch with the register's own convention ──
  // The gate lifts the BLOCK on a runner that could not read the record. It does
  // not lift the verdict, the word, or the count: `tally.fail` is the same
  // counter either way, so the summary can never read `0 FAILING` about a duty
  // this register knows is failing.
  const gatedRows = (over = { ownerGated: true, ownerGap: 'CI cannot see a laptop.' }) => {
    const rows = heldRows(OBS_FAIL);
    Object.assign(rows[0], over);
    return rows;
  };

  test('🔴 THE GATE: an `ownerGated` row with a written `ownerGap` PRINTS its held failure instead of blocking — and the print names it FAILING, not merely unreadable', () => {
    const r = evaluateRunRecords(reg3(gatedRows()), probesOf({ 'duty.win': dark }), NOW3);
    assert.deepEqual(r.errors, [], 'owner-only work must not redden every runner — CLAUDE.md C-6');
    const p = r.prints.join(' | ');
    assert.match(p, /🔴 KNOWN FAILING, NOT BLOCKING HERE: duty\.win — reader `windows-scheduled-task` could not run here/);
    assert.match(p, /holds its last readable observation as FAILING/, 'a gated line that said only "unreadable" would give back the visibility the gate is paid for');
    assert.match(p, /4294770688/, 'the held evidence travels with the printed verdict too');
    assert.match(p, /OWNER-GATED, so it prints here and does not block \(CLAUDE\.md C-6\): CI cannot see a laptop\./);
  });

  test('🔴 THE COUNT IS THE SAME COUNTER: a gated failure is still inside `FAILING`, and the summary says how many of them are gated — a gate that shrank the number would be the old `0 FAILING` by another route', () => {
    const r = evaluateRunRecords(reg3(gatedRows()), probesOf({ 'duty.win': dark }), NOW3);
    assert.equal(r.stats.fail, 1, 'gating changes the exit code, never the verdict');
    assert.equal(r.stats.gatedFail, 1);
    assert.equal(r.stats.unreadable, 0, 'a known-bad row is never laundered back into "could not tell"');
    const summary = r.prints.find((l) => /scheduled duty\(ies\) ·/.test(l));
    assert.match(summary, /1 FAILING \(1 of them OWNER-GATED: printed, not blocking\)/);
    assert.doesNotMatch(summary, /0 FAILING/);
  });

  test('🔴 THE TEETH SURVIVE: the SAME dark reader and the SAME held failure still BLOCK without the gate — absent, half-declared, or on a readable failure the gate never reaches', () => {
    const ungated = evaluateRunRecords(reg3(gatedRows({})), probesOf({ 'duty.win': dark }), NOW3);
    assert.match(ungated.errors.join(' | '), /duty\.win — reader `windows-scheduled-task` could not run here/, 'no `ownerGated`: sticky-fail keeps its teeth');

    for (const half of [{ ownerGated: true }, { ownerGated: true, ownerGap: '   ' }, { ownerGated: 'true', ownerGap: 'a gap' }]) {
      const r = evaluateRunRecords(reg3(gatedRows(half)), probesOf({ 'duty.win': dark }), NOW3);
      assert.equal(r.errors.length, 1, `a gap nobody wrote is a waiver: ${JSON.stringify(half)}`);
      assert.equal(r.stats.gatedFail, 0);
    }

    // The gate is scoped to the DARK branch alone. On the host that CAN read the
    // record, an owner-gated row fails exactly as it did before — which is why
    // this change leaves the Windows runner red on the real backup duty.
    const readable = evaluateRunRecords(reg3(gatedRows()), probesOf({ 'duty.win': { lastSuccessMs: NaN, detail: 'LastTaskResult 4294770688 (0xFFFD0000).' } }), NOW3);
    assert.match(readable.errors.join(' | '), /its record IS reachable and holds NO SUCCESSFUL RUN AT ALL/);
    assert.equal(readable.stats.gatedFail, 0, 'gating a READABLE failure would be the weakening this is not');
  });

  test('🔴 A HELD FAILURE IS CLEARED ONLY WHERE THE RECORD CAN BE READ — a live healthy read FAILS until the row is updated, so the sticky state cannot rot into a permanent red', () => {
    const r = evaluateRunRecords(reg3(heldRows(OBS_FAIL)), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 3_600_000, detail: 'ok' } }), NOW3);
    assert.match(r.errors.join(' | '), /its record was QUERIED and is healthy .* still reads FAILING/);
    assert.match(r.errors.join(' | '), /Clear it HERE, on the host that can read this record/);
  });

  test('a held observation must carry a LOOKUP-ABLE detail and a real verdict — an adjective holds nothing, and this field is the whole per-row guarantee', () => {
    const bad = [
      { verdict: 'broken', at: '2026-08-06T02:00:01Z', detail: 'LastTaskResult 4294770688.' },
      { verdict: 'fail', at: '', detail: 'LastTaskResult 4294770688.' },
      { verdict: 'fail', at: '2026-08-06T02:00:01Z', detail: 'it was failing' },
      { verdict: 'fail', at: '2026-08-06T02:00:01Z' },
      'fail',
    ];
    for (const o of bad) {
      const r = evaluateRunRecords(reg3(heldRows(o)), probesOf({ 'duty.win': dark }), NOW3);
      assert.match(r.errors.join(' | '), /`recordQuery\.lastObserved` must be/, `must refuse ${JSON.stringify(o)}`);
    }
    const good = evaluateRunRecords(reg3(heldRows(OBS_FAIL)), probesOf({ 'duty.win': dark }), NOW3);
    assert.doesNotMatch(good.errors.join(' | '), /`recordQuery\.lastObserved` must be/);
  });

  test('a held observation on an `unreachable` row FAILS — nothing ever read that record, so there is no observation to hold', () => {
    const rows = two();
    rows[1].mechanism.recordQuery.lastObserved = OBS_FAIL;
    const r = evaluateRunRecords(reg3(rows), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 3_600_000, detail: 'ok' } }), NOW3);
    assert.match(r.errors.join(' | '), /duty\.box — `recordQuery\.lastObserved` on a row whose reader is `unreachable`/);
  });

  test('🔴 THE REAL TREE ON THE REAL CI RUNNER: with Task Scheduler absent, the shipped register\'s backup duty is RED — the state that printed clean in run 33001960316', () => {
    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const T = /^\d+[hd]$/;
    const scheduled = real.rows.filter((r) => r.kind === 'duty' && T.test(String(r.cadence ?? '')));
    const win = scheduled.filter((r) => r.mechanism?.recordQuery?.reader === 'windows-scheduled-task');
    // ⚠️ `win` IS LEGITIMATELY EMPTY SINCE 2026-09-02 and this test must not
    // demand otherwise. Its last member, duty.laptop.nikatru-daily-backup, moved
    // to `glitchtip-heartbeat` so the duty could be read from the Linux runner
    // this test is named after, and `windows-scheduled-task` is parked in
    // `_retiredReaders`. Re-asserting `win.length > 0` here would make the
    // register's own remedy — "delete it, or point a row at it" — impossible to
    // apply, which is a test holding a design in place rather than protecting a
    // property.
    //
    // 🔴 WHAT THE PROPERTY ACTUALLY WAS, AND WHERE IT LIVES NOW. This test's
    // subject is NOT Task Scheduler: it is "a duty last seen FAILING does not go
    // green by going dark on a runner that cannot read it". That is still
    // asserted, twice over — on fixtures at `a dark reader on a row held FAILING
    // …` above, and on the real committed row in the `glitchtip-heartbeat`
    // describe below, which drives the shipped register through a stale, a
    // miss-only and a 404 probe and requires RED for each. So the guarantee is
    // kept and only the reader carrying it changed. The loop below still runs
    // over every remaining member, and reddens the day one is re-declared and
    // starts holding a failure.
    if (win.length === 0) return;
    // The guard's own non-Windows branch, driven by argument rather than by host,
    // so this assertion means the same thing on the laptop and on the runner.
    const byTask = readScheduledTaskProbe(win.map((r) => r.mechanism.recordQuery.task), { platform: 'linux' });
    const probes = new Map();
    for (const r of win) probes.set(r.id, byTask.get(r.mechanism.recordQuery.task));
    // Every other reader answers healthy, so nothing below can be a side effect.
    for (const r of scheduled) if (!probes.has(r.id)) probes.set(r.id, { lastSuccessMs: NOW3 - 3_600_000, detail: 'stubbed healthy' });
    const r = evaluateRunRecords(real, probes, NOW3);
    for (const row of win) {
      const held = row.mechanism.recordQuery.lastObserved?.verdict === 'fail';
      if (!held) continue;
      // NOT GOING GREEN BY GOING DARK is the property; BLOCKING is only one of
      // its two channels. An `ownerGated` row prints the same verdict under the
      // KNOWN FAILING marker and does not block (CLAUDE.md C-6) — so the channel
      // is chosen by the row's own declaration, and the WORD is asserted either way.
      const gated = row.ownerGated === true;
      const channel = (gated ? r.prints : r.errors).join(' | ');
      const idRe = row.id.replace(/\./g, '\\.');
      assert.match(channel, new RegExp(`${gated ? '🔴 KNOWN FAILING, NOT BLOCKING HERE: ' : ''}${idRe} — reader \`windows-scheduled-task\``), `${row.id} must not go green by going dark on a Linux runner`);
      assert.match(channel, new RegExp(`${idRe}[^|]*holds its last readable observation as FAILING`), `${row.id} must be named FAILING, not merely unreadable`);
      if (gated) assert.doesNotMatch(r.errors.join(' | '), new RegExp(idRe), `${row.id} declares \`ownerGated\`, so it must not block CI on work only the owner can do`);
    }
    // The summary is the line a reader scans, and it is what said `0 FAILING`
    // through run 33001960316 while this duty was failing every night.
    const summary = r.prints.find((l) => /scheduled duty\(ies\) ·/.test(l));
    // Domain asked of the REGISTER, not of the guard's own output: with no held
    // failure left, `0 FAILING` is the true count and demanding otherwise lies.
    if (win.some((row) => row.mechanism.recordQuery.lastObserved?.verdict === 'fail')) {
      assert.doesNotMatch(summary, /0 FAILING/, 'the shipped register knows a duty is failing; the count must say so on the Linux runner too');
    }
  });

  test('a query that ANSWERS "the mechanism does not exist" is a hard failure — a stale row reads as coverage', () => {
    const r = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { missing: true, why: 'no scheduled task named "T"' } }), NOW3);
    assert.match(r.errors.join(' | '), /DOES NOT EXIST: no scheduled task named "T"/);
  });

  test('a scheduled duty with NO reader at all FAILS — it would be inside the count and outside the query', () => {
    const rows = two();
    delete rows[0].mechanism.recordQuery;
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /no `mechanism\.recordQuery\.reader`/);
  });

  test('an undeclared reader name FAILS — free text would let a row invent a reader nothing implements', () => {
    const rows = two();
    rows[0].mechanism.recordQuery = { reader: 'telepathy' };
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /is not declared in `_recordReaders`/);
  });

  test('`unreachable` with no `why` FAILS — "nothing can read it" may be recorded, never passed over', () => {
    const rows = two();
    rows[1].mechanism.recordQuery = { reader: 'unreachable' };
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /`reader: "unreachable"` with no `why`/);
  });

  test('🔴 EVERY duty declared unreachable is COVERAGE LOST — the escape hatch may not become the domain', () => {
    const rows = [duty('duty.a', '1d', { reader: 'unreachable', why: 'w' }), duty('duty.b', '1d', { reader: 'unreachable', why: 'w' })];
    const r = evaluateRunRecords(reg3(rows, { _maxUnreachable: 9 }), new Map(), NOW3);
    assert.ok(r.coverageLost, 'an all-unreachable register must be COVERAGE LOST');
    assert.match(r.coverageLost.join(' '), /Every outcome would then be a print, this limb could not fail/);
  });

  test('one more `unreachable` than the ceiling FAILS — the ratchet only goes down', () => {
    const rows = [...two(), duty('duty.box2', '1d', { reader: 'unreachable', why: 'w' })];
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /2 duty row\(s\) declare `reader: "unreachable"` and the ceiling is 1/);
  });

  test('one more `unreadable` than ITS ceiling FAILS — "could not tell" gets a limit too, and it is a failure above it', () => {
    const rows = [...two(), duty('duty.win2', '1d', { reader: 'windows-scheduled-task', task: 'T2' })];
    const dark = { unreadable: true, why: 'this runner is linux' };
    const r = evaluateRunRecords(reg3(rows), probesOf({ 'duty.win': dark, 'duty.win2': dark }), NOW3);
    assert.match(r.errors.join(' | '), /2 scheduled duty\(ies\) went UNREADABLE on this runner and the ceiling is 1/);
    assert.match(r.prints.join(' | '), /ANSWERED ZERO QUERIES/, 'the print stays; what changed is that it no longer stands alone');
    assert.equal(r.stats.unreachable, 1, 'the OTHER ceiling is untouched: one unreachable row, ceiling 1, no error about it');
    assert.doesNotMatch(r.errors.join(' | '), /declare `reader: "unreachable"` and the ceiling/);
  });

  test('🔴 DELETING `_maxUnreadable` is COVERAGE LOST, never "no limit" — an absent ceiling is the same defect one verdict over', () => {
    const readersNoCap = readers();
    delete readersNoCap._maxUnreadable;
    for (const bad of [undefined, 0.5, '3', -1, null]) {
      const over = bad === undefined ? readersNoCap : { ...readers(), _maxUnreadable: bad };
      const r = evaluateRunRecords({ _recordReaders: over, rows: two() }, probesOf({ 'duty.win': { unreadable: true, why: 'linux' } }), NOW3);
      assert.ok(r.coverageLost, `_maxUnreadable = ${String(bad)} must refuse, not soften`);
      assert.match(r.coverageLost.join(' '), /`_recordReaders\._maxUnreadable` is missing, or is not a non-negative integer/);
      assert.equal(r.errors, undefined, 'a structural refusal does not also return a problem list to be filtered down to nothing');
    }
  });

  test('`_maxUnreadable: 0` is a legal ceiling — a register may declare that NOTHING may go unread', () => {
    const r = evaluateRunRecords(reg3(two(), { _maxUnreadable: 0 }), probesOf({ 'duty.win': { unreadable: true, why: 'linux' } }), NOW3);
    assert.equal(r.coverageLost, undefined);
    assert.match(r.errors.join(' | '), /1 scheduled duty\(ies\) went UNREADABLE on this runner and the ceiling is 0/);
  });

  test('a declared reader no row uses FAILS — a reader with no member is code that cannot fail', () => {
    const r = evaluateRunRecords(reg3(two(), { 'file-stamp': { queries: 'an mtime', needs: 'the file' } }), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /`_recordReaders\.file-stamp` is declared and no row uses it/);
  });

  test('NO duty on a clock at all is COVERAGE LOST — moving every duty off a timer must not satisfy O-3', () => {
    const rows = [duty('duty.x', 'on-demand', { reader: 'unreachable', why: 'w' })];
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.ok(r.coverageLost);
    assert.match(r.coverageLost.join(' '), /ranges over the empty set/);
  });

  test('deleting `_recordReaders` entirely is COVERAGE LOST, not a silent return to checking prose', () => {
    const r = evaluateRunRecords({ rows: two() }, new Map(), NOW3);
    assert.ok(r.coverageLost);
    assert.match(r.coverageLost.join(' '), /`_recordReaders` is missing/);
  });

  test('a window multiplier under 1 FAILS — a window shorter than the cadence reports a healthy duty dead', () => {
    const r = evaluateRunRecords(reg3(two(), { _windowMultiplier: 0.5 }), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /_windowMultiplier` must be a number >= 1/);
  });
});

describe('assert-ops-register — [14]O-3 · the Windows scheduled-task probe, and THE INVERSION it used to perform', () => {
  // ══ 🔴 WHAT THIS SUITE PINS · MEASURED ON THE LAPTOP 2026-08-26 ═════════════
  // `probeWindowsTasks` emitted `result=[int]$i.LastTaskResult`. `LastTaskResult`
  // is a System.UInt32 holding an HRESULT-shaped value, and this host's real
  // value for "NIKATRU daily backup" is 4294770688 (0xFFFD0000).
  //
  //     [int]4294770688  ->  THROWS "Value was either too large or too small
  //                          for an Int32."
  //
  // The throw landed in the probe's OWN catch, the catch wrote `found=$false`,
  // and the guard printed `no scheduled task named "NIKATRU daily backup"
  // exists on this host` — while Get-ScheduledTask showed it Ready at TaskPath
  // `\` with LastRunTime 2026-08-26 10:00:00 and NextRunTime the same evening.
  //
  // 🔴 THE INVERSION, which is what these cases exist to pin: a task that
  // SUCCEEDS carries a small result (0) that casts fine and reports healthy; a
  // task that FAILS carries a large HRESULT that overflowed and was reported as
  // NOT EXISTING. The probe was reliable ONLY while nothing was wrong. It
  // converted its most important possible finding — "your scheduled duty is
  // running and failing" — into a quieter and WRONG one, "you never set it up",
  // which sends a reader off to create a task that already exists.
  //
  // These drive the PURE seam (`readScheduledTaskProbe` / `classifyScheduledTaskRow`)
  // with fixture rows, exactly as the block above drives `evaluateRunRecords`
  // with `probesOf`. NOTHING here touches this host's real Task Scheduler:
  // `probeWindowsTasks` short-circuits on `process.platform !== 'win32'` and CI
  // runs on Linux, so a suite that depended on a real task would be vacuous
  // there and non-deterministic here.
  // ═══════════════════════════════════════════════════════════════════════════

  const NAME = 'NIKATRU daily backup';
  // The exact JSON the fixed PowerShell emitter produces, per state.
  const spawnOf = (rows) => ({ platform: 'win32', error: null, status: 0, stdout: JSON.stringify(rows) });
  const probeOne = (row, names = [NAME]) => readScheduledTaskProbe(names, spawnOf([row])).get(names[0]);

  test('🔴 THE REGRESSION THAT MATTERS — a LastTaskResult too large for Int32 is "EXISTS AND IS FAILING", NEVER "missing". RED before the [int]->[long] fix: [int]4294770688 threw, the throw hit the probe\'s own catch, and 0xFFFD0000 was reported as an absent task.', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00.0000000Z', result: 4294770688, why: null });
    assert.equal(p.missing, undefined, 'a FAILING task reported as MISSING is the whole defect — it sends a reader to create a task that already exists');
    assert.equal(p.unreadable, undefined, 'the query answered; this is not "I could not tell"');
    assert.ok(Number.isNaN(p.lastSuccessMs), 'a non-zero result is no successful run');
    assert.match(p.detail, /EXISTS AND IS FAILING/);
    assert.match(p.detail, /THIS IS NOT A MISSING TASK/);
    assert.match(p.detail, /RAN at 2026-08-26T04:30:00\.0000000Z/, 'the run time proves the schedule fired — "dead" and "firing and failing" are different facts');
  });

  test('🔴 the decimal ALONE is unactionable — the failing verdict prints the HRESULT shape 0xFFFD0000 beside it, and claims nothing about what the code means', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00.0000000Z', result: 4294770688, why: null });
    assert.match(p.detail, /4294770688 \(0xFFFD0000\)/);
    assert.equal(formatTaskResult(4294770688), '4294770688 (0xFFFD0000)');
    assert.equal(formatTaskResult(0), '0 (0x00000000)');
    assert.equal(formatTaskResult(267011), '267011 (0x00041303)');
    // A signed Int32 carrying the same bit pattern decodes to the SAME hex, which
    // is the point of [long]: both shapes survive and print identically.
    assert.equal(formatTaskResult(-131072), '-131072 (0xFFFE0000)');
  });

  test('🔴 THE OTHER END OF THE RANGE, which `[uint32]` would have reintroduced: a NEGATIVE Int32 result is also "exists and failing", not missing and not unreadable', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: -131072, why: null });
    assert.equal(p.missing, undefined);
    assert.match(p.detail, /EXISTS AND IS FAILING/);
    assert.match(p.detail, /-131072 \(0xFFFE0000\)/);
  });

  test('STATE 1 — the task does not exist: an ANSWERED ObjectNotFound is `missing`, the hard failure a stale register row deserves', () => {
    const p = probeOne({ task: NAME, state: 'absent', lastRun: null, result: null, why: 'CimException: The system cannot find the file specified.' });
    assert.equal(p.missing, true);
    assert.equal(p.unreadable, undefined);
    assert.match(p.why, /no scheduled task named "NIKATRU daily backup" exists on this host/);
    assert.match(p.why, /answered ObjectNotFound, it did not merely fail to be read/);
  });

  test('STATE 2 — the task exists and its last result is 0: the ONLY healthy outcome, and it carries a real lastSuccessMs', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: 0, why: null });
    assert.equal(p.missing, undefined);
    assert.equal(p.unreadable, undefined);
    assert.equal(p.lastSuccessMs, Date.parse('2026-08-26T04:30:00Z'));
    assert.match(p.detail, /SUCCEEDED \(LastTaskResult = 0 \(0x00000000\)\)/);
  });

  test('STATE 3 — the task exists and has NEVER RUN: 267011 = SCHED_S_TASK_HAS_NOT_RUN is not a failure and not an absence, and it is named as itself', () => {
    const byCode = probeOne({ task: NAME, state: 'read', lastRun: '1899-12-30T00:00:00Z', result: 267011, why: null });
    assert.equal(byCode.missing, undefined);
    assert.equal(byCode.unreadable, undefined);
    assert.ok(Number.isNaN(byCode.lastSuccessMs));
    assert.match(byCode.detail, /HAS NEVER RUN/);
    // 267011 with a plausible LastRunTime must still read as never-run: the code
    // is the authority, not the timestamp.
    const codeWins = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: 267011, why: null });
    assert.match(codeWins.detail, /HAS NEVER RUN — LastTaskResult = 267011 \(0x00041303\) = SCHED_S_TASK_HAS_NOT_RUN/);
    // And a missing LastRunTime is never-run even with no code at all.
    const noTime = probeOne({ task: NAME, state: 'read', lastRun: null, result: null, why: null });
    assert.match(noTime.detail, /HAS NEVER RUN — it reports no usable LastRunTime/);
    assert.equal(noTime.unreadable, undefined, 'a null LastTaskResult with a null LastRunTime is "never ran", not "unreadable"');
  });

  test('🔴 STATE 0 — a catch that is NOT "no such task" is `unreadable` WITH the message, never `missing`. This is the collapse that let an overflow impersonate an absent task.', () => {
    const p = probeOne({ task: NAME, state: 'threw', lastRun: null, result: null, why: 'InvalidCastException: Value was either too large or too small for an Int32.' });
    assert.equal(p.missing, undefined, '"something else threw" must NEVER be reported as "the task does not exist"');
    assert.equal(p.unreadable, true);
    assert.match(p.why, /was NOT "no such task"/);
    assert.match(p.why, /Value was either too large or too small for an Int32/, 'the message must survive, or the next reader cannot tell what broke');
    assert.match(p.why, /neither "it is fine" nor "it is absent"/);
  });

  test('a row with NO recognisable state at all is `unreadable` — the row-classifier has no default that means "fine" and none that means "absent"', () => {
    for (const bad of [undefined, null, '', 'found', true]) {
      const p = classifyScheduledTaskRow({ task: NAME, state: bad, lastRun: null, result: null, why: null });
      assert.equal(p.unreadable, true, 'state=' + JSON.stringify(bad ?? null) + ' must be unreadable');
      assert.equal(p.missing, undefined);
      assert.equal(p.lastSuccessMs, undefined);
      assert.match(p.why, /no usable state for "NIKATRU daily backup"/);
    }
  });

  test('powershell unavailable is `unreadable` for every name — a probe that could not run is not a probe that found nothing', () => {
    const byError = readScheduledTaskProbe([NAME, 'Other'], { platform: 'win32', error: new Error('spawnSync powershell ENOENT'), status: null, stdout: '' });
    for (const n of [NAME, 'Other']) {
      assert.equal(byError.get(n).unreadable, true);
      assert.equal(byError.get(n).missing, undefined);
      assert.match(byError.get(n).why, /powershell could not be run here \(spawnSync powershell ENOENT\)/);
    }
    const byStatus = readScheduledTaskProbe([NAME], { platform: 'win32', error: null, status: 1, stdout: '' });
    assert.match(byStatus.get(NAME).why, /powershell could not be run here \(exit 1\)/);
  });

  test('a NON-WINDOWS runner is `unreadable`, which is why this suite never asks the host for a real task — CI runs on Linux and would otherwise assert nothing', () => {
    const p = readScheduledTaskProbe([NAME], { platform: 'linux' });
    assert.equal(p.get(NAME).unreadable, true);
    assert.equal(p.get(NAME).missing, undefined);
    assert.match(p.get(NAME).why, /this runner is linux, and Task Scheduler exists only on the Windows host/);
  });

  test('output that is not the expected JSON is `unreadable`, in BOTH its shapes — unparseable, and parseable-but-not-an-array', () => {
    const junk = readScheduledTaskProbe([NAME], { platform: 'win32', error: null, status: 0, stdout: 'Get-ScheduledTaskInfo : boom' });
    assert.equal(junk.get(NAME).unreadable, true);
    assert.match(junk.get(NAME).why, /output was not JSON/);
    const notArray = readScheduledTaskProbe([NAME], { platform: 'win32', error: null, status: 0, stdout: '{"task":"x"}' });
    assert.equal(notArray.get(NAME).unreadable, true);
    assert.match(notArray.get(NAME).why, /parsed as JSON but was not the array of task rows/);
  });

  test('🔴 SILENCE ABOUT A NAME IS `unreadable`, NOT `missing` — a dropped row must not impersonate an absent task any more than an overflow may', () => {
    const p = readScheduledTaskProbe([NAME, 'Never mentioned'], spawnOf([{ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: 0, why: null }]));
    assert.equal(p.get(NAME).lastSuccessMs, Date.parse('2026-08-26T04:30:00Z'));
    assert.equal(p.get('Never mentioned').unreadable, true);
    assert.equal(p.get('Never mentioned').missing, undefined);
    assert.match(p.get('Never mentioned').why, /returned no row for "Never mentioned" at all/);
  });

  test('🔴 A RESULT THAT ARRIVES AS A STRING IS `unreadable`, NOT a failure — `=== 0` against "0" is silently false and would report a HEALTHY task as failing', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: '0', why: null });
    assert.equal(p.unreadable, true);
    assert.equal(p.missing, undefined);
    assert.ok(!('lastSuccessMs' in p), 'no verdict may be produced from a value that cannot be compared');
    assert.match(p.why, /arrived as a string \("0"\) rather than a number/);
  });

  test('a task that RAN but returned no LastTaskResult at all is `unreadable` — "it ran" without "how it ended" is not a success', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: null, why: null });
    assert.equal(p.unreadable, true);
    assert.equal(p.missing, undefined);
    assert.match(p.why, /no LastTaskResult came back at all/);
  });

  test('🔴 END TO END THROUGH `evaluateRunRecords`: the overflowing result reaches the guard as a RED "no successful run", and the printed line says EXISTS AND IS FAILING rather than DOES NOT EXIST', () => {
    const NOWW = Date.parse('2026-08-26T12:00:00Z');
    const readers = {
      _maxUnreachable: 1,
      _maxUnreadable: 1,
      _windowMultiplier: 1.5,
      'windows-scheduled-task': { queries: 'Get-ScheduledTaskInfo', needs: 'win32' },
      unreachable: { queries: 'nothing', needs: 'n/a' },
    };
    const row = (id, recordQuery) => ({
      id,
      kind: 'duty',
      what: 'a scheduled duty',
      detector: 'x',
      response: 'y',
      cadence: '1d',
      mechanism: { substrate: 'windows-task-scheduler', anchor: 'renovate.json', record: 'r', failingValue: 'f', readBy: 'b', recordQuery },
    });
    const reg = {
      _recordReaders: readers,
      rows: [
        row('duty.laptop.nikatru-daily-backup', { reader: 'windows-scheduled-task', task: NAME }),
        row('duty.box', { reader: 'unreachable', why: 'on a host nothing here can reach' }),
      ],
    };
    const probe = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00.0000000Z', result: 4294770688, why: null });
    const r = evaluateRunRecords(reg, new Map([['duty.laptop.nikatru-daily-backup', probe]]), NOWW);
    const joined = r.errors.join(' | ');
    assert.match(joined, /duty\.laptop\.nikatru-daily-backup — its record IS reachable and holds NO SUCCESSFUL RUN AT ALL/);
    assert.match(joined, /EXISTS AND IS FAILING/);
    assert.match(joined, /4294770688 \(0xFFFD0000\)/);
    assert.doesNotMatch(joined, /DOES NOT EXIST/, 'THE INVERSION: the old code path put this exact row here, as an absent task');
  });
});

describe('assert-ops-register — [14]O-11 / [14]O-17 · a tolerance that cannot fail is not a tolerance', () => {
  // Both requirements shipped BUILT with an empty domain: twelve `expiring` rows
  // and zero executed lead-window comparisons; nineteen `retention` rows and
  // zero declared periods. The decision was to KEEP both tolerances — the dates
  // and the periods are genuinely not this repository's to know — and to make
  // each cost something that can go red.
  const withExpiry = (extra) => {
    const r = baseRegister();
    r.rows.push({
      id: 'expiring.thing',
      kind: 'expiring',
      what: 'a thing that expires',
      detector: 'this row',
      response: 'renew it',
      cadence: '180d',
      leadDays: 30,
      expires: null,
      expiryKnownAt: 'a vendor console',
      ownerGated: true,
      ownerGap: 'console-only',
      mechanism: { substrate: 'x', anchor: 'Private/runbooks/operations.md', record: 'r', failingValue: 'f', readBy: 'nothing yet' },
      accessProviders: ['cloudflare'],
      source: 'verified',
      ...extra,
    });
    return r;
  };

  test('a null expiry with no `expiryKnownAt` FAILS — the tolerance must name its source', () => {
    assert.match(messages(withExpiry({ expiryKnownAt: undefined })), /must carry `expiryKnownAt`/);
  });

  test('one more null expiry than the ceiling FAILS — the ratchet only goes down', () => {
    const r = withExpiry({});
    r.rows.push({ ...r.rows[r.rows.length - 1], id: 'expiring.second' });
    assert.match(messages(r), /2 `expiring` row\(s\) carry `expires: null` and the ceiling is 1/);
  });

  test('the executed-comparison count PRINTS, and reads 0 while every date is null', () => {
    const p = run(withExpiry({})).prints.join(' | ');
    assert.match(p, /\[14\]O-11 — 1 expiring row\(s\) · 0 lead-window comparison\(s\) ACTUALLY EXECUTED · 1 expiry UNREAD/);
    assert.match(p, /THE LEAD-WINDOW ARITHMETIC RAN ZERO TIMES ON THIS RUN/);
  });

  test('once a real date lands the count moves — the print is measuring, not decorating', () => {
    const far = new Date(NOW + 300 * 86_400_000).toISOString().slice(0, 10);
    const p = run(withExpiry({ expires: far, ownerGated: false, ownerGap: undefined })).prints.join(' | ');
    assert.match(p, /1 lead-window comparison\(s\) ACTUALLY EXECUTED · 0 expiry UNREAD/);
    assert.doesNotMatch(p, /RAN ZERO TIMES/);
  });

  test('a declared `period` with no `deletingJob` FAILS — O-17 is "deleted on schedule, BY A JOB"', () => {
    const r = baseRegister();
    r.rows.push({
      id: 'retention.events',
      kind: 'retention',
      store: 'd1:platform_db:events',
      what: 'analytics events',
      rule: 'period',
      periodDays: 365,
      detector: 'the coverage guard',
      response: 'the sweep',
      cadence: '365d',
      mechanism: { substrate: 'cloudflare-d1', anchor: 'Private/runbooks/operations.md', record: 'the table', failingValue: 'a row older than the period', readBy: 'the coverage guard' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });
    assert.match(messages(r), /`rule: period` with no `deletingJob`/);
  });

  test('one more undeclared period than the ceiling FAILS, and the count prints while it is 0 declared', () => {
    const r = baseRegister();
    const row = (id) => ({
      id,
      kind: 'retention',
      store: `kv:${id}`,
      what: 'a store',
      rule: 'period-undeclared',
      detector: 'the coverage guard',
      response: 'stage 8 owns the number',
      cadence: '365d',
      ownerGated: true,
      ownerGap: 'the period is a policy decision',
      mechanism: { substrate: 'cloudflare-kv', anchor: 'Private/runbooks/operations.md', record: 'the store', failingValue: 'a key older than the period', readBy: 'the coverage guard' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });
    r.rows.push(row('retention.one'));
    assert.match(run(r).prints.join(' | '), /\[14\]O-17 — 1 retention row\(s\) · 0 declare a PERIOD/);
    r.rows.push(row('retention.two'));
    assert.match(messages(r), /2 retention row\(s\) carry `rule: period-undeclared` and the ceiling is 1/);
  });
});

describe('assert-ops-register — a named READER must exist, not merely be named', () => {
  // The register's first draft named `tooling/ci/assert-update-coverage.mjs` as
  // the reader for the dependency duty. That file has never existed — so the row
  // asserted a live reader for a duty nothing reads, which is the "zero readers"
  // defect reproduced inside the file written to end it. `.anchor` was checked;
  // `.readBy` — the field carrying the claim that matters — was not.
  const withPath = (field, value) => {
    const r = baseRegister();
    if (field.startsWith('mechanism.')) r.rows[0].mechanism[field.slice(10)] = value;
    else r.rows[0][field] = value;
    return r;
  };

  test('a `mechanism.readBy` naming a guard that does not exist FAILS', () => {
    assert.match(messages(withPath('mechanism.readBy', 'tooling/ci/assert-imaginary.mjs')), /which is not in the tree/);
  });

  test('a `detector` naming a guard that does not exist FAILS', () => {
    assert.match(messages(withPath('detector', 'checked by tooling/ci/assert-nope.mjs on every push')), /which is not in the tree/);
  });

  test('a `mechanism.record` naming a workflow that does not exist FAILS', () => {
    assert.match(messages(withPath('mechanism.record', 'the run history of .github/workflows/gone.yml')), /which is not in the tree/);
  });

  test('a reader that DOES exist passes', () => {
    assert.deepEqual(run(withPath('mechanism.readBy', 'renovate.json')).errors, []);
  });

  test('prose with no path in it is left alone — this is not a spell-checker', () => {
    assert.deepEqual(run(withPath('mechanism.readBy', 'a human reading the Dependency Dashboard issue')).errors, []);
  });

  test('a Private/ path is NOT treated as a missing file, because CI cannot see Private/', () => {
    assert.deepEqual(run(withPath('mechanism.readBy', 'Private/runbooks/operations.md §0')).errors, []);
  });
});

describe('assert-ops-register — end to end, against the real repository', () => {
  // 🔴 THIS TEST USED TO ASSERT `status === 0` AND THAT IS NO LONGER A CLAIM IT
  // MAY MAKE. From 2026-08-06 the [14]O-3 limb QUERIES each mechanism's own run
  // record, and on the Windows host two of the three Task Scheduler duties are
  // genuinely returning LastTaskResult = 1 — so a red run there is the guard
  // working, not the register being malformed. On a Linux runner that reader is
  // DARK, which on a row last seen FAILING is red too — the second shape below.
  //
  // Asserting 0 would therefore be asserting "no duty is currently failing",
  // which is a fact about the owner's laptop rather than about this file, and
  // the fix everybody reaches for when it goes red is to delete the query.
  // Asserting nothing would be worse. So the claim is the one that IS this
  // file's: THE REGISTER IS STRUCTURALLY SOUND — every problem, if any, must be
  // a record-query verdict about a failing duty, never a schema, coverage or
  // delegation error. A structural break still reddens this test on every OS.
  const realGuard = () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: resolve(CI_DIR, '..', '..'), encoding: 'utf8' });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  /** The record-query verdicts that ARE "a duty is failing": a reachable record
   *  with no success (or none inside the window), a mechanism that is gone, and
   *  a dark reader on a row held FAILING. */
  const DUTY_IS_FAILING = /its record IS reachable and (holds NO SUCCESSFUL RUN AT ALL|the newest SUCCESSFUL run)|the mechanism its `recordQuery` names DOES NOT EXIST|reader `[^`]+` .+ AND the register holds its last readable observation as FAILING \(/;

  // ── 🔴 THE FIFTH SHAPE, AND WHY IT IS DELIBERATELY NOT IN THE SET ABOVE ────
  // `classifyRunRecord` emits one more failing shape — HELD-BUT-HEALTHY — the
  // first time a host READS A SUCCESS while `recordQuery.lastObserved` still
  // says `fail`. MEASURED 2026-08-27 by driving the guard's own classifier with
  // the committed duty.laptop.nikatru-daily-backup row and a healthy probe:
  // verdict `fail`, no `gated` flag (so it BLOCKS), and its line matched NONE of
  // the four shapes above. So on the day 0xFFFD0000 is repaired, this test would
  // have gone red on the laptop calling a guard doing exactly its job a
  // "structural break".
  //
  // THE JUDGEMENT, so the next reader need not re-derive it: held-but-healthy is
  // NOT a duty that is failing — the record was queried and holds a fresh
  // success — so widening DUTY_IS_FAILING to swallow it would make this
  // describe's own sentence false. It is A REGISTER TO REPAIR: one stale field,
  // in the very file this test is about. The VERDICT (red) was already right;
  // only the MESSAGE was wrong, and the message is what decides whether the next
  // reader deletes one field or deletes the check.
  const HELD_BUT_HEALTHY = /its record was QUERIED and is healthy .+ still reads FAILING \(/;

  test('the committed register is STRUCTURALLY sound — any failure is a duty that is failing, not a malformed register', () => {
    const { code, out } = realGuard();
    if (code === 0) return;
    const problems = out
      .split('\n')
      .filter((l) => /^ {4}\S/.test(l))
      .map((l) => l.trim());
    assert.ok(problems.length > 0, `exit ${code} with no itemised problems:\n${out}`);
    // The structural claim is checked over EVERY line FIRST.
    const stale = problems.filter((p) => HELD_BUT_HEALTHY.test(p));
    for (const p of problems) {
      if (stale.includes(p)) continue;
      assert.match(
        p,
        DUTY_IS_FAILING,
        `a NON-record problem in the committed register — this is a structural break and must be fixed, not tolerated:\n${p}`,
      );
    }
    assert.equal(
      stale.length,
      0,
      'A HELD FAILURE HAS OUTLIVED THE FAILURE IT RECORDS, AND THE GUARD IS WORKING. This duty\'s record was ' +
        'queried and holds a fresh success; what is stale is one field of tooling/ops/register.json. THE REPAIR ' +
        'IS A DELETION, on a host that can read this record: remove ' +
        '`mechanism.recordQuery.lastObserved` from the row named below. Do NOT delete the `recordQuery`, and do ' +
        `NOT widen the accepted-shape pattern:\n${stale.join('\n')}`,
    );
  });

  test('🔴 held-but-healthy is CLASSIFIED, not forgotten — the two patterns partition it, and neither may quietly swallow it', () => {
    // The state fires no earlier than the day the backup is repaired, so the
    // subject is BUILT, not found: a committed scheduled row with a FAILING
    // observation attached, and the probe that host returns once 0xFFFD0000 is
    // gone. Built, so the deletion the test above orders cannot empty this test.
    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const readable = real.rows.filter(
      (r) =>
        r.kind === 'duty' &&
        /^\d+[hd]$/.test(String(r.cadence ?? '')) &&
        typeof r?.mechanism?.recordQuery?.reader === 'string' &&
        r.mechanism.recordQuery.reader !== 'unreachable',
    );
    assert.ok(readable.length > 0, 'no committed duty row carries a readable record query, so nothing here could be classified');
    const built = JSON.parse(JSON.stringify(readable[0]));
    built.mechanism.recordQuery.lastObserved = { verdict: 'fail', at: '2026-08-06T02:00:01Z', detail: 'LastTaskResult 4294770688.' };
    const held = real.rows.filter((r) => r?.mechanism?.recordQuery?.lastObserved?.verdict === 'fail');
    const NOWH = Date.parse('2026-08-27T04:00:00Z');
    for (const row of [built, ...held]) {
      const c = classifyRunRecord(
        row,
        { lastSuccessMs: NOWH - 2 * 3_600_000, detail: 'LastTaskResult 0.' },
        NOWH,
        real._recordReaders._windowMultiplier,
      );
      assert.equal(c.verdict, 'fail', `${row.id}: a live healthy read must still fail while the held failure stands`);
      assert.match(c.line, HELD_BUT_HEALTHY, `${row.id}: the repair branch must own this line, or the message reverts to "structural break"`);
      assert.doesNotMatch(c.line, DUTY_IS_FAILING, `${row.id}: held-but-healthy is not a duty that is failing, and accepting it here would make this describe's own claim false`);
    }
  });

  test('🔴 A MALFORMED REGISTER IS STILL REJECTED — seven real mutations of the committed file, none reaching either accepting branch', () => {
    // The half that matters about the branch above: it must not have become an
    // escape hatch. Every line below is the GUARD'S OWN, harvested by mutating
    // the committed register and running the real limb over it — not prose a
    // fixture author wrote to match a pattern they also wrote.
    const NOWM = Date.parse('2026-08-27T04:00:00Z');
    const real = () => JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const byId = (reg, id) => {
      const row = reg.rows.find((x) => x.id === id);
      assert.ok(row, `${id} is gone from the register, so this mutation would range over nothing`);
      return row;
    };
    const healthyProbes = (reg) => {
      const m = new Map();
      for (const r of reg.rows) if (r.kind === 'duty' && /^\d+[hd]$/.test(String(r.cadence ?? ''))) m.set(r.id, { lastSuccessMs: NOWM - 2 * 3_600_000, detail: 'stubbed healthy' });
      return m;
    };
    const cases = [
      ['a scheduled duty loses its query', (r) => { delete byId(r, 'duty.workflow.e2e.yml').mechanism.recordQuery; }, /no `mechanism\.recordQuery\.reader`/],
      ['a reader nothing declares', (r) => { byId(r, 'duty.workflow.e2e.yml').mechanism.recordQuery.reader = 'invented-reader'; }, /is not declared in `_recordReaders`/],
      ['a held observation stated as an adjective', (r) => { byId(r, 'duty.laptop.nikatru-daily-backup').mechanism.recordQuery.lastObserved = { verdict: 'fail', at: '2026-08-27T03:34:00Z', detail: 'it was failing' }; }, /`recordQuery\.lastObserved` must be/],
      ['a held observation on a row nothing has ever read', (r) => { byId(r, 'duty.oci.disk-alert').mechanism.recordQuery.lastObserved = { verdict: 'fail', at: '2026-08-27T03:34:00Z', detail: 'LastTaskResult 4294770688.' }; }, /on a row whose reader is `unreachable`/],
      ['`unreachable` with no `why`', (r) => { delete byId(r, 'duty.oci.disk-alert').mechanism.recordQuery.why; }, /`reader: "unreachable"` with no `why`/],
      ['a declared reader no row uses', (r) => { r._recordReaders['file-stamp'] = { queries: 'an mtime', needs: 'the file' }; }, /is declared and no row uses it/],
      ['the unreachable ceiling breached', (r) => { r._recordReaders._maxUnreachable = 0; }, /and the ceiling is 0/],
    ];
    for (const [name, mutate, expected] of cases) {
      const reg = real();
      mutate(reg);
      const errs = evaluateRunRecords(reg, healthyProbes(reg), NOWM).errors ?? [];
      const hit = errs.find((e) => expected.test(e));
      assert.ok(hit, `${name}: the guard did not emit its own ${expected} — the mutation landed on nothing:\n${errs.join('\n')}`);
      assert.doesNotMatch(hit, HELD_BUT_HEALTHY, `${name}: the held-but-healthy repair branch must not swallow a structural problem:\n${hit}`);
      assert.doesNotMatch(hit, DUTY_IS_FAILING, `${name}: a structural problem must not read as a failing duty:\n${hit}`);
    }
  });

  test('the [14]O-3 record limb actually ran, and says how many records it queried', () => {
    // Without this the previous test is satisfiable by a guard that stopped
    // querying entirely — the defect the whole limb replaces, one level up.
    const { out } = realGuard();
    assert.match(out, /\[14\]O-3 — \d+ scheduled duty\(ies\) · \d+ record\(s\) QUERIED/);
  });

  test('the [14]O-11 and [14]O-17 execution counts print on every run', () => {
    const { out } = realGuard();
    assert.match(out, /\[14\]O-11 — \d+ expiring row\(s\) · \d+ lead-window comparison\(s\) ACTUALLY EXECUTED/);
    assert.match(out, /\[14\]O-17 — \d+ retention row\(s\) · \d+ declare a PERIOD/);
  });

  test('a repository with no operations register is COVERAGE LOST, not a quiet pass', () => {
    const root = join(TMP, `e${seq++}`);
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'name: CI\n');
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(`${r.stdout}\n${r.stderr}`, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE DIGEST THAT READ THIS GUARD AND REPORTED THE OPPOSITE OF WHAT IT SAID.
//
// ops-watch.yml's `digest` job collects three readers into one weekly issue. Two
// of them were written correctly; the third — this guard — was one piped line:
//
//     node tooling/ci/assert-ops-register.mjs 2>&1 | grep -E '^(⬜|⚠)' || echo '(none printed)'
//
// It was wrong twice, in the same direction:
//   · A PIPELINE'S STATUS IS ITS LAST STAGE'S. The digest recorded grep's exit,
//     never the guard's — the exact `$?`-after-a-pipe trap CLAUDE.md records
//     costing three guard checks on 2026-08-05.
//   · THE FILTER DROPPED EVERY FAILURE LINE. This guard writes problems as
//     `✗ …` with indented detail; neither shape starts with ⬜ or ⚠. So a
//     register in COVERAGE LOST rendered in the weekly digest as one line:
//     "(none printed)" — the most reassuring possible presentation of a red check.
//
// MEASURED before the repair, with a stub reader that prints a `✗` line and
// exits 1: the old form printed `exit: 0` and no failure line; the new form
// printed the failure lines and `exit: 1`.
//
// The cases below are STRUCTURAL, against the real workflow, and that is a
// deliberate limit: the defect is a shell property, and executing the fragment
// would make this suite depend on `bash` being on PATH — which it is on the CI
// runner and is not reliably on the owner's Windows host, so the test would fail
// for the wrong reason on half the machines that run it. What they encode is
// exactly the two halves above, each of which reddens if the piped form returns.
// ─────────────────────────────────────────────────────────────────────────────
describe('the weekly digest must report this guard\'s verdict, not grep\'s', () => {
  const OPS_WATCH = resolve(CI_DIR, '..', '..', '.github', 'workflows', 'ops-watch.yml');
  const yaml = () => readFileSync(OPS_WATCH, 'utf8');
  /** The digest's collector step, comments removed, so prose about the old form
   *  can never satisfy an assertion about the new one. */
  const collector = () => {
    const text = yaml();
    const at = text.indexOf('- name: Collect what the readers say');
    assert.ok(at > 0, 'the digest collector step must exist — this whole block is about it');
    const end = text.indexOf('- name: Deliver it to one durable issue', at);
    assert.ok(end > at, 'the collector must be followed by the delivery step');
    return text
      .slice(at, end)
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
  };

  test('the register reader is not piped — a pipeline reports its LAST stage, never the guard', () => {
    const body = collector();
    assert.match(body, /assert-ops-register\.mjs/, 'the digest must still read this guard');
    for (const line of body.split('\n')) {
      if (!line.includes('assert-ops-register.mjs')) continue;
      assert.doesNotMatch(line, /\|/, `the reader is piped, so the digest records the pipe's status:\n${line}`);
    }
  });

  test('the status is captured on its OWN line and echoed', () => {
    const lines = collector().split('\n').map((l) => l.trim());
    const at = lines.findIndex((l) => l.includes('assert-ops-register.mjs'));
    assert.ok(at !== -1);
    assert.match(lines[at], /^out="\$\(node tooling\/ci\/assert-ops-register\.mjs 2>&1\)"$/);
    assert.equal(lines[at + 1], 'code=$?', '`$?` must be read before ANY other command runs, or it is that command\'s status');
    assert.ok(
      lines.slice(at).some((l) => /^echo "exit: \$code"$/.test(l)),
      'the digest must print the guard\'s exit, or a red register is indistinguishable from a quiet week',
    );
  });

  test('a NON-ZERO exit prints the guard\'s output unfiltered — the ⬜/⚠ filter drops every `✗` line', () => {
    const body = collector();
    // The filter may still run, but only on the branch where there is nothing to
    // hide. On the failure branch the whole output has to survive.
    assert.match(body, /if \[ "\$code" -eq 0 \]; then/);
    const elseAt = body.indexOf('else');
    assert.ok(elseAt > 0, 'there must be a failure branch at all');
    const failureBranch = body.slice(elseAt, body.indexOf('fi', elseAt));
    assert.match(failureBranch, /printf '%s\\n' "\$out"/);
    assert.doesNotMatch(failureBranch, /grep/, 'filtering the failure branch is the defect, one level down');
  });

  test('the two sibling readers still report their own exits — the shape this one was repaired to match', () => {
    const body = collector();
    assert.match(body, /node tooling\/ops\/status\.mjs 2>&1\n\s*echo "exit: \$\?"/);
    assert.match(body, /node tooling\/ops\/check-heartbeats\.mjs 2>&1\n\s*echo "exit: \$\?"/);
  });
});

describe('assert-ops-register — HOSTNAMES ARE DELEGATED, and the delegation can fail', () => {
  // This register deliberately holds no hostname rows: [11]E-9's
  // monitor-register.json owns that set, with a wider derivation. "Delegated" is
  // only a different thing from "unowned" if the pointer is verified — so these
  // exercise the pointer being absent, dangling, empty, and blind.
  const fixtureRoot = (mutate = () => {}) => {
    const root = join(TMP, `d${seq++}`);
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    mkdirSync(join(root, 'tooling/ops'), { recursive: true });
    mkdirSync(join(root, 'services/svc'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'name: CI\n');
    writeFileSync(join(root, 'services/svc/wrangler.jsonc'), JSON.stringify({ name: 'svc' }));
    // The `cloudflare-cron` confinement limb reads this file to confirm the
    // coupling it guards still exists, so a fixture root without it is an
    // INCOMPLETE model of the subject and reports COVERAGE LOST — which is the
    // limb working, not a fixture bug. Copy the REAL reader rather than writing
    // a stub containing the literal: a stub would encode the assumption the
    // limb exists to check, and would keep passing after the real file changed.
    writeFileSync(
      join(root, 'tooling/ops/check-heartbeats.mjs'),
      readFileSync(resolve(CI_DIR, '..', 'ops', 'check-heartbeats.mjs'), 'utf8'),
    );

    const reg = baseRegister();
    reg._delegated = { hostnames: 'tooling/monitor-register.json' };
    reg.rows[1].mechanism.anchor = 'renovate.json';
    reg.rows[2].mechanism.anchor = 'renovate.json';
    reg.rows[1].mechanism.readBy = 'the backup script';
    reg.rows[2].mechanism.readBy = 'this guard';
    writeFileSync(join(root, 'renovate.json'), '{}');

    // ── what main() now demands and evaluate() does not ──────────────────────
    // These four additions all exist because of the 2026-08-06 [14]O-3/O-11/O-17
    // repair, and each models the SHAPE the real register has rather than the
    // minimum that makes the guard quiet:
    //  · the one scheduled duty declares a reader (an unreachable one, with a why)
    //  · a second scheduled duty uses the OTHER declared reader, because a reader
    //    no row uses is an error — and because a register whose every duty is
    //    `unreachable` is COVERAGE LOST, which is the anti-vacuity rule itself
    //  · one `expiring` row and one `retention` row, because a register holding
    //    none of either makes [14]O-11 and [14]O-17 range over the empty set
    sched(reg).mechanism.recordQuery = { reader: 'unreachable', why: 'the fixture laptop is not reachable from a test runner' };
    reg.rows.push({
      id: 'duty.workflow.nightly',
      kind: 'duty',
      what: 'a nightly scheduled workflow',
      detector: 'its own alert job',
      response: 'read the issue it files',
      cadence: '1d',
      mechanism: {
        substrate: 'github-actions',
        anchor: 'renovate.json',
        record: 'GitHub Actions run history, filtered to event = schedule',
        failingValue: 'conclusion = failure on event = schedule',
        readBy: 'this guard, by querying the run history',
        recordQuery: { reader: 'github-run-history', workflow: 'ci.yml', event: 'schedule', headBranch: 'main' },
      },
      // [14]O-10 wants an IN-TREE freshness reader or a written gap. This
      // fixture root has no guards in it, so the gap is the honest answer — and
      // it exercises the print-don't-fail path rather than routing round it.
      freshnessGap: 'the fixture root contains no in-tree guards; [14]O-10 is exercised against the real repository elsewhere.',
      absenceWatcher: {
        substrate: '(none)',
        what: 'NOTHING — a push-triggered reader cannot catch the provider dying, because it is on that provider.',
        ownerGated: true,
        gap: 'needs a watcher off GitHub; recorded so the count carries it.',
      },
      accessProviders: ['github'],
      source: 'verified',
    });
    reg.rows.push({
      id: 'expiring.fixture-domain',
      kind: 'expiring',
      what: 'a domain registration',
      detector: 'this row',
      response: 'renew it',
      cadence: '180d',
      leadDays: 30,
      expires: null,
      expiryKnownAt: 'the registrar console',
      ownerGated: true,
      ownerGap: 'console-only',
      mechanism: { substrate: 'cloudflare-registrar', anchor: 'renovate.json', record: 'the console', failingValue: 'auto-renew off', readBy: 'nothing yet' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });
    reg.rows.push({
      id: 'retention.fixture-table',
      kind: 'retention',
      store: 'd1:fixture_db:heartbeat',
      what: 'an append-only heartbeat table',
      rule: 'keep',
      keepWhy: 'append-only by design; the additive-only schema rule forbids dropping it',
      detector: 'assert-retention-coverage.mjs',
      response: 'n/a',
      cadence: '365d',
      mechanism: { substrate: 'cloudflare-d1', anchor: 'renovate.json', record: 'the table itself', failingValue: 'a row older than the period, once one exists', readBy: 'assert-retention-coverage.mjs' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });

    const state = { reg, monitor: { hosts: [{ hostname: 'example.test' }] } };
    mutate(state, root);
    writeFileSync(join(root, 'tooling/ops/register.json'), JSON.stringify(state.reg));
    if (state.monitor !== null) writeFileSync(join(root, 'tooling/monitor-register.json'), JSON.stringify(state.monitor));
    return root;
  };
  // 🔴 THE CREDENTIALS ARE SCRUBBED ON PURPOSE. [14]O-3's readers really do
  // leave the machine, so a developer who happens to have GITHUB_TOKEN exported
  // would run a DIFFERENT test from CI — and the one that passes locally and
  // fails in CI (or the reverse) is the test everybody learns to ignore. With
  // them absent the reader is deterministically `unreadable`, which is a print,
  // so these tests measure the delegation limb and nothing else.
  const runRoot = (root) => {
    const env = { ...process.env };
    for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) delete env[k];
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8', env });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  test('the fixture root is green first, or nothing below means anything', () => {
    const r = runRoot(fixtureRoot());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /delegated to tooling\/monitor-register\.json \(1 hosts\)/);
  });

  test('no `_delegated.hostnames` at all is COVERAGE LOST — the surfaces would be owned by nobody', () => {
    const r = runRoot(fixtureRoot((s) => { delete s.reg._delegated; }));
    assert.equal(r.code, 1);
    assert.match(r.out, /`_delegated.hostnames` is missing/);
  });

  test('a delegate that does not exist is COVERAGE LOST, not a silent pass-through', () => {
    const r = runRoot(fixtureRoot((s) => { s.monitor = null; }));
    assert.equal(r.code, 1);
    assert.match(r.out, /which does not exist/);
  });

  test('a delegate with an EMPTY host set is COVERAGE LOST — an empty delegate is worse than none', () => {
    const r = runRoot(fixtureRoot((s) => { s.monitor = { hosts: [] }; }));
    assert.equal(r.code, 1);
    assert.match(r.out, /could not be read as a host register/);
  });

  test('a delegate blind to a custom domain this repo deploys FAILS — a pointer at a smaller set', () => {
    const r = runRoot(fixtureRoot((s, root) => {
      writeFileSync(
        join(root, 'services/svc/wrangler.jsonc'),
        JSON.stringify({ name: 'svc', routes: [{ pattern: 'api.example.test', custom_domain: true }] }),
      );
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /is not among the 1 host\(s\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [14]O-4 — SOMETHING ON DIFFERENT INFRASTRUCTURE NOTICES THE SILENCE.
//
// The property under test is not "a watcher is named". It is: the watcher is on
// a DIFFERENT MACHINE, and somebody has SEEN IT FIRE. Both halves have already
// failed in production here — the four Oracle crontab duties are watched by a
// GlitchTip on the Oracle box (different word, same machine), and monitor 6 was
// configured, enabled, drawn red and silent for nine days behind a null foreign
// key. So every test below asks whether the guard can still fail, never whether
// the register happens to be well-formed today.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — [14]O-4 · the absence of a scheduled duty must be noticed from elsewhere', () => {
  test('the base register is green AND the limb really ran — one proven watcher, counted', () => {
    const v = run(baseRegister());
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.absence.scheduled, 1);
    assert.equal(v.stats.absence.proven, 1);
    assert.equal(v.stats.absence.gaps.length, 0);
  });

  test('a scheduled duty with NO absenceWatcher FAILS — its own record is written by the thing that dies', () => {
    const r = baseRegister();
    delete sched(r).absenceWatcher;
    assert.match(messages(r), /and no `absenceWatcher`/);
  });

  test('🔴 A WATCHER ON THE SAME HOST FAILS — and the two substrates are spelled DIFFERENTLY', () => {
    // The Oracle case, in miniature: `oci-cron` and `glitchtip-heartbeat` are
    // different words for one box. A string comparison would call this
    // "different infrastructure"; only resolving both to a host catches it.
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'laptop';
    assert.match(messages(r), /THE WATCHER RUNS ON THE THING IT WATCHES/);
  });

  test('a same-host watcher is ACCEPTED when ownerGated with a written gap, and the gap NAMES the shape', () => {
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'laptop';
    const aw = sched(r).absenceWatcher;
    aw.ownerGated = true;
    aw.gap = 'closing it needs a monitor on a second provider — console-only work';
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.absence.proven, 0);
    assert.equal(v.stats.absence.gaps.length, 1);
    assert.match(v.stats.absence.gaps[0], /ITS WATCHER SHARES THE DUTY'S HOST/);
  });

  test('`ownerGated` with no written gap FAILS — a gap nobody describes is a waiver', () => {
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'laptop';
    sched(r).absenceWatcher.ownerGated = true;
    assert.match(messages(r), /`absenceWatcher.ownerGated: true` with no written `gap`/);
  });

  test('substrate `(none)` FAILS unless it is owner-gated — "nothing watches it" may be recorded, never passed over', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    aw.substrate = '(none)';
    delete aw.downTransitionDrill;
    assert.match(messages(r), /is only an honest answer alongside `ownerGated: true`/);
  });

  test('substrate `(none)` WITH a gap passes and is printed as NOTHING WATCHES IT AT ALL, distinct from a shared host', () => {
    // Three gaps, three repairs. Rolling them into one count is how the Oracle
    // rows' shared-host problem hid behind "it has a watcher".
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    aw.substrate = '(none)';
    delete aw.downTransitionDrill;
    aw.ownerGated = true;
    aw.gap = 'an event reporter with no heartbeat; the absence half is on-box work';
    // …and the mapping it used to reach must go with it, which is the unused-key
    // rule doing its job: `(none)` reaches nothing, so nothing may point at it.
    delete r._substrateHosts['glitchtip-heartbeat'];
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.match(v.stats.absence.gaps[0], /NOTHING WATCHES ITS ABSENCE AT ALL/);
  });

  // ── the drill: a declaration is not a behaviour ────────────────────────────
  test('🔴 AN OFF-HOST WATCHER WITH NO DRILL AND NO DATED drillDue FAILS — this is the whole limb', () => {
    const r = baseRegister();
    delete sched(r).absenceWatcher.downTransitionDrill;
    assert.match(messages(r), /neither a `downTransitionDrill` nor a dated `drillDue`/);
  });

  test('drill evidence that is the WORD "verified" FAILS — monitor 6 was "verified" while telling nobody', () => {
    const r = baseRegister();
    sched(r).absenceWatcher.downTransitionDrill.evidence = 'verified';
    assert.match(messages(r), /names nothing a later reader can look up/);
  });

  test('drill evidence carrying a durable id in ANY of the accepted shapes passes', () => {
    for (const evidence of ['issue #151 at 10:08:00Z', 'OPS-3 and OPS-4 resolved', 'run 30899326549']) {
      const r = baseRegister();
      sched(r).absenceWatcher.downTransitionDrill.evidence = evidence;
      assert.deepEqual(run(r).errors, [], evidence);
    }
  });

  test('a drill dated in the FUTURE fails — a transition that has not happened cannot be dated', () => {
    const r = baseRegister();
    sched(r).absenceWatcher.downTransitionDrill.date = '2099-01-01';
    assert.match(messages(r), /is in the FUTURE/);
  });

  test('a drill with no `how` fails — the half a later reader needs to repeat it', () => {
    const r = baseRegister();
    delete sched(r).absenceWatcher.downTransitionDrill.how;
    assert.match(messages(r), /`downTransitionDrill.how` is empty/);
  });

  test('an owner-gated watcher does NOT licence an unverifiable drill sitting next to it', () => {
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'laptop';
    const aw = sched(r).absenceWatcher;
    aw.ownerGated = true;
    aw.gap = 'console-only';
    aw.downTransitionDrill.evidence = 'tested';
    assert.match(messages(r), /names nothing a later reader can look up/);
  });

  // ── the drillDue tripwire, with the lead window degradedUntil taught ───────
  test('`drillDue` far out PRINTS and never blocks; the count of pending drills moves', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    delete aw.downTransitionDrill;
    Object.assign(aw, { drillDue: '2099-01-01', drillLeadDays: 14, drillGap: 'the transport is proven and this limb is not' });
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.absence.pending, 1);
    assert.equal(v.stats.absence.proven, 0);
    assert.match(v.prints.join(' | '), /off-host but UNDRILLED/);
  });

  test('`drillDue` with no positive `drillLeadDays` FAILS — the 2026-08-04 finding, applied one level down', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    delete aw.downTransitionDrill;
    Object.assign(aw, { drillDue: '2099-01-01', drillGap: 'still unobserved' });
    assert.match(messages(r), /no positive integer `drillLeadDays`/);
  });

  test('`drillDue` INSIDE its own lead window is RED, with time left to act', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    delete aw.downTransitionDrill;
    // NOW is 2026-08-02; six days out, inside a 14-day window.
    Object.assign(aw, { drillDue: '2026-08-08', drillLeadDays: 14, drillGap: 'still unobserved' });
    assert.match(messages(r), /FIRES IN 6 DAY\(S\), inside its own 14-day lead window/);
  });

  test('a PASSED `drillDue` is a hard failure that refuses the one move it exists to refuse', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    delete aw.downTransitionDrill;
    Object.assign(aw, { drillDue: '2026-07-01', drillLeadDays: 14, drillGap: 'still unobserved' });
    const m = messages(r);
    assert.match(m, /has PASSED and the down-transition is still unobserved/);
    assert.match(m, /Moving the date is the one move this field exists to refuse/);
  });

  // ── the host map is itself checkable ──────────────────────────────────────
  test('a watcher substrate with no `_substrateHosts` entry FAILS as "cannot be checked"', () => {
    const r = baseRegister();
    sched(r).absenceWatcher.substrate = 'carrier-pigeon';
    assert.match(messages(r), /has no `_substrateHosts` entry, so whether it shares/);
  });

  test('a DUTY substrate with no `_substrateHosts` entry FAILS — the left-hand side matters too', () => {
    const r = baseRegister();
    delete r._substrateHosts['github-actions'];
    assert.match(messages(r), /this duty's HOST is\s+unknown/);
  });

  test('a host outside the fixed provider vocabulary FAILS — free text makes it a spelling comparison', () => {
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'that one box in the corner';
    assert.match(messages(r), /is not in the fixed provider vocabulary/);
  });

  test('a `_substrateHosts` key no row reaches FAILS — a mapping about nothing inflates the domain', () => {
    const r = baseRegister();
    r._substrateHosts['fax-machine'] = 'laptop';
    assert.match(messages(r), /is reached by no duty row and by no absence watcher/);
  });

  // ── COVERAGE LOST: the domain may not empty itself ────────────────────────
  test('🔴 MOVING EVERY DUTY OFF A CLOCK IS COVERAGE LOST, NOT A PASS', () => {
    // The vacuity escape. `on-demand` already costs a `why`, but without this
    // the O-4 domain could still be emptied one row at a time while the guard
    // went on printing ok — this repository's single most repeated defect.
    const r = baseRegister();
    const d = sched(r);
    d.cadence = 'on-demand';
    d.why = 'escaping the O-4 domain by leaving the clock';
    delete d.absenceWatcher;
    r._substrateHosts = { 'github-actions': 'github', 'windows-task-scheduler': 'laptop' };
    assert.match(messages(r), /COVERAGE LOST — not one `duty` row carries a TIME cadence/);
  });

  test('a register with NO duty row at all is COVERAGE LOST', () => {
    const r = baseRegister();
    r.rows = r.rows.filter((x) => x.kind !== 'duty');
    r._requiredCoverage = { ids: ['recovery.bundles'] };
    r._substrateHosts = {};
    assert.match(messages(r), /COVERAGE LOST — this register declares NO `duty` row at all/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // `cloudflare-cron` CONFINEMENT — the other side of the `kind === 'duty'` filter.
  //
  // check-heartbeats.mjs derives its watched set with
  // `kind === 'duty' && substrate === 'cloudflare-cron'`, and this guard's own
  // `anchored` map is built from `kind === 'duty'` alone. A NON-duty row carrying
  // that substrate is therefore invisible to BOTH — it names a Cloudflare cron
  // whose outcome nothing reads, and before 2026-08-07 every limb passed it.
  //
  // Found by mutation, not by reading: a `cloudflare-cron` substrate on an
  // `expiring` row produced no COVERAGE LOST from either reader. The premise
  // that it would was stated in a brief and was WRONG IN THE DANGEROUS DIRECTION.
  // ───────────────────────────────────────────────────────────────────────────
  test('a NON-duty row declaring `cloudflare-cron` FAILS — nothing would ever read its outcome', () => {
    const r = baseRegister();
    // ANY non-duty kind, not a named one. The first draft looked for `expiring`
    // and this fixture has none — the assert below caught it rather than the
    // test silently passing over an absent victim, which is the whole reason it
    // is written as a guard and not as a comment.
    const victim = r.rows.find((x) => x.kind !== 'duty' && x.mechanism);
    assert.ok(victim, 'fixture must contain a NON-duty row with a mechanism, or this test asserts nothing');
    victim.mechanism.substrate = 'cloudflare-cron';
    assert.match(messages(r), /declares `mechanism\.substrate: "cloudflare-cron"`/);
    assert.match(messages(r), new RegExp(`${victim.id.replace(/\./g, '\\.')} —`));
  });

  test('the confinement scan has a NON-EMPTY domain and prints its size', () => {
    // A confinement rule over zero rows is the vacuous pass this repo keeps
    // re-finding. The count is asserted, not just the absence of an error.
    const v = run(baseRegister());
    const line = v.prints.find((p) => p.includes('`cloudflare-cron` confinement'));
    assert.ok(line, `no confinement line printed; prints were: ${v.prints.join(' | ')}`);
    const n = Number(line.match(/(\d+) non-duty row\(s\) scanned/)?.[1] ?? 0);
    assert.ok(n > 0, `confinement scanned ${n} rows — an empty domain passes forever`);
  });

  test('a DUTY row declaring `cloudflare-cron` is fine — the rule confines, it does not ban', () => {
    // The mutation that proves the rule is not simply "reject this substrate".
    const r = baseRegister();
    sched(r).mechanism.substrate = 'cloudflare-cron';
    assert.doesNotMatch(messages(r), /declares `mechanism\.substrate: "cloudflare-cron"`/);
  });

  test('the scoping is REAL: `trigger` and `on-demand` duties need no watcher, and both counts print', () => {
    // Scoped for the reason [14]O-10 records — a trigger duty has no timer that
    // can silently die. The scoped-OUT count is printed too, so shrinking the
    // domain is visible rather than silent.
    const v = run(baseRegister());
    assert.equal(v.stats.absence.duties, 2);
    assert.equal(v.stats.absence.scheduled, 1);
    assert.match(v.prints.join(' | '), /1 on a CLOCK \(the O-4 domain\) · 1 on `trigger`\/`on-demand`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED_COVERAGE for the two written-procedure rows — [14]O-19 + [10]D-12.
//
// 🔴 THE HOLE THIS CLOSES, AND WHY NO OTHER TEST IN THIS FILE REACHES IT.
// `_requiredCoverage.ids ⊆ rows` is enforced by the guard, so deleting a ROW
// while its id stays in the list fails loudly (mutation M-A, run against the
// real tree on 2026-08-06: exit 1, "_requiredCoverage names
// `recovery.app-retirement` and no row has that id"). But deleting the row AND
// its id together passes CLEAN — the domain shrinks and the guard reports ok,
// because nothing anywhere says WHICH ids the external half must contain. That
// is check-migrations.mjs's 5-files-to-4 defect exactly, and these two rows are
// the likeliest victims of it: both are pure-`Private/` procedures whose entire
// machine-readable existence is the register line.
//
// So the list is pinned HERE, against the REAL register, rather than against a
// fixture — a fixture would encode the same misunderstanding as the row. Adding
// a row is free; REMOVING one of these is a deliberate edit to this file.
//
// NEGATIVE-TESTED, not assumed: dropping either id from a copy of the real
// `_requiredCoverage.ids` reddens `pinned` below; dropping either row reddens
// `resolves`. Both were run before this suite was committed.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — the two written-procedure rows cannot vanish quietly', () => {
  const REAL = JSON.parse(
    readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'),
  );

  /** [14]O-19's contract half and [10]D-12's whole document. Neither is visible
   *  to any tree walk — `Private/` is gitignored — so the register row is the
   *  only handle CI will ever have on them. */
  const PINNED = ['recovery.app-retirement', 'recovery.store-enforcement-response'];

  for (const id of PINNED) {
    test(`\`${id}\` is pinned in the external half (_requiredCoverage.ids)`, () => {
      assert.ok(
        REAL._requiredCoverage.ids.includes(id),
        `${id} is not in _requiredCoverage.ids. Without it, deleting the row and the id together ` +
          'shrinks the register silently and the guard still prints ok.',
      );
    });

    test(`\`${id}\` resolves to a row anchored in Private/runbooks/`, () => {
      const row = REAL.rows.find((r) => r.id === id);
      assert.ok(row, `${id} is named in _requiredCoverage.ids and is not a row.`);
      assert.equal(row.kind, 'recovery-path');
      assert.match(
        row.mechanism.anchor,
        /* FLATTENED 2026-08-15. This pattern was `^company\/runbooks\/` and had been
           stale since the MORNING of the same day, when company/ moved under Private/ —
           it survived the citation sweep precisely because it does NOT carry a
           `Private/` prefix, so a scan for `Private/company/` (deleted 2026-08-15) could never see it.
           A stale pattern that names no current directory is invisible to exactly the
           search you would run to find it. */
        /^Private\/runbooks\/.+\.md$/,
        'The anchor must stay a runbook. Repointing it at an in-tree file CI can read would make ' +
          'the row look verifiable while the procedure it stands for stayed unwritten.',
      );
    });
  }

  test('🔴 the retirement contract is NOT recorded as executed — lastDrill stays null until it is', () => {
    // [14]O-19's acceptance is "a checklist exists AND has been executed end to
    // end at least once". Writing Private/runbooks/app-retirement.md discharges
    // the first half only. This assertion exists so that setting the date is a
    // DELIBERATE act that also edits this line — the built-vs-working confusion
    // this repo keeps paying for arrives precisely as a quiet field change.
    // ⚠️ When the procedure IS executed: set lastDrill, append the runbook's §8
    // entry, and change this test to assert the date instead of the null.
    const row = REAL.rows.find((r) => r.id === 'recovery.app-retirement');
    assert.equal(row.lastDrill, null);
    assert.equal(row.ownerGated, true, 'a null drill must cost a printed gap');
    assert.ok(row.ownerGap && row.ownerGap.trim().length > 0);
  });

  test('[10]D-12 limb (d): the enforcement runbook carries a real last-reviewed date on a clock', () => {
    // The dated half of D-12's acceptance. Unlike the row above this one IS
    // dated, because its drill is "re-read the four stores' published pages",
    // which was genuinely performed on the date recorded. The guard turns that
    // date into a build failure once it passes the cadence — which is the only
    // limb of D-12 a machine can hold at all.
    const row = REAL.rows.find((r) => r.id === 'recovery.store-enforcement-response');
    assert.match(row.lastDrill, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(cadenceDays(row.cadence), 180);
    assert.equal(
      row.source,
      'unverified',
      'Three of four appeal deadlines could not be established from a primary page. `unverified` ' +
        'with an `unverifiedWhy` is how this register records that, and it is counted and printed.',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A RETIRED ROW IS OUT OF BOTH LIVE SETS, OR IT IS NOT RETIRED.
//
// `_retiredRows` is a RECORD and no guard reads it — that is the point of
// retiring rather than editing in place, and tooling/legal/provider-register.json
// says exactly the same of `retiredDisclosureGaps`. What CAN go wrong is half a
// retirement, and the two halves fail very differently:
//
//   the ID left in `_requiredCoverage.ids` — assert-ops-register.mjs already
//       fails ("_requiredCoverage names `x` and no row has that id"), so that
//       half is held by the guard and needs nothing here.
//   the ROW left in `rows`                 — NOTHING fails. Every limb keeps
//       enforcing a store this same file records as gone, and its `ownerGap`
//       keeps printing on every run, asking the owner for work already done.
//
// That second state is not hypothetical: it is retention.kv.ratel-cache's whole
// history. The namespace was deleted, nothing re-read the account, and the row
// went on being enforced and printed until 2026-08-11. A record saying "retired"
// beside a row still being enforced is worse than no record, because it reads as
// the cleanup having happened.
//
// The evidence limb reuses the guard's own DURABLE_ID rather than a second regex
// with the same idea in it: "we decided to stop tracking it" is a deletion, and
// only a reading of the thing ITSELF — timestamped, re-runnable — makes it a
// retirement. Retiring must never become the cheap way to shrink the domain.
//
// NEGATIVE-TESTED ON THE REAL TREE, not on a fixture — the mutations and their
// output are in the increment report.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — a retired row is gone from BOTH live sets, with evidence', () => {
  const REAL = JSON.parse(
    readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'),
  );
  // 🔴 NO `?? []` HERE, AND THE FIRST DRAFT HAD ONE. With the default, deleting
  // `_retiredRows.rows` outright left `retired` an empty array — the shape test
  // below passed on it, the per-entry tests ranged over nothing, and the suite
  // printed 153 green. Measured, not reasoned about: mutation M5 against the real
  // register was CAUGHT ONLY after this line lost its default. A fallback on the
  // value being checked is how an assertion stops being able to fail.
  const retiredRaw = REAL._retiredRows?.rows;
  const retired = Array.isArray(retiredRaw) ? retiredRaw : [];
  const liveIds = new Set(REAL.rows.map((r) => r.id));
  const requiredIds = new Set(REAL._requiredCoverage.ids);

  /** Same reasoning as PINNED above, one register-section over: an ENTRY deleted
   *  from `_retiredRows` takes with it the only evidence of how long the row
   *  stood and what made it stop, and nothing else in the tree would notice.
   *  Adding a retirement is free; erasing one is a deliberate edit to this file. */
  const PINNED_RETIRED = ['retention.kv.ratel-cache'];

  test('`_retiredRows.rows` exists as an array, so the limbs below have a domain', () => {
    assert.ok(Array.isArray(retiredRaw), '`_retiredRows.rows` is missing or is not an array.');
  });

  for (const id of PINNED_RETIRED) {
    test(`the retirement of \`${id}\` is still recorded — history is not erased on a later edit`, () => {
      assert.ok(
        retired.some((e) => e?.id === id),
        `${id} was retired and its record is gone. Deleting the entry removes the dated evidence that the ` +
          'store it covered no longer exists, which is the only thing separating a retirement from a deletion.',
      );
    });
  }

  for (const entry of retired) {
    const id = entry?.id ?? '<no id>';

    test(`\`${id}\` is retired, so it is NOT in \`rows\``, () => {
      assert.ok(
        !liveIds.has(id),
        `${id} is recorded as retired AND is still a live row. Every guard would keep enforcing it — ` +
          'and if it is owner-gated, keep printing its gap — while this file says it was retired.',
      );
    });

    test(`\`${id}\` is retired, so it is NOT in \`_requiredCoverage.ids\``, () => {
      assert.ok(
        !requiredIds.has(id),
        `${id} is recorded as retired and is still named in _requiredCoverage.ids, which requires a row ` +
          'to exist for it. The two halves of the retirement disagree.',
      );
    });

    test(`\`${id}\` carries a date, a reason, and evidence a later reader can re-check`, () => {
      assert.match(entry.retiredOn ?? '', /^\d{4}-\d{2}-\d{2}$/, `${id} — \`retiredOn\` must be an ISO date.`);
      assert.ok((entry.retiredWhy ?? '').trim().length > 0, `${id} — \`retiredWhy\` is empty.`);
      assert.match(
        entry.evidence ?? '',
        DURABLE_ID,
        `${id} — \`evidence\` carries nothing a later reader can look up. The same rule the guard applies ` +
          'to drill evidence: a timestamp, a run id, an issue number — not an adjective.',
      );
      assert.equal(entry.row?.id, id, `${id} — the preserved \`row\` must be the row that was retired, verbatim.`);
    });
  }
});

describe('assert-ops-register — [14]O-3 · the GlitchTip heartbeat reader, and THE PROPERTY IT WAS BUILT TO KEEP', () => {
  // ── WHY THIS SUITE IS LONGER THAN THE READER IT TESTS ──────────────────────
  // The reader exists because `duty.laptop.nikatru-daily-backup` moved off
  // `windows-scheduled-task` on 2026-09-02: that reader is structurally
  // unreadable on every Linux runner, so once the backup was repaired and its
  // held failure was correctly cleared to `pass`, the row fell through to plain
  // `unreadable` and took the count past its ceiling.
  //
  // 🔴 THE DANGER IN THAT FIX IS OBVIOUS AND IT IS WHAT THESE CASES GUARD: the
  // easy way to make a row readable is to make it readable AND ALWAYS GREEN. A
  // reader that answered "fine" whenever it could reach GlitchTip would drop the
  // unreadable count, unblock the merge, and silently retire the only automated
  // check that the laptop backup still runs. So the cases below are weighted
  // toward the RED outcomes: a stale heartbeat, a page of nothing but misses, an
  // empty page, a monitor that stopped being a Heartbeat, and a monitor that is
  // gone. Every one of them must be a FAILURE, and none of them may be a print.
  const MON = { monitorType: 'Heartbeat', interval: 43200 };
  const Q = { org: 'nikatru', monitor: 6 };
  const upAt = (iso) => ({ startCheck: iso, isUp: true, reason: null });
  const downAt = (iso) => ({ startCheck: iso, isUp: false, reason: 'no heartbeat' });

  test('a fresh heartbeat is the duty\'s last successful run, and the detail names the monitor and the timestamp', () => {
    const r = classifyGlitchtipChecks(MON, [upAt('2026-09-02T13:42:42.162Z')], Q);
    assert.equal(r.lastSuccessMs, Date.parse('2026-09-02T13:42:42.162Z'));
    assert.equal(r.unreadable, undefined);
    assert.equal(r.missing, undefined);
    assert.match(r.detail, /monitor 6 \(Heartbeat, interval 43200s\)/);
    assert.match(r.detail, /newest SUCCESSFUL heartbeat at 2026-09-02T13:42:42\.162Z/);
  });

  test('the NEWEST success wins even when the page is not ordered, so this never depends on the API\'s sort order', () => {
    const r = classifyGlitchtipChecks(MON, [upAt('2026-09-01T01:00:00Z'), upAt('2026-09-02T13:42:42Z'), upAt('2026-08-30T01:00:00Z')], Q);
    assert.equal(r.lastSuccessMs, Date.parse('2026-09-02T13:42:42Z'));
  });

  test('misses on the page do not hide a real success — they are COUNTED and reported beside it', () => {
    const r = classifyGlitchtipChecks(MON, [downAt('2026-09-02T20:00:00Z'), downAt('2026-09-02T18:00:00Z'), upAt('2026-09-02T13:42:42Z')], Q);
    assert.equal(r.lastSuccessMs, Date.parse('2026-09-02T13:42:42Z'));
    assert.match(r.detail, /3 check\(s\) on the newest page \(2 of them recording a miss\)/);
  });

  test('🔴 THE HEARTBEAT STOPPED — a page of nothing but misses is NO SUCCESSFUL RUN, which is a failure and never a print', () => {
    const r = classifyGlitchtipChecks(MON, [downAt('2026-09-03T02:00:00Z'), downAt('2026-09-02T14:00:00Z')], Q);
    assert.ok(Number.isNaN(r.lastSuccessMs), 'must be NaN so classifyRunRecord routes it to the NO SUCCESSFUL RUN branch');
    assert.equal(r.unreadable, undefined, 'a duty that is failing must not be reported as a duty that could not be read');
    assert.match(r.detail, /contain NO successful heartbeat/);
  });

  test('🔴 THE MONITOR HAS NO CHECKS AT ALL — also a failure, for the same reason: absence of evidence is not evidence of a run', () => {
    const r = classifyGlitchtipChecks(MON, [], Q);
    assert.ok(Number.isNaN(r.lastSuccessMs));
    assert.equal(r.unreadable, undefined);
  });

  test('a check with an unparseable timestamp is not a success — a success this reader cannot date cannot be compared to a window', () => {
    const r = classifyGlitchtipChecks(MON, [{ startCheck: 'whenever', isUp: true }], Q);
    assert.ok(Number.isNaN(r.lastSuccessMs));
  });

  test('🔴 `isUp` MUST BE STRICTLY TRUE — a truthy string or a 1 is not a heartbeat GlitchTip recorded as up', () => {
    for (const bad of ['true', 1, {}, null, undefined]) {
      const r = classifyGlitchtipChecks(MON, [{ startCheck: '2026-09-02T13:42:42Z', isUp: bad }], Q);
      assert.ok(Number.isNaN(r.lastSuccessMs), `isUp: ${JSON.stringify(bad)} must not count as a success`);
    }
  });

  test('🔴 A MONITOR THAT STOPPED BEING A HEARTBEAT IS `missing`, NOT a pass — a GET monitor answers a different question forever', () => {
    const r = classifyGlitchtipChecks({ monitorType: 'GET', interval: 60 }, [upAt('2026-09-02T13:42:42Z')], Q);
    assert.equal(r.missing, true);
    assert.equal(r.lastSuccessMs, undefined, 'a fresh-looking check on the wrong monitor type must not become a success');
    assert.match(r.why, /not "Heartbeat"/);
  });

  test('a payload that is not an array is `unreadable` — refusing to read is not reading a failure', () => {
    for (const bad of [null, undefined, { detail: 'Not found.' }, 'nope']) {
      const r = classifyGlitchtipChecks(MON, bad, Q);
      assert.equal(r.unreadable, true, `${JSON.stringify(bad)} must be unreadable`);
      assert.equal(r.lastSuccessMs, undefined, 'an unread payload must never assert that the duty failed');
    }
  });

  // ── AND THE END-TO-END HALF: the register's own row, through the guard's own
  // classifier, on a runner that is not Windows. This is the claim the fix rests
  // on and it is asserted rather than believed.
  const realRegister = () => JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
  const NOWG = Date.parse('2026-09-02T15:30:00Z');

  test('THE SHIPPED ROW IS READABLE FROM LINUX — the whole point of the move, asserted against the committed register', () => {
    const reg = realRegister();
    const row = reg.rows.find((r) => r.id === 'duty.laptop.nikatru-daily-backup');
    assert.ok(row, 'the row this reader was built for must still exist');
    assert.equal(row.mechanism.recordQuery.reader, 'glitchtip-heartbeat');
    assert.ok(reg._recordReaders['glitchtip-heartbeat'], 'the reader must be DECLARED, or the row names one nothing implements');
    // No platform gate anywhere in the path: the same inputs give the same
    // verdict on Windows, Linux and macOS, which `windows-scheduled-task` could
    // never say.
    const fresh = classifyGlitchtipChecks(MON, [upAt('2026-09-02T13:42:42.162Z')], row.mechanism.recordQuery);
    const v = classifyRunRecord(row, fresh, NOWG, reg._recordReaders._windowMultiplier);
    assert.equal(v.verdict, 'pass', v.line);
  });

  test('🔴 AND IT STILL GOES RED WHEN THE HEARTBEAT STOPS — the property the whole change had to preserve, on the REAL row', () => {
    const reg = realRegister();
    const row = reg.rows.find((r) => r.id === 'duty.laptop.nikatru-daily-backup');
    const mult = reg._recordReaders._windowMultiplier;

    // 1 · STALE. The duty's own cadence window (8h x 1.5 = 12h) has passed with
    //     no new POST. This is what "the laptop stopped backing up" looks like.
    const stale = classifyGlitchtipChecks(MON, [upAt('2026-09-01T00:00:00Z')], row.mechanism.recordQuery);
    const vStale = classifyRunRecord(row, stale, NOWG, mult);
    assert.equal(vStale.verdict, 'fail', vStale.line);
    assert.match(vStale.line, /newest SUCCESSFUL run is [\d.]+h old, outside its own window/);

    // 2 · NOTHING BUT MISSES on the newest page.
    const missed = classifyGlitchtipChecks(MON, [downAt('2026-09-02T15:00:00Z')], row.mechanism.recordQuery);
    const vMissed = classifyRunRecord(row, missed, NOWG, mult);
    assert.equal(vMissed.verdict, 'fail', vMissed.line);
    assert.match(vMissed.line, /holds NO SUCCESSFUL RUN AT ALL/);

    // 3 · THE MONITOR IS GONE. A stale register row is worse than an absent one.
    const gone = { missing: true, why: 'GlitchTip has no monitor 6 in organisation `nikatru` — the id the register names returns 404' };
    const vGone = classifyRunRecord(row, gone, NOWG, mult);
    assert.equal(vGone.verdict, 'fail', vGone.line);
    assert.match(vGone.line, /DOES NOT EXIST/);

    // 4 · AND NONE OF THE THREE IS OWNER-GATED INTO A PRINT. The row carries
    //     `ownerGated: true`, which lifts the block ONLY on the held-failure
    //     branch; a query that RAN and answered must still block. If this ever
    //     flips, the duty is being watched by something that cannot say no.
    for (const v of [vStale, vMissed, vGone]) {
      assert.notEqual(v.gated, true, `a READ failure must never be gated into a print: ${v.line}`);
    }
  });

  // ── `firstDue`: the bootstrap gate, and every way it must NOT work ────────
  // It is the only thing in this limb that lifts a block on a query that RAN
  // and answered, so it gets the same treatment the held-failure gate got: the
  // one case it may cover, and four it may not.
  describe('recordQuery.firstDue — the bootstrap gate', () => {
    const REAL = () => JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    // The schema half lives inside `evaluateRunRecords`, so it is exercised the
    // way the guard exercises it: no probes, which makes every reader dark and
    // raises its own unreadable-ceiling error. Filter to the claim under test.
    const limbErrors = (reg) => evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];
    const NOWF = Date.parse('2026-09-03T06:00:00Z');
    const MULT = () => REAL()._recordReaders._windowMultiplier;
    const EMPTY = { lastSuccessMs: NaN, detail: 'globalonlinedeveloper/X has NO successful `schedule` run of w.yml in its run history at all.' };
    const rowWith = (firstDue) => ({
      id: 'duty.workflow.test.yml',
      kind: 'duty',
      cadence: '7d',
      mechanism: { recordQuery: { reader: 'github-run-history', workflow: 'w.yml', event: 'schedule', ...(firstDue === undefined ? {} : { firstDue }) } },
    });

    test('a duty declared before its first slot PRINTS instead of blocking — the deadlock this field exists to break', () => {
      const c = classifyRunRecord(rowWith('2026-09-05T12:00:00Z'), EMPTY, NOWF, MULT());
      assert.equal(c.verdict, 'fail', 'it is still counted as FAILING — the gate lifts the block, never the verdict');
      assert.equal(c.gated, true, c.line);
      assert.match(c.line, /NOT YET DUE/);
      assert.match(c.line, /2026-09-05T12:00:00Z/, 'the date must be in the line, or nobody can tell when it stops printing');
    });

    test('🔴 AND IT BLOCKS THE MOMENT THE DATE PASSES, with nobody editing the row', () => {
      const row = rowWith('2026-09-05T12:00:00Z');
      const after = Date.parse('2026-09-05T12:00:01Z');
      const c = classifyRunRecord(row, EMPTY, after, MULT());
      assert.equal(c.verdict, 'fail');
      assert.notEqual(c.gated, true, 'one second past its own date the gate must be gone: this is what makes it a wait and not a waiver');
      assert.match(c.line, /has PASSED, so it gates nothing: delete the field/);
    });

    test('🔴 IT NEVER GATES A STALE SUCCESS — a duty that ran and then stopped is exactly what this limb is for', () => {
      const stale = { lastSuccessMs: NOWF - 400 * 3_600_000, detail: 'run 1 (schedule) succeeded.' };
      const c = classifyRunRecord(rowWith('2026-09-05T12:00:00Z'), stale, NOWF, MULT());
      assert.equal(c.verdict, 'fail');
      assert.notEqual(c.gated, true, 'a record WITH a success is past its bootstrap; gating staleness would be the weakening');
      assert.match(c.line, /outside its own window/);
    });

    test('🔴 IT NEVER GATES A MISSING MECHANISM — a workflow that has been deleted is not a workflow waiting to start', () => {
      const gone = { missing: true, why: 'the workflow the register names returns 404' };
      const c = classifyRunRecord(rowWith('2026-09-05T12:00:00Z'), gone, NOWF, MULT());
      assert.equal(c.verdict, 'fail');
      assert.notEqual(c.gated, true);
      assert.match(c.line, /DOES NOT EXIST/);
    });

    test('a row with NO firstDue is unchanged — the gate is opt-in and the default is still red', () => {
      const c = classifyRunRecord(rowWith(undefined), EMPTY, NOWF, MULT());
      assert.equal(c.verdict, 'fail');
      assert.notEqual(c.gated, true);
      assert.match(c.line, /holds NO SUCCESSFUL RUN AT ALL/);
      assert.doesNotMatch(c.line, /firstDue/);
    });

    test('an unparseable firstDue gates nothing — a field that lifts a block is a timestamp or it is nothing', () => {
      for (const bad of ['soon', '', 'next monday', null]) {
        const c = classifyRunRecord(rowWith(bad), EMPTY, NOWF, MULT());
        assert.notEqual(c.gated, true, `${JSON.stringify(bad)} must not gate`);
      }
    });

    // ── and the schema half: the guard must REFUSE the shapes that would turn
    //    the wait into a waiver. Run through the real limb over the real file.
    // 🔴 THE SUBJECT IS DERIVED, NOT PINNED, AND THAT IS THE WHOLE POINT OF THIS
    //    FIELD. A `firstDue` exists to be DELETED the moment its record lands —
    //    its own text says so — so a control pinned to one row id and one literal
    //    date fails on the very act it exists to make safe. It did, on 2026-09-05,
    //    when `duty.workflow.renovate.yml`'s spent bootstrap was removed after its
    //    first scheduled run landed. ⚠️ The domain is asserted NON-EMPTY: "no row
    //    carries a firstDue" must REFUSE rather than pass vacuously, because a
    //    mutation applied to nothing is a control that cannot fail.
    const bootstrapRow = (reg) => {
      const row = reg.rows.find((r) => typeof r?.mechanism?.recordQuery?.firstDue === 'string');
      assert.ok(
        row,
        'COVERAGE LOST — no row carries a `recordQuery.firstDue`, so every mutation below would ' +
          'range over nothing and pass. Re-point this at a row that has one, or delete these cases ' +
          'with the field.',
      );
      return row;
    };

    test('🔴 THE SCHEMA REFUSES A DATE PARKED IN THE FUTURE — the one way this becomes permanent', () => {
      const reg = REAL();
      const row = bootstrapRow(reg);
      assert.ok(Number.isFinite(Date.parse(row.mechanism.recordQuery.firstDue)), 'the committed firstDue must be a real instant');
      const far = JSON.parse(JSON.stringify(reg));
      bootstrapRow(far).mechanism.recordQuery.firstDue = '2030-01-01T00:00:00Z';
      const out = limbErrors(far);
      assert.ok(
        out.some((e) => /more than one cadence window/.test(e)),
        `a firstDue four years out must be refused; got:\n${out.join('\n')}`,
      );
    });

    test('the schema refuses an unparseable firstDue and one on an `unreachable` reader', () => {
      const reg = REAL();
      const bad = JSON.parse(JSON.stringify(reg));
      bootstrapRow(bad).mechanism.recordQuery.firstDue = 'soon';
      assert.ok(limbErrors(bad).some((e) => /not a parseable instant/.test(e)));

      const unreachable = JSON.parse(JSON.stringify(reg));
      const q = bootstrapRow(unreachable).mechanism.recordQuery;
      q.reader = 'unreachable';
      q.why = 'built for this mutation only';
      assert.ok(limbErrors(unreachable).some((e) => /reader is `unreachable`/.test(e)));
    });

    test('the committed register raises NO firstDue error of its own — the mutations above are the only red', () => {
      // NOT `errors === []`: with an empty probe map every reader is dark, which
      // is its own (correct) error about the unreadable ceiling. The claim here
      // is narrower and is the one that matters — the committed value is legal.
      const mine = limbErrors(REAL()).filter((e) => /firstDue/.test(e));
      assert.deepEqual(mine, [], 'the committed firstDue must be legal: ' + mine.join(' | '));
    });
  });

  // ── the BRANCH half of a run-history read ───────────────────────────────
  // Added 2026-09-03. Today every row pairs `headBranch` with `event: schedule`
  // and GitHub fires schedules only on the default branch, so none of this
  // changes a verdict — which is exactly why the cases exist: the guarantee is
  // real, implied, and would vanish silently the day Phase 2 widens the event
  // filter. These are what make it survive that edit.
  describe('recordQuery.headBranch — the guarantee that was only ever implied', () => {
    const Q = { workflow: 'e2e.yml', event: 'schedule', headBranch: 'main' };
    const run = (over = {}) => ({ id: 7, updated_at: '2026-09-03T04:00:00Z', head_branch: 'main', ...over });

    test('a run on the named branch is accepted, and the branch is IN the detail', () => {
      const r = classifyRunHistoryAnswer(Q, run(), 'owner/repo');
      assert.equal(r.lastSuccessMs, Date.parse('2026-09-03T04:00:00Z'));
      assert.match(r.detail, /on main/, 'a reader must be able to see which branch the verdict is about');
    });

    test('🔴 A RUN ON ANOTHER BRANCH IS REFUSED — the API filter is a REQUEST, this is the ANSWER', () => {
      // The case that matters: a `branch=` parameter silently ignored by a future
      // API version would widen this guard with nothing to notice it. Checking
      // what came BACK is the difference between asking and knowing.
      const r = classifyRunHistoryAnswer(Q, run({ head_branch: 'feat/something' }), 'owner/repo');
      assert.ok(Number.isNaN(r.lastSuccessMs), 'a run from another branch must not satisfy a claim about main');
      assert.match(r.detail, /branch filter did not hold/);
      assert.match(r.detail, /feat.something/, 'the branch that came back must be named, or nobody can debug it');
    });

    test('a missing head_branch is refused too — absent is not "probably main"', () => {
      const r = classifyRunHistoryAnswer(Q, run({ head_branch: undefined }), 'owner/repo');
      assert.ok(Number.isNaN(r.lastSuccessMs));
      assert.match(r.detail, /branch filter did not hold/);
    });

    test('with NO headBranch declared the answer is unchanged — the field is opt-in at this layer', () => {
      const { headBranch, ...noBranch } = Q;
      const r = classifyRunHistoryAnswer(noBranch, run({ head_branch: 'anything' }), 'owner/repo');
      assert.equal(r.lastSuccessMs, Date.parse('2026-09-03T04:00:00Z'));
      assert.doesNotMatch(r.detail, / on /);
    });

    test('an empty history says so, and names the branch it looked on', () => {
      const r = classifyRunHistoryAnswer(Q, undefined, 'owner/repo');
      assert.ok(Number.isNaN(r.lastSuccessMs));
      assert.match(r.detail, /NO successful/);
      assert.match(r.detail, /on main/);
    });

    // ── and the SCHEMA half: the field cannot be dropped, and cannot be put
    //    where nothing would apply it.
    test('🔴 the schema REFUSES a github-run-history row with no headBranch — this is the ratchet', () => {
      const reg = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
      const row = reg.rows.find((r) => r?.mechanism?.recordQuery?.reader === 'github-run-history');
      assert.ok(row, 'no committed row reads run history, so this ratchet would be vacuous');
      delete row.mechanism.recordQuery.headBranch;
      const errs = evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];
      assert.ok(errs.some((e) => /with no `headBranch`/.test(e)), 'dropping headBranch must fail; got: ' + errs.join(' | '));
    });

    test('the schema refuses headBranch on a reader that reads no run history', () => {
      const reg = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
      const row = reg.rows.find((r) => {
        const q = r?.mechanism?.recordQuery;
        return q && q.reader !== 'github-run-history' && q.reader !== 'unreachable';
      });
      assert.ok(row, 'no committed row uses another readable reader');
      row.mechanism.recordQuery.headBranch = 'main';
      const errs = evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];
      assert.ok(errs.some((e) => /which reads no run history/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('EVERY committed run-history row names a branch — the guarantee is total, not sampled', () => {
      const reg = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
      const rows = reg.rows.filter((r) => r?.mechanism?.recordQuery?.reader === 'github-run-history');
      assert.ok(rows.length >= 5, `expected the five workflow rows and Renovate; found ${rows.length}`);
      for (const r of rows) assert.equal(r.mechanism.recordQuery.headBranch, 'main', r.id);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // WORKER CRON PHASE 2 — the two-limb read.
  //
  // The thing being defended is narrow and worth stating: `event: schedule` was
  // carrying TWO claims (the timer fired, the run passed) and Phase 2 separates
  // them. Every test below is a way that separation could be done WRONGLY and
  // still look finished — an event filter dropped with nothing put in its place,
  // a dispatch accepted as a cadence claim, a timer limb so wide that any
  // healthy job vouches for any workflow. Each has a recorded failing case.
  // ───────────────────────────────────────────────────────────────────────────
  describe('assert-ops-register — the TIMER/OUTCOME split, and the ways it could be faked', () => {
    const registerCopy = () => JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const e2eRow = (reg) => reg.rows.find((r) => r.id === 'duty.workflow.e2e.yml');
    const errsOf = (reg) => evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];

    // ── the SCHEMA half: neither limb can be moved without the other ─────────
    test('🔴 dropping the event filter with NO timer limb is REFUSED — this is the whole ratchet', () => {
      const reg = registerCopy();
      const row = reg.rows.find((r) => r?.mechanism?.recordQuery?.event);
      assert.ok(row, 'no committed row still filters on an event, so this ratchet would be vacuous');
      delete row.mechanism.recordQuery.event;
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /no `event` and no `timer` limb/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('🔴 naming workflow_dispatch as the event is REFUSED — a hand-press is not a cadence claim', () => {
      const reg = registerCopy();
      const row = e2eRow(reg);
      row.mechanism.recordQuery.event = 'workflow_dispatch';
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /pressed a button; it is not a cadence claim/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('🔴 a timer limb narrowed by NEITHER job NOR target is REFUSED — any healthy job would vouch', () => {
      const reg = registerCopy();
      const q = e2eRow(reg).mechanism.recordQuery;
      delete q.timer.job;
      delete q.timer.target;
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /narrows by neither `job` nor `target`/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('a timer limb reading anything but the D1 heartbeat is refused — only a timer writes that table', () => {
      const reg = registerCopy();
      e2eRow(reg).mechanism.recordQuery.timer.reader = 'github-run-history';
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /timer\.reader` must be/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('a timer limb that loses its wrangler anchor is refused — it would go permanently unreadable', () => {
      const reg = registerCopy();
      delete e2eRow(reg).mechanism.recordQuery.timer.wrangler;
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /needs both `table` and `wrangler`/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('a timer limb on a row that reads no run history is refused — there is nothing to split', () => {
      const reg = registerCopy();
      const row = reg.rows.find((r) => r?.mechanism?.recordQuery?.reader === 'cloudflare-d1-heartbeat');
      assert.ok(row, 'no committed row reads the heartbeat directly');
      row.mechanism.recordQuery.timer = { reader: 'cloudflare-d1-heartbeat', table: 'cron_heartbeat', wrangler: 'x', job: 'j' };
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /has nothing to split/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('the committed e2e row IS on the split, narrowed to the dispatcher and to its own workflow', () => {
      const q = e2eRow(registerCopy()).mechanism.recordQuery;
      assert.equal(q.event, undefined, 'the event filter must be gone, or the timer limb is decoration');
      assert.equal(q.headBranch, 'main', 'the branch guarantee rode on the event filter and must now be explicit');
      assert.equal(q.timer.reader, 'cloudflare-d1-heartbeat');
      assert.equal(q.timer.job, 'github_dispatch');
      // 🔴 DERIVED FROM THE WORKER, NOT TYPED OUT. The first version of this
      // assertion read `'e2e.yml'` — a hand-written expectation checked against a
      // hand-written register, i.e. two copies of one belief. The Worker actually
      // writes `${repo}/${workflow}`, so the row it was "confirming" matched ZERO
      // heartbeat rows and the duty would have gone red the moment `firstDue`
      // expired. An expectation that does not come from the producer cannot fail
      // when the producer is what you got wrong.
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      const { targets } = dispatchTargetsFromSource(src);
      assert.ok(targets.includes(q.timer.target), `the dispatcher writes ${targets.join(', ')}; the row declares ${q.timer.target}`);
      assert.match(q.timer.target, /e2e\.yml$/, 'a timer row for ANOTHER workflow would prove nothing about this one');
    });

    // ── the guard that would have caught the above, negative-tested ──────────
    test('🔴 a target the dispatcher does NOT write is REFUSED — the bug that shipped', () => {
      const reg = registerCopy();
      e2eRow(reg).mechanism.recordQuery.timer.target = 'e2e.yml'; // the shipped mistake, verbatim
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      const probs = checkTimerTargetsAgainstDispatcher(reg, src);
      assert.equal(probs.length, 1, 'exactly the e2e row should fail; got: ' + probs.join(' | '));
      assert.match(probs[0], /is not a target the dispatcher writes/);
      assert.match(probs[0], /EXACT equality/, 'the message must say WHY a near-miss is silent, or the next reader repeats it');
    });

    test('the committed build-platforms row is on the split too, with its own qualified target', () => {
      const reg = registerCopy();
      const q = reg.rows.find((r) => r.id === 'duty.workflow.build-platforms.yml').mechanism.recordQuery;
      assert.equal(q.event, undefined);
      assert.equal(q.headBranch, 'main');
      assert.equal(q.timer.job, 'github_dispatch');
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      assert.ok(dispatchTargetsFromSource(src).targets.includes(q.timer.target));
    });

    // ── the ceiling that went stale the day after it was written ────────────
    describe('_maxUnreadable is DERIVED, and the derivation is enforced', () => {
      test('the committed ceiling equals the derivation', () => {
        const reg = registerCopy();
        assert.equal(reg._recordReaders._maxUnreadable, deriveUnreadableCeiling(reg).ceiling);
      });

      test('🔴 a ceiling ABOVE the derivation FAILS — that is the weakening direction', () => {
        const reg = registerCopy();
        reg._recordReaders._maxUnreadable = deriveUnreadableCeiling(reg).ceiling + 1;
        const errs = evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];
        assert.ok(errs.some((e) => /ABOVE the register/.test(e)), 'got: ' + errs.join(' | '));
      });

      test('a ceiling BELOW it PRINTS and does not block — stricter is legal, silent staleness is not', () => {
        const reg = registerCopy();
        reg._recordReaders._maxUnreadable = 0;
        const out = evaluateRunRecords(reg, new Map(), Date.now());
        assert.ok(!(out.errors ?? []).some((e) => /_maxUnreadable/.test(e)), 'stricter must not fail the build');
        assert.ok((out.prints ?? []).some((p) => /NO LONGER HOLDS/.test(p)), 'but it must SAY so');
      });

      test('🔴 a timer limb counts against BOTH providers — under-counting is what staled it', () => {
        const reg = registerCopy();
        const before = deriveUnreadableCeiling(reg);
        const cf = before.perProvider.find(([p]) => p === 'cloudflare')[1];
        // Strip the timer limbs and Cloudflare must lose exactly those rows.
        for (const r of reg.rows) {
          const q = r?.mechanism?.recordQuery;
          if (q?.timer) delete q.timer;
        }
        const after = deriveUnreadableCeiling(reg);
        const cfAfter = (after.perProvider.find(([p]) => p === 'cloudflare') ?? ['cloudflare', 0])[1];
        assert.ok(cfAfter < cf, `timer limbs must contribute to the cloudflare count; ${cf} -> ${cfAfter}`);
      });

      test('GitHub is excluded on purpose — its rows are MEANT to break the ceiling together', () => {
        const reg = registerCopy();
        assert.ok(
          !deriveUnreadableCeiling(reg).perProvider.some(([p]) => p === 'github'),
          'counting GitHub would let a lost GITHUB_TOKEN raise the ceiling instead of failing the build',
        );
      });

      test('adding a Cloudflare-backed row RAISES the derivation — the coupling is real', () => {
        const reg = registerCopy();
        const before = deriveUnreadableCeiling(reg).ceiling;
        const row = reg.rows.find((r) => r.id === 'duty.workflow.e2e.yml');
        reg.rows.push(JSON.parse(JSON.stringify({ ...row, id: 'duty.workflow.invented.yml' })));
        assert.equal(deriveUnreadableCeiling(reg).ceiling, before + 1);
      });
    });

    test('the committed register AGREES with the dispatcher — the bijection, not a spot check', () => {
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      assert.deepEqual(checkTimerTargetsAgainstDispatcher(registerCopy(), src), []);
    });

    test('a dispatcher whose target TEMPLATE changed is COVERAGE LOST, not a silent pass', () => {
      const r = dispatchTargetsFromSource('const target = `${t.workflow}`;\nGITHUB_DISPATCH_TARGETS = [\n];');
      assert.ok(r.error, 'a template this guard cannot reproduce must be an error');
      assert.match(r.error, /does not know how to reproduce/);
    });

    test('a dispatcher with ZERO parsed targets is an error — an empty set would pass vacuously', () => {
      const r = dispatchTargetsFromSource('const target = `${t.repo}/${t.workflow}`;\nexport const GITHUB_DISPATCH_TARGETS: X = [\n];');
      assert.ok(r.error);
      assert.match(r.error, /ZERO entries/);
    });

    test('the targets are read from the source, and COMMENTED-OUT ones do not count', () => {
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      const { targets, error } = dispatchTargetsFromSource(src);
      assert.equal(error, undefined);
      assert.ok(targets.length >= 3, `expected renovate, ops-watch and e2e at least; got ${targets.join(', ')}`);
      for (const t of targets) assert.match(t, /^[\w-]+\/[\w.-]+\.yml$/, `target ${t} is not repo/workflow shaped`);
    });

    // ── the VERDICT half: pure, so every branch is reachable with no network ──
    const ok = (ms, detail = 'd') => ({ lastSuccessMs: ms, detail });
    const T0 = Date.parse('2026-09-04T00:00:00Z');

    test('the duty is only as fresh as its STALER limb, and the answer says which', () => {
      const staleTimer = combineLimbProbes(ok(T0), ok(T0 - 40 * 3_600_000));
      assert.equal(staleTimer.lastSuccessMs, T0 - 40 * 3_600_000);
      assert.match(staleTimer.detail, /STALER limb is the TIMER/);
      const staleOutcome = combineLimbProbes(ok(T0 - 40 * 3_600_000), ok(T0));
      assert.equal(staleOutcome.lastSuccessMs, T0 - 40 * 3_600_000);
      assert.match(staleOutcome.detail, /STALER limb is the OUTCOME/);
    });

    test('🔴 A HEALTHY OUTCOME CANNOT CARRY A DEAD TIMER — the failure this split exists to catch', () => {
      // Before Phase 2 this state was unrepresentable: one query answered both.
      // A workflow going green on hand-presses while its cron is dead is exactly
      // what "counting manual runs let a never-firing cron look healthy" means.
      const r = combineLimbProbes(ok(T0), ok(T0 - 200 * 3_600_000));
      assert.equal(r.lastSuccessMs, T0 - 200 * 3_600_000, 'the dead timer must win, not be averaged away');
    });

    test('an unreadable limb is UNREADABLE, names which one, and never reads as fresh', () => {
      const t = combineLimbProbes(ok(T0), { unreadable: true, why: 'no CF token' });
      assert.ok(t.unreadable);
      assert.match(t.why, /timer limb/);
      assert.match(t.why, /no CF token/);
      const o = combineLimbProbes({ unreadable: true, why: 'no GH token' }, ok(T0));
      assert.ok(o.unreadable);
      assert.match(o.why, /outcome limb/);
      assert.equal(t.lastSuccessMs, undefined, 'an unreadable answer must carry no timestamp at all');
    });

    test('a missing mechanism outranks a fresh sibling — a query that answered "it is gone" is not a pass', () => {
      const r = combineLimbProbes(ok(T0), { missing: true, why: 'the table is gone' });
      assert.ok(r.missing);
      assert.match(r.why, /timer limb/);
    });

    test('unreadable outranks missing — "I could not tell" must never be reported as "it is gone"', () => {
      const r = combineLimbProbes({ missing: true, why: 'gone' }, { unreadable: true, why: 'no token' });
      assert.ok(r.unreadable, 'a dark reader beside a missing one must not be reported as a definite absence');
    });

    test('🔴 AN EMPTY TIMER RECORD PROPAGATES AS BOOTSTRAP, not as the outcome\'s healthy timestamp', () => {
      // This is the case on the very first run after the row is repointed: the
      // workflow has years of green runs and the dispatcher has written nothing
      // yet. Reporting the OUTCOME's timestamp would hide the gap completely.
      const r = combineLimbProbes(ok(T0), { lastSuccessMs: NaN, detail: 'no row.' });
      assert.ok(Number.isNaN(r.lastSuccessMs));
      assert.match(r.detail, /TIMER/);
      assert.match(r.detail, /OUTCOME/, 'both limbs must be named, or a reader cannot tell which one is empty');
    });

    test('a limb that produced no result at all is unreadable, not a silent pass', () => {
      assert.ok(combineLimbProbes(ok(T0), undefined).unreadable);
      assert.ok(combineLimbProbes(undefined, ok(T0)).unreadable);
    });

    test('describeNarrowing names both halves, so a stale line says WHICH claim went stale', () => {
      assert.equal(describeNarrowing({ job: 'github_dispatch', target: 'e2e.yml' }), 'job `github_dispatch` + target `e2e.yml`');
      assert.equal(describeNarrowing({ job: 'j' }), 'job `j`');
    });
  });

  test('every reader the committed register DECLARES is one the guard actually dispatches', () => {
    // The schema check next door proves a row cannot name an undeclared reader.
    // Nothing proved the other direction: a reader could be declared, used by a
    // row, and never dispatched by `probeRunRecords` — in which case the row
    // gets no probe at all and silently degrades to `unreadable`, which prints.
    // That is how this limb would go quiet without the number moving.
    const declared = Object.keys(realRegister()._recordReaders).filter((k) => !k.startsWith('_'));
    const src = readFileSync(resolve(CI_DIR, 'assert-ops-register.mjs'), 'utf8');
    for (const name of declared) {
      if (name === 'unreachable') continue; // by declaration, dispatched by nobody
      assert.ok(
        src.includes(`q.reader === '${name}'`),
        `\`${name}\` is declared in _recordReaders and no branch of probeRunRecords dispatches it, so every row using it would go unreadable`,
      );
    }
  });
});
