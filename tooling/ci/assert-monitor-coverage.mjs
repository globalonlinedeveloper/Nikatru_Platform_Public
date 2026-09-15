#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-monitor-coverage.mjs — [pipeline E-9] every live hostname has a
// monitor, and the list cannot silently shrink.
//
// WHY THIS EXISTS. The acceptance quantifies over "every live hostname", and
// until tooling/monitor-register.json landed that set did not exist anywhere a
// machine could read. The monitor set lived inside GlitchTip, then on the Oracle
// box and on the Hostinger box (Box B) since 2026-09-02;
// the deployed set lived in wrangler configs, an app catalogue and a handful of
// canonical links; and the comparison between them was performed by a human,
// from memory, when somebody happened to look. Measured 2026-08-01 and again
// 2026-08-02 — six monitors, five hostnames, and TWO deployed custom domains
// (platform.nikatru.com, config.nikatru.com) that nothing watches, both bound
// since the Worker shipped. Nobody decided not to monitor them.
//
// 🔴 THE DEPLOYED SET IS DERIVED FROM THE TREE ON EVERY RUN, from three sources
// that already exist for other reasons:
//   · workerCustomDomains — `routes[]` entries with `custom_domain: true`
//     across services/*/wrangler.jsonc. A custom domain IS a public hostname.
//   · appCatalogue        — the `url` and `api` hosts in
//     catalog/apps.json, which is what the public site advertises.
//   · siteCanonicals      — each sites/*/index.html's `<link rel="canonical">`.
//     A site's own canonical URL is the one place it names the host it is
//     served from; the directory name is not that (`sites/nikatru` ⇒
//     nikatru.com is a guess, and a guess is how a register goes stale).
// Adding a route to a wrangler config therefore acquires a monitoring
// obligation the moment it merges, rather than when somebody remembers this
// file exists. That is the half a hand-typed list can never have.
//
// WHAT FAILS, AND WHAT ONLY PRINTS
//   FAIL · a derived hostname with no row in the register    (the list shrank)
//   FAIL · a row naming a hostname nothing deploys, unless it is `declared`
//          with a reason                                     (a dead row)
//   FAIL · a row claiming a monitor without id/name/type/verifiedOn
//   FAIL · no row carries `role: "observability"`  (nothing asks who watches
//          the watcher — the monitor host is the one hostname NO deploy config
//          can mention, so its absence is silent by construction)
//   PRINT · rows with `monitor: null` — the actual coverage gap.
//
// ⚠️ THE GAP PRINTS RATHER THAN FAILS ON PURPOSE, and this is the repo's
// established shape rather than a softening. Creating a monitor is an action on
// the owner's GlitchTip instance, not a change to this repository; a guard that
// failed CI on it would block every branch on work only the owner can do — the
// same reasoning assert-seams-wired.mjs applies to the unpinned pack-signing
// keys. What must never happen is the gap becoming INVISIBLE, so the count is
// on stdout every single run, gap or no gap.
//
// ⏱ 2026-09-07 — THE SENTENCE ABOVE IS APPENDED TO, NOT REWRITTEN, AND HALF OF
// IT IS WRONG. "work only the owner can do" is the claim
// tooling/monitor-register.json's own `🔴 whyItStayedOpen` records as WRONG:
// creating a monitor takes the vault GLITCHTIP_TOKEN and one POST, an agent has
// now done it four times (ids 11, 12, 31, 32), and believing otherwise parked
// the tree's highest-consequence unwatched host for three days. What survives is
// the OTHER half, which is the real reason this prints: a guard that reddens
// every branch over the state of a third-party instance gets disabled, and a
// disabled guard checks nothing. The printed line below was corrected on the
// same day for the same reason — see the note at the print itself.
//
// ⚠️ NO THRESHOLD IS CHECKED AND NONE IS INVENTED. "How many consecutive
// failures should page, and how fast" has no derivable answer in this tree, so
// this guard asserts nothing about it. The register records each monitor's
// interval as a MEASURED fact — what the live API reports today — not a target.
//
// The LIVE half of E-9 is tooling/ops/verify-monitors.mjs, which reconciles the
// register against the GlitchTip API. It is deliberately not run here: a CI limb
// needing a network token would either be skipped (and a skipped check reports
// ok) or would make every build depend on the box GlitchTip runs on — Box B,
// the Hostinger box, since 2026-09-02 — which is the very single point of
// failure E-9b is about.
//
// ⏱ 2026-09-09 — THE `origin` FIELD, AND WHY IT IS A FOURTH READING RATHER THAN
// A FOURTH DERIVED SOURCE. APPENDED; NOTHING ABOVE IS REWRITTEN.
// [ADR 075] moved every app's published address to a PATH on the apex and gave
// catalog/apps.json a new field: `origin` — the Cloudflare Pages PRODUCTION
// ALIAS the apex router actually fetches the bytes from. Measured 2026-09-09 it
// is `https://subly-9cp.pages.dev`; the `-9cp` is a suffix Cloudflare appended
// because the project name was already taken, which is exactly why the alias is
// DECLARED in apps/<id>/app.yaml `hosts.pagesOrigin` and can never be guessed
// from the id. That host is live, the whole apex is dark without it, and until
// this block nothing in this guard read the field at all.
// tooling/monitor-register.json named the gap itself, at
// `_derivation._appPublicPathIsCOMPUTEDNotTyped`: "that host is neither derived
// nor declared and nothing here says whether it should be watched … Named
// rather than fixed: assert-monitor-coverage.mjs belongs to another unit."
// This is that unit.
//
// 🔴 WHAT WAS MEASURED BEFORE CHOOSING THE SHAPE, because the obvious move is
// wrong. `subly-9cp.pages.dev` has NO row in the register today — measured
// 2026-09-09, zero `origin` keys and zero `pages.dev` hostnames under `hosts`.
// So feeding origins into the DERIVED set would make limb 1 red on the tree as
// it stands, for a row this guard cannot write: a register row is a CLAIM OF
// COVERAGE, and that file's own rule is "A ROW AND ITS LIVE MONITOR ARE ONE
// CHANGE, NOT TWO". Reddening the build to force a row buys precisely the
// defect the register refuses — a declared monitor that does not exist. The
// split below is that reasoning applied, and it is the same FAIL/PRINT line the
// header draws above rather than a new one:
//   FAIL  · a catalogue `origin` the tree does not corroborate — the STALE case
//           (limb 5). The corroborating source is the app's OWN declaration,
//           apps/<slug>/app.yaml `hosts.pagesOrigin` (or `hosts.web` when it is
//           absent, which is the same fallback tooling/app-yaml/render.mjs:367
//           uses to COMPOSE the catalogue field). Rename the Pages project in
//           one file and not the other and the router fetches a host that is
//           gone, with every other guard in this repository green.
//   FAIL  · a register ROW for an origin host that has gone stale. This needs no
//           new limb and gets none: origin hosts now count as deployed for the
//           no-dead-rows limb, so a row naming last week's alias stops being
//           produced by anything the moment the alias moves, and limb 2 fails it
//           by name. ⚠️ Before this change such a row could not exist AT ALL —
//           limb 2 refused it as dead — so the register was structurally unable
//           to declare the one hostname the apex router depends on even if
//           somebody wanted to. Admitting it is what gives the staleness catch
//           teeth; it excuses nothing, because limb 1 is untouched and the
//           admitted set is exactly the hostnames the catalogue itself names.
//   PRINT · an origin host with no row in the register. That is the accounting
//           gap the register named, it is real, and closing it is a register
//           edit plus a GlitchTip POST — the same shape as the `monitor: null`
//           gap above, printed on every run so it cannot go quiet.
//
// ⚠️ WHAT THIS DELIBERATELY DOES NOT RE-CHECK, so it is a second axis and not a
// rival guard. assert-app-address-shape.mjs already grades the `origin` field's
// SHAPE (https, not the apex, no path — its limb 4) and already holds each route
// in sites/nikatru/app-routes.json equal to its catalogue row's `origin` (its
// limb 6). Neither of those asks the question below: does the alias still match
// the app's own declaration, and does the register account for it.
//
// Usage:  node tooling/ci/assert-monitor-coverage.mjs [repoRoot]
// Exit 0 = every deployed hostname is declared, 1 = violation or lost coverage.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
/** ⏱ 2026-09-09 — the repository's ONE reader of apps/<id>/app.yaml. It is
 *  imported rather than re-implemented for the reason its own header gives: a
 *  second parser of a declaration file guesses differently from the first, and
 *  a guess is how a register goes stale. */
