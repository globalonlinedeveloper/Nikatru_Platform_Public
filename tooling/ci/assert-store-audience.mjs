#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-store-audience.mjs — THE ADULT POSTURE IS PINNED PER STORE CHANNEL, NOT
// MERELY CONSISTENT ACROSS TWO FORMS.
//
// [ADR 068]: no NIKATRU app, extension or site targets children; the audience
// floor is 18 and no Families or Kids declaration is ever made. Rows
// O-STORE-AUDIENCE-GUARDED-BY-CONSISTENCY-ONLY (C-21) and
// O-WINDOWS-AGE-RATING-ANSWERS-UNRECORDED (C-23).
//
// ── WHAT WAS ACTUALLY GUARDED BEFORE THIS ───────────────────────────────────
//   · Play's content-rating `target-audience-children` answer was checked by
//     assert-play-declarations.mjs for EQUALITY with the Data safety Families
//     Policy badge. Flipping BOTH to `true` — an app declared for children on
//     both Play screens — was exit 0 everywhere.
//   · Play's Target audience age group (Play Console → App content → Target
//     audience and content) had no repo record at all.
//   · The iOS `kids-age-band` row was required to EXIST
//     (assert-sworn-store-files.mjs requiredRows), not to be null; answering
//     `NINE_TO_ELEVEN` was exit 0.
//   · apps-gov-in's "suitable for children" was pinned to "No" by
//     assert-store-metadata.mjs only WHEN PRESENT; deleting the question passed.
//   · Windows' IARC answers existed nowhere in the repository.
//
// ── THE LIMBS ───────────────────────────────────────────────────────────────
//  A. POSTURE. Every `kind: "store"` row of tooling/channel-register.json is
//     either in POSTURE below — a list of pins, each a file in the app's store
//     tree, a pointer into it and the value [ADR 068] requires there — or in
//     UNRECORDED with the reason its store has no audience answer in this tree.
//     A store row in neither is COVERAGE LOST: a new channel acquires the
//     obligation by existing, and is never silently outside the rule. A pin
//     whose channel is not a register store row is a stale pin and FAILS.
//     Graded for every app in catalog/apps.json whose store tree for that
//     channel exists. A pinned value that is absent FAILS: an unrecorded answer
//     is the hole the apps-gov-in pin had.
//  B. DERIVATION. A Windows age-rating file (store/windows-store/age-rating.json)
//     carries the IARC answers, and IARC is ONE questionnaire behind both
//     storefronts. So each Windows claim names the Play content-rating claim it
//     is derived from (`fromPlayClaim`), its answer must EQUAL that claim's, and
//     the two claim sets must be the same set: a Play claim the Windows file
//     omits is a question Partner Center will ask that nobody has answered.
//
// A file whose `"sworn"` is `false` is a PREVIEW (the brick stamps every sworn
// file that way, see assert-sworn-store-files.mjs limb 0) and its pins are
// PRINTED as not graded rather than failed; an all-preview run is COVERAGE LOST.
//
// Exit: 0 = every pinned answer holds · 1 = one does not ·
//       2 = COVERAGE LOST (too little was read to be evidence)
// Usage: node tooling/ci/assert-store-audience.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPS_REGISTER, readCatalogFile } from '../catalog/read.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
const ADR = '[ADR 068]: no NIKATRU app targets children; the audience floor is 18 and no Families or Kids declaration is made.';

/** The Apple age-rating file answers for every channel its `channels` names: ONE
 *  App Store Connect record covers iOS and macOS (app.yaml gives both one
 *  recordId, and assert-store-identity.mjs fails two), and the age rating hangs
 *  off that record's appInfo. So macOS is pinned through the iOS file. */
