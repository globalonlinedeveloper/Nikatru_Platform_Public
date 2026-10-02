#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-cors-allowlist.mjs — EVERY Worker's CORS allowlist is DERIVED from the
// app catalogue, and carries nothing the catalogue does not justify.
//
// Why this needs a guard at all: the owner chose an EXACT allowlist over suffix
// matching (2026-07-25). An exact list fails CLOSED and SILENTLY — drop an
// origin and that surface loses its browser callers with no server-side error,
// no failing request log, and nothing in CI. The middleware's own vitest suites
// cover BEHAVIOUR; this covers the deployed CONFIG, which lives in wrangler.jsonc
// and cannot be imported from a Worker test (that tsconfig deliberately exposes
// no node APIs).
//
// 🔴 THIS GUARD USED TO READ ONE FILE. `const WRANGLER =
// 'services/platform/wrangler.jsonc'` — hardcoded, with services/subscriptiontracker-api never
// opened, while tooling/capability-register.json claimed ALLOWED_ORIGINS was
// "guarded by assert-cors-allowlist.mjs" as if that covered the var generally.
// Mutation-proven 2026-08-01: emptying services/subscriptiontracker-api/wrangler.jsonc's
// ALLOWED_ORIGINS produced BYTE-IDENTICAL output and exit 0.
//
// 🔴 AND THEN IT HARDCODED THE ORIGINS. The fix above iterated every Worker but
// compared them against a `POLICY` literal inside this file — so the allowlist
// was still a HAND-EDITED list, merely moved from wrangler.jsonc into the guard
// that was supposed to derive it. Mutation-proven 2026-08-07 on the real tree:
// adding a second live app to catalog/apps.json with a brand-new
// origin (`https://drift.nikatru.com`) and changing nothing else produced
// BYTE-IDENTICAL output and exit 0 — while that app's every browser request
// would have been refused at runtime. This is [4]B-2's CORS half and [3]S-11:
// stamping a new app into the factory must not depend on a human remembering to
// edit a comma-separated string in two Worker configs.
//
// THE DERIVATION (there is no hand-maintained origin list left):
//   • catalog/apps.json is the app catalogue. Each row's `url`
//     contributes exactly one browser ORIGIN.
//   • WHICH origins a Worker answers is its SCOPE, the `cors` field of its row in
//     tooling/platform-register.json (`servingWorker`, `appWorkers[]`):
//       – `every-app`: a SHARED Worker (the platform: config.nikatru.com /
//         platform.nikatru.com) that EVERY app's web build calls → it must list
//         EVERY catalogue origin;
//       – `own-app`: `services/<slug>-api`, app <slug>'s own Worker → it must list
//         that one app's origin. The app is found by DIRECTORY NAME, so a new app
//         that brings its own Worker is covered without editing this file:
//         provision-backend.mjs step [6] writes its row with `cors: "own-app"`.
//   • ⏱ 2026-10-01 (rv2-newproduct-010, O-CORS-PREVIEW-ORIGIN-HAND-LISTED): each
//     row's `origin` — the app's Cloudflare Pages preview origin, which
//     tooling/app-yaml/render.mjs writes from app.yaml `hosts.pagesOrigin` — is a
//     second DERIVED origin, required wherever that app's `url` origin is. It was
//     a hand EXTRAS entry here and a hand value in both Worker configs, so app
//     #2's preview build was refused by every Worker until someone remembered
//     both. A row with no `origin` is a finding: the catalogue contract requires
//     one, and without it the preview origin cannot be derived.
//   • Anything else listed in a config must appear in EXTRAS with a reason. An
//     origin the catalogue does not justify and nobody wrote a reason for is a
//     hand-addition, and that is the drift this guard exists to stop.
//
// ⏱ 2026-09-27 — THE SCOPE LEFT THIS FILE FOR THE REGISTER, AND THE CODE IS HELD
// TO IT (O-SERVICE-KIT-UNBUILT, E-b1). It used to be a `SERVICE_POLICY` literal
// here, naming `platform` by hand beside a derivation that covered everything
// else. Every Worker now binds the ONE middleware, services/_shared/src/cors.ts,
// in its own src/middleware/cors.ts with `cors({ scope, appId?, methods })`, and
// this guard fails a Worker whose binding passes a scope its row does not name.
// That limb is what makes the field mean anything: since [ADR 075] every
// catalogue origin is the apex, so `every-app` and `own-app` require the SAME
// origin set, and no origin limb can see a row flipped from one to the other.
// Measured with this limb cut out, app #1's row set to `every-app`: exit 2, and
// ONLY through the MIN_PER_APP_WORKERS floor, because the tree's one own-app
// Worker vanished — a floor that a second own-app Worker satisfies. What the
// scope still decides is in the code — the localhost trade an `own-app` Worker
// carries and the shared Worker must not — so that is where the row is checked.
//
// Usage:  node tooling/ci/assert-cors-allowlist.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';
import { APEX_ORIGIN } from '../sites/apex.mjs';

