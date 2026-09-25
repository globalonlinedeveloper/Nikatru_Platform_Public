// ─────────────────────────────────────────────────────────────────────────────
// backend.mjs — the one resolver from an app id to the databases its Worker
// binds. Row O-E2E-LANE-WIRED-TO-ONE-APP.
//
// Until this module the e2e lane was wired to one app by hand: e2e.yml spelled
// out both database ids on six lines, and verify_row, verify_purged and purge
// each read an env key named after that one app. A second app in the matrix
// would have been verified and purged against the first app's database.
//
// `backendOf(appId, { env })` reads services/<appId>-api/wrangler.jsonc — the
// Worker's own deploy config, so the ids here are the ids that Worker writes —
// with the repo's parseJsonc (tooling/ci/d1-sql-inventory.mjs), and returns:
//   appDb      — binding APP_DB's database_id
//   platformDb — binding PLATFORM_DB's database_id
//   apiHost    — apps/<appId>/app.yaml `hosts.api`, for `env: 'production'`
//                only. A non-production env returns null: that Worker has no
//                custom domain, and its workers.dev host is computed by
//                tooling/store/capture-backend.mjs, never read from app.yaml.
// `env: 'sandbox'` (any name but 'production') reads the `env.<name>` block.
//
// It throws BackendRefused, naming the file and the binding, when:
//   · the app id is not a plain slug, or its wrangler.jsonc is unreadable;
//   · the env block, or binding APP_DB / PLATFORM_DB in it, is missing or has
//     no database_id;
//   · a second app's wrangler.jsonc resolves the SAME appDb in the same env —
//     two apps verified and purged against one database is the defect this
//     row names, only moved.
//
// `e2eAppOf(appId)` reads the app's entry in tooling/e2e-leg-register.json
// (`apps.<id>`): the tables the purge deletes from and the table verify_row
// counts. `e2eTargetOrExit(appId, …)` is both, for the scripts' preamble.
//
// CLI:  node tooling/e2e/backend.mjs --app <id> [--env <name>] [--emit-output]
//   Prints which bindings resolved (never the ids). With --emit-output it also
//   appends `platform_db=<id>` to $GITHUB_OUTPUT, for e2e.yml's `backend` step.
//   Only the platform database is handed on: PLATFORM_D1_DATABASE_ID is the
//   switch purge.mjs reads as "this invocation owns the consent artifact", so it
//   stays an env key the workflow sets. The scripts resolve the app database
//   themselves from E2E_APP_ID.
//   Exit 0 resolved; 1 refused; 2 a usage error.
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseJsonc } from '../ci/d1-sql-inventory.mjs';
import { parseYaml } from '../app-yaml/yaml.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));

export const APP_DB_BINDING = 'APP_DB';
export const PLATFORM_DB_BINDING = 'PLATFORM_DB';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export class BackendRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackendRefused';
  }
}

export const wranglerPathOf = (appId) => `services/${appId}-api/wrangler.jsonc`;

/** Every app id with a Worker config under `<root>/services/<id>-api/`. */
export function appIdsWithWorker(root = ROOT) {
  const dir = join(root, 'services');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /-api$/.test(e.name))
    .map((e) => e.name.replace(/-api$/, ''))
    .filter((id) => SLUG.test(id) && existsSync(join(root, wranglerPathOf(id))))
    .sort();
}

function blockOf(appId, env, read) {
  const rel = wranglerPathOf(appId);
  let cfg;
  try {
    cfg = parseJsonc(read(rel));
  } catch (e) {
    throw new BackendRefused(`${rel} could not be read and parsed: ${e.message}`);
  }
  if (env === 'production') return { rel, block: cfg, where: 'the top level' };
  const block = cfg?.env?.[env];
  if (!block || typeof block !== 'object') return { rel, block: null, where: `env.${env}` };
  return { rel, block, where: `env.${env}` };
}

function databaseIdOf({ rel, block, where }, binding) {
  const d = (block?.d1_databases ?? []).find((x) => x?.binding === binding);
  if (!d) throw new BackendRefused(`${rel} ${where} declares no D1 binding ${binding}.`);
  if (typeof d.database_id !== 'string' || d.database_id === '') {
    throw new BackendRefused(`${rel} ${where} binding ${binding} has no database_id.`);
  }
  return d.database_id;
}

/**
 * `{ appDb, platformDb, apiHost }` for one app, read from its Worker's
 * wrangler.jsonc. Options: `env` ('production' or an `env.<name>` block),
 * `root` (the tree to read), `read(repoRelativePath) → text` (defaults to a
 * file read under `root`) and `appIds` (the apps checked for a shared appDb;
 * defaults to every services/<id>-api under `root`).
 */
