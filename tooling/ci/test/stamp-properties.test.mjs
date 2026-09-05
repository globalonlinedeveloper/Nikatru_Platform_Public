// ─────────────────────────────────────────────────────────────────────────────
// stamp-properties.test.mjs — assert-stamp-properties.mjs's EXEMPT_APPS must be
// VISIBLE, must name a path that exists, and must be SIZED.
//
// WHY THIS FILE EXISTS AT ALL (measured 2026-08-25, before it did):
// `ls tooling/ci/test/ | grep -i stamp-prop` returned nothing and
// tooling/ci/test/coverage-manifest.json carried no stamp-properties entry, while
// `node tooling/ci/assert-stamp-properties.mjs` exited 0 and ended with
// "ok — 26 property/properties enforced across 1 root(s):
// tooling/bricks/app/__brick__/apps/{{app_id}}". `grep -ci exempt` over that
// stdout returned 1, and the one hit was an unrelated brand-seed sentence: the
// ONE APP THAT SHIPS was dropped from the graded set and no line of output said
// so. Its ~50 sibling cases live in guards.test.mjs and are about the property
// audit itself; nothing there is about the exemption.
//
// 🔴 THE FIXTURE IS A REAL TREE, NOT A SYNTHETIC ONE, AND THAT IS FORCED.
// Limb (3) compares a COUNT of audit failures against a recorded floor, so a
// fixture whose exempted app is a two-file stub cannot express the limb at all —
// it can only express "the property test is missing". So `apps/subly` here is a
// COPY OF THE REAL BRICK plus a package manifest: a genuinely stamped app that
// audits with ZERO failures, into which this file then introduces failures ONE
// AT A TIME by renaming `group('property: …')` markers. That makes the count an
// input the tests control, which is the only way to sit ON the floor, one above
// it and one below it in three otherwise identical trees.
//
// The shared trees (`packages/`, `services/`, `catalog/`, the brick) are copied
// from the real repository rather than invented, because every source anchor
// starting `packages/`/`services/`/`tooling/` is resolved repo-absolute and a
// hand-written stand-in for eleven real files would drift from them silently.
//
// Run:  node --test tooling/ci/test/stamp-properties.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-stamp-properties.mjs');

const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const PROP_TEST = 'test/chassis_properties_test.dart';
const PROVIDERS = 'lib/state/providers.dart';
/** The one member of EXEMPT_APPS. Named here rather than derived, because the
 *  point of these cases is that the guard's own list is not empty and not free. */
const EXEMPT = 'apps/subly';

const GOOD_WORKSPACE = 'name: nikatru_workspace\nworkspace:\n  - packages/core\n  - apps/subly\n';
/** The same file with the exempted app taken off the list — limb (2)'s input. */
const WORKSPACE_WITHOUT_EXEMPT = 'name: nikatru_workspace\nworkspace:\n  - packages/core\n';

/** Directories that are build output or vendored code. Copying them turns a 4s
 *  fixture into a 32s one (measured) and no anchor is ever read from them. */
const SKIP_DIRS = new Set(['node_modules', '.dart_tool', 'build', 'coverage', '.git', 'dist', '.wrangler']);

let TMP;
let BASE;
/** Pristine sources, read once from the real tree; every case rewrites the two
 *  mutable files from these, so a case cannot inherit the previous case's edit. */
