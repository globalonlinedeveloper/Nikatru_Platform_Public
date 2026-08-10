#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-flag-exposure.mjs — [pipeline 11]E-12. A rollout is MEASURABLE:
// exposure is an event, and it shares the bucketing id the decision used.
//
// 🔴 THE STATE THIS REPLACED. `resolveFlag` has been in the tree since CFG G-14
// and `grep -rn variant_exposed` matched NOTHING, in any language. Every
// percentage rollout the chassis can express was unmeasurable by construction:
// the client decided on/off locally and told nobody. The treatment group could
// then only be re-derived from a bucketing id and a rollout percentage — and
// rollout percents are NOT VERSIONED, so the moment one is ramped the past is
// unrecoverable. "Did the variant convert better" had no answer that was not a
// guess about who saw it.
//
// THREE LIMBS
//   1 · THE EMITTING WRAPPER IS REAL. `ObservedFeatureFlags` exists in
//       packages/core, is exported from the barrel, emits `variant_exposed`,
//       and derives the event's bucket from `flagBucket` — the SAME function
//       `resolveFlag` uses. Two independent bucketing ids is the exact failure
//       `0002_analytics.sql` warns about for `anon_id`: the analysis attributes
//       sessions to the wrong arm and nothing ever looks wrong.
//   2 · NO RAW READER ESCAPES. In non-test code under apps/ and the brick, a
//       `core.FeatureFlags(...)` construction must sit INSIDE a
//       `core.ObservedFeatureFlags(...)` argument list. A raw one is a flag read
//       that emits nothing, and in the brick it is fifty future apps' worth.
//   3 · THE CALL-SITE COUNT IS PRINTED. Every run. See below.
//
// ⚠️ LIMB 2 IS VACUOUSLY TRUE ON THE CALL-SITE SIDE TODAY, AND SAYING SO IS THE
// POINT. `.isOn(` has ZERO non-test callers tree-wide right now. An assertion
// over an empty set is this repository's cardinal sin — `assert-seams-wired.mjs`
// exists because four capabilities shipped fail-closed with no proven open path
// and no test went red. So the count is PRINTED on every run, passing or
// failing, and it says out loud when it is zero. That is exactly when the rule
// is free to enforce: nothing has to be migrated, and the fifty-first app
// inherits a chassis that cannot read a flag silently.
//
// ⚠️ NO THRESHOLD, NO SAMPLE-SIZE FLOOR, NO MINIMUM DETECTABLE EFFECT. Those are
// the numbers a rollout guard is tempted to invent and none of them is derivable
// from this repository. This guard asserts a RELATIONSHIP — the event exists and
// its bucket is the decision's bucket — and nothing about how big an experiment
// must be.
//
// Usage:  node tooling/ci/assert-flag-exposure.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const WRAPPER = 'packages/core/lib/src/config/observed_feature_flags.dart';
const RESOLVER = 'packages/core/lib/src/config/flag_resolver.dart';
const BARREL = 'packages/core/lib/nikatru_core.dart';
const EVENT = 'variant_exposed';
const WRAPPER_TYPE = 'ObservedFeatureFlags';
const RAW_TYPE = 'FeatureFlags';
const BUCKET_FN = 'flagBucket';

/** Non-test consumer code. `test/` is excluded for the same reason
 *  assert-seams-wired.mjs excludes it: a reader whose only caller is a test is
 *  precisely the state being rejected. apps/probe is a gitignored local stamp —
 *  scanning it would make the answer depend on whether somebody ran `mason
 *  make`, which is not a property of the repository. */
const SCAN_ROOTS = ['apps', 'tooling/bricks'];
const SKIP_DIR = new Set(['build', '.dart_tool', 'node_modules', 'test', 'integration_test']);
const SKIP_PATH = ['apps/probe'];

let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => {
  console.error(`✗ COVERAGE LOST — ${m}`);
  process.exit(1);
};

const rel = (p) => join(ROOT, ...p.split('/'));
const readIf = (p) => (existsSync(rel(p)) ? readFileSync(rel(p), 'utf8') : null);

/** The span inside the balanced parens opening at `from`. Quote-aware. */
function balanced(text, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') {
      depth--;
      if (depth === 0) return { body: text.slice(from + 1, i), end: i };
    }
  }
  return null;
}

// ── 1 · the emitting wrapper is real ────────────────────────────────────────
const wrapper = readIf(WRAPPER);
if (wrapper === null) {
  coverageLost(
    `${WRAPPER} does not exist. It is the only thing that turns a local on/off decision into a measurable ` +
      'exposure, so without it every limb below would be checking that nobody uses a type that is not there.',
  );
}
const wrapperCode = stripSourceComments(wrapper, '.dart');

