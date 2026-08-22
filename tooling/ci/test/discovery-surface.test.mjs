// ─────────────────────────────────────────────────────────────────────────────
// discovery-surface.test.mjs — assert-discovery-surface.mjs must be able to FAIL,
// and tooling/sites/generate-discovery.mjs must be able to produce the input that
// makes it fail.
//
// [pipeline 12]W-1 / W-2 / W-9.
//
// 🔴 THE REAL-TREE MUTATIONS CAME FIRST, and they are what these fixtures encode.
// A fixture you wrote encodes the same misunderstanding as the guard you wrote —
// that is not a maxim in this repository, it is the recorded 2026-07-26 failure
// where assert-seams-wired.mjs passed all six of its own fixtures while matching
// its subject's own declaration. So every case below was first run against a
// scratch COPY of the real tree, restored from memory and byte-compared
// afterwards (never `git checkout --`, which hides whether the restore was
// faithful). Recorded results, in the order they were run:
//
//   M1  sites/nikatru/apps/subly.html: <h1>Subly</h1> -> <h1>Subly Pro</h1>
//         => FAIL "sites/nikatru/apps/subly.html DRIFTED"
//   M2  sites/nikatru/apps/subly.html deleted
//         => FAIL "sites/nikatru/apps/subly.html is MISSING"
//   M3  the <url> block for https://nikatru.com/apps/subly.html deleted from
//       sites/nikatru/sitemap.xml
//         => FAIL "sites/nikatru/sitemap.xml DRIFTED"  (a DISTINCT message from
//            M1, which is what the plan required of these two mutations)
//   M4  sites/nikatru/apps/_template.html: `[APP NAME]` -> `APP NAME`
//         => COVERAGE LOST, naming the lost canary token
//   M5  the generator's JSON-LD gains `aggregateRating`
//         => FAIL "carries `aggregateRating`/`review`"
//   M6  apps.json tagline gains a bracketed slot
//         => FAIL "carries 1 unfilled slot(s)"
//   M7  a second .html hand-added under sites/nikatru/apps/
//         => FAIL "is a page this generator would never write"
//
// The limb-F suite at the foot of this file was added 2026-08-07 and its
// mutations were run the same way, against the REAL tree, because the defect it
// repairs is precisely that limb F could not be reached from a fixture at all:
//
//   M8   tooling/content_pipeline/examples/lingo-phrases/recipe.json deleted
//          => COVERAGE LOST "the pack walk no longer finds 1 of its 1 canary
//             pack id(s): lingo"  (restored; sha256 4d7b497d… re-verified)
//   M9   packages/core/growth_probe/recipe.json added, pack_id "subly"
//          => 🔔 TRIGGER FIRED for W-5, W-6 AND W-8 together, "2 committed pack
//             id(s) [lingo, subly], 1 owned by a registry slug" — and W-4 stayed
//             DEFERRED, which is what keeps the two measurements independent
//   M10  THE SAME BYTES moved to apps/subly/build/web/recipe.json
//          => back to DEFERRED, "1 committed pack id(s) [lingo]". M9 and M10
//             differ only in the directory, so the `build` prune is provably
//             load-bearing rather than decorative
//   M11  a second live entry appended to sites/_shared/_data/apps.json and the
//        generator re-run
//          => 🔔 TRIGGER FIRED [12]W-4, "2 live registry entr(ies) of 2"
//             (restored via regenerate; all five surface sha256s re-verified
//             against the pre-mutation baseline, and `git status` clean)
//
// The limb-G suite (the price on the page vs the price in the rail config) was
// added the same way, and its first mutation is the reason the limb reads
// `services/platform/src/app-config-data.json` itself instead of importing the
// generator's `commerceFor()`:
//
//   M12  tooling/sites/generate-discovery.mjs `money()` renders every amount one
//        dollar high; surfaces regenerated
//          => the FIRST version of limb G printed `ok  … 2 rendered price(s)
//             equal what the config declares` over a page quoting $5.99 against
//             a config saying 499 — because both sides had been computed by the
//             mutant. After the limb was rewritten to parse the config and do its
//             own arithmetic: FAIL "carries data-offering=pro_monthly but not the
//             amount 4.99", one message per offering.
//        🔴 M12 ALSO EXPOSED A SHADOWING BUG in the canary: the "priced landing"
//             set was recorded AFTER the comparisons, so a DISAGREEING price
//             counted as an unpriced landing and `coverageLost()` — which calls
//             process.exit(1) — fired first and swallowed the amount message. The
//             set is now recorded before the comparisons: the canary asks whether
//             anything is being compared, never whether it agrees.
//   M13  the pricing section suppressed in the generator (`offerings.length` ->
//        `false`); surfaces regenerated, so limb A's drift diff is GREEN
//          => FAIL "does not carry data-offering=pro_monthly" (and pro_yearly) —
//             the case limb A structurally cannot see, since a generator that
//             emits no price agrees with a page that carries none
//   M14  subly's `offerings` array emptied in the rail config
//          => first CRASHED the generator (TypeError: cannot read 'code' of
//             undefined — the free card dereferenced offerings[0] eagerly and
//             wrote no page at all). Fixed, then re-run: page renders with no
//             pricing section, and COVERAGE LOST "1 of 1 canary landing(s) carry
//             no priced offering at all: subly" — the writable failing input
//             REQUIRED_PRICED_LANDINGS needed. (Config restored from a byte copy
//             and `git status` re-verified clean.)
//
// The og:image limb (H) and the <img> box floor were added 2026-08-21. Their
// evidence is of TWO kinds, recorded separately because they prove different
// things, and the second kind is the one this file's earlier suites lacked:
//
//   (a) REAL-TREE MEASUREMENTS, taken before either limb was written:
//   M15  the served-<img> sweep over all 19 .html under sites/. A raw `<img`
//          regex finds 8; through the shared `stripInert` only 5 are ELEMENTS,
//          and all 5 already carry integer width+height. The other 3 are an
//          <img> inside an HTML COMMENT (_template.html:114) and two <img>
//          strings inside <script> (nikatru/index.html:502 and the mirror's
//          project renderer). So the note that asked for this limb — "7 img
//          tags and width/height enforcement is ZERO" — is wrong on the count
//          in both directions: 8 raw, 5 served, and the tree already complies.
//          What was zero is ENFORCEMENT. The limb is a tripwire, not a repair.
//   M16  sites/nikatru/og-image.png read as bytes: IHDR 1200x630, 118,197 B, on
//          BOTH deploy roots. `grep -rn og-image tooling/` returns the two
//          generator emitters and one unrelated cache-policy fixture — nothing
//          anywhere asserted the file exists, let alone its size.
//          ⚠️ CORRECTED 2026-08-21, NOT DELETED, because the number was right
//          and its DOMAIN was not — house rule 2 is exactly this failure. Only
//          the DIMENSIONS are shared; the byte count is one file's. Re-measured
//          from each file's own IHDR and length after the fix:
//          sites/nikatru/og-image.png = 1200x630, 118,197 B;
//          sites/rajasekarselvam/og-image.png = 1200x630, 46,622 B.
//          The limb reads sites/nikatru only, so 118,197 was never the mirror's.
//          The grep half of M16 has also been narrowed since — see the note in
//          the 'the ASSET missing FAILS' case, which carries the current domain.
//
//   (b) TRIPWIRE REACHABILITY — every new condition replaced by `if (false)` in
//       a SCRATCHPAD copy of the guard (never in the repo) and re-run against
//       the input that fails against the real one. M17-M20 are the five
//       conditions the og:image and box limbs added on 2026-08-21 (M18 is two:
//       the null branch and the empty/absent-property branch); all five flipped.
//       M21, added later the same day with the attribute-name repair, is a
//       SIX-MUTATION matrix over the box limb specifically — read its entry for
//       what was disabled and what went red, rather than adding it to a count:
//   M17  `if (missing.length)` -> `if (false)`: the unsized-<img> tree goes
//          EXIT 1 -> EXIT 0. Fully green, so this limb is the ONLY reporter.
//   M18  `if (image === null)` and the empty/absent-property branch, each
//          neutralised in turn: EXIT STAYS 1 because limb A (DRIFT) co-fires on
//          a hand-edited generated page — and the limb-H MESSAGE disappears.
//          🔴 THAT IS WHY THOSE CASES ASSERT THE MESSAGE AND NOT ONLY THE CODE:
//          the exit code alone would have passed against a limb that does not
//          exist. Same class as M12.
//   M19  the width/height-vs-IHDR comparison neutralised: EXIT 1 -> EXIT 0 on a
//          tree whose og-image.png is really 800x418 while the page says
//          1200x630. 🔴 THIS IS THE CASE LIMB A CANNOT SEE — the page matches a
//          fresh generator run byte-for-byte, so the drift limb is green and
//          `assert.doesNotMatch(r.out, /DRIFTED/)` records that. It is M12's
//          lesson applied to a second pair: never compare two things the same
//          generator wrote.
//   M20  `if (!ogImagePx)` neutralised: a tree with NO og-image.png goes EXIT 1
//          -> EXIT 0, and the pages keep advertising the URL to every scraper.
//   M21  ADDED 2026-08-21 with the attribute-NAME fix, and it is the WHOLE box
//          limb, not a sample of it — the previous pass generalised from part of
//          its conditions, which is how the `\bwidth` hole survived review. A
//          scratchpad copy of tooling/ci + tooling/sites (never the repo), whose
//          baseline is 96 tests / 91 pass / 5 fail — the five reds are the 'the
//          real repository' suite, which needs the sites/ tree the copy omits.
//          Six mutations, each applied by a driver that EXITS 2 on a no-op so a
//          mutation that failed to apply cannot be misread as green:
//            a  both `(?<![-\w])` -> `\b`      -> 6 fail: +the data-* case
//            b  width lookbehind only -> `\b`  -> 6 fail: +the data-* case
//            c  height lookbehind only -> `\b` -> 6 fail: +the data-* case
//            d  `if (missing.length)` -> false -> 9 fail: +no-width/no-height,
//                                                 100%, data-*, _template reach
//            e  width regex forced true        -> 9 fail: same four
//            f  height regex forced true       -> 8 fail: +no-width/no-height,
//                                                 100%, data-*
//          Plus (g), which exists to answer "is the `doesNotMatch` on the ok
//          line an assertion nothing can reach?" — with `assert.equal(code, 1)`
//          above it, the ok line is only printed on the success path, so the
//          question is fair. Mutation: `process.exit(1)` -> `process.exitCode =
//          1` in the report block, i.e. the ordinary "print the census, THEN
//          fail" refactor. It FIRES: `doesNotMatch … /1 served <img> tag\(s\)
//          across sites\/nikatru reserve their box/`. So the line is load-
//          bearing — it says the certification sentence may never be printed
//          over a page that failed this limb — and not a decoration.
//          🔴 (a) IS THE ONE THAT MATTERS: EXIT 1 -> EXIT 0 and the ok line reads
//          `1 served <img> tag(s) across sites/nikatru reserve their box with
//          integer width+height` over a tag that reserves none — captured
//          verbatim from the mutant, not paraphrased. The lookbehind is the only
//          thing between a certified page and an evaded one, which is why the
//          data-* case asserts the message as well as the code (the M18 reason).
//   M22  ADDED 2026-08-21 by the re-verification pass, and it exists because
//          M17-M21 left THREE of these two limbs' conditions unrecorded while
//          M18's line says "all five flipped" - a reader checks the sentence,
//          not the code, so an unlisted condition reads as a covered one. The
//          WHOLE set was re-run against the FINAL files of this change, in the
//          same scratchpad copy of tooling/ci + tooling/sites (never the repo),
//          against the same reproduced baseline of 96 tests / 91 pass / 5 fail,
//          each mutation applied by a driver that EXITS 2 on a no-op. FOURTEEN
//          mutations, fourteen reds, fail count per mutant:
//            a-f  the box matrix of M21          6, 6, 6, 9, 9, 8
//            g    process.exit(1) -> exitCode    6
//            h    `if (existsSync(assetAbs))` -> false          28
//            i    the `head.length === 24 && ... 'IHDR'` test -> false   28
//            j    `if (!ogImagePx)` -> false            (= M20)  7
//            k    `if (!existsSync(abs(rel))) continue` -> always continue  10
//            l    `if (image === null)` -> false        (= M18a) 6
//            m    the empty/absent-property branch -> false (= M18b) 7
//            n    the IHDR-vs-declared comparison -> false (= M19)  6
//          h, i and k are the three that were NOT on the record before. h and
//          i land on 28 because `ogImagePx` stays null for the WHOLE run, so
//          limb H reports the asset missing against every fixture tree and the
//          suites that expect a clean guard go red alongside it: a blast
//          radius rather than a targeted tripwire, but red is what the
//          mutation asks for and green is what a decoration would have given.
//
//   M23  ADDED 2026-08-22 by the third pass. M17-M22 mutated the conditions
//          this change ADDED; M23 is EVERY condition in every BLOCK it touches
//          — the accessibility limb, the box limb, limb H, and the OG_IMAGE
//          constant in tooling/sites/generate-discovery.mjs — pinned BOTH ways
//          wherever both directions mean something. That second direction is
//          the point: a conjunct pinned FALSE is caught by the positive case,
//          while the direction that actually EVADES a limb is the one pinned
//          TRUE, and M17-M22 never took it. Same scratchpad discipline as M21
//          and M22 (a mirror of tooling/ + sites/ + .github/ + catalog/ +
//          apps/subly/store, never the repo, reproduced green first; a driver
//          that EXITS 2 on a no-op so an unapplied mutation cannot read as
//          green), plus one rule they did not have: the predicted tripwire is
//          run first, and any mutation that stays green is re-run against the
//          WHOLE committed suite before it is allowed to be called green.
//
//          🔴 TWELVE CONDITIONS CAME BACK GREEN — twelve assertions no case in
//          this file could tell from nothing. Every one is closed here: NINE by
//          a new case, THREE by deletion. The measurement for each is written
//          at the case or the comment that closes it.
//            1  `head.length === 24` in the IHDR parse -> the TRUNCATED header
//               case. The not-a-PNG fixture is 61 bytes, so only the string half
//               of that conjunction ever decided anything.
//            2  `w !== null && h !== null` on the IHDR comparison (both
//               conjuncts, pinned together) -> the doesNotMatch added to the
//               per-property case.
//            3  `w !== String(ogImagePx.w)`            -> the ONE-axis case.
//            4  `h !== String(ogImagePx.h)`            -> the ONE-axis case.
//               The M12 fixture disagrees on BOTH numbers, so either half alone
//               carried it and neither was falsifiable.
//            5  the `(?=[\s/>])` lookahead on the HEIGHT matcher -> the second
//               junk arm of the value-forms case. The first arm only exercises
//               width; two regexes need two inputs.
//            6  `[a-z]{2}` in the <html lang> matcher -> the `lang=""` arm.
//            7  `<img\b` in the accessibility scan    -> the custom-element case.
//            8  `<img\b` in the box scan              -> the custom-element case.
//            9  `<main\b` in the <main> counter       -> the custom-element case.
//               One `\b` three times over: it is a boundary before a HYPHEN as
//               well, and a custom element name is REQUIRED to contain one, so
//               `<img-comparison-slider>` was scanned as an image and
//               `<main-nav>` counted as a second <main>. All three now read
//               `(?![-\w])`, and one fixture carrying both components covers
//               all three.
//           10  `found.length > 0` on the accessibility coverage exit ->
//               DELETED, because the exit could never fire. The chrome limb one
//               block up walks the same root with byte-identical code, filters
//               it with the same `found.filter(isChromePage)` and increments in
//               the same place, so the two counters are always equal; its
//               identical exit runs FIRST and `coverageLost` calls
//               `process.exit(1)`. The case that proves it is here, in this
//               suite, and it asserts the surviving refusal.
//           11  `rel.endsWith('.html')` on limb H's landings filter -> DELETED.
//               No input this guard can be handed makes it false.
//           12  the `'??'` arm of the ok line's dimension -> DELETED. That line
//               is only reached when `problems` is empty and `if (!ogImagePx)`
//               pushes a problem, so the arm can never print.
//          All three deletions were measured green FIRST, against the suite as
//          it then stood, and the argument for each is written where it stood.
//
//          NOT IN THAT TWELVE, because they were pinned before the sweep ran
//          rather than caught by it: the single-quoted alternative, the
//          unquoted alternative and the `\s*` padding, on BOTH box matchers —
//          six conditions. Every other case in this file writes a tight
//          double-quoted value, so nothing exercised them. What the sweep DOES
//          establish is the second half of the claim: each of the six reddens
//          the value-forms case AND NOTHING ELSE in the suite.
//
//          🔴 AND FOUR OF THE TWELVE ARE NOT HOLES IN THIS CHANGE'S OWN CODE
//          (6, 7, 9 and 10) — they are in the accessibility limb, which predates
//          it, and which this file's box-limb comment described WRONGLY: it said
//          that limb "makes no compliance claim in its ok line". It does — the
//          line reads "+ alt on every <img>". `\balt` accepted `data-alt`,
//          `\blang` accepted `data-lang` and `xml:lang`, and the skip-link
//          target pattern was built from a TEMPLATE LITERAL where `\s` is not
//          an escape, so the pattern really read `ids*=s*["']main["']` — it
//          matched `id="main"` only because `s*` also matches zero `s`, and it
//          reported `id = "main"` as a link resolving to nothing. All of those
//          are repaired, each with its own case here. The lesson is the one M21
//          already recorded and this pass had to learn a second time: a limb
//          that was fixed once is not a limb that was checked.
//
//   Also caught by writing the negative half BEFORE trusting the limb: the first
//   width/height matcher was `/\bwidth\s*=\s*["']?\d/` and it PASSED
//   `width="100%"` — the exact tag the limb exists to catch — because `100%`
//   starts with a digit. The percentage case is in the suite for that reason.
//   🔴 AND THE SECOND HALF OF THE SAME MATCHER WAS WRONG THE SAME WAY, caught by
//   review on 2026-08-21 after the value half was already fixed: `\bwidth` also
//   matches `data-width`, so a tag reserving nothing was not just missed but
//   PRINTED AS COMPLIANT. Both halves of one regex, both loose, both only found
//   by asking what input would slip past — which is the argument for writing the
//   evasion before trusting the limb, not for trusting a limb that was fixed once.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { planDiscovery, renderSitemap, rewriteLlms, urlForPage } from '../../sites/generate-discovery.mjs';
import { today, lastmodFor, isGitRepo } from '../../sites/lastmod.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-discovery-surface.mjs');
const GENERATOR = join(REPO, 'tooling', 'sites', 'generate-discovery.mjs');

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-discovery-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const SITEMAP_BASE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://nikatru.com/</loc>
    <lastmod>2026-08-01</lastmod>
  </url>
