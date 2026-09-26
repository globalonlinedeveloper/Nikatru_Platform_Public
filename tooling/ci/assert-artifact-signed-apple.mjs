#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-artifact-signed-apple.mjs — read the signature out of the BUILT APPLE
// BUNDLE and refuse to call an unsigned or ad-hoc-signed build a release.
//
// The Apple half of the pair `assert-artifact-signed.mjs` forms for Play. Same
// law, different tool: that one runs `keytool -printcert -jarfile` over an .aab,
// this one runs `codesign -dv --verbose=4` over an .app.
//
// 🔴 WHY IT IS A SIBLING FILE AND NOT A BRANCH IN THE ANDROID ONE.
// The temptation was one guard with `--platform`. Everything about the two is
// different — the tool, the posture variable, the artifact shape, what "wrongly
// signed" even means (a debug KEY on Android; an ad-hoc signature or a
// DEVELOPMENT certificate here) — so a shared file would have been two programs
// sharing an argv parser, and the shared half would have been the argv parser,
// which is the part neither of them needed help with. What IS shared is the
// idea, and the idea is written down in both headers.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
//   1. the bundle carries a signature at all. `codesign` reports an unsigned
//      object as "code object is not signed at all" and EXITS NON-ZERO, but the
//      verdict here is the parsed output, never the status — the Android guard
//      shipped after discovering `keytool` exits 0 on an unsigned archive, and a
//      status-based verdict is the same bet either way.
//   2. the signature is not AD-HOC. `codesign -s -` produces a real, valid,
//      locally-verifiable signature with no identity behind it — `Signature=adhoc`,
//      `TeamIdentifier=not set`. It is what Xcode falls back to, it satisfies
//      "is it signed?", and App Store Connect rejects it. This is the Apple
//      equivalent of the Android debug key, and it is the reason a guard that
//      merely asked "is there a signature" would have passed the defect.
//   3. the leaf certificate is a DISTRIBUTION identity. `Apple Development:` and
//      `Developer ID Application:` are both perfectly valid signatures that the
//      App Store refuses — the first is for devices on your team, the second for
//      direct distribution outside the store. Accepting "some Apple certificate"
//      would accept both.
//   4. the team is the team the register pins.
//      ⏱ CORRECTED 2026-09-24: the team pin is APPLE_TEAM_ID (limb 5); a register teamId is an optional cross-check that must equal it.
//   5. the real signature agrees with the posture tooling/ci/apple-signing.mjs
//      exported. That step arranges a credential; this one reads the outcome. A
//      step that arranges a thing and then reports its own success is the "green
//      means ran" failure with extra stages.
//
// ── THE TWO ARCHIVES (⏱ 2026-09-25, O-APPLE-PROVER-SKIPS-THE-PKG) ────────────
//   `codesign` reads a CODE OBJECT, and an `.ipa` (a ZIP) or a `.pkg` (an
//   installer archive) is not one. Until today both were refused by name and
//   the release-signed .ipa and .pkg were graded only by inline shell in
//   build-platforms.yml's PROVE step. The guard now opens them itself, through
//   the same `run(cmd, args)` seam as every other tool call, and runs the .app
//   limbs on the bundle inside. Each moved shell check is a named limb; all but
//   info-plist run only on a release-signed run, where an identity was arranged:
//     · ipa-payload     `unzip` the .ipa; it must hold a Payload/*.app.
//     · pkg-signature   `pkgutil --check-signature`: an Apple-issued certificate,
//                       and APPLE_INSTALLER_IDENTITY.
//     · pkg-payload     `pkgutil --expand-full`; the .pkg must wrap a .app.
//     · identity        the wrapped .app's Authority chain names
//                       APPLE_DIST_IDENTITY.
//     · verify-strict   `codesign --verify --strict` on the wrapped .app.
//     · profile         the embedded profile's application-identifier is
//                       `<APPLE_TEAM_ID>.<bundleIdOf(apple-provisioning.json, slug)>`.
//                       Decoded by `security cms -D` (the envelope gate), then
//                       read in-process by parseMobileProvision (the comparison).
//                       ⚠️ A profile is issued against one App ID, so a bundle
//                       id change fails this limb until the Apple account
//                       issues a profile for the new id and the secret is
//                       replaced. That is account-side work, not a repo edit.
//     · entitlements    every key the app's entitlements file declares is in the
//                       signature; on iOS it must be in the profile too, and on
//                       macOS every key outside com.apple.security.* must be.
//                       A key the profile lacks is a distribution rejection; a
//                       key the signature lost answers "not entitled" on device
//                       ([ADR 082] §5: Declared Age Range then throws and the
//                       age gate reads no signal).
//     · info-plist      assert-built-info-plist.mjs on the wrapped .app.
//   The archive's channel row is the one whose signing.seam.artifactGlob the
//   path matches, and the app slug is that glob's first `*`.
//   ⚠️ The .pkg layout `pkgutil --expand-full` writes (`Payload/*.app`, or
//   `<component>.pkg/Payload/*.app`) is SYNTHETIC in the tests
//   (test/fixtures/apple-pkg-synthetic/): no .pkg has been expanded by this
//   guard on a real host yet.
//
// ── ⚠️ WHAT THIS GUARD CANNOT SEE, stated so green is not mistaken for safe ──
//   · A `.zip` or a `.dmg` is still refused by name, never reported as unsigned
//     — "the tool cannot read this" and "this file is not signed" must never be
//     the same outcome.
//   · On a bare .app it does not run `codesign --verify`. That answers "do the
//     sealed resources still hash correctly", which is a different question from
//     "who signed this". The archive limbs run it on the wrapped bundle, where
//     the inline PROVE shell ran it before; its failure is its own named problem.
//   · It says nothing about whether App Store Connect will ACCEPT the build. It
//     answers one question — which identity signed this — and leaves
//     entitlements, version strings and review policy to the guards that own them.
//   · 🔴 IT CANNOT RUN OFF macOS AND SAYS SO RATHER THAN PASSING. `codesign`
//     ships with Xcode. On any other platform this is COVERAGE LOST, never a
//     pass: "the tool was missing" and "the artifact is fine" must not be the
//     same exit code. The DECISIONS in this file are pure functions for exactly
//     that reason — they are unit-tested on Windows and Linux against captured
//     `codesign -dvv` output, which is the only part of the job that does not
//     need a Mac.
//     ⏱ CORRECTED 2026-09-24: those fixtures were HAND-WRITTEN, never captured; the captured ones are test/fixtures/apple-run-35741818599/.
//
// Usage:
//   node tooling/ci/assert-artifact-signed-apple.mjs [--repo-root <path>] <.app | .ipa | .pkg>…
//   node tooling/ci/assert-artifact-signed-apple.mjs [--repo-root <path>] --static
//     (reads build-platforms.yml and the register only — no env, no codesign,
//     any platform; the three limbs are described above `staticProblems`)
// Env in: APPLE_SIGNING_POSTURE (required — exported by
//         tooling/ci/apple-signing.mjs; the guard refuses to run without it)
//         APPLE_TEAM_ID (required when the posture is release-signed — THE team
//         pin, exported by the same step; the guard refuses to run without it)
//         APPLE_DIST_IDENTITY, APPLE_INSTALLER_IDENTITY (the archive limbs
//         `identity` and `pkg-signature`; exported by the same step, and the
//         archive limbs refuse a release-signed run without them)
//         RUNNER_TEMP (where an archive is opened; the OS temp dir otherwise)
// Exit 0 = the bundle is signed by the identity this lane intended. 1 = it is not.
//      2 = COVERAGE LOST — the question could not be asked.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, isAbsolute, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { whatToolReturned } from './tool-output.mjs';
import { parseMobileProvision } from './apple-signing.mjs';
import { REGISTER as PROVISIONING_REGISTER, bundleIdOf } from './apple-provisioning.mjs';
import { parseWorkflow, workflowSteps } from './workflow-scan.mjs';
import { listDir } from './tree-walk.mjs';

