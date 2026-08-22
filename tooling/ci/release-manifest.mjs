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
 * emits a Windows bundle and no MSIX would MATCH NOTHING — and `--emit-environments`
 * FAILS when no direct row matches at all rather than recording nothing, so that
 * lands as a red release lane naming the gap, which is the fail-closed direction.
 * ⚠️ That is a different empty from the one `signingPosture` produces below: a row
 * that matched and was withheld for posture exits 0 with the reason on stderr.
 * The CLI distinguishes them explicitly and says why.
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
 * 🔴 SIGNING POSTURE, READ OUT OF THE REGISTER AND NOT OUT OF THE ENVIRONMENT.
 *
 * THE DEFECT THIS ANSWERS, MEASURED 2026-08-21 RATHER THAN REASONED ABOUT.
 * Two fake files staged into a scratch directory (`…-app-release.aab` and
 * `…-subly.msix`, one line of text each) and then the release job's literal
 * command:
 *     node tooling/ci/release-manifest.mjs --emit-environments <dir> --app subly
 *       → EXIT 0, stdout `subly-windows-direct`
 * `build-platforms.yml:1313-1315` feeds that stdout, unfiltered, into
 * `record-deployment.mjs` — so the first tag writes a [10]D-9 deployment record
 * for `windows-direct` while that row's `signing.codeSigningCertificate` still
 * reads its own `notYetConfiguredSentinel`, "CODE-SIGNING-CERT-NOT-PURCHASED".
 * A deployment record naming a channel whose signing identity DOES NOT EXIST is
 * the unrecorded-deploy hole pointing the other way: not a shipment nobody
 * wrote down, but a shipment written down that nothing could have signed.
 *
 * LATENT, NOT LIVE, AND SAY SO PLAINLY. `git tag` → 0 in this repository on
 * 2026-08-21, and the step carries `if: github.ref_type == 'tag'`, so it has
 * never executed. It is live at the command line (above) and it arms itself on
 * the first tag — which is exactly why the recorded rule was "no first tag
 * before E1 + E11".
 *
 * ⚠️ WHY NOT `WINDOWS_SIGNING_POSTURE`, WHICH IS WHAT THE NAME SUGGESTS.
 * `git grep WINDOWS_SIGNING_POSTURE` over every tracked file returns FOUR hits
 * OUTSIDE THIS COMMENT — the command also matches the two lines you are reading,
 * so re-running it prints six. Measured 2026-08-21:
 * `.github/workflows/build-platforms.yml:794` (a comment
 * recording that nothing consumes it) and three inside `windows-signing.mjs`
 * (`:12`, `:116`, and `:134`, its declaration). Zero readers outside the script
 * that publishes it — and it is set on the `windows` JOB, while this runs in
 * `release`, a different job with a different environment. A guard reading it
 * here would read an always-empty string and pass forever, which is the
 * assertion-that-cannot-fail this repository deletes on sight. So the posture is
 * derived from the register, where the fact is actually declared.
 * (Re-measured 2026-08-22: unchanged — still 4 outside this comment, 6 in total,
 * at the same three files and the same six lines.)
 *
 * THE VOCABULARY IS THE REGISTER'S OWN, NOT A SECOND ONE INVENTED HERE.
 * `assert-channel-register.mjs`'s `6d. SIGNING-MATERIAL PINS` section (grep that
 * string — "limb 6d", which this comment said until 2026-08-22, does NOT occur
 * in that file and never did; the word "limb" was this file's) already treats "a `signing.*` object
 * carrying a `notYetConfiguredSentinel`" as the register's way of saying an
 * identity is declared but does not exist yet, and already FAILS a block with
 * some fields real and some still on the sentinel. This reads the same shape.
 *
 * 🔴 READ THE FOUR ENTRIES BELOW AS A CASCADE IN CODE ORDER, NOT AS FOUR
 * INDEPENDENT DESCRIPTIONS — the function returns at the FIRST match, and taking
 * any one entry on its own gives the wrong answer for real rows. Measured
 * 2026-08-22: `web`, `windows-store` and `linux-snap` each carry two `signing.*`
 * objects (`restoreDrill`, `seam`) and NEITHER has a `notYetConfiguredSentinel`
 * key, so each satisfies 'undeclared' as worded — and each classifies 'none',
 * because 'none' is tested first. The order is: sentinel → pinned → none →
 * undeclared.
 *
 *   'sentinel'   — some value field still equals the block's own sentinel. The
 *                  identity does not exist. Deliberately ANY field rather than
 *                  ALL: the half-configured case is the one that ships under the
 *                  wrong name, and withholding a ledger row is the cheap
 *                  direction to be wrong in.
 *   'pinned'     — a pin block exists and no field is on the sentinel.
 *   'none'       — `keyKind: "none"`, the register's word for "this channel
 *                  signs nothing of ours". Nothing to withhold.
 *   'undeclared' — a row with no `signing` block at all, or one whose every
 *                  `signing.*` object LACKS a `notYetConfiguredSentinel` key.
 *                  Unreadable posture is withheld, not assumed good.
 *                  🔴 READ THAT SECOND CLAUSE LITERALLY — IT IS NOT "PINS
 *                  NOTHING", WHICH IS WHAT THIS LINE SAID UNTIL 2026-08-21 AND
 *                  WHICH THE REGISTER MEASURABLY CONTRADICTS. `android-play`
 *                  classifies 'undeclared' today while carrying the only fully
 *                  configured pin in the whole REGISTER — a real `sha256`
 *                  fingerprint, `alias "nikatru-upload"`, `asOf "2026-08-04"` —
 *                  because its `signing.uploadCertificate` block has no
 *                  `notYetConfiguredSentinel` key. The loop below counts
 *                  `pinBlocks` only for blocks that HAVE that key, so a block
 *                  without one is invisible to it whatever it holds.
 *                  ⚠️ THEREFORE, TO WHOEVER FILLS A PIN IN: KEEP THE
 *                  `notYetConfiguredSentinel` KEY. Overwrite the value fields
 *                  and leave the sentinel line where it is. Deleting it — the
 *                  natural tidy-up, and the way android-play is written — flips
 *                  the row from 'pinned' to 'undeclared' and this gate withholds
 *                  the very ledger row you just earned, with a stderr line that
 *                  reads as a complaint about the register rather than "you
 *                  deleted a key the gate needs". Nothing else makes the key
 *                  durable: assert-channel-register.mjs skips any block without
 *                  one (its `6d. SIGNING-MATERIAL PINS` section) and requires only that ONE block
 *                  register-wide carries one. The recorded mitigation is that
 *                  the suite goes RED in that state rather than passing quietly
 *                  — see the REAL REGISTER case in release-durable.test.mjs.
 *
 * ⬜ NEITHER 'none' NOR 'undeclared' IS REACHED BY A DIRECT ROW TODAY, and that
 * is measured rather than assumed. Classifying all 8 rows of the real register
 * on 2026-08-21: `web`, `windows-store` and `linux-snap` → 'none'; `android-play`,
 * `ios-appstore` and `macos-appstore` → 'undeclared'; and the only two
 * `kind: "direct"` rows, `windows-direct` and `linux-appimage`, are BOTH
 * 'sentinel' — CODE-SIGNING-CERT-NOT-PURCHASED at `sha256`/`subject` and
 * APPIMAGE-SIGNING-KEY-NOT-GENERATED at `publicKeyBase64`. So the other three
 * states are live on rows this function never reaches (it takes direct rows
 * only), and both untaken branches are reached by fixtures in
 * release-durable.test.mjs — neither is an assertion with no input.
 * (Re-run 2026-08-22 against the register as it stands: identical, 8 rows, same
 * six classifications.)
 */
