// ─────────────────────────────────────────────────────────────────────────────
// name-clearance.test.mjs — the failing cases for the PROBE:
// `tooling/store/name-clearance.mjs` and its table `tooling/store/name-probes.mjs`.
//
// 🔴 THE CASE THIS FILE EXISTS FOR IS B2: A RED CONTROL THAT DOES NOT GO GREEN.
// Every "no hit" in this design is worthless unless something proved, on the same
// run and over the same transport, that the endpoint answers at all — because a
// no-hit from a dead endpoint is byte-for-byte a no-hit from a healthy one. If
// the downgrade ever stopped happening, every probe would go on printing FREE
// against an internet it could not reach, and NOTHING ELSE IN THE TREE WOULD
// NOTICE: the record would look complete, the guard would read it and pass, and
// the belief that a name had been checked would be the only thing that had been
// created. So the transport is INJECTED and the controls are exercised against a
// stub — a red control that can only be tested against the live internet is a red
// control nobody tests.
//
// GREEN CONTROL FIRST (A1, A2). Without a healthy-stub run that produces real
// PROVEN-TAKEN and PROVEN-FREE verdicts, every downgrade below would be equally
// consistent with a probe table that answers UNDETERMINED to everything — which
// would pass this file and prove nothing at all.
//
// The register and the catalogue are THE REAL ONES. The point of the probe is
// that it walks `tooling/channel-register.json` and carries no channel list, and
// a fixture register would test a walk over a tree that does not exist.
//
// Run:  node --test tooling/ci/test/name-clearance.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { clear, rollUp, writeRecord, makeHttp, shellQuote, CoverageLost, RECORD_REL, today } from '../../store/name-clearance.mjs';
import { settle } from '../../ops/name-clearance-sweep.mjs';
import { PROBES, noProbeRegistered, PROVEN_FREE, PROVEN_TAKEN, UNDETERMINED, NOT_APPLICABLE, HELD } from '../../store/name-probes.mjs';
import { whyLines } from '../../store/name-clearance-why.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROBE_SCRIPT = join(REPO, 'tooling', 'store', 'name-clearance.mjs');
const SWEEP_SCRIPT = join(REPO, 'tooling', 'ops', 'name-clearance-sweep.mjs');

/** A stub transport. `routes` is an ordered list of [substring, response]; the
 *  first substring the URL contains wins, so a control URL and the real query
 *  can be answered differently without parsing anything. */
function stub(routes, { controlsGreen = true } = {}) {
  const CONTROLS = [
    ['bundleId=com.google.Gmail', { status: 200, json: { resultCount: 1, results: [{ trackName: 'Gmail - Email by Google' }] } }],
    ['id=com.spotify.music', { status: 200, json: null }],
    ['snaps/info/firefox', { status: 200, json: {} }],
    ['q=ublock', { status: 200, json: { count: 12, results: [] } }],
  ];
  const DEAD = { ok: false, status: 0, json: null, text: '', error: 'stubbed dead endpoint' };
  return async (url, opts = {}) => {
    for (const [needle, res] of CONTROLS) {
      if (url.includes(needle)) return controlsGreen ? { ok: true, text: '', ...res } : DEAD;
    }
    // the winget control is a POST whose body carries the keyword
    if (url.includes('manifestSearch')) {
      const kw = JSON.parse(opts.body ?? '{}')?.Query?.KeyWord ?? '';
      if (kw === 'firefox') return controlsGreen ? { ok: true, status: 200, text: '', json: { Data: [{ PackageName: 'Mozilla Firefox' }] } } : DEAD;
      return { ok: true, status: 200, text: '', json: { Data: [] } };
    }
    for (const [needle, res] of routes) if (url.includes(needle)) return { ok: true, text: '', json: null, ...res };
    return { ok: true, status: 404, text: '', json: null };
  };
}

const TAKEN_ON_ITUNES = [
  [
    'itunes.apple.com/search',
    { status: 200, json: { resultCount: 1, results: [{ trackName: 'Subly', sellerName: 'Someone Else', primaryGenreName: 'Finance', trackId: 1 }] } },
  ],
];
const NOTHING_ANYWHERE = [['itunes.apple.com/search', { status: 200, json: { resultCount: 0, results: [] } }], ['addons.mozilla.org/api/v5/addons/search', { status: 200, json: { count: 0, results: [] } }]];

describe('the probe — green controls first', () => {
  test('A1 GREEN CONTROL — a live exact iOS listing comes back PROVEN-TAKEN with its evidence', async () => {
    const r = await clear({ root: REPO, name: 'Subly', app: 'subscriptiontracker', http: stub(TAKEN_ON_ITUNES) });
    assert.equal(r.channels['ios-appstore'].verdict, PROVEN_TAKEN);
    assert.match(r.channels['ios-appstore'].why, /GLOBALLY UNIQUE/);
    assert.ok(r.channels['ios-appstore'].evidence.some((e) => e.includes('Finance')), 'the colliding listing must be attached as evidence');
    assert.equal(rollUp(r).overall, 'BLOCKED');
    assert.equal(rollUp(r).exit, 1);
  });

  test('A2 GREEN CONTROL — an empty AMO answer with its control green is PROVEN-FREE', async () => {
    const r = await clear({ root: REPO, name: 'Qwintavul', app: 'subscriptiontracker', http: stub(NOTHING_ANYWHERE) });
    assert.equal(r.channels.amo.verdict, PROVEN_FREE);
    assert.equal(r.controls.failed.length, 0);
  });

  test('A3 the register is what is walked — every channel in it appears in the record', async () => {
    const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
    const r = await clear({ root: REPO, name: 'Qwintavul', app: 'subscriptiontracker', http: stub(NOTHING_ANYWHERE) });
    assert.deepEqual(Object.keys(r.channels).sort(), register.channels.map((c) => c.id).sort());
  });
});

