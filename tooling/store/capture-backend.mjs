// ─────────────────────────────────────────────────────────────────────────────
// capture-backend.mjs — the backend a store capture drives, computed from the
// two Workers' wrangler.jsonc files, and the refusals that keep a capture off
// production.
//
// Row O-STORE-CAPTURE-WRITES-UNATTRIBUTED-ROWS, first line: "Captures run
// against a non-production endpoint". Until this module the capture lane took
// API_BASE_URL from a repository secret that named the production API, so every
// live drive's consent answer and seeded subscriptions landed in production
// platform_db and subscriptiontracker_db.
//
// F1 — A HOST DEFINE ALONE DOES NOT PIN THE API. `apiClientProvider` prefers the
// resolved config document's `apiBaseUrl`, and under SKIP_REMOTE_CONFIG=true
// (capture-network-posture.mjs) that document is the compiled seed
// `kAppDefaultConfig`, whose `apiBaseUrl` is the production literal. So the
// capture also passes PIN_BACKEND_HOSTS=true: `AppConfig.pinnedBackend` reads
// it, `apiBaseFor` in lib/state/providers/subscriptions.dart obeys it, and the
// capture harness refuses to run a build that can reach an API unpinned.
//
// What this module refuses, each with a named limb:
//   · sandboxBackend() — a Worker config with no `env.sandbox`; an `env.sandbox`
//     that does not declare `routes: []`, `workers_dev: true` and
//     `triggers.crons: []` explicitly (wrangler INHERITS those three keys from
//     the top level, so an absent one binds the production custom domain or a
//     production cron to the sandbox script); a sandbox script name equal to a
//     top-level script name (a `--env sandbox` deploy would replace production);
//     a sandbox D1, KV or ratelimit id that is empty or equal to any top-level
//     id in either config.
//   · captureBackendDefines() — a caller env that carries API_BASE_URL,
//     PLATFORM_BASE_URL or CONFIG_BASE_URL at all, because a supplied host is how
//     production reached the capture; a final host that is a production host or
//     is not the sandbox host computed here; a SUPABASE_URL that differs from
//     the one the sandbox Workers verify tokens against.
//   · assertCaptureDefines() — any dart-define KEY outside
//     CAPTURE_DEFINE_ALLOWLIST, by name. GLITCHTIP_DSN would send a capture's
//     errors to production error tracking and REVENUECAT_KEY would open a real
//     purchase path; neither has a place in a store capture.
//
// Identity stays on the production Supabase project (owner decision D1 = a): the
// capture signs in a throwaway user there, and only the two Workers move.
//
// CLI:  node tooling/store/capture-backend.mjs --print-host <worker>
// prints the sandbox origin of `platform` or `subscriptiontracker-api`, for
// deploy-sandbox.yml's smoke and the capture jobs' health preflight, so neither
// workflow spells a host out. Exit 0 printed; 1 refused; 2 a usage error.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseJsonc } from '../ci/d1-sql-inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(HERE, '..', '..'));

/** The two Workers a capture binary reaches. Both are routed: the board a
 *  capture photographs is written by subscriptiontracker-api, and the consent
 *  answer and analytics go to platform. */
export const CAPTURE_WORKERS = Object.freeze({
  platform: 'services/platform/wrangler.jsonc',
  'subscriptiontracker-api': 'services/subscriptiontracker-api/wrangler.jsonc',
});

/** The account's workers.dev subdomain. A sandbox script has no custom domain
 *  (`routes: []`), so this is the only place it answers. */
export const WORKERS_DEV_SUBDOMAIN = 'nikatru';

/** The host defines a capture must never take from its environment. */
export const SUPPLIED_HOST_KEYS = Object.freeze(['API_BASE_URL', 'PLATFORM_BASE_URL', 'CONFIG_BASE_URL']);

/** Every dart-define KEY capture-play-screenshots.mjs pushes, read from its push
 *  sites: `need` (the identity four), the stamp, the Turnstile site key, the
 *  proof flag, `launchDefineArgs()`, the backend pairs below and the per-capture
 *  `storeViewDefineArgs(cap)`. A key outside this set is refused by name. */
export const CAPTURE_DEFINE_ALLOWLIST = Object.freeze([
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'E2E_EMAIL',
  'E2E_PASSWORD',
  'API_BASE_URL',
  'PLATFORM_BASE_URL',
  'CONFIG_BASE_URL',
  'PIN_BACKEND_HOSTS',
  'APP_VERSION',
  'TURNSTILE_SITE_KEY',
  'STORE_CAPTURE_ALLOW_DEMO',
  'SKIP_REMOTE_CONFIG',
  'STORE_CAPTURE_VIEW',
]);

export class CaptureBackendRefused extends Error {
  constructor(limb, message) {
    super(`[${limb}] ${message}`);
    this.name = 'CaptureBackendRefused';
    this.limb = limb;
  }
}