let PRISTINE_PROP;
let PRISTINE_PROVIDERS;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-stamp-prop-'));
  BASE = join(TMP, 'tree');
  const filter = (src) => !src.split(sep).some((p) => SKIP_DIRS.has(p));
  for (const d of ['catalog', 'packages', 'services', 'tooling/bricks']) {
    cpSync(join(REPO, d), join(BASE, d), { recursive: true, filter });
  }
  for (const f of ['tooling/channel-register.json', 'tooling/ci/check-site-integrity.mjs']) {
    mkdirSync(dirname(join(BASE, f)), { recursive: true });
    cpSync(join(REPO, f), join(BASE, f));
  }
  // The exempted app, as a REAL stamped app: the brick's own tree, which audits
  // clean, plus the package manifest that makes it a workspace member.
  cpSync(join(REPO, BRICK), join(BASE, EXEMPT), { recursive: true, filter });
  writeFileSync(join(BASE, EXEMPT, 'pubspec.yaml'), 'name: subly\ndescription: fixture stand-in\n');
  PRISTINE_PROP = readFileSync(join(REPO, BRICK, PROP_TEST), 'utf8');
  PRISTINE_PROVIDERS = readFileSync(join(REPO, BRICK, PROVIDERS), 'utf8');
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/**
 * Put the fixture into a known state and run the real guard against it.
 *
 * `missingGroups` renames N `group('property: …')` markers in the EXEMPTED app's
 * property test — and ONLY there, never in the brick — so the audit reports
 * exactly N "is NOT asserted" failures. The block bodies stay, so the MIN_BLOCKS
 * floor is untouched and N is the only thing that moves.
 *
 * `protect` keeps named properties out of that renaming. It is load-bearing for
 * the comment-stripping case and it is not cosmetic: a property whose GROUP is
 * missing never reaches its source anchors at all, so hiding
 * `content-pack-consumed` by accident would make the anchor case measure nothing
 * and pass — the "fixture that omits the input class" shape exactly. The first
 * draft of that case did hide it and reported 10 where it meant 11.
 *
 * `commentOutPackAnchor` turns the exempted app's one
 * `contentPack: 'https://…'` line into a `//` comment WITHOUT deleting the text.
 * That is the 2026-08-21 class-D shape reproduced: read RAW the anchor still
 * matches, read COMMENT-STRIPPED it does not.
 */