if (!new RegExp(`class\\s+${WRAPPER_TYPE}\\b`).test(wrapperCode)) {
  fail(`${WRAPPER} declares no \`class ${WRAPPER_TYPE}\`.`);
}
if (!wrapperCode.includes(`'${EVENT}'`)) {
  fail(
    `${WRAPPER} does not name the \`${EVENT}\` event in code (a comment does not count — comments are ` +
      'stripped before this scan). Without the event there is no denominator and the rollout is a coin toss.',
  );
}
if (!wrapperCode.includes(`${BUCKET_FN}(`)) {
  fail(
    `${WRAPPER} does not call \`${BUCKET_FN}(\`. The bucket ON THE EVENT must come from the SAME function the ` +
      'DECISION used; a second hash would attribute sessions to the wrong arm and nothing would ever look wrong.',
  );
}
for (const key of ['flag', 'variant', 'bucket']) {
  if (!new RegExp(`'${key}'\\s*:`).test(wrapperCode)) {
    fail(`${WRAPPER}'s event carries no \`${key}\` param. Without all three the exposure cannot be joined to an arm.`);
  }
}
// The dedupe. An exposure emitted on every `build()` would flood the write
// budget from one rebuilding widget, so its absence is a cost defect as well as
// a data one.
if (!/\.add\(|\.contains\(/.test(wrapperCode)) {
  fail(
    `${WRAPPER} has no per-session dedupe. A flag read inside \`build()\` runs on every frame, so an ` +
      'undeduplicated exposure is one widget emptying a shared 100k-writes/day budget.',
  );
}
// Consent is not bypassed: the wrapper must reach the Analytics FACADE, which is
// where the consent gate lives, and not a transport directly.
if (!/\bAnalytics\b/.test(wrapperCode)) {
  fail(
    `${WRAPPER} does not depend on the \`Analytics\` facade. Consent gating lives there; anything that reaches ` +
      'a transport directly is a second path to the wire that the DPDP consent state does not control.',
  );
}

const resolver = readIf(RESOLVER);
if (resolver === null) {
  coverageLost(`${RESOLVER} does not exist, so \`${BUCKET_FN}\` — the function limb 1 compares against — is gone.`);
}
if (!new RegExp(`int\\s+${BUCKET_FN}\\s*\\(`).test(stripSourceComments(resolver, '.dart'))) {
  coverageLost(
    `${RESOLVER} no longer declares \`${BUCKET_FN}\`. Limb 1's "same function" check would then be comparing the ` +
      'wrapper against a name nothing defines, which passes for the wrong reason.',
  );
}

const barrel = readIf(BARREL);
if (barrel === null || !barrel.includes('observed_feature_flags.dart')) {
  fail(`${BARREL} does not export the wrapper, so no app can reach it.`);
}

// ── the scan ────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let entries;
  try { entries = listDir(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      if (!SKIP_DIR.has(e)) walk(p, out);
    } else if (e.endsWith('.dart')) {
      out.push(p);
    }
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((r) => walk(rel(r)))
  .map((p) => relative(ROOT, p).replaceAll('\\', '/'))
  .filter((p) => !SKIP_PATH.some((skip) => p.startsWith(`${skip}/`)))
  .sort();

if (files.length === 0) {
  coverageLost(
    `no .dart file under ${SCAN_ROOTS.join(' or ')}. Limbs 2 and 3 would range over nothing and report that no ` +
      'raw flag reader escapes — which is true of an empty set and says nothing about the tree.',
  );
}

// ── 2 · no raw reader escapes ───────────────────────────────────────────────
let constructions = 0;
let wrapped = 0;
for (const file of files) {
  const code = stripSourceComments(readIf(file), '.dart');
  // Every `ObservedFeatureFlags(` argument span — a raw construction inside one
  // of these is the intended shape.
  const wrapperSpans = [];
  for (const m of code.matchAll(new RegExp(`\\b(?:core\\.)?${WRAPPER_TYPE}\\s*\\(`, 'g'))) {
    const span = balanced(code, m.index + m[0].length - 1);
    if (span) wrapperSpans.push([m.index, span.end]);
  }
  // Raw `FeatureFlags(` constructions — the negative lookbehind keeps
  // `ObservedFeatureFlags(` from matching as a raw one.
  for (const m of code.matchAll(new RegExp(`(?<![A-Za-z0-9_])${RAW_TYPE}\\s*\\(`, 'g'))) {
    constructions++;
    const inside = wrapperSpans.some(([start, end]) => m.index > start && m.index < end);
    if (inside) {
      wrapped++;
    } else {
      const line = code.slice(0, m.index).split('\n').length;
      fail(
        `${file}:${line} constructs a raw \`${RAW_TYPE}(\` outside any \`${WRAPPER_TYPE}(\`. That reader decides ` +
          'on/off locally and emits nothing, so the rollout it serves is unmeasurable — and rollout percents are ' +
          'not versioned, so once the percent is ramped the treatment group cannot be reconstructed. Wrap it: ' +
          `\`core.${WRAPPER_TYPE}(flags: core.${RAW_TYPE}(…), analytics: …)\`.`,
      );
    }
  }
}
if (constructions === 0) {
  coverageLost(
    `no \`${RAW_TYPE}(\` construction was found in ${files.length} non-test file(s) under ` +
      `${SCAN_ROOTS.join(', ')}. Limb 2 then holds vacuously — the brick's featureFlagsProvider is where the ` +
      'chassis binds rollouts to the install id, and if it stopped doing so this guard would certify a rule ' +
      'nothing exercises.',
  );
}

// ── 3 · the call-site count, PRINTED every run ──────────────────────────────
const callSites = [];
for (const file of files) {
  const code = stripSourceComments(readIf(file), '.dart');
  for (const m of code.matchAll(/\.isOn\s*\(/g)) {
    callSites.push(`${file}:${code.slice(0, m.index).split('\n').length}`);
  }
}
if (callSites.length === 0) {
  console.log(
    `--   ZERO non-test \`.isOn(\` call sites in ${files.length} file(s) under ${SCAN_ROOTS.join(', ')}. The ` +
      '"every flag read is observed" rule is therefore VACUOUSLY TRUE today, and this line is here so that is ' +
      'never mistaken for evidence that it is enforced against something. It is enforced against the TYPE ' +
      `(${WRAPPER_TYPE} is what the chassis exposes), which is why it costs nothing to hold now and everything ` +
      'to retrofit later.',
  );
} else {
  console.log(`--   ${callSites.length} non-test \`.isOn(\` call site(s), all reading an observed flag set:`);
  for (const c of callSites) console.log(`       ${c}`);
}

// ── 4 · THE OTHER WAY TO READ A ROLLOUT, COUNTED AND CAPPED ─────────────────
//
// 🔴 LIMB 2 KEYS ON `FeatureFlags(` CONSTRUCTIONS, AND THAT IS NOT THE ONLY
// DOOR. `resolveFlag`/`flagBucket` are top-level functions exported from the
// core barrel, so a caller can decide a rollout on-device, emit nothing, and
// never touch the type this guard polices. Found 2026-08-10 while wiring
// research/44 §7 rung 3, which needed exactly that: the promo card's variant is
// resolved with the raw function BECAUSE the observed reader would emit
// `variant_exposed` on first read, and research/44 §4.4 records that v1 ships
// UNMEASURED — the taxonomy carries no cross-promo event, and adding one costs
// 25–50% of portfolio session capacity against the binding D1 rows-written
// ceiling. That is owner decision D6, not an engineering preference.
//
// So the raw read is legitimate AND it is the exact shape limb 2 exists to
// prevent. It is therefore neither failed nor ignored: it is PRINTED with its
// file and line on every run, and CAPPED. A ceiling is what stops "one
// deliberate exception" becoming the way rollouts are read — the same idiom as
// assert-screen-set.mjs's reachability-exemption ceiling. Raise it only in the
// same change that adds the read, with the reason beside it.
const RAW_RESOLVERS = /(?<![A-Za-z0-9_.])(?:core\.)?(resolveFlag|flagBucket)\s*\(/g;
// 2 since 2026-08-10, and it is ONE logical read in TWO trees: the promo card's
// variant, in the brick template and in the one in-repo stamped app that
// carries the same spine file (`apps/subly`). Every future in-repo stamped app
// repeats the line — the same drift `EXCLUSIVE_TRIGGERS` in
// assert-seams-wired.mjs already accepts for the review prompt, and for the same
// reason: the twin is the chassis, not a second decision. When D6 says measure,
// this read moves to `featureFlagsProvider.isOn` in both trees and this number
// comes back to 0.
const RAW_READER_CEILING = 2;
const rawReads = [];
for (const file of files) {
  const code = stripSourceComments(readIf(file), '.dart');
  for (const m of code.matchAll(RAW_RESOLVERS)) {
    rawReads.push(`${file}:${code.slice(0, m.index).split('\n').length} (${m[1]})`);
  }
}
if (rawReads.length > RAW_READER_CEILING) {
  fail(
    `${rawReads.length} raw \`resolveFlag(\`/\`flagBucket(\` call site(s) in non-test code, and the checked-in ` +
      `ceiling is ${RAW_READER_CEILING}. Each one decides a rollout locally and tells nobody, so the treatment ` +
      'group can only be re-derived from a rollout percentage that is not versioned — once ramped, the past is ' +
      `gone. Wrap it: \`ref.watch(featureFlagsProvider)\` hands back an ${WRAPPER_TYPE}. Sites: ${rawReads.join(', ')}.`,
  );
}
if (rawReads.length === 0) {
  console.log(
    `--   ZERO raw \`resolveFlag(\`/\`flagBucket(\` call sites (ceiling ${RAW_READER_CEILING}). Every rollout ` +
      'read in the shipped tree is observed.',
  );
} else {
  console.log(
    `⬜   ${rawReads.length}/${RAW_READER_CEILING} UNMEASURED rollout read(s) — deliberate, dated, and printed ` +
      'rather than hidden. Each is a variant nobody can attribute a conversion to:',
  );
  for (const r of rawReads) console.log(`       ${r}`);
}

const summary =
  `flag exposure — \`${EVENT}\` emitted by ${WRAPPER_TYPE} on the same \`${BUCKET_FN}\` the decision uses; ` +
  `${wrapped}/${constructions} raw ${RAW_TYPE} construction(s) wrapped across ${files.length} non-test file(s); ` +
  `${callSites.length} call site(s)`;

if (failed) {
  console.error(`\n${summary}`);
  console.error('assert-flag-exposure: FAILED');
  process.exit(1);
}
ok(summary);
