#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render-platform-app-block.mjs — the platform Worker's PER-APP block, written
// from the register instead of by hand.
//
// ⏱ ADDED 2026-09-26 · row O-BACKUP-AND-FANOUT-SETS-HAND-LISTED (service kit E-c):
// "The backup database list, the cron appTargets and the platform's per-app
// bindings are derived from one source: the platform-register row … that
// provision-backend already writes."
//
// 🔴 THE FAILURE. An app with its own database needed the SAME edit in four places
// that nothing compared: its `<APP>_DB` D1 binding, its `ERASURE_<APP>` service
// binding and its `APP_ERASURE_ENDPOINTS` entry in services/platform/wrangler.jsonc,
// its fan-out row in src/scheduled.ts, and its name in src/backup/index.ts's export
// list. Miss the last two and app #2's renewals never run and its database is never
// backed up, with every check green.
//
// THE ONE SOURCE. `tooling/platform-register.json` `appWorkers` (provision-backend
// step [6] writes each row, since E-a1), joined with each app Worker's OWN config:
// its `APP_ID` var, and the D1 it OWNS (the entry with `migrations_dir`, read by
// tooling/ci/d1-stores.mjs — the one D1 walk). A row whose Worker owns no D1 gets its
// erasure binding and endpoint only.
//
// IT WRITES, and `--check` compares the same text and writes nothing:
//   · between `GENERATED BEGIN/END <region>` markers in services/platform/wrangler.jsonc:
//       app-erasure-endpoints  the `APP_ERASURE_ENDPOINTS` var (`<app>=https://<first host>`)
//       app-erasure-bindings   one `ERASURE_<APP>` service binding per app Worker
//       app-databases          one `<APP>_DB` D1 binding per owned app database
//     ⏱ 2026-10-01 (rv2-services-022) and the same three for the platform's
//     `env.sandbox`, each from the app Worker's OWN `env.sandbox`:
//       sandbox-app-erasure-endpoints  `<app>=https://<app script>-sandbox.<subdomain>.workers.dev`
//       sandbox-app-erasure-bindings   `ERASURE_<APP>` → the app's SANDBOX script
//       sandbox-app-databases          `<APP>_DB` → the D1 the app's env.sandbox owns
//     so a sandbox account deletion relays to the sandbox app Worker and empties the
//     sandbox app database — never production's, which the platform's sandbox could not
//     reach before (it bound none of the three, so a sandbox E2E could not see an
//     erasure defect at all). An app Worker with no `env.sandbox` is a refusal.
//     Everything outside the markers is the hand-written file, untouched.
//   · services/platform/src/generated/app-targets.ts: `APP_TARGETS` (the fan-out and the
//     backup's app databases) and `APP_KV` (each app Worker's KV namespaces the platform
//     does not already bind, deduplicated by namespace id: the brick's JWKS_CACHE and
//     SESSION_REVOKED ARE the platform's).
//   · ⏱ 2026-09-28 · ST-N1: `NATIVE_AUTH_APPS` in the same module — every app under apps/
//     that signs in with Supabase AND ships a native target, read by the SAME walk
//     tooling/ci/assert-auth-callbacks.mjs grades schemes with (`appsInScope`, `appIdOf`,
//     `TARGET_DIRS`). services/platform/src/routes/native-auth.ts serves
//     POST /v1/auth/native/<app>/* for exactly these ids, so a newly stamped native app
//     gets the captcha-free sign-in route from a re-render, with no Worker edit. It is
//     NOT the `appWorkers` rows: a client-only app has no Worker of its own and still
//     signs in natively.
//
// NOT WRITTEN, ON PURPOSE: the `ALLOWED_ORIGINS` list. Its members are every app's web
// origin (catalog/apps.json), client-only apps included — not the `appWorkers` rows —
// and it is CORS policy, the E-b1 PR's subject. It stays hand-kept, guarded by
// tooling/ci/assert-cors-allowlist.mjs.
//
// Refusals (exit 1, nothing written): a row whose config is not a Worker config, an
// `APP_ID` that is not the row's name minus `-api`, an app database with no id, and an
// `APP_KV` namespace the platform config does not bind (the nightly export can read only
// what the Worker binds — bind it, then re-render). A register or config that cannot be
// read is exit 2.
//
// Usage:  node tooling/scripts/render-platform-app-block.mjs [--check] [--root <dir>]
// Exit 0 = written (or, with --check, already what the register renders).
// Exit 1 = --check found a difference, or a refusal above.   Exit 2 = could not read.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc, ownedD1 } from '../ci/d1-stores.mjs';
import { appIdOf, appsInScope, TARGET_DIRS } from '../ci/assert-auth-callbacks.mjs';
import { WORKERS_DEV_SUBDOMAIN } from '../store/capture-backend.mjs';

