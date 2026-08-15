#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// release-manifest.mjs — the integrity record that turns a pile of build output
// into a RELEASE.
//
// [pipeline 9]R-4 "A release artifact outlives the run that made it.
//                 Every artifact intended for a user is published to a durable,
//                 addressable location with an integrity record, not left as a
//                 workflow-scoped artifact."
//
// ── WHAT WAS TRUE BEFORE THIS FILE, MEASURED ─────────────────────────────────
// `git tag` → 0. `git ls-remote --tags origin` → 0. No `gh release create`
// anywhere. FIVE jobs ending at `actions/upload-artifact` with
// `retention-days: 7`. No SHA256SUMS. So a release artifact outlived its run by
// seven days — the requirement's NEGATION, not a weak form of it.
//
// ── THE MECHANISM, AND WHY EACH THIRD OF IT IS LOAD-BEARING ──────────────────
// The acceptance names three properties and no single artefact carries all
// three, so the mechanism is three things wired together rather than a choice
// between them:
//
//   DURABLE      a GitHub Release. Not a preference: Private/requirements/
//                zero-cost-stack.md:46-47 is LOCKED — "Build SOURCE stays CI ->
//                signed artifact on GitHub Releases regardless" and "GitHub
//                Releases = artifact origin for every installer/APK". A Release
//                asset has no retention clock; `upload-artifact` has a 7-day one.
//   ADDRESSABLE  the git TAG. `build-platforms.yml` already triggers on
//                `push: tags: ['*-v*']`, so the tag is simultaneously what gates
//                the six-platform proof and what gives the release a stable URL
//                (/releases/tag/<app>-v<x>). Using the trigger that already
//                exists is what keeps this generic over apps ([9]R-1): the glob
//                names no app, and neither does anything below.
//   INTEGRITY    this file. SHA256SUMS, in the exact format `sha256sum -c`
//                consumes, so a downloader verifies with a tool they already
//                have and not with a script we wrote. Verified locally
//                2026-08-06 on GNU coreutils 8.32: `#`-prefixed lines are
//                skipped by `-c`, which is what lets the manifest carry the
//                gated commit SHA in its own header without breaking the check.
//
// ── A RELEASE YOU CANNOT VERIFY IS NOT A RELEASE ─────────────────────────────
// The manifest header names the app, the tag, the GATED COMMIT SHA and the run
// that produced it. That is [pipeline R-6]'s "published artifact → commit SHA"
// mapping, carried INSIDE the artifact set rather than only in an API record,
// because the API record is behind an account and the download is not.
//
// ⚠️ `--verify` IS NOT DECORATION AND IT IS THE HALF THAT CAN GO RED TODAY.
// It re-hashes every file and compares BOTH directions: a named file that is
// missing FAILS, and a file in the directory the manifest does not name FAILS.
// The second direction is the one that matters — "a checksum file naming every
// asset" is the acceptance's own wording, and a manifest that silently covers
// four of five assets is exactly the shape this repository keeps deleting.
// The release lane runs `--write` then `--verify` on EVERY run, tag or not, so
// the mechanism is exercised weekly instead of first exercised on release day.
//
// ── WHY IT LIVES IN tooling/ci AND NOT IN tooling/release ────────────────────
// It looks like a release script and it is not filed with them, deliberately.
// `assert-channel-register.mjs` enforces [10]D-10's orphan rule over that
// directory: EVERY `.mjs` directly in `tooling/release/` must be named by some
// channel row's `submission.script`, so that deleting a row's submission block
// cannot leave a script sitting there looking maintained and wired to nothing.
// This file is not a submission path — it is a step every release lane runs —
// so declaring it on a channel to satisfy that rule would put a lie in the
// register, and hiding it in a subdirectory would be evasion by filing. It
// belongs with `record-deployment.mjs`, which is the same shape (an action CI
// performs at publish time, not a guard) and already lives here.
// ⚠️ Do not "tidy" it back into tooling/release/: that fails the build, and the
// failure names D-10 rather than this file.
//
// ── WHAT THIS FILE DELIBERATELY DOES NOT DO ──────────────────────────────────
// It does not call `gh`, and it does not create anything outward-facing. The
// publish is a step in the workflow, in plain sight, because
// `assert-release-provenance.mjs` classifies a publish from the WORKFLOW TEXT —
// hiding `gh release create` inside a script would make a real publish invisible
// to the guard that demands it be gated and recorded. A helper that quietly
// disarms a guard is worse than no helper.
//
// ── 🔴 `--verify` PROVES CONSISTENCY, NOT COMPLETENESS — [pipeline G3] ───────
// Measured 2026-08-08 before this was written: stage a release holding the .apk
// and the .aab, leave the .msix out entirely, `--write` then `--verify`, and it
// prints `ok  2 asset(s) verified`. Every word of that is true. The manifest
// describes exactly the directory it was handed — and the directory is missing a
// whole platform. A release can therefore ship Windows-less with the integrity
// record, the guard and the aggregator all green, because each of them is asking
// whether the set is SELF-CONSISTENT and none is asking whether it is COMPLETE.
//
// `--expect-formats` is the completeness half, and the expected set is DERIVED so
// nothing here is a list somebody maintains (`expectedReleaseFormats` below):
// every installable extension a channel row with a declared LANE accepts, plus the
// declared extras, minus the bundle members that never travel loose. A format no
// lane emits (.ipa, .pkg, .snap, .AppImage today) is a channel that does not exist
// yet — demanding it would fail every release for work nobody has started, which
// is the "assertion that cannot pass" mirror of an assertion that cannot fail.
//
// ⚠️ IT IS OPT-IN AND THE DEFAULT IS UNCHANGED. The release job passes it in a
// LATER increment; until then `--verify` alone behaves exactly as it did, so
// nothing already green goes red on a workflow file this increment cannot edit.
// RECORDED FAILING CASE: stage the .apk and .aab and omit the .msix →
// `--verify --expect-formats` exits 1 naming `.msix`; plain `--verify` exits 0.
//
// Usage:
//   node tooling/ci/release-manifest.mjs --stage  <fromDir> --out <dir> --app <id> --tag <tag>
//   node tooling/ci/release-manifest.mjs --write  <dir> --app <id> --tag <tag> --sha <sha> [--run-url <url>]
//   node tooling/ci/release-manifest.mjs --verify <dir> [--expect-formats]
//   node tooling/ci/release-manifest.mjs --emit-assets <dir>
//   node tooling/ci/release-manifest.mjs --emit-environments <dir> --app <id>
//   [--repo-root <path>]   point the register lookup at another tree (tests)
//
// Exit 0 = the mode succeeded. 1 = it did not, loudly and with a reason.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync, copyFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// 🔴 `listDir`, NOT `readdirSync` — assert-walks-bounded.mjs forbids a raw
// directory listing anywhere in tooling/ci, because listDir is the one place
// that knows about nested checkouts. Caught by that guard on this file's first
// integration run; it is the same defect that had .claude/worktrees — eleven
// full copies of this repo — resolving citations into stale branches today.
import { listDir } from './tree-walk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(join(HERE, '..', '..'));  // tooling/ci -> repo root
const REGISTER_REL = 'tooling/channel-register.json';

