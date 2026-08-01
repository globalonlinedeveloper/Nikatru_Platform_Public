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
//
// That last one is not cosmetic. Both app stores require a reachable privacy
// policy; `sites/nikatru` is the policy host for every app we publish. Deleting
// `privacy.html` used to pass this lane, pass ci-gate, and deploy — the first
// signal would have been a store takedown. Nothing in the repo noticed.
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-9.
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
import { readdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = process.argv[2] ?? process.cwd();
const claimedRoots = process.argv.slice(3);
const SITES = join(repoRoot, 'sites');

/** A deploy root is a directory under sites/ that ships an index.html.
 *  `sites/_shared` is an Eleventy source layer, not a deploy root, and is
 *  correctly excluded by that test rather than by a hardcoded name. */
const REQUIRED_FILES = ['index.html', '404.html', 'robots.txt', '_headers'];

/** The pages a store reviewer (and Indian e-commerce rules, for refunds) expects
 *  to resolve on the site that fronts a published app. */
const LEGAL_PAGES = ['privacy.html', 'terms.html', 'refund.html'];

/** "Still a real page" without matching prose the owner alone may edit:
 *  a size floor measured on VISIBLE TEXT (so a fat <script> or a base64 image
 *  cannot pad a stub past it) plus a rendered-heading marker. The smallest real
 *  page today is refund.html at 2,329 visible characters, so this floor is a
 *  stub detector, not an editorial constraint on how long a policy may be. */
const MIN_LEGAL_TEXT_CHARS = 1000;

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

const problems = [];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
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

const siteRoots = readdirSync(SITES, { withFileTypes: true })
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
/** Blank out comments, <script> and <style> so a commented-out link cannot bind
 *  a site to a policy it never promised, and script source cannot be counted as
 *  page text. Replaced with a space rather than deleted — nothing here needs
 *  byte offsets, but keeping words apart keeps the text measure honest. */
function stripInert(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ');
}

function visibleText(html) {
  return stripInert(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

  return { name, duties, reasons };
}

const boundRoots = [];
for (const root of siteRoots) {
  const { name, duties, reasons } = legalDuties(root);
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

// ── Pages Functions must at least parse ──────────────────────────────────────
// Pages Functions are ES modules in .js files. `node --check` assumes CommonJS
// for .js and would reject `export` as a syntax error, so each file is copied to
// a .mjs temp — the only extension Node treats as unambiguously ESM.
const functionFiles = siteRoots.flatMap((root) => {
  const fnDir = join(root, 'functions');
  return existsSync(fnDir) ? walk(fnDir).filter((f) => f.endsWith('.js')) : [];
});

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
