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
// both directions, PER ROW — the two rows do NOT declare the same set, and
// comparing one list against both is the defect the role map's own header
// records and dates. Two copies of a list drift; two copies that are compared
// cannot drift silently. Renaming a secret in the register without
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
// repository secret would be worse in every direction: it would be one more
// name to keep in step, one more rotation obligation, and a long-lived value
// protecting a keychain that exists for the length of one job in a directory
// the runner destroys — while the credential it guards is already in that job's
// environment. A per-run random value cannot leak from a previous run because
// there is no previous run to leak from.
//
// ── ⬜ A GAP THIS SCRIPT PRINTS AND CANNOT CLOSE ─────────────────────────────
// A Mac App Store `.pkg` needs TWO certificates: an application certificate
// (Apple Distribution / 3rd Party Mac Developer Application) to sign the .app,
// and an INSTALLER certificate (Mac Installer Distribution / 3rd Party Mac
// Developer Installer) to sign the package `productbuild` produces. Since
// 2026-08-20 the register declares BOTH — `APPLE_DIST_CERT_P12_BASE64` on both
// Apple rows and `APPLE_INSTALLER_CERT_P12_BASE64` on macos-appstore alone — so
// what is missing is no longer the NAME, it is the certificate: nothing can
// issue one until the account exists. The macos-appstore `.pkg` intent below is
// therefore planned and printed rather than run, and nothing in this file
// imports an installer identity into the keychain. That is printed on every run
// rather than failing the build, because the missing item is an owner action on
// an account that does not exist yet (OWNER_QUEUE A-4) and a guard that blocks
// CI on work only the owner can do blocks every merge in the repository.
//
// Usage:
//   node tooling/ci/apple-signing.mjs [--app <slug>] [--out <dir>]
//                                     [--repo-root <path>] [--github-env <path>]
//                                     [--method <app-store-connect|…>]
// Env in:  the four names WANTED below (the register declares them on both Apple
//          rows; the fifth, row-only name is recognised and never read here)
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
/** BOTH Apple rows. One Apple Developer account and one distribution identity
 *  serve two App Store Connect records, so the two rows share the four names
 *  `WANTED` below — but they are NOT required to declare the same set, and
 *  saying they were is what broke this file (see the role map). macos-appstore
 *  carries one name iOS cannot use; the comparison is therefore per row. */
export const CHANNEL_IDS = ['ios-appstore', 'macos-appstore'];

export const POSTURE_ENV = 'APPLE_SIGNING_POSTURE';
export const RELEASE_SIGNED = 'release-signed';
export const UNSIGNED_PROOF = 'unsigned-build-proof';

/**
 * The role map. Every name here must appear in the declared set of the row it
 * belongs to, and vice versa — checked on every run, both directions, per row.
 *
 * 🔴 THE DEFECT THIS SHAPE CLOSES, AND IT WAS LIVE, NOT LATENT. Until
 * 2026-08-21 this map held FOUR names and `main()` compared the same four
 * against BOTH rows. Commit 2d2f51b (2026-08-20) added a FIFTH name —
 * `APPLE_INSTALLER_CERT_P12_BASE64` — to the macos-appstore row ALONE, and the
 * comparison had no way to say "this row, not that one", so it read a correct
 * declaration as drift. Measured on a clean tree 2026-08-21:
 * `node tooling/ci/apple-signing.mjs --app subly` → EXIT 1, "FAIL COVERAGE LOST
 * — …macos-appstore row and this script disagree… declared in the register and
 * unknown here: APPLE_INSTALLER_CERT_P12_BASE64". The `apple` job's only
 * invocation of this script — search `build-platforms.yml` for the line
 * `run: node tooling/ci/apple-signing.mjs --app`, which was :942 on 2026-08-21;
 * the anchor is the text, not the number — carries no `if:` guard, and
 * `continue-on-error:` is set on no job and no step in this repository
 * (measured 2026-08-21 over `.github/workflows/`: the literal string occurs
 * exactly twice, both inside `#` comments in deploy-web.yml — so zero
 * occurrences as a key), so the `apple` job failed on EVERY lane and the
 * `release` job that `needs:` it could not run — tag or no tag.
 *
 * ⚠️ THE TWO ROWS DO NOT DECLARE THE SAME SET, AND THAT IS THE RECORD RATHER
 * THAN A CONVENIENCE. The register's own `why` for the fifth name says it in
 * capitals: macOS only, do not copy it onto ios-appstore, because iOS ships an
 * .ipa and needs no installer certificate at all — declaring it there would name
 * a credential that lane can never use. So `ROW_ONLY_ENV` below is scoped, and a
 * name appearing on the wrong row is still COVERAGE LOST.
 *
 * ⚠️ WHAT THIS DOES NOT CATCH — said plainly, because an overclaiming comment
 * here would be worse than none:
 *   · the installer certificate is RECOGNISED, never ARRANGED. It is deliberately
 *     outside `WANTED`, so the all-or-none law does not range over it, nothing
 *     reads it from the environment, and supplying the other four still resolves
 *     to `release-signed`. The `productbuild` step stays a printed intent.
 *   · nothing here compares the register to the WORKFLOW. "A secret is declared
 *     and no lane names it" is assert-channel-register.mjs §8's subject, and §8
 *     prints that case rather than failing it.
 *   · a name on the wrong ROW is caught; a name given the wrong ROLE is not. The
 *     keys below are this file's own vocabulary and the register does not carry
 *     them, so swapping `p12` and `profiles` would pass this comparison and fail
 *     later, at a byte validator.
 */
