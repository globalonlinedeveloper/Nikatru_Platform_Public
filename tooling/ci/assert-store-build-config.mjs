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
//
// ── WHAT IS DELIBERATELY NOT GRADED ──────────────────────────────────────────
//   · Any lane a store row does not declare. build-platforms.yml's `apple` job
//     builds iOS and macOS and is NOT the App Store rows' lane (they declare
//     none) — it is a six-platform BUILD PROOF, and a proof of compilation does
//     not need production credentials.
//   · The web build, the Linux build, e2e's debug build, and every fork PR.
//     A fork holds no secrets, so a rule reaching them could only ever fail on
//     correct input, and a guard that does that gets deleted by whoever hits it.
//   · WHETHER THE VALUES ARE RIGHT. This reads workflow structure; it cannot see
//     a secret's contents, so a store lane wired to a STAGING Supabase passes
//     here. Printed on every run rather than left implied.
//
// Usage:  node tooling/ci/assert-store-build-config.mjs [repoRoot]
// Exit 0 = no store artifact is a demo build. 1 = at least one is.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// The SHARED workflow parser — the `run: >` fold, the `run: |` join and the
// comment blanking all live there. ci.yml's own comment beside
// assert-vendor-portability records what a line-based dart-define scan costs:
// it found 2 of the 11 defines that existed. Four copies of a workflow parser
// drift in the one way that reports "clean".
import { parseAllWorkflows } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = 'tooling/channel-register.json';
const APPS = 'sites/_shared/_data/apps.json';
const CONFIG_REL = (slug) => `apps/${slug}/lib/core/config/app_config.dart`;

/** The getter every store artifact must satisfy. Named once; everything it
 *  requires is read out of the source, never listed here. */
