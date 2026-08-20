#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-artifact-shape.mjs — every artifact a lane claims to produce EXISTS,
// at its own named path, with bytes in it.
//
// 🔴 THE DEFECT THIS REMOVES IS A PROPERTY OF `actions/upload-artifact@v4`, not
// of anything anybody wrote here. `if-no-files-found: error` fails the step when
// the WHOLE path set matches nothing. So a `path:` block that unions a directory
// with a glob —
//
//     path: |
//       apps/<app>/build/windows/x64/runner/Release
//       apps/<app>/build/windows/msix/*.msix
//
// — is satisfied by the DIRECTORY alone. The msix packaging step can emit no
// file at all and the upload is green, the artifact downloads, and the only
// Microsoft Store package this factory builds is simply not in it. The same
// union hides a missing .aab behind a present .apk on the Android lane.
//
// Nothing in the tree caught it, and the reason is worth stating: every guard
// that reads a workflow reads its TEXT, and the text still names the .msix. The
// path list is a correct DECLARATION of intent — the failure is that no step
// ever compared the declaration to the disk. That comparison is this file, and
// it runs on the runner, after the build, before the upload, where the answer is
// a fact rather than a promise.
//
// ── WHAT IS DERIVED AND WHAT IS DECLARED ─────────────────────────────────────
// DERIVED — the set of installable file extensions, from
// tooling/channel-register.json, through `installableExtensions()` in
// tooling/ci/release-manifest.mjs. Imported, never re-typed: a private copy is
// the first thing to drift, and the drift prints ok. That helper is also what
// `--stage` uses to decide what a release is made of, so this guard and the
// release lane are answering "what is an artifact" out of one declaration.
//
// DECLARED — where Flutter PUTS each of them. That is toolchain layout, it is
// not in the register and it is not derivable from it, so it is written down
// once, here, in LANE_OUTPUTS. What stops that table going stale is that it is
// checked against the register in BOTH directions on every run:
//   · every extension this table expects must be in the register-derived
//     installable set (otherwise the table expects an artifact the factory does
//     not consider an artifact);
//   · every file-extension format declared by a register row whose `lane.job` is
//     this platform must have an entry in this table (otherwise a channel's
//     artifact is one this guard would never look for, and its absence would be
//     exactly as invisible as before).
// Either direction failing is COVERAGE LOST, not a pass.
//
// ── WHAT IT DELIBERATELY DOES NOT ASSERT ─────────────────────────────────────
// iOS. `flutter build ios --release --no-codesign` produces an unsigned .app and
// no .ipa — the `ios-appstore` row's `.ipa` has no lane at all. Writing an
// assertion over an artifact that does not exist is how a guard acquires a check
// that can never fail; the gap is PRINTED on every run of the apple lane
// instead, so it stays visible until a lane produces something.
//
// 🔴 THE .app IS NOW RETAINED (2026-08-20). build-platforms.yml's `apple` job
// uploads build/ios/iphoneos as `<app>-ios-<posture>`, so the clause that used
// to sit here — "and no step uploads it" — stopped being true the moment that
// step landed, and is removed rather than left to age. What is still absent is
// the `.ipa`, and any assertion over what IS retained; the second is the next
// change, not this one.
//
// ── NEGATIVE TEST ────────────────────────────────────────────────────────────
// tooling/ci/test/artifact-shape.test.mjs. The load-bearing case is the exact
// input that is GREEN today: a windows fixture with `Release/` populated and the
// .msix deleted. The upload accepts it; this guard fails naming the msix path.
//
// Usage:
//   node tooling/ci/assert-artifact-shape.mjs --app <id> --platform <lane job>
//   [--repo-root <path>]   point the register + build tree at another root (tests)
//
// Exit 0 = every expected artifact is present and non-empty. 1 = it is not, or
// the scan can no longer tell.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listDir } from './tree-walk.mjs';
import { installableExtensions, BUNDLE_MEMBERS } from './release-manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(join(HERE, '..', '..'));  // tooling/ci -> repo root
const REGISTER_REL = 'tooling/channel-register.json';
const APPS_DIR = 'apps';