export const REGISTER_REL = 'tooling/platform-register.json';
export const PLATFORM_CONFIG_REL = 'services/platform/wrangler.jsonc';
export const MODULE_REL = 'services/platform/src/generated/app-targets.ts';
export const REGIONS = [
  'app-erasure-endpoints',
  'app-erasure-bindings',
  'app-databases',
  'sandbox-app-erasure-endpoints',
  'sandbox-app-erasure-bindings',
  'sandbox-app-databases',
];
const RENDERER = 'tooling/scripts/render-platform-app-block.mjs';

export class Refusal extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const upper = (appId) => appId.toUpperCase().replace(/-/g, '_');

/**
 * The per-app rows for the tree at `root`:
 * `[{ appId, worker, origin, db: {binding, databaseName, databaseId} | null, kv: [{binding, id}],
 *     sandbox: { worker, origin, db: {binding, databaseName, databaseId} | null } }]`.
 */
export function appRows(root) {
  const regAbs = join(root, REGISTER_REL);
  if (!existsSync(regAbs)) throw new Refusal(`${REGISTER_REL} does not exist under ${root}.`, 2);
  let register;
  try {
    register = JSON.parse(readFileSync(regAbs, 'utf8'));
  } catch (e) {
    throw new Refusal(`${REGISTER_REL} is not JSON (${e.message}).`, 2);
  }
  if (!Array.isArray(register.appWorkers)) throw new Refusal(`${REGISTER_REL} has no \`appWorkers\` array.`, 2);
  const rows = [];
  for (const [i, w] of register.appWorkers.entries()) {
    const where = `${REGISTER_REL} appWorkers[${i}] (${w?.name ?? '?'})`;
    const rel = String(w?.config ?? '');
    if (!/^services\/[^/]+\/wrangler\.jsonc$/.test(rel)) throw new Refusal(`${where} names config \`${rel}\`, which is not services/<dir>/wrangler.jsonc.`);
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(join(root, rel), 'utf8'));
    } catch (e) {
      throw new Refusal(`${where}: ${rel} could not be read or parsed (${e.message}).`, 2);
    }
    const appId = cfg?.vars?.APP_ID;
    if (typeof appId !== 'string' || `${appId}-api` !== w.name) {
      throw new Refusal(`${where}: ${rel} declares APP_ID \`${appId}\`, and the row's Worker is \`${w.name}\`; the Worker of app <id> is <id>-api.`);
    }
    const host = Array.isArray(w.hosts) && typeof w.hosts[0] === 'string' ? w.hosts[0] : null;
    if (host === null) throw new Refusal(`${where} names no host, so its erasure endpoint has no origin.`);
    const lostLines = [];
    const { owned } = ownedD1(root, rel, cfg, (lines) => lostLines.push(...lines));
    if (lostLines.length) throw new Refusal(`${where}: ${lostLines.join(' ')}`, 2);
    if (owned.length > 1) throw new Refusal(`${where}: ${rel} owns ${owned.length} D1 databases; the per-app block binds one per app.`);
    const own = owned[0] ?? null;
    if (own !== null && !own.databaseId) throw new Refusal(`${where}: ${rel} owns ${own.databaseName} with no database_id to bind it by.`);
    // The sandbox twin, from the app Worker's own env.sandbox: its script is what
    // `wrangler deploy --env sandbox` names it, and its database the one entry there
    // that carries `migrations_dir` (the D1 it owns, as at the top level).
    const sbx = cfg?.env?.sandbox;
    if (sbx === null || typeof sbx !== 'object' || Array.isArray(sbx)) {
      throw new Refusal(
        `${where}: ${rel} declares no \`env.sandbox\`, so the platform's sandbox would have no erasure relay, service binding ` +
          'or database twin for this app. Every app Worker carries the block the brick stamps.',
      );
    }
    const sbxOwned = (Array.isArray(sbx.d1_databases) ? sbx.d1_databases : []).filter((d) => d && d.migrations_dir);
    if (sbxOwned.length > 1) throw new Refusal(`${where}: ${rel} env.sandbox owns ${sbxOwned.length} D1 databases; the per-app block binds one per app.`);
    if ((own === null) !== (sbxOwned.length === 0)) {
      throw new Refusal(`${where}: ${rel} owns ${own === null ? 'no' : 'a'} D1 at the top level and ${sbxOwned.length ? 'one' : 'none'} in env.sandbox; the sandbox twins production's.`);
    }
    const sbxOwn = sbxOwned[0] ?? null;
    if (sbxOwn !== null && !sbxOwn.database_id) throw new Refusal(`${where}: ${rel} env.sandbox owns ${sbxOwn.database_name} with no database_id to bind it by.`);
    const sbxWorker = typeof sbx.name === 'string' && sbx.name ? sbx.name : `${cfg.name}-sandbox`;
    rows.push({
      appId,
      worker: w.name,
      origin: `https://${host}`,
      db: own === null ? null : { binding: `${upper(appId)}_DB`, databaseName: own.databaseName, databaseId: own.databaseId },
      kv: (Array.isArray(cfg?.kv_namespaces) ? cfg.kv_namespaces : []).map((k) => ({ binding: k.binding, id: k.id })),
      sandbox: {
        worker: sbxWorker,
        origin: `https://${sbxWorker}.${WORKERS_DEV_SUBDOMAIN}.workers.dev`,
        db: sbxOwn === null ? null : { binding: `${upper(appId)}_DB`, databaseName: sbxOwn.database_name, databaseId: sbxOwn.database_id },
      },
    });
  }
  return rows;
}

