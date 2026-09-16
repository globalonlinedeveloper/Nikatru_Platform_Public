#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-availability.mjs — a served page may not claim a channel the catalogue
// has not published to.
//
// 🔴 THE DEFECT, AND IT WAS FOUND IN OUR OWN DESIGN ARTEFACT. The design canvas
// for this component built its tiles by slicing a hand-ordered array and marking
// the first N live. On the real data that rendered **"App Store" as LIVE when
// the only live channel is `web`**. Nothing would have failed: the markup is
// well formed, the page is fast, the guard suite was green, and the claim was
// simply false. A store-badge row is the one piece of marketing copy on this
// site that a reader treats as a fact rather than as a promise — and nikatru.com
// is also the host of the store-required legal pages, so a false availability
// claim sits one link away from the privacy policy an app-store reviewer reads.
//
// Hand-written badge rows cannot be wrong in a way anybody notices. They can
// only be STALE, and staleness here is indistinguishable from a lie.
//
// ── WHAT THIS CHECKS ─────────────────────────────────────────────────────────
//  A. Every `<a>` inside a generated `.avail-tiles` block points at a URL that
//     is a NON-NULL `listings` value in catalog/apps.json. A tile that links
//     anywhere else was not derived from the catalogue.
//  B. Every generated block's tile count and live count equal the counts
//     re-derived here from the register ∩ the catalogue. This is the drift limb:
//     the HTML is committed (Cloudflare serves the repo with no build step), so
//     a register change that nobody regenerated for shows up as a disagreement.
//  C. 🔴 THE ANTI-HARDCODE LIMB, and the one with a real domain today. No served
//     page may carry a LINK whose text names a STORE channel the catalogue has
//     not published to. The channel names come from tooling/channel-register.json
//     — this file hardcodes no store names, because a hardcoded list of store
//     names is the same defect one level down.
//
// ── WHY C IS THE LIMB THAT MATTERS RIGHT NOW ─────────────────────────────────
// Zero pages carry an availability block today; the renderer
// (tooling/sites/availability.mjs) lands before the pages that use it. A guard
// whose domain is empty is a guard that reports clean over nothing, so A and B
// print their block count on every run and it cannot quietly become zero — while
// C's domain is EVERY served HTML file in sites/nikatru, which is non-empty now
// and is where a hand-written badge row would actually appear.
//
// ── THE REQUIREMENT THIS IS A SECOND LIMB OF ─────────────────────────────────
// [10]D-1 — "no channel is claimed that is not served". tooling/ci/
// assert-channel-register.mjs already holds that over `catalog/apps.json`'s
// `platforms` array: an app may not LIST a platform whose register row is not
// served. That is the DATA half. This is the PAGE half, and until now it did not
// exist — a page could name every store in the world while the catalogue behind
// it stayed honest, because nothing read the two together. The claim a buyer
// acts on is the one on the page.
//
// Usage:  node tooling/ci/assert-availability.mjs [repoRoot]
// Exit 0 = clean, 1 = a page claims a channel that is not published.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { stripInert } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';
import { availabilityRow } from './channel-arming.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const REGISTER = 'tooling/channel-register.json';
const CATALOGUE = 'catalog/apps.json';
const SITE = 'sites/nikatru';

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);

function read(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

function done() {
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-availability: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  · ${p}`);
    // ⏱ 2026-09-16 — O-EXIT2-CONVENTION-GAP. Exit 2 when EVERY problem is a COVERAGE LOST: the run did
    // not check enough to be evidence. Exit 1 when any is a finding — a proven defect outranks a blind
    // limb. This exited 1 for both until today. assert-guard-coverage.mjs reads this exact idiom.
    process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
  }
  console.log('✓ assert-availability: every channel claim on the site is one the catalogue published.');
  process.exit(0);
}

// ── COVERAGE, BEFORE ANY CONTENT CLAIM ───────────────────────────────────────
const rawRegister = read(REGISTER);
const rawCatalogue = read(CATALOGUE);
if (rawRegister === null) {
  coverageLost(
    `there is no register at ${REGISTER}. It is the only file that says which channels exist and whether ` +
      `they are served; without it every claim below would pass over an empty set.`,
  );
  done();
}
if (rawCatalogue === null) {
  coverageLost(
    `there is no catalogue at ${CATALOGUE}. It is the only file that says which storefronts hold a real ` +
      `listing, so "is this claim true" has no right-hand side.`,
  );
  done();
}

let register;
let catalogue;
try {
  register = JSON.parse(rawRegister);
} catch (e) {
  fail(`${REGISTER} is not valid JSON (${e.message}).`);
  done();
}
try {
  catalogue = JSON.parse(rawCatalogue);
} catch (e) {
  fail(`${CATALOGUE} is not valid JSON (${e.message}).`);
  done();
}

const channels = Array.isArray(register?.channels) ? register.channels : [];
const apps = Array.isArray(catalogue) ? catalogue.filter((a) => a !== null && typeof a === 'object') : [];
if (channels.length === 0) {
  coverageLost(`${REGISTER} declares no \`channels\`. Nothing here can be true or false about an empty register.`);
  done();
}
if (apps.length === 0) {
  coverageLost(`${CATALOGUE} holds no app rows, so no page can be checked against a listing.`);
  done();
}