const APPLE_AGE = 'ios-appstore/age-rating.json';
const appleAgePins = (channel) => [
  { file: APPLE_AGE, at: 'channels', includes: channel, what: `the Apple age-rating answers name ${channel} among the channels they answer for` },
  { file: APPLE_AGE, at: 'audienceFloor.value', equals: 18, what: 'the recorded audience floor' },
  { file: APPLE_AGE, at: 'claims[id=kids-age-band].answer', equals: null, what: 'App Store Kids Age Band — off (a band is a Kids-category declaration)' },
];

/** channel id → the answers [ADR 068] fixes, as pins into that channel's store tree. */
const POSTURE = {
  'android-play': [
    { file: 'android-play/content-rating.json', at: 'claims[id=target-audience-children].answer', equals: false, what: 'content rating — not designed for or targeted at children' },
    { file: 'android-play/data-safety.json', at: 'dataSecurity.playFamiliesPolicy.answer', equals: false, what: 'Data safety — no Play Families Policy commitment' },
    { file: 'android-play/content-rating.json', at: 'targetAudience.ageGroups', equals: ['18 and over'], what: 'Target audience and content — the age groups targeted' },
  ],
  'ios-appstore': appleAgePins('ios-appstore'),
  'macos-appstore': appleAgePins('macos-appstore'),
  'windows-store': [
    { file: 'windows-store/age-rating.json', at: 'channel', equals: 'windows-store', what: 'the Windows IARC answers name their channel' },
    { file: 'windows-store/age-rating.json', at: 'audienceFloor.value', equals: 18, what: 'the recorded audience floor' },
    { file: 'windows-store/age-rating.json', at: 'claims[id=target-audience-children].answer', equals: false, what: 'IARC — not designed for or targeted at children' },
  ],
  'apps-gov-in': [
    { file: 'apps-gov-in/form-answers.json', at: 'step3[id=suitable-for-children].answer', equals: 'No', what: 'upload form question 5 — "Is the app suitable for children?"' },
  ],
};

/** channel id → why its store tree holds no audience answer to pin. PRINTED on
 *  every run: these are gaps stated, not channels outside the rule. */
const UNRECORDED = {
  'linux-snap': 'no Snap Store audience or age-rating question is recorded in this tree; none is known to this repository',
  'chrome-webstore': "the extension stores' audience answers have no repo record yet (the extension listing trees carry listing text only)",
  'edge-addons': "the extension stores' audience answers have no repo record yet (the extension listing trees carry listing text only)",
  amo: "the extension stores' audience answers have no repo record yet (the extension listing trees carry listing text only)",
};

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`    ${l}`);
  console.error('');
  console.error('assert-store-audience: FAILED');
  process.exit(2);
}

/** Read a JSON file under ROOT: { json } | { missing } | { lost }. */
function readJson(rel) {
  let text;
  try {
    text = readFileSync(join(ROOT, rel), 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { missing: true };
    throw e;
  }
  try {
    return { json: JSON.parse(text) };
  } catch (e) {
    return { lost: `${rel} is not valid JSON (${e.message})` };
  }
}

const treeExists = (rel) => {
  try {
    return statSync(join(ROOT, rel)).isDirectory();
  } catch {
    return false;
  }
};

/** Resolve `a.b[id=x].c` in a document. `{ found, value }`. */
function at(doc, pointer) {
  let cur = doc;
  for (const part of pointer.split('.')) {
    const m = /^([^[\]]+)(?:\[id=([^\]]+)\])?$/.exec(part);
    if (!m || cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, m[1])) return { found: false };
    cur = cur[m[1]];
    if (m[2] !== undefined) {
      if (!Array.isArray(cur)) return { found: false };
      const row = cur.find((r) => r && typeof r === 'object' && r.id === m[2]);
      if (row === undefined) return { found: false };
      cur = row;
    }
  }
  return { found: true, value: cur };
}

