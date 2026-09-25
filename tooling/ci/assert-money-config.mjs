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
//     RevenueCat fan-in on services/subscriptiontracker-api gained the same world guard. The
//     rule that survives both eras: declaring without a door is a second rail
//     nobody decided to run, and a door without a declaration is a Worker that
//     503s every money read in production.)
//     ⏱ 2026-09-08 — THE SUBJECT NOW INCLUDES THE BRICK'S SERVICE TEMPLATE, in
//     both directions, and its ABSENCE of a money world is a CHECKED absence
//     rather than an unexamined one. The template ships no money door on
//     purpose; until this widening it could have grown one with no declaration
//     (every money read 503ing in production) or a declaration with no door
//     (a generator that generates a repository failing this very limb) with
//     nothing red. The full reasoning, and the measurement that disproved the
//     "just add the missing line" reading, is at the config-discovery block.
//   2 NO sandbox-shaped credential or base URL appears in ANY config, the
//     template included.
//   3 EXACTLY ONE destination secret per registered rail, and NONE of them is a
//     committed var. The set comes from the adapter registry, so a second rail
//     is inside this limb the day it is registered.
//   4 THE MoR ROUTE FAILS CLOSED on an absent or unrecognised environment. A
//     default in either direction is a silent catastrophe: 'live' honours
//     sandbox money as real, 'sandbox' stops honouring real money, both green.
//   5 EVERY DEPLOYED money-door Worker's own tests EXERCISE the 503 — a branch
//     that is written but never fired is exactly what the MC7 mutation run found.
//     (Limbs 3, 4 and 5 stay on the DEPLOYED set; the reason each does is written
//     out at the config-discovery block below, beside the widening of 1 and 2.)
//
// ⏱ 2026-09-24 · FOUR SUB-LIMBS, for wrangler ENVIRONMENTS and the secret register
// (O-RAZORPAY-CHECKOUT-ADAPTER, the India rail of [ADR 076] §10):
//   1b every `env.<name>` of a money-door config declares its OWN `vars` with
//      MONEY_ENVIRONMENT exactly `live` or `sandbox`; a door-less config's
//      environment declares none.
//   1c a SANDBOX environment binds no top-level route or custom domain, runs no
//      cron, and binds a PLATFORM_DB that is not the production database.
//   3b no destination secret is a key of any `env.<name>.vars`.
//   3c every destination secret is declared in tooling/channel-register.json
//      `ciSecretRegister.nonSigning`.
//   With no environment anywhere, 1b, 1c and 3b pass VACUOUSLY and the run says so.
//
// ── HOW THIS GUARD READS SOURCE (2026-08-21) ────────────────────────────────
// SEVEN FILE READS LIVE IN THIS GUARD AND THIS LIST IS ALL OF THEM. An
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
//   · LIMB 3c (2026-09-24) reads tooling/channel-register.json with a plain
//     `JSON.parse`: strict JSON carries no comments to strip, and a register it
//     cannot read is COVERAGE LOST, never a pass.
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
// platform and 210→209 on subscriptiontracker-api while `proven` stays at 8 and 2 — the SAME
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
const fail = (m) => problems.push(m); const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`); // exit 2 only if EVERY problem is one (summary below)

const SERVICES = join(ROOT, 'services');
const REGISTRY = 'services/platform/src/lib/mor/registry.ts';
const ROUTE = 'services/platform/src/routes/money.ts';
/** The Worker that owns the rail, and therefore the one that must declare it. */
const MONEY_WORKER = 'platform';

/**
 * Sandbox-shaped values, from primary Paddle documentation only. The list is a
 * LIST rather than three constants because the rail is provider-agnostic by
 * design ([ADR 004]'s `MoRWebhookVerifier` seam): when a SECOND adapter is
 * registered, its documented sandbox shapes are added HERE, once, and every
 * deployed config is checked against them.
 *
 * ⚠️ CORRECTED 2026-08-28. This read "`configurable` because [ADR 004] runs a
 * second rail: when a Lemon Squeezy adapter is registered…". [ADR 039] D4
 * (2026-08-09) RETIRED that clause of [ADR 004] — the parallel Lemon Squeezy
 * application was never evidenced and the product is sunsetting into Stripe — so
 * no second rail is being pursued today. WHICH successor is a queued owner
 * decision. The SHAPE of this list is unchanged; only its justification is.
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
    coverageLost(`${where} could not be parsed after stripping comments: ${err.message}. An unparseable config is scanned by nothing.`);
    return null;
  }
}

// ── the configs ──────────────────────────────────────────────────────────────
//
// ⏱ THE BRICK'S SERVICE TEMPLATE JOINED THIS SET ON 2026-09-08, AND THE REASON
// IS THE OPPOSITE OF THE ONE THAT WAS PROPOSED.
//
// A review that day read `MONEY_ENVIRONMENT` as MISSING from
// `tooling/bricks/app/__brick__/…/{{app_id}}-api/wrangler.jsonc` and called
// adding it a one-line fix, on the reasoning that a stamped backend would
// otherwise "ship payment and entitlement routes that answer 503". MEASURED, that
// premise is false in both halves and the fix would have been a REGRESSION:
//
//   · the template ships NO money door at all. Its `src/routes/` holds
//     `account.ts` and nothing else — no entitlements route, no webhook route —
//     and its own clone contract says so in the file the line would have gone
//     into: "NEVER HERE: MoR/payment webhooks. They terminate in `platform`".
//     There is no route to answer 503.
//   · adding the declaration would have made every stamped backend violate
//     LIMB 1 BELOW the moment its `services/<app>-api/` was committed — "a
//     declaration without a door is a second rail nobody decided to run" —
//     so the generator would have generated a repository that fails its own gate.
//
// WHAT WAS ACTUALLY WRONG IS THAT NOTHING CHECKED EITHER DIRECTION HERE. This
// guard's subject was `services/` alone, so the template could grow a money door
// with no declaration — every money read 503ing in production, which IS the
// failure the review feared — or grow a declaration with no door, and CI would
// have said nothing. That is the same blind spot recorded in
// tooling/platform-register.json's `bindingSources._why`: assert-clone-contract
// only ever inspects the throwaway CI probe stamp, "which is exactly how a
// per-app R2 bucket stayed live from 2026-07-17 with every guard green".
//
// So the template is IN SCOPE for limbs 1 and 2, and its ABSENCE of a money
// world is now a CHECKED absence rather than an unexamined one. Limbs 3-5 stay
// on the deployed set: limb 3 is about the adapter registry and the destination
// secrets of the live rail, limb 4 is about one file in services/platform, and
// limb 5 requires a vitest suite the brick ships no `test/` directory for —
// requiring one of a template is a different change, and limb 1's biconditional
// already refuses the state that reaches production.
const configs = [];
if (!existsSync(SERVICES)) {
  console.error('✗ COVERAGE LOST — no services/ directory. Every limb would range over nothing.');
  process.exit(2); // COVERAGE LOST: could not look, not a finding
}
for (const e of listDir(SERVICES, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  for (const f of ['wrangler.jsonc', 'wrangler.json']) {
    const p = join(SERVICES, e.name, f);
    if (existsSync(p)) {
      configs.push({
        service: e.name,
        rel: `services/${e.name}/${f}`,
        raw: readFileSync(p, 'utf8'),
        srcDir: join(SERVICES, e.name, 'src'),
        deployed: true,
      });
    }
  }
}

/** The brick's service template, found by WALKING for a wrangler config rather
 *  than by a path literal. The directory name is a mustache expression
 *  (`{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api`) and a literal
 *  would rot the day it is renamed — silently, by matching nothing, which reads
 *  as "the template is clean". Same derivation assert-platform-register.mjs uses
 *  for the same file. */
const BRICK_ROOT = join(ROOT, 'tooling', 'bricks', 'app', '__brick__');
function brickServiceConfigs() {
  const out = [];
  const walk = (dir, base) => {
    let entries;
    try {
      entries = listDir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(dir, e.name), `${base}/${e.name}`);
      else if (e.name === 'wrangler.jsonc' || e.name === 'wrangler.json') {
        out.push({
          service: base,
          rel: `${base}/${e.name}`,
          raw: readFileSync(join(dir, e.name), 'utf8'),
          srcDir: join(dir, 'src'),
          deployed: false,
        });
      }
    }
  };
  walk(BRICK_ROOT, 'tooling/bricks/app/__brick__');
  return out;
}
const templateConfigs = existsSync(BRICK_ROOT) ? brickServiceConfigs() : [];
if (templateConfigs.length === 0) {
  console.error(
    '✗ COVERAGE LOST — found ZERO wrangler configs under tooling/bricks/app/__brick__.',
    '\n  Limb 1 must range over the template every future backend is stamped from; a walk that finds',
    '\n  nothing there certifies the deployed Workers and says nothing about the generator.',
  );
  process.exit(2); // COVERAGE LOST: could not look, not a finding
}
for (const c of templateConfigs) configs.push(c);

if (configs.length === 0) {
  console.error('✗ COVERAGE LOST — found ZERO wrangler configs. The scan is broken, not the tree.');
  process.exit(2); // COVERAGE LOST: could not look, not a finding
}
/** The DEPLOYED subset — limbs 3, 4 and 5's subject, for the reasons above. */
const deployedConfigs = configs.filter((c) => c.deployed);
if (deployedConfigs.length === 0) {
  console.error('✗ COVERAGE LOST — found ZERO deployed wrangler configs. The scan is broken, not the tree.');
  process.exit(2); // COVERAGE LOST: could not look, not a finding
}
if (!configs.some((c) => c.service === MONEY_WORKER)) {
  console.error(`✗ COVERAGE LOST — no deployed config for services/${MONEY_WORKER}, the Worker that owns the money rail.`);
  console.error('  Every limb below is about that config; without it this guard grades the wrong Workers and prints ok.');
  process.exit(2); // COVERAGE LOST: could not look, not a finding
}

// ── LIMB 1 · the declaring set IS the money-door set, and every value is live ─
/** A config "has a money door" iff a file under ITS OWN src/ refuses with the
 *  `money_rail_not_configured` marker — read comment-stripped, the same idiom
 *  limb 4 uses, so the prose explaining the refusal cannot count as one.
 *
 *  ⚠️ TAKES THE DIRECTORY, NOT A SERVICE NAME. It was `join(SERVICES, service,
 *  'src')` until 2026-09-08, which is a path this guard could only build for a
 *  Worker under services/ — so widening the subject to the brick template meant
 *  the src directory had to come from the config that owns it. */
function hasMoneyDoor(srcDir) {
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

const doorConfigs = configs.filter((c) => hasMoneyDoor(c.srcDir));
const doorServices = doorConfigs.map((c) => c.service);
if (doorConfigs.filter((c) => c.deployed).length === 0) {
  // A recorded failure, not an early exit: the limbs below still run, so a tree
  // that ALSO lost its route file reports both findings rather than the first.
  // Scoped to DEPLOYED doors on purpose: the template legitimately has none, so
  // counting it here would let a tree that lost both real doors read as ok.
  coverageLost(
    'no deployed source refuses with `money_rail_not_configured`, so the money-door set is empty; ' +
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
      `${c.rel} declares MONEY_ENVIRONMENT = ${JSON.stringify(value)}. ` +
        (c.deployed
          ? 'This file is the DEPLOYED configuration, so it must be exactly "live". '
          : 'This is the template every stamped backend is generated from, so it must be exactly "live" — a stamp ' +
            'is a production deploy waiting to happen. ') +
        'A sandbox rail is a separate wrangler environment with its own secret, never ' +
        'this file with the value edited — a sandbox payment would otherwise write a production entitlement and ' +
        'nothing would go red. [5]M-12',
    );
  }
}
if (declaringEnvironment.filter((d) => d.deployed).length === 0) {
  fail(
    'NO deployed config declares MONEY_ENVIRONMENT. The money doors refuse to serve without it (503), so the rail ' +
      'would be dead in production — and neither the notification payload nor the destination secret can supply the ' +
      'value, because no primary source establishes either. [5]M-12',
  );
} else if (doorConfigs.length > 0) {
  // THE BICONDITIONAL, over EVERY config including the template: a door with no
  // declaration 503s every money read in production; a declaration with no door
  // is a second rail nobody decided to run. Both directions, both kinds of file.
  const doorRels = new Set(doorConfigs.map((c) => c.rel));
  const declaringRels = new Set(declaringEnvironment.map((d) => d.rel));
  for (const d of declaringEnvironment) {
    if (!doorRels.has(d.rel)) {
      fail(
        `${d.rel} declares MONEY_ENVIRONMENT but no file under its own src/ refuses with ` +
          '`money_rail_not_configured` — a declaration without a door is a second rail nobody decided to run ' +
          '([ADR 020]:18; the decided set is the MoR rail plus [ADR 039] D5\'s RevenueCat fan-in).' +
          (d.deployed
            ? ''
            : ' For the BRICK TEMPLATE this is not a hypothetical: the stamped `services/<app>-api/` inherits the ' +
              'declaration, and this very limb then fails on the generated repository. The template ships no money ' +
              'door on purpose — its own clone contract reads "NEVER HERE: MoR/payment webhooks. They terminate in ' +
              '`platform`" — so the correct template carries no declaration either.'),
      );
    }
  }
  for (const s of doorConfigs) {
    if (!declaringRels.has(s.rel)) {
      fail(
        `${s.rel} names a Worker that carries a money door (its source refuses with \`money_rail_not_configured\`) ` +
          'but that config declares no MONEY_ENVIRONMENT — every money read on that Worker would 503 in production, ' +
          'which is the fail-closed branch firing on every request instead of on a misconfiguration. [5]M-12' +
          (s.deployed
            ? ''
            : ' This is the BRICK TEMPLATE: every backend ever stamped from it would ship that dead rail.'),
      );
    }
  }
}

