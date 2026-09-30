#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-edge-shield.mjs — IS THE EDGE SHIELD STILL IN FRONT OF BOX B AND BOX C?
//
// ⏱ 2026-09-26 · LEAD RULING SHIELD-R1 §7, row O-BOXES-UNSHIELDED-FROM-SPIKES.
// services/edge-shield sits on two Cloudflare ZONE routes in front of Box C's
// auth (auth-api.nikatru.com/auth/v1/*) and Box B's GlitchTip
// (glitchtip.nikatru.com/api/*), and adds ONE response header to everything it
// passes: `x-nikatru-shield: 1`. Every way the shield can drop out of path — a
// route deleted in the dashboard, the Worker deleted, a route re-pointed, a
// deploy that bound no route, the Worker throwing so `passThroughOnException`
// hands the request straight to the origin — looks EXACTLY like a healthy box:
// the origin still answers. The header is the only thing that tells the two
// apart, so this reads it.
//
// TWO PROBES, the ruling's own, one per route:
//   · GET  https://auth-api.nikatru.com/auth/v1/.well-known/jwks.json
//   · POST https://glitchtip.nikatru.com/api/1/envelope/   (no key: GlitchTip
//     refuses it 403, and the shield still marks the refusal)
// Any HTTP answer is judged — a 403, a 429 or a 530 from a box that is down all
// pass through the shield and carry the header. The box's own health is
// tooling/ops/status.mjs's question, not this one.
//
// COVERAGE IS A RELATIONSHIP. The probes are checked against the zone routes
// services/edge-shield/wrangler.jsonc declares, both ways: every route has a
// probe inside it, and every probe falls inside a route. A route added without a
// probe, or a probe left outside a route that moved, is COVERAGE LOST (exit 2)
// before a single request is sent.
//
// EXIT CODES (AGENTS.md): 0 every probe answered with the header · 1 a probe
// answered WITHOUT it — "shield not in path" · 2 COULD NOT LOOK: the routes
// could not be read, the probes do not cover them, or a probe never answered
// after the bounded retry. No credential is needed or read.
//
// Usage:  node tooling/ops/check-edge-shield.mjs [--settle] [--root <repoRoot>]
// Run by .github/workflows/ops-watch.yml (its own edge-shield job, weekly on the Monday slot), and with --settle
// as the post-deploy smoke of deploy-workers.yml's edge-shield job, where an
// answer without the header is asked again for about two minutes (a route bound
// seconds ago may not have reached every edge) before it is judged RED.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWithBoundedRetry, classifyThrown, transientLook, CouldNotLook } from './bounded-retry.mjs';
import { stripSourceComments } from '../ci/text-reductions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The header services/edge-shield/src/limit.ts adds to every response it passes. */
export const SHIELD_HEADER = 'x-nikatru-shield';
/** Where the shield's routes are declared. */
export const EDGE_CONFIG_REL = 'services/edge-shield/wrangler.jsonc';

/** The ruling's two probes. Neither carries a credential; neither changes anything. */
export const PROBES = Object.freeze([
  Object.freeze({
    what: 'Box C auth — the GoTrue JWKS',
    method: 'GET',
    url: 'https://auth-api.nikatru.com/auth/v1/.well-known/jwks.json',
  }),
  Object.freeze({
    what: 'Box B crash intake — an envelope with no key',
    method: 'POST',
    url: 'https://glitchtip.nikatru.com/api/1/envelope/',
    body: '',
    headers: Object.freeze({ 'content-type': 'application/x-sentry-envelope' }),
  }),
]);

/** PURE. The zone routes of a wrangler.jsonc text, as `{ pattern, zone_name }`. */
export function zoneRoutesOf(text) {
  const cfg = JSON.parse(stripSourceComments(text, '.ts').replace(/,(\s*[}\]])/g, '$1'));
  return (Array.isArray(cfg?.routes) ? cfg.routes : []).filter((r) => typeof r?.pattern === 'string' && r.pattern);
}

/**
 * PURE. Does a Cloudflare route pattern (`host/path*`, where `*` is a wildcard)
 * match this URL? Scheme and query are not part of a route.
 */
export function routeMatches(pattern, url) {
  const u = new URL(url);
  const subject = `${u.host}${u.pathname}`;
  // ⏱ 2026-09-30 · A literal glob walk, not a RegExp built from the pattern: the
  // escaped RegExp was correct, but CodeQL read every host a test fed it as an
  // unescaped hostname regexp (js/incomplete-hostname-regexp #503–#508). The
  // first piece anchors the start, the last the end, and each `*` spans any run.
  const pieces = pattern.split('*');
  if (pieces.length === 1) return subject === pattern;
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (!subject.startsWith(first) || subject.length < first.length + last.length || !subject.endsWith(last)) return false;
  let at = first.length;
  const end = subject.length - last.length;
  for (const piece of pieces.slice(1, -1)) {
    const i = subject.indexOf(piece, at);
    if (i === -1 || i + piece.length > end) return false;
    at = i + piece.length;
  }
  return true;
}

/** PURE. `{ unprobed, stray }`: routes with no probe inside, probes inside no route. */
export function coverage(routes, probes = PROBES) {
  const unprobed = routes.filter((r) => !probes.some((p) => routeMatches(r.pattern, p.url))).map((r) => r.pattern);
  const stray = probes.filter((p) => !routes.some((r) => routeMatches(r.pattern, p.url))).map((p) => p.url);
  return { unprobed, stray };
}