describe('the probe — the downgrades that make an answer honest', () => {
  test('B1 A DEAD RED CONTROL turns the SAME empty answer from PROVEN-FREE into UNDETERMINED', async () => {
    const green = await clear({ root: REPO, name: 'Qwintavul', app: 'subscriptiontracker', http: stub(NOTHING_ANYWHERE) });
    const red = await clear({ root: REPO, name: 'Qwintavul', app: 'subscriptiontracker', http: stub(NOTHING_ANYWHERE, { controlsGreen: false }) });
    assert.equal(green.channels.amo.verdict, PROVEN_FREE, 'green control first — without this the red below proves nothing');
    assert.equal(red.channels.amo.verdict, UNDETERMINED);
    assert.match(red.channels.amo.why, /RED CONTROL FAILED/);
    assert.ok(red.controls.failed.includes('amo'), 'the failed control must be recorded, not just acted on');
  });

  test('B2 a dead control downgrades EVERY networked channel, and the roll-up is COVERAGE LOST', async () => {
    const red = await clear({ root: REPO, name: 'Qwintavul', app: 'subscriptiontracker', http: stub(NOTHING_ANYWHERE, { controlsGreen: false }) });
    for (const id of ['ios-appstore', 'macos-appstore', 'android-play', 'linux-snap', 'amo']) {
      assert.equal(red.channels[id].verdict, UNDETERMINED, `${id} must not answer while its control is dead`);
    }
    assert.equal(rollUp(red).overall, 'UNDETERMINED');
    assert.equal(rollUp(red).exit, 2, 'could-not-check and checked-and-fine must never share an exit code');
  });

  test('B3 Apple never proves FREE — a clean miss with a green control is still UNDETERMINED', async () => {
    const r = await clear({ root: REPO, name: 'Qwintavul', app: 'subscriptiontracker', http: stub(NOTHING_ANYWHERE) });
    assert.equal(r.channels['ios-appstore'].verdict, UNDETERMINED);
    assert.match(r.channels['ios-appstore'].why, /NOT PROOF OF AVAILABILITY/);
    assert.match(r.channels['ios-appstore'].why, /App Store Connect/, 'the manual step that WOULD settle it must be named');
  });

  test('B4 a snap 404 is UNDETERMINED, because registered-but-unpublished 404s identically', async () => {
    const r = await clear({ root: REPO, name: 'Qwintavul', app: 'subscriptiontracker', http: stub(NOTHING_ANYWHERE) });
    assert.equal(r.channels['linux-snap'].verdict, UNDETERMINED);
    assert.match(r.channels['linux-snap'].why, /REGISTERED BUT UNPUBLISHED/);
    assert.match(r.channels['linux-snap'].why, /snapcraft register --dry-run/);
  });

  test('B5 Microsoft is never answered by software — the only authority is the reservation itself', async () => {
    const r = await clear({ root: REPO, name: 'Qwintavul', app: 'subscriptiontracker', http: stub(NOTHING_ANYWHERE) });
    assert.equal(r.channels['windows-store'].verdict, UNDETERMINED);
    assert.match(r.channels['windows-store'].why, /OWNER ONLY/);
  });

  test('B6 a channel with NO PROBE REGISTERED is reported, never silently dropped', () => {
    const answer = noProbeRegistered('a-thirteenth-channel');
    assert.equal(answer.verdict, UNDETERMINED);
    assert.match(answer.why, /NO PROBE REGISTERED/);
    assert.equal(answer.uniqueness, 'UNKNOWN');
    // and the table really does not know it — otherwise this case is unreachable
    assert.equal(PROBES['a-thirteenth-channel'], undefined);
  });
});

// 🔴 THE SELF-EXCLUSION PAIR READS THE DECLARED NAME OFF THE TREE, and does not
// spell it. Both cases below are ABOUT the name `catalog/apps.json` currently
// carries for `subscriptiontracker` — C1 that re-clearing it is not a self-collision, C2 that a
// DIFFERENT app proposing that same name still collides. A literal here is a copy
// of a value the tree owns, and on 2026-09-09 that copy went stale in the worst
// available way: this file arrived on main written against `Subly`, the rename
// branch never touched it because it did not exist there, and the merge was
// TEXTUALLY CLEAN while C2 silently inverted — `Subly` stopped being anybody's
// declared name, so the "different app" no longer collided with anything and the
// case that must bite went green for the wrong reason. Derived, it cannot happen
// again: rename the app and this pair follows it.
const DECLARED_NAME = (() => {
  const rows = JSON.parse(readFileSync(join(REPO, 'catalog', 'apps.json'), 'utf8'));
  const list = Array.isArray(rows) ? rows : rows.apps;
  const row = list.find((a) => a.slug === 'subscriptiontracker');
  assert.ok(row?.name, 'catalog/apps.json must carry a name for slug "subscriptiontracker" — without it this pair tests nothing');
  return row.name;
})();