</urlset>
`;

/** The one non-generated file in the generated directory, reduced to the parts
 *  this guard classifies: its noindex and its canary tokens. */
const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta name="robots" content="noindex, nofollow">
<title>[APP NAME]</title>
<link rel="canonical" href="https://nikatru.com/apps/[SLUG].html">
<script type="application/ld+json">
{ "price": "[0 or price]" }
</script>
</head>
<body>
<a href="[WEB APP URL]">Open</a>
<a href="[SNAP OR dl.nikatru.com APPIMAGE URL]">Linux</a>
</body>
</html>
`;

/** A PNG that is EXACTLY its header, for limb H's og:image dimension check.
 *
 *  The guard reads the 8-byte signature, then IHDR — the mandatory first chunk —
 *  and takes width and height as big-endian uint32 at offsets 16 and 20. Those
 *  24 bytes are the whole of what it parses, so that is the whole of what a
 *  fixture needs. Head-only ON PURPOSE: a fixture carrying IDAT/IEND would imply
 *  the guard decodes an image, which it does not and must not — it runs with no
 *  network and no image library, and "read the header" is the claim the limb
 *  makes. The REAL asset is exercised by the guard's own run over this
 *  repository, which prints 1200x630 read from sites/nikatru/og-image.png
 *  (118,197 bytes, measured 2026-08-21). */
function pngHeader(w, h) {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); // IHDR payload length
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

/** A minimal deploy tree: registry + the nikatru root the generator writes into. */
function tree(entries, opts = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'sites', '_shared', '_data'), { recursive: true });
  mkdirSync(join(root, 'sites', 'nikatru', 'apps'), { recursive: true });
  // The social card every generated landing points at. `ogPx` lets a case ship
  // an image whose real size DISAGREES with what the generator declares — the
  // one input limb A structurally cannot see, because there both sides of the
  // comparison were written by the generator (M12).
  if (opts.ogImage !== false) {
    writeFileSync(
      join(root, 'sites', 'nikatru', 'og-image.png'),
      opts.ogPx ? pngHeader(opts.ogPx.w, opts.ogPx.h) : pngHeader(1200, 630),
    );
  }
  writeFileSync(
    join(root, 'sites', '_shared', '_data', 'apps.json'),
    typeof entries === 'string' ? entries : JSON.stringify(entries, null, 2),
  );
  writeFileSync(join(root, 'sites', 'nikatru', 'sitemap.xml'), opts.sitemap ?? SITEMAP_BASE);
  writeFileSync(join(root, 'sites', 'nikatru', 'index.html'), chromed('home'));
  if (opts.template !== false) writeFileSync(join(root, 'sites', 'nikatru', 'apps', '_template.html'), opts.template ?? TEMPLATE);
  // Content packs, for limb F's trigger watcher. `at` is a repo-relative
  // directory so a case can put the same pack somewhere the walk must PRUNE
  // (build output, test fixtures) and prove the trigger stays quiet.
  for (const { at, pack_id } of opts.packs ?? []) {
    mkdirSync(join(root, ...at.split('/')), { recursive: true });
    writeFileSync(join(root, ...at.split('/'), 'recipe.json'), JSON.stringify({ recipe_version: 1, pack_id }, null, 2));
  }
  // The rail config — the ONE place a price lives. Written only when a case asks
  // for it, because a tree with no rail is the state every guard fixture was in
  // before commerce existed and the generator must still produce a page there.
  if (opts.rail !== undefined) {
    mkdirSync(join(root, 'services', 'platform', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'services', 'platform', 'src', 'app-config-data.json'),
      typeof opts.rail === 'string' ? opts.rail : `${JSON.stringify(opts.rail, null, 2)}\n`,
    );
  }
  // Store listings, keyed by slug exactly as the brick stamps them.
  for (const [slug, text] of Object.entries(opts.store ?? {})) {
    const dir = join(root, 'apps', slug, 'store', 'android-play');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'long-description.txt'), text);
  }
  if (opts.pricingPage) writeFileSync(join(root, 'sites', 'nikatru', 'pricing.html'), chromed('<h1>Pricing</h1>'));
  return root;
}

/** A rail config shaped like the real one: `defaults` plus a per-app key. */
const rail = (apps) => ({
  defaults: { features: {}, paywall: { enabled: false, offerings: [] } },
  apps,
});

