#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-ceiling-budget.mjs — every hard cap in the Worker source derives from a
// SOURCED free-tier ceiling, and an undeclared cap is the failure.
//
// [pipeline B-6] "Every free-tier ceiling recorded once, with arithmetic, and
//                 every hard cap derives from it."
//
// ── THE CRITERION B-6 SHIPPED WITH COULD NOT FIRE ────────────────────────────
// "A ceilings file exists." An EMPTY file satisfies that, forever. So the
// criterion is inverted here: the register is the right-hand side, and what this
// guard actually checks is that no number in the source is floating free of it.
//
//   MAX_EVENTS_PER_BATCH = 100 sat in services/platform/src/routes/events.ts
//   naming no ceiling at all — and it was DOUBLE the documented Free limit of 50
//   queries per Worker invocation. Nothing in the tree could say so, because
//   there was no right-hand side to compare it against.
//
// ── A LIMIT WITHOUT A `source` IS NOT ENFORCED, IT IS REPORTED ───────────────
// 🔴 An INVENTED ceiling fires on CORRECT input, which is strictly worse than no
// ceiling. assert-store-metadata.mjs paid for this already: a made-up "120
// characters or fewer" rejected this repo's own 129-character fixture. So a
// ceiling row carrying a numeric `value` must carry an https `source` and a
// `verifiedOn` date or this guard fails, and a row whose `value` is null is
// UNVERIFIED — it prints, and deriving a cap from it is itself a failure.
//
// ── EIGHT LIMBS, EACH WITH A WRITABLE FAILING INPUT ──────────────────────────
//   1. every numeric ceiling row is SOURCED and DATED
//   2. every vendor surface has at least one ceiling row (a relationship to
//      tooling/capability-register.json, a list assert-vendor-portability.mjs
//      already maintains, so it cannot be shrunk to make this limb pass)
//   3. every `const NAME = <number>` in services/*/src/ is annotated
//      `@ceiling <id> lte` (arithmetic CHECKED) or `@ceiling none — <reason>`;
//      an over-ceiling value FAILS unless it declares `@ceiling-exceeds`
//   4. every `.batch(` call site is named in `batchCallSites`, in BOTH
//      directions — a stale entry makes the accounting look complete
//   5. the deployed configs: cron count, D1 database count, KV namespace count
//      and every rate-limiter `period`, against their sourced ceilings
//   6. the WRITE-AMPLIFICATION factor is COUNTED from the schema, not typed
//   7. every row's `verifiedOn` is YOUNGER than the register's stated
//      `verificationCadence` — a citation past that age FAILS
//   8. every account-wide ceiling no `configCeilings` check can count names the
//      place its ACTUAL number is read, and that place PRINTS on every run
//
// ── LIMBS 7 AND 8: "DATED" IS NOT "CURRENT", AND A HUMAN LIMB MUST BE LOUD ──
// [11]E-14's replacement acceptance, both halves:
//
//   (1) "The ceilings carry the date they were last checked against the vendor,
//        and a check older than the stated cadence FAILS rather than being
//        assumed current."
//   (2) "Where the actual numbers are read is still `human` (Cloudflare account
//        analytics), and that is legitimate — but it must PRINT on every run,
//        never silently pass, because it is the limb nobody can automate today."
//
// 🔴 LIMB 1 CHECKED THE DATE'S FORMAT AND NOTHING ELSE. `verifiedOn` matched
// /^\d{4}-\d{2}-\d{2}$/ and was never compared to anything, so `2019-01-01` on
// every one of the sixteen rows exited 0 — MEASURED, before limb 7 existed. A
// date the build never reads is the same object as no date: the row still looks
// cited, the vendor page has moved on, and the first symptom is a 429 nobody
// predicted. Limb 7 gives the age a threshold, and the threshold is declared in
// the register (`verificationCadence.cadence`) rather than compiled in here, so
// the cadence is a reviewable fact and not a guard author's opinion.
//
// The cadence is parsed with `cadenceDays()` imported from assert-ops-register
// — the SAME parser tooling/ops/register.json's duty cadences use. One duration
// vocabulary in this repo (`1h 8h 1d 7d 30d 120d 180d 365d`), not two that
// disagree at the edges.
//
// 🔴 LIMB 8 IS THE OPPOSITE FAILURE: a limb that CANNOT be automated must not be
// silent. Four ceilings here bound an ACCOUNT-WIDE DAILY TOTAL — requests/day,
// rows written/day, KV reads and writes/day — plus storage/account. Nothing in
// this repo observes any of them: the rate limiters are per-colo and prove
// nothing account-wide (ratelimit.accountingAccuracy is the citation), and
// limb 5 counts only what a wrangler config DECLARES. So the actual numbers
// exist in exactly one place — the Cloudflare dashboard — and the honest state
// is `human`. The failure mode of an honest gap is that it goes quiet, which is
// why limb 8's domain is DERIVED (an account-wide row that no configCeilings
// check counts) and every entry lands in `prints`, on green runs and red ones
// alike. The same treatment `@ceiling-exceeds` and `unboundedReason` already get.
//
// ── LIMB 6: A MODEL WHOSE NUMBER NOBODY CAN RE-DERIVE ───────────────────────
// [pipeline 11]E-14 recorded a capacity model whose acceptance criterion was
// "a recorded capacity model STATES each ceiling … and NAMES where the numbers
// are read". Every verb is satisfied by writing prose — and the prose was WRONG
// BY 5×. D1 bills ROWS WRITTEN, an index row IS a row written, and `events`
// carries four indexes, so one event costs 1 + 4 = 5 rows and every headroom
// figure downstream was five times too generous. Nothing could say so, because
// the factor was a number in a document rather than a count of the schema.
//
// So limb 6 parses the migrations for `CREATE INDEX … ON <table>`, computes
// 1 base row + N index rows, divides the ceiling by it, and FAILS when the
// stored value disagrees. Adding a fifth index moves the headroom by itself.
//
// ⚠️ COVERAGE IS A RELATIONSHIP, NEVER A NUMBER. Limb 2's domain is the vendor
// surface list; limb 3's is every constant the scan finds; limb 4's is every
// batch call site on disk; limb 5's is every wrangler config on disk; limb 6's
// is every .sql in the declared migrations directory. The only integers here
// are self-checks that the SCANS still find anything at all — because a parser
// that matches nothing reports perfect agreement with an empty register, which
// is this repo's single most repeated failure. Limb 6's own version of that:
// an index parser that matches NOTHING derives 1 row per event, which is
// exactly the 5×-optimistic number E-14's research pass rejected.
//
// Usage:  node tooling/ci/assert-ceiling-budget.mjs [repoRoot]
// Exit 0 = every cap derives from a sourced ceiling; 1 = one does not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
// ONE duration vocabulary in this repo. `cadenceDays` is the parser
// tooling/ops/register.json's duty cadences already run through; a second
// implementation here would agree with it until the day it did not.
// (assert-ops-register.mjs gates its own main run on `process.argv[1]`, so this
// import runs no guard — tooling/ci/test/ops-register.test.mjs imports it the
// same way.)
import { cadenceDays } from './assert-ops-register.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const CEILINGS = 'tooling/ceilings.json';
const CAPABILITY_REGISTER = 'tooling/capability-register.json';
const BRICK_CFG =
  'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/wrangler.jsonc';

