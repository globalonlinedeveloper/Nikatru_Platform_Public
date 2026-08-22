#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-discovery-surface.mjs — the generated discovery surfaces cannot drift
// from the registry that produced them.
//
// [pipeline 12]W-9 (regenerate in CI and diff what is SERVED) · the enforcement
// half of [12]W-1 (a landing per registry entry) and [12]W-2a/W-2c (the hub, at
// one named URL — `CANONICAL_HUB_URL`, recorded in
// knowledge/decisions/026-canonical-hub-url.md).
//
// ⚠️ THAT URL IS IMPORTED, NEVER RETYPED. It used to be spelled out here in
// prose and re-composed as `${ORIGIN}apps/` in the print below, and it is now
// one exported constant in tooling/sites/generate-discovery.mjs — the module
// that actually WRITES the page. [10]D-11 limb 3 in assert-catalog-reachable.mjs
// imports the same constant to require a 200 from it, so a hub that moves takes
// both its generator and its reachability probe with it in one edit.
//
// 🔴 WHY A DIFF AND NOT A BUILD STEP. `sites/nikatru` is deployed by Cloudflare's
// own Git integration with NO build step, so the bytes in the repository are the
// bytes a visitor gets. A generator that only ran in CI would emit files nobody
// serves — the `sites/_shared/_site/**` mistake, which made an `apps.json` write
// look consumed for a month. `sites/_shared/_site/**` is therefore explicitly NOT
// a subject of any assertion in this file. What IS asserted is that re-running
// `tooling/sites/generate-discovery.mjs` over the committed registry reproduces
// the committed pages byte-for-byte.
//
// ── THE FOUR-GUARD BOUNDARY, honoured deliberately ───────────────────────────
// Four guards share `apps.json` and `sites/**` and their subjects are DISJOINT,
// because one fault producing three messages is how a fix chases the wrong one:
//   · [10]D-1  assert-channel-claims.mjs   — CLAIM VALIDITY (channels, platforms)
//   · [12]W-9  THIS FILE                   — GENERATED-ARTIFACT DRIFT + rendering
//   · [3]S-7a  assert-catalog-reachable.mjs— CATALOGUE REACHABILITY (does it answer)
//   · [1]F-9   check-site-integrity.mjs    — canonical form, sitemap↔page relation
// In particular this file does NOT re-assert that an indexable page appears in
// the sitemap: check-site-integrity.mjs already owns that relationship, in both
// directions, per deploy root, under its `the sitemap must list exactly the
// indexable pages, by canonical URL` banner. (Anchored, not numbered: this read
// `:477-499` until 2026-08-21 and that section had moved.) What this file owns
// is that the sitemap's /apps/ blocks are the ones the generator would have
// written.
//
// ── NO FLOOR ANYWHERE, ON PURPOSE ────────────────────────────────────────────
// W-9's original acceptance asked for a `REQUIRED_COVERAGE` floor of "at least
// the current surface count". The current surface count was ZERO, and it was
// derived from the guard's own output — a floor computed from what the guard
// currently finds can never notice that the guard stopped finding. Every limb
// below is a SET EQUALITY between two independently-maintained artefacts
// (`sites/_shared/_data/apps.json` and the committed pages) or a NAMED list of
// things that must still be found. Nothing here is a number somebody lowers.
//
// Usage:  node tooling/ci/assert-discovery-surface.mjs [repoRoot]
// Exit 0 = the served surfaces are what the registry says. 1 = drift, or the
// scan lost its coverage.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripInert } from './text-reductions.mjs';
import {
  planDiscovery,
  APPS_DIR,
  CANONICAL_HUB_URL,
  DEPLOY_ROOT,
  NOT_GENERATED,
  RAIL_CONFIG,
  REGISTRY,
} from '../sites/generate-discovery.mjs';
import { isChromePage, CHROME_EXCLUDED, REGIONS, openMarker, closeMarker, isCssRegion } from '../sites/chrome.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const selfDir = dirname(fileURLToPath(import.meta.url));
const SCANNING_OWN_REPO = (selfDir + sep).startsWith(ROOT + sep);

const problems = [];
const prints = [];
const abs = (rel) => join(ROOT, ...rel.split('/'));

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`    ${l}`);
  process.exit(1);
}

/** A bracketed slot of ANY shape. Deliberately NOT the `\[[A-Z…]*\]` form the
 *  stage document proposed: measured against the file it was written about,
 *  that pattern misses `[0 or price]` (starts with a digit), `[Feature 1]` and
 *  `[SNAP OR dl.nikatru.com APPIMAGE URL]` (lower-case inside) — three of the
 *  live tokens in `_template.html`. A scan for the literal word `PLACEHOLDER`
 *  returns ZERO on that same file; do not rebuild that bug either. This is the
 *  same shape `assert-channel-claims.mjs`'s `bracketed slot` cue already uses,
 *  so the repository has one answer to "is this a slot" and not two. */
const SLOT = /\[[^\]\n]{1,160}\]/g;

/** The ping mechanism [12]W-3b owes. Named here so the "is it wired?" print
 *  below cannot drift from the file it is about. */
const PING_SCRIPT = 'tooling/sites/indexnow-ping.mjs';

/** THE CANARY. The placeholder scanner is proven against known-dirty input
 *  before it is trusted, the way assert-no-price-literals.mjs proves its matcher:
 *  a scanner that has quietly stopped matching reports every generated page
 *  clean, which is indistinguishable from a clean tree. These five tokens are
 *  live in `sites/nikatru/apps/_template.html` today. NAMED, not counted — a
 *  count is a number somebody lowers, and a name says which one went. */
const REQUIRED_TEMPLATE_TOKENS = [
  '[APP NAME]',
  '[SLUG]',
  '[WEB APP URL]',
  '[0 or price]',
  '[SNAP OR dl.nikatru.com APPIMAGE URL]',
];

/** THE PACK-WALK CANARY, and the second one in this file for the same reason.
 *  [12]W-5, W-6 and W-8 all defer on ONE measurement — "does a registry app own
 *  a committed content pack?" — and the failure that measurement can hide is not
 *  a wrong answer, it is a WALK THAT STOPPED REACHING. A walk that finds nothing
 *  reports `0 owned by a registry slug`, which is byte-identical to the correct
 *  answer today, so all three requirements would read DEFERRED forever on
 *  evidence nobody gathered. `lingo` is a real committed pack, not a fixture:
 *  tooling/content_pipeline/examples/lingo-phrases/recipe.json calls itself
 *  "REAL INPUT rather than a fixture" and assert-pack-roundtrip.mjs rebuilds
 *  packages/core/test/fixtures/pack/v1/ from it on every push. NAMED rather than
 *  counted, for REQUIRED_TEMPLATE_TOKENS' reason: a count is a number somebody
 *  lowers, and a name says which one went. */
const REQUIRED_PACK_IDS = ['lingo'];

/** THE PRICE CANARY, and the third in this file for the third time the same
 *  reason applies. Limb G below compares the price on a generated landing to the
 *  price in `RAIL_CONFIG`, and the failure it CANNOT see by itself is a landing
 *  that stopped carrying a price at all: an app with no offerings compares
 *  nothing and reports the same `ok` line as an app whose prices match. That is
 *  the state every landing was in before this existed, and it looked clean.
 *
 *  NAMED, not counted, and not derived from what the guard currently finds. If a
 *  landing here was deliberately unpriced — the app taken off `live`, its
 *  offerings removed from the rail config — say so by editing this list in the
 *  same commit, naming what remains. */
const REQUIRED_PRICED_LANDINGS = ['subly'];

// ── the plan ─────────────────────────────────────────────────────────────────
const { files, registry, live, problems: registryProblems, chromeOnly } = planDiscovery(ROOT);
for (const p of registryProblems) problems.push(p);

if (files.size === 0) {
  // 🔴 THE REASON IS CARRIED INTO THE MESSAGE, and that was found by this
  // limb's own test rather than reasoned: an unparseable apps.json plans zero
  // files, and the first version reported only "my scan reached nothing" while
  // the parse error — the actual cause, already computed — was dropped. A
  // coverage complaint that does not say WHY the domain emptied sends the fix
  // to the wrong file.
  coverageLost([
    `the generator planned ZERO files from ${REGISTRY}, so every comparison below ranged over nothing.`,
    ...registryProblems.map((p) => `reason: ${p}`),
    'Emitting nothing must never be a pass: a guard that compares an empty plan to an empty tree prints',
    'ok forever while the studio has no discovery surface at all.',
  ]);
}