// ── the subjects ─────────────────────────────────────────────────────────────
const reg = readJson(REGISTER_REL);
if (!reg.json) coverageLost([`${reg.lost ?? `${REGISTER_REL} does not exist`}, so no store channel could be named.`]);
const storeRows = (Array.isArray(reg.json.channels) ? reg.json.channels : []).filter((r) => r?.kind === 'store');
if (storeRows.length === 0) coverageLost([`${REGISTER_REL} declares no \`kind: "store"\` channel, so the posture ranged over nothing.`]);
const storeIds = new Set(storeRows.map((r) => String(r.id)));

const unruled = storeRows.filter((r) => !Object.hasOwn(POSTURE, r.id) && !Object.hasOwn(UNRECORDED, r.id));
if (unruled.length) {
  coverageLost([
    `store channel(s) ${unruled.map((r) => `"${r.id}"`).join(', ')} carry no audience pin and no stated reason for having none.`,
    `${ADR} Add the channel's pins to POSTURE in tooling/ci/assert-store-audience.mjs, or its reason to UNRECORDED;`,
    'a store this guard was never taught is a store whose audience answer nothing grades.',
  ]);
}
for (const id of [...Object.keys(POSTURE), ...Object.keys(UNRECORDED)]) {
  if (!storeIds.has(id)) {
    problems.push(`"${id}" is pinned or excused in tooling/ci/assert-store-audience.mjs but is not a \`kind: "store"\` row of ${REGISTER_REL}. A stale pin reads as coverage of a channel that does not exist.`);
  }
}

// The catalogue is read through the one Node reader (tooling/catalog/read.mjs), never by path.
const apps = readCatalogFile(ROOT, APPS_REGISTER);
const slugs = apps.ok && Array.isArray(apps.value) ? apps.value.map((a) => a?.slug).filter((s) => typeof s === 'string' && s !== '') : [];
if (slugs.length === 0) coverageLost([`${apps.ok ? `${APPS_REGISTER} names no app` : apps.why}, so no app's store tree could be graded.`]);

// ── A · the posture, per (app, channel) ──────────────────────────────────────
const dirOf = (row, slug) => (typeof row.storeMetadataDir === 'string' ? row.storeMetadataDir.replace('{app}', slug) : null);
const appTreeOf = (slug) => `apps/${slug}/store`;
let graded = 0;
let preview = 0;
const gradedChannels = new Set();
const missingReported = new Set(); // one finding per absent file, not one per pin into it
for (const row of storeRows) {
  const pins = POSTURE[row.id];
  if (!pins) continue;
  for (const slug of slugs) {
    const dir = dirOf(row, slug);
    if (!dir || !treeExists(dir)) continue; // the app does not ship to this store
    for (const pin of pins) {
      const rel = `${appTreeOf(slug)}/${pin.file}`;
      const where = `app "${slug}" × "${row.id}": ${rel}`;
      const doc = readJson(rel);
      if (doc.missing) {
        if (!missingReported.has(rel)) problems.push(`${where} does not exist, so ${pin.what} has no record. ${ADR}`);
        missingReported.add(rel);
        continue;
      }
      if (doc.lost) coverageLost([`${doc.lost}; ${pin.what} was not read.`]);
      if (doc.json?.sworn === false) {
        preview++;
        prints.push(`⬜ PREVIEW — ${where} says "sworn": false; \`${pin.at}\` (${pin.what}) is not graded until it is sworn.`);
        continue;
      }
      const got = at(doc.json, pin.at);
      graded++;
      gradedChannels.add(row.id);
      if (!got.found) {
        problems.push(`${where} \`${pin.at}\` is absent: ${pin.what} is unrecorded. ${ADR}`);
      } else if (pin.includes !== undefined) {
        if (!Array.isArray(got.value) || !got.value.includes(pin.includes)) {
          problems.push(`${where} \`${pin.at}\` is ${JSON.stringify(got.value)} and must include "${pin.includes}": ${pin.what}. Without it nothing in the tree answers for that channel.`);
        }
      } else if (JSON.stringify(got.value) !== JSON.stringify(pin.equals)) {
        problems.push(`🔴 ${where} \`${pin.at}\` is ${JSON.stringify(got.value)}; the adult posture requires ${JSON.stringify(pin.equals)} — ${pin.what}. ${ADR}`);
      }
    }
  }
}
if (graded === 0 && preview > 0) {
  coverageLost([`every pinned file read is a preview ("sworn": false; ${preview} pin(s)), so no audience answer was graded.`]);
}
if (graded === 0) {
  coverageLost([`${slugs.length} app(s) × ${Object.keys(POSTURE).length} pinned channel(s) graded ZERO answers: no app ships a store tree this guard pins.`]);
}
for (const [id, why] of Object.entries(UNRECORDED)) prints.push(`⬜ UNRECORDED — "${id}": ${why}.`);

