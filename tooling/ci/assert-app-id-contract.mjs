#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-app-id-contract.mjs — the app id has ONE rule, every caller uses it,
// and every copy that cannot use it is at least as strict.
//
// Subject: contracts/app-id/app-id.js (+ its generated app-id.json).
// Row: O-APP-ID-FORM-UNVALIDATED, limb (a). Same form as
// contracts/store/ and tooling/ci/assert-store-vocabulary.mjs.
//
// ── WHY THIS GUARD EXISTS ────────────────────────────────────────────────────
// An app id becomes a Worker name, a D1 name, a DNS label, a Dart package, an
// Android applicationId and an Apple bundle id, and the two store ids cannot be
// changed after the first upload. Before the contract each caller carried its
// own regex and they disagreed: the stamper accepted `habit_tracker` (a Worker
// name and a DNS label cannot hold `_`), and it accepted up to 63 characters
// while services/platform/src/config.ts APP_ID_PATTERN drops anything over 32
// from the served set WITHOUT AN ERROR. So an app could be stamped, provisioned
// and deployed, and then never served.
//
// ── THE FOUR LIMBS ───────────────────────────────────────────────────────────
//   1. app-id.json is byte-for-byte what contracts/app-id/generate.mjs writes.
//   2. config.ts APP_ID_PATTERN, parsed the way assert-config-registry.mjs
//      parses it, accepts EVERY id in a generated sample the contract accepts
//      (each length from the minimum to the maximum, each letter first, each
//      letter and digit after it). config.ts is a Worker deploy path, so it is
//      graded here, not edited; it may stay the looser of the two.
//   3. The callers: provision-backend.mjs, assert-store-identity.mjs and
//      assert-catalog-contract.mjs IMPORT appIdProblems from the contract and
//      call it; pre_gen.dart reads contracts/app-id/app-id.json; and none of the
//      four carries an app-id regex of its own.
//      ⚠️ THAT LAST PART IS A HEURISTIC, and says so: it flags a regex literal
//      anchored on `^[a-z]` (JS `/^[a-z]…`, or `RegExp(r'^[a-z]…` in Dart) that
//      sits within 200 characters of `appId`, `app_id` or `slug`. A rule spelled
//      another way would pass it. tooling/ci/test/app-id-contract.test.mjs pins
//      the shape it does catch — the one every caller used before the contract.
//   4. tooling/app-yaml/schema/app.schema.json (`id`), privacy.schema.json
//      (`app`) and contracts/release.schema.json (`unit`) accept NO id in the
//      sample that the contract refuses on its pattern or its length. The
//      reserved words are not graded here: a JSON Schema pattern cannot carry
//      them, and the stamp refuses them first.
//
// Usage:  node tooling/ci/assert-app-id-contract.mjs [repoRoot]
// Exit codes: 0 green · 1 a finding · 2 COVERAGE LOST (not a pass): a caller, a
// schema, config.ts or the contract could not be read.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const CONTRACT_JS_REL = 'contracts/app-id/app-id.js';
const CONTRACT_JSON_REL = 'contracts/app-id/app-id.json';
const CONFIG_TS = 'services/platform/src/config.ts';

/** Every caller of the rule, and how it must reach the contract. */
const CALLERS = [
  { file: 'tooling/scripts/provision-backend.mjs', reads: 'import', specifier: '../../contracts/app-id/app-id.js' },
  { file: 'tooling/ci/assert-store-identity.mjs', reads: 'import', specifier: '../../contracts/app-id/app-id.js' },
  { file: 'tooling/ci/assert-catalog-contract.mjs', reads: 'import', specifier: '../../contracts/app-id/app-id.js' },
  { file: 'tooling/bricks/app/hooks/pre_gen.dart', reads: 'json', path: CONTRACT_JSON_REL },
];

/** The schemas that restate the rule, and the property that holds it. */
const SCHEMAS = [
  { file: 'tooling/app-yaml/schema/app.schema.json', property: 'id' },
  { file: 'tooling/app-yaml/schema/privacy.schema.json', property: 'app' },
  // A release's `unit` is an apps/<id> directory, so it is the same id.
  { file: 'contracts/release.schema.json', property: 'unit' },
];

const problems = [];
const notes = [];
const fail = (line, ...rest) => problems.push([line, ...rest].join('\n      '));

/** COVERAGE LOST — printed and exited immediately, never collected. */
function coverageLost(line, ...rest) {
  console.error(`✗ COVERAGE LOST — ${line}`);
  for (const r of rest) console.error(`      ${r}`);
  console.error('      Exit 2 is deliberately not a pass: this guard could not make the assertion it claims.');
  process.exit(2);
}

const read = (rel, why) => {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) coverageLost(`${rel} is not present under ${ROOT}.`, why);
  return readFileSync(abs, 'utf8');
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const show = (id) => `${JSON.stringify(id)} (${[...id].length} characters)`;

