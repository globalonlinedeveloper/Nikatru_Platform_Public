#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// provision-backend.mjs — take a freshly stamped backend app from placeholder to
// deployable, in one command, with no hand-editing.
//
// [pipeline S-12] company/pipeline/03-stamper.md — limbs 2 and 3.
//
// WHAT IT REPLACES. The stamp's own checklist used to say: run
// `wrangler d1 create <id>_db --location apac`, PASTE the returned uuid into
// services/<id>-api/wrangler.jsonc, then cd there and run the migration. Three
// manual steps, one of them a copy-paste of a uuid into a specific key of a
// JSONC file — which is exactly the shape of edit that goes wrong silently. The
// charter word is "zero manual edits"; this is that applied to the rare variant.
//
// ── WHY --location apac AND NOT A JURISDICTION ──────────────────────────────
// `[3]S-12`'s research note said the script "must choose jurisdiction explicitly
// rather than rely on a hint whose permanence nobody can confirm". Checked
// against the vendor 2026-07-29 and that advice does not apply to this business:
//   · D1 JURISDICTIONS exist for data-locality LAW — the supported set is `eu`
//     and `fedramp`. There is no APAC jurisdiction, and setting `eu` would pin an
//     India-served portfolio's data inside the EU. Wrong tool.
//   · D1 LOCATION HINTS are wnam/enam/weur/eeur/apac/oc (NOT sam/afr/me, where
//     D1 does not run at all). `apac` is the correct and only expression of
//     "near our users".
// The hint is also load-bearing rather than cosmetic: D1's default places the
// primary instance near WHOEVER ISSUED THE CREATE CALL, so provisioning from a
// US CI runner would silently land the database in North America. Naming apac
// makes placement a property of the spec instead of a property of who ran it.
//
// ── WHAT "DONE" MEANS HERE, AND WHY A DRY RUN IS NOT IT ─────────────────────
// S-12's original criterion asked for `wrangler deploy --dry-run` to pass. It
// passes on the all-zeros placeholder, because a dry run never contacts D1 — so
// the criterion was green on the exact defect it was written to catch. The three
// things proved instead are all things a placeholder cannot fake:
//   1. no committed config carries the placeholder  (assert-d1-bindings.mjs, CI)
//   2. `wrangler d1 info <app_id>_db` returns the uuid now in the config
//   3. the starter migration has been APPLIED to that database
//
// Usage:
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
//     node tooling/scripts/provision-backend.mjs <app_id> [--location apac] [--dry]
//
// Credentials are read from the ENVIRONMENT only; this script never opens
// `.claude/secrets.env` itself.
//
// ⚠️ DO NOT `source` THAT FILE. It is named like an env file but is not one — it
// carries free-form notes alongside the KEY=VALUE lines, so `. .claude/secrets.env`
// tries to EXECUTE them and spills unrelated credentials into terminal output
// (observed 2026-07-29). Extract only what you need:
//
//   export CLOUDFLARE_API_TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' .claude/secrets.env | cut -d= -f2-)
//   export CLOUDFLARE_ACCOUNT_ID=$(grep -m1 '^CLOUDFLARE_ACCOUNT_ID=' .claude/secrets.env | cut -d= -f2-)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_HINTS = ['wnam', 'enam', 'weur', 'eeur', 'apac', 'oc'];

const args = process.argv.slice(2);
const appId = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry');
const locIdx = args.indexOf('--location');
const location = locIdx > -1 ? args[locIdx + 1] : 'apac';

function die(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

if (!appId || !/^[a-z][a-z0-9_]*$/.test(appId)) {
  die(['usage: provision-backend.mjs <app_id> [--location apac] [--dry]', '  app_id must be snake_case.']);
}
if (!VALID_HINTS.includes(location)) {
  die([
    `✗ "${location}" is not a D1 location hint. Supported: ${VALID_HINTS.join(', ')}.`,
    '  D1 does not run in sam/afr/me at all, so those are not slow — they are impossible.',
  ]);
}

const ROOT = resolve(process.cwd());
const svcDir = join(ROOT, 'services', `${appId}-api`);
const cfgPath = join(svcDir, 'wrangler.jsonc');
const dbName = `${appId}_db`;

if (!existsSync(cfgPath)) {
  die([
    `✗ no stamped backend at ${cfgPath}.`,
    '  This provisions an app the brick already stamped with needs_backend=true; it does not stamp one.',
  ]);
}

for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[k]) {
    die([
      `✗ ${k} is not set.`,
      "  Locally:  export CLOUDFLARE_API_TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' .claude/secrets.env | cut -d= -f2-)",
      '  (do NOT `source` that file — see the header)',
      '  This is the owner-held input S-12 always said would remain; everything else is automated.',
    ]);
  }
}