export const REGISTER = 'tooling/channel-register.json';
export const CHANNEL_IDS = ['ios-appstore', 'macos-appstore'];
export const POSTURE_ENV = 'APPLE_SIGNING_POSTURE';
export const RELEASE_SIGNED = 'release-signed';
export const UNSIGNED_PROOF = 'unsigned-build-proof';

/** Leaf-certificate common-name prefixes that mean "this may be submitted to an
 *  App Store". `Apple Distribution:` is what Xcode 11+ issues for both iOS and
 *  macOS; `3rd Party Mac Developer Application:` is the older Mac App Store
 *  form and is still issued to accounts created before the unification. */
export const DISTRIBUTION_PREFIXES = Object.freeze([
  'Apple Distribution:',
  '3rd Party Mac Developer Application:',
]);

/** Valid Apple signatures that the App Store REFUSES, each with the reason it
 *  exists. Naming them is what turns a confusing upload rejection into a
 *  sentence in a build log. */
export const WRONG_KIND = Object.freeze([
  ['Apple Development:', 'a DEVELOPMENT certificate — it signs builds for devices registered to the team, and the App Store rejects it'],
  ['iPhone Developer:', 'a legacy DEVELOPMENT certificate; same rejection'],
  ['Mac Developer:', 'a legacy DEVELOPMENT certificate; same rejection'],
  ['Developer ID Application:', 'a DIRECT-DISTRIBUTION certificate — it is for apps shipped outside the store and notarized, and the App Store rejects it'],
]);

/** Bundle suffixes `codesign` cannot read and this guard does not open. Refused
 *  by name; see the header. ⏱ 2026-09-25: `.ipa` and `.pkg` left this list for
 *  ARCHIVE_SUFFIXES. */
export const UNREADABLE_SUFFIXES = Object.freeze(['.zip', '.dmg']);

/** The archives this guard opens, and the .app limbs then run on what is inside. */
export const ARCHIVE_SUFFIXES = Object.freeze(['.ipa', '.pkg']);

/** Pure so it is testable off macOS, where the loop that calls it cannot run.
 *  Returns the offending suffix or null. */
export function unreadableSuffix(rel) {
  const lower = String(rel).toLowerCase();
  return UNREADABLE_SUFFIXES.find((s) => lower.endsWith(s)) ?? null;
}

/** `.ipa`, `.pkg`, or null for anything this guard hands straight to codesign. */
export function archiveKind(rel) {
  const lower = String(rel).toLowerCase();
  return ARCHIVE_SUFFIXES.find((s) => lower.endsWith(s)) ?? null;
}

/** The Apple row whose `signing.seam.artifactGlob` a repo-relative archive path
 *  matches, and the app slug that glob's first `*` stands for. Null when no row's
 *  glob matches — an archive at a path the register does not declare. */
export function archiveRow(rows, rel) {
  const path = String(rel).replace(/\\/g, '/');
  for (const row of rows) {
    const glob = row?.signing?.seam?.artifactGlob;
    if (typeof glob !== 'string') continue;
    const re = new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('([^/]+)')}$`);
    const m = re.exec(path);
    if (m) return { row, slug: m[1] };
  }
  return null;
}

/** The top-level keys of an XML plist's root dict — an entitlements file, or
 *  `codesign -d --entitlements - --xml` output. Nested dicts are skipped. */
export function plistTopKeys(xml) {
  const text = String(xml ?? '');
  const open = text.indexOf('<dict>');
  if (open === -1) return [];
  const keys = [];
  let depth = 0;
  const re = /<(\/?)(dict|key)>([^<]*)/g;
  re.lastIndex = open;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[2] === 'dict') depth += m[1] ? -1 : 1;
    else if (!m[1] && depth === 1) keys.push(m[3].trim());
    if (depth === 0) break;
  }
  return keys;
}

/** The profile's Entitlements dict, as its top-level keys. */
export function profileEntitlementKeys(xml) {
  const text = String(xml ?? '');
  const at = text.search(/<key>Entitlements<\/key>\s*<dict>/);
  if (at === -1) return [];
  return plistTopKeys(text.slice(text.indexOf('<dict>', at)));
}

/** The moved PROVE limbs' decisions, pure. `kind` is '.ipa' or '.pkg'. */
export function entitlementProblems({ kind, rel, declared, signed, profiled }) {
  const problems = [];
  for (const key of declared) {
    if (!signed.includes(key)) problems.push(`entitlements: ${rel}'s wrapped app lacks declared entitlement ${key} in its signature.`);
    // A profile carries only the entitlements that need provisioning. On macOS the
    // App Sandbox keys (com.apple.security.*) are signed in and never provisioned.
    const provisioned = kind === '.ipa' || !key.startsWith('com.apple.security.');
    if (provisioned && !profiled.includes(key)) problems.push(`entitlements: ${rel}'s embedded profile lacks declared entitlement ${key}.`);
  }
  return problems;
}

/** `pkgutil --check-signature` text → the S4 limb's problems. */
export function pkgSignatureProblems({ rel, text, installerIdentity }) {
  const problems = [];
  if (!/signed by a developer certificate issued by Apple/.test(text)) {
    problems.push(`pkg-signature: pkgutil does not report ${rel} as signed by a developer certificate issued by Apple.`);
  }
  if (installerIdentity && !text.includes(installerIdentity)) {
    problems.push(`pkg-signature: ${rel} is not signed by "${installerIdentity}" (APPLE_INSTALLER_IDENTITY).`);
  }
  return problems;
}

/** The profile limb, pure: `profile` is parseMobileProvision's result. */
export function profileProblems({ rel, profile, teamId, bundleId }) {
  if (profile === null) return [`profile: ${rel}'s embedded profile has no plist this guard can read.`];
  const want = teamId ? `${teamId}.${bundleId}` : null;
  if (want !== null && profile.appIdentifier !== want) {
    return [`profile: ${rel}'s embedded profile is for "${profile.appIdentifier}", not "${want}" (APPLE_TEAM_ID and the app's bundleId in tooling/apple-provisioning.json).`];
  }
  if (want === null && profile.bundleId !== bundleId) {
    return [`profile: ${rel}'s embedded profile is for "${profile.bundleId}", not the row's "${bundleId}".`];
  }
  return [];
}

// ═════════════════════════════════════════════════════════════════════════════
// PURE DECISION LOGIC — the whole verdict, testable without a Mac.
// ═════════════════════════════════════════════════════════════════════════════

