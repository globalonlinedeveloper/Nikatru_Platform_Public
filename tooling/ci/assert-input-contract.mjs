#!/usr/bin/env node
// [pipeline S-1] THE APP SPEC IS ONE VALIDATED INPUT CONTRACT.
//
// Two properties, and the first is the one with teeth.
//
// ── 1 · EVERY declared var has a rule, and "every" cannot shrink ────────────
// The old acceptance criterion said "every load-bearing var is validated". That
// names NO SET, so it was satisfied by validating one — and the tree validated
// 2 of 8. A criterion that quantifies over a set nobody computes is the same
// defect as one that quantifies over an empty set: it reports coverage it does
// not have.
//
// So the set is COMPUTED HERE, from `brick.yaml` itself, and compared against
// the rules `pre_gen.dart` actually implements. Add a ninth var and the build
// fails until it has a rule. That is what makes the word "every" mean something
// a person cannot quietly shrink.
//
// A "rule" is TWO things, and for a long time only the first was checked: the
// hook must READ the var out of the spec, AND be able to REJECT on the value it
// read. See the 🔴 note at the check itself for the mutation that proved the
// difference — deleting a whole validation rule while keeping the read left this
// guard reporting full coverage.
//
// ── 2 · NO INSTRUCTION MAY NAME A FILE THAT DOES NOT EXIST ─────────────────
// The brick told its user four times to edit `apps/<id>/app.yaml`. That file has
// never existed. A runbook naming a phantom file is worse than one saying
// nothing: the reader assumes they are holding it wrong.
//
// 🔴 THE OBVIOUS IMPLEMENTATION IS A BLACKLIST, AND IT IS WRONG. Grepping for
// `app.yaml` stops that one filename and nothing else — the next phantom, under
// a different name, sails through while the guard reports clean. So this
// EXTRACTS every yaml/json filename the brick and its hooks mention and fails on
// any that neither exists nor is allowlisted. Catch the class, not the instance.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ── two views of the hook, both offset-preserving ────────────────────────────
// Blanked spans keep their newlines and their width, so an index in one view is
// the same index in the other and in the raw source.
//
// ⚠️ THE TWO VIEWS ARE NOT INTERCHANGEABLE, and picking the wrong one silently
// inverts this guard:
//   · `withStrings` keeps string literals, because the READ this guard looks for
//     IS a string — `v('app_id')`. Blank the literals and every var's read looks
//     identical, which is the caveat PR #92 recorded when the sibling guard's
//     exported stripper would have erased the very evidence it needed.
//   · `code` blanks them, because the REJECTION must be proven by a CONDITION,
//     and every error message in the hook recites the var's own name in prose.
//     Match against strings and the message satisfies the rule it is describing.
// A hand-rolled scanner rather than a regex: a regex cannot tell `//` inside a
// string from a comment. It lives here rather than being imported because every
// .mjs directly under tooling/ci is a GUARD to assert-guard-coverage.mjs (needing
// its own negative test and coverage marker) and a subdirectory is a hard
// COVERAGE LOST — so there is nowhere shared to put it that does not cost more
// than it saves.
function stripDart(src, { keepStrings = false } = {}) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out += '  '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; out += '  '; i += 2; if (depth === 0) break; continue; }
        out += blank(src[i]); i++;
      }
      continue;
    }
    if (c === "'" || c === '"' || (c === 'r' && (c2 === "'" || c2 === '"'))) {
      const isRaw = c === 'r';
      const q = isRaw ? c2 : c;
      let j = isRaw ? i + 1 : i;
      const triple = src[j] === q && src[j + 1] === q && src[j + 2] === q;
      const closeLen = triple ? 3 : 1;
      const start = i;
      j += closeLen;
      while (j < n) {
        if (!isRaw && src[j] === '\\') { j += 2; continue; }
        if (src[j] === q && (!triple || (src[j + 1] === q && src[j + 2] === q))) { j += closeLen; break; }
        if (!triple && src[j] === '\n') break;
        j++;
      }
      const literal = src.slice(start, j);
      out += keepStrings ? literal : [...literal].map(blank).join('');
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * OFFSET RANGES of every `if (…)` condition that lexically ENCLOSES a rejection.
 *
 * Walks the brace structure of the stripped hook, recording, for each
 * `problems.add(`, the condition of every `if` whose block contains it. That is
 * the "lexical region that reads it" the fix calls for, computed rather than
 * assumed — and it is FAIL-CLOSED: if this walker ever stops understanding the
 * hook's shape it returns nothing, every var reads as unrejectable, and the build
 * goes red instead of quietly reporting full coverage.
 *
 * RANGES, not text, because the caller needs to read the SAME span out of both
 * views: local identifiers out of the string-blanked one (so an error message
 * cannot satisfy the rule it describes), and an inlined `v('name')` read out of
 * the string-keeping one (where the read IS a literal). One view alone gets one
 * of those two wrong.
 */
function rejectionConditions(code) {
  const conditions = [];
  const stack = [];
  const rejections = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') stack.push(i);
    else if (code[i] === '}') stack.pop();
    else if (code.startsWith('problems.add(', i)) rejections.push([...stack]);
  }
  /** The `if (…)` condition whose block opens at `brace`, or null. */
  const conditionAt = (brace) => {
    let close = brace - 1;
    while (close >= 0 && /\s/.test(code[close])) close--;
    if (code[close] !== ')') return null; // not `… ) {` — e.g. a plain block or a lambda
    let depth = 0;
    let open = -1;
    for (let k = close; k >= 0; k--) {
      if (code[k] === ')') depth++;
      else if (code[k] === '(') { depth--; if (depth === 0) { open = k; break; } }
    }
    if (open === -1) return null;
    let j = open - 1;
    while (j >= 0 && /\s/.test(code[j])) j--;
    // `if (…)` or `else if (…)` — a `for`/`while` header is not a rejection rule.
    if (!/\bif$/.test(code.slice(Math.max(0, j - 2), j + 1))) return null;
    return [open + 1, close];
  };
  const seen = new Set();
  for (const braces of rejections) {
    for (const b of braces) {
      if (seen.has(b)) continue;
      seen.add(b);
      const range = conditionAt(b);
      if (range) conditions.push(range);
    }
  }
  return conditions;
}

