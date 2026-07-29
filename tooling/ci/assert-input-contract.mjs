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
  const problemsPushed = [...preGen.matchAll(/problems\.add\(/g)].length;
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
  const unruled = declared.filter((name) => {
    const read = new RegExp(`(?:\\bv\\(|\\bvars\\[)\\s*'${name}'`).test(preGen);
    return !read;
  });
  if (unruled.length) {
    problems.push(
      `these declared var(s) have NO rule in ${PRE_GEN}: ${unruled.join(', ')}. "Every load-bearing var is validated" was satisfied by validating 2 of 8 for exactly this reason — the set was never computed.`,
    );
  } else if (declared.length) {
    ok(`every one of the ${declared.length} declared var(s) is named by a rule`);
  }

  // ── refusal must be atomic ────────────────────────────────────────────────
  // A hook that logs and continues stamps the app anyway. mason exits 64 on a
  // throw, having written nothing — that is the whole safety property behind
  // [pipeline S-13]'s refusal.
  if (!/throw\s+Exception\(/.test(preGen)) {
    problems.push(
      `${PRE_GEN} never throws. A hook that only logs lets the stamp proceed, so a rejected spec would be written to disk anyway — and S-13's refusal would eat the app it declined to overwrite.`,
    );
  } else {
    ok('refusal throws, so mason exits without writing');
  }

  // ── [pipeline S-13] the existence check ───────────────────────────────────
  if (!/Directory\(['"`]apps\//.test(preGen) || !/existsSync\(\)/.test(preGen)) {
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
