#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-store-build-config.mjs — a build destined for a STORE may not be the
// demo build.
//
// 🔴 WHY THIS EXISTS — the second half of a defect found on 2026-08-04, and the
// same shape as the first. `build-platforms.yml`'s Google Play step read:
//
//     flutter build appbundle --release --dart-define=GLITCHTIP_DSN=…
//
// …and nothing else. `AppConfig.isBackendLive` is
// `isSupabaseConfigured && isApiConfigured`, and both compare a dart-define
// against a PLACEHOLDER constant. With no defines supplied both stay at their
// placeholders, so the bundle intended for Google Play resolved
// `MockAuthRepository()` and `SeedApiClient()` — mock sign-in and seeded data —
// and the analytics/consent rails went inert. The .aab was debug-signed AND a
// demo build; signing was only half of why that upload would have been wrong.
//
// 📌 BOTH HALVES ARE ONE FAILURE MODE: A RELEASE LANE SILENTLY DEGRADING TO A
// NON-PRODUCTION DEFAULT. In both cases the fallback is correct somewhere — a
// keyless build proof is what the weekly six-platform run is for, and demo mode
// is what lets a stranger clone this repo and see every screen without a
// backend. In both cases nothing distinguished "correct here" from "wrong here",
// and in both cases the first thing that would have noticed was a store.
//
// ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
// Every `flutter build` step that produces an artifact for a `kind: store`
// channel supplies every dart-define `AppConfig.isBackendLive` needs.
// ⏱ 2026-09-22 — CORRECTION APPENDED, the sentence above left as written: every
// RELEASE `flutter build` in this repository that produces an artifact for a
// `kind: store` OR a `kind: direct` channel (O-DIRECT-DOWNLOADS-NEVER-GRADED).
//
// ── ⚠️ NEITHER SIDE OF THAT SENTENCE IS WRITTEN DOWN HERE ────────────────────
//   · THE REQUIRED DEFINES ARE DERIVED FROM app_config.dart. The guard reads
//     `isBackendLive`, follows the getters it names, and maps the fields those
//     reach back to their `String.fromEnvironment` keys. Hard-coding
//     {SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL} would freeze today's
//     answer: a fourth requirement added to `isBackendLive` next year would be
//     missing from every store artifact with this guard still printing ok. That
//     is the failure this repository has recorded most often.
//   · THE SUBJECT LANES ARE DERIVED FROM tooling/channel-register.json. A step
//     is graded when it builds for a platform of a `kind: store` row, inside a
//     job that row DECLARES as its `lane` or its `submission`. Naming workflows
//     here would point the guard at whatever shipped the day it was written —
//     "a guard pointed at a lane nobody ships from" is this repo's most-recorded
//     failure, and the register is the one place that says which lane is which.
//     ⏱ 2026-09-22 — CORRECTION APPENDED, the paragraph above left as written
//     (O-STORE-BUILD-GUARD-GRADES-DECLARED-JOBS-ONLY): THE SUBJECT BUILDS ARE NOW
//     A CENSUS OF THE WORKFLOWS, placed by the register. workflow-scan.mjs
//     `flutterReleaseBuilds` finds EVERY release `flutter build` in every
//     workflow; each one is placed against a channel row by the RELEASE_CHANNEL
//     it stamps into itself. The register still names no workflow here — it
//     places builds; it no longer chooses which ones are looked at.
//     THIS USED TO READ `row.lane` AND `row.submission`, AND THE
//     REGISTER SAYS IN ITS OWN `_why` THAT THOSE FIELDS NAME THE DRY RUN AND ARE A
//     FLOOR, NOT A CENSUS. Measured at f88912e5: the old domain scored 13 step
//     counts over 12 distinct builds out of 16 that ship; deleting SUPABASE_URL
//     from submit-play.yml's `submit` job — the job that builds the .aab Google
//     Play receives — left this guard exiting 0, printing OK. The same mutation
//     now exits 1 and names the step.
//
// ── WHAT IS DELIBERATELY NOT GRADED ──────────────────────────────────────────
//   · Any lane a store row does not declare. build-platforms.yml's `apple` job
//     builds iOS and macOS and is NOT the App Store rows' lane (they declare
//     none) — it is a six-platform BUILD PROOF, and a proof of compilation does
//     not need production credentials.
//   · The web build, the Linux build, e2e's debug build, and every fork PR.
//     A fork holds no secrets, so a rule reaching them could only ever fail on
//     correct input, and a guard that does that gets deleted by whoever hits it.
//   ⏱ 2026-09-22 — CORRECTION APPENDED, the two bullets above left as written:
//   · "Any lane a store row does not declare" is GONE as an exclusion. A build is
//     excused only where the register says its OUTPUT IS THROWN AWAY:
//     `releaseBuildsNeverShipped` names ci.yml's brick smoke build and
//     symbolication-proof.yml's crash fixture, each with its reason, printed on
//     every run. A build-proof job whose builds stamp no row stays outside this
//     guard because it produces no store or direct artifact, not because nobody
//     named it — and 6b-ii of assert-channel-register fails any such build that
//     stamps nothing and is not in that key.
//   · "the Linux build" is GONE from the second bullet. It is the build the
//     `linux-appimage` row (kind: direct) ships from, stamped for that row: it
//     passed no SUPABASE_URL, no SUPABASE_ANON_KEY and no API_BASE_URL, so the
//     day that row is served its download would be the demo build, with this
//     guard printing ok (O-DIRECT-DOWNLOADS-NEVER-GRADED). Latent today — the
//     row is served:false and only the raw bundle leaves the job, as an artifact.
//     A debug or profile build and every fork PR stay outside, for the reason given.
//   · The WEB build stays outside THIS rule: it belongs to the `kind: web` row,
//     which ships from deploy-web.yml with all three defines and is graded by W1
//     below for the web-only set instead.
//   · WHETHER THE VALUES ARE RIGHT. This reads workflow structure; it cannot see
//     a secret's contents, so a store lane wired to a STAGING Supabase passes
//     here. Printed on every run rather than left implied.
//
// ── ⏱ 2026-09-15 · THE SECOND QUESTION: A WEB-ONLY DEFINE, GRADED BOTH WAYS ──
// [ADR 084], owner, 2026-09-15: "Store builds skip it" — Cloudflare Turnstile is
// a WEB sign-in check, and a store build is built WITHOUT its site key on purpose
// (a widget inside a native webview is unverified on every device; a wrong answer
// blocks sign-in). An absence nobody states is indistinguishable from an
// accident, so this guard now states it:
//   · THE WEB-ONLY SET IS DERIVED, the same way the required set is: the defines
//     `AppConfig.isTurnstileConfigured` (WEB_ONLY_GETTER) reaches. An app whose
//     lib/ imports the captcha package and declares no such getter is COVERAGE
//     LOST — a renamed getter must not quietly grade nothing.
//   · W1 every release `flutter build web` step in a lane a `web` platform row
//     declares MUST pass every web-only define;
//   · W2 every store build step graded above MUST NOT pass one — a store build
//     that starts carrying the key is a finding, not a silent behaviour change;
//   · W3 the define is read in ONE place: a `String.fromEnvironment('<define>')`
//     anywhere else under apps/<slug>/lib/ is a second home;
//   · W4 a web-only define may not also be one `isBackendLive` requires — the two
//     rules would contradict each other on every store lane.
// The app itself treats "no key" as "no captcha" only in a native build; a web
// build with a live backend and no key reports an error (turnstile_gate.dart).
//
// Usage:  node tooling/ci/assert-store-build-config.mjs [repoRoot]
// Exit 0 = no store or direct artifact is a demo build, and the web-only defines reach
//          the web lanes and no store lane. 1 = a finding. 2 = COVERAGE LOST — "did not
//          check enough to be evidence", never a finding (AGENTS.md exit-code convention).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The SHARED workflow parser — the `run: >` fold, the `run: |` join and the
// comment blanking all live there. ci.yml's own comment beside
// assert-vendor-portability records what a line-based dart-define scan costs:
// it found 2 of the 11 defines that existed. Four copies of a workflow parser
// drift in the one way that reports "clean".
import { parseAllWorkflows, flutterReleaseBuilds, gradeDomain, buildAt } from './workflow-scan.mjs';
// The declared surface axis (O-EXT-SURFACE-AXIS) — whether a row is a Flutter app
// or an extension is READ from the register, never inferred from its id.
import { partitionByFlutterApp } from './channel-surface.mjs';
// The one directory listing (assert-walks-bounded.mjs) — W3 walks each app's lib/.
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = 'tooling/channel-register.json';
const APPS = 'catalog/apps.json';
/** ORDERED CANDIDATE LAYOUTS, read from the register — NOT one hard-coded path.
 *
 *  🔴 THIS WAS `apps/<slug>/lib/core/config/app_config.dart` AND IT MEMORISED THE
 *  LAYOUT SUBLY IS MOVING OFF. apps/subscriptiontracker kept its config at
 *  `lib/core/config/app_config.dart` while the BRICK stamps
 *  `lib/core/app_config.dart`; the moment [ADR 037] P2.5 de-duplicated the two
 *  onto the stamped path this lookup found nothing, `configsRead` stayed 0, and the
 *  guard exited COVERAGE LOST — a CORRECT tree failing a guard that had
 *  memorised the old one. Measured 2026-08-08 on a scratch root: exit 1,
 *  "not one app_config.dart was read".
 *
 *  `assert-store-metadata.mjs` hit exactly this and already solved it in the
 *  register — `storeMetadataContract.appConfigPaths`, which carries its own `_why`.
 *  Reading the SAME declaration here means the next layout move is one edit
 *  in one file, not a hunt for every guard that wrote a path down. */
