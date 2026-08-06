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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { evaluate, cadenceDays, parseJsonc, findWranglerConfigs } from '../assert-ops-register.mjs';

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
        mechanism: { substrate: 'google-drive', anchor: 'company/runbooks/backup-liveness.md', record: 'a dated file', failingValue: 'a stale date', readBy: 'the backup script' },
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
        mechanism: { substrate: 'google-drive', anchor: 'company/runbooks/backup-liveness.md', record: 'a dated file', failingValue: 'an intersection', readBy: 'this guard' },
        accessProviders: ['google'],
        source: 'verified',
      },
      // [14]O-4's domain is duties ON A CLOCK, and the three rows above are not
      // on one. Appended (never inserted) so every rows[N] index above still
      // points where its test thinks it does, and anchored OUTSIDE company/ so
      // the companyAnchored count assertion is untouched.
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

describe('assert-ops-register — mechanism, source and the company/ blind spot', () => {
  test('an anchor that is not in the tree FAILS', () => {
    const r = baseRegister();
    r.rows[0].mechanism.anchor = '.github/workflows/gone.yml';
    assert.match(messages(r), /is not in the tree/);
  });

  test('an anchor under company/ is ACCEPTED and COUNTED, because CI cannot read it', () => {
    const v = run(baseRegister());
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.companyAnchored, 2);
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
      ownerGated: true,
      ownerGap: 'console-only',
      mechanism: { substrate: 'cloudflare-registrar', anchor: 'company/runbooks/operations.md', record: 'the console', failingValue: 'auto-renew off', readBy: 'nothing yet' },
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
      mechanism: { substrate: 'windows-task-scheduler', anchor: 'company/runbooks/backup-liveness.md', record: 'LastTaskResult', failingValue: '!= 0', readBy: 'a monitor' },
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
      mechanism: { substrate: 'owner-decision', anchor: 'company/OWNER_QUEUE.md', record: 'the decisions log', failingValue: 'day 90 with no review', readBy: 'this guard' },
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
      mechanism: { substrate: 'owner-decision', anchor: 'company/OWNER_QUEUE.md', record: 'the decisions log', failingValue: 'day 90 with no review', readBy: 'this guard' },
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
      mechanism: { substrate: 'owner-decision', anchor: 'company/OWNER_QUEUE.md', record: 'x', failingValue: 'y', readBy: 'z' },
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

  test('a company/ path is NOT treated as a missing file, because CI cannot see company/', () => {
    assert.deepEqual(run(withPath('mechanism.readBy', 'company/runbooks/operations.md §0')).errors, []);
  });
});

describe('assert-ops-register — end to end, against the real repository', () => {
  test('the committed register passes its own guard', () => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: resolve(CI_DIR, '..', '..'), encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
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

    const reg = baseRegister();
    reg._delegated = { hostnames: 'tooling/monitor-register.json' };
    reg.rows[1].mechanism.anchor = 'renovate.json';
    reg.rows[2].mechanism.anchor = 'renovate.json';
    reg.rows[1].mechanism.readBy = 'the backup script';
    reg.rows[2].mechanism.readBy = 'this guard';
    writeFileSync(join(root, 'renovate.json'), '{}');
    const state = { reg, monitor: { hosts: [{ hostname: 'example.test' }] } };
    mutate(state, root);
    writeFileSync(join(root, 'tooling/ops/register.json'), JSON.stringify(state.reg));
    if (state.monitor !== null) writeFileSync(join(root, 'tooling/monitor-register.json'), JSON.stringify(state.monitor));
    return root;
  };
  const runRoot = (root) => {
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
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
