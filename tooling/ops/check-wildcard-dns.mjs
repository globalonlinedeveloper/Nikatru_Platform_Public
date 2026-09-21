#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-wildcard-dns.mjs — [ADR 080] §4 deleted the proxied wildcard
// `*.nikatru.com`. This is the check that makes that deletion STAY, and it reads
// the zone's own record list, which is the only authority on the question.
//
// ── WHY IT IS HERE AND NOT IN CI ────────────────────────────────────────────
// 🔴 MEASURED 2026-09-11, and it cost most of an afternoon. The CI guard
// assert-catalog-reachable.mjs limb 2 enforced the wildcard by RESOLVING a name
// nobody registered. When the record was deleted at 17:13:11Z, main went red on
// the next push — the guard still required the record — so the record was put
// back at 17:49:54Z to unblock deploys. Inverting the limb to fail when the
// wildcard EXISTS was tried the same day and measured wrong in the other
// direction: a fresh `wc-6980804e.nikatru.com` still answered HTTP 530 from a
// GitHub runner at 17:42Z while 8.8.8.8 and 1.1.1.1 both returned NXDOMAIN.
//
// A runner's resolver lags the zone. So a DNS probe from CI cannot gate a build
// in EITHER direction without turning every open pull request red whenever the
// record changes, and #673 correctly made that limb report-only. The lesson is
// recorded once and applies to every check: NO CI CHECK MAY DEPEND ON LIVE
// DNS OR HTTP STATE IN A WAY THAT CAN BLOCK THE BUILD. Live-state enforcement
// belongs in ops-watch, which is scheduled, blocks nothing, and files an issue.
//
// ── WHY A TOKEN IS THE RIGHT ANSWER HERE, HAVING BEEN THE WRONG ONE THERE ────
// assert-catalog-reachable's header argues, correctly for ITS host, that "a
// guard that needs a credential is a guard that gets switched off the first time
// the credential expires". That argument is about a guard every pull request
// runs. This one runs in ops-watch, where CLOUDFLARE_API_TOKEN is already in the
// environment of six other steps, and where an expired credential is exit 2 —
// a named COVERAGE LOST on a scheduled run — rather than a blocked merge.
//
// ── FAIL-CLOSED, AND WHAT EACH EXIT MEANS ───────────────────────────────────
//   0 — the zone was read and holds NO wildcard record. The number of records
//       scanned is printed, because a read that returned nothing would satisfy
//       "no wildcard" vacuously; a zone with zero records is exit 2, not a pass.
//   1 — a wildcard record EXISTS. It names the record, its id, its type, its
//       content and whether it is proxied, so the owner can delete it by id.
//   2 — COULD NOT LOOK. No token, the API refused, the zone did not resolve to
//       exactly one id, or the answer came back in a shape this file cannot
//       read. NEVER 0: "I could not look" and "there is no wildcard" are the
//       same colour on purpose.
//
// The apex is IMPORTED from tooling/ci/assert-catalog-reachable.mjs, which
// derives it from the canonical hub URL. A second literal here could be edited
// on one side and go on printing ok about a zone nobody owns.
//
// Usage:  node tooling/ops/check-wildcard-dns.mjs [--zone <apex>]
// Env:    CLOUDFLARE_API_TOKEN  (Zone → DNS → Read is enough)
//
// 🔴 `process.exit()` IS BANNED IN THIS FILE, the same rule its neighbours in
// tooling/ops carry: with output still buffered the libuv assertion aborts the
// process on Windows. Set `process.exitCode`.
// ─────────────────────────────────────────────────────────────────────────────

import { WILDCARD_APEX } from '../ci/assert-catalog-reachable.mjs';
import { CouldNotLook, classifyThrown, transientLook, isTransientStatus, retryAfterMs, readWithBoundedRetry } from './bounded-retry.mjs';

export const CF_API = 'https://api.cloudflare.com/client/v4';
/** One request may not hang a scheduled job. */
export const REQUEST_TIMEOUT_MS = 20_000;
/** A zone with more records than this is not read to the end by this file, and
 *  saying "no wildcard" off a truncated list would be the false clean the whole
 *  file exists to prevent — so it is exit 2 instead. */
