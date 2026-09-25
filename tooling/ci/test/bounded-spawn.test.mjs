// ─────────────────────────────────────────────────────────────────────────────
// bounded-spawn.test.mjs — an external tool that never answers must become a
// fast, named COVERAGE LOST, and never a verdict.
//
// The class this pins: a guard that spawns an outside program with no timeout
// does not fail when that program hangs. The JOB is cancelled at its own
// timeout-minutes, the log stops mid-guard, and nothing names the command. That
// is how the launcher-icons hang read across five runs (#616, #617, #618, #619
// and one on main) before `flutter create` was bounded in
// flutter-stock-assets.mjs. The two `gh repo list` call sites had exactly the
// same shape, against a network the runner does not control.
//
//   B1 a process that never ends is killed at the bound, and says so
//   B2 the bound is a WALL CLOCK — it fires in about the time it was given
//   B3 a program that answers is not disturbed by the bound
//   B4 a non-zero exit is reported as an ANSWER, not as a time-out
//   B5 a program that cannot be started is startFailed, not timedOut
//   B6 the environment override raises the bound; it cannot remove it
//   B7 no `gh repo list` call site in tooling/ci spawns without a bound
//
// Mutations run against bounded-spawn.mjs (predictions written first):
//   · `timeout: timeoutMs` dropped from the spawn options        → B1, B2 RED
//   · the ETIMEDOUT branch removed                               → B1 RED
//   · timeoutFromEnv's `<= 0` guard made `< 0`                   → B6 RED
//   · assert-github-matrix's boundedSpawn reverted to execFileSync → B7 RED
//
// Run:  node --test tooling/ci/test/bounded-spawn.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boundedSpawn, timeoutFromEnv, DEFAULT_TIMEOUT_MS } from '../bounded-spawn.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A child that outlives any patience: it holds an open timer for a minute. */
const FOREVER = ['-e', 'setTimeout(() => {}, 60_000)'];

describe('bounded-spawn — a tool that never answers is COVERAGE LOST, fast', () => {
  test('B1 a process that never ends is killed at the bound and says so', () => {
    const r = boundedSpawn(process.execPath, FOREVER, { timeoutMs: 1_500, label: 'gh repo list' });
    assert.equal(r.timedOut, true);
    assert.equal(r.ok, false);
    assert.equal(r.startFailed, false);
    assert.match(r.detail, /`gh repo list` did not answer within 2 s and was killed/);
    assert.match(r.detail, /the question was never asked, not answered no/);
  });

  test('B2 the bound is a wall clock — it fires in about the time it was given', () => {
    const t0 = Date.now();
    const r = boundedSpawn(process.execPath, FOREVER, { timeoutMs: 1_500 });
    const spent = Date.now() - t0;
    assert.equal(r.timedOut, true);
    assert.ok(spent < 30_000, `a 1.5 s bound took ${spent} ms — that is not a bound`);
  });

  test('B3 a program that answers is not disturbed by the bound', () => {
    const r = boundedSpawn(process.execPath, ['-e', 'process.stdout.write("[]")'], { timeoutMs: 30_000 });
    assert.equal(r.ok, true);
    assert.equal(r.timedOut, false);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '[]');
  });

  test('B4 a non-zero exit is an ANSWER, not a time-out', () => {
    const r = boundedSpawn(process.execPath, ['-e', 'process.stderr.write("bad token"); process.exit(4)'], {
      timeoutMs: 30_000,
      label: 'gh repo list',
    });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, false, 'a tool that answered must never be reported as never having answered');
    assert.equal(r.status, 4);
    assert.match(r.detail, /`gh repo list` exit 4/);
    assert.match(r.stderr, /bad token/);
  });

  test('B5 a program that cannot be started is startFailed, not timedOut', () => {
    const r = boundedSpawn(join(CI_DIR, 'no-such-program-at-all'), [], { timeoutMs: 5_000 });
    assert.equal(r.startFailed, true);
    assert.equal(r.timedOut, false);
    assert.match(r.detail, /could not be started/);
  });

  test('B6 the environment override raises the bound; it cannot remove it', () => {
    assert.equal(timeoutFromEnv('X', 60_000, {}), 60_000, 'absent → the call site default');
    assert.equal(timeoutFromEnv('X', 60_000, { X: '5000' }), 5_000, 'set → honoured');
    assert.equal(timeoutFromEnv('X', 60_000, { X: '900' }), 1_000, 'below the floor → the floor');
    for (const bad of ['0', '-1', '', 'later', 'Infinity', 'NaN']) {
      assert.equal(timeoutFromEnv('X', 60_000, { X: bad }), 60_000, `${JSON.stringify(bad)} must not disable the bound`);
    }
    assert.equal(timeoutFromEnv('X', undefined, {}), DEFAULT_TIMEOUT_MS);
  });
});