export const ROLE_ENV = Object.freeze({
  p12: 'APPLE_DIST_CERT_P12_BASE64',
  p12Password: 'APPLE_DIST_CERT_PASSWORD',
  profiles: 'APPLE_PROVISIONING_PROFILES_BASE64',
  teamId: 'APPLE_TEAM_ID',
  installerP12: 'APPLE_INSTALLER_CERT_P12_BASE64',
});

/** The names this script READS FROM THE ENVIRONMENT and arranges into a keychain.
 *  Both Apple rows declare exactly these, and the all-or-none law ranges over
 *  exactly these. A name that arrives here starts being required of every row. */
export const WANTED = Object.freeze([ROLE_ENV.p12, ROLE_ENV.p12Password, ROLE_ENV.profiles, ROLE_ENV.teamId]);

/** Names one row declares and the other must not, keyed by that row's channel id.
 *
 *  🔴 `WANTED` AND THIS MAP MUST PARTITION `ROLE_ENV`, AND A TEST SAYS SO. These
 *  are the file's second and third enumerations of the same names; a role added
 *  to `ROLE_ENV` alone would be KNOWN and yet reachable from neither, so
 *  `expectedNames()` would never expect it and `homeRowOf()` would return null
 *  for it while the printed message insisted it had a home row. The pin is the
 *  test named `WANTED and ROW_ONLY_ENV PARTITION ROLE_ENV` in
 *  test/apple-signing.test.mjs — added 2026-08-21, and it goes red on a sixth
 *  role that reaches neither list, or on a name that reaches both. */
export const ROW_ONLY_ENV = Object.freeze({
  'macos-appstore': Object.freeze([ROLE_ENV.installerP12]),
});

/** The exact set a given row must declare: the shared four plus its own. */
export function expectedNames(channelId) {
  return [...WANTED, ...(ROW_ONLY_ENV[channelId] ?? [])];
}

/**
 * The bidirectional comparison, for ONE row.
 *   extra     — declared there, unknown here. A new credential nobody taught
 *               this file about, so it cannot be validated or used at all.
 *   absent    — expected here, not declared there. It would be read from an
 *               environment nobody declared.
 *   misplaced — the sharp subset of `extra`: a name this file DOES know, sitting
 *               on a row it does not belong to. That reads as a copy-paste
 *               between two adjacent rows rather than as a new secret, so it is
 *               named separately with the row it actually belongs to.
 */
export function registerDrift(channelId, declared) {
  const expected = expectedNames(channelId);
  const known = Object.values(ROLE_ENV);
  const list = Array.isArray(declared) ? declared : [];
  const extra = list.filter((n) => !expected.includes(n)).sort();
  return {
    extra,
    absent: expected.filter((n) => !list.includes(n)).sort(),
    misplaced: extra.filter((n) => known.includes(n)),
  };
}