export const MAX_PAGES = 10;
export const PAGE_SIZE = 100;

// ⏱ 2026-09-21 — `CouldNotLook` IS NO LONGER DECLARED HERE. Every reader under
// tooling/ops/ declared its own, so `err instanceof CouldNotLook` was only ever
// true inside the file that threw — survivable while every throw and catch sat
// in one file, and the first thing to break when the bounded retry moved out of
// one. One class for the lane, re-exported so every existing importer of THIS
// module is unmoved (row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED, sweep clause).
export { CouldNotLook } from './bounded-retry.mjs';

/** PURE. Which records on a page are wildcards, whatever their type.
 *
 *  🔴 IT MATCHES THE LEADING LABEL, NOT THE WHOLE NAME. [ADR 080] §4 is about
 *  `*.nikatru.com`, and that is what was deleted — but a wildcard at any depth
 *  (`*.api.nikatru.com`) makes names resolve that nobody registered, which is
 *  the property the ADR is about. Matching only the apex form would let the same
 *  defect back in one label down while this file printed ok. */
export function wildcardRecords(records, apex) {
  return (records ?? []).filter((r) => {
    const name = typeof r?.name === 'string' ? r.name.toLowerCase() : '';
    if (!name.startsWith('*.')) return false;
    return name === `*.${apex}` || name.endsWith(`.${apex}`);
  });
}

/** PURE. The verdict, so every branch is reachable from a test with no network. */
export function judge({ apex, records }) {
  if (!Array.isArray(records)) {
    return { code: 2, lines: [`✗ COULD NOT LOOK — the record list for ${apex} was not an array.`] };
  }
  if (records.length === 0) {
    return {
      code: 2,
      lines: [
        `✗ COULD NOT LOOK — the zone ${apex} came back with ZERO DNS records.`,
        'A live zone always holds records; an empty answer satisfies "no wildcard" vacuously and is not a pass.',
      ],
    };
  }
  const hits = wildcardRecords(records, apex);
  if (hits.length > 0) {
    return {
      code: 1,
      lines: [
        `✗ A WILDCARD DNS RECORD EXISTS in ${apex}, and [ADR 080] §4 deleted it.`,
        ...hits.map(
          (r) =>
            `    ${r.name}  ${r.type}  -> ${r.content}  (proxied=${r.proxied === true}, id=${r.id})`,
        ),
        'Every NIKATRU hostname is explicit and exactly one label deep ([ADR 080]). A wildcard makes every retired',
        'name go on resolving, so a name nobody serves answers instead of failing, and a catalogue entry that is',
        'dead cannot be told from one that is alive.',
        'The record was restored on 2026-09-11 only because a CI guard still required it; that guard is report-only',
        'since #673, so nothing depends on it any more. Delete it by the id above.',
        `    curl -X DELETE "${CF_API}/zones/<zone id>/dns_records/<id>" -H "authorization: Bearer $CLOUDFLARE_API_TOKEN"`,
      ],
    };
  }
  return {
    code: 0,
    lines: [`ok  no wildcard DNS record in ${apex} — ${records.length} record(s) read from the zone itself ([ADR 080] §4)`],
  };
}

/**
 * ONE Cloudflare read, attempted up to READ_ATTEMPTS times on the shared bounded
 * plan (tooling/ops/bounded-retry.mjs).
 *
 * 🔴 IT WAS UN-RETRIED UNTIL 2026-09-21 AND ONE DROPPED TCP CONNECTION WAS A
 * RUN-LEVEL VERDICT. That is the defect row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED
 * measured on check-pages-deployments.mjs; this file is one of the eleven the
 * same row's sweep clause names. Nothing about the EXIT CODE moves — a read that
 * outlives the plan is still COULD NOT LOOK, still exit 2, never a pass.
 *
 * ⚠️ ONLY A TRANSIENT SHAPE IS RE-ASKED. The wire dropping, HTTP 429 and HTTP
 * 5xx are "not now"; a 401/403, unparseable JSON and `success:false` are
 * ANSWERS and fail on first sight, because re-asking them cannot change them.
 *
 * `sleep` and `note` are injected so the bound is PROVEN rather than waited.
 */
