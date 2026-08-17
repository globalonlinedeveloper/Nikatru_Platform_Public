#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// apple-signing.mjs — materialise the APPLE DISTRIBUTION IDENTITY for one CI
// build and decide, out loud, whether this run is allowed to be unsigned.
//
// This is the macOS/iOS half of the pair `tooling/ci/android-signing.mjs`
// already forms for Play, and it is deliberately the same shape, because the
// defect it forecloses is the same one and it has already happened once here.
//
// 🔴 WHY THIS EXISTS — the defect it closes, named. PR #202 declared four Apple
// secrets on the `ios-appstore` and `macos-appstore` rows of
// tooling/channel-register.json. `grep -rn APPLE_DIST_CERT_P12_BASE64` over the
// whole tree on 2026-08-08 returned THE REGISTER AND NOTHING ELSE: no workflow
// named them, no script read them, nothing compared them to anything. That is
// the Android state of 2026-08-04 exactly — a correct declaration with no
// consumer — and on the Android side it meant every .aab the factory had ever
// produced was debug-signed while every configuration check stayed green. The
// Apple lane's version of the same silence is worse in one respect: today
// `build-platforms.yml` runs `flutter build ios --release --no-codesign`, so
// the lane's UNSIGNED-ness is real and correct, and the day somebody removes
// `--no-codesign` there is nothing anywhere that would notice the secrets were
// never wired.
//
//   all four supplied   → materialise the .p12 and the profiles, arrange a
//                         per-run keychain, write the ExportOptions.plist the
//                         signed export needs, posture = `release-signed`
//   none supplied       → posture = `unsigned-build-proof`, the gap PRINTED IN
//                         CAPITALS and named (Apple Developer account,
//                         OWNER_QUEUE A-4) — UNLESS this is a release lane AND
//                         the register ARMS one of the two Apple rows, where the
//                         absence is a FAILURE and not a posture
//   some supplied       → FAIL, always, on every lane. Three of four is an
//                         artifact nobody can explain, and Apple's notion of a
//                         "correctly signed but wrong identity" build is
//                         rejected at upload, after the account is spent.
//
// 🔴 THE RELEASE-LANE FAILURE IS SCOPED BY THE REGISTER, NOT BY THE TAG ALONE,
// AND THAT CORRECTION WAS MEASURED. Until 2026-08-09 the middle ending read
// "UNLESS this is a release lane" full stop, and the consequence was that a
// `subly-v*` tag killed the `apple` job — while `windows-signing.mjs` killed
// `windows` and `appimage-signing.mjs` killed `linux_web_android` for the same
// reason. build-platforms.yml's `release` job `needs:` all three, so the FIRST
// GitHub Release this repository would ever publish was unreachable, blocked on
// an Apple enrolment protecting a submission that cannot happen: BOTH Apple rows
// are `lane: null` — nothing in this repository emits an .ipa or a .pkg, and
// `build-platforms.yml` builds iOS with `--no-codesign` on purpose. The scope
// test now comes from the register's own `served` / `submittable` / `lane`
// fields, through `tooling/ci/channel-arming.mjs`, and the gap is PRINTED IN
// FULL on the release lane instead ([pipeline C-6], the same rule the .pkg
// installer-certificate gap below already follows). The failing case did not go
// away: give an Apple row a lane, or mark it served, and the identical tag fails
// naming the field that armed it.
//
// ⚠️ THIS SCRIPT IS NOT THE PROOF. It says what it INTENDS; it cannot say what
// xcodebuild did. `tooling/ci/assert-artifact-signed-apple.mjs` reads the real
// signature back out of the built bundle with `codesign -dvv` and fails if the
// signer disagrees with the posture exported here. A step that arranges a
// credential and then reports its own success is the "green means ran" failure
// with extra stages — the exact reason the Android pair is two files.
//
// ── NAMES COME FROM THE REGISTER, AND THE COPY HERE IS COMPARED TO IT ────────
// The Android script parses its variable names out of build.gradle.kts because
// Gradle is the authority for what Gradle reads. There is no equivalent build
// file here: `xcodebuild` reads a keychain and a plist, not a named set of
// environment variables, so the authority for the NAMES is the register, which
// is where [9]R-3 limb 2 says signing secrets are enumerated.
//
// But this script cannot merely read them, because it must know what each one
// IS — one is base64 of a PKCS#12, one is its passphrase, one is base64 of a
// profile set, one is a 10-character team identifier, and they are validated
// and used in four completely different ways. A role map is therefore declared
// below, and the register's declared set is COMPARED TO IT on every run, in
// both directions, on both rows. Two copies of a list drift; two copies that
// are compared cannot drift silently. Renaming a secret in the register without
// teaching this file fails HERE, loudly, instead of producing an unsigned build
// from a run that looked like a signing run.
//
// ── KEY MATERIAL IS WRITTEN OUTSIDE THE REPOSITORY, ON PURPOSE ───────────────
// $RUNNER_TEMP, never the workspace — the .p12, the keychain database, the
// decoded profiles and the generated ExportOptions.plist. Every
// `actions/upload-artifact` path in this repo is workspace-relative, so key
// material inside the tree is one broad `path:` away from being published, and
// on a PUBLIC repo an artifact is downloadable by anyone. Outside the tree
// there is no glob that can reach it.
//
// ── THE KEYCHAIN PASSWORD IS GENERATED PER RUN AND IS NOT A SECRET ───────────
// `security create-keychain -p` needs a password. It is `randomBytes(24)`,
// generated here, never printed, never exported, and never stored. Making it a
// repository secret would be worse in every direction: it would be a fifth
// name to keep in step, a fifth rotation obligation, and a long-lived value
// protecting a keychain that exists for the length of one job in a directory
// the runner destroys — while the credential it guards is already in that job's
// environment. A per-run random value cannot leak from a previous run because
// there is no previous run to leak from.
//
// ── ⬜ A GAP THIS SCRIPT PRINTS AND CANNOT CLOSE ─────────────────────────────
// A Mac App Store `.pkg` needs TWO certificates: an application certificate
// (Apple Distribution / 3rd Party Mac Developer Application) to sign the .app,
// and an INSTALLER certificate (Mac Installer Distribution / 3rd Party Mac
// Developer Installer) to sign the package `productbuild` produces. The
// register declares ONE — `APPLE_DIST_CERT_P12_BASE64` — so the macos-appstore
// `.pkg` intent below can be planned but not fully signed from the declared
// secret set. That is printed on every run rather than failing the build,
// because the missing item is an owner action on an account that does not exist
// yet (OWNER_QUEUE A-4) and a guard that blocks CI on work only the owner can do
// blocks every merge in the repository.
//
// Usage:
//   node tooling/ci/apple-signing.mjs [--app <slug>] [--out <dir>]
//                                     [--repo-root <path>] [--github-env <path>]
//                                     [--method <app-store-connect|…>]
// Env in:  the four names the register declares (see ROLE_ENV below)
//          GITHUB_REF, GITHUB_WORKFLOW_REF — read to DERIVE whether this is a
//          release lane. There is deliberately no flag a workflow can set or
//          forget; see the derivation block.
// Env out (via $GITHUB_ENV): APPLE_SIGNING_POSTURE and, when signing was
//          arranged, the keychain / plist / team paths the export steps read.
// Exit 0 = the posture is decided and legal for this lane. 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { armedFatalLines, releaseGapVerdict, unarmedGapLines } from './channel-arming.mjs';