const SUBLY_OFFERINGS = [
  { product_id: 'pro_monthly', amount_minor: 499, currency_code: 'USD', term: 'month', trial_days: 30 },
  { product_id: 'pro_yearly', amount_minor: 1999, currency_code: 'USD', term: 'year', trial_days: 30 },
];

/** Run the real generator over a fixture root, exactly as the owner would. */
function generate(root) {
  const r = spawnSync(process.execPath, [GENERATOR, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function guard(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const SUBLY = {
  slug: 'subly',
  name: 'Subly',
  tagline: 'Track every subscription in one place',
  url: 'https://subly.nikatru.com',
  platforms: ['web'],
  status: 'live',
};

/** A fixture page carrying the chrome sentinels, exactly as every served page
 *  under the deploy root must. The chrome set is DERIVED from the tree, so any
 *  .html a fixture writes under sites/nikatru is in the contract - a stub without
 *  markers is not a smaller fixture, it is an invalid page, and the generator
 *  correctly refuses it. */
const chromed = (body) =>
  '<html lang="en"><head><style>\n' +
  '  /* CHROME:a11y-css */\n  :focus-visible{outline:2px}\n  /* /CHROME:a11y-css */\n' +
  '  /* CHROME:footer-css */\n  /* /CHROME:footer-css */\n' +
  '</style></head><body>\n' +
  '<!-- CHROME:skiplink -->\n<a class="skip-link" href="#main">Skip</a>\n<!-- /CHROME:skiplink -->\n' +
  '<main id="main">' + body + '</main>' +
  '\n<!-- CHROME:footer -->\n<!-- /CHROME:footer -->\n</body></html>\n';

const p = (root, ...rel) => join(root, 'sites', 'nikatru', ...rel);

describe('the generator', () => {
  test('a generated tree passes the guard, and is idempotent', () => {
    const root = tree([SUBLY]);
    assert.equal(generate(root).code, 0);
    const first = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    // A second run must change nothing — otherwise CI's regenerate-and-diff can
    // never be green, and the drift limb would fire on every push.
    const second = generate(root);
    assert.equal(second.code, 0);
    assert.match(second.out, /0 changed/);
    assert.equal(readFileSync(p(root, 'apps', 'subly.html'), 'utf8'), first);
    assert.equal(guard(root).code, 0);
  });

  test('a live entry is indexable, carries a canonical, and joins the sitemap', () => {
    const root = tree([SUBLY]);
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.doesNotMatch(html, /noindex/);
    assert.match(html, /<link rel="canonical" href="https:\/\/nikatru\.com\/apps\/subly">/);
    const sitemap = readFileSync(p(root, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/nikatru\.com\/apps\/subly<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/nikatru\.com\/apps\/<\/loc>/);
    // The homepage <loc> that was already there survives untouched.
    assert.match(sitemap, /<loc>https:\/\/nikatru\.com\/<\/loc>/);
  });

  test('STATUS CHANGES THE PAGE, NEVER WHETHER THE PAGE EXISTS — a preview entry is noindex, unlisted and off the hub', () => {
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo', status: 'preview' }]);
    generate(root);
    const html = readFileSync(p(root, 'apps', 'lingo.html'), 'utf8');
    assert.match(html, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(html, /rel="canonical"/);
    const sitemap = readFileSync(p(root, 'sitemap.xml'), 'utf8');
    assert.doesNotMatch(sitemap, /apps\/lingo\.html/);
    // ...and the hub advertises only what the registry calls live. A card for a
    // non-live app is a promise made to a stranger.
    const hub = readFileSync(p(root, 'apps', 'index.html'), 'utf8');
    assert.doesNotMatch(hub, /Lingo/);
    assert.match(hub, /Subly/);
    assert.equal(guard(root).code, 0);
  });

  test('operatingSystem comes from the entry, never from the hardcoded six', () => {
    const root = tree([{ ...SUBLY, platforms: ['web'] }]);
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.match(html, /"operatingSystem": "Web"/);
    assert.doesNotMatch(html, /iOS, Android, Windows, macOS, Linux, Web/);
  });

  test('no price, no offers block, no aggregateRating, no store button it cannot back', () => {
    const root = tree([SUBLY]);
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.doesNotMatch(html, /offers/);
    assert.doesNotMatch(html, /aggregateRating/);
    assert.doesNotMatch(html, /priceCurrency/);
    assert.doesNotMatch(html, /apps\.apple\.com|play\.google\.com|apps\.microsoft\.com|flathub/i);
  });

  test('a slug that is not a safe filename or URL segment is refused, not written', () => {
    const root = tree([{ ...SUBLY, slug: '../evil' }]);
    const r = generate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /not usable as a filename or a URL/);
    assert.equal(existsSync(join(root, 'sites', 'evil.html')), false);
  });

  test('a duplicate slug is refused — two entries would write one landing', () => {
    const root = tree([SUBLY, { ...SUBLY, name: 'Other' }]);
    assert.match(generate(root).out, /appears more than once/);
  });

  test('an entry with no tagline is refused — the meta description comes from it', () => {
    const root = tree([{ ...SUBLY, tagline: '' }]);
    assert.match(generate(root).out, /has no tagline/);
  });

  test('a platform id the generator has no name for fails rather than publishing the raw token', () => {
    const root = tree([{ ...SUBLY, platforms: ['web', 'fuchsia'] }]);
    assert.match(generate(root).out, /no name for/);
  });

  test('renderSitemap emits <loc> + <lastmod> and nothing else — [12]W-3a', () => {
    const out = renderSitemap([
      { loc: 'https://nikatru.com/', lastmod: '2026-08-04' },
      { loc: 'https://nikatru.com/apps/', lastmod: '2026-08-06' },
    ]);
    assert.match(out, /<loc>https:\/\/nikatru\.com\/<\/loc>\n {4}<lastmod>2026-08-04<\/lastmod>/);
    // Google ignores both entirely, and a field nothing can check is a field
    // that can only ever be wrong. The guard fails a sitemap carrying either.
    assert.doesNotMatch(out, /changefreq|priority/);
  });

  test('urlForPage is the one canonical form — index.html is the bare directory', () => {
    assert.equal(urlForPage('index.html'), 'https://nikatru.com/');
    assert.equal(urlForPage('apps/index.html'), 'https://nikatru.com/apps/');
    assert.equal(urlForPage('privacy.html'), 'https://nikatru.com/privacy');
  });

  test('🔴 the sitemap is the WHOLE page set now, not just the /apps/ blocks', () => {
    // The half that used to be carried through byte-for-byte was hand-maintained
    // inside a requirement whose first sentence is "never hand-maintained", and
    // it had drifted on the real tree: six URLs claiming 2026-08-01/03 while
    // every page last changed 2026-08-04.
    const root = tree([SUBLY]);
    writeFileSync(p(root, 'privacy.html'), chromed('p'));
    generate(root);
    const sitemap = readFileSync(p(root, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/nikatru\.com\/privacy<\/loc>/);
    // …and a noindex page is excluded BY ITS OWN DECLARATION, never by name.
    // `_template.html` is the live proof: it is served and must stay unlisted.
    assert.doesNotMatch(sitemap, /_template/);
  });

  test('🔴 EVERY <url> carries a <lastmod> — an optional one is one a hand edit escapes by deleting', () => {
    const root = tree([SUBLY]);
    generate(root);
    const sitemap = readFileSync(p(root, 'sitemap.xml'), 'utf8');
    const locs = [...sitemap.matchAll(/<loc>/g)].length;
    const mods = [...sitemap.matchAll(/<lastmod>/g)].length;
    assert.ok(locs > 0, 'the fixture must produce at least one URL or this asserts nothing');
    assert.equal(mods, locs);
    // A fixture tree is not a git work tree, so every date degrades to today on
    // BOTH sides — writer and checker evaluate the same function. That is what
    // keeps a synthetic tree self-consistent rather than accidentally green.
    assert.match(sitemap, new RegExp(`<lastmod>${today()}</lastmod>`));
  });

  test('rewriteLlms replaces the ## Apps section and leaves the owner prose alone', () => {
    const before = '# N\n\n## About\n- Studio: N\n\n## Apps\n- Old — stale — https://old.example (web)\n\n## Key pages\n- Home: /\n';
    const out = rewriteLlms(before, [
      { name: 'Subly', tagline: 'Track every subscription in one place', url: 'https://subly.nikatru.com', platforms: ['web'] },
    ]);
    assert.match(out, /## Apps\n- Subly — Track every subscription in one place — https:\/\/subly\.nikatru\.com \(web\)\n\n## Key pages/);
    assert.doesNotMatch(out, /Old — stale/);
    assert.match(out, /## About\n- Studio: N/);
  });

  test('🔴 rewriteLlms leaves exactly ONE blank line — the recorded `m`-flag `$` bug', () => {
    // The first version used /^## Apps\n[\s\S]*?(?=\n## |$)/m. Under `m`, `$`
    // matches at the end of every LINE, so the body stopped at the end of the
    // first entry and left the section's own trailing newline for the
    // replacement to add again. It shipped a double blank line on its first real
    // run and was caught by reading the diff, not by a fixture asserting the
    // Subly line was present — which would have passed.
    const before = '## Apps\n- Old — x — https://o.example (web)\n\n## Key pages\n- Home: /\n';
    const out = rewriteLlms(before, [{ name: 'A', tagline: 'T', url: 'https://a.example', platforms: ['web'] }]);
    assert.doesNotMatch(out, /\n\n\n/);
    assert.equal(out, '## Apps\n- A — T — https://a.example (web)\n\n## Key pages\n- Home: /\n');
  });

  test('rewriteLlms returns null when its anchor heading is gone, rather than guessing', () => {
    assert.equal(rewriteLlms('# N\n\n## Key pages\n- Home: /\n', []), null);
  });

  test('a non-live entry never reaches llms.txt — it is a promise to a stranger', () => {
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo', url: 'https://lingo.nikatru.com', status: 'preview' }]);
    writeFileSync(p(root, 'llms.txt'), '# N\n\n## Apps\n- placeholder\n\n## Key pages\n- Home: /\n');
    generate(root);
    const llms = readFileSync(p(root, 'llms.txt'), 'utf8');
    assert.match(llms, /- Subly —/);
    assert.doesNotMatch(llms, /Lingo|lingo\.nikatru\.com/);
  });

  test('a live landing prices itself from the RAIL CONFIG, and the guard compares the two', () => {
    const root = tree([SUBLY], {
      rail: rail({ subly: { features: {}, paywall: { enabled: false, offerings: SUBLY_OFFERINGS } } }),
      pricingPage: true,
    });
    assert.equal(generate(root).code, 0);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.match(html, /data-offering="pro_monthly"/);
    assert.match(html, /\$4\.99 <small>\/ month<\/small>/);
    assert.match(html, /data-offering="pro_yearly"/);
    assert.match(html, /\$19\.99 <small>\/ year<\/small>/);
    assert.match(html, /30-DAY FREE TRIAL/);
    assert.equal(guard(root).code, 0);
  });

  test('🔴 A RENDERED PRICE THAT DISAGREES WITH THE CONFIG FAILS — the limb the drift diff cannot supply', () => {
    // Limb A compares the page to the GENERATOR, so a generator that quotes the
    // wrong number agrees with the page it wrote. Only a second, independent read
    // of the config can see it. Proven on the real tree too: `money()` mutated to
    // add a dollar printed `ok` from the first version of that limb, because it
    // imported the generator's own formatter to compute what it expected.
    const root = tree([SUBLY], {
      rail: rail({ subly: { features: {}, paywall: { enabled: false, offerings: SUBLY_OFFERINGS } } }),
    });
    generate(root);
    const page = p(root, 'apps', 'subly.html');
    writeFileSync(page, readFileSync(page, 'utf8').replace('$4.99', '$3.99'));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /but not the amount 4\.99/);
  });

  test('a declared offering with NO card on the page fails, naming the product id', () => {
    const root = tree([SUBLY], {
      rail: rail({ subly: { features: {}, paywall: { enabled: false, offerings: SUBLY_OFFERINGS } } }),
    });
    generate(root);
    const page = p(root, 'apps', 'subly.html');
    writeFileSync(page, readFileSync(page, 'utf8').replace('data-offering="pro_yearly"', 'data-card="yearly"'));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /does not carry data-offering="pro_yearly"/);
  });

  test('🔴 PRICES ON THE PAGE, STILL NO `offers` IN THE JSON-LD — the honest half is the half that ships', () => {
    // Google's SoftwareApplication rich result wants offers.price AND
    // aggregateRating|review together, so emitting `offers` buys a rich result
    // only next to a rating this factory must never synthesise. The guard's limb D
    // fails the build for it; this asserts the generator does not hand it one.
    const root = tree([SUBLY], {
      rail: rail({ subly: { features: {}, paywall: { enabled: false, offerings: SUBLY_OFFERINGS } } }),
    });
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/)[1]);
    assert.equal('offers' in ld, false);
    assert.equal('aggregateRating' in ld, false);
    assert.match(html, /\$4\.99/); // …and the price really is on the page
  });

  test('the FREE card is a fact about the paywall switch, not a tier description — it goes when the switch flips', () => {
    const off = tree([SUBLY], { rail: rail({ subly: { paywall: { enabled: false, offerings: SUBLY_OFFERINGS } } }) });
    generate(off);
    const free = readFileSync(p(off, 'apps', 'subly.html'), 'utf8');
    assert.match(free, /<h3>Free<\/h3>/);
    assert.match(free, /Paid checkout is not open yet/);

    const on = tree([SUBLY], { rail: rail({ subly: { paywall: { enabled: true, offerings: SUBLY_OFFERINGS } } }) });
    generate(on);
    const paid = readFileSync(p(on, 'apps', 'subly.html'), 'utf8');
    assert.doesNotMatch(paid, /<h3>Free<\/h3>/);
    assert.doesNotMatch(paid, /Paid checkout is not open yet/);
    assert.match(paid, /\$4\.99/);
    assert.equal(guard(on).code, 0);
  });

  test('🔴 an EMPTY offerings array renders a page instead of crashing the generator', () => {
    // Found by mutation, not by reading: the free card dereferenced
    // `offerings[0].code` eagerly, so emptying a live app's offerings threw a
    // TypeError and wrote NO page at all. That is a state a live app is in the
    // moment someone edits its paywall entry.
    const root = tree([SUBLY], { rail: rail({ subly: { paywall: { enabled: false, offerings: [] } } }) });
    assert.equal(generate(root).code, 0);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.doesNotMatch(html, /data-offering/);
    assert.doesNotMatch(html, /<h2>Pricing<\/h2>/);
    assert.equal(guard(root).code, 0);
  });

  test('a feature flag with no reader-facing name FAILS rather than title-casing an internal switch', () => {
    const root = tree([SUBLY], { rail: rail({ subly: { features: { renewals: true, reminders_v2: true } } }) });
    const r = generate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /no reader-facing name/);
    assert.match(r.out, /reminders_v2/);
  });

  test('a `term` outside the config vocabulary FAILS rather than inventing a billing frequency', () => {
    const root = tree([SUBLY], {
      rail: rail({
        subly: { paywall: { enabled: false, offerings: [{ product_id: 'x', amount_minor: 100, currency_code: 'USD', term: 'quarter' }] } },
      }),
    });
    const r = generate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /will not put a price on/);
  });

  test('enabled features render, disabled ones do not', () => {
    const root = tree([SUBLY], { rail: rail({ subly: { features: { renewals: true, budgets: false, exports: true } } }) });
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.match(html, /Renewal reminders/);
    assert.match(html, /Export your data/);
    assert.doesNotMatch(html, /<b>Budgets\.<\/b>/);
  });

  test('the store listing lede reaches the page and STOPS at the first section heading', () => {
    const root = tree([SUBLY], {
      store: {
        subly: 'One list of everything you pay for.\n\nAdd each service once and it does the arithmetic.\n\nWHAT IT DOES\n- a bullet nobody asked this page for\n\nPRIVACY\nNot here either.\n',
      },
    });
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.match(html, /One list of everything you pay for\./);
    assert.match(html, /Add each service once and it does the arithmetic\./);
    assert.doesNotMatch(html, /WHAT IT DOES|a bullet nobody asked|Not here either/);
    assert.equal(guard(root).code, 0);
  });

  test('a listing with no heading at all is BOUNDED, not poured onto the page', () => {
    const root = tree([SUBLY], { store: { subly: 'One.\n\nTwo.\n\nThree.\n\nFour.\n' } });
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.match(html, /<p>One\.<\/p>/);
    assert.match(html, /<p>Two\.<\/p>/);
    assert.doesNotMatch(html, /<p>Three\.<\/p>/);
  });

  test('a NON-live entry gets no price, no features and no lede — status changes what the page SAYS', () => {
    const root = tree([{ ...SUBLY, status: 'preview' }], {
      rail: rail({ subly: { features: { renewals: true }, paywall: { enabled: false, offerings: SUBLY_OFFERINGS } } }),
      store: { subly: 'A lede that must not appear.\n' },
      pricingPage: true,
    });
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.doesNotMatch(html, /data-offering|\$4\.99|Renewal reminders|A lede that must not appear/);
    assert.match(html, /not released yet/);
    assert.equal(guard(root).code, 0);
  });

  test('🔴 `See pricing` is linked ONLY when the deploy root actually ships pricing.html', () => {
    // check-site-integrity.mjs fails a link to a page the root does not serve,
    // and rightly: the alternative is a button that 404s from the one page a
    // payment processor's verification opens.
    const withPage = tree([SUBLY], {
      rail: rail({ subly: { paywall: { enabled: false, offerings: SUBLY_OFFERINGS } } }),
      pricingPage: true,
    });
    generate(withPage);
    assert.match(readFileSync(p(withPage, 'apps', 'subly.html'), 'utf8'), /href="\/pricing\?app=subly"/);

    const without = tree([SUBLY], { rail: rail({ subly: { paywall: { enabled: false, offerings: SUBLY_OFFERINGS } } }) });
    generate(without);
    const html = readFileSync(p(without, 'apps', 'subly.html'), 'utf8');
    // The shared footer links /pricing on every page as site navigation; what is
    // conditional is the CTA, which carries the ?app= query string.
    assert.doesNotMatch(html, /href="\/pricing\?app=/);
    assert.match(html, /\$4\.99/); // the summary still renders; only the link is withheld
  });

  test('an unparseable rail config FAILS — absent is a tree with no prices, present-and-broken is a tree that lost them', () => {
    const root = tree([SUBLY], { rail: '{ not json' });
    const r = generate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /is not valid JSON/);
  });

  test('the four legal pages are linked from every landing, generated or not', () => {
    const root = tree([SUBLY]);
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    for (const page of ['/privacy', '/terms', '/refund', '/delete-account']) {
      assert.ok(html.includes(`href="${page}"`), `the landing must link ${page}`);
    }
  });

  test('a renamed ## Apps heading FAILS rather than silently returning the catalogue to hand maintenance', () => {
    const root = tree([SUBLY]);
    writeFileSync(p(root, 'llms.txt'), '# N\n\n## Applications\n- whatever\n');
    const r = generate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /has no `## Apps` heading/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [12]W-3a · lastmodFor, against a REAL git repository.
//
// This is the fixed point the generator's own header said could not be reached:
// a git-derived `<lastmod>` written into a file committed alongside its subject
// cannot know the commit date that does not exist yet. The resolution is the
// three branches below, and they are tested against real commits rather than a
// stubbed `git`, because a fake git would only prove the fake behaves.
// ─────────────────────────────────────────────────────────────────────────────
describe('lastmodFor — the value a URL will carry once this state is committed', () => {
  const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

  function gitRepo() {
    const root = join(TMP, `g${seq++}`);
    mkdirSync(root, { recursive: true });
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    git(root, 'config', 'user.name', 'Fixture');
    return root;
  }

  test('a file with no history at all resolves to today — it is being ADDED in this commit', () => {
    const root = gitRepo();
    writeFileSync(join(root, 'page.html'), 'v1\n');
    assert.equal(lastmodFor(root, 'page.html'), today());
  });

  test('🔴 a committed, unchanged file resolves to its OWN commit date, not to HEAD', () => {
    // The distinction the whole clause turns on. W-3's research note warned the
    // criterion is "satisfied by any generator that touches git, including one
    // that reads the repo's own HEAD date for every URL" — so a later commit
    // that does not touch this file must not move its date.
    const root = gitRepo();
    writeFileSync(join(root, 'page.html'), 'v1\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '--date=2026-03-04T10:00:00', '-m', 'add page');
    writeFileSync(join(root, 'other.html'), 'x\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '--date=2026-05-06T10:00:00', '-m', 'unrelated');
    assert.equal(lastmodFor(root, 'page.html'), '2026-03-04');
    assert.equal(lastmodFor(root, 'other.html'), '2026-05-06');
  });

  test('🔴 a committed file whose PLANNED bytes differ resolves to today — it is being changed now', () => {
    // This is what makes the generator idempotent across `generate → commit →
    // CI regenerates → diff`. Without it the first run would write the OLD
    // commit date for a page it is about to rewrite, and the second run would
    // write a different one — so `0 changed` could never hold and CI's
    // regenerate-and-diff could never be green.
    const root = gitRepo();
    writeFileSync(join(root, 'page.html'), 'v1\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '--date=2026-03-04T10:00:00', '-m', 'add page');
    assert.equal(lastmodFor(root, 'page.html', 'v1\n'), '2026-03-04');
    assert.equal(lastmodFor(root, 'page.html', 'v2\n'), today());
  });

  test('a DIRTY working tree resolves to today even with no planned bytes — the guard reads the tree', () => {
    const root = gitRepo();
    writeFileSync(join(root, 'page.html'), 'v1\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '--date=2026-03-04T10:00:00', '-m', 'add page');
    assert.equal(lastmodFor(root, 'page.html'), '2026-03-04');
    writeFileSync(join(root, 'page.html'), 'edited\n');
    assert.equal(lastmodFor(root, 'page.html'), today());
  });

  test('a tree that is not a git work tree degrades to today, identically for writer and checker', () => {
    const plain = join(TMP, `p${seq++}`);
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, 'page.html'), 'v1\n');
    assert.equal(isGitRepo(plain), false);
    assert.equal(lastmodFor(plain, 'page.html'), today());
  });
});

describe('the drift limb (W-9)', () => {
  test('M1 — a hand-edited landing FAILS, naming that file', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('<h1>Subly</h1>', '<h1>Subly Pro</h1>'));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /sites\/nikatru\/apps\/subly\.html DRIFTED/);
  });

  test('M2 — a deleted landing FAILS as MISSING', () => {
    const root = tree([SUBLY]);
    generate(root);
    unlinkSync(p(root, 'apps', 'subly.html'));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /sites\/nikatru\/apps\/subly\.html is MISSING/);
  });

  test('M3 — a deleted sitemap <url> block FAILS with a DISTINCT message from M1', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'sitemap.xml');
    // ⚠️ MATCHED BY REGEX, NOT BY A LITERAL BLOCK. The literal this replaced
    // stopped matching the moment [12]W-3a put a `<lastmod>` inside every
    // `<url>` — and a `String.replace` that matches nothing removes nothing, so
    // the mutation silently became a no-op and this test passed a guard it was
    // no longer feeding bad input to. Exactly the shape F-10 exists to catch,
    // caught here only because the guard then returned 0 where 1 was asserted.
    const before = readFileSync(f, 'utf8');
    const after = before.replace(/[ \t]*<url>\s*<loc>https:\/\/nikatru\.com\/apps\/subly<\/loc>[\s\S]*?<\/url>\n/, '');
    assert.notEqual(after, before, 'the mutation must actually remove the block, or this test asserts nothing');
    writeFileSync(f, after);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /sites\/nikatru\/sitemap\.xml DRIFTED/);
    assert.doesNotMatch(r.out, /apps\/subly\.html DRIFTED/);
  });

  test('a registry entry added and never regenerated FAILS', () => {
    const root = tree([SUBLY]);
    generate(root);
    writeFileSync(
      join(root, 'sites', '_shared', '_data', 'apps.json'),
      JSON.stringify([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo' }], null, 2),
    );
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /apps\/lingo\.html is MISSING/);
  });
});

describe('the coverage relationship (both directions)', () => {
  test('M7 — a hand-added page under apps/ FAILS, because the diff alone cannot see it', () => {
    const root = tree([SUBLY]);
    generate(root);
    writeFileSync(p(root, 'apps', 'ghost.html'), '<html><body>ghost</body></html>\n');
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /ghost\.html is a page this generator would never write/);
  });

  test('_template.html is the ONE exemption, and it is by name — it does not read as drift', () => {
    const root = tree([SUBLY]);
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /_template\.html \(not generated, noindex, served\)/);
  });

  test('a landing whose registry entry was deleted FAILS in the other direction', () => {
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo' }]);
    generate(root);
    writeFileSync(join(root, 'sites', '_shared', '_data', 'apps.json'), JSON.stringify([SUBLY], null, 2));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /lingo\.html is a page this generator would never write/);
  });
});

