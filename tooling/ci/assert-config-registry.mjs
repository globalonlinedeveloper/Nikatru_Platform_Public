#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-config-registry.mjs — ONBOARDING AN APP IS A DATA EDIT, NOT A SOURCE ONE.
//
// [pipeline 4]B-2, Private/requirements/ (was pipeline/04-backend-platform.md,
// folded into that JSON spec 2026-08-15).
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
//   8. a served `features` key is switched ON and NOTHING reads it — a capability
//      the config claims and no surface delivers.
//   9. an OPTIONAL AppConfig field is emitted with no reader, or read with no
//      emitter — the two halves of a dead seam, one of which reports healthy.
//  10. `AppConfig.text(key)` acquires a non-test caller — an accessor whose
//      fallback is the raw KEY, on a surface where the raw key is user-facing.
//
// ⚠️ LIMB 8 IS THE ONE WITH A PRINTED HALF, and the sentence above ("every limb
// below is a GATE, not a MONITOR") was true until 2026-08-21 and is corrected
// rather than deleted. Limb 8 GATES on a served feature key that is `true` with
// no reader; it PRINTS a served feature key that is `false` with no reader. The
// asymmetry is `max_promos_per_week`'s, one field over: that key is served 0,
// read by nothing that acts on it, and this repo treats it as a LEVER SHIPPING
// BEFORE ITS SENDER — printed on every run by assert-ads-declarations.mjs and by
// assert-adapter-capabilities.mjs's "TRIPWIRE ARMED, DOMAIN EMPTY" note, never
// failed. A disarmed switch nobody reads changes nothing when its reader lands.
// An ARMED switch nobody reads is the opposite: the document asserts the app has
// the capability, and the first surface to honour it inherits a decision no one
// made. So the value decides, not the key.
//
// ⚠️ LIMBS 9 AND 10 (2026-08-25) HAVE PRINTED HALVES FOR THE SAME REASON, and
// they exist because limb 6 CANNOT SEE PAST A QUESTION MARK: its required set is
// built with `.filter((k) => k[2] !== '?')`, so an optional field of the
// AppConfig interface escapes the completeness check by construction, and limb 8
// ranges over `features` only. `theme?` sat in exactly that gap — declared and
// parsed on BOTH sides, emitted by no producer and read by no consumer, with the
// one dead field also being the one hardcoded past `config.test.ts`'s stray-key
// assertion. It is PRINTED rather than deleted because it is the server-side home
// of the owner's brand-vs-seed decision; it FAILS the moment either end moves
// without the other. Limb 10 is the same shape for a method: `AppConfig.text` is
// bypassed on purpose by all three live copy surfaces, and the first non-test
// caller fails the build.
//
// ── CORRECTION 2026-08-25 · OBSERVATION 10 IS RETIRED, NOT RELAXED ──────────
// Everything above stands as written and is corrected rather than deleted.
// `AppConfig.text(key)` NO LONGER EXISTS: it was removed from
// packages/core/lib/src/config/app_config.dart together with its only two call
// sites, the two assertions in packages/core/test/config_test.dart that limb 10
// named as the thing its deletion was waiting on. Observation 10 can therefore
// no longer be made — an accessor that is gone cannot acquire a caller — so the
// Exit line's "one of the ten above" now reads one of the NINE above, and limb
// 10 was DELETED rather than left printing "its subject is gone" on every run.
// That branch existed to say "delete me"; keeping it would be keeping a check
// that cannot fail, which this file already refuses one limb over (see the
// absent `dartFiles.length === 0` branch in limb 8 and the reason recorded
// beside it). Tests 10a–10h went with it in the same change.
//
// THE [O3] RULE THE LIMB ENFORCED IS UNCHANGED AND STILL LIVE. The `copy` map is
// still read directly on three surfaces — subly's home_screen and
// onboarding_screen and the brick's onboarding_screen — each supplying a designed
// l10n default and each treating a blank override as absent. What is gone is the
// accessor that got that rule wrong, not the rule.
//
// ── APPENDED 2026-08-25 · OBSERVATION 10 RETURNS, WITH A DIFFERENT SUBJECT ───
// Both blocks above are left exactly as written. The retirement was right about
// the ACCESSOR and wrong about what it left behind: deleting the one place that
// got [O3] wrong is not the same as keeping [O3], and the block above says so
// itself — "the rule is unchanged and still live" — while the change that wrote
// it removed the only mechanical enforcement the rule had. Between that commit
// and this one, a freshly reintroduced `copy[key] ?? key` failed nothing.
//
// So observation 10 now reads: a shipped `copy` READ falls back to the raw key,
// or reads an override without treating a blank one as absent. Same rule, same
// [O3] reason, and a domain that is NOT empty — FOUR live read sites, measured
// and PRINTED on every run rather than typed into this prose. It subsumes the
// old limb without needing the accessor to exist: `app_config.dart` is in
// `dartFiles`, so re-declaring `String text(String key) => copy[key] ?? key;`
// fails limb 10 on the declaration alone, with no caller required.
//
// ⏱ TWO NUMBERS IN THE BLOCK ABOVE ARE WRONG AND ARE CORRECTED HERE, NOT EDITED
// THERE. (1) "three surfaces" is four — both brick screens read the map, not
// just the brick's onboarding one; the recipe and the four paths are written out
// beside limb 10. (2) "the Exit line's 'one of the ten above' now reads one of
// the NINE above" described an edit that was never made: the Exit line below
// still says TEN, was never changed to nine, and is correct again today. A
// correction that describes a change instead of making it is the drift this
// file's own limb 8 exists to catch, one register up.
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
// Exit:   0 = the served set is data and complete · 1 = one of the ten above.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripSourceComments } from './text-reductions.mjs';
// 🔴 EVERY directory listing in tooling/ci goes through `listDir`, and
// assert-walks-bounded.mjs enforces that on every run — it is the one place
// that knows which trees a guard may not leave. The reader-scan below was
// written with a bare `readdirSync` and CI caught it immediately.
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());