// ── A · DRIFT: the committed bytes are the bytes the generator writes ────────
// The load-bearing limb. A hand edit to a generated landing, a deleted <url>
// block, a registry change nobody regenerated for — all three land here, each
// naming its own file so the fix goes to the right place.
let compared = 0;
for (const [rel, expected] of files) {
  const path = abs(rel);
  if (!existsSync(path)) {
    problems.push(
      `${rel} is MISSING. ${REGISTRY} says it should exist, and Cloudflare serves this tree with no build ` +
        'step — so a surface that is not committed is a surface nobody can reach. Run ' +
        '`node tooling/sites/generate-discovery.mjs` and commit the result.',
    );
    continue;
  }
  compared++;
  const actual = readFileSync(path, 'utf8');
  if (actual !== expected) {
    problems.push(
      `${rel} DRIFTED from what tooling/sites/generate-discovery.mjs writes for the current ${REGISTRY}. ` +
        'These files are generated and committed, never hand-edited: an edit here is served until the next ' +
        'regeneration silently reverts it. Change the registry or the generator, then re-run ' +
        '`node tooling/sites/generate-discovery.mjs` and commit.',
    );
  }
}
// ⚠️ THERE IS DELIBERATELY NO `compared === 0` COVERAGE CHECK HERE, though the
// symmetry with every other limb is tempting and one was written first. It
// CANNOT FAIL: `files.size === 0` already exited above, so `compared === 0`
// means every planned file was missing — and each of those pushed its own
// MISSING problem on the way past. An assertion with no writable failing input
// inflates apparent coverage, which is worse than not having it.

// ── B · COVERAGE AS A RELATIONSHIP, BOTH DIRECTIONS ─────────────────────────
// The diff above cannot see a file the plan has never heard of. This can: the
// .html set under sites/nikatru/apps/, minus the one non-generated file, must
// EQUAL the planned set. An entry with no landing fails above; a landing with no
// entry fails here. No number on either side.
const appsDirAbs = abs(APPS_DIR);
if (!existsSync(appsDirAbs) || !statSync(appsDirAbs).isDirectory()) {
  coverageLost([
    `${APPS_DIR} does not exist, so the landing-set relationship compared nothing.`,
    `Every registry entry owes a page there, and ${DEPLOY_ROOT} is classified app-facing by`,
    'check-site-integrity.mjs BECAUSE that directory exists — losing it loses two guards at once.',
  ]);
}
const onDisk = new Set(
  listDir(appsDirAbs)
    .filter((f) => f.toLowerCase().endsWith('.html'))
    .filter((f) => f !== NOT_GENERATED),
);
// 🔴 `chromeOnly` IS SUBTRACTED HERE, and leaving it in was a real regression
// caught by the deleted-registry-entry test. A landing whose entry is removed
// still sits on disk, still carries the sentinels the generator gave it, and is
// therefore still spliced into `files` — so without this filter it re-entered
// `planned` and this limb stopped being able to see an orphaned landing at all.
const planned = new Set(
  [...files.keys()]
    .filter((r) => r.startsWith(`${APPS_DIR}/`) && !chromeOnly.has(r))
    .map((r) => r.split('/').pop()),
);
for (const f of onDisk) {
  if (!planned.has(f)) {
    problems.push(
      `${APPS_DIR}/${f} is a page this generator would never write, and it is not the one non-generated ` +
        `file (${NOT_GENERATED}). It sits inside the Cloudflare deploy root, so it is SERVED — either it ` +
        `belongs to a registry entry that was deleted from ${REGISTRY}, or it was hand-added. Add the entry ` +
        'or delete the page.',
    );
  }
}
// The other direction — a registry entry with no page — is limb A's MISSING
// message, and it is NOT restated here. A second loop over `planned \ onDisk`
// was written first and deleted: it could only ever produce a message limb A
// had already produced for the same file, which is the two-guards-on-one-fault
// shape a directory away from four guards that already share this tree.