/** Run a command, returning {code, out}.
 *
 * 🔴 NO `shell: true`. On Windows that was the obvious way to make `npx`
 * resolvable, and it re-parses every argument — so the verification query
 * `SELECT name FROM sqlite_master WHERE type='table'` arrived at wrangler
 * mangled and the command failed. Resolving the `.cmd` shim directly passes
 * arguments verbatim, which is what a SQL string needs. */
function sh(cmd, cmdArgs, cwd = ROOT) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', env: process.env });
  // A process that never STARTED must not look like one that ran and failed.
  if (r.error) return { code: 127, out: `could not run ${cmd}: ${r.error.message}` };
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// 🔴 THE SERVICE'S OWN PINNED WRANGLER, resolved to an absolute path — not
// `npx wrangler@4`, and never through a shell.
//   · npx would resolve a version independent of the one the template pins
//     (`wrangler: ^4.0.0`), so the tool that provisions could differ from the
//     tool that deploys. [pipeline F-2] is the same lesson about mason_cli.
//   · spawning through a shell on Windows re-parses every argument, which
//     mangled the verification query `... WHERE type='table'` and made the
//     command fail; the script then read the empty output as "the table is
//     missing" and reported a perfectly migrated database as unproven.
//   · and `npx` without a shell simply does not resolve on Windows.
// Installing first is therefore step 1, not a lazy step inside the migration.
function ensureInstalled() {
  // 🔴 THE JS ENTRY POINT, NOT THE .bin SHIM. Node refuses to spawn a Windows
  // `.cmd` without `shell: true` (the CVE-2024-27980 fix) — it fails EINVAL —
  // and `shell: true` re-parses arguments, which mangles the SQL this script
  // has to send. Running `node .../wrangler/bin/wrangler.js` sidesteps both:
  // no shim, no shell, arguments verbatim, and identical on every platform.
  const local = join(svcDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (existsSync(local)) return local;
  console.log('    node_modules missing → npm install (this is the only network wait)');
  // npm is itself a .cmd on Windows, so this one call does need a shell — it
  // takes no argument that a shell could mangle.
  const inst = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: svcDir, encoding: 'utf8', env: process.env, shell: process.platform === 'win32',
  });
  if (inst.status !== 0) die(['✗ npm install failed:', `${inst.stdout ?? ''}${inst.stderr ?? ''}`]);
  const instOk = { code: 0, out: '' };
  void instOk;
  if (!existsSync(local)) die([`✗ npm install succeeded but ${local} is still absent.`]);
  return local;
}