const ROOT_GETTER = 'isBackendLive';

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
const ok = (m) => console.log(`ok   ${m}`);
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-store-build-config: FAILED');
  process.exit(1);
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
function requiredDefines(source, rel) {
  const fields = new Map();
  for (const m of source.matchAll(/static\s+const\s+String\s+(\w+)\s*=\s*String\.fromEnvironment\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
    fields.set(m[1], m[2]);
  }
  const getters = new Map();
  for (const m of source.matchAll(/static\s+bool\s+get\s+(\w+)\s*=>\s*([^;]+);/g)) {
    getters.set(m[1], m[2]);
  }
  if (!getters.has(ROOT_GETTER)) return { missingRoot: `${rel} declares no \`${ROOT_GETTER}\` getter.` };

  const seen = new Set();
  const need = new Set();
  const queue = [ROOT_GETTER];
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
for (const app of Array.isArray(apps) ? apps : []) {
  const rel = CONFIG_REL(app.slug);
  const src = read(rel);
  if (src === null) {
    problems.push(`${rel} does not exist. Every app in ${APPS} carries the config chassis; without it there is nothing to derive this app's store requirements from.`);
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
}
if (configsRead === 0) {
  coverageLost([
    `not one app_config.dart was read under ${ROOT}.`,
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. WHICH STEPS SHIP TO A STORE? Read out of the register, not listed here.
// ─────────────────────────────────────────────────────────────────────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) coverageLost([`${REGISTER} does not exist — there is no declaration of which lane serves a store.`]);
let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}
const storeRows = (register.channels ?? []).filter((c) => c.kind === 'store');
if (storeRows.length === 0) {
  coverageLost([
    `${REGISTER} declares no \`kind: "store"\` channel.`,
    'The subject set is derived from those rows. With none, this guard grades nothing and prints ok —',
    'the empty-set pass that every guard in this tree is written to refuse.',
  ]);
}

const workflows = new Map(parseAllWorkflows(ROOT).map((w) => [w.rel, w]));
if (workflows.size === 0) coverageLost([`no workflow parsed under ${ROOT}/.github/workflows.`]);

/** Every (row, job) a store row DECLARES — its build lane and its submission. */
const declared = [];
for (const row of storeRows) {
  for (const [kind, decl] of [['lane', row.lane], ['submission', row.submission]]) {
    if (!decl || typeof decl.workflow !== 'string' || typeof decl.job !== 'string') continue;
    declared.push({ row, kind, workflow: decl.workflow, job: decl.job });
  }
}
if (declared.length === 0) {
  coverageLost([
    `${storeRows.length} store row(s) and NOT ONE declares a \`lane\` or \`submission\` with {workflow, job}.`,
    'The subject set is empty, so every store artifact is unchecked and this guard reports clean.',
  ]);
}

const NON_RELEASE = /--debug\b|--profile\b/;
let graded = 0;
const rowsWithNoBuild = new Map();

for (const d of declared) {
  const wf = workflows.get(d.workflow);
  if (!wf) {
    problems.push(`${REGISTER}: channel "${d.row.id}" declares ${d.kind} workflow ${d.workflow}, which this scan did not parse. A declared lane pointing at a file that is not there is graded by nobody.`);
    continue;
  }
  const job = wf.jobs.get(d.job);
  if (!job) {
    problems.push(`${REGISTER}: channel "${d.row.id}" declares ${d.kind} job "${d.job}" in ${d.workflow}, which declares [${[...wf.jobs.keys()].join(', ')}].`);
    continue;
  }
  const platforms = new Set(d.row.platforms ?? []);
  let buildsHere = 0;
  for (const line of job.logical) {
    for (const m of line.text.matchAll(/flutter\s+build\s+([a-z]+)/g)) {
      const platform = TARGET_PLATFORM.get(m[1]);
      // A target for another platform in the same job — build-platforms.yml's
      // android job also builds web and linux — is not this row's artifact.
      if (platform === undefined || !platforms.has(platform)) continue;
      if (NON_RELEASE.test(line.text)) continue;
      buildsHere++;
      graded++;
      const where = `${d.workflow}:${line.n} (channel "${d.row.id}", ${d.kind} job "${d.job}", \`flutter build ${m[1]}\`)`;
      const absent = [...REQUIRED].filter((name) => !new RegExp(`--dart-define(?:=|\\s+)${name}=`).test(line.text));
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
  }
  if (buildsHere === 0) {
    const key = d.row.id;
    if (!rowsWithNoBuild.has(key)) rowsWithNoBuild.set(key, []);
    rowsWithNoBuild.get(key).push(`${d.kind} job "${d.job}" in ${d.workflow}`);
  }
}

// A row whose declared jobs build nothing for its own platform is NOT a failure
// — linux-snap ingests a prebuilt artifact by design ([ADR 015] §3) — but it IS
// a row this guard cannot speak for, and an unspoken-for row is how a subject set
// shrinks unnoticed. Printed every run.
for (const [id, where] of rowsWithNoBuild) {
  prints.push(`channel "${id}" — no \`flutter build\` for its platform in ${where.join(' / ')}, so nothing was graded for it. Correct where the artifact is packaged from a prebuilt bundle; a coverage hole if that lane was supposed to build.`);
}

if (graded === 0) {
  // ⚠️ THE DIAGNOSIS COMES FIRST, and the test run is why. A declared job that
  // does not exist produces BOTH a precise problem and an empty graded set;
  // exiting on the coverage check alone replaced "channel X declares job
  // 'ghost', which does not exist" with "zero steps were graded" — true, useless,
  // and it reads as a broken guard rather than a broken register. The identical
  // ordering bug was found in assert-artifact-signed.mjs the same day.
  for (const p of prints) console.error(`     ⬜ ${p}`);
  for (const p of problems) console.error(`FAIL ${p}`);
  coverageLost([
    `${declared.length} declared store job(s) yielded ZERO graded build steps.`,
    'Either no store lane builds anything any more, or the `flutter build` matcher has stopped matching',
    'inside the parsed job lines. Both look exactly like a clean sweep.',
  ]);
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
  `assert-store-build-config: OK — ${graded} store build step(s) across ${declared.length} declared lane(s) ` +
    `each pass all ${REQUIRED.size} define(s) AppConfig.${ROOT_GETTER} reaches (${[...REQUIRED].sort().join(', ')}), ` +
    `derived from ${configsRead} app config file(s) via ${getterChains.join(' | ')}`,
);
