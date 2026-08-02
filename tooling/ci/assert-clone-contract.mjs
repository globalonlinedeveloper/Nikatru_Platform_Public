#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-clone-contract.mjs — prove what a stamped app is ALLOWED to own.
//
// [ADR 020] The brick's default stamp is CLIENT-ONLY. That is not a style
// preference: D1 Free allows 10 databases per ACCOUNT (5 GB total), one of
// which is platform_db, so a per-app database is affordable for at most nine
// apps. A default stamp that quietly regains a Worker, a D1 or an R2 bucket is
// how the portfolio walks back into that ceiling — silently, and only visibly
// at app #10, when unwinding it means N migrations and N wrangler
// reconfigurations.
//
// Checks are STRUCTURAL, never textual. An earlier version of this grepped for
// the string "r2_buckets" and matched the comment in the template explaining
// why there is no r2_buckets — the same comment-vs-code confusion the migration
// guard strips out. Parse the config; do not pattern-match prose.
//
// Usage:
//   node tooling/ci/assert-clone-contract.mjs --client probe --backend probeapi
//   node tooling/ci/assert-clone-contract.mjs --client probe          # phase 1
// Exit 0 = contract holds, 1 = violated.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { extname, join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const clientApp = argOf('--client');
const backendApp = argOf('--backend');

const failures = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`  ok  ${msg}`);

/** Strip // and block comments from JSONC, drop trailing commas, then parse.
 *  Trailing commas are legal in wrangler's JSONC and hard-failing on one would
 *  teach people to distrust this guard. Throws on genuinely malformed input —
 *  itself worth catching, since an unparseable stamped wrangler.jsonc would
 *  otherwise only surface inside a deploy. */
function parseJsonc(path) {
  const raw = readFileSync(path, 'utf8');
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const two = raw.slice(i, i + 2);
    if (two === '//') {
      while (i < raw.length && raw[i] !== '\n') i++;
    } else if (two === '/*') {
      const end = raw.indexOf('*/', i + 2);
      i = end === -1 ? raw.length : end + 2;
    } else if (raw[i] === '"') {
      out += raw[i++];
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === '\\') out += raw[i++];
        out += raw[i++];
      }
      if (i < raw.length) out += raw[i++];
    } else {
      out += raw[i++];
    }
  }
  // A comma followed only by whitespace before a closing } or ] — safe now that
  // string literals above were copied through verbatim and are not re-scanned.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Source files only. `lstat` (not `stat`) so a dangling symlink cannot throw,
 *  and an extension filter so this stays cheap and text-safe after
 *  `flutter pub get` has populated the app directory. */
const kReadableExt = new Set(['.dart', '.yaml', '.yml', '.json', '.arb']);
/** Floor for the banned-name scan. A freshly stamped app carries far more than
 *  this (pubspec, analysis_options, l10n arb, and the whole lib/ tree), so a
 *  count below it means the walk broke rather than the app being small. */
const MIN_CLIENT_SOURCES = 5;
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '.dart_tool' || entry === 'build' || entry === 'node_modules') continue;
    const p = join(dir, entry);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue; // vanished or unreadable — not this guard's business
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) found.push(...walk(p));
    else if (kReadableExt.has(extname(p))) found.push(p);
  }
  return found;
}

// ── [pipeline 13]T-1a · NO PUSH-TOKEN DEPENDENCY IN A STAMPED APP ───────────
//
// The retention requirement is that reminders are LOCAL: scheduled by the OS on
// the device, with no token, no push service, no per-app server pushing
// anything. That premise holds today by accident — nobody has added
// `firebase_messaging` — and nothing in the repo would notice if somebody did.
//
// A push dependency is not a style choice. It drags in a vendor account, a
// server that must hold a token per install, a per-app credential in a console
// only the owner can reach, and a privacy disclosure on both stores. The right
// moment to refuse it is the one where it costs one line to refuse.
//
// The check is STRUCTURAL, per this file's own rule: the pubspec's dependency
// BLOCKS are parsed and the names compared. A doc comment in the brick's
// pubspec explaining why there is no push dependency must not trip it — that is
// the exact `r2_buckets` bug this guard's header is about.
const PUSH_PACKAGES = new Set([
  'firebase_messaging',
  'firebase_messaging_web',
  'firebase_core', // messaging's mandatory companion; present only to carry it
  'onesignal_flutter',
  'huawei_push',
  'pusher_beams',
  'flutter_apns',
  'flutter_apns_only',
  'unifiedpush',
  'web_push',
  'webpush',
]);
/** The shapes a NEW push SDK arrives under. An exact-name list only ever knows
 *  about the vendors somebody thought of; this catches the next one. A genuine
 *  false positive is resolved by naming the package and its reason here, which
 *  is a deliberate, reviewable act — not by widening the pattern. */
