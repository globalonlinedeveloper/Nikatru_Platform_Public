// ─────────────────────────────────────────────────────────────────────────────
// spawn-ceiling.test.mjs — tooling/scripts/spawn-ceiling.mjs must stop a hung
// synchronous spawn, must keep a timeout the caller chose, and must be loaded by
// every `node --test` a workflow runs.
//
// ⏱ 2026-09-25 · #934's main CI run (36106900356) hung in one `spawnSync` with no
// timeout until job 107981386553's 25-minute kill. `--test-timeout` cannot stop
// that: the blocked event loop never runs the runner's timer. The preload can,
// and these cases hold it to that:
//   (a) with a 2000 ms ceiling, a spawn of a process that never exits returns
//       ETIMEDOUT at the ceiling — through the ESM named import a test file uses;
//   (b) a timeout the caller passed is kept, including one LONGER than the ceiling;
//   (c) every `node --test` line under .github/workflows/ carries `--import` of the
//       preload and `--test-timeout=`, with a fixture line that lacks it as the red
//       control, so the check is not vacuous.
//
// Run:  node --test tooling/ci/test/spawn-ceiling.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CEILING_ENV, DEFAULT_CEILING_MS } from '../../scripts/spawn-ceiling.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PRELOAD = join(ROOT, 'tooling', 'scripts', 'spawn-ceiling.mjs');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/** Runs `source` as an ES module in a child node that loaded the preload, with
 *  NIKATRU_SPAWN_CEILING_MS set, and returns the JSON the child printed. The
 *  outer spawn has its own explicit 60 s timeout, so this file cannot hang either. */
function inChild(ceilingMs, source) {
  const r = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(PRELOAD).href, '--input-type=module', '-e', source],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, [CEILING_ENV]: String(ceilingMs) } },
  );
  assert.equal(r.error, undefined, `the child did not finish (${r.error?.code ?? r.error})`);
  assert.equal(r.status, 0, `the child failed:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// A process that outlives every ceiling below, then exits on its own after 15 s, so a
// failed case cannot leak a process that runs forever.
const HANG = `[process.execPath, ['-e', 'setTimeout(() => {}, 15000)']]`;

describe('spawn-ceiling: a hung synchronous spawn stops at the ceiling', () => {
  test('(a) spawnSync, through the ESM named import, returns ETIMEDOUT at a 2000 ms ceiling', () => {
    const got = inChild(2000, `
      import { spawnSync } from 'node:child_process';
      const t = Date.now();
      const r = spawnSync(...${HANG});
      console.log(JSON.stringify({ code: r.error?.code ?? null, status: r.status, ms: Date.now() - t }));
    `);
    assert.equal(got.code, 'ETIMEDOUT');
    assert.equal(got.status, null);
    assert.ok(got.ms >= 1900, `it returned after ${got.ms} ms, before the 2000 ms ceiling: something else stopped it`);
    assert.ok(got.ms < 12_000, `it returned after ${got.ms} ms: the ceiling did not stop it`);
  });

  test('(a) execFileSync and execSync throw ETIMEDOUT at the same ceiling', () => {
    const got = inChild(2000, `
      import { execFileSync, execSync } from 'node:child_process';
      const codes = [];
      try { execFileSync(...${HANG}); codes.push('returned'); } catch (e) { codes.push(e.code ?? String(e)); }
      const cmd = '"' + process.execPath + '" -e "setTimeout(() => {}, 15000)"';
      // stdio ignored: a shell that does not exec its command leaves node as a
      // grandchild, and a grandchild holding the pipes would outlast the kill.
      try { execSync(cmd, { stdio: 'ignore' }); codes.push('returned'); } catch (e) { codes.push(e.code ?? String(e)); }
      console.log(JSON.stringify({ codes }));
    `);
    assert.deepEqual(got.codes, ['ETIMEDOUT', 'ETIMEDOUT']);
  });

  test('(b) an explicit timeout is kept, even one longer than the ceiling', () => {
    const got = inChild(1000, `
      import { spawnSync } from 'node:child_process';
      const t = Date.now();
      const r = spawnSync(...${HANG}, { timeout: 4000 });
      console.log(JSON.stringify({ code: r.error?.code ?? null, ms: Date.now() - t }));
    `);
    assert.equal(got.code, 'ETIMEDOUT');
    assert.ok(got.ms >= 3800, `it returned after ${got.ms} ms: the 1000 ms ceiling overrode the caller's 4000 ms`);
  });

  test('(b) a call that sets no timeout still keeps its other options', () => {
    const got = inChild(5000, `
      import { spawnSync } from 'node:child_process';
      const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.PROBE)'], { encoding: 'utf8', env: { ...process.env, PROBE: 'kept' } });
      console.log(JSON.stringify({ out: r.stdout, status: r.status }));
    `);
    assert.deepEqual(got, { out: 'kept', status: 0 });
  });

  test('the default is 240 s, and a ceiling that is not a positive integer refuses to load', () => {
    assert.equal(DEFAULT_CEILING_MS, 240_000);
    for (const bad of ['abc', '0', '-5', '1.5']) {
      const r = spawnSync(
        process.execPath,
        ['--import', pathToFileURL(PRELOAD).href, '-e', 'process.exit(0)'],
        { encoding: 'utf8', timeout: 60_000, env: { ...process.env, [CEILING_ENV]: bad } },
      );
      assert.notEqual(r.status, 0, `${CEILING_ENV}=${bad} loaded: a typo would silently set the ceiling`);
      assert.match(r.stderr, /is not a positive integer of milliseconds/);
    }
  });
});