// ── C · NO PLACEHOLDER SLOT SURVIVES INTO A GENERATED PAGE ──────────────────
// `_template.html` is the ONE allowlisted file, and it is allowlisted by NAME
// rather than by luck: it is served in production right now
// (`nikatru.com/apps/_template` resolves), and any guard walking this directory
// that does not classify it explicitly reads it as either drift or a legitimate
// landing — both readings are wrong.
//
// 🔴 LIMBS C AND D READ THE BYTES ON DISK, not the bytes the generator would
// write. That is deliberate and it is this guard's stated posture — the sites
// are served straight from the repository, so what is COMMITTED is what a
// visitor and a crawler get. Reading the plan instead would make both limbs
// assertions about the generator alone: a fabricated rating pasted into a
// committed landing would produce only a DRIFT message, and the reader would
// have to open the file to learn WHY the drift matters. (The planned bytes are
// the fallback when the file is missing, which limb A has already reported.)
// 🔴 `chromeOnly` PAGES ARE EXCLUDED FROM `served`, AND THE REASON IS THE WHOLE
// DISTINCTION THIS GUARD RESTS ON. Limbs C and D below assert properties of a
// page THIS GENERATOR AUTHORED — no unfilled bracketed slot survived into it, and
// it carries the JSON-LD block the generator writes on every page it emits. A
// hand-maintained document that merely receives the shared footer owes neither.
// Grading the spliced pages against them produced twelve findings about pages
// that were entirely correct: `index.html`'s `[type="email"]` and its keyword
// array read as "unfilled slots", and seven legal/utility pages were faulted for
// having no JSON-LD they were never supposed to have.
//
// The BYTE-DIFF in limb A still covers every spliced page in full — that is the
// limb that catches a hand-edited footer, and it is not narrowed here.
const served = new Map(
  [...files.keys()]
    .filter((rel) => rel.endsWith('.html'))
    .filter((rel) => !chromeOnly.has(rel))
    .map((rel) => [rel, existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf8') : files.get(rel)]),
);

let slotsScanned = 0;
for (const [rel, expected] of served) {
  slotsScanned++;
  const hits = [...expected.matchAll(SLOT)].map((m) => m[0]);
  if (hits.length) {
    problems.push(
      `${rel} carries ${hits.length} unfilled slot(s): ${[...new Set(hits)].slice(0, 5).join(' ')}. A generated ` +
        'page ships a bracketed slot only when the generator has nothing to put there, and a visitor reads ' +
        'the brackets.',
    );
  }
}
// ⚠️ NO `slotsScanned === 0` COVERAGE CHECK, and one was written before it was
// traced: `files` always carries the hub page once the registry parses, and an
// unparseable/empty registry already exited above with its reason. So the
// condition cannot be reached, and an assertion that cannot fail inflates
// apparent coverage. What CAN go quiet here is the MATCHER, and that is what
// the canary below exists for — a real check with a real failing input.

const templateAbs = join(appsDirAbs, NOT_GENERATED);
if (!existsSync(templateAbs)) {
  if (SCANNING_OWN_REPO) {
    coverageLost([
      `${APPS_DIR}/${NOT_GENERATED} is gone, and it is this guard's placeholder CANARY.`,
      'Without it nothing proves the slot scanner still matches, so limb C would report every generated',
      'page clean whether or not it can still see a slot. It is also the one file in a generated directory',
      'that is deliberately NOT generated; if it was retired on purpose, retire this canary in the same',
      'change and say what replaced it.',
    ]);
  }
} else {
  const templateText = readFileSync(templateAbs, 'utf8');
  const found = new Set([...templateText.matchAll(SLOT)].map((m) => m[0]));
  const lostTokens = REQUIRED_TEMPLATE_TOKENS.filter((t) => !found.has(t));
  if (lostTokens.length) {
    coverageLost([
      `the slot scanner no longer finds ${lostTokens.length} of its ${REQUIRED_TEMPLATE_TOKENS.length} canary token(s) in ${APPS_DIR}/${NOT_GENERATED}: ${lostTokens.join(', ')}.`,
      'Either the scanner stopped matching — in which case limb C above is reporting every generated page',
      'clean for the wrong reason — or the template was edited. If the edit is deliberate, update',
      'REQUIRED_TEMPLATE_TOKENS in this file in the same commit, naming the tokens that remain.',
    ]);
  }
  if (!/<meta[^>]+name\s*=\s*["']robots["'][^>]*noindex/i.test(templateText)) {
    problems.push(
      `${APPS_DIR}/${NOT_GENERATED} has lost its \`noindex\`. That directory is inside the Cloudflare deploy ` +
        'root, so the template is SERVED — `nikatru.com/apps/_template` returns a page full of unfilled ' +
        'slots. Its own noindex is what keeps it out of the sitemap and out of the index, and it is what ' +
        'exempts it from check-site-integrity.mjs\'s canonical limb.',
    );
  }
}

// ── D · THE STRUCTURED DATA IS HONEST ───────────────────────────────────────
// Validated against what it CLAIMS, not "has JSON-LD".
//
// 🔴 `aggregateRating` present ⇒ FAIL, unconditionally. No app has ratings, and
// a synthesised one is the fastest route to a structured-data manual action on
// `nikatru.com` — the same host that serves the privacy/terms/refund/
// delete-account pages both app stores require to resolve. That is a takedown
// risk on the store-compliance surface, not a ranking risk.
let ldChecked = 0;
for (const [rel, expected] of served) {
  const block = expected.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/);
  if (!block) {
    problems.push(`${rel} carries no JSON-LD block, and this generator writes one on every page it emits.`);
    continue;
  }
  let ld;
  try {
    ld = JSON.parse(block[1].replace(/\\u003c/g, '<'));
  } catch (e) {
    problems.push(`${rel} has a JSON-LD block that does not parse — ${e.message}. Invalid structured data is worse than none.`);
    continue;
  }
  ldChecked++;
  if (typeof ld.name !== 'string' || ld.name.trim() === '') {
    problems.push(`${rel} JSON-LD has no non-empty \`name\`, which is the one field every schema.org type here requires.`);
  }
  if ('aggregateRating' in ld || 'review' in ld) {
    problems.push(
      `${rel} JSON-LD carries \`aggregateRating\`/\`review\`. No NIKATRU app has real ratings, so this can ` +
        'only have been synthesised — and a fabricated rating on the host that also serves the ' +
        'store-required legal pages risks a manual action against those pages too.',
    );
  }
  const canonical = expected.match(/<link rel="canonical" href="([^"]+)">/);
  if (canonical && ld.url !== canonical[1]) {
    problems.push(
      `${rel} declares canonical ${canonical[1]} and its JSON-LD \`url\` is ${JSON.stringify(ld.url)}. Two ` +
        'self-references that disagree is one page telling a crawler two different addresses.',
    );
  }
  if ('offers' in ld) {
    problems.push(
      `${rel} JSON-LD carries an \`offers\` block. No price may be written here: [OWNER_QUEUE D-1] locks ` +
        '$4.99/month and $19.99/year while the JSON-LD block of apps/_template.html says priceCurrency ' +
        'INR, and which ' +
        'currency the checkout actually charges is UNVERIFIED from this repository. ' +
        'assert-no-price-literals.mjs bans a price literal in shipping source for the same reason.',
    );
  }
}
// ⚠️ NO `ldChecked === 0` COVERAGE CHECK either, for the same traced reason and
// a sharper one: the only way this limb ranges over nothing is for EVERY page to
// have no JSON-LD block or an unparseable one — and each of those pushes its own
// problem above, naming the page. A COVERAGE-LOST exit here would fire FIRST and
// swallow those messages, which is precisely the defect the registry limb's own
// test caught at the top of this file. The per-page complaint IS the coverage
// signal, and it says which page.

// ── G · THE PRICE ON THE PAGE IS THE PRICE IN THE RAIL CONFIG ───────────────
// Limb A already fails a landing whose bytes differ from a fresh run, so this
// limb is not a second drift check and must not read as one. What it owns is the
// half limb A structurally cannot see: limb A compares the page to the
// GENERATOR, and a generator that stopped emitting prices agrees with a page
// that carries none. Both would be byte-identical and both would be wrong.
//
// So this reads the rail config INDEPENDENTLY and asserts the relationship the
// generator claims to implement — every offering `services/platform/src/
// app-config-data.json` declares for a live app appears on that app's SERVED
// landing, by product id AND by rendered amount. The bytes on disk are the
// subject, for limbs C and D's stated reason: Cloudflare serves this tree
// directly, so what is committed is what a buyer is quoted.
//
// 🔴 A PRICE IS THE ONE THING ON THESE PAGES A STRANGER IS ASKED TO ACT ON.
// [5]M-11 puts prices in the rail config precisely so the app cannot quote one
// number while the checkout charges another; a marketing page that quotes a
// third is the same defect with a payment processor's seller verification
// reading it.
//
// 🔴🔴 THIS LIMB PARSES `RAIL_CONFIG` ITSELF AND DOES ITS OWN ARITHMETIC, AND
// THE FIRST VERSION DID NOT — it imported the generator's `commerceFor()` to
// compute the expected amount, which made it an assertion about the generator
// agreeing with itself. MEASURED, not reasoned: `money()` was mutated to render
// every price one dollar too high, the surfaces were regenerated, and this limb
// printed `ok — 2 rendered price(s) equal what the config declares` over a page
// quoting $5.99 against a config saying 499. Both sides had been computed by the
// mutant. That is the recorded assert-seams-wired.mjs shape — a check aimed at
// its subject's own declaration — and the ONLY thing that removes it is deriving
// the expected value here, from the file, with arithmetic written here. Only the
// PATH is imported, for CANONICAL_HUB_URL's reason: a file that moves must take
// its readers with it in one edit.
let offeringsCompared = 0;
{
  const railPath = abs(RAIL_CONFIG);
  let rail = null;
  if (existsSync(railPath)) {
    try {
      rail = JSON.parse(readFileSync(railPath, 'utf8'));
    } catch {
      rail = null; // an unparseable config is planDiscovery's complaint, pushed above
    }
  }
  const landingsCompared = new Set();

  /** `amount_minor` as the page must render its digits. Written HERE on purpose:
   *  the point of this limb is that two artefacts agree, and two artefacts that
   *  share a formatter are one artefact. The SYMBOL is not asserted — a currency
   *  glyph is presentation, and the number is the claim. */
  const digits = (minor) => (minor / 100).toFixed(2);

  for (const app of registry) {
    if (!app || typeof app.slug !== 'string' || app.status !== 'live') continue;
    const rel = `${APPS_DIR}/${app.slug}.html`;
    const html = served.get(rel);
    if (html === undefined) continue; // limb A reported it MISSING, naming the file
    const declared = rail?.apps?.[app.slug]?.paywall?.offerings;
    for (const o of Array.isArray(declared) ? declared : []) {
      if (typeof o?.product_id !== 'string' || !o.product_id || !Number.isInteger(o.amount_minor)) {
        // A malformed offering is the GENERATOR's complaint (it refuses to price
        // it and says so). Skipping it here keeps one fault to one message.
        continue;
      }
      offeringsCompared++;
      // 🔴 RECORDED BEFORE THE COMPARISONS, NOT AFTER THEM, AND THAT ORDERING IS
      // A FIXED BUG. It was `pricedLandings.add()` at the FOOT of this loop, so a
      // landing whose price merely DISAGREED with the config never got added —
      // and `coverageLost()` calls `process.exit(1)` immediately, before the
      // `problems` report. Measured: the wrong-price mutation below printed only
      // "COVERAGE LOST — subly carries no priced offering", swallowing the exact
      // message ("carries data-offering=pro_monthly but not the amount 4.99")
      // that says what to fix. The canary's question is "is this limb comparing
      // anything at all?", never "does it agree?" — agreement is what `problems`
      // is for, and the two must not be able to shadow each other.
      landingsCompared.add(app.slug);
      const marker = `data-offering="${o.product_id}"`;
      if (!html.includes(marker)) {
        problems.push(
          `${rel} does not carry ${marker}, and ${RAIL_CONFIG} declares that offering for a LIVE app. The ` +
            'landing is the page nikatru.com/<app> resolves to — a released app whose own page is silent about ' +
            'what it costs sends the reader to look for the number somewhere else, which is where a wrong one ' +
            'gets typed.',
        );
        continue;
      }
      if (!html.includes(digits(o.amount_minor))) {
        problems.push(
          `${rel} carries ${marker} but not the amount ${digits(o.amount_minor)} that ${RAIL_CONFIG} declares for it (amount_minor ${o.amount_minor}). A page ` +
            'quoting a price the rail does not charge is the exact failure [5]M-11 puts prices in the config to ' +
            'prevent, one surface further out — and this one is read by buyers and by a merchant of record.',
        );
        continue;
      }
    }
  }

  if (SCANNING_OWN_REPO) {
    const unpriced = REQUIRED_PRICED_LANDINGS.filter((slug) => !landingsCompared.has(slug));
    if (unpriced.length) {
      coverageLost([
        `${unpriced.length} of ${REQUIRED_PRICED_LANDINGS.length} canary landing(s) carry no priced offering at all: ${unpriced.join(', ')}.`,
        'This limb compares prices, so a landing with NO price compares nothing and reports exactly what a',
        'correct one reports — the state every generated landing was in before it existed. Either the',
        `generator stopped emitting the pricing block, or the app's offerings left ${RAIL_CONFIG}, or the entry`,
        'is no longer `live`. If one of those was deliberate, update REQUIRED_PRICED_LANDINGS in this file in',
        'the same commit, naming the landings that remain priced.',
      ]);
    }
  }
}

// ── E · THE OWNER-RESERVED AND DEFERRED GAPS, PRINTED EVERY RUN ─────────────
// Printed and never failed, for [pipeline C-6]'s reason: each resolution is
// either an owner decision or a requirement whose trigger has not fired, and a
// guard that fails the build on those gets switched off. Printed EVERY run so
// none of them can become permanent by being invisible.

// (i) [12]W-2's homepage half — the D-12 decision, deliberately NOT taken here.
{
  const indexPath = abs(`${DEPLOY_ROOT}/index.html`);
  if (existsSync(indexPath)) {
    const raw = readFileSync(indexPath, 'utf8');
    const linksHub = /href\s*=\s*["']\/apps\/["']/.test(raw);
    if (!linksHub) {
      prints.push(
        `UNLINKED HUB (owner decision, [12]D-12): ${CANONICAL_HUB_URL} is generated, indexable and in the sitemap, ` +
          `and ${DEPLOY_ROOT}/index.html does not link to it. LINKING IT IS THE ANNOUNCEMENT DECISION — the ` +
          'same one check-site-integrity.mjs refuses to take about the homepage APPS array, on the stated ' +
          'grounds that a soft launch is a legitimate state and no decision record answers it. This ' +
          'generator deliberately does not touch that array, so the decision stays open and its PRINT stays ' +
          'firing. Resolve by adding a link (and, if wanted, the APPS entries), or record that the hub is ' +
          'reachable by sitemap and llms.txt alone.',
      );
    }
  }
}

// (ii) [12]W-2b — SHOW-1 wants the showcase on the mirror too, and the reason it
//      is not generated there is MEASURED, not a preference.
{
  const mirrorApps = abs('sites/rajasekarselvam/apps');
  if (!existsSync(mirrorApps)) {
    prints.push(
      'MIRROR NOT GENERATED ([12]W-2b, SHOW-1 wants the entry on both sites): sites/rajasekarselvam ships no ' +
        'apps/ directory and this generator does not create one. The reason is structural, not a preference — ' +
        'check-site-integrity.mjs classifies a deploy root as APP-FACING when it ships an apps/ directory, ' +
        'and an app-facing root immediately owes privacy.html, terms.html, refund.html and ' +
        'delete-account.html, none of which exist there. Creating the directory would turn the sites lane ' +
        'red on four pages of legal copy only the owner writes (OWNER_QUEUE O-3). Decide once: publish those ' +
        'four pages on the mirror, or record that the mirror links to nikatru.com/apps/ instead of ' +
        'duplicating the catalogue.',
    );
  }
}

// (iii) [12]W-2d — nothing in the factory promotes `preview` → `live`, and the
//       subject set for a promoter is empty today. Both halves are measured.
{
  const notLive = registry.filter((a) => a && a.status !== 'live');
  prints.push(
    `NO PROMOTION PATH ([12]W-2d, claimed by no stage — verified across all 14): ` +
      `tooling/bricks/app/hooks/post_gen.dart writes 'status': 'preview' as a CONSTANT on every stamp, and ` +
      'the one "live" row was typed by a human. ' +
      `Measured now: ${notLive.length} non-live registry entr(ies), so a ` +
      'promoter would today have nothing to promote — building one now is a capability with no consumer. It ' +
      'is also the ANNOUNCE act if the owner decides a live entry IS an announcement (the D-12 print above), ' +
      'so it must land with that decision and with assert-catalog-reachable.mjs already green, or "live" ' +
      'means nothing.',
  );
}

// (iv) [12]W-3e — the IndexNow key file. Owner-gated; NOT fabricated here.
//       No free `A-7`/`A-8` id is assumed: OWNER_QUEUE runs A-1…A-6 then A-9,
//       A-10, so the next free id is A-11 and the row is PROPOSED, not written.
//
// 🔴 TWO INDEPENDENT HALVES, MEASURED SEPARATELY, because they are blocked on
// different people and collapsing them hid that. The KEY is owner work. The
// SCRIPT and its WIRING are agent work, and until 2026-08-06 neither existed —
// `grep -rn -i indexnow .github/workflows/` returned zero hits and the clause's
// entire mechanism was a sentence in a stage document, filed under the owner's
// blocker. A clause with no mechanism must not read as "waiting on the owner".
{
  const keys = existsSync(abs(DEPLOY_ROOT))
    ? listDir(abs(DEPLOY_ROOT)).filter((f) => /^[0-9a-f]{8,128}\.txt$/i.test(f))
    : [];
  if (keys.length === 0) {
    prints.push(
      `INDEXNOW KEY ABSENT (owner-gated, [12]W-3e — proposed OWNER_QUEUE A-11): no key file at ${DEPLOY_ROOT}. ` +
        'An IndexNow ping without one is answered 202 — which means "key unverified", not "accepted" — so a ' +
        'keyless host is congratulated forever. The key must be generated by the owner and placed at the ' +
        `deploy root; nothing here fabricates one. ${PING_SCRIPT} already refuses to send without it, and ` +
        'starts working with no code change the day the file lands. Google ignores IndexNow entirely, so the ' +
        'generated sitemap above is what actually reaches Google and this is the cheap half.',
    );
  }

  // Is the mechanism WIRED? Measured against the tracked workflows, not assumed.
  // A script nobody invokes is the `check-selection-record.mjs` shape — present,
  // correct, and enforcing nothing — and the only way that gap stays visible is
  // if something recomputes it on every run.
  if (SCANNING_OWN_REPO) {
    const wfDir = abs('.github/workflows');
    const wf = existsSync(wfDir) ? listDir(wfDir).filter((f) => /\.ya?ml$/i.test(f)) : [];
    if (wf.length === 0) {
      coverageLost([
        '.github/workflows holds no YAML, so "is the IndexNow ping wired?" was measured against nothing.',
        'That question is the whole of [12]W-3b, and an unmeasured answer prints the same as a good one.',
      ]);
    }
    const callers = wf.filter((f) => readFileSync(join(wfDir, f), 'utf8').includes(PING_SCRIPT));
    if (callers.length === 0) {
      prints.push(
        `INDEXNOW PING NOT WIRED ([12]W-3b): ${PING_SCRIPT} exists and is testable, and ${wf.length} tracked ` +
          'workflow(s) invoke it ZERO times — so the "announces itself" half of W-3 is enforced by nothing, ' +
          'exactly as it was when IndexNow appeared nowhere in the repo at all. It needs a path-filtered job ' +
          `on push to main running \`node ${PING_SCRIPT} --root ${DEPLOY_ROOT} --base \${{ github.event.before }} --ping\`, ` +
          'with `fetch-depth: 0` so the base sitemap can be read. This print flips off by itself the run after ' +
          'that job lands.',
      );
    }
  }
}

// ── F · THE DEFERRED STAGE-12 SURFACES, AND WHETHER THEIR TRIGGERS FIRED ────
// [12]W-4, W-5, W-6 and W-8 are deferred behind written triggers. A deferral
// that lives only in prose is one a later session re-litigates from memory, and
// a trigger nobody measures is one nobody notices firing. So each trigger is
// COMPUTED from the tree on every run and printed with its current answer. The
// print flips by itself the day the tree changes; nothing here fails the build,
// because "you shipped a second app" must not turn CI red.
//
// 🔴 THIS LIMB IS NOT GATED ON `SCANNING_OWN_REPO`, AND THE GATE IT LOST IS THE
// WHOLE POINT OF THIS EDIT. It shipped inside `if (SCANNING_OWN_REPO)`, which
// made the `🔔 TRIGGER FIRED` branch UNREACHABLE BY ANY TEST: every fixture root
// lives in a temp directory, so the flag is false there and limb F emitted
// nothing at all. Measured on 2026-08-07 against a fixture carrying TWO LIVE
// registry entries — precisely W-4's stated trigger — the guard printed no W-4
// line whatsoever, and `/TRIGGER FIRED/` did not match its output.
//
// The test that was supposed to cover this ('a second live registry entry FLIPS
// W-4's trigger print') never ran the guard: it called `planDiscovery` and
// asserted `live.length === 2`, which is a property of the GENERATOR, not of the
// print it names. That is the recorded assert-seams-wired.mjs shape — an
// assertion aimed one artifact away from its subject — and it left this file's
// own header claim, "the print flips by itself the day the tree changes",
// entirely unproven. Four requirements were relying on a flip nobody had seen.
//
// Nothing here needs the real repository: `live` comes from the registry, and
// the pack and pubspec walks are `existsSync`-guarded, so a fixture with no
// packages/ tree measures zero packs and prints DEFERRED — which is the honest
// answer for that tree. Only the CANARY below is own-repo-gated, exactly as the
// `_template.html` canary is, because only this repository is known to carry the
// pack it names.
{
  // The shared measurement W-5, W-6 and W-8 all key off: does any committed
  // content pack belong to an app the registry knows about? A pack that no
  // registry entry owns has no landing to funnel to and no app to be shared
  // from. Test fixtures are excluded by path — packages/core/test/fixtures/pack
  // exists to prove the FORMAT, and counting it would report the trigger fired
  // on a file whose whole purpose is to be synthetic.
  //
  // ⚠️ `build` IS PRUNED FOR THE SAME REASON, and it was missing while
  // `walkPubspecs` twenty lines below already had it. Build output is not
  // committed but this walk reads the WORKING TREE, so a developer who has run
  // `flutter build web` measures a different tree than CI does — and a pack
  // copied into build output could fire a trigger that the repository does not
  // actually satisfy. That is the green-in-CI-red-on-a-developer-machine shape
  // tree-walk.mjs exists to prevent, in miniature.
  const packIds = new Set();
  const walkPacks = (dir) => {
    let entries;
    try {
      entries = listDir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'build' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walkPacks(p);
      } else if (e.name === 'manifest.json' || e.name === 'recipe.json') {
        if (p.split(sep).includes('test') || p.split(sep).includes('fixtures')) continue;
        try {
          const id = JSON.parse(readFileSync(p, 'utf8')).pack_id;
          if (typeof id === 'string' && id) packIds.add(id);
        } catch {
          /* schema faults belong to assert-recipe-contract.mjs, not here */
        }
      }
    }
  };
  for (const root of ['packages', 'apps', 'tooling/content_pipeline']) {
    if (existsSync(abs(root))) walkPacks(abs(root));
  }
  const slugs = new Set(registry.map((a) => a?.slug).filter((s) => typeof s === 'string'));
  const ownedPacks = [...packIds].filter((id) => slugs.has(id));

  // THE CANARY for the walk above. Own-repo only: a fixture tree legitimately
  // carries no packs, and demanding one there would make every other test in
  // this file build a content pipeline it does not care about.
  if (SCANNING_OWN_REPO) {
    const lostPacks = REQUIRED_PACK_IDS.filter((id) => !packIds.has(id));
    if (lostPacks.length) {
      coverageLost([
        `the pack walk no longer finds ${lostPacks.length} of its ${REQUIRED_PACK_IDS.length} canary pack id(s): ${lostPacks.join(', ')}.`,
        'That walk is the SOLE evidence behind three deferrals — [12]W-5, W-6 and W-8 all key off "does a',
        'registry app own a committed pack?". A walk that reaches nothing answers `0 owned by a registry',
        'slug`, which is the same string the correct answer prints today, so all three would go on reading',
        'DEFERRED while nothing was actually being measured. If the pack moved or was retired deliberately,',
        'update REQUIRED_PACK_IDS in this file in the same commit, naming what remains.',
      ]);
    }
  }

  // A vendor is DECLARED only when it appears in a dependency block, never when
  // a comment mentions it. `packages/platform_storage/pubspec.yaml:27` names
  // both share_plus and app_links in prose recording [2]C-4's adjudication, and
  // a bare grep reads that as adoption.
  const declares = (vendor) => {
    const hits = [];
    const walkPubspecs = (dir) => {
      let entries;
      try {
        entries = listDir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'build') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walkPubspecs(p);
        else if (e.name === 'pubspec.yaml') {
          const declared = readFileSync(p, 'utf8')
            .split('\n')
            .some((l) => new RegExp(`^\\s{2,}${vendor}\\s*:`).test(l));
          if (declared) hits.push(p);
        }
      }
    };
    for (const root of ['packages', 'apps', 'tooling/bricks']) {
      if (existsSync(abs(root))) walkPubspecs(abs(root));
    }
    return hits.length;
  };

  const triggers = [
    {
      id: 'W-4',
      what: 'an in-app "more apps" surface fed by the same registry',
      trigger: 'a SECOND app is live in the registry',
      fired: live.length >= 2,
      measured: `${live.length} live registry entr(ies) of ${registry.length}`,
      why: 'with one live app the surface renders an empty list — a wired, guarded, green and useless capability, which is exactly the shape [2]C-2/C-6 ban. Note the trigger is doubly gated: nothing in the factory promotes preview → live (post_gen.dart writes "preview" as a constant), so it cannot fire by itself.',
    },
    {
      id: 'W-5',
      what: 'the share loop (G-29), with the per-platform mechanics encoded once',
      trigger: 'the first shareable artifact — i.e. a registry app that owns a content pack',
      fired: ownedPacks.length > 0,
      measured: `${packIds.size} committed pack id(s) [${[...packIds].sort().join(', ') || 'none'}], ${ownedPacks.length} owned by a registry slug; share_plus declared in ${declares('share_plus')} pubspec dependency block(s)`,
      why: 'Subly has no shareable moment — a private subscription list is nothing anyone posts. The loop earns its keep on a content app, where the pack item IS the artifact.',
    },
    {
      id: 'W-6',
      what: 'one portfolio link scheme + the DeepLinkService growth half (G-30)',
      trigger: 'with W-5 — a link scheme with nothing to link to is dead weight',
      fired: ownedPacks.length > 0,
      measured: `app_links declared in ${declares('app_links')} pubspec dependency block(s) (it is already resolved transitively via supabase_flutter, so adopting it is a declaration, not a vendor intake)`,
      why: 'same trigger as W-5, and the same reason.',
    },
    {
      id: 'W-8',
      what: 'the content-pack → static indexable demand surface',
      trigger: 'a published pack owned by a registry app',
      fired: ownedPacks.length > 0,
      measured: `${ownedPacks.length} pack(s) owned by a registry slug (registry slugs: ${[...slugs].sort().join(', ') || 'none'})`,
      why: "the renderer's output must funnel to that app's landing, and there is no app to funnel to. Google's scaled-content-abuse policy describes \"one generic renderer turning a pack into a long-tail page per unit\" closely enough that the per-page value gates must fail the build when it is finally written — and a manual action would attach to nikatru.com, the same host serving the store-required legal pages.",
    },
  ];
  for (const t of triggers) {
    prints.push(
      `${t.fired ? '🔔 TRIGGER FIRED' : 'DEFERRED'} [12]${t.id} — ${t.what}. Trigger: ${t.trigger}. ` +
        `Measured now: ${t.measured}. ${t.fired ? 'The condition this requirement was deferred behind is now TRUE — build it.' : `Not fired: ${t.why}`}`,
    );
  }
}

