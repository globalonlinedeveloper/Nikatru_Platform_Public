#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-worker-versions.mjs — THE LIVE WORKER IS THE LEDGER'S NEWEST RECORD
// (PB-06, row O-LIVE-DUTY-RED-BLOCKS-THE-FIX-DEPLOY, folding
// O-WORKER-LIVE-VERSION-UNWATCHED).
//
// ── THE MEASURED HOLE ────────────────────────────────────────────────────────
// deploy-workers.yml writes one GitHub Deployment per Worker it ships
// (tooling/ci/record-deployment.mjs <unit> <url>), and that ledger is what
// rollback.mjs, plan-deploy.mjs and check-prod-provenance.mjs read as "what is
// live". Nothing ever re-read the Worker to see whether that is still TRUE. A
// `wrangler rollback` from a laptop, a dashboard "deploy previous version", or a
// deploy whose record step failed all leave the ledger naming one build while
// another one answers — and every reader downstream then reasons from the
// wrong build.
//
// ── WHAT IS GRADED ───────────────────────────────────────────────────────────
// The unit set is DERIVED from deploy-workers.yml, never listed: every
// `record-deployment.mjs <unit> <url>` it runs, with the app-worker matrix line
// expanded through tooling/ci/worker-set.mjs. Each unit is read ONE of two ways:
//   · HEALTH  — the platform Worker and every app Worker answer `/v1/health`
//               with `build` = the RELEASE var deploy-workers.yml sets to
//               github.sha. It must EQUAL the newest ledger record's `sha`.
//   · SHIELD  — services/edge-shield has no health route and must not grow one
//               on either box's host. If its `x-nikatru-shield` header carries a
//               commit (lane fix-deploy-lane-order adds it), that is compared
//               like `build`. Until then its ACTIVE deployment's version is read
//               through the Cloudflare API with CLOUDFLARE_READ_TOKEN and must
//               equal the `worker_version_id` the ledger record carries.
// A recorded unit that is neither is COVERAGE LOST: a new Worker in the deploy
// lane cannot silently fall outside this check.
//
// EXIT CODES (AGENTS.md): 0 every unit serves the ledger's newest build · 1 a
// unit serves another build · 2 COULD NOT LOOK — no unit derived, a ledger or a
// live read that did not answer, a record with nothing to compare, an
// unclassified unit. 2 beats 1.
//
// 🔴 `process.exit()` IS NOT USED, for check-pages-deployments.mjs's reason: an
// undici keep-alive socket is still open, and the libuv assertion aborts the
// process on Windows. `process.exitCode` is set instead.
//
// Usage:  node tooling/ops/check-worker-versions.mjs [--root DIR] [--fixture FILE]
// Env:    GITHUB_TOKEN | GH_TOKEN (ledger read), GITHUB_REPOSITORY,
//         CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (the shield's fallback read)
// `--fixture` answers every read from a file (`{ ledger, health, shieldHeader,
// cloudflare }`, keyed by unit) and touches no network: the red control.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appWorkerMatrix } from '../ci/worker-set.mjs';
import { parseWorkflow } from '../ci/workflow-scan.mjs';
import { stripSourceComments } from '../ci/text-reductions.mjs';
import { CouldNotLook, transientLook, isTransientStatus, readWithBoundedRetry, classifyThrown } from './bounded-retry.mjs';
import { SHIELD_HEADER, PROBES as SHIELD_PROBES, EDGE_CONFIG_REL } from './check-edge-shield.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEPLOY_WORKERS_REL = '.github/workflows/deploy-workers.yml';
export const HEALTH_PATH = '/v1/health';
export const DEFAULT_REPOSITORY = 'globalonlinedeveloper/Nikatru_Platform_Public';
/** A full commit, which is what RELEASE and the ledger both carry. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** The edge shield's script name, read from its wrangler config, never typed. */
export function shieldScriptName(root) {
  const p = join(root, EDGE_CONFIG_REL);
  if (!existsSync(p)) return null;
  const m = stripSourceComments(readFileSync(p, 'utf8')).match(/"name"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

/** PURE. Every `record-deployment.mjs <unit> <url>` call in a workflow text, in
 *  order. A unit that is a `${{ … }}` expression is returned as `matrix: true`. */
export function recordedUnits(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/record-deployment\.mjs\s+(\S+)\s+(\S+)/g)) {
    const [unit, url] = [m[1], m[2]];
    out.push({ unit, url, matrix: unit.includes('${{') });
  }
  return out;
}

