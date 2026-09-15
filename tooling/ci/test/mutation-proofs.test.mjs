// ─────────────────────────────────────────────────────────────────────────────
// mutation-proofs.test.mjs — the failing cases of assert-mutation-proofs.mjs.
//
// 🔴 EVERY RED BELOW IS PRECEDED BY A GREEN CONTROL, and the first test in the
// file IS that control. Without it every red here would be equally consistent
// with a guard that refuses everything it is handed — which is the shape rule 6
// of docs/verification-discipline.md exists for, and which this repository has
// shipped before.
//
// ⚠️ THE STATIC LIMBS ARE TESTED HERE; THE `--execute` LIMB IS NOT RUN AGAINST
// FLUTTER, and that is deliberate rather than an omission. Executing a real
// mutation costs a `flutter test` invocation — measured on 2026-09-09 at 3m21s
// warm, 5m45s cold, on the file six of the fourteen real rows name — so a suite
// that ran one would put minutes into `guard-meta`, which is capped at 25 and
// whose whole 199s budget is this file's neighbours. What IS tested here is
// every decision `--execute` makes BEFORE and AFTER the subprocess: that it
// refuses a row it cannot resolve to exactly one test file, that it refuses when
// nothing is runnable rather than sweeping an empty set, and that `--only`
// without `--execute` is an error rather than a silently ignored word. The
// subprocess itself is exercised for real by the nightly lane and by the
// transcript pasted into any commit that lowers the ratchet.
//
// The fixture is a REAL git repository because the guard cross-checks its own
// directory walk against `git ls-files` — a walk that silently stops reaching a
// tracked record is exactly the defect this whole family of guards exists for,
// and a fixture with no index would make that limb answer "could not establish"
// and quietly stop checking.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripDartComments } from '../dart-source.mjs';
import { POSIX, goneWithin } from './fixtures/process-group.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-mutation-proofs.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-mutproof-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