const PUSH_NAME_SHAPES = /(?:^|_)(?:fcm|apns|push)(?:_|$)|firebase|onesignal|airship|braze|clevertap|vapid|pushy|pushwoosh/i;

/** Dependency names declared under `dependencies:` / `dev_dependencies:`.
 *  A two-space-indented `name:` inside one of those blocks — the only shape a
 *  pubspec dependency takes. Returns [{ name, block }]. */
function pubspecDeps(path) {
  const out = [];
  let block = null;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^[a-z_]+:/i.test(line)) {
      block = /^(dependencies|dev_dependencies|dependency_overrides):/.test(line) ? line.split(':')[0] : null;
      continue;
    }
    if (!block) continue;
    const m = line.match(/^ {2}([a-z0-9_]+)\s*:/i);
    if (m) out.push({ name: m[1], block });
  }
  return out;
}

/** Assert a stamped app's dependency set carries no push rail. Shared by both
 *  stamps: a backend stamp is not licensed to push either — the ONE Worker in
 *  services/platform is not a push service, and a per-app one would be the
 *  ceiling problem this whole file is about, wearing a new hat. */
function assertNoPushDependency(appId) {
  const pubspec = join('apps', appId, 'pubspec.yaml');
  if (!existsSync(pubspec)) {
    fail(`apps/${appId}/pubspec.yaml does not exist — the push-dependency scan had nothing to read, which reports exactly like a clean stamp.`);
    return;
  }
  const deps = pubspecDeps(pubspec);
  // COVERAGE, as a RELATIONSHIP between two readings of the same file rather
  // than as a number somebody keeps. The raw text names the shared packages;
  // if the parser above stops finding them, the scan has broken while still
  // reporting "no push dependency" over an empty set.
  const raw = readFileSync(pubspec, 'utf8');
  const rawShared = [...raw.matchAll(/^ {2}(nikatru_[a-z0-9_]+)\s*:/gm)].map((m) => m[1]);
  const parsed = new Set(deps.map((d) => d.name));
  const missed = rawShared.filter((n) => !parsed.has(n));
  if (deps.length === 0 || missed.length) {
    fail(
      `COVERAGE LOST — the dependency parse of apps/${appId}/pubspec.yaml found ${deps.length} entry(ies) ` +
        `and missed ${missed.length} shared package(s) the file plainly declares (${missed.join(', ') || 'none'}). ` +
        'A stamp that declares nothing reads identically to a stamp that declares no push rail.',
    );
    return;
  }
  const banned = deps.filter((d) => PUSH_PACKAGES.has(d.name) || PUSH_NAME_SHAPES.test(d.name));
  if (banned.length) {
    for (const d of banned) {
      fail(
        `apps/${appId}/pubspec.yaml declares \`${d.name}\` under \`${d.block}\`. [13]T-1 A stamped app's ` +
          'reminders are LOCAL — scheduled by the OS on the device. A push rail needs a token per install, a ' +
          'server that stores it, a vendor console only the owner can reach and a store privacy disclosure, ' +
          'and none of that is affordable per app across a portfolio. If this package is genuinely not a push ' +
          'SDK, name it and say why in PUSH_PACKAGES\' sibling comment rather than widening the pattern.',
      );
    }
  } else {
    ok(`no push-token dependency among the ${deps.length} declared by the stamped pubspec`);
  }
}

/** The `_phApiBase = ...` line of a stamped app_config.dart, or null. */
function apiBaseLine(appId) {
  const cfg = join('apps', appId, 'lib', 'core', 'app_config.dart');
  if (!existsSync(cfg)) return null;
  return (
    readFileSync(cfg, 'utf8')
      .split('\n')
      .find((l) => l.includes('_phApiBase') && l.includes('=')) ?? null
  );
}