// ── 1. the toolchain, then the config ───────────────────────────────────────
step(1, `Resolving the service's own wrangler, then reading ${cfgPath}`);
const WRANGLER = ensureInstalled();
const wrangler = (a, cwd = svcDir) => sh(process.execPath, [WRANGLER, ...a], cwd);
console.log(`    wrangler: ${WRANGLER}`);
let cfgText = readFileSync(cfgPath, 'utf8');
const appDbBlock = /("binding"\s*:\s*"APP_DB"[\s\S]{0,400}?"database_id"\s*:\s*")([^"]+)(")/;
const m = cfgText.match(appDbBlock);
if (!m) {
  die([
    '✗ could not find the APP_DB binding\'s `database_id` in the config.',
    '  The patch is scoped to APP_DB deliberately — PLATFORM_DB is shared and must never be rewritten.',
  ]);
}
const current = m[2];
console.log(`    APP_DB.database_id is currently: ${current}`);
if (current !== PLACEHOLDER && UUID.test(current)) {
  console.log(`    Already provisioned. Verifying rather than re-creating.`);
}

// ── 2. create the database (idempotent) ──────────────────────────────────────
step(2, `Ensuring D1 database "${dbName}" exists (--location ${location})`);
let uuid = null;
const info = wrangler(['d1', 'info', dbName, '--json']);
if (info.code === 0) {
  try {
    uuid = JSON.parse(info.out.slice(info.out.indexOf('{'))).uuid ?? null;
  } catch { /* fall through to create */ }
}
if (uuid) {
  console.log(`    exists already → ${uuid}`);
} else if (dry) {
  console.log(`    [--dry] would run: wrangler d1 create ${dbName} --location ${location}`);
} else {
  const created = wrangler(['d1', 'create', dbName, '--location', location]);
  if (created.code !== 0) die([`✗ d1 create failed:`, created.out]);
  const found = created.out.match(UUID.source.replace(/^\^|\$$/g, ''));
  uuid = found ? found[0] : null;
  if (!uuid) {
    const again = wrangler(['d1', 'info', dbName, '--json']);
    try {
      uuid = JSON.parse(again.out.slice(again.out.indexOf('{'))).uuid ?? null;
    } catch { /* handled below */ }
  }
  if (!uuid) die(['✗ created the database but could not read its uuid back.', created.out]);
  console.log(`    created → ${uuid}`);
}

if (dry) {
  console.log('\n[--dry] stopping before any write. Nothing was created, patched or migrated.');
  process.exit(0);
}

// ── 3. patch the config — APP_DB only ────────────────────────────────────────
step(3, `Patching APP_DB.database_id in wrangler.jsonc`);
if (current === uuid) {
  console.log('    already correct; left unchanged (idempotent).');
} else {
  cfgText = cfgText.replace(appDbBlock, `$1${uuid}$3`);
  writeFileSync(cfgPath, cfgText);
  console.log(`    ${current} → ${uuid}`);
}

// ── 4. apply the starter migration ───────────────────────────────────────────
step(4, `Applying migrations (wrangler d1 migrations apply APP_DB --remote)`);
const mig = wrangler(['d1', 'migrations', 'apply', 'APP_DB', '--remote'], svcDir);
if (mig.code !== 0) die(['✗ migrations apply failed:', mig.out]);
console.log('    applied.');

// ── 5. PROVE it, because a dry run would not have ────────────────────────────
step(5, 'Verifying against the live database');
const infoAfter = wrangler(['d1', 'info', dbName, '--json']);
let liveUuid = null;
try {
  liveUuid = JSON.parse(infoAfter.out.slice(infoAfter.out.indexOf('{'))).uuid ?? null;
} catch { /* reported below */ }

const tables = wrangler([
  'd1', 'execute', dbName, '--remote', '--json',
  '--command', "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
]);

const problems = [];
// 🔴 THE EXIT CODE IS CHECKED BEFORE THE OUTPUT IS READ. Without this, a query
// that never ran reads as "the table is missing" — the script told me the
// migration had not landed on a database where it demonstrably had, because the
// command itself had failed. An error reported as a specific finding is worse
// than an error reported as an error.
if (tables.code !== 0) {
  die(['', '✗ could not verify: the table query itself failed to run.', tables.out]);
}
if (liveUuid !== uuid) problems.push(`d1 info returned ${liveUuid}, config holds ${uuid}`);
if (readFileSync(cfgPath, 'utf8').includes(PLACEHOLDER)) {
  problems.push('the config still contains the all-zeros placeholder somewhere');
}
if (!/d1_migrations/.test(tables.out)) {
  problems.push('no `d1_migrations` table — the migration did not land');
}

if (problems.length) {
  die(['', '✗ PROVISIONED BUT NOT PROVEN:', ...problems.map((p) => `    ${p}`)]);
}

console.log(`    d1 info      → ${liveUuid}  (matches the config)`);
console.log(`    tables       → ${(tables.out.match(/"name":\s*"([a-z_]+)"/g) ?? []).length} present, including d1_migrations`);
console.log(`\n✅ ${appId}: provisioned, patched and migrated. Zero manual edits.`);
console.log(`   Run log above is S-12 limbs 2 and 3; limb 1 is enforced in CI by assert-d1-bindings.mjs.`);
