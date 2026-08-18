// ─────────────────────────────────────────────────────────────────────────────
// copy-parity.test.mjs — assert-copy-parity.mjs must be able to FAIL, and must
// be able to REFUSE, and must be able to say NOT PROVEN. Three different things.
//
// 🔴 REAL-TREE NEGATIVE TESTS CAME FIRST. Every case below was produced by
// MUTATING THE ACTUAL WORKSPACE on 2026-08-18 — a real 686-file source copy was
// materialised in Projects/Google_Play_Store/Android/Games/Nikatru_Android_Games_Public,
// catalog/store-matrix.json's Games row was flipped to `live`, and the guard was
// run against it — then the shell was emptied and every blob re-checked against
// its pre-state pin. Results, with the exit code each produced:
//   R1  two real copies, in parity            -> ok, 585 pairs hashed        exit 0
//   R2  one trailing space in the COPY's
//       packages/core/lib/src/result.dart     -> DIVERGED, both blobs named  exit 1
//   R3  the same edit in the copy's
//       apps/subly/android/… (per-slot)       -> still ok, 585 pairs         exit 0
//   R4  that shared file DELETED from the copy-> MISSING, 584 pairs          exit 1
//   R5  the copy carrying a tooling/ file     -> UNDECIDED PATHS CARRIED     exit 1
//   R6  a waiver pinned to the origin blob    -> WAIVED, printed by name     exit 0
//   R7  then a "fix" lands in the ORIGIN      -> STALE WAIVER + DIVERGED     exit 1
//   R8  copy re-synced, waiver left behind    -> OBSOLETE WAIVER             exit 1
//   R9  an EMPTY SHELL row flipped to `live`  -> COVERAGE LOST, refusal      exit 2
//   R10 the guard alone in a subject-free dir -> COVERAGE LOST, refusal      exit 2
// A fixture the test author wrote encodes the same misunderstanding as the guard
// the test author wrote. Only breaking the real tree proves the guard reaches a
// real tree. The synthetic workspaces below exist so the ten results above can be
// re-run by anyone, on any machine, without a 686-file copy — they are a
// REPRODUCTION of a real-tree finding, never the origin of one.
//
// 🔴 R3 IS THE CASE THAT MATTERS MOST AND IS THE EASIEST TO FORGET. Without a
// case where a file DIFFERS and the guard still passes, every red result above is
// equally consistent with a guard that refuses everything it is ever shown. R3 and
// T_PER_SLOT are that control.
//
// 🔴 AND THE POSITIVE CONTROL AGAINST THE REAL REPOSITORY DERIVES ITS EXPECTATION.
// It does NOT assert `exit 3`. Today the real matrix has one live slot so exit 3
// is right, but the day a second slot ships that becomes 0 and a typed 3 would go
// red over correct work — the failure mode recorded against WEB's
// vendor-current.test.mjs, whose re-typed "1 of 1" killed nineteen cases when the
// last pending upstream was promoted. The expectation is computed from
// catalog/store-matrix.json at run time, so the suite tracks the matrix instead of
// having to be remembered.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync, rmdirSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-copy-parity.mjs');
const REAL_REGISTRY = join(REPO, 'catalog', 'store-matrix.json');
const REAL_DECL = join(REPO, 'catalog', 'copy-origins.json');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-copy-parity-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const run = (guardPath) => {
  const r = spawnSync(process.execPath, [guardPath], { encoding: 'utf8' });
  return { code: r.status, text: `${r.stdout || ''}${r.stderr || ''}` };
};

