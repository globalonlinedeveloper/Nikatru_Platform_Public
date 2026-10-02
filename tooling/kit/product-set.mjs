// ─────────────────────────────────────────────────────────────────────────────
// product-set.mjs — every product of every kind, and the ONE set of ids they
// claim, read from the tree.
//
// Rows O-NEW-PRODUCT-HAS-NO-READOUT and O-NEW-PRODUCT-READOUT-SAYS-DONE-FOR-UNDONE-STEPS
// (rv2-newproduct-014, -015).
//
// ── THE KIND ─────────────────────────────────────────────────────────────────
// The readout planned every id as an app: an extension the corpus already lists
// was told to create a Pages project and mason-stamp a Flutter app. A product's
// kind is where its slug is published, and PRODUCT_REGISTERS
// (contracts/entitlement/bundle.js) names that register per kind; productsOf()
// reads them through readProducts() (tooling/bundle-availability.mjs), the same
// reader the bundle derivation and tag-owner.mjs use. Two kinds are DECLARED with
// `register: null` today, and for those the tree is the register:
//   · service — a Worker directory (tooling/ci/worker-set.mjs) that is not an
//     app's own `<app>-api`; its id is the directory less a trailing `-api`
//     (stamp-service.mjs stamps `services/<id>-api`);
//   · site — a site directory (tooling/ci/site-set.mjs).
// When either kind gains a register, its PRODUCT_REGISTERS row gains the path,
// readProducts() reads it, and the tree derivation here switches off by itself
// (it runs only for a kind whose register is null).
//
// ── THE CLAIMED-ID SET ───────────────────────────────────────────────────────
// A product id was unique only inside its own register, and contracts/app-id
// reserves language keywords, never our own names. A backend app with id
// `platform` would get APP_DB `platform_db`, and provision-backend.mjs's
// idempotent `d1 info` would find the LIVE platform database and bind the new
// app's migrations to it. claimsOf() is every name the tree already spends, each
// attributed to the product that spends it:
//   · every product's id, in every kind;
//   · every Worker directory, its deployed `name`, and every D1 `database_name`
//     its wrangler.jsonc binds, by STEM (`<x>-api` and `<x>_db` claim `x`);
//   · the first label of every `*.nikatru.com` host the platform register or the
//     monitor register names (`config`, `vault`, `www` …), by the same stem.
// A name whose stem a product already claims is attributed to that product, so
// app #1's own Worker, database and API host are app #1's and clash with nothing.
// A name no product claims is attributed to the thing itself (`database:x_db`,
// `host:vault.nikatru.com`), so it clashes with every new id.
//
// Pure over the tree: reads, never writes, no network.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT_REGISTERS } from '../../contracts/entitlement/bundle.js';
import { readProducts } from '../bundle-availability.mjs';
import { parseJsonc } from '../ci/d1-sql-inventory.mjs';
import { siteSet, SITES_DIR, SITE_ENTRY } from '../ci/site-set.mjs';
import { workerSet, SERVICES_DIR, WORKER_CONFIG, REGISTER as PLATFORM_REGISTER } from '../ci/worker-set.mjs';

/** The kinds the readout has a step list for. `bundle` and `script` are not planned here. */
export const PLANNED_KINDS = Object.freeze(['app', 'extension', 'service', 'site']);

/** The monitor register, whose hosts are names the platform already answers on. */
export const MONITOR_REGISTER = 'tooling/monitor-register.json';
/** The apex every claimed host label hangs off. */
export const APEX = 'nikatru.com';

const nullRegisterKinds = () => new Set(PRODUCT_REGISTERS.filter((r) => r.register === null).map((r) => r.kind));

/** Every app id the tree knows: each app register slug, and each `apps/<id>/app.yaml`
 *  (a stamped app whose catalogue row the site chain has not written yet is still an
 *  app, and its `<id>-api` Worker is still its own, never a service). */
function appIdsOf(root, products) {
  const ids = new Set(products.filter((p) => p.kind === 'app').map((p) => p.id));
  const apps = join(root, 'apps');
  if (existsSync(apps)) {
    for (const d of readdirSync(apps)) if (existsSync(join(apps, d, 'app.yaml'))) ids.add(d);
  }
  return ids;
}

/** A Worker directory's owner: the app whose own Worker it is, or the service it is. */
export function workerOwner(dir, appIds) {
  const stem = dir.replace(/-api$/, '');
  if (dir !== stem && appIds.has(stem)) return { kind: 'app', id: stem };
  return { kind: 'service', id: stem };
}

/**
 * `{ products: [{ id, kind, source, status }], problems }` — every product of
 * every kind. `problems` are readProducts()'s (a register that could not be
 * read); a caller must not read an empty answer as "no product".
 */
export function productsOf(root) {
  const { products: registered, problems } = readProducts(root);
  const products = registered.map((p) => ({ id: p.slug, kind: p.kind, source: p.register, status: p.status }));
  const derived = nullRegisterKinds();
  const appIds = appIdsOf(root, products);
  if (derived.has('service')) {
    for (const dir of workerSet(root)?.workers ?? []) {
      const o = workerOwner(dir, appIds);
      if (o.kind === 'service') products.push({ id: o.id, kind: 'service', source: `${SERVICES_DIR}/${dir}/${WORKER_CONFIG}`, status: null });
    }
  }
  if (derived.has('site')) {
    for (const s of siteSet(root)?.sites ?? []) products.push({ id: s, kind: 'site', source: `${SITES_DIR}/${s}/${SITE_ENTRY}`, status: null });
  }
  return { products, problems };
}

