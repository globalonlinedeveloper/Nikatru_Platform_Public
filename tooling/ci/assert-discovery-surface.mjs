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
// the sitemap: check-site-integrity.mjs:477-499 already owns that relationship,
// in both directions, per deploy root. What this file owns is that the sitemap's
// /apps/ blocks are the ones the generator would have written.
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
import {
  planDiscovery,
  APPS_DIR,
  CANONICAL_HUB_URL,
  DEPLOY_ROOT,
  NOT_GENERATED,
  REGISTRY,
} from '../sites/generate-discovery.mjs';

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

// ── the plan ─────────────────────────────────────────────────────────────────
const { files, registry, live, problems: registryProblems } = planDiscovery(ROOT);
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
const planned = new Set([...files.keys()].filter((r) => r.startsWith(`${APPS_DIR}/`)).map((r) => r.split('/').pop()));
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
const served = new Map(
  [...files.keys()]
    .filter((rel) => rel.endsWith('.html'))
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
        '$4.99/month and $19.99/year while apps/_template.html:76 says priceCurrency INR, and which ' +
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
    `${slotsScanned} page(s) slot-scanned with the canary intact; ${ldChecked} JSON-LD block(s) carry no fabricated rating`,
);

if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (an owner decision, or a defer-trigger that has not fired) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