// ── THE PUBLISHED TRUTH, DERIVED ONCE ────────────────────────────────────────
/** Every non-null listing URL across every app — the complete set of storefront
 *  destinations this site is entitled to link to. */
const publishedUrls = new Set();
/** storefrontKey → true when SOME app has published to it. */
const publishedKeys = new Set();
for (const app of apps) {
  const listings = app.listings !== null && typeof app.listings === 'object' ? app.listings : {};
  for (const [k, v] of Object.entries(listings)) {
    if (typeof v === 'string' && v.trim() !== '') {
      publishedUrls.add(v.trim());
      publishedKeys.add(k);
    }
  }
}

/** The STORE rows a page could name. `kind: "web"` is excluded deliberately: its
 *  label ("Web") is an ordinary English word and matching links on it would flag
 *  every navigation item on the site. */
const storeRows = channels.filter((c) => c?.kind === 'store' && typeof c?.name === 'string' && c.name !== '');

/** The names a link could plausibly use for a channel: the register's own name,
 *  and that name with a trailing parenthetical dropped — the same derivation
 *  tooling/sites/availability.mjs renders with. Nothing else; this guard invents
 *  no store vocabulary of its own. */
function namesFor(row) {
  const out = new Set([row.name]);
  const m = /^(.*?)\s*\([^()]*\)\s*$/.exec(row.name);
  if (m && m[1].trim() !== '') out.add(m[1].trim());
  return [...out];
}

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// ── THE PAGES ────────────────────────────────────────────────────────────────
function htmlUnder(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of listDir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && p.toLowerCase().endsWith('.html')) out.push(p);
    }
  };
  walk(abs);
  return out;
}

const pages = htmlUnder(SITE);
if (pages.length === 0) {
  coverageLost(
    `no HTML was found under ${SITE}. That is the deploy root Cloudflare serves; an empty scan here is ` +
      `indistinguishable from a site with nothing wrong on it.`,
  );
  done();
}

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i;
const ALT = /\balt\s*=\s*("([^"]*)"|'([^']*)')/gi;

let blocksSeen = 0;
let anchorsInBlocks = 0;
let anchorsScanned = 0;
const placeholderSkips = [];

