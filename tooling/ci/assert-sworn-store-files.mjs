#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-sworn-store-files.mjs — A SWORN DECLARATION MAY NOT REGRESS TOWARD THE
// TEMPLATE IT WAS STAMPED FROM.
//
// [pipeline K-8 / G-32, ADR 037 P2.7] Two files under a channel's store
// directory are not metadata — they are declarations a human swears to:
//   · store/android-play/data-safety.json   (898 lines answered · 59 stamped)
//   · store/android-play/content-rating.json (186 lines answered · 53 stamped)
// The brick stamps both UNANSWERED, on purpose: a template cannot know what an
// app does, and a confidently wrong sworn declaration is worse than an obviously
// incomplete one. Which means every app carries, in the same path, a file that
// has TWO legitimate shapes — and only one of them is legal for a shipping app.
//
// ── THE FAILURE THIS EXISTS FOR, MEASURED, NOT IMAGINED ─────────────────────
// The Subly re-stamp (ADR 037) put both files in the EXCLUDE-verbatim bucket:
// "keep the live file, drop the stamp's". That is a decision recorded in
// Private/knowledge/plans/subly-restamp-P22-lock.md §1.3 and enforced by nothing. A
// `git apply` of the wrong bucket, a merge resolution that takes "theirs", or a
// future re-stamp run with overwrite-on-conflict replaces 898 measured lines
// with 59 nulls — and the app keeps building, keeps testing and keeps deploying.
//
// 🔬 WHAT assert-play-declarations.mjs ALREADY CATCHES, AND WHAT IT DOES NOT.
// Measured 2026-08-08 by mutating a real-tree copy (24 mutations, exit code
// captured on its own line). The WHOLESALE swap IS caught — it dies on
// `vocabulary.categories`. Every limb below exists because a PARTIAL regression
// was measured to pass it with exit 0:
//
//   M1/M22  dataSecurity.encryptedInTransit.answer := null (+ basis gutted) → EXIT 0
//   M8/M19  _readme collapsed to the template's prose                        → EXIT 0
//   M10     content-rating authorities deleted, assignedRating nulled        → EXIT 0
//   M11     content-rating humanOwned deleted                                → EXIT 0
//   M17/M25 data-safety `resolved` deleted / emptied                         → EXIT 0
//   M20     every answer `basis` replaced with the word "stamped"            → EXIT 0
//   M26     _readme truncated to five lines                                  → EXIT 0
//   M28     the Files-and-docs basis rewritten, losing its code citation     → EXIT 0
//
// So this guard is NOT a second opinion on the answers. play-declarations owns
// "does the declaration still describe the code". This one owns the narrower,
// duller question that turned out to be unowned: "is this still an ANSWERED
// declaration at all, or has it drifted back toward the blank the brick emits".
// Overlapping limbs were deliberately NOT written: the citation url/fetched/
// quote shape, the per-answer tri-state, the inventory relation and the
// inAppControl path all belong to play-declarations, all were mutation-proven
// to fire there, and a redundant assertion is the thing this repo deletes
// (see the Ed25519 length checks, removed for changing no test outcome).
//
// ── THE LIMBS ───────────────────────────────────────────────────────────────
//  1. FLOOR. Every answered copy is at least MIN_LINES lines AND at least twice
//     the brick template's own line count. The second half is DERIVED from the
//     template in the tree, so the hand-written 150 can never quietly become a
//     floor that sits below the thing it is defending against.
//  2. TEMPLATE SIGNATURE REFUSED, and the signature is DERIVED FROM THE BRICK
//     rather than hand-listed. Whatever the brick emits as null, an answered
//     copy may not carry as null; whatever the brick emits as `sources.cited:
//     []`, an answered copy may not carry at all. Re-cut the brick and this
//     limb re-derives itself.
//  3. PROSE FLOOR on `_readme`. It is the operating record — why the file is
//     guarded, which questions were settled and why each had been recorded as
//     needing something it did not. The template's is 19 lines of instructions
//     to a future author. Losing it costs no machine check anywhere.
//  4. SUBSTANCE. Every `basis` is at least MIN_BASIS_CHARS (the shortest live
//     one is 66); `resolved` keeps its write-ups; content-rating keeps its
//     rating authorities and its named human-owned obligations.
//  5. CITED CODE STILL EXISTS. Every repository path named anywhere in the
//     document resolves (43 distinct paths do today). A declaration that cites
//     a file which was renamed is a false record, and nothing else reads these
//     strings.
//
//     🔴 THIS LIMB CAUGHT A LIVE ONE BEFORE IT WAS EVEN COMMITTED. Run against
//     the working tree mid-P2.5b (the app_config de-duplication, ADR 037), it
//     failed on three references to `apps/subly/lib/core/config/app_config.dart`
//     — a file that increment DELETES in favour of `lib/core/app_config.dart`.
//     One of the three is `buildPosture.gateFile`, the declaration's own pointer
//     at the compile-time gate every posture answer depends on, and
//     assert-play-declarations.mjs never reads that field: `grep -c gateFile` on
//     it is 0. So the Data safety form would have shipped naming the wrong file
//     for the reason it gives every answer, at exit 0 across the whole gate.
//  6. UI ANCHORS. Where a declaration rests on a screen ROW rather than on a
//     file, the row is anchored by its literal. Deleting the row leaves limb 5
//     green — the file still exists — and the sworn sentence describing it
//     false. Every anchor is self-checked: an anchor whose pointer no longer
//     resolves FAILS rather than silently not applying.
//  7. THE INVERSE, ON THE BRICK. The template must STAY a template. Copying an
//     app's answers into the brick would make app #2 swear to app #1's code —
//     the same lie in the other direction, and the one direction a floor-based
//     guard would otherwise read as an improvement.
//  9. THE CHANNEL README'S CITED PATHS. Limb 5's question, asked of the prose
//     file that sits beside the sworn JSON in the same store tree.
//
//     🔴 MEASURED, AND THE NUMBER IS TEN. #216 (P2.5b) moved
//     `apps/{app}/lib/core/config/app_config.dart` to
//     `apps/{app}/lib/core/app_config.dart`. Limb 5 repaired the THREE citations
//     inside the declarations and never looked at the READMEs, where the SAME
//     dead path sat twice in every one of the five channels — the
//     privacy-policy-url and support-url rows of each derivation map. Ten
//     confident wrong answers about where a listing field is generated from,
//     surviving the guard written for exactly this defect, because that guard's
//     subject set was `.json` and the defect was in `.md`.
//
//     The README is not sworn, and this limb does not treat it as such: it makes
//     no claim about the prose. It asks only the question limb 5 already asks —
//     does the repository path this file NAMES still resolve — of the one file
//     in the tree that tells a person which source each listing field comes
//     from. Nothing else reads those strings, so nothing else can notice.
//
// ── REQUIRED_COVERAGE ───────────────────────────────────────────────────────
// The sworn set is DERIVED from tooling/channel-register.json, never listed
// here: every `.json` in any channel's storeMetadataContract additionalFiles is
// a declaration and must have a spec below. A third sworn file added to that
// contract with no spec is a hard failure, not a silent pass — which is the
// whole reason the set is derived. Non-.json additionalFiles are store ASSETS
// (feature-graphic.png, store-icon-512.png) and are named as skipped, with the
// guard that owns them.
//
// Usage:  node tooling/ci/assert-sworn-store-files.mjs [repoRoot]
// Exit 0 = every shipping declaration is still answered; 1 = one has regressed.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const REGISTER_REL = 'tooling/channel-register.json';
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

