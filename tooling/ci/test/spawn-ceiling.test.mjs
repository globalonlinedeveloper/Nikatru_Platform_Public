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
//   (c) every `node --test` line under .github/workflows/ carries `--import "$SPAWN_CEILING"`
//       (the preload as the absolute URL setup-node exports — a relative path resolves
//       against the step's cwd: spawn-ceiling-cwd.test.mjs) and `--test-timeout=`, with
//       fixture lines that lack it, or name the preload relatively, as the red control.
//
// ⏱ 2026-09-28 · PR #1025 (run 36376688038, guard-meta): no-hardcoded-strings.test.mjs
// :1033's guard child printed and never exited, and the ceiling killed it at 240 s
// (nodejs/node#54918). The preload now starts every node child --single-threaded, the
// flag FXH-2 (#1015) gave the extensions self-test's children. These cases hold it:
//   (d) each launch form — spawnSync (by path and by name), execFileSync, execSync,
//       spawn, execFile (callback and promisified), exec, fork — starts node with the
//       flag exactly once, including a launch that already carried it; the SAME
//       child without the preload sees no flag on any of them, the red control;
//   (e) `singleThreaded: false` keeps V8 background tasks on, and a program that is
//       not node keeps its arguments byte for byte;
//   (f) every `singleThreaded: false` under a test directory is declared in OPT_OUTS
//       with its count, so a new launch cannot quietly step out from under the flag;
//       a fixture with an undeclared opt-out is the red control.
//
// Mutations run against the real tree (2026-09-28, green control exit 0 first):
//   · `singleThreadedArgs` returns `args` unchanged                  → (d) + (e) RED
//   · the execSync/exec command rewrite dropped                       → (d) + (e) RED
//   · the opt-out ignored (`optedOut` returns false)                  → (e) RED
//   · `singleThreaded: false` added to no-hardcoded-strings' run()     → (f) RED
//   · the opt-out removed from listing-assets' pinning case            → (f) RED
//
// Run:  node --test tooling/ci/test/spawn-ceiling.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CEILING_ENV, DEFAULT_CEILING_MS, singleThreadedArgs, singleThreadedCommand } from '../../scripts/spawn-ceiling.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PRELOAD = join(ROOT, 'tooling', 'scripts', 'spawn-ceiling.mjs');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

/** Runs `source` as an ES module in a child node that loaded the preload (unless
 *  `preload` is false), with NIKATRU_SPAWN_CEILING_MS set, and returns the JSON the
 *  child printed. The outer spawn has its own explicit 60 s timeout, so this file
 *  cannot hang either. `viaFile` hands the source over as a temporary .mjs, not
 *  `-e`: endpoint protection on a Windows host refused (EPERM) to start a process
 *  whose COMMAND LINE held EVERY_FORM's launch calls, 2026-09-28. */
function inChild(ceilingMs, source, { preload = true, viaFile = false } = {}) {
  const dir = viaFile ? mkdtempSync(join(tmpdir(), 'spawn-ceiling-src-')) : null;
  if (dir) writeFileSync(join(dir, 'child.mjs'), source);
  const r = spawnSync(
    process.execPath,
    [...(preload ? ['--import', pathToFileURL(PRELOAD).href] : []), ...(dir ? [join(dir, 'child.mjs')] : ['--input-type=module', '-e', source])],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, [CEILING_ENV]: String(ceilingMs) } },
  );
  if (dir) rmSync(dir, { recursive: true, force: true });
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
    const imports = /--import\s+"\$SPAWN_CEILING"(\s|$)/.test(code);
    const timeout = /\s--test-timeout=\d+/.test(code);
    if (!imports || !timeout) bad.push(`:${i + 1} ${line.trim()}`);
  });
  return bad;
}