const defaultRead = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Binding → id for every D1, KV and ratelimit a config block declares. */
function idsOf(block) {
  const ids = {};
  for (const d of block?.d1_databases ?? []) ids[`d1:${d.binding}`] = d.database_id;
  for (const k of block?.kv_namespaces ?? []) ids[`kv:${k.binding}`] = k.id;
  for (const r of block?.ratelimits ?? []) ids[`ratelimit:${r.name}`] = r.namespace_id;
  return ids;
}

const originOf = (pattern) => `https://${String(pattern).replace(/\/.*$/, '')}`;
const workersDevOrigin = (script) => `https://${script}.${WORKERS_DEV_SUBDOMAIN}.workers.dev`;

/**
 * Reads both Workers' configs through `read(repoRelativePath) → text` and
 * returns, per Worker, `{ scriptName, sandboxHost, productionHosts,
 * sandboxIds, productionIds, supabaseUrl }`. Throws CaptureBackendRefused on
 * any of the refusals in the header.
 */
export function sandboxBackend({ read = defaultRead } = {}) {
  const parsed = [];
  for (const [worker, rel] of Object.entries(CAPTURE_WORKERS)) {
    let cfg;
    try {
      cfg = parseJsonc(read(rel));
    } catch (e) {
      throw new CaptureBackendRefused('unreadable', `${rel} could not be read and parsed: ${e.message}`);
    }
    if (typeof cfg?.name !== 'string' || !cfg.name) {
      throw new CaptureBackendRefused('unreadable', `${rel} declares no top-level \`name\`, so no sandbox script name can be computed.`);
    }
    parsed.push({ worker, rel, cfg });
  }

  const topIds = new Map();
  for (const { worker, cfg } of parsed) {
    for (const [binding, id] of Object.entries(idsOf(cfg))) {
      if (id !== undefined && id !== null && id !== '') topIds.set(String(id), `${worker} top-level ${binding}`);
    }
  }
  const topNames = new Set(parsed.map(({ cfg }) => cfg.name));

  const backend = {};
  for (const { worker, rel, cfg } of parsed) {
    const sbx = cfg.env?.sandbox;
    if (!sbx || typeof sbx !== 'object') {
      throw new CaptureBackendRefused('env-missing', `${rel} has no \`env.sandbox\` block, so ${worker} has no sandbox to capture against.`);
    }
    if (!Array.isArray(sbx.routes) || sbx.routes.length !== 0 || 'route' in sbx) {
      throw new CaptureBackendRefused(
        'routes',
        `${rel} env.sandbox must declare \`"routes": []\` explicitly: wrangler inherits the top-level routes, which bind the production custom domain.`,
      );
    }
    if (sbx.workers_dev !== true) {
      throw new CaptureBackendRefused(
        'workers-dev',
        `${rel} env.sandbox must declare \`"workers_dev": true\` explicitly: with no route it is the only address the sandbox script answers on.`,
      );
    }
    if (!Array.isArray(sbx.triggers?.crons) || sbx.triggers.crons.length !== 0) {
      throw new CaptureBackendRefused(
        'crons',
        `${rel} env.sandbox must declare \`"triggers": { "crons": [] }\` explicitly: wrangler inherits the top-level crons.`,
      );
    }
    const scriptName = sbx.name ?? `${cfg.name}-sandbox`;
    if (topNames.has(scriptName)) {
      throw new CaptureBackendRefused(
        'script-name',
        `${rel} env.sandbox resolves to the script name "${scriptName}", which is a production Worker: a --env sandbox deploy would replace it.`,
      );
    }
    const sandboxIds = idsOf(sbx);
    for (const [binding, id] of Object.entries(sandboxIds)) {
      if (id === undefined || id === null || id === '') {
        throw new CaptureBackendRefused('id-missing', `${rel} env.sandbox ${binding} declares no id.`);
      }
      if (topIds.has(String(id))) {
        throw new CaptureBackendRefused(
          'id-reuse',
          `${rel} env.sandbox ${binding} = ${id} is also the ${topIds.get(String(id))}: a sandbox binding on a production store writes production.`,
        );
      }
    }
    const routes = Array.isArray(cfg.routes) ? cfg.routes : cfg.route ? [cfg.route] : [];
    backend[worker] = {
      scriptName,
      sandboxHost: workersDevOrigin(scriptName),
      productionHosts: [
        ...routes.map((r) => originOf(typeof r === 'string' ? r : r?.pattern)),
        workersDevOrigin(cfg.name),
      ],
      sandboxIds,
      productionIds: idsOf(cfg),
      supabaseUrl: sbx.vars?.SUPABASE_URL ?? null,
    };
  }
  return backend;
}

/** Every top-level D1 database id across both configs — what a capture purge
 *  must never be pointed at. */
export function productionD1Ids(backend) {
  const ids = new Set();
  for (const w of Object.values(backend)) {
    for (const [binding, id] of Object.entries(w.productionIds)) if (binding.startsWith('d1:')) ids.add(String(id));
  }
  return ids;
}