export const APPS = 'catalog/apps.json';
export const REGISTER = 'tooling/channel-register.json';
/** BOTH Apple rows. One Apple Developer account, one distribution identity, two
 *  App Store Connect records — so the two rows must declare the SAME secret set
 *  and a disagreement between them is a record fault, not a choice. */
export const CHANNEL_IDS = ['ios-appstore', 'macos-appstore'];

export const POSTURE_ENV = 'APPLE_SIGNING_POSTURE';
export const RELEASE_SIGNED = 'release-signed';
export const UNSIGNED_PROOF = 'unsigned-build-proof';

/** The role map. Every name here must appear in the register's declared set and
 *  vice versa — checked on every run, both directions, both rows. */
export const ROLE_ENV = Object.freeze({
  p12: 'APPLE_DIST_CERT_P12_BASE64',
  p12Password: 'APPLE_DIST_CERT_PASSWORD',
  profiles: 'APPLE_PROVISIONING_PROFILES_BASE64',
  teamId: 'APPLE_TEAM_ID',
});
export const WANTED = Object.freeze(Object.values(ROLE_ENV));

/** The owner item behind the absent account, named in full so the printed gap
 *  is actionable without opening another file. */
export const OWNER_GAP = 'Apple Developer account (OWNER_QUEUE A-4)';

// ═════════════════════════════════════════════════════════════════════════════
// PURE DECISION LOGIC
//
// 🔬 EVERYTHING BELOW THIS LINE AND ABOVE `main()` IS A PURE FUNCTION, AND THE
// REASON IS THIS BOX. `security`, `codesign`, `xcrun` and `productbuild` exist
// only on macOS; this repository is developed on Windows and its guard lane runs
// on ubuntu. If the decisions lived inside the darwin-only execution path they
// could not be tested anywhere the authors work, and an untested branch in a
// signing seam is the thing this file exists to prevent. So the decisions are
// separated from the doing: the laws below are unit-tested with fixtures on any
// platform, and only the four `security` invocations are gated on
// `process.platform === 'darwin'`.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * THE ALL-OR-NONE LAW. Which of the wanted names carry a value.
 * `kind` is 'all' | 'none' | 'partial'; 'partial' is fatal on EVERY lane.
 */
export function secretSetLaw(values, wanted = WANTED) {
  const has = (n) => String(values[n] ?? '').trim() !== '';
  const supplied = wanted.filter(has);
  const missing = wanted.filter((n) => !has(n));
  const kind = missing.length === 0 ? 'all' : supplied.length === 0 ? 'none' : 'partial';
  return { kind, supplied, missing };
}

/**
 * IS THIS A RELEASE LANE? — DERIVED, NEVER DECLARED IN THE WORKFLOW.
 *
 * 🔴 A HAND-WRITTEN `APPLE_SIGNING_REQUIRED: 'true'` LINE IN THE YAML WOULD BE
 * THE SAME MISTAKE ONE LEVEL UP. The whole defect being foreclosed here is a
 * switch that was never thrown; a flag a workflow can delete is a switch of
 * exactly that kind, and deleting it would silently revert a submission lane to
 * producing a build proof with every check still green. So the question is put
 * to two things a workflow file cannot delete:
 *
 *   (a) A TAG PUSH. `GITHUB_REF` starting `refs/tags/` is a release by every
 *       reading, and GitHub sets it, not us.
 *   (b) THE CHANNEL'S DECLARED SUBMISSION PATH. The register names the workflow
 *       that submits to App Store Connect ([10]D-10 limb (i)); a workflow whose
 *       whole subject is a submittable artifact may not produce one that cannot
 *       be submitted. `GITHUB_WORKFLOW_REF` is the running workflow's own path,
 *       also set by GitHub.
 *
 * Everything else — a branch push, a pull request, a fork, the weekly six-
 * platform proof — is a BUILD PROOF and is allowed to be unsigned provided it
 * says so. A fork PR holds no secrets, so the unsigned ending must stay a
 * passing one or every fork contribution fails on work only the owner can do.
 */