/** Every non-comment line that runs `node … --test` without the preload and a
 *  test timeout. `--test` is matched as a whole flag, so `--test-timeout` or
 *  `--test-reporter` alone is not a test run. */
function unwired(text) {
  const bad = [];
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/^\s*#.*$/, '');
    if (!/\bnode\b.*\s--test(\s|$)/.test(code)) return;
    const imports = /--import\s+(\.\.?\/)+tooling\/scripts\/spawn-ceiling\.mjs(\s|$)/.test(code);
    const timeout = /\s--test-timeout=\d+/.test(code);
    if (!imports || !timeout) bad.push(`:${i + 1} ${line.trim()}`);
  });
  return bad;
}

const testLines = (text) => text.split('\n').filter((l) => /\bnode\b.*\s--test(\s|$)/.test(l.replace(/^\s*#.*$/, '')));

describe('spawn-ceiling: every workflow node --test loads the preload', () => {
  test('(c) the red control: a line without the preload is caught, a wired one is not', () => {
    assert.deepEqual(unwired('        run: node --test "tooling/ci/test/*.test.mjs"'), [':1 run: node --test "tooling/ci/test/*.test.mjs"']);
    assert.equal(unwired('        run: node --import ./tooling/scripts/spawn-ceiling.mjs --test "x.test.mjs"').length, 1, 'no --test-timeout');
    assert.deepEqual(unwired('        run: node --import ../tooling/scripts/spawn-ceiling.mjs --test-timeout=600000 --test scripts/test/a.test.mjs'), []);
    assert.deepEqual(unwired('      # run: node --test "x.test.mjs"'), [], 'a comment is not a run');
  });

  test('(c) every workflow file: each node --test line is wired', () => {
    const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    assert.ok(files.length >= 10, `only ${files.length} workflow files found under ${WORKFLOWS}`);
    let seen = 0;
    const bad = [];
    for (const f of files) {
      const text = readFileSync(join(WORKFLOWS, f), 'utf8');
      seen += testLines(text).length;
      for (const b of unwired(text)) bad.push(`${f}${b}`);
    }
    // Anti-vacuity: five known lines on 2026-09-25 (ci.yml ×2, extensions-ci.yml ×3).
    assert.ok(seen >= 5, `only ${seen} node --test line(s) found: the scan stopped seeing them`);
    assert.deepEqual(bad, [], `node --test without the spawn-ceiling preload:\n${bad.join('\n')}`);
  });
});
