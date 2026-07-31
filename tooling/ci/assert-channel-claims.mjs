#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-channel-claims.mjs — a public surface may not advertise a channel the
// factory does not serve, and may never advertise a disqualified one.
//
// [pipeline D-1] limb (ii) · "no channel is claimed that is not served"
// [pipeline D-7] the sites half · "the dead channel's tells are purged"
//
// ONE guard for two requirements, because both name this file and both are the
// same question asked of the same bytes. D-1 asks *is this channel served?*;
// D-7 asks *is this channel forbidden?* — a disqualified channel is the extreme
// case of an unserved one, and splitting them would mean two walks of the same
// tree with two coverage floors to keep in step.
//
// 🔴🔴 THE HOUSE RULE INVERTS HERE, AND THAT IS DELIBERATE — DO NOT "FIX" IT.
// Every other guard in this repo strips comments before scanning, each with its
// reason recorded (assert-stamp-platforms.mjs:39-45, assert-no-clone-tells.mjs:
// 12-19). THIS GUARD SCANS RAW TEXT, comments included, because here **the
// comment is the payload**: `sites/nikatru/index.html`'s Flathub tell lived
// inside the `/* … */` block a human is instructed to copy when adding an app,
// directly above `const APPS = []`. A comment-stripping version of this guard
// would go green on the exact line the requirement was written to catch, and
// `sites/nikatru/apps/_template.html` is worse still — it is the per-app landing
// template `[12]W-1` generates from, so its placeholder is an *instruction*, not
// an example. If you are aligning this file to house style: the style is wrong
// for this one guard, and the reason is this paragraph.
//
// ── WHY A TOKEN, NOT A DOMAIN ────────────────────────────────────────────────
// D-7 shipped its criterion as "any `flathub.org` reference". That matches ONE
// of the four tells that existed. The other three were bare labels
// (`"Snap / Flathub"`, twice) and a bracketed placeholder (`[FLATHUB/SNAP URL]`)
// — no domain, no link, still an advertisement. Match the case-insensitive
// TOKEN.
//
// ── BLOCK vs PRINT, and why prose is not a build failure ─────────────────────
// An AFFORDANCE is a promise: a store link, a download button, an artifact
// extension — a thing a user can click and be disappointed by. A CAPABILITY
// SENTENCE ("apps for iOS, Android, … our first releases are on the way") is
// marketing prose in the owner's voice. Failing the build on prose would make
// this guard an editor, and an editor gets switched off — the recorded fate of
// a guard that cries wolf (assert-lane-coverage.mjs:14-17). So affordances and
// disqualified tokens BLOCK; bare platform-count prose PRINTS, every run,
// quoting 39-CHASSIS cut 5's corollary so the owner decides with it in view.
// Disqualified tokens BLOCK wherever they appear, prose or not — a dead channel
// has no honest mention on a public surface.
//
// ── COVERAGE IS A RELATIONSHIP, NOT A NUMBER ─────────────────────────────────
// The deploy-root set is derived exactly as check-site-integrity.mjs derives it
// (a directory under sites/ shipping an index.html) and floored against the same
// MIN_SITES value, read from that file rather than copied. So the two guards
// lose coverage together, and neither floor is a number somebody can quietly
// lower in one place.
//
// Usage:  node tooling/ci/assert-channel-claims.mjs [repoRoot]
// Exit 0 = every public claim is backed by a served channel. 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const SITES = join(ROOT, 'sites');
const APPS_JSON = 'sites/_shared/_data/apps.json';
const REGISTER = 'tooling/channel-register.json';
const SIBLING = 'tooling/ci/check-site-integrity.mjs';

const problems = [];
const prints = [];
const ok = (m) => console.log(`ok   ${m}`);
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-channel-claims: FAILED');
  process.exit(1);
}

/** Surfaces a stranger can reach. `.md` is in because a README under a deploy
 *  root is published by a static host as readily as an .html file. */
const SCANNED = ['.html', '.js', '.json', '.md', '.txt'];

