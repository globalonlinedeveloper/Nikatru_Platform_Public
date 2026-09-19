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
// ⏱ CORRECTED 2026-09-03 — THE PARAGRAPH ABOVE IS LEFT AS WRITTEN AND ITS
// ARITHMETIC IS NOW DEAD. The account is on Workers Paid, where the ceiling is
// 50,000 databases and 10 GB per database, so "at most nine apps" describes a
// constraint that expired. Three further measurements retire the capacity
// argument completely rather than merely raising its numbers:
//
//   1. The D1 included allowance is PER ACCOUNT, not per database. Cloudflare's
//      pricing footnote 7: storage "is based on the sum of all databases in your
//      account". So splitting buys NO headroom and changes NO bill. The only
//      thing a split relieves is the PER-DATABASE cap — and platform_db is
//      282 kB against 10 GB.
//   2. Deleted rows DO return space. Gate R4-04, measured 2026-09-03: a probe D1
//      went to 9,150,464 bytes on 20,000 rows and a plain DELETE returned it to
//      16,384 — no VACUUM, no wait. A retention sweep bounds the ceiling, so it
//      is not a high-water mark.
//   3. Splitting does not break the bundle read either: every app Worker binds
//      PLATFORM_DB as a SECOND binding and reads entitlements there, so
//      [ADR 057]'s union stays inside one database however many app databases
//      exist.
//
// 🔴 THE DEFAULT IS STILL CLIENT-ONLY, AND THIS GUARD STILL EARNS ITS KEEP —
// but for the reasons below, not the ceiling above. State them correctly,
// because a guard defended by a dead argument is one somebody deletes:
//   · BLAST RADIUS. One bad migration in a shared database is a portfolio
//     outage. [ADR 020] rejected the app_id-discriminator design on exactly this.
//   · MIGRATION COST. `wrangler d1 migrations apply` takes ONE database. N
//     databases is a loop with no cross-database transactionality — succeeding
//     on four and failing on the fifth is a split brain with no rollback — and
//     INV-419, which would catch the drift, has no enforcer at all.
//   · YAGNI. An app that does not store user rows server-side should not own a
//     database, a migration set and an erasure route it never needed.
//
// Full evidence: Private/pre-minimal-2026-09-08:research/80-DATABASE-LAYOUT-PER-APP-VS-SHARED.md.
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
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { extname, join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { stripDartComments } from './dart-source.mjs';

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const clientApp = argOf('--client');
const backendApp = argOf('--backend');

const problems = [];
const fail = (msg) => problems.push(msg); const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`); // exit 2 only if EVERY problem is one (summary below)
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
  for (const entry of listDir(dir)) {
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
    coverageLost(
      `the dependency parse of apps/${appId}/pubspec.yaml found ${deps.length} entry(ies) ` +
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

/**
 * What `_phApiBase` is ASSIGNED in a stamped app_config.dart, read from the
 * file's CODE: comments are blanked first by dart-source.mjs (the one reading
 * of which bytes of a .dart file are code), and the string literal may sit on
 * the line after the `=`.
 *
 * ⏱ 2026-09-19. Until today this read "the first LINE containing `_phApiBase`
 * and `=`", and that line could be a comment. apps/subscriptiontracker's
 * app_config.dart carries a sentinel note whose prose reads
 * "[isApiConfigured] is `apiBaseUrl != _phApiBase`" above the declaration,
 * and the declaration puts its literal on the NEXT line. So
 * `--backend subscriptiontracker` graded a sentence of prose and failed on it.
 * CI never saw it: CI runs only against the stamped probes, whose template
 * declares on one line with no comment above.
 *
 * @returns {{ found: 'none' } | { found: 'many', count: number }
 *   | { found: 'one', value: string | null, text: string }}
 *   `value` is null when the assignment is not a plain string literal.
 */
function apiBaseAssignment(appId) {
  const cfg = join('apps', appId, 'lib', 'core', 'app_config.dart');
  if (!existsSync(cfg)) return { found: 'none' };
  const code = stripDartComments(readFileSync(cfg, 'utf8'));
  // `=` not followed by `=` is an assignment. `!= _phApiBase` and
  // `== _phApiBase` put the name AFTER the operator, so they never match.
  const hits = [...code.matchAll(/\b_phApiBase\s*=(?!=)\s*/g)];
  if (hits.length === 0) return { found: 'none' };
  if (hits.length > 1) return { found: 'many', count: hits.length };
  const at = hits[0].index + hits[0][0].length;
  const lit = /^(['"])([^'"\n]*)\1/.exec(code.slice(at));
  const text = code
    .slice(hits[0].index, at + (lit ? lit[0].length : 40))
    .replace(/\s+/g, ' ')
    .trim();
  return { found: 'one', value: lit ? lit[2] : null, text };
}

/** The hostname of an assigned URL, or null. CodeQL #11: "the host name
 *  appears on the line" was also satisfied by a trailing comment, and by a
 *  lookalike such as platform.nikatru.com.evil.test. */
function hostOf(value) {
  if (value === null) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/** The failure for an assignment that cannot be graded at all, or null. */
function ungradable(appId, a) {
  if (a.found === 'none') return `apps/${appId}/lib/core/app_config.dart missing or has no _phApiBase assignment in code`;
  if (a.found === 'many') return `apps/${appId}/lib/core/app_config.dart assigns _phApiBase ${a.count} times in code; one declaration is the contract`;
  if (a.value === null) return `_phApiBase is not assigned a plain string literal: ${a.text}`;
  return null;
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
      coverageLost(
        `the banned-name scan read only ${scanned.length} source file(s) under ` +
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
    const a = apiBaseAssignment(clientApp);
    const bad = ungradable(clientApp, a);
    if (bad) {
      fail(bad);
    } else if (hostOf(a.value) !== 'platform.nikatru.com') {
      fail(`_phApiBase is not the shared platform Worker: ${a.text}`);
    } else if (a.value.includes(`${clientApp}-api`)) {
      fail(`_phApiBase still carries a per-app API host: ${a.text}`);
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
  // Graded on the HOST, not on "the text contains <app>-api": its first label
  // must be `<app>-api` ([ADR 080] §3). The stamp's `https://<app>-api.nikatru.com`
  // and subscriptiontracker's sentinel
  // `https://subscriptiontracker-api.YOUR_SUBDOMAIN.workers.dev` both pass; the
  // shared Worker, another app's host, and `<app>-api` in a path do not.
  const a = apiBaseAssignment(backendApp);
  const bad = ungradable(backendApp, a);
  const host = bad ? null : hostOf(a.value);
  if (bad) {
    fail(bad);
  } else if (host === 'platform.nikatru.com') {
    fail(`_phApiBase rendered the client-only branch: ${a.text}`);
  } else if (host === null || host.split('.')[0] !== `${backendApp}-api`) {
    fail(`_phApiBase is not this app's own API host: ${a.text}`);
  } else {
    ok('_phApiBase points at its own API host');
  }

  // ⏱ 2026-09-12 · A STAMPED WORKER MUST BE ABLE TO RUN A TEST. Until today
  // the template shipped no vitest, no `test` script, no vitest.config.ts and no
  // test directory, so the first thing an owner could not do with a fresh backend
  // was run its suite - and the modules that carry its whole security and
  // correctness argument (the auth core, the retry, the erasure derivation) went
  // untested in its own resolution. The chassis suite under services/_shared/test
  // is what it inherits; this limb is what makes "it can run it" a fact rather
  // than an intention. Found by the factory-vs-app drift audit,
  // research/factory-drift-2026-09-12/.
  //
  // 🔴 THE CONFIG IS PART OF IT, NOT DECORATION. Without
  // `resolve.conditions: ['workerd', ...]` the suite resolves the NODE build of
  // jose, whose JWKS fetch uses node:https while the edge uses `fetch` - a green
  // suite over a transport production never runs. And without `../_shared/test`
  // in `include`, the Worker runs none of the chassis's tests, which is most of
  // what there is to run on day one.
  const pkgRel = `services/${backendApp}-api/package.json`;
  const pkgAbs = join(...pkgRel.split('/'));
  if (!existsSync(pkgAbs)) {
    fail(`${pkgRel} is missing, so nothing says how this Worker is built or tested`);
  } else {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgAbs, 'utf8'));
    } catch (err) {
      fail(`${pkgRel} is not valid JSON (${err.message}), so its scripts could not be read`);
      pkg = null;
    }
    if (pkg) {
      if (typeof pkg.scripts?.test !== 'string' || pkg.scripts.test.trim() === '') {
        fail(`${pkgRel} declares no \`test\` script — a stamped Worker that cannot be tested ships untested`);
      } else {
        ok('the stamped Worker declares a `test` script');
      }
      const dev = pkg.devDependencies ?? {};
      if (typeof dev.vitest !== 'string') {
        fail(`${pkgRel} declares no \`vitest\` devDependency, so its \`test\` script has nothing to run`);
      } else {
        ok(`the stamped Worker depends on vitest (${dev.vitest})`);
      }
    }
  }

  const cfgRel = `services/${backendApp}-api/vitest.config.ts`;
  const cfgAbs = join(...cfgRel.split('/'));
  if (!existsSync(cfgAbs)) {
    fail(`${cfgRel} is missing — without it the suite resolves the node build of jose, not the workerd build the edge runs`);
  } else {
    const cfg = readFileSync(cfgAbs, 'utf8');
    if (!/conditions:\s*\[[^\]]*'workerd'/.test(cfg)) {
      fail(`${cfgRel} does not put 'workerd' in resolve.conditions, so the suite would test a transport production never uses`);
    } else if (!cfg.includes('_shared/test')) {
      fail(`${cfgRel} does not include ../_shared/test, so this Worker runs none of the chassis suite it re-exports`);
    } else {
      ok('vitest.config.ts resolves workerd and inherits the chassis suite');
    }
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
// at the stamp would miss a cron added to subscriptiontracker-api by hand.
const CRON_HOME = 'platform';
{
  // 🔴 A DEPLOYED WORKER IS A DIRECTORY WITH AN ENTRY POINT, NOT ANY DIRECTORY
  // UNDER services/. NARROWED 2026-09-06, and it was measured in CI rather than
  // predicted: [ADR 067] decision 2 added `services/_shared/`, the ONE HOME of
  // the modules both Workers and the brick's Worker template used to carry three
  // times. It is inlined into its carriers' bundles by esbuild (proven by
  // `wrangler deploy --dry-run --outdir`, whose sourcemaps name
  // `services/_shared/src/health.ts` for both) and is deployed by nothing, so it
  // has no `wrangler.jsonc` and never will. This limb reported
  //
  //   ✗ COVERAGE LOST — services/_shared/wrangler.jsonc — the directory exists
  //     but carries no wrangler.jsonc.
  //
  // …which is the limb WORKING: it refused rather than passing over a directory
  // it could not read. What it needed was the new layout, in the same change.
  //
  // The relationship is unchanged in substance — every DEPLOYED Worker must
  // yield a parsed config, and a config that is renamed, moved or deleted is
  // still loud. `src/index.ts` is the same derivation
  // `.github/workflows/deploy-workers.yml`, `assert-worker-error-sink.mjs`,
  // `assert-vendor-portability.mjs` and `twinned-worker-modules.test.ts` use, so
  // the five cannot disagree about what a Worker is. The `CRON_HOME` floor two
  // limbs below is what stops the narrowing being satisfied by nothing: if the
  // filter ever stops finding `services/platform`, this limb fails.
  let dirs = null;
  try {
    dirs = listDir('services', { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => existsSync(`services/${name}/src/index.ts`))
      .sort();
  } catch {
    /* reported immediately below */
  }

  if (dirs === null || dirs.length === 0) {
    // COVERAGE ASSERTION. "No configs found → ok" is the shape this whole repo
    // keeps re-learning; a cron scan that reaches nothing reports a clean
    // portfolio.
    coverageLost(
      'the cron scan found no service directories under services/. ' +
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
      coverageLost(`${u}. The cron limb did not examine it, so its result is unknown, not clean.`);
    }
    if (!parsed.includes(CRON_HOME)) {
      coverageLost(
        `the cron scan never read services/${CRON_HOME}/wrangler.jsonc, which is the ` +
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

if (problems.length) {
  console.error('\nCLONE CONTRACT VIOLATED:');
  for (const f of problems) console.error(`  ✗ ${f}`);
  console.error('\nSee Private/decisions/020-brick-clone-contract.md.');
  process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1); // 2 = could not look (every problem is COVERAGE LOST); 1 = a finding
}
console.log('clone contract holds.');
