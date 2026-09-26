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
// ⏱ 2026-09-26 — THE LOCKFILE, THE REGISTER ROW, AND `--check` (O-SERVICE-KIT-UNBUILT, E-a1).
//   · Step [1] installs with `npm ci`, never `npm install`, and refuses a service
//     directory with no package-lock.json (exit 1) before it installs or calls
//     anything. The brick carries the lockfile its package.json resolves to, which
//     OSV-Scanner reads in this repository on every ci run; `npm install` would
//     resolve the ranges afresh on the day and ship a tree nobody reviewed.
//   · Step [6] writes the Worker's `appWorkers` row into tooling/platform-register.json
//     (and names its config in `bindingSources.configs`): name, entrypoint, config,
//     hosts (the config's custom domains), `dsnSecret` GLITCHTIP_DSN_<APP>,
//     `clientBasePath` and `routes`. The routes are DERIVED from the stamped
//     entrypoint by tooling/ci/worker-routes.mjs, the parser assert-platform-register
//     holds them to, and each route's auth, purpose, client and noLimiterReason come
//     from tooling/bricks/app/route-clients.json. A mounted route the map does not
//     name stops the step with exit 1 naming it; it never writes an
//     `unconsumedReason`. A row already there is left as it is. Step [6] writes files
//     only: it deploys nothing.
//   · 🔴 THE FIRST DEPLOY IS NOT HERE, by design (service-kit design §4.1 item 4).
//     This script runs before the new app's PR merges, and a deploy from here would
//     ship unmerged code past ci-gate and past record-deployment. The Worker's first
//     deploy belongs to the deploy lane (E-a2).
//   · `--check` (offline: no app_id, no token, no install, no network, no writes)
//     exits 1 naming each Worker directory under services/ that the register has no
//     row for (`servingWorker` or `appWorkers`), and 0 otherwise.
//
// ⏱ 2026-09-26 — THE INVENTORY ROW AND THE MONITOR HOST ROW (O-SERVICE-KIT-UNBUILT, E-b2).
//   · Step [7] copies tooling/legal/data-inventory.json's `d1:{{app_id}}_db` template
//     row into a concrete `d1:<app>_db` row (the name, `writtenBy` and the two
//     sentences that described a template are the app's; the kind, personalData and
//     retention kind are the template's), and adds tooling/monitor-register.json's
//     host row for each of the Worker's hosts: `derivedFrom: appCatalogue`,
//     `monitor: null`, and a `gap` whose `create` block is the GET monitor on the
//     Worker's health route. tooling/ops/ensure-monitors.mjs creates that monitor
//     and writes its id onto the row; this script sends nothing to GlitchTip. A row
//     already there is left as it is. The table rows of the app's own migrations are
//     NOT written here: what each table holds and the sentence that discloses it are
//     a person's to write, and assert-data-inventory.mjs names every one missing.
//   · `--check` also exits 1 on a registered Worker whose owned D1 (the walk in
//     tooling/ci/d1-stores.mjs) has no data-inventory row, or one of whose hosts has
//     no monitor-register host row.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
//     node tooling/scripts/provision-backend.mjs <app_id> [--location apac] [--dry]
//   node tooling/scripts/provision-backend.mjs <app_id> --self-check
//   node tooling/scripts/provision-backend.mjs --check
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
import { join, resolve, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
// The app-id rule, resolved against THIS module's URL (a static import always is),
// never the working directory: the script runs from the repo root, its tests from
// a temp dir. Row O-APP-ID-FORM-UNVALIDATED (a).
import { appIdProblems } from '../../contracts/app-id/app-id.js';
// Step [6] and `--check` read the Worker set, the register and the mounts with the
// same modules the guards use, resolved the same way (against this module's URL).
import { mountedRoutes } from '../ci/worker-routes.mjs';
import { workerSet, registerRows, REGISTER, SERVICES_DIR, WORKER_CONFIG } from '../ci/worker-set.mjs';
import { parseJsonc as parseConfig } from '../ci/d1-sql-inventory.mjs';
// Step [7] and `--check`: the one D1 walk, and the one writer of a monitor-register host row.
import { ownedD1 } from '../ci/d1-stores.mjs';
import { REGISTER_REL as MONITOR_REGISTER, appendHostRow } from '../ops/monitor-register.mjs';

/** Step [6]'s source for every route's auth, purpose and client (see the header). */
const ROUTE_CLIENTS = 'tooling/bricks/app/route-clients.json';
/** Step [7]'s inventory, and the template row it copies. */
const INVENTORY = 'tooling/legal/data-inventory.json';
const TEMPLATE_STORE = 'd1:{{app_id}}_db';

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
 *  and the check would go on passing. [pipeline S-12r] (absent from origins.lock.json by construction — S-12r is a residual of S-12, raised by Private/pre-minimal-2026-09-08:plans/03-stamper-plan.md after the pipeline harvest was frozen) */
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

// ─────────────────────────────────────────────────────────────────────────────
// `--check` — has every Worker directory a register row? Tree-wide, so it runs
// before the app_id rule and takes no app_id; offline, so it needs no token.
// A tree it cannot read is COVERAGE LOST (exit 2), never a pass.
if (args.includes('--check')) {
  if (appId) {
    die([`✗ --check covers every Worker under ${SERVICES_DIR}/ and takes no app_id (got "${appId}").`, 'usage: provision-backend.mjs --check']);
  }
  const root = resolve(process.cwd());
  const lost = (line) => {
    console.error(`✗ COVERAGE LOST — ${line}`);
    console.error('  --check could not look, which is not a pass.');
    process.exit(2);
  };
  const set = workerSet(root);
  if (set === null || set.workers.length === 0) {
    lost(`no Worker directory (a ${SERVICES_DIR}/<dir> holding ${WORKER_CONFIG}) under ${root}.`);
  }
  let register;
  try {
    register = JSON.parse(readFileSync(join(root, REGISTER), 'utf8'));
  } catch (e) {
    lost(`${REGISTER} is missing or not JSON (${e.message}), so no Worker can be matched to a row.`);
  }
  const rowFor = new Map(registerRows(register).map((r) => [String(r.row?.config ?? '').replace(/\\/g, '/'), r.field]));
  const missing = [];
  for (const dir of set.workers) {
    const cfg = `${SERVICES_DIR}/${dir}/${WORKER_CONFIG}`;
    if (rowFor.has(cfg)) console.log(`  ok  ${SERVICES_DIR}/${dir} — ${rowFor.get(cfg)}`);
    else missing.push(`${SERVICES_DIR}/${dir}`);
  }
  if (missing.length) {
    die(missing.map((m) =>
      `✗ ${m} holds a ${WORKER_CONFIG} and ${REGISTER} has no appWorkers row for it. ` +
        'Provisioning writes that row at step [6]; a Worker without one has no host, routes or crash-sink secret any lane can read.'));
  }
  // Step [7]'s two rows, for every registered Worker that has a directory here.
  let storeIds;
  let hostnames;
  try {
    storeIds = new Set(JSON.parse(readFileSync(join(root, INVENTORY), 'utf8')).stores.map((s) => s?.id));
  } catch (e) {
    lost(`${INVENTORY} is missing, not JSON or has no \`stores\` (${e.message}), so no Worker's database can be matched to a row.`);
  }
  try {
    hostnames = new Set(JSON.parse(readFileSync(join(root, MONITOR_REGISTER), 'utf8')).hosts.map((h) => h?.hostname));
  } catch (e) {
    lost(`${MONITOR_REGISTER} is missing, not JSON or has no \`hosts\` (${e.message}), so no Worker's host can be matched to a row.`);
  }
  const dirConfigs = new Set(set.workers.map((dir) => `${SERVICES_DIR}/${dir}/${WORKER_CONFIG}`));
  const unrecorded = [];
  for (const { row } of registerRows(register)) {
    const cfg = String(row?.config ?? '').replace(/\\/g, '/');
    if (!dirConfigs.has(cfg)) continue;
    let parsed;
    try {
      parsed = parseConfig(readFileSync(join(root, cfg), 'utf8'));
    } catch (e) {
      lost(`${cfg} does not parse as JSONC (${e.message}), so the databases it owns cannot be read.`);
    }
    const dbs = ownedD1(root, cfg, parsed, (lines) => lost(lines.join(' ')));
    for (const db of dbs.owned) {
      if (!storeIds.has(`d1:${db.databaseName}`)) {
        unrecorded.push(`${cfg} owns D1 ${db.databaseName} and ${INVENTORY} has no \`d1:${db.databaseName}\` row. Provisioning writes it at step [7].`);
      }
    }
    for (const h of Array.isArray(row.hosts) ? row.hosts : []) {
      if (!hostnames.has(h)) {
        unrecorded.push(`${cfg} serves ${h} and ${MONITOR_REGISTER} has no host row for it. Provisioning writes it at step [7]; ensure-monitors.mjs creates its monitor.`);
      }
    }
    if (dbs.owned.length || row.hosts?.length) {
      console.log(`  ok  ${cfg} — ${dbs.owned.map((d) => `d1:${d.databaseName}`).join(', ') || 'no owned D1'}; hosts ${(row.hosts ?? []).join(', ') || 'none'}`);
    }
  }
  if (unrecorded.length) die(unrecorded.map((u) => `✗ ${u}`));
  console.log(`\n✅ --check: all ${set.workers.length} Worker director(ies) under ${SERVICES_DIR}/ have a register row, and every owned D1 and host of theirs has its inventory and monitor-register row.`);
  process.exit(0);
}

if (!appId) {
  die(['usage: provision-backend.mjs <app_id> [--location apac] [--dry]']);
}
// Checked BEFORE anything is derived from the id: `${appId}_db` and `${appId}-api`
// below are a D1 name and a Worker name, and neither is renamed cheaply.
const idProblems = appIdProblems(appId);
if (idProblems.length > 0) {
  die([
    `✗ "${appId}" is not a valid app_id:`,
    ...idProblems.map((p) => `  · ${p}`),
    'usage: provision-backend.mjs <app_id> [--location apac] [--dry]',
  ]);
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

// READ ONCE (CodeQL #86): the config's bytes are taken here, instead of an existence check that
// the rewrite at the end of this script acted on. ENOENT/ENOTDIR are "no stamped backend";
// any other failure to read throws, as the later read did.
let cfgInitial = null;
try {
  cfgInitial = readFileSync(cfgPath, 'utf8');
} catch (e) {
  if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') throw e;
}
if (cfgInitial === null) {
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
// below without CLOUDFLARE_API_TOKEN/ACCOUNT_ID, then runs `npm ci` and
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
  const raw = cfgInitial;

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
//     (the stamped service's package.json pins wrangler EXACTLY, and
//     tooling/versions.json holds that pin), so the tool that provisions could
//     differ from the tool that deploys. [pipeline F-2] is the same lesson about
//     mason_cli.
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
  // 🔴 THE LOCKFILE FIRST, EVEN WHEN node_modules IS ALREADY THERE: a tree installed
  // with no lockfile is the unreviewed tree this refusal exists to stop, whoever
  // installed it. `npm ci` would refuse too, but only when it runs.
  if (!existsSync(join(svcDir, 'package-lock.json'))) {
    die([
      `✗ ${join(svcDir, 'package-lock.json')} does not exist.`,
      '  Step [1] installs with `npm ci`, which installs exactly the committed lockfile. The brick stamps one',
      '  beside package.json; restore it (re-stamp, or copy the brick\'s), never `npm install` a fresh tree here.',
    ]);
  }
  if (existsSync(local)) return local;
  console.log('    node_modules missing → npm ci (this is the only network wait)');
  // npm is itself a .cmd on Windows, so this one call does need a shell — it
  // takes no argument that a shell could mangle.
  const inst = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: svcDir, encoding: 'utf8', env: process.env, shell: process.platform === 'win32',
  });
  if (inst.status !== 0) die(['✗ npm ci failed:', `${inst.stdout ?? ''}${inst.stderr ?? ''}`]);
  if (!existsSync(local)) die([`✗ npm ci succeeded but ${local} is still absent.`]);
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

// ── 6. the register row — files only, it deploys nothing (see the header) ────
const cfgRel = `${SERVICES_DIR}/${appId}-api/${WORKER_CONFIG}`;

/** The `appWorkers` row for this Worker, or exit 1 naming why none can be written.
 *  Its routes are the stamped entrypoint's mounts; each one's auth, purpose, client
 *  and noLimiterReason are the ROUTE_CLIENTS entry with the same method and path. */
function appWorkerRow() {
  let cfg;
  try {
    cfg = parseConfig(readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    die([`✗ ${cfgRel} does not parse as JSONC (${e.message}); no row can be read off it.`]);
  }
  if (typeof cfg.main !== 'string' || cfg.main === '') {
    die([`✗ ${cfgRel} declares no \`main\`, so there is no entrypoint to read the Worker's routes from.`]);
  }
  const entrypoint = posix.normalize(`${SERVICES_DIR}/${appId}-api/${cfg.main}`);
  const hosts = (Array.isArray(cfg.routes) ? cfg.routes : [])
    .filter((r) => r?.custom_domain === true && typeof r.pattern === 'string' && r.pattern)
    .map((r) => r.pattern);
  if (hosts.length === 0) {
    die([`✗ ${cfgRel} declares no \`routes\` entry with \`custom_domain: true\`, so the row would name no host to smoke.`]);
  }
  let map;
  try {
    map = JSON.parse(readFileSync(join(ROOT, ROUTE_CLIENTS), 'utf8'));
  } catch (e) {
    die([`✗ ${ROUTE_CLIENTS} is missing or not JSON (${e.message}); it is where each route's client comes from.`]);
  }
  if (!Array.isArray(map?.routes)) die([`✗ ${ROUTE_CLIENTS} has no \`routes\` array.`]);

  const notes = [];
  const mounted = mountedRoutes(ROOT, entrypoint, '', notes);
  if (mounted.length === 0) {
    die([
      `✗ found no mounted route in ${entrypoint}. A row with \`routes: []\` describes a Worker that answers nothing,`,
      '  and assert-platform-register.mjs would refuse it. What the parser could not follow:',
      ...(notes.length ? notes.map((n) => `    · ${n}`) : ['    (nothing — it found no route at all)']),
    ]);
  }
  const sub = (s) => String(s).replaceAll('<<app_id>>', appId);
  const unmapped = [];
  const routes = [];
  for (const m of mounted) {
    const e = map.routes.find((r) => String(r?.method).toUpperCase() === m.method && r?.path === m.path);
    if (!e || !e.client?.file || !e.client?.expression) {
      unmapped.push(`${m.method} ${m.path} (mounted by ${m.owningFile})${e ? ': its entry names no client' : ''}`);
      continue;
    }
    const route = {
      id: sub(e.id),
      method: m.method,
      path: m.path,
      auth: e.auth,
      owningFile: m.owningFile,
      purpose: sub(e.purpose),
      client: {
        file: sub(e.client.file),
        expression: sub(e.client.expression),
        ...(e.client.note ? { note: sub(e.client.note) } : {}),
      },
    };
    if (e.noLimiterReason) route.noLimiterReason = sub(e.noLimiterReason);
    routes.push(route);
  }
  if (unmapped.length) {
    die([
      `✗ step [6]: ${ROUTE_CLIENTS} names no client for ${unmapped.length} route(s) that ${entrypoint} mounts:`,
      ...unmapped.map((u) => `    ${u}`),
      '  Name each route\'s caller in that map, or write this row by hand. This step writes no `unconsumedReason`:',
      '  a waiver a script writes is one nobody decided. Nothing was written to the register.',
    ]);
  }
  return {
    _why: [
      `Written by tooling/scripts/provision-backend.mjs step [6]: \`routes\` are what ${entrypoint} mounts`,
      `(tooling/ci/worker-routes.mjs), and each route's auth, purpose and client are ${ROUTE_CLIENTS}'s entry for it.`,
    ],
    name: cfg.name,
    entrypoint,
    config: cfgRel,
    hosts,
    // The app-id contract is ^[a-z][a-z0-9]*$, so the upper-cased id is a valid secret-name suffix.
    dsnSecret: `GLITCHTIP_DSN_${appId.toUpperCase()}`,
    _dsnSecretWhy:
      "The GitHub secret holding THIS Worker's crash-sink DSN, read by tooling/ci/worker-set.mjs --for-deploy. " +
      'Named for this app so its crashes file under its own GlitchTip project; creating the project and the secret is an owner step.',
    clientBasePath: map.clientBasePath,
    routes,
  };
}

step(6, `Writing ${appId}-api's appWorkers row into ${REGISTER}`);
const regPath = join(ROOT, REGISTER);
let register;
try {
  register = JSON.parse(readFileSync(regPath, 'utf8'));
} catch (e) {
  die([`✗ ${REGISTER} is missing or not JSON (${e.message}). The Worker is provisioned and has no register row.`]);
}
if (!Array.isArray(register.appWorkers)) die([`✗ ${REGISTER} has no \`appWorkers\` array to add the row to.`]);
const existing = register.appWorkers.find((w) => String(w?.config ?? '').replace(/\\/g, '/') === cfgRel);
if (existing) {
  console.log(`    ${cfgRel} already has a row (${existing.name}); left unchanged. assert-platform-register.mjs holds it to the tree.`);
} else {
  const row = appWorkerRow();
  register.appWorkers.push(row);
  const configs = register.bindingSources?.configs;
  if (Array.isArray(configs) && !configs.includes(cfgRel)) {
    configs.push(cfgRel);
    configs.sort();
  }
  writeFileSync(regPath, `${JSON.stringify(register, null, 2)}\n`);
  console.log(`    appWorkers[${register.appWorkers.length - 1}] ${row.name} → ${row.hosts.join(', ')}, dsnSecret ${row.dsnSecret}`);
  console.log(`    routes: ${row.routes.map((r) => `${r.method} ${r.path}`).join(' · ')}`);
  console.log(`    ${cfgRel} is named in bindingSources.configs.`);
}

// ── 7. the inventory row and the monitor host row — files only (see the header) ──
step(7, `Writing ${dbName}'s ${INVENTORY} row and ${appId}-api's ${MONITOR_REGISTER} host row(s)`);
const workerRow = register.appWorkers.find((w) => String(w?.config ?? '').replace(/\\/g, '/') === cfgRel);

/** The concrete inventory row: the template's kind, personalData and retention kind,
 *  with this app's name and config, and the two sentences that described a template
 *  replaced by ones that describe this database. The template's `note` argues for
 *  keeping the TEMPLATE row, so it is not copied. */
function inventoryRowFrom(template) {
  const { note: _templateOnly, ...rest } = JSON.parse(JSON.stringify(template).replaceAll('{{app_id}}', appId));
  return {
    ...rest,
    id: `d1:${dbName}`,
    name: dbName,
    // The sentence app #1's row uses. It describes the store and nothing else: this
    // file feeds the published privacy notice, so provenance belongs in git.
    holds: `${appId}'s own database. Holds no rows of its own; its tables do.`,
    retention: { ...rest.retention, reason: 'A container. Each table its migrations create carries its own row.' },
    writtenBy: [cfgRel],
  };
}

const invPath = join(ROOT, INVENTORY);
let inventory;
try {
  inventory = JSON.parse(readFileSync(invPath, 'utf8'));
} catch (e) {
  die([`✗ ${INVENTORY} is missing or not JSON (${e.message}). The Worker is registered and its database has no inventory row.`]);
}
if (!Array.isArray(inventory.stores)) die([`✗ ${INVENTORY} has no \`stores\` array to add the row to.`]);
if (inventory.stores.some((s) => s?.id === `d1:${dbName}`)) {
  console.log(`    ${INVENTORY} already has d1:${dbName}; left unchanged.`);
} else {
  const at = inventory.stores.findIndex((s) => s?.id === TEMPLATE_STORE);
  if (at < 0) {
    die([`✗ ${INVENTORY} has no ${TEMPLATE_STORE} template row to copy. Nothing was written to it; restore the template row, or write d1:${dbName} by hand.`]);
  }
  inventory.stores.splice(at, 0, inventoryRowFrom(inventory.stores[at]));
  writeFileSync(invPath, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(`    ${INVENTORY}: d1:${dbName} (copied from ${TEMPLATE_STORE}).`);
}

const health = (workerRow?.routes ?? []).find((r) => r?.method === 'GET' && /\/health$/.test(String(r?.path ?? '')));
if (!health) {
  die([`✗ ${cfgRel}'s register row mounts no GET …/health route, so there is nothing for a monitor to watch. Nothing was written to ${MONITOR_REGISTER}.`]);
}
const monPath = join(ROOT, MONITOR_REGISTER);
let monText;
try {
  monText = readFileSync(monPath, 'utf8');
  JSON.parse(monText);
} catch (e) {
  die([`✗ ${MONITOR_REGISTER} is missing or not JSON (${e.message}). Nothing was written to it.`]);
}
const monBefore = monText;
for (const hostname of workerRow?.hosts ?? []) {
  if ((JSON.parse(monText).hosts ?? []).some((h) => h?.hostname === hostname)) {
    console.log(`    ${MONITOR_REGISTER} already has ${hostname}; left unchanged.`);
    continue;
  }
  monText = appendHostRow(monText, {
    hostname,
    what: `the ${appId}-api Worker`,
    derivedFrom: 'appCatalogue',
    _why:
      `Written by tooling/scripts/provision-backend.mjs step [7]. \`monitor\` is null until tooling/ops/ensure-monitors.mjs ` +
      '--apply creates the monitor `gap.create` describes, reads it back, and writes it here with its id.',
    monitor: null,
    gap: {
      why: `${hostname} is provisioned, and GlitchTip has no monitor for it yet.`,
      action:
        "node tooling/ops/ensure-monitors.mjs prints the POST; its --apply creates the monitor (a vendor write: a parent step, after the owner's go).",
      create: {
        name: `${appId}-api health`,
        type: 'GET',
        path: health.path,
        expectedStatus: 200,
        expectedBody: '"ok":true',
        intervalSeconds: 60,
        project: appId,
      },
    },
  });
  console.log(`    ${MONITOR_REGISTER}: ${hostname} (monitor: null; ensure-monitors.mjs creates GET ${health.path}).`);
}
if (monText !== monBefore) writeFileSync(monPath, monText);

console.log(`\n✅ ${appId}: provisioned, patched, migrated and registered. Zero manual edits.`);
console.log(`   Run log above is S-12 limbs 2 and 3; limb 1 is enforced in CI by assert-d1-bindings.mjs.`);