const ROOT = resolve(process.argv[2] ?? '.');
const SERVICES = join(ROOT, 'services');
const CATALOGUE = join(ROOT, 'catalog', 'apps.json');
/** Each Worker's CORS scope is its row's `cors` field here. */
const REGISTER_REL = 'tooling/platform-register.json';
const REGISTER = join(ROOT, ...REGISTER_REL.split('/'));
const SCOPES = new Set(['every-app', 'own-app']);
/** Where every Worker binds services/_shared/src/cors.ts with its policy. */
const BINDING_REL = 'src/middleware/cors.ts';

/**
 * The ONLY permitted non-catalogue origins, each with the reason it is there.
 * Every entry is a standing exception to "the catalogue is the source of truth",
 * so each one has to earn its line. An origin in a config that is neither
 * catalogue-derived nor listed here is a hard failure.
 */
const EXTRAS = {
  platform: [
    // NOTE: no *.pages.dev entry. Each app's Pages preview origin is DERIVED from
    // its catalogue row's `origin` (rv2-newproduct-010); an EXTRAS entry for one
    // would be the second, hand-kept copy that change retired.
    {
      origin: 'http://localhost:3000',
      why: 'the local Subly web dev server (.claude/launch.json). It fetches config.nikatru.com cross-origin from the browser, and this Worker has NO localhost regex, so the origin must be listed explicitly.',
    },
  ],
  // NOTE: no localhost entry for an own-app Worker. A per-app Worker allows
  // localhost by regex (a recorded trade — the `flutter drive -d web-server`
  // harness picks a random port), so listing it here would assert something the
  // config does not need to carry. Its Pages preview origin is derived, like the
  // shared Worker's.
};

/** Strip line and block comments outside string literals, drop trailing commas,
 *  then parse. Structural, never a grep: a wrangler.jsonc is mostly prose, and
 *  a `grep '"r2_buckets"'` in this repo once matched the comment explaining why
 *  there is no r2_buckets. */