for (const abs of pages) {
  const rel = relative(ROOT, abs).split(sep).join('/');
  const raw = readFileSync(abs, 'utf8');
  // The shared HTML reduction: comments and <script>/<style> bodies blanked, so
  // a store name inside a JS string or a CSS comment is not read as markup.
  const html = stripInert(raw);

  // ── A + B · generated availability blocks ──────────────────────────────────
  for (const block of html.match(/<ul\b[^>]*class="[^"]*\bavail-tiles\b[^"]*"[^>]*>[\s\S]*?<\/ul>/gi) ?? []) {
    blocksSeen += 1;
    ANCHOR.lastIndex = 0;
    let m;
    let liveInBlock = 0;
    while ((m = ANCHOR.exec(block)) !== null) {
      anchorsInBlocks += 1;
      liveInBlock += 1;
      const href = HREF.exec(m[1]);
      const url = (href?.[2] ?? href?.[3] ?? '').trim();
      if (!publishedUrls.has(url)) {
        fail(
          `${rel}: an availability tile links to ${JSON.stringify(url)}, which is not a non-null \`listings\` ` +
            `value in ${CATALOGUE}. Every tile URL is a projection of the catalogue — a tile pointing anywhere ` +
            `else was written by hand, and a hand-written tile is a claim nothing re-checks.`,
        );
      }
    }
    const tiles = (block.match(/<li\b/gi) ?? []).length;
    // The block does not name its app, so it is checked against the WHOLE
    // catalogue: some app must produce exactly these counts. A block matching no
    // app is drift, whichever app it belongs to.
    const matches = apps.some((app) => {
      const row = availabilityRow(channels, app.listings ?? {});
      return row.shown === tiles && row.live === liveInBlock;
    });
    if (!matches) {
      const shapes = apps
        .map((app) => {
          const row = availabilityRow(channels, app.listings ?? {});
          return `${app.slug}=${row.live}/${row.shown}`;
        })
        .join(', ');
      fail(
        `${rel}: an availability block renders ${tiles} tile(s) of which ${liveInBlock} are links, and no app in ` +
          `${CATALOGUE} derives that shape today (${shapes}). Either the register moved and this committed HTML ` +
          `was never regenerated, or the block was hand-edited. The site is served from the repo with no build ` +
          `step, so committed drift IS what a visitor sees.`,
      );
    }
  }

  // ── C · the anti-hardcode limb, over every anchor on the page ──────────────
  ANCHOR.lastIndex = 0;
  let a;
  while ((a = ANCHOR.exec(html)) !== null) {
    anchorsScanned += 1;
    const attrs = a[1];
    const inner = a[2];
    // What a reader sees: the link text, plus any image alt inside it — a store
    // badge is an <img>, so alt text is where its name lives.
    const alts = [];
    ALT.lastIndex = 0;
    let al;
    while ((al = ALT.exec(inner)) !== null) alts.push(al[2] ?? al[3] ?? '');
    const visible = norm(`${inner.replace(/<[^>]*>/g, ' ')} ${alts.join(' ')}`);
    if (visible === '') continue;

    for (const row of storeRows) {
      const key = typeof row.storefrontKey === 'string' && row.storefrontKey !== '' ? row.storefrontKey : null;
      if (key !== null && publishedKeys.has(key)) continue; // genuinely published — a link is honest
      const hit = namesFor(row).find((n) => visible === norm(n));
      if (hit === undefined) continue;
      const href = HREF.exec(attrs);
      const url = (href?.[2] ?? href?.[3] ?? '').trim();
      // 🔴 A BRACKETED HREF IS A TEMPLATE SLOT, NOT A CLAIM — and this is a rule
      // about the VALUE, deliberately not an allowlist of file names. `[PLAY
      // STORE URL]` is not a URL: nobody can follow it, it resolves to nothing,
      // and the surrounding page is visibly a template. sites/nikatru/apps/
      // _template.html is the file this exists for, and check-site-integrity.mjs
      // already exempts that same file BY NAME from two of its own limbs — a
      // name exemption here would be a third place to keep in step, and it would
      // let a real page hide a false badge simply by being called a template.
      // The skipped links are COUNTED and PRINTED on every run, so this cannot
      // quietly become the path every badge takes.
      if (/^\[[^\]]*\]$/.test(url)) {
        placeholderSkips.push(`${rel} → ${JSON.stringify(hit)}`);
        continue;
      }
      fail(
        `${rel}: a link reading ${JSON.stringify(hit)} points at ${JSON.stringify(url)}, but ${CATALOGUE} has no ` +
          `published listing for channel "${row.id}" ` +
          `(${key === null ? `the register gives it no \`storefrontKey\`, so it has no listing at all` : `\`listings["${key}"]\` is null for every app`}). ` +
          `A link naming a store the product is not on tells a reader it can be downloaded there. Render the ` +
          `availability row from tooling/sites/availability.mjs instead of writing badges by hand.`,
      );
    }
  }
}

// ── THE SELF-CHECK, AND THE SUMMARY A SHRINK CANNOT HIDE IN ──────────────────
if (anchorsScanned === 0) {
  coverageLost(
    `${pages.length} page(s) under ${SITE} were read and not one <a> was found in any of them. Limb C ranged ` +
      `over nothing, which is indistinguishable from a site with no false badge on it.`,
  );
}

const row = availabilityRow(channels, apps[0].listings ?? {});
for (const lost of row.lost) coverageLost(lost);

console.log(`availability, derived from ${REGISTER} ∩ ${CATALOGUE}:`);
for (const app of apps) {
  const r = availabilityRow(channels, app.listings ?? {});
  console.log(`      ${app.slug}: ${r.live} of ${r.shown} channel(s) live · ${r.tiles.map((t) => `${t.id}=${t.state}`).join(' ')}`);
}
notes.push(`${pages.length} page(s) scanned under ${SITE}; ${anchorsScanned} link(s) checked against ${storeRows.length} store channel(s)`);
if (placeholderSkips.length) {
  notes.push(
    `${placeholderSkips.length} store-named link(s) skipped as TEMPLATE SLOTS (href is a bracketed ` +
      `placeholder, not a URL): ${placeholderSkips.join(', ')}`,
  );
}
notes.push(
  `${blocksSeen} generated availability block(s) found, carrying ${anchorsInBlocks} tile link(s)` +
    (blocksSeen === 0
      ? ' — none yet: the renderer lands before the pages that use it, and limb C is what covers the site today'
      : ''),
);

done();
