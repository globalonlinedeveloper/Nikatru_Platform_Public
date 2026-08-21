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
// ── WHAT IT DELIBERATELY DOES NOT CLAIM ──────────────────────────────────────
// It does NOT claim the live 404 is gone. Both files are BUNDLED at build time
// (a Worker has no filesystem), so a catalogue row reaches the edge only after
// `wrangler deploy`. That is a fact about the deployment, not about the repo,
// and this guard has no credentials — asserting it here would be an assertion
// that cannot fail. The served set is PRINTED on every run instead, so a shrink
// is visible to a reader even though it cannot fail a build.
//
// Usage:  node tooling/ci/assert-config-registry.mjs [repoRoot]
// Exit:   0 = the served set is data and complete · 1 = one of the eight above.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());

const CATALOGUE = 'catalog/apps.json';
const CONFIG_TS = 'services/platform/src/config.ts';
const DATA = 'services/platform/src/app-config-data.json';
const TYPES_TS = 'services/platform/src/types.ts';
const PRE_GEN = 'tooling/bricks/app/hooks/pre_gen.dart';
const DISCOVERY = 'tooling/sites/generate-discovery.mjs';

/** The roots limb 8 looks for a Dart reader of a served feature key in. The same
 *  three assert-adapter-capabilities.mjs scans for its promo-cap tripwire, and
 *  deliberately so: two guards asking "does shipped Dart read this config key"
 *  over two different file sets is two answers to one question. */
const DART_ROOTS = ['apps', 'packages', 'tooling/bricks'];

/** A scanner needs a test that it is still scanning what it thinks. These six
 *  files ARE the subject: with any one of them unread every limb below is
 *  vacuously true, and an empty domain reads exactly like a compliant one.
 *
 *  DISCOVERY joined the set on 2026-08-21 with limb 8. It is not decoration:
 *  its FEATURE_NAMES map is where three of the four served feature keys are
 *  actually read, so with that file unread limb 8 would report the live landing
 *  page's own content as dead configuration. */
const REQUIRED_COVERAGE = [CATALOGUE, CONFIG_TS, DATA, TYPES_TS, PRE_GEN, DISCOVERY];

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
{
  /** Non-test Dart under DART_ROOTS. `test/` and `integration_test/` are cut
   *  because a key read only by a test is exactly the state this limb reports:
   *  counting them would make every dead key look alive. */
  const dartUnder = (dir, out) => {
    let entries;
    try {
      entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
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

  // Comment-stripped ONCE and kept, because the const declarations and the call
  // sites are resolved in two passes: `kPromoCardFeature` is declared in
  // state/providers.dart and called in features/home/home_screen.dart, so a
  // single-pass scan would resolve it or not depending on directory order.
  const dartSrc = new Map();
  for (const rel of dartFiles) {
    dartSrc.set(rel, stripSourceComments(readFileSync(join(ROOT, rel), 'utf8'), '.dart'));
  }

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