/**
 * The backend argv pairs for `flutter drive`: API_BASE_URL, PLATFORM_BASE_URL
 * and CONFIG_BASE_URL at the sandbox hosts, and PIN_BACKEND_HOSTS=true (F1).
 * Throws CaptureBackendRefused on a supplied host, a production or foreign
 * host, or a SUPABASE_URL the sandbox Workers do not verify against.
 */
export function captureBackendDefines({ backend, env = process.env } = {}) {
  for (const k of SUPPLIED_HOST_KEYS) {
    if (env[k] !== undefined) {
      throw new CaptureBackendRefused(
        'supplied-host',
        `${k} is set in this environment. A capture computes its hosts from the wrangler configs; a host handed in by the caller is how production reached the capture lane. Remove ${k} from the step's env.`,
      );
    }
  }
  const api = backend?.['subscriptiontracker-api'];
  const platform = backend?.platform;
  if (!api || !platform) {
    throw new CaptureBackendRefused('env-missing', 'the backend names no platform or subscriptiontracker-api Worker.');
  }
  const hosts = {
    API_BASE_URL: api.sandboxHost,
    PLATFORM_BASE_URL: platform.sandboxHost,
    CONFIG_BASE_URL: platform.sandboxHost,
  };
  const production = new Set(Object.values(backend).flatMap((w) => w.productionHosts));
  const computed = new Set(Object.values(backend).map((w) => w.sandboxHost));
  const shape = new RegExp(`^https://[a-z0-9-]+-sandbox\\.${WORKERS_DEV_SUBDOMAIN}\\.workers\\.dev$`);
  for (const [k, host] of Object.entries(hosts)) {
    if (production.has(host)) {
      throw new CaptureBackendRefused('production-host', `${k} would be ${host}, a production host.`);
    }
    if (!computed.has(host) || !shape.test(host)) {
      throw new CaptureBackendRefused('foreign-host', `${k} would be ${host}, which is not a sandbox host computed from the wrangler configs.`);
    }
  }
  for (const [worker, w] of Object.entries(backend)) {
    if (!env.SUPABASE_URL || env.SUPABASE_URL !== w.supabaseUrl) {
      throw new CaptureBackendRefused(
        'supabase-mismatch',
        `SUPABASE_URL does not equal ${worker}'s env.sandbox vars.SUPABASE_URL, so the sandbox Worker could not verify the capture's session tokens.`,
      );
    }
  }
  return [
    ...Object.entries(hosts).flatMap(([k, host]) => ['--dart-define', `${k}=${host}`]),
    '--dart-define',
    'PIN_BACKEND_HOSTS=true',
  ];
}

/** The backend pairs a capture run pushes. `--proof` is a demo build with no
 *  API at all, so it reads no config and gets `[]`; every other run gets
 *  captureBackendDefines over sandboxBackend(). The allowlist below applies to
 *  both. */
export function backendDefinesForRun({ proof, env = process.env, read = defaultRead } = {}) {
  if (proof) return [];
  return captureBackendDefines({ backend: sandboxBackend({ read }), env });
}

/** Throws CaptureBackendRefused naming every dart-define key outside
 *  CAPTURE_DEFINE_ALLOWLIST. Accepts both `--dart-define K=V` and
 *  `--dart-define=K=V`; a define file is refused, since its keys are unread. */
export function assertCaptureDefines(args) {
  const allowed = new Set(CAPTURE_DEFINE_ALLOWLIST);
  const refused = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    let pair = null;
    if (a === '--dart-define') {
      if (i + 1 >= args.length) {
        throw new CaptureBackendRefused('define-allowlist', 'a trailing --dart-define carries no KEY=value.');
      }
      pair = String(args[++i]);
    } else if (a.startsWith('--dart-define=')) {
      pair = a.slice('--dart-define='.length);
    } else if (a.startsWith('--dart-define-from-file')) {
      throw new CaptureBackendRefused('define-allowlist', `${a} passes keys this check cannot read.`);
    }
    if (pair === null) continue;
    const key = pair.split('=')[0];
    if (!allowed.has(key)) refused.push(key);
  }
  if (refused.length) {
    throw new CaptureBackendRefused(
      'define-allowlist',
      `dart-define key(s) outside CAPTURE_DEFINE_ALLOWLIST: ${[...new Set(refused)].join(', ')}.`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--print-host');
  const worker = i === -1 ? undefined : args[i + 1];
  if (!worker || !Object.hasOwn(CAPTURE_WORKERS, worker)) {
    console.error(`usage: node tooling/store/capture-backend.mjs --print-host <${Object.keys(CAPTURE_WORKERS).join('|')}>`);
    process.exit(2);
  }
  try {
    console.log(sandboxBackend()[worker].sandboxHost);
  } catch (e) {
    if (!(e instanceof CaptureBackendRefused)) throw e;
    console.error(`capture-backend: REFUSED — ${e.message}`);
    process.exit(1);
  }
}