describe('the placeholder scanner and its canary', () => {
  test('M6 — a bracketed slot reaching a generated page FAILS', () => {
    const root = tree([{ ...SUBLY, tagline: 'Track every [THING] in one place' }]);
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /unfilled slot\(s\)/);
  });

  test('M4 — the canary going quiet is COVERAGE LOST, and it names the token', () => {
    const root = tree([SUBLY], { template: TEMPLATE.replace('[APP NAME]', 'APP NAME') });
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /\[APP NAME\]/);
  });

  test('the scanner matches the token shapes the stage document\'s own regex missed', () => {
    // `\[[A-Z][A-Z0-9 /_.—-]*\]` — the shape proposed in the plan — cannot match
    // any of these three, all of them live in the real _template.html. Recorded
    // here so nobody "tidies" the matcher back to it.
    const root = tree([SUBLY], {
      template: TEMPLATE.replace('[0 or price]', 'x').replace('[SNAP OR dl.nikatru.com APPIMAGE URL]', 'y'),
    });
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /\[0 or price\]/);
    assert.match(r.out, /\[SNAP OR dl\.nikatru\.com APPIMAGE URL\]/);
  });

  test('the template losing its noindex FAILS — it is served in production', () => {
    const root = tree([SUBLY], { template: TEMPLATE.replace('<meta name="robots" content="noindex, nofollow">', '') });
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /has lost its `noindex`/);
  });
});