/** The exact invocation: `codesign -dv --verbose=4`, which is what the PROVE steps
 *  in build-platforms.yml run over the .ipa payload and over the .app the .pkg
 *  wraps — so the output captured from those steps (test/fixtures/
 *  apple-run-35741818599/) is the output this guard reads. The verbosity is what
 *  makes the `Authority=` chain appear; `-dv` at the default level prints the team
 *  identifier and no authorities, and limb 3 would then range over an empty list.
 *  ⏱ 2026-09-24: this was `-dvv` until today, a level no captured output was taken at. */
export function codesignArgv(path) {
  return ['codesign', '-dv', '--verbose=4', path];
}

/**
 * Parse `codesign -dv --verbose=4` output.
 *
 * 🔬 THE OUTPUT GOES TO STDERR, NOT STDOUT. That is not a quirk to work around
 * quietly — a caller that reads only stdout gets an empty string, which parses
 * to "no signature" and would fail every correctly signed build. Both streams
 * are concatenated by the caller and the reason is recorded here.
 *
 * The format is `Key=Value` per line, with `Authority=` repeated once per
 * certificate in the chain, leaf first. Parsed into structure and compared on
 * fields — never grepped: the string "Apple Distribution" appears in this file's
 * own prose and in its tests, and a text match over the wrong buffer would read
 * either as a signature.
 */
export function parseCodesign(text) {
  const raw = String(text ?? '');
  const lines = raw.split(/\r?\n/);
  const out = {
    signed: true,
    adhoc: false,
    identifier: null,
    format: null,
    flags: null,
    teamId: null,
    authorities: [],
    signatureField: null,
  };

  if (/code object is not signed at all/i.test(raw)) {
    out.signed = false;
    return out;
  }

  // 🔬 THE CodeDirectory LINE IS NOT `Key=Value`. The real line is
  // `CodeDirectory v=20400 size=20035 flags=0x0(none) hashes=615+7 location=embedded`,
  // so a split at the first `=` reads its key as `CodeDirectory v`, and the
  // `key === 'CodeDirectory'` branch that stood in the loop below until 2026-09-24
  // never fired on captured output (row O-APPLE-GUARDS-PARSE-HAND-WRITTEN-OUTPUT).
  // The flags are read off the whole line instead; every other key keeps the split.
  const cd = raw.match(/^CodeDirectory v=\S+ .*\bflags=(\S+)/m);
  if (cd) out.flags = cd[1];

  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'Authority') out.authorities.push(value);
    else if (key === 'Identifier') out.identifier = value;
    else if (key === 'Format') out.format = value;
    else if (key === 'Signature') out.signatureField = value;
    else if (key === 'TeamIdentifier') out.teamId = value === 'not set' ? null : value;
  }

  // Three independent tells, because any one of them can be absent depending on
  // the codesign version and the object: the explicit `Signature=adhoc` field,
  // the `adhoc` bit in the CodeDirectory flags, and an empty authority chain
  // with a signature present. An ad-hoc signature has NO certificate, so the
  // third is the structural one and the other two are corroboration.
  if (out.signatureField === 'adhoc') out.adhoc = true;
  if (out.flags !== null && /adhoc/i.test(out.flags)) out.adhoc = true;
  if (out.authorities.length === 0 && out.teamId === null && out.identifier !== null) out.adhoc = true;

  // A parse that found NOTHING is not "an unsigned object" — it is output this
  // parser does not understand, and it must not be reported as a verdict.
  if (out.identifier === null && out.authorities.length === 0 && out.teamId === null && out.flags === null) {
    return { ...out, unparseable: true };
  }
  return out;
}

/** The leaf certificate, or null. `codesign` prints the chain leaf-first. */
export function leafAuthority(parsed) {
  return parsed.authorities.length > 0 ? parsed.authorities[0] : null;
}

/**
 * The verdict for ONE bundle. Pure: everything it needs is an argument.
 *
 * Returns `{ problems, prints, evaluated, teamChecked }`. `evaluated` is false
 * when nothing could be read at all, which the caller must count — a pass
 * produced by reading nothing is this repository's single most repeated failure.
 */