const configCandidateTemplates = (reg) => {
  const t = reg?.storeMetadataContract?.appConfigPaths;
  return Array.isArray(t) ? t.filter((p) => typeof p === 'string' && p.includes('{app}')) : [];
};

/** The getter every store artifact must satisfy. Named once; everything it
 *  requires is read out of the source, never listed here. */
const ROOT_GETTER = 'isBackendLive';

/** [ADR 084] The getter whose defines are WEB-ONLY. Named once, like ROOT_GETTER;
 *  the define names are read out of the source. */
const WEB_ONLY_GETTER = 'isTurnstileConfigured';

/** An app whose lib/ imports this package HAS a captcha, so it must declare
 *  WEB_ONLY_GETTER — otherwise W1/W2 would grade an empty set and say ok. */
const CAPTCHA_IMPORT = /import\s+['"]package:cloudflare_turnstile\//;

/** `flutter build <target>` → the platform it produces for. Same vocabulary as
 *  assert-channel-register.mjs's BUILD_TARGETS, restricted to the question this
 *  guard asks (which platform), because the format comparison is that guard's. */
const TARGET_PLATFORM = new Map([
  ['web', 'web'],
  ['apk', 'android'],
  ['appbundle', 'android'],
  ['ios', 'ios'],
  ['ipa', 'ios'],
  ['macos', 'macos'],
  ['windows', 'windows'],
  ['linux', 'linux'],
]);

const problems = [];
const prints = [];
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-store-build-config: FAILED');
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. WHAT DOES A LIVE BACKEND REQUIRE? Read out of the Dart, not listed here.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * `static const String field = String.fromEnvironment('DEFINE', …)` and
 * `static bool get name => body;` — the two shapes `isBackendLive` is built from.
 * Parsed rather than grepped: the answer is the set of DEFINES the getter
 * transitively reaches, which a text search for "SUPABASE" could not produce and
 * a hard-coded list could not keep.
 */
function requiredDefines(source, rel, rootGetter = ROOT_GETTER) {
  const fields = new Map();
  for (const m of source.matchAll(/static\s+const\s+String\s+(\w+)\s*=\s*String\.fromEnvironment\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
    fields.set(m[1], m[2]);
  }
  const getters = new Map();
  for (const m of source.matchAll(/static\s+bool\s+get\s+(\w+)\s*=>\s*([^;]+);/g)) {
    getters.set(m[1], m[2]);
  }
  if (!getters.has(rootGetter)) return { missingRoot: `${rel} declares no \`${rootGetter}\` getter.` };

  const seen = new Set();
  const need = new Set();
  const queue = [rootGetter];
  while (queue.length) {
    const g = queue.pop();
    if (seen.has(g)) continue;
    seen.add(g);
    for (const m of getters.get(g).matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const id = m[0];
      if (fields.has(id)) need.add(fields.get(id));
      else if (getters.has(id)) queue.push(id);
    }
  }
  return { defines: need, getters: seen };
}

// ─────────────────────────────────────────────────────────────────────────────
// 0. THE REGISTER, READ ONCE — it answers two questions, not one. Section 2
//    derives WHICH LANES serve a store; the config lookup below derives WHICH
//    LAYOUTS an app_config may live in. Hoisted here so the second reader is
//    not a second parse that can disagree with the first.
// ─────────────────────────────────────────────────────────────────────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) coverageLost([`${REGISTER} does not exist — there is no declaration of which lane serves a store.`]);
let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}
const CONFIG_TEMPLATES = configCandidateTemplates(register);
if (CONFIG_TEMPLATES.length === 0) {
  coverageLost([
    `${REGISTER} storeMetadataContract.appConfigPaths is missing, empty, or holds no {app} template.`,
    'It is the only declaration of where an app keeps its compiled config, and the required-define set',
    'below is derived from the files it locates. With no template this lookup finds nothing, every store',
    'step then supplies all zero of the defines it needs, and this guard reports clean.',
    'assert-store-metadata.mjs reads the same field and refuses the same way.',
  ]);
}

const appsRaw = read(APPS);
if (appsRaw === null) coverageLost([`${APPS} does not exist, so there is no app whose config could be read.`]);
let apps;
try {
  apps = JSON.parse(appsRaw);
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}

const REQUIRED = new Set();
let configsRead = 0;
const getterChains = [];
/** [ADR 084] defines a web lane MUST pass and a store lane MUST NOT. */
const WEB_ONLY = new Set();
const webOnlyChains = [];

/** Every .dart file under a repo-relative directory, repo-relative, '/'-joined. */
function dartUnder(relDir) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(join(ROOT, d))) return;
    for (const e of listDir(join(ROOT, d), { withFileTypes: true })) {
      const child = `${d}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith('.dart')) out.push(child);
    }
  };
  walk(relDir);
  return out;
}
for (const app of Array.isArray(apps) ? apps : []) {
  const candidates = CONFIG_TEMPLATES.map((t) => t.split('{app}').join(app.slug));
  const rel = candidates.find((c) => read(c) !== null) ?? null;
  const src = rel === null ? null : read(rel);
  if (src === null) {
    problems.push(`no app_config.dart for "${app.slug}" at any layout ${REGISTER} declares (${candidates.join(', ')}). Every app in ${APPS} carries the config chassis; without it there is nothing to derive this app's store requirements from.`);
    continue;
  }
  const r = requiredDefines(src, rel);
  if (r.missingRoot) {
    coverageLost([
      r.missingRoot,
      `Everything below is the set of defines that getter reaches. With the getter renamed or removed the`,
      `set is EMPTY, every store step trivially supplies all zero of them, and this guard reports clean.`,
      `If the chassis moved, re-point ROOT_GETTER in the same change.`,
    ]);
  }
  configsRead++;
  for (const d of r.defines) REQUIRED.add(d);
  getterChains.push(`${app.slug}: ${[...r.getters].join(' → ')}`);

  // [ADR 084] the web-only set, the app's captcha import, and W3's second home.
  const libRel = `apps/${app.slug}/lib`;
  const dartFiles = dartUnder(libRel);
  const importsCaptcha = dartFiles.filter((f) => CAPTCHA_IMPORT.test(read(f) ?? ''));
  const w = requiredDefines(src, rel, WEB_ONLY_GETTER);
  if (w.missingRoot) {
    if (importsCaptcha.length) {
      coverageLost([
        `${w.missingRoot} — and ${importsCaptcha.join(', ')} import(s) the captcha package.`,
        `[ADR 084] grades the captcha's site key web-only through that getter. With it renamed or removed the`,
        'web-only set is EMPTY, so no web lane is required to pass the key and no store lane is refused for',
        'passing it — the rule graded over nothing. If the getter moved, re-point WEB_ONLY_GETTER in the same change.',
      ]);
    }
    prints.push(`${app.slug}: no \`${WEB_ONLY_GETTER}\` and no captcha import under ${libRel} — no web-only define to grade for this app.`);
    continue;
  }
  if (w.defines.size === 0) {
    coverageLost([
      `\`${WEB_ONLY_GETTER}\` in ${rel} reaches ZERO dart-defines.`,
      'The web-only set is derived from it; an empty set lets every lane pass W1 and W2 by grading nothing.',
    ]);
  }
  for (const d of w.defines) {
    WEB_ONLY.add(d);
    const reads = new RegExp(`String\\.fromEnvironment\\(\\s*'${d}'`);
    for (const f of dartFiles) {
      if (f === rel) continue;
      if (reads.test(read(f) ?? '')) {
        problems.push(`W3 ${f} reads String.fromEnvironment('${d}') itself. [ADR 084]: the web-only key has ONE home, ${rel} (AppConfig.${WEB_ONLY_GETTER}); a second read is how a define lands in the copy nobody grades.`);
      }
    }
  }
  webOnlyChains.push(`${app.slug}: ${[...w.getters].join(' → ')}`);
}
if (configsRead === 0) {
  coverageLost([
    `not one app_config.dart was read under ${ROOT} at any layout the register declares (${CONFIG_TEMPLATES.join(', ')}).`,
    'The required-define set is derived from those files; an empty set makes every store step pass by',
    'supplying all zero of the things it needs, which is exactly this defect wearing a green tick.',
  ]);
}
if (REQUIRED.size === 0) {
  coverageLost([
    `\`${ROOT_GETTER}\` was found in ${configsRead} config file(s) and reaches ZERO dart-defines.`,
    'Either the getter stopped depending on any configuration — in which case the demo-mode branch it',
    'guards is gone and this guard should be deleted — or the field parse has stopped matching. Both',
    'produce a requirement of nothing, which every lane satisfies.',
  ]);
}
for (const d of WEB_ONLY) {
  if (REQUIRED.has(d)) {
    problems.push(`W4 ${d} is reached by BOTH \`${ROOT_GETTER}\` (every store lane must pass it) and \`${WEB_ONLY_GETTER}\` (no store lane may pass it). [ADR 084] makes it web-only; one of the two getters is wrong.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. WHICH STEPS SHIP TO A STORE? Read out of the BUILDS, graded by the register.
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 ⏱ 2026-09-22 — THIS SECTION USED TO WALK `row.lane` AND `row.submission`,
// and the register says in its own `_why` that those fields NAME THE DRY RUN AND
// ARE A FLOOR, NOT A CENSUS. Measured at f88912e5: the old domain graded 13 step
// counts over 12 distinct builds, out of 16 release builds that produce a store
// or direct artifact. The four it never saw:
//   · submit-play.yml#submit — the job that builds the .aab Google Play RECEIVES.
//     `android-play` declares `#dry-run` as its submission, so the real upload
//     job was graded by nobody.
//   · submit-windows-store.yml#submit and submit-snap.yml#submit — the same shape.
//     `linux-snap` names `#dry-run` as BOTH its lane and its submission, so the
//     old loop graded that one step twice and the submit job zero times.
//   · build-platforms.yml's Build linux step — `linux-appimage` is `kind: direct`
//     and declares no lane at all, so the build that row would ship was outside
//     every store rule (O-DIRECT-DOWNLOADS-NEVER-GRADED). It passed no
//     SUPABASE_URL, no SUPABASE_ANON_KEY and no API_BASE_URL: a demo build, latent
//     only because the row is not served yet, with this guard printing ok.
// And `apps-gov-in` declares neither lane nor submission; its apk was graded only
// because it happens to sit in `android-play`'s lane job. Move that step to a job
// of its own and it would have become ungraded silently.
//
// 📌 THE DOMAIN IS NOW THE CENSUS: every release `flutter build` in every
// workflow (workflow-scan.mjs `flutterReleaseBuilds`), placed against a register
// row by the RELEASE_CHANNEL each build stamps into itself. A job nobody names is
// graded exactly like a declared one, and a build that must not be graded has to
// be written down in `releaseBuildsNeverShipped` with a reason.
//
// ⚠️ PER SEGMENT, NOT PER LINE. A `run: |` block is joined with ` ; `, so the old
// whole-line test let one step's defines answer for the step beside it: deleting
// SUPABASE_URL from the appbundle step left this guard green because the apk step
// on the same logical line still carried one.
//
// `register` was read and parsed in section 0 — the config lookup needs it too,
// and two parses of one file are two answers waiting to disagree.
const shippableRows = (register.channels ?? []).filter((c) => c.kind === 'store' || c.kind === 'direct');
if (shippableRows.length === 0) {
  coverageLost([
    `${REGISTER} declares no \`kind: "store"\` or \`kind: "direct"\` channel.`,
    'The subject set is derived from those rows. With none, this guard grades nothing and prints ok —',
    'the empty-set pass that every guard in this tree is written to refuse.',
  ]);
}
const shippableIds = new Set(shippableRows.map((r) => r.id));

const parsedWorkflows = parseAllWorkflows(ROOT);
const workflows = new Map(parsedWorkflows.map((w) => [w.rel, w]));
if (workflows.size === 0) coverageLost([`no workflow parsed under ${ROOT}/.github/workflows.`]);

const census = flutterReleaseBuilds(ROOT, parsedWorkflows);
if (census.length === 0) {
  coverageLost([
    `${workflows.size} workflow(s) parsed and NOT ONE release \`flutter build\` was found in any of them.`,
    'Either this factory has stopped building the app, or the census has stopped matching inside the',
    'parsed job lines. Both look exactly like a clean sweep.',
  ]);
}
const domain = gradeDomain(census, register);

// A build the census cannot place — unstamped, or stamped with a channel no row
// declares — is NOT this guard's finding to report. assert-channel-register 6b/6b-ii
// owns "every release build stamps a channel that exists", and two guards failing
// on one defect teaches whoever hits it that the second one is noise. Printed here
// because a build outside the census is also a build outside THIS domain, and that
// is the sentence a reader of a green run needs.
if (domain.findings.length) {
  prints.push(
    `${domain.findings.length} release build(s) could not be placed against a channel row, so nothing here graded them: ` +
      `${domain.findings.map((f) => `${buildAt(f.build)} [${f.kind}]`).join(' / ')}. ` +
      'assert-channel-register.mjs 6b/6b-ii owns that rule and fails on it.',
  );
}
for (const e of domain.exempt) {
  prints.push(`NOT GRADED — ${buildAt(e)} is listed in ${REGISTER} \`releaseBuildsNeverShipped\`: ${e.why}`);
}

let graded = 0;
let storeStepsGradedForWebOnly = 0;
// ⚠️ THE DECLARED FIELDS STILL HAVE TO POINT SOMEWHERE. The domain no longer comes
// from `lane`/`submission` — that is the whole change above — but a row naming a job
// that does not exist is a register that has drifted from the workflows, and this guard
// parses both. ⏱ 2026-09-22: it is a FINDING now, not COVERAGE LOST. Under the old
// domain a ghost job ALSO emptied the subject set, so the run exited 2 and read as a
// broken guard rather than a broken register; the census grades every build either way,
// so what is left is simply a register row that is wrong.
for (const row of shippableRows) {
  for (const [kind, decl] of [['lane', row.lane], ['submission', row.submission]]) {
    if (!decl || typeof decl.workflow !== 'string' || typeof decl.job !== 'string') continue;
    const wf = workflows.get(decl.workflow);
    if (!wf) {
      problems.push(`${REGISTER}: channel "${row.id}" declares ${kind} workflow ${decl.workflow}, which this scan did not parse. A declared lane pointing at a file that is not there tells every reader of this register something untrue.`);
      continue;
    }
    if (!wf.jobs.get(decl.job)) {
      problems.push(`${REGISTER}: channel "${row.id}" declares ${kind} job "${decl.job}" in ${decl.workflow}, which declares [${[...wf.jobs.keys()].join(', ')}].`);
    }
  }
}


const storeBuilds = domain.graded.filter((b) => shippableIds.has(b.row.id));
for (const b of storeBuilds) {
  graded++;
  storeStepsGradedForWebOnly++;
  const where = `${b.workflow}:${b.runLine} (channel "${b.row.id}", job "${b.job}", \`flutter build ${b.target}\`)`;
  const absent = [...REQUIRED].filter((name) => !b.defines.has(name));
  // W2 [ADR 084]: a store build carries no captcha BY DESIGN.
  const carried = [...WEB_ONLY].filter((name) => b.defines.has(name));
  if (carried.length) {
    problems.push(
      `W2 ${where} passes ${carried.join(', ')}. [ADR 084] (owner, 2026-09-15, "Store builds skip it"): a store build ` +
        'is built WITHOUT the captcha site key on purpose — a Turnstile widget in a native webview is unverified on ' +
        'any device and a wrong answer blocks sign-in. Remove the define from this step; if bot sign-ups were ' +
        'observed on a native channel, that is the ADR\'s revisit trigger, and it is a decision, not a lane edit.',
    );
  }
  if (absent.length) {
    problems.push(
      `${where} does not pass ${absent.join(', ')}. ` +
        `AppConfig.${ROOT_GETTER} needs ${[...REQUIRED].join(', ')}; without them the fields stay at their ` +
        'PLACEHOLDER defaults and the artifact ships with mock auth and seeded data — a demo build, ' +
        'submitted to a store, with every other check green. deploy-web.yml already passes all of them ' +
        'from repository secrets that exist.',
    );
  }
}

// A row nothing builds for is NOT a failure — linux-snap ingests a prebuilt
// artifact by design ([ADR 015] §3), and `windows-direct` declares a `.exe` that
// the register's own `artifactBuild._why` already records nothing packages — but
// it IS a row this guard cannot speak for, and an unspoken-for row is how a
// subject set shrinks unnoticed. Printed every run.
//
// ⚠️ THROUGH THE DECLARED SURFACE AXIS, not by guessing from the id. The three
// extension rows have no Flutter build and never will (ADR 067 decision 1: the
// packer is build-free); listing them here every run is the noise that teaches a
// reader to skip this block, and the block is the only place a REAL hole shows up.
const built = new Set(storeBuilds.map((b) => b.row.id));
const surfaceSplit = partitionByFlutterApp(register, shippableRows);
if (surfaceSplit.undeclared.length) {
  coverageLost([
    `${surfaceSplit.undeclared.length} shippable row(s) declare no surface this scan can resolve: ${surfaceSplit.undeclared.map((r) => r.id).join(', ')}.`,
    'The Flutter/extension split decides which rows must be built for, so an unresolved row is a row',
    'silently excused from the "nothing builds this" report.',
  ]);
}
for (const row of surfaceSplit.flutter) {
  if (built.has(row.id)) continue;
  prints.push(
    `channel "${row.id}" [${row.kind}] — NOT ONE release \`flutter build\` in any workflow stamps RELEASE_CHANNEL=${row.id}, ` +
      'so nothing was graded for it. Correct where the artifact is packaged from a prebuilt bundle ([ADR 015] §3); ' +
      'a coverage hole if something was supposed to build it.',
  );
}
if (surfaceSplit.other.length) {
  prints.push(
    `${surfaceSplit.other.length} shippable row(s) are not a Flutter-app surface and are outside this rule by ` +
      `construction: ${surfaceSplit.other.map((r) => r.id).join(', ')} (the extension packer is build-free, ADR 067 decision 1).`,
  );
}

if (graded === 0) {
  // ⚠️ THE DIAGNOSIS COMES FIRST, and the test run is why. A census that places
  // no build produces BOTH precise problems and an empty graded set; exiting on
  // the coverage check alone replaced "channel X stamps a channel that does not
  // exist" with "zero steps were graded" — true, useless, and it reads as a broken
  // guard rather than a broken register. The identical ordering bug was found in
  // assert-artifact-signed.mjs the same day.
  for (const p of prints) console.error(`     ⬜ ${p}`);
  for (const p of problems) console.error(`FAIL ${p}`);
  coverageLost([
    `${census.length} release build(s) were found and NOT ONE was placed against a \`store\` or \`direct\` channel row.`,
    'Either no store artifact is built any more, or every build has stopped stamping a RELEASE_CHANNEL the',
    'register declares. Both look exactly like a clean sweep.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. [ADR 084] W1 — EVERY WEB LANE PASSES THE WEB-ONLY DEFINES.
//    The subject is every row whose platforms include `web` and that is NOT a
//    store row, read from the register like the store rows are.
// ─────────────────────────────────────────────────────────────────────────────
let webGraded = 0;
if (WEB_ONLY.size > 0) {
  const webRows = (register.channels ?? []).filter((c) => c.kind !== 'store' && (c.platforms ?? []).includes('web'));
  for (const row of webRows) {
    for (const [kind, decl] of [['lane', row.lane], ['submission', row.submission]]) {
      if (!decl || typeof decl.workflow !== 'string' || typeof decl.job !== 'string') continue;
      const wf = workflows.get(decl.workflow);
      const job = wf?.jobs.get(decl.job);
      if (!job) {
        problems.push(`W1 ${REGISTER}: web channel "${row.id}" declares ${kind} ${decl.workflow} job "${decl.job}", which this scan did not find, so no web build was graded for it.`);
        continue;
      }
      // ⏱ CHANGED 2026-09-25 (O-FLUTTER-BUILD-TYPED-PER-LINE, part 2 of 3): the job's
      // release web builds come off the census, per SEGMENT, as the store limb's do.
      // This loop used to test each logical line for `flutter build web` without
      // --debug/--profile, so a web build made through flutter-release-build.mjs was
      // no web build here, and one line's defines answered for every build on it.
      for (const b of census) {
        if (b.workflow !== decl.workflow || b.job !== decl.job || b.target !== 'web') continue;
        webGraded++;
        const absent = [...WEB_ONLY].filter((name) => !b.defines.has(name));
        if (absent.length) {
          problems.push(
            `W1 ${decl.workflow}:${b.runLine} (web channel "${row.id}", ${kind} job "${decl.job}", \`flutter build web\`) does not pass ${absent.join(', ')}. ` +
              `[ADR 084]: Turnstile guards WEB sign-in, and a web build with a live backend and no key is an error — the ` +
              'identity provider refuses every sign-in it sends without a captcha token.',
          );
        }
      }
    }
  }
  if (webGraded === 0) {
    for (const p of problems) console.error(`FAIL ${p}`);
    coverageLost([
      `${WEB_ONLY.size} web-only define(s) (${[...WEB_ONLY].join(', ')}) and ZERO release \`flutter build web\` steps were graded.`,
      `No non-store ${REGISTER} row with platform \`web\` declares a lane that builds web, so "every web lane passes the`,
      'key" ranged over nothing — exactly the half of [ADR 084] that makes a keyless web build an error.',
    ]);
  }
  prints.push(`[ADR 084] web-only define(s) ${[...WEB_ONLY].sort().join(', ')} via ${webOnlyChains.join(' | ')}: passed by ${webGraded} web build step(s), refused on ${storeStepsGradedForWebOnly} store build step(s).`);
}

prints.push(`VALUES ARE NOT CHECKED — this reads workflow structure, so a store lane wired to a STAGING Supabase project passes here. What it can see is that the define is passed at all.`);

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('   ── printed, not failed ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  A store artifact built without these defines is the DEMO build: mock auth, seeded data,');
  console.error('  inert analytics. On 2026-08-04 the Google Play .aab was exactly that, and debug-signed.');
  console.error('\nassert-store-build-config: FAILED');
  process.exit(1);
}

console.log(
  `assert-store-build-config: OK — ${graded} of ${census.length} release build step(s) in ${workflows.size} workflow(s) ` +
    `produce a store or direct artifact (${domain.exempt.length} exempt, ${domain.findings.length} unplaceable) and ` +
    `each pass all ${REQUIRED.size} define(s) AppConfig.${ROOT_GETTER} reaches (${[...REQUIRED].sort().join(', ')}), ` +
      `derived from ${configsRead} app config file(s) via ${getterChains.join(' | ')}; ` +
    `[ADR 084] ${WEB_ONLY.size} web-only define(s) passed by ${webGraded} web step(s) and by none of the store steps`,
);