// ── a synthetic workspace with the real anchor shape ────────────────────────
// <root>/nikatru/                              the anchor's second marker
// <root>/Projects/S/T/Y/<dir>/                 slot directories, at the real depth
// The guard is COPIED IN, so import.meta.url moves with it and it cannot reach
// back into the real repository — the trap assert-guards-refuse-empty.mjs measured
// when twenty guards re-scanned the real tree from an empty root.
function workspace({ slots, decl, originFiles, copyFiles, originIsGit = true, writeDecl = true }) {
  const root = join(TMP, `ws${++seq}`);
  mkdirSync(join(root, 'nikatru'), { recursive: true });
  const P = join(root, 'Projects');

  const dirOf = (s) => join(P, s.store, s.target, s.type, s.publicDir);
  for (const s of slots) mkdirSync(dirOf(s), { recursive: true });

  // Fall back to the first row when the declared origin has NO row — that is itself
  // a case under test, and the harness must still be able to lay the tree out.
  const originSlot = slots.find((s) => `${s.store}/${s.target}/${s.type}` === `${decl.origin.store}/${decl.origin.target}/${decl.origin.type}`) ?? slots[0];
  const originDir = dirOf(originSlot);

  const put = (base, rel, body) => {
    const abs = join(base, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  for (const [rel, body] of Object.entries(originFiles)) put(originDir, rel, body);

  // the guard lives inside the origin repo, two below its root
  cpSync(GUARD, join(originDir, 'tooling', 'ci', 'assert-copy-parity.mjs'));

  if (originIsGit) {
    spawnSync('git', ['-C', originDir, 'init', '-q'], { encoding: 'utf8' });
    spawnSync('git', ['-C', originDir, 'add', '-A'], { encoding: 'utf8' });
  }
  // 🔴 WRITTEN AFTER `git add`, ON PURPOSE. The guard enumerates the origin with
  // `git ls-files`, so a tracked catalog/ would become a `shared` path that no
  // synthetic copy carries — every case below would then report a MISSING finding
  // about the harness rather than about its own subject. In the real repository
  // catalog/store-matrix.json and catalog/copy-origins.json are likewise untracked
  // today, so leaving them out of the index here matches the tree rather than
  // dodging it.
  mkdirSync(join(originDir, 'catalog'), { recursive: true });
  writeFileSync(join(originDir, 'catalog', 'store-matrix.json'), JSON.stringify({ slots }, null, 2));
  if (writeDecl) writeFileSync(join(originDir, 'catalog', 'copy-origins.json'), JSON.stringify(decl, null, 2));

  for (const [slotKey, files] of Object.entries(copyFiles || {})) {
    const s = slots.find((x) => `${x.store}/${x.target}/${x.type}` === slotKey);
    for (const [rel, body] of Object.entries(files)) put(dirOf(s), rel, body);
  }
  return { root, originDir, guard: join(originDir, 'tooling', 'ci', 'assert-copy-parity.mjs'), dirOf };
}

// ── the shapes every synthetic case starts from ─────────────────────────────
const SLOTS = () => ([
  { store: 'Google_Play_Store', target: 'Android', type: 'Apps', publicDir: 'Origin_Public', state: 'live' },
  { store: 'Google_Play_Store', target: 'Android', type: 'Games', publicDir: 'Copy_Public', state: 'live' },
]);
const DECL = () => ({
  origin: { store: 'Google_Play_Store', target: 'Android', type: 'Apps' },
  copyMarkers: { anyOf: ['pubspec.yaml'] },
  enumeration: { ignoreDirs: ['.git'] },
  targetPlatformDirs: { Android: ['android'], iOS: ['ios'] },
  rules: [
    { match: '.github/workflows/**', kind: 'per-slot' },
    { match: 'apps/*/@targetPlatformDir/**', kind: 'per-slot' },
    { match: 'tooling/**', kind: 'undecided' },
    { match: '**', kind: 'shared' },
  ],
  divergences: { entries: [] },
});
const SRC = 'bool allowed(int n) { return n < 10; }\n';
const ORIGIN_FILES = () => ({
  'pubspec.yaml': 'name: origin\n',
  'packages/core/lib/guard.dart': SRC,
  'apps/subly/android/app/build.gradle.kts': 'signingConfig = release\n',
  '.github/workflows/ci.yml': 'name: ci\n',
});
const COPY_FILES = () => ({
  'pubspec.yaml': 'name: origin\n',
  'packages/core/lib/guard.dart': SRC,
  'apps/subly/android/app/build.gradle.kts': 'signingConfig = release\n',
  '.github/workflows/ci.yml': 'name: ci\n',
});
const COPY_KEY = 'Google_Play_Store/Android/Games';
const blobOf = (p) => spawnSync('git', ['hash-object', '--no-filters', '--', p], { encoding: 'utf8' }).stdout.trim();

// ═══════════════════════════════════════════════════════════════════════════
describe('assert-copy-parity — the positive control, against the REAL repository', () => {
  test('the real run agrees with what catalog/store-matrix.json actually declares', () => {
    assert.ok(existsSync(REAL_REGISTRY), 'catalog/store-matrix.json must exist for this guard to have a copy set');
    assert.ok(existsSync(REAL_DECL), 'catalog/copy-origins.json must exist for this guard to have a subject');
    const reg = JSON.parse(readFileSync(REAL_REGISTRY, 'utf8'));
    const decl = JSON.parse(readFileSync(REAL_DECL, 'utf8'));
    const originKey = `${decl.origin.store}/${decl.origin.target}/${decl.origin.type}`;
    // DERIVED, never typed. See the header: a re-typed count is a suite that goes
    // red over correct work and gets deleted rather than repaired.
    const copies = reg.slots.filter((s) => s.state === 'live' && `${s.store}/${s.target}/${s.type}` !== originKey);
    const { code, text } = run(GUARD);

    if (copies.length === 0) {
      assert.equal(code, 3, `the registry declares ${copies.length} copy(ies) besides the origin, so the guard must report NOT PROVEN (3), not ok (0). Got ${code}.`);
      assert.match(text, /NOT PROVEN/);
      assert.match(text, /COMPARED NOTHING/);
      assert.doesNotMatch(text, /^assert-copy-parity: ok/m, 'a guard that compared nothing must never print ok');
    } else {
      assert.ok(code === 0 || code === 1, `with ${copies.length} copy(ies) declared the guard must compare and report 0 or 1, got ${code}`);
      assert.doesNotMatch(text, /NOT PROVEN/, `${copies.length} copy(ies) are declared, so a NOT PROVEN verdict means the copy set was derived wrongly`);
    }
  });

  test('the self-test canaries run on the real invocation, not only here', () => {
    const { text } = run(GUARD);
    assert.match(text, /self-test: 4 canary\(ies\) passed/);
  });

  test('the real declaration classifies EVERY tracked path — classification is total', () => {
    const { text } = run(GUARD);
    assert.doesNotMatch(text, /matched NO rule/, 'a path falling through means the catch-all was removed');
  });

  test('the real declaration has no dead rules', () => {
    const { text } = run(GUARD);
    assert.doesNotMatch(text, /matched ZERO paths/, 'a rule matching nothing has drifted from the tree it describes');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('assert-copy-parity — it must be able to PASS (the control that makes every red result mean something)', () => {
  test('two copies in parity → exit 0, and the comparison count is real', () => {
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const { code, text } = run(w.guard);
    assert.equal(code, 0, text);
    assert.match(text, /shared path-pair\(s\) hashed across 1 copy\(ies\)/);
    assert.doesNotMatch(text, /hashed across 0 copy/);
  });

  test('a PER-SLOT path may differ and the guard still passes — otherwise a guard that fails on everything would pass every case above', () => {
    const copy = COPY_FILES();
    copy['apps/subly/android/app/build.gradle.kts'] = 'signingConfig = a_DIFFERENT_key\n';
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: copy } });
    const { code, text } = run(w.guard);
    assert.equal(code, 0, text);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('assert-copy-parity — it must be able to FAIL (exit 1)', () => {
  test('ONE CHARACTER in a shared Dart file → DIVERGED, both blob ids named', () => {
    const copy = COPY_FILES();
    copy['packages/core/lib/guard.dart'] = SRC.replace('n < 10', 'n <= 10');
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: copy } });
    const { code, text } = run(w.guard);
    assert.equal(code, 1, text);
    assert.match(text, /DIVERGED/);
    assert.match(text, /packages\/core\/lib\/guard\.dart/);
    assert.match(text, /[0-9a-f]{40}/);
  });

  test('a shared file that never landed in the copy → MISSING', () => {
    const copy = COPY_FILES();
    delete copy['packages/core/lib/guard.dart'];
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: copy } });
    const { code, text } = run(w.guard);
    assert.equal(code, 1, text);
    assert.match(text, /MISSING/);
    assert.match(text, /packages\/core\/lib\/guard\.dart/);
  });

  test('a shared-class file present ONLY in the copy → UNDECLARED duplication', () => {
    const copy = COPY_FILES();
    copy['packages/core/lib/extra.dart'] = SRC;
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: copy } });
    const { code, text } = run(w.guard);
    assert.equal(code, 1, text);
    assert.match(text, /UNDECLARED/);
  });

  test('a copy carrying an `undecided` path → the open decision is named, not guessed', () => {
    const copy = COPY_FILES();
    copy['tooling/ci/something.mjs'] = 'export const x = 1;\n';
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: copy } });
    const { code, text } = run(w.guard);
    assert.equal(code, 1, text);
    assert.match(text, /UNDECIDED PATHS CARRIED/);
    assert.match(text, /5\.6/);
  });

  test('a rule that matches nothing is a DEAD RULE, not a silent no-op', () => {
    const decl = DECL();
    decl.rules.unshift({ match: 'this/path/never/exists/**', kind: 'per-slot' });
    const w = workspace({ slots: SLOTS(), decl, originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const { code, text } = run(w.guard);
    assert.equal(code, 1, text);
    assert.match(text, /matched ZERO paths/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('assert-copy-parity — the waiver cannot be routed around', () => {
  test('a waiver pinned to the CURRENT origin blob suppresses the divergence, and says so by name', () => {
    const copy = COPY_FILES();
    copy['packages/core/lib/guard.dart'] = SRC.replace('n < 10', 'n <= 10');
    const decl = DECL();
    const w0 = workspace({ slots: SLOTS(), decl, originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: copy } });
    const pin = blobOf(join(w0.originDir, 'packages', 'core', 'lib', 'guard.dart'));
    assert.match(pin, /^[0-9a-f]{40}$/, 'git hash-object must be available for this case');

    const decl2 = DECL();
    decl2.divergences.entries = [{ slot: COPY_KEY, path: 'packages/core/lib/guard.dart', originBlob: pin, reason: 'test', recorded: '2026-08-18', recordedBy: 'test' }];
    const w = workspace({ slots: SLOTS(), decl: decl2, originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: copy } });
    const { code, text } = run(w.guard);
    assert.equal(code, 0, text);
    assert.match(text, /WAIVED divergence/);
  });

  test('🔴 the origin moves under the waiver → STALE, because that is what a fix landing looks like', () => {
    const copy = COPY_FILES();
    copy['packages/core/lib/guard.dart'] = SRC.replace('n < 10', 'n <= 10');
    const decl = DECL();
    // pinned to a blob the origin does NOT currently have — the state a waiver
    // reaches the moment anyone edits the origin file it was granted against.
    decl.divergences.entries = [{ slot: COPY_KEY, path: 'packages/core/lib/guard.dart', originBlob: '0'.repeat(40), reason: 'test', recorded: '2026-08-18', recordedBy: 'test' }];
    const w = workspace({ slots: SLOTS(), decl, originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: copy } });
    const { code, text } = run(w.guard);
    assert.equal(code, 1, text);
    assert.match(text, /STALE WAIVER/);
    assert.match(text, /DIVERGED/, 'a stale waiver must stop suppressing, not merely warn');
  });

  test('a waiver whose copy now matches is OBSOLETE — an unused waiver is a false statement about the tree', () => {
    const decl = DECL();
    const w0 = workspace({ slots: SLOTS(), decl, originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const pin = blobOf(join(w0.originDir, 'packages', 'core', 'lib', 'guard.dart'));
    const decl2 = DECL();
    decl2.divergences.entries = [{ slot: COPY_KEY, path: 'packages/core/lib/guard.dart', originBlob: pin, reason: 'test', recorded: '2026-08-18', recordedBy: 'test' }];
    const w = workspace({ slots: SLOTS(), decl: decl2, originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const { code, text } = run(w.guard);
    assert.equal(code, 1, text);
    assert.match(text, /OBSOLETE WAIVER/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('assert-copy-parity — the two absence rules must never collapse into one', () => {
  test('🔴 ONE COPY → exit 3 NOT PROVEN, never 0. This is the single most important property here.', () => {
    const slots = SLOTS();
    slots[1].state = 'shell-empty';                       // only the origin is live
    const w = workspace({ slots, decl: DECL(), originFiles: ORIGIN_FILES() });
    const { code, text } = run(w.guard);
    assert.equal(code, 3, text);
    assert.match(text, /NOT PROVEN/);
    assert.match(text, /COMPARED NOTHING/);
    assert.doesNotMatch(text, /^assert-copy-parity: ok/m);
  });

  test('a slot marked `live` over an EMPTY SHELL → REFUSAL, exit 2, not "no copies"', () => {
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: {} });
    // the copy directory exists (workspace() mkdir'd it) and is empty
    const { code, text } = run(w.guard);
    assert.equal(code, 2, text);
    assert.match(text, /COVERAGE LOST/);
    assert.match(text, /EMPTY/);
  });

  test('a slot marked `live` over a directory with content but NO copy marker → REFUSAL, with a DIFFERENT diagnosis', () => {
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: { 'notes.txt': 'hello\n' } } });
    const { code, text } = run(w.guard);
    assert.equal(code, 2, text);
    assert.match(text, /copy markers/);
    assert.doesNotMatch(text, /exists but is EMPTY/, 'the empty-shell and wrong-directory diagnoses must stay distinguishable');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('assert-copy-parity — it must REFUSE rather than report on nothing (exit 2)', () => {
  test('no declaration → refusal', () => {
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() }, writeDecl: false });
    const { code, text } = run(w.guard);
    assert.equal(code, 2, text);
    assert.match(text, /COVERAGE LOST/);
  });

  test('the origin slot is not `live` → refusal, because comparing against a shell is comparing against nothing', () => {
    const slots = SLOTS();
    slots[0].state = 'shell-empty';
    const w = workspace({ slots, decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const { code, text } = run(w.guard);
    assert.equal(code, 2, text);
    assert.match(text, /not "live"/);
  });

  test('the origin slot has no row in the registry → refusal', () => {
    const decl = DECL();
    decl.origin = { store: 'Nowhere_Store', target: 'Android', type: 'Apps' };
    const w = workspace({ slots: SLOTS(), decl, originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const { code, text } = run(w.guard);
    assert.equal(code, 2, text);
    assert.match(text, /NO ROW/);
  });

  test('a slot target with no targetPlatformDirs entry → refusal, because it would silently share the signing config', () => {
    const decl = DECL();
    delete decl.targetPlatformDirs.Android;
    const w = workspace({ slots: SLOTS(), decl, originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const { code, text } = run(w.guard);
    assert.equal(code, 2, text);
    assert.match(text, /targetPlatformDirs/);
  });

  test('the origin is not a git repository → refusal, not a filesystem-walk fallback', () => {
    const w = workspace({ slots: SLOTS(), decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() }, originIsGit: false });
    const { code, text } = run(w.guard);
    assert.equal(code, 2, text);
    assert.match(text, /not a git repository/);
  });

  test('the guard alone in a subject-free directory → refusal (assert-guards-refuse-empty asks exactly this)', () => {
    const bare = join(TMP, `bare${++seq}`, 'tooling', 'ci');
    mkdirSync(bare, { recursive: true });
    cpSync(GUARD, join(bare, 'assert-copy-parity.mjs'));
    const { code, text } = run(join(bare, 'assert-copy-parity.mjs'));
    assert.equal(code, 2, text);
    assert.match(text, /COVERAGE LOST/);
  });
});