function parseJsonc(path) {
  const raw = readFileSync(path, 'utf8');
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw.slice(i, i + 2) === '//') {
      while (i < raw.length && raw[i] !== '\n') i++;
    } else if (raw.slice(i, i + 2) === '/*') {
      const end = raw.indexOf('*/', i + 2);
      i = end === -1 ? raw.length : end + 2;
    } else if (raw[i] === '"') {
      out += raw[i++];
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === '\\') out += raw[i++];
        out += raw[i++];
      }
      if (i < raw.length) out += raw[i++];
    } else {
      out += raw[i++];
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// ── COVERAGE ASSERTIONS [pipeline F-10] ──────────────────────────────────────
// Everything below is only as strong as the catalogue it derives from and the
// configs it iterates. Empty either and this prints "all 0 required present"
// and exits 0 forever — an assertion that cannot fail, which this repo treats
// as worse than none. [10]D-8 limb (c) printed `0 comparison(s)`; an iOS
// usage-key haystack held 0 keys while 18 tells compared against it.
const MIN_SERVICES = 2; // platform + subscriptiontracker-api
const MIN_CATALOGUE_ORIGINS = 1; // apps.json declares subscriptiontracker today
const MIN_PER_APP_WORKERS = 1; // the `<slug>-api` derivation must be LIVE, not theoretical

if (!existsSync(SERVICES)) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — services/ does not exist under ${ROOT}.\n` +
      '    The scan is broken, not the tree.',
  );
  coverageLost();
}

if (!existsSync(CATALOGUE)) {
  console.error(
    'assert-cors-allowlist: COVERAGE LOST — no catalogue at catalog/apps.json.\n' +
      '    Every required origin is DERIVED from that file. Without it this guard\n' +
      '    has nothing to require, and would wave through an allowlist that had\n' +
      '    dropped every live app.',
  );
  coverageLost();
}

let catalogue;
try {
  catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
} catch (e) {
  console.error(`assert-cors-allowlist: COVERAGE LOST — apps.json is not parseable JSON: ${e.message}`);
  coverageLost();
}
if (!Array.isArray(catalogue)) {
  console.error('assert-cors-allowlist: COVERAGE LOST — apps.json is not an array.');
  coverageLost();
}

// ── derive the origins ───────────────────────────────────────────────────────
const apps = [];
const badRows = [];
for (const row of catalogue) {
  const slug = typeof row?.slug === 'string' ? row.slug : '(no slug)';
  if (typeof row?.url !== 'string' || row.url === '') {
    badRows.push(`✗ apps.json row "${slug}" has no \`url\`, so no browser origin can be derived for it.`);
    continue;
  }
  let origin;
  try {
    origin = new URL(row.url).origin;
  } catch {
    badRows.push(`✗ apps.json row "${slug}" has an unparseable \`url\`: ${row.url}`);
    continue;
  }
  // The Pages preview origin: the row's `origin`, written by render.mjs from
  // app.yaml `hosts.pagesOrigin`. An origin and nothing more — a path, or a
  // non-https scheme, is not something a browser sends as `Origin`.
  let preview = null;
  if (typeof row?.origin !== 'string' || row.origin === '') {
    badRows.push(`✗ apps.json row "${slug}" has no \`origin\`, so its Pages preview origin cannot be derived.`);
  } else {
    let parsed = null;
    try {
      parsed = new URL(row.origin);
    } catch {
      parsed = null;
    }
    if (parsed === null || parsed.protocol !== 'https:' || parsed.origin !== row.origin) {
      badRows.push(`✗ apps.json row "${slug}" has an \`origin\` that is not a bare https origin: ${row.origin}`);
    } else {
      preview = parsed.origin;
    }
  }
  apps.push({ slug, origin, preview });
}

const catalogueOrigins = [...new Set(apps.map((a) => a.origin))];
if (catalogueOrigins.length < MIN_CATALOGUE_ORIGINS) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — the catalogue yielded ${catalogueOrigins.length} origin(s), ` +
      `expected at least ${MIN_CATALOGUE_ORIGINS}.\n` +
      '    A guard over an empty catalogue requires nothing of any allowlist and\n' +
      '    passes forever — including over a config that had been emptied.',
  );
  for (const b of badRows) console.error(`    ${b}`);
  if (badRows.length) process.exit(1); else coverageLost(); // a malformed row printed above is a finding (1); none, and the scan could not look (2)
}

// 🔴 DECLARED, NOT DISCOVERED: EVERY CATALOGUE ORIGIN IS THE APEX [ADR 075].
// MIN_CATALOGUE_ORIGINS above is now a floor that can never RISE -- one apex, N
// apps, one origin forever -- so on its own it has stopped being coverage. What
// replaces it is this: the set of catalogue origins must be exactly {apex}. That
// is an assertion that CAN fail (publish one app on a subdomain again and it goes
// red), and it says out loud that the per-app CORS boundary was traded away on
// purpose rather than lost by accident. The apex is imported, never retyped.
{
  const apex = new URL(APEX_ORIGIN).origin;
  const strays = catalogueOrigins.filter((o) => o !== apex);
  if (strays.length) {
    console.error(
      // ⚠️ THE ORIGINS ARE QUOTED, and a trailing period never touches one. A
      // hostname with a sentence period butted against it reads as part of the
      // name to a human and to every anchored matcher — the test that asserts
      // this line had to choose between an unanchored host pattern (which also
      // matches `subly.nikatru.com.evil.example`) and a wrong one. Quoting ends
      // the name unambiguously, so the assertion can be anchored.
      `assert-cors-allowlist: ${strays.length} catalogue origin(s) are not the apex "${apex}": ` +
        `${strays.map((o) => `"${o}"`).join(', ')}\n` +
        '    [ADR 075] publishes every app at a PATH on the apex. An app back on its\n' +
        '    own origin needs its own payment-provider approval and its own allowlist\n' +
        '    entry, and assert-app-address-shape.mjs is the guard that names it.',
    );
    process.exit(1);
  }
}

// ── enumerate every Worker config under services/ ───────────────────────────
const configs = [];
for (const entry of listDir(SERVICES, { withFileTypes: true }).sort((a, b) =>
  a.name < b.name ? -1 : 1,
)) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const path = ['wrangler.jsonc', 'wrangler.json']
    .map((f) => join(SERVICES, entry.name, f))
    .find((p) => existsSync(p));
  if (!path) continue; // not a Worker (no deployable config)
  configs.push({
    service: entry.name,
    path,
    where: `services/${entry.name}/${path.split(/[\\/]/).pop()}`,
  });
}

if (configs.length < MIN_SERVICES) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — found ${configs.length} Worker config(s) under services/, ` +
      `expected at least ${MIN_SERVICES}.\n` +
      '    A rename or a moved directory silently shrinks this scan; a scan over\n' +
      '    nothing reports a clean allowlist for every Worker in the tree.',
  );
  coverageLost();
}