const problems = [];
const prints = [];
const ok = (m) => console.log(`ok   ${m}`);
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf8') : null);

/** Fatal on the spot: every check after a lost scan quantifies over nothing and
 *  would report "clean" over an empty set — the defect this guard exists for,
 *  in the guard itself. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-ceiling-budget: FAILED');
  process.exit(1);
}

// ── jsonc: comments stripped, string literals preserved ──────────────────────
// 🔴 STRING-AWARE ON PURPOSE. A naive `//` strip eats the `//` of every URL
// inside a string and turns valid JSON into garbage — and this repo's configs
// are full of prose containing `https://`. The same class of bug as grepping
// for `"r2_buckets"` and matching the comment that explains why there is none.
function stripJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c;
    i++;
  }
  // Trailing commas are legal in jsonc and fatal to JSON.parse.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Line comments stripped from TypeScript, strings preserved — same reasoning. */
function stripTsComments(text) {
  let out = '';
  let i = 0;
  let str = null;
  while (i < text.length) {
    const c = text[i];
    if (str) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
      if (c === str) str = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; out += c; i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return out;
}

// ── the register ─────────────────────────────────────────────────────────────
const raw = read(CEILINGS);
if (raw === null) {
  coverageLost([
    `${CEILINGS} does not exist.`,
    'Every limb below compares a number in the source against a row in this file. With no file the',
    'right-hand side is undefined, and an undefined right-hand side cannot reject anything — which',
    'is precisely the state [4]B-6 was written to end.',
  ]);
}
let register;
try {
  register = JSON.parse(raw);
} catch (e) {
  coverageLost([`${CEILINGS} is not valid JSON — ${e.message}`]);
}

const rows = Array.isArray(register.ceilings) ? register.ceilings : [];
if (rows.length === 0) {
  coverageLost([
    `${CEILINGS} declares ZERO ceilings.`,
    'This is B-6\'s original vacuity exactly: "a ceilings file exists" is satisfied by an empty one,',
    'and every derivation below would then resolve against nothing and pass.',
  ]);
}

const byId = new Map();
for (const r of rows) {
  if (!r || typeof r.id !== 'string' || r.id.trim() === '') {
    problems.push(`${CEILINGS} contains a ceiling row with no \`id\`. It can never be referenced, so it constrains nothing while still counting toward the register's apparent size.`);
    continue;
  }
  if (byId.has(r.id)) {
    problems.push(`${CEILINGS} declares the ceiling id "${r.id}" TWICE. Two rows for one limit is how the wrong one is derived from — whichever the reader reaches first.`);
    continue;
  }
  byId.set(r.id, r);
}

// ── LIMB 1 — every numeric ceiling is SOURCED and DATED ──────────────────────
let sourced = 0;
let unverified = 0;
const HTTPS = /^https:\/\/\S+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Ids limb 1 has already faulted for their date, so limb 7 does not say it
 *  twice about one edit. Two messages for one defect is how the specific line
 *  to fix gets lost in the noise. */
const dateReported = new Set();

for (const r of byId.values()) {
  const hasMagnitude = Number.isFinite(r.value);
  const hasEnum = Array.isArray(r.allowedValues) && r.allowedValues.length > 0;

  if (typeof r.ambiguity !== 'string' || r.ambiguity.trim() === '') {
    problems.push(
      `ceiling "${r.id}" declares no \`ambiguity\`. Every row must say what it does NOT settle — "None." is a legitimate and cheap answer. The field exists because d1.queriesPerInvocation's real ambiguity (does batch() spend 1 or N?) is the difference between a correct cap and a cap that is double the limit, and a register with nowhere to write that down loses it.`,
    );
  }

  if (!hasMagnitude && !hasEnum) {
    // UNVERIFIED. Legal, printed, and unusable as a derivation source.
    unverified++;
    const why = typeof r.ambiguity === 'string' ? r.ambiguity : '(no reason given)';
    prints.push(`UNVERIFIED ceiling "${r.id}" — no numeric value. ${why}`);
    continue;
  }

  if (typeof r.source !== 'string' || !HTTPS.test(r.source.trim())) {
    problems.push(
      `ceiling "${r.id}" declares a value (${r.value ?? JSON.stringify(r.allowedValues)}) with NO \`source\` https URL. An INVENTED ceiling fires on CORRECT input — a made-up "120 characters or fewer" once rejected this repo's own 129-character fixture — so this guard will not derive a cap from a number nobody cited. Add the URL, or set \`"value": null\` and say in \`ambiguity\` that it could not be sourced.`,
    );
    continue;
  }
  if (typeof r.verifiedOn !== 'string' || !ISO_DATE.test(r.verifiedOn.trim())) {
    dateReported.add(r.id);
    problems.push(
      `ceiling "${r.id}" has a \`source\` but no valid \`verifiedOn\` (YYYY-MM-DD). Vendor limits move — Cloudflare has changed D1's Free tier before — and an undated citation cannot decay. The date is what makes "we checked" a fact with an age rather than a claim.`,
    );
    continue;
  }
  if (typeof r.sourceText !== 'string' || r.sourceText.trim() === '') {
    problems.push(
      `ceiling "${r.id}" has a \`source\` URL but no \`sourceText\`. A bare URL cannot be checked against the number next to it: the page changes, the link still resolves, and the row keeps looking cited. The quoted sentence is what a reviewer compares.`,
    );
    continue;
  }
  sourced++;
}

if (sourced === 0) {
  coverageLost([
    `NOT ONE ceiling row is both sourced and dated (${byId.size} row(s) present, ${unverified} unverified).`,
    'Every derivation below resolves against a row this guard would refuse to derive from, so limb 3',
    'and limb 5 would check nothing while reporting clean.',
  ]);
}

/** A ceiling a cap may legitimately be derived FROM. */
function derivable(id) {
  const r = byId.get(id);
  if (!r) return { ok: false, why: `no ceiling row with id "${id}" exists in ${CEILINGS}` };
  if (!Number.isFinite(r.value)) {
    return {
      ok: false,
      why: `ceiling "${id}" is UNVERIFIED (\`value\` is null). A cap cannot derive from a number nobody could source — that is an invented limit wearing a citation.`,
    };
  }
  return { ok: true, row: r };
}

// ── LIMB 7 — a citation older than the stated cadence FAILS ─────────────────
// [11]E-14: "The ceilings carry the date they were last checked against the
// vendor, and a check older than the stated cadence FAILS rather than being
// assumed current."
//
// 🔴 THE STATE THIS REPLACES, MEASURED: `verifiedOn` on all sixteen rows set to
// `2019-01-01` — the guard exited 0. Limb 1 tests the date's SHAPE; nothing
// tested its AGE, so "dated" and "current" were the same word here.
const cadenceBlock = register.verificationCadence;
if (!cadenceBlock || typeof cadenceBlock !== 'object' || Array.isArray(cadenceBlock)) {
  coverageLost([
    `${CEILINGS} declares no \`verificationCadence\` block, so limb 7 never runs.`,
    'Every `verifiedOn` in this file is then checked for its FORMAT and never for its AGE — which is the',
    'state E-14\'s replacement acceptance was written against, and it exits 0 with every row dated 2019.',
  ]);
}
const CADENCE_DAYS = cadenceDays(cadenceBlock.cadence);
if (CADENCE_DAYS === null) {
  coverageLost([
    `${CEILINGS} \`verificationCadence.cadence\` = ${JSON.stringify(cadenceBlock.cadence)} is not a duration this repo can parse.`,
    'The accepted vocabulary is `<n>h` / `<n>d` (cadenceDays in assert-ops-register.mjs — the same parser',
    'tooling/ops/register.json uses). An unparseable cadence has no threshold to compare against, so EVERY',
    'row would be within it: a stale register reporting itself current, which is this limb\'s whole subject.',
  ]);
}
if (typeof cadenceBlock.reason !== 'string' || cadenceBlock.reason.trim() === '') {
  problems.push(
    `${CEILINGS} \`verificationCadence\` states a cadence of ${JSON.stringify(cadenceBlock.cadence)} and no \`reason\`. A re-verification interval is a JUDGEMENT about how fast this vendor's published limits move, and an unexplained interval is indistinguishable from one chosen because it happens to keep today's dates green. Same rule as a ceiling row's \`ambiguity\`: say it, however briefly.`,
  );
}

/** UTC midnight today. Whole days only — an hours-level answer would make the
 *  same tree pass and fail depending on the hour CI happened to start. */
const TODAY_MS = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
/** Strict: the regex admits `2026-13-45`. A date that does not round-trip is not
 *  a date, and `Date.parse` alone would silently roll it over. */
function ageDays(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) return null;
  return Math.round((TODAY_MS - ms) / 86400000);
}