/** The units to grade, derived. `{ units, problems }`; a problem is COVERAGE LOST. */
export function deriveUnits(root, { matrix = appWorkerMatrix } = {}) {
  const problems = [];
  // Through the ONE workflow parser (comments blanked), never a second text read.
  const wf = parseWorkflow(root, DEPLOY_WORKERS_REL);
  if (!wf) return { units: [], problems: [`${DEPLOY_WORKERS_REL} is not in the tree, so no Worker unit could be derived`] };
  const shield = shieldScriptName(root);
  if (!shield) problems.push(`${EDGE_CONFIG_REL} names no script, so the shield unit cannot be told apart`);
  const units = [];
  const seen = new Set();
  for (const r of recordedUnits(wf.lines.map((l) => l.text).join('\n'))) {
    if (r.matrix) {
      let m;
      try {
        m = matrix(root);
      } catch (e) {
        problems.push(`the app-worker matrix did not derive: ${e.message}`);
        continue;
      }
      if (m?.lost) problems.push(`the app-worker matrix is LOST: ${m.lost}`);
      for (const e of m?.entries ?? []) {
        if (seen.has(e.worker)) continue;
        seen.add(e.worker);
        units.push({ unit: e.worker, how: 'health', health: e.smokeUrl ?? `${e.origin}${HEALTH_PATH}` });
      }
      continue;
    }
    if (seen.has(r.unit)) continue;
    seen.add(r.unit);
    if (r.unit === shield) units.push({ unit: r.unit, how: 'shield', script: shield });
    else if (r.unit === 'platform') units.push({ unit: r.unit, how: 'health', health: `${r.url.replace(/\/+$/, '')}${HEALTH_PATH}` });
    else units.push({ unit: r.unit, how: 'unclassified' });
  }
  if (units.length === 0) problems.push(`${DEPLOY_WORKERS_REL} records no Worker unit, so nothing would be graded`);
  return { units, problems };
}

/** PURE. One unit's verdict: `{ code, line }`. `ledger` is the newest Deployment
 *  `{ id, sha, payload }`; `live` is what the Worker answered:
 *  `{ build }` (health or a shield header carrying a commit) or `{ versionId }`. */
export function judgeUnit(u, ledger, live) {
  if (!ledger || typeof ledger.sha !== 'string' || !FULL_SHA.test(ledger.sha.toLowerCase())) {
    return { code: 2, line: `?   ${u.unit} — the ledger holds no Deployment with a full sha, so there is nothing to compare the live Worker against.` };
  }
  const want = ledger.sha.toLowerCase();
  if (typeof live?.build === 'string') {
    const got = live.build.toLowerCase();
    if (!FULL_SHA.test(got)) return { code: 2, line: `?   ${u.unit} — the live build is "${live.build}", not a commit, so it cannot be compared.` };
    if (got === want) return { code: 0, line: `ok  ${u.unit} — live build ${got.slice(0, 12)} is the ledger's newest record (Deployment ${ledger.id ?? '?'}).` };
    return {
      code: 1,
      line:
        `✗   ${u.unit} — live build ${got.slice(0, 12)} is NOT the ledger's newest record ${want.slice(0, 12)} (Deployment ${ledger.id ?? '?'}). ` +
        'Production serves a build the ledger does not name: a rollback or a deploy outside deploy-workers.yml, or a record that never landed.',
    };
  }
  if (typeof live?.versionId === 'string') {
    const recorded = ledger.payload?.worker_version_id;
    if (typeof recorded !== 'string' || recorded === '') {
      return {
        code: 2,
        line:
          `?   ${u.unit} — the ledger's newest record (${want.slice(0, 12)}, Deployment ${ledger.id ?? '?'}) carries no worker_version_id, ` +
          `so the active version ${live.versionId} cannot be tied to a commit.`,
      };
    }
    if (recorded.toLowerCase() === live.versionId.toLowerCase()) {
      return { code: 0, line: `ok  ${u.unit} — active version ${live.versionId} is the ledger's newest record (${want.slice(0, 12)}).` };
    }
    return {
      code: 1,
      line: `✗   ${u.unit} — active version ${live.versionId} is NOT the version the ledger's newest record (${want.slice(0, 12)}) deployed, ${recorded}.`,
    };
  }
  return { code: 2, line: `?   ${u.unit} — no live version was read.` };
}

