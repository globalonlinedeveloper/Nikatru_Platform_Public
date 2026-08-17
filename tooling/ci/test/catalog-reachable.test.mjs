// ─────────────────────────────────────────────────────────────────────────────
// catalog-reachable.test.mjs — assert-catalog-reachable.mjs must be able to FAIL.
//
// [pipeline S-7a] The public catalogue may not advertise an app that does not
// answer.
//
// ⚠️ REAL-TREE NEGATIVE TESTS FIRST (2026-07-29, four, against the live wildcard):
//   N1 subly's url repointed at zzz-nonexistent-app.nikatru.com -> FAILED, 522
//   N2 the only entry marked `preview`                          -> passed, and
//      PRINTED "1 entry(ies) not probed" (the shrink must be visible)
//   N3 the catalogue emptied                                    -> COVERAGE LOST
//   N4 the only entry given an off-wildcard bogus host          -> COVERAGE LOST
//      Exits 1, which is right, but with N=1 the guard genuinely cannot tell
//      "no network" from "the one host is bogus" — so it now says exactly that
//      instead of asserting a cause it cannot observe.
//
// 🔴 NO TEST-ONLY BACKDOOR. These fixtures stand up a REAL http server on
// 127.0.0.1 and point a real catalogue at it, so the actual fetch/retry path
// runs. An env var that swapped in a fake would be a switch capable of silencing
// the guard in production, which is a worse defect than the one it tests.
//
// ═════════════════════════════════════════════════════════════════════════════
// [pipeline 10]D-11 LIMBS 2 AND 3 — AND WHY THEIR CASES ARE UNIT TESTS.
//
// The two new limbs probe FIXED hosts: a random `wc-<hex>` name under the
// wildcard apex, and the canonical hub URL. Neither can be made to fail from a
// fixture — nothing here can delete a DNS record or make nikatru.com/apps/
// return 404 — so a spawn test could only ever exercise their PASSING path,
// which is the "it has only ever run against valid input" defect F-10 exists to
// stop. So the DECISION is a pure function (`wildcardVerdict`, `hubVerdict`),
// exported and fed every branch below, while the spawn tests keep proving the
// wiring end to end.
//
// ⚠️ THE LIMBS ARE DELIBERATELY NOT ACTIVE IN THE FIXTURE RUNS ABOVE, and that
// is asserted rather than assumed: `surfaceIsOurs` gates them, and a fixture
// root in a temp directory is not the tree those two constants describe. Two
// cases pin it in BOTH directions — true for the repository root CI actually
// scans, false for a fixture — because a gate that silently reads false
// everywhere would turn both limbs off in CI and print nothing at all. The
// fixture run also asserts the skip is PRINTED.
//
// REAL-TREE RUN (2026-08-08, this worktree, `node tooling/ci/assert-catalog-reachable.mjs`):
//   ok  wildcard DNS answers — https://wc-3cc38997.nikatru.com/ returned HTTP 522
//   ok  canonical hub answers — https://nikatru.com/apps/ returned 200
// Both limb lines present, exit 0.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import {
  HUB_URL,
  WILDCARD_APEX,
  hubVerdict,
  nonceUrl,
  surfaceIsOurs,
  wildcardVerdict,
} from '../assert-catalog-reachable.mjs';
import { CANONICAL_HUB_URL, ORIGIN } from '../../sites/generate-discovery.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-catalog-reachable.mjs');

// 🔴 EVERY NETWORK CASE CARRIES AN EXPLICIT TIMEOUT, and it is load-bearing.
// `node --test` imposes none by default, so a case that cannot reach the local
// server does not fail — it HANGS, and a hung CI step is indistinguishable from
// a slow one. Measured on the authoring machine: nested spawns could not reach
// 127.0.0.1 at all (a direct fetch took 34 ms; the same URL from the spawned
// guard took 46 s and reported a transport error), so these cases could not be
// verified locally and CI is their first real run. A bound is what makes that
// safe to attempt rather than reckless.
const NET = { timeout: 40000 };

let TMP;
let server;
let PORT;
/** A port that is guaranteed CLOSED — bound, then released, so the OS answers
 *  with an immediate refusal. Port 1 was the obvious choice and was wrong: on
 *  Windows it blackholes rather than refusing, so each probe burned the full
 *  timeout × 3 attempts and the suite ran past two minutes. A refused connection
 *  is the transport failure this exercises; a swallowed one is a different test. */
let CLOSED_PORT;

