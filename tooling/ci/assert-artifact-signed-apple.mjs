#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-artifact-signed-apple.mjs — read the signature out of the BUILT APPLE
// BUNDLE and refuse to call an unsigned or ad-hoc-signed build a release.
//
// The Apple half of the pair `assert-artifact-signed.mjs` forms for Play. Same
// law, different tool: that one runs `keytool -printcert -jarfile` over an .aab,
// this one runs `codesign -dvv` over an .app.
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
//   5. the real signature agrees with the posture tooling/ci/apple-signing.mjs
//      exported. That step arranges a credential; this one reads the outcome. A
//      step that arranges a thing and then reports its own success is the "green
//      means ran" failure with extra stages.
//
// ── ⚠️ WHAT THIS GUARD CANNOT SEE, stated so green is not mistaken for safe ──
//   · It reads a CODE OBJECT: a `.app` bundle or a Mach-O binary. An `.ipa` is a
//     ZIP and a `.pkg` is an installer archive; `codesign` cannot read either,
//     and pointing this guard at one would report UNSIGNED for a correctly
//     signed app. Both are REFUSED BY NAME rather than reported as unsigned —
//     "the tool cannot read this" and "this file is not signed" must never be
//     the same outcome. Unzip the .ipa and pass `Payload/<App>.app`; check a
//     .pkg with `pkgutil --check-signature`, which is a different guard nobody
//     has needed yet because no lane produces a .pkg.
//   · It does not run `codesign --verify`. That answers "do the sealed resources
//     still hash correctly", which is a different question from "who signed
//     this", and adding it here would mean one exit code for two questions.
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
//
// Usage:
//   node tooling/ci/assert-artifact-signed-apple.mjs [--repo-root <path>] <bundle>…
// Env in: APPLE_SIGNING_POSTURE (required — exported by
//         tooling/ci/apple-signing.mjs; the guard refuses to run without it)
// Exit 0 = the bundle is signed by the identity this lane intended. 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Bundle suffixes `codesign` cannot read. Refused by name; see the header. */
export const UNREADABLE_SUFFIXES = Object.freeze(['.ipa', '.pkg', '.zip', '.dmg']);

/** Pure so it is testable off macOS, where the loop that calls it cannot run.
 *  Returns the offending suffix or null. */
export function unreadableSuffix(rel) {
  const lower = String(rel).toLowerCase();
  return UNREADABLE_SUFFIXES.find((s) => lower.endsWith(s)) ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// PURE DECISION LOGIC — the whole verdict, testable without a Mac.
// ═════════════════════════════════════════════════════════════════════════════

/** The exact invocation. `-dvv` is display + two verbosity levels, which is what
 *  makes the `Authority=` chain appear; `-dv` alone prints the team identifier
 *  and no authorities, and limb 3 would then range over an empty list. */
export function codesignArgv(path) {
  return ['codesign', '-dvv', path];
}

/**
 * Parse `codesign -dvv` output.
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
    else if (key === 'CodeDirectory') out.flags = value.match(/flags=(\S+)/)?.[1] ?? null;
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
        `${artifact} — \`codesign -dvv\` produced output this guard cannot parse. It found no Identifier, no ` +
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

  // ── limb 5: the identity the lane ARRANGED, if it said ────────────────────
  if (arrangedTeamId !== null && parsed.teamId !== null && parsed.teamId !== arrangedTeamId) {
    problems.push(
      `${artifact} is signed by team ${parsed.teamId} and this lane arranged ${arrangedTeamId}. Two identities were ` +
        'available to xcodebuild and it chose the one nobody asked for — usually a keychain search list that still ' +
        'contains a developer login keychain.',
    );
    return { problems, prints, evaluated: true, teamChecked: false };
  }

  // ── limb 4: the team the register pins ────────────────────────────────────
  if (pin === null) {
    prints.push(
      `${artifact} is distribution-signed by team ${parsed.teamId ?? '(unstated)'}; its team was NOT compared to a ` +
        'pin (see above).',
    );
    return { problems, prints, evaluated: true, teamChecked: false };
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
 *  code change. */
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
// THE IMPURE HALF
// ═════════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
// 🔴 `rootIdx + 1` ALONE IS THE BUG scan-secrets.mjs SHIPPED. With the flag
// absent, indexOf returns -1 and -1 + 1 is 0 — the first ARTIFACT's own index —
// so the flagless form would silently drop its first artifact.
const rootIdx = argv.indexOf('--repo-root');
const rootValueIdx = rootIdx >= 0 ? rootIdx + 1 : -1;

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-artifact-signed-apple: FAILED');
  process.exit(1);
}