/**
 * 🔴 AN AFFORDANCE IS A PROMISE ONLY IF ITS DESTINATION IS REAL.
 *
 * The first version of this guard failed on six placeholder URLs inside the
 * `/* … *​/` example blocks — `apps.apple.com/app/id0000000000`,
 * `play.google.com/store/apps/details?id=...`. Those are scaffolding for
 * channels we intend to serve one day, not promises to a stranger, and nothing
 * renders them (`APPS = []`). Failing on them is crying wolf, and the fix the
 * next person would reach for is comment-stripping — which would silently kill
 * D-7's limb, whose payload IS a comment. So the distinction is NOT
 * comment-vs-code. It is destination-vs-placeholder, which is a property of the
 * VALUE and survives any amount of reformatting.
 *
 * The payoff: this goes red at exactly the right moment — when a human pastes a
 * REAL App Store URL into the template while apps.json still says web-only.
 *
 * ⚠️ THIS EXEMPTION IS D-1's ALONE. D-7's disqualified-token check ignores it
 * entirely: `[FLATHUB/SNAP URL]` is a placeholder AND must still fail, because a
 * dead channel has no honest mention on a public surface — example or not. That
 * asymmetry is the whole reason the two limbs are written separately below.
 */
const PLACEHOLDER = /0{4,}|X{4,}|\.\.\.|\[[^\]]*\]|example\.com|YOUR[_ -]|<[A-Z_]+>/i;

/** The quoted string or attribute value the match sits inside — the destination
 *  itself, not the line, so a real URL next to a commented example is judged on
 *  its own. */
function destinationAround(text, index) {
  let start = index;
  let end = index;
  const stop = new Set(['"', "'", '`', '<', '>', ' ', '\n', '\t', '(', ')']);
  while (start > 0 && !stop.has(text[start - 1])) start--;
  while (end < text.length && !stop.has(text[end])) end++;
  return text.slice(start, end);
}

/** The QUOTE-delimited value around the match, spaces included. A bracketed
 *  placeholder like href="[SNAP OR dl.nikatru.com APPIMAGE URL]" contains
 *  spaces, so the tight token above sees only `dl.nikatru.com` and loses the
 *  brackets that mark it as scaffolding. Found by this guard's own first run
 *  after the dl.nikatru.com affordance landed. */
function quotedValueAround(text, index) {
  const stop = new Set(['"', "'", '`', '<', '>', '\n']);
  let start = index;
  let end = index;
  while (start > 0 && !stop.has(text[start - 1])) start--;
  while (end < text.length && !stop.has(text[end])) end++;
  return text.slice(start, end);
}

/**
 * Store and artifact affordances. Matching an ANCHOR or an ARTIFACT is what
 * makes this a promise rather than a sentence. `platforms` is ANY-OF: the
 * promise is honest if at least one listed platform is claimed.
 *
 * 🔴 ARTIFACT EXTENSIONS ARE DERIVED FROM THE REGISTER, NOT HAND-LISTED.
 * Review 2026-07-31 (mutation-proven): the first version hand-copied a subset —
 * `.exe`, `.ipa`, `.pkg` and `.snap` all passed clean while sitting in the
 * register's own `artifactFormats` a directory away, and `.dmg` was listed here
 * while mapping to NO register row. A hand-copied list beside its source of
 * truth has already drifted by the time it ships. Store DOMAINS stay hand-listed
 * (they are store URLs, not formats — the register has no field for them), with
 * a coverage assertion below so a register format that resolves to no pattern
 * is COVERAGE LOST rather than a silent pass.
 */
const STORE_AFFORDANCES = [
  { platforms: ['ios', 'macos'], re: /apps\.apple\.com|itunes\.apple\.com/gi, what: 'an App Store link' },
  { platforms: ['android'], re: /play\.google\.com\/store/gi, what: 'a Google Play link' },
  { platforms: ['windows'], re: /apps\.microsoft\.com|microsoft\.com\/store/gi, what: 'a Microsoft Store link' },
  { platforms: ['linux'], re: /snapcraft\.io/gi, what: 'a Snap Store link' },
  // [ADR 015] §4's own remedy — and therefore a promise when it appears for
  // real. Serves windows-direct and linux-appimage, hence any-of both.
  { platforms: ['windows', 'linux'], re: /dl\.nikatru\.com/gi, what: 'a dl.nikatru.com download link' },
];