// ═════════════════════════════════════════════════════════════════════════════
// 0. LOAD THE CONTRACT
// ═════════════════════════════════════════════════════════════════════════════
read(CONTRACT_JS_REL, 'There is no app-id contract to grade, so every limb below would pass over nothing.');
const contract = await import(pathToFileURL(join(ROOT, CONTRACT_JS_REL)).href).catch((e) =>
  coverageLost(`${CONTRACT_JS_REL} could not be imported.`, String(e && e.message)),
);
const { APP_ID_RULE, RESERVED, appIdProblems, renderAppIdJson } = contract;
if (
  !APP_ID_RULE ||
  typeof APP_ID_RULE.pattern !== 'string' ||
  !Number.isInteger(APP_ID_RULE.minLength) ||
  !Number.isInteger(APP_ID_RULE.maxLength) ||
  !Array.isArray(RESERVED) ||
  typeof appIdProblems !== 'function' ||
  typeof renderAppIdJson !== 'function'
) {
  coverageLost(`${CONTRACT_JS_REL} does not export APP_ID_RULE {pattern, minLength, maxLength}, RESERVED, appIdProblems and renderAppIdJson.`);
}
const RULE_RE = new RegExp(APP_ID_RULE.pattern);
/** Refused on the pattern or the length — the part a JSON Schema can express. */
const refusedByRule = (id) =>
  !RULE_RE.test(id) || [...id].length < APP_ID_RULE.minLength || [...id].length > APP_ID_RULE.maxLength;