// ── The DEFAULT stamp: client-only ──────────────────────────────────────────
if (clientApp) {
  console.log(`default stamp "${clientApp}" — client-only:`);

  const servicePath = `services/${clientApp}-api`;
  if (existsSync(servicePath)) {
    fail(`${servicePath} exists — the backend must be OPT-IN (needs_backend=true)`);
  } else {
    ok('no Worker stamped');
  }

  const appDir = `apps/${clientApp}`;
  if (!existsSync(appDir)) {
    fail(`${appDir} was not stamped at all`);
  } else {
    // Tripwire, not a proof: if a per-app D1 or bucket name ever appears in
    // CLIENT source, the template regained a per-app resource somewhere the
    // wrangler check cannot see.
    const banned = [`${clientApp}_db`, `${clientApp}-exports`];
    const hits = [];
    const scanned = walk(appDir);
    for (const file of scanned) {
      const text = readFileSync(file, 'utf8');
      for (const needle of banned) {
        if (text.includes(needle)) hits.push(`${file} mentions "${needle}"`);
      }
    }
    // COVERAGE ASSERTION [pipeline F-10]. Until 2026-07-27 this printed "ok, no
    // per-app D1/bucket name appears" whether it had read 200 files or ZERO —
    // and zero is exactly what an extension-filter change, a renamed source
    // folder, or a skip-list typo produces. A clean scan over nothing is this
    // repo's most repeated failure, so the scan now proves it reached the tree
    // before its result is believed.
    if (scanned.length < MIN_CLIENT_SOURCES) {
      fail(
        `COVERAGE LOST — the banned-name scan read only ${scanned.length} source file(s) under ` +
          `${appDir} (expected at least ${MIN_CLIENT_SOURCES}). The scan is broken, not the tree: ` +
          'a scan that reaches nothing reports clean.',
      );
    } else if (hits.length) {
      hits.forEach(fail);
    } else {
      ok(`no per-app D1/bucket name appears in client source (${scanned.length} file(s) scanned)`);
    }

    // Assert the ACTUAL assignment, not "the string appears in the file" — a
    // doc-comment mentioning the host must not satisfy this while _phApiBase
    // silently reverted to the per-app default.
    const line = apiBaseLine(clientApp);
    if (line === null) {
      fail(`apps/${clientApp}/lib/core/app_config.dart missing or has no _phApiBase`);
    } else if (!line.includes('platform.nikatru.com')) {
      fail(`_phApiBase is not the shared platform Worker: ${line.trim()}`);
    } else if (line.includes(`api-${clientApp}`)) {
      fail(`_phApiBase still carries a per-app API host: ${line.trim()}`);
    } else {
      ok('_phApiBase points at the shared platform Worker');
    }

    assertNoPushDependency(clientApp);
  }
}

// ── The OPT-IN backend stamp ────────────────────────────────────────────────
if (backendApp) {
  console.log(`opt-in backend stamp "${backendApp}":`);

  const wranglerPath = `services/${backendApp}-api/wrangler.jsonc`;
  if (!existsSync(wranglerPath)) {
    fail(`needs_backend=true did not stamp ${wranglerPath}`);
  } else {
    let cfg;
    try {
      cfg = parseJsonc(wranglerPath);
      ok('wrangler.jsonc parses');
    } catch (e) {
      fail(`${wranglerPath} is not parseable JSONC: ${e.message}`);
    }
    if (cfg) {
      const dbs = cfg.d1_databases ?? [];
      if (!dbs.some((d) => d.database_name === `${backendApp}_db`)) {
        fail(`missing its per-app D1 binding (${backendApp}_db)`);
      } else {
        ok('has its per-app D1');
      }
      if (!dbs.some((d) => d.database_name === 'platform_db')) {
        fail('missing the SHARED platform_db binding');
      } else {
        ok('binds the shared platform_db');
      }
      // Structural, not textual — the template's comment explaining the absence
      // of r2_buckets must not itself trip this.
      if (Object.hasOwn(cfg, 'r2_buckets')) {
        fail(
          'declares r2_buckets — object storage is ONE portfolio bucket bound in ' +
            'services/platform with an <app_id>/ key prefix, never one per app',
        );
      } else {
        ok('no per-app R2 bucket');
      }
    }
  }

  // The mirror of the client-only assertion. Without this, a bug that made the
  // {{#needs_backend}} section render the WRONG branch would pass clean.
  const line = apiBaseLine(backendApp);
  if (line === null) {
    fail(`apps/${backendApp}/lib/core/app_config.dart missing or has no _phApiBase`);
  } else if (!line.includes(`api-${backendApp}`)) {
    fail(`_phApiBase is not this app's own API host: ${line.trim()}`);
  } else if (line.includes('platform.nikatru.com')) {
    fail(`_phApiBase rendered the client-only branch: ${line.trim()}`);
  } else {
    ok('_phApiBase points at its own API host');
  }

  assertNoPushDependency(backendApp);
}

