#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-money-config.mjs — SANDBOX MONEY CANNOT GRANT A PRODUCTION UNLOCK.
//
// [pipeline 5]M-12.
//
// 🔴 THE ORIGINAL ACCEPTANCE CRITERION ASKED FOR AN INPUT THAT CANNOT BE
// CONSTRUCTED. "A correctly-signed sandbox notification does not grant a
// production entitlement" is unfalsifiable: sandbox and live credentials are
// disjoint, so such a notification fails the SIGNATURE check first and [5]M-1
// has already rejected it. The criterion asserted nothing [5]M-1 did not, which
// is why it moves here — to CONFIGURATION, where the failing input is a value
// somebody can actually type into a file.
//
// AND ONE THING THIS GUARD DELIBERATELY DOES NOT DO. It does NOT try to tell a
// sandbox destination secret from a live one. developer.paddle.com documents ONE
// prefix — `pdl_ntfset_` — for the notification-setting secret, and nothing
// establishes a sandbox variant (services/platform/src/lib/mor/paddle.ts, U2).
// A guard that pattern-matched the secret would be encoding an invented vendor
// fact on the boundary where an invented fact grants a stranger a free
// subscription. What IS documented, and what this guard uses:
//   · API keys        `pdl_sdbx_apikey_` vs `pdl_live_apikey_`
//   · base URLs       `sandbox-api.paddle.com` vs `api.paddle.com`
//   · client tokens   sandbox begins `test_`
//   (developer.paddle.com/api-reference/about/authentication · /sdks/sandbox)
//
// FIVE LIMBS, each with a CONSTRUCTIBLE failing input:
//   1 THE DECLARING SET IS THE MONEY-DOOR SET, and every declared value is
//     `live`. A Worker "has a money door" iff its deployed source refuses with
//     `money_rail_not_configured` — the fail-closed marker limb 4 requires.
//     (Until 2026-08-09 this read "exactly one config declares"; that was true
//     while platform owned every door and became false when [ADR 039] D5's
//     RevenueCat fan-in on services/subly-api gained the same world guard. The
//     rule that survives both eras: declaring without a door is a second rail
//     nobody decided to run, and a door without a declaration is a Worker that
//     503s every money read in production.)
//   2 NO sandbox-shaped credential or base URL appears in ANY deployed config.
//   3 EXACTLY ONE destination secret per registered rail, and NONE of them is a
//     committed var. The set comes from the adapter registry, so a second rail
//     is inside this limb the day it is registered.
//   4 THE MoR ROUTE FAILS CLOSED on an absent or unrecognised environment. A
//     default in either direction is a silent catastrophe: 'live' honours
//     sandbox money as real, 'sandbox' stops honouring real money, both green.
//   5 EVERY money-door Worker's own tests EXERCISE the 503 — a branch that is
//     written but never fired is exactly what the MC7 mutation run found.
//
// ── HOW THIS GUARD READS SOURCE (2026-08-21) ────────────────────────────────
// SIX FILE READS LIVE IN THIS GUARD AND THIS LIST IS ALL OF THEM. An
// enumeration that omits a reader is exactly how the weakest reader stays
// invisible — the first version of this block, written earlier the same day,
// omitted limb 2's, which was the most permissive comment reader in the file.
//   · THE DEPLOYED CONFIGS are read once and used twice: `parseJsonc` below
//     PARSES them (comments stripped, so the object is the config and never the
//     prose about it) and LIMB 2 SCANS them for sandbox shapes.
//   · LIMB 2 scanned with a home-grown `/^\s*\/\/.*$/gm` line-strip until
//     2026-08-21. Measured that day against SANDBOX_SHAPES: a full-line
//     `// …sandbox-api.paddle.com` was clean, but the SAME host in a TRAILING
//     `// …` or inside a `/* … */` block FAILED the build. FALSE RED — a
//     comment cannot deploy a credential. It now uses the shared reduction,
//     which is clean on all three comment shapes and still red on the real
//     value `"PADDLE_API": "https://sandbox-api.paddle.com"`.
//   · LIMB 3's registry read, LIMB 3's adapter read and LIMB 5's per-test-file
//     read were RAW until 2026-08-21 and now go through the shared reduction. A
//     guard that matches raw source cannot tell code from prose about code, and
//     this file's own house style puts a great deal of prose about code next to
//     the code.
//   · LIMBS 1 and 4 keep their OLDER line-prefix strip (drop a line whose first
//     non-space is `//` or `*`). Weaker on a TRAILING comment, measured to move
//     no verdict here today, and left alone rather than opening a third idiom.
// THE SHARED REDUCTION IS `stripSourceComments(src, ext)` from
// `text-reductions.mjs` — the one implementation several guards share, blanking
// comments to spaces so offsets and line numbers survive, and passing STRING
// AND TEMPLATE LITERALS THROUGH VERBATIM. It returns an UNKNOWN EXTENSION
// UNCHANGED AND SILENTLY, so every call here hands it an extension the module
// covers: `.ts` at the three source sites (those paths are built as `.ts` or
// filtered to `.test.ts`, so no other extension can reach them) and the LITERAL
// `'.jsonc'` for the deployed configs — `.json` is NOT in COMMENT_STYLES, so
// passing a `wrangler.json`'s real extname would silently scan its comments
// back in while looking like it stripped them.
// THIS WAS A LATENT HAZARD, NOT A CAUGHT DEFECT. Measured 2026-08-21 across the
// live tree: the limb-3 reads resolve identically raw and stripped (registry
// providers ["paddle"] both ways, its MOR_VERIFIERS match on line 29 both ways;
// the guard's `secretEnvVar: '…'` PATTERN matches exactly once in services/, at
// paddle.ts:422, raw and stripped), limb 5's block count falls 413→412 on
// platform and 210→209 on subly-api while `proven` stays at 8 and 2 — the SAME
// blocks — and limb 2 sees no sandbox shape in either view. The `ok` line this
// guard prints is byte-identical before and after. What the change buys is that
// the next comment cannot quietly become the evidence.
// ⚠️ CORRECTED THE SAME DAY, and the correction is the point of house rule 2:
// this block first read "`secretEnvVar` occurs exactly once in all of services/
// and it is code". The TOKEN occurs FIVE times in five files — contract.ts:202,
// paddle.ts:422, registry.ts:39, money.ts:97, money.test.ts:306. What occurs
// once is the guard's PATTERN. A dated number a reader can falsify with one
// grep discredits the numbers standing beside it.
//
// Usage:  node tooling/ci/assert-money-config.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const problems = [];
const fail = (m) => problems.push(m);