import { parseYaml } from '../app-yaml/yaml.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const REGISTER = 'tooling/monitor-register.json';
const SERVICES = 'services';
const SITES = 'sites';
const CATALOGUE = 'catalog/apps.json';
/** ⏱ 2026-09-09 — where the app's OWN declaration of its Pages alias lives.
 *  `catalog/apps.json` is RENDERED from it (tooling/app-yaml/render.mjs:367),
 *  so the two are one fact with two spellings and limb 5 holds them equal. */
const APPS_DIR = 'apps';

/** The three DERIVED sources. Each must contribute at least one hostname: a
 *  source that silently stops yielding anything makes the coverage check true
 *  of a smaller world and still prints ok, which is this repository's single
 *  most repeated failure. `declared` is not here — it is the escape hatch for
 *  the one hostname no deploy config can name, and it is bounded by the
 *  observability check below rather than by a count.
 *
 *  ⏱ 2026-09-07 — THE TWO SENTENCES ABOVE ARE APPENDED TO, NOT REWRITTEN,
 *  AND BOTH ARE NOW WRONG ABOUT THE HATCH. It is not "the one hostname no
 *  deploy config can name": measured today, tooling/monitor-register.json
 *  carries FIVE rows with `derivedFrom: "declared"` — glitchtip, ntfy, vault,
 *  beszel and logs; the observability host plus the four Box B services,
 *  none of which any wrangler config, catalogue row or canonical link can
 *  name. And the hatch was never "bounded by the observability check below":
 *  limb 3 caps rows carrying `role: "observability"` at ONE, which is a
 *  DIFFERENT set — four of the five declared rows carry no role at all and
 *  limb 3 never sees them.
 *
 *  THE REAL BOUND, and it is per row rather than a count. (a) Limb 2 is only
 *  REACHED for a hostname the derivation does not already yield — the first
 *  line of its body is `if (derived.has(h)) continue;` — so `declared` cannot
 *  excuse a DEPLOYED host by construction, no matter how many rows carry it.
 *  (b) For every row it does reach, the hatch demands BOTH
 *  `derivedFrom: "declared"` AND a `why` that is a non-empty string; delete
 *  or blank either field on any one of the five and this guard exits 1.
 *  A count would be weaker than that: five honest rows are fine and one
 *  unexplained row is not, which is exactly what (b) grades and what no
 *  number could. */