describe('the structured-data limb', () => {
  test('M5 — a fabricated aggregateRating in a served landing FAILS', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace('"@type": "SoftwareApplication",', '"@type": "SoftwareApplication",\n  "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.8", "ratingCount": "312" },'),
    );
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /aggregateRating/);
  });

  test('an offers block in a served landing FAILS — no price may be written here', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace('"@type": "SoftwareApplication",', '"@type": "SoftwareApplication",\n  "offers": { "@type": "Offer", "price": "4.99", "priceCurrency": "USD" },'),
    );
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /carries an `offers` block/);
  });

  test('a JSON-LD block that stops parsing FAILS rather than being skipped', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"@context": "https://schema.org",', '"@context": ,'));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /does not parse/);
  });

  test('a canonical and a JSON-LD url that disagree FAIL', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace('"url": "https://nikatru.com/apps/subly"', '"url": "https://nikatru.com/apps/subly.html"'),
    );
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /Two self-references that disagree/);
  });
});

describe('coverage self-checks — the scan itself must be loud when it stops scanning', () => {
  test('an EMPTY registry is COVERAGE LOST, never a quiet pass over nothing', () => {
    const root = tree([]);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /planned ZERO files/);
    assert.match(r.out, /reason: .*carries no entries/);
  });

  test('an unparseable registry names the PARSE ERROR as the reason, not just "I scanned nothing"', () => {
    const root = tree('{not json');
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /reason: .*not valid JSON/);
  });

  test('a missing apps/ directory is COVERAGE LOST — losing it loses two guards at once', () => {
    const root = tree([SUBLY]);
    generate(root);
    rmSync(join(root, 'sites', 'nikatru', 'apps'), { recursive: true, force: true });
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('planDiscovery over a root with no registry reports it rather than throwing', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { files, problems } = planDiscovery(root);
    assert.equal(files.size, 0);
    assert.match(problems.join('\n'), /does not exist/);
  });
});