export function releaseLane({ gitRef = '', workflowRef = '', submissionWorkflows = [] } = {}) {
  const reasons = [];
  const blind = [];
  const ref = String(gitRef).trim();
  const wfRef = String(workflowRef).trim();
  const declared = submissionWorkflows.filter((w) => typeof w === 'string' && w !== '');

  if (ref.startsWith('refs/tags/')) reasons.push(`the run is a TAG push (${ref})`);

  if (declared.length > 0 && wfRef !== '') {
    // `owner/repo/.github/workflows/x.yml@refs/heads/main` — compare the PATH
    // part only. Matching the whole string would tie the answer to a branch name.
    const runningPath = wfRef.split('@')[0];
    for (const w of new Set(declared)) {
      if (runningPath.endsWith(`/${w}`) || runningPath === w) {
        reasons.push(`this is a declared Apple submission workflow (${w})`);
        break;
      }
    }
  }
  if (declared.length === 0) {
    blind.push(
      `no Apple row in ${REGISTER} declares a \`submission.workflow\`, so limb (b) contributed nothing — ` +
        'only a tag push can mark a release here.',
    );
  }
  if (wfRef === '' && declared.length > 0) {
    blind.push('GITHUB_WORKFLOW_REF is unset (not a GitHub job), so limb (b) could not be evaluated.');
  }
  return { required: reasons.length > 0, reasons, blind };
}

/**
 * THE THREE ENDINGS, plus the one this platform adds.
 *
 * Returns `{ posture, fatal }`. `fatal` is null or `{ lines }`; a caller that
 * ignores `fatal` and reads `posture` gets null, which cannot be exported.
 *
 * ⚠️ THE FOURTH ENDING — ALL FOUR SECRETS ON A NON-macOS RUNNER — IS FATAL ON
 * EVERY LANE, and that is a decision worth defending. The alternatives were to
 * export `unsigned-build-proof` (which would be a lie: the secrets WERE
 * supplied, and the verifier's posture comparison would then certify an unsigned
 * artifact as the intended outcome) or to export `release-signed` anyway (a
 * worse lie: nothing was arranged). Apple signing cannot be arranged off macOS —
 * `security` and the keychain do not exist elsewhere — so a lane that supplied
 * the secrets on another runner is misconfigured, and the honest report of a
 * misconfiguration is a failure with the platform named in it.
 *
 * 🔴 `required` IS NOW "A RELEASE LANE **AND** AN ARMED CHANNEL". The caller
 * derives it from the release signal AND `channel-arming.mjs`'s reading of the
 * register; `armed` carries the rows that made it true so the message names the
 * FIELD that armed them and not only the secret that is missing. Passing
 * `required: true` with no `armed` rows still produces the exact message it
 * always did — which is why every existing case of this function is unchanged.
 */
export function resolvePosture({ law, required, platform = process.platform, armed = [] } = {}) {
  if (law.kind === 'partial') {
    return {
      posture: null,
      fatal: {
        lines: [
          'FAIL Apple signing is HALF configured and this build refuses to guess.',
          `     supplied: ${law.supplied.join(', ')}`,
          `     missing:  ${law.missing.join(', ')}`,
          '     Supply all of them or none. Three of four produces an UNSIGNED or wrongly-signed bundle',
          '     from a run that looked like a signing run, and Apple rejects it at upload — after the',
          '     account, the App Store Connect record and the review slot are already spent.',
        ],
      },
    };
  }

  if (law.kind === 'none') {
    if (required) {
      return {
        posture: null,
        fatal: {
          lines: [
            'FAIL this is a RELEASE lane and no Apple signing secrets are configured.',
            `     absent: ${law.missing.join(', ')}`,
            '',
            ...armedFatalLines(armed),
            ...(armed.length ? [''] : []),
            '     A release lane that cannot sign must not produce an artifact. App Store Connect rejects an',
            '     unsigned upload, so continuing here would spend a build, an artifact and a version string to',
            '     arrive at a bundle that cannot be submitted — with every check green.',
            '',
            `     🔴 THE MISSING ITEM IS NOT A SECRET, IT IS AN ACCOUNT: ${OWNER_GAP}.`,
            '     There is no distribution certificate to export until the enrolment exists, so the four',
            '     secrets below cannot be created by anybody working in this repository:',
            ...WANTED.map((n) => `       ${n}`),
            '     …or run this lane on a non-release trigger, where an unsigned BUILD PROOF is the recorded,',
            '     labelled outcome rather than a silent one.',
          ],
        },
      };
    }
    return { posture: UNSIGNED_PROOF, fatal: null };
  }

  if (platform !== 'darwin') {
    return {
      posture: null,
      fatal: {
        lines: [
          `FAIL all four Apple signing secrets are supplied and this runner is "${platform}", not macOS.`,
          '     ⬜ COVERAGE — `security`, `codesign`, `xcrun` and `productbuild` exist only on macOS, so the',
          '        keychain could not be created and NOTHING was arranged. Every value above was validated;',
          '        only the arrangement is impossible here.',
          '     Exporting a posture from this run would be a claim about a keychain that does not exist.',
          '     Run the Apple lane on a macOS runner (this repository pins macos-26), or unset the secrets',
          '     to take the labelled unsigned-build-proof path.',
        ],
      },
    };
  }

  return { posture: RELEASE_SIGNED, fatal: null };
}

/**
 * The `security` invocations that import one .p12 into a fresh, per-run
 * keychain and make it the one `codesign` searches.
 *
 * Constructed rather than executed so the SHAPE is testable off macOS. Each
 * entry carries its argv and the human reason, and `redactArgv` is what any
 * printer must pass it through — a plan that prints its own passwords is a
 * plan that leaks two secrets into a public build log.
 *
 * The order matters and is not arbitrary:
 *   create-keychain          a NEW keychain, never the login keychain — a CI job
 *                            must not be able to touch a developer's own keys
 *   set-keychain-settings    -lut 21600: no automatic re-lock mid-build, and a
 *                            6-hour ceiling so a leaked path is not a leaked key
 *                            forever
 *   unlock-keychain          import and codesign both need it open
 *   import -T                grants ONLY the four tools that need the key. `-A`
 *                            (any application) is the tempting shorter form and
 *                            is strictly broader for no benefit
 *   set-key-partition-list   without it, macOS 10.12+ shows a UI prompt on first
 *                            use of the key — which on a headless runner is not
 *                            a prompt, it is a hang until the job times out
 *   list-keychains -s        codesign searches the SEARCH LIST, not a path; a
 *                            keychain that exists and is not in it is invisible
 */