/** Which row a row-only name belongs to, so a misplacement can say where it goes. */
export function homeRowOf(name) {
  return Object.entries(ROW_ONLY_ENV).find(([, names]) => names.includes(name))?.[0] ?? null;
}

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
// platform, and only the `security` invocations are gated on
// `process.platform === 'darwin'`.
//
// 🔴 CORRECTED 2026-08-21 — THIS LINE SAID "the FOUR `security` invocations" AND
// THE NUMBER WAS FALSE. Re-measured today by importing this module and calling
// the function: `keychainPlan()` returns SIX steps and `argv[0] === 'security'`
// on all six — create-keychain, set-keychain-settings, unlock-keychain, import,
// set-key-partition-list, list-keychains. Their identity and ORDER are pinned by
// the test named `the keychain is created, unlocked and imported into — in that
// order`, so this prose is no longer the only copy of the count. A SEVENTH
// `security` call sits on the same darwin-gated path and is not part of the
// plan: `existingUserKeychains()` reads the current user search list so the
// sixth step can EXTEND it instead of replacing it. The test file's header
// already said "six"; this box was the copy that drifted — which is the whole
// argument for pinning a count in a test rather than in a sentence.
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
        'THE INSTALLER CERTIFICATE IS DECLARED AND DOES NOT EXIST. A Mac App Store .pkg needs a Mac ' +
        'Installer Distribution identity, which is a DIFFERENT certificate from the Apple Distribution ' +
        `one ${ROLE_ENV.p12} carries — that one signs the .app INSIDE the package and cannot sign the ` +
        'package itself. As of 2026-08-20 the macos-appstore row DECLARES ' +
        '`APPLE_INSTALLER_CERT_P12_BASE64` with its reason, so the name is no longer missing from the ' +
        'register; what is missing is the certificate, which nothing can issue until ' +
        `${OWNER_GAP} creates the account. This command stays PLANNED and unrunnable, and the ` +
        'sentence says which of the two gaps it is — they close on different days and by different ' +
        'people.',
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

/** ZIP64 marks an absent 32-bit value with an all-ones sentinel and carries the
 *  real one in a 64-bit field elsewhere. 0xFFFFFFFF read as an offset is how
 *  the Windows leg crashed; these two names exist so that number never appears
 *  bare in a comparison again. */
const U32_SENTINEL = 0xffffffff;
const U16_SENTINEL = 0xffff;

/**
 * The ZIP64 extended-information extra field (header id 0x0001) of ONE
 * central-directory entry, or null when it is absent or unusable.
 *
 * 🔴 THE SLOTS ARE POSITIONAL AND CONDITIONAL, WHICH IS THE WHOLE DIFFICULTY.
 * APPNOTE 4.5.3 orders them uncompressed size, compressed size, local-header
 * offset, disk-start — and each 8-byte slot is present ONLY IF its 32-bit
 * counterpart in the fixed header was the sentinel. So a reader that wants the
 * compressed size cannot simply take slot 0: it must first ask whether the
 * UNCOMPRESSED size was a sentinel too, and step over that slot if it was. Both
 * shapes occur inside ONE real archive — a 16-byte payload (two sizes, real
 * offset) for the first member and a 24-byte one (two sizes and the offset) for
 * every later member, because the first member sits at offset 0 and 0 needs no
 * 64-bit field. Measured on the fixture this change is tested against.
 *
 * `whichPresent` is therefore the CALLER'S reading of the fixed header, never a
 * guess made here. Anything that does not add up — a truncated payload, no
 * 0x0001 field at all, a value larger than the archive that contains it — is
 * REFUSED as null rather than approximated, and unzip() turns that into "not a
 * readable zip", which both callers already treat as a failure.
 */