// ── THE SAMPLE ───────────────────────────────────────────────────────────────
// One candidate set, split by the contract itself, so limbs 2 and 4 follow the
// contract when it moves: every length from 1 to eight past the maximum, every
// letter first, every letter and digit second, and the shapes the old rules let
// through.
const CYCLE = 'bcdefghijklmnopqrstuvwxyz0123456789a';
const candidates = new Set(['', 'habit_tracker', 'habit-tracker', '1app', 'Habit', 'a b', '_ab', 'ab_', 'ab-', 'aB', 'class']);
for (let n = 1; n <= APP_ID_RULE.maxLength + 8; n++) candidates.add(`a${CYCLE.repeat(Math.ceil(n / CYCLE.length) + 1).slice(0, n - 1)}`);
for (const c of 'abcdefghijklmnopqrstuvwxyz') candidates.add(`${c}0`);
for (const c of 'abcdefghijklmnopqrstuvwxyz0123456789_-') candidates.add(`a${c}`);
const accepted = [...candidates].filter((id) => appIdProblems(id).length === 0);
const refused = [...candidates].filter(refusedByRule);
const lengths = new Set(accepted.map((id) => id.length));
if (!lengths.has(APP_ID_RULE.minLength) || !lengths.has(APP_ID_RULE.maxLength) || refused.length === 0) {
  coverageLost(
    `the generated sample does not reach both bounds of ${APP_ID_RULE.minLength}..${APP_ID_RULE.maxLength}, or the contract refuses nothing in it.`,
    'Limbs 2 and 4 compare other rules against this sample; one that misses a bound compares nothing there.',
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. app-id.json IS WHAT generate.mjs WRITES
// ═════════════════════════════════════════════════════════════════════════════
{
  const onDisk = read(CONTRACT_JSON_REL, 'pre_gen.dart reads this file; without it the stamp refuses every id.');
  if (onDisk !== renderAppIdJson()) {
    fail(
      `limb 1 — ${CONTRACT_JSON_REL} is not what ${CONTRACT_JS_REL} would generate.`,
      'The JSON is GENERATED for pre_gen.dart, which cannot import JavaScript. Edit the .js and run:',
      '  node contracts/app-id/generate.mjs',
    );
  } else {
    notes.push(`limb 1 · ${CONTRACT_JSON_REL} is what generate.mjs writes (${RESERVED.length} reserved word(s))`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. EVERY ID THE CONTRACT ACCEPTS, THE WORKER SERVES
// ═════════════════════════════════════════════════════════════════════════════
{
  const src = read(CONFIG_TS, 'Its APP_ID_PATTERN is the filter the platform Worker drops apps with.');
  // Parsed exactly as tooling/ci/assert-config-registry.mjs section 4 parses it.
  const m = /APP_ID_PATTERN\s*=\s*\/([^/]+)\/([a-z]*)/.exec(src);
  if (!m) {
    coverageLost(
      `APP_ID_PATTERN could not be parsed out of ${CONFIG_TS}.`,
      'It is the filter buildRegistry drops rows with; without reading it, an id the Worker drops could not be named.',
    );
  }
  const worker = new RegExp(m[1], m[2]);
  const dropped = accepted.filter((id) => !worker.test(id)).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  if (dropped.length) {
    fail(
      `limb 2 — ${CONFIG_TS} APP_ID_PATTERN ${worker} refuses ${dropped.length} id(s) the contract accepts, first ${show(dropped[0])}: ` +
        `the Worker would drop ${dropped[0]} silently.`,
      `Also: ${dropped.slice(1, 4).map(show).join(', ') || 'none'}.`,
      `buildRegistry skips an id APP_ID_PATTERN refuses with no error, so an app the stamper accepted would never be served.`,
      `Tighten ${CONTRACT_JS_REL} (and run node contracts/app-id/generate.mjs); widening config.ts is a Worker deploy.`,
    );
  } else {
    notes.push(`limb 2 · ${CONFIG_TS} APP_ID_PATTERN ${worker} accepts all ${accepted.length} sampled id(s) the contract accepts`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. THE CALLERS USE THE CONTRACT, AND CARRY NO RULE OF THEIR OWN
// ═════════════════════════════════════════════════════════════════════════════
{
  const OWN_RULE = /(?:\/|RegExp\(\s*r?['"`])\^\[a-z\]/g;
  const ID_WORD = /(?:^|[^\w$])(?:appId|app_id|slug)(?![\w$])/;
  for (const caller of CALLERS) {
    const src = read(caller.file, `It is a caller of the app-id rule, and a caller that cannot be read cannot be graded.`);
    if (caller.reads === 'import') {
      const imports = new RegExp(`import\\s*\\{[^}]*\\bappIdProblems\\b[^}]*\\}\\s*from\\s*['"]${esc(caller.specifier)}['"]`).test(src);
      const calls = (src.match(/\bappIdProblems\s*\(/g) ?? []).length;
      if (!imports || calls === 0) {
        fail(
          `limb 3 — ${caller.file} does not ${imports ? 'call' : 'import'} appIdProblems from '${caller.specifier}'.`,
          'Each caller refuses a bad id through the contract; one that stops doing so is back to its own rule, or none.',
        );
      }
    } else if (!new RegExp(`File\\(\\s*'${esc(caller.path)}'\\s*\\)`).test(src)) {
      fail(
        `limb 3 — ${caller.file} does not read File('${caller.path}').`,
        'pre_gen.dart cannot import JavaScript; it applies the rule from the generated JSON or it applies none.',
      );
    }
    for (const hit of src.matchAll(OWN_RULE)) {
      const window = src.slice(Math.max(0, hit.index - 200), hit.index + 200);
      if (!ID_WORD.test(window)) continue;
      const line = src.slice(0, hit.index).split('\n').length;
      fail(
        `limb 3 — ${caller.file}:${line} carries its own app-id regex (${src.slice(hit.index, hit.index + 60).split('\n')[0]}…).`,
        `The rule lives in ${CONTRACT_JS_REL}; a second copy is how the stamper came to accept ids the Worker drops.`,
      );
    }
  }
  if (!problems.some((p) => p.startsWith('limb 3'))) {
    notes.push(`limb 3 · ${CALLERS.length} caller(s) use the contract and carry no app-id regex of their own`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. NO SCHEMA ACCEPTS AN ID THE CONTRACT REFUSES
// ═════════════════════════════════════════════════════════════════════════════
{
  for (const schema of SCHEMAS) {
    let doc;
    try {
      doc = JSON.parse(read(schema.file, 'It restates the app-id rule for app.yaml, privacy.yaml or release.json.'));
    } catch (e) {
      coverageLost(`${schema.file} did not parse as JSON.`, String(e && e.message));
    }
    const prop = doc?.properties?.[schema.property];
    if (!prop || typeof prop !== 'object') {
      coverageLost(`${schema.file} has no \`properties.${schema.property}\`, so there is no app-id rule in it to grade.`);
    }
    const re = typeof prop.pattern === 'string' ? new RegExp(prop.pattern, 'u') : null;
    const allows = (id) =>
      (re === null || re.test(id)) &&
      (prop.minLength === undefined || [...id].length >= prop.minLength) &&
      (prop.maxLength === undefined || [...id].length <= prop.maxLength);
    const loose = refused.filter(allows).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
    if (loose.length) {
      fail(
        `limb 4 — ${schema.file} properties.${schema.property} accepts ${loose.length} id(s) the contract refuses, first ${show(loose[0])}.`,
        `Also: ${loose.slice(1, 4).map(show).join(', ') || 'none'}.`,
        `It must be equal to or stricter than ${CONTRACT_JS_REL}: pattern ${APP_ID_RULE.pattern}, minLength ${APP_ID_RULE.minLength}, maxLength ${APP_ID_RULE.maxLength}.`,
      );
    } else {
      notes.push(`limb 4 · ${schema.file} properties.${schema.property} accepts none of the ${refused.length} sampled id(s) the contract refuses`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// VERDICT
// ═════════════════════════════════════════════════════════════════════════════
const where = relative(process.cwd(), ROOT) || '.';
if (problems.length) {
  console.error(`✗ assert-app-id-contract — ${problems.length} finding(s) in ${where}\n`);
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error(`  Subject: ${CONTRACT_JS_REL}. Row O-APP-ID-FORM-UNVALIDATED, limb (a).`);
  process.exit(1);
}

console.log(`✓ assert-app-id-contract — ${CONTRACT_JS_REL} is the one app-id rule: ${APP_ID_RULE.pattern}, ${APP_ID_RULE.minLength}-${APP_ID_RULE.maxLength} characters, ${RESERVED.length} reserved word(s)`);
for (const n of notes) console.log(`    · ${n}`);
process.exit(0);