export function signingPosture(channel) {
  // ⚠️ ALL FOUR CLAUSES ON THE NEXT TWO LINES ARE FALSIFIABLE, AND THREE OF THEM
  // WERE NOT UNTIL 2026-08-22. An `if (false)` sweep of EVERY condition in this
  // function — not only the ones the signing-posture change added — left
  // `channel?.`, `signing === null` and `Array.isArray(signing)` all surviving
  // with release-durable.test.mjs at EXIT 0 / 0 fail. None is dead, and the array
  // one fails OPEN, which is the direction that costs a false ledger row:
  //   · `channel?.`             — without it `signingPosture(undefined)` throws.
  //   · `signing === null`      — `typeof null === 'object'`, so without it a
  //                               `"signing": null` row (legal JSON) reaches
  //                               `Object.entries(null)` and throws.
  //   · `Array.isArray(signing)`— `typeof [] === 'object'` too, so without it the
  //                               entries are the array's INDICES, a pin-shaped
  //                               element counts as a pin block, and the row
  //                               classifies 'pinned' and IS RECORDED.
  //   · `typeof signing !== 'object'` was already red (the no-`signing`-key row).
  // All four are now pinned — see "an UNREADABLE `signing` value is UNDECLARED"
  // in release-durable.test.mjs.
  const signing = channel?.signing;
  if (signing === null || typeof signing !== 'object' || Array.isArray(signing)) {
    return { state: 'undeclared', detail: 'the row declares no readable `signing` block' };
  }
  const unfilled = [];
  let pinBlocks = 0;
  for (const [name, block] of Object.entries(signing)) {
    // 🔴 `block === null` AND NOTHING ELSE. This line read
    //     if (block === null || typeof block !== 'object' || Array.isArray(block))
    // until 2026-08-22, and the last two clauses were DELETED rather than kept,
    // under the same rule the `typeof v === 'string'` note below records:
    //   · `block === null` is LIVE and held — `null.notYetConfiguredSentinel`
    //     throws, and a null block is a real register shape (`signing.identity`
    //     is null on the rows that sign nothing). Neutering it turns this suite
    //     red at "signingPosture reads the register's own sentinel vocabulary".
    //   · `typeof block !== 'object'` and `Array.isArray(block)` were UNFALSIFIABLE
    //     BY CONSTRUCTION, not merely untested. The register is `JSON.parse`d, so a
    //     block is null, a string, a number, a boolean, an array or an object; for
    //     every one of those that is not an object, `block.notYetConfiguredSentinel`
    //     is `undefined` and the sentinel guard below `continue`s anyway. Proved by
    //     equivalence rather than by argument: the old predicate and this one were
    //     run side by side over every one of those shapes crossed with four
    //     `keyKind` values, each round-tripped through `JSON.parse(JSON.stringify())`
    //     — 100 cases, ZERO differing answers. An assertion nothing can falsify is
    //     worse than none here, because it makes this loop LOOK guarded twice over.
    if (block === null) continue;
    const sentinel = block.notYetConfiguredSentinel;
    // 🔴 A USABLE SENTINEL IS WHAT MAKES THIS OBJECT A PIN BLOCK AT ALL, and the
    // `continue` is load-bearing in the dangerous direction: without it every
    // object under `signing` is counted as a pin, nothing can equal an absent
    // sentinel, and a row with a tidied-away sentinel key classifies 'pinned' and
    // IS RECORDED. Measured 2026-08-21: this line survived an `if (false)` sweep
    // with the suite still EXIT 0, so the case was written — see "a `signing.*`
    // object with no USABLE sentinel is not a pin block" in release-durable.test.mjs.
    // (Appended 2026-08-22, not a rewrite of the line above: the 2026-08-21 sweep
    // covered this `if` AS A WHOLE and missed its sub-clauses. Re-swept clause by
    // clause today, BOTH now bite — neutering `typeof sentinel !== 'string'` alone
    // reddens this suite, and so does neutering `sentinel.trim() === ''` alone,
    // both at "a `signing.*` object with no USABLE sentinel is not a pin block".)
    if (typeof sentinel !== 'string' || sentinel.trim() === '') continue;
    pinBlocks++;
    // `notYetConfiguredSentinel` is excluded because it IS the sentinel — it is
    // the declaration of the placeholder, never a field standing in for a value.
    // Nothing else is excluded: the bookkeeping fields (_why, asOf, source…)
    // cannot equal the sentinel without saying the same thing the value fields do.
    // ⚠️ NO `typeof v === 'string'` HERE, AND ITS ABSENCE IS DELIBERATE. It stood
    // in this predicate until 2026-08-21 and was DELETED after an `if (false)`
    // sweep of every condition in this file measured it unfalsifiable: the whole
    // suite stayed EXIT 0 with it neutered, because `sentinel` is a non-empty
    // STRING by the guard above and `v === sentinel` is strict, so a non-string
    // `v` can never match. A test could not be written for it, which by this
    // repository's rule makes it dead code to remove rather than safety to keep.
    // ⚠️ THAT 2026-08-21 SWEEP WAS INCOMPLETE AND THIS PARAGRAPH OVERSTATED IT —
    // corrected, not overwritten. It said "every condition in this file", but it
    // mutated the two compound `if`s of this function as WHOLES; a clause-by-clause
    // re-sweep on 2026-08-22 found FOUR sub-clauses still surviving. Two were
    // unfalsifiable and went the way this paragraph describes (see the block guard
    // above); two were live-but-uncovered and were pinned with tests instead.
    const onSentinel = Object.entries(block)
      .filter(([k, v]) => k !== 'notYetConfiguredSentinel' && v === sentinel)
      .map(([k]) => k);
    if (onSentinel.length) unfilled.push(`signing.${name} still reads ${JSON.stringify(sentinel)} at ${onSentinel.map((k) => `\`${k}\``).join(', ')}`);
  }
  if (unfilled.length) return { state: 'sentinel', detail: unfilled.join('; ') };
  if (pinBlocks > 0) return { state: 'pinned', detail: `${pinBlocks} pinned signing-material block(s), none on a sentinel` };
  if (signing.keyKind === 'none') return { state: 'none', detail: 'keyKind "none" — this channel signs nothing of ours' };
  return { state: 'undeclared', detail: `keyKind ${JSON.stringify(signing.keyKind ?? null)} and no signing-material block carrying a \`notYetConfiguredSentinel\`` };
}

