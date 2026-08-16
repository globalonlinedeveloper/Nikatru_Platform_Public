#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// provision-backend.mjs — take a freshly stamped backend app from placeholder to
// deployable, in one command, with no hand-editing.
//
// [pipeline S-12] Private/requirements/ (was pipeline/03-stamper.md, folded into
// that JSON spec 2026-08-15) — limbs 2 and 3.
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
// ⚠️ EXTRACT THE ONE KEY YOU NEED; DO NOT `source` THE WHOLE FILE.
//
// This warning used to say the file "is not a pure env file" and that sourcing it
// EXECUTES free-form notes. That WAS true and it was not theoretical — on
// 2026-07-29 sourcing it spilled unrelated credentials into terminal output. It is
// no longer true: the vault was restructured on 2026-08-10 into pure `KEY=VALUE`
// plus `#` comments, and `set -a; . .claude/secrets.env` now exits 0 and sets 40
// variables. The incident is kept because it is the REASON for the idiom below,
// not because the defect is still there — a warning that asserts a fixed defect
// gets disbelieved, and then so does the advice attached to it.
//
// The idiom stands on least exposure alone: this script needs two values, and
// sourcing puts all forty into the environment of everything it then spawns.
//
//   export CLOUDFLARE_API_TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' .claude/secrets.env | cut -d= -f2-)
//   export CLOUDFLARE_ACCOUNT_ID=$(grep -m1 '^CLOUDFLARE_ACCOUNT_ID=' .claude/secrets.env | cut -d= -f2-)
//
// 🔴 AND STRIP THE QUOTES. The values are quoted, so a bare `cut -d= -f2-` yields
// `"…"` and sends `Bearer "…"`, which Cloudflare answers 400 code 6111 — a reply
// that reads exactly like a revoked token and cost two sessions on that wrong
// conclusion. Append `| sed -e "s/^['\\"]//" -e "s/['\\"]$//"`. Verified against
// the live API on 2026-08-10 after the restructure: /user/tokens/verify → 200,
// success true, status active.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_HINTS = ['wnam', 'enam', 'weur', 'eeur', 'apac', 'oc'];

/** 🔴 THE CONFIG SURGERY, HOISTED TO A CONSTANT SO ONE THING IS TESTED.
 *
 *  This regex is the riskiest line in the script: it rewrites a uuid inside a
 *  JSONC file, and its scoping — `"binding": "APP_DB"` first, then the NEXT
 *  `database_id` within 400 characters — is the only reason PLATFORM_DB (shared
 *  by the whole portfolio, bound in the very same array) is never rewritten.
 *
 *  It lives up here, above the credential gate, because `--self-check` must
 *  exercise THE REAL EXPRESSION. A self-check with its own copy of the pattern
 *  proves that the copy works, which is worth nothing: the two would rot apart
 *  and the check would go on passing. [pipeline S-12r] (absent from origins.lock.json by construction — S-12r is a residual of S-12, raised by Private/plans/03-stamper-plan.md after the pipeline harvest was frozen) */