const SERVICES = join(ROOT, 'services');
const REGISTRY = 'services/platform/src/lib/mor/registry.ts';
const ROUTE = 'services/platform/src/routes/money.ts';
/** The Worker that owns the rail, and therefore the one that must declare it. */
const MONEY_WORKER = 'platform';

/**
 * Sandbox-shaped values, from primary Paddle documentation only. `configurable`
 * because [ADR 004] runs a second rail: when a Lemon Squeezy adapter is
 * registered, its documented sandbox shapes are added HERE, once, and every
 * deployed config is checked against them.
 */
const SANDBOX_SHAPES = [
  { re: /pdl_sdbx_/i, what: 'a Paddle SANDBOX API key prefix (`pdl_sdbx_apikey_`)' },
  { re: /sandbox-api\.paddle\.com/i, what: 'the Paddle SANDBOX API base URL' },
  { re: /sandbox-vendors\.paddle\.com/i, what: 'the Paddle SANDBOX dashboard host' },
];

/** Comment-stripped JSONC → object. Comments are STRIPPED, never scanned: this
 *  repo has shipped a guard whose grep matched the comment explaining why the
 *  thing it looked for was absent. */
function parseJsonc(text, where) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch (err) {
    fail(`COVERAGE LOST — ${where} could not be parsed after stripping comments: ${err.message}. An unparseable config is scanned by nothing.`);
    return null;
  }
}