const ROOT = process.cwd();
const BRICK = 'tooling/bricks/app';
const YAML = `${BRICK}/brick.yaml`;
const PRE_GEN = `${BRICK}/hooks/pre_gen.dart`;
const problems = [];
const ok = (m) => console.log(`ok   ${m}`);

const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);

const brickYaml = read(YAML);
const preGen = read(PRE_GEN);
if (brickYaml === null) problems.push(`${YAML} is missing — the input contract has no declaration.`);
if (preGen === null) problems.push(`${PRE_GEN} is missing — nothing validates the spec at all.`);

if (brickYaml !== null && preGen !== null) {
  const preGenWithStrings = stripDart(preGen, { keepStrings: true }); // reads live in strings
  const preGenCode = stripDart(preGen); // conditions must be code, never prose

  // ── the declared set ──────────────────────────────────────────────────────
  // `vars:` is top-level; each var is a 2-space key beneath it. Parsed
  // structurally rather than grepped, because a grep for `\w+:` also matches
  // `type:`, `prompt:` and `default:` — the sub-keys OF each var — which would
  // inflate the domain and make the count meaningless in the safe direction.
  const lines = brickYaml.split('\n');
  const start = lines.findIndex((l) => /^vars:\s*$/.test(l));
  const declared = [];
  if (start === -1) {
    problems.push(`${YAML} declares no \`vars:\` block, so the contract has no inputs to check.`);
  } else {
    for (const line of lines.slice(start + 1)) {
      if (/^\S/.test(line)) break; // dedent ⇒ out of the vars block
      const m = line.match(/^ {2}(\w+):\s*$/);
      if (m) declared.push(m[1]);
    }
  }

  // A floor, not `> 0`: brick.yaml has held 8 vars since it was written, and a
  // parser that silently matches fewer is this repo's most-repeated failure.
  const MIN_VARS = 8;
  if (declared.length < MIN_VARS) {
    problems.push(
      `COVERAGE LOST — parsed only ${declared.length} var(s) from ${YAML}, expected >= ${MIN_VARS}. Either vars were deleted, or this parser has stopped seeing them.`,
    );
  } else {
    ok(`${declared.length} declared var(s) in brick.yaml`);
  }

  // ── the implemented set ───────────────────────────────────────────────────
  // A var counts as ruled when pre_gen READS it and can REJECT on it. Reading
  // alone is not a rule: the old hook read display_name to print it.
  const problemsPushed = [...preGenCode.matchAll(/problems\.add\(/g)].length;
  if (problemsPushed < MIN_VARS) {
    problems.push(
      `${PRE_GEN} raises only ${problemsPushed} problem(s); with ${declared.length} declared vars there must be at least one rejection path per var.`,
    );
  }

  // 🔴 REQUIRE THE READ, NOT THE WORD. The first version of this tested
  // `\bcategory\b` against the whole hook — and deleting the category rule left
  // it GREEN, because the word survives in the `categories` list, in a comment
  // and in the error message. That is the declaration-vs-usage trap for the
  // fifth time in this repo, this time in the guard written to prevent it.
  //
  // A var is ruled only if the hook actually READS IT OUT OF THE SPEC —
  // `v('name')` or `vars['name']`. Prose cannot satisfy that, and neither can a
  // variable that merely happens to share the name.
  //
  // 🔴 …AND REQUIRE THE REJECTION, NOT JUST THE READ. Triage 2026-08-01,
  // mutation-proven: the comment three lines above has ALWAYS said "READS it and
  // can REJECT on it. Reading alone is not a rule" — and only the read was
  // implemented. Replacing the whole `category` rule with
  // `context.logger.info('category: $category')` (read kept, rejection deleted)
  // left this guard printing `ok every one of the 8 declared var(s) is named by a
  // rule`, exit 0. The aggregate `problems.add(` floor below could not see it
  // either: the hook raises 11 and the floor is 8, so THREE rules could be
  // deleted before anything noticed — including both rules on `app_id`, the one
  // var whose derivations the hook itself records as IRREVERSIBLE.
  //
  // So the rejection is bound TO THE VAR: the value read out of the spec (or the
  // local it is assigned to) must appear in the CONDITION of an `if` that
  // encloses a `problems.add(`. A read-and-print cannot satisfy that, and neither
  // can the error message — conditions are matched against the string-blanked
  // view precisely because every message recites its own var's name.
  //
  // ⚠️ WHAT THIS DOES **NOT** CLAIM, stated so nobody reads more into it than it
  // proves: it asserts each var HAS a rejection path, not how many. Gutting both
  // `app_id` format rules is correctly NOT flagged here, because S-13's
  // `if (problems.isEmpty && appId.isNotEmpty)` re-stamp refusal is a genuine
  // rejection bound to that value. Counting rules per var would need a per-var
  // floor, and "a floor that needs tuning is a floor somebody lowers". The
  // aggregate `problems.add(` floor below stays as the (weaker) count check.
  const READ_OF = (name) => new RegExp(`(?:\\bv\\(|\\bvars\\[)\\s*'${name}'`, 'g');
  const conditions = rejectionConditions(preGenCode);
  const unread = [];
  const unrejected = [];
  for (const name of declared) {
    const reads = [...preGenWithStrings.matchAll(READ_OF(name))];
    if (reads.length === 0) { unread.push(name); continue; }
    // Tokens that stand for this var's VALUE: the read expression itself, plus
    // any local it is assigned to (`final String appId = v('app_id');`).
    const inlineReads = new Set(); // `v('x'` — only visible with strings kept
    const locals = new Set(); // `appId` — only trustworthy with strings blanked
    for (const r of reads) {
      inlineReads.add(r[0]);
      const before = preGenWithStrings.slice(Math.max(0, r.index - 80), r.index);
      const assign = before.match(/([A-Za-z_$][\w$]*)\s*=\s*$/);
      if (assign) locals.add(assign[1]);
    }
    const holds = (haystack, needles) =>
      [...needles].some((t) =>
        new RegExp(`(?:^|[^\\w$])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(haystack),
      );
    const bound = conditions.some(
      ([a, b]) =>
        holds(preGenCode.slice(a, b), locals) ||
        holds(preGenWithStrings.slice(a, b), inlineReads),
    );
    if (!bound) unrejected.push(locals.size ? `${name} (read into \`${[...locals].join('`, `')}\`)` : name);
  }
  if (unread.length) {
    problems.push(
      `these declared var(s) are NEVER READ in ${PRE_GEN}: ${unread.join(', ')}. "Every load-bearing var is validated" was satisfied by validating 2 of 8 for exactly this reason — the set was never computed.`,
    );
  }
  if (unrejected.length) {
    problems.push(
      `these declared var(s) are READ but nothing can REJECT on them in ${PRE_GEN}: ${unrejected.join('; ')}. ` +
        'No `problems.add(` sits inside an `if` whose condition tests that value, so a bad spec for it stamps an app anyway. ' +
        'Reading a var to print it is not a rule — that is the exact defect this check was written to prevent, and the aggregate floor below cannot see it.',
    );
  }
  if (!unread.length && !unrejected.length && declared.length) {
    ok(`every one of the ${declared.length} declared var(s) is read AND can be rejected on`);
  }
  // COVERAGE SELF-CHECK for the walker itself. It is already fail-closed (a
  // walker that understands nothing marks every var unrejected), but a count of
  // zero conditions over a hook that clearly rejects is worth naming rather than
  // leaving to be inferred from a wall of per-var failures.
  if (declared.length && conditions.length === 0) {
    problems.push(
      `COVERAGE LOST — parsed 0 rejection conditions out of ${PRE_GEN}. Either the hook stopped guarding its \`problems.add(\` calls with \`if\`, or this walker has stopped understanding its shape.`,
    );
  }

  // ── refusal must be atomic ────────────────────────────────────────────────
  // A hook that logs and continues stamps the app anyway. mason exits 64 on a
  // throw, having written nothing — that is the whole safety property behind
  // [pipeline S-13]'s refusal.
  if (!/throw\s+Exception\(/.test(preGenCode)) {
    problems.push(
      `${PRE_GEN} never throws. A hook that only logs lets the stamp proceed, so a rejected spec would be written to disk anyway — and S-13's refusal would eat the app it declined to overwrite.`,
    );
  } else {
    ok('refusal throws, so mason exits without writing');
  }

  // ── [pipeline S-13] the existence check ───────────────────────────────────
  // `preGenWithStrings`, not `preGenCode`: the path IS a string literal, so the
  // string-blanked view would erase the evidence. Comments are gone either way.
  if (!/Directory\(['"`]apps\//.test(preGenWithStrings) || !/existsSync\(\)/.test(preGenCode)) {
    problems.push(
      `${PRE_GEN} does not check whether apps/<app_id> already exists. Re-stamping an existing id silently replaces that app with an empty template.`,
    );
  } else {
    ok('a re-stamp of an existing app id is refused');
  }
}

// ── 2 · no instruction may name a file that does not exist ─────────────────
// Allowlisted names are files that legitimately do not exist in the BRICK
// because they are created by the stamp, or belong to the wider repo.
const ALLOW = new Set([
  'pubspec.yaml', 'analysis_options.yaml', 'l10n.yaml', 'brick.yaml',
  'apps.json', 'wrangler.jsonc', 'package.json', 'melos.yaml',
]);
const SCAN = [YAML, PRE_GEN, `${BRICK}/hooks/post_gen.dart`];
const phantoms = [];
let scanned = 0;
for (const rel of SCAN) {
  const src = read(rel);
  if (src === null) continue;
  scanned++;
  // Strip block comments so an explanatory note naming a file cannot be read as
  // an instruction — but KEEP line comments, because the phantom `app.yaml`
  // references lived in exactly those.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of code.matchAll(/([\w.-]+\.(?:yaml|yml|json|jsonc))\b/g)) {
    const name = m[1];
    if (ALLOW.has(name)) continue;
    // Does anything by that name exist anywhere in the brick or the repo root?
    if (!existsAnywhere(name)) phantoms.push({ rel, name });
  }
}
if (scanned === 0) {
  problems.push('COVERAGE LOST — scanned 0 brick files for phantom filenames.');
} else if (phantoms.length) {
  for (const p of phantoms) {
    problems.push(
      `${p.rel} names \`${p.name}\`, which does not exist anywhere in the tree. An instruction pointing at a phantom file makes the reader believe they are holding it wrong. (Allowlist it here if it is created later by the stamp.)`,
    );
  }
} else {
  ok(`no phantom filenames in ${scanned} brick file(s)`);
}

/** Is there a file with this basename anywhere we would plausibly mean? */
function existsAnywhere(name) {
  const roots = [BRICK, 'tooling', '.'];
  for (const r of roots) {
    if (walkFind(join(ROOT, r), name, 0)) return true;
  }
  return false;
}
function walkFind(dir, name, depth) {
  if (depth > 4) return false;
  let entries;
  try { entries = readdirSync(dir); } catch { return false; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git' || e === 'build' || e === '.dart_tool') continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (walkFind(p, name, depth + 1)) return true;
    } else if (e === name) {
      return true;
    }
  }
  return false;
}

void dirname;

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-input-contract: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-input-contract: ok');
}