/**
 * 🔴 THE ONE DECLARATION OF THE MANIFEST'S NAME.
 * `tooling/ci/assert-release-durable.mjs` reads it OUT OF THIS FILE rather than
 * carrying its own copy — the same single-declaration rule that makes
 * assert-release-provenance.mjs read `const GATE` out of assert-gate-passed.mjs.
 * A private copy in the guard would be the first thing to drift, and the drift
 * reports "clean".
 */
export const MANIFEST_NAME = 'SHA256SUMS';

/**
 * 🔴 THE EXTENSION SET IS DERIVED FROM THE CHANNEL REGISTER, NOT TYPED HERE.
 * `artifactFormats` on every row of tooling/channel-register.json is what the
 * factory's channels ACCEPT, it is maintained by [9]R-5, and it already grows
 * when a channel is added. Typing a list here would be the second declaration
 * and the first to go stale — a `.dmg` channel added to the register would
 * otherwise be invisible to both this script and the guard.
 *
 * ⚠️ `.apk` IS THE ONE ADDITION AND IT IS DECLARED, NOT SMUGGLED. No channel
 * ACCEPTS an .apk — Play takes the .aab and only the .aab — so no register row
 * can ever declare it. It is nonetheless the only Android artifact a human can
 * install on a handset, which is precisely "an artifact intended for a user".
 * A format with a reason beats a format with a row that would be a lie.
 */
