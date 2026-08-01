// ─────────────────────────────────────────────────────────────────────────────
// stamp-platforms.test.mjs — assert-stamp-platforms.mjs must be able to FAIL.
//
// [pipeline S-3 · S-4] A stamped app builds on every platform it claims, and
// joins the workspace that checks it.
//
// ⚠️ REAL-TREE MUTATIONS FIRST (2026-07-29, five, each grep-verified). THREE OF
// THE FIVE SURVIVED the first version, and all three were the same family — a
// match that was not SCOPED:
//
//   M1 the platform claim emptied            -> caught
//   M2 claims a platform nothing stamps      -> caught
//   M3 the workspace CALL deleted            -> NOT caught: the function
//      DECLARATION still matched the bare name. Declaration-vs-usage, sixth
//      time in this repo.
//   M4 idempotency gutted                    -> NOT caught: `_appendToAppsJson`
//      prints the same "already lists" phrase, so the check read the right
//      answer off the wrong function.
//   M5 the CI build step deleted             -> NOT caught: the explanatory
//      COMMENT above that step contains the words "flutter build web", so the
//      guard matched the prose describing the check instead of the check.
//
// M5 is the repo's own recorded rule — strip comments before scanning — being
// broken by the person writing it down. All three are fixed and re-verified.
//
// ⚠️ AND M5 WAS ONLY HALF FIXED (2026-08-01 full-corpus review). Stripping
// FULL-LINE comments and then testing bare presence anywhere in the file left
// three more prose shapes satisfying "CI builds this platform". Re-mutated
// against the REAL tree (a scratch git worktree, restore byte-verified), all
// three of which the shipped guard printed `ok` for:
//
//   M5b `run: echo skip  # flutter build web disabled while debugging`
//                                            -> MISSED (trailing comment)
//   M5c `run: echo "flutter build web"`      -> MISSED (quoted string)
//   M5d the phrase moved into the step `name:`, run gutted
//                                            -> MISSED (step name)
//
// The check now ranges over run-block STRUCTURE — the command text of `run:`
// scalars only, shell comments and quoted strings removed, phrase required in
// COMMAND position. All three now fail; the legitimate block-scalar and
// `&&`-chained shapes below are the false-alarm side of the same fix.
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
const GUARD = join(CI_DIR, 'assert-stamp-platforms.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-plat-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const POST_GEN = 'tooling/bricks/app/hooks/post_gen.dart';
const CI = '.github/workflows/ci.yml';
const PROBE_VARS = 'tooling/bricks/app/_probe_vars.json';

const goodPostGen = `
import 'dart:io';
import 'package:mason/mason.dart';

void run(HookContext context) {
  _appendToAppsJson(context, id: 'x');
  _registerInWorkspace(context, id: 'x');
}

void _registerInWorkspace(HookContext context, {required String id}) {
  final file = File('pubspec.yaml');
  final lines = file.readAsLinesSync();
  final entry = '  - apps/\$id';
  if (lines.contains(entry)) {
    context.logger.info('pubspec.yaml already lists "\$id"; left unchanged.');
    return;
  }
  file.writeAsStringSync('x');
}

void _appendToAppsJson(HookContext context, {required String id}) {
  context.logger.info('apps.json already lists "\$id"; left unchanged.');
  final m = <String, dynamic>{
    'platforms': <String>['web'],
  };
}
`;

const goodCi = `
jobs:
  app_brick:
    steps:
      # A comment that names flutter build web, to keep the prose trap covered.
      - name: A fresh stamp really builds for every platform it claims
        working-directory: apps/probe
        run: flutter build web --pwa-strategy=none
`;

// The stamp lane feeds mason THIS file, so `apps/<app_id>` is where a stamped
// app lands and where its build has to run. The guard derives the anchor from
// it rather than hardcoding `apps/probe`, so the fixture must supply it too.
const goodVars = JSON.stringify({ app_id: 'probe', display_name: 'Probe' });

// ── [pipeline S-4] the workspace-resolution half ────────────────────────────
// 🔴 THE TEMPLATE'S COMMENT DELIBERATELY CONTAINS THE WORDS IT DECLARES, exactly
// as the real one does. That is not decoration: it is the trap. Delete the real
// line and `includes('resolution: workspace')` is STILL true, so a naive guard
// stays green on the mutation that kills root resolution for the whole repo.
// Mutation-proven against the real tree before this fixture existed.
const goodBrickPubspec = `name: {{app_id.snakeCase()}}
publish_to: "none"
# The resolver refuses the whole workspace without \`resolution: workspace\`.
resolution: workspace
version: 0.1.0+1
`;

/** A member pubspec — `declares: false` reproduces the shipped defect. */
const memberPubspec = (name, declares = true) =>
  `name: ${name}\npublish_to: "none"\n${declares ? 'resolution: workspace\n' : ''}`;

const goodRootPubspec = `name: nikatru_workspace
publish_to: none

workspace:
  - packages/core
  - apps/probe

dev_dependencies:
  melos: ^8.2.2
`;

function tree({
  postGen = goodPostGen,
  ci = goodCi,
  platforms = ['web'],
  vars = goodVars,
  brickPubspec = goodBrickPubspec,
  rootPubspec = goodRootPubspec,
  members = { 'packages/core': memberPubspec('nikatru_core'), 'apps/probe': memberPubspec('probe') },
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const files = { [POST_GEN]: postGen, [CI]: ci, [PROBE_VARS]: vars };
  if (rootPubspec !== null) files['pubspec.yaml'] = rootPubspec;
  if (brickPubspec !== null) files[`${BRICK_APP}/pubspec.yaml`] = brickPubspec;
  for (const [dir, body] of Object.entries(members)) files[`${dir}/pubspec.yaml`] = body;
  for (const [f, body] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  for (const p of platforms) {
    mkdirSync(join(root, BRICK_APP, p), { recursive: true });
    writeFileSync(join(root, BRICK_APP, p, 'index.html'), '<html></html>');
  }
  mkdirSync(join(root, BRICK_APP), { recursive: true });
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-stamp-platforms', () => {
  test('passes when the claim, the folders and the CI build agree', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /claims 1 platform\(s\): web/);
    assert.match(out, /registers the app in the workspace/);
  });

  // 🔴 M1 — the original defect. An empty claim made every per-platform check
  // pass by having nothing to iterate.
  // ── the coverage self-check must itself be alive ──────────────────────────
  // 🔴 Added 2026-07-31: the step counters were written /^\s*-\s+…/ — in a
  // regex LITERAL that matches a literal backslash, so both counts were always
  // 0 and neither branch of the self-check could ever run. It satisfied
  // assert-guard-coverage's marker requirement while asserting nothing. The
  // survived-steps ok-line is the testable symptom: it NEVER printed under the
  // broken regex, so this assertion fails against it. Verified by mutation:
  // restoring the double backslash makes exactly this test go red.
  test('the step counters actually count — the survived-steps line prints', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /\d+ of \d+ CI step\(s\) survived comment stripping/);
  });

  test('FAILS COVERAGE LOST on a ci.yml with zero recognisable steps', () => {
    // The constructible failing input the old self-check never had: a workflow
    // file that parses but contains no steps at all.
    const stepless = ['jobs:', '  app_brick:', '    if: false', ''].join('\n');
    const { code, out } = run(tree({ ci: stepless }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO recognisable steps/);
  });

  test('FAILS when the platform claim is emptied', () => {
    const { code, out } = run(tree({
      postGen: goodPostGen.replace("<String>['web']", '<String>[]'),
      platforms: [],
    }));
    assert.equal(code, 1);
    assert.match(out, /platform claim is EMPTY/);
  });

  test('FAILS when a claimed platform has no stamped folder', () => {
    const { code, out } = run(tree({
      postGen: goodPostGen.replace("<String>['web']", "<String>['web', 'windows']"),
    }));
    assert.equal(code, 1);
    assert.match(out, /CLAIMS "windows" but the brick stamps no `windows\/` folder/);
  });

  // The other direction: shipping platform code nobody builds.
  test('FAILS when a stamped folder is not in the claim', () => {
    const { code, out } = run(tree({ platforms: ['web', 'linux'] }));
    assert.equal(code, 1);
    assert.match(out, /stamps a `linux\/` folder that the platform claim does not name/);
  });

  // 🔴 M5 — the comment trap. The fixture's ci.yml deliberately keeps a comment
  // saying "flutter build web" while the real step is gone.
  test('FAILS when the CI build step is deleted but a comment still names it', () => {
    const { code, out } = run(tree({
      ci: goodCi.replace('run: flutter build web --pwa-strategy=none', 'run: echo nothing'),
    }));
    assert.equal(code, 1, 'the comment above the step still says "flutter build web"');
    assert.match(out, /never runs `flutter build web`/);
  });

  // 🔴 M3 — the declaration must not satisfy a check about the CALL.
  test('FAILS when the workspace CALL is gone but the function remains', () => {
    const { code, out } = run(tree({
      postGen: goodPostGen.replace("  _registerInWorkspace(context, id: 'x');", ''),
    }));
    assert.equal(code, 1, 'void _registerInWorkspace(...) is still declared');
    assert.match(out, /never adds the app to the root `workspace:` list/);
  });

  // ── 🔴 M5b/c/d — the three prose shapes the half-fix still accepted. Each was
  //    reproduced against the real tree first and the shipped guard printed
  //    `ok   every claimed platform is stamped and built in CI` for all three.
  test('FAILS when the phrase survives only as a TRAILING comment on the run line', () => {
    // The realistic edit: someone disables a slow build while debugging and
    // leaves a note saying what used to be there. `^\s*#` never sees it.
    const { code, out } = run(tree({
      ci: goodCi.replace(
        'run: flutter build web --pwa-strategy=none',
        'run: echo skip  # flutter build web disabled while debugging',
      ),
    }));
    assert.equal(code, 1, 'a trailing comment is prose, not a build');
    assert.match(out, /never runs `flutter build web`/);
  });

  test('FAILS when the phrase appears only inside a quoted string', () => {
    const { code, out } = run(tree({
      ci: goodCi.replace('run: flutter build web --pwa-strategy=none', 'run: echo "flutter build web"'),
    }));
    assert.equal(code, 1, 'echoing the words is not running the command');
    assert.match(out, /never runs `flutter build web`/);
  });

  test('FAILS when the phrase appears only in the step name', () => {
    const { code, out } = run(tree({
      ci: goodCi
        .replace('- name: A fresh stamp really builds for every platform it claims', '- name: flutter build web')
        .replace('run: flutter build web --pwa-strategy=none', 'run: echo skip'),
    }));
    assert.equal(code, 1, 'a step name is a label, not a command');
    assert.match(out, /never runs `flutter build web`/);
  });

  // ── the false-alarm side. Scoping the match to command position must not
  //    reject the legitimate shapes this repo's workflows actually use, or the
  //    fix trades a silent pass for a build nobody can green.
  test('passes when the build lives in a `|` block scalar', () => {
    const { code, out } = run(tree({
      ci: `
jobs:
  app_brick:
    steps:
      - name: A fresh stamp really builds for every platform it claims
        working-directory: apps/probe
        run: |
          echo building
          flutter build web --pwa-strategy=none
`,
    }));
    assert.equal(code, 0, out);
  });

  test('passes when the build is one link in an && chain', () => {
    const { code, out } = run(tree({
      ci: goodCi.replace(
        'run: flutter build web --pwa-strategy=none',
        'run: cd apps/probe && flutter build web --pwa-strategy=none',
      ),
    }));
    assert.equal(code, 0, out);
  });

  test('passes when a real build line also carries a trailing comment', () => {
    const { code, out } = run(tree({
      ci: goodCi.replace(
        'run: flutter build web --pwa-strategy=none',
        'run: flutter build web --pwa-strategy=none  # PWA off: [ADR 006]',
      ),
    }));
    assert.equal(code, 0, out);
  });

  // ── 🔴 M6 — THE DIRECTORY. Scoping the match to command position asked
  //    WHETHER the command exists and never WHICH APP it builds. PR #92 fixed
  //    prose-vs-command and added no anchor at all. Mutation-proven against the
  //    real ci.yml 2026-08-01: flipping this step's `working-directory` from the
  //    freshly stamped probe to `apps/subly` left the shipped guard printing
  //    `ok every claimed platform is stamped and built in CI`. "A fresh stamp
  //    really builds" was then being proven by building the hand-maintained
  //    legacy app that has compiled for a year.
  test('FAILS when the build runs in a DIFFERENT app than the one that was stamped', () => {
    const { code, out } = run(tree({
      ci: goodCi.replace('working-directory: apps/probe', 'working-directory: apps/subly'),
    }));
    assert.equal(code, 1, 'building apps/subly proves nothing about a fresh stamp');
    assert.match(out, /runs `flutter build web`, but not in `apps\/probe` — it runs in `apps\/subly`/);
  });

  test('FAILS when the build runs at the repo root with no anchor at all', () => {
    const { code, out } = run(tree({
      ci: goodCi.replace('        working-directory: apps/probe\n', ''),
    }));
    assert.equal(code, 1, 'an unanchored build is a build of whatever happens to be at the root');
    assert.match(out, /it runs in `<repo root>`/);
  });

  // The anchor is DERIVED, never typed: rename the probe in the vars file and
  // the required directory moves with it. This is the pair that proves it — the
  // same ci.yml passes or fails purely on what the vars file says.
  test('the anchor follows _probe_vars.json — a renamed probe moves the requirement', () => {
    const renamed = JSON.stringify({ app_id: 'smoke' });
    const stale = run(tree({ vars: renamed }));
    assert.equal(stale.code, 1, 'ci.yml still builds apps/probe while the stamp is now apps/smoke');
    assert.match(stale.out, /but not in `apps\/smoke`/);

    const moved = run(tree({
      vars: renamed,
      ci: goodCi.replace('working-directory: apps/probe', 'working-directory: apps/smoke'),
    }));
    assert.equal(moved.code, 0, moved.out);
  });

  test('FAILS COVERAGE LOST when the vars file yields no app_id to anchor to', () => {
    const { code, out } = run(tree({ vars: JSON.stringify({ display_name: 'Probe' }) }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /yields no `app_id`/);
  });

  // The false-alarm side of the anchor: a `cd` into the stamped app is the other
  // shape this repo's workflows use, and it must still count.
  test('passes when the step has no working-directory but the chain cds into the stamp', () => {
    const { code, out } = run(tree({
      ci: goodCi
        .replace('        working-directory: apps/probe\n', '')
        .replace(
          'run: flutter build web --pwa-strategy=none',
          'run: cd apps/probe && flutter build web --pwa-strategy=none',
        ),
    }));
    assert.equal(code, 0, out);
  });

  // ── 🔴 [pipeline S-4] THE WORKSPACE-RESOLUTION HALF ───────────────────────
  // Registering the app in the workspace was only half of S-4. The stamped
  // pubspec never said `resolution: workspace`, and Dart refuses the WHOLE
  // workspace — every package at once — when a listed member omits it:
  //
  //   apps\<id>\pubspec.yaml is included in the workspace from .\pubspec.yaml,
  //   but does not have `resolution: workspace`.
  //
  // Reproduced on the real tree with Dart 3.12.2 before any of this was written:
  // stamp the probe, `flutter pub get` at the repo ROOT -> exit 1 for the entire
  // repository, i.e. `melos run gate` dead from the day app #2 is committed. It
  // was invisible to CI by construction — the lane resolves inside `apps/probe`,
  // which never consults the root, and workspace_gate has no stamp — so ci.yml
  // now also resolves from the root. These five cases were each mutation-proven
  // against the real worktree (restore byte-verified) before being written here.
  test('passes and SAYS SO when the template and every member declare it', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /the stamped pubspec declares `resolution: workspace`/);
    assert.match(out, /all 2 workspace member\(s\) declare `resolution: workspace`/);
  });

  // 🔴 THE PROSE TRAP, and the reason the check is comment-stripped and
  // column-anchored. The fixture template keeps a COMMENT naming the very line
  // that was deleted, so `includes('resolution: workspace')` is still true here.
  // This file has already been fooled by a comment saying "flutter build web",
  // and its sibling by one saying there is no `r2_buckets`.
  test('FAILS when the template loses the line but a COMMENT still names it', () => {
    const mutated = goodBrickPubspec.replace(/^resolution: workspace\n/m, '');
    assert.ok(mutated.includes('resolution: workspace'), 'the trap must survive the mutation');
    const { code, out } = run(tree({ brickPubspec: mutated }));
    assert.equal(code, 1, out);
    assert.match(out, /does not declare `resolution: workspace`, but the stamp adds/);
  });

  // A `resolution:` nested under another key is a different setting; only the
  // top-level one is honoured, so an indented match must not count as a declaration.
  test('FAILS when the declaration is INDENTED under another key', () => {
    const { code, out } = run(tree({
      brickPubspec: goodBrickPubspec.replace(/^resolution: workspace$/m, 'flutter:\n  resolution: workspace'),
    }));
    assert.equal(code, 1, out);
    assert.match(out, /does not declare `resolution: workspace`/);
  });

  // ── the RECIPROCAL direction. Direction 1 alone passes if the stamper starts
  //    registering some other path; direction 2 alone passes for as long as
  //    nothing stamped is committed — which is the state that hid this for the
  //    whole life of the brick. Both, or it is not covered.
  test('FAILS when a member on the root workspace list does not declare it', () => {
    const { code, out } = run(tree({
      members: { 'packages/core': memberPubspec('nikatru_core'), 'apps/probe': memberPubspec('probe', false) },
    }));
    assert.equal(code, 1, out);
    assert.match(out, /`apps\/probe` is on the root `workspace:` list but apps\/probe\/pubspec\.yaml does not declare/);
    assert.match(out, /WHOLE repository/);
  });

  test('FAILS when the stamper registers a path that has no pubspec at all', () => {
    const { code, out } = run(tree({
      rootPubspec: goodRootPubspec.replace('  - apps/probe', '  - apps/probe\n  - apps/ghost'),
    }));
    assert.equal(code, 1, out);
    assert.match(out, /`apps\/ghost` is on the root `workspace:` list but has no apps\/ghost\/pubspec\.yaml/);
  });

  // ── and the two coverage failures: a scan that reaches nothing must be LOUD.
  test('FAILS COVERAGE LOST when the template pubspec cannot be read', () => {
    const { code, out } = run(tree({ brickPubspec: null }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /could not be read, so "the stamped app declares/);
  });

  test('FAILS COVERAGE LOST when the root workspace list yields no members', () => {
    const { code, out } = run(tree({
      rootPubspec: goodRootPubspec.replace('workspace:', 'workspace_disabled:'),
    }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /yielded ZERO `workspace:` members/);
  });

  // 🔴 M4 — scoped to the right function. `_appendToAppsJson` keeps the phrase.
  test('FAILS when registration loses idempotency, though a sibling keeps the phrase', () => {
    const { code, out } = run(tree({
      postGen: goodPostGen.replace(
        `    context.logger.info('pubspec.yaml already lists "\$id"; left unchanged.');`,
        `    context.logger.info('skipped');`,
      ),
    }));
    assert.equal(code, 1, 'apps.json\'s function still prints "already lists"');
    assert.match(out, /not idempotent/);
  });
});