/** PURE. The verdict on one answer. */
export function judge(probe, res) {
  const mark = res.headers.get(SHIELD_HEADER);
  const where = `${probe.method} ${probe.url} → HTTP ${res.status}`;
  if (mark === '1') return { ok: true, line: `ok   ${probe.what}: ${where}, ${SHIELD_HEADER}: 1` };
  return {
    ok: false,
    line:
      `FAIL ${probe.what}: ${where} with ${mark === null ? `NO ${SHIELD_HEADER} header` : `${SHIELD_HEADER}: ${JSON.stringify(mark)}`} — ` +
      'SHIELD NOT IN PATH. The origin answered without services/edge-shield in front of it: a zone route is gone or ' +
      're-pointed, the Worker is gone, or it threw and passed the request through. Box B or Box C is taking this ' +
      'traffic unlimited.',
  };
}

/**
 * One probe, asked through the lane's bounded retry WITH its second look: the
 * Box B tunnel's US-edge stalls (row O-OPS-PROBE-US-EDGE-STALL) would otherwise
 * read as COULD NOT LOOK on a quiet box. Any HTTP status is an answer.
 *
 * `settle` (the post-deploy smoke only): an answer WITHOUT the header is asked
 * again through the same retry, because a route bound seconds ago may not have
 * reached every edge yet. When every attempt answered and none carried the
 * header, the last such answer is returned and judged RED; it never becomes a
 * "could not look".
 */
async function ask(probe, { fetchImpl, sleep, settle = false }) {
  let unmarked = null;
  try {
    return await readWithBoundedRetry(
      async (_attempt, { signal }) => {
        let res;
        try {
          res = await fetchImpl(probe.url, {
            method: probe.method,
            headers: { 'user-agent': 'nikatru-ops-watch/check-edge-shield', ...(probe.headers ?? {}) },
            body: probe.method === 'GET' ? undefined : probe.body,
            redirect: 'manual',
            signal,
          });
        } catch (err) {
          throw classifyThrown(err, `${probe.method} ${probe.url} did not answer (${err?.name ?? 'error'}: ${err?.message ?? err})`);
        }
        if (settle && res.headers.get(SHIELD_HEADER) !== '1') {
          unmarked = res;
          throw transientLook(`${probe.method} ${probe.url} answered HTTP ${res.status} without ${SHIELD_HEADER}; a route bound moments ago may still be reaching the edge`);
        }
        return res;
      },
      { sleep, note: (m) => console.log(`     ${m}`), secondLook: true, slowPath: (line) => console.log(`     ${line}`) },
    );
  } catch (err) {
    if (unmarked) return unmarked;
    throw err;
  }
}

/** The whole check. Returns the exit code; prints its own lines. */
export async function run({ root = ROOT, fetchImpl = globalThis.fetch, sleep, settle = false } = {}) {
  const cfgAbs = join(root, EDGE_CONFIG_REL);
  if (!existsSync(cfgAbs)) {
    console.error(`✗ COVERAGE LOST — ${EDGE_CONFIG_REL} does not exist, so which routes the shield holds cannot be said.`);
    return 2;
  }
  let routes;
  try {
    routes = zoneRoutesOf(readFileSync(cfgAbs, 'utf8'));
  } catch (err) {
    console.error(`✗ COVERAGE LOST — ${EDGE_CONFIG_REL} could not be parsed (${err.message}).`);
    return 2;
  }
  if (routes.length === 0) {
    console.error(`✗ COVERAGE LOST — ${EDGE_CONFIG_REL} declares no route, so there is nothing the shield could be in front of.`);
    return 2;
  }
  const { unprobed, stray } = coverage(routes);
  if (unprobed.length || stray.length) {
    console.error('✗ COVERAGE LOST — the probes and the shield’s routes disagree, so a green here would be about the wrong thing:');
    for (const r of unprobed) console.error(`    route ${r} has no probe inside it`);
    for (const p of stray) console.error(`    probe ${p} falls inside no route`);
    return 2;
  }

  let failed = 0;
  let unanswered = 0;
  for (const probe of PROBES) {
    let res;
    try {
      res = await ask(probe, { fetchImpl, sleep, settle });
    } catch (err) {
      unanswered++;
      console.error(`✗ COULD NOT LOOK — ${probe.what}: ${err instanceof CouldNotLook ? err.message : String(err)}`);
      continue;
    }
    const v = judge(probe, res);
    if (v.ok) console.log(v.line);
    else {
      failed++;
      console.error(v.line);
    }
  }
  if (failed) {
    console.error(`\nedge shield — ${failed} of ${PROBES.length} probe(s) answered WITHOUT the shield: shield not in path.`);
    return 1;
  }
  if (unanswered) {
    console.error(`\nedge shield — ${unanswered} of ${PROBES.length} probe(s) never answered; nothing is known about them. Not a pass.`);
    return 2;
  }
  console.log(`\nedge shield — in path on all ${routes.length} route(s): ${PROBES.length} probe(s), each answered with ${SHIELD_HEADER}: 1.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node tooling/ops/check-edge-shield.mjs [--settle] [--root <repoRoot>]';
  const at = args.indexOf('--root');
  const unknown = args.filter((a, i) => a.startsWith('--') && a !== '--root' && a !== '--settle' && args[i - 1] !== '--root');
  if (unknown.length) {
    console.error(`✗ unknown flag ${unknown.join(', ')}. ${usage}`);
    process.exit(2);
  }
  const root = at >= 0 && args[at + 1] ? resolve(args[at + 1]) : ROOT;
  process.exitCode = await run({ root, settle: args.includes('--settle') });
}
