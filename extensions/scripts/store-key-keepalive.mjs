#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// store-key-keepalive.mjs — the scheduled proof that the AMO and Edge API keys
// still authenticate. The Chrome key has its own job (publish-cws-keepalive.mjs);
// all three pass the one presence gate, keepaliveGate in store-poll.mjs.
//
// WHY: a store key is used on a tag push and on nothing else, so a revoked,
// rotated or expired key is found on the one path that ships bytes. The Edge
// API key carries a printed expiry (O-EDGE-API-KEY-EXPIRES-2026-11-20); the AMO
// key can be revoked on the AMO developer hub at any time. Each is exercised
// here, daily, with ONE read-only request that submits nothing:
//   · AMO:  GET {AMO}/api/v5/accounts/profile/ with an HS256 JWT (publish-amo's
//           amoJwt: iss, jti, iat, exp = iat + 60). 200 = the key is alive.
//   · Edge: GET {EDGE}/v1/products/<edge listingId>/submissions/operations/<zero
//           guid>. 404 or 200 = alive: measured 2026-09-09 (tool.json's
//           _listingIdWhy), a real key answers 404 for an operation that never
//           existed and a bogus key answers 403 "Client ID is Invalid".
//   · 401 or 403 = the key is rejected, exit 1. Any other status exits 1 and
//     prints it. A read that could not complete (CouldNotLook, after the bounded
//     retries) exits 1 "could not look": no answer is not a pass.
//
// ⚠️ THE FIRST SCHEDULED RUN IS A MEASUREMENT. The status a revoked key gets on
// these two reads is undocumented or unmeasured for both stores (the Edge 403
// above is a BOGUS key, not a revoked one). Read the first run's log, never
// summarise it.
//
// THE GATE (keepaliveGate): a present key is probed whether or not its register
// row is armed; an absent key on an ARMED row exits 1; an absent key on an
// unarmed row prints the owner step and exits 0 [pipeline C-6].
//
// SEAMS: AMO_API_BASE_URL and EDGE_API_BASE_URL accept the canonical origin or
// http on loopback only (loopbackBase), for the loopback test cases; no workflow
// sets either (extension-publish.test.mjs).
//
// ⚠️ NEVER `process.exit()` AFTER A `fetch` ON WINDOWS (TRAPS shell-12).
//
// Usage:  node scripts/store-key-keepalive.mjs [--repo-root <dir>]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ArmingCoverageLost, REPO_ROOT } from './publish-arming.mjs';
import { amoJwt } from './publish-amo.mjs';
import { keepaliveGate, loopbackBase, overrideLine } from './store-poll.mjs';
import { fetchWithBoundedRetry, CouldNotLook } from '../../tooling/ops/bounded-retry.mjs';

export const AMO_ORIGIN = 'https://addons.mozilla.org';
export const EDGE_ORIGIN = 'https://api.addons.microsoftedge.microsoft.com';
const ZERO_OPERATION = '00000000-0000-0000-0000-000000000000';

/** The Edge product id the probe addresses: the first tool (in directory order)
 *  whose tool.json declares one. Any well-formed product id gives the same
 *  authenticated 404, so which tool's id is used does not change the answer. */
function edgeListingId(root) {
  const base = join(root, 'extensions', 'Extension');
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base).sort()) {
    const abs = join(base, dir, 'tool.json');
    if (!existsSync(abs)) continue;
    let tool;
    try { tool = JSON.parse(readFileSync(abs, 'utf8')); } catch { continue; }
    const id = tool?.storeMetadata?.stores?.edge?.listingId;
    if (typeof id === 'string' && id.trim() !== '') return { id: id.trim(), where: `extensions/Extension/${dir}/tool.json` };
  }
  return null;
}