let datedRows = 0;
let oldestAge = -Infinity;
let oldestId = null;
for (const r of byId.values()) {
  const iso = typeof r.verifiedOn === 'string' ? r.verifiedOn.trim() : '';
  const age = ISO_DATE.test(iso) ? ageDays(iso) : null;

  if (age === null) {
    // 🔴 UNVERIFIED ROWS ARE CHECKED TOO, and limb 1 never reaches them — it
    // `continue`s at `value: null` before the date is looked at. "The vendor
    // states there is no accurate number to have" is ITSELF a claim about a
    // vendor page, and it can stop being true. An undatable row would otherwise
    // be the one place in this register where a citation never decays.
    if (!dateReported.has(r.id)) {
      problems.push(
        `ceiling "${r.id}" carries no valid \`verifiedOn\` (YYYY-MM-DD) — found ${JSON.stringify(r.verifiedOn)}. Limb 7 dates EVERY row, including UNVERIFIED ones: "the vendor publishes no number here" is a reading of a vendor page like any other, and a row with no date is the one row whose citation can never go stale. Recording when it was last looked at is free.`,
      );
    }
    continue;
  }

  datedRows++;
  if (age > oldestAge) { oldestAge = age; oldestId = r.id; }

  if (age < 0) {
    problems.push(
      `ceiling "${r.id}" is dated ${iso}, which is ${-age} day(s) in the FUTURE. A forward date is permanently inside any cadence, so it is the one value that makes this limb unable to fire — an invented threshold in the shape of a typo. Use the day the vendor page was actually read.`,
    );
    continue;
  }
  if (age > CADENCE_DAYS) {
    problems.push(
      `STALE CITATION: ceiling "${r.id}" was last checked against the vendor on ${iso} — ${age} days ago, past the register's stated \`${cadenceBlock.cadence}\` cadence (${CADENCE_DAYS} days). Re-read ${r.source ?? '(no source URL)'}, confirm the number and the quoted \`sourceText\` still say what this row says, and set \`verifiedOn\` to the day you read it — and if the limit MOVED, the value moves with it and every cap derived from it is re-checked by the limbs above. Do NOT bump the date without opening the page: that converts this guard into the thing it replaced. [11]E-14 — a check older than the cadence FAILS rather than being assumed current.`,
    );
  }
}

// ── LIMB 2 — every vendor surface has a ceiling ──────────────────────────────
// The left-hand side is a list assert-vendor-portability.mjs already maintains,
// so it cannot be quietly shrunk to make this limb pass.
const capRaw = read(CAPABILITY_REGISTER);
if (capRaw === null) {
  coverageLost([
    `${CAPABILITY_REGISTER} does not exist, so limb 2's expected set has no left-hand side.`,
    'Without it "every bound surface has a recorded ceiling" ranges over the empty set and is',
    'vacuously true — the same shape as B-6\'s original criterion.',
  ]);
}
let capRegister;
try {
  capRegister = JSON.parse(capRaw);
} catch (e) {
  coverageLost([`${CAPABILITY_REGISTER} is not valid JSON — ${e.message}`]);
}
const surfaces = capRegister?.vendors?.cloudflare?.surfaces;
if (!Array.isArray(surfaces) || surfaces.length === 0) {
  coverageLost([
    `${CAPABILITY_REGISTER} vendors.cloudflare.surfaces is missing or empty.`,
    'That list IS limb 2\'s domain. Empty, every surface has a ceiling in zero comparisons.',
  ]);
}