describe('the real repository', () => {
  test('the committed surfaces match a fresh generator run, and the guard says so', () => {
    const r = guard(REPO);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /generated file\(s\) match a fresh run/);
  });

  test('🔴 THE HOMEPAGE APPS ARRAY IS HAND-MAINTAINED, AND THE SPLICE DOES NOT TOUCH IT', () => {
    // This test used to pin the OPPOSITE state: an empty array and a standing
    // UNANNOUNCED print, because the owner decision had not been taken. It was
    // taken on 2026-08-21 - announce Subly, which was measured answering 200 at
    // https://subly.nikatru.com - so the assertions move with the decision.
    //
    // What did NOT change, and is the half worth keeping: the generator does not
    // own this array. index.html is now spliced for shared chrome, so the risk is
    // new and specific - a splice that disturbed the body would rewrite 33 KB of
    // hand-written homepage, this array included.
    const home = readFileSync(join(REPO, 'sites', 'nikatru', 'index.html'), 'utf8');
    assert.match(home, /const APPS = \[\n/);
    assert.match(home, /name: "Subly"/);
    assert.match(home, /https:\/\/subly\.nikatru\.com/);

    // The registry and the homepage now agree, so the print is gone. Its absence
    // is the assertion: a print that never clears is a print nobody reads.
    const site = spawnSync(process.execPath, [join(CI_DIR, 'check-site-integrity.mjs'), REPO], { encoding: 'utf8' });
    assert.equal(site.status, 0, site.stdout + site.stderr);
    assert.doesNotMatch(site.stdout, /UNANNOUNCED/);
  });

  test('🔴 re-running the generator leaves the hand-written homepage byte-identical', () => {
    // The splice's core bargain, asserted against the REAL 33 KB page rather than
    // a fixture: chrome is regenerated, everything else is untouched.
    const before = readFileSync(join(REPO, 'sites', 'nikatru', 'index.html'), 'utf8');
    const { files } = planDiscovery(REPO);
    const after = files.get('sites/nikatru/index.html');
    assert.equal(typeof after, 'string', 'the homepage must be in the planned set');
    assert.equal(after, before);
  });

  test('the deferred stage-12 triggers are MEASURED and printed, not asserted from prose', () => {
    const r = guard(REPO);
    for (const id of ['W-4', 'W-5', 'W-6', 'W-8']) {
      assert.match(r.out, new RegExp(`\\[12\\]${id}`), `${id} must be reported every run`);
    }
    assert.match(r.out, /DEFERRED \[12\]W-8[\s\S]*?0 pack\(s\) owned by a registry slug/);
  });

  test('🔴 the pack-walk CANARY still reaches the pack it names — three deferrals rest on it', () => {
    // The own-repo half of limb F's coverage. `0 owned by a registry slug` is the
    // correct answer today AND the answer a walk that reaches nothing gives, so
    // the only thing separating them is evidence that the walk still finds a pack
    // it is known to be able to find. If this line stops saying `lingo`, W-5, W-6
    // and W-8 are no longer being measured — they are merely being asserted.
    const r = guard(REPO);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 committed pack id\(s\) \[lingo\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Limb F · THE DEFERRAL WATCHER FOR [12]W-4, W-5, W-6 and W-8.
//
// 🔴 WHY THIS SUITE EXISTS. The watcher shipped inside `if (SCANNING_OWN_REPO)`,
// so on every fixture root — all of them temp directories — limb F emitted
// NOTHING, and the `🔔 TRIGGER FIRED` branch had no writable failing input at
// all. Measured 2026-08-07 before the fix: a fixture carrying two live registry
// entries, which is verbatim W-4's trigger, produced no `W-4` substring anywhere
// in the guard's output and no `TRIGGER FIRED` match.
//
// The test that stood here claimed the flip in its NAME ('a second live registry
// entry FLIPS W-4's trigger print') and never ran the guard: it called
// `planDiscovery` and asserted `live.length === 2` — a fact about the generator,
// true whether or not the print exists. Four requirements were deferred on a
// mechanism whose firing had never once been observed, which is the repository's
// own recorded assert-seams-wired.mjs shape.
//
// So every case below runs the REAL guard and reads the REAL print, in both
// directions: fired when the trigger's condition holds, deferred when it does
// not. A watcher that can only print one of its two branches is a constant.
// ─────────────────────────────────────────────────────────────────────────────
describe('the deferred stage-12 trigger watcher', () => {
  /** Every trigger line for `id`, as the guard actually printed it. */
  const lineFor = (out, id) => out.split('\n').find((l) => l.includes(`[12]${id} —`)) ?? '';

  test('🔴 TWO LIVE ENTRIES FLIP W-4 — the branch that was unreachable before', () => {
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo' }]);
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 0, r.out);
    const w4 = lineFor(r.out, 'W-4');
    assert.match(w4, /🔔 TRIGGER FIRED/);
    assert.match(w4, /2 live registry entr\(ies\) of 2/);
    assert.match(w4, /The condition this requirement was deferred behind is now TRUE — build it\./);
  });

  test('ONE live entry keeps W-4 DEFERRED — the watcher is not stuck on either branch', () => {
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo', status: 'preview' }]);
    generate(root);
    const w4 = lineFor(guard(root).out, 'W-4');
    assert.match(w4, /DEFERRED/);
    assert.doesNotMatch(w4, /TRIGGER FIRED/);
    assert.match(w4, /1 live registry entr\(ies\) of 2/);
  });

  test('🔴 a pack a REGISTRY SLUG OWNS flips W-5, W-6 and W-8 together — they share one measurement', () => {
    const root = tree([SUBLY], { packs: [{ at: 'packages/subly_content', pack_id: 'subly' }] });
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 0, r.out);
    for (const id of ['W-5', 'W-6', 'W-8']) {
      assert.match(lineFor(r.out, id), /🔔 TRIGGER FIRED/, `${id} must fire on an owned pack`);
    }
    assert.match(lineFor(r.out, 'W-8'), /1 pack\(s\) owned by a registry slug/);
    // ...and W-4 is INDEPENDENT: a pack is not a second live app. Collapsing the
    // two measurements would make one requirement's trigger answer for another's.
    assert.match(lineFor(r.out, 'W-4'), /DEFERRED/);
  });

  test('a pack NO registry slug owns leaves all three DEFERRED — this is the real tree\'s state', () => {
    // `lingo` is committed and real; no app named `lingo` is in the registry. The
    // guard must count the pack and still refuse to call the trigger fired.
    const root = tree([SUBLY], { packs: [{ at: 'tooling/content_pipeline/examples/lingo-phrases', pack_id: 'lingo' }] });
    generate(root);
    const r = guard(root);
    const w5 = lineFor(r.out, 'W-5');
    assert.match(w5, /DEFERRED/);
    assert.match(w5, /1 committed pack id\(s\) \[lingo\], 0 owned by a registry slug/);
    assert.match(lineFor(r.out, 'W-8'), /DEFERRED/);
  });

  test('a pack under test/fixtures is NOT counted — it exists to prove the FORMAT', () => {
    const root = tree([SUBLY], { packs: [{ at: 'packages/core/test/fixtures/pack/v1', pack_id: 'subly' }] });
    generate(root);
    const r = guard(root);
    assert.match(lineFor(r.out, 'W-5'), /0 committed pack id\(s\) \[none\]/);
    assert.match(lineFor(r.out, 'W-8'), /DEFERRED/);
    assert.doesNotMatch(lineFor(r.out, 'W-8'), /TRIGGER FIRED/);
  });

  test('🔴 a pack under build/ is NOT counted — the walk reads the WORKING TREE', () => {
    // Build output is not committed, but this walk is a directory scan: a
    // developer who has run a build would otherwise measure a different tree than
    // CI does, and a copied pack would fire a trigger the repository does not
    // satisfy. `build` was missing from this walk's prune list while the pubspec
    // walk twenty lines below it already had it.
    const root = tree([SUBLY], { packs: [{ at: 'apps/subly/build/web', pack_id: 'subly' }] });
    generate(root);
    const r = guard(root);
    assert.match(lineFor(r.out, 'W-5'), /0 committed pack id\(s\) \[none\]/);
    assert.match(lineFor(r.out, 'W-8'), /DEFERRED/);
    assert.doesNotMatch(lineFor(r.out, 'W-8'), /TRIGGER FIRED/);
  });

  test('all four lines are printed on any tree, and none of them fails the build', () => {
    // [pipeline C-6]: "you shipped a second app" must never turn CI red. The
    // watcher informs; it does not gate.
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo' }], {
      packs: [{ at: 'packages/p', pack_id: 'subly' }],
    });
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 0, 'every trigger fired and the guard must STILL exit 0');
    for (const id of ['W-4', 'W-5', 'W-6', 'W-8']) {
      assert.match(lineFor(r.out, id), /🔔 TRIGGER FIRED/, `${id} must be reported`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The shared-chrome limbs. The mechanism's safety property is that it CANNOT
// quietly do nothing, so every way it could go silent has a case here.
describe('the shared chrome relationship', () => {
  test('a tree whose pages carry their sentinels passes, and reports the count', () => {
    const root = tree([SUBLY]);
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /page\(s\) carry shared chrome from tooling\/sites\/chrome\.mjs/);
  });

  test('🔴 a page that LOSES a sentinel fails, naming the page', () => {
    // The silent-rot case. Without this the page keeps serving whatever chrome
    // it last had while every file count above still includes it.
    const root = tree([SUBLY]);
    generate(root);
    const home = readFileSync(p(root, 'index.html'), 'utf8');
    writeFileSync(p(root, 'index.html'), home.replace('<!-- /CHROME:footer -->', ''));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /index\.html/);
    assert.match(r.out, /sentinel|chrome region/);
  });

  test('🔴 a DUPLICATED pair fails - the second copy would be left stale and served', () => {
    const root = tree([SUBLY]);
    generate(root);
    const home = readFileSync(p(root, 'index.html'), 'utf8');
    writeFileSync(p(root, 'index.html'), home + home);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /sentinel|chrome region/);
  });

  test('🔴 a NEW page is in the contract the moment it exists', () => {
    // The property a hardcoded page list could not give: a page nobody
    // classified is exactly how a site grows a second footer.
    const root = tree([SUBLY]);
    generate(root);
    writeFileSync(p(root, 'about.html'), '<html><body>about</body></html>\n');
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /about\.html/);
  });

  test('a dated snapshot is NOT asked for chrome - it is a record, not a page', () => {
    const root = tree([SUBLY]);
    generate(root);
    mkdirSync(p(root, 'legal', '2026-08-10', 'en'), { recursive: true });
    writeFileSync(p(root, 'legal', '2026-08-10', 'en', 'privacy.html'),
      '<meta name="robots" content="noindex"><html><body>frozen policy</body></html>\n');
    const r = guard(root);
    assert.equal(r.code, 0, r.out);
  });

  test('🔴 a snapshot that grows a <script> FAILS - the record would start moving', () => {
    const root = tree([SUBLY]);
    generate(root);
    mkdirSync(p(root, 'legal', '2026-08-10', 'en'), { recursive: true });
    writeFileSync(p(root, 'legal', '2026-08-10', 'en', 'privacy.html'),
      '<meta name="robots" content="noindex"><html><body>f<script>x()</scr' + 'ipt></body></html>\n');
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /contains a <script>/);
  });

  test('🔴 an exemption that outlived its subject FAILS, in a directory that exists', () => {
    // A standing exemption for a file that is gone is a hole waiting for a
    // future page to be dropped into it. Scoped to directories the tree models,
    // so a fixture that never had the area is not faulted for its absence.
    const root = tree([SUBLY]);
    generate(root);
    mkdirSync(p(root, 'fullshot'), { recursive: true });
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /not served from/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Limb G. Before it existed the web pages had NO accessibility assertion of any
// kind -- assert-a11y-coverage.mjs sounds like it covers them and is scoped to
// Flutter screens. Each of the five properties gets a failing case, because a
// limb whose failing input nobody has written is a limb nobody has checked.
describe('the web accessibility chrome', () => {
  const mutate = (root, fn) => {
    const f = p(root, 'index.html');
    writeFileSync(f, fn(readFileSync(f, 'utf8')));
    return guard(root);
  };

  test('a tree with the chrome passes, and says what it checked', () => {
    const root = tree([SUBLY]);
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /carry lang \+ one <main> \+ a skip link that resolves/);
  });
  test('a deploy root where NOTHING is a chrome page is COVERAGE LOST, and the run stops there', () => {
    // 🔴 THIS CASE IS ALSO THE EVIDENCE FOR A DELETION, WHICH IS WHY IT SITS
    // IN THE ACCESSIBILITY SUITE. That limb used to carry its own coverage
    // exit, `if (found.length > 0 && a11yChecked === 0)`. It could never fire:
    // the chrome limb one block up walks the same root with byte-identical
    // code, filters it with the same `found.filter(isChromePage)`, increments
    // its counter in the same place — so the two counters are always equal —
    // and its identical exit runs FIRST through a `coverageLost` that calls
    // `process.exit(1)`.
    // MEASURED 2026-08-22, and BOTH halves of the measurement are needed:
    // pinning `found.length > 0` in the accessibility exit to FALSE left the
    // whole committed suite green at 105 tests / 105 pass / 0 fail, EXIT 0 —
    // no case anywhere could tell it from nothing; and this tree, the only
    // shape that could ever have reached it, prints the CHROME limb's line and
    // ends. The accessibility exit was deleted rather than pinned, and this
    // case is what keeps the surviving refusal honest.
    // `_template.html` is the one served page that is CHROME_EXCLUDED, so a
    // root holding only it is a root where nothing is a chrome page.
    const only = tree([SUBLY]);
    unlinkSync(p(only, 'index.html'));
    const r = guard(only);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /1 \.html file\(s\) are served from sites\/nikatru and NONE of them was treated as a chrome page/);
  });

  test('🔴 a page with no <html lang> FAILS', () => {
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, (h) => h.replace('<html lang="en">', '<html>'));
    assert.equal(r.code, 1);
    assert.match(r.out, /no <html lang/);
  });

  test('🔴 zero <main> elements FAILS, and so would two', () => {
    const root = tree([SUBLY]); generate(root);
    const none = mutate(root, (h) => h.replace('<main id="main">', '<div>').replace('</main>', '</div>'));
    assert.equal(none.code, 1);
    assert.match(none.out, /has 0 <main> element\(s\)/);

    const root2 = tree([SUBLY]); generate(root2);
    const two = mutate(root2, (h) => h.replace('<main id="main">', '<main id="main"></main><main>'));
    assert.equal(two.code, 1);
    assert.match(two.out, /has 2 <main> element\(s\)/);
  });

  test('🔴 a skip link whose target does not exist FAILS - worse than having none', () => {
    // The case that matters most: the page LOOKS like it solved the problem.
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, (h) => h.replace('id="main"', 'id="content"'));
    assert.equal(r.code, 1);
    assert.match(r.out, /no element carries that id/);
  });

  test('🔴 a missing skip link FAILS', () => {
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, (h) => h.replace(/<a[^>]*skip-link[^>]*>[^<]*<\/a>/, ''));
    assert.equal(r.code, 1);
    assert.match(r.out, /has no skip link/);
  });

  test('🔴 no :focus-visible rule FAILS', () => {
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, (h) => h.split(':focus-visible').join('.nope'));
    assert.equal(r.code, 1);
    assert.match(r.out, /declares no :focus-visible/);
  });

  test('🔴 an <img> with no alt FAILS, and alt="" is accepted as decorative', () => {
    const root = tree([SUBLY]); generate(root);
    const bad = mutate(root, (h) => h.replace('</main>', '<img src="/x.png"></main>'));
    assert.equal(bad.code, 1);
    assert.match(bad.out, /no alt attribute/);

    // 🔴 THE DIMENSIONS ON THIS LINE ARE NOT DECORATION. They were added
    // 2026-08-21 with the width/height limb, and without them this "accepted"
    // case exits 1 — which is the point: the positive control has to satisfy
    // EVERY rule the limb enforces, or it stops being evidence that alt="" is
    // what was accepted.
    const root2 = tree([SUBLY]); generate(root2);
    const ok = mutate(root2, (h) => h.replace('</main>', '<img src="/x.png" alt="" width="4" height="4"></main>'));
    assert.equal(ok.code, 0, ok.out);
  });
  test('🔴 data-lang is NOT lang, and xml:lang is NOT lang — both FAIL', () => {
    // 🔴 THE `\b` HOLE, THIRD COPY. `/<html[^>]+\blang\s*=/` puts a word
    // boundary between `-` and `l`, so it fired on `data-lang` — and on the `:`
    // of `xml:lang` — and the page was then COUNTED into the ok line's
    // "page(s) carry lang + …". A screen reader reads none of those.
    // MEASURED 2026-08-22 against the real guard before the repair: the
    // data-lang tree exited 0. Same shape as the width/height limb's
    // `data-width` case, in a limb that predates it.
    const dataLang = tree([SUBLY]); generate(dataLang);
    const a = mutate(dataLang, (h) => h.replace('<html lang="en">', '<html data-lang="en">'));
    assert.equal(a.code, 1, a.out);
    assert.match(a.out, /has no <html lang/);
    assert.doesNotMatch(a.out, /page\(s\) carry lang \+ one <main>/);

    const xmlLang = tree([SUBLY]); generate(xmlLang);
    const b = mutate(xmlLang, (h) => h.replace('<html lang="en">', '<html xml:lang="en">'));
    assert.equal(b.code, 1, b.out);
    assert.match(b.out, /has no <html lang/);
    // 🔴 AND `lang` MUST NAME A LANGUAGE. The matcher ends `["'][a-z]{2}`, and
    // that class was unfalsifiable until this arm: MEASURED 2026-08-22 in a
    // scratchpad copy, dropping it left the committed suite green at 103 tests
    // / 103 pass / 0 fail, EXIT 0. `lang=""` is exactly what a template ships
    // when the slot was never filled, and it declares nothing — the attribute
    // is present and the screen reader is still guessing.
    const emptyLang = tree([SUBLY]); generate(emptyLang);
    const c = mutate(emptyLang, (h) => h.replace('<html lang="en">', '<html lang="">'));
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /has no <html lang/);
  });

  test('a skip target written `id = "main"` RESOLVES — the whitespace the pattern claimed to allow', () => {
    // 🔴 PINS THE `\\s` REPAIR. The target check is built with `new RegExp` from
    // a TEMPLATE LITERAL, where `\s` is not an escape and collapsed to a bare
    // `s`: the pattern was `ids*=s*["']main["']`. It matched `id="main"` only
    // because `s*` also matches zero `s`, so no committed case could see the
    // bug — and a page writing the same attribute with spaces around the `=`,
    // which is legal HTML, was reported as a skip link resolving to nothing.
    // MEASURED 2026-08-22 before the repair: this tree exited 1 with "no
    // element carries that id" over an id that plainly exists.
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, (h) => h.replace('id="main"', 'id = "main"'));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /page\(s\) carry lang \+ one <main> \+ a skip link that resolves/);
  });

  test('🔴 data-alt is NOT alt — the tag has no alternative text and must not be CERTIFIED', () => {
    // 🔴 THE `\b` HOLE, SECOND COPY, in the limb whose ok line says "+ alt on
    // every <img>". `data-alt` is what a lightbox or a gallery script really
    // stashes a caption in, and `/\balt\s*=/` accepted it as the alt attribute.
    // MEASURED 2026-08-22 against the real guard before the repair: this tree
    // exited 0 and printed the alt claim. The dimensions are on the tag so that
    // the box limb cannot be what fails it — this case has to be about alt.
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, (h) => h.replace('</main>', '<img src="/x.png" data-alt="x" width="4" height="4"></main>'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has an <img> with no alt attribute/);
    assert.doesNotMatch(r.out, /alt on every <img>/);
  });
  test('a custom element whose name STARTS with img is not an <img> — neither limb may demand anything of it', () => {
    // 🔴 PINS THE `(?![-\w])` IN BOTH <img> SCANS. `\b` stood there until
    // 2026-08-22 and it is a boundary between `g` and any NON-word character —
    // and a custom element name is required to contain a hyphen, so
    // `<img-comparison-slider>`, a real published web component, matched both
    // scans: the accessibility limb demanded `alt` on it and the box limb
    // demanded pixel width and height. MEASURED that day by restoring `\b` in
    // a scratchpad copy and running THIS tree against it: EXIT 1, two problems,
    // "sites/nikatru/index.html has an <img> with no alt attribute:
    // <img-comparison-slider first="/a.png" second="/b.png">" and "... has a
    // served <img> with no integer width and no integer height attribute:"
    // over the same element. This is the FALSE-POSITIVE direction of the same defect as
    // `data-width` — a guard that fails a correct page is a guard somebody
    // works around — and with `\b` no committed case could see it.
    const root = tree([SUBLY]); generate(root);
    //
    // 🔴 AND `<main-nav>` IS THE SAME DEFECT IN THE <main> COUNTER, one block
    // up: `/<main\b/gi` counted it, so this page reported "2 <main> element(s),
    // expected exactly 1" and failed. That counter now reads `<main(?![-\w])`.
    // Both elements are in ONE fixture on purpose — a page that adopts web
    // components adopts more than one, and each of the three scans in these two
    // limbs had the identical `\b`.
    const r = mutate(root, (h) => h.replace('</main>', '<img-comparison-slider first="/a.png" second="/b.png"></img-comparison-slider><main-nav aria-hidden="true"></main-nav></main>'));
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /with no alt attribute/);
    // and it is not counted as a served image either
    assert.match(r.out, /0 served <img> tag\(s\)/);
    // nor as a second <main>
    assert.doesNotMatch(r.out, /<main> element\(s\)/);
  });
});