// ── the deployed configs ─────────────────────────────────────────────────────
const configs = [];
if (!existsSync(SERVICES)) {
  console.error('✗ COVERAGE LOST — no services/ directory. Every limb would range over nothing.');
  process.exit(1);
}
for (const e of listDir(SERVICES, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  for (const f of ['wrangler.jsonc', 'wrangler.json']) {
    const p = join(SERVICES, e.name, f);
    if (existsSync(p)) configs.push({ service: e.name, rel: `services/${e.name}/${f}`, raw: readFileSync(p, 'utf8') });
  }
}
if (configs.length === 0) {
  console.error('✗ COVERAGE LOST — found ZERO deployed wrangler configs. The scan is broken, not the tree.');
  process.exit(1);
}
if (!configs.some((c) => c.service === MONEY_WORKER)) {
  console.error(`✗ COVERAGE LOST — no deployed config for services/${MONEY_WORKER}, the Worker that owns the money rail.`);
  console.error('  Every limb below is about that config; without it this guard grades the wrong Workers and prints ok.');
  process.exit(1);
}

// ── LIMB 1 · the declaring set IS the money-door set, and every value is live ─
/** A service "has a money door" iff a file under its src/ refuses with the
 *  `money_rail_not_configured` marker — read comment-stripped, the same idiom
 *  limb 4 uses, so the prose explaining the refusal cannot count as one. */
function hasMoneyDoor(service) {
  const srcDir = join(SERVICES, service, 'src');
  if (!existsSync(srcDir)) return false;
  let found = false;
  const walk = (d) => {
    for (const e of listDir(d, { withFileTypes: true })) {
      if (found) return;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(e.name)) {
        const code = readFileSync(p, 'utf8')
          .split('\n')
          .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
          .join('\n');
        if (code.includes('money_rail_not_configured')) found = true;
      }
    }
  };
  walk(srcDir);
  return found;
}

const doorServices = [...new Set(configs.map((c) => c.service))].filter(hasMoneyDoor);
if (doorServices.length === 0) {
  // A recorded failure, not an early exit: the limbs below still run, so a tree
  // that ALSO lost its route file reports both findings rather than the first.
  fail(
    'COVERAGE LOST — no deployed source refuses with `money_rail_not_configured`, so the money-door set is empty; ' +
      'limb 1 has nothing to compare and limb 5 nothing to exercise. The scan is broken, not the tree.',
  );
}

const declaringEnvironment = [];
for (const c of configs) {
  const cfg = parseJsonc(c.raw, c.rel);
  if (cfg === null) continue;
  const value = cfg?.vars?.MONEY_ENVIRONMENT;
  if (value === undefined) continue;
  declaringEnvironment.push({ ...c, value });
  if (value !== 'live') {
    fail(
      `${c.rel} declares MONEY_ENVIRONMENT = ${JSON.stringify(value)}. This file is the DEPLOYED configuration, so ` +
        "it must be exactly \"live\". A sandbox rail is a separate wrangler environment with its own secret, never " +
        'this file with the value edited — a sandbox payment would otherwise write a production entitlement and ' +
        'nothing would go red. [5]M-12',
    );
  }
}
if (declaringEnvironment.length === 0) {
  fail(
    'NO deployed config declares MONEY_ENVIRONMENT. The money doors refuse to serve without it (503), so the rail ' +
      'would be dead in production — and neither the notification payload nor the destination secret can supply the ' +
      'value, because no primary source establishes either. [5]M-12',
  );
} else if (doorServices.length > 0) {
  for (const d of declaringEnvironment) {
    if (!doorServices.includes(d.service)) {
      fail(
        `${d.rel} declares MONEY_ENVIRONMENT but no file under services/${d.service}/src refuses with ` +
          '`money_rail_not_configured` — a declaration without a door is a second rail nobody decided to run ' +
          '([ADR 020]:18; the decided set is the MoR rail plus [ADR 039] D5\'s RevenueCat fan-in).',
      );
    }
  }
  for (const s of doorServices) {
    if (!declaringEnvironment.some((d) => d.service === s)) {
      fail(
        `services/${s} carries a money door (its source refuses with \`money_rail_not_configured\`) but its deployed ` +
          'config declares no MONEY_ENVIRONMENT — every money read on that Worker would 503 in production, which is ' +
          'the fail-closed branch firing on every request instead of on a misconfiguration. [5]M-12',
      );
    }
  }
}