/** Extension patterns built from `artifactFormats` across the register rows.
 *  Formats that are not user-downloadable files are named exempt. */
const NON_FILE_FORMATS = new Set(['static-bundle']);
function artifactAffordances(register) {
  const out = [];
  const uncovered = [];
  for (const c of register.channels ?? []) {
    for (const fmt of c.artifactFormats ?? []) {
      // A non-string element is a SCHEMA fault and assert-channel-register.mjs
      // owns that complaint — but it must not CRASH this guard on the way past.
      // Review 2026-07-31 (mutation-proven): `artifactFormats: [null]` reached
      // `fmt.startsWith('.')` and threw a raw TypeError, and a crash is not a
      // catch. Route it into the same COVERAGE-LOST path an unresolvable format
      // takes, so the register's schema failure and this one say the same thing.
      if (typeof fmt !== 'string' || fmt === '') {
        uncovered.push(`${c.id}: ${JSON.stringify(fmt)} (not a non-empty string)`);
        continue;
      }
      if (NON_FILE_FORMATS.has(fmt)) continue;
      if (!fmt.startsWith('.')) {
        uncovered.push(`${c.id}: "${fmt}"`);
        continue;
      }
      out.push({
        platforms: c.platforms ?? [],
        re: new RegExp(fmt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'),
        what: `a ${fmt} artifact (register: ${c.id})`,
      });
    }
  }
  return { patterns: out, uncovered };
}

/** Prose that claims a platform COUNT. Printed, never failed — see the header. */
const COUNT_CLAIM = /\b(six|6)\s+platforms\b|\ball\s+six\b/gi;

/** A direct GitHub-release download. [ADR 015] §4: Releases is the artifact
 *  ORIGIN, never the download button. Preventive — zero hits today, and it must
 *  not be counted as coverage of anything until a Linux artifact exists. */
const GITHUB_RELEASE = /github\.com\/[\w.-]+\/[\w.-]+\/releases/gi;

// ── inputs ───────────────────────────────────────────────────────────────────
const appsRaw = read(APPS_JSON);
if (appsRaw === null) coverageLost([`${APPS_JSON} does not exist — there is nothing to check the sites against.`]);
let apps;
try {
  apps = JSON.parse(appsRaw);
} catch (e) {
  coverageLost([`${APPS_JSON} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) {
  coverageLost([`${APPS_JSON} carries no entries, so every "is this platform claimed?" question below answers "no" for the wrong reason.`]);
}
const claimedPlatforms = new Set(apps.flatMap((a) => (Array.isArray(a.platforms) ? a.platforms : [])));
if (claimedPlatforms.size === 0) {
  coverageLost([`${APPS_JSON} claims ZERO platforms across ${apps.length} entr(ies) — the comparison set is empty.`]);
}

// Disqualified channels come from [9]R-5's register, so there is ONE list and a
// channel cannot be dead in one file and alive in another.
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'The disqualified-channel list lives there. Without it this guard would silently check only',
    'affordances and report clean over the tells [pipeline D-7] exists to catch.',
  ]);
}
let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}
const disqualified = Array.isArray(register.disqualified) ? register.disqualified : [];

// ── assemble the affordance set: hand-listed store domains + register-derived
//    artifact formats, with a coverage assertion tying the two together ───────
const derived = artifactAffordances(register);
if (derived.uncovered.length) {
  coverageLost([
    `register artifactFormats that resolve to NO scan pattern: ${derived.uncovered.join(', ')}.`,
    'Every downloadable format the register declares must be scannable here, or a public surface can',
    'advertise exactly the artifact the register knows about and this guard cannot see it.',
  ]);
}
if (derived.patterns.length === 0) {
  coverageLost([
    `ZERO artifact patterns derived from ${REGISTER}.`,
    'The register declares .aab/.msix/.AppImage and more; deriving none means the derivation broke,',
    'and every extension check below would silently not exist.',
  ]);
}
const AFFORDANCES = [...STORE_AFFORDANCES, ...derived.patterns];

/**
 * A disqualified channel's tells. 🔴 REQUIRED, non-empty, and containing the
 * id — review 2026-07-31 (mutation-proven): the first version fell back to
 * `[id]` when `tells` was emptied or deleted, so one keystroke narrowed the
 * Flathub scan from ['flathub','flatpak'] to ['flathub'] with zero complaint,
 * while the register's own `_tellsWhy` promised narrowing could not be silent.
 * A promise the guard does not enforce is prose; now the key is mandatory.
 */
function tellsOf(d) {
  const id = String(d.id ?? '').trim();
  const extra = (Array.isArray(d.tells) ? d.tells : []).map((t) => String(t).trim()).filter(Boolean);
  if (!id) {
    problems.push(`a disqualified entry has no \`id\`, so it contributes no tell and silently narrows this scan.`);
    return extra;
  }
  if (extra.length === 0) {
    problems.push(
      `disqualified channel "${id}" has no \`tells\` array (or an empty one). The tell list IS the scan; deleting it narrows the scan to nothing while looking like tidying. Declare every string that advertises the channel, id included.`,
    );
    return [id];
  }
  if (!extra.some((t) => t.toLowerCase() === id.toLowerCase())) {
    problems.push(
      `disqualified channel "${id}" declares \`tells\` that do not include its own id. Narrowing the tell list is how a dead channel comes back under a name the guard stopped looking for.`,
    );
  }
  return [...new Set(extra)];
}

if (disqualified.length === 0) {
  coverageLost([
    `${REGISTER} lists ZERO disqualified channels.`,
    '[pipeline D-7]\'s whole limb ranges over that list. An empty list makes it vacuously true, which is',
    'indistinguishable from "the tells are purged" and is how a permanently-banned channel comes back.',
  ]);
}

// ── the deploy-root set, floored against check-site-integrity's own MIN_SITES ─
if (!existsSync(SITES)) coverageLost([`no sites/ directory under ${ROOT}.`]);
const siteRoots = readdirSync(SITES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(SITES, e.name, 'index.html')))
  .map((e) => e.name)
  .sort();