/** The two postures a release may record a deployment under. */
const RECORDABLE_POSTURES = new Set(['pinned', 'none']);

/**
 * The deployment environments a GitHub Release is the ORIGIN for, given what it
 * actually carries. DERIVED from the register on all three axes so nothing here
 * is a list somebody maintains:
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
 *   · and only when `signingPosture` above says the row's identity EXISTS.
 *
 * 🔴 IT RETURNS BOTH HALVES, AND THE OMISSIONS ARE THE POINT. A row dropped for
 * posture is returned in `omitted` with the register's own words for why, and the
 * CLI prints every one of them — on STDERR, because the release job consumes
 * this command's STDOUT as a word list (`for environment in $(…)`) and a reason
 * on stdout would become an argument to `record-deployment.mjs`. Silently
 * returning a shorter list is the failure this whole file is written against:
 * the release would go out, the ledger would be short, and nothing would say so.
 *
 * ── WHAT THIS DOES NOT CATCH, STATED SO NOBODY READS IT AS MORE ──────────────
 *   · IT READS THE REGISTER'S DECLARATION, NEVER THE ARTIFACT'S BYTES. The day
 *     the certificate is bought and the pin filled in, an UNSIGNED .msix sitting
 *     in `dist` still emits `<app>-windows-direct`. `assert-artifact-signed-msix.mjs`
 *     is the reader of signatures and it runs in the `windows` job, not here.
 *   · IT IGNORES `served`. windows-direct is `served: false` today and would be
 *     recorded the day its pin is filled, `served` untouched.
 *   · IT IGNORES `restoreDrill`. All 8 rows carry `signing.restoreDrill.date:
 *     null` — the field sits UNDER `signing`, not on the row, and re-measuring it
 *     at the row level returns 0 of 8 rather than 8 of 8, which is why the path
 *     is written out here (measured 2026-08-21). A configured identity nobody has ever restored is
 *     recorded without complaint. That is the owner-gated drill, a different
 *     question from whether the identity exists.
 *   · IT WITHHOLDS A LEDGER ROW, IT DOES NOT WITHHOLD A RELEASE. `--verify`,
 *     `--expect-formats` and `gh release create` are untouched: the .msix is
 *     still published and still downloadable. Only the [10]D-9 record is held
 *     back, which is the half that would otherwise be false.
 */