/**
 * The app ids POST /v1/auth/native/:app serves: every apps/<dir> that constructs
 * SupabaseAuthRepository (assert-auth-callbacks.mjs `appsInScope`) and ships at least one
 * native directory (`TARGET_DIRS`), named by `appIdOf` — the id its callback scheme
 * `com.nikatru.<id>` is built from. Sorted, so the render is stable. An id that is not
 * scheme-safe is listed as it is; the route refuses it, as authCallbackScheme() does.
 */
export function nativeAuthApps(root) {
  const ids = new Set();
  for (const app of appsInScope(root)) {
    if (![...TARGET_DIRS.values()].some((dir) => existsSync(join(app.dir, dir)))) continue;
    try {
      ids.add(appIdOf(app.dir));
    } catch (e) {
      throw new Refusal(`apps/${app.name}/app.yaml does not parse (${e.message}), so its native sign-in route cannot be named.`, 2);
    }
  }
  return [...ids].sort();
}

const MARK = (region) =>
  `// ── GENERATED BEGIN ${region} — ${RENDERER} from ${REGISTER_REL} appWorkers; edit the register and re-render, never these lines ──`;
const END = (region) => `// ── GENERATED END ${region} ──`;

/** The text between the markers of each region, indented as the region's BEGIN line is. */
export function regionTexts(rows, indent) {
  const pad = (n) => ' '.repeat(n);
  const sandboxRows = rows.map((r) => ({ ...r, ...r.sandbox }));
  const prod = productionRegionTexts(rows, pad, indent);
  const sbx = productionRegionTexts(sandboxRows, pad, indent);
  return {
    ...prod,
    'sandbox-app-erasure-endpoints': sbx['app-erasure-endpoints'],
    'sandbox-app-erasure-bindings': sbx['app-erasure-bindings'],
    'sandbox-app-databases': sbx['app-databases'],
  };
}