describe('the probe — self is not a collision', () => {
  test('C1 an app re-clearing ITS OWN declared name is PROVEN-FREE on web, and says so', async () => {
    const r = await clear({ root: REPO, name: DECLARED_NAME, app: 'subscriptiontracker', http: stub(NOTHING_ANYWHERE) });
    assert.equal(r.channels.web.verdict, PROVEN_FREE);
    assert.ok(r.channels.web.evidence.some((e) => /SELF, NOT A COLLISION/.test(e)), 'the exclusion must be visible in the output, not silent');
  });

  test('C2 a DIFFERENT app proposing the same name still collides — the exclusion is not a blanket', async () => {
    const r = await clear({ root: REPO, name: DECLARED_NAME, app: 'someotherapp', http: stub(NOTHING_ANYWHERE) });
    assert.equal(r.channels.web.verdict, PROVEN_TAKEN);
    assert.equal(rollUp(r).overall, 'BLOCKED');
  });
});

/** A PROCEED that says who ruled, when and on what — the only ruling that clears.
 *  ⏱ 2026-09-24: the fixtures here carried `{ ruling: 'PROCEED' }` alone until the
 *  PR 913 review (L2) found `rollUp` clearing what limb 7 refuses. */
const COMPLETE_PROCEED = Object.freeze({ ruling: 'PROCEED', ruledBy: 'owner', ruledOn: '2026-09-09', basis: 'ADR 074' });