export const EXTRA_INSTALLABLE = new Map([
  [
    '.apk',
    'no channel ACCEPTS an .apk (Play takes the .aab), so no register row can declare it — yet it is the only Android artifact a person can sideload onto a handset, which is exactly the "intended for a user" the requirement quantifies over.',
  ],
]);

/**
 * 🔴 INSTALLABLE IS NOT THE SAME AS SELF-CONTAINED, and the first local dry run
 * of the release lane (2026-08-06) is what found the difference. `--stage` lifted
 * `subly.exe` out of `build/windows/x64/runner/Release/` and produced TWO broken
 * things at once: a loose .exe with none of its DLLs or `data/` beside it, and an
 * archive of the bundle with its executable removed. Neither would run.
 *
 * So an extension listed here is still an INSTALLABLE for the guard — a lane that
 * uploads one and publishes nothing durable is still R-4's negation — but it is
 * never lifted out on its own. It travels inside its platform's archive, whole.
 * `.msix`, `.apk` and `.aab` are single self-contained packages and are lifted.
 *
 * ⚠️ THE CONSEQUENCE, RECORDED RATHER THAN HIDDEN: `originEnvironments` below
 * matches a channel against the LOOSE asset names, so the `windows-direct` row is
 * matched through its `.msix` and not through its `.exe`. An app that some day
 * emits a Windows bundle and no MSIX would match nothing — and `--emit-environments`
 * FAILS on an empty answer rather than recording nothing, so that lands as a red
 * release lane naming the gap, which is the fail-closed direction.
 */
export const BUNDLE_MEMBERS = new Map([
  [
    '.exe',
    'a Flutter Windows runner .exe is not a package: it loads flutter_windows.dll and the data/ directory from beside itself, so lifting it out of build/windows/x64/runner/Release produces an executable that cannot start AND an archive that no longer contains one. The register lists it on the windows-direct row as the shape of that BUNDLE, not as a standalone download.',
  ],
]);

/** Every installable file extension: the register's, plus the declared extras. */
export function installableExtensions(register) {
  const found = new Set();
  for (const c of register?.channels ?? []) {
    for (const f of c?.artifactFormats ?? []) {
      // A register format is either a file extension (".aab") or a shape name
      // ("static-bundle"). Only the first kind names a file.
      if (typeof f === 'string' && /^\.[A-Za-z0-9]+$/.test(f)) found.add(f);
    }
  }
  for (const e of EXTRA_INSTALLABLE.keys()) found.add(e);
  return found;
}

/**
 * The formats a staged release is EXPECTED to carry — the completeness half that
 * `--verify` cannot answer on its own.
 *
 * Derived on three axes, every one of them already maintained elsewhere:
 *   · `installableExtensions()` above is the SINGLE declaration of "what counts as
 *     an installable at all". This narrows that set; it never widens it, so a
 *     format that escapes the classifier cannot be demanded here either.
 *   · a channel row must have a declared `lane`. That is the register saying some
 *     job in this factory EMITS the format. Rows with `lane: null` (ios-appstore,
 *     macos-appstore, linux-snap, linux-appimage, windows-direct today) are
 *     channels that do not exist yet, and demanding their artifacts would make
 *     every release red for work that has not started.
 *   · minus `BUNDLE_MEMBERS`. A `.exe` never travels loose — `--stage` leaves it
 *     inside its platform archive on purpose — so it can never appear in the flat
 *     release directory and requiring it would be an assertion that cannot pass.
 * Plus the declared extras: the `.apk` has no channel row and cannot have one, and
 * it is the only Android artifact a person can install.
 *
 * ⚠️ IT CAN GO EMPTY, and that is a COVERAGE LOST at the call site rather than a
 * quiet pass — an empty expectation set makes "is this release complete" answer
 * yes for a directory holding nothing.
 */