export function originEnvironments(register, app, assetNames) {
  const out = [];
  const omitted = [];
  // ⚠️ EVERY GUARD IN THIS LOOP IS FALSIFIABLE, AND SIX OF THEM WERE NOT UNTIL
  // 2026-08-22. The 2026-08-21 sweep this file's comments cite stopped at the
  // conditions the signing-posture change ADDED; a clause-by-clause re-sweep
  // measured exactly these six SURVIVING `if (false)` with release-durable.test.mjs
  // at EXIT 0 and 0 fail — the `?.` in `c?.kind`, `typeof tpl !== 'string'`,
  // `!tpl.includes('{app}')`, `c.artifactFormats ?? []`, `c.id ?? '(unnamed)'`,
  // and the `new Set(out)` dedupe. (The rest of the loop was already held, the two
  // `.toLowerCase()` calls included — the MIXED fixture's `.AppImage` asset reddens
  // both. Measured, not assumed: they were mutated in the same sweep and went red.)
  // Not one of the six is dead — each changes the answer on a register a human can
  // write: a `null` row, a row with no `artifactFormats`, an id-less row, a
  // `deploymentEnvironment` that forgot `{app}` (which emits ONE environment name
  // shared by every app), two rows naming one environment (which records the same
  // [10]D-9 row TWICE). All six are pinned rather than deleted — see "a MALFORMED
  // row is skipped, never fatal, and never silently renamed" and "the extension
  // match is case-insensitive BOTH ways" in release-durable.test.mjs.
  // 🔴 TWO `?.`s WERE DELETED IN THE SAME PASS, on lines 3 and 5 of this loop
  // (`c?.deploymentEnvironment`, `c?.artifactFormats`): once the line above has
  // `continue`d on a nullish `c`, nothing downstream can observe them, so no test
  // could be written and they only made the loop look guarded twice over.
  for (const c of register?.channels ?? []) {
    if (c?.kind !== 'direct') continue;
    const tpl = c.deploymentEnvironment;
    if (typeof tpl !== 'string' || !tpl.includes('{app}')) continue;
    const formats = (c.artifactFormats ?? []).filter((f) => typeof f === 'string' && f.startsWith('.'));
    const carried = formats.some((f) => assetNames.some((n) => n.toLowerCase().endsWith(f.toLowerCase())));
    if (!carried) continue;
    const environment = tpl.replace('{app}', app);
    const posture = signingPosture(c);
    if (!RECORDABLE_POSTURES.has(posture.state)) {
      omitted.push({ id: c.id ?? '(unnamed)', environment, state: posture.state, detail: posture.detail });
      continue;
    }
    out.push(environment);
  }
  return { environments: [...new Set(out)].sort(), omitted };
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
// tooling/ci/test/release-durable.test.mjs and by nothing else — measured
// 2026-08-21, `git grep -l "release-manifest.mjs'" -- tooling/ci/test` returns
// that one file. (This line named `release-manifest.test.mjs` until today; no
// such file exists in `tooling/ci/test/`, and the three that begin `release-`
// are release-durable, release-lane-generic and release-provenance. Corrected
// rather than left, because the sentence is the reason the guard below exists
// and a reader checking it would find nothing at the path it names.) Without the
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
    const { environments, omitted } = originEnvironments(loadRegister(), app, names);
    // 🔴 STDERR, NOT STDOUT. The release job reads this command as a word list
    // (`for environment in $(node … --emit-environments …)`), so a reason printed
    // on stdout becomes an argument to record-deployment.mjs.
    for (const o of omitted) {
      console.error(`omitted  ${o.environment} — channel "${o.id}" signing posture is ${o.state.toUpperCase()}: ${o.detail}.`);
    }
    if (environments.length === 0 && omitted.length === 0) {
      die(
        `no \`kind: "direct"\` channel in ${REGISTER_REL} declares a format this release carries.`,
        `The release holds: ${names.join(', ') || '(nothing)'}.`,
        'Publishing while recording nothing is [10]D-9\'s unrecorded deploy wearing a release badge —',
        'the artifacts would exist and nothing could say what shipped.',
      );
    }
    for (const e of environments) console.log(e);
    // ⚠️ EXIT 0 WITH AN EMPTY LIST IS CORRECT HERE AND IS NOT THE `die` ABOVE.
    // The two empties are different facts and the difference decides the lane:
    // NOTHING MATCHED is a gap nobody declared, and it fails closed. EVERYTHING
    // MATCHED WAS OMITTED is a state the register declares out loud, on a row the
    // owner has not yet bought a certificate for — the same [pipeline C-6] shape
    // assert-channel-register.mjs uses when it PRINTS a deferred pin instead of
    // failing. Exiting 1 here would fail the release job AFTER `gh release create`
    // has already published, leaving a real release under a red run.
    if (environments.length === 0) {
      console.error(`\nno [10]D-9 record for this release: all ${omitted.length} matching direct channel(s) were omitted above. The assets are published; nothing is recorded as deployed through an identity that does not exist.`);
    }
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