// 🔴 `doFetch` IS A TEST SEAM AND IT IS LOAD-BEARING. Without it the retry here can
// only be proven by the fact that the module is imported — and a mutation that put
// a bare `new CouldNotLook` back at the throw site was measured on 2026-09-21 to
// pass every import-shaped assertion while quietly re-asking nothing.
export async function cf(path, token, { sleep, note, doFetch = fetch } = {}) {
  return readWithBoundedRetry(
    async () => {
      let res;
      try {
        res = await doFetch(`${CF_API}${path}`, {
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (e) {
        throw classifyThrown(e, `GET ${path} did not answer (${e?.name ?? 'error'}: ${e?.message ?? e})`);
      }
      // A body that dies MID-READ is the wire dropping too, so it is classified by
      // the same rule rather than read as an empty answer.
      let text;
      try {
        text = await res.text();
      } catch (e) {
        throw classifyThrown(e, `GET ${path} answered HTTP ${res.status} and then dropped mid-body (${e?.message ?? e})`);
      }
      if (!res.ok) {
        const line = `GET ${path} answered HTTP ${res.status}: ${text.slice(0, 300)}`;
        throw isTransientStatus(res.status) ? transientLook(line, { retryAfterMs: retryAfterMs(res) }) : new CouldNotLook(line);
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new CouldNotLook(`GET ${path} answered unparseable JSON: ${text.slice(0, 200)}`);
      }
      if (body?.success !== true) {
        throw new CouldNotLook(`Cloudflare reported success=false for ${path}: ${JSON.stringify(body?.errors ?? null).slice(0, 300)}`);
      }
      return body;
    },
    { sleep, note },
  );
}

/** IMPURE. Every DNS record of the zone named `apex`, paged to the end. */
export async function readZoneRecords(apex, token, api = cf) {
  const zones = await api(`/zones?name=${encodeURIComponent(apex)}`, token);
  const list = Array.isArray(zones?.result) ? zones.result : [];
  if (list.length !== 1) {
    throw new CouldNotLook(`\`/zones?name=${apex}\` resolved to ${list.length} zone(s); exactly one is required to read its records`);
  }
  const id = list[0]?.id;
  if (typeof id !== 'string' || id.length === 0) throw new CouldNotLook(`the zone ${apex} came back without an id`);
  const records = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await api(`/zones/${id}/dns_records?per_page=${PAGE_SIZE}&page=${page}`, token);
    const got = Array.isArray(body?.result) ? body.result : null;
    if (got === null) throw new CouldNotLook(`the record list of ${apex} page ${page} was not an array`);
    records.push(...got);
    if (got.length < PAGE_SIZE) return records;
  }
  throw new CouldNotLook(
    `the record list of ${apex} is longer than ${MAX_PAGES * PAGE_SIZE} records, so this run did not read it to the end — ` +
      'and "no wildcard" off a truncated list is exactly the false clean this check exists to prevent',
  );
}

async function main(argv) {
  const zoneAt = argv.indexOf('--zone');
  const apex = (zoneAt >= 0 ? argv[zoneAt + 1] : WILDCARD_APEX) ?? WILDCARD_APEX;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  console.log(`check-wildcard-dns — the zone's own record list for ${apex}   ([ADR 080] §4)`);
  if (!token) {
    console.error('✗ COULD NOT LOOK — CLOUDFLARE_API_TOKEN is not in the environment, so the zone was not read.');
    console.error('    Nothing about the wildcard is known from this run. That is exit 2, never a pass.');
    process.exitCode = 2;
    return;
  }
  let records;
  try {
    records = await readZoneRecords(apex, token);
  } catch (e) {
    console.error(`✗ COULD NOT LOOK — ${e instanceof CouldNotLook ? e.message : `${e.name}: ${e.message}`}`);
    console.error('    Nothing about the wildcard is known from this run. That is exit 2, never a pass.');
    process.exitCode = 2;
    return;
  }
  const v = judge({ apex, records });
  for (const line of v.lines) (v.code === 0 ? console.log : console.error)(line);
  process.exitCode = v.code;
}

if (process.argv[1] && process.argv[1].endsWith('check-wildcard-dns.mjs')) {
  await main(process.argv.slice(2));
}