/**
 * 🔴 FLUTTER'S OUTPUT LAYOUT, KEYED BY THE LANE JOB THAT PRODUCES IT.
 *
 * The key is a JOB NAME and not a workflow file on purpose: a register row binds
 * a channel to `{workflow, job}`, and this guard is invoked with that job's name,
 * so a second workflow growing a lane job called `windows` is covered by being
 * called rather than by this file learning about it. (It is also what keeps this
 * guard out of assert-release-lane-generic.mjs's lane-bound set — it names no
 * workflow, so it is not bound to one.)
 *
 * Entry shapes, and each exists because the disk has that shape:
 *   { ext, dir }              ≥1 file under `dir` ending in `ext`, non-zero.
 *   { tree }                  a directory holding ≥1 regular file, recursively.
 *   { tree, bundleMember }    …and ≥1 non-zero file with that extension inside.
 *   { treeGlob, suffix }      ≥1 SUBDIRECTORY of `treeGlob` named `*suffix`,
 *                             itself holding ≥1 regular file. A macOS .app is a
 *                             directory; `statSync().size` on it says nothing.
 *
 * `uploaded: false` marks output this lane BUILDS and does not upload. It is
 * still asserted — a `flutter build` that silently produced nothing is the same
 * defect whether or not the result is packaged — and it is labelled so nobody
 * reads its presence here as a claim that it ships.
 */
const LANE_OUTPUTS = new Map([
  [
    'linux_web_android',
    {
      what: 'the Linux desktop bundle, the web bundle, and both Android artifacts',
      expect: [
        {
          ext: '.aab',
          dir: 'build/app/outputs/bundle/release',
          why: 'the Google Play artifact — the format the android-play row accepts, and the one the union upload could hide behind the .apk',
        },
        {
          ext: '.apk',
          dir: 'build/app/outputs/flutter-apk',
          why: 'the only Android artifact a person can sideload onto a handset (no channel ACCEPTS an .apk, which is why release-manifest.mjs declares it as an extra rather than a register row declaring it)',
        },
        {
          tree: 'build/linux/x64/release/bundle',
          why: 'the Linux desktop bundle — a directory, so `if-no-files-found` is satisfied by it even when everything beside it is missing',
        },
        {
          tree: 'build/web',
          uploaded: false,
          why: 'the web bundle. This lane BUILDS it as part of the six-platform proof and uploads nothing from it; the served web channel is a different lane entirely',
        },
      ],
      gaps: [],
    },
  ],
  [
    'windows',
    {
      what: 'the Windows runner bundle and the Microsoft Store package',
      expect: [
        {
          ext: '.msix',
          dir: 'build/windows/msix',
          why: 'the Microsoft Store package. THE recorded failing case: with Release/ present, an absent .msix is accepted by the upload and by every text-reading guard',
        },
        {
          tree: 'build/windows/x64/runner/Release',
          bundleMember: '.exe',
          why: 'the Windows runner bundle. The .exe is asserted INSIDE it rather than lifted out: it loads flutter_windows.dll and data/ from beside itself, which is why release-manifest.mjs declares it a bundle member and never stages it alone',
        },
      ],
      gaps: [],
    },
  ],
  [
    'apple',
    {
      what: 'the macOS application bundle',
      expect: [
        {
          treeGlob: 'build/macos/Build/Products/Release',
          suffix: '.app',
          why: 'the macOS application bundle — what this lane actually produces and uploads today',
        },
      ],
      gaps: [
        'iOS — `flutter build ios --release --no-codesign` produces an UNSIGNED build/ios/iphoneos/*.app and no .ipa. As of 2026-08-20 that .app IS uploaded and retained for 90 days as `<app>-ios-<posture>`, and THIS GUARD STILL ASSERTS NOTHING ABOUT IT. That is now a gap in this table rather than a fact about the lane: until today an assertion here would have ranged over an artifact that did not exist, which could never fail and would have inflated coverage instead of adding it. There is something to look at now. The `ios-appstore` row still accepts ".ipa", which nothing produces, and still has no lane. This line stops being printed when the assertion is written — not by anybody editing it away.',
      ],
    },
  ],
]);