const coveredSurfaces = new Set();
for (const r of byId.values()) {
  for (const s of Array.isArray(r.surfaces) ? r.surfaces : []) coveredSurfaces.add(s);
}
for (const s of surfaces) {
  if (!coveredSurfaces.has(s)) {
    problems.push(
      `vendor surface "${s}" is bound by this portfolio and NO ceiling row names it. A surface with no recorded limit is a surface whose failure mode is discovered in production — and this list is the one assert-vendor-portability.mjs maintains, so the honest fix is a ceiling row, never removing the surface.`,
    );
  }
}
// The other direction: a ceiling naming a surface nobody binds is a stale row
// inflating apparent coverage.
const surfaceSet = new Set(surfaces);
for (const r of byId.values()) {
  for (const s of Array.isArray(r.surfaces) ? r.surfaces : []) {
    if (!surfaceSet.has(s)) {
      problems.push(
        `ceiling "${r.id}" names surface "${s}", which ${CAPABILITY_REGISTER} does not list. Either the surface was removed and this row was left behind — still counting toward limb 2's coverage — or it was renamed and every derivation from it now points at nothing.`,
      );
    }
  }
}

// ── the TypeScript sources ───────────────────────────────────────────────────
function walk(rel, out = []) {
  const a = abs(rel);
  if (!existsSync(a) || !statSync(a).isDirectory()) return out;
  for (const e of listDir(a, { withFileTypes: true })) {
    const child = posix.join(rel, e.name);
    if (e.isDirectory()) walk(child, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(child);
  }
  return out;
}

const serviceDirs = existsSync(abs('services'))
  ? listDir(abs('services'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `services/${e.name}`)
  : [];
const sourceFiles = serviceDirs.flatMap((d) => walk(`${d}/src`));
if (sourceFiles.length === 0) {
  coverageLost([
    'the source scan found ZERO TypeScript files under services/*/src/.',
    'Limbs 3 and 4 both quantify over this set. Empty, every cap is annotated and every batch is',
    'accounted for, in zero comparisons.',
  ]);
}

// ── LIMB 3 — every numeric constant is annotated, and the arithmetic checked ─
// `const NAME = <number>` — including simple products like `256 * 1024`, which
// is how a byte ceiling is actually written. Evaluated arithmetically rather
// than matched as text, because `256 * 1024` compared as a STRING to a ceiling
// is a comparison that can never fail.
const CONST_RE = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*number\s*)?=\s*([0-9][0-9_.eE+*\s]*?)\s*;/;

/** Only the arithmetic this scan is willing to VOUCH for. Anything else is
 *  reported as unevaluated rather than guessed at — a wrong evaluation would
 *  reject correct input, the invented-limit failure in a different costume. */
function evalNumeric(expr) {
  const cleaned = expr.replace(/_/g, '').trim();
  if (/^[0-9.eE+]+$/.test(cleaned)) return Number(cleaned);
  const m = cleaned.match(/^([0-9.eE+]+)\s*\*\s*([0-9.eE+]+)$/);
  if (m) return Number(m[1]) * Number(m[2]);
  return null;
}

let annotated = 0;
let checkedArithmetic = 0;
let exempted = 0;
/** Gates the "no arithmetic ran" backstop below.
 *
 *  🔴 A BACKSTOP THAT HIDES THE DIAGNOSIS IT WAS MEANT TO BACK UP IS WORSE THAN
 *  NO BACKSTOP. `coverageLost` exits immediately, so when a constant is
 *  unannotated or points at a ceiling that does not exist, the specific message
 *  naming that constant would be replaced by a generic "not one comparison ran"
 *  — and the person reading CI would learn nothing about which line to fix.
 *  When limb 3 has already said something concrete, it says it and stops there.
 *  Same reasoning, same shape, as assert-store-metadata.mjs's `limitProblems`. */
let constantProblems = 0;
const constLocations = new Map(); // NAME -> [file...]

for (const file of sourceFiles) {
  const text = read(file);
  if (text === null) continue;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = CONST_RE.exec(lines[i]);
    if (!m) continue;
    const [, name, expr] = m;
    constLocations.set(name, [...(constLocations.get(name) ?? []), file]);

    // The annotation lives in the comment block IMMEDIATELY above the constant.
    // One declaration, in the file where the number lives — a second list in
    // JSON would be the first thing to drift away from the source it describes.
    let block = '';
    for (let j = i - 1; j >= 0; j--) {
      const t = lines[j].trim();
      if (t === '') break;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/')) {
        block = `${lines[j]}\n${block}`;
        continue;
      }
      break;
    }

    const none = /@ceiling\s+none\s*[—-]\s*(\S[^\n]*)/.exec(block);
    const ref = /@ceiling\s+([A-Za-z][A-Za-z0-9_.]*)\s+(lte|memberOf)/.exec(block);
    const exceeds = /@ceiling-exceeds\s+(\S[^\n]*)/.exec(block);

    if (none) {
      exempted++;
      annotated++;
      continue;
    }
    if (!ref) {
      constantProblems++;
      problems.push(
        `${file}:${i + 1} \`${name}\` is a numeric constant with NO \`@ceiling\` annotation. Write \`// @ceiling <id> lte\` above it and this guard checks the arithmetic, or \`// @ceiling none — <reason>\` if it bounds an input shape rather than a platform resource. An unannotated cap is exactly what MAX_EVENTS_PER_BATCH = 100 was: a number at DOUBLE its platform's documented limit, with nothing in the tree able to say so.`,
      );
      continue;
    }
    annotated++;

    const d = derivable(ref[1]);
    if (!d.ok) {
      constantProblems++;
      problems.push(`${file}:${i + 1} \`${name}\` derives from \`@ceiling ${ref[1]}\` — but ${d.why}`);
      continue;
    }
    const value = evalNumeric(expr);
    if (value === null) {
      constantProblems++;
      problems.push(
        `${file}:${i + 1} \`${name} = ${expr.trim()}\` is annotated \`@ceiling ${ref[1]}\` and this scan cannot evaluate its expression, so the comparison did not run. A cap that claims a ceiling and is never measured against it is worse than an unannotated one: it looks checked. Simplify the expression or teach evalNumeric the form.`,
      );
      continue;
    }
    checkedArithmetic++;
    if (value > d.row.value) {
      if (exceeds) {
        prints.push(
          `OVER CEILING (declared): ${file}:${i + 1} \`${name} = ${value}\` exceeds ceiling "${ref[1]}" = ${d.row.value}. ${exceeds[1]}`,
        );
      } else {
        problems.push(
          `${file}:${i + 1} \`${name} = ${value}\` EXCEEDS its declared ceiling "${ref[1]}" = ${d.row.value} (${d.row.sourceText}). Lower the constant, or declare \`// @ceiling-exceeds <reason>\` above it — which prints on every run rather than going quiet. Source: ${d.row.source}`,
        );
      }
    }
  }
}