/** The three region bodies over `rows`. The sandbox regions are the same shapes over
 *  each row's `sandbox` twin, so the two can never be rendered two ways. */
function productionRegionTexts(rows, pad, indent) {
  return {
    'app-erasure-endpoints': `${pad(indent)}"APP_ERASURE_ENDPOINTS": "${rows.map((r) => `${r.appId}=${r.origin}`).join(',')}"`,
    'app-erasure-bindings': rows
      .map((r) =>
        [
          `${pad(indent)}{`,
          `${pad(indent + 2)}"binding": "ERASURE_${upper(r.appId)}",`,
          `${pad(indent + 2)}"service": "${r.worker}",`,
          `${pad(indent + 2)}"entrypoint": "ErasureEntrypoint"`,
          `${pad(indent)}}`,
        ].join('\n'),
      )
      .join(',\n'),
    'app-databases': rows
      .filter((r) => r.db !== null)
      .map((r) =>
        // No comment inside a generated entry: the BEGIN marker says what it is, and every
        // line here keeps the file's line numbers where the hand-written entry had them.
        // The app Worker owns the migrations, so there is never a migrations_dir here.
        [
          `${pad(indent)}{`,
          `${pad(indent + 2)}"binding": "${r.db.binding}",`,
          `${pad(indent + 2)}"database_name": "${r.db.databaseName}",`,
          `${pad(indent + 2)}"database_id": "${r.db.databaseId}"`,
          `${pad(indent)}}`,
        ].join('\n'),
      )
      .join(',\n'),
  };
}

/** `configText` with every region's body replaced. Refuses a region whose markers are missing or duplicated. */
export function renderConfig(configText, rows) {
  const lines = configText.split('\n');
  const out = [];
  for (const region of REGIONS) {
    const begins = lines.filter((l) => l.trim() === MARK(region)).length;
    const ends = lines.filter((l) => l.trim() === END(region)).length;
    if (begins !== 1 || ends !== 1) {
      throw new Refusal(`${PLATFORM_CONFIG_REL} carries ${begins} BEGIN and ${ends} END marker(s) for region ${region}; exactly one of each is required.`);
    }
  }
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const region = REGIONS.find((r) => lines[i].trim() === MARK(r));
    if (!region) continue;
    const indent = lines[i].length - lines[i].trimStart().length;
    let j = i + 1;
    while (lines[j].trim() !== END(region)) j++;
    const body = regionTexts(rows, indent)[region];
    if (body !== '') out.push(body);
    i = j - 1;
  }
  return out.join('\n');
}