export function expectedReleaseFormats(register) {
  const installable = installableExtensions(register);
  const laneBacked = new Set();
  for (const c of register?.channels ?? []) {
    const lane = c?.lane;
    if (!lane || typeof lane.workflow !== 'string' || typeof lane.job !== 'string') continue;
    for (const f of c?.artifactFormats ?? []) if (typeof f === 'string' && /^\.[A-Za-z0-9]+$/.test(f)) laneBacked.add(f);
  }
  for (const e of EXTRA_INSTALLABLE.keys()) laneBacked.add(e);
  const out = new Set();
  for (const e of laneBacked) if (installable.has(e) && !BUNDLE_MEMBERS.has(e)) out.add(e);
  return out;
}

/** Which expected formats this asset set does NOT carry. Sorted, so the failure
 *  message is stable and diffable across runs. */
export function missingReleaseFormats(expected, assetNames) {
  return [...expected]
    .filter((f) => !assetNames.some((n) => n.toLowerCase().endsWith(f.toLowerCase())))
    .sort();
}

/**
 * The deployment environments a GitHub Release is the ORIGIN for, given what it
 * actually carries. DERIVED from the register on both axes so nothing here is
 * a list somebody maintains:
 *
 *   · `kind: "direct"` rows only. A GitHub Release is a download origin, never a
 *     store submission — [ADR 015] §4 is explicit that Releases is "the artifact
 *     origin, not the download button". Recording a Play or App Store channel
 *     here would write a submission that never happened into [10]D-9's ledger,
 *     which record-deployment.mjs's own header calls worse than recording nothing
 *     (and it would refuse anyway: a store row demands --state and --listing-url).
 *   · and only when the release CARRIES one of that row's declared formats. A
 *     row whose artifact this release does not contain is not a channel this
 *     release served.
 */
export function originEnvironments(register, app, assetNames) {
  const out = [];
  for (const c of register?.channels ?? []) {
    if (c?.kind !== 'direct') continue;
    const tpl = c?.deploymentEnvironment;
    if (typeof tpl !== 'string' || !tpl.includes('{app}')) continue;
    const formats = (c?.artifactFormats ?? []).filter((f) => typeof f === 'string' && f.startsWith('.'));
    const carried = formats.some((f) => assetNames.some((n) => n.toLowerCase().endsWith(f.toLowerCase())));
    if (!carried) continue;
    out.push(tpl.replace('{app}', app));
  }
  return [...new Set(out)].sort();
}

/** `<sha256>  <name>`, the classic two-space (text-mode) form GNU sha256sum
 *  writes and reads. Comment lines are `#`-prefixed and `-c` skips them. */
export function renderManifest({ app, tag, sha, runUrl, entries }) {
  const lines = [
    `# NIKATRU release manifest — verify with:  sha256sum -c ${MANIFEST_NAME}`,
    `# app: ${app}`,
    `# tag: ${tag}`,
    `# commit: ${sha}`,
  ];
  if (runUrl) lines.push(`# built-by: ${runUrl}`);
  lines.push(`# assets: ${entries.length}`);
  for (const e of entries) lines.push(`${e.hash}  ${e.name}`);
  return `${lines.join('\n')}\n`;
}

/** The inverse. Comments are kept separately so `--verify` can echo the commit
 *  the manifest claims rather than making the caller re-parse it. */
export function parseManifest(text) {
  const entries = [];
  const meta = {};
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      const m = line.slice(1).match(/^\s*([a-z-]+):\s*(.+)$/);
      if (m) meta[m[1]] = m[2].trim();
      continue;
    }
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) entries.push({ hash: m[1].toLowerCase(), name: m[2] });
  }
  return { meta, entries };
}

const sha256 = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');

/** Regular files directly inside `dir`, excluding the manifest itself. The
 *  release directory is FLAT by construction — `--stage` flattens into it — so
 *  a subdirectory here is output nobody staged and is reported, not ignored. */
export function assetFiles(dir) {
  const names = [];
  const strays = [];
  for (const e of listDir(dir, { withFileTypes: true })) {
    if (e.name === MANIFEST_NAME) continue;
    if (e.isDirectory()) strays.push(e.name);
    else names.push(e.name);
  }
  return { names: names.sort(), strays: strays.sort() };
}