// ── argv ─────────────────────────────────────────────────────────────────────
// `indexOf` returns -1 when absent and -1 + 1 === 0, which silently selects
// argv[0]. That exact off-by-one shipped in assert-gate-passed.mjs and blocked
// two production deploys with the value plainly on the command line.
const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? null : v;
}

function die(msg, ...more) {
  console.error(`✗ ${msg}`);
  for (const m of more) console.error(`  ${m}`);
  process.exit(1);
}

function coverageLost(first, ...more) {
  console.error(`✗ COVERAGE LOST — ${first}`);
  for (const m of more) console.error(`    ${m}`);
  console.error('  The scan is broken, or the lane changed shape. Either way this is not "clean".');
  process.exit(1);
}

const app = flag('app');
const platform = flag('platform');
const root = resolve(flag('repo-root') ?? DEFAULT_ROOT);

if (!app) die('--app <id> is required.', 'Without it this guard has no build tree to look at and would pass by looking at nothing.');
if (!platform) die('--platform <lane job> is required.', `Known: ${[...LANE_OUTPUTS.keys()].join(', ')}.`);

// ── the register: the DERIVED half ───────────────────────────────────────────
const registerAbs = join(root, REGISTER_REL);
if (!existsSync(registerAbs)) {
  coverageLost(
    `${REGISTER_REL} does not exist under ${root}.`,
    'The installable-extension set is derived from it. Falling back on a list typed in this file is',
    'exactly the second declaration that goes stale while reporting ok.',
  );
}
let register = null;
try {
  register = JSON.parse(readFileSync(registerAbs, 'utf8'));
} catch (e) {
  coverageLost(
    `${REGISTER_REL} is not valid JSON (${e.message}).`,
    'Every extension this guard looks for is checked against it; unreadable means the check below would',
    'range over nothing and pass.',
  );
}
const universe = installableExtensions(register);
if (universe.size === 0) {
  coverageLost(
    `${REGISTER_REL} yielded ZERO installable extensions.`,
    'A register whose rows declare no file format is not a factory that ships nothing — it is a derivation',
    'that has stopped reading, and every expectation below would be "covered" by an empty set.',
  );
}

// ── the lane ─────────────────────────────────────────────────────────────────
const lane = LANE_OUTPUTS.get(platform);
if (!lane) {
  coverageLost(
    `no output layout is declared for lane job "${platform}" (known: ${[...LANE_OUTPUTS.keys()].join(', ')}).`,
    'A renamed or new build job would otherwise be asserted over an empty expectation list, which passes.',
    'Add its entry to LANE_OUTPUTS in the same change that adds the job.',
  );
}
// A lane whose expectation list is empty would print ok having looked at
// nothing — checked BEFORE the loop, because "the loop found no problems" is
// exactly what an empty list produces.
if (!Array.isArray(lane.expect) || lane.expect.length === 0) {
  coverageLost(
    `lane "${platform}" declares an EMPTY expectation list.`,
    'It would pass by having nothing to check, which is the exact failure this guard was written against.',
  );
}

const appDir = join(root, APPS_DIR, app);
if (!existsSync(appDir)) {
  coverageLost(
    `${APPS_DIR}/${app} does not exist under ${root}.`,
    'Every path below is relative to it, so a wrong --app resolves to nothing and would report every',
    'artifact missing — or, with a lane that expects none, report clean.',
  );
}

// ── REQUIRED COVERAGE, both directions ───────────────────────────────────────
const expectedExts = new Set();
for (const e of lane.expect) {
  if (e.ext) expectedExts.add(e.ext);
  if (e.bundleMember) expectedExts.add(e.bundleMember);
}

