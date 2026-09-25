// ─────────────────────────────────────────────────────────────────────────────
// ops-status.test.mjs — tooling/ops/status.mjs must be able to FAIL.
//
// [pipeline O-2] "One command answers 'is anything broken now?'"
//
// 🔴 THE THING THIS COMMAND EXISTS TO REFUSE TO DO, and the reason every case
// below exists: report a surface healthy because a socket opened. Three live
// GlitchTip monitors were `Ping` until 2026-08-11 (ids 3, 4, 5); a Ping on a
// Pages host is green while the app behind it serves a blank shell. The Ping
// cases below stay, and are fixtures rather than a description of the live
// instance: the shape has to keep being refused whether or not one exists
// today. And `platform`, `config` and `api` all
// answer `{"ok":true}` today while `events` and `consent_artifacts` hold ZERO
// rows — so a status-only assertion certifies a broken pipe.
//
// ⚠️ WHAT IS AND IS NOT PROVEN BY A GREEN RUN OF THIS SUITE. Every branch below
// is red-proven by an input written to make it red — the healthy path, a
// non-200, a 200 with an unparseable body, a 200 with a VACUOUS body on a
// data-bearing surface, a probe that could not run, and every COVERAGE LOST
// limb. Two of them are not fixtures at all:
//
//   L1  THE REAL DELEGATE REGISTER is derived here, not a hand-written copy of
//       it. `WATCHED` below comes from tooling/monitor-register.json, so a
//       hostname added to that file joins these tests without anybody editing
//       them — and a test asserting "watching 2 surfaces" would have been the
//       hand-kept list this whole command exists to replace.
//   L2  THE LIVE TRANSPORT IS EXERCISED FOR REAL against a hostname in the
//       reserved `.invalid` TLD (RFC 2606), which cannot resolve anywhere. That
//       is a genuine transport failure through the real `fetch` path — not a
//       fixture asserting that a fixture works — and it proves "a probe that
//       could not run is RED, never a skip".
//
// ⚠️ THERE IS NO "MISSING TOKEN" CASE HERE, AND ITS ABSENCE IS DELIBERATE. Every
// hostname in the delegate is a public surface answering an unauthenticated GET,
// so status.mjs requires no credential; a test for a token it does not read
// would be an assertion that cannot fail, which this repo has already shipped
// once and paid for. The fail-closed-on-environment limb it DOES have is tested
// instead: an unreadable --probes-file and an absent/unparseable register both
// exit 2, "I could not look", distinct from 1.
//
// Run:  node --test "tooling/ci/test/ops-status.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { deriveSurfaces, evaluateSurface, runStatus, statusWorstCaseMs, EXIT_OK, EXIT_UNHEALTHY, EXIT_CANNOT_LOOK } from '../../ops/status.mjs';
import { secondLookWallMs, READ_ATTEMPTS, RETRY_WALL_CEILING_MS } from '../../ops/bounded-retry.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const STATUS = join(REPO, 'tooling/ops/status.mjs');
/** ⏱ 2026-09-25: the most any one spawn of status.mjs may take here before it is
 *  killed — a hung child is a red case, never a hung suite. */
const SPAWN_TIMEOUT_MS = 60_000;

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ops-status-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** A surface as deriveSurfaces() produces one. `dataBearing` is the only axis
 *  the decision function branches on beyond status, so both values are used. */
