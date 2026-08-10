#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-ads-declarations.mjs — THE ADVERTISING ANSWER IS DECIDED BY FORMAT, SO
// IT IS DERIVED FROM FORMAT, ONCE, AND EVERY CLAIM THAT DEPENDS ON IT IS
// COMPARED TO THAT ONE DERIVATION.
//
// [research/44 §3 V3 · pipeline K-8 / G-32] This repository made THREE sworn
// claims about advertising and could not check the thing all three are about:
//
//   1. sites/nikatru/privacy.html — "…and no Nikatru app carries advertising."
//      Registered at tooling/legal/policy-claims.json as a `code` row whose
//      assertion is a PUBSPEC WALK for ad SDKs.
//   2. store/android-play/content-rating.json `contains-ads` — derivation
//      "dependency-tells": eight Dart packages and one Android permission.
//   3. store/android-play/data-safety.json — the Play purpose "Advertising or
//      marketing" exists in the vocabulary and is used by zero answer rows.
//   4. …and the Play Console "App content → Ads" declaration, the one that puts
//      the "Contains ads" badge on the listing, had NO repo representation at
//      all: no file, no derivation, no guard.
//
// 🔴 ALL THREE KEY ON PACKAGE TELLS, AND THE QUESTION IS NOT ABOUT PACKAGES.
// Google's ads declaration lists a YES trigger that needs no SDK: "House ads: My
// app renders a small ad banner, interstitial ad, ad wall, and/or widget" to
// promote your other apps. A house ad is UI WE RENDER — no dependency, no
// permission, no manifest entry. So a promo surface can land and every one of
// those dependency-keyed assertions stays GREEN while becoming FALSE. That is
// this repository's signature defect (a check that cannot fail for the change it
// is nominally about) sitting under a declaration whose stated penalty is
// suspension: "If you misrepresent the presence of ads in your app(s), it's
// considered a violation of the Google Play policies and may result in your
// app(s) being suspended."
//
// ── WHAT IT DERIVES, FROM THE SHIPPED TREE ──────────────────────────────────
//  (A) DOES A PROMOTIONAL COMPONENT EXIST? Every Dart file under the declared
//      roots — the app, the shared packages AND the brick template, because the
//      brick is where a surface arrives for all fifty apps at once — is reduced
//      (comments and string literals blanked) and its WIDGET-SHAPED
//      DECLARATIONS are parsed out: `class X extends <widget>` and
//      `Widget x(…)`. A declaration is flagged when its OWN NAME carries an
//      advertising token. Names, not prose: a comment about house ads and a
//      copy string reading "Sponsored" are both blanked before the scan.
//
//      ⚠️ THE CALIBRATION CASE IS `CatchUpNudgeBanner`, AND IT MUST NOT FIRE.
//      It is a banner, it sits in the home body, and it is not an ad — it nudges
//      the user about their own data. A rule keyed on "banner" would raise a
//      false alarm on day one and be switched off within a week, which is why
//      the format word only CLASSIFIES a hit that already fired on an
//      advertising token. It is also a required-coverage anchor, so the matcher
//      is proven to still find it on every run.
//
//  (B) DOES A SERVED CONFIG PAYLOAD CARRY A PROMOTIONAL LEVER, OR NAME AN APP
//      THAT IS NOT THE HOST? The payload is parsed as STRUCTURE. A key whose
//      tokens carry an advertising word is a lever; a lever whose value is
//      disarmed (0/false/null/empty) is PRINTED, not failed — that is exactly
//      what `max_promos_per_week: 0` is, a cap that ships before the sender.
//      An ARMED lever is a promotional surface reaching devices by
//      configuration. A key carrying both an advertising token and `app`, or a
//      string value equal to another registered app's slug, is a CROSS-APP
//      payload — which is the trigger with the different declaration
//      consequence (same-app promotion matches none of Play's three).
//
// ── AND THEN IT COMPARES THAT ONE VERDICT TO ALL FOUR CLAIMS ─────────────────
// ads-declaration.json's own answers · data-safety.json's advertising-purpose
// row count · content-rating.json's `contains-ads` · and the privacy page's
// advertising sentence, PINNED THREE WAYS (the declaration names the exact
// sentence, the register must carry it as a row, the page must still emphasise
// it). The pin is what makes an owner-gated reword impossible to forget: the
// sentence cannot change without editing this declaration in the same commit,
// and it cannot stay as written once the format scan finds a surface.
//
// 🔬 WHY THE PROSE IS NEVER GREPPED. tooling/legal/policy-claims.json's own
// advertising row exists because a NAMED LIST IS NOT EXHAUSTIVE; answering
// "does this sentence still promise no ads" by pattern-matching English would
// be the same defect one level up. So the sentence is compared for EQUALITY
// against the register row and against the emphasised span extracted from the
// page — three copies of one string, pinned — and the only semantic claim made
// about it lives in the declaration as a boolean (`assertsAbsence`).
//
// ── WHAT THIS GUARD CANNOT SEE, PRINTED ON EVERY RUN ────────────────────────
//   · STORE LISTING ASSETS. A promotional screenshot is a promotional surface
//     and this scan reads code, not PNGs. Recorded as human-owned.
//   · A KV CONFIG OVERRIDE. `config:<app>` is written outside the tree; the
//     bundled payload is what CI can read.
//   · THE COMPILED-IN DART DEFAULT for the promo-notification cap, owned end to
//     end by assert-adapter-capabilities.mjs. Deliberately not re-asserted — a
//     redundant assertion is the thing this repository deletes.
//   · WHETHER GOOGLE HAS CHANGED THE DECLARATION since the recorded fetch date.
//
// Usage:  node tooling/ci/assert-ads-declarations.mjs [repoRoot]
// Exit 0 = every advertising claim still agrees with the shipped tree.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listDir } from './tree-walk.mjs';
import {
  emphasisedSpans,
  normaliseForMatch,
  stripSourceComments,
  stripStringLiterals,
} from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
const CHANNEL = 'android-play';
const ADS_FILE = 'ads-declaration.json';
const SWORN_SIBLINGS = ['data-safety.json', 'content-rating.json'];

const problems = [];
const prints = [];

const abs = (rel) => join(ROOT, ...rel.split('/'));
const exists = (rel) => existsSync(abs(rel));
const read = (rel) => (exists(rel) ? readFileSync(abs(rel), 'utf8') : null);
const isDir = (rel) => exists(rel) && statSync(abs(rel)).isDirectory();