// (a) nothing is expected that the factory does not consider an artifact.
for (const ext of expectedExts) {
  if (!universe.has(ext)) {
    coverageLost(
      `this guard expects a "${ext}" for lane "${platform}" and ${REGISTER_REL} derives no such installable format.`,
      `The register-derived set is: ${[...universe].sort().join(', ')}.`,
      'The table and the register have diverged; one of them is describing a factory that no longer exists.',
    );
  }
}

// (b) every bundle member is a member DECLARED as one, not asserted as one here.
for (const e of lane.expect) {
  if (e.bundleMember && !BUNDLE_MEMBERS.has(e.bundleMember)) {
    coverageLost(
      `"${e.bundleMember}" is asserted as a bundle member of ${e.tree} and release-manifest.mjs does not declare it one.`,
      `BUNDLE_MEMBERS declares: ${[...BUNDLE_MEMBERS.keys()].join(', ') || 'nothing'}.`,
      'That map is what stops the release lane lifting a file out of the bundle it needs to sit in; a second,',
      'private notion of "bundle member" here would drift from it silently.',
    );
  }
}

// (c) every format a channel binds to THIS job is a format this guard looks for.
const rows = Array.isArray(register?.channels) ? register.channels : [];
const boundRows = rows.filter((c) => c?.lane?.job === platform);
for (const row of boundRows) {
  const formats = (row.artifactFormats ?? []).filter((f) => typeof f === 'string' && /^\.[A-Za-z0-9]+$/.test(f));
  for (const f of formats) {
    if (!expectedExts.has(f)) {
      coverageLost(
        `channel "${row.id}" declares lane job "${platform}" and accepts "${f}", and this guard has no path for it.`,
        `It looks for: ${[...expectedExts].sort().join(', ') || 'no file extension at all'}.`,
        'The channel\'s own artifact would be the one thing an upload could drop without this guard noticing —',
        'which is the defect it exists for, aimed at itself.',
      );
    }
  }
}

// ── the assertions ───────────────────────────────────────────────────────────
const problems = [];
const found = [];
const notes = [];

/** Regular files under `abs`, recursively, as { rel, size }. */
function filesUnder(abs, rel = '') {
  const out = [];
  for (const e of listDir(abs, { withFileTypes: true })) {
    const child = join(abs, e.name);
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...filesUnder(child, childRel));
    else if (e.isFile()) out.push({ rel: childRel, size: statSync(child).size });
  }
  return out;
}