// ── E · EVERY CHROME PAGE STILL CARRIES ITS SENTINELS ───────────────────────
//
// Limb A byte-compares each spliced page against a fresh splice, so a hand-edited
// footer is already caught there. This limb answers the question limb A cannot:
// does the page still have the MARKERS at all? Delete them and the generator
// throws, which planDiscovery turns into a problem — but "the generator threw" is
// a much worse diagnosis than "this page lost this marker", and a reader hitting
// it at 2am deserves the second one.
//
// The set is DERIVED (isChromePage over the deploy-root walk), so a page added
// tomorrow is in the contract the moment it exists. CHROME_EXCLUDED is the only
// way out and it costs a written reason.
let chromePagesChecked = 0;
{
  const rootAbs = abs(DEPLOY_ROOT);
  const found = [];
  const stack = existsSync(rootAbs) ? [rootAbs] : [];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of listDir(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) { stack.push(f); continue; }
      if (e.name.toLowerCase().endsWith('.html')) {
        found.push(`${DEPLOY_ROOT}/${f.slice(rootAbs.length + 1).split(sep).join('/')}`);
      }
    }
  }

  for (const rel of found.filter(isChromePage)) {
    chromePagesChecked++;
    const html = readFileSync(abs(rel), 'utf8');
    for (const region of REGIONS.keys()) {
      const css = isCssRegion(region);
      for (const [kind, marker] of [['opening', openMarker(region, css)], ['closing', closeMarker(region, css)]]) {
        const n = html.split(marker).length - 1;
        if (n !== 1) {
          problems.push(
            `${rel} carries ${n} ${kind} sentinel(s) for chrome region "${region}", expected exactly 1. ` +
              "The splice replaces one span between one pair; any other count means part of this page's " +
              'chrome is no longer maintained from tooling/sites/chrome.mjs while still being served.',
          );
        }
      }
    }
  }

  // An exemption that outlives its subject is an exemption nobody re-examines.
  //
  // Scoped to entries whose PARENT DIRECTORY exists, and that is not a softening.
  // A tree with no `sites/nikatru/fullshot/` at all is a tree that does not model
  // that area — every generator fixture in the suite is one — and faulting it for
  // an absent exemption subject would be reporting on a page the tree never
  // claimed to have. A missing file INSIDE a directory that does exist is the
  // real case: the page was deleted and the exemption was not.
  for (const rel of CHROME_EXCLUDED.keys()) {
    if (!existsSync(dirname(abs(rel)))) continue;
    if (!found.includes(rel)) {
      problems.push(
        `CHROME_EXCLUDED (tooling/sites/chrome.mjs) names ${rel}, which is not served from ${DEPLOY_ROOT}. ` +
          'Delete the entry, or restore the page — a standing exemption for a file that no longer exists ' +
          'is a hole waiting for a future page to be dropped into it.',
      );
    }
  }

  if (found.length > 0 && chromePagesChecked === 0) {
    coverageLost([
      `${found.length} .html file(s) are served from ${DEPLOY_ROOT} and NONE of them was treated as a chrome page.`,
      'Either isChromePage stopped matching or CHROME_EXCLUDED has swallowed the whole root. Both leave every',
      'page free to grow a footer of its own while this guard reports a clean run.',
    ]);
  }
}