/** PURE. The active version of a `GET …/workers/scripts/<s>/deployments` body:
 *  the newest deployment's version at 100%. A split rollout is not one build. */
export function activeVersionOf(body) {
  const deployments = body?.result?.deployments;
  if (!Array.isArray(deployments) || deployments.length === 0) return null;
  const newest = [...deployments].sort((a, b) => String(b?.created_on ?? '').localeCompare(String(a?.created_on ?? '')))[0];
  const full = (newest?.versions ?? []).filter((v) => Number(v?.percentage) === 100);
  return full.length === 1 && typeof full[0].version_id === 'string' ? full[0].version_id : null;
}

/** PURE. The worst code wins: 2 beats 1 beats 0. */
export function fold(results) {
  let code = 0;
  for (const r of results) {
    if (r.code === 2) code = 2;
    else if (r.code === 1 && code === 0) code = 1;
  }
  return code;
}

async function getJson(fetchImpl, url, headers, what, signal) {
  let res;
  try {
    res = await fetchImpl(url, { headers, signal });
  } catch (e) {
    throw classifyThrown(e, `${what}: ${e?.message ?? e}`);
  }
  if (isTransientStatus(res.status)) throw transientLook(`${what}: HTTP ${res.status}`);
  if (res.status !== 200) throw new CouldNotLook(`${what}: HTTP ${res.status}`);
  try {
    return { body: await res.json(), headers: res.headers };
  } catch {
    throw new CouldNotLook(`${what}: the answer is not JSON`);
  }
}

