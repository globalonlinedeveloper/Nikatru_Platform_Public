#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-edge-zone.mjs — IS THE LIVE nikatru.com ZONE THE ONE tooling/edge/zone.json DECLARES?
//
// ⏱ 2026-10-01 · lane fix-edge-as-code (train P30), row NEW O-EDGE-CONFIG-NOT-DECLARED;
// ADR draft `edge-declared-as-code`, recorded by the next Private pass. It EXTENDS
// check-wildcard-dns.mjs: the same Cloudflare read (`cf`, bounded retry, success:false
// is an answer) and the same paged record list (`readZoneRecords`), imported, not copied.
//
// WHAT IS JUDGED, each limb a finding (exit 1) when it moves:
//   DNS     · a PROXIABLE record (A, AAAA, CNAME) that is DNS-only and whose name is not
//             in `dns.dnsOnly` (PB-05: "every served host is proxied" as a standing fact);
//           · a declared record that is gone, or whose declared `proxied`, `type`,
//             `content` or `ttl` differs (a null field is printed, never compared).
//   WAF     · the custom-rule phase holds a different number of rules, or a declared ref
//             is gone, or a declared field of it moved.
//   ACCESS  · an `applied` app that is gone; a live nikatru.com app nobody declared; a
//             declared policy-id set that moved; a `prepared` app absent past its `until`.
//   PROBE   · a gated host (PB-19: beszel, logs) whose GET / does not answer 302 to a
//             *.cloudflareaccess.com login. No credential; asked from outside.
// The rate-limit rule stays with tooling/ops/edge-ratelimit-rule.mjs; this file checks only
// that the declaration it points at is there and names this zone.
//
// EXIT CODES (AGENTS.md): 0 the zone is the declared one · 1 drift, each finding named ·
// 2 COULD NOT LOOK: the declaration is malformed, the zone or an account list could not be
// read, a probe never answered, or the read token is absent past its pending-until date.
// A finding outranks a could-not-look: what WAS read and found wrong is reported as wrong.
//
// THE TOKEN. It reads CLOUDFLARE_READ_TOKEN (#1095's read-only token: Zone DNS Read, Zone WAF
// Read, and Access: Apps and Policies Read, which this file adds to the owner's mint list) and
// CLOUDFLARE_ACCOUNT_ID. Until the owner mints it, `--cloudflare-read-pending-until <date>`
// (the date ci.yml gives #1095's own deferral) makes the API limbs print UNREADABLE and the
// run go on with the unauthenticated probes; the day after the date that is exit 2.
//
// 🔴 THE LOG IS PUBLIC (lead ruling on PR #1147, item 3). This runs in the public repo's
// ops-watch.yml, whose logs anyone can read, so the default output NEVER carries a record's
// content or the name of a record nobody declared: it prints counts, and for each such record
// an 8-char sha256 (`recordHash`) to match against a local export. Declared names are already
// public in ZONE_FILE_REL. edge-zone.test.mjs holds it: the default output contains no content.
//
// Usage:  node tooling/ops/check-edge-zone.mjs [--cloudflare-read-pending-until YYYY-MM-DD] [--root <dir>]
//         node tooling/ops/check-edge-zone.mjs --export <file>   (LOCAL ONLY — refused under
//              GitHub Actions: writes the records in the provider-neutral shape, with each one's
//              hash, plus what has no neutral equivalent — a DNS-provider move's worklist — to
//              <file>, and prints only how many it wrote)
//
// 🔴 `process.exit()` IS BANNED IN THIS FILE, as in its neighbours: set `process.exitCode`.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cf, readZoneRecords, CouldNotLook, MAX_PAGES, PAGE_SIZE } from './check-wildcard-dns.mjs';
import { readWithBoundedRetry, classifyThrown } from './bounded-retry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ZONE_FILE_REL = 'tooling/edge/zone.json';
export const TOKEN_ENV = 'CLOUDFLARE_READ_TOKEN';
export const PROXIABLE = Object.freeze(['A', 'AAAA', 'CNAME']);
const RECORD_KEYS = ['name', 'type', 'content', 'ttl', 'proxied'];
const RECORD_EXTRA_KEYS = ['why', 'mailAuth'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A bare lowercase DNS name. `zone` is the one declared value that reaches a Cloudflare API
 *  path (`/zones?name=`), so anything else is refused before a request is built (CodeQL #560). */
export const ZONE_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const lc = (s) => (typeof s === 'string' ? s.toLowerCase() : s);

/** PURE. A record's short public handle: the first 8 hex of sha256(name, type, content). */
export function recordHash(r) {
  return createHash('sha256').update(`${lc(r?.name ?? '')}\n${r?.type ?? ''}\n${r?.content ?? ''}`).digest('hex').slice(0, 8);
}
/** PURE. A value's short public handle, for a live field that must not reach the log. */
const valueHash = (v) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex').slice(0, 8);

/** The file's text, or null when it is not there — one read, no exists-then-read. */
function readIfThere(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}
const endOfDay = (d) => Date.parse(`${d}T23:59:59Z`);

/** PURE. Every way the declaration is unusable; an empty list means it can be judged against. */
export function validateDeclaration(doc, { root = ROOT } = {}) {
  const bad = [];
  if (doc?.provider !== 'cloudflare') bad.push(`\`provider\` is ${JSON.stringify(doc?.provider)}; this reader speaks "cloudflare" only`);
  if (typeof doc?.zone !== 'string' || !doc.zone) bad.push('no `zone`');
  else if (!ZONE_NAME.test(doc.zone)) bad.push(`\`zone\` ${JSON.stringify(doc.zone)} is not a bare lowercase DNS name`);
  const dns = doc?.dns;
  if (!Array.isArray(dns?.dnsOnly) || dns.dnsOnly.some((n) => typeof n !== 'string')) bad.push('`dns.dnsOnly` is not a list of names');
  if (!Array.isArray(dns?.records) || dns.records.length === 0) bad.push('`dns.records` declares no record');
  for (const [i, r] of (Array.isArray(dns?.records) ? dns.records : []).entries()) {
    const at = `dns.records[${i}]`;
    for (const k of RECORD_KEYS) if (!(k in (r ?? {}))) bad.push(`${at} has no \`${k}\` (write null for "not yet measured")`);
    for (const k of Object.keys(r ?? {})) if (!RECORD_KEYS.includes(k) && !RECORD_EXTRA_KEYS.includes(k)) bad.push(`${at} carries \`${k}\`, which is not part of the provider-neutral record`);
    if (typeof r?.name !== 'string' || !r.name) bad.push(`${at} has no name`);
    else if (typeof doc?.zone === 'string' && lc(r.name) !== lc(doc.zone) && !lc(r.name).endsWith(`.${lc(doc.zone)}`)) bad.push(`${at} ${r.name} is not in the zone ${doc.zone}`);
    if (typeof r?.proxied !== 'boolean') bad.push(`${at} \`proxied\` is not true or false`);
    if (r?.proxied === true && r?.type !== null && !PROXIABLE.includes(r?.type)) bad.push(`${at} is a ${r.type} declared proxied, and only ${PROXIABLE.join('/')} can be`);
  }
  const c = doc?.cloudflare;
  const rl = c?.rateLimit;
  if (typeof rl?.file !== 'string') bad.push('`cloudflare.rateLimit.file` is missing');
  else {
    const abs = join(root, ...rl.file.split('/'));
    let text = null;
    try {
      text = readIfThere(abs);
      if (text === null) bad.push(`\`cloudflare.rateLimit.file\` ${rl.file} does not exist`);
    } catch (err) {
      bad.push(`\`cloudflare.rateLimit.file\` ${rl.file} could not be read (${err.code ?? err.message})`);
    }
    if (text !== null) {
      try {
        const rule = JSON.parse(text);
        if (rule?.zone !== doc?.zone) bad.push(`${rl.file} names the zone ${JSON.stringify(rule?.zone)}, not ${doc?.zone}`);
        if (rule?.phase !== rl.phase) bad.push(`${rl.file} is the ${JSON.stringify(rule?.phase)} phase, not ${JSON.stringify(rl.phase)}`);
      } catch (err) {
        bad.push(`${rl.file} is not JSON (${err.message})`);
      }
    }
  }
  const waf = c?.wafCustom;
  if (waf?.phase !== 'http_request_firewall_custom') bad.push('`cloudflare.wafCustom.phase` is not "http_request_firewall_custom"');
  if (!Number.isInteger(waf?.count) || !Array.isArray(waf?.rules) || waf.rules.length !== waf.count) bad.push('`cloudflare.wafCustom` declares a `count` its `rules` do not have');
  const apps = c?.access?.apps;
  if (!Array.isArray(apps) || apps.length === 0) bad.push('`cloudflare.access.apps` declares no app');
  const seen = new Set();
  for (const [i, a] of (Array.isArray(apps) ? apps : []).entries()) {
    const at = `cloudflare.access.apps[${i}]`;
    if (typeof a?.domain !== 'string' || !a.domain) bad.push(`${at} has no domain`);
    else if (seen.has(lc(a.domain))) bad.push(`${at} ${a.domain} is declared twice`);
    else seen.add(lc(a.domain));
    if (a?.status !== 'applied' && a?.status !== 'prepared') bad.push(`${at} \`status\` is ${JSON.stringify(a?.status)}, not "applied" or "prepared"`);
    if (a?.status === 'prepared' && (!DATE.test(a?.until ?? '') || Number.isNaN(endOfDay(a.until)))) bad.push(`${at} is prepared with no YYYY-MM-DD \`until\`, so its deferral cannot be bounded`);
    if (a?.policyIds !== null && !(Array.isArray(a?.policyIds) && a.policyIds.length > 0 && a.policyIds.every((p) => typeof p === 'string' && p))) bad.push(`${at} \`policyIds\` is neither null nor a non-empty list of ids`);
    if (a?.probe !== undefined) {
      if (a.status !== 'applied') bad.push(`${at} probes an app that is not applied, which would be red by construction`);
      if (typeof a.probe?.path !== 'string' || !a.probe.path.startsWith('/') || !Number.isInteger(a.probe?.expectStatus) || typeof a.probe?.expectLocationHostSuffix !== 'string') bad.push(`${at} \`probe\` needs path, expectStatus and expectLocationHostSuffix`);
    }
  }
  const declaredProxied = new Set((Array.isArray(dns?.records) ? dns.records : []).filter((r) => r?.proxied === true).map((r) => lc(r.name)));
  const ingress = c?.tunnelIngress?.hostnames;
  if (!Array.isArray(ingress)) bad.push('`cloudflare.tunnelIngress.hostnames` is not a list');
  else for (const h of ingress) if (!declaredProxied.has(lc(h))) bad.push(`tunnel ingress ${h} is not a declared proxied DNS record`);
  return bad;
}

/** The declaration, or CouldNotLook naming every problem in it. */
export function loadDeclaration(root = ROOT) {
  const abs = join(root, ...ZONE_FILE_REL.split('/'));
  let text;
  try {
    text = readIfThere(abs);
  } catch (err) {
    throw new CouldNotLook(`${ZONE_FILE_REL} could not be read (${err.code ?? err.message})`);
  }
  if (text === null) throw new CouldNotLook(`${ZONE_FILE_REL} is not there, so there is nothing to compare the zone with`);
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new CouldNotLook(`${ZONE_FILE_REL} is not JSON (${err.message})`);
  }
  const bad = validateDeclaration(doc, { root });
  if (bad.length) throw new CouldNotLook(`${ZONE_FILE_REL} cannot be judged against:\n    ${bad.join('\n    ')}`);
  return doc;
}

/** PURE. DNS findings and notes for a live record list. Neither ever carries a live record's
 *  content or an undeclared record's name (the log is public): a hash stands in for each. */
export function judgeDns(decl, records) {
  const findings = [];
  const notes = [];
  const dnsOnly = new Set(decl.dns.dnsOnly.map(lc));
  const declaredNames = new Set(decl.dns.records.map((d) => lc(d.name)));
  for (const r of records) {
    if (PROXIABLE.includes(r?.type) && r?.proxied !== true && !dnsOnly.has(lc(r?.name))) {
      const who = declaredNames.has(lc(r?.name)) ? `${r.name} ${r.type}` : `undeclared ${r.type} record sha256:${recordHash(r)}`;
      findings.push(`DNS  ${who} is DNS-ONLY and not in dns.dnsOnly: the origin's address is public and nothing at the edge is in front of it (name and content: --export <file>, locally)`);
    }
  }
  const matched = new Set();
  for (const d of decl.dns.records) {
    const live = records.filter((r) => lc(r?.name) === lc(d.name) && (d.type === null ? (d.proxied ? PROXIABLE.includes(r?.type) : true) : r?.type === d.type));
    if (live.length === 0) {
      findings.push(`DNS  declared ${d.name} ${d.type ?? '(any proxiable type)'} is NOT in the zone`);
      continue;
    }
    for (const r of live) matched.add(r);
    const r = live[0];
    if ((r.proxied === true) !== d.proxied) findings.push(`DNS  ${d.name} ${r.type} proxied=${r.proxied === true}, declared ${d.proxied}`);
    for (const k of ['content', 'ttl']) {
      const live = k === 'content' ? `sha256:${valueHash(r[k])}` : JSON.stringify(r[k]);
      if (d[k] === null) notes.push(`${d.name} ${r.type} ${k} not declared; live: ${live}`);
      else if (r[k] !== d[k]) findings.push(`DNS  ${d.name} ${r.type} ${k} is ${live}, declared ${JSON.stringify(d[k])}`);
    }
    if (d.type === null) notes.push(`${d.name} type not declared; live: ${r.type}`);
  }
  const undeclared = records.filter((r) => !matched.has(r));
  if (undeclared.length) notes.push(`${undeclared.length} live record(s) are not declared (names and contents: --export <file>, locally): sha256 ${undeclared.map(recordHash).join(', ')}`);
  return { findings, notes };
}

/** PURE. WAF custom-rule findings for the live phase's rules. */
export function judgeWaf(decl, rules) {
  const findings = [];
  const notes = [];
  const w = decl.cloudflare.wafCustom;
  if (rules.length !== w.count) findings.push(`WAF  the custom-rule phase holds ${rules.length} rule(s), declared ${w.count}`);
  w.rules.forEach((d, i) => {
    const live = d.ref === null ? rules[i] : rules.find((r) => r?.ref === d.ref);
    if (!live) {
      if (d.ref !== null) findings.push(`WAF  declared rule ref ${d.ref} is NOT in the phase`);
      return;
    }
    if (d.ref === null) notes.push(`WAF rule ${i + 1} ref not declared; live: ${JSON.stringify(live.ref)} "${live.description ?? ''}" action=${live.action}`);
    for (const k of ['description', 'action']) if (d[k] !== null && live[k] !== d[k]) findings.push(`WAF  rule ${d.ref ?? i + 1} ${k} is ${JSON.stringify(live[k])}, declared ${JSON.stringify(d[k])}`);
    if (d.enabled !== null && (live.enabled !== false) !== d.enabled) findings.push(`WAF  rule ${d.ref ?? i + 1} enabled=${live.enabled !== false}, declared ${d.enabled}`);
  });
  return { findings, notes };
}

/** PURE. Every domain a live Access app answers on, normalised. */
export function appDomains(app) {
  const out = new Set();
  const add = (d) => typeof d === 'string' && d && out.add(lc(d).replace(/\/+$/, ''));
  add(app?.domain);
  for (const d of Array.isArray(app?.self_hosted_domains) ? app.self_hosted_domains : []) add(d);
  for (const d of Array.isArray(app?.destinations) ? app.destinations : []) add(d?.uri);
  return [...out];
}

/** PURE. Does a live app sit on a declared domain (the domain itself or a path under it)? */
export function appMatches(app, domain) {
  const want = lc(domain).replace(/\/+$/, '');
  return appDomains(app).some((d) => d === want || d.startsWith(`${want}/`));
}

/** PURE. Access findings and notes for the account's live app list. */
export function judgeAccess(decl, apps, { now = Date.now() } = {}) {
  const findings = [];
  const notes = [];
  const zone = lc(decl.zone);
  const inZone = apps.filter((a) => appDomains(a).some((d) => { const host = d.split('/')[0]; return host === zone || host.endsWith(`.${zone}`); }));
  const claimed = new Set();
  // The longest declared domain claims a live app first, so vault.nikatru.com/admin is never
  // swallowed by a shorter declaration.
  const declared = [...decl.cloudflare.access.apps].sort((a, b) => b.domain.length - a.domain.length);
  for (const d of declared) {
    const live = inZone.filter((a) => !claimed.has(a) && appMatches(a, d.domain));
    for (const a of live) claimed.add(a);
    if (live.length === 0) {
      if (d.status === 'applied') findings.push(`ACCESS  declared app ${d.domain} is NOT on the account: the host is public`);
      else if (now > endOfDay(d.until)) findings.push(`ACCESS  prepared app ${d.domain} is still not applied, and its deferral ran out on ${d.until}`);
      else notes.push(`prepared app ${d.domain} not applied yet (deferred until ${d.until})`);
      continue;
    }
    if (d.status === 'prepared') notes.push(`prepared app ${d.domain} IS live — flip it to "applied" with its policy ids in ${ZONE_FILE_REL}`);
    const ids = [...new Set(live.flatMap((a) => (Array.isArray(a?.policies) ? a.policies : []).map((p) => p?.id)).filter(Boolean))].sort();
    if (d.policyIds === null) notes.push(`${d.domain} policyIds not declared; live: ${JSON.stringify(ids)}`);
    else {
      const want = [...d.policyIds].sort();
      if (JSON.stringify(want) !== JSON.stringify(ids)) findings.push(`ACCESS  ${d.domain} policies are ${JSON.stringify(ids)}, declared ${JSON.stringify(want)}`);
    }
  }
  for (const a of inZone) if (!claimed.has(a)) findings.push(`ACCESS  live app ${JSON.stringify(a?.name ?? null)} (id=${a?.id}) on ${appDomains(a).join(', ')} is declared nowhere in ${ZONE_FILE_REL}`);
  return { findings, notes };
}

/** PURE. One gate probe's verdict. */
export function judgeProbe(domain, probe, res) {
  const loc = res.headers.get('location');
  let host = null;
  try {
    host = loc ? new URL(loc).host.toLowerCase() : null;
  } catch {
    host = null;
  }
  const where = `GET https://${domain}${probe.path} → HTTP ${res.status}${loc ? ` → ${loc.split('?')[0]}` : ''}`;
  if (res.status === probe.expectStatus && host !== null && host.endsWith(probe.expectLocationHostSuffix)) return { ok: true, line: `ok   PROBE  ${where}` };
  return { ok: false, line: `PROBE  ${where} — expected ${probe.expectStatus} to *${probe.expectLocationHostSuffix}: the Access gate is NOT in front of ${domain}` };
}

async function askProbe(url, { fetchImpl, sleep }) {
  return readWithBoundedRetry(
    async (_attempt, { signal }) => {
      try {
        return await fetchImpl(url, { method: 'GET', headers: { 'user-agent': 'nikatru-ops-watch/check-edge-zone' }, redirect: 'manual', signal });
      } catch (err) {
        throw classifyThrown(err, `GET ${url} did not answer (${err?.name ?? 'error'}: ${err?.message ?? err})`);
      }
    },
    { sleep, note: (m) => console.log(`     ${m}`), secondLook: true, slowPath: (line) => console.log(`     ${line}`) },
  );
}

/** IMPURE. The zone's id, by name. */
export async function zoneId(apex, token, api = cf) {
  const body = await api(`/zones?name=${encodeURIComponent(apex)}`, token);
  const list = Array.isArray(body?.result) ? body.result : [];
  if (list.length !== 1 || typeof list[0]?.id !== 'string' || !list[0].id) throw new CouldNotLook(`\`/zones?name=${apex}\` resolved to ${list.length} zone(s); exactly one with an id is required`);
  return list[0].id;
}

/** IMPURE. The rules of the zone's WAF custom-rule phase. */
export async function readWafRules(id, token, api = cf) {
  let body;
  try {
    body = await api(`/zones/${id}/rulesets/phases/http_request_firewall_custom/entrypoint`, token);
  } catch (err) {
    // A phase with no entrypoint answers 404: that is an ANSWER (zero rules), judged against
    // the declared count, never "could not look" (the rule edge-ratelimit-rule.mjs keeps too).
    if (err instanceof CouldNotLook && / answered HTTP 404:/.test(err.message)) return [];
    throw err;
  }
  const rules = body?.result?.rules;
  if (rules === undefined) return [];
  if (!Array.isArray(rules)) throw new CouldNotLook('the WAF custom-rule phase answered rules that are not a list');
  return rules;
}

/** IMPURE. Every Access app on the account, paged to the end. */
export async function readAccessApps(accountId, token, api = cf) {
  const apps = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await api(`/accounts/${accountId}/access/apps?per_page=${PAGE_SIZE}&page=${page}`, token);
    const got = Array.isArray(body?.result) ? body.result : null;
    if (got === null) throw new CouldNotLook(`the Access app list page ${page} was not an array`);
    apps.push(...got);
    if (got.length < PAGE_SIZE) return apps;
  }
  throw new CouldNotLook(`the account holds more than ${MAX_PAGES * PAGE_SIZE} Access apps, so this run did not read the list to the end`);
}