// ── LIMBS 1b + 1c · wrangler ENVIRONMENTS carry their own money world ────────
// ⏱ 2026-09-24. Limb 1 reads the TOP-LEVEL `vars` only, and a named wrangler
// environment (`env.<name>`, deployed with `--env <name>`) is a second deploy of
// the same Worker. What an environment inherits decides what can go wrong, so it
// was READ, not assumed — developers.cloudflare.com/workers/wrangler/configuration/,
// 2026-09-24: `routes`/`route`, `triggers` and `workers_dev` ARE inherited;
// `vars`, `kv_namespaces`, `r2_buckets` and `services` are NOT, and neither are
// `d1_databases`. So an environment that omits `vars` has no money world at all,
// and a sandbox environment that omits `routes` or `triggers` binds the
// production hostnames and runs the production crons — the destructive nightly
// `retentionSweep` among them — against whatever database it binds.
//
// 1b ranges over every config; 1c over the money-door configs' SANDBOX
// environments: one named `sandbox`, or one that declares the sandbox world.
// With no `env` anywhere both pass VACUOUSLY; the run prints that rather than
// claiming environment coverage.
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const parsedOnce = new Map();
/** Each config parsed ONCE for the environment limbs (limbs 1 and 3 keep their own reads). */
function parsedConfig(c) {
  if (!parsedOnce.has(c.rel)) parsedOnce.set(c.rel, parseJsonc(c.raw, c.rel));
  return parsedOnce.get(c.rel);
}
/** `[name, block]` for every named environment a parsed config declares. */
function environmentsOf(c, cfg) {
  if (cfg?.env === undefined) return [];
  if (!isObject(cfg.env)) {
    fail(`${c.rel} declares \`env\` as something other than an object, so no environment in it can be read — and an environment nobody can read is one whose money world nobody checked. [5]M-12`);
    return [];
  }
  return Object.entries(cfg.env);
}
/** The HOSTNAMES a config block binds, from `route` and `routes` (a string, or an
 *  object with a `pattern` — `custom_domain` entries included). */