/** The live reads, over an injected fetch. Each returns a value or throws CouldNotLook. */
export function liveReaders({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const repo = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const gh = env.GITHUB_TOKEN || env.GH_TOKEN || '';
  const ghHeaders = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'nikatru-check-worker-versions',
    ...(gh ? { Authorization: `Bearer ${gh}` } : {}),
  };
  const retry = (what, read) => readWithBoundedRetry((_a, { signal }) => read(signal), { note: (m) => console.log(`    ⟳   ${what} — ${m}`) });
  return {
    async ledger(unit) {
      const url = `https://api.github.com/repos/${repo}/deployments?environment=${encodeURIComponent(unit)}&per_page=1`;
      const { body } = await retry(`${unit} ledger`, (signal) => getJson(fetchImpl, url, ghHeaders, `the ${unit} ledger`, signal));
      if (!Array.isArray(body)) throw new CouldNotLook(`the ${unit} ledger answer is not a list`);
      const d = body[0];
      if (!d) return null;
      let payload = d.payload;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          payload = null;
        }
      }
      return { id: d.id ?? null, sha: d.sha, payload: payload && typeof payload === 'object' ? payload : null };
    },
    async health(u) {
      const { body } = await retry(`${u.unit} health`, (signal) =>
        getJson(fetchImpl, u.health, { Accept: 'application/json', 'User-Agent': 'nikatru-check-worker-versions' }, `${u.health}`, signal),
      );
      if (typeof body?.build !== 'string') throw new CouldNotLook(`${u.health} answered no \`build\` (${JSON.stringify(body?.build ?? null)})`);
      return body.build;
    },
    async shieldHeader() {
      const probe = SHIELD_PROBES.find((p) => p.method === 'GET');
      if (!probe) return null;
      // A header that did not read is not a verdict: the Cloudflare read below
      // still grades the shield, so this falls through rather than failing.
      try {
        return await retry('shield header', async (signal) => {
          let res;
          try {
            res = await fetchImpl(probe.url, { method: 'GET', headers: { 'User-Agent': 'nikatru-check-worker-versions' }, signal });
          } catch (e) {
            throw classifyThrown(e, `${probe.url}: ${e?.message ?? e}`);
          }
          return res.headers.get(SHIELD_HEADER);
        });
      } catch {
        return null;
      }
    },
    async cloudflare(script) {
      const token = env.CLOUDFLARE_API_TOKEN;
      const account = env.CLOUDFLARE_ACCOUNT_ID;
      if (!token || !account) {
        throw new CouldNotLook(
          `no ${!token ? 'CLOUDFLARE_API_TOKEN (ops-watch maps CLOUDFLARE_READ_TOKEN into it)' : 'CLOUDFLARE_ACCOUNT_ID'}, so ${script}'s active version was not read`,
        );
      }
      const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${script}/deployments`;
      const { body } = await retry(`${script} deployments`, (signal) =>
        getJson(fetchImpl, url, { Authorization: `Bearer ${token}`, 'User-Agent': 'nikatru-check-worker-versions' }, `${script} deployments`, signal),
      );
      const v = activeVersionOf(body);
      if (!v) throw new CouldNotLook(`${script} has no single version at 100% in its newest deployment`);
      return v;
    },
  };
}

/** The fixture's reads: the same shape as `liveReaders`, from one JSON object. */
export function fixtureReaders(fx) {
  const need = (map, key, what) => {
    if (!map || !(key in map)) throw new CouldNotLook(`the fixture has no ${what} for ${key}`);
    return map[key];
  };
  return {
    async ledger(unit) {
      return need(fx.ledger, unit, 'ledger record');
    },
    async health(u) {
      return need(fx.health, u.unit, 'health build');
    },
    async shieldHeader() {
      return fx.shieldHeader ?? null;
    },
    async cloudflare(script) {
      return need(fx.cloudflare, script, 'Cloudflare active version');
    },
  };
}

/** Grade every derived unit. Returns `{ code, lines }`. */
export async function run({ root, readers, matrix } = {}) {
  const lines = [];
  const { units, problems } = deriveUnits(root, matrix ? { matrix } : {});
  const results = problems.map((p) => ({ code: 2, line: `?   ${p}` }));
  for (const u of units) {
    if (u.how === 'unclassified') {
      results.push({
        code: 2,
        line:
          `?   ${u.unit} — ${DEPLOY_WORKERS_REL} records it, and it is neither the platform Worker, an app Worker nor the edge shield, ` +
          'so this check does not know how to read its live version. Teach deriveUnits, never skip it.',
      });
      continue;
    }
    try {
      const ledger = await readers.ledger(u.unit);
      let live;
      if (u.how === 'health') {
        live = { build: await readers.health(u) };
      } else {
        const header = await readers.shieldHeader();
        if (typeof header === 'string' && FULL_SHA.test(header.trim().toLowerCase())) live = { build: header.trim() };
        else live = { versionId: await readers.cloudflare(u.script) };
      }
      results.push(judgeUnit(u, ledger, live));
    } catch (e) {
      results.push({ code: 2, line: `?   ${u.unit} — COULD NOT LOOK: ${e?.message ?? e}` });
    }
  }
  for (const r of results) lines.push(r.line);
  const code = fold(results);
  lines.push(
    code === 0
      ? `ok  ${units.length} Worker unit(s) each serve the ledger's newest record.`
      : code === 1
        ? '✗   a live Worker serves a build its ledger does not name as newest (above).'
        : '?   COVERAGE LOST — at least one Worker was not graded (above). That is never a pass.',
  );
  return { code, lines };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const root = resolve(opt('--root') ?? join(HERE, '..', '..'));
  const fixture = opt('--fixture');
  let readers;
  if (fixture !== undefined) {
    try {
      readers = fixtureReaders(JSON.parse(readFileSync(resolve(fixture), 'utf8')));
    } catch (e) {
      console.log(`?   the fixture ${fixture} did not read: ${e.message}`);
      process.exitCode = 2;
      return;
    }
  } else {
    readers = liveReaders();
  }
  const { code, lines } = await run({ root, readers });
  for (const l of lines) console.log(l);
  process.exitCode = code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.log(`?   check-worker-versions threw: ${e?.stack ?? e}`);
    process.exitCode = 2;
  });
}