const surface = (over = {}) => ({
  hostname: 'api.example.test',
  what: 'the API',
  derivedFrom: 'appCatalogue',
  monitorId: 2,
  url: 'https://api.example.test/v1/health',
  expectedStatus: 200,
  dataBearing: true,
  ...over,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('status — "healthy" means it produced its expected output, not that a socket opened', () => {
  test('a data-bearing surface answering the declared status with a carrying body is the pass', () => {
    const v = evaluateSurface(surface(), { status: 200, body: '{"ok":true}' });
    assert.equal(v.ok, true);
  });

  test('a NON-data-bearing surface answering the declared status is the pass — the body is not asserted', () => {
    // Deliberate scope statement: the register decides which surfaces get the
    // body assertion (by declaring a `path`), and a door-only surface passes on
    // the door. If this ever fails, the dataBearing flag stopped being read.
    const v = evaluateSurface(surface({ dataBearing: false, url: 'https://watcher.example.test/' }), {
      status: 200,
      body: '<html>a login page</html>',
    });
    assert.equal(v.ok, true);
  });

  test('a NON-200 is RED — the register declares the expected status and it is asserted', () => {
    const v = evaluateSurface(surface(), { status: 500, body: '{"ok":true}' });
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'status');
    assert.match(v.reason, /answered 500 .* expects 200/);
  });

  test('the expected status comes from the REGISTER, not from a hardcoded 200', () => {
    // A row declaring 204 must pass on 204 and fail on 200 — proving the value
    // is read rather than assumed.
    assert.equal(evaluateSurface(surface({ expectedStatus: 204, dataBearing: false }), { status: 204 }).ok, true);
    assert.equal(evaluateSurface(surface({ expectedStatus: 204, dataBearing: false }), { status: 200 }).ok, false);
  });

  test('a 200 with an EMPTY body on a data-bearing surface is RED', () => {
    const v = evaluateSurface(surface(), { status: 200, body: '' });
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'vacuous');
    assert.match(v.reason, /EMPTY body/);
  });

  test('a 200 with `{}` on a data-bearing surface is RED — this is the vacuous-body case', () => {
    const v = evaluateSurface(surface(), { status: 200, body: '{}' });
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'vacuous');
    assert.match(v.reason, /carries NOTHING/);
  });

  test('a 200 with `[]`, with only null/empty values, or with a bare scalar is RED too', () => {
    assert.equal(evaluateSurface(surface(), { status: 200, body: '[]' }).kind, 'vacuous');
    assert.equal(evaluateSurface(surface(), { status: 200, body: '{"ok":null,"detail":""}' }).kind, 'vacuous');
    assert.equal(evaluateSurface(surface(), { status: 200, body: '{"rows":[],"meta":{}}' }).kind, 'vacuous');
    assert.equal(evaluateSurface(surface(), { status: 200, body: '"ok"' }).kind, 'vacuous');
    assert.equal(evaluateSurface(surface(), { status: 200, body: 'null' }).kind, 'vacuous');
  });

  test('a 200 carrying an HTML error page instead of JSON is RED — the status-only check calls this healthy', () => {
    const v = evaluateSurface(surface(), { status: 200, body: '<!doctype html><h1>error 1000</h1>' });
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'unparseable');
    assert.match(v.reason, /NOT JSON/);
  });

  test('`{"ok":false}` still passes the body assertion — this command asserts SHAPE, and says so', () => {
    // Recorded rather than hidden: a body carrying `ok:false` is non-vacuous, so
    // it passes here and is caught by the status assertion or by the row-count
    // limb that is deliberately NOT in this command. Asserting on a field name
    // this command does not own would be inventing a contract.
    assert.equal(evaluateSurface(surface(), { status: 200, body: '{"ok":false}' }).ok, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('status — fail closed: every "I could not tell" is RED, never a skip', () => {
  test('a probe that could not run (timeout, DNS, refused) is RED', () => {
    const v = evaluateSurface(surface(), { error: 'getaddrinfo ENOTFOUND' });
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'unreachable');
    assert.match(v.reason, /COULD NOT RUN/);
  });

  test('NO probe result at all is RED — the strongest reason to refuse to say "fine"', () => {
    for (const nothing of [undefined, null, 'not-an-object']) {
      const v = evaluateSurface(surface(), nothing);
      assert.equal(v.ok, false, `${JSON.stringify(nothing)} was not treated as a failure`);
      assert.equal(v.kind, 'unreachable');
    }
  });

  test('an answer with no status code is RED rather than interpreted generously', () => {
    const v = evaluateSurface(surface(), { body: '{"ok":true}' });
    assert.equal(v.ok, false);
    assert.equal(v.kind, 'unreachable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('status — the probed set is DERIVED from stage 11\'s register, and cannot silently shrink', () => {
  /** A fixture tree whose derivation SUCCEEDS, so every mutation below is proven
   *  to fail for its own reason and not for a pre-existing one. */
  function makeTree(mutate = () => {}) {
    const root = join(TMP, `t${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    const state = {
      register: {
        _derivation: {
          _why: ['a leading-underscore key is meta, not a source'],
          appCatalogue: 'every url and api host in the catalogue',
          declared: ['the observability host no deploy config can name'],
        },
        hosts: [
          {
            hostname: 'api.example.test',
            what: 'the API',
            derivedFrom: 'appCatalogue',
            monitor: { id: 2, name: 'API health', type: 'GET', path: '/v1/health', expectedStatus: 200, verifiedOn: '2026-08-02' },
          },
          {
            hostname: 'watcher.example.test',
            role: 'observability',
            what: 'the monitor host',
            derivedFrom: 'declared',
            monitor: { id: 1, name: 'watcher', type: 'GET', expectedStatus: 200, verifiedOn: '2026-08-02' },
          },
        ],
      },
    };
    mutate(state);
    writeFileSync(join(root, 'tooling', 'monitor-register.json'), JSON.stringify(state.register));
    return root;
  }

  test('the fixture derives two surfaces, one of them data-bearing, with no problems', () => {
    const { surfaces, gaps, problems } = deriveSurfaces(makeTree());
    assert.deepEqual(problems, []);
    assert.equal(surfaces.length, 2);
    assert.equal(gaps.length, 0);
    assert.deepEqual(
      surfaces.map((s) => [s.url, s.expectedStatus, s.dataBearing]),
      [
        ['https://api.example.test/v1/health', 200, true],
        ['https://watcher.example.test/', 200, false],
      ],
    );
  });

  test('data-bearing is decided by the register\'s `path`, not by a list typed in the guard', () => {
    // Remove the path from the API row and it stops being data-bearing; add one
    // to the watcher row and it starts. If this fails, somebody typed a list.
    const { surfaces } = deriveSurfaces(
      makeTree((s) => {
        delete s.register.hosts[0].monitor.path;
        s.register.hosts[1].monitor.path = '/health';
      }),
    );
    assert.equal(surfaces.find((x) => x.hostname === 'api.example.test').dataBearing, false);
    assert.equal(surfaces.find((x) => x.hostname === 'watcher.example.test').dataBearing, true);
  });

  test('an ABSENT register is COVERAGE LOST, not an empty set of healthy surfaces', () => {
    const root = join(TMP, `empty${seq++}`);
    mkdirSync(root, { recursive: true });
    const { surfaces, problems } = deriveSurfaces(root);
    assert.equal(surfaces.length, 0);
    assert.match(problems.join(' '), /COVERAGE LOST.*does not exist/);
  });

  test('an UNPARSEABLE register is COVERAGE LOST', () => {
    const root = join(TMP, `bad${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(join(root, 'tooling', 'monitor-register.json'), '{ "hosts": [');
    assert.match(deriveSurfaces(root).problems.join(' '), /COVERAGE LOST.*could not be parsed/);
  });

  test('an EMPTY hosts array is COVERAGE LOST — an empty register accepts any deployment at all', () => {
    assert.match(deriveSurfaces(makeTree((s) => { s.register.hosts = []; })).problems.join(' '), /ZERO hosts/);
  });

  test('a register with no `hosts` array at all is COVERAGE LOST', () => {
    assert.match(deriveSurfaces(makeTree((s) => { delete s.register.hosts; })).problems.join(' '), /declares no `hosts` array/);
  });

  test('a row with no hostname is COVERAGE LOST, not a row quietly dropped from the set', () => {
    assert.match(deriveSurfaces(makeTree((s) => { delete s.register.hosts[0].hostname; })).problems.join(' '), /carries no hostname/);
  });

  test('the same hostname declared twice is COVERAGE LOST — two answers to one question', () => {
    assert.match(
      deriveSurfaces(makeTree((s) => { s.register.hosts[1].hostname = 'api.example.test'; })).problems.join(' '),
      /declares api\.example\.test twice/,
    );
  });

  test('a row whose `derivedFrom` names no declared source is COVERAGE LOST', () => {
    assert.match(
      deriveSurfaces(makeTree((s) => { s.register.hosts[0].derivedFrom = 'somebodyTypedThis'; })).problems.join(' '),
      /is not one of the register's own `_derivation` keys/,
    );
  });

  test('a row with no `derivedFrom` at all is COVERAGE LOST', () => {
    assert.match(deriveSurfaces(makeTree((s) => { delete s.register.hosts[1].derivedFrom; })).problems.join(' '), /provenance is unstated/);
  });

  // ⚠️ THE LIMB THAT CATCHES A SHRINKING WORLD, and the one the requirement calls
  // "yields fewer rows than it declares". Nothing here is individually broken:
  // the surviving row is perfectly healthy and would be probed and reported ok.
  test('a DECLARED derivation source contributing zero rows is COVERAGE LOST', () => {
    const { surfaces, problems } = deriveSurfaces(
      makeTree((s) => { s.register.hosts = [s.register.hosts[0]]; }),
    );
    assert.match(problems.join(' '), /derivation source "declared" and NOT ONE row comes from it/);
    assert.equal(surfaces.length, 0, 'a partial set must not survive a coverage loss');
  });

  test('a register with no `_derivation` block is COVERAGE LOST — there is nothing to check the rows against', () => {
    assert.match(deriveSurfaces(makeTree((s) => { delete s.register._derivation; })).problems.join(' '), /declares no `_derivation` sources/);
  });

  test('COVERAGE LOST empties BOTH surfaces and gaps — no partial report ever prints ok', () => {
    const r = deriveSurfaces(makeTree((s) => { s.register.hosts[0].derivedFrom = 'nonsense'; }));
    assert.ok(r.problems.length > 0);
    assert.deepEqual(r.surfaces, []);
    assert.deepEqual(r.gaps, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('status — the owner-gated gap is CLASSIFIED, COUNTED and never fatal', () => {
  function makeGappyTree(mutate = () => {}) {
    const root = join(TMP, `g${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    const register = {
      _derivation: { appCatalogue: 'the catalogue', workerCustomDomains: 'worker routes' },
      hosts: [
        {
          hostname: 'api.example.test',
          derivedFrom: 'appCatalogue',
          monitor: { id: 2, type: 'GET', path: '/v1/health', expectedStatus: 200 },
        },
        // no monitor at all — the platform.nikatru.com / config.nikatru.com shape
        {
          hostname: 'platform.example.test',
          derivedFrom: 'workerCustomDomains',
          monitor: null,
          gap: { why: 'never monitored since the Worker shipped', action: 'Create a GlitchTip uptime monitor.' },
        },
        // a Ping — the shape that is green while the page is a blank shell
        { hostname: 'site.example.test', derivedFrom: 'appCatalogue', monitor: { id: 4, type: 'Ping' } },
        // a GET with nothing to assert the answer against
        { hostname: 'other.example.test', derivedFrom: 'appCatalogue', monitor: { id: 5, type: 'GET' } },
      ],
    };
    mutate(register);
    writeFileSync(join(root, 'tooling', 'monitor-register.json'), JSON.stringify(register));
    return root;
  }

  test('a row with no monitor, a Ping row and an expectedStatus-less GET are all GAPS, not probes', () => {
    const { surfaces, gaps, problems } = deriveSurfaces(makeGappyTree());
    assert.deepEqual(problems, []);
    assert.equal(surfaces.length, 1);
    assert.equal(gaps.length, 3);
    assert.deepEqual(gaps.map((g) => g.kind).sort(), ['no-expected-status', 'no-monitor', 'not-a-get']);
  });

  test('a Ping gap says WHY a ping is not health, so the printed line is readable on its own', () => {
    const { gaps } = deriveSurfaces(makeGappyTree());
    assert.match(gaps.find((g) => g.kind === 'not-a-get').why, /a socket opened, not that the surface produced its expected output/);
  });

  test('a monitor-less row with no stated reason still becomes a gap, and says so', () => {
    const { gaps } = deriveSurfaces(makeGappyTree((r) => { delete r.hosts[1].gap; }));
    assert.match(gaps.find((g) => g.kind === 'no-monitor').why, /no reason recorded/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('status — through the CLI: exit codes, the printed count, and the live transport', () => {
  const probes = (obj) => {
    const p = join(TMP, `p${seq++}.json`);
    writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  // ⏱ 2026-09-25: every spawn carries a `timeout`, and `env` lets the LIVE case
  // shorten the second look's gaps (row O-OPS-PROBE-US-EDGE-STALL).
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [STATUS, ...args], { cwd: REPO, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, env: { ...process.env, ...env } });

  /** One healthy surface, one gap-free tree; used for the 0-gap print. */
  function cleanTree() {
    const root = join(TMP, `c${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(
      join(root, 'tooling', 'monitor-register.json'),
      JSON.stringify({
        _derivation: { appCatalogue: 'the catalogue' },
        hosts: [{ hostname: 'api.example.test', derivedFrom: 'appCatalogue', monitor: { id: 2, type: 'GET', path: '/v1/health', expectedStatus: 200 } }],
      }),
    );
    return root;
  }

  /** One healthy surface plus FIVE unprobeable ones. Five was the live gap count
   *  when this was written; it is a fixture, not a reading of the register. */
  function gappyTree() {
    const root = join(TMP, `q${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    const gapRow = (n) => ({ hostname: `gap${n}.example.test`, derivedFrom: 'appCatalogue', monitor: null, gap: { why: `gap ${n}` } });
    writeFileSync(
      join(root, 'tooling', 'monitor-register.json'),
      JSON.stringify({
        _derivation: { appCatalogue: 'the catalogue' },
        hosts: [
          { hostname: 'api.example.test', derivedFrom: 'appCatalogue', monitor: { id: 2, type: 'GET', path: '/v1/health', expectedStatus: 200 } },
          ...[1, 2, 3, 4, 5].map(gapRow),
        ],
      }),
    );
    return root;
  }

  test('--help runs and exits 0', () => {
    const r = run(['--help']);
    assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /is anything broken right now/i);
  });

  test('a healthy fixture exits 0', () => {
    const r = run(['--root', cleanTree(), '--probes-file', probes({ 'api.example.test': { status: 200, body: '{"ok":true}' } })]);
    assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /every probed surface produced its expected output/);
  });

  test('an unhealthy surface exits 1 — "I looked, and it is broken"', () => {
    const r = run(['--root', cleanTree(), '--probes-file', probes({ 'api.example.test': { status: 503, body: '{"ok":true}' } })]);
    assert.equal(r.status, EXIT_UNHEALTHY);
    assert.match(r.stderr, /are NOT healthy/);
  });

  test('a 200 with a vacuous body on a data-bearing surface exits 1 through the whole command', () => {
    const r = run(['--root', cleanTree(), '--probes-file', probes({ 'api.example.test': { status: 200, body: '{}' } })]);
    assert.equal(r.status, EXIT_UNHEALTHY, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /carries NOTHING/);
  });

  test('a surface the fixture never answers for exits 1 — an unprobed surface is not a passed one', () => {
    const r = run(['--root', cleanTree(), '--probes-file', probes({})]);
    assert.equal(r.status, EXIT_UNHEALTHY);
    assert.match(r.stderr, /NO probe result at all/);
  });

  test('a LOST-COVERAGE register exits 2, NOT 1 — "I could not look" is a different answer', () => {
    const root = join(TMP, `nolook${seq++}`);
    mkdirSync(root, { recursive: true });
    const r = run(['--root', root, '--probes-file', probes({})]);
    assert.equal(r.status, EXIT_CANNOT_LOOK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST/);
    assert.match(r.stderr, /NOTHING was probed on this run/);
  });

  test('an unreadable --probes-file exits 2 rather than being treated as "no results"', () => {
    const r = run(['--root', cleanTree(), '--probes-file', join(TMP, 'nope.json')]);
    assert.equal(r.status, EXIT_CANNOT_LOOK);
    assert.match(r.stderr, /could not read probe fixture/);
  });

  test('fixture mode announces itself loudly, so it can never pass unnoticed in a real ops log', () => {
    const r = run(['--root', cleanTree(), '--probes-file', probes({ 'api.example.test': { status: 200, body: '{"ok":true}' } })]);
    assert.match(r.stdout, /OFFLINE FIXTURE MODE/);
  });

  // ── the gap PRINT, asserted on the COUNT ─────────────────────────────────
  test('five unprobeable hostnames print as "5 of 6", and do NOT fail the build', () => {
    const r = run(['--root', gappyTree(), '--probes-file', probes({ 'api.example.test': { status: 200, body: '{"ok":true}' } })]);
    assert.equal(r.status, EXIT_OK, `a printed gap must never block: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /5 of 6 declared hostname\(s\) CANNOT BE PROBED/);
    // The print used to tag the whole class OWNER_QUEUE S-8. It is not owner
    // work — ids 11 and 12 were CREATED and ids 3, 4 and 5 CONVERTED with the
    // vault token — so what must survive is the reason it does not block, and
    // an explicit refusal to re-file it as owner-only.
    assert.match(r.stdout, /a disabled guard checks nothing/);
    assert.match(r.stdout, /NOT a claim that the work is owner-only/);
  });

  test('ZERO gaps prints "0 of 1" — the count is there either way, so the two never read identically', () => {
    const r = run(['--root', cleanTree(), '--probes-file', probes({ 'api.example.test': { status: 200, body: '{"ok":true}' } })]);
    assert.match(r.stdout, /0 of 1 declared hostname\(s\) are unprobeable/);
    assert.doesNotMatch(r.stdout, /CANNOT BE PROBED/);
  });

  test('the bound on what a green run proves is printed on every run, gap or no gap', () => {
    const r = run(['--root', cleanTree(), '--probes-file', probes({ 'api.example.test': { status: 200, body: '{"ok":true}' } })]);
    assert.match(r.stdout, /WHAT A GREEN RUN DOES NOT PROVE/);
    assert.match(r.stdout, /ZERO rows/);
  });

  // ── L2: the LIVE transport, for real, with no network dependency ──────────
  // 🔴 THIS CASE ASSERTED EXIT 1 UNTIL 2026-09-21, AND EXIT 1 WAS THE BUG.
  // A host that resolves nowhere is the same evidence a DNS blip on the runner
  // produces, and this reader called both "I looked, it is broken". It is now
  // COVERAGE LOST, after the bounded plan is exhausted — which is also why this
  // case now takes ~3 s: it is the ceiling being spent, measured rather than
  // asserted in prose (row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED, sweep clause).
  test('LIVE — a surface that never answers exits 2, not 1, through the real fetch path', () => {
    // `.invalid` is reserved by RFC 2606 and resolves nowhere, so this is a
    // genuine transport failure rather than a fixture describing one. No
    // --probes-file: the real prober runs.
    const root = join(TMP, `live${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(
      join(root, 'tooling', 'monitor-register.json'),
      JSON.stringify({
        _derivation: { appCatalogue: 'the catalogue' },
        hosts: [{ hostname: 'nikatru-ops-status.invalid', derivedFrom: 'appCatalogue', monitor: { id: 99, type: 'GET', expectedStatus: 200 } }],
      }),
    );
    // ⏱ 2026-09-25: the unreached surface now also takes the SECOND LOOK; its
    // 15 s gaps are shortened to 0 here (the knob can only shorten), so the case
    // still spends the real ceiling and not a minute of sleep.
    const r = run(['--root', root], { OPS_SECOND_LOOK_GAP_MS: '0' });
    assert.equal(r.status, EXIT_CANNOT_LOOK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST/);
    assert.match(r.stderr, /NOTHING ANSWERED/);
    assert.match(r.stdout, /SECOND LOOK/);
    assert.doesNotMatch(r.stdout, /OFFLINE FIXTURE MODE/);
  });

  test('🔴 FIXTURE — nothing on the first pass, an answer on second-look attempt 2: exit 0, and the SLOW PATH block names it', () => {
    const r = run([
      '--root', cleanTree(),
      '--probes-file', probes({
        'api.example.test': { unreached: 'no answer within 10s (stub)', secondLook: [{ unreached: 'again' }, { status: 200, body: '{"ok":true}' }] },
      }),
    ]);
    assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /⚠ SLOW PATH — 1 surface\(s\) answered only on the SECOND LOOK/);
    assert.match(r.stdout, /api\.example\.test — nothing on any of the 3 first-pass attempt\(s\); second-look attempt 2\/4 answered 200\./);
  });

  test('🔴 FIXTURE — an unreached row with no second-look answer is still exit 2, COVERAGE LOST', () => {
    const r = run(['--root', cleanTree(), '--probes-file', probes({ 'api.example.test': { unreached: 'no answer (stub)' } })]);
    assert.equal(r.status, EXIT_CANNOT_LOOK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /COVERAGE LOST/);
    assert.doesNotMatch(r.stdout, /SLOW PATH/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-25 — THE SECOND LOOK (row O-OPS-PROBE-US-EDGE-STALL). ops-watch went
// red with NOTHING ANSWERED three times (runs 35996417635, 36110724525,
// 36113462303) from surfaces that were up: a US Cloudflare edge stalled in front
// of the Mumbai tunnel (edge 499, origin 0) for longer than the ~33 s first pass.
// runStatus is driven IN PROCESS with an injected fetch and a recording sleep:
// no socket, no real wait. The stall is a dropped connection, the same class a
// hung attempt ends in, so it is re-asked exactly like one.
describe('status — the second look: a stall is looked at twice, and never forgiven', () => {
  const stall = () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
  };
  const answer = (status, body = '{"ok":true}') => new Response(body, { status });
  /** A fetch that answers per HOST from a script (the last entry repeats). */
  const scripted = (byHost) => {
    const calls = {};
    const doFetch = async (url) => {
      const host = new URL(url).hostname;
      calls[host] = (calls[host] ?? 0) + 1;
      const plan = byHost[host];
      return plan[Math.min(calls[host] - 1, plan.length - 1)]();
    };
    return { doFetch, calls };
  };
  const tree = (hosts) => {
    const root = join(TMP, `s${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    writeFileSync(
      join(root, 'tooling', 'monitor-register.json'),
      JSON.stringify({
        _derivation: { appCatalogue: 'the catalogue' },
        hosts: hosts.map((hostname, i) => ({ hostname, derivedFrom: 'appCatalogue', monitor: { id: 50 + i, type: 'GET', path: '/v1/health', expectedStatus: 200 } })),
      }),
    );
    return root;
  };
  const go = async (hosts, byHost) => {
    const { doFetch, calls } = scripted(byHost);
    const slept = [];
    const out = [];
    const err = [];
    const code = await runStatus({
      root: tree(hosts),
      probesFile: null,
      doFetch,
      sleep: async (ms) => { slept.push(ms); },
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    return { code, calls, slept, out: out.join('\n'), err: err.join('\n') };
  };

  test('(a) 🔴 nothing on the first pass, healthy on the second look → exit 0, and the SLOW PATH block is printed', async () => {
    const r = await go(['a.example.test'], { 'a.example.test': [stall, stall, stall, stall, () => answer(200)] });
    assert.equal(r.code, EXIT_OK, `${r.out}\n${r.err}`);
    assert.equal(r.calls['a.example.test'], 5, '3 first-pass attempts + 2 second-look attempts, and not one more');
    assert.deepEqual(r.slept, [1000, 2000, 15_000]);
    assert.match(r.out, /⚠ SLOW PATH — 1 surface\(s\) answered only on the SECOND LOOK/);
    assert.match(r.out, /a\.example\.test — nothing on any of the 3 first-pass attempt\(s\); second-look attempt 2\/4 answered 200\./);
    assert.match(r.out, /ok {2}every probed surface produced its expected output/);
  });

  test('(b) 🔴 the second look answers UNHEALTHY → exit 1, graded exactly like a first-pass answer', async () => {
    const r = await go(['a.example.test'], { 'a.example.test': [stall, stall, stall, () => answer(502, 'error code: 502')] });
    assert.equal(r.code, EXIT_UNHEALTHY, `${r.out}\n${r.err}`);
    assert.match(r.err, /1 of 1 probed surface\(s\) are NOT healthy/);
    assert.doesNotMatch(r.err, /COVERAGE LOST/);
    assert.match(r.out, /second-look attempt 1\/4 answered 502\./, 'the slow path is printed on a red run too');
  });

  test('(c) 🔴 nothing on the second look either → exit 2, COVERAGE LOST, after 3 + 4 attempts', async () => {
    const r = await go(['a.example.test'], { 'a.example.test': [stall] });
    assert.equal(r.code, EXIT_CANNOT_LOOK, `${r.out}\n${r.err}`);
    assert.equal(r.calls['a.example.test'], 7);
    assert.deepEqual(r.slept, [1000, 2000, 15_000, 15_000, 15_000]);
    assert.match(r.err, /COVERAGE LOST — 1 of 1 probed surface\(s\) NEVER ANSWERED, on any of the 3 attempts nor on any of the 4 second-look attempts/);
    assert.match(r.err, /SECOND LOOK: /);
    assert.doesNotMatch(r.out, /SLOW PATH/);
  });

  test('only the UNREACHED are looked at again, and they are looked at IN PARALLEL', { timeout: 5000 }, async () => {
    // Each lost surface's first second-look attempt waits until BOTH have
    // arrived. Looked at one after the other, the first would wait for ever and
    // the case's { timeout } would red it; in parallel, nobody waits.
    let arrived = 0;
    let release;
    const barrier = new Promise((r) => { release = r; });
    const meet = async () => {
      arrived += 1;
      if (arrived === 2) release();
      await barrier;
      return answer(200);
    };
    const r = await go(['up.example.test', 'b.example.test', 'c.example.test'], {
      'up.example.test': [() => answer(200)],
      'b.example.test': [stall, stall, stall, meet],
      'c.example.test': [stall, stall, stall, meet],
    });
    assert.equal(r.code, EXIT_OK, `${r.out}\n${r.err}`);
    assert.equal(r.calls['up.example.test'], 1, 'a surface that answered is never asked twice');
    assert.equal(r.calls['b.example.test'], 4);
    assert.equal(r.calls['c.example.test'], 4);
    assert.match(r.out, /⚠ SLOW PATH — 2 surface\(s\)/);
  });

  test('(d) the DERIVED worst case of one status run fits the status job\'s timeout-minutes, with margin', (t) => {
    // Every term comes from a constant, never from a number typed here.
    assert.equal(statusWorstCaseMs(0), secondLookWallMs(10_000), 'the second look runs ONCE, whatever the count');
    assert.equal(statusWorstCaseMs(1) - statusWorstCaseMs(0), READ_ATTEMPTS * 10_000 + RETRY_WALL_CEILING_MS, 'one surface costs one bounded read');
    const n = deriveSurfaces(REPO).surfaces.length;
    assert.ok(n > 0, 'the real register derived ZERO surfaces, so this fits nothing');
    const wf = readFileSync(join(REPO, '.github/workflows/ops-watch.yml'), 'utf8');
    const job = wf.match(/\n {2}status:\n([\s\S]*?)(?=\n {2}[a-z][\w-]*:\n)/);
    assert.ok(job, 'no `status:` job in ops-watch.yml');
    assert.match(job[1], /node tooling\/ops\/status\.mjs/, 'the `status:` job no longer runs status.mjs');
    const minutes = Number(job[1].match(/\n {4}timeout-minutes: (\d+)/)?.[1]);
    assert.ok(minutes > 0, 'the status job carries no timeout-minutes');
    const worst = statusWorstCaseMs(n);
    const budget = minutes * 60_000;
    t.diagnostic(`${n} surfaces: worst case ${worst / 1000} s against ${budget / 1000} s — ${(budget - worst) / 1000} s spare`);
    assert.ok(worst <= budget, `${n} surfaces × ${(READ_ATTEMPTS * 10_000 + RETRY_WALL_CEILING_MS) / 1000} s + ${secondLookWallMs(10_000) / 1000} s = ${worst / 1000} s exceeds the ${minutes}-minute job`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('status — end to end through the REAL delegate register', () => {
  // ⚠️ DERIVED, NOT TYPED. If these were written as `{'api.nikatru.com': …}` the
  // suite would be a second enumeration of the hostname set — the exact thing
  // [11]E-9's register exists to prevent, and the thing that lets a newly added
  // host be "covered" by tests that have never heard of it.
  const real = deriveSurfaces(REPO);
  const probes = (obj) => {
    const p = join(TMP, `r${seq++}.json`);
    writeFileSync(p, JSON.stringify(obj));
    return p;
  };
  const healthy = (over = {}) =>
    Object.fromEntries(real.surfaces.map((s) => [s.hostname, { status: s.expectedStatus, body: '{"ok":true}', ...over }]));
  const run = (file) => spawnSync(process.execPath, [STATUS, '--probes-file', file], { cwd: REPO, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS });

  test('the real register derives cleanly and yields a NON-EMPTY probed set — the floor every case below stands on', () => {
    // Without this, an accidentally-empty derivation makes `healthy()` an empty
    // object, the command probes nothing, exits 0, and every assertion below
    // passes while checking nothing at all.
    assert.deepEqual(real.problems, []);
    assert.ok(real.surfaces.length > 0, 'COVERAGE LOST — the real register derived ZERO probeable surfaces');
    assert.ok(real.surfaces.some((s) => s.dataBearing), 'no real surface is data-bearing, so the body limb is exercised against nothing');
  });

  test('every row of the real register is accounted for — probed or printed, none silently dropped', () => {
    const declared = JSON.parse(readFileSync(join(REPO, 'tooling/monitor-register.json'), 'utf8')).hosts.length;
    assert.equal(real.surfaces.length + real.gaps.length, declared);
  });

  test('a healthy fixture over the real derivation exits 0 and names the derived count', () => {
    const r = run(probes(healthy()));
    assert.equal(r.status, EXIT_OK, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, new RegExp(`probing ${real.surfaces.length} surface\\(s\\) derived from tooling/monitor-register\\.json`));
  });

  test('EVERY real probed surface is graded — a failure in ANY ONE of them is caught', () => {
    // With a hand-written fixture, a surface added to the register but never
    // exercised is covered on paper only. Here each is in turn the ONLY
    // unhealthy one, and each must be caught by name.
    for (const s of real.surfaces) {
      const rows = healthy();
      rows[s.hostname] = { status: 599, body: '{"ok":true}' };
      const r = run(probes(rows));
      assert.equal(r.status, EXIT_UNHEALTHY, `a failing "${s.hostname}" was NOT caught`);
      assert.match(r.stderr, new RegExp(s.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) /* every metacharacter (CodeQL #25) */);
    }
  });

  test('EVERY real DATA-BEARING surface rejects a vacuous body — the {"ok":true}-over-an-empty-table case', () => {
    const dataBearing = real.surfaces.filter((s) => s.dataBearing);
    for (const s of dataBearing) {
      const rows = healthy();
      rows[s.hostname] = { status: s.expectedStatus, body: '{}' };
      const r = run(probes(rows));
      assert.equal(r.status, EXIT_UNHEALTHY, `a vacuous body from "${s.hostname}" was NOT caught`);
    }
  });

  test('the real register\'s owner-gated gaps print with their count and do not block', () => {
    const r = run(probes(healthy()));
    assert.equal(r.status, EXIT_OK);
    const declared = real.surfaces.length + real.gaps.length;
    const expected = real.gaps.length
      ? new RegExp(`${real.gaps.length} of ${declared} declared hostname\\(s\\) CANNOT BE PROBED`)
      : new RegExp(`0 of ${declared} declared hostname\\(s\\) are unprobeable`);
    assert.match(r.stdout, expected);
  });
});
