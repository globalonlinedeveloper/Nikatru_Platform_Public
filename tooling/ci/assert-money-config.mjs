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
// FOUR LIMBS, each with a CONSTRUCTIBLE failing input:
//   1 EXACTLY ONE money environment is declared in the deployed config, and it
//     is `live`. A sandbox value there is the whole defect, in one line.
//   2 NO sandbox-shaped credential or base URL appears in ANY deployed config.
//   3 EXACTLY ONE destination secret per registered rail, and NONE of them is a
//     committed var. The set comes from the adapter registry, so a second rail
//     is inside this limb the day it is registered.
//   4 THE ROUTE FAILS CLOSED on an absent or unrecognised environment. A default
//     in either direction is a silent catastrophe: 'live' honours sandbox money
//     as real, 'sandbox' stops honouring real money, and both stay green.
//
// Usage:  node tooling/ci/assert-money-config.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

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

// ── LIMB 1 · exactly one money environment, and it is `live` ─────────────────
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
    'NO deployed config declares MONEY_ENVIRONMENT. The money route refuses to serve without it (503), so the rail ' +
      'would be dead in production — and neither the notification payload nor the destination secret can supply the ' +
      'value, because no primary source establishes either. [5]M-12',
  );
} else if (declaringEnvironment.length > 1) {
  fail(
    `${declaringEnvironment.length} deployed configs declare MONEY_ENVIRONMENT (${declaringEnvironment.map((d) => d.rel).join(', ')}). ` +
      'Exactly one Worker owns the money rail ([ADR 020]:18); a second declaration is a second rail nobody decided to run.',
  );
}

// ── LIMB 2 · no sandbox shape anywhere in a deployed config ─────────────────
for (const c of configs) {
  // Comments are stripped: the config's own prose explains what a sandbox value
  // would be, and a scanner that reads prose grades the explanation.
  const code = c.raw.replace(/^\s*\/\/.*$/gm, '');
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
  const registry = readFileSync(registryPath, 'utf8');
  const arr = /MOR_VERIFIERS\s*:\s*readonly\s+MoRWebhookVerifier\[\]\s*=\s*\[([^\]]*)\]/.exec(registry);
  const providers = arr ? [...new Set([...arr[1].matchAll(/([A-Za-z_$][\w$]*)Verifier/g)].map((m) => m[1]))] : [];
  for (const p of providers) {
    const adapter = join(ROOT, `services/platform/src/lib/mor/${p}.ts`);
    if (!existsSync(adapter)) continue;
    const m = /secretEnvVar\s*:\s*'([A-Z][A-Z0-9_]*)'/.exec(readFileSync(adapter, 'utf8'));
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
// The two together are what make limb 4 more than a shape.
{
  const testDir = join(ROOT, 'services', 'platform', 'test');
  const files = existsSync(testDir) ? listDir(testDir).filter((f) => f.endsWith('.test.ts')) : [];
  if (files.length === 0) {
    fail('COVERAGE LOST — no test files under services/platform/test, so nothing exercises the money rail\'s fail-closed branch.');
  } else {
    const blocks = [];
    for (const f of files) {
      const src = readFileSync(join(testDir, f), 'utf8');
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
        'NO SINGLE test block asserts that an absent or unrecognised money environment yields 503. [5]M-12: the branch ' +
          'can be written and unreachable — that is exactly what the mutation run found — so it has to be fired, not ' +
          'merely present.',
      );
    }
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
  `ok  money config — ${configs.length} deployed config(s) scanned; MONEY_ENVIRONMENT declared exactly once and is ` +
    `"live"; no sandbox credential or host in any deployed config; ${secretVars.length} destination secret(s) derived ` +
    `from the adapter registry, none committed; the route refuses an undeclared environment`,
);