/** The generated TypeScript module. `platformKvIds` are the namespace ids the platform already binds. */
export function renderModule(rows, platformKvIds, nativeApps = []) {
  const seen = new Set(platformKvIds);
  const kv = [];
  for (const r of rows) {
    for (const k of r.kv) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      kv.push({ name: `${r.worker}:${k.binding}`, binding: `${upper(r.appId)}_${k.binding}`, id: k.id });
    }
  }
  const targets = rows.filter((r) => r.db !== null);
  return [
    `// GENERATED by ${RENDERER} from ${REGISTER_REL} appWorkers, joined with each app`,
    "// Worker's own D1 (tooling/ci/d1-stores.mjs); NATIVE_AUTH_APPS from apps/. Edit those and re-render; never this file.",
    `// \`node ${RENDERER} --check\` fails on any difference.`,
    '',
    '/** One app database the platform Worker fans out to (src/scheduled.ts) and exports nightly (src/backup/index.ts). */',
    'export interface AppTarget {',
    '  readonly appId: string;',
    '  readonly dbBinding: string;',
    '  readonly databaseName: string;',
    '}',
    '',
    '/** One app KV namespace the platform does not already bind, deduplicated by namespace id. */',
    'export interface AppKv {',
    '  readonly name: string;',
    '  readonly binding: string;',
    '  readonly id: string;',
    '}',
    '',
    'export const APP_TARGETS: readonly AppTarget[] = [',
    ...targets.map((r) => `  { appId: '${r.appId}', dbBinding: '${r.db.binding}', databaseName: '${r.db.databaseName}' },`),
    '];',
    '',
    'export const APP_KV: readonly AppKv[] = [',
    ...kv.map((k) => `  { name: '${k.name}', binding: '${k.binding}', id: '${k.id}' },`),
    '];',
    '',
    '/** Every app that signs in with Supabase and ships a native target (apps/, read as',
    ' *  tooling/ci/assert-auth-callbacks.mjs reads it): the apps POST /v1/auth/native/:app serves. */',
    'export const NATIVE_AUTH_APPS: readonly string[] = [',
    ...nativeApps.map((id) => `  '${id}',`),
    '];',
    '',
  ].join('\n');
}

/** Both files as the register renders them: `{ config, module, kvUnbound }`. */
export function render(root) {
  const rows = appRows(root);
  const cfgAbs = join(root, PLATFORM_CONFIG_REL);
  if (!existsSync(cfgAbs)) throw new Refusal(`${PLATFORM_CONFIG_REL} does not exist under ${root}.`, 2);
  const configText = readFileSync(cfgAbs, 'utf8');
  let platformCfg;
  try {
    platformCfg = parseJsonc(configText);
  } catch (e) {
    throw new Refusal(`${PLATFORM_CONFIG_REL} does not parse (${e.message}).`, 2);
  }
  const platformKv = (platformCfg.kv_namespaces ?? []).map((k) => k.id);
  const module = renderModule(rows, platformKv, nativeAuthApps(root));
  const config = renderConfig(configText, rows);
  // An APP_KV namespace is read by the nightly export through env[binding]: it must be bound.
  const bound = new Set((platformCfg.kv_namespaces ?? []).map((k) => k.binding));
  const kvUnbound = [...module.matchAll(/binding: '([A-Z0-9_]+)', id: '([^']+)'/g)]
    .filter((m) => !bound.has(m[1]))
    .map((m) => `${m[1]} (${m[2]})`);
  if (kvUnbound.length) {
    throw new Refusal(
      `an app Worker binds KV namespace(s) the platform Worker does not: ${kvUnbound.join(', ')}. The nightly export reads ` +
        `only what the platform binds; add each to ${PLATFORM_CONFIG_REL} kv_namespaces under that binding, then re-render.`,
    );
  }
  return { config, module };
}

function main(argv) {
  const check = argv.includes('--check');
  const r = argv.indexOf('--root');
  const root = resolve(r !== -1 ? argv[r + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  let out;
  try {
    out = render(root);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.error(`✗ render-platform-app-block: ${e.code === 2 ? 'COVERAGE LOST — ' : ''}${e.message}`);
    return e.code;
  }
  const targets = [
    [PLATFORM_CONFIG_REL, out.config],
    [MODULE_REL, out.module],
  ];
  const differ = targets.filter(([rel, text]) => !existsSync(join(root, rel)) || readFileSync(join(root, rel), 'utf8') !== text);
  if (check) {
    if (differ.length) {
      for (const [rel] of differ) console.error(`✗ ${rel} is not what ${REGISTER_REL} renders. Run: node ${RENDERER}`);
      return 1;
    }
    console.log(`ok  ${PLATFORM_CONFIG_REL} (${REGIONS.length} generated regions) and ${MODULE_REL} are what ${REGISTER_REL} renders`);
    return 0;
  }
  for (const [rel, text] of differ) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
    console.log(`wrote ${rel}`);
  }
  if (!differ.length) console.log('nothing to write: both files are already what the register renders');
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = main(process.argv.slice(2));