function zip64ExtraFields(buffer, extraStart, extraLen, whichPresent) {
  const end = extraStart + extraLen;
  if (end > buffer.length) return null;
  for (let q = extraStart; q + 4 <= end; ) {
    const id = buffer.readUInt16LE(q);
    const size = buffer.readUInt16LE(q + 2);
    const payloadEnd = q + 4 + size;
    if (payloadEnd > end) return null;
    if (id !== 0x0001) { q = payloadEnd; continue; }
    let r = q + 4;
    // Read one 8-byte slot, bounded by the PAYLOAD only. Whether the VALUE is
    // credible depends on what the slot means, which is the caller's business
    // below and not this reader's.
    const slot = () => {
      if (r + 8 > payloadEnd) return null;
      const v = buffer.readBigUInt64LE(r);
      r += 8;
      return v;
    };
    // 🔴 THIS BOUND IS TRUE OF AN OFFSET AND OF A COMPRESSED SIZE, AND FALSE OF
    // AN UNCOMPRESSED ONE. Nothing inside this archive can START past its end,
    // and no member's stored bytes can be more numerous than the file holding
    // them — but a member's UNCOMPRESSED size is a property of the decompressed
    // content and is routinely LARGER than the whole archive. That is what
    // compression is.
    //
    // MEASURED 2026-08-25 on the real subly.msix (build-platforms 32823633046,
    // the first run to keep the package after the guard refused it): entry [2]
    // `flutter_windows.dll` declares an uncompressed size of 21,284,864 bytes
    // inside a 16,585,733-byte archive — 1.28x the file that contains it, and
    // entirely ordinary for a DLL. Applying the offset bound to that slot
    // returned null, which unzip() turned into "could not be read as a zip",
    // which the guard reported as COVERAGE LOST over the whole package. A check
    // added for safety was the thing refusing a valid package.
    //
    // The uncompressed slot is READ ONLY TO STEP OVER IT — its value is
    // discarded — so it needs the payload bound and nothing else.
    const withinArchive = (v) => (v === null || v > BigInt(buffer.length) ? null : Number(v));
    const out = {};
    if (whichPresent.uncompressedSize && slot() === null) return null;
    if (whichPresent.compressedSize) {
      const v = withinArchive(slot());
      if (v === null) return null;
      out.compressedSize = v;
    }
    if (whichPresent.localOffset) {
      const v = withinArchive(slot());
      if (v === null) return null;
      out.localOffset = v;
    }
    return out;
  }
  return null;
}

/**
 * A minimal ZIP reader — central directory only, stored and deflated members,
 * ZIP64 included. TWO CALLERS, ON TWO PLATFORMS:
 *
 *   • profileMembers() below, for the APPLE provisioning-profile bundle the
 *     profiles secret carries. That secret holds a SET (one iOS profile, one
 *     macOS profile at least), and a set has to arrive in a container. A zip is
 *     what every tool on every desk already produces, so it is what is
 *     accepted; the alternative — an invented separator between concatenated
 *     profiles — would be a format only this repository knows, which nobody
 *     would produce correctly under pressure.
 *   • tooling/ci/assert-artifact-signed-msix.mjs, for the WINDOWS .msix that
 *     `dart run msix:create` writes, opened to read AppxManifest.xml and to
 *     prove AppxSignature.p7x is ABSENT.
 *
 * 🔴 THIS COMMENT USED TO CLAIM THE NARROW SCOPE, AND THAT CLAIM COST THE
 * WINDOWS LEG WEEKS. It said the reader existed for "a handful of small files",
 * "one iOS profile, one macOS profile" — while the msix guard had been
 * importing it the whole time. The stated domain and the real one disagreed,
 * and the code was correct for the stated one, so the header read like an
 * explanation instead of like a bug. MEASURED on build-platforms run
 * 32814517717 (2026-08-25, the first dispatch to get past the argv defect
 * PR #366 fixed): the 16,585,912-byte .msix made this function throw
 * `RangeError [ERR_OUT_OF_RANGE] … Received 4294967295`, and the guard CRASHED
 * instead of reporting anything. The other five platforms were green on that
 * same run.
 *
 * 🔴 AND ZIP64 IS NOT A ">4 GB" FEATURE HERE. 4294967295 is 0xFFFFFFFF, the
 * ZIP64 sentinel, in a package of 16.6 MB. An .msix is an OPC/APPX package and
 * the packaging tool writes the ZIP64 end-of-central-directory record, its
 * locator and the sentinels REGARDLESS OF SIZE. A reader that handles only the
 * 32-bit fields is not "enough for small archives"; it is enough for archives
 * whose WRITER chose not to use ZIP64, which is a property of the tool and not
 * of the bytes.
 *
 * The ZIP64 path is entered ONLY where a sentinel is actually present, so an
 * archive carrying none — every zip an Apple desk produces today — is read by
 * exactly the statements that read it before, in the same order. That is not a
 * claim: test/apple-signing.test.mjs pins the whole non-ZIP64 answer set,
 * truncations and byte corruptions included.
 *
 * Only two compression methods exist in practice for the files either caller
 * hands over and both are handled. Anything else is REFUSED by name rather than
 * skipped: a member silently dropped is a profile silently missing, and the
 * build that follows fails at codesign with a message about entitlements.
 */
