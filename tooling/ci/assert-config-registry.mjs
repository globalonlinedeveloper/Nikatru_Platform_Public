#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-config-registry.mjs — ONBOARDING AN APP IS A DATA EDIT, NOT A SOURCE ONE.
//
// [pipeline 4]B-2, company/pipeline/04-backend-platform.md.
//
// ── THE SENTENCE, AND WHAT WOULD MAKE IT FALSE ───────────────────────────────
// "The set of apps the shared config service serves is DATA; adding an app to
//  the portfolio requires no edit to the Worker's source."
//
// Measured live 2026-08-06, when it was false:
//     GET https://config.nikatru.com/config/subly  → 200
//     GET https://config.nikatru.com/config/lingo  → 404 {"error":"unknown_app"}
// `lingo` is a real content pack in this repo. The set lived in an object
// literal `DEFAULT_CONFIGS` in services/platform/src/config.ts, so onboarding
// app #2 meant editing and redeploying the ONE Worker every app's launch path
// goes through.
//
// The observations that make the sentence false again, each visible from the
// repository with no credentials — so every limb below is a GATE, not a MONITOR:
//
//   1. config.ts stops deriving the set from the catalogue (import deleted, or
//      the catalogue no longer reaches the builder).
//   2. an app id reappears as a LITERAL in config.ts — the registry, re-typed.
//   3. the value document names an app the catalogue does not have: dead data
//      that reads as configuration and serves nobody.
//   4. a catalogue slug is not a well-formed app id, so it is DROPPED from the
//      served set — an app that vanished with nothing said.
//   5. the catalogue lists a slug twice: two rows, one silently wins.
//   6. `defaults` stops carrying a complete AppConfig, so app #2 is onboarded
//      with a PARTIAL config — the onboarding works and the app is broken.
//   7. the shared api base the server hands a client-only app diverges from the
//      one pre_gen.dart compiles into that app as its fallback.
//
// ── WHAT IT DELIBERATELY DOES NOT CLAIM ──────────────────────────────────────
// It does NOT claim the live 404 is gone. Both files are BUNDLED at build time
// (a Worker has no filesystem), so a catalogue row reaches the edge only after
// `wrangler deploy`. That is a fact about the deployment, not about the repo,
// and this guard has no credentials — asserting it here would be an assertion
// that cannot fail. The served set is PRINTED on every run instead, so a shrink
// is visible to a reader even though it cannot fail a build.
//
// Usage:  node tooling/ci/assert-config-registry.mjs [repoRoot]
// Exit:   0 = the served set is data and complete · 1 = one of the seven above.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());

const CATALOGUE = 'sites/_shared/_data/apps.json';
const CONFIG_TS = 'services/platform/src/config.ts';
const DATA = 'services/platform/src/app-config-data.json';
const TYPES_TS = 'services/platform/src/types.ts';
const PRE_GEN = 'tooling/bricks/app/hooks/pre_gen.dart';

/** A scanner needs a test that it is still scanning what it thinks. These five
 *  files ARE the subject: with any one of them unread every limb below is
 *  vacuously true, and an empty domain reads exactly like a compliant one. */
const REQUIRED_COVERAGE = [CATALOGUE, CONFIG_TS, DATA, TYPES_TS, PRE_GEN];

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);

