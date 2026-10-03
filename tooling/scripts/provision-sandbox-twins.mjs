#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// provision-sandbox-twins.mjs — create the sandbox twins of the platform's
// production KV namespaces and R2 bucket, and write their ids into every Worker
// config whose env.sandbox binds them.
//
// ⏱ 2026-10-01 · rv2-services-022, row O-SANDBOX-ENV-DROPS-PRODUCTION-BINDINGS.
// The platform's env.sandbox bound CONFIG_KV and nothing else of its kind, and
// subscriptiontracker-api's had no SESSION_REVOKED, so a sandbox E2E could not
// catch a revocation or an erasure defect. The configs now declare every twin
// (tooling/ci/assert-platform-register.mjs limb 8 holds them both ways); the
// three below did not exist in the account, so their entries carry the
// all-zeros placeholder until THIS script creates them and writes the ids in.
// Limb 8 refuses a placeholder in a deployable config, so the gate stays red
// until it has run: a twin in name only is not a twin.
//
// The resources that already exist are NOT here: platform_db_sandbox,
// subscriptiontracker_db_sandbox, platform-config-sandbox and the sandbox
// JWKS_CACHE namespace were created 2026-09-23/24 and their ids are in the
// configs; the sandbox erasure binding names the app's sandbox SCRIPT, which
// deploy-sandbox.yml creates by deploying it.
//
// RULES, each enforced below rather than promised:
//   · CREATE ONLY. Nothing is ever deleted, renamed or overwritten — in the
//     account or in a config. A config entry already holding a real id that
//     differs from the account's is a refusal (exit 1), not a rewrite.
//   · IDEMPOTENT. Every resource is looked up by its exact name first; an
//     existing one is reused. A second run creates nothing and writes nothing.
//   · THE SANDBOX NAMING SPACE ONLY. Every name ends in `-sandbox`; the
//     declaration is checked before any request is sent.
//   · RECORD EACH ID. Every id is written into the configs at once, through
//     tooling/scripts/wrangler-surgery.mjs (structure-scoped, re-parse-verified),
//     and printed by name with a short hash, never the token.
//
// THE TOKEN. CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the
// environment, or else read IN-PROCESS from the gitignored vault
// `.claude/secrets.env` of the MAIN checkout (resolved through
// `git rev-parse --git-common-dir`, so a worktree finds it): the two keys only,
// quotes stripped (provision-backend.mjs's header says why both matter). The
// token is never printed, logged or passed to a child process.
//
// Usage:
//   node tooling/scripts/provision-sandbox-twins.mjs            # plan: read the account, print, write nothing
//   node tooling/scripts/provision-sandbox-twins.mjs --apply    # create what is missing, write the ids
//   node tooling/scripts/provision-sandbox-twins.mjs --list     # offline: the twins and the configs they land in
// Exit 0 = done (or, plan, nothing refused) · 1 = a refusal · 2 = could not read the account or a config.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from '../ci/d1-stores.mjs';
import { workerSet, SERVICES_DIR, WORKER_CONFIG } from '../ci/worker-set.mjs';
import { bindingField, isPlaceholderId, setEnvBindingField, SurgeryRefused } from './wrangler-surgery.mjs';

/** The twins this script owns. `binding` is the name every env.sandbox uses. */
export const TWINS = Object.freeze([
  { kind: 'kv', name: 'session-revoked-sandbox', binding: 'SESSION_REVOKED', twinOf: 'SESSION_REVOKED (aa46ad5002874231931cc5dc5b6e2904)' },
  { kind: 'kv', name: 'signups-sandbox', binding: 'SIGNUPS', twinOf: 'SIGNUPS (d73cf5ffd0fd4d8396012fccd15906ad)' },
  { kind: 'r2', name: 'nikatru-backups-sandbox', binding: 'BACKUPS_R2', twinOf: 'BACKUPS_R2 (nikatru-backups)' },
]);
export const SANDBOX_ENV = 'sandbox';
/** R2 placement, as D1's: a property of the spec, never of who ran the create. */
export const R2_LOCATION = 'apac';

export class Refused extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/** Every refusal of the declaration itself, before any request is sent. */
export function declarationProblems(twins = TWINS) {
  const out = [];
  const seen = new Set();
  for (const t of twins) {
    if (!/^[a-z0-9][a-z0-9-]*-sandbox$/.test(String(t.name))) out.push(`${t.name}: not in the sandbox naming space (\`<name>-sandbox\`).`);
    if (t.kind !== 'kv' && t.kind !== 'r2') out.push(`${t.name}: kind ${t.kind} is neither kv nor r2.`);
    if (seen.has(t.binding)) out.push(`${t.binding}: declared twice.`);
    seen.add(t.binding);
  }
  return out;
}