for (const e of lane.expect) {
  // ── a file, named by its own extension, at its own path ──────────────────
  if (e.ext) {
    const relDir = `${APPS_DIR}/${app}/${e.dir}`;
    const abs = join(appDir, e.dir);
    if (!existsSync(abs)) {
      problems.push(`${relDir}/*${e.ext} — the directory does not exist, so no ${e.ext} was produced. ${e.why}.`);
      continue;
    }
    const hits = listDir(abs, { withFileTypes: true })
      .filter((x) => x.isFile() && x.name.toLowerCase().endsWith(e.ext.toLowerCase()))
      .map((x) => ({ name: x.name, size: statSync(join(abs, x.name)).size }));
    if (hits.length === 0) {
      problems.push(
        `${relDir}/*${e.ext} — NO ${e.ext} at this path. ${e.why}. ` +
          'An upload whose `path:` unions this glob with a directory accepts exactly this state: ' +
          '`if-no-files-found: error` fires only when the WHOLE set is empty.',
      );
      continue;
    }
    const empty = hits.filter((h) => h.size === 0);
    if (empty.length) {
      problems.push(
        `${relDir}/${empty.map((h) => h.name).join(', ')} — ZERO BYTES. A file that exists satisfies both the ` +
          'glob and `if-no-files-found`, and installs nowhere.',
      );
      continue;
    }
    for (const h of hits) found.push(`${relDir}/${h.name} (${h.size} bytes)`);
    continue;
  }

  // ── a directory bundle: exists, and has something in it ──────────────────
  if (e.tree) {
    const relDir = `${APPS_DIR}/${app}/${e.tree}`;
    const abs = join(appDir, e.tree);
    if (!existsSync(abs)) {
      problems.push(`${relDir}/ — the directory does not exist. ${e.why}.`);
      continue;
    }
    const files = filesUnder(abs);
    if (files.length === 0) {
      problems.push(
        `${relDir}/ — the directory exists and is EMPTY. ${e.why}. ` +
          'An empty directory is what makes a union `path:` pass while carrying nothing.',
      );
      continue;
    }
    if (e.bundleMember) {
      const members = files.filter((f) => f.rel.toLowerCase().endsWith(e.bundleMember.toLowerCase()));
      if (members.length === 0) {
        problems.push(
          `${relDir}/ — holds ${files.length} file(s) and NO "${e.bundleMember}". ${e.why}. ` +
            'A bundle without its executable is a directory the upload is perfectly happy with.',
        );
        continue;
      }
      if (members.every((m) => m.size === 0)) {
        problems.push(`${relDir}/ — every "${e.bundleMember}" in the bundle is ZERO BYTES (${members.map((m) => m.rel).join(', ')}).`);
        continue;
      }
    }
    const label = e.uploaded === false ? ' [built here, not uploaded]' : '';
    found.push(`${relDir}/ (${files.length} file(s))${label}`);
    continue;
  }

  // ── a directory that IS the artifact (a macOS .app) ──────────────────────
  if (e.treeGlob) {
    const before = problems.length;
    const relDir = `${APPS_DIR}/${app}/${e.treeGlob}`;
    const abs = join(appDir, e.treeGlob);
    if (!existsSync(abs)) {
      problems.push(`${relDir}/*${e.suffix} — the containing directory does not exist. ${e.why}.`);
      continue;
    }
    const bundles = listDir(abs, { withFileTypes: true }).filter(
      (x) => x.isDirectory() && x.name.toLowerCase().endsWith(e.suffix.toLowerCase()),
    );
    if (bundles.length === 0) {
      problems.push(`${relDir}/*${e.suffix} — no "${e.suffix}" bundle at this path. ${e.why}.`);
      continue;
    }
    let ok = false;
    for (const b of bundles) {
      const files = filesUnder(join(abs, b.name));
      if (files.length === 0) {
        problems.push(`${relDir}/${b.name}/ — the ${e.suffix} bundle exists and is EMPTY. A .app is a directory; its size on disk says nothing about whether it can launch.`);
        continue;
      }
      found.push(`${relDir}/${b.name}/ (${files.length} file(s))`);
      ok = true;
    }
    if (!ok && problems.length === before) problems.push(`${relDir}/*${e.suffix} — nothing usable found.`);
    continue;
  }

  coverageLost(
    `LANE_OUTPUTS entry for "${platform}" declares none of ext / tree / treeGlob: ${JSON.stringify(e)}.`,
    'An entry this loop cannot read is an expectation that quietly asserts nothing.',
  );
}

if (boundRows.length === 0) {
  notes.push(
    `no channel in ${REGISTER_REL} names lane job "${platform}", so direction (c) had nothing to compare. ` +
      'What is asserted below is what the lane PRODUCES, not what a channel accepts — stated rather than implied.',
  );
}
for (const g of lane.gaps) notes.push(`GAP — ${g}`);

// ── verdict ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ ${app} / ${platform} — ${problems.length} expected artifact(s) missing or empty:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  Each path above is asserted ON ITS OWN. `actions/upload-artifact` cannot do that: its');
  console.error('  `if-no-files-found: error` fails only when the ENTIRE path set matches nothing, so one');
  console.error('  present directory is enough to carry a whole upload that is missing its installer.');
  process.exit(1);
}

for (const f of found) console.log(`ok  ${f}`);
for (const n of notes) console.log(`⬜ ${n}`);
console.log(
  `\nassert-artifact-shape: ok — ${app} / ${platform}: ${lane.expect.length} expectation(s) satisfied by ` +
    `${found.length} artifact path(s) (${lane.what}); ${expectedExts.size} extension(s) checked against the ` +
    `${universe.size} derived from ${REGISTER_REL}; ${boundRows.length} channel row(s) bound to this lane job`,
);