const APP_DB_BLOCK = /("binding"\s*:\s*"APP_DB"[\s\S]{0,400}?"database_id"\s*:\s*")([^"]+)(")/;

const args = process.argv.slice(2);
const appId = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry');
const selfCheck = args.includes('--self-check');
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

// ─────────────────────────────────────────────────────────────────────────────
// `--self-check` — the OFFLINE exercise, and the whole of [pipeline S-12r] (absent from origins.lock.json by construction — S-12r is a residual id, never a pipeline heading).
//
// WHY IT EXISTS. Until now nothing ran this script and nothing tested it:
// `grep -rn provision-backend .github/` returned zero, and it sits under
// tooling/scripts/, which assert-guard-coverage.mjs did not cover. The repo's
// own precedent is three lines away in ci.yml, where the four release scripts
// are dry-run exercised on every push because "a release script nobody runs
// rots exactly like a guard nobody feeds bad input to". This one had neither.
//
// WHY NOT REUSE `--dry`. `--dry` is not offline: it exits at the credential gate
// below without CLOUDFLARE_API_TOKEN/ACCOUNT_ID, then runs `npm install` and
// calls `wrangler d1 info` before it stops. In CI that would fail for people who
// have no secret — a fork PR — rather than for defects, which is the worst kind
// of red. `--self-check` stops HERE, above the gate: no token, no install, no
// network, no writes.
//
// WHAT IT PROVES — the config surgery, which is the half most likely to rot. A
// template edit to the stamped wrangler.jsonc (renaming the binding, reordering
// the array so PLATFORM_DB comes first, widening the gap past 400 characters)
// breaks the scoping silently, and the failure would land on a real database.
// So the patch is applied IN MEMORY to a synthetic uuid and the result RE-PARSED,
// asserting structurally that APP_DB moved and PLATFORM_DB did not.
if (selfCheck) {
  const problems = [];
  const raw = readFileSync(cfgPath, 'utf8');

  /** Strip JSONC comments and trailing commas, then parse. A local copy on
   *  purpose: every guard in tooling/ci that reads wrangler.jsonc carries its
   *  own, because these files are each meant to run standalone with no import
   *  graph. Structural parsing is the point — this repo has already shipped a
   *  check that matched a COMMENT explaining the absence of the very key it was
   *  looking for. */
  const parseJsonc = (text) => {
    let out = '';
    let i = 0;
    while (i < text.length) {
      const two = text.slice(i, i + 2);
      if (two === '//') {
        while (i < text.length && text[i] !== '\n') i++;
      } else if (two === '/*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? text.length : end + 2;
      } else if (text[i] === '"') {
        out += text[i++];
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\') out += text[i++];
          out += text[i++];
        }
        if (i < text.length) out += text[i++];
      } else {
        out += text[i++];
      }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  };

  // 🔴 THE ENTRY AND ITS `database_id` ARE TWO DIFFERENT FACTS, and collapsing
  // them into one lookup made this check report the wrong cause: an APP_DB entry
  // that had merely lost its `database_id` line was reported as "no entry is
  // bound as APP_DB", sending a reader to look for a rename that had not
  // happened. It is also the more dangerous of the two — see below.
  const entryOf = (cfg, binding) => (cfg.d1_databases ?? []).find((d) => d.binding === binding);
  const idOf = (cfg, binding) => entryOf(cfg, binding)?.database_id;

  console.log(`self-check: ${cfgPath}`);
  let before;
  try {
    before = parseJsonc(raw);
    console.log('  ok  the stamped wrangler.jsonc parses as JSONC');
  } catch (e) {
    problems.push(`the stamped wrangler.jsonc is not parseable JSONC: ${e.message}`);
  }

  if (before) {
    const appIdBefore = idOf(before, 'APP_DB');
    const platformIdBefore = idOf(before, 'PLATFORM_DB');
    // Matched up here so the diagnostics below can say what the live patch WOULD
    // have captured, rather than only that something is missing.
    const m = raw.match(APP_DB_BLOCK);

    if (entryOf(before, 'APP_DB') === undefined) {
      problems.push(
        'no d1_databases entry is bound as "APP_DB". The patch below targets that binding by name, ' +
          'so a rename in the brick template would leave this script silently patching nothing.',
      );
    } else if (appIdBefore === undefined) {
      // 🔴 THE SHAPE THAT REWRITES THE SHARED BINDING. The patch looks for the
      // FIRST `database_id` after `"binding": "APP_DB"`. If the APP_DB entry has
      // none, the search runs straight on into the NEXT entry — PLATFORM_DB —
      // and the live run would write this app's uuid over the portfolio's shared
      // database id. The regex still "matches"; it just matches the wrong thing.
      problems.push(
        'the APP_DB entry declares no `database_id`. The patch is scoped to the first `database_id` ' +
          'FOLLOWING the APP_DB binding, so with none of its own it captures the NEXT binding\'s — ' +
          'PLATFORM_DB, shared by the whole portfolio. A missing line here is not a missing patch, ' +
          'it is a patch applied to the wrong database' +
          (m ? `: the live run would have captured "${m[2]}"` : '') + '.',
      );
    }
    if (platformIdBefore === undefined) {
      problems.push(
        'no d1_databases entry is bound as "PLATFORM_DB". That binding is the REASON the patch is ' +
          'scoped: without it in the fixture, "the shared binding was not rewritten" is proven by ' +
          'its absence rather than by the scoping, which is no proof at all.',
      );
    }

    if (!m) {
      problems.push(
        'APP_DB_BLOCK did not match the stamped config. This is the exact expression the live run ' +
          'uses to patch database_id, so a non-match means provisioning would die at step 1 for ' +
          'every newly stamped backend app.',
      );
    } else if (appIdBefore !== undefined && m[2] !== appIdBefore) {
      // 🔴 THE CASE THE SCOPING EXISTS FOR. If the array is reordered or the
      // 400-character window widened, this regex can capture a DIFFERENT
      // binding's database_id while still "matching".
      problems.push(
        `APP_DB_BLOCK captured "${m[2]}", but the parsed APP_DB.database_id is "${appIdBefore}". ` +
          'The regex matched something other than the APP_DB binding it names.',
      );
    }

    if (m && appIdBefore !== undefined && platformIdBefore !== undefined) {
      const SYNTHETIC = '11111111-2222-4333-8444-555555555555';
      let after;
      try {
        after = parseJsonc(raw.replace(APP_DB_BLOCK, `$1${SYNTHETIC}$3`));
      } catch (e) {
        problems.push(`the patch produced a config that no longer parses: ${e.message}`);
      }
      if (after) {
        if (idOf(after, 'APP_DB') !== SYNTHETIC) {
          problems.push(`after the patch APP_DB.database_id is "${idOf(after, 'APP_DB')}", not the value written.`);
        } else {
          console.log('  ok  the patch rewrites APP_DB.database_id (verified by re-parsing, not by regex)');
        }
        if (idOf(after, 'PLATFORM_DB') !== platformIdBefore) {
          problems.push(
            `the patch also rewrote PLATFORM_DB.database_id ("${platformIdBefore}" -> ` +
              `"${idOf(after, 'PLATFORM_DB')}"). That binding is SHARED by the whole portfolio; ` +
              'rewriting it points every app at the wrong database.',
          );
        } else {
          console.log('  ok  PLATFORM_DB.database_id is untouched — the shared binding is never rewritten');
        }
      }
    }
  }

  if (problems.length) {
    console.error('\n✗ provision-backend --self-check FAILED:');
    for (const p of problems) console.error(`    ${p}`);
    console.error('\n  Nothing was created, patched or migrated — this mode never leaves memory.');
    process.exit(1);
  }
  console.log('\n✅ self-check passed. No token, no install, no network, no writes.');
  process.exit(0);
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
// The SAME constant `--self-check` exercises above — see its header for why it
// is not a second copy of the pattern.
const appDbBlock = APP_DB_BLOCK;
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