/** Where each twin's id lands: `[{ twin, config, section, field, current }]` for
 *  every Worker config under services/ whose env.sandbox binds the twin's binding. */
export function placements(root, twins = TWINS) {
  const set = workerSet(root);
  if (set === null || set.workers.length === 0) throw new Refused(`no Worker directory under ${join(root, SERVICES_DIR)}.`, 2);
  const out = [];
  for (const dir of set.workers) {
    const rel = `${SERVICES_DIR}/${dir}/${WORKER_CONFIG}`;
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(join(root, rel), 'utf8'));
    } catch (e) {
      throw new Refused(`${rel} does not parse (${e.message}).`, 2);
    }
    for (const twin of twins) {
      const section = twin.kind === 'kv' ? 'kv_namespaces' : 'r2_buckets';
      const field = twin.kind === 'kv' ? 'id' : 'bucket_name';
      const current = bindingField(cfg, { env: SANDBOX_ENV, section, binding: twin.binding, field });
      if (current === undefined) continue;
      out.push({ twin, config: rel, section, field, current });
    }
  }
  return out;
}

const shortHash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 8);

/** The two credentials, from the environment or the main checkout's vault. Never printed. */
export function credentials(root, env = process.env) {
  const want = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
  const got = Object.fromEntries(want.map((k) => [k, env[k] ?? null]));
  if (want.every((k) => got[k])) return got;
  const common = spawnSync('git', ['-C', root, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  const commonDir = common.status === 0 ? common.stdout.trim() : null;
  const mainRoot = commonDir ? dirname(isAbsolute(commonDir) ? commonDir : resolve(root, commonDir)) : root;
  const vault = join(mainRoot, '.claude', 'secrets.env');
  if (existsSync(vault)) {
    for (const line of readFileSync(vault, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || !want.includes(m[1]) || got[m[1]]) continue;
      got[m[1]] = m[2].trim().replace(/^['"]/, '').replace(/['"]$/, '');
    }
  }
  const missing = want.filter((k) => !got[k]);
  if (missing.length) {
    throw new Refused(`${missing.join(' and ')} not set in the environment and not found in ${vault}. Nothing was read or created.`);
  }
  return got;
}

/** A Cloudflare v4 API client over `fetchImpl`. Every call checks `success`. */
export function cloudflare({ token, account, fetchImpl = globalThis.fetch }) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  const call = async (method, path, body) => {
    let res;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new Refused(`${method} ${path} did not complete (${e.message}).`, 2);
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* reported below */
    }
    if (!res.ok || json?.success !== true) {
      const errs = (json?.errors ?? []).map((x) => `${x.code} ${x.message}`).join('; ') || `HTTP ${res.status}`;
      throw new Refused(`${method} ${path} was refused: ${errs}.`, 2);
    }
    return json;
  };
  return {
    async kvNamespaces() {
      const all = [];
      for (let page = 1; page <= 50; page++) {
        const j = await call('GET', `/storage/kv/namespaces?per_page=100&page=${page}`);
        all.push(...(j.result ?? []));
        if ((j.result ?? []).length < 100) return all;
      }
      throw new Refused('more than 5,000 KV namespaces; the listing was not read to its end.', 2);
    },
    async createKv(title) {
      return (await call('POST', '/storage/kv/namespaces', { title })).result;
    },
    async r2Buckets() {
      return (await call('GET', '/r2/buckets?per_page=1000')).result?.buckets ?? [];
    },
    async createR2(name) {
      return (await call('POST', '/r2/buckets', { name, locationHint: R2_LOCATION })).result;
    },
  };
}

/**
 * The run: resolve every twin against the account (creating it when `apply`),
 * then write each id into its placements. Returns `{ writes, pending }` (the configs
 * written, or under plan the ones that would be); `read`/`write` are `(rel) → text`
 * and `(rel, text) → void`, injected so a test can hold the files in memory.
 */
export async function provision({ root, api, apply, read, write, log = () => {} }) {
  const problems = declarationProblems();
  if (problems.length) throw new Refused(`the twin declaration is refused: ${problems.join(' ')}`);
  const where = placements(root);
  for (const twin of TWINS) {
    if (!where.some((p) => p.twin === twin)) {
      throw new Refused(`no ${SERVICES_DIR}/*/${WORKER_CONFIG} env.${SANDBOX_ENV} binds ${twin.binding}, so ${twin.name} would be created for nothing.`);
    }
  }
  const kv = await api.kvNamespaces();
  const r2 = await api.r2Buckets();
  const ids = new Map();
  for (const twin of TWINS) {
    if (twin.kind === 'kv') {
      const hits = kv.filter((n) => n.title === twin.name);
      if (hits.length > 1) throw new Refused(`${hits.length} KV namespaces are titled ${twin.name}; which one is the twin is not this script's guess.`);
      if (hits.length === 1) {
        ids.set(twin, hits[0].id);
        log(`  exists   kv ${twin.name} → id #${shortHash(hits[0].id)}`);
      } else if (apply) {
        const made = await api.createKv(twin.name);
        if (!made?.id || made.title !== twin.name) throw new Refused(`creating KV ${twin.name} returned no id for that title.`, 2);
        ids.set(twin, made.id);
        log(`  created  kv ${twin.name} → id #${shortHash(made.id)}  (twin of ${twin.twinOf})`);
      } else {
        log(`  would create kv ${twin.name}  (twin of ${twin.twinOf})`);
      }
    } else {
      const hit = r2.find((b) => b.name === twin.name);
      if (hit) {
        ids.set(twin, twin.name);
        log(`  exists   r2 ${twin.name}`);
      } else if (apply) {
        const made = await api.createR2(twin.name);
        if (made?.name !== twin.name) throw new Refused(`creating R2 bucket ${twin.name} did not answer with that name.`, 2);
        ids.set(twin, twin.name);
        log(`  created  r2 ${twin.name} (location ${R2_LOCATION})  (twin of ${twin.twinOf})`);
      } else {
        log(`  would create r2 ${twin.name} (location ${R2_LOCATION})  (twin of ${twin.twinOf})`);
      }
    }
  }
  // Every refusal before any write: a half-recorded set is the state this avoids.
  const edits = new Map();
  for (const p of where) {
    const id = ids.get(p.twin);
    if (id === undefined) continue; // plan mode, not created
    if (p.current === id) continue;
    if (!isPlaceholderId(p.current) && p.current !== '') {
      throw new Refused(
        `${p.config} env.${SANDBOX_ENV} ${p.twin.binding} already names ${p.field} #${shortHash(p.current)}, and the account's ${p.twin.name} is #${shortHash(id)}. ` +
          'This script never overwrites a recorded id: find out which is right, by hand.',
      );
    }
    let text = edits.get(p.config) ?? read(p.config);
    try {
      text = setEnvBindingField(text, { env: SANDBOX_ENV, section: p.section, binding: p.twin.binding, field: p.field, value: id });
    } catch (e) {
      if (e instanceof SurgeryRefused) throw new Refused(`${p.config}: ${e.message}`);
      throw e;
    }
    edits.set(p.config, text);
  }
  const writes = [];
  for (const [rel, text] of edits) {
    if (!apply) continue;
    write(rel, text);
    writes.push(rel);
    log(`  wrote    ${rel}`);
  }
  if (!apply && edits.size) log(`  would write ${[...edits.keys()].join(', ')}`);
  return { writes, pending: apply ? [] : [...edits.keys()] };
}

async function main(argv) {
  const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const apply = argv.includes('--apply');
  const unknown = argv.filter((a) => !['--apply', '--list'].includes(a));
  if (unknown.length) {
    console.error(`✗ unknown argument(s) ${unknown.join(' ')}. Usage: provision-sandbox-twins.mjs [--apply | --list]`);
    return 1;
  }
  try {
    if (argv.includes('--list')) {
      const problems = declarationProblems();
      if (problems.length) throw new Refused(problems.join(' '));
      for (const p of placements(root)) {
        console.log(`  ${p.twin.kind} ${p.twin.name.padEnd(26)} → ${p.config} env.${SANDBOX_ENV} ${p.twin.binding}${isPlaceholderId(p.current) ? '  (placeholder: not yet created)' : ''}`);
      }
      return 0;
    }
    const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = credentials(root);
    console.log(`${apply ? 'APPLY' : 'PLAN (no --apply: nothing is created or written)'} — ${TWINS.length} sandbox twin(s), account #${shortHash(account)}`);
    const out = await provision({
      root,
      api: cloudflare({ token, account }),
      apply,
      read: (rel) => readFileSync(join(root, rel), 'utf8'),
      write: (rel, text) => writeFileSync(join(root, rel), text),
      log: (l) => console.log(l),
    });
    console.log(apply ? `✅ done: ${out.writes.length} config(s) written. Nothing was deleted.` : '✅ plan only. Re-run with --apply.');
    return 0;
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    console.error(`✗ provision-sandbox-twins: ${e.code === 2 ? 'COVERAGE LOST — ' : ''}${e.message}`);
    return e.code;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exitCode = await main(process.argv.slice(2));