/** Structural failure. Every limb below quantifies over something the scan
 *  found, so continuing would report "clean" over nothing — this repository's
 *  single most repeated defect, and the one an empty advertising domain is
 *  indistinguishable from. Exits immediately. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-ads-declarations: FAILED');
  process.exit(1);
}

function parseJson(rel, why) {
  const text = read(rel);
  if (text === null) coverageLost([`${rel} does not exist.`, ...why]);
  try {
    return JSON.parse(text);
  } catch (e) {
    coverageLost([`${rel} is not valid JSON — ${e.message}`, ...why]);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RULE. These live in the GUARD and not in the declaration on purpose: they
// are the DERIVATION, not the app's claim. A declaration that carried its own
// token list would be a list somebody trims on the afternoon it is inconvenient
// — the same shape as the hand-ratcheted floors this repo has already removed.
// The declaration owns what is app-shaped (its roots, its anchors, its
// payloads); the guard owns what is Google-shaped.
// ─────────────────────────────────────────────────────────────────────────────
/** An identifier token that says "this is advertising or promotion". Matched as
 *  a WHOLE TOKEN after camelCase/snake_case splitting, which is why `ad` cannot
 *  fire on "adapter", "header" or "read", and `promos` fires on
 *  `maxPromosPerWeek`. */
const AD_TOKENS = new Set([
  'ad', 'ads', 'advert', 'adverts', 'advertising', 'advertisement', 'advertisements',
  'promo', 'promos', 'promotion', 'promotions', 'promotional', 'promoted',
  'interstitial', 'interstitials', 'adwall', 'sponsor', 'sponsored', 'sponsorship',
]);

/** Pairs that mean "a surface pointing at our OTHER apps" without containing an
 *  advertising word. Play's NO carve-out is literally a "More Apps section in
 *  the main menu", so the words are the ones Google itself uses. */
const AD_PAIRS = [
  ['more', 'apps'],
  ['your', 'apps'],
  ['other', 'apps'],
  ['cross', 'app'],
  ['cross', 'apps'],
  ['cross', 'sell'],
];

/** Format words, used ONLY to classify a hit that already fired. Google asks
 *  which format renders — "a small ad banner, interstitial ad, ad wall, and/or
 *  widget" — and the answer goes on the declaration. */
const FORMAT_TOKENS = [
  'banner', 'interstitial', 'wall', 'widget', 'card', 'panel', 'sheet', 'dialog',
  'overlay', 'popup', 'takeover', 'tile', 'carousel',
];

/** Does this base class make a declaration a RENDERED SURFACE? A promotional
 *  class that is not one is machinery, not a surface, and is PRINTED rather than
 *  failed — `PromoGate` (a pure decision primitive) creates no Play consequence
 *  on its own, and failing on it would make the frequency governor unshippable
 *  ahead of the widget it governs.
 *
 *  🔴 THIS WAS AN ENUMERATED PREFIX LIST AND THE LIST WAS NOT EXHAUSTIVE — the
 *  precise defect this guard indicts in the three declarations it checks.
 *  Measured on the real tree 2026-08-09: `class PromoBanner extends
 *  HookConsumerWidget` — the standard flutter_hooks/Riverpod base, and a surface
 *  that unambiguously RENDERS — was classified "PROMOTIONAL MACHINERY, NO
 *  SURFACE" and the guard exited 0. A house ad would have shipped under the one
 *  check written to stop it, because the rule keyed on a hand-typed set of
 *  prefixes (`Stateless|Stateful|Consumer|…`) that nobody re-derives when
 *  Flutter or Riverpod adds a base.
 *
 *  So the rule is STRUCTURAL now, and it is a property of Dart/Flutter naming
 *  rather than a list somebody maintains: a widget base is named `…Widget`, and
 *  a `State` companion is `…State<…>` (the generic parameter is required, so a
 *  plain domain class `extends AppState` is not swept in). `CustomPainter` is
 *  named explicitly because it is the one renderer whose name breaks the
 *  convention — it paints pixels, so a `PromoPainter` is a surface. */
function isWidgetShaped(base) {
  const bare = String(base).replace(/\s*<[\s\S]*$/, '').trim();
  const generic = /</.test(String(base));
  if (/(?:^|[A-Za-z0-9_$])Widget$/.test(bare)) return true;
  if (generic && /State$/.test(bare)) return true;
  return /^CustomPainter$/.test(bare);
}