export function keychainPlan({ keychain, keychainPassword, p12Path, p12Password, existingKeychains = [] } = {}) {
  return [
    { why: 'a fresh keychain, never the login keychain', argv: ['security', 'create-keychain', '-p', keychainPassword, keychain] },
    { why: 'no auto-relock mid-build; 6-hour ceiling', argv: ['security', 'set-keychain-settings', '-lut', '21600', keychain] },
    { why: 'import and codesign both need it open', argv: ['security', 'unlock-keychain', '-p', keychainPassword, keychain] },
    {
      why: 'import the distribution identity, granting only the tools that need it',
      argv: [
        'security', 'import', p12Path, '-k', keychain, '-P', p12Password, '-f', 'pkcs12',
        '-T', '/usr/bin/codesign', '-T', '/usr/bin/security', '-T', '/usr/bin/productbuild', '-T', '/usr/bin/productsign',
      ],
    },
    {
      why: 'without this the first key use raises a UI prompt, which on a headless runner is a hang',
      argv: ['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychain],
    },
    {
      why: 'codesign searches the search list, not a path',
      argv: ['security', 'list-keychains', '-d', 'user', '-s', keychain, ...existingKeychains],
    },
  ];
}

/**
 * Replace every occurrence of a secret value with `***`.
 *
 * Exact-value replacement, not a name-based one: the passwords appear as bare
 * argv elements with nothing around them to key on, and the empty string is
 * excluded because replacing it would blank the whole line.
 */
export function redactArgv(argv, secrets = []) {
  const hide = secrets.filter((s) => typeof s === 'string' && s !== '');
  return argv.map((a) => (hide.includes(a) ? '***' : a));
}

/** Apple team identifiers are ten upper-case alphanumerics. Format only — no
 *  check here can tell a well-formed team id from the RIGHT one, and pretending
 *  otherwise would be an assertion that cannot fail. */
export function teamIdProblem(value) {
  if (!/^[A-Z0-9]{10}$/.test(String(value))) {
    return (
      `${ROLE_ENV.teamId} is not a 10-character Apple team identifier (ten upper-case letters or digits). ` +
      'The value is never printed. With the wrong team id xcodebuild selects a different identity or none at ' +
      'all, and the build that results is refused at upload rather than here.'
    );
  }
  return null;
}

/**
 * A `.mobileprovision` / `.provisionprofile` is a CMS (PKCS#7) envelope with an
 * XML property list inside it. The plist is stored as plain text, so the
 * envelope does not have to be parsed to read it — the bytes between `<?xml`
 * and the closing `</plist>` are the whole record.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT DO: it does not verify the CMS signature.
 * A profile is not a secret and not an authenticator — Apple's own tooling
 * validates it at signing time, and a check here that "verified" it with an
 * incomplete implementation would be an assertion whose passing means nothing.
 * What is read is exactly what this script must cross-check: the team it belongs
 * to, the application it is for, its name (which ExportOptions.plist addresses
 * it by) and when it expires.
 *
 * Returns null when the bytes are not a profile at all.
 */
export function parseMobileProvision(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer);
  const start = text.indexOf('<?xml');
  const end = text.lastIndexOf('</plist>');
  if (start === -1 || end === -1 || end < start) return null;
  const plist = text.slice(start, end + '</plist>'.length);

  const str = (key) => plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1] ?? null;
  const date = (key) => plist.match(new RegExp(`<key>${key}</key>\\s*<date>([^<]*)</date>`))?.[1] ?? null;
  const arr = (key) => {
    const block = plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1];
    if (block === undefined) return [];
    return [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  };

  const name = str('Name');
  const uuid = str('UUID');
  const teamIds = arr('TeamIdentifier');
  const expires = date('ExpirationDate');
  // `application-identifier` lives in the Entitlements dict and is
  // `<TEAMID>.<bundle id>`; the wildcard form ends in `.*`.
  const appIdentifier = str('application-identifier');
  const bundleId =
    appIdentifier && teamIds.some((t) => appIdentifier.startsWith(`${t}.`))
      ? appIdentifier.slice(appIdentifier.indexOf('.') + 1)
      : appIdentifier;

  if (name === null && teamIds.length === 0 && appIdentifier === null) return null;
  return { name, uuid, teamIds, expires, appIdentifier, bundleId };
}

/**
 * The plist `flutter build ipa --export-options-plist` and `xcodebuild
 * -exportArchive` consume.
 *
 * `signingStyle: manual` is not a preference. Automatic signing asks Apple for a
 * profile at build time, which needs an App Store Connect API key this lane does
 * not have and makes the artifact depend on the state of a remote account —
 * exactly the kind of build nobody can reproduce a month later. Manual signing
 * uses the profiles supplied as a secret, which is why they are a secret.
 */