/** Structural failure. Every limb below quantifies over something the scan
 *  found, so continuing would report clean over nothing — this repository's
 *  single most repeated defect. Exits immediately. */
function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`    ${l}`);
  console.error('');
  console.error('assert-sworn-store-files: FAILED');
  process.exit(1);
}

const abs = (rel) => join(ROOT, ...rel.split('/'));
const readJson = (rel) => {
  let text;
  try {
    text = readFileSync(abs(rel), 'utf8');
  } catch {
    return { error: 'unreadable', text: null, json: null };
  }
  try {
    return { error: null, text, json: JSON.parse(text) };
  } catch (e) {
    return { error: e.message, text, json: null };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// THE SPECS. One per sworn declaration. Numbers carry their measurement, so a
// reader can tell a floor from a wish.
// ─────────────────────────────────────────────────────────────────────────────
/** Absolute floor. The relative floor (2x the template) is derived at runtime;
 *  this is the "even if the template shrinks to nothing" backstop. */
const MIN_LINES = 150;
/** Shortest live `basis` is 66 characters (data-safety answers[15]). 40 leaves
 *  real headroom while refusing "stamped" (7) and "Nothing to see." (15) —
 *  both measured to pass assert-play-declarations. */
const MIN_BASIS_CHARS = 40;

const SWORN_SPECS = new Map([
  [
    'android-play/data-safety.json',
    {
      // `_readme` measured 44 live / 19 in the brick template.
      minReadme: 30,
      // Named citation objects under `sources` (9 live). The SHAPE of each one
      // — url + fetched + quote + allowed host — is assert-play-declarations'
      // limb 1 and is deliberately not repeated here.
      minCitations: 4,
      /** Arrays that carry the record itself. `resolved` is the one measured
       *  hole: deleting it or emptying it is EXIT 0 on play-declarations, and
       *  it holds the two 2026-08-04 write-ups explaining that both open
       *  questions had been recorded as needing something they did not. */
      nonEmptyArrays: ['answers', 'resolved'],
      /** Objects that must exist with at least N own keys. */
      minKeys: [],
      /** Pointers that must hold a real boolean. `encryptedInTransit.answer`
       *  is the measured hole: nulling it is EXIT 0 on play-declarations while
       *  Play's "Data is encrypted in transit" question goes unanswered. */
      booleans: ['dataSecurity.encryptedInTransit.answer'],
      /** Every entry of these arrays must carry these keys, non-empty. */
      entryKeys: [{ at: 'resolved', keys: ['question', 'answer', 'settledOn', 'settledBy'] }],
    },
  ],
  [
    'android-play/content-rating.json',
    {
      // `_readme` measured 26 live / 19 in the brick template.
      minReadme: 22,
      minCitations: 2,
      nonEmptyArrays: ['claims', 'authorities.list'],
      // `humanOwned` measured 5 keys live; deleting it whole is EXIT 0 on
      // play-declarations, and it is the only record of what a person — not a
      // guard — must do before the questionnaire can be submitted.
      minKeys: [{ at: 'humanOwned', min: 3 }],
      booleans: [],
      entryKeys: [],
    },
  ],
  [
    // The THIRD sworn declaration (2026-08-09) — Play Console "App content →
    // Ads". Its answers are keyed on FORMAT, not on packages, which is why it
    // exists at all: a house-ad surface adds no dependency, so the other two
    // declarations' `dependency-tells` stay green while becoming false.
    // assert-ads-declarations.mjs owns "is the answer still TRUE of the tree";
    // this spec owns the same duller question as the two above — "is it still
    // an ANSWERED declaration at all".
    'android-play/ads-declaration.json',
    {
      // `_readme` measured 38 live / 26 in the brick template.
      minReadme: 30,
      minCitations: 3,
      /** The scan's own subject and its positive controls. `requiredCoverage` is
       *  the measured hole in the FORMAT derivation: emptying it leaves the
       *  widget-declaration matcher with nothing proving it still matches, and
       *  an empty domain then reads identically to a broken instrument. */
      nonEmptyArrays: ['formatScan.roots', 'formatScan.requiredCoverage', 'notCovered'],
      // `crossChecks` measured 4 keys (3 + `_why`), `humanOwned` 4 (3 + `_why`).
      // The cross-checks are the whole point of the file — one derivation, four
      // consumers — and deleting the block silently un-relates them.
      minKeys: [{ at: 'crossChecks', min: 3 }, { at: 'humanOwned', min: 3 }],
      // The two answers Google actually asks for. A null here is a store
      // question going unanswered while every dependency-keyed guard is green.
      booleans: ['containsAds', 'promotesOtherApps'],
      entryKeys: [{ at: 'formatScan.requiredCoverage', keys: ['file', 'symbol', 'why'] }],
    },
  ],
]);

/**
 * Where a sworn sentence rests on a SCREEN ROW rather than on a file. Limb 5
 * cannot see this: the file still exists, so the citation resolves, while the
 * row the sentence describes is gone.
 *
 * 🔬 THIS TABLE IS HAND-WRITTEN AND THE DERIVED VERSION WAS TRIED AND REJECTED
 * ON MEASUREMENT. "Any basis naming exactly one path and one single-quoted
 * phrase" yields 14 pairs of which only 3 hold — the quotes are mostly quoted
 * POLICY PROSE ("never collected", "Other financial info"), not UI strings. A
 * derived rule with an 11/14 false-positive rate would be switched off inside a
 * week, and an assertion that cannot tell its failure from a false positive is
 * worse than none for the same reason as one that cannot fail at all.
 *
 * Every entry is self-checked below: `pointer` must resolve and must still cite
 * `file`, or the anchor is stale and the build fails. An anchor that quietly
 * stops applying is the exact shape this guard exists to refuse.
 */
// P2.7 correction, minutes after this guard first ran: the P2.6b merge moved
// the row's copy into l10n, so a RAW-source literal match passed on a COMMENT
// mentioning the row while the rendered string lived in the .arb — the exact
// prose-grep false green this repo has a rule and a scar about. The anchor is
// now two-part, both parsed: the CODE half is matched with comments and string
// literals stripped (the l10n accessor is an identifier and survives the
// reduction); the COPY half is read from the .arb, which is what users see.
const UI_ANCHORS = [
  {
    doc: 'android-play/data-safety.json',
    pointer: 'answers[type=Files and docs].basis',
    file: 'apps/{app}/lib/features/settings/settings_screen.dart',
    codeSymbol: 'l10n.exportDataCsv',
    arbFile: 'apps/{app}/lib/l10n/app_en.arb',
    arbKey: 'exportDataCsv',
    arbMustContain: 'Export data',
    why:
      'The Files-and-docs answer swears the app performs no file I/O because the Settings export row is an ' +
      'INERT placeholder with a null onTap. Delete the row and the sentence describes a screen that does not ' +
      'exist — a false sworn record. [ADR 037 P2.6b measured this row as one of the surfaces a wholesale ' +
      'apply of the stamped settings screen deletes, with zero test references tree-wide.]',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// limb 8 · LINE CITATIONS — `file.dart:540-545` must still point at the line it
// describes.
//
// 🔴 WHY THIS EXISTS, WITH THE MEASUREMENT. On 2026-08-10 all four `file:line`
// citations in data-safety.json's `buildPosture._why` were re-walked and THREE
// WERE WRONG: the two providers.dart pointers were ~500 and ~1300 lines out
// (they predate the P2.6 re-stamp), and the fourth named a file that had been
// deleted. Every CLAIM those lines made was still true, which is exactly why
// nothing went red — and then the repair shipped as a prose instruction telling
// a future human to "re-walk these four before any submission". That note lasted
// under a day: the very next edit to app.dart's consent gate moved the fourth
// citation from :376 to :396, and only a hand re-measurement caught it.
//
// A line number is a pointer into a file other people edit. It is correct until
// somebody inserts above it and NOTHING recomputes it — the same class as the
// `ci.yml:NNNN` drift CLAUDE.md records, where one +35-line insert broke 203
// citations. This repository's rule is to prefer a build-failing guard over a
// note, so the four pointers are checked mechanically:
//
//   · the NUMBER is read out of the sworn document, never carried here — the
//     document's own claim is the thing under test;
//   · the cited line RANGE must contain the anchor, so a shift of even one line
//     past the range fails;
//   · the anchor must exist SOMEWHERE in the file too, so a renamed symbol is
//     reported as a broken anchor rather than as drift (a different repair).
//
// Adding a row here should feel like adding a UI_ANCHOR: it is a claim that a
// specific sentence in a sworn record depends on a specific line of code.
// ─────────────────────────────────────────────────────────────────────────────
const LINE_ANCHORS = [
  {
    doc: 'android-play/data-safety.json',
    cite: 'providers.dart',
    file: 'apps/{app}/lib/state/providers.dart',
    anchor: 'InMemoryAuthRepository()',
    why: 'the auth-repo branch the Account row is answered from',
  },
  {
    doc: 'android-play/data-safety.json',
    cite: 'providers.dart',
    file: 'apps/{app}/lib/state/providers.dart',
    anchor: 'SeedApiClient()',
    why: 'the in-memory API client that makes "never leaves the device" true',
  },
  {
    doc: 'android-play/data-safety.json',
    cite: 'analytics_providers.dart',
    file: 'apps/{app}/lib/state/analytics_providers.dart',
    anchor: 'core.NoOpAnalytics()',
    why: 'the analytics off-switch the Analytics rows are answered from',
  },
  {
    doc: 'android-play/data-safety.json',
    cite: 'app.dart',
    file: 'apps/{app}/lib/app.dart',
    anchor: 'const _ConsentPrompt()',
    why: 'the consent prompt that gates every analytics answer on this form',
  },
];

// ── the register decides WHAT is sworn ──────────────────────────────────────
const reg = readJson(REGISTER_REL);
if (!reg.json) {
  coverageLost([
    `${REGISTER_REL} is ${reg.error === 'unreadable' ? 'missing' : `not valid JSON (${reg.error})`}.`,
    'It is what declares which per-channel files are sworn declarations. Without it this guard has no',
    'subject set at all and would pass over nothing.',
  ]);
}
const perChannel = reg.json.storeMetadataContract?.perChannel ?? {};
const channelRows = Array.isArray(reg.json.channels) ? reg.json.channels : [];
/** Every channel that HAS a store tree — limb 9's subject set, derived from the
 *  same contract block the sworn set is derived from rather than listed here.
 *  `_why` is documentation, not a channel (same filter as the sworn derivation
 *  below). Add a sixth channel to the contract and its README is checked with no
 *  edit to this file. */
const storeChannels = Object.keys(perChannel).filter((c) => !c.startsWith('_'));

/** { channel, file, key } for every .json in any channel's additionalFiles. */
const swornWanted = [];
const skippedAssets = [];
for (const [channel, contract] of Object.entries(perChannel)) {
  if (channel.startsWith('_')) continue; // `_why` is documentation, not a channel
  for (const file of contract?.additionalFiles ?? []) {
    if (file.endsWith('.json')) swornWanted.push({ channel, file, key: `${channel}/${file}` });
    else skippedAssets.push(`${channel}/${file}`);
  }
}
if (!swornWanted.length) {
  coverageLost([
    `${REGISTER_REL} declares no .json additionalFiles on any channel.`,
    'The sworn set is derived from that contract, so an empty derivation means this guard checked nothing',
    'while printing a pass — not that the declarations are fine.',
  ]);
}
// REQUIRED_COVERAGE, first direction: a sworn file with no spec.
const unspecced = swornWanted.filter((s) => !SWORN_SPECS.has(s.key));
if (unspecced.length) {
  coverageLost([
    `${unspecced.length} sworn declaration(s) in ${REGISTER_REL} have no spec in this guard: ${unspecced
      .map((s) => s.key)
      .join(', ')}.`,
    'A .json in a channel\'s additionalFiles is a declaration somebody swears to. Adding one and leaving it',
    'unspecced here is how the third sworn file ships with no floor at all — so the set is DERIVED and the',
    'omission is a build failure rather than a silent gap. Add a spec, or move the file out of the contract.',
  ]);
}
// …and the second: a spec for something no longer sworn.
const wantedKeys = new Set(swornWanted.map((s) => s.key));
const orphanSpecs = [...SWORN_SPECS.keys()].filter((k) => !wantedKeys.has(k));
if (orphanSpecs.length) {
  coverageLost([
    `this guard specs ${orphanSpecs.join(', ')}, which ${REGISTER_REL} no longer declares as sworn.`,
    'The spec then guards a file nothing requires to exist, and its floors read as coverage while ranging',
    'over nothing. Retire the spec in the same change that retired the declaration.',
  ]);
}

// ── the apps ────────────────────────────────────────────────────────────────
// Derived from the root pubspec `workspace:` list, never from a directory
// listing: the brick lane stamps apps/probe and never removes it, so a listing
// differs between this box and CI (assert-app-dod.mjs states the same reason).
const apps = [];
let workspaceRead = false;
try {
  const lines = readFileSync(join(ROOT, 'pubspec.yaml'), 'utf8').replace(/^\s*#.*$/gm, '').split('\n');
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at !== -1) {
    workspaceRead = true;
    for (const line of lines.slice(at + 1)) {
      if (/^\S/.test(line)) break;
      const m = line.match(/^\s*-\s*(\S+)\s*$/);
      if (m && m[1].startsWith('apps/')) apps.push(m[1]);
    }
  }
} catch {
  /* handled by workspaceRead */
}
if (!workspaceRead || !apps.length) {
  coverageLost([
    'the root pubspec.yaml has no readable `workspace:` block with an apps/ member.',
    'The set of apps whose declarations are checked would then be empty, and an empty domain prints ok.',
  ]);
}

// ── the template, read from the brick, is the yardstick for limbs 1, 2 and 7 ─
/** channelFile -> { lines, nullKeys, readme, raw } */
const templates = new Map();
for (const { channel, file, key } of swornWanted) {
  const rel = `${BRICK_APP}/store/${channel}/${file}`;
  const t = readJson(rel);
  if (!t.json) {
    coverageLost([
      `the brick template ${rel} is ${t.error === 'unreadable' ? 'missing' : `not valid JSON (${t.error})`}.`,
      'Every floor in this guard is expressed RELATIVE to the template it defends against, and limb 7 asserts',
      'the template is still blank. With no template there is no yardstick, and the absolute floors alone',
      'would silently stop being able to catch a template that had grown past them.',
    ]);
  }
  templates.set(key, {
    rel,
    lines: t.text.split('\n').length,
    readme: Array.isArray(t.json._readme) ? t.json._readme.length : 0,
    nullKeys: Object.entries(t.json).filter(([, v]) => v === null).map(([k]) => k),
    hasCitedArray: Array.isArray(t.json.sources?.cited),
    json: t.json,
  });
}

// ── limb 7, HOISTED · the template must STAY blank ──────────────────────────
// Runs BEFORE the answered copies, because it validates the YARDSTICK the other
// limbs measure against. Written after the loop it produced a true failure with
// a misleading message: copying an app's answers into the brick tripped the
// MIN_LINES self-check ("raise MIN_LINES") instead of saying the template had
// stopped being a template. A check whose message points at the wrong repair is
// a check somebody applies the wrong repair to.
for (const [, tmpl] of templates) {
  const stillBlank = tmpl.nullKeys.length > 0;
  if (!stillBlank) {
    fail(
      `🔴 the brick template ${tmpl.rel} carries NO null answers. \`null\` is the template's real answer — it ` +
        'means "nobody has answered this yet". A template that carries answers makes app #2 swear to app #1\'s ' +
        'code, and every floor below would read that as an improvement.',
    );
  }
  if (tmpl.lines >= MIN_LINES) {
    if (stillBlank) {
      coverageLost([
        `MIN_LINES is ${MIN_LINES} and the brick template ${tmpl.rel} is ${tmpl.lines} lines.`,
        'The floor sits at or below the thing it defends against, so a wholesale regression to the template',
        'would pass it. Raise MIN_LINES above the template.',
      ]);
    }
    fail(
      `🔴 the brick template ${tmpl.rel} is ${tmpl.lines} lines — as long as an ANSWERED declaration. The brick ` +
        'is stamped before a line of product code exists, so it cannot honestly answer anything.',
    );
  }
  if (!Array.isArray(tmpl.json.unresolved) || tmpl.json.unresolved.length === 0) {
    fail(
      `🔴 the brick template ${tmpl.rel} has an empty \`unresolved\` list. That list is what tells the person ` +
        'stamping app #2 which questions they still owe; empty, the blank form reads as a finished one.',
    );
  }
  if (tmpl.readme === 0) {
    fail(`the brick template ${tmpl.rel} has no \`_readme\`. It is the instructions the stamped app is meant to follow.`);
  }
}

// ── helpers shared by the limbs ─────────────────────────────────────────────
/** Dotted pointer walk. Returns `undefined` for any missing hop. */
function at(obj, pointer) {
  let cur = obj;
  for (const hop of pointer.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[hop];
  }
  return cur;
}

/** Every string leaf, with its pointer. */
function strings(obj, path = '', out = []) {
  if (typeof obj === 'string') out.push([path, obj]);
  else if (Array.isArray(obj)) obj.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) strings(obj[k], path ? `${path}.${k}` : k, out);
  return out;
}

/** Repository-relative paths named inside prose. Restricted to tokens ending in
 *  a known source extension: a bare directory ("tooling/legal") is a reference,
 *  a file is a citation, and only the second can be checked for existence
 *  without arguing about trailing slashes. */
const PATH_RE = /(?:apps|packages|services|tooling|sites)\/[A-Za-z0-9_.\/{}-]*\.(?:dart|json|jsonc|yaml|yml|ts|tsx|mjs|html|txt|xml|sql|arb|md)/g;

// ─────────────────────────────────────────────────────────────────────────────
// THE RUN
// ─────────────────────────────────────────────────────────────────────────────
let copiesChecked = 0;
let pathsChecked = 0;
let anchorsChecked = 0;
let lineCitesChecked = 0;
let readmesChecked = 0;
let readmePathsChecked = 0;
const specsExercised = new Set();

for (const app of apps) {
  const appId = app.replace(/^apps\//, '');
  for (const { channel, file, key } of swornWanted) {
    const rel = `${app}/store/${channel}/${file}`;
    if (!existsSync(abs(rel))) continue; // presence is assert-store-metadata.mjs's contract
    const spec = SWORN_SPECS.get(key);
    const tmpl = templates.get(key);
    const doc = readJson(rel);
    if (!doc.json) {
      fail(`${rel} is not valid JSON (${doc.error}). A sworn declaration nothing can parse is a declaration nothing can check.`);
      continue;
    }
    copiesChecked++;
    specsExercised.add(key);
    const j = doc.json;

    // ── limb 1 · the floor, absolute AND relative to the template ───────────
    const lines = doc.text.split('\n').length;
    // The template-relative half of the floor. Its validity (MIN_LINES must sit
    // ABOVE the template) is asserted in the hoisted limb-7 block above, before
    // any answered copy is measured against it.
    const floor = Math.max(MIN_LINES, tmpl.lines * 2);
    if (lines < floor) {
      fail(
        `🔴 ${rel} is ${lines} lines; the floor is ${floor} (absolute ${MIN_LINES}, or twice the ${tmpl.lines}-line ` +
          `brick template at ${tmpl.rel}, whichever is larger). A sworn declaration does not shrink by two thirds ` +
          'in the ordinary course of business — this is the shape of a stamp overwriting an answered file.',
      );
    }

    // ── limb 2 · the template signature, DERIVED from the brick ─────────────
    if (tmpl.hasCitedArray && Array.isArray(j.sources?.cited)) {
      fail(
        `🔴 ${rel} carries \`sources.cited\` as an ARRAY, which is the brick template's empty-citation shape ` +
          `(${tmpl.rel}). An answered declaration cites its sources as named objects; an array here means the ` +
          'template was written over the answers.',
      );
    }
    const regressedNulls = tmpl.nullKeys.filter((k) => Object.prototype.hasOwnProperty.call(j, k) && j[k] === null);
    if (regressedNulls.length) {
      fail(
        `🔴 ${rel} answers \`null\` for ${regressedNulls.length} field(s) the brick stamps null and an answered ` +
          `copy must not: ${regressedNulls.join(', ')}. These are the template's own unanswered fields — the list ` +
          `is derived from ${tmpl.rel}, so it re-derives itself when the brick is re-cut.`,
      );
    }

    // ── limb 3 · the prose floor ────────────────────────────────────────────
    const readme = Array.isArray(j._readme) ? j._readme.length : 0;
    if (readme < spec.minReadme) {
      fail(
        `${rel} has a ${readme}-line \`_readme\`; the floor is ${spec.minReadme} (the brick template's is ` +
          `${tmpl.readme} lines of instructions to a future author). The readme is the only record of WHY each ` +
          'answer is what it is and which questions were settled — losing it costs no machine check anywhere, ' +
          'which is exactly why nothing else notices.',
      );
    }

    // ── limb 3b · the citation COUNT (their SHAPE is play-declarations') ────
    const src = j.sources && typeof j.sources === 'object' ? j.sources : {};
    const citations = Object.entries(src).filter(
      ([k, v]) => !k.startsWith('_') && v && typeof v === 'object' && !Array.isArray(v) && typeof v.url === 'string',
    );
    if (citations.length < spec.minCitations) {
      fail(
        `${rel} carries ${citations.length} source citation(s); the floor is ${spec.minCitations}. ` +
          'assert-play-declarations.mjs checks that each citation has a url, a fetch date, a quote and an allowed ' +
          'host — it does not check that any remain. Deleting them all leaves that limb ranging over nothing.',
      );
    }

    // ── limb 4 · substance ──────────────────────────────────────────────────
    for (const pointer of spec.nonEmptyArrays) {
      const v = at(j, pointer);
      if (!Array.isArray(v) || v.length === 0) {
        fail(
          `${rel} \`${pointer}\` is ${Array.isArray(v) ? 'EMPTY' : 'missing'}. It is the record itself; an empty ` +
            'one reads as "there was never anything here" and is indistinguishable from a fresh stamp.',
        );
      }
    }
    for (const { at: pointer, min } of spec.minKeys) {
      const v = at(j, pointer);
      const n = v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).length : 0;
      if (n < min) {
        fail(`${rel} \`${pointer}\` carries ${n} key(s); at least ${min} are required. These name what a PERSON must do before submission — a machine cannot inherit them.`);
      }
    }
    for (const pointer of spec.booleans) {
      const v = at(j, pointer);
      if (typeof v !== 'boolean') {
        fail(
          `🔴 ${rel} \`${pointer}\` is ${JSON.stringify(v)} and must be a boolean. MEASURED HOLE: nulling this ` +
            'field is exit 0 on assert-play-declarations.mjs, so the store question it answers silently goes ' +
            'unanswered while every other guard stays green.',
        );
      }
    }
    for (const { at: pointer, keys } of spec.entryKeys) {
      const arr = at(j, pointer);
      if (!Array.isArray(arr)) continue; // already reported by nonEmptyArrays
      arr.forEach((entry, i) => {
        for (const k of keys) {
          const v = entry && typeof entry === 'object' ? entry[k] : undefined;
          if (typeof v !== 'string' || v.trim().length === 0) {
            fail(`${rel} \`${pointer}[${i}]\` has no \`${k}\`. A settled question with no write-up is a settled question nobody can re-check.`);
          }
        }
      });
    }
    for (const [pointer, value] of strings(j)) {
      if (!pointer.endsWith('basis')) continue;
      if (value.trim().length < MIN_BASIS_CHARS) {
        fail(
          `🔴 ${rel} \`${pointer}\` is ${value.trim().length} character(s): ${JSON.stringify(value.slice(0, 40))}. ` +
            `A basis under ${MIN_BASIS_CHARS} characters is a placeholder. MEASURED HOLE: replacing every basis ` +
            'with the word "stamped" is exit 0 on assert-play-declarations.mjs, which checks only that the field ' +
            'is a non-empty string.',
        );
      }
    }

    // ── limb 5 · every cited path still exists ──────────────────────────────
    const seen = new Set();
    for (const [pointer, value] of strings(j)) {
      for (const m of value.matchAll(PATH_RE)) {
        const cited = m[0];
        if (seen.has(cited)) continue;
        seen.add(cited);
        // A citation may name the file IN THIS APP (`apps/{app}/…`, a template
        // placeholder standing for the app being checked) or the file IN THE
        // BRICK (`tooling/bricks/app/__brick__/apps/{{app_id}}/…`, where the
        // braces are a LITERAL DIRECTORY NAME on disk). Both are real citations
        // and either resolution is enough.
        //
        // 🔴 SUBSTITUTION ALONE WAS WRONG, and it only became visible with the
        // third sworn declaration (2026-08-09). ads-declaration.json's format
        // scan anchors on a widget in the BRICK — which is where a promo surface
        // arrives for all fifty apps at once — and substituting `{{app_id}}` →
        // `subly` turned a citation of a file that exists into
        // `…/__brick__/apps/subly/…`, which never will. The repair accepts
        // either reading rather than guessing which one was meant; both name a
        // file that is really there, which is all this limb claims.
        const candidates = [cited.replace('{{app_id}}', appId).replace('{app}', appId), cited];
        pathsChecked++;
        if (!candidates.some((c) => existsSync(abs(c)))) {
          fail(
            `${rel} \`${pointer}\` cites ${cited}, which does not exist (tried ${candidates.join(' and ')}). A sworn ` +
              'sentence resting on a file that was renamed is a false record, and these strings are read by nothing ' +
              'else in the tree.',
          );
        }
      }
    }

    // ── limb 6 · UI anchors ─────────────────────────────────────────────────
    for (const anchor of UI_ANCHORS) {
      if (anchor.doc !== key) continue;
      anchorsChecked++;
      const anchorFile = anchor.file.replace('{app}', appId);
      // Self-check A: the declaration must still cite the file the anchor is
      // about. If it does not, the anchor is aimed at a sentence that no longer
      // exists and would pass forever.
      const citesIt = strings(j).some(([, v]) => v.includes(anchorFile));
      if (!citesIt) {
        fail(
          `🔴 STALE ANCHOR — ${rel} no longer cites ${anchorFile}, which UI anchor "${anchor.pointer}" is about. ` +
            'Either the declaration was rewritten and the anchor must be re-pointed, or the sentence it guards was ' +
            'deleted. Both are changes to a sworn record; neither may pass as a no-op.',
        );
        continue;
      }
      // Self-check B: the anchored file must exist (limb 5 covers the citation,
      // this covers the anchor's own copy of the path).
      if (!existsSync(abs(anchorFile))) {
        fail(`🔴 STALE ANCHOR — ${anchorFile} does not exist, so UI anchor "${anchor.pointer}" checks nothing.`);
        continue;
      }
      // CODE half — comments and string literals stripped first, so a comment
      // narrating the row (there are two in the merged screen) can never
      // satisfy this, and neither can a log line quoting it.
      const reduced = stripStringLiterals(
        stripSourceComments(readFileSync(abs(anchorFile), 'utf8'), '.dart'),
      );
      if (!reduced.includes(anchor.codeSymbol)) {
        fail(
          `🔴 ${rel} rests on a screen row that is GONE — ${anchorFile} no longer references ` +
            `${JSON.stringify(anchor.codeSymbol)} in CODE (comments and strings stripped). ${anchor.why}`,
        );
      }
      // COPY half — what the user actually sees is the .arb value; a key that
      // renders something unrelated is a row wearing the sworn sentence's name.
      const arbRel = anchor.arbFile.replace('{app}', appId);
      if (!existsSync(abs(arbRel))) {
        fail(`🔴 STALE ANCHOR — ${arbRel} does not exist, so the copy half of "${anchor.pointer}" checks nothing.`);
        continue;
      }
      let arb;
      try {
        arb = JSON.parse(readFileSync(abs(arbRel), 'utf8'));
      } catch (e) {
        fail(`🔴 ${arbRel} is not valid JSON (${e.message}) — the copy half of "${anchor.pointer}" cannot be read.`);
        continue;
      }
      const copy = arb[anchor.arbKey];
      if (typeof copy !== 'string' || !copy.includes(anchor.arbMustContain)) {
        fail(
          `🔴 ${rel} rests on screen copy that is GONE — ${arbRel} key ${JSON.stringify(anchor.arbKey)} ` +
            `no longer renders text containing ${JSON.stringify(anchor.arbMustContain)} ` +
            `(found: ${JSON.stringify(copy ?? null)}). ${anchor.why}`,
        );
      }
    }

    // ── limb 8 · line citations still point at what they describe ───────────
    const docText = strings(j)
      .map(([, v]) => v)
      .join('\n');
    for (const la of LINE_ANCHORS) {
      if (la.doc !== key) continue;
      const laFile = la.file.replace('{app}', appId);
      if (!existsSync(abs(laFile))) {
        fail(`🔴 STALE LINE ANCHOR — ${laFile} does not exist, so the ${la.cite} citation in ${rel} checks nothing.`);
        continue;
      }
      const src = readFileSync(abs(laFile), 'utf8').split('\n');
      if (!src.some((l) => l.includes(la.anchor))) {
        fail(
          `🔴 STALE LINE ANCHOR — ${laFile} no longer contains ${JSON.stringify(la.anchor)} anywhere. That is a ` +
            `RENAME, not a line shift, so re-point the anchor rather than the number: ${la.why}.`,
        );
        continue;
      }
      // The number is read out of the sworn document — its own claim is what is
      // under test. `basename:N` or `basename:N-M`, whichever the prose uses.
      const base = laFile.split('/').pop();
      const cites = [
        ...docText.matchAll(new RegExp(`${base.replace(/[.]/g, '\\.')}:(\\d+)(?:-(\\d+))?`, 'g')),
      ];
      if (!cites.length) {
        fail(
          `🔴 STALE LINE ANCHOR — ${rel} no longer cites ${base}:<line> at all, so the anchor for ` +
            `${JSON.stringify(la.anchor)} is aimed at a sentence that is gone and would pass forever.`,
        );
        continue;
      }
      lineCitesChecked++;
      const hit = cites.some(([, from, to]) => {
        const a = Number(from);
        const b = Number(to ?? from);
        return src.slice(a - 1, b).some((l) => l.includes(la.anchor));
      });
      if (!hit) {
        const where = src.findIndex((l) => l.includes(la.anchor)) + 1;
        fail(
          `🔴 DRIFTED CITATION — ${rel} cites ${cites
            .map((c) => `${base}:${c[1]}${c[2] ? `-${c[2]}` : ''}`)
            .join(', ')}, and NONE of those lines contains ${JSON.stringify(la.anchor)}. It is at ${base}:${where} ` +
            `today. ${la.why}. A line number is a pointer into a file other people edit: it is correct until ` +
            'somebody inserts above it, and nothing recomputes it. Fix the number in the sworn document.',
        );
      }
    }
  }

  // ── limb 9 · the channel README's cited paths still exist ─────────────────
  // Deliberately OUTSIDE the sworn loop above: that loop ranges over the JSON
  // declarations, which exist on ONE channel, and this limb's subject is every
  // channel's README. Nesting it there is how it would have silently checked
  // android-play only.
  for (const channel of storeChannels) {
    const rel = `${app}/store/${channel}/README.md`;
    if (!existsSync(abs(rel))) continue; // presence is assert-store-metadata.mjs's contract
    readmesChecked++;
    const readmeLines = readFileSync(abs(rel), 'utf8').split('\n');
    const seenInReadme = new Set();
    for (let i = 0; i < readmeLines.length; i++) {
      for (const m of readmeLines[i].matchAll(PATH_RE)) {
        const cited = m[0];
        if (seenInReadme.has(cited)) continue;
        seenInReadme.add(cited);
        // The same two readings limb 5 accepts, for the same measured reason: a
        // citation may name the file IN THIS APP (a `{app}`/`{{app_id}}`
        // placeholder standing for the app being checked) or the file IN THE
        // BRICK, where the braces are a literal directory name on disk.
        const candidates = [cited.replace('{{app_id}}', appId).replace('{app}', appId), cited];
        readmePathsChecked++;
        if (!candidates.some((c) => existsSync(abs(c)))) {
          fail(
            `${rel}:${i + 1} cites ${cited}, which does not exist (tried ${candidates.join(' and ')}). ` +
              'This table is a DERIVATION MAP — it tells a person which file each listing field is generated ' +
              'from. Pointing it at a file that was moved or deleted is a confident wrong answer, and nothing ' +
              'else in this tree reads these strings. [Ten of these survived here after #216 moved app_config.]',
          );
        }
      }
    }
  }
}

// ── REQUIRED_COVERAGE, final direction: did every spec actually get used? ───
const unexercised = [...SWORN_SPECS.keys()].filter((k) => !specsExercised.has(k));
if (unexercised.length) {
  coverageLost([
    `${unexercised.length} spec(s) were never exercised: ${unexercised.join(', ')}.`,
    'No app in the workspace carries that declaration, so its floors ranged over nothing while this guard',
    'printed a pass. Either the file was deleted from every app — which assert-store-metadata.mjs should have',
    'caught first — or this scan is no longer finding the store trees it thinks it is.',
  ]);
}
if (copiesChecked === 0) {
  coverageLost([
    `not one sworn declaration was read across ${apps.length} app(s): ${apps.join(', ')}.`,
    'Every limb is per-copy, so zero copies is a clean pass over an empty set — the failure this guard is',
    'itself an instance of the repo trying to stop.',
  ]);
}
if (pathsChecked === 0) {
  coverageLost([
    'the cited-path limb matched ZERO repository paths across every declaration read.',
    'These files cite 55 paths today. Zero means the matcher stopped matching, not that the declarations',
    'stopped citing code — and a path check that matches nothing passes forever.',
  ]);
}
// ⚠️ GATED ON `problems.length === 0`, AND THE GATE IS NOT A SOFTENING. A
// declaration that has been overwritten by the brick template carries no line
// citations at all, so this count is legitimately zero — and that tree ALREADY
// fails, loudly, on the line floor and on `unresolved`. Ungated, this
// `coverageLost` exits first and replaces "your sworn file was clobbered" with
// "the scan found nothing", which is the wrong diagnosis of a correctly detected
// defect. It cost a real failure in the fixture suite before the gate was added.
// With everything else green, zero here really does mean the scan stopped
// reaching — the case this check exists for.
if (problems.length === 0 && lineCitesChecked < LINE_ANCHORS.length) {
  coverageLost([
    `only ${lineCitesChecked} of ${LINE_ANCHORS.length} line citation(s) were evaluated.`,
    'Each one is a sworn sentence resting on a specific line of code, and the number it checks is read out of',
    'the declaration itself — so an unevaluated row is a citation nobody is re-walking. Three of these four',
    'were measurably wrong on 2026-08-10 while every claim they made was still true, which is why prose',
    '("re-walk these before submission") was not accepted as the repair.',
  ]);
}
if (readmesChecked === 0) {
  coverageLost([
    `not one channel README was read across ${apps.length} app(s) and ${storeChannels.length} channel(s).`,
    'Limb 9 is per-README, so zero READMEs is a clean pass over an empty set. `README.md` is',
    '`storeMetadataContract.requiredFiles[0]` — every store tree has one by contract — so zero does not mean',
    'the READMEs are fine, it means this scan is no longer finding the store trees it thinks it is.',
  ]);
}
if (readmePathsChecked === 0) {
  coverageLost([
    `the channel READMEs matched ZERO repository paths across ${readmesChecked} README(s).`,
    'Every derivation map names the file each listing field is generated from; the count is 32 today and is',
    'never legitimately zero. The ten dead paths this limb was written for all lived in those tables, so a',
    'matcher that stopped matching would restore the exact blindness this limb exists to end — and a path',
    'check that matches nothing passes forever.',
  ]);
}
if (anchorsChecked === 0) {
  coverageLost([
    `not one of the ${UI_ANCHORS.length} UI anchor(s) was evaluated.`,
    'Each one guards a sworn sentence that rests on a screen ROW, which the cited-path limb cannot see.',
    'Unevaluated, they are documentation.',
  ]);
}

for (const n of notes) console.log(n);
console.log(
  `note skipped ${skippedAssets.length} non-.json additionalFile(s) — store ASSETS, not declarations ` +
    `(${skippedAssets.join(', ')}); assert-listing-assets.mjs owns them.`,
);
console.log(
  'note this guard does NOT re-check whether the answers are TRUE. That is assert-play-declarations.mjs, ' +
    'which was mutation-measured on 2026-08-08 and owns the posture, the tells, the inventory relation and ' +
    'the citation shape. This one owns only "is it still answered at all".',
);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  [ADR 037 P2.7] The Data safety and content-rating files are SWORN DECLARATIONS. They were');
  console.error('  placed in the re-stamp\'s EXCLUDE-verbatim bucket by a decision no guard enforced until now:');
  console.error('  Private/knowledge/plans/subly-restamp-P22-lock.md §1.3.');
  console.error('\nassert-sworn-store-files: FAILED');
  process.exitCode = 1;
} else {
  console.log(
    `\nok   ${copiesChecked} sworn declaration(s) still answered across ${apps.length} app(s); ` +
      `${pathsChecked} cited path(s) resolve; ${anchorsChecked} UI anchor(s) hold; ` +
      `${readmePathsChecked} path(s) in ${readmesChecked} channel README(s) resolve; ` +
      `${templates.size} brick template(s) still blank`,
  );
  console.log('\nassert-sworn-store-files: ok');
}