/** The kinds `id` is a product of, in PRODUCT_REGISTERS order, each with its source. */
export function kindsOf(root, id) {
  const { products, problems } = productsOf(root);
  return { kinds: products.filter((p) => p.id === id).map((p) => ({ kind: p.kind, source: p.source })), problems };
}

const readJson = (root, rel) => {
  try {
    return JSON.parse(readFileSync(join(root, ...rel.split('/')), 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Every claimed name: `Map<id, [{ owner, as, source }]>`, `owner` being
 * `"<kind>:<id>"` of the product the name is attributed to, or the thing itself.
 */
export function claimsOf(root) {
  const claims = new Map();
  const add = (id, owner, as, source) => {
    if (!claims.has(id)) claims.set(id, []);
    claims.get(id).push({ owner, as, source });
  };
  const { products, problems } = productsOf(root);
  for (const p of products) add(p.id, `${p.kind}:${p.id}`, `${p.kind} id`, p.source);
  const appIds = appIdsOf(root, products);
  const workers = workerSet(root)?.workers ?? [];
  /** The owner of a stem, or null: a product (an app or service first, then any kind),
   *  else the app or service whose Worker directory carries that stem. */
  const workerOwners = new Map(workers.map((dir) => workerOwner(dir, appIds)).map((o) => [o.id, `${o.kind}:${o.id}`]));
  const ownerOfStem = (stem) => {
    const mine = products.filter((p) => p.id === stem);
    const hit = mine.find((p) => p.kind === 'app' || p.kind === 'service') ?? mine[0];
    return hit ? `${hit.kind}:${hit.id}` : workerOwners.get(stem) ?? null;
  };

  for (const dir of workers) {
    const o = workerOwner(dir, appIds);
    const owner = `${o.kind}:${o.id}`;
    const rel = `${SERVICES_DIR}/${dir}/${WORKER_CONFIG}`;
    add(o.id, owner, 'Worker directory', `${SERVICES_DIR}/${dir}`);
    let cfg = null;
    try {
      cfg = parseJsonc(readFileSync(join(root, SERVICES_DIR, dir, WORKER_CONFIG), 'utf8'));
    } catch (e) {
      problems.push(`${rel} does not parse (${e.message}), so the names it spends cannot be read`);
      continue;
    }
    if (typeof cfg?.name === 'string' && cfg.name !== '') {
      const stem = cfg.name.replace(/-api$/, '');
      add(stem, ownerOfStem(stem) ?? owner, `Worker name "${cfg.name}"`, rel);
    }
    for (const db of Array.isArray(cfg?.d1_databases) ? cfg.d1_databases : []) {
      if (typeof db?.database_name !== 'string') continue;
      const stem = db.database_name.replace(/_db$/, '');
      add(stem, ownerOfStem(stem) ?? `database:${db.database_name}`, `D1 database "${db.database_name}"`, rel);
    }
  }

  const hosts = [];
  const platform = readJson(root, PLATFORM_REGISTER);
  for (const row of [platform?.servingWorker, ...(platform?.appWorkers ?? []), ...(platform?.edgeWorkers ?? [])]) {
    for (const h of Array.isArray(row?.hosts) ? row.hosts : []) hosts.push({ host: String(h), source: PLATFORM_REGISTER });
  }
  const monitors = readJson(root, MONITOR_REGISTER);
  for (const h of Array.isArray(monitors?.hosts) ? monitors.hosts : []) {
    if (typeof h?.hostname === 'string') hosts.push({ host: h.hostname, source: MONITOR_REGISTER });
  }
  const suffix = `.${APEX}`;
  for (const { host, source } of hosts) {
    const h = host.toLowerCase();
    if (!h.endsWith(suffix)) continue;
    const label = h.slice(0, -suffix.length);
    if (label === '' || label.includes('.')) continue;
    const stem = label.replace(/-api$/, '');
    add(stem, ownerOfStem(stem) ?? `host:${h}`, `host ${h}`, source);
  }
  return { claims, problems };
}

/**
 * The claims on `id` that are not the product `kind:id` itself — the names a
 * new product `id` of `kind` would collide with. Each `{ owner, as, source }`,
 * one per distinct owner and use.
 */
export function clashesOf(root, id, kind) {
  const { claims, problems } = claimsOf(root);
  const self = `${kind}:${id}`;
  const seen = new Set();
  const clashes = [];
  for (const c of claims.get(id) ?? []) {
    if (c.owner === self) continue;
    const key = `${c.owner}|${c.as}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clashes.push(c);
  }
  return { clashes, problems };
}

/** One sentence naming every clash, for a refusal. */
export function describeClashes(id, clashes) {
  return `"${id}" is already claimed: ${clashes.map((c) => `${c.as} (${c.source}, owned by ${c.owner})`).join('; ')}`;
}
