#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-site-integrity.mjs — the static sites are code too.
//
// `sites/nikatru` and `sites/rajasekarselvam` are deployed by Cloudflare's own
// Git integration, on every push to main, with no GitHub workflow involved. Until
// this guard existed **nothing in the repo so much as parsed them** — including
// `sites/nikatru/functions/api/subscribe.js`, 110 lines of real server code
// holding a KV binding that stores email signups. A syntax error there ships to
// production within a minute and produces no signal anywhere.
//
// Cloudflare cannot be gated by a GitHub check. So the protection is indirect:
// with `main` protected (F-5a), code that cannot pass this lane cannot reach
// `main`, and therefore cannot reach Cloudflare.
//
// What this checks — deliberately shallow, and honest about it:
//   · every Pages Function parses (catches a typo, NOT wrong logic or a bad key)
//   · every deploy root still ships the files that break the site if missing
//   · every APP-FACING deploy root still ships real privacy/terms/refund pages
//   · ONE canonical URL form — canonicals, sitemap, internal links and the store
//     metadata trees all name the same URL for the same page
//   · a page's `data-policy-version` and its sitemap `lastmod` agree
//   · a Function that reads the client IP fingerprints it with a KEYED hash
//   · a promise a Function quotes from the site copy is still ON the site copy
//   · the site's app list and catalog/apps.json do not disagree
//
// That last one is not cosmetic. Both app stores require a reachable privacy
// policy; `sites/nikatru` is the policy host for every app we publish. Deleting
// `privacy.html` used to pass this lane, pass ci-gate, and deploy — the first
// signal would have been a store takedown. Nothing in the repo noticed.
//
// Pipeline requirement: Private/requirements/ → F-9.
// (Stage 1's prose, pipeline/01-foundation.md, was folded into that JSON spec
// 2026-08-15; the id still resolves against an `origin` field there.)
//
// Usage:  node tooling/ci/check-site-integrity.mjs [repoRoot] [claimedRoot...]
// Exit 0 = clean, 1 = a site is broken or the scan lost its coverage.
//
// `claimedRoot` arguments (e.g. `sites/nikatru`) are the CI lane's structural
// claim over the Cloudflare-Git-deployed sites. assert-lane-coverage.mjs used to
// accept those two paths appearing in a workflow COMMENT as proof they were
// covered (2026-08-01 full-corpus review) — prose satisfying a coverage check.
// Naming them as arguments makes the claim load-bearing at both ends: the run
// line in ci.yml is the text the lane guard matches, and THIS script fails if a
// claimed root is not actually among the deploy roots it scans, so the claim
// cannot outlive the thing it claims.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, resolve, dirname, sep, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// ONE reading of "what a person saw on this page", shared with the archive and
// claims guards. See tooling/ci/text-reductions.mjs for why it is not four copies.
// `stripSourceComments` is the same module's reading of "what this file's CODE
// says", and it is here for the same reason: the Pages-Function limb below had
// been letting a comment stand in for the code it was checking.
import { stripInert, visibleText, stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';
// ONE reading of "when did this page last change", shared with the generator
// that WRITES sites/nikatru/sitemap.xml. See tooling/sites/lastmod.mjs for why
// the writer and the checker must evaluate the same function. [pipeline 12]W-3a
import { lastmodFor, isGitRepo, isShallowRepo } from '../sites/lastmod.mjs';

const repoRoot = process.argv[2] ?? process.cwd();
const claimedRoots = process.argv.slice(3);
const SITES = join(repoRoot, 'sites');

/** A deploy root is a directory under sites/ that ships an index.html.
 *  `sites/_shared` is an Eleventy source layer, not a deploy root, and is
 *  correctly excluded by that test rather than by a hardcoded name. */
// [pipeline 12]W-3b, 2026-08-02. `sitemap.xml` and `llms.txt` were NOT here, and
// the sitemap relationship below sat behind an `if (existsSync(...))` — so
// deleting sites/rajasekarselvam/sitemap.xml passed this lane, passed ci-gate,
// and shipped, with the check that would have caught a drifted sitemap quietly
// skipping instead. A discovery surface is not optional decoration: the sitemap
// is how every page on these roots is found, and llms.txt is the machine-readable
// description an assistant reads INSTEAD of the pages. Deleting either is a
// deploy that loses a channel, and nothing said so.
const REQUIRED_FILES = ['index.html', '404.html', 'robots.txt', '_headers', 'sitemap.xml', 'llms.txt'];

/** The pages a store reviewer (and Indian e-commerce rules, for refunds) expects
 *  to resolve on the site that fronts a published app.
 *
 *  `delete-account.html` joined the set on 2026-08-03 ([pipeline K-7], INC-12).
 *  It is here rather than in PRINTED_LEGAL_GAPS because — unlike the pricing
 *  page — it needs no owner decision to exist: it describes what the code
 *  already does. A published deletion route with no published way to find it is
 *  the orphan K-7 is named after, and it is the URL a store reviewer opens when
 *  an app offers accounts. Adding it here is what makes the 1000-character
 *  visible-text floor, the <h1> check, the canonical form, the sitemap relation
 *  and the navigation walker all apply to it — the same treatment the other
 *  three get, with no second code path. */
const LEGAL_PAGES = ['privacy.html', 'terms.html', 'refund.html', 'delete-account.html'];

/** "Still a real page" without matching prose the owner alone may edit:
 *  a size floor measured on VISIBLE TEXT (so a fat <script> or a base64 image
 *  cannot pad a stub past it) plus a rendered-heading marker. The smallest real
 *  page today is refund.html at 2,329 visible characters, so this floor is a
 *  stub detector, not an editorial constraint on how long a policy may be. */
const MIN_LEGAL_TEXT_CHARS = 1000;

/** WHO IS SELLING. NIKATRU is a trading name; the legal person behind every
 *  published app and every payment is a sole proprietor, and a terms page that
 *  names only the brand tells a buyer nothing about who they contracted with —
 *  the thing a store reviewer, a payment processor's seller verification and a
 *  refund dispute all turn on. Already true at the time this limb was written,
 *  and true in three separate hand-written documents, which is exactly why it
 *  needed asserting: nothing would have noticed a rewrite dropping it.
 *
 *  ⚠️ THIS CONSTANT IS A DECLARED FACT, and a declared fact inside a guard is a
 *  second source of truth. That is why it is checked against TWO independently
 *  authored pages below rather than one: a wrong value here fails loudly on both
 *  instead of quietly agreeing with the single page it was copied from. The
 *  business SSoT that would otherwise own it lives outside this (public)
 *  repository, so there is no in-tree file to derive it from. [pipeline K-2a] */
const SELLER_LEGAL_NAME = 'Rajasekar Selvam';
const MUST_NAME_SELLER = ['terms.html', 'privacy.html'];

/** [12]W-3a — how the lastmod limb proves it is still scanning.
 *
 * 🔴 A HARDCODED `['nikatru','rajasekarselvam']` WAS WRITTEN FIRST AND REJECTED,
 * on evidence rather than taste: it turned seven self-hosted fixtures red,
 * because a fixture that scaffolds one deploy root can never satisfy a list that
 * names two. The pressure that creates is entirely in the wrong direction — the
 * cheap way out is to shorten the list, and a coverage floor somebody shortens
 * to make a test pass is a coverage floor that has already stopped working.
 *
 * What replaced it is a RELATIONSHIP with no number and no name in it: EVERY
 * deploy root whose sitemap was compared to its pages must also have contributed
 * at least one `<lastmod>` compared to git. It holds for two roots and for
 * twenty, it is satisfiable by a one-root fixture, and there is nothing in it to
 * lower. A root going dark ENTIRELY is deliberately not re-asserted here: the
 * `claimedRoot` arguments already fail this script when a root named on the CI
 * run line is not among the roots it scanned, and ci.yml names both. */
const LASTMOD_FLOOR = 'every sitemap-compared root contributes a git-checked lastmod';

/** Pages an app-facing root owes that CANNOT be a build failure yet, each with
 *  the owner item that unblocks it. The split is [pipeline C-6]'s and this file
 *  already uses it for the unannounced-app case: adding `pricing.html` to
 *  LEGAL_PAGES today would fail every CI run on copy only the owner can write
 *  and prices only the owner can publish — and a guard that cries wolf is one
 *  somebody switches off.
 *
 *  When the page lands, this prints the promotion instead, and the flip into
 *  LEGAL_PAGES is a one-line change after which the 1000-character floor, the
 *  <h1> check and the navigation walker all apply unchanged. */
const PRINTED_LEGAL_GAPS = new Map([
  [
    'pricing.html',
    'a published price list. A store reviewer and a payment processor\'s seller verification both look for one, ' +
      'and the prices are already decided — only the copy and the go-live are outstanding (OWNER_QUEUE O-3).',
  ],
]);

/** Deploy roots that MUST be treated as app-facing, named rather than sniffed.
 *  The heuristics below (an apps/ directory, a relative link to a legal page)
 *  exist to catch a NEW site nobody added here — they are not trusted to keep
 *  covering the one we already know about, because a heuristic that stops
 *  matching reports "clean". Enforced only when scanning the repository this
 *  script lives in; guard fixtures are synthetic trees with no nikatru. */
const REQUIRED_LEGAL_ROOTS = ['nikatru'];

const selfDir = dirname(fileURLToPath(import.meta.url));
const SCANNING_OWN_REPO = (selfDir + sep).startsWith(resolve(repoRoot) + sep);

/** A scan that quietly matches nothing reports "clean" forever. */
const MIN_SITES = 2;
const MIN_FUNCTIONS = 1;

/** THE CANONICAL URL FORM, picked once and enforced everywhere.
 *
 *  `https://<host>/<path>.html`, the extension kept, the homepage being the bare
 *  origin — and internal links to those pages written ROOT-RELATIVE (`/x.html`).
 *
 *  Why this form and not extensionless: it is what every already-published
 *  surface says. apps/subly/store/<channel>/privacy-policy-url.txt (five of them,
 *  the URL a store reviewer opens), the four page canonicals, every sitemap
 *  <loc>, llms.txt, and sites/nikatru/apps/_template.html's own footer all use
 *  `.html`. Extensionless would have been a defensible choice on an empty tree;
 *  here it would mean re-submitting five store listings to match a preference.
 *
 *  Why it needs a guard at all: nothing joined those surfaces up. On 2026-08-01
 *  the four subpages linked each other document-relative (`privacy.html`) while
 *  the app template a directory away linked them root-relative (`/privacy.html`),
 *  and both render identically from the site root — so the inconsistency was
 *  invisible until a page moves into a subdirectory and the relative form
 *  silently resolves somewhere else. */
const CANONICAL_FORM = 'https://<host>/<page> (homepage: https://<host>/), linked as /<page>';

/** The client-IP header a Cloudflare Function reads. Named once: the limb below
 *  and its message both quote it. */
const IP_HEADER = 'cf-connecting-ip';

const problems = [];
const prints = [];

function walk(dir, out = []) {
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

if (!existsSync(SITES)) {
  console.error(`✗ no sites/ directory under ${repoRoot}`);
  process.exit(1);
}

const siteRoots = listDir(SITES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(SITES, e.name, 'index.html')))
  .map((e) => join(SITES, e.name));

// ── required files ───────────────────────────────────────────────────────────
for (const root of siteRoots) {
  for (const f of REQUIRED_FILES) {
    if (!existsSync(join(root, f))) {
      problems.push(`missing ${relative(repoRoot, join(root, f))}`);
    }
  }
}

// ── legally-required pages on app-facing deploy roots ────────────────────────
// `stripInert` / `visibleText` are imported from tooling/ci/text-reductions.mjs
// (top of file). They used to be declared here, and three later guards needed
// the same reduction — a second copy of "what a reader actually saw" is a second
// answer to the question the 1000-character floor, the archive comparison and
// the claims register all ask.

/** Legal pages this document links to with a SAME-SITE relative href
 *  (`privacy.html`, `./privacy.html`, `/privacy.html`). An absolute URL is
 *  deliberately ignored: it may point at another property, and resolving it
 *  would need a host map this guard has no business owning. */
function linkedLegalPages(html) {
  const found = new Set();
  const stripped = stripInert(html);
  for (const m of stripped.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const url = m[1].trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('#')) continue;
    const file = url.split(/[?#]/)[0].split('/').pop()?.toLowerCase();
    if (file && LEGAL_PAGES.includes(file)) found.add(file);
  }
  return found;
}

const htmlIn = (root) => walk(root).filter((f) => f.toLowerCase().endsWith('.html'));

/** Which legal pages this deploy root owes, and why. Two independent tiers,
 *  because they answer different questions:
 *
 *  · APP-FACING — the site fronts a published app, so a store reviewer will look
 *    for the whole set whether or not the site links to it. Signalled by the
 *    name list (authoritative) or by shipping an apps/ directory (catches a new
 *    site nobody added to the list).
 *  · LINKED — any site, app-facing or not, that points a same-site link at a
 *    legal page owes THAT page. A dangling /privacy.html is a 404 where a policy
 *    was promised. Scoped to the linked page only: a brochure site that adds a
 *    privacy policy has not thereby taken on a refund policy.
 *
 *  A root matching neither (sites/rajasekarselvam today) is exempt by
 *  construction rather than by an exclusion list that would quietly rot. */
function legalDuties(root) {
  const name = root.slice(SITES.length + 1);
  const duties = new Map(); // page → why it is owed
  const reasons = [];

  const appFacing = [];
  if (SCANNING_OWN_REPO && REQUIRED_LEGAL_ROOTS.includes(name)) appFacing.push('named in REQUIRED_LEGAL_ROOTS');
  if (existsSync(join(root, 'apps'))) appFacing.push('ships an apps/ directory');
  if (appFacing.length) {
    reasons.push(`app-facing (${appFacing.join('; ')})`);
    for (const p of LEGAL_PAGES) duties.set(p, `app-facing site (${appFacing.join('; ')})`);
  }

  const linked = new Set();
  for (const f of htmlIn(root)) for (const p of linkedLegalPages(readFileSync(f, 'utf8'))) linked.add(p);
  if (linked.size) {
    reasons.push(`links to ${[...linked].sort().join(', ')}`);
    for (const p of linked) if (!duties.has(p)) duties.set(p, 'a same-site link points at it');
  }

  return { name, duties, reasons, appFacing: appFacing.length > 0 };
}

const boundRoots = [];
const appFacingRoots = [];
for (const root of siteRoots) {
  const { name, duties, reasons, appFacing } = legalDuties(root);
  if (appFacing) appFacingRoots.push({ root, name });
  if (!duties.size) continue;
  boundRoots.push({ name, count: duties.size, reasons });

  for (const [page, why] of duties) {
    const abs = join(root, page);
    const rel = relative(repoRoot, abs);
    if (!existsSync(abs)) {
      problems.push(`missing ${rel} — ${why}`);
      continue;
    }
    const raw = readFileSync(abs, 'utf8');
    const text = visibleText(raw);
    if (text.length < MIN_LEGAL_TEXT_CHARS) {
      problems.push(
        `${rel} is a stub — ${text.length} visible characters, floor is ${MIN_LEGAL_TEXT_CHARS}`,
      );
    }
    const h1 = stripInert(raw).match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
    if (!h1 || !h1[1].replace(/<[^>]*>/g, '').trim()) {
      problems.push(`${rel} has no rendered <h1> — it is not a readable policy page`);
    }
  }
}

// ── the commercial surface names a legal person, not just a brand ────────────
// [pipeline K-2a]. Two limbs, deliberately of different severities.
//
// Scoped to THIS repository, the same way REQUIRED_LEGAL_ROOTS is: both the
// proprietor's name and the pricing-page gap are facts about NIKATRU, and
// demanding them of a synthetic guard fixture would be this file asserting its
// own author's business details onto somebody else's tree. A fixture that
// deliberately models this repository (the self-hosted mode in
// site-integrity.test.mjs) carries them, which is the same bargain every other
// coverage floor here strikes.
let sellerNameChecks = 0;
/** The DOMAIN this limb quantifies over: app-facing roots × the pages that owe
 *  the name. Counted separately from the checks actually performed, because a
 *  page that is MISSING is already a reported problem — treating that as lost
 *  coverage would report the scan broken when the tree is broken, and send the
 *  fix to the wrong file. What can genuinely empty out is the domain. */
let sellerNameDomain = 0;
for (const { root, name } of SCANNING_OWN_REPO ? appFacingRoots : []) {
  for (const page of MUST_NAME_SELLER) {
    sellerNameDomain++;
    const abs = join(root, page);
    if (!existsSync(abs)) continue; // already reported as a missing legal page
    sellerNameChecks++;
    if (!visibleText(readFileSync(abs, 'utf8')).includes(SELLER_LEGAL_NAME)) {
      problems.push(
        `sites/${name}/${page} does not name ${JSON.stringify(SELLER_LEGAL_NAME)} anywhere in its visible text. ` +
          'NIKATRU is a trading name; a buyer, a store reviewer and a payment processor\'s seller verification all ' +
          'need the legal person behind the sale, and "who did I contract with" is the first question a refund ' +
          'dispute asks. (If the proprietor\'s registered name has changed, SELLER_LEGAL_NAME in this file changes ' +
          'with the pages, in the same commit.)',
      );
    }
  }
  // The owner-gated half: named, dated to an owner item, and printed EVERY run
  // so it cannot become permanent by being invisible.
  for (const [page, why] of PRINTED_LEGAL_GAPS) {
    const abs = join(root, page);
    if (!existsSync(abs)) {
      prints.push(
        `MISSING (owner-gated): sites/${name}/${page} — ${why} ` +
          'PRINTED, NOT FAILED: adding it to LEGAL_PAGES today would fail every CI run on work only the owner can ' +
          'do. Nothing else in this repo is blocked by it — a store submission accepts a screenshot where a live ' +
          'page is not yet available.',
      );
    } else {
      prints.push(
        `PROMOTE ME: sites/${name}/${page} now exists, so it no longer needs the owner-gated exemption. Move ` +
          `${JSON.stringify(page)} from PRINTED_LEGAL_GAPS into LEGAL_PAGES in this file — a one-line change, after ` +
          'which the visible-text floor, the <h1> check and the navigation walker all apply to it unchanged.',
      );
    }
  }
}

// ── ONE CANONICAL URL FORM ───────────────────────────────────────────────────
// canonical ⟷ og:url ⟷ sitemap <loc> ⟷ internal links ⟷ store metadata.
//
// Every one of those is a separate file naming the same page, and until this
// limb existed NOTHING compared them. Each is individually plausible; the bug is
// only ever visible in the relationship.

/** A `<link rel=canonical>` / `<meta property=og:url>` read ATTRIBUTE-ORDER
 *  INDEPENDENTLY. A single regex demanding rel-before-href would silently return
 *  null on a tag somebody reordered, and "no canonical" is the input this limb
 *  treats as a fault — so the miss would look like the fault, at the wrong file. */
function tagValue(html, tag, marker, valueAttr) {
  for (const m of stripInert(html).matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))) {
    if (!marker.test(m[0])) continue;
    const v = m[0].match(new RegExp(`${valueAttr}\\s*=\\s*["']([^"']+)["']`, 'i'));
    if (v) return v[1].trim();
  }
  return null;
}
const canonicalOf = (html) => tagValue(html, 'link', /rel\s*=\s*["']canonical["']/i, 'href');
const ogUrlOf = (html) => tagValue(html, 'meta', /property\s*=\s*["']og:url["']/i, 'content');

/** A page asking not to be indexed owes no canonical and belongs in no sitemap.
 *  This is what exempts sites/nikatru/apps/_template.html and the 404s BY THEIR
 *  OWN DECLARATION rather than by a filename list that would rot. */
const isNoindex = (html) => {
  const tag = tagValue(html, 'meta', /name\s*=\s*["']robots["']/i, 'content');
  return tag !== null && /noindex/i.test(tag);
};

const posixRel = (root, abs) => relative(root, abs).split(sep).join('/');

/** The one URL this page is allowed to call itself.
 *
 *  🔴 EXTENSIONLESS, and the `.html` form is now the defect. Cloudflare Pages
 *  "automatically redirects HTML files to extension-less versions: for instance,
 *  /contact.html will be redirected to /contact"
 *  (developers.cloudflare.com/pages/configuration/serving-pages/, 2026-08-20).
 *  So the `.html` spelling was never the served URL — it was a 308 TO the served
 *  URL, and every canonical, sitemap <loc> and store listing naming it was
 *  spending a redirect to reach the page it meant. Measured 2026-08-21 before
 *  this changed: 7 canonicals and 7 sitemap <loc>s in the `.html` form, all 7
 *  redirecting. Must stay identical to `urlForPage` in
 *  tooling/sites/generate-discovery.mjs; the sitemap↔pages set equality below
 *  is what makes a disagreement between the two loud. */
function expectedUrl(origin, page) {
  if (page === 'index.html') return origin;
  if (page.endsWith('/index.html')) return origin + page.slice(0, -'index.html'.length);
  return origin + page.replace(/\.html$/i, '');
}

/** `<url>` blocks of a sitemap, parsed as blocks so a <loc> keeps its <lastmod>.
 *  Reading the two with independent global regexes would pair them by ORDER, and
 *  a sitemap with one entry missing a lastmod would then shift every later date
 *  onto the wrong page while still looking parsed. */
function sitemapEntries(xml) {
  const out = [];
  for (const block of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url\s*>/gi)) {
    const loc = block[1].match(/<loc\s*>\s*([^<\s]+)\s*<\/loc\s*>/i);
    const lastmod = block[1].match(/<lastmod\s*>\s*([^<\s]+)\s*<\/lastmod\s*>/i);
    if (loc) out.push({ loc: loc[1].trim(), lastmod: lastmod ? lastmod[1].trim() : null });
  }
  return out;
}

/** Same-site hrefs/srcs, comments and scripts already removed. Returns the path
 *  as written, so the limb can judge the FORM and not just the destination. */
function sameSiteRefs(html) {
  const out = [];
  for (const m of stripInert(html).matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = m[1].trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('#') || raw === '') continue;
    out.push({ raw, path: raw.split(/[?#]/)[0] });
  }
  return out;
}

/** origin → the set of URLs that origin's pages claim as canonical. Consumed by
 *  the store-metadata cross-check below, so a store listing cannot point at a
 *  page this repo does not ship, or at the same page spelled another way. */
const canonicalByOrigin = new Map();
/** How many pages carried a `data-policy-version`, and how many store URLs were
 *  compared — the two limbs whose domain could silently empty out. */
let policyVersionsChecked = 0;
let storeUrlsChecked = 0;
let urlFormRoots = 0;
/** [12]W-3b — how many deploy roots had their sitemap compared to their pages.
 *  Zero is the state this limb spent its whole life one deletion away from. */
let sitemapRootsCompared = 0;
/** [12]W-3c — how many llms.txt files were read against the app registry. */
let llmsFilesChecked = 0;
/** [12]W-3a — how many sitemap `<lastmod>` values were compared to git, and
 *  WHICH roots contributed. The root NAMES are what the floor asserts: a count
 *  is a number somebody lowers, and "9 URLs checked" cannot tell you that all
 *  nine came from one root while the other stopped being scanned. */
let lastmodChecked = 0;
const lastmodRootsSeen = new Set();
/** root name → how many indexable pages it had. The other half of the
 *  `LASTMOD_FLOOR` relationship; see that constant for why it is not a name list. */
const sitemapRootsWithPages = new Map();

/** 🔴 SHALLOW CLONES MAKE THE LIMB ABOVE A LIE, NOT MERELY WEAKER. With
 *  `fetch-depth: 1` the checkout holds ONE synthetic commit that adds every
 *  file, so `git log -1 -- <any path>` answers with the HEAD date for
 *  everything — and a sitemap saying one identical date for every URL would
 *  pass. That is exactly the failure W-3's own research note named: "satisfied
 *  by any generator that touches git, including one that reads the repo's own
 *  HEAD date for every URL". So a shallow repository is COVERAGE LOST here, the
 *  same posture assert-policy-archive.mjs already takes for the same reason.
 *
 *  Checked BEFORE the roots are walked so the message is about the checkout and
 *  not about a date. Skipped when the tree under test is not a git work tree at
 *  all — guard fixtures are temp directories, and they degrade to `today()` on
 *  both sides of the comparison, which keeps them self-consistent. */
if (isGitRepo(repoRoot) && isShallowRepo(repoRoot)) {
  console.error('✗ COVERAGE LOST — the repository is a SHALLOW clone, so per-file git history is not present.');
  console.error('    In a depth-1 checkout `git log -1 -- <path>` answers with the single root commit for EVERY');
  console.error('    file, so a sitemap giving every URL the same date would pass the [12]W-3a lastmod limb');
  console.error('    forever. The lane that runs this guard must check out with `fetch-depth: 0`.');
  process.exit(1);
}

for (const root of siteRoots) {
  const name = root.slice(SITES.length + 1);
  const indexHtml = join(root, 'index.html');
  if (!existsSync(indexHtml)) continue;

  // The origin is READ from the root's own homepage canonical rather than
  // declared here: a host list in a guard is a second source of truth for the
  // site's own address, and the first one to be wrong after a domain change.
  const origin = canonicalOf(readFileSync(indexHtml, 'utf8'));
  if (origin === null) continue; // a root that claims no canonical at all is out of scope
  if (!/^https:\/\/[^/]+\/$/.test(origin)) {
    problems.push(
      `sites/${name}/index.html canonical is ${JSON.stringify(origin)} — the homepage canonical is what every other URL on this root is derived from, so it must be the bare origin with a trailing slash (form: ${CANONICAL_FORM}).`,
    );
    continue;
  }
  urlFormRoots++;

  const pages = htmlIn(root).map((abs) => ({ abs, page: posixRel(root, abs), html: readFileSync(abs, 'utf8') }));
  const indexable = pages.filter((p) => !isNoindex(p.html));
  /** EVERY file on this root, keyed by both spellings a <loc> can name it by: the
   *  served form and the `.html` form Pages 308s to it. Exact strings from the
   *  names on disk, never an existsSync() probe — that would resolve a
   *  case-different <loc> on Windows and not on Linux. */
  const servedBy = new Map();
  for (const p of pages) servedBy.set(origin + p.page, p.page);
  for (const p of pages) servedBy.set(expectedUrl(origin, p.page), p.page);
  const wanted = new Map(); // canonical URL → page
  const policyVersions = new Map(); // canonical URL → declared version

  for (const p of indexable) {
    const want = expectedUrl(origin, p.page);
    wanted.set(want, p.page);
    const got = canonicalOf(p.html);
    if (got === null) {
      problems.push(
        `sites/${name}/${p.page} declares no <link rel="canonical"> and is not noindex. Every indexable page names itself in exactly one form (${CANONICAL_FORM}); a page with no canonical is a page two URLs can both claim.`,
      );
    } else if (got !== want) {
      problems.push(
        `sites/${name}/${p.page} canonical is ${JSON.stringify(got)}, and the one form this site uses makes it ${JSON.stringify(want)}. Canonicals, the sitemap, the internal links and apps/*/store/*/privacy-policy-url.txt all have to name the same URL, or a store reviewer, a crawler and a visitor are each sent to a different one.`,
      );
    }
    const og = ogUrlOf(p.html);
    if (og !== null && got !== null && og !== got) {
      problems.push(
        `sites/${name}/${p.page} og:url is ${JSON.stringify(og)} but its canonical is ${JSON.stringify(got)}. Two self-references that disagree is the same page shared under one URL and indexed under another.`,
      );
    }
    const ver = p.html.match(/data-policy-version\s*=\s*["'](\d{4}-\d{2}-\d{2})["']/i);
    if (ver) policyVersions.set(want, { version: ver[1], page: p.page });
  }
  canonicalByOrigin.set(origin, new Set(wanted.keys()));

  // ── the sitemap must list exactly the indexable pages, by canonical URL ────
  const sitemapPath = join(root, 'sitemap.xml');
  // The absence itself is reported ONCE, by REQUIRED_FILES above — two messages
  // for one fault is how a fix chases the wrong one. What this counter defends
  // is the other failure: the limb running against ZERO roots and printing ok.
  if (existsSync(sitemapPath)) {
    sitemapRootsCompared++;
    sitemapRootsWithPages.set(name, wanted.size);
    const entries = sitemapEntries(readFileSync(sitemapPath, 'utf8'));
    const listed = new Set(entries.map((e) => e.loc));
    for (const [url, page] of wanted) {
      if (!listed.has(url)) {
        problems.push(
          `sites/${name}/sitemap.xml does not list ${url} (sites/${name}/${page}). An indexable page missing from the sitemap, or listed under a second spelling, is how the canonical form quietly forks.`,
        );
      }
    }
    for (const e of entries) {
      if (!wanted.has(e.loc)) {
        problems.push(
          `sites/${name}/sitemap.xml lists ${e.loc}, which is not the canonical URL of any indexable page on this root. Either the page is gone (the sitemap advertises a 404) or it is spelled in a second form (${CANONICAL_FORM}).`,
        );
      }
    }

    // ── [12]W-3a · EVERY `lastmod` IS THE FILE'S OWN GIT DATE ───────────────
    //
    // 🔴 THE CLAUSE THIS IMPLEMENTS, AND THE HOLE IT CLOSES. W-3's acceptance
    // says the sitemap's `lastmod` values "come from git history — a hand edit
    // fails the drift guard". Nothing asserted it. The ONLY `lastmod` limb in
    // the repository was #34 below, which compares ONE page's date to its
    // `data-policy-version` — so on 2026-08-06 six of the eight nikatru URLs and
    // the mirror's only URL could carry ANY date at all and no check would
    // notice. They did: the file claimed 2026-08-01/2026-08-03 (and 2026-07-18
    // on the mirror) while every page on both roots last changed 2026-08-04, in
    // `6605cc1`. Three separate live URLs were telling crawlers a false date.
    //
    // 🔴 WHY HERE AND NOT IN THE GENERATOR ALONE. `generate-discovery.mjs`
    // WRITES `sites/nikatru/sitemap.xml`, and the drift guard re-running it does
    // fail a hand edit — but only on that one root. `sites/rajasekarselvam` has
    // no generator and never will (an `apps/` directory there would make the
    // root app-facing and immediately owe four legal pages, which is why the
    // discovery generator refuses to touch it). This file already walks EVERY
    // deploy root and already owns the sitemap↔pages relationship, so this is
    // where the coverage is. The two sides share `tooling/sites/lastmod.mjs`, so
    // the writer and the checker evaluate ONE function and cannot disagree.
    //
    // ⚠️ A `lastmod` is required on every entry, not merely correct when
    // present. An optional assertion is one a hand edit escapes by deletion.
    for (const e of entries) {
      // 🔴 `wanted` IS THE INDEXABLE PAGES ONLY, so a <loc> naming a real file that
      // is not one of them — a noindex page, or the `.html` spelling — reached this
      // limb as undefined and skipped it, and its date was never compared to git.
      // `servedBy` answers from the FILES, so the two limbs no longer share one
      // lookup. The skip that remains is the honest one: a <loc> no file serves has
      // no page to take a git date from.
      const page = wanted.get(e.loc) ?? servedBy.get(e.loc);
      if (page === undefined) continue; // no file on this root serves this <loc>
      lastmodChecked++;
      lastmodRootsSeen.add(name);
      if (e.lastmod === null) {
        problems.push(
          `sites/${name}/sitemap.xml lists ${e.loc} with no <lastmod>. Google uses lastmod only where it is verifiably accurate and ignores changefreq/priority entirely, so lastmod is the ONE optional field worth emitting — and an entry without it is an entry a hand edit cannot be caught deleting.`,
        );
        continue;
      }
      const expected = lastmodFor(repoRoot, `sites/${name}/${page}`);
      if (e.lastmod !== expected) {
        problems.push(
          `sites/${name}/sitemap.xml gives ${e.loc} lastmod ${e.lastmod}, and sites/${name}/${page} last changed ${expected} according to git. The sitemap's dates are a FUNCTION of the repository (tooling/sites/lastmod.mjs), not a field somebody keeps up to date by hand — a date a crawler cannot rely on is worse than none, because it is the signal that decides whether the page is re-fetched. Run \`node tooling/sites/generate-discovery.mjs\` for sites/nikatru; sites/rajasekarselvam has one URL and is edited by hand.`,
        );
      }
    }

    // `changefreq`/`priority` are not merely useless, they are a value nothing
    // can check sitting next to one everything now can. Google states it ignores
    // both; keeping them invites a reader to maintain them.
    for (const dead of ['changefreq', 'priority']) {
      if (new RegExp(`<${dead}\\s*>`, 'i').test(readFileSync(sitemapPath, 'utf8'))) {
        problems.push(
          `sites/${name}/sitemap.xml carries a <${dead}> element. Google ignores changefreq and priority entirely (developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), so every one of them is an unverifiable claim that costs a reader attention and buys nothing. <loc> + <lastmod>, and nothing else.`,
        );
      }
    }

    // ── #34: a policy version and the sitemap date for that page agree ──────
    // The single line that makes the drift catchable. On 2026-08-01 privacy.html
    // said version 2026-07-26 while its sitemap lastmod said 2026-07-18 — eight
    // days of a crawler being told the policy had not changed, and nothing in the
    // repo could notice, because the two facts lived in different files and no
    // check spanned them.
    //
    // 🔴 RE-POINTED 2026-08-06 FROM `===` TO `>=`, and it was re-pointed rather
    // than deleted. Equality was correct while `lastmod` was hand-maintained and
    // the policy version was the only date anyone had. It is WRONG now that
    // `lastmod` is git-derived, and it was already wrong on the tree: privacy.html
    // declares version 2026-08-01 and its file last changed 2026-08-04, because
    // `6605cc1` edited the brand display name inside the copy without publishing
    // a new policy. Both facts are true and they answer different questions —
    // "which text is in force" versus "when did this page last change" — so an
    // equality between them makes a green tree impossible for a reason neither
    // fact is at fault for.
    //
    // What survives is the drift #34 actually existed to catch, and the recorded
    // failing case still fails: a page declaring version 2026-07-26 while the
    // sitemap says the page last changed 2026-07-18 is publishing a policy the
    // crawler is told does not exist yet. Its writable failing input today is a
    // POST-DATED version — declare 2026-09-01 in the page and the sitemap can
    // never reach it, because git cannot report a future date.
    for (const [url, { version, page }] of policyVersions) {
      policyVersionsChecked++;
      const entry = entries.find((e) => e.loc === url);
      if (!entry) continue; // already reported as a missing <loc>
      if (entry.lastmod !== null && entry.lastmod < version) {
        problems.push(
          `sites/${name}/${page} declares data-policy-version="${version}" and sites/${name}/sitemap.xml gives that page lastmod ${entry.lastmod} — EARLIER than the version it claims to be serving. The policy page IS its version: a crawler told the page last changed before the version it declares has been told the new text was never published, and the consent records that cite the version disagree with the page about which text was shown.`,
        );
      }
    }
  }

  // ── internal links: one form, and it resolves ─────────────────────────────
  //
  // 🔴 THIS LIMB WAS INVERTED ON 2026-08-21, and the inversion is the point.
  // It used to require `.html` and report the extensionless form as the defect
  // ("It resolves, which is the problem"). That had the redirect backwards:
  // Cloudflare Pages SERVES the extension-less URL and 308s `.html` TO it, so the
  // form the limb was enforcing was the one costing a redirect, on every internal
  // link, on every page. The relationship it protects is unchanged — ONE form,
  // and it resolves — only the form it names is now the served one.
  //
  // TWO SCOPE RULES, both of which the inversion forced and neither of which is
  // a softening:
  //
  //  1. THE FORM HALF SKIPS `noindex` PAGES; THE RESOLVES HALF DOES NOT. The one
  //     form exists to keep ONE canonical URL per page, and a noindex page is by
  //     its own declaration outside that relationship — which is exactly how the
  //     canonical and sitemap limbs above already treat it. Concretely this is
  //     what keeps the limb off `apps/_template.html` (allowlisted by name in
  //     assert-discovery-surface.mjs, deliberately served, deliberately noindex)
  //     and off the three DATED legal snapshots under `legal/`, which are frozen
  //     records: rewriting a link inside a published policy archive edits the
  //     record. A DANGLING link is still a defect on any page, indexable or not,
  //     so that half keeps its full scope.
  //
  //  2. A LINK TO A `_redirects` SOURCE RESOLVES. `checkout-return.html` links
  //     `/subly`, which is not a file — it is the permanent commerce address,
  //     declared in `_redirects`. Before the inversion nothing reached that link
  //     (it has no `.html`), so the limb had never had an opinion about it and
  //     the redirect map was unverified. Reading the map makes the link legal AND
  //     puts every redirect source under the same "it resolves" rule as a file.
  const redirectSources = (() => {
    const f = join(root, '_redirects');
    if (!existsSync(f)) return new Set();
    return new Set(
      readFileSync(f, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.split(/\s+/)[0])
        .filter((from) => from.startsWith('/')),
    );
  })();

  /** A reference that is actually a path. `_template.html`'s placeholder slots
   *  (`[WEB APP URL]`) are not links in any form, and a limb that scolds them for
   *  being document-relative is reporting on a token nobody ever meant as a URL. */
  const looksLikePath = (v) => /^[A-Za-z0-9._~\/-]+$/.test(v);

  for (const p of pages) {
    const pageIsNoindex = isNoindex(p.html);
    for (const { raw, path } of sameSiteRefs(p.html)) {
      const last = path.split('/').pop() ?? '';
      if (!looksLikePath(path)) continue;

      if (last.toLowerCase().endsWith('.html')) {
        if (pageIsNoindex) continue;
        problems.push(
          `sites/${name}/${p.page} links ${JSON.stringify(raw)}, the \`.html\` form of ${path.replace(/\.html$/i, '')}. Cloudflare Pages serves the extension-less URL and 308-redirects \`.html\` to it, so this link spends a redirect to reach the page it means, and is a second spelling of a URL only one form of which is canonical (${CANONICAL_FORM}).`,
        );
        continue;
      }

      if (path.startsWith('/') && last !== '' && !last.includes('.')) {
        if (redirectSources.has(path)) continue;
        if (!existsSync(join(root, `${path.slice(1).split('/').join(sep)}.html`))
          && !existsSync(join(root, path.slice(1).split('/').join(sep), 'index.html'))) {
          problems.push(
            `sites/${name}/${p.page} links ${JSON.stringify(raw)}, and no page and no _redirects rule backs that URL on this deploy root.`,
          );
        }
        continue;
      }

      // A document-relative page link resolves against the directory it is
      // written in, so the same footer means different things in / and /apps/.
      if (!path.startsWith('/') && last !== '' && !last.includes('.') && !pageIsNoindex) {
        problems.push(
          `sites/${name}/${p.page} links ${JSON.stringify(raw)} document-relative. Same-site page links use the root-relative form (${CANONICAL_FORM}).`,
        );
      }
    }
  }
}

// ── the store listings point at a URL this repo actually serves ──────────────
// apps/<app>/store/<channel>/privacy-policy-url.txt is the URL an App Store or
// Partner Center reviewer opens. It is written in one tree and served from
// another, and nothing joined them: the sites could rename every legal page and
// five store listings would keep pointing at the old URLs, still looking correct.
{
  const appsDir = join(repoRoot, 'apps');
  const urlFiles = existsSync(appsDir)
    ? walk(appsDir).filter((f) => /[/\\]store[/\\][^/\\]+[/\\][^/\\]*-url\.txt$/i.test(f))
    : [];
  for (const f of urlFiles) {
    const url = readFileSync(f, 'utf8').trim();
    const m = url.match(/^(https:\/\/[^/]+\/)/);
    if (!m) continue; // shape is assert-store-metadata.mjs's complaint, not this one
    const known = canonicalByOrigin.get(m[1]);
    if (!known) continue; // points at a host this repo does not deploy — out of scope
    storeUrlsChecked++;
    if (!known.has(url)) {
      problems.push(
        `${relative(repoRoot, f).split(sep).join('/')} points a store listing at ${url}, which is not the canonical URL of any indexable page this repo deploys to ${m[1]}. A store listing is the one URL a reviewer opens; if it is a second spelling of a real page today it is a takedown the day the redirect goes.`,
      );
    }
  }
}

// ── the site's app list vs catalog/apps.json ─────────────────────
// 🔴 THIS LIMB DELIBERATELY DOES NOT DECIDE WHETHER AN APP IS ANNOUNCED.
// Whether a "live" app is named on the public homepage is a launch decision the
// OWNER makes (soft launch vs launched), and no decision record answers it. What
// IS decidable without knowing that answer is whether the two files AGREE — so
// the limb ranges over the disagreement, in both directions, and treats them
// differently for the reason [pipeline C-6] gives:
//
//   site lists an app apps.json does not mark live -> FAIL. A store button or an
//     app card with nothing behind it is a promise made to a stranger, and an
//     agent can fix it by editing the registry or the page.
//   apps.json marks an app live and the site is silent -> PRINT, every run. The
//     fix is "announce it", which is owner work; failing the build on it would
//     block ALL CI on a decision only the owner can take, and a guard that cries
//     wolf gets switched off (assert-lane-coverage.mjs:14-17).
let appsArrayFound = false;
{
  const appsJsonPath = join(repoRoot, 'catalog', 'apps.json');
  const siteIndex = join(SITES, 'nikatru', 'index.html');
  if (existsSync(siteIndex)) {
    // A MISSING or unparseable apps.json is assert-channel-claims.mjs's
    // COVERAGE LOST, not this file's — two guards reporting one fault is how a
    // fix chases the wrong message. What this file owns is the ARRAY, so the
    // floor below tracks that and nothing else.
    let registry = [];
    try {
      registry = JSON.parse(readFileSync(appsJsonPath, 'utf8'));
    } catch {
      registry = [];
    }
    // RAW, not stripInert: the array lives inside a <script>, which stripInert
    // removes. Bracket-depth scan from `const APPS = [` so the INSTRUCTIONAL
    // comment above it — which contains a full example object, `name` and all —
    // cannot be mistaken for a listed app.
    const raw = readFileSync(siteIndex, 'utf8');
    const at = raw.search(/\bconst\s+APPS\s*=\s*\[/);
    if (at !== -1) {
      appsArrayFound = true;
      const open = raw.indexOf('[', at);
      let depth = 0;
      let end = open;
      for (let i = open; i < raw.length; i++) {
        const c = raw[i];
        if (c === '"' || c === "'" || c === '`') {
          const q = c;
          i++;
          while (i < raw.length && raw[i] !== q) i += raw[i] === '\\' ? 2 : 1;
          continue;
        }
        if (c === '/' && raw[i + 1] === '/') {
          i = raw.indexOf('\n', i);
          if (i === -1) break;
          continue;
        }
        if (c === '[') depth++;
        else if (c === ']' && --depth === 0) {
          end = i;
          break;
        }
      }
      const body = raw.slice(open, end + 1);
      const onSite = new Set([...body.matchAll(/\bname\s*:\s*["']([^"']+)["']/g)].map((m) => m[1].toLowerCase()));
      const live = new Map(
        (Array.isArray(registry) ? registry : [])
          .filter((a) => a && a.status === 'live' && typeof a.name === 'string')
          .map((a) => [a.name.toLowerCase(), a]),
      );

      for (const listed of onSite) {
        if (!live.has(listed)) {
          problems.push(
            `sites/nikatru/index.html lists an app "${listed}" in its APPS array, and catalog/apps.json has no entry with that name and status "live". The homepage is advertising an app the registry does not say is live — one of the two files is wrong, and a store button with nothing behind it is a promise made to a stranger.`,
          );
        }
      }
      for (const [key, app] of live) {
        if (!onSite.has(key)) {
          prints.push(
            `UNANNOUNCED: catalog/apps.json marks "${app.name}" status "live" (${app.url ?? 'no url'}), and sites/nikatru/index.html still ships an empty APPS array with the copy "our first releases are on the way". ` +
              'The two disagree. WHICH ONE IS RIGHT IS AN OWNER DECISION — a soft launch that is deliberately not announced is a legitimate state, and so is an announcement that was simply never written; no decision record answers it. ' +
              'Resolve it by either adding the app to the APPS array (and refreshing the pre-launch copy), or changing its apps.json status to something other than "live". Printed, not failed, so this cannot block CI on owner-only work — and printed EVERY run so it cannot become permanent.',
          );
        }
      }
    }
  }
}

// ── [pipeline 12]W-3c · llms.txt must not contradict the app registry ────────
//
// `llms.txt` is the machine-readable description an assistant reads INSTEAD of
// the pages, and it had ZERO coverage: the string appeared in this file exactly
// once, inside a comment. It was measurably lying — `sites/nikatru/llms.txt`
// said "First releases are on the way" and "Status: pre-launch" while
// `catalog/apps.json` marked `subly` live and
// `assert-catalog-reachable.mjs` proved its URL answers.
//
// 🔴 WHY THIS FAILS WHERE THE HOMEPAGE LIMB ONLY PRINTS. The homepage limb
// deliberately refuses to decide whether a live app is ANNOUNCED — a soft
// launch is a legitimate state and that is an owner's call. This is a different
// question. A file whose entire job is to state what the site is cannot say
// "pre-launch" while the registry says an app is live and the app answers on
// the public internet: that is not a launch-timing choice, it is a factual
// contradiction between two files in this repo, and an agent can fix either
// side. The announcement decision stays exactly where it was.
//
// Derived from `apps.json`, never from a keyword list somebody tunes. The one
// prose pattern below is a CONTRADICTION list, not a copy standard, and it says
// so. Platform-count claims are deliberately NOT touched here —
// `assert-channel-claims.mjs` owns those and PRINTS rather than fails, because
// site copy is the owner's voice; two guards on one fault is how a fix chases
// the wrong message.
{
  const appsJsonPath = join(repoRoot, 'catalog', 'apps.json');
  let registry = [];
  try {
    registry = JSON.parse(readFileSync(appsJsonPath, 'utf8'));
  } catch {
    registry = []; // a missing/unparseable registry is assert-channel-claims.mjs's complaint
  }
  const live = (Array.isArray(registry) ? registry : []).filter(
    (a) => a && a.status === 'live' && typeof a.url === 'string' && a.url,
  );
  const notLive = (Array.isArray(registry) ? registry : []).filter(
    (a) => a && a.status !== 'live' && typeof a.url === 'string' && a.url,
  );
  /** Phrases that cannot be true at the same time as a live registry entry.
   *  A CONTRADICTION list — not a house style, and not a claim about how the
   *  copy should read. Each one asserts the studio has shipped nothing. */
  const PRE_LAUNCH_CLAIMS = [
    /\bpre-?launch\b/i,
    /first releases? (?:are|is) on the way\b/i,
    /\bnot (?:yet )?(?:released|launched|available)\b/i,
    /\bcoming soon\b/i,
    // "first apps in active development" and "first NIKATRU releases in active
    // development" are the same claim with a brand dropped in the middle, and
    // the narrower pattern this replaced caught only the first — leaving the
    // mirror site making the identical false statement, unremarked, on the run
    // that first went red.
    /\bfirst\b[^.\n]{0,40}\breleases?\b[^.\n]{0,40}\bin active development\b/i,
    /\bfirst\b[^.\n]{0,40}\bapps?\b[^.\n]{0,40}\bin active development\b/i,
  ];
  const appFacingNames = new Set(appFacingRoots.map((r) => r.name));

  for (const root of siteRoots) {
    const name = root.slice(SITES.length + 1);
    const p = join(root, 'llms.txt');
    if (!existsSync(p)) continue; // absence is REQUIRED_FILES' complaint, reported once
    llmsFilesChecked++;
    const text = readFileSync(p, 'utf8');

    // (a) It may not advertise an app the registry does not call live. Same
    //     rule, same reason, as the homepage limb: a name with nothing behind
    //     it is a promise made to a stranger.
    for (const app of notLive) {
      if (text.includes(app.url)) {
        problems.push(
          `sites/${name}/llms.txt names ${app.url}, and catalog/apps.json gives "${app.name ?? app.slug}" status ` +
            `"${app.status}". An assistant reading this file will send someone to an app the registry does not say is live.`,
        );
      }
    }

    if (live.length === 0) continue;

    // (b) It may not claim the studio has shipped nothing while it has.
    for (const re of PRE_LAUNCH_CLAIMS) {
      const m = text.match(re);
      if (m) {
        problems.push(
          `sites/${name}/llms.txt says ${JSON.stringify(m[0])} while catalog/apps.json marks ` +
            `${live.map((a) => `"${a.name ?? a.slug}"`).join(', ')} live at ${live.map((a) => a.url).join(', ')}. ` +
            'The two files contradict each other. This is NOT the announcement question the homepage limb ' +
            'leaves to the owner — one of these two statements is simply false, and either side is an ' +
            'agent-sized edit: correct the copy, or change the registry status.',
        );
      }
    }

    // (c) On an APP-FACING root only, a live app must be findable by URL. The
    //     mirror ships an llms.txt too and is deliberately out of scope: it
    //     points readers at the studio rather than duplicating its catalogue,
    //     and forcing it to carry the list would be inventing a requirement
    //     nobody wrote.
    if (!appFacingNames.has(name)) continue;
    for (const app of live) {
      if (!text.includes(app.url)) {
        problems.push(
          `sites/${name}/llms.txt does not name ${app.url}, which catalog/apps.json marks live. ` +
            'This file exists to tell a machine reader what the site is; a live app it omits is a page the ' +
            'assistant will never mention and a user will never reach.',
        );
      }
    }
  }
}

// ── Pages Functions must at least parse ──────────────────────────────────────
// Pages Functions are ES modules in .js files. `node --check` assumes CommonJS
// for .js and would reject `export` as a syntax error, so each file is copied to
// a .mjs temp — the only extension Node treats as unambiguously ESM.
const functionsByRoot = siteRoots.map((root) => {
  const fnDir = join(root, 'functions');
  return { root, files: existsSync(fnDir) ? walk(fnDir).filter((f) => f.endsWith('.js')) : [] };
});
const functionFiles = functionsByRoot.flatMap((r) => r.files);

// ── what a Pages Function does with a visitor's IP, and what it promises ─────
// text-reductions.mjs returns an UNKNOWN extension VERBATIM and says nothing —
// the trap its own header records against `.kts`. Every file below is a `.js`
// Pages Function (the walk above filters on that extension), so this asserts the
// reduction still knows `.js` rather than assuming it: without the assertion, a
// reduction that stopped reducing would look exactly like a file with no
// comments, and the three limbs below would silently go back to reading prose.
// Same shape as the startup check in assert-no-do-alarms.mjs.
if (stripSourceComments('x // c', '.js') === 'x // c') {
  problems.push(
    'stripSourceComments() left a `.js` sample containing a comment completely unchanged. text-reductions.mjs returns an unknown extension VERBATIM and says nothing, so the Pages-Function limbs below would be reading comments as code — the precise defect they were amended to stop.',
  );
}
let ipReaders = 0;
let promiseMarkers = 0;
const saltSecrets = new Set();
for (const { root, files } of functionsByRoot) {
  const name = root.slice(SITES.length + 1);
  const rootHtml = htmlIn(root).map((f) => readFileSync(f, 'utf8'));
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    // The file's CODE, comments blanked to spaces (same length, same line
    // numbers, string literals untouched). The SITE PROMISE limb further down
    // keeps reading raw `src` on purpose — its subject IS a comment.
    const codeSrc = stripSourceComments(src, extname(file).toLowerCase());
    const where = relative(repoRoot, file).split(sep).join('/');

    if (codeSrc.toLowerCase().includes(IP_HEADER)) {
      ipReaders++;
      // 🔴 A KEYED hash, not a digest. `sha256(ip)` is not pseudonymisation: IPv4
      // is 2^32 values, so the whole space can be hashed and looked up — minutes
      // on a laptop, 256 tries for a known /24. This site's own privacy policy
      // promises we do not retain network identifiers, and a reversible one is a
      // network identifier wearing a hash.
      //
      // WHAT THIS DOES NOT CATCH, said plainly: it asserts the file HAS a keyed
      // construction and an env-sourced secret IN CODE, not that every path
      // through it uses them. A Function keeping the HMAC helper and adding a
      // second, unkeyed digest of the address beside it would pass. Catching
      // that needs dataflow, and an assertion that pretends to more reach than
      // it has is how a check stops checking without anyone noticing.
      // ("IN CODE" is the amendment below, and it is the only thing that changed
      // in this sentence: until 2026-08-21 all three limbs read RAW source, so
      // "HAS" meant "the token appears somewhere in the file, comments included".)
      //
      // AMENDED 2026-08-21 (`keyed`), EXTENDED 2026-08-22 to the other two limbs
      // it had been left beside — the IP-reader test above, `keyed` and `secrets`
      // now all read `codeSrc`, this file's comments blanked to spaces by the shared
      // reduction in tooling/ci/text-reductions.mjs (the same module the visible-
      // text reductions at the top of this file come from — there is one reader
      // of "what this text really says", not one per guard).
      //
      // MEASURED 2026-08-21 and re-measured unchanged 2026-08-22, on
      // sites/nikatru/functions/api/subscribe.js, the only
      // Pages Function in the tree (`find sites -path '*/functions/*' -name
      // '*.js'` returns exactly it):
      //     /HMAC/                raw 11, 19, 121, 132, 136  ->  132, 136
      //     crypto.subtle.sign(   raw 136                    ->  136
      //     cf-connecting-ip      raw 287                    ->  287
      //     env.*(SALT|SECRET|KEY) raw 288 SUBSCRIBE_RATE_LIMIT_SALT -> 288, same
      //     length 17734 -> 17734, blanked and never deleted, so every line
      //     number above is the same number in both views.
      // Three of the five /HMAC/ matches were the paragraph explaining why the
      // rate-limit key is an HMAC. House style FORBIDS deleting an explanatory
      // comment, so those three are PERMANENT: that half of the conjunction
      // could not go false no matter what the code did. NO VERDICT MOVES ON
      // TODAY'S TREE — every anchor survives the reduction and the guard prints
      // the same line before and after.
      //
      // BUT THE FALSE NEGATIVES ARE NOT HYPOTHETICAL, and that is the correction
      // to the earlier reading of this change as demonstrable-but-not-live. Each
      // one below was produced by RUNNING this guard, and each is pinned by a
      // test in tooling/ci/test/site-integrity.test.mjs that PASSES here and
      // FAILS against the raw-reading version (all three: guard EXIT 0):
      //   keyed     a Function that digests the address bare, mentions HMAC only
      //             in the note above it, and signs an unrelated unsubscribe
      //             token. Raw: reported clean.
      //   secrets   a Function with a hardcoded pepper whose only mention of the
      //             environment is `// the salt comes from env.PROBE_SALT`. Raw:
      //             exit 0 AND it PRINTED "must be set in Cloudflare: PROBE_SALT"
      //             — naming a Cloudflare secret no code reads while the key
      //             material sits in the repo. That is worse than silence.
      //   ipReaders a Function that moved to another header and left the old name
      //             in a comment still counted as a reader, which held up the
      //             COVERAGE LOST floor at the foot of this file. A floor whose
      //             whole job is to notice vacuous quiet was itself being
      //             satisfied by a sentence.
      //
      // The SITE PROMISE limb further down still reads RAW `src`, and must: its
      // subject IS a comment (subscribe.js:4 is the only such marker in the tree,
      // 1 match raw and 0 after the reduction), which is why `src` is not
      // rebound for the whole loop body. String literals pass through VERBATIM,
      // load-bearing here: "HMAC" at 132 and 136 IS a string literal, because
      // that is how WebCrypto names an algorithm, and a reduction that blanked
      // strings too would take this correct file to zero HMAC matches and fail
      // it. Do not "harden" this with stripStringLiterals.
      //
      // STILL NOT CAUGHT — the residue, not an exhaustive list: a file that keeps
      // the HMAC helper in code and digests the address beside it. That one needs
      // dataflow, which is why it is still open; anything cheaper than dataflow
      // that turns up should be fixed rather than added to this paragraph.
      const keyed = /crypto\.subtle\.sign\s*\(/.test(codeSrc) && /HMAC/.test(codeSrc);
      const secrets = [...codeSrc.matchAll(/\benv\.([A-Z][A-Z0-9_]*(?:SALT|SECRET|KEY)[A-Z0-9_]*)\b/g)].map((m) => m[1]);
      for (const s of secrets) saltSecrets.add(s);
      if (!keyed) {
        problems.push(
          `${where} reads the ${IP_HEADER} header and never calls crypto.subtle.sign with HMAC. An UNKEYED digest of an IP address is reversible by exhausting the address space, so storing one — even as a rate-limit key — is storing the address. Fingerprint it under a secret, or do not derive a stored key from it at all.`,
        );
      }
      if (secrets.length === 0) {
        problems.push(
          `${where} reads the ${IP_HEADER} header and reads no salt/secret/key from \`env\`. The secret is what makes the fingerprint one-way in practice; without one from the environment the key material is in the repo, which is not a secret.`,
        );
      }
    }

    // A promise a Function QUOTES from the site is a promise the site has to
    // still be making. Before this, subscribe.js quoted "your email only …
    // nothing else, ever" in a comment; nothing checked the page still said it,
    // and nothing would have noticed when the code began storing more.
    for (const m of src.matchAll(/SITE PROMISE:\s*"([^"]+)"/g)) {
      promiseMarkers++;
      if (!rootHtml.some((h) => h.includes(m[1]))) {
        problems.push(
          `${where} quotes a SITE PROMISE that no page under sites/${name} makes: ${JSON.stringify(m[1])}. Either the copy changed and the code's promise is now a lie, or the quote was retyped — and a promise the code believes it is keeping to text nobody serves is the worst of the two.`,
        );
      }
    }
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'nikatru-site-'));
try {
  for (const file of functionFiles) {
    const probe = join(scratch, `probe-${functionFiles.indexOf(file)}.mjs`);
    writeFileSync(probe, readFileSync(file, 'utf8'));
    const r = spawnSync(process.execPath, ['--check', probe], { encoding: 'utf8' });
    if (r.status !== 0) {
      const detail = (r.stderr ?? '').split('\n').find((l) => l.includes('Error')) ?? 'parse failed';
      problems.push(`${relative(repoRoot, file)} does not parse — ${detail.trim()}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ── coverage self-check, BEFORE reporting clean ──────────────────────────────
// A claimed root the scan does not actually reach is the lane guard's claim
// pointing at nothing — the caller (ci.yml) says "this script covers X" and X is
// not covered. Checked against the DISCOVERED deploy roots, not the filesystem:
// a directory that exists but lost its index.html is exactly a site this script
// has stopped checking.
{
  const scanned = new Set(siteRoots.map((r) => relative(repoRoot, r).replaceAll('\\', '/')));
  const dangling = claimedRoots.filter((c) => !scanned.has(c.replace(/\/+$/, '')));
  if (dangling.length) {
    console.error(
      `✗ COVERAGE LOST — the caller claims ${dangling.join(', ')} as scanned deploy root(s), but the scan found no such root.`,
    );
    console.error('  The CI lane is promising coverage this script does not deliver.');
    process.exit(1);
  }
}
if (siteRoots.length < MIN_SITES) {
  console.error(
    `✗ COVERAGE LOST — found ${siteRoots.length} deploy root(s) under sites/, expected at least ${MIN_SITES}.`,
  );
  console.error('  The scan is broken, not the tree.');
  process.exit(1);
}
if (functionFiles.length < MIN_FUNCTIONS) {
  console.error(
    `✗ COVERAGE LOST — found ${functionFiles.length} Pages Function(s), expected at least ${MIN_FUNCTIONS}.`,
  );
  console.error('  Server-side site code exists and is no longer being parsed.');
  process.exit(1);
}
// A named root that stops being scanned is the failure this whole file exists to
// prevent: "0 app-facing sites, all legal pages present" is what a deleted
// sites/nikatru would print without this.
if (SCANNING_OWN_REPO) {
  const bound = new Set(boundRoots.map((b) => b.name));
  const lost = REQUIRED_LEGAL_ROOTS.filter((n) => !bound.has(n));
  if (lost.length) {
    console.error(
      `✗ COVERAGE LOST — ${lost.map((n) => `sites/${n}`).join(', ')} is no longer scanned for legal pages.`,
    );
    console.error('  The store requirement did not go away; the guard stopped looking.');
    process.exit(1);
  }
}

// Every limb added on 2026-08-01 quantifies over something that can EMPTY OUT —
// a page that loses an attribute, an array that gets renamed, a walk that stops
// reaching a tree — and an empty domain makes each of them vacuously true while
// printing "ok". So each declares the smallest population it must still find.
// Enforced only when scanning the repository this script lives in: guard
// fixtures are synthetic trees that legitimately have none of these.
//
// Placed AFTER the legal-roots check on purpose. That one is the oldest and most
// specific claim this file makes, and a fixture that has lost sites/nikatru must
// still hear about sites/nikatru rather than about a policy-version attribute.
if (SCANNING_OWN_REPO) {
  const lost = [];
  if (urlFormRoots === 0) {
    lost.push('ZERO deploy roots declared a homepage canonical, so the one-canonical-URL-form limb compared nothing. Every canonical, sitemap <loc> and internal-link check hangs off that origin.');
  }
  if (policyVersionsChecked === 0) {
    lost.push('NO page carries a `data-policy-version` attribute, so the policy-version/sitemap-lastmod comparison ran zero times. sites/nikatru/privacy.html carries one; if it was renamed, re-point this limb.');
  }
  if (storeUrlsChecked === 0) {
    lost.push('NO apps/*/store/*/*-url.txt resolved to a host this repo deploys, so no store listing was compared to a page we serve. Five of them point at nikatru.com today.');
  }
  if (!appsArrayFound) {
    lost.push('`const APPS = [` was not found in sites/nikatru/index.html, so the site-list/apps.json comparison had nothing to compare. Renaming that array silently retires the check.');
  }
  if (ipReaders === 0) {
    lost.push(`NO Pages Function reads the ${IP_HEADER} header, so the keyed-fingerprint requirement ranged over an empty set. sites/nikatru/functions/api/subscribe.js does read it.`);
  }
  if (sitemapRootsCompared === 0) {
    lost.push('NO deploy root had its sitemap compared to its indexable pages. That limb used to sit behind an existsSync() skip, so a root with no sitemap produced silence; it is now a required file, and this says so if the comparison itself stops happening.');
  }
  if (llmsFilesChecked === 0) {
    lost.push('NO llms.txt was read against catalog/apps.json, so the machine-readable description of these sites was compared to nothing. Both deploy roots ship one.');
  }
  if (lastmodChecked === 0) {
    lost.push(
      'NO sitemap <lastmod> was compared to git history at all, so [12]W-3a ranged over nothing. This is the ' +
        'limb that makes a hand-edited date fail; with it quiet, every sitemap in the tree could carry any ' +
        'date at all and this script would still print ok — the exact state the repository was in until ' +
        '2026-08-06.',
    );
  }
  if (promiseMarkers === 0) {
    lost.push('NO Pages Function carries a `SITE PROMISE: "…"` marker, so no code-held promise was checked against the copy the site actually serves.');
  }
  if (sellerNameDomain === 0) {
    lost.push(
      `NO app-facing page was in scope for the seller's legal name, so the "${MUST_NAME_SELLER.join(' and ')} name a ` +
        'legal person" limb ranged over nothing. sites/nikatru owes both pages; if the app-facing classification ' +
        'stopped matching, that is what broke.',
    );
  }
  if (lost.length) {
    console.error(`✗ COVERAGE LOST — ${lost.length} check(s) below ran over an empty set and would report clean forever:`);
    for (const l of lost) console.error(`    ${l}`);
    process.exit(1);
  }
}

// ── [12]W-3a · THE RELATIONSHIP FLOOR, ON EVERY TREE AND NOT JUST THIS ONE ───
// Runs outside the SCANNING_OWN_REPO block on purpose: the other floors defend
// facts that are true of THIS repository (a policy version exists, an APPS array
// exists), and a synthetic tree legitimately has none of them. This one defends
// a property of the LIMB, which is equally true of any tree it is pointed at — a
// root whose sitemap was compared to its indexable pages, and which HAS
// indexable pages, must have had at least one date checked. Anything else means
// the loop ran and compared nothing, which prints exactly like a clean root.
{
  const silent = [...sitemapRootsWithPages]
    .filter(([name, pages]) => pages > 0 && !lastmodRootsSeen.has(name))
    .map(([name]) => name);
  if (silent.length) {
    console.error(`✗ COVERAGE LOST — ${LASTMOD_FLOOR}, and ${silent.length} did not:`);
    for (const name of silent) {
      console.error(
        `    sites/${name} has ${sitemapRootsWithPages.get(name)} indexable page(s) and a sitemap that was ` +
          'compared to them, yet ZERO of its <lastmod> values reached the git check. The sitemap↔pages limb ' +
          'and the lastmod limb walk the same entries, so one running while the other does not means the ' +
          'entries stopped matching a canonical URL — and a date nothing checks is a date a hand edit owns.',
      );
    }
    process.exit(1);
  }
}

if (problems.length) {
  console.error(`✗ ${problems.length} site problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}

console.log(
  `ok  site integrity — ${siteRoots.length} deploy root(s), ${functionFiles.length} function(s) parse, required files present`,
);
// Print the classification on every run: if a site silently drops off this list
// the diff shows it, which is the only warning a heuristic can honestly give.
console.log(
  `    legal pages enforced on ${boundRoots.length} deploy root(s)` + (boundRoots.length ? ':' : ''),
);
for (const b of boundRoots) console.log(`      sites/${b.name} — ${b.count} page(s): ${b.reasons.join('; ')}`);
console.log(
  `    one canonical URL form on ${urlFormRoots} root(s); ${policyVersionsChecked} policy version(s) not ahead of their sitemap lastmod, ${storeUrlsChecked} store listing URL(s) matched to a page we serve`,
);
console.log(
  `    ${lastmodChecked} sitemap <lastmod> value(s) equal their page's git date, across ${lastmodRootsSeen.size} root(s): ${[...lastmodRootsSeen].sort().join(', ')}`,
);
console.log(
  `    ${sellerNameChecks} commercial page(s) name the seller's legal person, not just the brand`,
);
// The secret is OWNER work — it lives in the Cloudflare dashboard, not the repo —
// so its NAME is printed every run. A guard that silently requires a secret
// nobody was told to set is a guard that ships a disabled feature.
if (saltSecrets.size) {
  console.log(
    `    ${ipReaders} Function(s) fingerprint the client IP under an env secret — must be set in Cloudflare: ${[...saltSecrets].sort().join(', ')}`,
  );
}

if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (the resolution is an OWNER decision; a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