function read(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

// ⚠️ DECLARED HERE, ABOVE THE FIRST `done()` CALL, AND THAT IS LOAD-BEARING.
// `done()` is a hoisted function declaration that PRINTS the served set, so it
// reads these two — and the first thing it does on a missing file is run before
// the `let`s further down would have initialised. The first draft put them at
// their point of use and every COVERAGE-LOST path died with
// `ReferenceError: Cannot access 'catalogue' before initialization` instead of
// the message it was supposed to print: the guard failed, so the build was still
// red, but for a reason that told the reader nothing. Six of this file's own
// tests caught it.
let catalogue = null;
let data = null;

// ── 0 · COVERAGE ─────────────────────────────────────────────────────────────
const raw = {};
for (const rel of REQUIRED_COVERAGE) {
  raw[rel] = read(rel);
  if (raw[rel] === null) coverageLost(`${rel} does not exist, so its limb checked nothing.`);
}
if (problems.length) done();

try {
  catalogue = JSON.parse(raw[CATALOGUE]);
} catch (e) {
  coverageLost(`${CATALOGUE} does not parse (${e.message}); the served set is derived from it.`);
}

try {
  data = JSON.parse(raw[DATA]);
} catch (e) {
  coverageLost(`${DATA} does not parse (${e.message}); every served value comes from it.`);
}
if (problems.length) done();

if (!Array.isArray(catalogue) || catalogue.length === 0) {
  coverageLost(
    `${CATALOGUE} is not a non-empty array. The served set is its rows, so an empty one makes ` +
      'every limb below range over nothing while still printing clean.',
  );
  done();
}

/** The comment-stripped source. Asserted to have ACTUALLY reduced: an unknown
 *  extension is returned VERBATIM by stripSourceComments, and a scan that reads
 *  its subject's own header comments as code reports the opposite of the truth
 *  — this repo has shipped that exact defect once already (a `grep '"r2_buckets"'`
 *  matched the comment explaining why there is no `r2_buckets`).
 *
 *  ⚠️ MEASURED ON NON-WHITESPACE, NOT ON LENGTH. The reduction replaces comments
 *  with SPACES so byte offsets survive, so `stripped.length` is IDENTICAL to the
 *  input's and a length comparison can never fail. That was this function's
 *  first draft and it fired on all three files at once — an assertion that
 *  cannot pass is as useless as one that cannot fail, and it is the same
 *  mistake. */
function code(rel, ext) {
  const stripped = stripSourceComments(raw[rel], ext);
  const dense = (s) => s.replace(/\s+/g, '').length;
  if (raw[rel].includes('//') && dense(stripped) >= dense(raw[rel])) {
    coverageLost(`the comment reduction did not reduce ${rel}; its limbs would be scanning prose.`);
  }
  return stripped;
}
const configSrc = code(CONFIG_TS, '.ts');
const typesSrc = code(TYPES_TS, '.ts');
const preGenSrc = code(PRE_GEN, '.dart');
if (problems.length) done();

// ── 1 · THE SET COMES FROM THE CATALOGUE ─────────────────────────────────────
// Two halves, because either alone is satisfiable with the defect present: an
// import nothing uses is dead, and a builder fed a literal is the old registry.
{
  const imp = /import\s+(\w+)\s+from\s+'(?:\.\.\/)+sites\/_shared\/_data\/apps\.json'/.exec(configSrc);
  if (!imp) {
    fail(
      `[4]B-2: ${CONFIG_TS} does not import ${CATALOGUE}. The set of apps this Worker serves is then ` +
        'whatever is typed into the Worker, which is the source edit B-2 exists to remove.',
    );
  } else {
    const binding = imp[1];
    const reachesBuilder = new RegExp(`buildRegistry\\s*\\(\\s*${binding}\\b`).test(configSrc);
    if (!reachesBuilder) {
      fail(
        `[4]B-2: ${CONFIG_TS} imports the catalogue as \`${binding}\` but never passes it to ` +
          '`buildRegistry(`. An import nothing consumes is decoration; the served set would still be ' +
          'coming from somewhere else.',
      );
    }
  }
}

// ── 2 · NO APP ID IS A LITERAL IN THE WORKER'S SOURCE ────────────────────────
// The failing input is one line long and is exactly the defect: paste
// `subly: { app_id: 'subly', … }` back into config.ts and this goes red.
//
// ⚠️ SCOPE, stated because it is narrower than "the slug does not appear". The
// two shapes matched are the ones a registry actually takes — a quoted string,
// and an identifier key opening an object. A slug that collides with an
// AppConfig FIELD NAME (an app literally called `app_id`) would trip the second
// on this file's own `{ app_id: slug, … }`; that is why the field names are
// excluded by name below, with the exclusion PRINTED rather than silent.
{
  const fieldNames = new Set(
    [...typesSrc.matchAll(/^\s{2}(\w+)\??\s*:/gm)].map((m) => m[1]),
  );
  for (const row of catalogue) {
    const slug = row && typeof row.slug === 'string' ? row.slug : null;
    if (!slug) continue;
    if (fieldNames.has(slug)) {
      notes.push(`slug "${slug}" is also an AppConfig field name — literal check skipped for it.`);
      continue;
    }
    const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asString = new RegExp(`['"\`]${esc}['"\`]`).test(configSrc);
    const asKey = new RegExp(`(^|[{,\\s])${esc}\\s*:\\s*\\{`).test(configSrc);
    if (asString || asKey) {
      fail(
        `[4]B-2: the app id "${slug}" appears as a ${asString ? 'string literal' : 'registry key'} in ` +
          `comment-stripped ${CONFIG_TS}. That is the hardcoded registry growing back — the served set ` +
          'must be derived from the catalogue, never named in the Worker.',
      );
    }
  }
}

// ── 3 · NO VALUE DOCUMENT ENTRY FOR AN APP NOBODY STAMPED ────────────────────
const slugs = catalogue.map((r) => (r && typeof r.slug === 'string' ? r.slug : null));
const slugSet = new Set(slugs.filter(Boolean));
{
  const perApp = data && typeof data.apps === 'object' && data.apps !== null ? data.apps : null;
  if (perApp === null) {
    coverageLost(`${DATA} has no \`apps\` object, so the orphan check ranged over nothing.`);
  } else {
    for (const key of Object.keys(perApp)) {
      if (!slugSet.has(key)) {
        fail(
          `${DATA} carries values for "${key}", which is not a slug in ${CATALOGUE}. Nothing serves ` +
            'them — an app is served because the catalogue lists it, not because this file mentions ' +
            'it. Dead data that reads as configuration is how a "we already set that" belief survives.',
        );
      }
    }
  }
}

// ── 4 · EVERY CATALOGUE SLUG IS A WELL-FORMED APP ID ─────────────────────────
// The pattern is PARSED OUT OF config.ts rather than copied here: a second copy
// of a rule is a second thing to disagree with, and the whole point is that the
// filter which drops a row and this check which reports it are the same rule.
{
  const m = /APP_ID_PATTERN\s*=\s*\/([^/]+)\/([a-z]*)/.exec(configSrc);
  if (!m) {
    coverageLost(
      `APP_ID_PATTERN could not be parsed out of ${CONFIG_TS}. It is the filter buildRegistry drops ` +
        'rows with; without reading it, a dropped app could not be reported.',
    );
  } else {
    const pattern = new RegExp(m[1], m[2]);
    for (let i = 0; i < catalogue.length; i++) {
      const slug = slugs[i];
      if (slug === null) {
        fail(`${CATALOGUE} row ${i} has no string \`slug\`; buildRegistry drops it and serves nothing for it.`);
      } else if (!pattern.test(slug)) {
        fail(
          `${CATALOGUE} row ${i} has slug "${slug}", which APP_ID_PATTERN rejects. buildRegistry DROPS ` +
            'it, so the app is in the public catalogue and absent from the served config set — the ' +
            'silent shrink this guard exists to make loud.',
        );
      }
    }
  }
}

// ── 5 · NO SLUG TWICE ────────────────────────────────────────────────────────
{
  const seen = new Set();
  for (const slug of slugs) {
    if (slug === null) continue;
    if (seen.has(slug)) {
      fail(
        `${CATALOGUE} lists "${slug}" more than once. buildRegistry keys on the slug, so the LAST row ` +
          'wins and the other is served to nobody while still being advertised publicly.',
      );
    }
    seen.add(slug);
  }
}

// ── 6 · `defaults` IS A COMPLETE AppConfig ───────────────────────────────────
// 🔴 THE LIMB THAT MAKES ONBOARDING MEAN SOMETHING. An app with no entry in the
// value document is served `defaults` and nothing else. If `defaults` is
// partial, app #2 is onboarded with no source edit — and gets a config missing
// `min_supported_version`, which the client parses into whatever its fallback
// is. The onboarding works and the app is broken, which is worse than a 404.
//
// The required key set is parsed from the AppConfig INTERFACE, not kept here, so
// adding a field to the contract without a default fails this the same day.
// `app_id` and `api_base_url` are excluded because they are DERIVED per app from
// the catalogue row and would be wrong as portfolio-wide defaults.
{
  const iface = /export interface AppConfig\s*\{([\s\S]*?)\n\}/.exec(typesSrc);
  if (!iface) {
    coverageLost(`\`export interface AppConfig\` could not be parsed out of ${TYPES_TS}.`);
  } else {
    const DERIVED = new Set(['app_id', 'api_base_url']);
    const required = [...iface[1].matchAll(/^\s{2}(\w+)(\??)\s*:/gm)]
      .filter((k) => k[2] !== '?' && !DERIVED.has(k[1]))
      .map((k) => k[1]);
    if (required.length === 0) {
      coverageLost(
        `no required field parsed out of AppConfig in ${TYPES_TS}; the completeness check would pass ` +
          'over an empty key set.',
      );
    }
    const defaults = data && typeof data.defaults === 'object' && data.defaults !== null ? data.defaults : null;
    if (defaults === null) {
      fail(`${DATA} has no \`defaults\` object. Every app without its own entry would be served nothing.`);
    } else {
      for (const k of required) {
        if (!Object.prototype.hasOwnProperty.call(defaults, k)) {
          fail(
            `${DATA} \`defaults\` is missing "${k}", which AppConfig declares as required. An app ` +
              'onboarded by a catalogue row alone would be served an INCOMPLETE config — B-2 satisfied ' +
              'and the app broken.',
          );
        }
      }
      notes.push(`defaults carry all ${required.length} required AppConfig field(s).`);
    }
  }
}

// ── 7 · THE SHARED API BASE IS ONE STRING, NOT TWO ───────────────────────────
// A client-only stamp compiles `https://platform.nikatru.com/v1` in as its
// fallback (pre_gen.dart) and is SERVED whatever `sharedApiBaseUrl` says. The
// two disagreeing is a divergence that passes every test and dies in production
// — [pipeline C-6]'s shape — so the literal is compared, not trusted.
{
  const m = /api_base_url'\]\s*=\s*needsBackend\s*\?\s*'[^']*'\s*:\s*'([^']*)'/.exec(preGenSrc);
  if (!m) {
    coverageLost(
      `the client-only \`api_base_url\` literal could not be parsed out of ${PRE_GEN}. The server's ` +
        'shared base was then compared against nothing.',
    );
  } else if (data.sharedApiBaseUrl !== m[1]) {
    fail(
      `TWO SPELLINGS OF ONE HOST — ${DATA} serves a client-only app ` +
        `"${data.sharedApiBaseUrl}" while ${PRE_GEN} compiles "${m[1]}" into it as its fallback. ` +
        'Whichever is wrong, the app works in every test (the fallback answers) and calls a dead host ' +
        'the moment runtime config resolves.',
    );
  } else {
    notes.push(`shared api base "${m[1]}" agrees with the brick's compiled-in fallback.`);
  }
}

done();

function done() {
  // The served set, PRINTED every run. This guard cannot see the live edge, so
  // the one thing it can do about a shrink is make it impossible to miss.
  if (Array.isArray(catalogue)) {
    const shared = data && typeof data.sharedApiBaseUrl === 'string' ? data.sharedApiBaseUrl : '(none)';
    const rows = catalogue
      .filter((r) => r && typeof r.slug === 'string')
      .map((r) => {
        const api = typeof r.api === 'string' && r.api.trim() !== '' ? `${r.api.replace(/\/+$/, '')}/v1` : shared;
        return `      ${r.slug} → ${api}`;
      });
    console.log(`[4]B-2 served config set — ${rows.length} app(s), derived from ${CATALOGUE}:`);
    for (const r of rows) console.log(r);
    console.log(
      '      (a catalogue row reaches the edge only after `wrangler deploy` — both files are bundled ' +
        'at build time.)',
    );
  }
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-config-registry: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  console.log('✓ assert-config-registry: the served app set is data, complete, and singly spelled.');
  process.exit(0);
}