export function exportOptionsPlist({ teamId, method = 'app-store-connect', profiles = [], signingStyle = 'manual' } = {}) {
  const mapping = profiles
    .filter((p) => p && p.bundleId && p.name)
    .map((p) => `      <key>${p.bundleId}</key>\n      <string>${p.name}</string>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '  <dict>',
    '    <key>method</key>',
    `    <string>${method}</string>`,
    '    <key>teamID</key>',
    `    <string>${teamId}</string>`,
    '    <key>signingStyle</key>',
    `    <string>${signingStyle}</string>`,
    '    <key>uploadSymbols</key>',
    '    <true/>',
    '    <key>provisioningProfiles</key>',
    '    <dict>',
    ...(mapping === '' ? [] : [mapping]),
    '    </dict>',
    '  </dict>',
    '</plist>',
    '',
  ].join('\n');
}

/**
 * The signed-export INTENTS: the exact commands the later steps run, built here
 * so the paths this script produced are the paths they consume.
 *
 * Printed rather than executed. This file's job ends at "the credential is in
 * place and here is what to run with it"; running a Flutter build from inside a
 * credential-arranging step would put an eight-minute compile inside the step
 * that holds the passwords in argv, and would make one failure indistinguishable
 * from the other.
 */
export function signedExportPlan({ appSlug, exportOptionsPath, keychain, teamId, outDir } = {}) {
  const plan = [
    {
      channel: 'ios-appstore',
      what: 'the signed .ipa the App Store Connect upload takes',
      cwd: `apps/${appSlug}`,
      argv: ['flutter', 'build', 'ipa', '--release', '--export-options-plist', exportOptionsPath],
      produces: `apps/${appSlug}/build/ios/ipa/*.ipa`,
    },
    {
      channel: 'macos-appstore',
      what: 'the signed .app the installer package wraps',
      cwd: `apps/${appSlug}`,
      argv: ['flutter', 'build', 'macos', '--release'],
      produces: `apps/${appSlug}/build/macos/Build/Products/Release/*.app`,
    },
    {
      channel: 'macos-appstore',
      what: 'the .pkg the Mac App Store accepts',
      cwd: `apps/${appSlug}`,
      argv: [
        'productbuild', '--component', 'build/macos/Build/Products/Release/<App>.app', '/Applications',
        '--sign', `3rd Party Mac Developer Installer: <name> (${teamId})`,
        '--keychain', keychain,
        join(outDir ?? '$RUNNER_TEMP', `${appSlug}.pkg`),
      ],
      produces: join(outDir ?? '$RUNNER_TEMP', `${appSlug}.pkg`),
      gap:
        'THE INSTALLER CERTIFICATE IS NOT IN THE REGISTER. A Mac App Store .pkg needs a Mac Installer ' +
        'Distribution identity, which is a DIFFERENT certificate from the Apple Distribution one ' +
        `${ROLE_ENV.p12} carries. No secret is declared for it, so this command is planned and cannot be ` +
        `completed from the declared set. The missing item is part of the ${OWNER_GAP}.`,
    },
  ];
  return plan;
}

/**
 * A newline in a value is REFUSED rather than escaped. `$GITHUB_ENV` is
 * line-oriented, so a value carrying one writes a SECOND assignment of the
 * writer's choosing into the environment of every later step in the job — a
 * secret becomes a way to set PATH. No Apple credential contains a line break,
 * so refusing costs nothing, and the alternative (a heredoc with a random
 * delimiter) only moves the same question to the delimiter.
 */
export function newlineOffenders(pairs) {
  return Object.entries(pairs).filter(([, v]) => /[\r\n]/.test(String(v))).map(([k]) => k);
}

/**
 * A minimal ZIP reader — central directory only, stored and deflated members.
 *
 * The profiles secret carries a SET (one iOS profile, one macOS profile at
 * least), and a set has to arrive in a container. A zip is what every tool on
 * every desk already produces, so it is what is accepted; the alternative — an
 * invented separator between concatenated profiles — would be a format only this
 * repository knows, which nobody would produce correctly under pressure.
 *
 * Only two compression methods exist in practice for a handful of small files
 * and both are handled. Anything else is REFUSED by name rather than skipped:
 * a member silently dropped is a profile silently missing, and the build that
 * follows fails at codesign with a message about entitlements.
 */
export function unzip(buffer) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 0xffff; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) return null;
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;
    const lNameLen = buffer.readUInt16LE(localOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buffer.slice(dataStart, dataStart + compressedSize);
    if (name.endsWith('/')) continue;
    if (method === 0) out.push({ name, bytes: raw });
    else if (method === 8) out.push({ name, bytes: inflateRawSync(raw) });
    else out.push({ name, bytes: null, unsupportedMethod: method });
  }
  return out;
}

/**
 * Turn the decoded profiles blob into named members.
 * A single DER profile (first byte 0x30) and a zip of several are both accepted.
 */
export function profileMembers(bytes) {
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) {
    const entries = unzip(bytes);
    if (entries === null) return { kind: 'zip', members: null };
    return {
      kind: 'zip',
      members: entries.filter((e) => !e.name.split('/').pop().startsWith('.') && !e.name.startsWith('__MACOSX/')),
    };
  }
  if (bytes[0] === 0x30) return { kind: 'single', members: [{ name: 'profile-1.mobileprovision', bytes }] };
  return { kind: 'unknown', members: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE IMPURE HALF — argument handling, the filesystem, and the darwin-only
// execution of the plan above.
// ═════════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

/** 🔴 AN EMPTY STRING IS NOT AN UNSET VARIABLE, and `??` cannot tell them apart.
 *  Recorded on the Android side by mutation, 2026-08-04, and reused unchanged
 *  rather than re-derived: with `GITHUB_ENV=''` the null check passes and the
 *  script crashes with `ENOENT: open ''` AFTER printing a successful posture,
 *  and with `RUNNER_TEMP=''` the key material is written to `resolve('')` — the
 *  CURRENT DIRECTORY, which is the repository, which is the one place this file
 *  exists to keep it out of. Neither can happen on a real runner, and "it cannot
 *  happen in production" is how both survive review. */
const envOr = (name, fallback) => {
  const v = (process.env[name] ?? '').trim();
  return v === '' ? fallback : v;
};

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\napple-signing: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\napple-signing: FAILED');
  process.exit(1);
}

