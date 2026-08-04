#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-play-declarations.mjs — the Data safety form and the content rating
// questionnaire are SWORN DECLARATIONS ABOUT WHAT THE CODE DOES, so they are
// compared to the code.
//
// [pipeline K-8 / G-32] Two Play Console artefacts had NO representation in this
// repository at all until 2026-08-04, and the store README said so in prose:
// "⬜ Data safety form — a Play Console questionnaire. Blocking, and it has no
// repo representation." The Play organisation account verified the same day,
// which put both on the critical path to the first submission.
//
// 🔴 WHY A GUARD AND NOT JUST A FILE. A hand-written JSON of answers that nobody
// checks is worth almost nothing — it is true the afternoon it is typed and
// silently false three commits later, because no store console watches a
// repository. Google's own User Data policy puts the accuracy on us: "All
// developers must complete a clear and accurate Data safety section for every
// app… The developer is responsible for the accuracy of the label"
// (support.google.com/googleplay/android-developer/answer/10144311, fetched
// 2026-08-04). A Data safety label that contradicts the app's behaviour is a
// policy violation that gets apps removed, and it is also the artefact every
// DPDP consent claim ultimately rests on.
//
// So every answer that CAN be derived from the tree is derived, and the ones
// that cannot are named as a human's — by id, printed on every run. There is no
// third category, and a claim with neither a derivation nor an owner fails.
//
// ── THE LIMBS THAT ACTUALLY BITE, IN THE ORDER THEY WOULD CATCH A REAL DRIFT ──
//
//  (A) THE POSTURE. The .aab lane passes ONE dart-define (GLITCHTIP_DSN), and
//      AppConfig's isSupabaseConfigured/isApiConfigured/isBackendLive are
//      COMPILE-TIME constants over those defines. So the bundle Play would
//      receive today runs MockAuthRepository, SeedApiClient and NoOpAnalytics
//      and collects almost nothing — and adding `--dart-define=SUPABASE_URL` to
//      that one step silently turns the whole declaration into a lie. The
//      define set on the `flutter build appbundle` step is PARSED and compared.
//      This is the limb that made the whole file worth writing.
//
//  (B) THE TELLS. Nobody adds ACCESS_FINE_LOCATION to a manifest by hand; they
//      add `geolocator` to a pubspec and Gradle merges the permission in from a
//      file this repository does not contain. So each "not collected" answer
//      names the permissions, packages and iOS usage-description keys that
//      would contradict it, and the derived sets are compared against them.
//      Add a location permission or a location package and the Location answers
//      fail. MUTATION-PROVEN AGAINST THE REAL TREE — see the test header.
//
//  (C) THE INVENTORY RELATION, BOTH DIRECTIONS. tooling/legal/data-inventory.json
//      already enumerates every store this factory can put data in and already
//      fails when a table appears with no row. This guard makes the Data safety
//      form the SAME system rather than a second document that happens to agree
//      today: every `personalData: true` row is either mapped to a declared
//      Play data type or excluded BY NAME with a reason. A new personal-data
//      table therefore fails two guards, and neither takes prose for an answer.
//
//  (D) EQUALITY, NOT SUBSET, on the Android permission set and on the direct
//      dependency set. A subset check answers "did anything forbidden appear";
//      an equality answers "did anything appear AT ALL", which is the question
//      that matters when the forbidden list can never be complete. A new
//      dependency fails with "nobody said what data it can collect".
//
//  (E) THE CROSS-FILE CONTRADICTION. The Data safety form and the content
//      rating questionnaire ask the same question twice, on different screens,
//      months apart: does the app share personal info, and is it for children.
//      Answering them inconsistently is invisible to a human and obvious to a
//      comparison, so the content-rating answers are DERIVED from the Data
//      safety ones rather than written independently.
//
// ── WHAT THIS GUARD CANNOT SEE, PRINTED ON EVERY RUN ─────────────────────────
// Stated out loud because green must not be mistaken for "the form is right":
//   · THE MERGED ANDROID MANIFEST. Gradle merges permissions from every
//     plugin's own manifest, none of which is in this repository, and Android
//     cannot be built on the maintainer's machine at all. (D) is the mitigation
//     — a permission-bearing plugin cannot arrive without a new dependency —
//     but it is a mitigation, not a reading. `bundletool dump manifest` on a
//     CI-built .aab is the reading.
//   · WHAT THE CRASH SDK ACTUALLY SENDS. `contexts.device` and the Sentry
//     Android installation id are assembled inside a vendored SDK at runtime.
//     That is why "Device or other IDs" is `null` under the demo posture.
//   · SUPABASE'S OWN auth.users. External project, no migrations in this repo.
//   · WHETHER PLAY HAS CHANGED ITS VOCABULARY since the fetch date recorded in
//     the declaration. Nothing in CI can notice a Google page being edited.
//   · TRANSITIVE Dart dependencies. (D) is over DIRECT ones on purpose: an
//     equality over the resolved graph would fire on every Renovate bump and be
//     switched off within a week.
//   · THE RESULTING IARC RATING. It is assigned by the rating authorities from
//     the submitted questionnaire, and this guard FAILS if one is written down
//     without a certificate and a citation beside it.
//
// 🔬 NO INVENTED NUMBERS ANYWHERE. Every external requirement quoted by the
// declarations carries a URL, a fetch date and a quote, and the host must be
// one that WROTE or ENFORCES the rule — the same rule tooling/legal/duty-matrix
// .json already uses. A citation that fails it is a build failure, because a
// limit sourced to a blog cannot be re-verified and this repo has already
// deleted one invented store limit for firing on correct input.
//
// Usage:  node tooling/ci/assert-play-declarations.mjs [repoRoot]
// Exit 0 = the declarations still describe this tree; 1 = they do not.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripInert, stripSourceComments } from './text-reductions.mjs';
import { parseWorkflow } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
const INVENTORY_REL = 'tooling/legal/data-inventory.json';
const CHANNEL = 'android-play';

const problems = [];
const prints = [];

const abs = (rel) => join(ROOT, ...rel.split('/'));
const exists = (rel) => existsSync(abs(rel));
const read = (rel) => (exists(rel) ? readFileSync(abs(rel), 'utf8') : null);
const isDir = (rel) => exists(rel) && statSync(abs(rel)).isDirectory();