export function backendOf(appId, { env = 'production', root = ROOT, read, appIds } = {}) {
  if (typeof appId !== 'string' || !SLUG.test(appId)) {
    throw new BackendRefused(`app id ${JSON.stringify(appId)} is not a plain slug, so no Worker config can be named for it.`);
  }
  if (typeof env !== 'string' || !SLUG.test(env)) {
    throw new BackendRefused(`env ${JSON.stringify(env)} is not a plain name.`);
  }
  const readRel = read ?? ((rel) => readFileSync(join(root, rel), 'utf8'));

  const own = blockOf(appId, env, readRel);
  if (!own.block) throw new BackendRefused(`${own.rel} has no \`${own.where}\` block.`);
  const appDb = databaseIdOf(own, APP_DB_BINDING);
  const platformDb = databaseIdOf(own, PLATFORM_DB_BINDING);

  for (const other of appIds ?? appIdsWithWorker(root)) {
    if (other === appId) continue;
    const theirs = blockOf(other, env, readRel);
    if (!theirs.block) continue;
    const d = (theirs.block.d1_databases ?? []).find((x) => x?.binding === APP_DB_BINDING);
    if (d && d.database_id === appDb) {
      throw new BackendRefused(
        `${own.rel} and ${theirs.rel} both bind ${APP_DB_BINDING} to the same database in ${own.where}: ` +
          `apps ${appId} and ${other} would be verified and purged against one database.`,
      );
    }
  }

  let apiHost = null;
  if (env === 'production') {
    const yamlRel = `apps/${appId}/app.yaml`;
    let doc;
    try {
      doc = parseYaml(readRel(yamlRel));
    } catch (e) {
      throw new BackendRefused(`${yamlRel} could not be read and parsed: ${e.message}`);
    }
    apiHost = doc?.hosts?.api;
    if (typeof apiHost !== 'string' || apiHost === '') {
      throw new BackendRefused(`${yamlRel} declares no \`hosts.api\`.`);
    }
  }
  return { appDb, platformDb, apiHost };
}

export const LEG_REGISTER_REL = 'tooling/e2e-leg-register.json';
// The same identifier regex purge.mjs and verify_row.mjs apply again where they
// build their statements, which is where the SQL inventory guard's [R3] looks.
const TABLE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * One app's entry in the leg register, `apps.<appId>`: the tables purge.mjs
 * deletes the throwaway user's rows from (`userTables`) and the one table
 * verify_row.mjs counts (`rowTable`). Both are interpolated into SQL, so each
 * must be a plain identifier, and `rowTable` must be one of `userTables`.
 * Throws BackendRefused naming the register and the key.
 */
export function e2eAppOf(appId, { root = ROOT, read } = {}) {
  const readRel = read ?? ((rel) => readFileSync(join(root, rel), 'utf8'));
  let reg;
  try {
    reg = JSON.parse(readRel(LEG_REGISTER_REL));
  } catch (e) {
    throw new BackendRefused(`${LEG_REGISTER_REL} could not be read and parsed: ${e.message}`);
  }
  const entry = reg?.apps?.[appId];
  if (!entry || typeof entry !== 'object') {
    throw new BackendRefused(`${LEG_REGISTER_REL} has no \`apps.${appId}\` entry.`);
  }
  const { userTables, rowTable } = entry;
  if (!Array.isArray(userTables) || userTables.length === 0 || !userTables.every((t) => typeof t === 'string' && TABLE.test(t))) {
    throw new BackendRefused(`${LEG_REGISTER_REL} \`apps.${appId}.userTables\` must be a non-empty list of plain table names.`);
  }
  if (typeof rowTable !== 'string' || !userTables.includes(rowTable)) {
    throw new BackendRefused(`${LEG_REGISTER_REL} \`apps.${appId}.rowTable\` must be one of its userTables.`);
  }
  return { userTables: [...userTables], rowTable };
}

/**
 * For the e2e scripts, called above their first request: `backendOf` plus the
 * app's register entry, or the refusal printed as `<prefix>: <why>` and
 * `process.exit(code)`. An exit is safe there because no request handle is
 * open yet (verify_purged.mjs's header has the libuv crash an exit over one
 * causes on Windows).
 */
export function e2eTargetOrExit(appId, { env = 'production', code = 1, prefix = 'REFUSED' } = {}) {
  try {
    return { ...backendOf(appId, { env }), ...e2eAppOf(appId) };
  } catch (e) {
    if (!(e instanceof BackendRefused)) throw e;
    console.error(`${prefix}: ${e.message} Nothing was requested.`);
    process.exit(code);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const appId = valueOf('--app');
  const env = valueOf('--env') ?? 'production';
  const emit = args.includes('--emit-output');
  if (!appId) {
    console.error('usage: node tooling/e2e/backend.mjs --app <id> [--env <name>] [--emit-output]');
    process.exit(2);
  }
  if (emit && !process.env.GITHUB_OUTPUT) {
    console.error('backend: --emit-output needs $GITHUB_OUTPUT, and it is not set.');
    process.exit(2);
  }
  let b;
  try {
    b = backendOf(appId, { env });
  } catch (e) {
    if (!(e instanceof BackendRefused)) throw e;
    console.error(`backend: REFUSED — ${e.message}`);
    process.exit(1);
  }
  if (emit) appendFileSync(process.env.GITHUB_OUTPUT, `platform_db=${b.platformDb}\n`);
  console.log(
    `backend: ${appId} (${env}) — ${APP_DB_BINDING} and ${PLATFORM_DB_BINDING} resolved from ${wranglerPathOf(appId)}` +
      (b.apiHost ? `; api host ${b.apiHost}` : '') +
      (emit ? '; platform_db written to $GITHUB_OUTPUT' : ''),
  );
}