// ── every Worker's scope, READ FROM THE REGISTER ────────────────────────────
// A row is matched to its Worker by the `config` path it names, the key
// provision-backend.mjs and assert-platform-register.mjs already use.
if (!existsSync(REGISTER)) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — no register at ${REGISTER_REL}.\n` +
      '    Every Worker\'s scope is its row\'s `cors` field there. Without it this guard\n' +
      '    cannot tell the shared Worker from an app\'s own, so it can require nothing.',
  );
  coverageLost();
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (e) {
  console.error(`assert-cors-allowlist: COVERAGE LOST — ${REGISTER_REL} is not parseable JSON: ${e.message}`);
  coverageLost();
}
const registerRows = [
  ...(register?.servingWorker && typeof register.servingWorker === 'object'
    ? [{ field: 'servingWorker', row: register.servingWorker }]
    : []),
  ...(Array.isArray(register?.appWorkers)
    ? register.appWorkers.map((row, i) => ({ field: `appWorkers[${i}]`, row }))
    : []),
];
if (registerRows.length < MIN_SERVICES) {
  console.error(
    `assert-cors-allowlist: COVERAGE LOST — ${REGISTER_REL} names ${registerRows.length} Worker row(s), ` +
      `expected at least ${MIN_SERVICES} (\`servingWorker\` and \`appWorkers[]\`).\n` +
      '    A register that lost its rows leaves every Worker with no scope, and each\n' +
      '    would be reported as unregistered rather than checked.',
  );
  coverageLost();
}

const problems = [...badRows];
/** Worker directory → its register row. */
const rowByService = new Map();
for (const entry of registerRows) {
  const m = /^services\/([^/]+)\/wrangler\.jsonc?$/.exec(String(entry.row?.config ?? '').replace(/\\/g, '/'));
  if (m) {
    rowByService.set(m[1], entry);
  } else {
    problems.push(
      `✗ ${REGISTER_REL} ${entry.field} names no \`services/<dir>/wrangler.jsonc\` in \`config\` ` +
        `(${JSON.stringify(entry.row?.config ?? null)}), so no Worker can be matched to its \`cors\` scope.`,
    );
  }
}

/**
 * What a Worker's src/middleware/cors.ts binds: every `scope:` and `appId:`
 * string literal in its comment-stripped source. The binding is one
 * `cors({ … })` call (services/platform/test/twinned-worker-modules.test.ts
 * refuses anything more), so a reader of literals is enough — and it is not a
 * grep over prose, because the comments are gone first.
 */
function bindingOf(service) {
  const rel = `services/${service}/${BINDING_REL}`;
  const abs = join(SERVICES, service, ...BINDING_REL.split('/'));
  if (!existsSync(abs)) return { rel, missing: true, scopes: [], appIds: [] };
  const code = stripSourceComments(readFileSync(abs, 'utf8'), '.ts');
  const literals = (key) =>
    [...code.matchAll(new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`]*)\\1`, 'g'))].map((m) => m[2]);
  return { rel, missing: false, scopes: literals('scope'), appIds: literals('appId') };
}

let checked = 0;
let originsSeen = 0; // catalogue-DERIVED requirements
let extrasSeen = 0; // hand-declared EXTRAS, counted separately and printed
let perAppWorkers = 0;
// ⏱ 2026-09-27 (LEAD RULING SHIELD-R3, rv-c21 SHIELD-F2): the EDGE pass-through policy — edgePassThrough() below.
const EDGE = edgeServices(ROOT);
let edgeChecked = 0;
let bindingsHeld = 0;