/** Both directions of "the manifest names every asset". */
export function verifyEntries(dir, manifestText) {
  const { meta, entries } = parseManifest(manifestText);
  const { names, strays } = assetFiles(dir);
  const problems = [];
  for (const s of strays) {
    problems.push(`${s}/ is a DIRECTORY in the release directory. The asset set is flat; a directory here is output nobody staged and nothing checksummed.`);
  }
  const named = new Set(entries.map((e) => e.name));
  for (const n of names) {
    if (!named.has(n)) {
      problems.push(`${n} is in the release directory and the manifest does NOT name it. "A checksum file naming EVERY asset" is the acceptance's own wording; an unlisted asset is an asset nobody can verify.`);
    }
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (!existsSync(abs)) {
      problems.push(`${e.name} is named by the manifest and is not in the release directory. The manifest describes a set that is not this one.`);
      continue;
    }
    const got = sha256(abs);
    if (got !== e.hash) problems.push(`${e.name} hashes to ${got}, the manifest says ${e.hash}.`);
  }
  if (entries.length === 0) {
    problems.push('the manifest names ZERO assets. An empty integrity record verifies an empty release and reports success — the exact shape this file exists to remove.');
  }
  return { meta, entries, problems };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
//
// ⚠️ RUN ONLY WHEN INVOKED DIRECTLY. The pure functions above are imported by
// tooling/ci/test/release-manifest.test.mjs and by nothing else; without the
// `import.meta.url` guard at the bottom, importing them would run the CLI with
// the TEST RUNNER's argv, fall through every mode, and `process.exit(1)` the
// whole suite. Same shape as assert-platform-proof-fresh.mjs and four other
// guards in this tree.
// ─────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) die(`--${name} was given with no value`);
  return v;
};
const has = (name) => argv.includes(`--${name}`);

function die(msg, ...more) {
  console.error(`✗ ${msg}`);
  for (const m of more) console.error(`  ${m}`);
  process.exit(1);
}

function loadRegister() {
  const root = resolve(flag('repo-root') ?? DEFAULT_ROOT);
  const abs = join(root, REGISTER_REL);
  if (!existsSync(abs)) {
    die(
      `COVERAGE LOST — ${REGISTER_REL} does not exist under ${root}.`,
      'The installable-format set and the origin-channel set are both DERIVED from it. Refusing to fall',
      'back on a list typed in this file — that copy is the one that drifts, and the drift prints ok.',
    );
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    die(`${REGISTER_REL} is not valid JSON (${e.message}).`);
  }
}

const requireDir = (d, what) => {
  if (d === null) die(`${what} needs a directory argument`);
  const abs = resolve(d);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) die(`${abs} is not a directory`);
  return abs;
};

const positionalAfter = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? null : v;
};