export function unzip(buffer) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 0xffff; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) return null;
  let count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);

  // ── ZIP64, entered only where the 32-bit record says it cannot answer ──────
  // The locator sits immediately before the EOCD and points at the EOCD64
  // record, which carries the real entry count and central-directory offset.
  // A sentinel with no locator behind it is not a zip this reader can open, and
  // saying so with null — the answer both callers already handle — is the whole
  // difference between a verdict and an ERR_OUT_OF_RANGE stack trace.
  if (count === U16_SENTINEL || p === U32_SENTINEL) {
    const loc = eocd - 20;
    if (loc < 0 || buffer.readUInt32LE(loc) !== 0x07064b50) return null;
    const rec = buffer.readBigUInt64LE(loc + 8);
    if (rec + 56n > BigInt(buffer.length)) return null;
    const recAt = Number(rec);
    if (buffer.readUInt32LE(recAt) !== 0x06064b50) return null;
    if (count === U16_SENTINEL) {
      const total = buffer.readBigUInt64LE(recAt + 32);
      if (total > BigInt(buffer.length)) return null;
      count = Number(total);
    }
    if (p === U32_SENTINEL) {
      const off = buffer.readBigUInt64LE(recAt + 48);
      if (off > BigInt(buffer.length)) return null;
      p = Number(off);
    }
  }

  const out = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(p + 10);
    let compressedSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    let localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.slice(p + 46, p + 46 + nameLen).toString('utf8');
    // The per-entry half of the same story. `p + 24` — the uncompressed size —
    // is read INSIDE the branch because that is the only place its value means
    // anything: it says whether the extra field's first slot belongs to it.
    // ⚠️ AND THAT IS A PREFERENCE, NOT A PINNED PROPERTY. Hoisting it beside
    // the other fixed reads was MUTATED on 2026-08-25 and the suite stayed
    // GREEN — both placements answer identically for every archive the tests
    // can build, because the only input that could tell them apart is one where
    // p+24 is off the end while p+20 is not, and BOTH placements throw
    // ERR_OUT_OF_RANGE there. Saying so here is cheaper than a test that
    // pretends to hold the line.
    if (compressedSize === U32_SENTINEL || localOffset === U32_SENTINEL) {
      const z = zip64ExtraFields(buffer, p + 46 + nameLen, extraLen, {
        uncompressedSize: buffer.readUInt32LE(p + 24) === U32_SENTINEL,
        compressedSize: compressedSize === U32_SENTINEL,
        localOffset: localOffset === U32_SENTINEL,
      });
      if (z === null) return null;
      if (z.compressedSize !== undefined) compressedSize = z.compressedSize;
      if (z.localOffset !== undefined) localOffset = z.localOffset;
    }
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
    const { extra, absent, misplaced } = registerDrift(row.id, declared);
    if (extra.length || absent.length) {
      coverageLost([
        `${REGISTER}'s ${row.id} row and this script disagree about which secrets sign an Apple build.`,
        extra.length ? `     declared in the register and unknown here: ${extra.join(', ')}` : '',
        absent.length ? `     expected here and not declared in the register: ${absent.join(', ')}` : '',
        ...misplaced.map(
          (n) =>
            `     ⚠️ ${n} IS known here — but only on the ${homeRowOf(n)} row, and the ${row.id} lane can ` +
            'never use it. This reads as a copy between two adjacent rows, not as a new credential.',
        ),
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