for (const { service, path, where } of configs) {
  if (EDGE.has(service)) {
    edgeChecked += edgePassThrough(service, path, where, problems);
    continue;
  }
  const entry = rowByService.get(service);
  // The `<slug>-api` derivation: app `subscriptiontracker` owns `services/subscriptiontracker-api`.
  const owner = apps.find((a) => `${a.slug}-api` === service);

  if (entry === undefined) {
    // A new Worker is not automatically out of scope — it is unregistered scope.
    problems.push(
      `✗ ${where} — no row in ${REGISTER_REL} names services/${service}, so nothing says which\n` +
        '    browser origins it answers. Give it a row with a `cors` scope: `every-app` for a\n' +
        '    Worker every app\'s web build calls, or `own-app` for services/<slug>-api, app\n' +
        '    <slug>\'s own Worker (provision-backend.mjs step [6] writes that row). A Worker\n' +
        '    with no row is a Worker whose allowlist nothing checks.',
    );
    continue;
  }
  const scope = entry.row?.cors;
  if (!SCOPES.has(scope)) {
    problems.push(
      `✗ ${REGISTER_REL} ${entry.field} (services/${service}) — \`cors\` is ${JSON.stringify(scope ?? null)}; ` +
        'it must be "every-app" or "own-app".\n' +
        '    The scope decides which origins this Worker must list and whether it carries the\n' +
        '    localhost trade, and a row without one leaves both undecided.',
    );
    continue;
  }

  /** An app's derived requirements: its public origin, then its Pages preview origin. */
  const requiredOf = (a, because) => [
    { origin: a.origin, why: `apps.json declares "${a.slug}" at ${a.origin}; ${because}` },
    ...(a.preview === null
      ? []
      : [{ origin: a.preview, why: `apps.json declares "${a.slug}"'s Pages preview origin ${a.preview} (\`origin\`); ${because}` }]),
  ];
  let required;
  if (scope === 'every-app') {
    required = apps.flatMap((a) => requiredOf(a, `${service} is shared by every app`));
  } else if (owner) {
    perAppWorkers++;
    required = requiredOf(owner, `services/${service} is that app's own Worker`);
  } else {
    problems.push(
      `✗ ${where} — ${REGISTER_REL} ${entry.field} says \`cors: "own-app"\`, and no app in\n` +
        `    catalog/apps.json owns services/${service}. An own-app Worker is services/<slug>-api\n` +
        '    for a catalogue slug; that is how its one required origin is derived.',
    );
    continue;
  }

  // ── the code binds the scope the register names ─────────────────────────
  // 🔴 RC9. Flip app #1's row to `every-app` and no origin requirement changes:
  // every catalogue origin is the apex, so both scopes require the same set. The row
  // would then claim a Worker that allows no localhost while its binding keeps
  // the trade — or, the dangerous direction, the SHARED Worker bound `own-app`
  // would answer every localhost port behind a row still reading `every-app`.
  const binding = bindingOf(service);
  const bindingProblem = (what) =>
    problems.push(
      `✗ ${binding.rel} — ${what}\n` +
        `    ${REGISTER_REL} ${entry.field} names \`cors: "${scope}"\`. Every Worker binds\n` +
        '    services/_shared/src/cors.ts in that file with ONE `cors({ scope, appId?, methods })`\n' +
        '    call, and the scope it passes is the one its row names.',
    );
  if (binding.missing) {
    bindingProblem('there is no such file, so nothing binds this Worker\'s CORS.');
  } else if (binding.scopes.length !== 1) {
    bindingProblem(`it passes ${binding.scopes.length} \`scope\` literal(s) (${binding.scopes.join(', ') || 'none'}); it must pass exactly one.`);
  } else if (binding.scopes[0] !== scope) {
    bindingProblem(
      `it binds \`scope: '${binding.scopes[0]}'\` and the register says "${scope}". ` +
        (binding.scopes[0] === 'own-app'
          ? 'That Worker answers every localhost port on top of its list, which the register says it does not.'
          : 'That Worker refuses the localhost ports the register says it answers.'),
    );
  } else if (scope === 'own-app' && (binding.appIds.length !== 1 || binding.appIds[0] !== owner.slug)) {
    bindingProblem(
      `it names \`appId\` ${binding.appIds.map((a) => `'${a}'`).join(', ') || '(none)'}; an own-app Worker in ` +
        `services/${service} belongs to app '${owner.slug}', and names it once.`,
    );
  } else if (scope === 'every-app' && binding.appIds.length > 0) {
    bindingProblem(`it names \`appId\` ${binding.appIds.map((a) => `'${a}'`).join(', ')}; an every-app Worker belongs to no one app.`);
  } else {
    bindingsHeld++;
  }

  let cfg;
  try {
    cfg = parseJsonc(path);
  } catch (e) {
    problems.push(`✗ ${where} is not parseable JSONC: ${e.message}`);
    continue;
  }

  const raw = cfg?.vars?.ALLOWED_ORIGINS;
  if (typeof raw !== 'string') {
    problems.push(
      `✗ ${where} — vars.ALLOWED_ORIGINS is missing.\n` +
        '    An absent value denies every non-localhost browser origin: the web\n' +
        '    build of this app loses every call it makes from a browser.',
    );
    continue;
  }

  const listed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (listed.length === 0) {
    problems.push(
      `✗ ${where} — ALLOWED_ORIGINS is EMPTY.\n` +
        '    An empty list denies every non-localhost browser origin rather than\n' +
        '    falling back to "*" (the "*" fallback was the fork removed 2026-08-01).\n' +
        '    This takes the web build offline for every listed origin.',
    );
    continue;
  }

  checked++;

  // ── ORIGIN IS NO LONGER A PER-APP BOUNDARY [ADR 075] ───────────────────
  // This guard's whole design is an EXACT PER-WORKER allowlist: services/<slug>-api
  // must list THAT ONE APP'S origin. That was a real boundary while every app had
  // its own subdomain. It is not one any more. Every app is published at
  // https://nikatru.com/<id>, so every app's browser tab sends the SAME Origin, and
  // app #2's Worker will be required to allow the string app #1's tab also sends.
  //
  // 🔴 THE DANGEROUS PART IS THAT NOTHING GOES RED WHEN THAT HAPPENS. The guard
  // stays green while meaning strictly less. So the replacement boundary is asserted
  // HERE, next to the assertion it replaces: a per-app Worker must carry vars.APP_ID,
  // because the token+APP_ID pair is the only thing left that can tell one app's
  // caller from another's. A per-app Worker without it is authorising on nothing but
  // a shared string.
  if (scope !== 'every-app' && typeof cfg?.vars?.APP_ID !== 'string') {
    problems.push(
      `✗ ${where} — vars.APP_ID is missing on a PER-APP Worker.\n` +
        '    Every app is published on one shared origin (https://nikatru.com/<id>),\n' +
        '    so ALLOWED_ORIGINS can no longer distinguish this app from any other.\n' +
        '    APP_ID is the surviving half of that decision; without it this Worker\n' +
        '    authorises on a string every app in the portfolio sends.',
    );
  }

  // The allowlist must EQUAL derived ∪ EXTRAS — a floor and a ceiling in one.
  // A declared EXTRA is required too: it is an origin somebody wrote a reason
  // for, so removing it has to be a reviewable diff in this file rather than a
  // quiet edit to a comma-separated string. (Dropping http://localhost:3000
  // silently breaks local web dev; that was catchable before this rewrite and
  // must stay catchable.)
  const expected = [
    ...required,
    ...(EXTRAS[service] ?? []).map((e) => ({ origin: e.origin, why: `EXTRAS: ${e.why}`, extra: true })),
  ];

  // (a) everything expected must be present.
  for (const { origin, why, extra } of expected) {
    if (extra) extrasSeen++;
    else originsSeen++;
    if (!listed.includes(origin)) {
      problems.push(
        `✗ ${where} — missing "${origin}" — ${why}.\n` +
          (extra
            ? '    Declared in EXTRAS but absent from the config. If it is genuinely\n' +
              '    no longer needed, delete the EXTRAS entry in the same change so the\n' +
              '    reason disappears with the origin.'
            : '    Derived from the catalogue, absent from the config: that app builds\n' +
              '    green, deploys green, and every browser request it makes to this\n' +
              '    Worker is refused at runtime with nothing logged server side.'),
      );
    }
  }

  // (b) nothing may be hand-added that neither the catalogue nor EXTRAS justifies.
  const justified = new Set(expected.map((e) => e.origin));
  for (const origin of listed) {
    if (!justified.has(origin)) {
      problems.push(
        `✗ ${where} — "${origin}" is listed but NOTHING justifies it.\n` +
          '    It is not a catalogue app\'s origin and it is not in EXTRAS. Either\n' +
          '    add the app to catalog/apps.json, or add an EXTRAS entry\n' +
          '    in this guard saying why it is there. An unexplained origin is a\n' +
          '    standing CORS grant nobody reviewed.',
      );
    }
  }
}