const CATALOGUE = 'catalog/apps.json';
const CONFIG_TS = 'services/platform/src/config.ts';
const DATA = 'services/platform/src/app-config-data.json';
const TYPES_TS = 'services/platform/src/types.ts';
const PRE_GEN = 'tooling/bricks/app/hooks/pre_gen.dart';
const DISCOVERY = 'tooling/sites/generate-discovery.mjs';
const APP_CONFIG_DART = 'packages/core/lib/src/config/app_config.dart';

/** The roots limb 8 looks for a Dart reader of a served feature key in. The same
 *  three assert-adapter-capabilities.mjs scans for its promo-cap tripwire, and
 *  deliberately so: two guards asking "does shipped Dart read this config key"
 *  over two different file sets is two answers to one question. */
const DART_ROOTS = ['apps', 'packages', 'tooling/bricks'];

/** A scanner needs a test that it is still scanning what it thinks. These seven
 *  files ARE the subject: with any one of them unread every limb below is
 *  vacuously true, and an empty domain reads exactly like a compliant one.
 *
 *  DISCOVERY joined the set on 2026-08-21 with limb 8. It is not decoration:
 *  its FEATURE_NAMES map is where three of the four served feature keys are
 *  actually read, so with that file unread limb 8 would report the live landing
 *  page's own content as dead configuration.
 *
 *  APP_CONFIG_DART joined on 2026-08-25 with limbs 9 and 10. It is the CLIENT
 *  half of the contract `types.ts` declares, and both new limbs are questions
 *  about it: with that file unread, limb 9's mirror check would pass over
 *  nothing and limb 10 would report a dead accessor whose declaration it never
 *  looked for.
 *
 *  CORRECTION 2026-08-25 — limb 10 was deleted later the same day, with
 *  `AppConfig.text`. APP_CONFIG_DART STAYS IN THIS LIST REGARDLESS: limb 9
 *  still reads it as the Dart mirror of the `types.ts` interface, so dropping
 *  it here would exit at limb 0 with COVERAGE LOST and take limb 9's mirror
 *  check down with it. */
const REQUIRED_COVERAGE = [CATALOGUE, CONFIG_TS, DATA, TYPES_TS, PRE_GEN, DISCOVERY, APP_CONFIG_DART];

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
const discoverySrc = code(DISCOVERY, '.mjs');
if (problems.length) done();

// ── 1 · THE SET COMES FROM THE CATALOGUE ─────────────────────────────────────
// Two halves, because either alone is satisfiable with the defect present: an
// import nothing uses is dead, and a builder fed a literal is the old registry.
{
  const imp = /import\s+(\w+)\s+from\s+'(?:\.\.\/)+catalog\/apps\.json'/.exec(configSrc);
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

// ── 8 · EVERY SERVED `features` KEY THAT IS ON HAS A READER ──────────────────
// 🔴 THE LIMB THAT EXISTS BECAUSE THE EVIDENCE FOR "THIS KEY IS DEAD" WAS
// LANGUAGE-SCOPED AND WRONG. Measured 2026-08-21: `apps.subly.features` serves
// renewals/budgets/exports; 185 non-test Dart files read NONE of them (the one
// `.feature(` call in shipped Dart, home_screen.dart:1573, asks for
// `promo_card_enabled`, which this document does not serve at all); and
// services/platform/test/config.test.ts + packages/core/test/config_test.dart
// are TESTS. Every one of those observations is true, and the conclusion they
// invite — dead data, delete it — is false: tooling/sites/generate-discovery.mjs
// FEATURE_NAMES maps all three to a title and a blurb, and they are three
// bullets on sites/nikatru/apps/subly.html today, which Cloudflare Pages serves
// out of this repo to strangers.
//
// So the reader set this limb builds is the UNION of both surfaces. A guard that
// looked at one language would have licensed the deletion instead of stopping
// it, which is the precise defect it is here to prevent.
//
// The verdict is decided by the VALUE, for the reason in the header:
//   · on  (`true`) + no reader → FAIL. A claimed capability nothing delivers.
//   · off (`false`) + no reader → PRINTED. `max_promos_per_week`'s shape: a
//     lever that ships disarmed, declared before its reader, changing nothing.
//   · anything not a boolean → FAIL. packages/core `_boolMap` DROPS a non-bool
//     value silently and generate-discovery.mjs's `on !== true` skips it, so it
//     is a key that reads as configuration and reaches no surface at all.
// ── THE SHIPPED-DART CORPUS, READ ONCE FOR LIMBS 8, 9 AND 10 ─────────────────
// (CORRECTION 2026-08-25: limb 10 was deleted with `AppConfig.text`; the corpus
//  below is now read once for limbs 8 and 9.)
/** Non-test Dart under DART_ROOTS. `test/` and `integration_test/` are cut
 *  because a key read only by a test is exactly the state these limbs report:
 *  counting them would make every dead key look alive.
 *
 *  ⚠️ HOISTED OUT OF LIMB 8's BLOCK on 2026-08-25 when limbs 9 and 10 arrived.
 *  Three limbs asking "does shipped Dart read this" over three separately built
 *  file lists is three answers to one question, and the two that drift are the
 *  ones nobody re-measures. */
const dartUnder = (dir, out) => {
  let entries;
  try {
    entries = listDir(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'build' || e.name === 'node_modules') continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) dartUnder(rel, out);
    else if (e.name.endsWith('.dart')) out.push(rel);
  }
  return out;
};
const dartFiles = DART_ROOTS.reduce((acc, d) => dartUnder(d, acc), []).filter(
  (rel) => !/\/(?:test|integration_test)\//.test(rel),
);