// ── [pipeline S-6] NO `crons` OUTSIDE services/platform ─────────────────────
// S-6's acceptance has always read "a stamp claims only affordable cloud
// resources — AND no `crons` block outside services/platform". The first half
// was built; THIS HALF WAS NEVER WRITTEN. Until now `grep -i cron` over this
// file and its test returned zero matches, so the limb that stages 13 T-1 and
// T-10 both name as their single enforcer did not exist. Nothing was violating
// it — exactly one `crons` block exists, in services/platform — and nothing
// would have noticed if something started to.
//
// WHY IT IS STRUCTURAL, not a per-app budget: cron triggers are capped PER
// CLOUDFLARE ACCOUNT on the Free plan, not per Worker, so the ceiling is shared
// by the whole portfolio and a per-app cron does not scale to 50 apps. ⚠️ The
// specific number in `company/.../architecture.md` is a REPO-SOURCED claim that
// was NOT re-verified against the vendor when this limb was written — it is not
// restated here as a fresh fact, and the rule does not depend on its exact
// value. One nightly cron in one place scales; N do not.
//
// ⚠️ NEVER A GREP. This repo has already shipped a guard that matched the
// template comment explaining why there is no `r2_buckets` — and the platform
// config's own header contains the word "cron" in prose twice. The config is
// PARSED (comments stripped by parseJsonc above) and the check reads
// `triggers.crons` off the resulting object.
//
// It runs on every invocation rather than under --client/--backend, because it
// is a property of the whole services/ tree: the freshly stamped config is one
// subject, the committed ones are the others, and a limb that only ever looked
// at the stamp would miss a cron added to subly-api by hand.
const CRON_HOME = 'platform';
{
  let dirs = null;
  try {
    dirs = readdirSync('services', { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    /* reported immediately below */
  }

  if (dirs === null || dirs.length === 0) {
    // COVERAGE ASSERTION. "No configs found → ok" is the shape this whole repo
    // keeps re-learning; a cron scan that reaches nothing reports a clean
    // portfolio.
    fail(
      'COVERAGE LOST — the cron scan found no service directories under services/. ' +
        'A scan over an empty set proves no cron exists anywhere, which is how a guard ' +
        'reports healthy while enforcing nothing.',
    );
  } else {
    // 🔴 THE COVERAGE FLOOR IS DERIVED, NOT TYPED. Not "at least N configs" — a
    // number somebody eventually lowers — but a RELATIONSHIP between two
    // independent observations: every directory under services/ is a deployable
    // Worker, so every one of them must have yielded a parsed wrangler.jsonc. A
    // directory the scan could not read is either a real defect or this scan's
    // filename assumption having drifted, and both must be loud.
    const parsed = [];
    const unreadable = [];
    const offenders = [];
    for (const dir of dirs) {
      // Forward slashes deliberately, not join(): this path goes into the
      // FAILURE MESSAGE as well as into readFileSync, and join() would print
      // `services\x\wrangler.jsonc` on a Windows dev box and
      // `services/x/wrangler.jsonc` on the Linux runner. A guard whose message
      // changes shape by operating system cannot be matched by its own tests.
      // Node's fs accepts forward slashes on Windows, and the rest of this file
      // already builds its paths this way.
      const path = `services/${dir}/wrangler.jsonc`;
      if (!existsSync(path)) {
        unreadable.push(`${path} — the directory exists but carries no wrangler.jsonc`);
        continue;
      }
      let cfg;
      try {
        cfg = parseJsonc(path);
      } catch (e) {
        unreadable.push(`${path} — is not parseable JSONC (${e.message})`);
        continue;
      }
      parsed.push(dir);
      const crons = cfg?.triggers?.crons;
      if (Array.isArray(crons) && crons.length > 0 && dir !== CRON_HOME) {
        offenders.push(
          `services/${dir}/wrangler.jsonc declares ${crons.length} cron trigger(s) ` +
            `(${crons.map((c) => JSON.stringify(c)).join(', ')}). Cron triggers are capped per ` +
            'ACCOUNT, not per Worker, so a per-app cron spends a portfolio-wide budget and does ' +
            `not scale to 50 apps. The ONE scheduled job lives in services/${CRON_HOME}; give it ` +
            'the work rather than giving this Worker a schedule.',
        );
      }
    }

    for (const u of unreadable) {
      fail(`COVERAGE LOST — ${u}. The cron limb did not examine it, so its result is unknown, not clean.`);
    }
    if (!parsed.includes(CRON_HOME)) {
      fail(
        `COVERAGE LOST — the cron scan never read services/${CRON_HOME}/wrangler.jsonc, which is the ` +
          'one directory the rule exempts. Without it the scan is not looking at this repo\'s ' +
          'services/ tree at all, and every "no cron here" result below is about some other tree.',
      );
    }
    if (offenders.length) {
      offenders.forEach(fail);
    } else if (!unreadable.length && parsed.includes(CRON_HOME)) {
      ok(
        `no cron triggers outside services/${CRON_HOME} ` +
          `(${parsed.length} service config(s) parsed: ${parsed.join(', ')})`,
      );
    }
  }
}

if (!clientApp && !backendApp) {
  console.error('assert-clone-contract: pass --client <app> and/or --backend <app>');
  process.exit(1);
}

if (failures.length) {
  console.error('\nCLONE CONTRACT VIOLATED:');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('\nSee knowledge/decisions/020-brick-clone-contract.md.');
  process.exit(1);
}
console.log('clone contract holds.');