// ── LIMB 2 · no sandbox shape anywhere in a deployed config ─────────────────
for (const c of configs) {
  // Comments are stripped: the config's own prose explains what a sandbox value
  // would be, and a scanner that reads prose grades the explanation.
  //
  // ⚠️ THE EXTENSION IS THE LITERAL `'.jsonc'`, NOT `extname(c.rel)`. The read
  // above accepts `wrangler.json` as well as `wrangler.jsonc`, `.json` is not in
  // COMMENT_STYLES, and an unknown extension comes back UNCHANGED AND SILENT —
  // so the honest-looking version of this line would scan the comments back in
  // on exactly the file that hides them. Both files are parsed as JSONC here
  // anyway (`parseJsonc` above), so reading them as JSONC is not a guess.
  //
  // Until 2026-08-21 this line was `c.raw.replace(/^\s*\/\/.*$/gm, '')`, which
  // dropped only WHOLE-LINE `//` comments. Measured that day: a sandbox host in
  // a TRAILING `// …` or a `/* … */` block failed the build off the comment
  // alone (false RED), while the shared reduction is clean on both and still red
  // on the real value. It is string-aware, so `"https://…supabase.co"` — a `//`
  // inside a quoted value — survives in both readings.
  const code = stripSourceComments(c.raw, '.jsonc');
  for (const s of SANDBOX_SHAPES) {
    if (s.re.test(code)) {
      fail(
        `${c.rel} contains ${s.what}. A deployed config naming a sandbox credential or host is the constructible ` +
          'form of "sandbox money grants a production unlock" — and unlike the original criterion, somebody can ' +
          'actually type it. [5]M-12',
      );
    }
  }
}

