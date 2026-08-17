// ─────────────────────────────────────────────────────────────────────────────
// monitor-coverage.test.mjs — assert-monitor-coverage.mjs must be able to FAIL.
//
// [pipeline E-9] every live hostname has a monitor, and the list cannot silently
// shrink.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-02, SIX).
// Every restore was byte-compared (`git status --short` back to the untracked
// new files alone) and the guard re-run to its passing line.
//
//   MN1  services/platform/wrangler.jsonc gains a       -> caught: "events.nikatru.com is
//        third `custom_domain: true` route                  deployed by this repository
//        (events.nikatru.com)                               (workerCustomDomains) and has
//                                                           NO row"
//   MN2  the platform.nikatru.com ROW deleted from      -> caught: same failure from the
//        the register                                       other side
//   MN3  `role: "observability"` deleted from the       -> caught: COVERAGE LOST — "no row
//        glitchtip row                                      carries `role: observability`"
//   MN4  api.nikatru.com's monitor loses `verifiedOn`   -> caught: "claims a monitor but the
//                                                           claim is incomplete"
//   MN5  the <link rel="canonical"> deleted from BOTH   -> caught: COVERAGE LOST — "the
//        sites/*/index.html                                 siteCanonicals derivation
//                                                           yielded no hostname"
//   MN6  a row added for old.nikatru.com, which         -> caught: "has a row … and nothing
//        nothing deploys                                    in the tree deploys it"
//   None crashed; every one exited 1 with the intended message.
//
// 🔴 THE RED THIS GUARD RECORDS, on the tree as it stands and verified against
//   the LIVE GlitchTip API on 2026-08-02 by tooling/ops/verify-monitors.mjs:
//   platform.nikatru.com and config.nikatru.com are bound as custom domains in
//   services/platform/wrangler.jsonc and NOTHING WATCHES EITHER. The first is
//   the whole analytics + DPDP consent rail for every app in the portfolio; the
//   second is the pre-consent launch fetch every client makes. Both have been
//   unwatched since the Worker shipped, and nobody had decided that.
//
// ⚠️ THAT GAP PRINTS RATHER THAN FAILING, so this suite asserts BOTH halves of
//   that choice: that the gap is on stdout, and that the guard still exits 0.
//   A test that only checked the exit code would pass just as happily if the
//   gap stopped being mentioned at all — which is the failure mode of every
//   "printed, not hidden" limb in this repository.
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
const GUARD = join(CI_DIR, 'assert-monitor-coverage.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-monitor-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** A wrangler config with a comment that NAMES a hostname in prose. The comment
 *  must not become a deployed hostname — the same defect as the `r2_buckets`
 *  grep that matched the comment explaining there is no r2_buckets. */
const PLATFORM_WRANGLER = `{
  "name": "platform",
  "main": "src/index.ts",
  // legacy.nikatru.com used to be routed here and is NOT any more.
  "routes": [
    { "pattern": "config.example.test", "custom_domain": true },
    { "pattern": "platform.example.test", "custom_domain": true },
    // A non-custom-domain route is a PATTERN on an existing zone, not a host
    // this repo brings into existence; it is deliberately not derived.
    { "pattern": "example.test/legacy/*", "zone_name": "example.test" },
  ],
}`;

const APPS_JSON = JSON.stringify(
  [{ slug: 'demo', name: 'Demo', url: 'https://demo.example.test', api: 'https://api.example.test', status: 'live' }],
  null,
  2,
);

const SITE_HTML = (host) => `<!doctype html>
<html><head>
<link rel="canonical" href="https://${host}/">
<meta property="og:url" content="https://${host}/">
</head><body>ok</body></html>
`;

const monitor = (id, name, type = 'Ping') => ({ id, name, type, intervalSeconds: 60, verifiedOn: '2026-08-02' });

const REGISTER = () => ({
  hosts: [
    { hostname: 'main.example.test', derivedFrom: 'siteCanonicals', monitor: monitor(1, 'main') },
    { hostname: 'founder.example.test', derivedFrom: 'siteCanonicals', monitor: monitor(2, 'founder') },
    { hostname: 'demo.example.test', derivedFrom: 'appCatalogue', monitor: monitor(3, 'demo') },
    { hostname: 'api.example.test', derivedFrom: 'appCatalogue', monitor: monitor(4, 'api', 'GET') },
    {
      hostname: 'watcher.example.test',
      role: 'observability',
      derivedFrom: 'declared',
      why: 'the thing doing the watching — no deploy config can name it',
      monitor: monitor(5, 'watcher', 'GET'),
    },
    { hostname: 'config.example.test', derivedFrom: 'workerCustomDomains', monitor: monitor(6, 'config') },
    {
      hostname: 'platform.example.test',
      derivedFrom: 'workerCustomDomains',
      monitor: null,
      gap: { why: 'nothing watches the shared ingest', action: 'create a monitor', openedOn: '2026-08-02' },
    },
  ],
  observability: { decidedOn: null, decidedBy: null },
});

function makeRepo(edit = (f) => f) {
  const root = join(TMP, `r${seq++}`);
  const files = edit({
    'services/platform/wrangler.jsonc': PLATFORM_WRANGLER,
    'catalog/apps.json': APPS_JSON,
    'sites/main/index.html': SITE_HTML('main.example.test'),
    'sites/founder/index.html': SITE_HTML('founder.example.test'),
    'tooling/monitor-register.json': JSON.stringify(REGISTER(), null, 2),
  });
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    const p = join(root, ...rel.split('/'));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

/** Edit the register through its parsed form — a text replace on JSON is how a
 *  fixture starts asserting about whitespace instead of about structure. */
const withRegister = (mutate) => (f) => {
  const r = JSON.parse(f['tooling/monitor-register.json']);
  mutate(r);
  return { ...f, 'tooling/monitor-register.json': JSON.stringify(r, null, 2) };
};

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-monitor-coverage — the deployed set is derived, not typed', () => {
  test('PASSES when every derived hostname has a row', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /6 deployed hostname\(s\) derived from 3 source\(s\)/);
    assert.match(r.out, /workerCustomDomains: 2, appCatalogue: 2, siteCanonicals: 2/);
  });

  test('FAILS when a Worker gains a custom domain nothing declares', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/wrangler.jsonc': f['services/platform/wrangler.jsonc'].replace(
        '{ "pattern": "platform.example.test", "custom_domain": true },',
        '{ "pattern": "platform.example.test", "custom_domain": true },\n    { "pattern": "events.example.test", "custom_domain": true },',
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /events\.example\.test is deployed by this repository \(workerCustomDomains\) and has NO row/);
  });

  test('FAILS when the app catalogue advertises a host nothing declares', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'catalog/apps.json': JSON.stringify(
        [...JSON.parse(f['catalog/apps.json']),
          { slug: 'two', name: 'Two', url: 'https://two.example.test', status: 'live' }],
        null,
        2,
      ),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /two\.example\.test is deployed by this repository \(appCatalogue\) and has NO row/);
  });

  test('FAILS when a register row for a deployed host is deleted', () => {
    const r = run(makeRepo(withRegister((reg) => {
      reg.hosts = reg.hosts.filter((h) => h.hostname !== 'config.example.test');
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /config\.example\.test is deployed by this repository .* and has NO row/);
  });

  test('a hostname named only in a wrangler COMMENT is not a deployed host', () => {
    // The fixture's config carries `legacy.nikatru.com` in a `//` comment. If
    // comments were scanned it would be an undeclared deployed hostname and the
    // passing case above could never be green — asserted explicitly so that is
    // not an accident.
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /legacy/);
  });

  test('a route WITHOUT custom_domain is not a deployed host', () => {
    // `example.test/legacy/*` is a pattern on a zone that already exists, not a
    // hostname this repo brings into being.
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /legacy\/\*/);
  });

  test('FAILS on a dead row — a declared host nothing deploys', () => {
    const r = run(makeRepo(withRegister((reg) => {
      reg.hosts.push({ hostname: 'old.example.test', derivedFrom: 'appCatalogue', monitor: monitor(9, 'old') });
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /old\.example\.test has a row .* and nothing in the tree deploys it/);
  });

  test('a `declared` row WITH a reason is not a dead row', () => {
    // watcher.example.test is in the passing fixture and is derived by nothing.
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /watcher\.example\.test has a row/);
  });

  test('FAILS a `declared` row with no reason', () => {
    const r = run(makeRepo(withRegister((reg) => {
      delete reg.hosts.find((h) => h.role === 'observability').why;
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /watcher\.example\.test has a row .* and nothing in the tree deploys it/);
  });
});

describe('assert-monitor-coverage — a monitor claim is a complete claim', () => {
  test('FAILS an undated monitor claim', () => {
    const r = run(makeRepo(withRegister((reg) => {
      delete reg.hosts.find((h) => h.hostname === 'api.example.test').monitor.verifiedOn;
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /api\.example\.test claims a monitor but the claim is incomplete: no verifiedOn/);
  });

  test('FAILS a monitor claim with no numeric id', () => {
    const r = run(makeRepo(withRegister((reg) => {
      reg.hosts.find((h) => h.hostname === 'demo.example.test').monitor.id = 'three';
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /demo\.example\.test claims a monitor but the claim is incomplete: no id \(a number\)/);
  });

  test('FAILS a hostname declared twice', () => {
    const r = run(makeRepo(withRegister((reg) => {
      reg.hosts.push({ hostname: 'demo.example.test', derivedFrom: 'appCatalogue', monitor: monitor(7, 'dup') });
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /declares demo\.example\.test twice/);
  });

  test('FAILS an unmonitored host with no stated reason', () => {
    const r = run(makeRepo(withRegister((reg) => {
      delete reg.hosts.find((h) => h.hostname === 'platform.example.test').gap;
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /platform\.example\.test declares no monitor and records no `gap\.why`/);
  });
});

describe('assert-monitor-coverage — the gap prints and does not fail', () => {
  test('the unmonitored host is PRINTED, and the guard still exits 0', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    // Both halves. Checking only the exit code would pass just as happily if the
    // gap stopped being mentioned, which is how a "printed, not hidden" limb
    // becomes hidden.
    assert.match(r.out, /1 deployed hostname\(s\) with NO monitor — OWNER-GATED, printed not hidden/);
    assert.match(r.out, /platform\.example\.test — nothing watches the shared ingest/);
    assert.match(r.out, /1 gap\(s\)/);
  });

  test('the undecided observability SPOF is PRINTED on every run', () => {
    const r = run(makeRepo());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the observability SPOF is UNDECIDED/);
  });

  test('a recorded SPOF decision stops the SPOF notice', () => {
    const r = run(makeRepo(withRegister((reg) => {
      reg.observability = { decidedOn: '2026-08-02', decidedBy: 'owner' };
    })));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /the observability SPOF is UNDECIDED/);
    // …and the host gap is untouched by that decision.
    assert.match(r.out, /printed not hidden/);
  });
});

describe('assert-monitor-coverage — coverage self-checks', () => {
  test('COVERAGE LOST when the site-canonical derivation yields nothing', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'sites/main/index.html': f['sites/main/index.html'].replace(/<link rel="canonical"[^>]*>/, ''),
      'sites/founder/index.html': f['sites/founder/index.html'].replace(/<link rel="canonical"[^>]*>/, ''),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — the "siteCanonicals" derivation yielded no hostname/);
  });

  test('COVERAGE LOST when no Worker declares a custom domain', () => {
    const r = run(makeRepo((f) => ({
      ...f,
      'services/platform/wrangler.jsonc': f['services/platform/wrangler.jsonc'].replaceAll('"custom_domain": true', '"custom_domain": false'),
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — the "workerCustomDomains" derivation yielded no hostname/);
  });

  test('COVERAGE LOST when the register is missing', () => {
    const r = run(makeRepo((f) => ({ ...f, 'tooling/monitor-register.json': null })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — .*monitor-register\.json does not exist/s);
  });

  test('COVERAGE LOST when the register declares no hosts', () => {
    const r = run(makeRepo(withRegister((reg) => { reg.hosts = []; })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — .*declares no hosts/s);
  });

  test('COVERAGE LOST when no row carries role: observability', () => {
    const r = run(makeRepo(withRegister((reg) => {
      delete reg.hosts.find((h) => h.role === 'observability').role;
    })));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — no row .* carries `"role": "observability"`/s);
  });
});