function run({ missingGroups = 0, protect = [], commentOutPackAnchor = false, workspace = GOOD_WORKSPACE, exemptHasPubspec = true } = {}) {
  let hidden = 0;
  const prop = PRISTINE_PROP.replace(/group\(\s*'property: ([a-z0-9-]+)'/g, (m, key) => {
    if (protect.includes(key) || hidden >= missingGroups) return m;
    hidden++;
    return m.replace("'property: ", "'notaproperty: ");
  });
  assert.equal(hidden, missingGroups, `could not hide ${missingGroups} property group(s); hid ${hidden}`);
  writeFileSync(join(BASE, EXEMPT, PROP_TEST), prop);

  const providers = commentOutPackAnchor
    ? PRISTINE_PROVIDERS.split('\n')
        .map((l) => (/contentPack:\s*'https:\/\//.test(l) ? `// ${l}` : l))
        .join('\n')
    : PRISTINE_PROVIDERS;
  writeFileSync(join(BASE, EXEMPT, PROVIDERS), providers);

  writeFileSync(join(BASE, 'pubspec.yaml'), workspace);
  const manifest = join(BASE, EXEMPT, 'pubspec.yaml');
  if (exemptHasPubspec) writeFileSync(manifest, 'name: subly\ndescription: fixture stand-in\n');
  else rmSync(manifest, { force: true });

  const r = spawnSync(process.execPath, [GUARD], { cwd: BASE, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// The floor the guard records for apps/subly. Named once here so a case that
// moves off it says which direction it moved in.
const FLOOR = 10;

describe('assert-stamp-properties — EXEMPT_APPS is visible, existent and sized', () => {
  // ── LIMB (1) · VISIBLE ─────────────────────────────────────────────────────
  // The defect: `ok` with the only shipped app silently ungraded. A reader must
  // not be able to reach the verdict line without meeting the exemption.
  test('every EXEMPT_APPS member is named, with its reason, on a passing run', () => {
    const { code, out } = run({ missingGroups: FLOOR });
    assert.equal(code, 0, out);
    assert.match(out, /NOT GRADED: apps\/subly is in EXEMPT_APPS/);
    assert.match(out, /39-CHASSIS §4 cut 1/, 'the reason travels with the name, or the line is a label');
  });

  test('the ok line itself carries the SKIPPED count — not a separate line above it', () => {
    const { code, out } = run({ missingGroups: FLOOR });
    assert.equal(code, 0, out);
    const verdict = out.split('\n').find((l) => l.startsWith('assert-stamp-properties: ok'));
    assert.ok(verdict, out);
    // 🔴 THE ASSERTION IS ON THE VERDICT LINE, not on `out`. A print anywhere in
    // the output would satisfy a whole-output match while still letting somebody
    // read "ok — enforced across 1 root(s)" and stop there.
    assert.match(verdict, /1 app root\(s\) NOT GRADED \(EXEMPT_APPS: apps\/subly\)/, verdict);
  });

  // ── LIMB (2) · THE EXEMPTION MUST NAME A REAL WORKSPACE MEMBER ─────────────
  test('FAILS when an EXEMPT_APPS entry is not on the workspace list', () => {
    const { code, out } = run({ missingGroups: FLOOR, workspace: WORKSPACE_WITHOUT_EXEMPT });
    assert.equal(code, 1, out);
    assert.match(out, /EXEMPT_APPS names "apps\/subly", which is NOT in the root pubspec\.yaml `workspace:` block/);
    // ⚠️ AND IT IS ONE DEFECT, ONE MESSAGE. The ratchet must NOT also fire here:
    // an app that is not on the list was never audited, so a count for it would
    // be a second failure attributing one cause to two places.
    assert.doesNotMatch(out, /has DRIFTED|has CAUGHT UP/, out);
  });

  test('the same tree with the app back on the list does NOT report it', () => {
    const { out } = run({ missingGroups: FLOOR });
    assert.doesNotMatch(out, /which is NOT in the root pubspec\.yaml/);
  });

  // ── LIMB (3) · THE RATCHET ────────────────────────────────────────────────
  // 🔴 THE COUNT IS PRINTED WHETHER OR NOT IT FAILS. That is the whole point of
  // the limb: the number the header prose called "9, now 10" is now produced by
  // the guard on every run instead of being a hand measurement somebody is told
  // to redo.
  test('the size of the exemption is printed on a run that passes', () => {
    const { code, out } = run({ missingGroups: FLOOR });
    assert.equal(code, 0, out);
    assert.match(
      out,
      new RegExp(`the same audit run over it produces ${FLOOR} FAIL line\\(s\\) \\(recorded floor ${FLOOR},`),
    );
    // …and it says WHICH properties, not just how many. A bare number is a
    // measurement nobody can act on.
    assert.match(out, /would fail: apps\/subly: property '/);
  });

  test('FAILS when the exempted app DRIFTS one property further from the chassis', () => {
    const { code, out } = run({ missingGroups: FLOOR + 1 });
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`has DRIFTED: the audit now produces ${FLOOR + 1} FAIL line\\(s\\), above the recorded floor of ${FLOOR}`));
  });

  // 🔴 THE DIRECTION A ONE-SIDED FLOOR CANNOT SEE, and the reason this is not a
  // budget. An exempted app that catches up leaves the floor sitting above the
  // real number, and a later regression can reappear underneath it in silence.
  test('FAILS the OTHER way when the exempted app CATCHES UP and the floor is not lowered', () => {
    const { code, out } = run({ missingGroups: FLOOR - 1 });
    assert.equal(code, 1, out);
    assert.match(out, new RegExp(`has CAUGHT UP: the audit produces ${FLOOR - 1} FAIL line\\(s\\), BELOW the recorded floor of ${FLOOR}`));
    assert.match(out, new RegExp(`Lower the floor to ${FLOOR - 1} in this commit`));
  });

  // 🔴 THE TRAP THE 2026-08-21 RECORD NAMES BY NUMBER: raw vs comment-stripped.
  // The header records that reading the anchors RAW gives 9 for apps/subly and
  // COMMENT-STRIPPED gives 10, and that the difference is exactly one anchor
  // matching a `///` sentence ABOUT a feature the app does not have. A ratchet
  // built on a re-implementation that skipped the stripper would pin the wrong
  // number and then look perfectly stable. This case reproduces that shape: the
  // `contentPack: 'https://…'` line is COMMENTED OUT, not deleted, so the text a
  // raw read matches is still in the file.
  test('the ratchet counts a COMMENTED-OUT anchor as gone — the raw read would not', () => {
    const clean = run({ missingGroups: FLOOR, protect: ['content-pack-consumed'] });
    assert.equal(clean.code, 0, clean.out);

    const commented = run({ missingGroups: FLOOR, protect: ['content-pack-consumed'], commentOutPackAnchor: true });
    assert.equal(commented.code, 1, commented.out);
    assert.match(commented.out, new RegExp(`has DRIFTED: the audit now produces ${FLOOR + 1} FAIL line\\(s\\)`));
    // Named, so a future reader can tell this is the content-pack anchor and not
    // some other property that happened to move.
    assert.match(commented.out, /would fail: apps\/subly: property 'content-pack-consumed' is asserted but its IMPLEMENTATION is gone/);
  });

  // ── THE MEASURABILITY GATE, pinned so it cannot be widened by accident ─────
  // A tree may NAME `apps/subly` on its workspace list without being the app —
  // every assert-stamp-properties fixture in guards.test.mjs does exactly that,
  // seeding two files under `apps/subly/lib` so the [13]T-4 boot walk has
  // something to walk. The ratchet therefore compares only when the exempted app
  // carries a `pubspec.yaml`. That is not an opt-out: a `workspace:` member with
  // no manifest is not a Dart workspace, and `dart pub get` refuses the whole
  // repository. But it IS a branch, so it gets a case — otherwise the gate is a
  // condition no test can tell from its absence.
  test('PRINTS the count but does not compare it when the exempted app is not a package', () => {
    const { code, out } = run({ missingGroups: 0, exemptHasPubspec: false });
    assert.equal(code, 0, out);
    assert.match(out, /produces 0 FAIL line\(s\) — but this tree has no apps\/subly\/pubspec\.yaml/);
    assert.match(out, new RegExp(`it is not the package floor ${FLOOR} was measured over`));
    // 0 is nine below the floor and must still not fail HERE.
    assert.doesNotMatch(out, /has CAUGHT UP|has DRIFTED/, out);
  });

  // …and the same tree WITH the manifest, so the silence above is attributable
  // to the gate rather than to a ratchet that stopped comparing anything.
  test('the identical tree WITH the manifest does compare, and fails', () => {
    const { code, out } = run({ missingGroups: 0 });
    assert.equal(code, 1, out);
    assert.match(out, /has CAUGHT UP: the audit produces 0 FAIL line\(s\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATION — AN ANCHOR FOLLOWS ITS SPELLING INTO THE CHASSIS (ADR 067 dec. 2)
//
// [ADR 066] measured 88 literal shapes anchored to 10 named brick files and
// called each one "re-pointable, but each is a guard edit, never a free move".
// The edit is made once, generically: an anchor whose file DELEGATES to
// `package:nikatru_chassis_screens` is searched there too.
//
// The subject here is `theme-triplet-supplied`, whose single anchor is
// `themeMode: ref.watch(themeModeProvider)` in `lib/app.dart`. Move that line
// into the chassis and read the adapter alone, and the guard says the property
// "is asserted but its IMPLEMENTATION is gone" — about a tree where the line is
// one import away and perfectly alive.
//
// SP-D1 IS THE GREEN CONTROL AND IT IS NOT OPTIONAL. Without it SP-D2's red is
// equally consistent with a resolver that refuses every delegation, and SP-D2 is
// the case that has to keep working: the anchor must still be able to FAIL when
// the line is genuinely nowhere.
// ─────────────────────────────────────────────────────────────────────────────
describe('an anchor whose line moved into the chassis is judged there', () => {
  const APP_ROOT = 'lib/app.dart';
  const ANCHOR = 'themeMode: ref.watch(themeModeProvider),';
  const CHASSIS = 'packages/chassis_screens/lib/app_shell.dart';

  /** The brick's `app.dart` emptied of the anchored line, which now lives in the
   *  chassis file it delegates to.
   *
   *  `lineInPackage: false` is the mutation the anchor exists for — the line is
   *  in NEITHER file. `packageOnDisk: false` is the resolver's own refusal. */
  function delegate({ lineInPackage = true, packageOnDisk = true } = {}) {
    const appPath = join(BASE, BRICK, APP_ROOT);
    const original = readFileSync(appPath, 'utf8');
    assert.ok(original.includes(ANCHOR), 'the subject anchor has moved out of the brick app.dart');
    writeFileSync(
      appPath,
      `import 'package:nikatru_chassis_screens/app_shell.dart';\n` +
        // 🔴 THE ADAPTER MUST ACTUALLY USE WHAT IT IMPORTS. The shared resolver
        // refuses an import nothing references, because a review proved on
        // 2026-09-05 that one unused import line was enough to widen a scan and
        // silence a deleted control. So the anchored line is replaced by a REAL
        // use of `AppShell` — which is what a screen moving into the chassis
        // actually looks like, and a comment would not have been.
        original.split(ANCHOR).join('home: const AppShell(),'),
    );
    if (packageOnDisk) {
      mkdirSync(join(BASE, 'packages/chassis_screens/lib'), { recursive: true });
      writeFileSync(
        join(BASE, CHASSIS),
        'class AppShell extends StatelessWidget {\n' +
          '  Widget build(BuildContext context) => MaterialApp(\n' +
          (lineInPackage ? `    ${ANCHOR}\n` : '    // the line is in neither file\n') +
          '  );\n}\n',
      );
    }
  }

  /** Every case rewrites `app.dart`, so it is restored afterwards — the fixture
   *  tree is shared by every describe block in this file and a case that leaks
   *  its edit reddens the ones after it for a reason that is not theirs. */
  const restoreApp = () => {
    cpSync(join(REPO, BRICK, APP_ROOT), join(BASE, BRICK, APP_ROOT));
    rmSync(join(BASE, 'packages/chassis_screens'), { recursive: true, force: true });
  };

  test('SP-D1 · the anchor resolves through the delegation', () => {
    try {
      delegate();
      const { code, out } = run({ missingGroups: FLOOR });
      assert.equal(code, 0, out);
      assert.match(out, /property 'theme-triplet-supplied' asserted and implemented/);
    } finally {
      restoreApp();
    }
  });

  test('SP-D2 · the anchor still FAILS when the line is in neither file', () => {
    try {
      delegate({ lineInPackage: false });
      const { code, out } = run({ missingGroups: FLOOR });
      assert.equal(code, 1, out);
      assert.match(out, /property 'theme-triplet-supplied' is asserted but its IMPLEMENTATION is gone/);
    } finally {
      restoreApp();
    }
  });

  test('SP-D3 · COVERAGE LOST when the delegation resolves to nothing on disk', () => {
    try {
      delegate({ packageOnDisk: false });
      const { code, out } = run({ missingGroups: FLOOR });
      assert.equal(code, 1, out);
      assert.match(out, /COVERAGE LOST — .*anchor on .*app\.dart could not be resolved/);
      assert.match(out, /that file is not on disk/);
    } finally {
      restoreApp();
    }
  });

  test('SP-D4 · two chassis imports in one file is refused, not guessed', () => {
    try {
      delegate();
      const appPath = join(BASE, BRICK, APP_ROOT);
      writeFileSync(
        appPath,
        `import 'package:nikatru_chassis_screens/other.dart';\n${readFileSync(appPath, 'utf8')}`,
      );
      const { code, out } = run({ missingGroups: FLOOR });
      assert.equal(code, 1, out);
      assert.match(out, /imports 2 different `package:nikatru_chassis_screens` paths/);
      assert.match(out, /will not guess between two of them/);
    } finally {
      restoreApp();
    }
  });
});