// ── LIMB 3 · one destination secret per rail, none of them committed ─────────
const registryPath = join(ROOT, REGISTRY);
let secretVars = [];
if (!existsSync(registryPath)) {
  fail(`COVERAGE LOST — ${REGISTRY} does not exist, so the money-secret set is empty and limb 3 asserts nothing.`);
} else {
  // ⚠️ BOTH READS IN THIS LIMB ARE COMMENT-STRIPPED, and both take the FIRST
  // match, which is the whole reason. A doc comment sitting ABOVE either
  // declaration and quoting an older version of it wins the race against the
  // real code below — and what limb 3 does with the answer is decide WHICH env
  // var names must not appear as committed `vars` in a PUBLIC repo. A shadowed
  // read here does not merely mis-report; it stops looking for the secret that
  // is actually there. `stripSourceComments` blanks comments to spaces (offsets
  // and line numbers survive) and passes STRING LITERALS THROUGH VERBATIM —
  // load-bearing, since `secretEnvVar: 'PADDLE_NOTIFICATION_SECRET'` is a
  // string. Both paths end in `.ts` by construction (REGISTRY is a constant and
  // the adapter path is built as `${p}.ts`), so the module's silent
  // unknown-extension passthrough cannot be reached from here; `.ts` picks the
  // C-family lexer, in which block comments do NOT nest — and a nesting stripper
  // on a .ts file swallows the file tail.
  //
  // LATENT, NOT LIVE — measured 2026-08-21 against this tree. registry.ts: the
  // MOR_VERIFIERS match lands on line 29 raw AND stripped, providers ["paddle"]
  // either way, 2084 CHARACTERS in and out. (Characters, not bytes, and the distinction is
  // measurable rather than pedantic: the blanked comments hold multi-byte UTF-8 — box rules,
  // middots, emoji — so the same file is 2402 utf8 bytes on disk and 2084 after the strip.
  // The property this module promises is offset preservation, and offsets are characters.)
  // paddle.ts: the PATTERN below matches
  // EXACTLY ONCE in the whole of services/ — paddle.ts:422 — raw first match ===
  // stripped first match === PADDLE_NOTIFICATION_SECRET. (The bare TOKEN
  // `secretEnvVar` occurs five times in five files; it is the pattern, not the
  // token, that is unique. This comment said "the token" until it was measured
  // the same day.) Both verdicts are unchanged today.
  // What this does NOT catch: a `secretEnvVar` inside a string or template
  // literal still counts (strings are deliberately not blanked), and nothing
  // here checks that the name the adapter declares is the name it READS.
  const registry = stripSourceComments(readFileSync(registryPath, 'utf8'), extname(registryPath).toLowerCase());
  const arr = /MOR_VERIFIERS\s*:\s*readonly\s+MoRWebhookVerifier\[\]\s*=\s*\[([^\]]*)\]/.exec(registry);
  const providers = arr ? [...new Set([...arr[1].matchAll(/([A-Za-z_$][\w$]*)Verifier/g)].map((m) => m[1]))] : [];
  for (const p of providers) {
    const adapter = join(ROOT, `services/platform/src/lib/mor/${p}.ts`);
    if (!existsSync(adapter)) continue;
    const m = /secretEnvVar\s*:\s*'([A-Z][A-Z0-9_]*)'/.exec(stripSourceComments(readFileSync(adapter, 'utf8'), extname(adapter).toLowerCase()));
    if (!m) {
      fail(`adapter services/platform/src/lib/mor/${p}.ts declares no \`secretEnvVar\`, so its destination secret is not enumerable and cannot be checked.`);
      continue;
    }
    secretVars.push(m[1]);
  }
  if (secretVars.length === 0) {
    fail(
      `COVERAGE LOST — derived ZERO money destination secrets from ${REGISTRY}. "Exactly one secret exists" over an ` +
        'empty set is a check that cannot fail.',
    );
  }
  const dupes = secretVars.filter((v, i) => secretVars.indexOf(v) !== i);
  if (dupes.length) {
    fail(`two registered rails share the destination secret ${dupes[0]}. One secret verifying two rails means either rail's key opens the other's door.`);
  }
}
for (const c of configs) {
  const cfg = parseJsonc(c.raw, c.rel);
  if (cfg === null) continue;
  for (const v of secretVars) {
    if (cfg?.vars?.[v] !== undefined) {
      fail(
        `${c.rel} declares ${v} as a committed \`vars\` entry. It is a SECRET — \`wrangler secret put\` — and this ` +
          'repository is PUBLIC. A committed destination secret lets anyone sign a notification that grants themselves Pro.',
      );
    }
  }
}