function main() {
  const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const OUT_DIR = resolve(opt('out') ?? envOr('RUNNER_TEMP', tmpdir()));
  const GITHUB_ENV = opt('github-env') ?? envOr('GITHUB_ENV', null);
  const METHOD = opt('method') ?? 'app-store-connect';

  const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

  // ── the register: the authority for the NAMES and for the release lane ─────
  const registerRaw = read(REGISTER);
  if (registerRaw === null) {
    coverageLost([
      `${REGISTER} does not exist.`,
      'It declares the Apple signing secrets and names the workflow that submits to App Store Connect,',
      'which is both halves of how this script decides anything. Without it the decision would be made',
      'blind and would default to "a build proof is fine" — on the one lane where it is not.',
    ]);
  }
  let register;
  try {
    register = JSON.parse(registerRaw);
  } catch (e) {
    coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
  }

  const rows = [];
  for (const id of CHANNEL_IDS) {
    const row = (register.channels ?? []).find((c) => c.id === id);
    if (!row) {
      coverageLost([
        `${REGISTER} declares no "${id}" channel.`,
        'That row is where the Apple signing secrets are enumerated ([9]R-3 limb 2) and where the submission',
        'workflow is declared. With it gone this script would compare its role map to nothing and the release',
        'lane derivation would silently stop recognising a submission run.',
      ]);
    }
    rows.push(row);
  }

  // ── the role map vs the register, both directions, both rows ──────────────
  for (const row of rows) {
    const declared = row.signing?.ciSecrets?.names;
    if (!Array.isArray(declared) || declared.length === 0) {
      coverageLost([
        `${REGISTER}'s ${row.id} row declares no \`signing.ciSecrets.names\`.`,
        'That list is the authority for which secrets are Apple signing material. With it absent this script',
        'would fall back to the copy below, which is the drift it exists to catch.',
      ]);
    }
    const extra = declared.filter((n) => !WANTED.includes(n)).sort();
    const absent = WANTED.filter((n) => !declared.includes(n)).sort();
    if (extra.length || absent.length) {
      coverageLost([
        `${REGISTER}'s ${row.id} row and this script disagree about which secrets sign an Apple build.`,
        extra.length ? `     declared in the register and unknown here: ${extra.join(', ')}` : '',
        absent.length ? `     expected here and not declared in the register: ${absent.join(', ')}` : '',
        'Each name is validated and used differently — one is a PKCS#12, one its passphrase, one a profile',
        'set, one a team identifier — so a name this script does not recognise cannot be handled at all, and',
        'a name it expects that the register has dropped would be read from an environment nobody declared.',
      ].filter((l) => l !== ''));
    }
  }

  // ── which app ──────────────────────────────────────────────────────────────
  const appsRaw = read(APPS);
  if (appsRaw === null) coverageLost([`${APPS} does not exist — there is no app to sign for.`]);
  let apps;
  try {
    apps = JSON.parse(appsRaw);
  } catch (e) {
    coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
  }
  if (!Array.isArray(apps) || apps.length === 0) coverageLost([`${APPS} carries no app entries.`]);
  const appId = opt('app') ?? apps[0]?.slug;
  const app = apps.find((a) => a.slug === appId);
  if (!app) die([`FAIL no app "${appId}" in ${APPS}.`, `     Known: ${apps.map((a) => a.slug).join(', ')}`]);

  // ── is this a release lane? ───────────────────────────────────────────────
  const lane = releaseLane({
    gitRef: process.env.GITHUB_REF ?? '',
    workflowRef: process.env.GITHUB_WORKFLOW_REF ?? '',
    submissionWorkflows: rows.map((r) => r.submission?.workflow).filter((w) => typeof w === 'string'),
  });

  const values = Object.fromEntries(WANTED.map((n) => [n, (process.env[n] ?? '').trim()]));
  const law = secretSetLaw(values);

  console.log(`── Apple signing · app "${app.slug}" · lane requires signing: ${lane.required ? 'YES' : 'no'} ──`);
  for (const r of lane.reasons) console.log(`   required because ${r}`);
  if (!lane.required) console.log('   no release signal (not a tag push, not a declared submission workflow) — a BUILD PROOF is legal here');
  for (const b of lane.blind) console.log(`   ⬜ ${b}`);

  // 🔴 IS EITHER APPLE ROW ARMED? Derived from the rows this script already
  // found by id, out of their own `served` / `submittable` / `lane` fields —
  // there is no channel name in this decision, only the two rows the register
  // handed back. Either row arming makes the release lane fatal: ONE identity
  // signs both, so a partial answer is not on offer.
  const gap = releaseGapVerdict(rows);
  const releaseFatal = lane.required && gap.fatal;

  // ── partial and the missing-on-an-ARMED-release-lane endings ──────────────
  if (law.kind === 'partial' || (law.kind === 'none' && releaseFatal)) {
    die(resolvePosture({ law, required: releaseFatal, armed: gap.armed }).fatal.lines);
  }

  // ── the legal unsigned ending — LABELLED, which is the whole difference ───
  if (law.kind === 'none') {
    // A release lane whose channels are NOT armed. Printed in full and not
    // fatal: no lane in this repository emits an .ipa or a .pkg, so failing
    // would block the release of five ready channels on an enrolment only the
    // owner can buy. Guarded by `lane.required`, so a branch push, a fork PR and
    // the weekly platform proof print exactly what they printed before.
    if (lane.required) {
      console.log('');
      for (const l of unarmedGapLines({
        armings: gap.unarmed,
        secretNames: law.missing,
        laneReasons: lane.reasons,
        ownerItem: `${OWNER_GAP} — there is no distribution certificate to export until the enrolment exists`,
      })) {
        console.log(l);
      }
    }
    console.log('');
    console.log(`⬜ SIGNING POSTURE: ${UNSIGNED_PROOF.toUpperCase()}`);
    console.log(`   🔴 NO APPLE SIGNING SECRETS ARE SET, AND THE REASON IS NOT A MISSING SECRET.`);
    console.log(`   🔴 THE MISSING ITEM IS THE ${OWNER_GAP.toUpperCase()}.`);
    console.log('   Without the enrolment there is no distribution certificate, no provisioning profile and no');
    console.log('   team identifier to put in a secret, so nobody working in this repository can close this.');
    console.log('   🔴 AN UNSIGNED BUNDLE CANNOT BE UPLOADED TO APP STORE CONNECT. This artifact is a build');
    console.log('      proof: it proves the Apple modules compile, and nothing about a signing identity.');
    console.log('   This is the correct outcome for a branch, a fork PR and the weekly platform proof.');
    exportEnv({ [POSTURE_ENV]: UNSIGNED_PROOF }, GITHUB_ENV);
    console.log('\napple-signing: OK (unsigned build proof, labelled)');
    process.exit(0);
  }

  // ═══ all four supplied ═════════════════════════════════════════════════════
  // Every value is validated BEFORE anything is written. The Android script
  // learned this the expensive way: its first live run wrote the keystore and
  // then refused the export, leaving a real key on disk from a run that failed.
  const teamId = values[ROLE_ENV.teamId];
  const teamProblem = teamIdProblem(teamId);
  if (teamProblem !== null) die([`FAIL ${teamProblem}`]);

  const p12 = decodeB64(values[ROLE_ENV.p12], ROLE_ENV.p12);
  // A PKCS#12 is DER: a SEQUENCE, first byte 0x30. Structure, not a size floor —
  // an invented minimum length would fire on a correct small file and pass a
  // padded stub. The usual real-world failure is base64 of an HTML error page.
  if (p12[0] !== 0x30) {
    die([
      `FAIL ${ROLE_ENV.p12} decodes to ${p12.length} byte(s) that are not a PKCS#12.`,
      `     Expected DER (first byte 0x30); found 0x${p12[0]?.toString(16).padStart(2, '0') ?? '--'}.`,
      '     No part of the value is printed. The usual cause is base64 of the wrong file, or of an error',
      '     page a download produced. Re-export the identity from Keychain Access as a .p12 and re-encode it.',
    ]);
  }

  const profileBytes = decodeB64(values[ROLE_ENV.profiles], ROLE_ENV.profiles);
  const { kind: blobKind, members } = profileMembers(profileBytes);
  if (members === null) {
    die([
      `FAIL ${ROLE_ENV.profiles} decodes to ${profileBytes.length} byte(s) this script cannot read as profiles.`,
      `     Detected shape: ${blobKind}. Expected either ONE .mobileprovision/.provisionprofile (DER, first`,
      '     byte 0x30) or a ZIP containing them. No part of the value is printed.',
    ]);
  }
  const unsupported = members.filter((m) => m.bytes === null);
  if (unsupported.length) {
    die([
      `FAIL ${ROLE_ENV.profiles} is a zip whose member(s) use a compression method this script cannot read:`,
      ...unsupported.map((m) => `       ${m.name} (method ${m.unsupportedMethod})`),
      '     Skipping a member would silently drop a provisioning profile, and the build that follows fails at',
      '     codesign with a message about entitlements. Re-create the archive with stored or deflated entries.',
    ]);
  }

  const parsed = [];
  for (const m of members) {
    const p = parseMobileProvision(m.bytes);
    if (p === null) {
      die([
        `FAIL ${ROLE_ENV.profiles} carries a member that is not a provisioning profile: ${m.name}`,
        '     A provisioning profile is a CMS envelope with an XML plist inside; this member has no plist.',
        '     No part of the value is printed.',
      ]);
    }
    parsed.push({ ...p, member: m.name });
  }
  if (parsed.length === 0) {
    coverageLost([
      `${ROLE_ENV.profiles} yielded ZERO profiles after decoding.`,
      'Every cross-check below would have ranged over an empty list and printed ok, which is this',
      "repository's single most repeated failure.",
    ]);
  }

  // The team cross-check. A profile from a DIFFERENT team than the one
  // xcodebuild is told to use produces a build that codesigns and is refused at
  // upload — the failure surfaces at the store, which is the one place this
  // repository has decided failures must not surface.
  const wrongTeam = parsed.filter((p) => !p.teamIds.includes(teamId));
  if (wrongTeam.length) {
    die([
      `FAIL ${ROLE_ENV.profiles} carries profile(s) belonging to a different team than ${ROLE_ENV.teamId}.`,
      ...wrongTeam.map((p) => `       ${p.member} — "${p.name}" belongs to ${p.teamIds.join(', ') || '(no team)'}`),
      '     A profile binds the certificate to a bundle id and its entitlements FOR ONE TEAM. Signing with a',
      '     mismatched pair produces a valid signature that App Store Connect refuses, after the upload.',
      `     The team identifier itself is not printed above beyond what the profiles declare.`,
    ]);
  }

  const now = Date.now();
  const expired = parsed.filter((p) => p.expires !== null && Date.parse(p.expires) < now);
  if (expired.length) {
    die([
      `FAIL ${ROLE_ENV.profiles} carries EXPIRED provisioning profile(s).`,
      ...expired.map((p) => `       ${p.member} — "${p.name}" expired ${p.expires}`),
      '     An expired profile fails at codesign, several minutes into a build, with a message about',
      '     entitlements rather than about a date. Re-download it from the Apple Developer portal.',
    ]);
  }

  // ── the fourth ending: this platform cannot arrange anything ──────────────
  const decided = resolvePosture({ law, required: lane.required });
  if (decided.fatal !== null) die(decided.fatal.lines);

  // ── nothing was written until here ────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const p12Path = join(OUT_DIR, `${app.slug}-distribution.p12`);
  const keychain = join(OUT_DIR, `${app.slug}-signing.keychain-db`);
  const profileDir = join(OUT_DIR, `${app.slug}-profiles`);
  const exportOptionsPath = join(OUT_DIR, `${app.slug}-ExportOptions.plist`);
  if (!isAbsolute(p12Path) || !isAbsolute(keychain)) {
    coverageLost([
      `the resolved key-material paths are not absolute (${p12Path}).`,
      '`security` resolves a relative keychain against the working directory, which for a CI job is the',
      'repository — the one place this file exists to keep key material out of.',
    ]);
  }
  // 0600 on a POSIX runner. Written outside the workspace either way.
  writeFileSync(p12Path, p12, { mode: 0o600 });
  mkdirSync(profileDir, { recursive: true });
  for (const p of parsed) {
    const member = members.find((m) => m.name === p.member);
    writeFileSync(join(profileDir, p.member.split('/').pop()), member.bytes, { mode: 0o600 });
  }
  writeFileSync(exportOptionsPath, exportOptionsPlist({ teamId, method: METHOD, profiles: parsed }));

  // ── the keychain ──────────────────────────────────────────────────────────
  const keychainPassword = randomBytes(24).toString('base64url');
  const plan = keychainPlan({
    keychain,
    keychainPassword,
    p12Path,
    p12Password: values[ROLE_ENV.p12Password],
    existingKeychains: existingUserKeychains(),
  });
  const secrets = [keychainPassword, values[ROLE_ENV.p12Password], values[ROLE_ENV.p12], values[ROLE_ENV.profiles]];

  console.log('');
  for (const step of plan) {
    console.log(`   $ ${redactArgv(step.argv, secrets).join(' ')}`);
    const r = spawnSync(step.argv[0], step.argv.slice(1), { encoding: 'utf8' });
    if (r.error || r.status !== 0) {
      die([
        `FAIL \`security ${step.argv[1]}\` failed — ${step.why}.`,
        `     ${redactArgv([...(r.stderr ?? '').trim().split('\n')], secrets).join(' ')}`,
        '     The keychain is in $RUNNER_TEMP and the runner destroys it with the job; nothing needs',
        '     unpicking by hand. No password appears in this output.',
      ]);
    }
  }

  exportEnv(
    {
      [POSTURE_ENV]: RELEASE_SIGNED,
      [ROLE_ENV.teamId]: teamId,
      APPLE_KEYCHAIN_PATH: keychain,
      APPLE_EXPORT_OPTIONS_PLIST: exportOptionsPath,
      APPLE_PROVISIONING_PROFILES_DIR: profileDir,
    },
    GITHUB_ENV,
  );

  console.log('');
  console.log(`ok   distribution identity imported into a per-run keychain — ${p12.length} byte(s), outside the workspace`);
  console.log(`ok   ${parsed.length} provisioning profile(s) decoded, team-checked and in date:`);
  for (const p of parsed) console.log(`        "${p.name}" → ${p.bundleId ?? '(no application-identifier)'} · expires ${p.expires ?? 'unstated'}`);
  console.log(`ok   ExportOptions.plist written (method "${METHOD}", signingStyle manual)`);
  console.log('');
  console.log('   ── the signed-export intents, with the paths this step produced ──');
  for (const step of signedExportPlan({ appSlug: app.slug, exportOptionsPath, keychain, teamId, outDir: OUT_DIR })) {
    console.log(`   [${step.channel}] ${step.what}`);
    console.log(`      $ (cd ${step.cwd} && ${step.argv.join(' ')})`);
    if (step.gap) console.log(`      🔴 ${step.gap}`);
  }
  console.log('');
  console.log(`⬜ SIGNING POSTURE: ${RELEASE_SIGNED.toUpperCase()}`);
  console.log('   This says what was ARRANGED, not what xcodebuild did.');
  console.log('   tooling/ci/assert-artifact-signed-apple.mjs reads the signature back out of the built bundle');
  console.log('   with `codesign -dvv` and fails if the real signer disagrees with this line.');
  console.log('\napple-signing: OK');
}