export function verdict({ artifact, posture, parsed, pin = null, arrangedTeamId = null } = {}) {
  const problems = [];
  const prints = [];

  if (parsed.unparseable) {
    return {
      problems: [
        `${artifact} — \`codesign -dv --verbose=4\` produced output this guard cannot parse. It found no Identifier, no ` +
          'Authority, no TeamIdentifier and no CodeDirectory flags. That is not an unsigned bundle; it is a ' +
          'reading this guard does not understand, and reporting a verdict from it would certify whatever it found.',
      ],
      prints,
      evaluated: false,
      teamChecked: false,
    };
  }

  const leaf = leafAuthority(parsed);

  // ── limb 1 + 2: is there an identity behind this signature at all ─────────
  if (!parsed.signed || parsed.adhoc) {
    const how = !parsed.signed ? 'is NOT SIGNED AT ALL' : 'carries an AD-HOC signature (no identity, no team)';
    if (posture === RELEASE_SIGNED) {
      problems.push(
        `${artifact} ${how} and ${POSTURE_ENV} says "${RELEASE_SIGNED}". The signing secrets were supplied and ` +
          'xcodebuild did not use them — the silent fallback this guard exists for. An ad-hoc signature is a real, ' +
          'locally-valid signature with nobody behind it, so every check that asks only "is it signed" passes it, ' +
          'and App Store Connect refuses it.',
      );
      return { problems, prints, evaluated: true, teamChecked: false };
    }
    // The legal, LABELLED unsigned-for-release outcome. Loud on purpose.
    prints.push(
      `${artifact} ${how} and this lane declared "${UNSIGNED_PROOF}", so that is the expected outcome. ` +
        '🔴 IT CANNOT BE UPLOADED TO APP STORE CONNECT. It proves the Apple modules build, and nothing about a ' +
        'signing identity.',
    );
    return { problems, prints, evaluated: true, teamChecked: false };
  }

  // ── a real identity signed it — was the lane expecting one? ───────────────
  if (posture === UNSIGNED_PROOF) {
    problems.push(
      `${artifact} is signed by ${JSON.stringify(leaf)} and ${POSTURE_ENV} says "${UNSIGNED_PROOF}". An identity ` +
        'reached this build through a path the lane did not arrange — a keychain left over from another job, an ' +
        'inherited environment, a developer machine — and an artifact nobody can attribute is the thing that must ' +
        'never reach a store.',
    );
    return { problems, prints, evaluated: true, teamChecked: false };
  }

  // ── limb 3: the right KIND of certificate ─────────────────────────────────
  const wrong = WRONG_KIND.find(([prefix]) => leaf !== null && leaf.startsWith(prefix));
  if (wrong) {
    problems.push(
      `${artifact} is signed by ${JSON.stringify(leaf)}, which is ${wrong[1]}. It is a valid Apple signature and ` +
        'it verifies locally, which is exactly why nothing else in the chain would have objected. Expected a leaf ' +
        `beginning ${DISTRIBUTION_PREFIXES.map((p) => JSON.stringify(p)).join(' or ')}.`,
    );
    return { problems, prints, evaluated: true, teamChecked: false };
  }
  if (leaf === null || !DISTRIBUTION_PREFIXES.some((p) => leaf.startsWith(p))) {
    problems.push(
      `${artifact} is signed by ${JSON.stringify(leaf)}, which is not a recognised App Store distribution ` +
        `identity. Expected a leaf certificate beginning ${DISTRIBUTION_PREFIXES.map((p) => JSON.stringify(p)).join(' or ')}. ` +
        'An unrecognised leaf is not treated as acceptable-by-default: the whole point of this limb is that several ' +
        'perfectly valid Apple certificates are refused by the store.',
    );
    return { problems, prints, evaluated: true, teamChecked: false };
  }

  // ── limb 5: the team the lane ARRANGED — APPLE_TEAM_ID, THE team pin ──────
  // ⏱ 2026-09-24 (O-APPLE-GUARDS-PARSE-HAND-WRITTEN-OUTPUT): "the team-id pin is the APPLE_TEAM_ID secret; a
  // register teamId is optional and never a second source of truth." Until today a MATCH here set nothing, so
  // every run summarised "0 team(s) compared", and a team codesign did not print was skipped, not refused.
  let teamChecked = false;
  if (arrangedTeamId !== null) {
    if (parsed.teamId === null) {
      problems.push(
        `${artifact} is distribution-signed by ${JSON.stringify(leaf)} and carries no readable TeamIdentifier, and ` +
          `APPLE_TEAM_ID (the team pin) is ${arrangedTeamId}. A team this guard cannot read cannot be compared, and ` +
          'an uncompared team is never a pass.',
      );
      return { problems, prints, evaluated: true, teamChecked: false };
    }
    if (parsed.teamId !== arrangedTeamId) {
      problems.push(
        `${artifact} is signed by team ${parsed.teamId} and this lane arranged ${arrangedTeamId} (APPLE_TEAM_ID, the ` +
          'team pin). Two identities were available to xcodebuild and it chose the one nobody asked for — usually a ' +
          'keychain search list that still contains a developer login keychain.',
      );
      return { problems, prints, evaluated: true, teamChecked: false };
    }
    teamChecked = true;
  }

  // ── limb 4: the team the register pins — an OPTIONAL cross-check ──────────
  // It never stands in for APPLE_TEAM_ID: `main` refuses a release-signed run with no APPLE_TEAM_ID, and fails a
  // register teamId that disagrees with it before any bundle is read.
  if (pin === null) {
    if (!teamChecked) {
      prints.push(
        `${artifact} is distribution-signed by team ${parsed.teamId ?? '(unstated)'}; its team was NOT compared to a ` +
          'pin (see above).',
      );
    }
    return { problems, prints, evaluated: true, teamChecked };
  }
  if (parsed.teamId !== pin) {
    problems.push(
      `${artifact} is signed by a team that is not the pinned one. expected ${pin}; found ` +
        `${parsed.teamId ?? '(none)'} (${JSON.stringify(leaf)}). A certificate swapped for another perfectly valid ` +
        'one — a copy-paste between repositories, a half-applied rotation, a restore from the wrong backup — ' +
        'produces a correctly signed build that App Store Connect refuses, so the failure surfaces at the store ' +
        `unless this line catches it. If the team changed deliberately, update ${REGISTER} in the same change.`,
    );
    return { problems, prints, evaluated: true, teamChecked: false };
  }

  return { problems, prints, evaluated: true, teamChecked: true };
}

/** The team identifier the register pins, or null with the reason. Read through
 *  a documented path so that turning the pin ON later is a record edit and not a
 *  code change.
 *  ⏱ 2026-09-24: OPTIONAL — APPLE_TEAM_ID is the pin; a register value is a cross-check that must equal it. */