/** PURE. The DNS-provider move's worklist: neutral records, and what has no neutral form. */
export function exportZone(decl, records) {
  return {
    provider: decl.provider,
    zone: decl.zone,
    records: records.map((r) => ({ name: r.name, type: r.type, content: r.content, ttl: r.ttl, proxied: r.proxied === true, sha256: recordHash(r) })),
    noNeutralEquivalent: [
      `the proxied flag on ${records.filter((r) => r.proxied === true).length} record(s): the edge (TLS, WAF, rate limit, Access) in front of each`,
      `the rate-limit rule (${decl.cloudflare.rateLimit.file})`,
      `${decl.cloudflare.wafCustom.count} WAF custom rule(s) (${decl.cloudflare.wafCustom.phase})`,
      `${decl.cloudflare.access.apps.length} Access app(s): ${decl.cloudflare.access.apps.map((a) => a.domain).join(', ')}`,
      `the tunnel ingress for ${decl.cloudflare.tunnelIngress.hostnames.length} hostname(s)`,
    ],
  };
}

/** The whole check. Returns the exit code; prints its own lines. */
export async function run({ root = ROOT, env = process.env, api = cf, fetchImpl = globalThis.fetch, sleep, now = Date.now(), pendingUntil = null, exportFile = null, write = writeFileSync } = {}) {
  let decl;
  try {
    decl = loadDeclaration(root);
  } catch (err) {
    console.error(`✗ COULD NOT LOOK — ${err.message}`);
    return 2;
  }
  if (pendingUntil !== null && (!DATE.test(pendingUntil) || Number.isNaN(endOfDay(pendingUntil)))) {
    console.error(`✗ COULD NOT LOOK — --cloudflare-read-pending-until is "${pendingUntil}", not a YYYY-MM-DD date, so the deferral it declares cannot be bounded.`);
    return 2;
  }
  console.log(`check-edge-zone — the live ${decl.zone} zone against ${ZONE_FILE_REL}`);
  const token = typeof env[TOKEN_ENV] === 'string' ? env[TOKEN_ENV].trim() : '';
  const accountId = typeof env.CLOUDFLARE_ACCOUNT_ID === 'string' ? env.CLOUDFLARE_ACCOUNT_ID.trim() : '';

  if (exportFile !== null) {
    if (env.GITHUB_ACTIONS === 'true') {
      console.error('✗ --export is LOCAL ONLY: it writes every record\'s name and content, and a runner\'s files are not where those belong.');
      return 2;
    }
    if (typeof exportFile !== 'string' || exportFile === '' || exportFile.startsWith('--')) {
      console.error('✗ --export needs a file to write to: --export <file>. The records never go to the log.');
      return 2;
    }
    if (!token) {
      console.error(`✗ COULD NOT LOOK — ${TOKEN_ENV} is not in the environment; --export reads the live zone.`);
      return 2;
    }
    try {
      const x = exportZone(decl, await readZoneRecords(decl.zone, token, api));
      write(resolve(exportFile), `${JSON.stringify(x, null, 2)}\n`, 'utf8');
      console.log(`wrote ${x.records.length} record(s) to ${exportFile}`);
      return 0;
    } catch (err) {
      console.error(`✗ COULD NOT LOOK — ${err instanceof CouldNotLook ? err.message : `${err.name}: ${err.message}`}`);
      return 2;
    }
  }

  const findings = [];
  const notes = [];
  const unreadable = [];

  for (const a of decl.cloudflare.access.apps.filter((x) => x.probe)) {
    const url = `https://${a.domain}${a.probe.path}`;
    try {
      const v = judgeProbe(a.domain, a.probe, await askProbe(url, { fetchImpl, sleep }));
      if (v.ok) console.log(v.line);
      else findings.push(v.line);
    } catch (err) {
      unreadable.push(`PROBE  ${url} never answered: ${err instanceof CouldNotLook ? err.message : String(err)}`);
    }
  }

  if (!token || !accountId) {
    const missing = [!token && TOKEN_ENV, !accountId && 'CLOUDFLARE_ACCOUNT_ID'].filter(Boolean).join(' and ');
    if (pendingUntil !== null && now <= endOfDay(pendingUntil)) {
      console.log(`::warning title=The edge zone is UNREADABLE until ${missing} is set (deferred until ${pendingUntil})::DNS, WAF and Access were NOT read; only the Access gate probes ran.`);
      notes.push(`UNREADABLE — ${missing} is not set; the DNS, WAF and Access limbs are deferred until ${pendingUntil} (#1095's pending-until). Nothing about them is known from this run.`);
    } else {
      unreadable.push(`${missing} is not set${pendingUntil ? `, and the deferral ran out on ${pendingUntil}` : ''}: the owner mints ${TOKEN_ENV} with Zone DNS Read, Zone WAF Read and Access: Apps and Policies Read`);
    }
  } else {
    const limbs = [
      ['DNS', async () => judgeDns(decl, await readZoneRecords(decl.zone, token, api))],
      ['WAF', async () => judgeWaf(decl, await readWafRules(await zoneId(decl.zone, token, api), token, api))],
      ['ACCESS', async () => judgeAccess(decl, await readAccessApps(accountId, token, api), { now })],
    ];
    for (const [name, limb] of limbs) {
      try {
        const v = await limb();
        findings.push(...v.findings);
        notes.push(...v.notes);
        if (v.findings.length === 0) console.log(`ok   ${name}`);
      } catch (err) {
        unreadable.push(`${name}  ${err instanceof CouldNotLook ? err.message : `${err.name}: ${err.message}`}`);
      }
    }
  }

  for (const n of notes) console.log(`note ${n}`);
  for (const f of findings) console.error(`FAIL ${f}`);
  for (const u of unreadable) console.error(`✗ COULD NOT LOOK — ${u}`);
  if (findings.length) {
    console.error(`\nedge zone — ${findings.length} finding(s): the live zone is not the one ${ZONE_FILE_REL} declares.`);
    return 1;
  }
  if (unreadable.length) {
    console.error(`\nedge zone — ${unreadable.length} part(s) could not be read; nothing is known about them. Not a pass.`);
    return 2;
  }
  console.log(`\nedge zone — the live zone is the declared one, in every limb this run could read.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const usage = 'Usage: node tooling/ops/check-edge-zone.mjs [--cloudflare-read-pending-until YYYY-MM-DD] [--export <file>] [--root <dir>]';
  const valued = ['--root', '--cloudflare-read-pending-until', '--export'];
  const unknown = args.filter((a, i) => a.startsWith('--') && !valued.includes(a) && !valued.includes(args[i - 1]));
  if (unknown.length) {
    console.error(`✗ unknown flag ${unknown.join(', ')}. ${usage}`);
    process.exitCode = 2;
  } else {
    const val = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] ?? '' : null);
    process.exitCode = await run({
      root: val('--root') ? resolve(val('--root')) : ROOT,
      pendingUntil: val('--cloudflare-read-pending-until'),
      exportFile: val('--export'),
    });
  }
}
