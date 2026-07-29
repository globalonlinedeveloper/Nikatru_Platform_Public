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
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

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
  const dir = join(root, 'sites', '_shared', '_data');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'apps.json'), JSON.stringify(entries, null, 2));
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const entry = (slug, path, status = 'live') => ({ slug, name: slug, url: url(path), status });

describe('assert-catalog-reachable', () => {
  test('passes when every live entry answers', NET, () => {
    const { code, out } = run(tree([entry('alpha', '/ok'), entry('beta', '/ok')]));
    assert.equal(code, 0, out);
    assert.match(out, /2 of 2 live entry\(ies\) answered/);
  });

  // 🔴 N1 — the defect S-7a exists for, in the exact shape production produces.
  test('FAILS on a live entry answering 522 (a subdomain with no origin)', NET, () => {
    const { code, out } = run(tree([entry('alpha', '/ok'), entry('dead', '/gone')]));
    assert.equal(code, 1);
    assert.match(out, /dead — marked `live` but .* answered HTTP 522/);
    assert.match(out, /NOTHING BEHIND IT/);
  });

  test('FAILS on a live entry answering 404', NET, () => {
    const { code, out } = run(tree([entry('alpha', '/ok'), entry('missing', '/missing')]));
    assert.equal(code, 1);
    assert.match(out, /missing — marked `live` but .* answered HTTP 404/);
  });

  test('FAILS on a live entry with no url at all', () => {
    const { code, out } = run(tree([{ slug: 'urlless', status: 'live' }]));
    assert.equal(code, 1);
    assert.match(out, /urlless — marked `live` with no `url`/);
  });

  // N2 — `preview` is legitimately skipped, but the shrink must be VISIBLE,
  // because marking everything preview is the one way to empty the domain.
  test('skips preview entries and PRINTS that it did', NET, () => {
    const { code, out } = run(tree([entry('alpha', '/ok'), entry('soon', '/gone', 'preview')]));
    assert.equal(code, 0, out);
    assert.match(out, /1 entry\(ies\) not marked `live` and therefore NOT probed/);
  });

  // ── anti-vacuity ──────────────────────────────────────────────────────────
  test('COVERAGE LOST on an empty catalogue', () => {
    const { code, out } = run(tree([]));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — the catalogue is empty/);
  });

  test('COVERAGE LOST when the catalogue file is absent', () => {
    const root = join(TMP, `r${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST — no catalogue/);
  });

  // 🔴 N4 — the honesty case. Every live entry fails at the transport layer, so
  // the guard cannot know whether the network died or every host is bogus. It
  // must exit 1 and must NOT claim a cause it cannot observe.
  test('COVERAGE LOST — and no invented cause — when every entry fails transport', NET, () => {
    const { code, out } = run(tree([
      { slug: 'a', url: dead('/x'), status: 'live' },
      { slug: 'b', url: dead('/y'), status: 'live' },
    ]));
    assert.equal(code, 1);
    assert.match(out, /CANNOT TELL YOU WHICH OF TWO THINGS HAPPENED/);
  });

  // The other side of that judgement: one unreachable host among answering ones
  // is that host's problem, and must NOT be excused as a network outage.
  test('FAILS a single unreachable host when others answered', NET, () => {
    const { code, out } = run(tree([
      entry('alpha', '/ok'),
      { slug: 'offline', url: dead('/z'), status: 'live' },
    ]));
    assert.equal(code, 1);
    assert.match(out, /offline — marked `live` but .* could not be reached at all/);
    assert.match(out, /So this is the app, not the network/);
  });
});
