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

import { clear, rollUp, writeRecord, makeHttp, CoverageLost, RECORD_REL } from '../../store/name-clearance.mjs';
import { PROBES, noProbeRegistered, PROVEN_FREE, PROVEN_TAKEN, UNDETERMINED, NOT_APPLICABLE } from '../../store/name-probes.mjs';

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

describe('the probe — the roll-up and the record', () => {
  test('D1 a wall outranks everything; coverage lost on a global channel outranks QUALIFIED', () => {
    const base = { controls: { green: 1, failed: [] }, trademark: { ruling: 'PROCEED' }, channels: {} };
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
  test('D6 only PROCEED clears — a DO-NOT-PROCEED ruling can never roll up to CLEAR', () => {
    const channels = { d: { verdict: PROVEN_FREE, uniqueness: 'none' } };
    const refused = { controls: { green: 1, failed: [] }, trademark: { ruling: 'DO-NOT-PROCEED' }, channels };
    assert.equal(rollUp(refused).overall, 'QUALIFIED');
    assert.equal(rollUp(refused).exit, 1);
    const ruled = { controls: { green: 1, failed: [] }, trademark: { ruling: 'PROCEED' }, channels };
    assert.equal(rollUp(ruled).overall, 'CLEAR', 'green control: the same record with PROCEED clears, so the case above is about the ruling');
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