// ── the box a served <img> reserves, and the og:image block ──────────────────
// Both landed 2026-08-21 in one pass, because both edits are in the same two
// files. The real-tree measurements they encode are in the header above (M15-M20).
describe('a served <img> reserves its box before the bytes arrive', () => {
  const mutate = (root, fn) => {
    const f = p(root, 'index.html');
    writeFileSync(f, fn(readFileSync(f, 'utf8')));
    return guard(root);
  };
  const withImg = (tag) => (h) => h.replace('</main>', `${tag}</main>`);

  test('a tree whose images are sized passes, and the run SAYS how many it checked', () => {
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, withImg('<img src="/x.png" alt="x" width="440" height="275">'));
    assert.equal(r.code, 0, r.out);
    // The domain, printed. A limb whose count is invisible can quietly reach 0.
    assert.match(r.out, /1 served <img> tag\(s\) across sites\/nikatru reserve their box/);
  });

  test('🔴 no width FAILS, no height FAILS, and neither FAILS naming both', () => {
    const noW = tree([SUBLY]); generate(noW);
    const a = mutate(noW, withImg('<img src="/x.png" alt="x" height="275">'));
    assert.equal(a.code, 1);
    assert.match(a.out, /no integer width attribute/);
    assert.doesNotMatch(a.out, /no integer height/);

    const noH = tree([SUBLY]); generate(noH);
    const b = mutate(noH, withImg('<img src="/x.png" alt="x" width="440">'));
    assert.equal(b.code, 1);
    assert.match(b.out, /no integer height attribute/);

    const neither = tree([SUBLY]); generate(neither);
    const c = mutate(neither, withImg('<img src="/x.png" alt="x">'));
    assert.equal(c.code, 1);
    assert.match(c.out, /no integer width and no integer height attribute/);
  });

  test('🔴 width="100%" FAILS — the attribute is present and reserves NOTHING', () => {
    // The case a presence-only check passes. HTML width/height on <img> are
    // non-negative integers in CSS pixels; a percentage is discarded as an
    // unparseable presentational hint, so the tag looks compliant and shifts
    // the page exactly as much as a tag with no attributes at all.
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, withImg('<img src="/x.png" alt="x" width="100%" height="100%">'));
    assert.equal(r.code, 1);
    assert.match(r.out, /no integer width and no integer height attribute/);
  });
  test('🔴 width="0" height="0" FAILS — a zero box reserves nothing either', () => {
    // 🔴 THE LAST INPUT FOR WHICH THIS LIMB'S OK LINE WAS FALSE. `\d+` accepted
    // `0`, so a tag reserving a 0x0 box was counted as one that "reserve[s]
    // their box with integer width+height". The value halves read `[1-9]\d*` as
    // of 2026-08-22; MEASURED that day against the real guard before the
    // change, this tree exited 0 and printed the certification sentence.
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, withImg('<img src="/x.png" alt="x" width="0" height="0">'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no integer width and no integer height attribute/);
    assert.doesNotMatch(r.out, /1 served <img> tag\(s\) across sites\/nikatru reserve their box/);

    // And a leading zero is not a pixel count either: `0440` is not 440.
    const lead = tree([SUBLY]); generate(lead);
    const z = mutate(lead, withImg('<img src="/x.png" alt="x" width="0440" height="275">'));
    assert.equal(z.code, 1, z.out);
    assert.match(z.out, /no integer width attribute/);
    assert.doesNotMatch(z.out, /no integer height/);
  });
  test('every value form HTML allows passes, on BOTH attributes, and a junk suffix does not', () => {
    // 🔴 PINS EVERY ALTERNATIVE INSIDE BOTH MATCHERS, ON BOTH ATTRIBUTES.
    // Each matcher is `(?:"\s*[1-9]\d*\s*"|'\s*[1-9]\d*\s*'|[1-9]\d*(?=[\s/>]))`
    // and every other case in this file writes a tight double-quoted value, so
    // the single-quoted alternative, the unquoted alternative and the `\s*`
    // padding had no input that could tell them from nothing.
    // MEASURED, NOT ASSUMED, in this pass's mutation sweep (2026-08-22, a
    // scratchpad copy of tooling/ + sites/, never the repo): deleting the
    // single-quoted alternative, deleting the unquoted alternative and deleting
    // the `\s*` padding — each on the width matcher and again on the height
    // matcher, six mutations — redden THIS case and NOTHING ELSE in the suite.
    // "and nothing else" is the half that matters: it is what says no other
    // case was ever exercising them.
    // All three quoting forms are legal HTML that authors and formatters really
    // emit, so a limb that understands only one of them fails a compliant page
    // — the opposite direction from the `data-width` hole, and just as wrong.
    const padded = tree([SUBLY]); generate(padded);
    const a = mutate(padded, withImg('<img src="/x.png" alt="x" width=" 440 " height=" 275 ">'));
    assert.equal(a.code, 0, a.out);
    assert.match(a.out, /1 served <img> tag\(s\) across sites\/nikatru reserve their box/);

    const single = tree([SUBLY]); generate(single);
    const b = mutate(single, withImg("<img src=\"/x.png\" alt=\"x\" width=' 440 ' height=' 275 '>"));
    assert.equal(b.code, 0, b.out);

    const bare = tree([SUBLY]); generate(bare);
    const c = mutate(bare, withImg('<img src="/x.png" alt="x" width=440 height=275/>'));
    assert.equal(c.code, 0, c.out);

    // 🔴 AND THE LOOKAHEAD BITES. `440x` is not 440 px: without `(?=[\s/>])`
    // the matcher takes the leading digits of a junk value and CERTIFIES the
    // tag — the `width="100%"` defect wearing a different value. Only the width
    // is named, which is what proves the lookahead is doing it and not a
    // blanket rejection of the tag.
    const junk = tree([SUBLY]); generate(junk);
    const d = mutate(junk, withImg('<img src="/x.png" alt="x" width=440x height=275>'));
    assert.equal(d.code, 1, d.out);
    assert.match(d.out, /no integer width attribute/);
    assert.doesNotMatch(d.out, /no integer height/);
    // 🔴 AND THE SAME JUNK ON THE OTHER ATTRIBUTE, because these are TWO
    // regexes and the arm above only exercises one of them. MEASURED
    // 2026-08-22 in a scratchpad copy: deleting the HEIGHT lookahead alone left
    // the committed suite green at 103 tests / 103 pass / 0 fail, EXIT 0 — the
    // half that was still a decoration after the width half had a case.
    const junkH = tree([SUBLY]); generate(junkH);
    const e = mutate(junkH, withImg('<img src="/x.png" alt="x" width=440 height=275x>'));
    assert.equal(e.code, 1, e.out);
    assert.match(e.out, /no integer height attribute/);
    assert.doesNotMatch(e.out, /no integer width/);
  });

  test('🔴 data-width/data-height FAIL — a prefixed copy is not the attribute, and must not be CERTIFIED', () => {
    // Added 2026-08-21 for the second defect in the same regex. `\bwidth` puts a
    // word boundary between `-` and `w`, so the first version of this limb fired
    // on `data-width="440"` — and the consequence is worse than a miss: with no
    // problem to report the run exits 0 AND prints "1 served <img> tag(s) …
    // reserve their box", so the guard affirmatively certifies a tag that
    // reserves nothing. `data-*` is legal author markup a lazy-loader really
    // uses to stash intrinsic size for JS, so this is a plausible page, not a
    // contrived one.
    //
    // 🔴 THE MESSAGE IS ASSERTED, NOT ONLY THE CODE, for the M18 reason: the
    // exit code alone passes against a limb that stopped looking, and the ok
    // line is the half that was actively FALSE before the fix.
    const root = tree([SUBLY]); generate(root);
    const r = mutate(root, withImg('<img src="/x.png" alt="x" data-width="440" data-height="275">'));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no integer width and no integer height attribute/);
    assert.doesNotMatch(r.out, /1 served <img> tag\(s\) across sites\/nikatru reserve their box/);

    // The mixed shape: one real attribute, one prefixed. Only the prefixed half
    // is named, which is what proves the two regexes were tightened separately
    // rather than the whole tag being rejected for carrying a `data-` at all.
    const half = tree([SUBLY]); generate(half);
    const h = mutate(half, withImg('<img src="/x.png" alt="x" width="440" data-height="275">'));
    assert.equal(h.code, 1, h.out);
    assert.match(h.out, /no integer height attribute/);
    assert.doesNotMatch(h.out, /no integer width/);
  });

  test('an <img> inside <script> or inside a comment is NOT an element, and does not fail', () => {
    // 🔴 THE DISCRIMINATING PAIR. Both inputs are byte-for-byte the failing tag
    // from the case above; only their surroundings differ. If stripInert were
    // dropped for a bare regex these two go red, and the guard would be
    // demanding pixel attributes on a string inside a program — which is the
    // live shape at sites/nikatru/index.html:502, whose box is pinned by CSS
    // (.app-icon 56x56, flex:none) and shifts nothing.
    const inScript = tree([SUBLY]); generate(inScript);
    const a = mutate(inScript, withImg('<script>const t = `<img src="/x.png" alt="x">`;</script>'));
    assert.equal(a.code, 0, a.out);
    assert.match(a.out, /0 served <img> tag\(s\)/);

    const inComment = tree([SUBLY]); generate(inComment);
    const b = mutate(inComment, withImg('<!-- <img src="/x.png" alt="x"> or an emoji -->'));
    assert.equal(b.code, 0, b.out);
    assert.match(b.out, /0 served <img> tag\(s\)/);
  });

  test('the check reaches pages the CHROME limb skips by name, not just the 11 it scans', () => {
    // _template.html is CHROME_EXCLUDED and still SERVED — the guard's own ok
    // line says so — and it is the sheet every future app page is copied from.
    // An unsized <img> there would be inherited, so the walk must reach it.
    const root = tree([SUBLY, { ...SUBLY, slug: 'x', name: 'X' }]);
    writeFileSync(p(root, 'apps', '_template.html'), TEMPLATE.replace('</body>', '<img src="/s.webp" alt="[APP NAME] shot"></body>'));
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /_template\.html has a served <img> with no integer width/);
  });
});