const testLines = (text) => text.split('\n').filter((l) => /\bnode\b.*\s--test(\s|$)/.test(l.replace(/^\s*#.*$/, '')));

describe('spawn-ceiling: every workflow node --test loads the preload', () => {
  test('(c) the red control: a line without the preload is caught, a wired one is not', () => {
    assert.deepEqual(unwired('        run: node --test "tooling/ci/test/*.test.mjs"'), [':1 run: node --test "tooling/ci/test/*.test.mjs"']);
    assert.equal(unwired('        run: node --import "$SPAWN_CEILING" --test "x.test.mjs"').length, 1, 'no --test-timeout');
    assert.deepEqual(unwired('        run: node --import "$SPAWN_CEILING" --test-timeout=600000 --test scripts/test/a.test.mjs'), []);
    // A relative preload resolves against the step's cwd, which left the checkout in #1160.
    assert.equal(unwired('        run: node --import ../tooling/scripts/spawn-ceiling.mjs --test-timeout=600000 --test a.test.mjs').length, 1, 'relative ../');
    assert.equal(unwired('        run: node --import ./tooling/scripts/spawn-ceiling.mjs --test-timeout=600000 --test a.test.mjs').length, 1, 'relative ./');
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

// The probe prints how many times --single-threaded is in its own execArgv. The flag
// is spelled in two halves so a command that carries the probe does not itself
// contain the flag, which would read as "already carried" and skip the rewrite.
const PROBE = "process.stdout.write(String(process.execArgv.join(' ').split('--single' + '-threaded').length - 1))";
const EVERY_FORM = `
  import { spawnSync, spawn, execFileSync, execFile, execSync, exec, fork } from 'node:child_process';
  import { promisify } from 'node:util';
  import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  const PROBE = ${JSON.stringify(PROBE)};
  const node = process.execPath;
  const cmd = '"' + node + '" -e "' + PROBE + '"';
  const out = (c) => new Promise((ok) => { let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => ok(o)); });
  const dir = mkdtempSync(join(tmpdir(), 'spawn-ceiling-'));
  const mod = join(dir, 'probe.cjs');
  writeFileSync(mod, PROBE);
  const got = {};
  got.spawnSync = spawnSync(node, ['-e', PROBE], { encoding: 'utf8' }).stdout;
  got.spawnSyncByName = spawnSync('node', ['-e', PROBE], { encoding: 'utf8' }).stdout;
  got.execFileSync = execFileSync(node, ['-e', PROBE], { encoding: 'utf8' });
  got.execSync = execSync(cmd, { encoding: 'utf8' });
  got.spawn = await out(spawn(node, ['-e', PROBE]));
  got.execFile = await new Promise((ok) => execFile(node, ['-e', PROBE], (e, o) => ok(o)));
  got.execFilePromisified = (await promisify(execFile)(node, ['-e', PROBE])).stdout;
  got.exec = await new Promise((ok) => exec(cmd, (e, o) => ok(o)));
  got.fork = await out(fork(mod, [], { silent: true, execArgv: [] }));
  got.alreadyFlagged = spawnSync(node, ['--single-threaded', '-e', PROBE], { encoding: 'utf8' }).stdout;
  got.optedOut = spawnSync(node, ['-e', PROBE], { encoding: 'utf8', singleThreaded: false }).stdout;
  rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify(got));
`;
const FORMS = ['spawnSync', 'spawnSyncByName', 'execFileSync', 'execSync', 'spawn', 'execFile', 'execFilePromisified', 'exec', 'fork'];

describe('spawn-ceiling: every node child a test starts runs --single-threaded', () => {
  test('(d) every launch form starts node with the flag exactly once; without the preload none does', () => {
    const on = inChild(60_000, EVERY_FORM, { viaFile: true });
    const off = inChild(60_000, EVERY_FORM, { preload: false, viaFile: true });
    // The red control first: the same probes, no preload, no flag. Were this '1', the
    // probe could not tell the preload's work from the child's own startup.
    for (const f of FORMS) assert.equal(off[f], '0', `without the preload, ${f} already saw the flag: the probe proves nothing`);
    for (const f of FORMS) assert.equal(on[f], '1', `${f} started node WITHOUT --single-threaded under the preload (nodejs/node#54918)`);
    assert.equal(on.alreadyFlagged, '1', 'a launch that already carried the flag got it twice');
    assert.equal(off.alreadyFlagged, '1');
  });

  test('(e) singleThreaded: false keeps background tasks on, and a program that is not node is untouched', () => {
    const on = inChild(60_000, EVERY_FORM, { viaFile: true });
    assert.equal(on.optedOut, '0', 'singleThreaded: false did not keep the child multi-threaded');
    const args = ['--seed', 'a b', '-e', 'x'];
    for (const file of ['git', '/usr/bin/nodejs-helper', 'C:\\tools\\nodemon.cmd', 'sh']) {
      assert.deepEqual(singleThreadedArgs(file, args, {}), args, `${file} is not node, and its arguments changed`);
    }
    for (const file of ['node', 'node.exe', '/usr/local/bin/node', 'C:\\Program Files\\nodejs\\node.exe', process.execPath]) {
      assert.deepEqual(singleThreadedArgs(file, args, {}), ['--single-threaded', ...args], `${file} is node and was not flagged`);
    }
    assert.equal(singleThreadedCommand('git status', {}), 'git status');
    assert.equal(singleThreadedCommand('nodemon x.js', {}), 'nodemon x.js');
    assert.equal(singleThreadedCommand('node x.mjs --y', {}), 'node --single-threaded x.mjs --y');
    assert.equal(singleThreadedCommand('"C:\\a b\\node.exe" -e 1', {}), '"C:\\a b\\node.exe" --single-threaded -e 1');
    assert.equal(singleThreadedCommand('node x.mjs', { singleThreaded: false }), 'node x.mjs');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) THE OPT-OUTS ARE DECLARED. `singleThreaded: false` is the one way a launch
// under the preload keeps V8 background tasks on. Each is a test that proves a guard
// relaunches ITSELF single-threaded, which it cannot prove if it starts with the flag.
// The count is exact both ways: an undeclared opt-out is red, and so is a declared
// one that is gone, so this list cannot outlive what it describes. This file is the
// one not scanned: it holds the list, and spells the key in its own cases and fixtures.
// ─────────────────────────────────────────────────────────────────────────────
const OPT_OUTS = {
  'tooling/ci/test/apps-gov-in-media.test.mjs': 1,
  'tooling/ci/test/assert-frames-carry-text.test.mjs': 1,
  'tooling/ci/test/elf-page-alignment.test.mjs': 1,
  'tooling/ci/test/launcher-icons.test.mjs': 1,
  'tooling/ci/test/listing-assets-ink.test.mjs': 1,
  'tooling/ci/test/listing-assets.test.mjs': 1,
  'tooling/ci/test/single-threaded-relaunch.test.mjs': 1,
  'tooling/ci/test/stamp-brand-assets.test.mjs': 1,
};
const OPT_OUT = /['"]?\bsingleThreaded['"]?\s*:\s*false\b/g;

/** Code occurrences of the opt-out in `text`; a `//` or `*` comment line is prose. */
const optOuts = (text) =>
  text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).reduce((n, l) => n + (l.match(OPT_OUT)?.length ?? 0), 0);

/** Every .mjs/.cjs/.js under a `test` directory below `dir`. */
function testFiles(dir, inTest = false, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) testFiles(p, inTest || e.name === 'test', acc);
    else if (inTest && /\.(mjs|cjs|js)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Every file whose opt-out count differs from what `declared` says, both ways. */
function undeclared(counts, declared) {
  const bad = [];
  for (const [f, n] of Object.entries(counts)) if (n !== (declared[f] ?? 0)) bad.push(`${f}: ${n} opt-out(s), OPT_OUTS declares ${declared[f] ?? 0}`);
  for (const [f, n] of Object.entries(declared)) if (!(f in counts)) bad.push(`${f}: OPT_OUTS declares ${n}, the file has none`);
  return bad;
}

describe('spawn-ceiling: every opt-out from --single-threaded is declared', () => {
  test('(f) the red control: an undeclared opt-out and a stale declaration are both caught', () => {
    assert.equal(optOuts('  spawnSync(process.execPath, [G], { singleThreaded: false });\n  // singleThreaded: false — prose'), 1);
    assert.equal(optOuts("spawnSync(node, a, { 'singleThreaded':false })"), 1);
    assert.deepEqual(undeclared({ 'tooling/ci/test/new.test.mjs': 1 }, {}), ['tooling/ci/test/new.test.mjs: 1 opt-out(s), OPT_OUTS declares 0']);
    assert.deepEqual(undeclared({}, { 'tooling/ci/test/gone.test.mjs': 1 }), ['tooling/ci/test/gone.test.mjs: OPT_OUTS declares 1, the file has none']);
    assert.deepEqual(undeclared({ a: 1 }, { a: 1 }), []);
  });

  test('(f) every test file under tooling/ and extensions/scripts/: each opt-out is declared', () => {
    const files = [...testFiles(join(ROOT, 'tooling')), ...testFiles(join(ROOT, 'extensions', 'scripts'))];
    // Anti-vacuity: 291 tooling test files started node on 2026-09-28.
    assert.ok(files.length >= 250, `only ${files.length} test files found: the walk stopped seeing them`);
    const counts = {};
    for (const f of files.filter((p) => resolve(p) !== fileURLToPath(import.meta.url))) {
      const n = optOuts(readFileSync(f, 'utf8'));
      if (n) counts[relative(ROOT, f).replaceAll('\\', '/')] = n;
    }
    assert.deepEqual(undeclared(counts, OPT_OUTS), [], 'a launch keeps V8 background tasks on without being declared');
  });
});