// Every Worker the register names must actually have been reached. Otherwise a
// renamed directory turns a checked Worker into an unchecked one and the run
// still prints a tally that looks healthy.
const seen = new Set(configs.map((c) => c.service));
for (const [service, entry] of rowByService) {
  if (!seen.has(service)) {
    problems.push(
      `✗ COVERAGE LOST — ${REGISTER_REL} ${entry.field} names services/${service}, but no Worker config was found there.\n` +
        '    Either the directory moved (fix the row\'s `config` in the same change) or\n' +
        '    the Worker was deleted; until then its allowlist is checked by nothing.',
    );
  }
}

// EXTRAS for a Worker that no longer exists is dead policy pretending to be cover.
for (const service of Object.keys(EXTRAS)) {
  if (!seen.has(service)) {
    problems.push(
      `✗ COVERAGE LOST — EXTRAS names services/${service}, but no Worker config was found there.`,
    );
  }
}

// The `<slug>-api` limb must have matched something. If it never fires, the
// per-app half of the derivation is untested code that reports healthy.
if (perAppWorkers < MIN_PER_APP_WORKERS) {
  problems.push(
    `✗ COVERAGE LOST — the <slug>-api derivation matched ${perAppWorkers} Worker(s), ` +
      `expected at least ${MIN_PER_APP_WORKERS}.\n` +
      '    That limb is what covers each app\'s own API Worker. If it matches\n' +
      '    nothing, only the shared Worker is really being checked.',
  );
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(
    `\nassert-cors-allowlist: ${problems.length} problem(s).\n` +
      'An exact allowlist fails closed and silently: the affected surface simply\n' +
      'stops working in the browser, with nothing logged server side.',
  );
  process.exit(problems.every((p) => p.startsWith('✗ COVERAGE LOST')) ? 2 : 1); // 2 = could not look; 1 = a finding
}