describe('bounded-spawn — the call sites', () => {
  // 🔴 THE RATCHET, and it reads CODE rather than prose about code: this corpus
  // writes about `gh repo list` in comments, so a raw grep would be satisfied by
  // a paragraph. Same reduction assert-github-matrix.mjs's own org-literal limb
  // uses, for the same reason.
  const files = readdirSync(CI_DIR).filter((f) => f.endsWith('.mjs'));
  const GH_LIST_ARGV = /\[\s*'repo'\s*,\s*'list'/;

  test('B7 every `gh repo list` spawn in tooling/ci goes through boundedSpawn', () => {
    const queriers = [];
    const unbounded = [];
    for (const f of files) {
      if (f === 'bounded-spawn.mjs') continue;
      const src = stripSourceComments(readFileSync(join(CI_DIR, f), 'utf8'), '.mjs');
      if (!GH_LIST_ARGV.test(src)) continue;
      queriers.push(f);
      if (!/boundedSpawn\(/.test(src)) unbounded.push(f);
    }
    assert.ok(
      queriers.length >= 2,
      `expected the two \`gh repo list\` call sites, found ${queriers.length}: ${queriers.join(', ')} — ` +
        'if they are gone this check is vacuous and must be re-aimed, not deleted',
    );
    assert.deepEqual(
      unbounded,
      [],
      `these spawn \`gh repo list\` with no wall clock, so a hung call is a cancelled job with no name on it:\n${unbounded.join('\n')}`,
    );
  });

  // ⏱ 2026-09-12 — THE SIGNING SEAMS. Eight spawns across three files ran with
  // no wall clock: two probes (`signtool /?`, `openssl version`), the Windows
  // verify that reaches a timestamp authority and a revocation list, the two
  // openssl passes over a whole AppImage, and three `security` calls that can
  // block on a keychain prompt no runner will ever answer. Each one unbounded is
  // a cancelled job with the log stopping mid-guard and nothing naming the
  // command — the shape that read as five separate mysteries in #616, #617,
  // #618, #619 and on main before `flutter create` was bounded.
  // ⏱ 2026-09-25 — windows-signing.mjs retired with its only step, so two seams remain.
  test('B7c no signing seam spawns an external tool without a wall clock', () => {
    const SEAMS = ['apple-signing.mjs', 'appimage-signing.mjs'];
    const offenders = [];
    for (const f of SEAMS) {
      const src = stripSourceComments(readFileSync(join(CI_DIR, f), 'utf8'), '.mjs');
      src.split('\n').forEach((line, i) => {
        if (/\bspawnSync\s*\(/.test(line)) offenders.push(`${f}:${i + 1} ${line.trim()}`);
      });
      assert.ok(
        /boundedSpawn\(/.test(src),
        `${f} no longer calls boundedSpawn — either it stopped spawning anything (re-aim this check) or the bound was removed`,
      );
    }
    assert.deepEqual(
      offenders,
      [],
      `these signing spawns have no bound, so a hung tool is a cancelled job with no name on it:\n${offenders.join('\n')}`,
    );
  });

  test('B7b both call sites name GH_LIST_TIMEOUT_MS, so the bound is tunable without being removable', () => {
    const named = files.filter((f) => f !== 'bounded-spawn.mjs' && readFileSync(join(CI_DIR, f), 'utf8').includes('GH_LIST_TIMEOUT_MS'));
    assert.deepEqual(named.sort(), ['assert-github-matrix.mjs', 'assert-store-matrix.mjs']);
  });
});