before(async () => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-catalog-'));
  const throwaway = createServer(() => {});
  await new Promise((r) => throwaway.listen(0, '127.0.0.1', r));
  CLOSED_PORT = throwaway.address().port;
  await new Promise((r) => throwaway.close(r));
  // /ok -> 200 · /gone -> 522, the shape a dead subdomain takes under the
  // wildcard · /missing -> 404, a settled answer that must NOT be retried into
  // a pass.
  server = createServer((req, res) => {
    if (req.url.startsWith('/ok')) { res.writeHead(200); res.end('up'); return; }
    if (req.url.startsWith('/gone')) { res.writeHead(522); res.end('no origin'); return; }
    res.writeHead(404); res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  PORT = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
const url = (p) => `http://127.0.0.1:${PORT}${p}`;
const dead = (p) => `http://127.0.0.1:${CLOSED_PORT}${p}`;

function tree(entries) {
  const root = join(TMP, `r${seq++}`);
  const dir = join(root, 'catalog');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'apps.json'), JSON.stringify(entries, null, 2));
  return root;
}

// 🔴 ASYNC, AND THAT IS THE WHOLE POINT. This was `spawnSync`, which BLOCKS the
// event loop of the very process hosting the fixture server — so the guard's
// request could never be answered and every network case reported a transport
// error. It reproduced identically on the authoring machine and on the CI
// runner, which is what finally ruled out "sandboxed localhost" and pointed at
// the harness deadlocking itself. The guard was correct on every one of those
// runs; the test could not let it succeed.
const execFileAsync = promisify(execFile);
const run = async (cwd) => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (err) {
    return { code: err.code ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const entry = (slug, path, status = 'live') => ({ slug, name: slug, url: url(path), status });

describe('assert-catalog-reachable', () => {
  test('passes when every live entry answers', NET, async () => {
    const { code, out } = await run(tree([entry('alpha', '/ok'), entry('beta', '/ok')]));
    assert.equal(code, 0, out);
    assert.match(out, /2 of 2 live entry\(ies\) answered/);
  });

  // 🔴 N1 — the defect S-7a exists for, in the exact shape production produces.
  test('FAILS on a live entry answering 522 (a subdomain with no origin)', NET, async () => {
    const { code, out } = await run(tree([entry('alpha', '/ok'), entry('dead', '/gone')]));
    assert.equal(code, 1);
    assert.match(out, /dead — marked `live` but .* answered HTTP 522/);
    assert.match(out, /NOTHING BEHIND IT/);
  });

  test('FAILS on a live entry answering 404', NET, async () => {
    const { code, out } = await run(tree([entry('alpha', '/ok'), entry('missing', '/missing')]));
    assert.equal(code, 1);
    assert.match(out, /missing — marked `live` but .* answered HTTP 404/);
  });

  test('FAILS on a live entry with no url at all', async () => {
    const { code, out } = await run(tree([{ slug: 'urlless', status: 'live' }]));
    assert.equal(code, 1);
    assert.match(out, /urlless — marked `live` with no `url`/);
  });

  // N2 — `preview` is legitimately skipped, but the shrink must be VISIBLE,
  // because marking everything preview is the one way to empty the domain.
  test('skips preview entries and PRINTS that it did', NET, async () => {
    const { code, out } = await run(tree([entry('alpha', '/ok'), entry('soon', '/gone', 'preview')]));
    assert.equal(code, 0, out);
    assert.match(out, /1 entry\(ies\) not marked `live` and therefore NOT probed/);
  });

  // ── anti-vacuity ──────────────────────────────────────────────────────────
  test('COVERAGE LOST on an empty catalogue', async () => {
    const { code, out } = await run(tree([]));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — the catalogue is empty/);
  });

  test('COVERAGE LOST when the catalogue file is absent', async () => {
    const root = join(TMP, `r${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = await run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no catalogue/);
  });

  // 🔴 N4 — the honesty case. Every live entry fails at the transport layer, so
  // the guard cannot know whether the network died or every host is bogus. It
  // must exit 1 and must NOT claim a cause it cannot observe.
  test('COVERAGE LOST — and no invented cause — when every entry fails transport', NET, async () => {
    const { code, out } = await run(tree([
      { slug: 'a', url: dead('/x'), status: 'live' },
      { slug: 'b', url: dead('/y'), status: 'live' },
    ]));
    assert.equal(code, 1);
    assert.match(out, /CANNOT TELL YOU WHICH OF TWO THINGS HAPPENED/);
  });

  // The other side of that judgement: one unreachable host among answering ones
  // is that host's problem, and must NOT be excused as a network outage.
  test('FAILS a single unreachable host when others answered', NET, async () => {
    const { code, out } = await run(tree([
      entry('alpha', '/ok'),
      { slug: 'offline', url: dead('/z'), status: 'live' },
    ]));
    assert.equal(code, 1);
    assert.match(out, /offline — marked `live` but .* could not be reached at all/);
    assert.match(out, /So this is the app, not the network/);
  });

  // ── [10]D-11 · the limbs are OFF for a fixture root, and SAY SO ────────────
  // The one end-to-end fact a fixture can establish about limbs 2 and 3: that
  // pointing this guard at somebody else's tree does not silently assert this
  // repository's DNS against it — and that the skip appears in the log of the
  // run that took it, because a limb that stops running while CI stays green is
  // the defect this whole directory exists to prevent.
  test('a fixture root does NOT probe the D-11 limbs, and PRINTS that it did not', NET, async () => {
    const { code, out } = await run(tree([entry('alpha', '/ok')]));
    assert.equal(code, 0, out);
    assert.match(out, /limbs 2 \(wildcard\) and 3 \(canonical hub\) NOT probed/);
    assert.match(out, /CI passes no root, so CI always probes them/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 10]D-11 LIMB 2 — the wildcard is asserted, not assumed.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-catalog-reachable — [10]D-11 limb 2 (wildcard)', () => {
  // The production case, and the one that reads backwards until you hold it
  // next to limb 1: a 522 is a FAILURE for a named app and a PASS here. The name
  // is random, so answering AT ALL is the proof.
  test('ANY HTTP status from a name nobody registered proves the wildcard answers', () => {
    for (const status of [522, 404, 200]) {
      const v = wildcardVerdict({
        url: `https://wc-deadbeef.${WILDCARD_APEX}/`,
        verdict: { status },
        othersAnswered: true,
      });
      assert.equal(v.ok, true, `HTTP ${status} should settle limb 2`);
      assert.match(v.line, new RegExp(`^ok {2}wildcard DNS answers`));
      assert.match(v.line, new RegExp(`returned HTTP ${status}`));
    }
  });

  // 🔴 THE DEFECT D-11 EXISTS FOR. Deleting the wildcard record leaves every
  // catalogue hostname NXDOMAIN, and limb 1 alone reads that as "the runner is
  // offline". This limb must name the RECORD, not the network.
  test('FAILS — naming the DNS record class — when the nonce is unreachable while others answered', () => {
    const v = wildcardVerdict({
      url: `https://wc-deadbeef.${WILDCARD_APEX}/`,
      verdict: { transport: 'ENOTFOUND' },
      othersAnswered: true,
    });
    assert.equal(v.ok, false);
    assert.equal(v.coverageLost, false);
    const text = v.lines.join('\n');
    assert.match(text, /THE WILDCARD DNS RECORD IS GONE/);
    assert.match(text, /ENOTFOUND/);
    assert.match(text, /PROXIED WILDCARD CNAME/);
    assert.match(text, new RegExp(`\\*\\.${WILDCARD_APEX.replace(/\./g, '\\.')}`));
  });

  // The honesty case, matching limb 1's existing convention exactly: with
  // nothing answering anywhere, "the record is gone" and "this runner has no
  // network" are the same observation, so neither is claimed.
  test('COVERAGE LOST — and no DNS claim — when nothing in the run answered', () => {
    const v = wildcardVerdict({
      url: `https://wc-deadbeef.${WILDCARD_APEX}/`,
      verdict: { transport: 'EAI_AGAIN' },
      othersAnswered: false,
    });
    assert.equal(v.ok, false);
    assert.equal(v.coverageLost, true);
    const text = v.lines.join('\n');
    assert.match(text, /COVERAGE LOST/);
    assert.ok(!/RECORD IS GONE/.test(text), 'must not name a cause it cannot observe');
  });

  // FRESH is load-bearing: a fixed nonce could be created as a real record (or
  // cached) and would then answer for a reason unrelated to the wildcard — a
  // probe that has quietly stopped testing its subject.
  test('the nonce is fresh every call and sits under the apex derived from the hub URL', () => {
    const a = nonceUrl();
    const b = nonceUrl();
    assert.notEqual(a, b);
    for (const u of [a, b]) {
      const parsed = new URL(u);
      assert.match(parsed.hostname, /^wc-[0-9a-f]{8}\./);
      assert.equal(parsed.hostname.endsWith(`.${WILDCARD_APEX}`), true, u);
      assert.equal(parsed.protocol, new URL(HUB_URL).protocol);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 10]D-11 LIMB 3 — the canonical hub answers.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-catalog-reachable — [10]D-11 limb 3 (canonical hub)', () => {
  test('PASSES on 200 and names the hub URL', () => {
    const v = hubVerdict({ url: HUB_URL, verdict: { ok: true, status: 200 }, othersAnswered: true });
    assert.equal(v.ok, true);
    assert.match(v.line, /^ok {2}canonical hub answers/);
    assert.ok(v.line.includes(HUB_URL), v.line);
  });

  // [12]W-9 diffs the committed BYTES of that page and would still be green:
  // a file being right says nothing about the host serving it.
  test('FAILS on any non-200 answer, naming the status', () => {
    for (const status of [404, 522, 500, 301]) {
      const v = hubVerdict({ url: HUB_URL, verdict: { status }, othersAnswered: true });
      assert.equal(v.ok, false, `HTTP ${status} must not pass limb 3`);
      assert.equal(v.coverageLost, false);
      assert.match(v.lines.join('\n'), new RegExp(`returned HTTP ${status}`));
    }
  });

  // `redirect: 'follow'` means /apps (no slash) → 308 → 200 arrives here as a
  // plain 200. It still answers, so it passes — but WHERE it landed must be in
  // the line rather than swallowed, or a hub quietly moved elsewhere reads
  // identically to one serving from its canonical address.
  test('a 200 reached through a redirect passes AND names the final URL', () => {
    const finalUrl = `${HUB_URL}index.html`;
    const v = hubVerdict({
      url: HUB_URL,
      verdict: { ok: true, status: 200, redirected: true, finalUrl },
      othersAnswered: true,
    });
    assert.equal(v.ok, true);
    assert.match(v.line, /after a redirect to/);
    assert.ok(v.line.includes(finalUrl), v.line);
  });

  test('a transport error FAILS when others answered and is COVERAGE LOST when nothing did', () => {
    const down = hubVerdict({ url: HUB_URL, verdict: { transport: 'ECONNREFUSED' }, othersAnswered: true });
    assert.equal(down.ok, false);
    assert.equal(down.coverageLost, false);
    assert.match(down.lines.join('\n'), /So this is the hub, not the network/);

    const dark = hubVerdict({ url: HUB_URL, verdict: { transport: 'ECONNREFUSED' }, othersAnswered: false });
    assert.equal(dark.ok, false);
    assert.equal(dark.coverageLost, true);
    assert.match(dark.lines.join('\n'), /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DERIVATION ITSELF. Two guards and one generator now talk about the same
// URL, and the only thing keeping them talking about the SAME url is an import.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-catalog-reachable — the hub URL is derived, never retyped', () => {
  test('HUB_URL is the generator\'s own CANONICAL_HUB_URL', () => {
    assert.equal(HUB_URL, CANONICAL_HUB_URL);
    assert.equal(CANONICAL_HUB_URL, `${ORIGIN}apps/`);
    assert.equal(WILDCARD_APEX, new URL(CANONICAL_HUB_URL).hostname);
  });

  // 🔴 THE COUPLING TEST, and it has a real failing input: paste the hostname
  // back into the guard as a literal and this goes red. Equality alone could
  // not catch that — a hardcoded copy of today's value is equal to today's
  // value, and only diverges on the day somebody moves the hub, which is
  // precisely the day nobody is watching. Comments are stripped (the file's
  // header discusses the apex at length) with the same reduction nine other
  // guards use, so PROSE CANNOT SATISFY OR BREAK THIS CHECK.
  test('the guard\'s CODE carries no hostname literal — only the import', () => {
    const src = readFileSync(join(CI_DIR, 'assert-catalog-reachable.mjs'), 'utf8');
    const code = stripSourceComments(src, '.mjs');
    assert.ok(
      src.includes(WILDCARD_APEX),
      'sanity: the file must mention the apex SOMEWHERE (its header does), or this test proves nothing',
    );
    assert.equal(
      code.includes(WILDCARD_APEX),
      false,
      `the apex appears as a literal in executable code; it must come from CANONICAL_HUB_URL. ` +
        `Offending line(s): ${code
          .split('\n')
          .map((l, i) => [l, i + 1])
          .filter(([l]) => l.includes(WILDCARD_APEX))
          .map(([, n]) => n)
          .join(', ')}`,
    );
    assert.match(code, /import \{ CANONICAL_HUB_URL \} from '\.\.\/sites\/generate-discovery\.mjs'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE GATE. Both limbs run only against this repository's own tree, so the gate
// is pinned in BOTH directions — a gate stuck on `false` turns them off in CI
// and prints nothing, which is exactly the silence this repo keeps paying for.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-catalog-reachable — the D-11 limbs are gated on our own tree', () => {
  test('TRUE for the repository root CI scans, FALSE for a fixture root', () => {
    assert.equal(surfaceIsOurs(resolve(CI_DIR, '..', '..')), true, 'CI passes no root, so this is the CI case');
    assert.equal(surfaceIsOurs(TMP), false, 'a temp fixture tree is not the tree the hub URL describes');
  });
});