// The EXTRAS count is printed, not buried: every one is a standing exception to
// "the catalogue is the source of truth", and a number that quietly grows is how
// a hand-maintained list comes back.
console.log(
  `assert-cors-allowlist: ${checked} Worker config(s) checked against ${catalogueOrigins.length} ` +
    `catalogue origin(s) from ${apps.length} app(s); ${originsSeen} derived requirement(s) ` +
    `+ ${extrasSeen} declared EXTRAS all present, no unjustified origins; ` +
    `${bindingsHeld} Worker(s) bind the \`cors\` scope their ${REGISTER_REL} row names` +
    (edgeChecked > 0 ? `; ${edgeChecked} edge pass-through Worker(s) answer \`*\` and never credentials.` : '.'),
);

/** The one COVERAGE LOST stop: each could-not-look branch above prints its own reason and ends
 *  here, so the run exits 2 — never 1, which would read as a finding (AGENTS.md exit-code
 *  convention, O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-cors-allowlist.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost() {
  process.exit(2);
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-27 · THE EDGE PASS-THROUGH POLICY (LEAD RULINGS SHIELD-R1..R3, rv-c21
// SHIELD-F2, row O-BOXES-UNSHIELDED-FROM-SPIKES). Declared LAST (hoisted), like
// coverageLost above, so no `assert-cors-allowlist.mjs:NNN` citation moves; the
// one import it needs is the top-of-file one since E-b1.
//
// services/edge-shield is not an allowlisting Worker and must not be taught as one.
// It sits on zone routes in front of Box C's GoTrue and Box B's GlitchTip and passes
// every answer through untouched, so the ORIGIN's own CORS governs every answer a
// browser reads — except the shield's own refusal (429, or 503 for the refresh
// grant), which it builds itself. `exemptReason` would be FALSE here (the auth and
// intake clients ARE browsers), so it is held TRUE to a narrower policy instead:
//   · it is an `edgeWorkers` entry of tooling/platform-register.json (limb 7 of
//     assert-platform-register.mjs holds the entry to the config);
//   · its config declares no `vars.ALLOWED_ORIGINS` — a pass-through reads none, so
//     one would be an allowlist nothing enforces;
//   · its source sets `Access-Control-Allow-Origin` to the literal `'*'` and to
//     nothing else — never an echoed `Origin` (assert-no-origin-authz.mjs refuses
//     the read itself);
//   · it never sets `Access-Control-Allow-Credentials` — `*` with credentials is
//     the one CORS answer a browser refuses, and a refusal carries no secret.
// Source is read COMMENT-STRIPPED: the refusal's own doc comment explains the
// policy and names both headers.
// ─────────────────────────────────────────────────────────────────────────────
// stripSourceComments is imported at the top of this file (E-b1 imports it there for bindingOf).

/** service directory -> edgeWorkers entry, from tooling/platform-register.json. An
 *  unreadable register is no edge Worker at all, so every Worker falls back to the
 *  derivation above and an untaught one still fails there. */