function main() {
  const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const artifacts = argv.filter((a, i) => !a.startsWith('--') && i !== rootValueIdx);

  // ── the posture this lane INTENDED ───────────────────────────────────────
  // Required, not defaulted. A default would make the most important comparison
  // in the file — intended vs actual — collapse into "actual vs actual" on
  // exactly the runs where the export failed, which is when it matters.
  const posture = (process.env[POSTURE_ENV] ?? '').trim();
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

  if (artifacts.length === 0) {
    coverageLost([
      'no bundle path was given, so this guard evaluated nothing.',
      'A signature check over an empty set prints ok and is the single most repeated failure in this',
      'repository. Pass the built .app (for an .ipa, the Payload/<App>.app inside it).',
    ]);
  }

  // ── codesign ─────────────────────────────────────────────────────────────
  if (process.platform !== 'darwin') {
    coverageLost([
      `\`codesign\` does not exist on "${process.platform}" — it ships with Xcode and runs only on macOS.`,
      'This is the check being IMPOSSIBLE here, not the bundle being fine, and the two must never share an',
      'exit code. Run this guard in the macOS lane, next to the build that produced the bundle.',
      '⬜ COVERAGE — every DECISION in this file is a pure function tested on this platform against captured',
      '   `codesign -dvv` output; what cannot be exercised off macOS is the invocation itself.',
    ]);
  }
  const probe = spawnSync('codesign', ['--help'], { encoding: 'utf8' });
  if (probe.error) {
    coverageLost([
      'codesign could not be run on this macOS host.',
      "It is this guard's only way to read a signature. A check that cannot be made must not report success.",
      'Install the Xcode command line tools in the job (xcode-select --install, or actions/setup-xcode).',
    ]);
  }

  // ── the pinned team ──────────────────────────────────────────────────────
  const registerAbs = join(ROOT, REGISTER);
  if (!existsSync(registerAbs)) {
    coverageLost([
      `${REGISTER} does not exist under ${ROOT}.`,
      'It carries the pinned distribution team. Without it limb 4 would range over undefined and every',
      'distribution certificate on earth would read as the right one.',
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
      `NO PINNED TEAM — no Apple row in ${REGISTER} carries \`signing.distributionCertificate.teamId\`, so limb 4 ` +
        'is not enforced: ANY distribution certificate passes. That is the honest state today — there is no ' +
        'Apple Developer account (OWNER_QUEUE A-4) and therefore no team identifier to pin. Adding it is a ' +
        'one-line record edit on enrolment day, and this line is what stops that being forgotten.',
    );
  }

  const arrangedTeamId = (process.env.APPLE_TEAM_ID ?? '').trim() || null;

  let evaluated = 0;
  let teamChecked = 0;
  for (const rel of artifacts) {
    const abs = isAbsolute(rel) ? rel : join(ROOT, rel);
    const suffix = unreadableSuffix(rel);
    if (suffix !== null) {
      problems.push(
        `${rel} is a ${suffix}, which \`codesign\` cannot read — it reads a code object (.app bundle or Mach-O ` +
          'binary), and an archive reports as unsigned however well the app inside it is signed. Refused by name ' +
          'rather than reported as unsigned: "the tool cannot read this" and "this is not signed" must not be the ' +
          'same result. Unzip the .ipa and pass Payload/<App>.app.',
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

    const args = codesignArgv(abs);
    const r = spawnSync(args[0], args.slice(1), { encoding: 'utf8' });
    // 🔬 BOTH STREAMS. `codesign -dvv` writes its report to STDERR; a caller
    // reading stdout alone gets "" and would fail every correct build.
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const parsed = parseCodesign(output);
    const v = verdict({ artifact: rel, posture, parsed, pin: pinResult.pin, arrangedTeamId });
    if (parsed.signed && !parsed.adhoc && !parsed.unparseable) {
      console.log(`   ${rel} · leaf ${JSON.stringify(leafAuthority(parsed))} · team ${parsed.teamId ?? '(none)'} · id ${parsed.identifier ?? '(none)'}`);
    }
    problems.push(...v.problems);
    prints.push(...v.prints);
    if (v.evaluated) evaluated++;
    if (v.teamChecked) teamChecked++;
    if (v.problems.length === 0 && v.prints.length === 0) {
      console.log(`ok   ${rel} — distribution-signed by the pinned team`);
    }
  }

  // A pass produced by reading nothing is the failure this repository keeps
  // meeting. ⚠️ THE PROBLEMS ARE PRINTED FIRST: an unreadable bundle produces
  // BOTH a precise diagnosis and an empty evaluation set, and exiting on the
  // coverage check alone would replace "this file carries no signature" with
  // "nothing was evaluated", which is true, useless, and reads as a broken guard
  // rather than a broken artifact.
  if (evaluated === 0) {
    for (const p of problems) console.error(`FAIL ${p}`);
    coverageLost([
      `${artifacts.length} bundle path(s) were given and NOT ONE yielded a readable signature report.`,
      'Every assertion above ranged over an empty set. Either the build produced nothing, or the paths are',
      'wrong, or codesign has stopped reading these bundles — and all three look identical to a clean run.',
    ]);
  }

  if (prints.length) {
    console.log('');
    console.log('   ── printed, not failed ──');
    for (const p of prints) console.log(`   ⬜ ${p}`);
  }

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`FAIL ${p}`);
    console.error('');
    console.error('  Every .aab this factory built before 2026-08-04 was debug-signed and every configuration');
    console.error('  check was green, because the configuration was already correct and nothing read the bytes.');
    console.error('  This is that guard for the Apple side, written before the first Apple artifact exists.');
    console.error('\nassert-artifact-signed-apple: FAILED');
    process.exit(1);
  }

  console.log('');
  console.log(
    `assert-artifact-signed-apple: OK — ${evaluated}/${artifacts.length} bundle(s) read with codesign; posture ` +
      `"${posture}" matches the real signer; ${teamChecked} team(s) compared against the pin` +
      `${pinResult.pin === null ? ' (none pinned — see above)' : ''}`,
  );
  console.log('   A code object only — an .ipa, .pkg, .zip or .dmg is refused by name, never read as unsigned.');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