describe('the probe — the roll-up and the record', () => {
  test('D1 a wall outranks everything; coverage lost on a global channel outranks QUALIFIED', () => {
    const base = { controls: { green: 1, failed: [] }, trademark: { ...COMPLETE_PROCEED }, channels: {} };
    const blocked = { ...base, channels: { a: { verdict: PROVEN_TAKEN, uniqueness: 'global' }, b: { verdict: UNDETERMINED, uniqueness: 'global' } } };
    assert.equal(rollUp(blocked).overall, 'BLOCKED');
    const undet = { ...base, channels: { b: { verdict: UNDETERMINED, uniqueness: 'global' } } };
    assert.equal(rollUp(undet).overall, 'UNDETERMINED');
    const qualified = { ...base, channels: { c: { verdict: PROVEN_TAKEN, uniqueness: 'tolerated' } } };
    assert.equal(rollUp(qualified).overall, 'QUALIFIED');
    const clean = { ...base, channels: { d: { verdict: PROVEN_FREE, uniqueness: 'none' }, e: { verdict: NOT_APPLICABLE, uniqueness: 'none' } } };
    assert.equal(rollUp(clean).overall, 'CLEAR');
    assert.equal(rollUp(clean).exit, 0);
  });

  test('D2 a null trademark ruling can never roll up to CLEAR', () => {
    const r = { controls: { green: 1, failed: [] }, trademark: { ruling: null }, channels: { d: { verdict: PROVEN_FREE, uniqueness: 'none' } } };
    assert.equal(rollUp(r).overall, 'QUALIFIED');
    assert.equal(rollUp(r).exit, 1);
  });

  // ⏱ 2026-09-24 (apps-review F1). The roll-up read `ruling == null`, so ANY other
  // value cleared — the owner refusing the name included.
  // ⏱ 2026-09-24, later (the PR 913 review, L2): a refusal is a wall, so it rolls
  // up to BLOCKED, where it rolled up to QUALIFIED until then.
  test('D6 only PROCEED clears — a DO-NOT-PROCEED ruling rolls up to BLOCKED, exit 1', () => {
    const channels = { d: { verdict: PROVEN_FREE, uniqueness: 'none' } };
    const refused = { controls: { green: 1, failed: [] }, trademark: { ...COMPLETE_PROCEED, ruling: 'DO-NOT-PROCEED' }, channels };
    assert.equal(rollUp(refused).overall, 'BLOCKED');
    assert.equal(rollUp(refused).exit, 1);
    const ruled = { controls: { green: 1, failed: [] }, trademark: { ...COMPLETE_PROCEED }, channels };
    assert.equal(rollUp(ruled).overall, 'CLEAR', 'green control: the same record with PROCEED clears, so the case above is about the ruling');
    assert.equal(rollUp(ruled).exit, 0);
  });

  test('D8 (RC3) DO-NOT-PROCEED outranks coverage lost, and a bare one with no who or when still blocks', () => {
    const channels = { b: { verdict: UNDETERMINED, uniqueness: 'global' } };
    const refused = { controls: { green: 1, failed: [] }, trademark: { ruling: 'DO-NOT-PROCEED' }, channels };
    assert.equal(rollUp(refused).overall, 'BLOCKED', 'nothing ships under a refused name, whatever the channels could not tell');
    const undecided = { controls: { green: 1, failed: [] }, trademark: { ...COMPLETE_PROCEED }, channels };
    assert.equal(rollUp(undecided).overall, 'UNDETERMINED', 'green control: the same channels under a PROCEED stay UNDETERMINED');
  });

  // ⏱ 2026-09-24 (the PR 913 review, L2). `rollUp` read `ruling === 'PROCEED'` alone
  // and gave CLEAR, exit 0, to a ruling limb 7 refuses. Both now call `rulingOwed`.
  test('D9 (RC2) a PROCEED with no `basis` rolls up to QUALIFIED, never CLEAR', () => {
    const channels = { d: { verdict: PROVEN_FREE, uniqueness: 'none' } };
    const noBasis = { controls: { green: 1, failed: [] }, trademark: { ruling: 'PROCEED', ruledBy: 'owner', ruledOn: '2026-09-09' }, channels };
    assert.equal(rollUp(noBasis).overall, 'QUALIFIED');
    assert.equal(rollUp(noBasis).exit, 1);
    const bare = { controls: { green: 1, failed: [] }, trademark: { ruling: 'PROCEED' }, channels };
    assert.equal(rollUp(bare).overall, 'QUALIFIED', 'the review\'s own case: `{ruling:"PROCEED"}` with nothing else');
  });

  test('D10 a PROCEED with a blank `basis`, a blank `ruledBy` or an impossible `ruledOn` rolls up to QUALIFIED', () => {
    const channels = { d: { verdict: PROVEN_FREE, uniqueness: 'none' } };
    const blankBasis = { controls: { green: 1, failed: [] }, trademark: { ...COMPLETE_PROCEED, basis: ' ' }, channels };
    assert.equal(rollUp(blankBasis).overall, 'QUALIFIED');
    const blankBy = { controls: { green: 1, failed: [] }, trademark: { ...COMPLETE_PROCEED, ruledBy: '' }, channels };
    assert.equal(rollUp(blankBy).overall, 'QUALIFIED');
    const noSuchDay = { controls: { green: 1, failed: [] }, trademark: { ...COMPLETE_PROCEED, ruledOn: '2026-02-31' }, channels };
    assert.equal(rollUp(noSuchDay).overall, 'QUALIFIED', 'V8 parses 2026-02-31 as 3 March; it is not a date anybody ruled on');
    const leapDay = { controls: { green: 1, failed: [] }, trademark: { ...COMPLETE_PROCEED, ruledOn: '2028-02-29' }, channels };
    assert.equal(rollUp(leapDay).overall, 'CLEAR', 'green control: a real leap day is a date');
  });

  test('D11 the probe and limb 7 ask ONE completeness check, and neither carries a copy of it', () => {
    const probe = readFileSync(PROBE_SCRIPT, 'utf8');
    const limb7 = readFileSync(join(REPO, 'tooling', 'ci', 'assert-name-clearance.mjs'), 'utf8');
    assert.match(probe, /import \{ rulingOwed \} from '\.\.\/scripts\/name-ruling\.mjs';/);
    assert.match(limb7, /import \{ rulingOwed \} from '\.\.\/scripts\/name-ruling\.mjs';/);
    assert.doesNotMatch(probe, /tm\.basis\.trim\(\)|tm\.ruledBy\.trim\(\)/, 'a second copy of the check would drift from the first');
    assert.doesNotMatch(limb7, /tm\.basis\.trim\(\)|tm\.ruledBy\.trim\(\)/);
  });

  test('D3 --execute REFUSES to overwrite an existing record when a control failed', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    try {
      mkdirSync(join(tmp, 'apps', 'x'), { recursive: true });
      writeFileSync(join(tmp, RECORD_REL('x')), '{"overall":"CLEAR"}\n');
      const record = { app: 'x', slug: 'x', name: 'X', asOf: '2026-09-09', overall: 'UNDETERMINED', channels: {}, identifiers: [], controls: { green: 0, failed: ['amo'] }, trademark: { ruling: null } };
      const w = writeRecord(tmp, record);
      assert.equal(w.written, false);
      assert.match(w.why, /REFUSED/);
      assert.equal(readFileSync(join(tmp, RECORD_REL('x')), 'utf8').trim(), '{"overall":"CLEAR"}', 'the good record must be left exactly as it was');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('D4 --execute PRESERVES the owner gate — a re-probe can never extend its own waiver', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    try {
      mkdirSync(join(tmp, 'apps', 'x'), { recursive: true });
      writeFileSync(
        join(tmp, RECORD_REL('x')),
        `${JSON.stringify({ trademark: { ruling: null, ruledBy: null, ruledOn: null, ownerItem: 'O-KEEP-ME', gatedUntil: '2026-10-09' } })}\n`,
      );
      const record = { app: 'x', slug: 'x', name: 'X', asOf: '2026-09-30', overall: 'QUALIFIED', channels: {}, identifiers: [], controls: { green: 3, failed: [] }, trademark: { disclaimer: 'd', signals: [], ruling: null, ruledBy: null, ruledOn: null, ownerItem: null, gatedUntil: null } };
      assert.equal(writeRecord(tmp, record).written, true);
      const back = JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));
      assert.equal(back.trademark.gatedUntil, '2026-10-09', 'the gate date must survive a re-probe untouched');
      assert.equal(back.trademark.ownerItem, 'O-KEEP-ME');
      assert.equal(back.name.verifyKind, 'remote', 'the record ages by the same mechanism as every other dated fact');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('D7 --execute PRESERVES a recorded ruling whole, `basis` included', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    try {
      mkdirSync(join(tmp, 'apps', 'x'), { recursive: true });
      writeFileSync(
        join(tmp, RECORD_REL('x')),
        `${JSON.stringify({ trademark: { ruling: 'PROCEED', ruledBy: 'owner', ruledOn: '2026-09-09', basis: 'ADR 074', ownerItem: null, gatedUntil: null } })}\n`,
      );
      const record = { app: 'x', slug: 'x', name: 'X', asOf: '2026-09-30', overall: 'QUALIFIED', channels: {}, identifiers: [], controls: { green: 3, failed: [] }, trademark: { disclaimer: 'd', signals: [], ruling: null, ruledBy: null, ruledOn: null, basis: null, ownerItem: null, gatedUntil: null } };
      assert.equal(writeRecord(tmp, record).written, true);
      const back = JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));
      assert.equal(back.trademark.ruling, 'PROCEED');
      assert.equal(back.trademark.basis, 'ADR 074', 'a re-probe that dropped the basis would leave a ruling limb 7 refuses');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('D5 a missing register is COVERAGE LOST, not an empty clearance', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    try {
      await assert.rejects(() => clear({ root: tmp, name: 'X', app: 'x', http: stub([]) }), (e) => e instanceof CoverageLost && /channel set/i.test(e.lines.join(' ')));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // D4 carries a gate whose ruling is still null, so a writeRecord that dropped
  // `ruling`, `ruledBy` or `ruledOn` would pass it: the fresh record's nulls and
  // the carried nulls are the same bytes. The weekly sweep rewrites the record
  // on every run and lands it by pull request, so an owner's ruling that did not
  // survive the rewrite would be deleted by a bot and merged on a green gate.
  test('D6 the sweep\'s rewrite CARRIES an owner RULING — all five trademark fields survive, the evidence does not', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    try {
      mkdirSync(join(tmp, 'apps', 'x'), { recursive: true });
      writeFileSync(
        join(tmp, RECORD_REL('x')),
        `${JSON.stringify({ asOf: '2026-09-01', trademark: { disclaimer: 'old', signals: ['old signal'], ruling: 'PROCEED', ruledBy: 'owner', ruledOn: '2026-09-20', ownerItem: 'O-RULED', gatedUntil: '2026-10-09' } })}\n`,
      );
      const record = { app: 'x', slug: 'x', name: 'X', asOf: '2026-09-28', overall: 'QUALIFIED', channels: {}, identifiers: [], controls: { green: 3, failed: [] }, trademark: { disclaimer: 'd', signals: ['fresh signal'], ruling: null, ruledBy: null, ruledOn: null, ownerItem: null, gatedUntil: null } };
      assert.equal(writeRecord(tmp, record).written, true);
      const back = JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));
      assert.equal(back.trademark.ruling, 'PROCEED', 'an owner ruling must survive a re-probe');
      assert.equal(back.trademark.ruledBy, 'owner');
      assert.equal(back.trademark.ruledOn, '2026-09-20');
      assert.equal(back.trademark.ownerItem, 'O-RULED');
      assert.equal(back.trademark.gatedUntil, '2026-10-09');
      assert.deepEqual(back.trademark.signals, ['fresh signal'], 'the observations are this run\'s; only the owner\'s five fields are carried');
      assert.equal(back.asOf, '2026-09-28', 'the date is this run\'s, or the 30-day ceiling reads a date nobody measured');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ⏱ 2026-09-24 (review M2). The sweep compared the PROBE's roll-up against the
  // file's `overall`, but the probe carries no ruling: a PROCEED record re-probed
  // clean rolled up QUALIFIED, printed "CLEAR → QUALIFIED" and reported a flip
  // every Monday while writing CLEAR. One verdict, from the merged record.
  test('N5 the sweep reports the MERGED record\'s verdict — a PROCEED record re-probed clean stays CLEAR, and a second run reports no flip', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    try {
      mkdirSync(join(tmp, 'apps', 'x'), { recursive: true });
      writeFileSync(
        join(tmp, RECORD_REL('x')),
        `${JSON.stringify({ overall: 'CLEAR', trademark: { ruling: 'PROCEED', ruledBy: 'owner', ruledOn: '2026-09-20', basis: 'ADR 074', ownerItem: null, gatedUntil: null } })}\n`,
      );
      const record = {
        app: 'x', slug: 'x', name: 'X', asOf: '2026-09-28', overall: 'QUALIFIED', identifiers: [], controls: { green: 3, failed: [] },
        channels: { d: { verdict: PROVEN_FREE, uniqueness: 'global' }, e: { verdict: NOT_APPLICABLE, uniqueness: 'none' } },
        trademark: { disclaimer: 'd', signals: [], ruling: null, ruledBy: null, ruledOn: null, basis: null, ownerItem: null, gatedUntil: null },
      };
      assert.equal(rollUp(record).overall, 'QUALIFIED', 'green control: the probe alone rolls up QUALIFIED, so the verdict below is the merge\'s');

      const first = settle({ root: tmp, app: 'x', name: 'X', previous: 'CLEAR', record });
      const written = JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8')).overall;
      assert.equal(written, 'CLEAR');
      assert.equal(first.overall, written, 'the sweep\'s verdict is the one it wrote');
      assert.match(first.line, /CLEAR → CLEAR$/);
      assert.equal(first.flip, null, 'nothing flipped: the file said CLEAR and still says CLEAR');

      const second = settle({ root: tmp, app: 'x', name: 'X', previous: written, record });
      assert.equal(second.overall, 'CLEAR');
      assert.equal(second.flip, null, 'a second run over its own output reports no flip');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ⏱ 2026-09-24 (the batch that landed N5 and the PR 913 review's L2 together).
  // The probe carries no ruling, so it rolls up QUALIFIED here as well; the
  // merged record is what changes once the owner states a basis, and that one
  // change is the one flip the sweep may report.
  test('N5+L2 a PROCEED with no `basis` is written and printed QUALIFIED with no flip; stating the basis is ONE flip to CLEAR', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    const noBasis = { ruling: 'PROCEED', ruledBy: 'owner', ruledOn: '2026-09-20', basis: null, ownerItem: null, gatedUntil: null };
    try {
      mkdirSync(join(tmp, 'apps', 'x'), { recursive: true });
      writeFileSync(join(tmp, RECORD_REL('x')), `${JSON.stringify({ overall: 'QUALIFIED', trademark: noBasis })}\n`);
      const record = {
        app: 'x', slug: 'x', name: 'X', asOf: '2026-09-28', identifiers: [], controls: { green: 3, failed: [] },
        channels: { d: { verdict: PROVEN_FREE, uniqueness: 'global' } },
        trademark: { disclaimer: 'd', signals: [], ruling: null, ruledBy: null, ruledOn: null, basis: null, ownerItem: null, gatedUntil: null },
      };
      const readBack = () => JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));

      const first = settle({ root: tmp, app: 'x', name: 'X', previous: 'QUALIFIED', record });
      assert.equal(readBack().overall, 'QUALIFIED', 'a PROCEED with no basis does not clear');
      assert.equal(readBack().trademark.ruling, 'PROCEED', 'the ruling is carried, not reset');
      assert.equal(first.overall, readBack().overall, 'the sweep\'s verdict is the one it wrote');
      assert.match(first.line, /QUALIFIED → QUALIFIED$/);
      assert.equal(first.flip, null);
      const second = settle({ root: tmp, app: 'x', name: 'X', previous: first.overall, record });
      assert.equal(second.flip, null, 'a second run over its own output reports no flip');

      const doc = readBack();
      doc.trademark.basis = 'ADR 074';
      writeFileSync(join(tmp, RECORD_REL('x')), `${JSON.stringify(doc)}\n`);
      const stated = settle({ root: tmp, app: 'x', name: 'X', previous: second.overall, record });
      assert.equal(readBack().overall, 'CLEAR');
      assert.equal(stated.overall, 'CLEAR', 'the sweep prints the merged verdict; the probe alone still rolls up QUALIFIED');
      assert.match(stated.flip ?? '', /moved QUALIFIED → CLEAR/, 'the basis being stated is a real change, reported once');
      const after = settle({ root: tmp, app: 'x', name: 'X', previous: stated.overall, record });
      assert.equal(after.flip, null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('N5 a dry run rolls up the merged record and writes nothing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    try {
      mkdirSync(join(tmp, 'apps', 'x'), { recursive: true });
      const before = `${JSON.stringify({ overall: 'CLEAR', trademark: { ruling: 'PROCEED', ruledBy: 'owner', ruledOn: '2026-09-20', basis: 'ADR 074', ownerItem: null, gatedUntil: null } })}\n`;
      writeFileSync(join(tmp, RECORD_REL('x')), before);
      const record = {
        app: 'x', slug: 'x', name: 'X', asOf: '2026-09-28', identifiers: [], controls: { green: 3, failed: [] },
        channels: { d: { verdict: PROVEN_FREE, uniqueness: 'global' } },
        trademark: { disclaimer: 'd', signals: [], ruling: null, ruledBy: null, ruledOn: null, basis: null, ownerItem: null, gatedUntil: null },
      };
      const w = writeRecord(tmp, record, { dryRun: true });
      assert.equal(w.written, false);
      assert.equal(w.refused, false);
      assert.equal(w.overall, 'CLEAR');
      assert.equal(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'), before, 'a dry run leaves the record byte-for-byte');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ⏱ 2026-09-24 (review M2). `verify` spliced the name in bare, so the pasted
  // command cleared "Nikatru" — the first word — and wrote the result over the
  // record for the three-word name.
  test('N5 the record\'s verify line quotes a multi-word name, so pasting it clears the whole name', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    try {
      const record = {
        app: 'x', slug: 'x', name: 'Nikatru Subscription Tracker', asOf: '2026-09-28', identifiers: [], controls: { green: 3, failed: [] },
        channels: {}, trademark: { disclaimer: 'd', signals: [], ruling: null, ruledBy: null, ruledOn: null, basis: null, ownerItem: null, gatedUntil: null },
      };
      assert.equal(writeRecord(tmp, record).written, true);
      const back = JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));
      assert.equal(back.name.verify, "node tooling/store/name-clearance.mjs 'Nikatru Subscription Tracker' --app x --execute");
      assert.equal(shellQuote('Subly'), 'Subly', 'a one-word name needs no quotes');
      assert.equal(shellQuote("It's"), "'It'\\''s'", 'an apostrophe closes, escapes and reopens the quote');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── HELD — the owner's verdict, which no probe can read ─────────────────────
// A throwaway root with a two-channel register and a probed record over it. The
// record's `overall` is UNDETERMINED for exactly ONE reason — `ios-appstore`, a
// global channel the probe could not settle — so a hold there is the only thing
// in it that can move the roll-up, and H1's CLEAR is attributable to the hold.
const heldRecord = () => ({
  app: 'x',
  slug: 'x',
  name: { value: 'X', asOf: '2026-09-09', verify: 'node tooling/store/name-clearance.mjs X --app x --execute', verifyKind: 'remote' },
  asOf: '2026-09-09',
  channels: {
    'ios-appstore': { verdict: UNDETERMINED, uniqueness: 'global', why: 'No iOS listing carries this name.', evidence: [], control: null },
    amo: { verdict: PROVEN_FREE, uniqueness: 'tolerated', why: 'No listed add-on carries this name.', evidence: [], control: null },
  },
  identifiers: [],
  controls: { green: 1, failed: [] },
  trademark: { disclaimer: 'd', signals: [], ruling: 'PROCEED', ruledBy: 'owner', ruledOn: '2026-09-09', basis: 'ADR 074', ownerItem: null, gatedUntil: null },
  overall: 'UNDETERMINED',
});
function heldRoot() {
  const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-held-'));
  mkdirSync(join(tmp, 'tooling'), { recursive: true });
  mkdirSync(join(tmp, 'apps', 'x'), { recursive: true });
  writeFileSync(join(tmp, 'tooling', 'channel-register.json'), `${JSON.stringify({ channels: [{ id: 'ios-appstore' }, { id: 'amo' }] }, null, 2)}\n`);
  writeFileSync(join(tmp, RECORD_REL('x')), `${JSON.stringify(heldRecord(), null, 2)}\n`);
  return tmp;
}
const hold = (root, args) => spawnSync(process.execPath, [PROBE_SCRIPT, '--repo', root, ...args], { encoding: 'utf8' });

describe('the probe — HELD, the owner-recorded verdict', () => {
  test('H1 --hold writes HELD with the store record id, heldBy owner and today, and recomputes overall', () => {
    const tmp = heldRoot();
    try {
      const before = JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));
      assert.equal(before.overall, 'UNDETERMINED', 'green control: the fixture starts UNDETERMINED, so the CLEAR below is the hold');
      assert.equal(rollUp(before).overall, 'UNDETERMINED');
      const r = hold(tmp, ['--hold', 'ios-appstore', '--record', '6741234567', '--app', 'x']);
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      const back = JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));
      const ch = back.channels['ios-appstore'];
      assert.equal(ch.verdict, HELD);
      assert.equal(ch.storeRecordId, '6741234567');
      assert.equal(ch.heldBy, 'owner');
      assert.equal(ch.heldOn, today());
      assert.match(ch.why, /HELD by the owner/);
      assert.match(ch.why, /Before the hold the probe read UNDETERMINED: No iOS listing carries this name\./, 'the probe reading the hold replaced must survive in the prose');
      assert.equal(ch.uniqueness, 'global', 'the probe\'s observation fields are left as they were');
      assert.equal(back.overall, 'CLEAR', 'overall must be recomputed, not left at the pre-hold UNDETERMINED');
      assert.equal(back.channels.amo.verdict, PROVEN_FREE, 'a hold touches the one channel it names');
      assert.deepEqual(back._why, whyLines(back), 'a hold is a write, and every write regenerates `_why`');
      assert.ok(back._why.some((l) => l.includes('ios-appstore (global; store record 6741234567,')), back._why.join('\n'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('H2 --execute carries a prior HELD forward, and only a HELD', () => {
    const tmp = heldRoot();
    try {
      const prior = heldRecord();
      prior.channels['ios-appstore'] = {
        verdict: HELD,
        uniqueness: 'global',
        why: 'HELD by the owner, recorded 2026-09-20: reserved under record 6741234567.',
        evidence: [],
        control: null,
        storeRecordId: '6741234567',
        heldBy: 'owner',
        heldOn: '2026-09-20',
      };
      prior.channels.amo.verdict = UNDETERMINED;
      writeFileSync(join(tmp, RECORD_REL('x')), `${JSON.stringify(prior, null, 2)}\n`);
      const fresh = heldRecord();
      fresh.name = 'X';
      fresh.asOf = '2026-09-30';
      fresh.channels['ios-appstore'].control = { what: 'itunes lookup', green: true, detail: 'HTTP 200' };
      const w = writeRecord(tmp, fresh);
      assert.equal(w.written, true);
      assert.deepEqual(w.carriedHeld, ['ios-appstore']);
      assert.match(w.why, /HELD carried forward on ios-appstore/);
      const back = JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));
      const ch = back.channels['ios-appstore'];
      assert.equal(ch.verdict, HELD, 'a re-probe must never overwrite the owner\'s hold with its own UNDETERMINED');
      assert.equal(ch.storeRecordId, '6741234567');
      assert.equal(ch.heldBy, 'owner');
      assert.equal(ch.heldOn, '2026-09-20');
      assert.match(ch.why, /reserved under record 6741234567/);
      assert.deepEqual(ch.control, { what: 'itunes lookup', green: true, detail: 'HTTP 200' }, 'this run\'s observation is refreshed');
      assert.equal(back.channels.amo.verdict, PROVEN_FREE, 'green control: a channel that was not HELD takes this run\'s verdict');
      assert.equal(back.overall, 'CLEAR');
      assert.deepEqual(back._why, whyLines(back), '--execute regenerates `_why` from the merged record, the carried HELD included');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('H3 --hold on a channel the register does not declare exits 2 and writes nothing', () => {
    const tmp = heldRoot();
    try {
      const bytes = readFileSync(join(tmp, RECORD_REL('x')), 'utf8');
      const r = hold(tmp, ['--hold', 'ios-app-store', '--record', '6741234567', '--app', 'x']);
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /COVERAGE LOST/);
      assert.match(r.stderr, /"ios-app-store", which tooling\/channel-register\.json does not declare/);
      assert.equal(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'), bytes, 'a refused hold must leave the record byte-identical');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('H4 --hold with no store record id exits 2 and writes nothing', () => {
    const tmp = heldRoot();
    try {
      const bytes = readFileSync(join(tmp, RECORD_REL('x')), 'utf8');
      const r = hold(tmp, ['--hold', 'ios-appstore', '--app', 'x']);
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /--hold needs --record <store record id>/);
      assert.equal(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'), bytes);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  // ⏱ 2026-09-24 (the batch that landed N5 and HELD together). The probe cannot
  // see a console reservation, so it rolls `ios-appstore` up UNDETERMINED on
  // every run; the merged record carries the HELD and says CLEAR. The sweep
  // prints and compares the merged verdict, so a hold is no weekly flip.
  test('H5 a hold on the only undetermined global channel moves the record UNDETERMINED → CLEAR, and the sweep then prints CLEAR with no flip, twice', () => {
    const tmp = heldRoot();
    try {
      const readBack = () => JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));
      assert.equal(readBack().overall, 'UNDETERMINED', 'green control: ios-appstore is the one undetermined global channel');
      const h = hold(tmp, ['--hold', 'ios-appstore', '--record', '6741234567', '--app', 'x']);
      assert.equal(h.status, 0, `${h.stdout}${h.stderr}`);
      assert.equal(readBack().overall, 'CLEAR', 'the hold is the only change, and it clears the record');

      const probe = heldRecord();
      probe.name = 'X';
      probe.asOf = '2026-09-30';
      assert.equal(rollUp(probe).overall, 'UNDETERMINED', 'green control: the probe alone still rolls up UNDETERMINED, so a CLEAR below is the merge\'s');

      const first = settle({ root: tmp, app: 'x', name: 'X', previous: readBack().overall, record: probe });
      assert.equal(readBack().overall, 'CLEAR');
      assert.equal(readBack().channels['ios-appstore'].verdict, HELD, 'the sweep carries the hold forward');
      assert.equal(first.overall, 'CLEAR', 'the sweep\'s verdict is the one it wrote');
      assert.match(first.line, /CLEAR → CLEAR$/);
      assert.equal(first.flip, null, 'the hold is not re-reported as a flip by every sweep after it');

      const second = settle({ root: tmp, app: 'x', name: 'X', previous: first.overall, record: probe });
      assert.equal(second.overall, 'CLEAR');
      assert.equal(second.flip, null, 'a second run over its own output reports no flip');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('the probe — `_why` is generated from the record, on every write', () => {
  test('W1 --why rewrites `_why` and nothing else, and a second run writes nothing', () => {
    const tmp = heldRoot();
    try {
      const rec = heldRecord();
      const stale = { _why: ['SEEDED by hand, about a name this record no longer clears.'], ...rec };
      writeFileSync(join(tmp, RECORD_REL('x')), `${JSON.stringify(stale, null, 2)}\n`);
      const r = hold(tmp, ['--why', '--app', 'x']);
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /`_why` regenerated/);
      const back = JSON.parse(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'));
      assert.deepEqual(back._why, whyLines(rec));
      assert.deepEqual(Object.keys(back), Object.keys(stale), 'key order is kept');
      const { _why: _a, ...restBack } = back;
      const { _why: _b, ...restStale } = stale;
      assert.deepEqual(restBack, restStale, 'every field but `_why` is byte-for-byte the input');
      const bytes = readFileSync(join(tmp, RECORD_REL('x')), 'utf8');
      const again = hold(tmp, ['--why', '--app', 'x']);
      assert.equal(again.status, 0);
      assert.match(again.stdout, /already matches its fields; nothing written/);
      assert.equal(readFileSync(join(tmp, RECORD_REL('x')), 'utf8'), bytes);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('W2 --why with no record exits 2 and creates nothing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-why-'));
    try {
      const r = hold(tmp, ['--why', '--app', 'x']);
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /COVERAGE LOST — cannot read apps\/x\/name-clearance\.json/);
      assert.ok(!existsSync(join(tmp, 'apps')));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('W3 whyLines groups the verdicts, names the trademark state, and carries no register state', () => {
    const rec = heldRecord();
    rec.trademark = { ...rec.trademark, ruling: null, ruledBy: null, ruledOn: null, basis: null, ownerItem: 'O-FIXTURE-TRADEMARK-HOLD', gatedUntil: '2026-10-09' };
    const lines = whyLines(rec);
    assert.ok(lines.includes('Clear (PROVEN-FREE) — an authority answered "no such name" with its red control green: amo.'), lines.join('\n'));
    assert.ok(lines.includes('Blocked for a submission (UNDETERMINED) — could not check, which is never a pass: ios-appstore (global).'), lines.join('\n'));
    assert.ok(lines.some((l) => l.startsWith('Trademark: no ruling') && l.includes('O-FIXTURE-TRADEMARK-HOLD') && l.includes('2026-10-09')), lines.join('\n'));
    assert.doesNotMatch(lines.join('\n'), /\b(armed|arming|served|lane: null|submittable)\b/i, 'arming is register state; writing it into a record is how `_why[4]` went stale');
    assert.deepEqual(whyLines(rec), lines, 'pure: the same record gives the same lines');
  });
});

describe('the two executables refuse rather than pass', () => {
  test('E1 the probe with no candidate name exits 2 — it checked nothing', () => {
    const r = spawnSync(process.execPath, [PROBE_SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /COVERAGE LOST/);
  });

  test('E2 the sweep over a root with no catalogue exits 2, and sweeps nothing', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nk-nc-'));
    try {
      const r = spawnSync(process.execPath, [SWEEP_SCRIPT, '--repo', tmp], { encoding: 'utf8' });
      assert.equal(r.status, 2);
      assert.match(r.stderr, /COVERAGE LOST/);
      assert.ok(!existsSync(join(tmp, 'apps')), 'a refused sweep must not create anything');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('E3 makeHttp turns a thrown fetch into a non-answer, never into a 404', async () => {
    const http = makeHttp({
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
    });
    const r = await http('https://example.invalid/');
    assert.equal(r.ok, false);
    assert.equal(r.status, 0, 'a dead network must not be indistinguishable from "no such record"');
    assert.equal(r.json, null);
  });

  test('E4 a body that is not JSON parses to null — a JS-rendered store page is never an answer', async () => {
    const http = makeHttp({ fetchImpl: async () => ({ status: 200, text: async () => '<!doctype html><div id="app"></div>' }) });
    const r = await http('https://example.invalid/');
    assert.equal(r.status, 200);
    assert.equal(r.json, null);
  });
});