/** The two probes. `alive` lists the statuses that mean the key authenticated. */
const PROBES = Object.freeze({
  amo: {
    label: 'AMO',
    seam: 'AMO_API_BASE_URL',
    canonical: AMO_ORIGIN,
    alive: [200],
    request(base, env) {
      return {
        url: `${base}/api/v5/accounts/profile/`,
        headers: { authorization: `JWT ${amoJwt(env.AMO_JWT_ISSUER, env.AMO_JWT_SECRET)}`, accept: 'application/json' },
      };
    },
  },
  'edge-addons': {
    label: 'Edge',
    seam: 'EDGE_API_BASE_URL',
    canonical: EDGE_ORIGIN,
    alive: [200, 404],
    request(base, env, root) {
      const listing = edgeListingId(root);
      if (listing === null) return { error: 'no extensions/Extension/*/tool.json declares storeMetadata.stores.edge.listingId, so the Edge probe has no product to address.' };
      return {
        url: `${base}/v1/products/${encodeURIComponent(listing.id)}/submissions/operations/${ZERO_OPERATION}`,
        headers: { authorization: `ApiKey ${env.EDGE_API_KEY}`, 'x-clientid': env.EDGE_CLIENT_ID },
        note: `product id from ${listing.where}`,
      };
    },
  },
});

async function probeOne(store, { env, fetchImpl, root, sleep, out }) {
  const p = PROBES[store];
  let gate;
  try {
    gate = keepaliveGate(store, env, root);
  } catch (e) {
    if (e instanceof ArmingCoverageLost) {
      out.push(...e.lines, `FAIL ${p.label}: the register could not be read, so the key's gate is unknown.`);
      return 1;
    }
    throw e;
  }
  out.push(...gate.lines);
  if (gate.gate === 'refuse') {
    out.push(`FAIL ${p.label}: the register ARMS ${store} and [${gate.missing.join(', ')}] is absent — the release lane depends on a key that is not there.`);
    return 1;
  }
  if (gate.gate === 'owner-step') {
    out.push(`store-key-keepalive: ${p.label} NOTHING TO CHECK — no key is set and the register does not arm ${store}.`);
    return 0;
  }
  const seam = loopbackBase(p.seam, p.canonical, env);
  if (seam.error !== undefined) {
    out.push(`FAIL ${seam.error}`);
    return 1;
  }
  if (seam.override) out.push(overrideLine(p.seam, seam.base));
  const req = p.request(seam.base, env, root);
  if (req.error !== undefined) {
    out.push(`FAIL ${p.label}: ${req.error}`);
    return 1;
  }
  let res;
  try {
    res = await fetchWithBoundedRetry(({ signal }) => fetchImpl(req.url, { headers: req.headers, signal }), {
      describe: (s) => `${p.label} key probe: ${s}`,
      ...(sleep === undefined ? {} : { sleep }),
    });
  } catch (e) {
    if (e instanceof CouldNotLook) {
      out.push(`FAIL ${p.label}: could not look — ${e.message}. No answer is not a pass.`);
      return 1;
    }
    throw e;
  }
  const where = req.note === undefined ? '' : ` (${req.note})`;
  if (p.alive.includes(res.status)) {
    out.push(`store-key-keepalive: ${p.label} OK — the key authenticated: HTTP ${res.status}${where}. The key is never printed.`);
    return 0;
  }
  if (res.status === 401 || res.status === 403) {
    out.push(`FAIL ${p.label}: the key was REJECTED — HTTP ${res.status}${where}. Re-issue it; the release lane cannot publish with it.`);
    return 1;
  }
  out.push(`FAIL ${p.label}: HTTP ${res.status}${where}, which this probe does not read as alive or as rejected. Read the answer before anything else.`);
  return 1;
}

/**
 * Runs both probes and returns `{ code, lines }`; main prints the lines and sets
 * the exit code. `sleep` is bounded-retry's injectable backoff sleep, for tests.
 */
export async function runKeepalive({ env = process.env, fetchImpl = fetch, root = REPO_ROOT, sleep } = {}) {
  const out = [];
  let code = 0;
  for (const store of ['amo', 'edge-addons']) {
    const c = await probeOne(store, { env, fetchImpl, root, sleep, out });
    if (c !== 0) code = 1;
  }
  out.push(code === 0 ? 'store-key-keepalive: OK' : 'store-key-keepalive: FAILED');
  return { code, lines: out };
}

async function main(argv) {
  const i = argv.indexOf('--repo-root');
  const root = i !== -1 && i + 1 < argv.length ? argv[i + 1] : REPO_ROOT;
  const { code, lines } = await runKeepalive({ root });
  for (const l of lines) (l.startsWith('FAIL') ? console.error : console.log)(l);
  process.exitCode = code;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main(process.argv.slice(2));
}