function edgeServices(root) {
  let reg;
  try {
    reg = JSON.parse(readFileSync(join(root, 'tooling', 'platform-register.json'), 'utf8'));
  } catch {
    return new Map();
  }
  const out = new Map();
  for (const e of Array.isArray(reg?.edgeWorkers) ? reg.edgeWorkers : []) {
    const m = String(e?.config ?? '').replace(/\\/g, '/').match(/^services\/([^/]+)\/wrangler\.jsonc?$/);
    if (m) out.set(m[1], e);
  }
  return out;
}

/** 1 when services/<service> holds the pass-through policy, else 0 with the findings pushed. */
function edgePassThrough(service, path, where, problems) {
  const before = problems.length;
  const srcDir = join(SERVICES, service, 'src');
  const files = [];
  const walk = (abs) => {
    for (const e of listDir(abs, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(abs, e.name));
      else if (/\.(ts|js|mjs)$/.test(e.name)) files.push(join(abs, e.name));
    }
  };
  if (existsSync(srcDir)) walk(srcDir);
  if (files.length === 0) {
    problems.push(
      `✗ COVERAGE LOST — ${where} is an edge Worker (tooling/platform-register.json edgeWorkers), and ` +
        `services/${service}/src holds no source, so the CORS headers it sets could not be read.`,
    );
    return 0;
  }
  let cfg = null;
  try {
    cfg = parseJsonc(path);
  } catch (e) {
    problems.push(`✗ ${where} is not parseable JSONC: ${e.message}`);
  }
  if (cfg?.vars?.ALLOWED_ORIGINS !== undefined) {
    problems.push(
      `✗ ${where} — an EDGE pass-through declares vars.ALLOWED_ORIGINS.\n` +
        '    It passes every answer through with the origin\'s own CORS and reads no allowlist, so this\n' +
        '    one is a list nothing enforces. Remove it, or make the Worker an allowlisting one.',
    );
  }
  for (const abs of files) {
    const rel = `services/${service}/${abs.slice(srcDir.length + 1).split(/[\\/]/).join('/')}`;
    const code = stripSourceComments(readFileSync(abs, 'utf8'), '.ts');
    if (/access-control-allow-credentials/i.test(code)) {
      problems.push(
        `✗ ${rel} — an EDGE pass-through sets Access-Control-Allow-Credentials.\n` +
          '    Its own answers are refusals that carry no secret, and every other answer is the origin\'s,\n' +
          '    untouched. Credentials beside `*` is the one CORS answer a browser refuses.',
      );
    }
    const all = [...code.matchAll(/access-control-allow-origin/gi)].length;
    const star = [...code.matchAll(/['"`]access-control-allow-origin['"`]\s*[:,]\s*(['"`])\*\1/gi)].length;
    if (all !== star) {
      problems.push(
        `✗ ${rel} — sets Access-Control-Allow-Origin to something other than the literal '*' (${all - star} of ${all}).\n` +
          '    An EDGE pass-through answers its own refusals `*` and never echoes the request\'s Origin:\n' +
          '    the origin behind it owns every other CORS decision (rv-c21 SHIELD-F2).',
      );
    }
  }
  if (problems.length === before) {
    console.log(`  – ${where} — edge pass-through (tooling/platform-register.json edgeWorkers): answers its own refusals \`*\`, never credentials, no allowlist of its own; the origin's CORS governs everything it passes through`);
    return 1;
  }
  return 0;
}