export function pinnedTeamId(register, channelIds = CHANNEL_IDS) {
  const found = new Map();
  for (const id of channelIds) {
    const row = (register.channels ?? []).find((c) => c.id === id);
    if (!row) return { pin: null, missingRow: id };
    const value = row.signing?.distributionCertificate?.teamId ?? row.signing?.teamId ?? null;
    found.set(id, value);
  }
  const values = [...found.values()];
  if (values.every((v) => v === null)) return { pin: null, missingRow: null };
  const distinct = [...new Set(values)];
  if (distinct.length > 1) {
    return { pin: null, missingRow: null, disagreement: [...found.entries()] };
  }
  return { pin: distinct[0], missingRow: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// --static — build-platforms.yml held to the register's Apple artifact globs
// ═════════════════════════════════════════════════════════════════════════════
// ⏱ ADDED 2026-09-25 (O-APPLE-PROVER-SKIPS-THE-PKG). The archive limbs above run
// only in the bp step that proves a release-signed archive, and bp does not run
// on a pull request. This mode reads no bundle and needs no Mac. It runs in
// ci.yml on every PR and asks three questions of bp's text:
//   · static-prove    some step runs this guard on each Apple row's
//                     artifactGlob, with the glob's app `*` as `${{ matrix.app }}`;
//   · static-upload   some actions/upload-artifact step uploads that same path;
//   · static-posture  each such prover step carries no `if:`, or exactly
//                     `env.APPLE_SIGNING_POSTURE == 'release-signed'`.
// A register row with no artifactGlob, or a bp with no parsed step, is COVERAGE
// LOST: each limb ranges over them, and over nothing each would pass.
// LANE-BOUND: build-platforms.yml — --static grades the Apple build lane itself: both Apple rows of tooling/channel-register.json name .github/workflows/build-platforms.yml (job apple) as their lane.workflow, and it is the one workflow that builds, proves and uploads the .ipa and the .pkg; a second Apple lane in the register would have to be derived from lane.workflow here instead.

export const BUILD_WORKFLOW = '.github/workflows/build-platforms.yml';
export const PROVER = 'tooling/ci/assert-artifact-signed-apple.mjs';
export const RELEASE_COND = `env.${POSTURE_ENV} == '${RELEASE_SIGNED}'`;

/** The path bp names for a register glob: the glob's app `*` is the matrix's app. */
export const workflowGlob = (glob) => String(glob).replace(/^apps\/\*\//, () => 'apps/${{ matrix.app }}/');

/** `token` as one whitespace-delimited word of a command line. */
const hasToken = (text, token) =>
  new RegExp(`(^|\\s)${String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|;|$)`).test(String(text ?? ''));

/** An `if:` as the expression it evaluates: `${{ }}` removed, quotes and spacing normalised. Null stays null. */
export const normaliseCond = (cond) =>
  cond === null || cond === undefined
    ? null
    : String(cond).trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1').replace(/"/g, "'").replace(/\s+/g, ' ').trim();

/**
 * The three --static limbs. `rows` are the register's Apple rows, each with a
 * `signing.seam.artifactGlob`; `steps` are bp's steps as
 * `{ first, name, cond, run, uses, paths }` — `run` the step's logical command
 * text or null, `uses` its action or null, `paths` its `path:` entries.
 * Returns `{ problems, oks }`.
 */
export function staticProblems({ rows, steps }) {
  const problems = [];
  const oks = [];
  const provers = steps.filter((s) => hasToken(s.run, PROVER));
  const uploads = steps.filter((s) => /^actions\/upload-artifact@/.test(s.uses ?? ''));
  for (const row of rows) {
    const glob = row.signing.seam.artifactGlob;
    const want = workflowGlob(glob);
    const carrying = provers.filter((s) => hasToken(s.run, want));
    if (carrying.length === 0) {
      problems.push(
        `static-prove · ${row.id}: no step in ${BUILD_WORKFLOW} runs ${PROVER} on ${want}. The register's ` +
          `signing.seam.artifactGlob is ${glob}, so the archive this channel submits is never opened.`,
      );
    } else {
      oks.push(`static-prove · ${row.id}: ${BUILD_WORKFLOW}:${carrying[0].first} runs the prover on ${want}`);
    }
    for (const s of carrying) {
      const c = normaliseCond(s.cond);
      if (c !== null && c !== RELEASE_COND) {
        problems.push(
          `static-posture · ${row.id}: ${BUILD_WORKFLOW}:${s.first} ${JSON.stringify(s.name ?? '(unnamed)')} runs the ` +
            `prover on ${want} only when \`${s.cond}\`. The archives are built on ${RELEASE_COND}, so the step ` +
            'carries that condition or none.',
        );
      }
    }
    const uploaded = uploads.find((s) => s.paths.includes(want));
    if (uploaded === undefined) {
      problems.push(
        `static-upload · ${row.id}: no actions/upload-artifact step in ${BUILD_WORKFLOW} uploads ${want}, the path ` +
          `the register's artifactGlob ${glob} names, so the archive the prover opens is not the one uploaded for submission.`,
      );
    } else {
      oks.push(`static-upload · ${row.id}: ${BUILD_WORKFLOW}:${uploaded.first} uploads ${want}`);
    }
  }
  return { problems, oks };
}

/** Each step of a parsed job with its `uses:` and its `path:` entries, the
 *  `with:` keys workflowSteps does not read. A `path: |` block is one entry per line. */
function stepsWithPaths(job) {
  const at = new Map(job.lines.map((l, i) => [l.n, i]));
  return workflowSteps(job).map((s) => {
    const lines = job.lines.slice(at.get(s.first), at.get(s.last) + 1);
    let uses = null;
    const paths = [];
    for (let i = 0; i < lines.length; i++) {
      const u = lines[i].text.match(/^\s*(?:-\s+)?uses:\s*(\S+)/);
      if (u) uses = u[1];
      const p = lines[i].text.match(/^(\s*)path:\s*(.*?)\s*$/);
      if (!p) continue;
      if (/^[|>][-+]?$/.test(p[2])) {
        for (let j = i + 1; j < lines.length; j++) {
          const t = lines[j].text;
          if (t.trim() === '') continue;
          if (t.search(/\S/) <= p[1].length) break;
          paths.push(t.trim());
        }
      } else if (p[2] !== '') {
        paths.push(p[2].replace(/^(['"])(.*)\1$/, '$2'));
      }
    }
    return { first: s.first, name: s.name, cond: s.cond, run: s.run?.text ?? null, uses, paths };
  });
}

function staticCheck({ ROOT, log, error, coverageLost }) {
  const registerAbs = join(ROOT, REGISTER);
  if (!existsSync(registerAbs)) {
    coverageLost([
      `--static: ${REGISTER} does not exist under ${ROOT}.`,
      'It names the path each Apple archive is written at; without it there is no path to hold bp to.',
    ]);
  }
  let register;
  try {
    register = JSON.parse(readFileSync(registerAbs, 'utf8'));
  } catch (e) {
    coverageLost([`--static: ${REGISTER} is not valid JSON — ${e.message}`]);
  }
  const channels = Array.isArray(register?.channels) ? register.channels : [];
  const rows = [];
  for (const id of CHANNEL_IDS) {
    const row = channels.find((c) => c?.id === id);
    if (row === undefined) {
      coverageLost([`--static: ${REGISTER} declares no "${id}" channel, so the path its archive is written at is unknown.`]);
    }
    const glob = row.signing?.seam?.artifactGlob;
    if (typeof glob !== 'string' || glob === '') {
      coverageLost([
        `--static: ${REGISTER}'s "${id}" row has no signing.seam.artifactGlob, so there is no path to hold bp to.`,
        'Reading it as nothing-to-check would pass a workflow that proves and uploads nothing.',
      ]);
    }
    rows.push(row);
  }

  const parsed = parseWorkflow(ROOT, BUILD_WORKFLOW);
  if (parsed === null) {
    coverageLost([
      `--static: ${BUILD_WORKFLOW} does not exist under ${ROOT}.`,
      'It is the workflow that builds, proves and uploads the Apple archives.',
    ]);
  }
  const steps = [...parsed.jobs.values()].flatMap((job) => stepsWithPaths(job));
  if (steps.length === 0) {
    coverageLost([
      `--static: no step was parsed out of ${BUILD_WORKFLOW}.`,
      'Every limb ranges over its steps, and over none each would pass.',
    ]);
  }

  const { problems, oks } = staticProblems({ rows, steps });
  for (const o of oks) log(`   ok ${o}`);
  if (problems.length) {
    error('');
    for (const p of problems) error(`FAIL ${p}`);
    error('\nassert-artifact-signed-apple --static: FAILED');
    return 1;
  }
  log('');
  log(
    `assert-artifact-signed-apple --static: OK — ${rows.length} Apple row(s), ${steps.length} step(s) of ` +
      `${BUILD_WORKFLOW} read; each artifactGlob is proven by ${PROVER} (under no \`if:\` or ${RELEASE_COND}) and uploaded.`,
  );
  return 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE IMPURE HALF — one injection seam, `main({ argv, env, platform, run })`
// ═════════════════════════════════════════════════════════════════════════════
// ⏱ 2026-09-24 (O-APPLE-GUARDS-PARSE-HAND-WRITTEN-OUTPUT, ADR 064): every tool
// call goes through `run(cmd, args)`, which returns `{ status, stdout, stderr,
// error }` and is spawnSync by default. A test hands `main` a `run` that returns
// output captured from a real macOS job, and that output travels the SAME path
// CI's does — probe, parse, verdict, summary, exit. No flag and no environment
// variable points this guard at a file: a second input path is one CI never runs.

/** The real tool, both streams as text. */
const defaultRun = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

/** Carries an exit code out of the check to `main`, which returns it — the
 *  assert-ops-register.mjs idiom. The CLI wrapper at the foot of the file is the
 *  one place that exits. */
class GuardExit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

/**
 * Run the guard. Returns `{ code, stdout, stderr }` and prints nothing itself:
 * 0 = signed by the identity this lane intended, 1 = it is not, 2 = COVERAGE LOST.
 */
export function main({ argv = process.argv.slice(2), env = process.env, platform = process.platform, run = defaultRun } = {}) {
  const out = [];
  const err = [];
  let code;
  try {
    code = check({ argv, env, platform, run, log: (s = '') => out.push(s), error: (s = '') => err.push(s) });
  } catch (e) {
    if (!(e instanceof GuardExit)) throw e;
    code = e.code;
  }
  const text = (lines) => (lines.length ? `${lines.join('\n')}\n` : '');
  return { code, stdout: text(out), stderr: text(err) };
}

function check({ argv, env, platform, run, log, error }) {
  const coverageLost = (lines) => {
    error('');
    error(`FAIL COVERAGE LOST — ${lines[0]}`);
    for (const l of lines.slice(1)) error(`     ${l}`);
    error('\nassert-artifact-signed-apple: FAILED');
    // ⏱ 2026-09-16 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
    // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
    throw new GuardExit(2);
  };

  const opt = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
  };
  // 🔴 `rootIdx + 1` ALONE IS THE BUG scan-secrets.mjs SHIPPED. With the flag
  // absent, indexOf returns -1 and -1 + 1 is 0 — the first ARTIFACT's own index —
  // so the flagless form would silently drop its first artifact.
  const rootIdx = argv.indexOf('--repo-root');
  const rootValueIdx = rootIdx >= 0 ? rootIdx + 1 : -1;

  // What codesign returned, for every COVERAGE LOST on its output: the binary,
  // a version (codesign has no --version, so the host's macOS release is printed
  // in its place), the exit, and the first 20 lines of each stream. Resolved only
  // when a stop needs it, through the same `run`.
  const firstLine = (r) => (!r.error && r.status === 0 ? String(r.stdout ?? '').trim().split(/\r?\n/)[0] || null : null);
  const whatCodesignReturned = (result) => {
    const os = firstLine(run('sw_vers', ['-productVersion']));
    return whatToolReturned({
      name: 'codesign',
      path: firstLine(run('which', ['codesign'])),
      version: os ? `codesign has no --version; the host is macOS ${os} (sw_vers -productVersion)` : null,
      result,
    });
  };

  const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const artifacts = argv.filter((a, i) => !a.startsWith('--') && i !== rootValueIdx);

  // --static reads text, not bundles: no posture, no codesign, any platform.
  if (argv.includes('--static')) return staticCheck({ ROOT, log, error, coverageLost });

  // ── the posture this lane INTENDED ───────────────────────────────────────
  // Required, not defaulted. A default would make the most important comparison
  // in the file — intended vs actual — collapse into "actual vs actual" on
  // exactly the runs where the export failed, which is when it matters.
  const posture = (env[POSTURE_ENV] ?? '').trim();
  if (posture === '') {
    coverageLost([
      `${POSTURE_ENV} is not set, so this guard does not know what the lane intended.`,
      'It is exported by tooling/ci/apple-signing.mjs. Its absence means that step did not run, did not reach',
      '$GITHUB_ENV, or ran in a different job — and comparing the bundle against a default would certify',
      'whatever it found.',
    ]);
  }
  if (posture !== RELEASE_SIGNED && posture !== UNSIGNED_PROOF) {
    coverageLost([
      `${POSTURE_ENV} is ${JSON.stringify(posture)}, which is neither "${RELEASE_SIGNED}" nor "${UNSIGNED_PROOF}".`,
      'An unrecognised posture cannot be compared to anything, and treating it as either one would pick a',
      'verdict by accident.',
    ]);
  }

  // ── the team pin: APPLE_TEAM_ID ──────────────────────────────────────────
  // ⏱ 2026-09-24 — parent ruling: "the team-id pin is the APPLE_TEAM_ID secret; a register teamId is optional
  // and never a second source of truth." apple-signing.mjs exports it to $GITHUB_ENV on the release-signed
  // path. Until today an EMPTY value skipped limb 5 without a word, and the run passed with no team compared.
  const arrangedTeamId = (env.APPLE_TEAM_ID ?? '').trim() || null;
  if (posture === RELEASE_SIGNED && arrangedTeamId === null) {
    coverageLost([
      `${RELEASE_SIGNED} and APPLE_TEAM_ID is empty — the team cannot be compared.`,
      `APPLE_TEAM_ID is the team pin. tooling/ci/apple-signing.mjs exports it beside ${POSTURE_ENV} whenever it`,
      'arranges a release identity, so a release-signed run without it is a step that did not reach this job —',
      'and a signature compared against no team passes whichever team signed it.',
    ]);
  }

  if (artifacts.length === 0) {
    coverageLost([
      'no bundle path was given, so this guard evaluated nothing.',
      'A signature check over an empty set prints ok and is the single most repeated failure in this',
      'repository. Pass the built .app, the .ipa or the .pkg.',
    ]);
  }

  // ── codesign ─────────────────────────────────────────────────────────────
  if (platform !== 'darwin') {
    coverageLost([
      `\`codesign\` does not exist on "${platform}" — it ships with Xcode and runs only on macOS.`,
      'This is the check being IMPOSSIBLE here, not the bundle being fine, and the two must never share an',
      'exit code. Run this guard in the macOS lane, next to the build that produced the bundle.',
      '⬜ COVERAGE — every DECISION in this file is a pure function tested on this platform against captured',
      '   `codesign -dv --verbose=4` output; what cannot be exercised off macOS is the invocation itself.',
    ]);
  }
  const probe = run('codesign', ['--help']);
  if (probe.error) {
    coverageLost([
      'codesign could not be run on this macOS host.',
      "It is this guard's only way to read a signature. A check that cannot be made must not report success.",
      'Install the Xcode command line tools in the job (xcode-select --install, or actions/setup-xcode).',
      ...whatCodesignReturned(probe),
    ]);
  }

  // ── the register: the Apple rows, and their optional team cross-check ────
  const registerAbs = join(ROOT, REGISTER);
  if (!existsSync(registerAbs)) {
    coverageLost([
      `${REGISTER} does not exist under ${ROOT}.`,
      'It carries the Apple rows and any team they record, which must equal APPLE_TEAM_ID. Reading it as absent',
      'would drop that cross-check without a word.',
    ]);
  }
  let register;
  try {
    register = JSON.parse(readFileSync(registerAbs, 'utf8'));
  } catch (e) {
    coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
  }
  const pinResult = pinnedTeamId(register);
  if (pinResult.missingRow !== null) {
    coverageLost([
      `${REGISTER} declares no "${pinResult.missingRow}" channel.`,
      'That row is where the Apple signing identity is enumerated ([9]R-3) and where its team is pinned.',
    ]);
  }

  const problems = [];
  const prints = [];
  if (pinResult.disagreement) {
    problems.push(
      `${REGISTER}'s Apple rows pin DIFFERENT teams: ` +
        `${pinResult.disagreement.map(([id, v]) => `${id}=${v ?? 'null'}`).join(', ')}. ` +
        'There is one Apple Developer account behind both rows, so they cannot legitimately differ; a build ' +
        'can only match one of them and the other would fail with a message about the artifact rather than ' +
        'about this record.',
    );
  } else if (pinResult.pin === null) {
    prints.push(
      `NO REGISTER TEAM — no Apple row in ${REGISTER} carries \`signing.distributionCertificate.teamId\`, and none ` +
        'is needed: the team pin is APPLE_TEAM_ID, the repository secret apple-signing.mjs exports, and every ' +
        'release-signed bundle is compared against it. A register teamId is an OPTIONAL cross-check — when ' +
        'present it must equal APPLE_TEAM_ID, and it never stands in for it (ruling 2026-09-24).',
    );
  } else if (arrangedTeamId !== null && pinResult.pin !== arrangedTeamId) {
    problems.push(
      `the register disagrees with APPLE_TEAM_ID; the env is the pin. ${REGISTER}'s Apple rows record team ` +
        `${pinResult.pin} and APPLE_TEAM_ID is ${arrangedTeamId}. A register teamId is an optional cross-check and ` +
        'never a second source of truth: correct or delete the register value in the same change as the team.',
    );
  }

  let evaluated = 0;
  let teamChecked = 0;
  const unread = [];

  /** The codesign read every bundle takes, bare or found inside an archive. */
  const readSignature = (label, appAbs) => {
    const args = codesignArgv(appAbs);
    const r = run(args[0], args.slice(1));
    // 🔬 BOTH STREAMS. `codesign -dv` writes its report to STDERR; a caller
    // reading stdout alone gets "" and would fail every correct build.
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const parsed = parseCodesign(output);
    if (parsed.unparseable) unread.push({ rel: label, r });
    const v = verdict({ artifact: label, posture, parsed, pin: pinResult.pin, arrangedTeamId });
    if (parsed.signed && !parsed.adhoc && !parsed.unparseable) {
      log(`   ${label} · leaf ${JSON.stringify(leafAuthority(parsed))} · team ${parsed.teamId ?? '(none)'} · id ${parsed.identifier ?? '(none)'}`);
    }
    problems.push(...v.problems);
    prints.push(...v.prints);
    if (v.evaluated) evaluated++;
    if (v.teamChecked) teamChecked++;
    return { parsed, v };
  };

  // ── the archives: opened here, through `run` (O-APPLE-PROVER-SKIPS-THE-PKG) ──
  const appleRows = Array.isArray(register?.channels) ? register.channels.filter((c) => CHANNEL_IDS.includes(c?.id)) : [];
  const workRoot = (env.RUNNER_TEMP ?? '').trim() || tmpdir();
  const distIdentity = (env.APPLE_DIST_IDENTITY ?? '').trim() || null;
  const installerIdentity = (env.APPLE_INSTALLER_IDENTITY ?? '').trim() || null;
  const BUILT_PLIST = join(dirname(fileURLToPath(import.meta.url)), 'assert-built-info-plist.mjs');
  const toolLost = (limb, name, result) =>
    coverageLost([
      `${limb}: \`${name}\` could not be run, or refused the archive, so the bundle inside it was never read.`,
      'This is the check being impossible, not the archive being fine.',
      ...whatToolReturned({ name, path: result?.error ? null : name, result }),
    ]);
  const appsIn = (dir) =>
    existsSync(dir) ? listDir(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.endsWith('.app')).map((e) => join(dir, e.name)) : [];

  /** ipa-payload / pkg-signature / pkg-payload: the one wrapped .app, or null with the problem pushed. */
  const openArchive = (kind, rel, abs) => {
    const dest = mkdtempSync(join(workRoot, kind === '.ipa' ? 'ipa-check-' : 'pkg-check-'));
    if (kind === '.ipa') {
      const r = run('unzip', ['-q', abs, '-d', dest]);
      if (r.error) toolLost('ipa-payload', 'unzip', r);
      if (r.status !== 0) {
        problems.push(`ipa-payload: ${rel} is not a readable zip (unzip exit ${r.status}).`);
        return null;
      }
      const apps = appsIn(join(dest, 'Payload'));
      if (apps.length !== 1) {
        problems.push(`ipa-payload: ${rel} holds ${apps.length} Payload/*.app; exactly one is the bundle.`);
        return null;
      }
      return apps[0];
    }
    const sig = run('pkgutil', ['--check-signature', abs]);
    if (sig.error) toolLost('pkg-signature', 'pkgutil', sig);
    problems.push(...pkgSignatureProblems({ rel, text: `${sig.stdout ?? ''}${sig.stderr ?? ''}`, installerIdentity }));
    // `--expand-full` refuses a destination that exists, so it gets a fresh child.
    const out = join(dest, 'expanded');
    const r = run('pkgutil', ['--expand-full', abs, out]);
    if (r.error || r.status !== 0) toolLost('pkg-payload', 'pkgutil --expand-full', r);
    const components = existsSync(out)
      ? listDir(out, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.endsWith('.pkg')).map((e) => join(out, e.name, 'Payload'))
      : [];
    const apps = [join(out, 'Payload'), ...components].flatMap(appsIn);
    if (apps.length !== 1) {
      problems.push(`pkg-payload: ${rel} wraps ${apps.length} .app bundle(s) under Payload/; exactly one is the app.`);
      return null;
    }
    return apps[0];
  };

  /** info-plist always; identity / verify-strict / profile / entitlements when a release identity was arranged. */
  const wrappedAppLimbs = ({ kind, rel, appAbs, row, slug, parsed }) => {
    if (posture === RELEASE_SIGNED) releaseLimbs({ kind, rel, appAbs, row, slug, parsed });
    else prints.push(`${rel}: "${posture}" arranges no identity, so identity, verify-strict, profile and entitlements were not held — the signature verdict and the Info.plist were.`);

    const plist = run(process.execPath, [BUILT_PLIST, '--app', slug, '--repo-root', ROOT, appAbs]);
    if (plist.error || plist.status === 2) toolLost('info-plist', 'assert-built-info-plist.mjs', plist);
    if (plist.status !== 0) {
      const said = `${plist.stdout ?? ''}${plist.stderr ?? ''}`.trim().split(/\r?\n/).filter(Boolean).slice(0, 5);
      problems.push(`info-plist: assert-built-info-plist.mjs refuses ${rel}'s wrapped app (exit ${plist.status}): ${said.join(' | ')}`);
    }
  };

  const releaseLimbs = ({ kind, rel, appAbs, row, slug, parsed }) => {
    if (distIdentity !== null && !parsed.authorities.includes(distIdentity)) {
      problems.push(`identity: ${rel}'s wrapped app is not signed by "${distIdentity}" (APPLE_DIST_IDENTITY); its Authority chain is ${JSON.stringify(parsed.authorities)}.`);
    }
    const strict = run('codesign', ['--verify', '--strict', appAbs]);
    if (strict.error) toolLost('verify-strict', 'codesign', strict);
    if (strict.status !== 0) {
      problems.push(`verify-strict: \`codesign --verify --strict\` rejects ${rel}'s wrapped app (exit ${strict.status}): ${String(strict.stderr ?? '').trim().split(/\r?\n/)[0]}`);
    }

    // The bundle id is the APP's (per slug), never one register literal shared by every app.
    let bundleId;
    try {
      bundleId = bundleIdOf(JSON.parse(readFileSync(join(ROOT, PROVISIONING_REGISTER), 'utf8')), slug);
    } catch (e) {
      coverageLost([`profile: no bundle id for "${slug}" could be read from ${PROVISIONING_REGISTER}, so the profile in ${rel} has nothing to be compared with — ${e.message}`]);
    }
    const profilePath = kind === '.ipa' ? join(appAbs, 'embedded.mobileprovision') : join(appAbs, 'Contents', 'embedded.provisionprofile');
    let profileText = '';
    if (!existsSync(profilePath)) {
      problems.push(`profile: ${rel}'s wrapped app has no ${kind === '.ipa' ? 'embedded.mobileprovision' : 'Contents/embedded.provisionprofile'}.`);
    } else {
      // The envelope gate: a bare plist named like a profile is not a profile Apple signed.
      const cms = run('security', ['cms', '-D', '-i', profilePath]);
      if (cms.error) toolLost('profile', 'security cms -D', cms);
      if (cms.status !== 0) problems.push(`profile: ${rel}'s ${kind === '.ipa' ? 'embedded.mobileprovision' : 'Contents/embedded.provisionprofile'} is not a CMS envelope \`security cms -D\` can decode (exit ${cms.status}).`);
      const bytes = readFileSync(profilePath);
      profileText = bytes.toString('latin1');
      const profile = parseMobileProvision(bytes);
      // The three fields the inline PROVE shell printed with PlistBuddy, kept as diagnostics.
      if (profile !== null) log(`   ${rel} · profile ${JSON.stringify(profile.name)} · ${profile.appIdentifier ?? '(no application-identifier)'} · expires ${profile.expires ?? '(none)'}`);
      problems.push(...profileProblems({ rel, profile, teamId: arrangedTeamId, bundleId }));
    }

    const entRel = kind === '.ipa' ? `apps/${slug}/ios/Runner/Runner.entitlements` : `apps/${slug}/macos/Runner/Release.entitlements`;
    if (!existsSync(join(ROOT, entRel))) {
      prints.push(`entitlements: ${entRel} does not exist, so ${rel} was held to no declared entitlement — an app that declares none asserts none.`);
    } else {
      const declared = plistTopKeys(readFileSync(join(ROOT, entRel), 'utf8'));
      if (declared.length === 0) {
        problems.push(`entitlements: ${entRel} declares no key this guard could read.`);
      } else {
        const ent = run('codesign', ['-d', '--entitlements', '-', '--xml', appAbs]);
        if (ent.error || ent.status !== 0) toolLost('entitlements', 'codesign -d --entitlements', ent);
        problems.push(...entitlementProblems({ kind, rel, declared, signed: plistTopKeys(ent.stdout), profiled: profileEntitlementKeys(profileText) }));
      }
    }
  };

  for (const rel of artifacts) {
    const abs = isAbsolute(rel) ? rel : join(ROOT, rel);
    const suffix = unreadableSuffix(rel);
    if (suffix !== null) {
      problems.push(
        `${rel} is a ${suffix}, which \`codesign\` cannot read and this guard does not open — it reads a code ` +
          'object (.app bundle or Mach-O binary), and opens an .ipa or a .pkg. Refused by name rather than reported ' +
          'as unsigned: "the tool cannot read this" and "this is not signed" must not be the same result.',
      );
      continue;
    }
    if (!existsSync(abs)) {
      problems.push(`${rel} does not exist. This guard runs after the build; a missing bundle means the build did not produce what this lane claims it did.`);
      continue;
    }
    const stat = statSync(abs);
    if (stat.isFile() && stat.size === 0) {
      problems.push(`${rel} is ZERO bytes. A truncated binary uploads and fails processing, which spends a version string that can never be reused.`);
      continue;
    }

    const kind = archiveKind(rel);
    if (kind === null) {
      const { v } = readSignature(rel, abs);
      if (v.problems.length === 0 && v.prints.length === 0) {
        log(`ok   ${rel} — distribution-signed by the pinned team`);
      }
      continue;
    }

    const repoRel = (isAbsolute(rel) ? relative(ROOT, rel) : rel).replace(/\\/g, '/');
    const hit = archiveRow(appleRows, repoRel);
    if (hit === null) {
      problems.push(
        `${rel} is at no Apple row's signing.seam.artifactGlob ` +
          `(${appleRows.map((c) => c.signing?.seam?.artifactGlob ?? `${c.id}: none`).join(', ')}). The row gives the bundle id ` +
          'the embedded profile is held to, and an archive at an undeclared path is one no upload or submission reads.',
      );
      continue;
    }
    if (posture === RELEASE_SIGNED) {
      const missing = [distIdentity === null && 'APPLE_DIST_IDENTITY', kind === '.pkg' && installerIdentity === null && 'APPLE_INSTALLER_IDENTITY'].filter(Boolean);
      if (missing.length) {
        coverageLost([
          `${RELEASE_SIGNED} and ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} empty, so ${rel} cannot be held to the identity that signed it.`,
          'tooling/ci/apple-signing.mjs exports both beside APPLE_TEAM_ID; the inline PROVE shell this limb replaced',
          'failed on an unset one too (`set -u`).',
        ]);
      }
    }
    const before = problems.length;
    const appAbs = openArchive(kind, rel, abs);
    if (appAbs === null) continue;
    const label = `${rel} → ${relative(dirname(dirname(appAbs)), appAbs).replace(/\\/g, '/')}`;
    const { parsed, v } = readSignature(label, appAbs);
    wrappedAppLimbs({ kind, rel, appAbs, row: hit.row, slug: hit.slug, parsed });
    if (problems.length === before && v.prints.length === 0) {
      log(`ok   ${rel} — opened; the wrapped app is distribution-signed by the pinned team, and its profile, entitlements and Info.plist agree`);
    }
  }

  // A pass produced by reading nothing is the failure this repository keeps
  // meeting. ⚠️ THE PROBLEMS ARE PRINTED FIRST: an unreadable bundle produces
  // BOTH a precise diagnosis and an empty evaluation set, and exiting on the
  // coverage check alone would replace "this file carries no signature" with
  // "nothing was evaluated", which is true, useless, and reads as a broken guard
  // rather than a broken artifact.
  if (evaluated === 0) {
    for (const p of problems) error(`FAIL ${p}`);
    coverageLost([
      `${artifacts.length} bundle path(s) were given and NOT ONE yielded a readable signature report.`,
      'Every assertion above ranged over an empty set. Either the build produced nothing, or the paths are',
      'wrong, or codesign has stopped reading these bundles — and all three look identical to a clean run.',
      ...unread.flatMap(({ rel, r }) => [`what codesign returned for ${rel}:`, ...whatCodesignReturned(r)]),
    ]);
  }

  if (prints.length) {
    log('');
    log('   ── printed, not failed ──');
    for (const p of prints) log(`   ⬜ ${p}`);
  }

  if (problems.length) {
    error('');
    for (const p of problems) error(`FAIL ${p}`);
    error('');
    error('  Every .aab this factory built before 2026-08-04 was debug-signed and every configuration');
    error('  check was green, because the configuration was already correct and nothing read the bytes.');
    error('  This is that guard for the Apple side, written before the first Apple artifact exists.');
    error('\nassert-artifact-signed-apple: FAILED');
    return 1;
  }

  log('');
  log(
    `assert-artifact-signed-apple: OK — ${evaluated}/${artifacts.length} bundle(s) read with codesign; posture ` +
      `"${posture}" matches the real signer; ${teamChecked} team(s) compared against APPLE_TEAM_ID` +
      `${posture === UNSIGNED_PROOF ? ` (none — "${UNSIGNED_PROOF}" arranges no identity)` : ''}` +
      `${pinResult.pin !== null && arrangedTeamId !== null ? '; the register teamId agrees with it' : ''}`,
  );
  log('   An .ipa or .pkg is opened and its wrapped .app read; a .zip or .dmg is refused by name, never read as unsigned.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { code, stdout, stderr } = main();
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exit(code);
}
