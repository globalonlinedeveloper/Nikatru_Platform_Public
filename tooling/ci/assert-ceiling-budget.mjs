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
// ── FIVE LIMBS, EACH WITH A WRITABLE FAILING INPUT ───────────────────────────
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
//
// ⚠️ COVERAGE IS A RELATIONSHIP, NEVER A NUMBER. Limb 2's domain is the vendor
// surface list; limb 3's is every constant the scan finds; limb 4's is every
// batch call site on disk; limb 5's is every wrangler config on disk. The only
// integers here are self-checks that the SCANS still find anything at all —
// because a parser that matches nothing reports perfect agreement with an empty
// register, which is this repo's single most repeated failure.
//
// Usage:  node tooling/ci/assert-ceiling-budget.mjs [repoRoot]
// Exit 0 = every cap derives from a sourced ceiling; 1 = one does not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  for (const e of readdirSync(a, { withFileTypes: true })) {
    const child = posix.join(rel, e.name);
    if (e.isDirectory()) walk(child, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(child);
  }
  return out;
}

const serviceDirs = existsSync(abs('services'))
  ? readdirSync(abs('services'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `services/${e.name}`)
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
    `${constLocations.size} numeric constant(s) in ${sourceFiles.length} source file(s): ${annotated} annotated ` +
      `(${checkedArithmetic} compared to a sourced ceiling, ${exempted} declared non-bounding)`,
  );
  ok(`${batchesAccounted} of ${foundSites.size} \`.batch(\` call site(s) accounted for; ${configChecksRun} account-wide config ceiling(s) counted across ${parsed.length} wrangler config(s)`);
  console.log('\nassert-ceiling-budget: ok');
}