// 🔴 READ the sibling's floor, never copy it. A number copied into two files is
// two numbers, and the second one is the one nobody updates.
const siblingSrc = read(SIBLING);
let minSites = null;
if (siblingSrc !== null) {
  const m = siblingSrc.match(/const\s+MIN_SITES\s*=\s*(\d+)/);
  if (m) minSites = Number(m[1]);
}
if (minSites === null) {
  coverageLost([
    `could not read MIN_SITES from ${SIBLING}.`,
    'This guard deliberately has no floor of its own — it binds to that one so the two cannot drift.',
    'If that constant was renamed, re-point this read; do not reintroduce a local number.',
  ]);
}
if (siteRoots.length < minSites) {
  coverageLost([
    `found ${siteRoots.length} deploy root(s) under sites/, and ${SIBLING} requires at least ${minSites}.`,
    `Roots seen: ${siteRoots.join(', ') || '(none)'}.`,
    'A scan that stopped finding sites reports every public surface clean.',
  ]);
}
ok(`${siteRoots.length} deploy root(s) (${siteRoots.join(', ')}), floor ${minSites} read from ${SIBLING}`);

// ── walk ─────────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '_site' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SCANNED.some((ext) => e.name.toLowerCase().endsWith(ext))) out.push(p);
  }
  return out;
}