// ── LIMB 4 · the route fails closed on an absent/unknown environment ─────────
const routePath = join(ROOT, ROUTE);
if (!existsSync(routePath)) {
  fail(`COVERAGE LOST — ${ROUTE} does not exist, so limb 4 has no route to grade.`);
} else {
  const route = readFileSync(routePath, 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
    .join('\n');
  if (!/isMoneyEnvironment\s*\(/.test(route)) {
    fail(
      `${ROUTE} does not validate the environment with \`isMoneyEnvironment(...)\`. An unvalidated value is a value ` +
        'that can be anything, and the route would stamp it onto every entitlement row it writes. [5]M-12',
    );
  }
  // The refusal itself. A validation that logs and continues is not a refusal.
  if (!/money_rail_not_configured/.test(route)) {
    fail(
      `${ROUTE} has no \`money_rail_not_configured\` refusal. An absent or unrecognised MONEY_ENVIRONMENT must REFUSE: ` +
        "a default of 'live' silently honours sandbox money as real, and a default of 'sandbox' silently stops honouring " +
        'real money. Both stay green forever. [5]M-12',
    );
  }
  // 🔴 THE RESOLVER'S BODY, NOT A PATTERN ANYWHERE IN THE FILE. The first
  // version of this limb looked for `MONEY_ENVIRONMENT ?? 'live'` and was
  // MUTATION-PROVEN USELESS: changing the resolver's refusal branch from
  // `: null` to `: ('live' as MoneyEnvironment)` left `isMoneyEnvironment(`
  // present, left the (now unreachable) `money_rail_not_configured` refusal
  // present, matched no `??` fallback, and the guard printed ok over a rail that
  // silently treats every misconfigured deploy as LIVE. So the resolver is now
  // read as a unit: it must be able to answer "I cannot tell", and it must not
  // name a money world itself.
  const fn = /function\s+environmentOf\s*\([^)]*\)[^{]*\{/.exec(route);
  if (!fn) {
    fail(
      `${ROUTE} declares no \`environmentOf(...)\` resolver, so the value that stamps every entitlement row comes ` +
        'from somewhere this guard cannot read. [5]M-12',
    );
  } else {
    const open = route.indexOf('{', fn.index + fn[0].length - 1);
    let depth = 0;
    let body = '';
    for (let k = open; k < route.length; k++) {
      if (route[k] === '{') depth++;
      else if (route[k] === '}') { depth--; if (depth === 0) { body = route.slice(open, k + 1); break; } }
    }
    if (!/\bnull\b/.test(body)) {
      fail(
        `${ROUTE}'s \`environmentOf\` never returns null, so it cannot say "I cannot tell" and the route's 503 branch ` +
          'is unreachable. A resolver that always answers is a default wearing a validator\'s clothes. [5]M-12',
      );
    }
    const literal = /['"](?:live|sandbox)['"]/.exec(body);
    if (literal) {
      fail(
        `${ROUTE}'s \`environmentOf\` names a money world itself (${literal[0]}). The DEPLOY declares the environment; ` +
          "a literal in the resolver is a default, and there is no safe default — 'live' honours sandbox money as real " +
          "and 'sandbox' stops honouring real money, both silently. [5]M-12",
      );
    }
  }
}

// ── LIMB 5 · the fail-closed behaviour is EXERCISED, not just written ────────
// A structural check can say the branch exists; only a test can say it fires.
// The two together are what make limb 4 more than a shape. PER MONEY-DOOR
// WORKER: each service in the door set proves its own 503 with its own tests —
// platform's suite firing says nothing about subly-api's door.
for (const svc of doorServices) {
  const testDir = join(ROOT, 'services', svc, 'test');
  const files = existsSync(testDir) ? listDir(testDir).filter((f) => f.endsWith('.test.ts')) : [];
  if (files.length === 0) {
    fail(`COVERAGE LOST — no test files under services/${svc}/test, so nothing exercises that money door's fail-closed branch.`);
    continue;
  }
  const blocks = [];
  for (const f of files) {
    // ⚠️ READ COMMENT-STRIPPED, and the two matches below fail in OPPOSITE
    // DIRECTIONS, so they are worth naming separately.
    //
    //   · THE describe.skip TEST, on raw source, drops an ENTIRE FILE from the
    //     scan when a COMMENT merely mentions `describe.skip(` — "do not turn
    //     this into describe.skip(...)" in a review note is enough. Fewer blocks
    //     means `proven` can go FALSE over a suite that does fire its 503. That
    //     is the FALSE RED direction: noisy, but it fails loudly and someone
    //     looks. (It needs the literal paren; prose writing `describe.skip`
    //     without one does not drop the file.)
    //
    //   · THE it|test ENUMERATOR, on raw source, picks up prose and INFLATES the
    //     block count. A comment carrying `503`, `environment` and `expect(`
    //     together would satisfy `proven` on its own — the guard would declare a
    //     money door's fail-closed branch EXERCISED on the strength of a
    //     sentence describing it. That is the FALSE GREEN direction, and it is
    //     the one that matters: this limb exists precisely because the MC7
    //     mutation run found a branch that was written and never fired, and a
    //     comment is the purest form of written-and-never-fired.
    //
    // LATENT, NOT LIVE — measured 2026-08-21 against this tree. Blocks
    // enumerated: services/platform 413 raw vs 412 stripped, services/subly-api
    // 210 vs 209. The two raw-only blocks are prose, both of them:
    // services/platform/test/insights-equivalence.test.ts:490 (a doc comment
    // quoting `.test(JSON.stringify(rows))`) and
    // services/subly-api/test/webhooks.test.ts:94 (a doc comment reading "null
    // OMITS it (a clock-less event)" — `it(` inside English). Neither is a
    // proving block: `proven` resolves to 8 real blocks on platform and 2 on
    // subly-api, IDENTICAL set-for-set raw and stripped, so THE VERDICT DOES NOT
    // MOVE TODAY. `describe.skip`/`.todo` occurs ZERO times across all 36 test
    // files in either view, so that half of the hazard is fully latent — no file
    // is dropped today by either reading.
    //
    // WHAT THIS DOES NOT CATCH: string literals pass through VERBATIM by design,
    // so a test whose 503/environment/expect( co-occurrence sits inside a
    // template literal still counts as proof; and a block that CONTAINS the
    // three tokens is still not the same thing as a block that ASSERTS on them.
    const src = stripSourceComments(readFileSync(join(testDir, f), 'utf8'), extname(f).toLowerCase());
    // ⚠️ A SKIPPED TEST IS TEXT, NOT EVIDENCE. Mutation-proven 2026-08-01:
    // changing the [5]M-12 suite to `describe.skip` left every assertion
    // readable and none of them running, and this limb said ok.
    if (/\bdescribe\s*\.\s*(?:skip|todo)\s*\(/.test(src)) continue;
    for (const m of src.matchAll(/\b(?:it|test)(?!\s*\.\s*(?:skip|todo))\s*\(/g)) {
      const open = src.indexOf('(', m.index);
      let depth = 0;
      for (let k = open; k < src.length; k++) {
        if (src[k] === '(') depth++;
        else if (src[k] === ')') { depth--; if (depth === 0) { blocks.push(src.slice(open, k + 1)); break; } }
      }
    }
  }
  const proven = blocks.some((b) => /\b503\b/.test(b) && /environment/i.test(b) && /\bexpect\s*\(/.test(b));
  if (!proven) {
    fail(
      'NO SINGLE test block asserts that an absent or unrecognised money environment yields 503 ' +
        `under services/${svc}/test. [5]M-12: the branch can be written and unreachable — that is exactly what ` +
        'the mutation run found — so it has to be fired, not merely present.',
    );
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ money config — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [5]M-12 Sandbox money can never grant a production unlock. Enforced at the CONFIG layer,');
  console.error('  because the original criterion asked for an input that cannot be constructed.');
  process.exit(1);
}

console.log(
  `ok  money config — ${configs.length} deployed config(s) scanned; MONEY_ENVIRONMENT declared by exactly the ` +
    `${doorServices.length} money-door Worker(s) {${doorServices.join(', ')}} and every value is "live"; no sandbox ` +
    `credential or host in any deployed config; ${secretVars.length} destination secret(s) derived from the adapter ` +
    `registry, none committed; each door refuses an undeclared environment and its own tests fire the 503`,
);