// Comment-stripped ONCE and kept, because limb 8's const declarations and its
// call sites are resolved in two passes: `kPromoCardFeature` is declared in
// state/providers.dart and called in features/home/home_screen.dart, so a
// single-pass scan would resolve it or not depending on directory order. Limbs
// 9 and 10 need the SAME reduction for a different reason — the brick's
// onboarding screen explains in a doc comment why it does not call
// `AppConfig.text`, and a raw-text scan would read that explanation as the
// caller limb 10 exists to find.
// (CORRECTION 2026-08-25: limb 10 is deleted. The reduction is still
//  load-bearing for limb 9, whose BOUND `.theme` scan reads the same map and
//  would otherwise resolve identifiers named inside doc comments.)
const dartSrc = new Map();
for (const rel of dartFiles) {
  dartSrc.set(rel, stripSourceComments(readFileSync(join(ROOT, rel), 'utf8'), '.dart'));
}

{
  const featureConsts = new Map();
  for (const src of dartSrc.values()) {
    for (const m of src.matchAll(/\bconst\s+String\s+(\w+)\s*=\s*(['"])([^'"]*)\2/g)) {
      featureConsts.set(m[1], m[3]);
    }
  }

  const dartReaders = new Map(); // feature key → [file, …]
  const unresolved = [];
  let callSites = 0;
  for (const [rel, src] of dartSrc) {
    for (const m of src.matchAll(/\.feature\(\s*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))/g)) {
      callSites++;
      const key = m[2] ?? featureConsts.get(m[3]);
      if (key === undefined) {
        unresolved.push(`${rel} → feature(${m[3]})`);
        continue;
      }
      if (!dartReaders.has(key)) dartReaders.set(key, []);
      dartReaders.get(key).push(rel);
    }
  }

  // The site half. FEATURE_NAMES is PARSED out of the generator rather than
  // copied here for the same reason APP_ID_PATTERN is in limb 4: a second copy
  // of a rule is a second thing to disagree with.
  const namesBlock = /FEATURE_NAMES\s*=\s*new Map\(\s*\[([\s\S]*?)\]\s*\)/.exec(discoverySrc);
  const siteReaders = new Set();
  if (!namesBlock) {
    coverageLost(
      `FEATURE_NAMES could not be parsed out of ${DISCOVERY}. It is where the landing page's feature ` +
        'bullets get their reader-facing names, so without it every key it renders would be reported as ' +
        'having no reader — this guard would license deleting the content of a live public page.',
    );
  } else {
    for (const m of namesBlock[1].matchAll(/\[\s*(['"])([^'"]+)\1/g)) siteReaders.add(m[2]);
  }

  // ── COVERAGE — three ways this limb would range over nothing ──────────────
  //
  // ⚠️ THERE IS NO `dartFiles.length === 0` BRANCH, AND ITS ABSENCE IS THE
  // POINT. The first draft had one. It cannot fail: PRE_GEN is
  // `tooling/bricks/app/hooks/pre_gen.dart`, it is in REQUIRED_COVERAGE, it is
  // a `.dart` file under a DART_ROOT, and limb 0 calls done() before this code
  // runs when it is missing — so by the time control reaches here the count is
  // at least 1, always. This file's own test suite is what found that: the case
  // written to prove the branch instead proved it unreachable, tripping the
  // `callSites === 0` limb below. An assertion that cannot fail is worse than
  // none, so it is deleted rather than kept "for safety", and `callSites === 0`
  // subsumes it anyway — zero files means zero call sites.
  if (callSites === 0) {
    coverageLost(
      `limb 8 scanned ${dartFiles.length} non-test Dart file(s) and found ZERO \`feature(\` call sites. ` +
        'Either `AppConfig.feature` was renamed or the call shape moved; until it is re-pointed, "no Dart ' +
        'reader" is a fact about this regex, not about the tree.',
    );
  }
  if (unresolved.length) {
    coverageLost(
      `limb 8 cannot resolve the key read by ${unresolved.join(', ')} — the argument is neither a string ` +
        'literal nor a `const String` this scan can see. A key read through a runtime value cannot be ' +
        'proven unread, so the whole limb would be reporting a floor rather than the truth.',
    );
  }
  if (namesBlock && siteReaders.size === 0) {
    coverageLost(`FEATURE_NAMES in ${DISCOVERY} parsed to ZERO keys; the site half of the reader set is empty.`);
  }

  // ── THE DOMAIN: every feature key this document actually serves ───────────
  const served = []; // {key, value, where}
  const collect = (obj, where) => {
    const f = obj && typeof obj === 'object' ? obj.features : undefined;
    if (f === null || typeof f !== 'object' || Array.isArray(f)) return;
    for (const [key, value] of Object.entries(f)) served.push({ key, value, where });
  };
  collect(data.defaults, 'defaults');
  for (const [slug, entry] of Object.entries(data.apps ?? {})) collect(entry, `apps.${slug}`);

  if (problems.length === 0) {
    const disarmed = [];
    let wired = 0;
    for (const { key, value, where } of served) {
      const readBy = [
        ...(dartReaders.get(key) ?? []),
        ...(siteReaders.has(key) ? [`${DISCOVERY} FEATURE_NAMES`] : []),
      ];
      if (typeof value !== 'boolean') {
        fail(
          `${DATA} ${where}.features.${key} = ${JSON.stringify(value)}, which is not a boolean. ` +
            "packages/core's `_boolMap` keeps only bool values and drops the rest without a word, and " +
            `${DISCOVERY} renders a bullet only for \`=== true\` — so this key is served, carried over the ` +
            'wire, and read by nothing on either side. Dead data that reads as configuration.',
        );
      } else if (readBy.length > 0) {
        wired++;
      } else if (value === true) {
        fail(
          `${DATA} ${where}.features.${key} is served TRUE and NOTHING reads it. Measured this run: ` +
            `${dartFiles.length} non-test Dart file(s) carrying ${callSites} \`feature(\` call site(s), and ` +
            `FEATURE_NAMES in ${DISCOVERY}. An ON switch nobody reads is a capability this document claims ` +
            'and no surface delivers — and the first surface to honour it later inherits a decision nobody ' +
            'made. Give it a reader, or serve it `false` (a disarmed lever is printed, not failed).',
        );
      } else {
        disarmed.push(`${where}.features.${key}`);
      }
    }
    if (wired > 0) notes.push(`${wired} served feature key(s) have a non-test reader in Dart or ${DISCOVERY}.`);
    if (disarmed.length) {
      notes.push(
        `DISARMED FEATURE LEVER(S), printed not failed — ${disarmed.join(', ')}. Served \`false\` with no ` +
          "reader on either surface: `max_promos_per_week`'s shape, a lever declared before its reader. " +
          'Nothing changes when the reader lands, which is why this prints instead of failing.',
      );
    }

    // The other direction, PRINTED for the reason the header gives for the live
    // edge: this guard cannot decide it. A key shipped code reads and this
    // document does not serve resolves to `feature()`'s `orElse: false` — and
    // for `promo_card_enabled` that is DELIBERATE and owner-gated, because
    // serving it true turns the app into a promotional surface and makes
    // apps/subly/store/android-play/ads-declaration.json re-derivable.
    // assert-stamp-properties.mjs:787 pins the absent-means-false read. Failing
    // here would block CI on a decision only the owner can take.
    const servedKeys = new Set(served.map((r) => r.key));
    const unserved = [...dartReaders.keys()].filter((k) => !servedKeys.has(k));
    if (unserved.length) {
      notes.push(
        `READ BUT UNSERVED — ${unserved.map((k) => `${k} (${dartReaders.get(k).length} call site(s))`).join(', ')}. ` +
          `${DATA} serves no such key, so \`feature()\` answers its \`orElse: false\` and the capability is ` +
          'dark on every device. Printed, not failed: arming one of these is an owner decision.',
      );
    }
  }
}

// ── 9 · AN *OPTIONAL* AppConfig FIELD IS STILL A FIELD ───────────────────────
// 🔴 THE LIMB THAT EXISTS BECAUSE LIMB 6 CANNOT SEE PAST A QUESTION MARK.
// Limb 6 derives its completeness set with `.filter((k) => k[2] !== '?')`, so an
// OPTIONAL field of the AppConfig interface is outside it by construction, and
// limb 8 ranges over `features` only. Measured 2026-08-25, `theme?` was the one
// optional field in the contract, and it was the one field with no emitter, no
// reader and (until that day) no doc comment — sitting between two fields that
// each carry a full paragraph explaining why they ship ahead of a reader.
//
// The two failing directions are not symmetric decorations; both have happened
// in this repository:
//   · EMITTED AND UNREAD — the value document serves a key that reaches every
//     client's parser and no surface. That is limb 8's `features` failure, one
//     level up, for a field rather than a flag.
//   · READ AND UNEMITTED — the client parses a key the server is STRUCTURALLY
//     INCAPABLE of sending, so the runtime branch can never be taken and every
//     test passes because falling back is correct when a value is absent.
//     `update_url` was in exactly that state for weeks; `src/types.ts` records
//     it as "instance five" of that shape.
// Neither → PRINTED as an armed tripwire, in the idiom
// assert-adapter-capabilities.mjs uses for `max_promos_per_week`: an empty
// domain that says so cannot be mistaken for a rule that held.
//
// ⚠️ WHAT THE READER SCAN CAN GET WRONG, AND IN WHICH DIRECTION — REWRITTEN
// 2026-08-25. The paragraph that stood here is kept as a dated CORRECTION at the
// end of this block rather than deleted, because it asserted a SAFETY PROPERTY
// this code did not have and the record of that is the point.
//
// The scan computes TWO sets per optional key over comment-stripped non-test
// Dart, always excluding the class that declares the field:
//   · LOOSE — every file containing a member access `.<camelCase>` on ANY
//     receiver. `MaterialApp.theme` lands in this set.
//   · BOUND — the subset in which that access resolves TEXTUALLY to an
//     AppConfig-typed receiver. Per file, from the comment-stripped source: the
//     identifiers this file declares with an AppConfig type — the tree's idioms
//     are `final core.AppConfig? cfg = …`, `core.AppConfig cfg`, `AppConfig? cfg`
//     and the parameter form `_copy(core.AppConfig? cfg, …)` — plus the class
//     name itself, for static access. A name immediately followed by `(` is a
//     METHOD whose RETURN type is AppConfig (`AppConfig? peek(String appId)` in
//     config_loader.dart), not an identifier of that type, so it is excluded.
// BOUND ⊆ LOOSE by construction: both require the literal `.<camelCase>`.
//
// Each branch is fed the set whose ERROR DIRECTION is a visible FAIL:
//   · emitted + BOUND empty → FAIL. Resolution is textual, so it UNDER-reaches:
//     a receiver returned by a call (`_cache.peek(id)?.theme`), an identifier
//     declared in another file, a typedef. Under-reaching here produces a FAIL,
//     which is the safe way to be wrong — and every LOOSE file is NAMED in the
//     message as a near miss whose receiver did not resolve, so a genuine reader
//     the binding scan could not see is one glance to spot.
//   · unemitted + LOOSE non-empty → FAIL, and deliberately on the LOOSE set: in
//     THIS branch a false positive is a FAIL and a MISS would be a false pass, so
//     the broad matcher is the safe one here for the same reason the narrow one
//     is safe above. The files are named.
//   · emitted + BOUND non-empty → healthy note, which NAMES the bound files (and
//     any loose-only near miss) rather than counting them.
//   · neither → the armed-tripwire note, reached only when nothing is emitted and
//     the LOOSE set is empty too.
//
// ── CORRECTION 2026-08-25 ────────────────────────────────────────────────────
// From this limb's first commit until today the paragraph here read, in full:
//
//     "It matches a member access `.<camelCase>` in comment-stripped non-test
//      Dart, excluding the class that declares the field. That is deliberately
//      BROAD: `MaterialApp.theme` would count if it appeared in shipped Dart (it
//      appears only in widget TESTS today, which are cut). A broad matcher can
//      only turn a tripwire into a FAIL here — never a FAIL into a pass — so the
//      error it can make is the visible one, and every matched file is named in
//      the message so a false positive is one glance to disprove."
//
// BOTH HALVES WERE FALSE. There was ONE set, `\.<camel>\b`, feeding every branch.
// Measured on a byte mirror of 6d67631, two runs differing in ONE line:
//
//   A. add `"theme": {"seed":"#6459F5"}` to `defaults` in
//      services/platform/src/app-config-data.json
//      → EXIT 1, `services/platform/src/app-config-data.json emits optional
//        AppConfig field "theme" (defaults) and NOTHING reads it`. CORRECT.
//   B. the same, PLUS one line appended to
//      apps/subly/lib/features/home/home_screen.dart:
//          ThemeData? _appTheme(MaterialApp app) => app.theme;
//      → EXIT 0, `ok  optional AppConfig field "theme" is emitted (defaults) and
//        read by 1 non-test Dart file(s).`
//
// One unrelated line of shipped Dart turned a correct FAIL into a PASS. That is
// a RED-to-GREEN loosening — strictly worse than the seam it polices — and it
// fires exactly when `theme` starts moving, because `.theme` on a non-AppConfig
// receiver is what a theming change introduces. Measured this run, `app.theme`
// on a MaterialApp already occurs 6 times in this tree, 3 in
// apps/subly/test/chassis_properties_test.dart and 3 in the brick's copy — all
// under /test/ today, so cut by the filter, and that is a property of where they
// happen to live, not of the matcher.
//
// The second half was false too, and independently: the PASSING branch printed a
// COUNT (`read by N non-test Dart file(s)`) and named no file at all. Only the
// read-and-unemitted FAIL branch named files. Both are fixed below; the passing
// note now names its readers.
{
  const iface = /export interface AppConfig\s*\{([\s\S]*?)\n\}/.exec(typesSrc);
  const dartMirror = code(APP_CONFIG_DART, '.dart');
  if (!iface) {
    coverageLost(`\`export interface AppConfig\` could not be parsed out of ${TYPES_TS} for limb 9.`);
  } else {
    const optional = [...iface[1].matchAll(/^\s{2}(\w+)(\??)\s*:/gm)]
      .filter((k) => k[2] === '?')
      .map((k) => k[1]);
    if (optional.length === 0) {
      notes.push(
        'AppConfig declares NO optional field today, so limb 9 has an empty domain and limb 6 covers every ' +
          'field in the contract. Printed rather than asserted: an empty domain that says so is not a rule ' +
          'that held.',
      );
    }

    // ── THE BINDING RESOLVER, limb-9-LOCAL ON PURPOSE ──────────────────────
    // It is not a shared module and must not become one: it answers a question
    // only this limb asks ("is this receiver an AppConfig?"), it is textual, and
    // a shared copy would invite a second caller with a different tolerance for
    // under-reach. NOT_A_SCANNER in assert-guard-coverage.mjs is this repo's
    // index of what IS shared; nothing there resolves a Dart receiver type.
    //
    // `AppConfig` is seeded into every file's set so `AppConfig.<field>` static
    // access resolves, which is why the emptiness check below asks for size > 1.
    const APPCONFIG_DECL = /\bAppConfig\s*\??\s+([A-Za-z_$][\w$]*)\b(?!\s*\()/g;
    const bindings = new Map(); // rel → Set<identifier of AppConfig type>
    if (optional.length > 0) {
      for (const [rel, src] of dartSrc) {
        if (rel === APP_CONFIG_DART) continue;
        const idents = new Set(['AppConfig']);
        for (const m of src.matchAll(APPCONFIG_DECL)) idents.add(m[1]);
        bindings.set(rel, idents);
      }
      // COVERAGE. With ZERO AppConfig-typed identifiers anywhere in the corpus,
      // BOUND is empty for every key no matter what the tree reads, and the
      // emitted branch below would be failing on a fact about this regex rather
      // than about the tree. The real tree has these declarations in
      // home_screen.dart, onboarding_screen.dart, money_providers.dart,
      // providers.dart, config_loader.dart, default_configs.dart and the brick
      // copies, so an empty result means the idiom moved.
      if (![...bindings.values()].some((s) => s.size > 1)) {
        coverageLost(
          `limb 9 resolved ZERO AppConfig-typed identifiers across ${dartFiles.length} non-test Dart file(s). ` +
            'Its binding scan looks for `final core.AppConfig? cfg = …`, `core.AppConfig cfg` and the parameter ' +
            'form `_copy(core.AppConfig? cfg, …)`; with none found, "no bound reader" is a fact about that ' +
            'pattern and not about the tree, and every emitted optional field would fail for the wrong reason.',
        );
      }
    }

    for (const key of optional) {
      const camel = key.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase());
      // The MIRROR half. `packages/core`'s AppConfig opens by declaring itself a
      // mirror of this contract; a server field the client does not parse is a
      // field no client can ever read, so the reader scan below would be
      // reporting a fact about the Dart class rather than about the tree.
      if (!new RegExp(`\\b${camel}\\b`).test(dartMirror)) {
        fail(
          `${TYPES_TS} declares optional AppConfig field "${key}" and ${APP_CONFIG_DART} does not mention ` +
            `\`${camel}\`. That file's own header calls itself a mirror of this contract, and a key the client ` +
            'never parses is a key no client can read — so limb 9 would be scanning for a symbol that does not ' +
            'exist. Mirror it, or drop it from the interface.',
        );
        continue;
      }
      const emittedIn = [];
      const carries = (obj) => obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
      if (carries(data.defaults)) emittedIn.push('defaults');
      for (const [slug, entry] of Object.entries(data.apps ?? {})) {
        if (carries(entry)) emittedIn.push(`apps.${slug}`);
      }

      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const access = new RegExp(`\\.${camel}\\b`);
      const looseReaders = [];
      const boundReaders = [];
      for (const [rel, src] of dartSrc) {
        if (rel === APP_CONFIG_DART) continue;
        if (!access.test(src)) continue;
        looseReaders.push(rel);
        const idents = [...(bindings.get(rel) ?? new Set())].map(esc).join('|');
        if (idents && new RegExp(`\\b(?:${idents})\\s*[?!]?\\s*\\.${camel}\\b`).test(src)) boundReaders.push(rel);
      }
      // ⚠️ THIS ONE CANNOT BE REDDENED BY ANY TREE, and that is stated rather
      // than hidden. BOUND ⊆ LOOSE holds because both patterns require the
      // literal `.<camel>`; the assertion exists to catch an edit to THIS FILE's
      // two patterns that decouples them. Proved able to fire, on a mirror of
      // 6d67631 (2026-08-25), by dropping `\\.${camel}\\b` from the BOUND pattern
      // above — 27 stray files, EXIT 1. Dropping the LOOSE gate alone does NOT
      // fire it, which is the measurement that says the coupling is in the two
      // patterns and not in the loop. Every branch below reads its verdict off
      // one set or the other, so the two drifting apart is the one way the branch
      // table stops meaning what the paragraph above says it means.
      const strays = boundReaders.filter((r) => !looseReaders.includes(r));
      if (strays.length) {
        coverageLost(
          `limb 9's BOUND set is not a subset of its LOOSE set for "${key}" (${strays.join(', ')}). The two ` +
            'patterns have been edited apart, so the branch table above no longer means what its header says.',
        );
      }
      const nearMiss = looseReaders.filter((r) => !boundReaders.includes(r));

      if (emittedIn.length > 0 && boundReaders.length === 0) {
        fail(
          `${DATA} emits optional AppConfig field "${key}" (${emittedIn.join(', ')}) and NOTHING reads it off ` +
            `an AppConfig-typed receiver. Measured this run: ${dartFiles.length} non-test Dart file(s) scanned ` +
            `for \`.${camel}\` bound to an AppConfig identifier, excluding ${APP_CONFIG_DART} itself. A field ` +
            "on the wire that reaches every client's parser and no surface is dead data that reads as " +
            "configuration — limb 8's failure one level up, for a field rather than a flag." +
            (nearMiss.length
              ? ` NEAR MISS — \`.${camel}\` also occurs in ${nearMiss.join(', ')}, on a receiver this scan ` +
                'could NOT resolve to AppConfig (a call result, a cross-file declaration, a typedef — or a ' +
                'genuinely unrelated receiver such as `MaterialApp.theme`). Binding resolution is textual and ' +
                'under-reaches on purpose, because under-reaching fails and over-reaching would pass.'
              : ''),
        );
      } else if (emittedIn.length === 0 && looseReaders.length > 0) {
        fail(
          `optional AppConfig field "${key}" is READ by ${looseReaders.join(', ')} and ${DATA} emits it from ` +
            'NOWHERE — not `defaults`, not any `apps.*` entry. The runtime branch can therefore never be taken ' +
            'in production while every test passes, because falling back is the correct behaviour when a value ' +
            'is absent. That is the `update_url` seam verbatim; src/types.ts records it as instance five. Emit ' +
            'it, or delete the reader. (This branch reads the BROAD set on purpose: here a false positive is a ' +
            'FAIL and a miss would be a false pass.)',
        );
      } else if (emittedIn.length > 0) {
        notes.push(
          `optional AppConfig field "${key}" is emitted (${emittedIn.join(', ')}) and read off an ` +
            `AppConfig-typed receiver by ${boundReaders.join(', ')}.` +
            (nearMiss.length
              ? ` Also carrying \`.${camel}\` on an unresolved receiver, NOT counted as a reader: ` +
                `${nearMiss.join(', ')}.`
              : ''),
        );
      } else {
        notes.push(
          `optional AppConfig field "${key}" — TRIPWIRE ARMED, DOMAIN EMPTY (${dartFiles.length} non-test Dart ` +
            `file(s) scanned). ${DATA} emits it from nowhere and no shipped Dart mentions \`.${camel}\` on any ` +
            'receiver at all, so it can reach a client only through a hand-written CONFIG_KV override that ' +
            '`deepMerge` passes through unvalidated. Whichever end moves first — an emitter or a reader — this ' +
            'limb fails until the other one exists.',
        );
      }
    }
  }
}


// ── 10 · A COPY OVERRIDE NEVER FALLS BACK TO THE RAW KEY ─────────────────────
// 🔴 THE SUBJECT MOVED; THE RULE DID NOT. Limb 10 used to be "`AppConfig.text`
// does not acquire a non-test caller", and it was deleted on 2026-08-25 with the
// accessor — correctly, because a branch whose only remaining output is "my
// subject is gone" is a check that cannot fail. What that deletion ALSO removed,
// with nothing said, was the only mechanical enforcement of [O3] anywhere in the
// tree: the rule that an override REPLACES designed copy, that designed copy is
// the FALLBACK, and that the raw key is NEVER what a user sees. The accessor was
// merely the one place that got the rule wrong. Deleting the wrong implementation
// is not the same as keeping the rule, and between that deletion and this limb
// nothing in CI would have failed on a freshly reintroduced `copy[key] ?? key`.
//
// So this limb asks the question at the place the rule is actually exercised —
// the `copy` MAP's read sites — instead of at one dead accessor's declaration.
// MEASURED 2026-08-25 over `dartFiles`: FOUR non-test read sites, all four the
// same idiom.
//
//     final String? override = cfg?.copy[key];
//     return (override == null || override.trim().isEmpty) ? fallback : override;
//
// ⏱ APPENDED 2026-08-25 — the retired limb's prose (and the correction in this
// file's header) says the map is read directly on THREE surfaces. Re-measured
// today with `grep -rn "copy\[" --include=*.dart apps packages tooling`: there
// are FOUR non-test sites, not three — subly's home_screen.dart:1535 and
// onboarding_screen.dart:100, AND BOTH brick screens,
// `tooling/bricks/…/features/firstrun/onboarding_screen.dart:53` and
// `tooling/bricks/…/features/home/home_screen.dart:300`. The prose above is left
// as written and corrected here rather than rewritten. The count this limb
// PRINTS is derived from the scan on every run, so it cannot go stale the way
// that sentence did.
//
// TWO CONDITIONS, BOTH TAKEN FROM WHAT THE FOUR SITES ALREADY DO:
//   (A) NO RAW-KEY FALLBACK. `copy[k] ?? k` — the same key on both sides of the
//       `??` — is exactly the shape that greets a freshly stamped app's first
//       user with `onboarding.1.title`. It is identifier-sensitive on purpose:
//       `copy[key] ?? fallback` is the CORRECT shape and must not trip it, so a
//       bare "`copy[…]` followed by `??`" test would be the wrong check. This is
//       also what stops the deleted accessor coming back — `app_config.dart` is
//       in `dartFiles`, so re-declaring `String text(String key) => copy[key] ??
//       key;` fails this limb on the declaration itself, with no caller needed.
//   (B) A BLANK OVERRIDE IS ABSENT. All four sites treat the empty string and
//       whitespace as no override, and each says why in its own words: "a config
//       that ships an empty string is a config somebody half-edited". A site that
//       skips that check ships a blank heading, worse than the designed one.
//
// ⚠️ WHAT (B) CAN AND CANNOT SEE, STATED RATHER THAN IMPLIED. The window is the
// read's own `;`-delimited statement plus the TWO after it — which is what all
// four sites need and no more. It is a proximity rule, not a parse: a site that
// spread the blank test five statements later would fail this limb for a reason
// that is not quite true. That direction is the safe one (it fails ARMED, and the
// repair is to write the idiom the other four use), and it is why (B) names the
// statement window in its own message.
//
// ⚠️ AND THE SELF-CHECK, because a scan over zero sites reports perfect
// compliance. Zero `copy[` reads in the shipped tree is COVERAGE LOST, not a
// pass: it means either the surfaces stopped reading overrides — the config key
// that reaches no surface, this file's limb 8 in another costume — or the scan
// stopped reaching them.
{
  const IDENT_FALLBACK = /copy\s*\[\s*([A-Za-z_$][\w$]*)\s*\]\s*\?\?\s*([A-Za-z_$][\w$]*)/g;
  const LITERAL_FALLBACK = /copy\s*\[\s*(['"])([^'"]*)\1\s*\]\s*\?\?\s*(['"])([^'"]*)\3/g;

  const sites = [];
  const rawKey = [];
  const blankBlind = [];

  for (const [rel, src] of dartSrc) {
    // Split on `;` rather than on newlines: the window below is "this statement
    // and the next two", and a statement is what the idiom is written in. Line
    // proximity would move under a reformat that changes nothing.
    const stmts = src.split(';');
    let nth = 0;
    for (let i = 0; i < stmts.length; i++) {
      if (!/\bcopy\s*\[/.test(stmts[i])) continue;
      nth += 1;
      const where = `${rel} (read #${nth})`;
      sites.push(where);

      let key = null;
      for (const m of stmts[i].matchAll(IDENT_FALLBACK)) if (m[1] === m[2]) key = m[1];
      for (const m of stmts[i].matchAll(LITERAL_FALLBACK)) if (m[2] === m[4]) key = `'${m[2]}'`;
      if (key !== null) {
        rawKey.push(`${where}: \`copy[${key}] ?? ${key}\``);
        continue;
      }

      if (!/\bis(?:Not)?Empty\b/.test(stmts.slice(i, i + 3).join(';'))) blankBlind.push(where);
    }
  }

  if (sites.length === 0) {
    coverageLost(
      `no shipped Dart reads the \`copy\` map at all (${dartFiles.length} non-test Dart file(s) scanned), so ` +
        'this limb ranged over nothing and would have reported [O3] as honoured by an empty set. Either every ' +
        'override surface stopped reading overrides — a served `copy` document that reaches no surface, which ' +
        'is limb 8 in another costume — or DART_ROOTS no longer reaches the screens.',
    );
  } else if (rawKey.length) {
    fail(
      `a \`copy\` override falls back to the RAW KEY: ${rawKey.join(', ')}. A freshly stamped app has ` +
        'overridden nothing, so that ships the literal key to a user — `onboarding.1.title` as a heading. ' +
        '[O3] — an override REPLACES designed copy, designed copy is the FALLBACK, never the raw key. Read ' +
        '`copy[key]` and supply a designed l10n default, as all four live sites do. This is the shape ' +
        '`AppConfig.text(key)` had before it was deleted on 2026-08-25; it does not come back.',
    );
  } else if (blankBlind.length) {
    fail(
      `a \`copy\` override is read without treating a BLANK override as absent: ${blankBlind.join(', ')}. ` +
        'A config that ships an empty string is a config somebody half-edited, and a blank heading is worse ' +
        'than the designed one. Every live site answers `(override == null || override.trim().isEmpty) ? ' +
        'fallback : override` — inside the read\'s own statement or the two after it, which is the window ' +
        'this limb reads.',
    );
  } else {
    notes.push(
      `[O3] copy overrides — TRIPWIRE ARMED, ${sites.length} READ SITE(S) (${dartFiles.length} non-test Dart ` +
        `file(s) scanned): ${sites.join(', ')}. The sites are LISTED, not just counted, because "four" was ` +
        'prose in this file twice and was wrong both times. None falls back to the raw key and every one ' +
        'treats a blank override as absent. ' +
        'This is what replaced the deleted `AppConfig.text` limb: the rule is checked where the map is read, ' +
        'not at one accessor\'s declaration, so it stays armed with a NON-empty domain.',
    );
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