const DERIVED_SOURCES = ['workerCustomDomains', 'appCatalogue', 'siteCanonicals'];

let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => {
  console.error(`✗ COVERAGE LOST — ${m}`);
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
};

const rel = (p) => join(ROOT, ...p.split('/'));
const readIf = (p) => (existsSync(rel(p)) ? readFileSync(rel(p), 'utf8') : null);

/** JSONC → JSON. Comments STRIPPED before parsing, never scanned — this repo has
 *  already shipped a guard that matched the template comment explaining why
 *  there is no `r2_buckets`. String literals are respected so a `//` inside a
 *  URL is not read as a comment. */
function parseJsonc(text, where) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch (err) {
    coverageLost(`${where} could not be parsed after stripping comments: ${err.message}`);
  }
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

// ── derive the deployed hostname set ────────────────────────────────────────
/** hostname → the set of sources that produced it. */
const derived = new Map();
const perSource = new Map(DERIVED_SOURCES.map((s) => [s, new Set()]));
const add = (source, host) => {
  if (!host) return;
  perSource.get(source).add(host);
  if (!derived.has(host)) derived.set(host, new Set());
  derived.get(host).add(source);
};

// 1 · Worker custom domains.
if (!existsSync(rel(SERVICES))) {
  coverageLost(`no ${SERVICES}/ directory under ${ROOT}; the Worker half of the derivation ran over nothing.`);
}
for (const e of listDir(rel(SERVICES), { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  for (const name of ['wrangler.jsonc', 'wrangler.json']) {
    const path = `${SERVICES}/${e.name}/${name}`;
    const text = readIf(path);
    if (text === null) continue;
    const cfg = parseJsonc(text, path);
    for (const route of Array.isArray(cfg.routes) ? cfg.routes : []) {
      if (route && route.custom_domain === true && typeof route.pattern === 'string') {
        add('workerCustomDomains', route.pattern.toLowerCase());
      }
    }
    break;
  }
}

// 2 · The app catalogue — what the public site advertises.
const catalogueText = readIf(CATALOGUE);
if (catalogueText === null) {
  coverageLost(`${CATALOGUE} does not exist; the app half of the derivation ran over nothing.`);
}
let catalogue;
try {
  catalogue = JSON.parse(catalogueText);
} catch (err) {
  coverageLost(`${CATALOGUE} is not valid JSON (${err.message}).`);
}
const catalogueRows = Array.isArray(catalogue) ? catalogue : [];
/** ⏱ 2026-09-09 — `origin` IS ABSENT FROM THIS LIST ON PURPOSE, and the reason
 *  is in the header block: a hostname added here acquires an ADVERTISED-host
 *  obligation graded by limb 1, and limb 1 is red today for the app origin,
 *  which has no row. The field is read in 2b instead, on its own terms. */
for (const app of catalogueRows) {
  for (const field of ['url', 'api']) {
    if (typeof app?.[field] === 'string') add('appCatalogue', hostOf(app[field]));
  }
}

// ── 2b · the app ORIGIN host — what the apex router FETCHES ─────────────────
// Since [ADR 075] the address an app is PUBLISHED at (`url`, above) and the
// host its bytes COME FROM (`origin`, here) are two different hostnames, and
// only the first was ever read. `origin` is the Cloudflare Pages production
// alias — live, load-bearing for the whole apex path, and unguessable from the
// app id (Cloudflare appended `-9cp` when `subly` was taken).
// This block only COLLECTS, because two later limbs need the set and both sit
// after the register is read: limb 2 (a row for an origin host is legitimate,
// and goes dead when the alias moves) and limb 5 (the alias against the app's
// own declaration). The floor below fires here rather than there because a
// catalogue that stopped yielding origins makes both of them vacuous at once.
/** origin hostname → the catalogue slug(s) that name it. */
const originHosts = new Map();
for (const app of catalogueRows) {
  if (typeof app?.origin !== 'string' || app.origin === '') continue;
  const h = hostOf(app.origin);
  if (!h) continue;
  if (!originHosts.has(h)) originHosts.set(h, []);
  originHosts.get(h).push(typeof app.slug === 'string' && app.slug !== '' ? app.slug : '(a row with no slug)');
}
if (catalogueRows.length > 0 && originHosts.size === 0) {
  coverageLost(
    `${CATALOGUE} carries ${catalogueRows.length} row(s) and not one of them yields an \`origin\` hostname. ` +
      'Every app row has carried one since [ADR 075] — tooling/app-yaml/render.mjs composes it from ' +
      '`hosts.pagesOrigin` (or `hosts.web`) and assert-app-address-shape.mjs fails a row without it — so a ' +
      'catalogue that yields none means the field was renamed or dropped and limb 5 below would report ' +
      'judgement over an empty set while printing ok. That is this repository\'s single most repeated failure.',
  );
}


// 3 · Each site's OWN canonical host. Not the directory name: `sites/nikatru`
//     ⇒ nikatru.com is a guess, and a guess is how a register goes stale.
if (!existsSync(rel(SITES))) {
  coverageLost(`no ${SITES}/ directory under ${ROOT}; the site half of the derivation ran over nothing.`);
}
for (const e of listDir(rel(SITES), { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
  const html = readIf(`${SITES}/${e.name}/index.html`);
  if (html === null) continue;
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  if (canonical) add('siteCanonicals', hostOf(canonical));
}

for (const source of DERIVED_SOURCES) {
  if (perSource.get(source).size === 0) {
    coverageLost(
      `the "${source}" derivation yielded no hostname. The deployed set below is short by everything it ` +
        'contributes, so "every live hostname is declared" would hold over a smaller world and still print ok.',
    );
  }
}

// ── the register ────────────────────────────────────────────────────────────
const registerText = readIf(REGISTER);
if (registerText === null) {
  coverageLost(`${REGISTER} does not exist. It is the declared right-hand side; without it this guard compares the deployed set against nothing.`);
}
let register;
try {
  register = JSON.parse(registerText);
} catch (err) {
  coverageLost(`${REGISTER} is not valid JSON (${err.message}).`);
}
const rows = Array.isArray(register?.hosts) ? register.hosts : [];
if (rows.length === 0) {
  coverageLost(`${REGISTER} declares no hosts. An empty register accepts any deployment at all, including one with no monitoring whatsoever.`);
}

const byHost = new Map();
for (const row of rows) {
  if (typeof row?.hostname !== 'string' || row.hostname === '') {
    fail(`${REGISTER} has a row with no hostname: ${JSON.stringify(row)}`);
    continue;
  }
  const h = row.hostname.toLowerCase();
  if (byHost.has(h)) {
    fail(`${REGISTER} declares ${h} twice. Two rows for one hostname is two answers to "is it monitored".`);
  }
  byHost.set(h, row);
}

// ── 1 · every deployed hostname is declared ─────────────────────────────────
const undeclared = [...derived.keys()].filter((h) => !byHost.has(h)).sort();
for (const h of undeclared) {
  fail(
    `${h} is deployed by this repository (${[...derived.get(h)].join(', ')}) and has NO row in ${REGISTER}. ` +
      'A hostname nobody declared is a hostname nobody decided about — which is exactly how ' +
      'platform.nikatru.com went unwatched from the day the Worker shipped.',
  );
}

// ── 2 · no dead rows ────────────────────────────────────────────────────────
// A row for a hostname nothing deploys reports judgement over nothing — this
// guard's own failure mode, applied to its subject.
// ⏱ 2026-09-09 — `originHosts` JOINS `derived` HERE, AND ONLY HERE. A row for
// the Pages alias the apex router fetches from was, until today, refused by this
// limb as dead — so the register could not declare the one hostname the whole
// apex path depends on even if somebody wanted to. Admitting it is what makes a
// STALE such row red: the alias moves (a project renamed, a catalogue re-render
// that never happened), the catalogue stops naming last week's host, and the row
// that still names it lands in this loop and fails by name. Nothing else is
// relaxed — limb 1 above is untouched, and the admitted set is exactly the
// hostnames catalog/apps.json itself carries in `origin`.
for (const [h, row] of byHost) {
  if (derived.has(h) || originHosts.has(h)) continue;
  if (row.derivedFrom === 'declared' && typeof row.why === 'string' && row.why.trim() !== '') continue;
  fail(
    `${h} has a row in ${REGISTER} and nothing in the tree deploys it. Either it was retired and the row ` +
      'did not follow, or it is genuinely outside the derivation — in which case say so with ' +
      '`"derivedFrom": "declared"` and a `why` that survives being read aloud.',
  );
}

// ── 3 · the observability host ──────────────────────────────────────────────
// The one hostname no wrangler config, app row or canonical link can name,
// because it is the thing doing the watching. Its absence is silent by
// construction, so it is the one row this guard requires by name.
const observability = rows.filter((r) => r.role === 'observability');
if (observability.length === 0) {
  coverageLost(
    `no row in ${REGISTER} carries \`"role": "observability"\`. The monitor host is the only hostname the ` +
      'derivation structurally cannot produce, so with no row for it "who watches the watcher" is a question ' +
      'nothing in this tree asks — and the answer today is that monitor id 1 watches the box it runs on.',
  );
}
if (observability.length > 1) {
  fail(`${REGISTER} carries ${observability.length} observability rows; there is one monitor host.`);
}

// ── 4 · a claimed monitor is a complete claim ───────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
let monitored = 0;
const gaps = [];
for (const [h, row] of [...byHost.entries()].sort()) {
  const m = row.monitor;
  if (m === null || m === undefined) {
    const why = row.gap?.why;
    if (typeof why !== 'string' || why.trim() === '') {
      fail(
        `${h} declares no monitor and records no \`gap.why\`. An unmonitored host with no stated reason is ` +
          'indistinguishable from one nobody has looked at — and the printed gap below is the only thing ' +
          'keeping this visible, so it has to say something.',
      );
      continue;
    }
    gaps.push(`${h} — ${why}${row.gap?.action ? ` ACTION: ${row.gap.action}` : ''}`);
    continue;
  }
  const missing = [];
  if (typeof m.id !== 'number') missing.push('id (a number)');
  if (typeof m.name !== 'string' || m.name === '') missing.push('name');
  if (typeof m.type !== 'string' || m.type === '') missing.push('type');
  if (typeof m.verifiedOn !== 'string' || !ISO_DATE.test(m.verifiedOn)) missing.push('verifiedOn (YYYY-MM-DD)');
  if (missing.length) {
    fail(
      `${h} claims a monitor but the claim is incomplete: no ${missing.join(', no ')}. ` +
        'An undated claim about a live system is a claim nobody can check; tooling/ops/verify-monitors.mjs ' +
        'reconciles these fields against the GlitchTip API and needs all of them to do it.',
    );
    continue;
  }
  monitored++;
}

// ── 5 · a catalogue origin is CORROBORATED by the app's own declaration ─────
// The STALE case. apps/<slug>/app.yaml is where the alias was read off the
// Cloudflare Pages API and written down; catalog/apps.json is RENDERED from it.
// Two spellings of one fact drift the moment one of them is hand-edited or the
// render is skipped, and the drift is invisible — the router just fetches a
// host that is not there any more.
if (!existsSync(rel(APPS_DIR))) {
  coverageLost(
    `no ${APPS_DIR}/ directory under ${ROOT}, so every \`origin\` in ${CATALOGUE} is uncorroborated and ` +
      'limb 5 would pass on any hostname whatsoever, including one that no longer exists.',
  );
}
for (const app of catalogueRows) {
  if (typeof app?.origin !== 'string' || app.origin === '') continue; // presence is assert-app-address-shape's limb 4.
  const declaredIn = typeof app.slug === 'string' && app.slug !== '' ? `${APPS_DIR}/${app.slug}/app.yaml` : null;
  const h = hostOf(app.origin);
  if (h === null) {
    fail(
      `${CATALOGUE} has an \`origin\` of ${JSON.stringify(app.origin)} that no hostname can be taken from, so ` +
        'nothing in this tree can corroborate the host the apex router fetches from.',
    );
    continue;
  }
  if (declaredIn === null) {
    fail(
      `${CATALOGUE} declares \`origin\` ${h} on a row with no \`slug\`. The slug is what names the app's own ` +
        `declaration under ${APPS_DIR}/, so without it the alias is a hostname this tree states exactly once ` +
        'and can never check.',
    );
    continue;
  }
  const yamlText = readIf(declaredIn);
  if (yamlText === null) {
    fail(
      `${CATALOGUE} declares \`origin\` ${h} for slug "${app.slug}" and ${declaredIn} does not exist. The ` +
        'catalogue is rendered FROM that file, so a catalogue row whose declaration is gone is a published ' +
        'address whose origin nothing in this repository still asserts.',
    );
    continue;
  }
  let doc;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    fail(`${declaredIn} could not be parsed, so \`origin\` ${h} is uncorroborated: ${err.message}`);
    continue;
  }
  const declared = doc?.hosts?.pagesOrigin || doc?.hosts?.web;
  if (typeof declared !== 'string' || declared.trim() === '') {
    fail(
      `${declaredIn} declares neither \`hosts.pagesOrigin\` nor \`hosts.web\`, so the \`origin\` ${h} in ` +
        `${CATALOGUE} is a hostname nothing else in this tree names.`,
    );
    continue;
  }
  const declaredHost = declared.trim().toLowerCase();
  if (declaredHost !== h) {
    fail(
      `${CATALOGUE} routes app "${app.slug}" to origin ${h} while ${declaredIn} declares ${declaredHost}. ` +
        'One of the two is STALE — a Pages project renamed on one side only, or a hand-edited catalogue — ' +
        'and the apex router fetches the catalogue\'s answer, so the app is served from a host the tree no ' +
        'longer says it deploys. Re-render the catalogue from the declaration rather than editing either by hand.',
    );
  }
}

// ── the printed gap, on every run, pass or fail ─────────────────────────────
if (gaps.length) {
  // ⏱ 2026-09-07 — THIS LINE SAID "deployed hostname(s) … — OWNER-GATED" AND BOTH
  // WORDS WERE FALSE. `declared` is the true set: limb 2 above admits a row for a
  // hostname this repo does not deploy when it carries `derivedFrom: "declared"`
  // and a `why`, and four such rows landed on 2026-09-07 for the Box B services
  // (ntfy, vault — both with monitors — and beszel, logs — both behind Cloudflare
  // Access, so each carries a stated gap instead). A gap printed here is
  // therefore not necessarily a deployed host. "OWNER-GATED" went for the reason
  // in the header note above. THE LIMB IS UNCHANGED: this is the wording of a
  // print, not a check, and both halves the suite pins — that the gap is named on
  // stdout and that the guard still exits 0 — are asserted exactly as before.
  console.log(`--   ${gaps.length} declared hostname(s) with NO monitor — printed not hidden:`);
  for (const g of gaps) console.log(`       ${g}`);
  console.log('     Creating a monitor is an action on the GlitchTip instance, not a change to this repo, so');
  console.log('     this prints rather than failing the build. It stops being printed when it stops being true.');
}
if (register?.observability?.decidedOn == null) {
  console.log(
    '--   [pipeline E-9b] the observability SPOF is UNDECIDED: every monitor, including the one watching',
  );
  console.log('     glitchtip.nikatru.com, runs inside GlitchTip on ONE box — Box B, the Hostinger box,');
  console.log('     since 2026-09-02 — and so does the alert path. The machine changed that day; the COUNT');
  console.log('     did not, so E-9b is exactly as open as it was on 2026-08-03.');
  console.log('     Owner must fund/accept an off-box checker or record the SPOF as accepted, with a date and a');
  console.log('     name (monitor-register.json → observability.decidedOn / decidedBy).');
}

// ⏱ 2026-09-09 — the ORIGIN accounting gap, printed on every run for the same
// reason the monitor gap above is: closing it is a register row PLUS a GlitchTip
// POST, and a row written ahead of the monitor is the defect
// tooling/monitor-register.json refuses by name ("A ROW AND ITS LIVE MONITOR ARE
// ONE CHANGE, NOT TWO"). What must never happen is the host going quiet, so it
// is named — with the app that depends on it — whether or not anything failed.
const unaccountedOrigins = [...originHosts.keys()].filter((h) => !byHost.has(h)).sort();
if (unaccountedOrigins.length) {
  console.log(
    `--   ${unaccountedOrigins.length} app ORIGIN host(s) with no row in ${REGISTER} — printed not hidden:`,
  );
  for (const h of unaccountedOrigins) {
    console.log(`       ${h} — the apex router fetches ${originHosts.get(h).join(', ')} from it`);
  }
  console.log('     Since [ADR 075] an app is served at a PATH on the apex and its bytes come from this host,');
  console.log('     so it is live and load-bearing while nothing in this register says whether it is watched.');
  console.log('     Declaring a row here is one change with the GlitchTip monitor it claims, which is why this');
  console.log('     guard prints it rather than failing a branch into writing a claim nobody has verified.');
}

const summary =
  `monitor coverage — ${derived.size} deployed hostname(s) derived from ${DERIVED_SOURCES.length} source(s) ` +
  `(${DERIVED_SOURCES.map((s) => `${s}: ${perSource.get(s).size}`).join(', ')}), ` +
  `${byHost.size} declared, ${monitored} monitored, ${gaps.length} gap(s)` +
  `, ${originHosts.size} app origin host(s) corroborated (${originHosts.size - unaccountedOrigins.length} with a row)`;

if (failed) {
  console.error(`\n${summary}`);
  console.error('assert-monitor-coverage: FAILED');
  process.exit(1);
}
ok(summary);
