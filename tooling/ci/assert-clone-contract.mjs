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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

/** Strip // and /* *​/ comments from JSONC, then parse. Throws on malformed
 *  input — which is itself worth catching: a stamped wrangler.jsonc that does
 *  not parse would only surface later, inside a deploy. */
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
  return JSON.parse(out);
}

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '.dart_tool' || entry === 'build' || entry === 'node_modules') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) found.push(...walk(p));
    else found.push(p);
  }
  return found;
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
    // A per-app D1 or bucket name appearing in CLIENT code means the template
    // regained a per-app resource somewhere the wrangler check cannot see.
    const banned = [`${clientApp}_db`, `${clientApp}-exports`];
    const hits = [];
    for (const file of walk(appDir)) {
      const text = readFileSync(file, 'utf8');
      for (const needle of banned) {
        if (text.includes(needle)) hits.push(`${file} mentions "${needle}"`);
      }
    }
    if (hits.length) hits.forEach(fail);
    else ok('no per-app D1 or R2 bucket referenced');

    const cfg = join(appDir, 'lib', 'core', 'app_config.dart');
    if (!existsSync(cfg)) {
      fail(`${cfg} missing`);
    } else if (!readFileSync(cfg, 'utf8').includes('platform.nikatru.com')) {
      fail('client-only app is not pointed at the shared platform Worker');
    } else {
      ok('points at the shared platform Worker');
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