/** camelCase / snake_case / kebab-case → lower-case word tokens. */
function tokensOf(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

const adTokenHit = (toks) => toks.filter((t) => AD_TOKENS.has(t));
const pairHit = (toks) => AD_PAIRS.filter(([a, b]) => toks.includes(a) && toks.includes(b)).map((p) => p.join('+'));
const formatOf = (toks) => FORMAT_TOKENS.filter((f) => toks.includes(f));

/** Disarmed = 0, false, null, "", [], {}. A promotional lever that is disarmed
 *  is a cap shipping before its sender, which is a GOOD state and is printed.
 *  Armed is a promotional surface reaching devices by configuration. */
function isArmed(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// 0 · THE REGISTER, AND THE SELF-CHECK ON THE ENFORCEMENT PATH.
//     Presence and non-emptiness of the three declarations is
//     assert-store-metadata.mjs's contract, via `additionalFiles`. If this file
//     is not listed there, deleting it leaves that guard silent and this one
//     COVERAGE LOSTs pointing at the wrong thing. Two guards, one relationship,
//     declared once — the same arrangement assert-play-declarations.mjs makes.
// ─────────────────────────────────────────────────────────────────────────────
const register = parseJson(REGISTER_REL, [
  'It declares the store channels and the per-channel file contract. Without it this guard cannot locate',
  'the metadata tree and every check below ranges over nothing.',
]);
const channelRow = (Array.isArray(register.channels) ? register.channels : []).find((c) => c && c.id === CHANNEL);
if (!channelRow || typeof channelRow.storeMetadataDir !== 'string') {
  coverageLost([
    `${REGISTER_REL} declares no \`${CHANNEL}\` channel with a \`storeMetadataDir\`.`,
    'The declarations live inside that tree. With no row there is no tree to check.',
  ]);
}
const additional = register.storeMetadataContract?.perChannel?.[CHANNEL]?.additionalFiles ?? [];
for (const f of [ADS_FILE, ...SWORN_SIBLINGS]) {
  if (!additional.includes(f)) {
    coverageLost([
      `${REGISTER_REL} storeMetadataContract.perChannel["${CHANNEL}"].additionalFiles does not list "${f}".`,
      'That list is what makes assert-store-metadata.mjs (and tooling/release/submit-play.mjs) require the',
      'file present and non-empty, and what makes assert-sworn-store-files.mjs derive a floor for it. Off',
      'it, the declaration can be deleted or emptied and the only guard that would notice is this one —',
      'exactly one guard too few for a sworn declaration.',
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 0b · THE APPS. Derived from the root pubspec `workspace:` list, never from a
//      directory listing: the brick lane stamps apps/probe and never removes it,
//      so a listing differs between a maintainer's box and CI.
// ─────────────────────────────────────────────────────────────────────────────
const apps = [];
{
  const text = read('pubspec.yaml');
  if (text === null) {
    coverageLost([
      'the root pubspec.yaml does not exist.',
      'It is where the set of apps comes from; with none, every limb below ranges over nothing.',
    ]);
  }
  const lines = text.replace(/^\s*#.*$/gm, '').split('\n');
  const at = lines.findIndex((l) => /^workspace:\s*$/.test(l));
  if (at !== -1) {
    for (const line of lines.slice(at + 1)) {
      if (/^\S/.test(line)) break;
      const m = line.match(/^\s*-\s*(\S+)\s*$/);
      if (m && m[1].startsWith('apps/')) apps.push(m[1].replace(/^apps\//, ''));
    }
  }
}
if (apps.length === 0) {
  coverageLost([
    'the root pubspec.yaml has no readable `workspace:` block naming an apps/ member.',
    'The set of apps whose advertising declarations are checked would be empty, and an empty domain',
    'prints ok.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RUN, PER APP THAT CARRIES A PLAY METADATA TREE.
// ─────────────────────────────────────────────────────────────────────────────
let appsChecked = 0;
let filesScannedTotal = 0;
let declarationsSeen = 0;
let widgetsSeen = 0;
let anchorsChecked = 0;
let crossChecksRun = 0;

for (const app of apps) {
  const dir = channelRow.storeMetadataDir.replace('{app}', app);
  if (!isDir(dir)) continue; // presence of the TREE is assert-store-metadata.mjs's contract
  appsChecked++;

  const ADS_REL = posix.join(dir, ADS_FILE);
  const DS_REL = posix.join(dir, 'data-safety.json');
  const CR_REL = posix.join(dir, 'content-rating.json');

  const decl = parseJson(ADS_REL, [
    'This IS the Play "App content → Ads" declaration. Absent, the answer that decides whether the store',
    'listing carries a "Contains ads" badge exists nowhere that can be reviewed or re-derived, and the',
    'three other advertising claims in this tree have nothing to be consistent WITH.',
  ]);
  const ds = parseJson(DS_REL, [
    'The Data safety declaration carries the "Advertising or marketing" purpose vocabulary, which is one of',
    'the four claims cross-checked below.',
  ]);
  const cr = parseJson(CR_REL, [
    'The content-rating questionnaire carries the `contains-ads` claim, which is one of the four claims',
    'cross-checked below.',
  ]);

  // ── 1 · CITATIONS. Same rule as the sibling declarations: a URL, a fetch date,
  //      a quote, and a host that WROTE or ENFORCES the rule. A store limit
  //      sourced to a blog cannot be re-verified.
  const sources = decl.sources;
  if (!sources || typeof sources !== 'object') {
    problems.push(
      `${ADS_REL} carries no \`sources\` block. Every trigger this declaration rests on needs a URL and a fetch date; an unverifiable policy rule is one nobody can tell has changed.`,
    );
  } else {
    const allowed = Array.isArray(sources.allowedHosts) ? sources.allowedHosts : [];
    if (allowed.length === 0) {
      problems.push(`${ADS_REL} sources.allowedHosts is missing or empty, so every citation would be accepted from any host at all.`);
    }
    let cited = 0;
    for (const [key, cite] of Object.entries(sources)) {
      if (key === 'allowedHosts' || key.startsWith('_')) continue;
      if (!cite || typeof cite !== 'object' || Array.isArray(cite)) {
        problems.push(`${ADS_REL} sources.${key} is not a citation object.`);
        continue;
      }
      for (const field of ['url', 'fetched', 'quote']) {
        if (typeof cite[field] !== 'string' || cite[field].trim() === '') {
          problems.push(`${ADS_REL} sources.${key} has no \`${field}\`. A cited rule needs the page, the day it said this, and what it said.`);
        }
      }
      if (typeof cite.url !== 'string') continue;
      let host;
      try {
        host = new URL(cite.url).host;
      } catch {
        problems.push(`${ADS_REL} sources.${key}.url is not a URL: ${JSON.stringify(cite.url)}`);
        continue;
      }
      if (allowed.length && !allowed.includes(host)) {
        problems.push(
          `${ADS_REL} sources.${key} cites ${host}, which is not in sources.allowedHosts. The test a host passes is that it WROTE the rule or ENFORCES it.`,
        );
        continue;
      }
      if (typeof cite.fetched === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(cite.fetched)) {
        problems.push(`${ADS_REL} sources.${key}.fetched is not an ISO date (YYYY-MM-DD): ${JSON.stringify(cite.fetched)}`);
        continue;
      }
      cited++;
    }
    if (cited === 0) {
      coverageLost([
        `${ADS_REL} carries ZERO usable citations.`,
        'Every trigger and carve-out this declaration reasons from would then be unsourced, and the answers',
        'below would rest on somebody\'s memory of a Google help page.',
      ]);
    }
  }

  if (typeof decl.console?.wordingStatus !== 'string') {
    problems.push(
      `${ADS_REL} carries no \`console.wordingStatus\`. The console's actual field text was either fetched and cited or it was not, and which of the two is load-bearing: a file that silently implies it mirrors the form is one nobody re-reads.`,
    );
  } else if (decl.console.wordingStatus === 'UNVERIFIED') {
    prints.push(`UNVERIFIED — the App content → Ads form's exact console wording was not fetched. ${decl.console.why ?? ''}`);
  }

  // ── 2 · THE FORMAT SCAN ────────────────────────────────────────────────────
  const scan = decl.formatScan;
  if (!scan || typeof scan !== 'object') {
    coverageLost([
      `${ADS_REL} declares no \`formatScan\`.`,
      'It names the roots walked, the floor on how many files that walk must reach, and the anchor symbols',
      'that prove the matcher still matches. Without it the advertising answer is an assertion with nothing',
      'behind it — which is the state this whole file exists to leave.',
    ]);
  }
  const roots = Array.isArray(scan.roots) ? scan.roots.filter((r) => typeof r === 'string') : [];
  if (roots.length === 0) {
    coverageLost([
      `${ADS_REL} formatScan.roots is empty.`,
      'The walk would read no file, find no promotional component, and the declaration would answer "no ads"',
      'on the strength of having looked nowhere.',
    ]);
  }

  /** Every .dart file under the declared roots. Tests excluded: a fixture named
   *  `PromoCardTest` is not a shipped surface. */
  const dartFiles = [];
  const walk = (relDir) => {
    if (!isDir(relDir)) return;
    for (const e of listDir(abs(relDir), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'build' || e.name === '.dart_tool') continue;
      const child = `${relDir}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith('.dart') && !e.name.endsWith('_test.dart') && !/\/test\//.test(child)) dartFiles.push(child);
    }
  };
  const missingRoots = roots.filter((r) => !isDir(r));
  if (missingRoots.length) {
    coverageLost([
      `${ADS_REL} formatScan.roots names ${missingRoots.length} director(ies) that do not exist: ${missingRoots.join(', ')}.`,
      'A root that is not there contributes no files, so the domain shrinks silently and the answer stays',
      '"no ads" for a reason that has nothing to do with the app. If a package moved, move the root with it',
      'in the same change.',
    ]);
  }
  for (const r of roots) walk(r);
  const minFiles = Number.isInteger(scan.minFiles) ? scan.minFiles : 0;
  if (minFiles <= 0) {
    coverageLost([
      `${ADS_REL} formatScan.minFiles is ${JSON.stringify(scan.minFiles)}; it must be a positive integer.`,
      'It is the floor on the haystack. Zero accepts a walk that read nothing, which is the only way an',
      '"absence of advertising" answer can be wrong in the direction nobody notices.',
    ]);
  }
  if (dartFiles.length < minFiles) {
    coverageLost([
      `the format walk read ${dartFiles.length} Dart file(s) under ${roots.join(', ')} and ${ADS_REL} floors it at ${minFiles}.`,
      'Either a root moved, or the walk narrowed. Both make "no promotional component was found" a statement',
      'about the instrument rather than about the app — and the two read identically in the pass line.',
    ]);
  }
  filesScannedTotal += dartFiles.length;

  /** { file, name, base, widgetShaped } for every declaration the matcher sees. */
  const declared = [];
  for (const f of dartFiles) {
    const reduced = stripStringLiterals(stripSourceComments(read(f) ?? '', '.dart'));
    for (const m of reduced.matchAll(/\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>{]*>)?\s+extends\s+([A-Za-z_$][A-Za-z0-9_$.]*(?:\s*<[^>{]*>)?)/g)) {
      declared.push({ file: f, name: m[1], base: m[2].trim(), widgetShaped: isWidgetShaped(m[2]) });
    }
    for (const m of reduced.matchAll(/(?:^|\n)\s*(?:static\s+)?Widget\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
      declared.push({ file: f, name: m[1], base: '(returns Widget)', widgetShaped: true });
    }
  }
  declarationsSeen += declared.length;
  widgetsSeen += declared.filter((d) => d.widgetShaped).length;
  if (declared.length === 0) {
    coverageLost([
      `the format matcher found ZERO declarations across ${dartFiles.length} Dart file(s).`,
      'It looks for `class X extends <widget>` and `Widget x(…)`. Finding none means the matcher stopped',
      'matching — Dart did not stop having widgets — and every "no promotional component" answer below would',
      'be a reading of a blank page reported as a clean bill of health.',
    ]);
  }

  // REQUIRED_COVERAGE: the anchors. Symbols that DO exist and must be found, so
  // an empty advertising domain is distinguishable from a broken instrument.
  const anchors = Array.isArray(scan.requiredCoverage) ? scan.requiredCoverage : [];
  if (anchors.length === 0) {
    coverageLost([
      `${ADS_REL} formatScan.requiredCoverage is empty.`,
      'These are the positive controls: known widget declarations the matcher must still find. Without them',
      'a matcher that matched nothing at all would produce exactly the answer this declaration wants to give,',
      'and nothing would tell the two apart.',
    ]);
  }
  for (const anchor of anchors) {
    const { file, symbol } = anchor ?? {};
    if (typeof file !== 'string' || typeof symbol !== 'string') {
      problems.push(`${ADS_REL} formatScan.requiredCoverage carries an entry with no \`file\`/\`symbol\` pair.`);
      continue;
    }
    anchorsChecked++;
    if (!exists(file)) {
      coverageLost([
        `${ADS_REL} formatScan.requiredCoverage anchors on ${file}, which does not exist.`,
        'An anchor whose file was renamed stops proving anything while still reading as coverage — the exact',
        'shape this guard exists to refuse. Move the anchor with the file in the same change.',
      ]);
    }
    if (!roots.some((r) => file === r || file.startsWith(`${r}/`))) {
      coverageLost([
        `${ADS_REL} formatScan.requiredCoverage anchors on ${file}, which is under none of the declared roots (${roots.join(', ')}).`,
        'The anchor would then be satisfied — or not — by a file the scan never opens, so it proves nothing',
        'about the walk it is supposed to be the control for.',
      ]);
    }
    if (!dartFiles.includes(file)) {
      coverageLost([
        `${ADS_REL} formatScan.requiredCoverage anchors on ${file} and the walk did not reach it.`,
        'The file exists and is under a declared root, so the walk itself narrowed — a filter, an exclusion or',
        'a directory rule. Everything the walk no longer reads is invisible to the advertising answer.',
      ]);
    }
    if (!declared.some((d) => d.file === file && d.name === symbol)) {
      coverageLost([
        `${ADS_REL} formatScan.requiredCoverage expects the matcher to find \`${symbol}\` in ${file}, and it did not.`,
        'The file was read, so this is the MATCHER, not the walk: it no longer recognises a widget declaration',
        'it recognised before. Every "no promotional component" answer downstream is then a property of the',
        'regex rather than of the tree.',
      ]);
    }
  }

  // (A) the promotional components.
  const surfaces = [];
  const machinery = [];
  for (const d of declared) {
    const toks = tokensOf(d.name);
    const hits = adTokenHit(toks);
    const pairs = pairHit(toks);
    if (hits.length === 0 && pairs.length === 0) continue;
    const entry = { ...d, tokens: hits, pairs, formats: formatOf(toks) };
    if (d.widgetShaped) surfaces.push(entry);
    else machinery.push(entry);
  }

  // (B) the served config payloads.
  const payloads = Array.isArray(scan.configPayloads) ? scan.configPayloads.filter((p) => typeof p === 'string') : [];
  if (payloads.length === 0) {
    coverageLost([
      `${ADS_REL} formatScan.configPayloads is empty.`,
      'A promotional surface can reach devices as configuration rather than as code — a feature flag, a copy',
      'override, a target app id. With no payload declared, that half of the domain is not scanned at all',
      'while the answer reads as derived from the whole tree.',
    ]);
  }
  const registryRel = typeof scan.appRegistry === 'string' ? scan.appRegistry : null;
  if (!registryRel) {
    coverageLost([
      `${ADS_REL} formatScan.appRegistry is missing.`,
      'It is the right-hand side of the cross-app limb: a payload value equal to ANOTHER app\'s slug is a',
      'cross-app reference. With no registry there is nothing to compare against and the limb passes by',
      'measuring nothing.',
    ]);
  }
  const registry = parseJson(registryRel, [
    'It is the portfolio catalogue the cross-app limb compares payload values against.',
  ]);
  const slugs = (Array.isArray(registry) ? registry : registry.apps ?? [])
    .map((r) => (r && typeof r === 'object' ? r.slug : r))
    .filter((s) => typeof s === 'string' && s.trim() !== '');
  if (slugs.length === 0) {
    coverageLost([
      `${registryRel} yielded ZERO app slugs.`,
      'The cross-app value limb ranges over that set; empty, it can never fire, and "no payload names another',
      'app" would be true of a registry nobody could read.',
    ]);
  }

  const levers = [];
  const crossAppRefs = [];
  let payloadKeys = 0;
  for (const rel of payloads) {
    const payload = parseJson(rel, [
      'It is a served config document this declaration claims carries no armed promotional lever. Absent,',
      'that claim ranges over nothing.',
    ]);
    const visit = (node, path, hostApp) => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => visit(v, `${path}[${i}]`, hostApp));
        return;
      }
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        const here = path ? `${path}.${key}` : key;
        // `apps.<slug>` names the HOST of everything beneath it, so a slug that
        // appears as a KEY there is the document's own subject, not a reference.
        const nextHost = path === 'apps' ? key : hostApp;
        if (!key.startsWith('_')) {
          payloadKeys++;
          const toks = tokensOf(key);
          const hits = adTokenHit(toks);
          const pairs = pairHit(toks);
          if (hits.length || pairs.length) {
            levers.push({
              file: rel,
              path: here,
              key,
              armed: isArmed(value),
              crossApp: toks.includes('app') || toks.includes('apps') || pairs.length > 0,
              value: typeof value === 'object' && value !== null ? `<${Array.isArray(value) ? 'array' : 'object'}>` : JSON.stringify(value),
            });
          }
          if (typeof value === 'string' && slugs.includes(value) && value !== nextHost) {
            crossAppRefs.push({ file: rel, path: here, value, hostApp: nextHost ?? '(none)' });
          }
        }
        visit(value, here, nextHost);
      }
    };
    visit(payload, '', null);
  }
  if (payloadKeys === 0) {
    coverageLost([
      `the config-payload walk read ZERO keys across ${payloads.join(', ')}.`,
      'Either the payload shape moved or the walk broke. An empty key set makes "no armed promotional lever"',
      'and "no cross-app reference" both vacuously true.',
    ]);
  }

  const armedLevers = levers.filter((l) => l.armed);
  const disarmedLevers = levers.filter((l) => !l.armed);
  const crossAppKeys = armedLevers.filter((l) => l.crossApp);

  // ── 3 · THE VERDICT ────────────────────────────────────────────────────────
  const adsPresent = surfaces.length > 0 || armedLevers.length > 0;
  const crossAppPresent = crossAppKeys.length > 0 || crossAppRefs.length > 0 || surfaces.some((s) => s.pairs.length > 0);
  const derivedFormats = [...new Set(surfaces.flatMap((s) => s.formats))].sort();

  const evidence = () =>
    [
      ...surfaces.map((s) => `component ${s.name} (${s.base}) in ${s.file} — advertising token(s) ${[...s.tokens, ...s.pairs].join(', ')}`),
      ...armedLevers.map((l) => `config ${l.file} ${l.path} = ${l.value} — an ARMED promotional lever`),
      ...crossAppRefs.map((r) => `config ${r.file} ${r.path} names app "${r.value}" while the host is "${r.hostApp}"`),
    ].join('; ') || '(none)';

  // ── 4 · CLAIM 1 — this declaration's own answers ────────────────────────────
  crossChecksRun++;
  if (typeof decl.containsAds !== 'boolean') {
    problems.push(`${ADS_REL} \`containsAds\` is ${JSON.stringify(decl.containsAds)}; Play asks a yes/no question and an absent answer is one somebody types into the console from memory.`);
  } else if (decl.containsAds !== adsPresent) {
    problems.push(
      adsPresent
        ? `🔴 ${ADS_REL} answers \`containsAds: false\` and the shipped tree renders a promotional surface. EVIDENCE: ${evidence()}. Google's trigger list needs no ad SDK — "House ads: My app renders a small ad banner, interstitial ad, ad wall, and/or widget" — and the penalty for getting this wrong is stated as suspension. Re-derive the answer, do not re-word it; and note that flipping it to true forces the privacy-page sentence and its register row to change in the same commit, which is [ADR 031] class B owner work.`
        : `${ADS_REL} answers \`containsAds: true\` and the format scan found NO promotional surface, no armed promotional lever and no cross-app payload across ${dartFiles.length} Dart file(s) and ${payloadKeys} config key(s). An overstated declaration is still an inaccurate one — it puts a "Contains ads" badge on a listing for an app that carries none.`,
    );
  }
  if (typeof decl.promotesOtherApps !== 'boolean') {
    problems.push(`${ADS_REL} \`promotesOtherApps\` is ${JSON.stringify(decl.promotesOtherApps)} and must be a boolean. Same-app promotion matches none of Play's three triggers; cross-app promotion carries the label unless it is a main-menu More-Apps destination. The two answers are not interchangeable.`);
  } else if (decl.promotesOtherApps !== crossAppPresent) {
    problems.push(
      `🔴 ${ADS_REL} answers \`promotesOtherApps: ${decl.promotesOtherApps}\` and the scan derived ${crossAppPresent}. ${
        crossAppPresent
          ? `EVIDENCE: ${[
              ...crossAppKeys.map((l) => `${l.file} ${l.path} is an armed cross-app promotional key`),
              ...crossAppRefs.map((r) => `${r.file} ${r.path} names app "${r.value}" while the host is "${r.hostApp}"`),
              ...surfaces.filter((s) => s.pairs.length).map((s) => `component ${s.name} (${s.pairs.join(', ')})`),
            ].join('; ')}.`
          : 'Nothing in the tree points at another app.'
      } This is the answer with the different declaration consequence, so it is derived separately and must not be inherited from containsAds.`,
    );
  }
  const declaredFormats = Array.isArray(decl.adFormats) ? [...decl.adFormats].map(String).sort() : null;
  if (declaredFormats === null) {
    problems.push(`${ADS_REL} \`adFormats\` is not an array. Use [] for "nothing renders" — Google asks WHICH format renders, and an absent list is a question left blank.`);
  } else if (declaredFormats.join('|') !== derivedFormats.join('|')) {
    problems.push(
      `🔴 ${ADS_REL} declares adFormats [${declaredFormats.join(', ') || '(none)'}] and the scan derived [${derivedFormats.join(', ') || '(none)'}] from the component name(s) ${surfaces.map((s) => s.name).join(', ') || '(none)'}. The format IS the declaration — banner, interstitial, ad wall and widget are separate answers on the form.`,
    );
  }

  // ── 5 · CLAIM 2 — data-safety.json's advertising PURPOSE rows ──────────────
  crossChecksRun++;
  const purposeSpec = decl.crossChecks?.dataSafetyPurpose;
  const purpose = purposeSpec?.purpose;
  if (typeof purpose !== 'string' || purpose.trim() === '') {
    coverageLost([
      `${ADS_REL} crossChecks.dataSafetyPurpose names no \`purpose\`.`,
      'The row count below is taken over that purpose string; with none, the limb counts nothing and reports',
      'the two declarations consistent.',
    ]);
  }
  const vocabPurposes = Array.isArray(ds.vocabulary?.purposes) ? ds.vocabulary.purposes : [];
  if (!vocabPurposes.includes(purpose)) {
    coverageLost([
      `${DS_REL} vocabulary.purposes does not contain ${JSON.stringify(purpose)}, which ${ADS_REL} cross-checks against.`,
      'Either Play renamed the purpose and the vocabulary was re-fetched without this declaration following,',
      'or the vocabulary lost it. Either way the count below would be permanently zero for a reason that has',
      'nothing to do with the app — an absence indistinguishable from a broken reading.',
    ]);
  }
  const dsAnswers = Array.isArray(ds.answers) ? ds.answers : [];
  if (dsAnswers.length === 0) {
    coverageLost([`${DS_REL} declares no \`answers\`.`, 'The advertising-purpose count ranges over them.']);
  }
  const rowsWithPurpose = dsAnswers
    .filter((a) => Array.isArray(a.purposes) && a.purposes.includes(purpose))
    .map((a) => `${a.category}|${a.type}`);
  const expectRows = Number.isInteger(purposeSpec.expectRows) ? purposeSpec.expectRows : null;
  if (expectRows === null) {
    problems.push(`${ADS_REL} crossChecks.dataSafetyPurpose declares no integer \`expectRows\`. The count is the check; without it the limb only reports a number nobody compared to anything.`);
  } else if (rowsWithPurpose.length !== expectRows) {
    problems.push(
      `🔴 ${DS_REL} has ${rowsWithPurpose.length} answer row(s) carrying the purpose ${JSON.stringify(purpose)} (${rowsWithPurpose.join(', ') || 'none'}) and ${ADS_REL} expects ${expectRows}. A data type collected FOR advertising is the Data safety form's half of the same question this declaration answers; they are filled in on different screens months apart and this is the only place they meet.`,
    );
  }
  if (rowsWithPurpose.length > 0 && decl.containsAds === false) {
    problems.push(
      `🔴 ${DS_REL} declares data collected for ${JSON.stringify(purpose)} (${rowsWithPurpose.join(', ')}) and ${ADS_REL} answers \`containsAds: false\`. One of the two declarations to Google is false, and Play reads both.`,
    );
  }
  // 🔴 AND THE ZERO ITSELF MUST BE DECLARED, NOT MERELY TRUE. An undeclared zero
  // is indistinguishable from a row somebody forgot to tick, and it is the
  // measured shape of research/44's defect (3): the advertising purpose sat in
  // the vocabulary, used by nothing, recorded by nobody, for as long as the
  // declaration existed.
  const blockPointer = purposeSpec.blockPointer;
  if (typeof blockPointer !== 'string' || blockPointer.trim() === '') {
    problems.push(
      `${ADS_REL} crossChecks.dataSafetyPurpose names no \`blockPointer\`. Without it, ${DS_REL} can carry the advertising purpose in its vocabulary and use it on no row with nothing in that file saying the zero was deliberate.`,
    );
  } else {
    const block = ds[blockPointer];
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      problems.push(
        `🔴 ${DS_REL} carries no \`${blockPointer}\` block, and ${ADS_REL} requires it. That block is where the advertising-purpose count is DECLARED in the file a person actually reads while filling in the Data safety form — deleting it leaves a zero nobody is accountable for.`,
      );
    } else {
      if (block.purpose !== purpose) {
        problems.push(`🔴 ${DS_REL} ${blockPointer}.purpose is ${JSON.stringify(block.purpose)} and ${ADS_REL} cross-checks ${JSON.stringify(purpose)}. The two are naming different Play purposes, so neither is checking the other.`);
      }
      if (block.declaredOnRows !== rowsWithPurpose.length) {
        problems.push(
          `🔴 ${DS_REL} ${blockPointer}.declaredOnRows says ${JSON.stringify(block.declaredOnRows)} and ${rowsWithPurpose.length} answer row(s) actually carry ${JSON.stringify(purpose)} (${rowsWithPurpose.join(', ') || 'none'}). The declared count and the real one are the whole point of the block.`,
        );
      }
    }
  }

  // ── 6 · CLAIM 3 — content-rating.json's `contains-ads` ─────────────────────
  crossChecksRun++;
  const crSpec = decl.crossChecks?.contentRatingClaim;
  const claimId = crSpec?.claimId;
  if (typeof claimId !== 'string' || claimId.trim() === '') {
    coverageLost([
      `${ADS_REL} crossChecks.contentRatingClaim names no \`claimId\`.`,
      'Without it there is no row to compare, and the IARC advertising answer goes unchecked while looking',
      'checked.',
    ]);
  }
  const crClaims = Array.isArray(cr.claims) ? cr.claims : [];
  const crClaim = crClaims.find((c) => c && c.id === claimId);
  if (!crClaim) {
    coverageLost([
      `${CR_REL} carries no claim with id ${JSON.stringify(claimId)}, which ${ADS_REL} cross-checks against.`,
      'The IARC questionnaire\'s advertising answer either moved or was deleted. A cross-check whose',
      'right-hand side is gone passes forever.',
    ]);
  }
  if (typeof crClaim.answer !== 'boolean') {
    problems.push(`${CR_REL} claim "${claimId}" has no boolean \`answer\` for this cross-check to compare.`);
  } else if (typeof decl.containsAds === 'boolean' && crClaim.answer !== decl.containsAds) {
    problems.push(
      `🔴 ${CR_REL} claim "${claimId}" answers ${crClaim.answer} and ${ADS_REL} answers \`containsAds: ${decl.containsAds}\`. These are the same sentence sworn to two authorities — IARC and Play — and they now disagree. The IARC claim derives from \`dependency-tells\`, which cannot see a house ad; when they disagree it is nearly always because a surface landed with no SDK behind it.`,
    );
  }
  // The claim must SAY that its package tells are not the whole answer. Without
  // the pointer a reviewer reads eight Dart packages and one permission and
  // concludes the question is covered — which is precisely how the blindness
  // survived from the day the questionnaire record was written.
  const pointerField = crSpec.pointerField;
  if (typeof pointerField !== 'string' || pointerField.trim() === '') {
    problems.push(`${ADS_REL} crossChecks.contentRatingClaim names no \`pointerField\`, so nothing requires the IARC claim to disclose that its derivation cannot see a house ad.`);
  } else {
    const pointer = crClaim[pointerField];
    if (!pointer || typeof pointer !== 'object' || typeof pointer.file !== 'string') {
      problems.push(
        `🔴 ${CR_REL} claim "${claimId}" carries no \`${pointerField}.file\`. Its derivation is "${crClaim.derivation}" — package tells — and Google's house-ad trigger needs no package, so the claim must point at the format-keyed declaration that owns the other half. A claim that reads as self-sufficient while being blind to the actual question is worse than one that admits what it does not cover.`,
      );
    } else if (pointer.file !== ADS_REL) {
      problems.push(`🔴 ${CR_REL} claim "${claimId}" ${pointerField}.file points at ${pointer.file} and this declaration is ${ADS_REL}. The pointer names a file that is not the format-keyed half, so the cross-reference resolves somewhere nobody is checking.`);
    } else if (!exists(pointer.file)) {
      problems.push(`🔴 ${CR_REL} claim "${claimId}" ${pointerField}.file names ${pointer.file}, which does not exist.`);
    }
  }

  // ── 7 · CLAIM 4 — the published advertising sentence, pinned three ways ────
  crossChecksRun++;
  const pp = decl.crossChecks?.policyPage;
  const registerRel = pp?.register;
  const pageName = pp?.page;
  const sentence = pp?.claim;
  if (typeof registerRel !== 'string' || typeof pageName !== 'string' || typeof sentence !== 'string' || sentence.trim() === '') {
    coverageLost([
      `${ADS_REL} crossChecks.policyPage is missing its \`register\`, \`page\` or \`claim\`.`,
      'That triple IS the pin: the exact published sentence, the register row that enforces it, and the page',
      'that emphasises it. Any one missing and the strongest advertising claim this business makes — the one',
      'a user actually reads — is checked by nobody.',
    ]);
  }
  const claimsReg = parseJson(registerRel, [
    'It is the published-claims register. Absent, the advertising sentence has no row, and the relationship',
    'this limb checks does not exist to check.',
  ]);
  const declaredPages = Array.isArray(claimsReg.pages) ? claimsReg.pages : [];
  if (!declaredPages.includes(pageName)) {
    coverageLost([
      `${registerRel} \`pages\` does not include ${JSON.stringify(pageName)}, which ${ADS_REL} pins its advertising sentence to.`,
      'The page left the register\'s domain, so assert-policy-claims.mjs no longer extracts its spans and this',
      'limb would be comparing against a document nothing else reads.',
    ]);
  }
  const siteRoot = typeof claimsReg.siteRoot === 'string' ? claimsReg.siteRoot : null;
  if (!siteRoot) {
    coverageLost([`${registerRel} declares no \`siteRoot\`.`, 'The page path is resolved through it so this declaration does not carry a second copy of where the site lives.']);
  }
  const pageRel = `${siteRoot}/${pageName}`;
  const pageHtml = read(pageRel);
  if (pageHtml === null) {
    coverageLost([`${pageRel} does not exist.`, 'It is the published page carrying the advertising sentence this declaration is pinned to.']);
  }
  const wantedSentence = normaliseForMatch(sentence);
  const rows = Array.isArray(claimsReg.claims) ? claimsReg.claims : [];
  if (rows.length === 0) {
    coverageLost([`${registerRel} declares no \`claims\` rows.`, 'The register half of the pin ranges over nothing.']);
  }
  const row = rows.find((r) => r && r.page === pageName && normaliseForMatch(String(r.claim ?? '')) === wantedSentence);
  if (!row) {
    problems.push(
      `🔴 ${registerRel} has NO row on ${pageName} for the sentence ${ADS_REL} swears to: ${JSON.stringify(sentence)}. Either the published sentence was reworded — in which case this declaration must be re-derived in the same commit, because its final limb is a claim about FORMAT that only holds while the format scan finds nothing — or the row was deleted and the strongest advertising claim on the site is now enforced by nothing.`,
    );
  } else {
    if (row.assert?.kind !== 'absent') {
      problems.push(
        `${registerRel}'s advertising row is type ${JSON.stringify(row.type ?? null)} with assert.kind ${JSON.stringify(row.assert?.kind ?? null)}; this declaration rests on it being an \`absent\` assertion (an ad-SDK walk). A descriptive row proves only that somebody wrote the sentence down.`,
      );
    }
    if (typeof row.assert?.pattern !== 'string' || row.assert.pattern.trim() === '') {
      problems.push(`${registerRel}'s advertising row carries an empty \`assert.pattern\`, so its SDK walk matches nothing and can never fire.`);
    }
  }
  const spans = emphasisedSpans(pageHtml);
  if (spans.length === 0) {
    coverageLost([
      `${pageRel} yielded ZERO emphasised spans.`,
      'Either the page lost its <b>/<strong> markup in a rewrite or the extractor stopped matching. The pin',
      'below would then fail for the wrong reason, or — worse — a future edit of this limb would "fix" it by',
      'comparing against nothing.',
    ]);
  }
  const onPage = spans.some((s) => s.text === wantedSentence);
  if (!onPage) {
    problems.push(
      `🔴 ${pageRel} no longer emphasises the sentence ${ADS_REL} swears to: ${JSON.stringify(sentence)}. The published advertising promise and this declaration have come apart. Publishing legal copy is [ADR 031] class B owner work, so the repair is an owner signature, not an edit — but the two must move together.`,
    );
  }
  if (pp.assertsAbsence === true && adsPresent) {
    problems.push(
      `🔴 ${pageRel} publishes ${JSON.stringify(sentence)} and the format scan found a promotional surface: ${evidence()}. The sentence is now FALSE as published. This is the owner gate on the whole cross-promotion programme — the sentence must be reworded to distinguish first-party promotion of our own apps from third-party ad networks, its ${registerRel} row edited in the same commit, and the policy version bumped. No promo surface may ship ahead of it.`,
    );
  } else if (pp.assertsAbsence !== true && pp.assertsAbsence !== false) {
    problems.push(`${ADS_REL} crossChecks.policyPage.assertsAbsence is ${JSON.stringify(pp.assertsAbsence)} and must be a boolean. It is the only semantic claim made about the sentence — everything else about it is string equality — so it cannot be left implicit.`);
  }

  // ── 8 · THE HUMAN-OWNED HALF, PRINTED ──────────────────────────────────────
  const humanOwned = decl.humanOwned ?? {};
  for (const [k, v] of Object.entries(humanOwned)) {
    if (k.startsWith('_')) continue;
    if (typeof v !== 'string' || v.trim() === '') {
      problems.push(`${ADS_REL} humanOwned.${k} carries no description of what the human must actually do.`);
    } else prints.push(`HUMAN-OWNED — ${k}: ${v}`);
  }
  for (const n of Array.isArray(decl.notCovered) ? decl.notCovered : []) prints.push(`NOT COVERED — ${n}`);

  // ── 9 · THE DOMAIN, SAID OUT LOUD ──────────────────────────────────────────
  if (!adsPresent) {
    prints.push(
      `DOMAIN EMPTY, AND THAT IS CURRENTLY TRUE — app "${app}": ${dartFiles.length} Dart file(s) walked under ` +
        `${roots.length} root(s), ${declared.length} declaration(s) parsed of which ` +
        `${declared.filter((d) => d.widgetShaped).length} are widget-shaped, ${anchors.length} anchor ` +
        `symbol(s) found, ${payloadKeys} config key(s) read across ${payloads.length} payload(s), ` +
        `${slugs.length} registered app slug(s). NOT ONE promotional component and NOT ONE armed promotional ` +
        `lever. The answer "no ads" is therefore evidence, not an absence of looking — the anchors above are ` +
        `what make those two distinguishable.`,
    );
  }
  if (slugs.length < 2) {
    prints.push(
      `CROSS-APP VALUE LIMB IS CONSTANT-FALSE TODAY — ${registryRel} registers ${slugs.length} app ("${slugs.join('", "')}"), ` +
        `so "a payload value naming ANOTHER app" has no value it could ever match. It is not evidence for ` +
        `\`promotesOtherApps: false\`; the KEY-shape limb (an advertising token beside \`app\`) is what can fire ` +
        `today, and the value limb becomes load-bearing the day app #2 joins the catalogue.`,
    );
  }
  for (const l of disarmedLevers) {
    prints.push(
      `DISARMED LEVER — ${l.file} ${l.path} = ${l.value}. A promotional key that ships disarmed is a cap ` +
        `arriving before its sender, which is the intended state. Arming it is a promotional touch and makes ` +
        `this declaration re-derivable. ${decl.formatScan?.disarmedLevers?.[l.key] ?? ''}`,
    );
  }
  for (const m of machinery) {
    prints.push(
      `PROMOTIONAL MACHINERY, NO SURFACE — ${m.name} (${m.base}) in ${m.file} carries advertising token(s) ` +
        `${[...m.tokens, ...m.pairs].join(', ')} and is not widget-shaped, so nothing renders. A decision ` +
        `primitive creates no Play declaration consequence on its own; the widget it governs does.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED_COVERAGE, the last direction: did anything get checked at all?
// ─────────────────────────────────────────────────────────────────────────────
if (appsChecked === 0) {
  coverageLost([
    `not one app in the workspace (${apps.join(', ')}) carries a "${CHANNEL}" store metadata tree.`,
    'Every limb is per-app, so zero apps is a clean pass over an empty set — which is the failure this guard',
    'is itself an instance of the repository trying to stop.',
  ]);
}
if (crossChecksRun === 0) {
  coverageLost(['NOT ONE cross-check was run.', 'The four advertising claims were never compared to anything.']);
}

if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (a human owns these; a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

console.log('');
console.log('   ── what this guard CANNOT see (green is not "no app carries advertising") ──');
console.log('   · STORE LISTING ASSETS — a promotional screenshot or feature graphic is a promotional surface');
console.log('     and this scan reads Dart and JSON, not PNGs. Human-owned, printed above.');
console.log('   · A KV CONFIG OVERRIDE — `config:<app>` is written outside the tree; only the payload the');
console.log('     Worker bundles at build time is readable from CI.');
console.log('   · THE COMPILED-IN DART DEFAULT for the promo-notification cap — assert-adapter-capabilities.mjs');
console.log('     owns it end to end, and a redundant assertion is the thing this repository deletes.');
console.log('   · WHETHER GOOGLE HAS CHANGED THE ADS DECLARATION since the fetch date in `sources`.');

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  [research/44 §3 V3] Three sworn advertising claims keyed on package tells, and a fourth that');
  console.error('  did not exist. Google: "If you misrepresent the presence of ads in your app(s), it\'s considered');
  console.error('  a violation of the Google Play policies and may result in your app(s) being suspended."');
  console.error('\nassert-ads-declarations: FAILED');
  process.exitCode = 1;
} else {
  console.log('');
  console.log(
    `ok   ads declarations — ${appsChecked} app(s); ${filesScannedTotal} Dart file(s) walked, ` +
      `${declarationsSeen} declaration(s) parsed (${widgetsSeen} widget-shaped), ` +
      `${anchorsChecked} required-coverage anchor(s) found`,
  );
  console.log(
    `ok   ${crossChecksRun} cross-check(s) agree — the ads declaration, the Data safety advertising purpose, ` +
      'the IARC contains-ads claim and the published advertising sentence all derive from ONE format scan',
  );
  console.log('\nassert-ads-declarations: ok');
}