if (constLocations.size === 0) {
  coverageLost([
    `${sourceFiles.length} source file(s) were read and ZERO numeric constants were found.`,
    'The constant pattern has stopped matching the code. Every cap in the tree is then "annotated"',
    'by never having been looked at — the exact shape of check-migrations.mjs silently dropping from',
    '5 files to 4 and reporting PASS.',
  ]);
}
if (annotated > 0 && checkedArithmetic === 0 && constantProblems === 0) {
  coverageLost([
    `${annotated} constant(s) carry a \`@ceiling\` annotation and NOT ONE arithmetic comparison ran.`,
    'Either every annotation is `none`, or every referenced ceiling is unverified, or the expression',
    'evaluator stopped evaluating. All three report every cap within its ceiling by measuring none.',
  ]);
}

// ── LIMB 4 — every batch call site is accounted for, in both directions ──────
const batchBlock = register.batchCallSites;
const declaredSites = Array.isArray(batchBlock?.sites) ? batchBlock.sites : [];
if (declaredSites.length === 0) {
  coverageLost([
    `${CEILINGS} declares no \`batchCallSites.sites\`.`,
    'A `.batch([...])` is the one construct that turns one handler into N queries, so it is the shape',
    'd1.queriesPerInvocation actually binds. With nothing declared, every call site on disk would be',
    'reported below as unaccounted — but an EMPTY declaration is the likelier reading of a block that',
    'was deleted, and it must not be mistaken for "there are no batches".',
  ]);
}