describe('the og:image block is complete and its numbers are the file\'s', () => {
  test('a generated tree carries all four properties on every landing, sized from the PNG', () => {
    const root = tree([SUBLY]);
    assert.equal(generate(root).code, 0);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    for (const prop of ['og:image', 'og:image:width', 'og:image:height', 'og:image:alt']) {
      assert.match(html, new RegExp(`<meta property="${prop}" content="[^"]+">`), `${prop} missing`);
    }
    // The hub gets the identical block — one constant, two templates.
    const hub = readFileSync(p(root, 'apps', 'index.html'), 'utf8');
    assert.match(hub, /<meta property="og:image:width" content="1200">/);
    assert.match(hub, /<meta property="og:image:height" content="630">/);

    const r = guard(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 generated page\(s\) carry all four og:image properties, sized 1200x630 from the IHDR/);
  });

  test('🔴 THE M12 CASE — a page whose declared size disagrees with the real image FAILS', () => {
    // The one input limb A structurally CANNOT see. The generator writes the
    // page and the page matches the generator byte-for-byte, so the drift limb
    // is green; only a limb that opens the PNG itself can tell that the number
    // is wrong. Same shape as limb G reading the rail config rather than
    // importing commerceFor().
    const root = tree([SUBLY], { ogPx: { w: 800, h: 418 } });
    assert.equal(generate(root).code, 0);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /declares og:image 1200x630 and sites\/nikatru\/og-image\.png is actually 800x418/);
    // and it is NOT the drift limb complaining — the bytes still agree.
    assert.doesNotMatch(r.out, /DRIFTED/);
  });
  test('🔴 ONE axis disagreeing is enough — width alone FAILS, height alone FAILS', () => {
    // 🔴 THIS EXISTS BECAUSE THE CASE ABOVE CANNOT TELL THE TWO HALVES APART.
    // The comparison is `w !== String(ogImagePx.w) || h !== String(ogImagePx.h)`
    // and the M12 fixture (a real 800x418 under a declared 1200x630) disagrees
    // on BOTH numbers, so EITHER disjunct alone still fires and that case still
    // passes. MEASURED 2026-08-22 in a scratchpad copy of tooling/, not
    // reasoned: pinning the width half to `false`, and pinning the height half
    // to `false`, each left the whole committed suite green. A half that no
    // input distinguishes is a decoration. These two trees are that input.
    const wOnly = tree([SUBLY], { ogPx: { w: 800, h: 630 } });
    assert.equal(generate(wOnly).code, 0);
    const a = guard(wOnly);
    assert.equal(a.code, 1, a.out);
    assert.match(a.out, /declares og:image 1200x630 and sites\/nikatru\/og-image\.png is actually 800x630/);

    const hOnly = tree([SUBLY], { ogPx: { w: 1200, h: 418 } });
    assert.equal(generate(hOnly).code, 0);
    const b = guard(hOnly);
    assert.equal(b.code, 1, b.out);
    assert.match(b.out, /declares og:image 1200x630 and sites\/nikatru\/og-image\.png is actually 1200x418/);
  });

  // ⚠️ THE NEXT THREE CASES ARE BUILT BY EDITING A GENERATED PAGE, so limb A
  // (DRIFT) CO-FIRES and `code === 1` is reached whether or not limb H exists.
  // THE MESSAGE ASSERTION IS THE DISCRIMINATING HALF — proved 2026-08-21 by
  // neutralising each condition in a scratchpad copy of the guard: the exit code
  // stayed 1 (drift) and the limb-H message vanished (M17/M18 in the header).
  // Read the exit code as a smoke alarm and the message as the evidence.
  test('🔴 a page that loses ONE of the four FAILS, per property, naming it', () => {
    for (const prop of ['og:image:width', 'og:image:height', 'og:image:alt']) {
      const root = tree([SUBLY]); generate(root);
      const f = p(root, 'apps', 'subly.html');
      writeFileSync(f, readFileSync(f, 'utf8').replace(new RegExp(`<meta property="${prop}"[^>]*>\n`), ''));
      const r = guard(root);
      assert.equal(r.code, 1, `${prop} removal was accepted`);
      assert.match(r.out, new RegExp(`carries og:image but no ${prop}\\b`), `${prop} not named`);
      // 🔴 AND IT MUST NOT ALSO INVENT A SIZE COMPLAINT. This pins the
      // `w !== null && h !== null` guard on the IHDR comparison further down
      // the same limb. Without it, a page that has lost og:image:width compares
      // the string "null" against 1200 and pushes a SECOND problem reading
      // "declares og:image nullx630 … is actually 1200x630", which sends the
      // reader to the artwork instead of to the property that is gone.
      // MEASURED 2026-08-22 in a scratchpad copy: with both null guards pinned
      // true the whole committed suite stayed green, because every other case
      // in this file supplies all four properties.
      assert.doesNotMatch(r.out, /declares og:image .* is actually /, `${prop} removal invented a size complaint`);
    }
  });

  test('🔴 an EMPTY og:image:alt FAILS — the property is present and says nothing', () => {
    const root = tree([SUBLY]); generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/(<meta property="og:image:alt" content=")[^"]*/, '$1'));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /an empty og:image:alt/);
  });

  test('🔴 losing og:image ALTOGETHER FAILS, and says the card is scavenged', () => {
    const root = tree([SUBLY]); generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/<meta property="og:image(:[a-z]+)?"[^>]*>\n/g, ''));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /declares no og:image at all/);
  });

  test('🔴 the ASSET missing FAILS, and says how many pages point at it', () => {
    // Nothing else in this repository asserts that og-image.png exists, which
    // was measured 2026-08-21: `grep -rn og-image tooling/` returns only this
    // generator's two emitters and one unrelated cache-policy fixture.
    // ⚠️ NARROWED THE SAME DAY, and the domain is the whole point. Re-run after
    // this pass's last edit, `grep -rln og-image tooling/ .github/` names FOUR
    // files, not three — assert-discovery-surface.mjs, generate-discovery.mjs,
    // this file, and tooling/ci/test/web-cache-policy.test.mjs. (No line count
    // is written here: several of the lines it would count are these comments,
    // so the number would grow every time somebody explains it.) The fourth is
    // a CONCURRENT change: tooling/ci/test/web-cache-policy.test.mjs now
    // asserts set equality (its `the real sites/rajasekarselvam ships EXACTLY
    // the six stable-named .png files` case) between a written inventory and
    // the walked .png files of
    // sites/rajasekarselvam — which DOES make that root's og-image.png a file
    // something else requires. It says nothing about SITES/NIKATRU's copy, the
    // only one this limb reads. So the sentence above holds for the deploy root
    // under test and no longer holds repository-wide; read it as the former.
    const root = tree([SUBLY], { ogImage: false });
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /og-image\.png is missing or is not a PNG whose IHDR can be read, and 2 generated page\(s\) point/);
  });

  test('🔴 a file that is not a PNG FAILS rather than being read as one', () => {
    const root = tree([SUBLY]); generate(root);
    writeFileSync(p(root, 'og-image.png'), 'GIF89a this is not a png, and 24 bytes of it are not an IHDR');
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /is not a PNG whose IHDR can be read/);
  });
  test('🔴 a TRUNCATED header FAILS as a report, not as a stack trace', () => {
    // 🔴 THIS PINS `head.length === 24`, WHICH NOTHING REACHED. The case above
    // is 61 bytes, so its `head` is a full 24 and only the IHDR half of that
    // conjunction ever decides anything — MEASURED 2026-08-22 in a scratchpad
    // copy, pinning `head.length === 24` to true left the committed suite
    // green. The input that tells the halves apart is a file SHORTER than 24
    // bytes that still says IHDR where a PNG says it: the string test passes,
    // `head.readUInt32BE(16)` then reads past the end and throws, and the guard
    // dies before ANY limb reports — the run's whole output becomes a V8 stack.
    // A 16-byte file is not exotic; it is what a truncated upload leaves.
    const root = tree([SUBLY]); generate(root);
    const short = Buffer.alloc(16);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(short, 0);
    short.writeUInt32BE(13, 8); // the IHDR payload length a real PNG carries
    short.write('IHDR', 12, 'latin1');
    // The two properties that make this input dangerous, ASSERTED rather than
    // described — if a later edit lengthens the buffer or moves the tag, this
    // case silently stops being the truncation case.
    assert.equal(short.length, 16);
    assert.equal(short.subarray(12, 16).toString('latin1'), 'IHDR');
    writeFileSync(p(root, 'og-image.png'), short);

    const r = guard(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is not a PNG whose IHDR can be read/);
    // THE DISCRIMINATING HALF: a crash also exits non-zero. The limb has to be
    // the thing that spoke.
    assert.doesNotMatch(r.out, /RangeError|ERR_OUT_OF_RANGE|readUInt32BE/);
  });
});