// ── G · THE WEB SURFACE IS ACCESSIBLE, AND SOMETHING FINALLY CHECKS ─────────
//
// 🔴 THE WEB PAGES WERE UNPOLICED FOR ACCESSIBILITY AND THAT FACT WAS INVISIBLE.
// `assert-a11y-coverage.mjs` sounds like it covers this and does not: its own
// scope is Flutter routed screens and modal sheets — measured 2026-08-21, it
// reports 19 reachable surfaces and NONE of them is a web page. So the eleven
// served pages, including the four legal ones a store reviewer opens, had no
// accessibility assertion of any kind.
//
// These five are the CHROME half — the properties that are the same on every page
// and are therefore emitted once by tooling/sites/chrome.mjs. Measured before that
// happened: a skip link on ONE page of eleven, `:focus-visible` on FOUR, and
// `404.html` with no <main> landmark at all.
//
// Deliberately NOT a full WCAG audit. Colour contrast, reading order and form
// labelling are not decidable from a static parse, and a limb that pretended
// otherwise would report a clean run about a page it had barely read. What is
// here is exactly what can be established by reading the file.
let a11yChecked = 0;
let boxChecked = 0;
{
  const rootAbs = abs(DEPLOY_ROOT);
  const found = [];
  const stack = existsSync(rootAbs) ? [rootAbs] : [];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of listDir(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) { stack.push(f); continue; }
      if (e.name.toLowerCase().endsWith('.html')) {
        found.push(`${DEPLOY_ROOT}/${f.slice(rootAbs.length + 1).split(sep).join('/')}`);
      }
    }
  }

  for (const rel of found.filter(isChromePage)) {
    a11yChecked++;
    const html = readFileSync(abs(rel), 'utf8');

    // 🔴 `(?<![-\w:])`, NOT `\b` — 2026-08-22. `\b` is a boundary between any
    // non-word character and `l`, so `\blang` fired on `data-lang="en"` and on
    // `xml:lang="en"`, and a page carrying either while declaring NO `lang` was
    // passed AND counted into the ok line's "page(s) carry lang + …". Measured
    // that day against the real guard, not reasoned: a fixture whose <html>
    // carried only `data-lang="en"` exited 0. The colon is in the class on
    // purpose — `xml:lang` is a real XHTML attribute and it is not the one an
    // HTML5 screen reader reads. Same repair, same day, as the `alt` limb below
    // and the width/height limb further down; all three carried one `\b`.
    if (!/<html[^>]+(?<![-\w:])lang\s*=\s*["'][a-z]{2}/i.test(html)) {
      problems.push(`${rel} has no <html lang="…">. A screen reader with no declared language reads the page in the user's default voice, which mispronounces every word of it.`);
    }

    // `(?![-\w])`, NOT `\b`, for the third time in this limb and the same
    // reason: a custom element name MUST contain a hyphen, and `\b` is a
    // boundary before a hyphen, so `<main-nav>` counted as a <main> element and
    // a page carrying one real <main> plus one such component was failed for
    // having "2 <main> element(s)". Measured 2026-08-22: with `\b`, the fixture
    // in the custom-element case of test/discovery-surface.test.mjs exits 1
    // saying exactly that.
    const mains = (html.match(/<main(?![-\w])/gi) ?? []).length;
    if (mains !== 1) {
      problems.push(
        `${rel} has ${mains} <main> element(s), expected exactly 1. Zero leaves a reader no way to skip the ` +
          'nav that opens every page on this site; more than one makes "the main content" ambiguous.',
      );
    }

    // The skip link is only worth having if its target exists. A link that
    // silently does nothing is worse than none: it reports the problem solved.
    const skip = html.match(/<a[^>]+class\s*=\s*["'][^"']*\bskip-link\b[^"']*["'][^>]*href\s*=\s*["']#([^"']+)["']/i);
    if (!skip) {
      problems.push(`${rel} has no skip link. Every page here opens with the same sticky nav, so without one a keyboard user tabs through all of it before reaching any content (WCAG 2.2 SC 2.4.1).`);
    // 🔴 `\\s`, NOT `\s` — 2026-08-22. This is a TEMPLATE LITERAL, so `\s` is
    // not an escape the parser knows and it collapses to a bare `s`: the
    // pattern this actually built was `ids*=s*["']main["']`, printed from the
    // built RegExp's own `.source` that day. Nothing was ever red, because
    // `s*` also matches zero `s` and every id in this tree is written
    // `id="main"` — but `id = "main"`, which is legal HTML, was reported as a
    // skip link resolving to nothing, and `<div ids="main">` satisfied it.
    } else if (!new RegExp(`id\\s*=\\s*["']${skip[1]}["']`, 'i').test(html)) {
      problems.push(
        `${rel} has a skip link pointing at #${skip[1]} and no element carries that id. It resolves to ` +
          'nothing, which is worse than having no skip link at all — the page looks like it solved the problem.',
      );
    }

    if (!/:focus-visible/.test(html)) {
      problems.push(`${rel} declares no :focus-visible rule. A keyboard user cannot see where they are (WCAG 2.2 SC 2.4.7).`);
    }

    // 🔴 `(?![-\w])`, NOT `\b` — 2026-08-22. `\b` is a boundary between `g` and
    // ANY non-word character, and a custom element name must contain a hyphen,
    // so `<img-comparison-slider first="a" second="b">` — a real published web
    // component — matched, and this limb demanded an `alt` attribute on an
    // element that is not an image. `(?![-\w])` rejects a following hyphen and
    // a following word character both, so `<img src=…>`, `<img/>` and `<img>`
    // still match and `<img-…>`, `<imgx…>` do not. Measured 2026-08-22 by
    // restoring `\b` in a scratchpad copy and running the fixture: EXIT 1 with
    // TWO problems over the one element — "no alt attribute" from here and "no
    // integer width and no integer height attribute" from the box limb below,
    // which carries the identical repair for the identical reason.
    for (const tag of html.match(/<img(?![-\w])[^>]*>/gi) ?? []) {
      // 🔴 `(?<![-\w])`, NOT `\b` — 2026-08-22, the same repair as the
      // width/height limb below. `\balt` fires on `data-alt="…"`, so an <img>
      // with no alt at all passed this limb AND was counted into the ok line's
      // "alt on every <img>" — a compliance sentence printed over a tag that
      // has none.
      if (!/(?<![-\w])alt\s*=/i.test(tag)) {
        problems.push(`${rel} has an <img> with no alt attribute: ${tag.slice(0, 90)}. An absent alt is read aloud as the filename; alt="" is the correct way to say "decorative".`);
      }
    }
  }

  // 🔴 NO COVERAGE EXIT HERE, AND THE ONE THAT STOOD HERE WAS DELETED
  // 2026-08-22. It read `if (found.length > 0 && a11yChecked === 0)` and it
  // could never fire. The chrome limb above computes `found` with a
  // BYTE-IDENTICAL walk of the same DEPLOY_ROOT, filters it with the SAME
  // `found.filter(isChromePage)`, and increments `chromePagesChecked` exactly
  // where this block increments `a11yChecked` — so the two counters are always
  // equal, its own `if (found.length > 0 && chromePagesChecked === 0)` is the
  // same predicate, it runs FIRST, and `coverageLost` calls `process.exit(1)`.
  // Any input that could reach this exit has already ended the process.
  // MEASURED 2026-08-22, both ways: pinning `found.length > 0` here to FALSE
  // left the whole committed suite green at 105 tests / 105 pass / 0 fail,
  // EXIT 0; and a deploy root whose only served page is CHROME_EXCLUDED prints
  // the CHROME limb's line and stops — that tree is the case named "a deploy
  // root where NOTHING is a chrome page" in test/discovery-surface.test.mjs.
  // The accessibility limb is NOT left uncovered by the deletion: it goes empty
  // only when the chrome filter goes empty, and that is refused one block up,
  // loudly, by name. A second copy of a refusal that can never be reached is
  // not a backstop; it is a sentence that makes this limb look guarded twice.

  // ── the box an <img> reserves before its bytes arrive ─────────────────────
  // Added 2026-08-21. The loop above asserts `alt` and NOTHING about size, so a
  // page could ship an image that pushes everything under it down the moment it
  // decodes — the reflow half of the same problem, and the one a visitor on a
  // slow connection actually feels (Core Web Vitals CLS).
  //
  // 🔴 THE MEASUREMENT, AND IT CORRECTS THE NOTE THAT ASKED FOR THIS. Swept
  // 2026-08-21 across all 19 .html under sites/ (16 under this deploy root, 3
  // under the mirror): a raw `<img` regex finds 8 tags, but only 5 of them are
  // SERVED MARKUP — and all 5 already carry both attributes. The other 3 are not
  // elements at all: _template.html:114 is an <img> inside an HTML COMMENT, and
  // sites/nikatru/index.html:502 plus the mirror's project renderer are <img>
  // strings inside <script>. So the gap this closes is ENFORCEMENT, not the
  // tree: nothing asserted it, and the next image would have shipped unsized
  // with every guard green. Under this deploy root the domain is 4 tags across
  // 16 pages, printed on every run below so it cannot quietly become 0.
  //
  // WHY stripInert AND NOT A LOCAL REGEX: it is THE shared HTML reduction
  // (tooling/ci/text-reductions.mjs, and the NOT_A_SCANNER entry that indexes
  // it) — comments and <script>/<style> bodies blanked. Reading a `<script>`
  // body as markup is how the same sweep first counted 8; a string in a program
  // is not an element, and the guard cannot know whether it ever renders or
  // under what CSS.
  //
  // WHY A DIGIT IS REQUIRED, not just the attribute: HTML's width/height on
  // <img> are non-negative INTEGERS in CSS pixels. `width="100%"` parses as a
  // presentational hint the browser discards, so a tag carrying it reserves
  // exactly nothing while looking compliant to a presence-only check.
  //
  // WHAT THIS DOES NOT CATCH, stated because an overclaiming limb is worse than
  // none: (1) whether the declared numbers match the image's real intrinsic
  // size — nothing here opens the file; (1b) `<image src=…>`, the legacy alias
  // an HTML parser coerces to <img>: this limb reads the literal element name
  // and does not follow the coercion, stated here rather than discovered later;
  // (2) an <img> built in JavaScript, e.g.
  // sites/nikatru/index.html:502, whose box is instead pinned by CSS (`.app-icon`
  // is 56x56 with `flex:none` at :110 and `.app-icon img{width:100%;height:100%}`
  // at :111, measured 2026-08-21 — that tag shifts nothing today, which is why
  // excluding it hides no defect); (3) <picture>/<source> and CSS background
  // images; (4) the mirror sites/rajasekarselvam, which this whole file
  // deliberately does not range over.
  //
  // NO FLOOR AND NO COVERAGE EXIT, consistent with this file's header: zero
  // images on a deploy root is a legitimate state — measured 2026-08-21, 14 of
  // the 16 pages here carry no served <img> at all, and only two do
  // (index.html: 1, apps/_template.html: 3) — so a `checked === 0` exit would
  // fire the day the founder photo is removed. The count is PRINTED instead.
  for (const rel of found) {
    // `(?![-\w])`, NOT `\b` — see the accessibility limb above for the
    // measurement; a hyphen is a word boundary, so `\b` swept in every custom
    // element whose name starts with "img" and demanded pixel attributes on it.
    for (const tag of stripInert(readFileSync(abs(rel), 'utf8')).match(/<img(?![-\w])[^>]*>/gi) ?? []) {
      boxChecked++;
      // 🔴 THE WHOLE VALUE, NOT ITS FIRST CHARACTER. The first version of this
      // matched `["']?\d` and passed `width="100%"` — the exact tag the limb
      // exists to catch — because `100%` STARTS with a digit. Caught 2026-08-21
      // by the percentage case in test/discovery-surface.test.mjs, which is why
      // that case is in the suite rather than in this comment.
      //
      // 🔴 AND THE ATTRIBUTE NAME, NOT A SUFFIX OF IT — `(?<![-\w])`, NOT `\b`.
      // Second defect of the same shape, caught 2026-08-21 by review after the
      // value half was fixed: `\b` is a boundary between `-` (non-word) and `w`,
      // so `/\bwidth\s*=\s*"\s*\d+\s*"/` FIRES ON `data-width="440"`. Measured
      // that day against the real guard, not reasoned: a generated tree whose
      // index.html carried `<img src="/x.png" alt="x" data-width="440"
      // data-height="275">` and no real width/height exited 0 AND printed
      // `1 served <img> tag(s) … reserve their box` — the limb did not merely
      // miss the tag, it CERTIFIED it. `data-*` is valid author markup a real
      // page could carry (a lazy-loader stashing intrinsic size for JS), so this
      // was reachable, not exotic. `(?<![-\w])` rejects any preceding `-` or word
      // character, so `data-width` and `x-width` stop being the attribute. Note
      // it changes nothing for `srcwidth`, which `\b` ALREADY rejected (`c` and
      // `w` are both word characters, so there is no boundary between them) —
      // the hole was the HYPHEN, not any prefix. Pinned by the data-* case in
      // test/discovery-surface.test.mjs; re-verified 2026-08-21 that the value
      // half is unchanged by the swap: `100%`, `44px` and `1e3` still false;
      // `width="440"`, bare `width=440` and `width=" 44 "` still true.
      //
      // ⚠️ REWRITTEN 2026-08-22, AND WHAT IT SAID IS KEPT SO THE RETIREMENT IS
      // VISIBLE. It read: "STILL NOT CAUGHT … `width="0" height="0"` passes —
      // 0 is a plain non-negative integer and a zero box reserves nothing. Left
      // as-is because narrowing to `[1-9]\d*` is a behaviour change to a limb
      // whose whole domain is 4 real tags, and no input in this tree reaches
      // it. The alt limb at the top of this file has the identical `\balt\s*=`
      // shape and the identical hole; it is not touched here because it makes
      // no compliance claim in its ok line, which is what made this one worth
      // fixing first."
      //
      // 🔴 THE LAST SENTENCE WAS FALSE ON THE FILE IT DESCRIBED. The ok line
      // DOES make the alt claim — it reads "+ alt on every <img>" — so the alt
      // limb had both the hole and the claim, and so did the `<html lang>`
      // matcher, a third copy of the same `\b`. The alt matcher carries
      // `(?<![-\w])` as of 2026-08-22 and the lang matcher `(?<![-\w:])` — the
      // colon because `xml:lang` is not `lang` either — and each has its own
      // evasion case in the suite.
      //
      // AND THE ZERO BOX IS CAUGHT NOW: the value halves below read `[1-9]\d*`,
      // not `\d+`. The old argument for leaving it was that 4 real tags cannot
      // reach it — but that is the argument for a cheap change, not against
      // one, and `width="0"` was the last input for which this limb's own ok
      // sentence was false. Measured 2026-08-22 before the change, by running
      // this limb's own walk over the tracked .html of this deploy root: the 4
      // served tags are apps/_template.html's three shots at 440x275 and
      // index.html's founder photo at 150x192. None is 0, so the narrowing
      // moves nothing in the tree and only removes an evasion.
      const px = (re) => re.test(tag);
      const missing = [
        px(/(?<![-\w])width\s*=\s*(?:"\s*[1-9]\d*\s*"|'\s*[1-9]\d*\s*'|[1-9]\d*(?=[\s/>]))/i) ? null : 'width',
        px(/(?<![-\w])height\s*=\s*(?:"\s*[1-9]\d*\s*"|'\s*[1-9]\d*\s*'|[1-9]\d*(?=[\s/>]))/i) ? null : 'height',
      ].filter(Boolean);
      if (missing.length) {
        problems.push(
          `${rel} has a served <img> with no integer ${missing.join(' and no integer ')} attribute: ` +
            `${tag.replace(/\s+/g, ' ').slice(0, 110)}. Until the bytes arrive the browser reserves no box for ` +
            'it, so every element below jumps when it decodes. Both attributes must be plain pixel integers — ' +
            'a percentage is discarded and reserves nothing, and a `data-` prefixed copy is not the attribute ' +
            'the browser reads.',
        );
      }
    }
  }
}

// ── H · THE og:image BLOCK IS COMPLETE, AND ITS NUMBERS ARE THE FILE'S ──────
// Added 2026-08-21 with the generator change that emits the block.
//
// THE DEFECT: every generated landing carried `og:image` and nothing else,
// while the two HAND-WRITTEN homepages carried all four properties
// (sites/nikatru/index.html:15-18, sites/rajasekarselvam/index.html:17-20) — so
// the short pages were exactly the generated ones. LATENT, NOT LIVE: no link was
// broken and nothing rendered wrongly; what was missing is the box a scraper
// reserves for a card it will not fetch, and the alternative text a reader who
// cannot see the card is given.
//
// 🔴 WHY THIS LIMB EXISTS AT ALL WHEN LIMB A ALREADY DIFFS THESE BYTES. Limb A
// compares the committed page to a fresh generator run, so BOTH SIDES ARE THE
// GENERATOR: a generator that declares 1200x630 for an 800x418 image agrees with
// itself forever. That is M12, recorded verbatim in
// tooling/ci/test/discovery-surface.test.mjs — limb G had exactly this bug and
// printed `ok` over a page quoting $5.99 against a config saying 499. So this
// limb parses the PNG's own IHDR and does its own comparison, against the page
// as SERVED rather than against anything imported from the generator.
//
// MEASURED 2026-08-21: sites/nikatru/og-image.png is 1200 x 630, 118,197 bytes.
// That number is NOT written here — it is read from the file on every run.
//
// WHAT THIS DOES NOT CATCH: that the URL resolves (nothing fetches it — the page
// is compared to the file at DEPLOY_ROOT, which is only the same thing because
// Cloudflare serves this tree with no build step); whether the alt sentence
// DESCRIBES the artwork (prose, and not decidable here — it is asserted
// non-empty and nothing more); a per-app card, which does not exist because one
// site-wide image serves every landing; and the mirror deploy root.
const OG_IMAGE_ASSET = `${DEPLOY_ROOT}/og-image.png`;
let ogChecked = 0;
let ogImagePx = null;
{
  const assetAbs = abs(OG_IMAGE_ASSET);
  // The PNG signature is 8 bytes and IHDR is the mandatory FIRST chunk: 4-byte
  // length, the literal `IHDR`, then width and height as big-endian uint32.
  // Read as structure, never guessed from the filename.
  if (existsSync(assetAbs)) {
    const head = readFileSync(assetAbs).subarray(0, 24);
    if (head.length === 24 && head.subarray(12, 16).toString('latin1') === 'IHDR') {
      ogImagePx = { w: head.readUInt32BE(16), h: head.readUInt32BE(20) };
    }
  }

  // ONE conjunct, not two. `&& rel.endsWith('.html')` stood here until
  // 2026-08-22 and was DELETED rather than kept, because no input this guard
  // can be handed makes it false: every key the plan puts under APPS_DIR comes
  // from the two `files.set(...)` calls in tooling/sites/generate-discovery.mjs
  // (search there for `${APPS_DIR}/index.html`) and both spell `.html` into the
  // key themselves. MEASURED 2026-08-22 in a scratchpad copy of tooling/:
  // pinned true, the committed suite stayed green — no test anywhere could tell
  // it apart from nothing. A conjunct nothing can falsify makes this filter
  // look narrower than it is; and if the generator ever does plan a non-.html
  // under apps/, limb H now says so out loud ("declares no og:image at all")
  // instead of skipping it in silence.
  const landings = [...files.keys()].filter((rel) => rel.startsWith(`${APPS_DIR}/`));
  if (!ogImagePx) {
    problems.push(
      `${OG_IMAGE_ASSET} is missing or is not a PNG whose IHDR can be read, and ${landings.length} generated ` +
        'page(s) point every social card at it. The dimensions those pages declare cannot be checked against ' +
        'anything, and the image itself is a 404 for every scraper that follows the URL.',
    );
  }

  for (const rel of landings) {
    if (!existsSync(abs(rel))) continue; // limb A already reported it MISSING
    const html = readFileSync(abs(rel), 'utf8');
    const prop = (name) => html.match(new RegExp(`<meta property="og:${name}" content="([^"]*)">`, 'i'))?.[1] ?? null;
    const image = prop('image');
    if (image === null) {
      problems.push(`${rel} declares no og:image at all, so a shared link renders as a bare title with whatever picture the scraper scavenges.`);
      continue;
    }
    ogChecked++;
    const w = prop('image:width');
    const h = prop('image:height');
    const alt = prop('image:alt');
    // All four or none is the point: three of four is the state this limb was
    // written to make impossible, and it is what a template that grows one
    // property at a time produces.
    for (const [name, value] of [['og:image:width', w], ['og:image:height', h], ['og:image:alt', alt]]) {
      if (value === null || value.trim() === '') {
        problems.push(
          `${rel} carries og:image but ${value === null ? 'no' : 'an empty'} ${name}. The four og:image ` +
            'properties are emitted as ONE block by tooling/sites/generate-discovery.mjs precisely so a page ' +
            'cannot ship three of four — width and height give a scraper the card\'s box without fetching the ' +
            'bytes, and alt is the only description a reader who cannot see it gets.',
        );
      }
    }
    if (ogImagePx && w !== null && h !== null && (w !== String(ogImagePx.w) || h !== String(ogImagePx.h))) {
      problems.push(
        `${rel} declares og:image ${w}x${h} and ${OG_IMAGE_ASSET} is actually ${ogImagePx.w}x${ogImagePx.h}. ` +
          'A declared box that disagrees with the image is worse than none: the scraper reserves the wrong ' +
          'shape and the card reflows or crops. Re-read the file; never retype the number.',
      );
    }
  }

  // ⚠️ NO `ogChecked === 0` COVERAGE EXIT, for limb A's reason and for M12's.
  // It could not fail on its own: `files.size === 0` already exited at the top,
  // and every landing that declares no og:image pushed its own problem and
  // `continue`d on the way past — so an empty count means those messages exist.
  // Worse, coverageLost() calls process.exit(1) IMMEDIATELY, so adding it here
  // would SWALLOW the per-page messages that say which pages lost the block —
  // the exact shadowing M12 exposed in limb G. The count is printed instead.
}

// ── F · THE DATED SNAPSHOTS STAY INERT ──────────────────────────────────────
// They are excluded from shared chrome because they are frozen consent records.
// That exclusion is only safe while they stay self-contained: a snapshot that
// grew a stylesheet or a script would start rendering with TODAY's chrome and
// stop being a record of what was served on its date.
let snapshotsChecked = 0;
{
  const legalAbs = abs(`${DEPLOY_ROOT}/legal`);
  const stack = existsSync(legalAbs) ? [legalAbs] : [];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of listDir(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) { stack.push(f); continue; }
      if (!e.name.toLowerCase().endsWith('.html')) continue;
      snapshotsChecked++;
      const rel = `${DEPLOY_ROOT}/${f.slice(abs(DEPLOY_ROOT).length + 1).split(sep).join('/')}`;
      const html = readFileSync(f, 'utf8');
      for (const [what, re] of [['<link rel="stylesheet">', /<link[^>]+rel\s*=\s*["']stylesheet["']/i], ['<script>', /<script\b/i]]) {
        if (re.test(html)) {
          problems.push(
            `${rel} contains a ${what}. A dated policy snapshot is a record of what was SERVED on its date, ` +
              'and it is excluded from the shared chrome for exactly that reason. An external stylesheet or ' +
              'a script makes the record depend on files that keep changing, so the archive silently starts ' +
              "showing today's site instead of that day's policy.",
          );
        }
      }
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ ${problems.length} discovery-surface problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

console.log(
  `ok  discovery surface — ${registry.length} registry entr(ies), ${live.length} live; ` +
    `${compared} generated file(s) match a fresh run of tooling/sites/generate-discovery.mjs; ` +
    `${onDisk.size} landing/hub page(s) under ${APPS_DIR} ≡ the registry, plus ${NOT_GENERATED} (not generated, noindex, served); ` +
    `${slotsScanned} page(s) slot-scanned with the canary intact; ${ldChecked} JSON-LD block(s) carry no fabricated rating; ` +
    `${offeringsCompared} rendered price(s) equal what ${RAIL_CONFIG} declares; ` +
    `${chromePagesChecked} page(s) carry shared chrome from tooling/sites/chrome.mjs ` +
    `(${CHROME_EXCLUDED.size} excluded by name, ${snapshotsChecked} dated snapshot(s) asserted inert); ` +
    `${a11yChecked} page(s) carry lang + one <main> + a skip link that resolves + :focus-visible + alt on every <img>; ` +
    `${boxChecked} served <img> tag(s) across ${DEPLOY_ROOT} reserve their box with integer width+height ` +
    '(tags inside comments and <script> are NOT elements and are not counted — the accessibility limb says why); ' +
    `${ogChecked} generated page(s) carry all four og:image properties, sized ` +
    // NO `ogImagePx ? … : '??'` HERE. The '??' arm was DELETED 2026-08-22
    // rather than left standing: this line is only reached when `problems` is
    // empty, and `if (!ogImagePx)` above pushes a problem, so a falsy
    // `ogImagePx` cannot get this far. MEASURED that day in a scratchpad copy —
    // pinned to this arm, the committed suite stayed green. A fallback no run
    // can print reads like a handled case and is not one.
    `${ogImagePx.w}x${ogImagePx.h} from the IHDR of ${OG_IMAGE_ASSET} itself`,
);

if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (an owner decision, or a defer-trigger that has not fired) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