// ── B · the Windows IARC answers are the Play IARC answers ───────────────────
let derived = 0;
for (const slug of slugs) {
  const winRel = `${appTreeOf(slug)}/windows-store/age-rating.json`;
  const playRel = `${appTreeOf(slug)}/android-play/content-rating.json`;
  const win = readJson(winRel);
  if (win.missing || win.json?.sworn === false) continue; // absence is limb A's finding; a preview is printed there
  if (win.lost) coverageLost([`${win.lost}; its derivation was not checked.`]);
  const play = readJson(playRel);
  if (!play.json) {
    problems.push(`${winRel} derives its answers from ${playRel}, which ${play.missing ? 'does not exist' : 'is not valid JSON'}. A derivation from nothing is an invented answer set.`);
    continue;
  }
  const playClaims = new Map((Array.isArray(play.json.claims) ? play.json.claims : []).map((c) => [c?.id, c]));
  const winClaims = Array.isArray(win.json.claims) ? win.json.claims : [];
  if (winClaims.length === 0) {
    problems.push(`${winRel} carries no \`claims\`: Partner Center's IARC questionnaire would be answered from memory.`);
    continue;
  }
  const carried = new Set();
  for (const [i, c] of winClaims.entries()) {
    const src = c?.fromPlayClaim;
    const p = playClaims.get(src);
    derived++;
    if (typeof src !== 'string' || p === undefined) {
      problems.push(`${winRel} \`claims[${i}]\` (${JSON.stringify(c?.id ?? null)}) names fromPlayClaim ${JSON.stringify(src ?? null)}, which is no claim of ${playRel}. Every Windows IARC answer is derived from the Play one; an underived answer is a second measurement that will drift.`);
      continue;
    }
    carried.add(src);
    if (c.id !== src) {
      problems.push(`${winRel} \`claims[${i}]\` has id ${JSON.stringify(c.id)} but derives from "${src}". One question, one id: a renamed row is how two answers to it stop being compared.`);
    }
    if (JSON.stringify(c.answer) !== JSON.stringify(p.answer)) {
      problems.push(`🔴 ${winRel} \`claims[${i}]\` ("${src}") answers ${JSON.stringify(c.answer)} and ${playRel} answers ${JSON.stringify(p.answer)}. IARC is one questionnaire behind both storefronts; the same app cannot answer it two ways.`);
    }
  }
  for (const id of playClaims.keys()) {
    if (!carried.has(id)) {
      problems.push(`${winRel} carries no claim derived from ${playRel} "${id}". Partner Center's IARC questionnaire asks it too, and nobody would have answered it.`);
    }
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('⬜ printed, not hidden:');
  for (const p of prints) console.log(`    ${p}`);
}
if (problems.length) {
  console.error(`✗ store audience — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('assert-store-audience: FAILED');
  process.exit(1);
}
console.log(
  `ok  adult posture — ${graded} pinned answer(s) hold across ${gradedChannels.size} channel(s) (${[...gradedChannels].join(', ')}) ` +
    `for ${slugs.length} app(s); ${Object.keys(UNRECORDED).length} store channel(s) stated as unrecorded`,
);
console.log(`ok  windows IARC answers — ${derived} claim(s) equal the Play content-rating claim each derives from`);