/** Structural failure: every check below quantifies over the missing thing, so
 *  continuing would report "clean" over nothing — this repository's single most
 *  repeated defect, reproduced inside the guard meant to prevent it. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-play-declarations: FAILED');
  process.exit(1);
}

function parseJson(rel, whyItMatters) {
  const text = read(rel);
  if (text === null) coverageLost([`${rel} does not exist.`, ...whyItMatters]);
  try {
    return JSON.parse(text);
  } catch (e) {
    coverageLost([`${rel} is not valid JSON — ${e.message}`, ...whyItMatters]);
  }
  return null;
}

// ── the register tells us where the tree is, and whether it is being enforced ─
const register = parseJson(REGISTER_REL, [
  'It declares the store channels and the per-channel file contract. Without it this guard cannot',
  'locate the metadata tree and every check below ranges over nothing.',
]);
const row = (Array.isArray(register.channels) ? register.channels : []).find((c) => c && c.id === CHANNEL);
if (!row || typeof row.storeMetadataDir !== 'string') {
  coverageLost([
    `${REGISTER_REL} declares no \`${CHANNEL}\` channel with a \`storeMetadataDir\`.`,
    'The declarations live inside that tree. With no row there is no tree to check.',
  ]);
}

const DIR = row.storeMetadataDir.replace('{app}', 'subly');
const DS_REL = posix.join(DIR, 'data-safety.json');
const CR_REL = posix.join(DIR, 'content-rating.json');

// 🔴 SELF-CHECK ON THE ENFORCEMENT PATH, NOT JUST ON THE FILES. Existence and
// non-emptiness of these two files is assert-store-metadata.mjs's job, via the
// contract's `additionalFiles`. If they are NOT listed there, deleting one would
// leave that guard silent and this one would simply COVERAGE LOST with a message
// pointing at the wrong file. Two guards, one relationship, declared once.
const additional = register.storeMetadataContract?.perChannel?.[CHANNEL]?.additionalFiles ?? [];
for (const f of ['data-safety.json', 'content-rating.json']) {
  if (!additional.includes(f)) {
    coverageLost([
      `${REGISTER_REL} storeMetadataContract.perChannel["${CHANNEL}"].additionalFiles does not list "${f}".`,
      'That list is what makes assert-store-metadata.mjs (and tooling/release/submit-play.mjs) require the',
      'file to be present and non-empty. Off it, the declaration can be deleted or emptied and the only',
      'guard that would notice is this one — which is exactly one guard too few for a sworn declaration.',
    ]);
  }
}

const ds = parseJson(DS_REL, [
  'This IS the Data safety declaration. Absent, there is nothing to compare to the code and the answers',
  'typed into the Play Console are whatever somebody remembered on the day.',
]);
const cr = parseJson(CR_REL, [
  'This IS the content rating questionnaire record. Absent, the answers submitted to IARC exist nowhere',
  'that can be reviewed or re-derived.',
]);
const inventory = parseJson(INVENTORY_REL, [
  'The personal-data inventory is the right-hand side of the mapping limb below. Absent, "every store',
  'holding personal data is mapped to a Play data type" ranges over an empty set and prints ok.',
]);

// ─────────────────────────────────────────────────────────────────────────────
// 1 · CITATIONS. Every external requirement carries a URL, a fetch date and a
//     quote, and the host must be one that WROTE or ENFORCES the rule.
// ─────────────────────────────────────────────────────────────────────────────
let citationsChecked = 0;
function checkCitations(doc, docRel) {
  const sources = doc.sources;
  if (!sources || typeof sources !== 'object') {
    problems.push(
      `${docRel} carries no \`sources\` block. Every external requirement this declaration rests on needs a URL and a fetch date; without them a rule cannot be re-verified later, and an unverifiable compliance rule is one nobody can tell has changed.`,
    );
    return;
  }
  const allowed = Array.isArray(sources.allowedHosts) ? sources.allowedHosts : [];
  if (allowed.length === 0) {
    problems.push(`${docRel} sources.allowedHosts is missing or empty, so every citation below would be accepted from any host at all.`);
    return;
  }
  for (const [key, cite] of Object.entries(sources)) {
    if (key === 'allowedHosts' || key.startsWith('_')) continue;
    if (!cite || typeof cite !== 'object') {
      problems.push(`${docRel} sources.${key} is not a citation object.`);
      continue;
    }
    for (const field of ['url', 'fetched', 'quote']) {
      if (typeof cite[field] !== 'string' || cite[field].trim() === '') {
        problems.push(
          `${docRel} sources.${key} has no \`${field}\`. A cited rule needs all three — the page, the day it said this, and what it said. Two of the three is a claim nobody can re-check.`,
        );
      }
    }
    if (typeof cite.url !== 'string') continue;
    let host;
    try {
      host = new URL(cite.url).host;
    } catch {
      problems.push(`${docRel} sources.${key}.url is not a URL: ${JSON.stringify(cite.url)}`);
      continue;
    }
    if (!allowed.includes(host)) {
      problems.push(
        `${docRel} sources.${key} cites ${host}, which is not in sources.allowedHosts. The test a host passes is that it is the body that WROTE the rule or the platform that ENFORCES it — a summary, a client alert or a checklist site cannot be re-verified, and a compliance corpus is worth exactly its ability to be re-checked.`,
      );
      continue;
    }
    if (typeof cite.fetched === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(cite.fetched)) {
      problems.push(`${docRel} sources.${key}.fetched is not an ISO date (YYYY-MM-DD): ${JSON.stringify(cite.fetched)}`);
      continue;
    }
    citationsChecked++;
  }
}
checkCitations(ds, DS_REL);
checkCitations(cr, CR_REL);

// ─────────────────────────────────────────────────────────────────────────────
// 2 · VOCABULARY TOTALITY. Play's type list, as STRUCTURE, in bijection with the
//     answer rows. A forgotten question and an invented Play type both fail.
// ─────────────────────────────────────────────────────────────────────────────
const vocab = ds.vocabulary?.categories;
if (!vocab || typeof vocab !== 'object' || Object.keys(vocab).length === 0) {
  coverageLost([
    `${DS_REL} declares no \`vocabulary.categories\`.`,
    'That map is the domain of the totality check: with it empty, "every Play data type has an answer"',
    'is vacuously true and a declaration with ZERO answers would pass.',
  ]);
}
const vocabTypes = new Map(); // "Category|Type" -> {category,type}
for (const [category, types] of Object.entries(vocab)) {
  if (category.startsWith('_')) continue;
  if (!Array.isArray(types) || types.length === 0) {
    problems.push(`${DS_REL} vocabulary.categories["${category}"] declares no types, so that whole category contributes no question.`);
    continue;
  }
  for (const t of types) vocabTypes.set(`${category}|${t}`, { category, type: t });
}
if (vocabTypes.size === 0) {
  coverageLost([`${DS_REL} vocabulary.categories yielded ZERO data types.`, 'The totality check below has no domain.']);
}

const answers = Array.isArray(ds.answers) ? ds.answers : [];
if (answers.length === 0) {
  coverageLost([`${DS_REL} declares no \`answers\`.`, 'Every limb below iterates them; with none, all of them pass by measuring nothing.']);
}
const answerByKey = new Map();
for (const a of answers) {
  const key = `${a.category}|${a.type}`;
  if (answerByKey.has(key)) {
    problems.push(`${DS_REL} declares TWO answers for ${key}. One data type, one answer — Play's form has one row per type and two rows here means one of them is not the submitted one.`);
    continue;
  }
  answerByKey.set(key, a);
  if (!vocabTypes.has(key)) {
    problems.push(
      `${DS_REL} answers ${JSON.stringify(key)}, which is not a type in \`vocabulary.categories\`. Either the type name was typed from memory and does not exist on the form, or the vocabulary was re-fetched and this row was left behind describing a question Play no longer asks.`,
    );
  }
}
for (const [key] of vocabTypes) {
  if (!answerByKey.has(key)) {
    problems.push(
      `${DS_REL} has NO answer for ${JSON.stringify(key)}. Play asks about every type in the form; a type with no row here is a question that gets answered in the console from memory, by whoever is filling it in, with nothing recording what they said.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · THE POSTURE. Which artefact does Play actually receive?
// ─────────────────────────────────────────────────────────────────────────────
const bp = ds.buildPosture ?? {};
const POSTURES = Object.keys(bp.postures ?? {});
if (POSTURES.length === 0) {
  coverageLost([
    `${DS_REL} buildPosture.postures is missing or empty.`,
    'Every answer is keyed by posture. With no postures declared, the per-answer shape check below has no',
    'keys to require and an answer object of `{}` would satisfy it.',
  ]);
}
if (!POSTURES.includes(bp.current)) {
  problems.push(
    `${DS_REL} buildPosture.current is ${JSON.stringify(bp.current)}, which is not one of the declared postures (${POSTURES.join(', ')}). The "which column do I type into the console" question has no answer.`,
  );
}

let laneDefines = null;
if (typeof bp.lane === 'string' && typeof bp.buildCommandContains === 'string') {
  const wf = parseWorkflow(ROOT, bp.lane);
  if (wf === null) {
    coverageLost([
      `${DS_REL} buildPosture.lane names ${bp.lane}, which does not exist.`,
      'That workflow is the only place the shipped artefact\'s dart-defines are declared. Unreadable, the',
      'posture limb — the one that catches the whole declaration silently becoming false — checks nothing.',
    ]);
  }
  const hits = [];
  for (const job of wf.jobs.values()) {
    for (const l of job.logical) {
      if (l.text.includes(bp.buildCommandContains)) hits.push(l);
    }
  }
  if (hits.length === 0) {
    coverageLost([
      `no step in ${bp.lane} contains ${JSON.stringify(bp.buildCommandContains)}.`,
      'The Play artefact build step could not be found, so the dart-define comparison below ranged over',
      'nothing and would have reported the declared posture correct whatever the workflow says. Either the',
      'lane stopped building an .aab, or the command was rewritten and buildPosture.buildCommandContains',
      'was not — and the second is silent under-coverage, which is the failure this repository keeps hitting.',
    ]);
  }
  laneDefines = new Set();
  for (const l of hits) {
    for (const m of l.text.matchAll(/--dart-define(?:-from-file)?[= ]([A-Za-z_][A-Za-z0-9_]*)/g)) laneDefines.add(m[1]);
  }

  const expected = new Set(Array.isArray(bp.expectedDefines) ? bp.expectedDefines : []);
  const extra = [...laneDefines].filter((d) => !expected.has(d)).sort();
  const missing = [...expected].filter((d) => !laneDefines.has(d)).sort();
  const identity = new Set(Array.isArray(bp.identityDefines) ? bp.identityDefines : []);

  for (const d of extra) {
    const isIdentity = identity.has(d);
    problems.push(
      isIdentity
        ? `🔴 ${bp.lane} now passes --dart-define=${d} to the Play artefact, and ${DS_REL} declares posture "${bp.current}". ${d} is one of buildPosture.identityDefines, so this build is NO LONGER the one the declaration describes: AppConfig.isBackendLive is a compile-time constant over exactly these defines, and flipping it turns on the account, the server sync and the analytics rail. Every answer's "${bp.current}" column now understates what the shipped bundle collects. Re-declare the posture before this artefact reaches a store.`
        : `${bp.lane} passes --dart-define=${d} to the Play artefact and ${DS_REL} buildPosture.expectedDefines does not list it. A define is a compile-time switch over app behaviour; an undeclared one is behaviour this declaration has not been checked against.`,
    );
  }
  for (const d of missing) {
    problems.push(
      `${DS_REL} buildPosture.expectedDefines lists ${d} and ${bp.lane} does not pass it to the Play artefact. If it was removed, the answers derived from it are now wrong in the other direction — e.g. dropping GLITCHTIP_DSN makes TelemetryConfig.enabled false and the crash-log answers OVERSTATE what ships. An overstated declaration is still an inaccurate one.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · THE DERIVED TREE FACTS. Permissions, direct dependencies, iOS usage keys.
//     Parsed, never grepped: an XML comment naming a permission is not a
//     permission, and this repository has already shipped a guard that matched
//     the comment explaining why a binding did NOT exist.
// ─────────────────────────────────────────────────────────────────────────────
const APP_DIR = 'apps/subly';

function walk(relDir, out = []) {
  if (!isDir(relDir)) return out;
  for (const e of listDir(abs(relDir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'build' || e.name === '.dart_tool') continue;
    const child = `${relDir}/${e.name}`;
    if (e.isDirectory()) walk(child, out);
    else out.push(child);
  }
  return out;
}

// (a) Android permissions, per manifest.
const manifestFiles = walk(`${APP_DIR}/android`).filter((f) => f.endsWith('/AndroidManifest.xml')).sort();
if (manifestFiles.length === 0) {
  coverageLost([
    `no AndroidManifest.xml was found under ${APP_DIR}/android.`,
    'The permission walk is the loudest single tell that a data type has started being collected. Reaching',
    'zero manifests makes every "this permission is absent" claim vacuously true while printing ok.',
  ]);
}
const permsByFile = new Map();
const allPerms = new Set();
for (const f of manifestFiles) {
  // XML comments out FIRST. The debug manifest's own comment explains why
  // INTERNET is there; a raw scan of the release manifest would be reading prose.
  const xml = stripInert(read(f) ?? '');
  const found = [...xml.matchAll(/<uses-permission[^>]*android:name\s*=\s*"([^"]+)"/g)].map((m) => m[1]).sort();
  permsByFile.set(f, found);
  for (const p of found) allPerms.add(p);
}

// (b) DIRECT dependencies of the app, from its pubspec. `#` comments blanked, so
//     a commented-out dependency is not read as one.
const pubspecRel = `${APP_DIR}/pubspec.yaml`;
const pubspecText = read(pubspecRel);
if (pubspecText === null) {
  coverageLost([`${pubspecRel} does not exist.`, 'The dependency-equality limb — the mitigation for not being able to read the merged manifest — has no subject.']);
}
const pubspecLines = stripSourceComments(pubspecText, '.yaml').split('\n');
const directDeps = new Set();
{
  const at = pubspecLines.findIndex((l) => /^dependencies:\s*$/.test(l));
  if (at === -1) {
    coverageLost([
      `${pubspecRel} has no top-level \`dependencies:\` block that this parse can find.`,
      'The direct-dependency set would be empty, so a newly added SDK would produce no "undeclared',
      'dependency" failure and the equality would instead complain about every declared entry — reporting',
      'the wrong fault, which is the diagnosis failure this repository keeps recording.',
    ]);
  }
  for (let i = at + 1; i < pubspecLines.length; i++) {
    if (/^\S/.test(pubspecLines[i])) break;
    const m = pubspecLines[i].match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/);
    if (m) directDeps.add(m[1]);
  }
}
if (directDeps.size === 0) {
  coverageLost([`${pubspecRel} \`dependencies:\` parsed to ZERO entries.`, 'See above: an empty set makes the equality check report the opposite of the truth.']);
}

// (c) iOS/macOS usage-description keys — the Apple-side equivalent of a
//     permission, and a second independent tell for the same capabilities.
const plistFiles = [...walk(`${APP_DIR}/ios`), ...walk(`${APP_DIR}/macos`)].filter((f) => f.endsWith('Info.plist')).sort();
const usageKeys = new Set();
for (const f of plistFiles) {
  const plist = stripInert(read(f) ?? '');
  for (const m of plist.matchAll(/<key>\s*(NS[A-Za-z]+UsageDescription)\s*<\/key>/g)) usageKeys.add(m[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · PER-ANSWER SHAPE, and THE TELLS.
// ─────────────────────────────────────────────────────────────────────────────
const VALID_PURPOSES = new Set(Array.isArray(ds.vocabulary?.purposes) ? ds.vocabulary.purposes : []);
const unresolvedById = new Map(
  (Array.isArray(ds.unresolved) ? ds.unresolved : []).filter((u) => u && typeof u.id === 'string').map((u) => [u.id, u]),
);

let answersChecked = 0;
let tellsChecked = 0;
let clientAbsenceChecked = 0;
let evidenceChecked = 0;
const unresolvedReferenced = new Set();
const anyShared = [];
const mappedInventoryRows = new Set();

const tri = (v) => v === true || v === false || v === null;

for (const a of answers) {
  const where = `${DS_REL} answer ${JSON.stringify(`${a.category}|${a.type}`)}`;

  for (const field of ['collected', 'shared']) {
    const block = a[field];
    if (!block || typeof block !== 'object') {
      problems.push(`${where} has no \`${field}\` object keyed by posture. The answer depends on which artefact ships; one value cannot express that.`);
      continue;
    }
    for (const p of POSTURES) {
      if (!Object.prototype.hasOwnProperty.call(block, p)) {
        problems.push(`${where} \`${field}\` has no entry for posture "${p}". A posture with no answer is a form field left blank for whichever build ships.`);
      } else if (!tri(block[p])) {
        problems.push(`${where} \`${field}.${p}\` is ${JSON.stringify(block[p])}; it must be true, false, or null for "not established yet".`);
      }
    }
  }
  if (!a.collected || typeof a.collected !== 'object') continue;
  answersChecked++;

  const collectedValues = POSTURES.map((p) => a.collected[p]);
  const sharedValues = POSTURES.map((p) => (a.shared ?? {})[p]);
  const everCollected = collectedValues.some((v) => v === true);
  const everNull = collectedValues.some((v) => v === null) || sharedValues.some((v) => v === null);
  const neverCollected = collectedValues.every((v) => v === false);

  if (sharedValues.some((v) => v === true)) anyShared.push(`${a.category}|${a.type}`);

  // `null` is a legitimate answer and it is EXACTLY as legitimate as the write-up
  // behind it. An unattached null is "we did not think about it" wearing the
  // costume of "we thought hard and could not tell".
  if (everNull) {
    if (typeof a.unresolved !== 'string' || !unresolvedById.has(a.unresolved)) {
      problems.push(
        `${where} answers \`null\` for at least one posture and names no entry in the declaration's own \`unresolved\` list. A null with nothing recording the question, who owns it and how it would be settled is an unanswered form field with no plan to answer it — and it will be filled in from memory by whoever opens the console.`,
      );
    } else {
      unresolvedReferenced.add(a.unresolved);
    }
  }

  if (everCollected) {
    if (!Array.isArray(a.purposes) || a.purposes.length === 0) {
      problems.push(`${where} is collected and declares no \`purposes\`. Play requires at least one purpose per collected type.`);
    } else {
      for (const p of a.purposes) {
        if (VALID_PURPOSES.size > 0 && !VALID_PURPOSES.has(p)) {
          problems.push(`${where} declares purpose ${JSON.stringify(p)}, which is not one of the purposes Play offers (vocabulary.purposes).`);
        }
      }
    }
    if (typeof a.required !== 'boolean') {
      problems.push(
        `${where} is collected and \`required\` is ${JSON.stringify(a.required)}. Play asks required-or-optional for every collected type, and "optional" is a claim that the app works without it — it needs a deliberate answer, not an absent one.`,
      );
    }
    if (!Array.isArray(a.evidence) || a.evidence.length === 0) {
      problems.push(`${where} is collected and names no \`evidence\`. A declared collection nobody can point at the code for cannot be reviewed when it changes.`);
    }
  } else if (neverCollected && a.required !== null && a.required !== undefined) {
    problems.push(`${where} is not collected in any posture and still declares \`required: ${JSON.stringify(a.required)}\`. Required-or-optional is only asked about collected types; a value here is an answer to a question Play does not ask.`);
  }

  for (const rel of Array.isArray(a.evidence) ? a.evidence : []) {
    if (!exists(rel)) {
      problems.push(`${where} names evidence ${rel}, which does not exist. The row is pointing at a file that moved or was deleted, so nothing connects the declared answer to the code behind it.`);
    } else evidenceChecked++;
  }
  for (const id of Array.isArray(a.inventoryRows) ? a.inventoryRows : []) mappedInventoryRows.add(id);

  if (typeof a.basis !== 'string' || a.basis.trim() === '') {
    problems.push(`${where} records no \`basis\`. An answer with no stated reasoning cannot be re-checked by the next person, who will re-derive it from scratch or, more likely, trust it.`);
  }

  // ── CLIENT-SIDE ABSENCE, ASSERTED WHATEVER THE ANSWER IS ─────────────────
  // 🔴 THE GAP THIS CLOSES IS THIS REPOSITORY'S SIGNATURE DEFECT: A CHECK THAT
  // STOPPED CHECKING. `tells` below are evaluated ONLY for a row claiming
  // "never collected in any posture". The moment a row answers `true` — or
  // `null` — for one posture, its whole tell list goes silent while still
  // sitting in the file looking like coverage. When this limb was written that
  // was true of 24 tells across four rows, including EVERY location tell,
  // because a `null` is not a `false`.
  //
  // `clientAbsence` is the half of the claim that SURVIVES collection: "this
  // type is collected, but the device still contributes nothing to it". For
  // Approximate location that is the entire answer — the geo is inferred at the
  // Cloudflare edge, and if `geolocator` ever appeared the row would become
  // device location, with different purposes and a different `required`.
  const ca = a.clientAbsence;
  if (ca !== undefined) {
    if (!ca || typeof ca !== 'object' || Array.isArray(ca)) {
      problems.push(`${where} has a \`clientAbsence\` that is not an object.`);
    } else {
      const caPerms = ca.androidPermissions ?? [];
      const caPkgs = ca.dartPackages ?? [];
      const caKeys = ca.iosUsageDescriptionKeys ?? [];
      if (caPerms.length + caPkgs.length + caKeys.length === 0) {
        coverageLost([
          `${where} declares \`clientAbsence\` with ZERO tells in it.`,
          'This block exists to keep asserting "the device contributes nothing" at exactly the point where the',
          'ordinary tells limb goes quiet. Empty, it asserts nothing while looking precisely like the thing that',
          'does — and an assertion that cannot fail is worse than none, because it inflates apparent coverage.',
          'Give it tells, or delete the block and stop implying the claim is checked.',
        ]);
      }
      if (typeof ca.claim !== 'string' || ca.claim.trim() === '') {
        problems.push(
          `${where} declares \`clientAbsence\` with no \`claim\`. The tells only mean something against a stated sentence — what exactly becomes false if one of them appears — and without it the next person cannot tell whether a hit means "change the answer" or "remove the dependency".`,
        );
      }
      const broke = `The device can now supply this type DIRECTLY, so this row's purposes, its \`required\` answer, its \`shared\` answer and its basis are all describing an app that no longer exists.`;
      for (const perm of caPerms) {
        clientAbsenceChecked++;
        if (allPerms.has(perm)) {
          problems.push(
            `🔴 ${where} declares clientAbsence and ${perm} is now declared in ${[...permsByFile].filter(([, v]) => v.includes(perm)).map(([f]) => f).join(', ')}. ${broke} The claim it breaks: ${ca.claim ?? '(none stated)'}`,
          );
        }
      }
      for (const pkg of caPkgs) {
        clientAbsenceChecked++;
        if (directDeps.has(pkg)) {
          problems.push(
            `🔴 ${where} declares clientAbsence and \`${pkg}\` is now a direct dependency in ${pubspecRel}. ${broke} The claim it breaks: ${ca.claim ?? '(none stated)'}`,
          );
        }
      }
      for (const key of caKeys) {
        clientAbsenceChecked++;
        if (usageKeys.has(key)) {
          problems.push(
            `🔴 ${where} declares clientAbsence and ${key} now appears in an Info.plist. Apple requires that key only when the capability is actually used, so its presence is a positive statement that the device does the thing this claim denies. ${broke}`,
          );
        }
      }
    }
  }

  // ── THE TELLS ────────────────────────────────────────────────────────────
  // Only meaningful for a claim of ABSENCE. A tell present while the widest
  // claim says "never collected" is the declaration having become false.
  const tells = a.tells ?? {};
  const hasTells =
    (tells.androidPermissions?.length ?? 0) + (tells.dartPackages?.length ?? 0) + (tells.iosUsageDescriptionKeys?.length ?? 0) > 0;

  // 🔬 DEAD TELLS. The general half of the rule above, needing no list: a
  // `tells` block on a row that is collected (or unresolved) in ANY posture can
  // never be reached by the loop below, so it is an assertion that cannot fire.
  // The repository's own rule is that such a thing is worse than none — it is
  // read as coverage by everyone who greps the file. Re-point it at
  // `clientAbsence`, which is evaluated unconditionally, or delete it.
  if (!neverCollected && hasTells) {
    problems.push(
      `${where} carries a \`tells\` block and is not "never collected" in every posture (collected: ${JSON.stringify(a.collected)}). The tells limb only evaluates never-collected rows, so every tell in that block is UNREACHABLE — it looks like coverage and can never fire. Move it to \`clientAbsence\` if the claim survives the row being collected (it usually does: "collected, but never from the device"), or delete it.`,
    );
  }

  if (neverCollected && !hasTells && a.derivationNote === undefined) {
    // Not a failure: several types genuinely have no mechanical tell (Race and
    // ethnicity is a form field, not a permission). What WOULD be dishonest is
    // pretending otherwise, so it prints instead — a tell-less absence claim is
    // a human's word, and the count is printed so nobody reads the pass line as
    // "every absence was verified".
    prints.push(`NO MECHANICAL TELL — ${a.category} > ${a.type} is declared never collected and nothing in the tree could contradict it. Human-owned by construction.`);
  }
  if (!neverCollected) continue;

  for (const perm of tells.androidPermissions ?? []) {
    tellsChecked++;
    if (allPerms.has(perm)) {
      problems.push(
        `🔴 ${where} declares this type is NEVER collected, and ${perm} is now declared in ${[...permsByFile].filter(([, v]) => v.includes(perm)).map(([f]) => f).join(', ')}. The declaration has become FALSE. Either the permission is a mistake, or the Data safety answer must change before this build reaches Play — a label that contradicts the manifest is the exact case Google's User Data policy enforces on.`,
      );
    }
  }
  for (const pkg of tells.dartPackages ?? []) {
    tellsChecked++;
    if (directDeps.has(pkg)) {
      problems.push(
        `🔴 ${where} declares this type is NEVER collected, and \`${pkg}\` is now a direct dependency in ${pubspecRel}. That package exists to do the thing this answer says the app does not do. Update the answer, or remove the dependency.`,
      );
    }
  }
  for (const key of tells.iosUsageDescriptionKeys ?? []) {
    tellsChecked++;
    if (usageKeys.has(key)) {
      problems.push(
        `🔴 ${where} declares this type is NEVER collected, and ${key} now appears in an Info.plist. Apple requires that key only when the capability is actually used, so its presence is a positive statement that the app does the thing this answer denies.`,
      );
    }
  }
}

if (answersChecked === 0 && problems.length === 0) {
  coverageLost(['NOT ONE answer was shape-checked.', 'Every per-answer limb above ran over an empty set.']);
}
if (tellsChecked === 0 && problems.length === 0) {
  coverageLost([
    'NOT ONE tell was evaluated against the tree.',
    'The tells are the whole reason this declaration is checkable rather than asserted: with none',
    'evaluated, adding a location permission or a location package would change nothing here and the',
    '"not collected" answers would be believed forever. Either every answer lost its `tells` block, or',
    'the walks above stopped reaching the manifests and the pubspec.',
  ]);
}

// ── REQUIRED_COVERAGE for the clientAbsence limb ─────────────────────────────
// 🔴 THE LIMB ABOVE IS OPTIONAL PER ROW, WHICH MEANS IT CAN BE DELETED PER ROW
// AND NOTHING WOULD SAY SO. The rows where "collected, but never from the
// device" is the load-bearing sentence are named in the declaration, and a named
// row that has lost its block fails here. This is the same shape as
// check-migrations.mjs's REQUIRED_COVERAGE, and it exists for the same recorded
// reason: a scanner that quietly stopped covering the thing it was written for
// still prints "clean".
const caRequired = ds.clientAbsenceRequiredFor?.types;
if (!Array.isArray(caRequired) || caRequired.length === 0) {
  coverageLost([
    `${DS_REL} clientAbsenceRequiredFor.types is missing or empty.`,
    'That list is the only thing making the `clientAbsence` limb non-deletable per row. Empty, every row',
    'could drop its block and this guard would report the same green it reports now — which is precisely',
    'the failure mode the block was added to close.',
  ]);
}
for (const key of caRequired) {
  const a = answerByKey.get(key);
  if (!a) {
    problems.push(
      `${DS_REL} clientAbsenceRequiredFor names ${JSON.stringify(key)} and there is no answer with that "Category|Type". Either the type was renamed on one side only, or the row was removed and this requirement outlived it.`,
    );
  } else if (a.clientAbsence === undefined) {
    problems.push(
      `🔴 ${DS_REL} answer ${JSON.stringify(key)} is required to carry a \`clientAbsence\` block and does not. That row's answer depends on the DEVICE contributing nothing to the data type — a claim the ordinary tells limb stops checking the moment the row is collected. Without the block, adding a location package, an ads SDK or a third-party analytics SDK would change nothing in this guard.`,
    );
  }
}
if (clientAbsenceChecked === 0 && problems.length === 0) {
  coverageLost([
    'NOT ONE clientAbsence tell was evaluated against the tree.',
    'Every row named in clientAbsenceRequiredFor either lost its block or lost its tells, so the claim that',
    'the device contributes nothing to Approximate location, the email address, app interactions and the',
    'device identifiers is now asserted by nobody and checked by nothing.',
  ]);
}

// ── the resolved list: a settled question keeps its write-up, AND its answer ──
// 🔴 A RESOLVED ENTRY IS A CHECK, NOT A SCRAPBOOK. Both of this declaration's
// open questions were settled on 2026-08-04 and both write-ups were kept, because
// the first thing anyone re-deriving a sworn declaration asks is why the value is
// what it is. But a kept write-up that nothing verifies is just prose: the limb
// below requires every type a resolved entry claims to have settled to be
// NON-NULL in every posture. Re-null an answer while leaving it listed as
// resolved — the exact shape of backsliding — and the build fails.
const resolved = Array.isArray(ds.resolved) ? ds.resolved : [];
let resolvedChecked = 0;
for (const r of resolved) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || r.id.trim() === '') {
    problems.push(`${DS_REL} carries a \`resolved\` entry with no \`id\`.`);
    continue;
  }
  const where = `${DS_REL} resolved "${r.id}"`;
  if (unresolvedById.has(r.id)) {
    problems.push(
      `${where} is ALSO listed in \`unresolved\`. One question cannot be both open and settled, and whichever of the two a reader happens to hit first becomes the answer they act on.`,
    );
  }
  for (const field of ['question', 'answer', 'settledOn', 'settledBy', 'ownerItem']) {
    if (typeof r[field] !== 'string' || r[field].trim() === '') {
      problems.push(
        `${where} has no \`${field}\`. A settled question needs the question, the answer, the day, who or what settled it and whose item it was — anything less is a value with no provenance, which is what this whole file exists not to be.`,
      );
    }
  }
  if (typeof r.settledOn === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(r.settledOn)) {
    problems.push(`${where}.settledOn is not an ISO date (YYYY-MM-DD): ${JSON.stringify(r.settledOn)}`);
  }
  const affects = Array.isArray(r.affects) ? r.affects : [];
  if (affects.length === 0) {
    problems.push(`${where} names no \`affects\`. A resolution that points at no Play data type cannot be checked against any answer, so nothing stops the answer drifting back.`);
  }
  for (const t of affects) {
    const hit = [...vocabTypes.values()].find((v) => v.type === t);
    if (!hit) {
      problems.push(`${where} says it affects ${JSON.stringify(t)}, which is not a Play data type in the vocabulary.`);
      continue;
    }
    const a = answerByKey.get(`${hit.category}|${hit.type}`);
    if (!a) continue;
    resolvedChecked++;
    const stillNull = POSTURES.filter((p) => a.collected?.[p] === null || (a.shared ?? {})[p] === null);
    if (stillNull.length > 0) {
      problems.push(
        `🔴 ${where} claims to have settled ${JSON.stringify(t)} on ${r.settledOn}, and that answer is STILL null for posture(s) ${stillNull.join(', ')}. Either the answer was re-opened and this entry was not moved back to \`unresolved\`, or it was never actually filled in. A question recorded as settled while the form field it settles is blank is worse than an open one: the open list is what the guard prints as blocking, and this row is not on it.`,
      );
    }
  }
}
if (resolved.length > 0 && resolvedChecked === 0 && problems.length === 0) {
  coverageLost([
    `${DS_REL} declares ${resolved.length} \`resolved\` entr(ies) and NOT ONE was matched to an answer row.`,
    'The backslide check ranges over those matches, so it measured nothing while reporting ok — and the',
    'entries would sit there asserting that two blocking questions are closed, which is the one claim in',
    'this file nobody should take on trust.',
  ]);
}

// ── the unresolved list, in both directions ──────────────────────────────────
for (const [id, u] of unresolvedById) {
  for (const field of ['question', 'ownerItem', 'howToResolve', 'status']) {
    if (typeof u[field] !== 'string' || u[field].trim() === '') {
      problems.push(`${DS_REL} unresolved "${id}" has no \`${field}\`. An open question with no owner and no procedure to settle it is a permanent exemption with a polite label.`);
    }
  }
  for (const t of Array.isArray(u.affects) ? u.affects : []) {
    if (![...vocabTypes.values()].some((v) => v.type === t)) {
      problems.push(`${DS_REL} unresolved "${id}" says it affects ${JSON.stringify(t)}, which is not a Play data type in the vocabulary.`);
    }
  }
  if (!unresolvedReferenced.has(id)) {
    problems.push(
      `${DS_REL} unresolved "${id}" is referenced by NO answer. Either the answer it belonged to was resolved and this entry outlived it — leaving a question that looks open about something already settled — or an answer lost its \`unresolved\` pointer and its null is now unattached.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · THE INVENTORY RELATION, BOTH DIRECTIONS.
// ─────────────────────────────────────────────────────────────────────────────
const stores = Array.isArray(inventory.stores) ? inventory.stores : [];
if (stores.length === 0) {
  coverageLost([`${INVENTORY_REL} declares no \`stores\`.`, 'The mapping limb has no right-hand side and would pass by comparing against nothing.']);
}
const storeById = new Map(stores.map((s) => [s.id, s]));
const personalRows = stores.filter((s) => s.personalData === true);
if (personalRows.length === 0) {
  coverageLost([
    `${INVENTORY_REL} has NO row marked \`personalData: true\`.`,
    'The mapping limb ranges over those rows. With none, "every store holding personal data is mapped to',
    'a Play data type" is vacuously true — and it is precisely the rows holding personal data that a Data',
    'safety declaration exists to describe.',
  ]);
}
const excluded = ds.inventory?.notFromThisApp ?? {};
let mappingChecked = 0;
for (const s of personalRows) {
  mappingChecked++;
  const isMapped = mappedInventoryRows.has(s.id);
  const isExcluded = Object.prototype.hasOwnProperty.call(excluded, s.id);
  if (isMapped && isExcluded) {
    problems.push(
      `${DS_REL} both MAPS ${s.id} to a Play data type and lists it in inventory.notFromThisApp. One of the two is wrong and both are in this file: either this app puts data there, or it does not.`,
    );
  } else if (!isMapped && !isExcluded) {
    problems.push(
      `🔴 ${INVENTORY_REL} row ${s.id} (${s.name}) holds personal data and ${DS_REL} neither maps it to a Play data type nor excludes it in inventory.notFromThisApp with a reason. A store holding something about a person that the Data safety declaration is silent about is the gap this guard exists to close — the same shape as a store with no inventory row at all.`,
    );
  } else if (isExcluded && (typeof excluded[s.id] !== 'string' || excluded[s.id].trim() === '')) {
    problems.push(`${DS_REL} inventory.notFromThisApp["${s.id}"] carries no reason. An exclusion with no argument is a row somebody decided not to think about.`);
  }
}
for (const id of Object.keys(excluded)) {
  if (!storeById.has(id)) {
    problems.push(
      `${DS_REL} inventory.notFromThisApp names ${JSON.stringify(id)} and ${INVENTORY_REL} has no such row. Either the store was renamed and this exclusion still describes the old one, or it was removed and the exclusion outlived it — the direction that stops this becoming a list that always looks complete.`,
    );
  }
}
for (const id of mappedInventoryRows) {
  if (!storeById.has(id)) {
    problems.push(`${DS_REL} maps a Play data type to inventory row ${JSON.stringify(id)}, which does not exist in ${INVENTORY_REL}.`);
  }
}
if (mappingChecked === 0 && problems.length === 0) {
  coverageLost(['NOT ONE personal-data inventory row was compared to the declaration.']);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 · EQUALITY: the declared permission set and the declared dependency set.
// ─────────────────────────────────────────────────────────────────────────────
const declaredPerms = ds.androidPermissions?.declaredInRepo ?? {};
const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
let permFilesChecked = 0;
for (const [f, found] of permsByFile) {
  if (!Object.prototype.hasOwnProperty.call(declaredPerms, f)) {
    problems.push(
      `${DS_REL} androidPermissions.declaredInRepo has no entry for ${f}, and that manifest exists. An unlisted manifest is a set of permissions this declaration has never been compared against.`,
    );
    continue;
  }
  permFilesChecked++;
  const declared = [...(declaredPerms[f] ?? [])].sort();
  if (!sameSet(declared, found)) {
    problems.push(
      `🔴 ${f} declares [${found.join(', ') || '(none)'}] and ${DS_REL} says [${declared.join(', ') || '(none)'}]. A permission is the loudest single tell that a data type has started being collected — say which Play data type this changes, in the same commit.`,
    );
  }
}
for (const f of Object.keys(declaredPerms)) {
  if (!permsByFile.has(f)) {
    problems.push(`${DS_REL} androidPermissions.declaredInRepo names ${f}, which does not exist. The declaration is describing a manifest that is gone.`);
  }
}
if (permFilesChecked === 0 && problems.length === 0) {
  coverageLost(['NOT ONE manifest was compared to the declared permission set.']);
}
if (typeof ds.androidPermissions?.cannotSee !== 'string' || ds.androidPermissions.cannotSee.trim() === '') {
  problems.push(
    `${DS_REL} androidPermissions carries no \`cannotSee\`. This walk reads only the manifests in this repository and Gradle merges more in from every plugin; a declaration that does not say so invites the permission set above to be read as complete, which it is not.`,
  );
}

const declaredDeps = ds.dependencySurface?.direct ?? {};
let depsChecked = 0;
for (const dep of [...directDeps].sort()) {
  const entry = declaredDeps[dep];
  if (entry === undefined) {
    problems.push(
      `🔴 ${pubspecRel} depends on \`${dep}\` and ${DS_REL} dependencySurface.direct has no entry for it. A new dependency arrived and nobody said what data it can collect. This is the mechanism by which a permission-bearing SDK actually enters an app — the manifest change happens inside a package this repository does not contain — so it is a build failure, not a note.`,
    );
    continue;
  }
  depsChecked++;
  if (!Array.isArray(entry.introduces)) {
    problems.push(`${DS_REL} dependencySurface.direct["${dep}"] has no \`introduces\` array (use [] for "collects nothing").`);
  } else {
    for (const t of entry.introduces) {
      const hit = [...vocabTypes.values()].find((v) => v.type === t);
      if (!hit) {
        problems.push(`${DS_REL} dependencySurface.direct["${dep}"].introduces names ${JSON.stringify(t)}, which is not a Play data type in the vocabulary.`);
        continue;
      }
      const a = answerByKey.get(`${hit.category}|${hit.type}`);
      if (a && POSTURES.every((p) => a.collected?.[p] === false)) {
        problems.push(
          `${DS_REL} says \`${dep}\` introduces ${JSON.stringify(t)} and the answer for that type declares it NEVER collected in any posture. The dependency map and the answer contradict each other, and both are in this file.`,
        );
      }
    }
  }
  if (typeof entry.why !== 'string' || entry.why.trim() === '') {
    problems.push(`${DS_REL} dependencySurface.direct["${dep}"] carries no \`why\`. "Introduces nothing" is a claim, and a claim with no argument is the one nobody re-checks.`);
  }
}
for (const dep of Object.keys(declaredDeps)) {
  if (!directDeps.has(dep)) {
    problems.push(
      `${DS_REL} dependencySurface.direct names \`${dep}\` and ${pubspecRel} no longer depends on it. Either it was removed and this entry outlived it, or it was renamed on one side only — the direction that stops this map looking complete while describing a graph that is gone.`,
    );
  }
}
if (depsChecked === 0 && problems.length === 0) {
  coverageLost(['NOT ONE direct dependency was compared to the declared dependency surface.']);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7b · THE CRASH SDK VERSION PIN.
//
// 🔴 "DEVICE OR OTHER IDS = TRUE" IS A FACT ABOUT A VERSION, NOT AN ETERNAL ONE.
// It was established by reading sentry_flutter 9.26.0 and the sentry-android
// 8.51.0 it carries: DeviceInfoUtil sets contexts.device.id to a UUID persisted
// for the life of the install, ungated by sendDefaultPii, and the Dart layer
// passes the unmodelled key straight through. Sentry ships often and Renovate
// bumps this repository automatically, so the single most likely way that answer
// silently becomes wrong — in EITHER direction — is a dependency bump nobody
// connected to a store declaration.
//
// The pin is compared to the COMMITTED pubspec.lock, not to the pubspec range: a
// `^9.26.0` constraint is satisfied by 9.99.0, so the constraint is not what was
// read. The lock is the resolved version CI actually builds.
// ─────────────────────────────────────────────────────────────────────────────
const css = ds.crashSdkSurface;
let pinsChecked = 0;
if (!css || typeof css !== 'object') {
  problems.push(
    `${DS_REL} carries no \`crashSdkSurface\`. The Device-or-other-IDs answer rests entirely on what a specific version of the crash SDK does; with no pin recorded, a Renovate bump changes the behaviour behind a sworn declaration and nothing anywhere notices.`,
  );
} else {
  const lockRel = typeof css.lockfile === 'string' ? css.lockfile : 'pubspec.lock';
  const lockText = read(lockRel);
  if (lockText === null) {
    coverageLost([
      `${DS_REL} crashSdkSurface.lockfile names ${lockRel}, which does not exist.`,
      'The version comparison below is the only thing tying the device-identifier answer to the code that',
      'was actually read. With no lockfile it would range over nothing and report the pin confirmed.',
    ]);
  }
  // Parse the resolved versions. Structure, not a grep: `version:` appears under
  // every one of ~200 packages, so the walk is anchored on the package heading
  // and stops at the next one.
  const lockVersions = new Map();
  {
    const lines = lockText.split('\n');
    let current = null;
    for (const line of lines) {
      const head = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*$/);
      if (head) {
        current = head[1];
        continue;
      }
      if (current === null) continue;
      if (/^ {0,2}\S/.test(line)) current = null;
      const v = line.match(/^ {4}version:\s*"?([^"\s]+)"?\s*$/);
      if (v && current !== null) {
        lockVersions.set(current, v[1]);
        current = null;
      }
    }
  }
  if (lockVersions.size === 0) {
    coverageLost([
      `${lockRel} parsed to ZERO resolved package versions.`,
      'Either the lockfile format moved or this parse is wrong. Every pin below would then be "not found"',
      'and the limb would fail for the wrong reason — or, if the loop were written the other way round,',
      'pass by comparing nothing. Fix the parse before trusting either outcome.',
    ]);
  }
  const pinned = css.pinned;
  if (!pinned || typeof pinned !== 'object' || Object.keys(pinned).length === 0) {
    coverageLost([
      `${DS_REL} crashSdkSurface.pinned is missing or empty.`,
      'It names the packages whose source was actually read. Empty, the loop below compares nothing and the',
      'declaration silently stops being tied to any particular SDK behaviour.',
    ]);
  }
  for (const [pkg, declaredVersion] of Object.entries(pinned)) {
    const actual = lockVersions.get(pkg);
    if (actual === undefined) {
      problems.push(
        `🔴 ${DS_REL} crashSdkSurface.pinned names \`${pkg}\` and ${lockRel} resolves no such package. The crash SDK the declaration was written against is not in the dependency graph at all — so either it was removed (and the crash-log, diagnostics and device-identifier answers all now overstate what ships) or it was renamed and this pin was left behind.`,
      );
      continue;
    }
    pinsChecked++;
    if (actual !== declaredVersion) {
      problems.push(
        `🔴 ${lockRel} resolves \`${pkg}\` to ${actual} and ${DS_REL} crashSdkSurface.pinned records ${declaredVersion}. The "Device or other IDs" answer was derived by READING THAT SDK's source — specifically that it attaches a persistent per-install id to contexts.device and that sendDefaultPii does not suppress it. A different version is a different program, and the answer on a sworn declaration must not survive a bump on the strength of it having been true once. Re-read the SDK, then update this pin in the same commit.`,
      );
    }
  }
  if (typeof css.cannotSee !== 'string' || css.cannotSee.trim() === '') {
    problems.push(
      `${DS_REL} crashSdkSurface carries no \`cannotSee\`. Reading the SDK settles what LEAVES THE DEVICE and says nothing about what the receiving GlitchTip instance does with it. A block that does not say so invites the pin above to be read as a complete answer about the crash rail, which it is not.`,
    );
  }
}
if (pinsChecked === 0 && problems.length === 0) {
  coverageLost([
    'NOT ONE crash-SDK version pin was compared to the lockfile.',
    'The device-identifier answer is version-scoped by construction; with no pin compared, the version it',
    'was scoped to is a comment.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 · DATA SECURITY: encryption in transit, and the deletion route.
// ─────────────────────────────────────────────────────────────────────────────
const sec = ds.dataSecurity ?? {};

// (a) Encrypted in transit — proven by there being no plaintext endpoint in the
//     shipped client, not by asserting TLS. `https://` does not contain
//     `http://`, so the match is exact without a lookahead.
const enc = sec.encryptedInTransit ?? {};
let dartScanned = 0;
if (enc.answer === true) {
  const roots = Array.isArray(enc.clientRoots) ? enc.clientRoots : [];
  if (roots.length === 0) {
    problems.push(`${DS_REL} dataSecurity.encryptedInTransit declares true and names no \`clientRoots\` to prove it over. The answer would be an assertion with nothing behind it.`);
  }
  const offenders = [];
  for (const rootRel of roots) {
    for (const f of walk(rootRel)) {
      if (!f.endsWith('.dart') || /\/test\//.test(f) || f.endsWith('_test.dart')) continue;
      dartScanned++;
      const src = stripSourceComments(read(f) ?? '', '.dart');
      if (src.includes('http://')) offenders.push(f);
    }
  }
  if (dartScanned === 0) {
    coverageLost([
      `dataSecurity.encryptedInTransit declares true and ZERO Dart files were scanned under ${roots.join(', ')}.`,
      '"No plaintext endpoint" would be true by having read nothing, which is the shape of every silent',
      'under-coverage this repository has recorded.',
    ]);
  }
  for (const f of offenders) {
    problems.push(
      `🔴 ${f} contains a \`http://\` URL in shipped client code, and ${DS_REL} declares all data encrypted in transit. One plaintext endpoint makes that answer false for every data type at once.`,
    );
  }
}

// (b) Deletion. Play requires BOTH an in-app path and a web link, and the web
//     link is submitted on this very form.
const del = sec.deletionRequestSupported ?? {};
let erasureRoutesChecked = 0;
if (del.answer === true) {
  if (typeof del.webDeletionUrl !== 'string' || !/^https:\/\/\S+$/.test(del.webDeletionUrl)) {
    problems.push(
      `${DS_REL} declares deletion supported and \`webDeletionUrl\` is not a single absolute https URL. Play requires a "web link resource where users can request app account deletion and associated data deletion", submitted in this form and functional.`,
    );
  }
  for (const [field, label] of [
    ['sitePage', 'the page the web deletion URL resolves to'],
    ['inAppControl', 'the in-app deletion control'],
  ]) {
    const rel = del[field];
    if (typeof rel !== 'string' || rel.trim() === '') {
      problems.push(`${DS_REL} declares deletion supported and names no \`${field}\` (${label}).`);
    } else if (!exists(rel)) {
      problems.push(
        `🔴 ${DS_REL} names ${rel} as ${label} and it does not exist. The declaration promises Google a deletion path that is not in the tree — and a user told their data is deleted stops asking, which is why a broken deletion route is worse than none.`,
      );
    }
  }
  for (const g of Array.isArray(del.guards) ? del.guards : []) {
    if (!exists(g)) problems.push(`${DS_REL} names ${g} as a guard behind the deletion answer and it does not exist.`);
  }

  // 🔴 THE ROUTES ARE DERIVED, NOT LISTED. Every inventory row this declaration
  // maps to a Play data type carries its own erasure story, and the rows whose
  // story is `purge`/`unlink` name the route that performs it. Taking the route
  // set from there means renaming or deleting a route fails HERE too, and there
  // is no second list of routes to drift from the first.
  const routes = new Set();
  for (const id of mappedInventoryRows) {
    const s = storeById.get(id);
    if (s?.erasure && typeof s.erasure.route === 'string') routes.add(s.erasure.route);
  }
  for (const r of [...routes].sort()) {
    erasureRoutesChecked++;
    if (!exists(r)) {
      problems.push(
        `🔴 ${INVENTORY_REL} says an erasure request reaches a store this declaration maps, via ${r}, and that file does not exist. "Users can request that their data is deleted" is answered YES on this form; the route answering it is gone.`,
      );
    }
  }
  if (routes.size === 0) {
    problems.push(
      `${DS_REL} declares deletion supported and NOT ONE mapped inventory row names an erasure route. Either no row with a route is mapped — in which case the deletion answer covers nothing this app writes — or the mapping lost its \`inventoryRows\`. Both make the answer unbacked.`,
    );
  }
} else if (del.answer !== false) {
  problems.push(`${DS_REL} dataSecurity.deletionRequestSupported.answer is ${JSON.stringify(del.answer)}; Play asks a yes/no question.`);
}

for (const [k, label] of [['playFamiliesPolicy', 'Play Families Policy badge'], ['independentSecurityReview', 'Independent Security Review badge']]) {
  const block = sec[k];
  if (!block || typeof block.answer !== 'boolean') {
    problems.push(`${DS_REL} dataSecurity.${k} has no boolean \`answer\`. The ${label} is a question on the form and an absent answer is one somebody fills in from memory.`);
  } else if (typeof block.basis !== 'string' || block.basis.trim() === '') {
    problems.push(`${DS_REL} dataSecurity.${k} records no \`basis\`.`);
  } else if (block.humanOwned === true) {
    prints.push(`HUMAN-OWNED — dataSecurity.${k} = ${block.answer}. ${block.basis}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9 · THE CONTENT RATING RECORD.
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 NO INVENTED RATING. Google: "Your app's content ratings are assigned by
// separate rating authorities and determined by your questionnaire responses."
// A rating in this file before the questionnaire is submitted is a value nobody
// computed, and it would be read as authoritative by the next person.
if (cr.assignedRating !== null && cr.assignedRating !== undefined) {
  const cert = cr.iarcCertificate;
  const ok = cert && typeof cert.id === 'string' && cert.id.trim() !== '' && cert.source && typeof cert.source.url === 'string' && typeof cert.source.fetched === 'string';
  if (!ok) {
    problems.push(
      `🔴 ${CR_REL} records assignedRating ${JSON.stringify(cr.assignedRating)} with no \`iarcCertificate\` carrying an id and a source. Ratings are ASSIGNED by the rating authorities from the submitted questionnaire — they are not chosen. A rating written here without the certificate that issued it is a guess wearing the costume of a result.`,
    );
  }
} else if (cr.status !== 'pending-questionnaire-submission') {
  problems.push(
    `${CR_REL} has no assignedRating and \`status\` is ${JSON.stringify(cr.status)}. When there is no rating the status must say so — "pending-questionnaire-submission" — so that "we do not have one" is distinguishable from "nobody filled this in".`,
  );
} else if (typeof cr.statusReason !== 'string' || cr.statusReason.trim() === '') {
  problems.push(`${CR_REL} is pending and records no \`statusReason\`.`);
} else {
  prints.push(`CONTENT RATING PENDING — ${cr.statusReason}`);
}

const claims = Array.isArray(cr.claims) ? cr.claims : [];
if (claims.length === 0) {
  coverageLost([`${CR_REL} declares no \`claims\`.`, 'Every content-rating limb below iterates them.']);
}
const DERIVATIONS = new Set(['listing-category', 'dependency-tells', 'cross-check', 'human-owned']);
const claimById = new Map();
let claimsChecked = 0;
for (const c of claims) {
  const where = `${CR_REL} claim "${c.id}"`;
  if (typeof c.id !== 'string' || c.id.trim() === '') {
    problems.push(`${CR_REL} carries a claim with no \`id\`.`);
    continue;
  }
  claimById.set(c.id, c);
  if (typeof c.answer !== 'boolean') {
    problems.push(`${where} has no boolean \`answer\`.`);
  }
  if (typeof c.basis !== 'string' || c.basis.trim() === '') {
    problems.push(`${where} records no \`basis\`.`);
  }
  if (!DERIVATIONS.has(c.derivation)) {
    problems.push(
      `${where} declares derivation ${JSON.stringify(c.derivation)}, which is not one of ${[...DERIVATIONS].join(', ')}. Every claim is either derived from the tree or owned by a human — there is no third category, and a claim with neither is one nobody checks and nobody owns.`,
    );
    continue;
  }
  claimsChecked++;

  if (c.derivation === 'human-owned') {
    if (!Array.isArray(c.surfaces) || c.surfaces.length === 0) {
      problems.push(`${where} is human-owned and names no \`surfaces\` for a reviewer to re-read. "Somebody checked" with no scope is not a check.`);
    } else {
      for (const s of c.surfaces) {
        if (!exists(s)) problems.push(`${where} names surface ${s}, which does not exist.`);
      }
      prints.push(`HUMAN-OWNED — content rating "${c.id}" = ${c.answer}. Re-read: ${c.surfaces.join(', ')}`);
    }
  }

  if (c.derivation === 'listing-category') {
    const f = c.categoryFile;
    const text = typeof f === 'string' ? read(f) : null;
    if (text === null) {
      problems.push(`${where} names categoryFile ${JSON.stringify(f)}, which does not exist.`);
    } else if (text.trim() !== c.categoryValue) {
      problems.push(
        `🔴 ${where} records categoryValue ${JSON.stringify(c.categoryValue)} and ${f} says ${JSON.stringify(text.trim())}. The questionnaire branches on app-vs-game at its first question; a listing filed under one and a questionnaire answered as the other is the misrepresentation Google removes apps for.`,
      );
    } else if (Array.isArray(c.gameCategories) && c.gameCategories.some((g) => g.toLowerCase() === text.trim().toLowerCase())) {
      problems.push(`🔴 ${where} answers "not a game" and ${f} names a game category (${text.trim()}).`);
    }
  }

  if (c.derivation === 'dependency-tells') {
    const t = c.tells ?? {};
    const n = (t.dartPackages?.length ?? 0) + (t.androidPermissions?.length ?? 0);
    if (n === 0) {
      problems.push(
        `${where} claims derivation "dependency-tells" and declares no tells. An assertion that cannot fail is worse than none — it inflates apparent coverage. Give it tells, or mark it human-owned honestly.`,
      );
      continue;
    }
    for (const pkg of t.dartPackages ?? []) {
      tellsChecked++;
      if (directDeps.has(pkg) !== (c.answer === true)) {
        if (directDeps.has(pkg)) {
          problems.push(
            `🔴 ${where} answers ${c.answer} and \`${pkg}\` is a direct dependency in ${pubspecRel}. That package exists to do the thing this questionnaire answer denies.`,
          );
        }
      }
    }
    for (const perm of t.androidPermissions ?? []) {
      tellsChecked++;
      if (allPerms.has(perm) && c.answer !== true) {
        problems.push(`🔴 ${where} answers ${c.answer} and ${perm} is declared in a manifest in this repository.`);
      }
    }
  }

  if (c.derivation === 'cross-check') {
    const rule = c.crossCheck?.rule;
    if (rule === 'no-answer-declares-shared') {
      const expected = anyShared.length > 0;
      if (c.answer !== expected) {
        problems.push(
          `🔴 ${where} answers ${c.answer} and ${DS_REL} declares shared:true for ${anyShared.length} data type(s)${anyShared.length ? ` (${anyShared.join(', ')})` : ''}. The Data safety form and the content rating questionnaire are asking the same question on two different screens, and they now give Google two different answers.`,
        );
      }
    } else if (rule === 'equals-play-families-policy') {
      const expected = sec.playFamiliesPolicy?.answer;
      if (typeof expected !== 'boolean') {
        problems.push(`${where} cross-checks dataSecurity.playFamiliesPolicy and that answer is not a boolean, so the comparison has nothing to compare to.`);
      } else if (c.answer !== expected) {
        problems.push(
          `🔴 ${where} answers ${c.answer} and ${DS_REL} dataSecurity.playFamiliesPolicy.answer is ${expected}. "Is this app for children" is asked on both forms; answering it two ways is a contradiction a human filling them in weeks apart will not catch.`,
        );
      }
    } else {
      problems.push(`${where} declares crossCheck.rule ${JSON.stringify(rule)}, which this guard does not implement — so the claim reads as checked and is not.`);
    }
  }
}
if (claimsChecked === 0 && problems.length === 0) {
  coverageLost([`NOT ONE content-rating claim was checked.`]);
}
const humanOwned = cr.humanOwned ?? {};
for (const [k, v] of Object.entries(humanOwned)) {
  if (k.startsWith('_')) continue;
  if (typeof v !== 'string' || v.trim() === '') {
    problems.push(`${CR_REL} humanOwned.${k} carries no description of what the human must actually do.`);
  } else prints.push(`HUMAN-OWNED — ${k}: ${v}`);
}
if (typeof cr.questionnaireWording?.status !== 'string') {
  problems.push(`${CR_REL} carries no \`questionnaireWording.status\`. The console's actual question text was either fetched and cited or it was not, and which of the two is load-bearing: a file that silently implies it mirrors the form is one nobody re-reads.`);
} else if (cr.questionnaireWording.status === 'UNVERIFIED') {
  prints.push(`UNVERIFIED — the IARC questionnaire's exact console wording was not fetched. ${cr.questionnaireWording.why ?? ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
const nulls = answers.filter((a) => POSTURES.some((p) => a.collected?.[p] === null));

if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (a human owns these; a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
if (nulls.length) {
  console.log('');
  console.log('   ── 🔴 THE FORM CANNOT BE SUBMITTED YET ──');
  for (const a of nulls) {
    const u = unresolvedById.get(a.unresolved);
    console.log(`   ❓ ${a.category} > ${a.type} is UNANSWERED (${a.unresolved})`);
    if (u) {
      console.log(`      owner: ${u.ownerItem} — ${u.question}`);
      console.log(`      settle it by: ${u.howToResolve}`);
    }
  }
  console.log('   An obviously incomplete declaration is recoverable; a confidently wrong one is a policy');
  console.log('   violation. These stay null until somebody observes the answer.');
}

console.log('');
console.log('   ── what this guard CANNOT see (green is not "the form is right") ──');
console.log('   · the MERGED Android manifest — Gradle adds permissions from plugin manifests that are not in');
console.log('     this repository, and Android cannot be built here. Mitigated by the dependency equality');
console.log('     above; read properly with `bundletool dump manifest` on a CI-built .aab.');
console.log('   · WHAT THE GLITCHTIP SERVER DOES AFTER RECEIPT. What the crash SDK PUTS ON THE WIRE is settled —');
console.log('     it was read from the pinned SDK source (contexts.device.id is a persistent per-install UUID on');
console.log('     Android, ungated by sendDefaultPii) and the pin is compared to pubspec.lock above. What is NOT');
console.log('     visible from here is enrichment on ingest: a Sentry-protocol server can infer geo from the');
console.log('     connecting address, and the instance is self-hosted with no configuration in this repository.');
console.log('     That is why Approximate location under the `demo` posture rests on the analytics rail being off');
console.log('     and nothing else. It cannot change the shipping answer — buildPosture.current is backend-live,');
console.log('     where Approximate location is already true.');
console.log('   · THE NATIVE SDK VERSIONS THEMSELVES. sentry-android and sentry-cocoa arrive through');
console.log("     sentry_flutter's own build.gradle and podspec, which are not files in this repository, so they");
console.log('     are recorded as a dated observation. The Dart pin that drags them in IS asserted.');
console.log("   · Supabase's own auth.users — external project, no migrations in this repo.");
console.log('   · whether Play has changed its data-type vocabulary since the fetch date in the declaration.');
console.log('   · TRANSITIVE Dart dependencies — the equality is over DIRECT ones deliberately.');
console.log('   · the IARC rating — assigned by the rating authorities, never derived here.');

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  [pipeline K-8 / G-32] The Data safety label is a sworn declaration about what the code does.');
  console.error('  Google: "The developer is responsible for the accuracy of the label."');
  console.error('\nassert-play-declarations: FAILED');
  process.exitCode = 1;
} else {
  console.log('');
  console.log(
    `ok   play declarations — ${answersChecked}/${vocabTypes.size} Play data type(s) answered across ${POSTURES.length} build posture(s); ` +
      `lane posture "${bp.current}" confirmed against ${bp.lane} (defines: ${laneDefines ? [...laneDefines].sort().join(', ') : 'n/a'})`,
  );
  console.log(
    `ok   ${tellsChecked} code tell(s) + ${clientAbsenceChecked} client-absence tell(s) evaluated against ${permsByFile.size} manifest(s), ` +
      `${directDeps.size} direct dependenc(ies) and ${usageKeys.size} iOS usage key(s); ${evidenceChecked} evidence path(s) resolve; ` +
      `${citationsChecked} citation(s) sourced to an allowed host`,
  );
  console.log(
    `ok   ${pinsChecked} crash-SDK version pin(s) match ${ds.crashSdkSurface?.lockfile ?? 'pubspec.lock'}; ` +
      `${resolvedChecked} settled question(s) re-checked against their answer rows (none has drifted back to null)`,
  );
  console.log(
    `ok   ${mappingChecked} personal-data inventory row(s) each mapped to a Play data type or excluded with a reason; ` +
      `${erasureRoutesChecked} erasure route(s) derived from the inventory still exist; ${dartScanned} client Dart file(s) carry no plaintext endpoint`,
  );
  console.log(`ok   ${claimsChecked} content-rating claim(s) checked; assignedRating is ${JSON.stringify(cr.assignedRating ?? null)}`);
  console.log('\nassert-play-declarations: ok');
}
