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
    for (const file of walk(appDir)) {
      const text = readFileSync(file, 'utf8');
      for (const needle of banned) {
        if (text.includes(needle)) hits.push(`${file} mentions "${needle}"`);
      }
    }
    if (hits.length) hits.forEach(fail);
    else ok('no per-app D1/bucket name appears in client source');

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