const files = siteRoots.flatMap((r) => walk(join(SITES, r)));
if (files.length === 0) {
  coverageLost([`${siteRoots.length} deploy root(s) contain ZERO scannable files (${SCANNED.join(', ')}).`]);
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const rel = (abs) => relative(ROOT, abs).split(sep).join('/');

let affordanceHits = 0;
let placeholders = 0;
let countClaims = 0;

for (const abs of files) {
  // RAW. No comment stripping. See the header — the comment is the payload.
  const text = readFileSync(abs, 'utf8');
  const where = rel(abs);

  // ── [D-7] disqualified channels — BLOCK, wherever they appear ─────────────
  // Every TELL, not just the id. Proven necessary by mutation 2026-07-31: a
  // surface reading "install the flatpak from your distro store" passed clean,
  // because `flatpak` is the package format and `flathub` is the channel id.
  // A reader cannot tell the difference and neither can a store reviewer.
  for (const d of disqualified) {
    for (const token of tellsOf(d)) {
      const re = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      for (const m of text.matchAll(re)) {
        problems.push(
          `${where}:${lineOf(text, m.index)} advertises "${m[0]}" — a tell of "${d.id}", a channel DISQUALIFIED by ${d.adr ?? 'a locked decision'}${d.date ? ` on ${d.date}` : ''}. ` +
            'A public surface naming a dead channel is an instruction to submit to it, and this one bans AI-assisted code and enforces with permanent publisher-wide bans.',
        );
      }
    }
  }

  // ── [ADR 015] §4 — a direct GitHub-release download button ────────────────
  for (const m of text.matchAll(GITHUB_RELEASE)) {
    problems.push(
      `${where}:${lineOf(text, m.index)} links a GitHub release download. [ADR 015] §4: Releases is the artifact ORIGIN, never the download button — serve it from dl.nikatru.com.`,
    );
  }

  // ── [D-1] limb (ii) — affordances for platforms no app claims — BLOCK ─────
  for (const a of AFFORDANCES) {
    a.re.lastIndex = 0;
    for (const m of text.matchAll(a.re)) {
      affordanceHits++;
      // ANY-OF: the promise is honest if at least one of the platforms this
      // affordance can serve is actually claimed.
      if (a.platforms.some((p) => claimedPlatforms.has(p))) continue;
      const destination = destinationAround(text, m.index);
      if (PLACEHOLDER.test(destination) || PLACEHOLDER.test(quotedValueAround(text, m.index))) {
        placeholders++;
        continue;
      }
      problems.push(
        `${where}:${lineOf(text, m.index)} offers ${a.what} for platform(s) ${a.platforms.map((p) => `"${p}"`).join('/')}, none of which any app in ${APPS_JSON} claims (claimed: ${[...claimedPlatforms].join(', ')}). ` +
          `The destination is REAL, not a placeholder: "${destination}". ` +
          'A store button with nothing behind it is a promise made to a stranger, and it rots into a lie without anyone editing it.',
      );
    }
  }

  // ── [D-1] cut 5's corollary — prose platform counts — PRINT ───────────────
  for (const m of text.matchAll(COUNT_CLAIM)) {
    countClaims++;
    prints.push(`${where}:${lineOf(text, m.index)} — "${m[0].trim()}"`);
  }
}

ok(`${files.length} public file(s) scanned RAW across ${siteRoots.length} root(s); ${affordanceHits} store/artifact affordance(s) seen, ${placeholders} of them template placeholders`);

// A guard whose pattern set stopped matching anything reports a clean tree. The
// sites DO carry store affordances (the APPS/PROJECTS templates), so zero here
// means the scan broke, not that the sites went quiet.
if (affordanceHits === 0) {
  coverageLost([
    `ZERO store or artifact affordances matched across ${files.length} file(s).`,
    'Both deploy roots ship an app-card template naming App Store, Google Play and Microsoft Store,',
    'so zero means the patterns or the walk stopped working — not that the surfaces went quiet.',
  ]);
}

if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed — site copy is the owner\'s voice, not a build artifact ──');
  console.log(`   ⬜ ${countClaims} platform-count claim(s). 39-CHASSIS §4 cut 5's corollary: "remove 'six`);
  console.log("      platforms' from site copy until it is true.\" All six DO build in CI ([pipeline F-4]),");
  console.log('      and NONE is distributed but web — so this is a capability claim, defensible, and the');
  console.log('      owner\'s call. Listed every run so it cannot go unnoticed:');
  for (const p of prints) console.log(`      · ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-channel-claims: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-channel-claims: ok');
}