function routeHosts(block) {
  const out = [];
  const add = (r) => {
    const p = typeof r === 'string' ? r : isObject(r) && typeof r.pattern === 'string' ? r.pattern : null;
    if (p !== null) out.push(p.split('/')[0].toLowerCase());
  };
  if (block?.route !== undefined) add(block.route);
  if (Array.isArray(block?.routes)) block.routes.forEach(add);
  return out;
}
const d1Of = (block) => (Array.isArray(block?.d1_databases) ? block.d1_databases.filter(isObject) : []);

const doorRelSet = new Set(doorConfigs.map((c) => c.rel));
let environmentCount = 0;
let sandboxEnvironmentCount = 0;
for (const c of configs) {
  const cfg = parsedConfig(c);
  if (cfg === null) continue;
  const hasDoor = doorRelSet.has(c.rel);
  for (const [name, e] of environmentsOf(c, cfg)) {
    environmentCount++;
    const where = `${c.rel} env.${name}`;
    // LIMB 1b
    if (!hasDoor) {
      if (e?.vars?.MONEY_ENVIRONMENT !== undefined) {
        fail(
          `${where} declares MONEY_ENVIRONMENT but no file under that config's own src/ refuses with ` +
            '`money_rail_not_configured` — a declaration without a door is a second rail nobody decided to run, in an ' +
            'environment exactly as at the top level (limb 1). [5]M-12',
        );
      }
      continue;
    }
    if (!isObject(e?.vars)) {
      fail(
        `${where} declares no \`vars\`. Wrangler does not inherit \`vars\` into an environment, so this environment ` +
          'has no MONEY_ENVIRONMENT and its money door answers 503 to every notification — and a copy of the top-level ' +
          'block would make it "live" by accident. It must declare its own world, exactly "live" or "sandbox". [5]M-12',
      );
      continue;
    }
    const world = e.vars.MONEY_ENVIRONMENT;
    if (world !== 'live' && world !== 'sandbox') {
      fail(
        `${where} declares MONEY_ENVIRONMENT = ${JSON.stringify(world)}. An environment of a money-door Worker must ` +
          'say exactly "live" or "sandbox"; the route refuses anything else, and a guard that let it through would ' +
          'certify a deploy whose every money read 503s. [5]M-12',
      );
    }
    // LIMB 1c
    if (name !== 'sandbox' && world !== 'sandbox') continue;
    sandboxEnvironmentCount++;
    const topHosts = new Set(routeHosts(cfg));
    if (e?.route === undefined && e?.routes === undefined) {
      if (topHosts.size > 0) {
        fail(
          `${where} declares no \`routes\`, so it INHERITS the top level's (${[...topHosts].join(', ')}). A sandbox ` +
            'deploy would then answer on the production hostnames, and a sandbox payment would be served as a real ' +
            'one. Declare `routes: []` (or its own hostnames). [5]M-12',
        );
      }
    } else {
      for (const h of routeHosts(e)) {
        if (topHosts.has(h)) {
          fail(`${where} binds \`${h}\`, a hostname the top level (the production deploy) already binds. A sandbox rail must never answer on a production host. [5]M-12`);
        }
      }
    }
    const crons = e?.triggers?.crons;
    if (!Array.isArray(crons) || crons.length !== 0) {
      fail(
        `${where} ${Array.isArray(crons) ? `runs ${crons.length} cron(s)` : 'declares no `triggers.crons`, so it INHERITS the top level\'s'}. ` +
          'A sandbox environment must declare `triggers: { "crons": [] }`: the production crons include the destructive ' +
          'nightly retention sweep, and a second copy of it has no business running from a sandbox. [5]M-12',
      );
    }
    const topD1 = d1Of(cfg);
    const topIds = new Set(topD1.map((d) => d.database_id).filter((id) => typeof id === 'string'));
    const topPlatformDb = topD1.find((d) => d.binding === 'PLATFORM_DB');
    const envPlatformDb = d1Of(e).find((d) => d.binding === 'PLATFORM_DB');
    if (topPlatformDb !== undefined) {
      if (envPlatformDb === undefined) {
        fail(`${where} binds no PLATFORM_DB. Wrangler does not inherit \`d1_databases\`, so the sandbox money door would have no store to record a notification in. [5]M-12`);
      } else if (typeof envPlatformDb.database_id !== 'string' || envPlatformDb.database_id.trim() === '') {
        fail(`${where} binds PLATFORM_DB with no \`database_id\`. Wrangler 4 can PROVISION a database for a binding that names none, on deploy — a resource nobody decided to create. Name the sandbox database. [5]M-12`);
      }
    }
    for (const d of d1Of(e)) {
      if (typeof d.database_id === 'string' && topIds.has(d.database_id)) {
        fail(
          `${where} binds ${d.binding} to a PRODUCTION database (${d.database_id}, bound at the top level). Sandbox ` +
            'money written there is indistinguishable from real money to every reader of that table, so a sandbox ' +
            'environment binds no production database. [5]M-12',
        );
      }
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
  coverageLost(`${REGISTRY} does not exist, so the money-secret set is empty and limb 3 asserts nothing.`);
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
    coverageLost(
      `derived ZERO money destination secrets from ${REGISTRY}. "Exactly one secret exists" over an ` +
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

// ── LIMB 3b · …nor a committed var in any wrangler ENVIRONMENT (2026-09-24) ──
// The loop above reads the top-level `vars` only, and an environment's `vars` is
// just as committed and just as public. Vacuous with no `env`, like 1b and 1c.
for (const c of configs) {
  const cfg = parsedConfig(c);
  if (cfg === null) continue;
  for (const [name, e] of environmentsOf(c, cfg)) {
    for (const v of secretVars) {
      if (isObject(e?.vars) && e.vars[v] !== undefined) {
        fail(
          `${c.rel} env.${name} declares ${v} as a committed \`vars\` entry. It is a SECRET — \`wrangler secret put ` +
            `--env ${name}\` — and this repository is PUBLIC; a sandbox destination secret committed here still lets ` +
            'anyone sign a notification that environment accepts.',
        );
      }
    }
  }
}

// ── LIMB 3c · every destination secret is DECLARED in the CI secret register ─
// ⏱ 2026-09-24 (O-RAZORPAY-CHECKOUT-ADAPTER). tooling/channel-register.json's
// `ciSecretRegister.nonSigning` is the register a workflow may name a secret from
// ([9]R-3 limb 2, assert-channel-register.mjs). A destination secret nobody
// declared is one the deploy lane FAILS on the day it lists it under `secrets:`,
// so the set derived above must be a subset of that register — checked here,
// where the set is already derived, rather than by a second scanner.
const CHANNEL_REGISTER = 'tooling/channel-register.json';
let registeredSecretCount = null;
{
  const p = join(ROOT, CHANNEL_REGISTER);
  let register = null;
  if (!existsSync(p)) {
    coverageLost(`${CHANNEL_REGISTER} does not exist, so no destination secret can be checked against \`ciSecretRegister.nonSigning\`.`);
  } else {
    try {
      register = JSON.parse(readFileSync(p, 'utf8'));
    } catch (err) {
      coverageLost(`${CHANNEL_REGISTER} could not be parsed (${err.message}), so no destination secret can be checked against it.`);
    }
  }
  if (register !== null) {
    const rows = register?.ciSecretRegister?.nonSigning;
    if (!Array.isArray(rows)) {
      coverageLost(`${CHANNEL_REGISTER} carries no \`ciSecretRegister.nonSigning\` array, so limb 3c has no register to compare against.`);
    } else {
      const declared = new Set(rows.map((r) => (typeof r?.name === 'string' ? r.name.trim() : '')).filter((n) => n !== ''));
      registeredSecretCount = declared.size;
      for (const v of secretVars) {
        if (!declared.has(v)) {
          fail(
            `${v}, a registered rail's destination secret, is not declared in ${CHANNEL_REGISTER} ` +
              '`ciSecretRegister.nonSigning`. Every secret a verifier reads is declared there with a kind and a reason, ' +
              'or the deploy lane fails the day it names it — and nothing says whether it was ever classified.',
          );
        }
      }
    }
  }
}

// ── LIMB 4 · the route fails closed on an absent/unknown environment ─────────
const routePath = join(ROOT, ROUTE);
if (!existsSync(routePath)) {
  coverageLost(`${ROUTE} does not exist, so limb 4 has no route to grade.`);
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
// platform's suite firing says nothing about subscriptiontracker-api's door.
// ⚠️ DEPLOYED DOORS ONLY. The brick's service template ships no `test/` directory
// at all, so requiring a vitest suite of it would fail on a template that is
// correct today — and an invented limit that fires on correct input is one
// somebody switches off. Limb 1's biconditional above already refuses the state
// that reaches production: a template door with no declaration is RED there.
for (const svc of doorConfigs.filter((c) => c.deployed).map((c) => c.service)) {
  const testDir = join(ROOT, 'services', svc, 'test');
  const files = existsSync(testDir) ? listDir(testDir).filter((f) => f.endsWith('.test.ts')) : [];
  if (files.length === 0) {
    coverageLost(`no test files under services/${svc}/test, so nothing exercises that money door's fail-closed branch.`);
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
    // enumerated: services/platform 413 raw vs 412 stripped, services/subscriptiontracker-api
    // 210 vs 209. The two raw-only blocks are prose, both of them:
    // services/platform/test/insights-equivalence.test.ts:490 (a doc comment
    // quoting `.test(JSON.stringify(rows))`) and
    // services/subscriptiontracker-api/test/webhooks.test.ts:94 (a doc comment reading "null
    // OMITS it (a clock-less event)" — `it(` inside English). Neither is a
    // proving block: `proven` resolves to 8 real blocks on platform and 2 on
    // subscriptiontracker-api, IDENTICAL set-for-set raw and stripped, so THE VERDICT DOES NOT
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
if (environmentCount === 0) {
  // A vacuous pass is not coverage, so it is printed and never claimed.
  console.log('⬜ no wrangler environments in any config — limbs 1b, 1c and 3b ranged over nothing and prove nothing about environments.');
}
if (problems.length) {
  console.error(`✗ money config — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [5]M-12 Sandbox money can never grant a production unlock. Enforced at the CONFIG layer,');
  console.error('  because the original criterion asked for an input that cannot be constructed.');
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1); // 2 = could not look (every problem is COVERAGE LOST); 1 = a finding
}

console.log(
  `ok  money config — ${deployedConfigs.length} deployed config(s) + ${templateConfigs.length} brick service ` +
    `template(s) scanned; MONEY_ENVIRONMENT declared by exactly the ${doorConfigs.length} money-door Worker(s) ` +
    `{${doorServices.join(', ')}} and every value is "live"; no sandbox credential or host in any of them; ` +
    `${secretVars.length} destination secret(s) derived from the adapter registry, none committed, each declared in ` +
    `${CHANNEL_REGISTER}'s ${registeredSecretCount} nonSigning row(s); ` +
    (environmentCount === 0
      ? 'no wrangler environments; '
      : `${environmentCount} wrangler environment(s), ${sandboxEnvironmentCount} sandbox, each with its own money world; `) +
    `each deployed door refuses an undeclared environment and its own tests fire the 503`,
);
