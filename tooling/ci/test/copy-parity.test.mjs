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

// ── THE GUARD'S LOCAL IMPORTS TRAVEL WITH IT (2026-08-18) ────────────────────
// 🔴 A FIXTURE THAT COPIES THE GUARD AND NOT THE MODULE IT IMPORTS DOES NOT RUN
// THE GUARD AT ALL. On 2026-08-18 assert-copy-parity.mjs stopped calling
// `readdirSync` and started calling `listDir` from ./tree-walk.mjs. Every case
// below copies the guard into a synthetic tree so `import.meta.url` moves with it;
// with the module left behind, node died in the ESM loader — ERR_MODULE_NOT_FOUND,
// exit 1, no output — and EIGHTEEN cases went red at once. The three that assert
// `exit 1` would have gone GREEN on that loader death, which is the shape this
// whole corpus refuses: a test passing for a reason that has nothing to do with
// its subject.
// So the copy is TRANSITIVE and DERIVED from the guard's own import statements —
// not a second hardcoded `cpSync`, which would go stale the next time an import
// is added and fail in the same silent direction. assert-guards-refuse-empty.mjs
// builds its subject-free tree with exactly this transitive copy, and names this
// exact failure in its own comment.
// 🔴 IT GIVES THE GUARD NO SUBJECT. tree-walk.mjs is a directory-listing helper —
// not a catalog, a registry or a repository — so a tree that has only it still has
// nothing for this guard to check, and R10 below still measures a real refusal.
const copyGuardWithLocalImports = (destCiDir) => {
  mkdirSync(destCiDir, { recursive: true });
  const guardCopy = join(destCiDir, 'assert-copy-parity.mjs');
  cpSync(GUARD, guardCopy);
  const seen = new Set();
  const rec = (absSrc) => {
    for (const m of readFileSync(absSrc, 'utf8').matchAll(/from\s+'\.\/([A-Za-z0-9._-]+\.mjs)'/g)) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      cpSync(join(CI_DIR, name), join(destCiDir, name));
      rec(join(CI_DIR, name));
    }
  };
  rec(GUARD);
  return guardCopy;
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

  // the guard lives inside the origin repo, two below its root — with the local
  // modules it imports beside it (see copyGuardWithLocalImports above)
  copyGuardWithLocalImports(join(originDir, 'tooling', 'ci'));

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
  // 🔴 EVERY LIVE ROW CARRIES A `backing.product`, BECAUSE THE REAL REGISTRY DOES.
  // Added 2026-08-19 with the copy-set fix. The guard no longer treats `state: "live"`
  // as the copy set — it takes the live rows whose product is the ORIGIN's product —
  // so a fixture whose rows name no product would make the guard REFUSE, and every
  // case below would then measure the harness instead of its subject. The default
  // gives every live row the SAME product, which reproduces exactly the semantics
  // these cases were written against: here, live still means "a copy of the origin".
  // A case that wants the other shape (a live slot holding a DIFFERENT product, which
  // is what broke the guard on the real tree) sets `backing` on the row itself.
  const rowsForRegistry = slots.map((s) => ({
    ...s,
    backing: s.backing !== undefined ? s.backing : (s.state === 'live' ? { product: 'origin-product', filed: true } : null),
  }));
  writeFileSync(join(originDir, 'catalog', 'store-matrix.json'), JSON.stringify({ slots: rowsForRegistry }, null, 2));
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
    // 🔴 AND THE DERIVATION IS `live` AND SAME PRODUCT, NOT `live` ALONE (2026-08-19).
    // `state` alone was this suite's model of the copy set until a SECOND, DIFFERENT
    // product (fullshot) reached `live` in its own slot. On that day `live` stopped
    // meaning "carries a copy of the origin", this control computed 1 copy, the guard
    // correctly found 0 and reported NOT PROVEN, and the case went red over a correct
    // registry AND a correct guard — the exact failure the header warns a typed count
    // causes, arriving instead through a derivation that had gone stale. The model has
    // to track the guard's definition of a copy, not just the registry's row count.
    const originProduct = reg.slots.find((s) => `${s.store}/${s.target}/${s.type}` === originKey)?.backing?.product ?? null;
    assert.ok(originProduct, 'the origin row must declare backing.product — the copy set is derived from it');
    const copies = reg.slots.filter((s) => s.state === 'live'
      && `${s.store}/${s.target}/${s.type}` !== originKey
      && s.backing?.product === originProduct);
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
// 🔴 A THIRD ABSENCE, WHICH THE FIRST TWO CANNOT EXPRESS: A SLOT THAT WAS NEVER
// A COPY. Added 2026-08-19, reproducing a REAL-TREE finding rather than inventing
// one. On that day the extension pair (product `fullshot`) moved into
// Chrome_Web_Store/Chrome/Extensions and that row went shell-claimed -> live. The
// guard derived its copy set from `state: "live"` alone, so it went looking for a
// Flutter copy inside a Chrome extension, found none of pubspec.yaml / package.json
// / manifest.json, and REFUSED with exit 2 — absence rule (b), "a WRONG PATH".
// It was not a wrong path. It was a slot that had never been a copy, and rule (b)
// has no way to say that. The three cases below are the difference:
//   · a different product live  -> EXCLUDED by name, and the verdict is NOT PROVEN (3)
//   · the same product live     -> compared, exit 0 (this is the control that stops
//                                  the fix from becoming "exclude everything")
//   · a live row with NO product-> REFUSAL (2), because unclassifiable is not absent
// Without the middle case, a guard that excluded every slot would pass the other two.
describe('assert-copy-parity — a `live` slot carrying a DIFFERENT product is not a copy', () => {
  test('🔴 the real 2026-08-19 shape: another product goes live → EXCLUDED by name, NOT PROVEN, never a refusal', () => {
    const slots = SLOTS();
    slots[1].backing = { product: 'some-other-product', filed: true };   // live, but not ours
    const w = workspace({ slots, decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: { 'notes.txt': 'hello\n' } } });
    const { code, text } = run(w.guard);
    assert.equal(code, 3, text);
    assert.match(text, /NOT PROVEN/);
    assert.doesNotMatch(text, /COVERAGE LOST/, 'a slot that was never a copy is not a wrong path — collapsing the two is the defect this case exists for');
    assert.match(text, /excluded/, 'a narrowing nobody is told about is how a smaller scan starts reading as a clean result');
    assert.match(text, /Google_Play_Store\/Android\/Games/, 'the excluded slot must be named');
    assert.match(text, /some-other-product/, 'and so must the product that owns it');
  });

  test('the SAME product live is still compared → exit 0. Without this, "exclude everything" would pass the case above.', () => {
    const slots = SLOTS();
    slots[1].backing = { product: 'origin-product', filed: true };       // the origin's product
    const w = workspace({ slots, decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const { code, text } = run(w.guard);
    assert.equal(code, 0, text);
    assert.match(text, /shared path-pair\(s\) hashed across 1 copy\(ies\)/);
  });

  test('a `live` row naming NO product → REFUSAL, because unclassifiable is not the same as excluded', () => {
    const slots = SLOTS();
    slots[1].backing = null;                                             // live, product unstated
    const w = workspace({ slots, decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const { code, text } = run(w.guard);
    assert.equal(code, 2, text);
    assert.match(text, /no \`backing\.product\`/);
    assert.doesNotMatch(text, /^assert-copy-parity: ok/m, 'guessing "not a copy" here is how a diverged copy drops out of the comparison in silence');
  });

  test('the ORIGIN row naming no product → REFUSAL. The copy set is derived FROM it, so it cannot be absent.', () => {
    const slots = SLOTS();
    slots[0].backing = null;                                             // the origin itself
    const w = workspace({ slots, decl: DECL(), originFiles: ORIGIN_FILES(), copyFiles: { [COPY_KEY]: COPY_FILES() } });
    const { code, text } = run(w.guard);
    assert.equal(code, 2, text);
    assert.match(text, /no \`backing\.product\`/);
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
    // The guard plus the local modules it imports, and NOTHING else — no catalog,
    // no registry, no repository. See copyGuardWithLocalImports above for why the
    // modules must come and why bringing them is not bringing a subject.
    const { code, text } = run(copyGuardWithLocalImports(bare));
    assert.equal(code, 2, text);
    assert.match(text, /COVERAGE LOST/);
  });
});