function fixture(files) {
  const dir = join(TMP, `f${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    if (body === null) continue;
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture', '--no-gpg-sign');
  return dir;
}

function run(cwd, args = []) {
  const r = spawnSync(process.execPath, [GUARD, cwd, ...args], { encoding: 'utf8', cwd });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// The effect file the fixture rows point at. The comment line is load-bearing:
// the hash is taken over the file with comment prose stripped, so a test below
// edits ONLY that line and requires the guard to stay green — the same property
// `lastCodeChangeDay` was rewritten for.
const EFFECT = [
  'class AddSheet {',
  '  // A comment. Changing this must NOT expire a proof.',
  '  void save() {',
  '    setState(() => _saving = false);',
  '  }',
  '}',
  '',
].join('\n');

const TEST_FILE = [
  "import 'package:flutter_test/flutter_test.dart';",
  'void main() {',
  "  testWidgets('a failed save re-arms the button', (tester) async {",
  '    expect(1, 1);',
  '  });',
  '}',
  '',
].join('\n');

/** The hash the guard computes: comment-stripped, right-trimmed, blank lines gone. */
function hashOf(text) {
  return createHash('sha256')
    .update(
      stripDartComments(text)
        .split('\n')
        .map((l) => l.replace(/\s+$/, ''))
        .filter((l) => l !== '')
        .join('\n'),
      'utf8',
    )
    .digest('hex');
}

const EDIT = { find: 'setState(() => _saving = false);', replace: 'setState(() => _saving = true);' };

function row(over = {}) {
  return {
    name: 'add subscription',
    primaryAction: 'saving a subscription',
    test: 'a failed save re-arms the button',
    effect: 'lib/add.dart:save',
    mutation: {
      symbol: 'lib/add.dart:save',
      observedRed: 'a failed save re-arms the button',
      date: '2026-09-09',
      edit: EDIT,
      codeHash: hashOf(EFFECT),
      ...(over.mutation ?? {}),
    },
    ...(({ mutation, ...rest }) => rest)(over),
  };
}

/** A tree with ONE record carrying ONE fully proven row, and a register whose
 *  floor says zero rows are unproven. That is the passing shape; every test
 *  below moves exactly one thing away from it. */
function build(over = {}) {
  const rows = over.rows ?? [row()];
  const files = {
    'tooling/dod-register.json': JSON.stringify(
      { mutationProofs: { unprovenFloor: over.floor ?? 0, measuredOn: '2026-09-09' } },
      null,
      2,
    ),
    'apps/demo/dod.json': over.record === null ? null : JSON.stringify({ app: 'demo', status: 'stamped', features: rows }, null, 2),
    'apps/demo/lib/add.dart': over.effect === null ? null : (over.effect ?? EFFECT),
    'apps/demo/test/add_test.dart': over.testFile === null ? null : (over.testFile ?? TEST_FILE),
  };
  if (over.extraFiles) Object.assign(files, over.extraFiles);
  if (over.registerRaw !== undefined) files['tooling/dod-register.json'] = over.registerRaw;
  return fixture(files);
}

describe('assert-mutation-proofs', () => {
  // ── THE GREEN CONTROL ─────────────────────────────────────────────────────
  test('passes on a tree whose one row carries a landing edit and a matching code hash', () => {
    const { code, out } = run(build());
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}mutation proofs/);
    assert.match(out, /1 carry a re-runnable edit pinned to a content hash/);
    assert.match(out, /0 UNPROVEN/);
  });

  test('a COMMENT-ONLY edit to the effect file does NOT expire the proof', () => {
    const reworded = EFFECT.replace('// A comment. Changing this must NOT expire a proof.', '// Entirely different prose, and more of it.');
    assert.notEqual(reworded, EFFECT, 'the fixture must actually have changed');
    const { code, out } = run(build({ effect: reworded }));
    assert.equal(code, 0, out);
    assert.match(out, /0 UNPROVEN/);
  });

  // ── COVERAGE LOST: the domain ─────────────────────────────────────────────
  test('COVERAGE LOST when the tree holds no dod.json at all', () => {
    const { code, out } = run(build({ record: null }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no dod\.json record was found/);
  });

  test('COVERAGE LOST when the record holds no feature rows', () => {
    const dir = build();
    writeFileSync(join(dir, 'apps/demo/dod.json'), JSON.stringify({ app: 'demo', features: [] }));
    const { code, out } = run(dir);
    assert.equal(code, 2);
    assert.match(out, /records no proof at all|COVERAGE LOST/);
  });

  test('COVERAGE LOST when the walk cannot reach a record git tracks', () => {
    // A record inside a directory the walk skips by name. git still tracks it,
    // so the cross-check catches a walk that grades a subset while reporting on
    // the whole — the defect the whole family of guards exists for.
    const dir = build({ extraFiles: { 'apps/demo/build/dod.json': JSON.stringify({ features: [row()] }) } });
    const { code, out } = run(dir);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /MISSED 1/);
  });

  // ── COVERAGE LOST: the ratchet's right-hand side ──────────────────────────
  test('COVERAGE LOST when the register carries no unprovenFloor', () => {
    const { code, out } = run(build({ registerRaw: JSON.stringify({ mutationProofs: {} }) }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /unprovenFloor/);
  });

  test('COVERAGE LOST when the register is not on disk', () => {
    const { code, out } = run(build({ registerRaw: null }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── LIMB 1 · shape ────────────────────────────────────────────────────────
  test('FAILS when a feature row carries no mutation block', () => {
    const r = row();
    delete r.mutation;
    const { code, out } = run(build({ rows: [r] }));
    assert.equal(code, 1);
    assert.match(out, /has no `mutation` block/);
  });

  test('FAILS when observedRed is blank, because then any non-zero exit reads as a catch', () => {
    const { code, out } = run(build({ rows: [row({ mutation: { observedRed: '   ' } })] }));
    assert.equal(code, 1);
    assert.match(out, /`mutation\.observedRed` is missing or blank/);
  });

  test('FAILS when the effect file named by the row is not on disk', () => {
    const { code, out } = run(build({ effect: null }));
    assert.equal(code, 1);
    assert.match(out, /is not on disk/);
  });

  // ── LIMB 2 · the edit must be a real, unique, re-runnable experiment ──────
  test('FAILS when the edit replaces the text with itself — a mutation that cannot change the program', () => {
    const { code, out } = run(build({ rows: [row({ mutation: { edit: { find: EDIT.find, replace: EDIT.find } } })] }));
    assert.equal(code, 1);
    assert.match(out, /replaces the text with itself/);
  });

  test('FAILS when the edit no longer lands in the effect file', () => {
    const { code, out } = run(build({ rows: [row({ mutation: { edit: { find: 'nothing like this exists', replace: 'x' } } })] }));
    assert.equal(code, 1);
    assert.match(out, /no longer occurs in/);
  });

  test('FAILS when the edit lands twice — two experiments sharing one record', () => {
    const twice = EFFECT.replace('  }\n}', `  }\n  void other() {\n    ${EDIT.find}\n  }\n}`);
    const { code, out } = run(build({ effect: twice, rows: [row({ mutation: { codeHash: hashOf(twice) } })] }));
    assert.equal(code, 1);
    assert.match(out, /occurs 2 times/);
  });

  // ── LIMB 3 · the hash IS the staleness clause ─────────────────────────────
  test('FAILS when the CODE of the effect file has changed since the proof was run', () => {
    const changed = EFFECT.replace('  void save() {', '  void save() { // ignore: unused\n    final x = 1;');
    const { code, out } = run(build({ effect: changed }));
    assert.equal(code, 1);
    assert.match(out, /has changed since this proof was run/);
    assert.match(out, /never by editing the hash/);
  });

  test('the staleness clause does not consult git, so it fires in a repository with no history', () => {
    // The change must leave `edit.find` landing, or limb 2 fires first and this
    // test would pass for the wrong reason — which is how a red for an unrelated
    // reason gets read as the catch.
    const dir = build({ effect: `${EFFECT}class Later { void f() {} }\n` });
    rmSync(join(dir, '.git'), { recursive: true, force: true });
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /has changed since this proof was run/);
  });

  // ── LIMB 4 · the ratchet, in BOTH directions ──────────────────────────────
  test('FAILS when an unproven row is ADDED above the floor', () => {
    const bare = row();
    delete bare.mutation.edit;
    delete bare.mutation.codeHash;
    bare.name = 'second row';
    const { code, out } = run(build({ rows: [row(), bare] }));
    assert.equal(code, 1);
    assert.match(out, /carry no executable proof, and the recorded floor is 0/);
    assert.match(out, /Raising the floor to accommodate a new unproven row/);
  });

  test('FAILS when a row is EARNED and the floor is not lowered — the number may not go stale either', () => {
    const { code, out } = run(build({ floor: 1 }));
    assert.equal(code, 1);
    assert.match(out, /but the recorded floor is still 1/);
    assert.match(out, /Lower `mutationProofs\.unprovenFloor`/);
  });

  test('a row with an edit but no hash is RUNNABLE and still counted UNPROVEN', () => {
    const r = row();
    delete r.mutation.codeHash;
    const { code, out } = run(build({ rows: [r], floor: 1 }));
    assert.equal(code, 0, out);
    assert.match(out, /RUNNABLE and has not been RUN/);
    assert.match(out, /1 UNPROVEN/);
  });

  // ── ⏱ 2026-09-11 · LIMB 5's SUBPROCESS, BOUNDED — with a fake `flutter` on PATH ──
  // POSIX only: a process group is the mechanism under test and Windows has none.
  // The fake stands in for the two ways `flutter test` stalled a pipe-reading spawn:
  // exiting while a child it started still holds the output, and never finishing.
  // Each case bounds its own wall clock well below what the old spawn would take.
  const POSIX_ONLY = POSIX ? false : 'a process group is the mechanism under test, and Windows has none';
  const withFakeFlutter = (script, extraEnv = {}) => {
    const bin = join(TMP, `bin${seq++}`);
    mkdirSync(bin, { recursive: true });
    const exe = join(bin, 'flutter');
    writeFileSync(exe, script, { mode: 0o755 });
    const cwd = build();
    const started = Date.now();
    const r = spawnSync(process.execPath, [GUARD, cwd, '--execute'], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extraEnv },
      timeout: 120_000,
    });
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, secs: (Date.now() - started) / 1000 };
  };

  test('--execute: a `flutter test` that exits leaving a child behind neither stalls the limb nor outlives it', { skip: POSIX_ONLY }, () => {
    // The child holds stdout for 40 s. A pipe-reading spawn waits for it — twice,
    // once for the green control and once for the mutant.
    //
    // 🔴 THE SLEEPER IS IDENTIFIED BY THE PID IT WRITES DOWN, NOT BY ITS NAME.
    // This case used to assert `killed: .*sleep`, and on 2026-09-12 it turned
    // main red — and blocked the web deploy behind it — because the guard had
    // caught the child between `fork` and `execve("sleep")`, while it still
    // carried this script's own name: `killed: 36721 flutter`. The name is a
    // scheduling outcome. See fixtures/process-group.mjs for the full note.
    const pidFile = join(TMP, `straggler${seq}.pid`);
    const r = withFakeFlutter(`#!/bin/sh\nsleep 40 &\necho $! > ${JSON.stringify(pidFile)}\necho "00:01 +1: All tests passed!"\nexit 0\n`);
    assert.ok(r.secs < 30, `the limb waited ${r.secs.toFixed(1)}s for a process \`flutter test\` left behind:\n${r.out}`);
    // The guard SAYS what it left — a pid and whatever the kernel was calling it.
    assert.match(r.out, /still running in its process group, killed: \d+ \S+/);
    // …and the sleeper it left is DEAD, which is what the name was standing in
    // for and what no race can flip.
    const straggler = Number(readFileSync(pidFile, 'utf8').trim());
    assert.ok(Number.isInteger(straggler) && straggler > 0, `the fake wrote no usable pid to ${pidFile}\n${r.out}`);
    assert.ok(goneWithin(straggler, 5_000), `the straggler (pid ${straggler}, sleep 40) outlived the guard\n${r.out}`);
    // Both runs exit 0, so the mutant did not redden: the verdict is the guard's own.
    assert.match(r.out, /THE MUTANT DID NOT REDDEN THE TEST/);
  });

  // The CONTROL for the two stall cases: output still reaches the guard. The fake
  // fails, printing the row's recorded message, ONLY when the mutation is in the
  // effect file — so a CAUGHT verdict requires the captured output to be read back.
  test('--execute: CONTROL — the output `flutter test` writes is read back, so a real catch is CAUGHT', { skip: POSIX_ONLY }, () => {
    const r = withFakeFlutter('#!/bin/sh\nif grep -q "_saving = true" lib/add.dart; then echo "00:01 -1: a failed save re-arms the button [E]"; exit 1; fi\necho "00:01 +1: All tests passed!"\nexit 0\n');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /CAUGHT — green control 0, mutant non-zero, and the recorded message was printed/);
  });

  test('--execute: a `flutter test` that never finishes is COVERAGE LOST within MUTATION_TEST_TIMEOUT_MS', { skip: POSIX_ONLY }, () => {
    const r = withFakeFlutter('#!/bin/sh\nsleep 60\n', { MUTATION_TEST_TIMEOUT_MS: '2000' });
    assert.ok(r.secs < 30, `the limb ran ${r.secs.toFixed(1)}s past a 2s bound:\n${r.out}`);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST: THE GREEN CONTROL did not finish within 2s/);
  });

  // ── LIMB 5 · --execute's decisions, short of the subprocess ───────────────
  test('--only without --execute is refused rather than silently ignored', () => {
    const { code, out } = run(build(), ['--only', 'add subscription']);
    assert.equal(code, 1);
    assert.match(out, /--only is meaningless without --execute/);
  });

  test('an unrecognised flag is an error, never a silently disabled floor', () => {
    // assert-guards-refuse-empty.mjs shipped `argv[2] === undefined` as its mode
    // switch until 2026-08-17, when any stray positional word was found to turn
    // every floor it had off. This is that lesson, encoded.
    const { code, out } = run(build(), ['--fixture-mode']);
    assert.equal(code, 1);
    assert.match(out, /unknown flag --fixture-mode/);
  });

  test('--execute COVERAGE LOST rather than sweeping an empty set when nothing is runnable', () => {
    const r = row();
    delete r.mutation.edit;
    delete r.mutation.codeHash;
    const { code, out } = run(build({ rows: [r], floor: 1 }), ['--execute']);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /nothing to execute/);
  });

  test('--execute COVERAGE LOST when --only names a row that is not runnable', () => {
    const { code, out } = run(build(), ['--execute', '--only', 'no such row']);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /matched no row/);
  });

  // ── LIMB 1b · THE HOLLOW ANCHOR, statically. This is the limb that found two
  //    real defects in apps/subscriptiontracker/dod.json the first time it ran,
  //    and it fires WITHOUT --execute, which is the point: the executed limb is
  //    not wired into any per-push job, so a check that only lived there would
  //    never run on a pull request.
  test('FAILS statically when the row names a test no file declares — the hollow anchor', () => {
    const { code, out } = run(build({ testFile: TEST_FILE.replace('a failed save re-arms the button', 'some other name entirely') }));
    assert.equal(code, 1);
    assert.match(out, /no test file under apps\/demo\/test declares/);
    assert.match(out, /cannot be true as written/);
  });

  test('FAILS when the test name is only found inside a COMMENT — resolve, do not match', () => {
    const commented = ["// testWidgets('a failed save re-arms the button', () {});", 'void main() {}', ''].join('\n');
    const { code, out } = run(build({ testFile: commented }));
    assert.equal(code, 1);
    assert.match(out, /no test file under apps\/demo\/test declares/);
  });

  test('FAILS when the test name is only found inside a STRING literal, not a declaration', () => {
    // assert-case-count-honest.mjs was born because 57 promised cases were
    // `test(…)` spelled inside fixture string literals. A bare mention is not a
    // declaration here either.
    const mentioned = ["void main() { final s = 'a failed save re-arms the button'; }", ''].join('\n');
    const { code, out } = run(build({ testFile: mentioned }));
    assert.equal(code, 1);
    assert.match(out, /no test file under apps\/demo\/test declares/);
  });

  test('FAILS when two files declare the name and the row does not say which', () => {
    const { code, out } = run(build({ extraFiles: { 'apps/demo/test/dupe_test.dart': TEST_FILE } }));
    assert.equal(code, 1);
    assert.match(out, /declared in 2 files/);
    assert.match(out, /carries no `testFile`/);
  });

  test('an ambiguous name is resolved by an explicit testFile on the row', () => {
    const r = row();
    r.testFile = 'test/add_test.dart';
    const { code, out } = run(build({ rows: [r], extraFiles: { 'apps/demo/test/dupe_test.dart': TEST_FILE } }));
    assert.equal(code, 0, out);
    assert.match(out, /0 UNPROVEN/);
  });

  test('FAILS when testFile names a file that does not declare the test', () => {
    const r = row();
    r.testFile = 'test/dupe_test.dart';
    const { code, out } = run(build({ rows: [r] }));
    assert.equal(code, 1);
    assert.match(out, /is declared only in test\/add_test\.dart/);
  });

  // ── THE TREE IS RESTORED. This is the property a harness that edits `lib/`
  //    cannot be trusted without, and it is checked by reading the file back
  //    after a run that necessarily fails at the subprocess (there is no Flutter
  //    in this suite, so the spawn errors) — the restore must have happened
  //    anyway, on the failure path.
  test('the effect file is byte-identical after an --execute run that could not complete', () => {
    const dir = build();
    const eff = join(dir, 'apps/demo/lib/add.dart');
    const before = readFileSync(eff, 'utf8');
    run(dir, ['--execute']);
    assert.equal(readFileSync(eff, 'utf8'), before, 'a harness that leaves a mutated lib/ file behind poisons every later run');
  });
});