const foundSites = new Set();
for (const file of sourceFiles) {
  const text = read(file);
  if (text === null) continue;
  if (/\.batch\s*\(/.test(stripTsComments(text))) foundSites.add(file);
}
if (foundSites.size === 0) {
  coverageLost([
    'the scan found ZERO `.batch(` call sites under services/*/src/.',
    'There are five in this repo. A pattern that matches none reports every batch accounted for.',
  ]);
}

const declaredByFile = new Map(declaredSites.filter((s) => typeof s?.file === 'string').map((s) => [s.file, s]));
let batchesAccounted = 0;
for (const file of foundSites) {
  const decl = declaredByFile.get(file);
  if (!decl) {
    problems.push(
      `${file} calls \`.batch(\` and ${CEILINGS} \`batchCallSites\` does not name it. Every batch must declare what bounds its statement count — a \`boundedBy\` constant, or an \`unboundedReason\` that prints. An unaccounted batch is how a handler quietly becomes N queries against a 50-query ceiling.`,
    );
    continue;
  }
  const bound = typeof decl.boundedBy === 'string' && decl.boundedBy.trim() !== '';
  const unbounded = typeof decl.unboundedReason === 'string' && decl.unboundedReason.trim() !== '';
  if (!bound && !unbounded) {
    problems.push(
      `${CEILINGS} \`batchCallSites\` names ${file} with neither a \`boundedBy\` constant nor a non-empty \`unboundedReason\`. A bare entry is a claim that the batch is accounted for, made by declaring nothing.`,
    );
    continue;
  }
  if (bound && !constLocations.has(decl.boundedBy)) {
    problems.push(
      `${CEILINGS} says ${file}'s batch is bounded by \`${decl.boundedBy}\`, and no constant of that name exists anywhere under services/*/src/. The bound is a string, the batch is real, and the two have stopped being related — the constant was renamed or deleted and this entry kept the accounting looking complete.`,
    );
    continue;
  }
  if (unbounded) prints.push(`UNBOUNDED BATCH (declared): ${file} — ${decl.unboundedReason}`);
  batchesAccounted++;
}
for (const file of declaredByFile.keys()) {
  if (!foundSites.has(file)) {
    problems.push(
      `${CEILINGS} \`batchCallSites\` names ${file}, and this scan finds no \`.batch(\` there. A stale entry is the same defect as a missing one: it makes the accounting look complete while covering a call site that has moved.`,
    );
  }
}

// ── LIMB 5 — the deployed configs against their account-wide ceilings ────────
const wranglerConfigs = [
  ...serviceDirs.map((d) => `${d}/wrangler.jsonc`).filter((r) => existsSync(abs(r))),
  ...(existsSync(abs(BRICK_CFG)) ? [BRICK_CFG] : []),
];
if (wranglerConfigs.length === 0) {
  coverageLost([
    'no wrangler config was found under services/*/ or in the brick template.',
    'Limb 5 counts crons, databases, namespaces and limiter periods across them. With none found,',
    'every account-wide ceiling is respected by counting nothing — and the brick is the config that',
    'MULTIPLIES all four by the number of apps.',
  ]);
}

const parsed = [];
for (const rel of wranglerConfigs) {
  const text = read(rel);
  try {
    parsed.push({ rel, cfg: JSON.parse(stripJsonc(text)) });
  } catch (e) {
    problems.push(`${rel} could not be parsed after comment stripping — ${e.message}. An unparseable config is silently excluded from every count below, which lowers each one.`);
  }
}
if (parsed.length === 0) {
  coverageLost([`${wranglerConfigs.length} wrangler config(s) were found and NONE parsed. Every limb-5 count would be zero and therefore under every ceiling.`]);
}

const checks = Array.isArray(register.configCeilings?.checks) ? register.configCeilings.checks : [];
if (checks.length === 0) {
  coverageLost([`${CEILINGS} declares no \`configCeilings.checks\` — limb 5 has nothing to evaluate and would pass over ${parsed.length} config(s) silently.`]);
}

const counters = {
  crons: () => parsed.reduce((n, p) => n + (Array.isArray(p.cfg?.triggers?.crons) ? p.cfg.triggers.crons.length : 0), 0),
  d1Databases: () => new Set(parsed.flatMap((p) => (Array.isArray(p.cfg?.d1_databases) ? p.cfg.d1_databases : []).map((d) => d?.database_name).filter(Boolean))).size,
  kvNamespaces: () => new Set(parsed.flatMap((p) => (Array.isArray(p.cfg?.kv_namespaces) ? p.cfg.kv_namespaces : []).map((k) => k?.id).filter(Boolean))).size,
};

let configChecksRun = 0;
for (const chk of checks) {
  const d = derivable(chk.ceiling);
  if (chk.relation === 'memberOf') {
    const row = byId.get(chk.ceiling);
    const allowed = Array.isArray(row?.allowedValues) ? row.allowedValues : null;
    if (!allowed) {
      problems.push(`configCeilings check "${chk.id}" uses relation \`memberOf\` against ceiling "${chk.ceiling}", which declares no \`allowedValues\`. The membership test has no set, so every value is a member.`);
      continue;
    }
    let measured = 0;
    for (const p of parsed) {
      for (const rl of Array.isArray(p.cfg?.ratelimits) ? p.cfg.ratelimits : []) {
        const period = rl?.simple?.period;
        if (period === undefined) continue;
        measured++;
        if (!allowed.includes(period)) {
          problems.push(
            `${p.rel} rate limiter "${rl.name ?? '(unnamed)'}" declares \`period: ${period}\`, and the binding accepts only ${JSON.stringify(allowed)}. Source: ${row.source} — "${row.sourceText}". A period outside the set deploys and then behaves in a way nobody predicted.`,
          );
        }
      }
    }
    if (measured > 0) configChecksRun++;
    continue;
  }
  if (!d.ok) {
    problems.push(`configCeilings check "${chk.id}" references ceiling "${chk.ceiling}" — but ${d.why}`);
    continue;
  }
  const counter = counters[chk.id];
  if (!counter) {
    problems.push(`configCeilings check "${chk.id}" has no counter in this guard. A declared check nobody evaluates is a check that reports clean by never running — add the counter or remove the declaration.`);
    continue;
  }
  configChecksRun++;
  const n = counter();
  if (n > d.row.value) {
    problems.push(
      `${chk.id}: the repo's wrangler configs declare ${n} (${chk.counts}) against the ceiling "${chk.ceiling}" = ${d.row.value}. Source: ${d.row.source} — "${d.row.sourceText}". Configs counted: ${parsed.map((p) => p.rel).join(', ')}`,
    );
  }
}
if (configChecksRun === 0) {
  coverageLost([
    `${checks.length} configCeilings check(s) are declared and NOT ONE was evaluated.`,
    'Every account-wide ceiling would then be respected by never being counted — and the tightest of',
    'them (5 cron triggers per account on Free) is the reason this portfolio has ONE scheduler.',
  ]);
}

// ── LIMB 6 — the write-amplification factor is COUNTED, never typed ──────────
// [11]E-14: "`rows_written_per_event` is computed by counting the indexes on
// `events`, not typed into a document. Adding a fifth index then changes the
// headroom number automatically, and a model whose stored value disagrees with
// the count FAILS."
const amp = register.writeAmplification;
if (!amp || typeof amp !== 'object' || Array.isArray(amp)) {
  coverageLost([
    `${CEILINGS} declares no \`writeAmplification\` block, so limb 6 never runs.`,
    'That limb is the whole of E-14\'s replacement acceptance: without the block there is no stored',
    'number to disagree with the schema, and a capacity model nobody can contradict is exactly the',
    'prose-satisfies-the-criterion shape E-14 was re-opened for — it read 1 row per event for two days',
    'while the schema said 5.',
  ]);
}
if (typeof amp.migrationsDir !== 'string' || typeof amp.table !== 'string') {
  coverageLost([
    `${CEILINGS} \`writeAmplification\` names no \`migrationsDir\` and/or no \`table\`.`,
    'Those two ARE limb 6\'s scan domain. With either missing the index count ranges over nothing and',
    'derives 1 row per event — the 5×-optimistic number this limb exists to make impossible.',
  ]);
}

const migDir = abs(amp.migrationsDir);
const migFiles = existsSync(migDir) && statSync(migDir).isDirectory()
  ? listDir(migDir).filter((n) => n.toLowerCase().endsWith('.sql')).sort()
  : [];
if (migFiles.length === 0) {
  coverageLost([
    `\`writeAmplification.migrationsDir\` = "${amp.migrationsDir}" holds NO .sql file.`,
    'Every index below is counted out of those files. None found, the count is zero, the derived factor',
    'is 1, and the model reports agreement with a schema it never read.',
  ]);
}

/** Every index this migration set leaves in place, by name.
 *
 *  🔴 A REAL PARSE, NOT A GREP — the repo rule, and this file is the reason for
 *  it: 0002_analytics.sql's HEADER COMMENT contains the words "UNIQUE INDEX",
 *  "write amplification" and "PRIMARY KEY" in a paragraph explaining a shape it
 *  deliberately does NOT use. A text scan reads that paragraph as schema.
 *  Comments AND string literals are blanked first (both reductions preserve byte
 *  offsets, so the line numbers reported below are the real ones), statements are
 *  split on `;` so a `CREATE INDEX` whose `ON <table>` sits on the NEXT line is
 *  still one statement — 0002:85-86 is exactly that, and it targets a DIFFERENT
 *  table, so a line-oriented scan would either miss it or miscount it. */
const liveIndexes = new Map(); // indexName -> { table, file, line }
const tablesCreated = new Set();
let indexStatements = 0;

const CREATE_TABLE_RE = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z_][\w$]*)["'`\]]?\s*\(/i;
// A statement that OPENS with CREATE … INDEX. Deliberately anchored: an
// unanchored `CREATE[\s\S]*INDEX` also matches a CREATE TABLE whose body happens
// to contain the word, and a limb that over-counts is as wrong as one that
// under-counts — it would silently raise the factor and shrink the headroom.
const INDEX_HEAD_RE = /^\s*CREATE\s+(?:\w+\s+)*?INDEX\b/i;
const CREATE_INDEX_RE =
  /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z_][\w$]*)["'`\]]?\s+ON\s+["'`[]?([A-Za-z_][\w$]*)["'`\]]?\s*\(/i;
const DROP_INDEX_RE = /^\s*DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?["'`[]?([A-Za-z_][\w$]*)["'`\]]?/i;

for (const f of migFiles) {
  const rel = posix.join(amp.migrationsDir, f);
  const rawSql = readFileSync(join(migDir, f), 'utf8');
  const sql = stripStringLiterals(stripSourceComments(rawSql, '.sql'));
  const lineOf = (idx) => rawSql.slice(0, idx).split('\n').length;

  let start = 0;
  for (let i = 0; i <= sql.length; i++) {
    if (i !== sql.length && sql[i] !== ';') continue;
    const stmt = sql.slice(start, i);
    const at = start;
    start = i + 1;
    if (stmt.trim() === '') continue;

    const t = CREATE_TABLE_RE.exec(stmt);
    if (t) tablesCreated.add(t[1]);

    if (!INDEX_HEAD_RE.test(stmt)) {
      const d = DROP_INDEX_RE.exec(stmt);
      if (d) liveIndexes.delete(d[1]);
      continue;
    }
    indexStatements++;
    const m = CREATE_INDEX_RE.exec(stmt);
    if (!m) {
      problems.push(
        `${rel}:${lineOf(at + stmt.search(/\S/))} opens a \`CREATE … INDEX\` statement whose target table this scan could NOT read, so it was counted for NO table at all. An index the parser cannot attribute is an index missing from the amplification factor, and a failed parse only ever moves that factor DOWN — towards the 1-row-per-event answer that was already wrong by 5×. This is reported rather than skipped for exactly that reason. The known form that lands here is a DOUBLE-QUOTED identifier (\`ON "events"\`): string literals are blanked before this scan — the repo rule, and the reason a comment naming an index is not counted as one — and SQLite's double quotes are indistinguishable from a literal at that stage. No migration in this repo uses that form; write the identifier bare, or teach CREATE_INDEX_RE the shape you need.`,
      );
      continue;
    }
    liveIndexes.set(m[1], { table: m[2], file: rel, line: lineOf(at + stmt.search(/\S/)) });
  }
}

if (!tablesCreated.has(amp.table)) {
  coverageLost([
    `no migration in "${amp.migrationsDir}" creates the table \`${amp.table}\` that \`writeAmplification\` sizes.`,
    `${migFiles.length} .sql file(s) were read and ${tablesCreated.size} table(s) parsed out of them` +
      `${tablesCreated.size ? ` (${[...tablesCreated].join(', ')})` : ''}.`,
    'Either the table was renamed and this block still sizes the old one, or the DDL parse has stopped',
    'reading CREATE TABLE. Both leave the index count below ranging over a table nobody writes to.',
  ]);
}

const tableIndexes = [...liveIndexes.values()].filter((x) => x.table === amp.table);
if (tableIndexes.length === 0) {
  coverageLost([
    `ZERO \`CREATE INDEX … ON ${amp.table}\` statements were parsed out of ${migFiles.length} migration file(s).`,
    `The derived factor would be 1 row written per row inserted — WHICH IS THE EXACT NUMBER [11]E-14's`,
    'sizing assumed before its research pass, and it was five times too generous. A zero here is a',
    'broken parser reporting the original defect as a result.',
  ]);
}

const ampCeiling = derivable(amp.ceiling);
if (!ampCeiling.ok) {
  problems.push(`\`writeAmplification\` derives its headroom from ceiling "${amp.ceiling}" — but ${ampCeiling.why}`);
}

const derivedPerEvent = 1 + tableIndexes.length;
const where = tableIndexes.map((x) => `${x.file}:${x.line}`).join(', ');

if (!Number.isFinite(amp.rowsWrittenPerEvent)) {
  problems.push(
    `${CEILINGS} \`writeAmplification\` declares no numeric \`rowsWrittenPerEvent\`. The schema says ${derivedPerEvent} (1 base row + ${tableIndexes.length} index rows: ${where}). The field is not optional: with nothing stored there is nothing for the count to contradict, and E-14's whole correction was that an unre-derivable number stayed wrong for two days.`,
  );
} else if (amp.rowsWrittenPerEvent !== derivedPerEvent) {
  problems.push(
    `${CEILINGS} \`writeAmplification.rowsWrittenPerEvent\` = ${amp.rowsWrittenPerEvent}, and the SCHEMA SAYS ${derivedPerEvent} — 1 base row + ${tableIndexes.length} index row(s) on \`${amp.table}\` (${where}). D1 bills rows written and an index row is a row written ("${ampCeiling.ok ? ampCeiling.row.source : amp.ceiling}"), so this factor multiplies every headroom figure downstream. [11]E-14: the value is COUNTED, never typed — do not edit it to match; either the index set changed on purpose (then this is the number to accept) or an index was added without anyone re-reading the capacity model.`,
  );
}

if (ampCeiling.ok && derivedPerEvent > 0) {
  const derivedPerDay = Math.floor(ampCeiling.row.value / derivedPerEvent);
  if (!Number.isFinite(amp.eventsPerDayWithinCeiling)) {
    problems.push(
      `${CEILINGS} \`writeAmplification\` declares no numeric \`eventsPerDayWithinCeiling\`. It is ⌊${ampCeiling.row.value} ÷ ${derivedPerEvent}⌋ = ${derivedPerDay}, and storing it is what makes the HEADROOM — not just the factor — move by itself when an index lands.`,
    );
  } else if (amp.eventsPerDayWithinCeiling !== derivedPerDay) {
    problems.push(
      `${CEILINGS} \`writeAmplification.eventsPerDayWithinCeiling\` = ${amp.eventsPerDayWithinCeiling}, and the derivation gives ${derivedPerDay} = ⌊${ampCeiling.row.value} (ceiling "${amp.ceiling}") ÷ ${derivedPerEvent} (rows per event, counted from ${where})⌋. This is the number [11]E-14 states as the portfolio's daily event budget; a stored figure that disagrees with its own inputs is the 5× error again, one recomputation later.`,
    );
  }
}

// ── LIMB 8 — where the ACTUAL numbers are read, PRINTED on every run ─────────
// [11]E-14: "Where the actual numbers are read is still `human` (Cloudflare
// account analytics), and that is legitimate — but it must PRINT on every run,
// never silently pass, because it is the limb nobody can automate today."
//
// ⚠️ THE DOMAIN IS DERIVED, NOT TYPED. A hand-written list of "the three that
// need a dashboard" is a number to tune, and it would stop covering the fourth
// ceiling the day one was added. The rule instead: a row whose `scope` is
// account-wide AND which no `configCeilings` check counts has NO observer
// anywhere in this repo. Limb 5 counts what a wrangler config DECLARES (crons,
// databases, namespaces); a daily TOTAL is not declared anywhere, and the rate
// limiters are per-colo and prove nothing account-wide. So for those rows the
// vendor dashboard is the only place the real number exists — and the honest
// fix for one appearing here is either a read location or a real counting
// check, never deleting the row (limb 2 catches that through `surfaces`).
const readsBlock = register.actualsReadFrom;
if (!readsBlock || typeof readsBlock !== 'object' || Array.isArray(readsBlock)) {
  coverageLost([
    `${CEILINGS} declares no \`actualsReadFrom\` block, so limb 8 never runs and NOTHING prints.`,
    'The ceilings would then be a capacity model with no reading: every number in it is what the vendor',
    'ALLOWS, and not one is what this account actually SPENDS. E-14 asks for both — "the ceiling is watched',
    'rather than discovered" — and the watching half is the half that cannot be automated here, which is',
    'exactly why its absence has to be loud instead of green.',
  ]);
}
if (typeof readsBlock.whyNotAutomated !== 'string' || readsBlock.whyNotAutomated.trim() === '') {
  problems.push(
    `${CEILINGS} \`actualsReadFrom\` declares no \`whyNotAutomated\`. This block exists because a limb is being left to a human, and a hand-done step with no recorded reason is one nobody can ever judge as still-necessary. It prints on every run alongside the locations.`,
  );
}

const readEntries = Array.isArray(readsBlock.locations) ? readsBlock.locations : [];
const countedByConfigCheck = new Set(checks.map((c) => c?.ceiling).filter((x) => typeof x === 'string'));
const observedOnly = [...byId.values()].filter(
  (r) => typeof r.scope === 'string' && r.scope.startsWith('per-account') && !countedByConfigCheck.has(r.id),
);
if (observedOnly.length === 0) {
  coverageLost([
    `ZERO account-wide ceilings were derived as "observable only at the vendor" out of ${byId.size} row(s).`,
    `Either every \`scope\` stopped starting with "per-account" (a rename), or a configCeilings check now`,
    'claims to count all of them. Both make limb 8 range over the empty set — every account-wide ceiling has',
    'a read location, in zero comparisons — and the daily-total ceilings are the ones with no observer in CI.',
  ]);
}

const readByCeiling = new Map();
for (const e of readEntries) {
  if (!e || typeof e.ceiling !== 'string' || e.ceiling.trim() === '') {
    problems.push(`${CEILINGS} \`actualsReadFrom.locations\` holds an entry naming no \`ceiling\`. It cannot be matched to anything, so it reads as coverage while covering nothing.`);
    continue;
  }
  if (!byId.has(e.ceiling)) {
    problems.push(
      `${CEILINGS} \`actualsReadFrom\` names ceiling "${e.ceiling}", which no row in this register declares. A read location pointing at an id nobody has is the stale-entry defect from limb 4 in a new place: the block looks complete and the ceiling it claims to watch is gone or renamed.`,
    );
    continue;
  }
  const where = typeof e.where === 'string' ? e.where.trim() : '';
  const url = typeof e.url === 'string' ? e.url.trim() : '';
  const reads = typeof e.reads === 'string' ? e.reads.trim() : '';
  if (where === '' || reads === '') {
    problems.push(
      `${CEILINGS} \`actualsReadFrom\` entry for "${e.ceiling}" is missing a non-empty \`where\` and/or \`reads\`. "It is read from the dashboard" names no page and no figure; the entry has to be followable by someone who has never done it, or the run prints a reminder nobody can act on.`,
    );
    continue;
  }
  if (!HTTPS.test(url)) {
    problems.push(
      `${CEILINGS} \`actualsReadFrom\` entry for "${e.ceiling}" carries no https \`url\`. Same rule as a ceiling's \`source\`: a navigation path with no link decays into folklore about a UI that has since been rearranged.`,
    );
    continue;
  }
  readByCeiling.set(e.ceiling, e);

  const row = byId.get(e.ceiling);
  const bound = Number.isFinite(row.value) ? `${row.value}${row.unit ? ` ${row.unit}` : ''} (${row.scope})` : 'UNVERIFIED — no numeric ceiling to compare against';
  // The magnitude is READ FROM THE ROW, never repeated in the entry: a number
  // typed twice is a number that disagrees with itself eventually, and this
  // print would be the copy nobody re-derives.
  prints.push(`READ BY HUMAN — "${e.ceiling}": ${where} → ${url}\n      read ${reads}; it must stay under ${bound}`);
}

for (const r of observedOnly) {
  if (!readByCeiling.has(r.id)) {
    problems.push(
      `ceiling "${r.id}" is account-wide (\`scope: ${r.scope}\`) and NO \`configCeilings\` check counts it, so nothing in this repo can observe what is actually being spent against it — and \`actualsReadFrom\` names no place to read it either. That is a ceiling discovered rather than watched: the first signal is the vendor refusing a write. Add a location (dashboard path + https url + the figure to read), or add a real counting check to \`configCeilings\` if the number can in fact be derived from the repo.`,
    );
  }
}

if (readsBlock.whyNotAutomated) prints.push(`READ LOCATION IS \`human\` — ${readsBlock.whyNotAutomated}`);

// ── report ───────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (a declared gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
  console.log('');
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-ceiling-budget: FAILED');
  process.exitCode = 1;
} else {
  ok(
    `REQUIRED_COVERAGE — ${surfaces.length} vendor surface(s), every one named by a ceiling row; ` +
      `${sourced} sourced+dated ceiling(s), ${unverified} recorded UNVERIFIED and not derivable from`,
  );
  ok(
    `${datedRows} of ${byId.size} ceiling(s) dated and WITHIN the stated \`${cadenceBlock.cadence}\` re-verification cadence; ` +
      `oldest is "${oldestId}" at ${oldestAge} day(s), ${CADENCE_DAYS - oldestAge} day(s) before it fails`,
  );
  ok(
    `${readByCeiling.size} human read location(s) printed above for ${observedOnly.length} account-wide ceiling(s) ` +
      `no configCeilings check can count (${observedOnly.map((r) => r.id).join(', ')})`,
  );
  ok(
    `${constLocations.size} numeric constant(s) in ${sourceFiles.length} source file(s): ${annotated} annotated ` +
      `(${checkedArithmetic} compared to a sourced ceiling, ${exempted} declared non-bounding)`,
  );
  ok(`${batchesAccounted} of ${foundSites.size} \`.batch(\` call site(s) accounted for; ${configChecksRun} account-wide config ceiling(s) counted across ${parsed.length} wrangler config(s)`);
  ok(
    `write amplification DERIVED, not read: ${indexStatements} \`CREATE INDEX\` statement(s) parsed from ` +
      `${migFiles.length} migration file(s), ${tableIndexes.length} of them on \`${amp.table}\` (${where}) ` +
      `⇒ ${derivedPerEvent} rows written per event, ⌊${ampCeiling.ok ? ampCeiling.row.value : '?'} ÷ ${derivedPerEvent}⌋ = ` +
      `${amp.eventsPerDayWithinCeiling} events/day portfolio-wide`,
  );
  console.log('\nassert-ceiling-budget: ok');
}