/** Base64 that is not base64 decodes to SOMETHING — `Buffer.from` ignores what
 *  it cannot read rather than throwing — so a secret pasted with a stray
 *  fragment truncates silently and is discovered later, by a tool, in a message
 *  about a file format. Re-encoding and comparing is the only way to see it. */
function decodeB64(raw, name) {
  const b64 = String(raw).replace(/\s+/g, '');
  if (b64 === '') coverageLost([`${name} is whitespace only after trimming — it passed the presence check and carries nothing.`]);
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) {
    die([
      `FAIL ${name} is not valid base64 (it decodes to ${bytes.length} byte(s) and does not round-trip).`,
      '     The value is never printed. Re-create it with a tool that emits a single unbroken base64 string,',
      '     and paste it without added line breaks or quotes.',
    ]);
  }
  return bytes;
}

/** The current user search list, so adding ours does not REMOVE the system one.
 *  `security list-keychains -s` REPLACES the list; the shorter form that passes
 *  only our keychain works right up until something else in the job needs the
 *  login keychain, and then fails somewhere unrelated. */
function existingUserKeychains() {
  const r = spawnSync('security', ['list-keychains', '-d', 'user'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return [];
  return [...String(r.stdout ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Append to $GITHUB_ENV so every later step in the job sees the same complete
 * set.
 *
 * 🔴 ALL OF THEM OR NONE, AND THAT IS WHY THIS IS ONE CALL. Exporting only the
 * keychain path — the tidier-looking option — makes every other reader of the
 * environment see one variable of several and conclude the configuration is
 * HALF supplied, which is a state this repository refuses on purpose.
 */
function exportEnv(pairs, githubEnv) {
  const offenders = newlineOffenders(pairs);
  if (offenders.length) {
    die([
      `FAIL the value for ${offenders.join(', ')} contains a line break, and $GITHUB_ENV is line-oriented.`,
      '     Writing it would inject a second, attacker-chosen assignment into the job environment.',
      '     Re-create the secret without the trailing newline. The value itself is never printed.',
    ]);
  }
  if (githubEnv === null) {
    // Not a failure: this script is runnable by hand. It is also not a silent
    // pass — assert-artifact-signed-apple.mjs requires APPLE_SIGNING_POSTURE and
    // refuses to run without it, so a build in which this export did not happen
    // fails there rather than proceeding unlabelled.
    console.log('');
    console.log('⬜ NOT EXPORTED — no $GITHUB_ENV and no --github-env, so nothing was written for later');
    console.log('   steps. Outside a GitHub job that is expected. Inside one it is a wiring fault, and');
    console.log('   assert-artifact-signed-apple.mjs refuses to run without APPLE_SIGNING_POSTURE.');
    for (const k of Object.keys(pairs)) console.log(`   would export: ${k}`);
    return;
  }
  appendFileSync(githubEnv, `${Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