function main() {
  // ── --stage: lift every installable FILE out of the downloaded artifact tree ──
  // Recursive, because `actions/download-artifact` reproduces whatever directory
  // shape `upload-artifact` derived from its `path:` globs — a shape this script
  // must not have to predict.
  //
  // 🔴 IT MOVES, IT DOES NOT COPY, and that is a size decision with a correctness
  // edge. The lane archives whatever REMAINS under the download tree into one
  // .tar.gz per platform artifact, so that everything a run produced outlives it —
  // desktop bundles, the web build, symbol files. Copying would put the .apk both
  // inside its archive and beside it, doubling the largest asset in the release
  // for nothing. Moving first leaves each installer in exactly one place, which is
  // also the only arrangement where `--verify`'s "the manifest names every asset"
  // means what it says.
  if (has('stage')) {
    const from = requireDir(positionalAfter('stage'), '--stage');
    const out = resolve(flag('out') ?? die('--stage needs --out <dir>'));
    const app = flag('app') ?? die('--stage needs --app <id>');
    const tag = flag('tag') ?? die('--stage needs --tag <tag>');
    // Installable MINUS the declared bundle members — see BUNDLE_MEMBERS above.
    // Lifting a bundle's executable out breaks the executable and the bundle.
    const exts = new Set([...installableExtensions(loadRegister())].filter((x) => !BUNDLE_MEMBERS.has(x)));
    mkdirSync(out, { recursive: true });

    const staged = [];
    const walk = (dir) => {
      for (const e of listDir(dir, { withFileTypes: true })) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) { walk(abs); continue; }
        const ext = [...exts].find((x) => e.name.toLowerCase().endsWith(x.toLowerCase()));
        if (!ext) continue;
        // `<tag>-<basename>`, and NOT `<app>-<tag>-…`: the tag already carries
        // the app (`subly-v1.0.0`, from the `*-v*` trigger glob), so prefixing
        // the app again produced `subly-subly-v1.0.0-app-release.apk`. What the
        // name has to survive is a year in a downloads folder —
        // `subly-v1.0.0-app-release.apk` does; `app-release.apk`, which is what
        // every Flutter build emits for every app, does not.
        let name = `${tag}-${basename(e.name)}`;
        // upload-artifact names are per-app already, but two platform artifacts
        // can still carry the same basename. A silent overwrite would drop an
        // asset AND leave the manifest describing whichever survived, so a
        // collision is disambiguated rather than resolved by luck.
        let n = 2;
        while (existsSync(join(out, name))) name = `${tag}-${n++}-${basename(e.name)}`;
        // renameSync fails with EXDEV across devices — the runner's workspace and
        // a caller-chosen --out need not share one — so the copy+unlink fallback
        // is not defensive padding, it is the path a different mount takes.
        try {
          renameSync(abs, join(out, name));
        } catch {
          copyFileSync(abs, join(out, name));
          unlinkSync(abs);
        }
        staged.push(name);
      }
    };
    walk(from);

    if (staged.length === 0) {
      die(
        `COVERAGE LOST — no installable artifact found under ${from}.`,
        `Looked for: ${[...exts].sort().join(', ')} (derived from ${REGISTER_REL}).`,
        'A release with no installer is a release of nothing, and publishing one would satisfy every',
        'downstream check over an empty set.',
      );
    }
    for (const s of staged) console.log(`staged  ${s}`);
    console.log(`\nok  ${staged.length} installable artifact(s) staged into ${out}`);
    process.exit(0);
  }

  // ── --write: the integrity record ────────────────────────────────────────────
  if (has('write')) {
    const dir = requireDir(positionalAfter('write'), '--write');
    const app = flag('app') ?? die('--write needs --app <id>');
    const tag = flag('tag') ?? die('--write needs --tag <tag>');
    const sha = flag('sha') ?? die('--write needs --sha <gated commit sha>');
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      die(
        `--sha "${sha}" is not a commit SHA.`,
        'This field is the whole of "a release artifact identifies WHAT it is". A placeholder here produces',
        'a manifest that looks complete and maps the download to nothing.',
      );
    }
    const { names, strays } = assetFiles(dir);
    if (strays.length) {
      die(
        `${dir} contains director${strays.length === 1 ? 'y' : 'ies'}: ${strays.join(', ')}.`,
        'The release directory is flat. A directory here is output nobody staged, so it would be published',
        'unhashed or not published at all — and nothing would say which.',
      );
    }
    if (names.length === 0) {
      die(`${dir} holds no asset, so there is nothing to checksum.`, 'Refusing to write an integrity record over an empty set.');
    }
    const entries = names.map((n) => ({ name: n, hash: sha256(join(dir, n)) }));
    const text = renderManifest({ app, tag, sha, runUrl: flag('run-url'), entries });
    writeFileSync(join(dir, MANIFEST_NAME), text);
    console.log(text.trimEnd());
    console.log(`\nok  ${MANIFEST_NAME} written for ${entries.length} asset(s) at commit ${sha}`);
    process.exit(0);
  }

  // ── --verify: the proof, run on every lane execution ─────────────────────────
  if (has('verify')) {
    const dir = requireDir(positionalAfter('verify'), '--verify');
    const manifest = join(dir, MANIFEST_NAME);
    if (!existsSync(manifest)) {
      die(
        `${manifest} does not exist.`,
        'A release directory with no integrity record is exactly the state [9]R-4 forbids, and it would',
        'publish cleanly — nothing downstream re-derives a checksum.',
      );
    }
    const { meta, entries, problems } = verifyEntries(dir, readFileSync(manifest, 'utf8'));
    if (problems.length) {
      console.error(`✗ ${MANIFEST_NAME} does not describe ${dir}:`);
      for (const p of problems) console.error(`    ${p}`);
      process.exit(1);
    }
    console.log(`ok  ${entries.length} asset(s) verified against ${MANIFEST_NAME}; commit ${meta.commit ?? '(none recorded)'}, tag ${meta.tag ?? '(none recorded)'}`);

    // ── the completeness half, opt-in — see the header ────────────────────────
    if (has('expect-formats')) {
      const expected = expectedReleaseFormats(loadRegister());
      // 🔴 THE COVERAGE RAIL IS ON THE REGISTER'S CONTRIBUTION, NOT ON THE TOTAL.
      // The total can never be empty — `EXTRA_INSTALLABLE` always carries the
      // `.apk` — so a check for `expected.size === 0` would be an assertion with
      // no input that makes it fail, which this repository deletes rather than
      // keeps. What CAN go empty, and what would silently gut this mode, is the
      // REGISTER's half: if every row loses its `lane` (or the lane derivation
      // stops reading them), the expectation collapses to the hardcoded extras
      // and a release missing every store artifact passes on the strength of one
      // sideloadable .apk. Reachable, and reached by a test.
      const fromRegister = [...expected].filter((e) => !EXTRA_INSTALLABLE.has(e));
      if (fromRegister.length === 0) {
        die(
          `COVERAGE LOST — no channel row in ${REGISTER_REL} with a declared \`lane\` contributes an installable format.`,
          `The expectation collapsed to the declared extras alone (${[...expected].sort().join(', ') || 'nothing'}), so this mode would certify`,
          'a release that carries none of the artifacts the factory actually ships. Either every row lost its lane, or the',
          'lane derivation has stopped reading them — and both look identical from the outside.',
        );
      }
      const { names } = assetFiles(dir);
      const missing = missingReleaseFormats(expected, names);
      if (missing.length) {
        die(
          `${dir} is missing ${missing.length} expected release format(s): ${missing.join(', ')}.`,
          `Expected (derived from ${REGISTER_REL}): ${[...expected].sort().join(', ')}.`,
          `Present: ${names.join(', ') || '(nothing)'}.`,
          'The manifest above is CORRECT — it describes this directory exactly. That is the point: a release missing a',
          'whole platform verifies clean, because --verify asks whether the set is self-consistent and never whether it',
          'is complete. A lane that lost an artifact upstream would otherwise publish a platform short with every check green.',
        );
      }
      console.log(`ok  all ${expected.size} expected format(s) present: ${[...expected].sort().join(', ')}`);
    }
    process.exit(0);
  }

  // ── --emit-assets: the exact argument list the publish step passes to `gh` ───
  if (has('emit-assets')) {
    const dir = requireDir(positionalAfter('emit-assets'), '--emit-assets');
    const manifest = join(dir, MANIFEST_NAME);
    if (!existsSync(manifest)) die(`${manifest} does not exist — write the manifest before emitting the asset list.`);
    const { names } = assetFiles(dir);
    if (names.length === 0) die(`${dir} holds no asset.`, 'Emitting an empty list would create a release with no downloads and report success.');
    // The manifest FIRST: it is the one asset a verifier needs before any other.
    for (const n of [MANIFEST_NAME, ...names]) console.log(join(dir, n));
    process.exit(0);
  }

  // ── --emit-environments: which [10]D-9 records this release owes ─────────────
  if (has('emit-environments')) {
    const dir = requireDir(positionalAfter('emit-environments'), '--emit-environments');
    const app = flag('app') ?? die('--emit-environments needs --app <id>');
    const { names } = assetFiles(dir);
    const envs = originEnvironments(loadRegister(), app, names);
    if (envs.length === 0) {
      die(
        `no \`kind: "direct"\` channel in ${REGISTER_REL} declares a format this release carries.`,
        `The release holds: ${names.join(', ') || '(nothing)'}.`,
        'Publishing while recording nothing is [10]D-9\'s unrecorded deploy wearing a release badge —',
        'the artifacts would exist and nothing could say what shipped.',
      );
    }
    for (const e of envs) console.log(e);
    process.exit(0);
  }

  die(
    'no mode given.',
    'Usage: --stage <from> --out <dir> --app <id> --tag <tag> | --write <dir> --app <id> --tag <tag> --sha <sha>',
    '       | --verify <dir> | --emit-assets <dir> | --emit-environments <dir> --app <id>',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
