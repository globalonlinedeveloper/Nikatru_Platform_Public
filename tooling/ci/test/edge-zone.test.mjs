// ─────────────────────────────────────────────────────────────────────────────
// edge-zone.test.mjs — tooling/edge/zone.json is a usable declaration of the
// nikatru.com zone, and tooling/ops/check-edge-zone.mjs goes RED on drift and says
// "could not look" rather than green when it could not.
//
// ⏱ 2026-10-01 · lane fix-edge-as-code (train P30), row NEW O-EDGE-CONFIG-NOT-DECLARED.
// No case reaches the network: the Cloudflare API is an injected `api(path, token)`
// stub and every probe is an injected fetch.
//
// Run:  node --test tooling/ci/test/edge-zone.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CouldNotLook } from '../../ops/bounded-retry.mjs';
import {
  ZONE_FILE_REL,
  loadDeclaration,
  validateDeclaration,
  judgeDns,
  judgeAccess,
  judgeWaf,
  judgeProbe,
  exportZone,
  recordHash,
  run,
} from '../../ops/check-edge-zone.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DECL = loadDeclaration(REPO);
const RAW = JSON.parse(readFileSync(join(REPO, ZONE_FILE_REL), 'utf8'));
const MAIL = JSON.parse(readFileSync(join(REPO, 'tooling', 'mail-transport.json'), 'utf8')).authRecords.records;
const NOW = Date.parse('2026-10-02T00:00:00Z');
const noSleep = async () => {};
const clone = (o) => JSON.parse(JSON.stringify(o));

/** A live record list that satisfies every declared record. */
function liveRecords() {
  return DECL.dns.records.map((d, i) => ({
    id: `rec${i}`,
    name: d.name,
    type: d.type ?? 'CNAME',
    content: d.content ?? 'origin.example',
    ttl: d.ttl ?? 300,
    proxied: d.proxied,
  }));
}
/** A live Access app list that satisfies every APPLIED declared app. */
function liveApps() {
  return DECL.cloudflare.access.apps
    .filter((a) => a.status === 'applied')
    .map((a, i) => ({ id: `app${i}`, name: a.domain, domain: a.domain, policies: [{ id: `pol${i}` }] }));
}
function liveWaf() {
  return DECL.cloudflare.wafCustom.rules.map((r, i) => ({ id: `w${i}`, ref: r.ref ?? `ref${i}`, description: r.description ?? `rule ${i}`, action: r.action ?? 'block', enabled: true }));
}

/** The Cloudflare API stub, cf()-shaped: (path, token) -> body, or a thrown CouldNotLook. */
function cloudflare({ records = liveRecords(), apps = liveApps(), waf = liveWaf(), refuse = null } = {}) {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (refuse && path.includes(refuse)) throw new CouldNotLook(`GET ${path} answered HTTP 403: {}`);
    if (path.startsWith('/zones?name=')) return { success: true, result: [{ id: 'z1' }] };
    if (path.startsWith('/zones/z1/dns_records')) return { success: true, result: records };
    if (path === '/zones/z1/rulesets/phases/http_request_firewall_custom/entrypoint') return { success: true, result: { rules: waf } };
    if (path.startsWith('/accounts/acct/access/apps')) return { success: true, result: apps };
    throw new Error(`not stubbed: ${path}`);
  };
  api.calls = calls;
  return api;
}

/** Every probe answers the Access 302 unless `answer` says otherwise. */
function gates(answer = () => ({ status: 302, location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/x' })) {
  const asked = [];
  const impl = async (url) => {
    asked.push(url);
    const a = answer(url);
    if (a instanceof Error) throw a;
    return new Response(null, { status: a.status, headers: a.location ? { location: a.location } : {} });
  };
  impl.asked = asked;
  return impl;
}

async function quiet(fn) {
  const out = [];
  const [log, err] = [console.log, console.error];
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    return { code: await fn(), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
}

const ENV = { CLOUDFLARE_READ_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'acct' };
const go = (opts = {}) => quiet(() => run({ root: REPO, env: ENV, api: cloudflare(), fetchImpl: gates(), sleep: noSleep, now: NOW, ...opts }));

describe('the declaration (tooling/edge/zone.json)', () => {
  test('validates: the provider is ONE field and the zone id is never written as a value', () => {
    assert.deepEqual(validateDeclaration(RAW, { root: REPO }), []);
    assert.equal(RAW.provider, 'cloudflare');
    assert.doesNotMatch(JSON.stringify(RAW), /\b[0-9a-f]{32}\b/, 'a 32-hex Cloudflare id is written in the declaration');
  });

  test('refuses a zone that is not a bare DNS name: it is the one declared value a Cloudflare request carries', () => {
    for (const zone of ['nikatru.com/../accounts', 'nikatru.com?x=1', 'Nikatru.com', 'evil.example.com@nikatru.com', 'nikatru']) {
      assert.ok(validateDeclaration({ ...RAW, zone }, { root: REPO }).some((b) => b.includes('is not a bare lowercase DNS name')), `${zone} was accepted`);
    }
  });

  test('every DNS record is the provider-neutral { name, type, content, ttl, proxied }', () => {
    for (const r of RAW.dns.records) {
      assert.deepEqual(Object.keys(r).filter((k) => !['why', 'mailAuth'].includes(k)), ['name', 'type', 'content', 'ttl', 'proxied']);
    }
  });

  test('the mail DNS is declared: every mail-transport authRecords row has exactly one record here, by name', () => {
    for (const m of MAIL) {
      const here = RAW.dns.records.filter((r) => r.mailAuth === m.id);
      assert.equal(here.length, 1, `${m.id} is declared ${here.length} time(s)`);
      assert.equal(here[0].name, m.name);
      assert.equal(here[0].proxied, false);
    }
    const ids = new Set(MAIL.map((m) => m.id));
    for (const r of RAW.dns.records.filter((x) => x.mailAuth)) assert.ok(ids.has(r.mailAuth), `${r.mailAuth} is no authRecords row`);
  });

  test('PB-19: beszel and logs are applied Access apps WITH an outside probe for the 302', () => {
    for (const d of ['beszel.nikatru.com', 'logs.nikatru.com']) {
      const a = RAW.cloudflare.access.apps.find((x) => x.domain === d);
      assert.equal(a?.status, 'applied', d);
      assert.deepEqual(a.probe, { path: '/', expectStatus: 302, expectLocationHostSuffix: '.cloudflareaccess.com' });
    }
  });

  test('PB-15 and PB-22: the vault admin, ntfy and GlitchTip UI apps are declared, each bounded by `until`', () => {
    for (const d of ['vault.nikatru.com/admin', 'ntfy.nikatru.com', 'glitchtip.nikatru.com']) {
      const a = RAW.cloudflare.access.apps.find((x) => x.domain === d);
      assert.ok(a, `${d} is not declared`);
      assert.match(a.until ?? '', /^\d{4}-\d{2}-\d{2}$/, d);
    }
    const g = RAW.cloudflare.access.apps.find((x) => x.domain === 'glitchtip.nikatru.com');
    assert.ok(g.bypass.includes('/api/*') && g.bypass.includes('/_health/'));
    assert.match(g.why, /monitor 1/);
  });

  test('a malformed declaration is refused, naming each problem', () => {
    const bad = clone(RAW);
    bad.provider = 'route53';
    bad.dns.records[0].region = 'x';
    bad.cloudflare.wafCustom.count = 3;
    bad.cloudflare.access.apps.push({ domain: 'x.nikatru.com', status: 'prepared', policyIds: null });
    bad.cloudflare.tunnelIngress.hostnames.push('nowhere.nikatru.com');
    const got = validateDeclaration(bad, { root: REPO }).join('\n');
    assert.match(got, /`provider` is "route53"/);
    assert.match(got, /carries `region`/);
    assert.match(got, /declares a `count` its `rules` do not have/);
    assert.match(got, /is prepared with no YYYY-MM-DD `until`/);
    assert.match(got, /tunnel ingress nowhere\.nikatru\.com is not a declared proxied DNS record/);
  });
});

describe('the drift reader (tooling/ops/check-edge-zone.mjs)', () => {
  test('GREEN CONTROL: a live zone equal to the declaration → exit 0, reading only', async () => {
    const api = cloudflare();
    const { code, out } = await go({ api });
    assert.equal(code, 0, out);
    assert.match(out, /^ok {3}DNS$/m);
    assert.match(out, /^ok {3}WAF$/m);
    assert.match(out, /^ok {3}ACCESS$/m);
    assert.ok(api.calls.some((p) => p.startsWith('/accounts/acct/access/apps')));
  });

  test('🔴 RED CONTROL: one proxied=false A record outside dns.dnsOnly → exit 1, naming it', async () => {
    const records = [...liveRecords(), { id: 'leak', name: 'origin.nikatru.com', type: 'A', content: '203.0.113.7', ttl: 1, proxied: false }];
    const { code, out } = await go({ api: cloudflare({ records }) });
    assert.equal(code, 1, out);
    const leak = records.at(-1);
    assert.match(out, new RegExp(`FAIL DNS {2}undeclared A record sha256:${recordHash(leak)} is DNS-ONLY`));
    assert.doesNotMatch(out, /203\.0\.113\.7|origin\.nikatru\.com/, "the leaking record's content or name reached the log");
  });

  test('🔴 RED CONTROL (item 3): the default output carries NO record content and no undeclared record name — the log is public', async () => {
    // Every live record gets a content no declaration holds; three undeclared records
    // (one of them DNS-only and proxiable, one a TXT) join them. Not one of those
    // strings, nor an undeclared name, may reach the log, on green or on red.
    const secret = (i) => `secret-content-${i}.tunnel.example`;
    const records = [
      ...liveRecords().map((r, i) => ({ ...r, content: secret(i) })),
      { id: 'u1', name: 'hidden-one.nikatru.com', type: 'CNAME', content: 'hidden-target-1.example', ttl: 1, proxied: true },
      { id: 'u2', name: 'hidden-two.nikatru.com', type: 'A', content: '198.51.100.23', ttl: 1, proxied: false },
      { id: 'u3', name: 'hidden-three.nikatru.com', type: 'TXT', content: 'v=hidden-token-xyz', ttl: 1, proxied: false },
    ];
    const { code, out } = await go({ api: cloudflare({ records }) });
    assert.equal(code, 1, out);
    for (const r of records) {
      assert.ok(!out.includes(r.content), `record content ${r.content} reached the log:\n${out}`);
      if (r.id.startsWith('u')) {
        assert.ok(!out.includes(r.name), `undeclared name ${r.name} reached the log:\n${out}`);
        assert.ok(out.includes(recordHash(r)), `undeclared record ${r.id} is not counted by its hash:\n${out}`);
      }
    }
    assert.match(out, /3 live record\(s\) are not declared/);
  });

  test('--export <file> writes every record (with its hash) to the file and only a count to the log; refused under GitHub Actions or with no file', async () => {
    const written = [];
    const write = (path, text) => written.push({ path, text });
    const ok = await go({ exportFile: 'zone-export.json', write });
    assert.equal(ok.code, 0, ok.out);
    assert.equal(written.length, 1);
    const x = JSON.parse(written[0].text);
    assert.equal(x.records.length, liveRecords().length);
    assert.equal(x.records[0].sha256, recordHash(liveRecords()[0]));
    assert.match(ok.out, /^wrote \d+ record\(s\) to zone-export\.json$/m);
    assert.doesNotMatch(ok.out, /origin\.example/);
    const ci = await go({ exportFile: 'x.json', write, env: { ...ENV, GITHUB_ACTIONS: 'true' } });
    assert.equal(ci.code, 2, ci.out);
    assert.match(ci.out, /LOCAL ONLY/);
    const none = await go({ exportFile: '', write });
    assert.equal(none.code, 2, none.out);
    assert.equal(written.length, 1, 'a refused export wrote a file');
  });

  test('🔴 RED CONTROL: an Access app missing → exit 1, naming the host left public', async () => {
    const apps = liveApps().filter((a) => a.domain !== 'beszel.nikatru.com');
    const { code, out } = await go({ api: cloudflare({ apps }) });
    assert.equal(code, 1, out);
    assert.match(out, /FAIL ACCESS {2}declared app beszel\.nikatru\.com is NOT on the account/);
  });

  test('a declared proxied record turned DNS-only, or gone → exit 1', () => {
    const flipped = liveRecords().map((r) => (r.name === 'glitchtip.nikatru.com' ? { ...r, proxied: false } : r));
    assert.ok(judgeDns(DECL, flipped).findings.some((f) => /glitchtip\.nikatru\.com CNAME proxied=false, declared true/.test(f)));
    const gone = liveRecords().filter((r) => r.name !== 'vault.nikatru.com');
    assert.ok(judgeDns(DECL, gone).findings.some((f) => /declared vault\.nikatru\.com CNAME is NOT in the zone/.test(f)));
  });

  test('a DNS-only TXT or MX is no finding: only A, AAAA and CNAME can be proxied', () => {
    const records = [...liveRecords(), { id: 't', name: 'x.nikatru.com', type: 'TXT', content: 'v', ttl: 1, proxied: false }];
    assert.deepEqual(judgeDns(DECL, records).findings, []);
  });

  test('a live Access app nobody declared, or a declared policy set that moved → exit 1', () => {
    const extra = [...liveApps(), { id: 'new', name: 'stray', domain: 'stray.nikatru.com', policies: [] }];
    assert.ok(judgeAccess(DECL, extra, { now: NOW }).findings.some((f) => /"stray" \(id=new\) on stray\.nikatru\.com is declared nowhere/.test(f)));
    const pinned = clone(DECL);
    pinned.cloudflare.access.apps.find((a) => a.domain === 'logs.nikatru.com').policyIds = ['pol-declared'];
    assert.ok(judgeAccess(pinned, liveApps(), { now: NOW }).findings.some((f) => /logs\.nikatru\.com policies are \["pol\d"\], declared \["pol-declared"\]/.test(f)));
  });

  test('a prepared app is a note until its `until`, exit 1 after it, and claims a path-scoped live app', () => {
    const before = judgeAccess(DECL, liveApps(), { now: NOW });
    assert.deepEqual(before.findings, []);
    assert.ok(before.notes.some((n) => /prepared app vault\.nikatru\.com\/admin not applied yet/.test(n)));
    const after = judgeAccess(DECL, liveApps(), { now: Date.parse('2026-10-22T00:00:00Z') });
    assert.ok(after.findings.some((f) => /prepared app vault\.nikatru\.com\/admin is still not applied/.test(f)));
    const applied = [...liveApps(), { id: 'va', name: 'vault admin', destinations: [{ type: 'public', uri: 'vault.nikatru.com/admin' }], policies: [{ id: 'p' }] }];
    const v = judgeAccess(DECL, applied, { now: NOW });
    assert.deepEqual(v.findings, []);
    assert.ok(v.notes.some((n) => /prepared app vault\.nikatru\.com\/admin IS live/.test(n)));
  });

  test('the WAF phase with a different number of rules, or a declared ref gone → exit 1', () => {
    assert.ok(judgeWaf(DECL, liveWaf().slice(0, 1)).findings.some((f) => /holds 1 rule\(s\), declared 2/.test(f)));
    const pinned = clone(DECL);
    pinned.cloudflare.wafCustom.rules[0].ref = 'gone-ref';
    assert.ok(judgeWaf(pinned, liveWaf()).findings.some((f) => /declared rule ref gone-ref is NOT in the phase/.test(f)));
  });

  test('🔴 RED CONTROL (PB-19): a gated host answering 200 instead of the Access 302 → exit 1', async () => {
    const fetchImpl = gates((url) => (url.startsWith('https://logs.') ? { status: 200 } : { status: 302, location: 'https://t.cloudflareaccess.com/login' }));
    const { code, out } = await go({ fetchImpl });
    assert.equal(code, 1, out);
    assert.match(out, /PROBE {2}GET https:\/\/logs\.nikatru\.com\/ → HTTP 200 — expected 302/);
  });

  test('a 302 to anywhere but *.cloudflareaccess.com is not the gate', () => {
    const p = { path: '/', expectStatus: 302, expectLocationHostSuffix: '.cloudflareaccess.com' };
    const res = new Response(null, { status: 302, headers: { location: 'https://cloudflareaccess.com.evil.example/x' } });
    assert.equal(judgeProbe('logs.nikatru.com', p, res).ok, false);
  });

  test('an API that refuses → exit 2, COULD NOT LOOK, never a pass', async () => {
    const { code, out } = await go({ api: cloudflare({ refuse: '/access/apps' }) });
    assert.equal(code, 2, out);
    assert.match(out, /✗ COULD NOT LOOK — ACCESS {2}GET \/accounts\/acct\/access\/apps/);
  });

  test('no read token inside the pending-until date → the API limbs are UNREADABLE, the probes still judge', async () => {
    const fetchImpl = gates();
    const { code, out } = await go({ env: {}, fetchImpl, pendingUntil: '2026-10-21' });
    assert.equal(code, 0, out);
    assert.match(out, /UNREADABLE — CLOUDFLARE_READ_TOKEN and CLOUDFLARE_ACCOUNT_ID is not set/);
    assert.ok(fetchImpl.asked.length >= 2);
  });

  test('no read token past the pending-until date, or with no date at all → exit 2', async () => {
    const late = await go({ env: {}, pendingUntil: '2026-10-01' });
    assert.equal(late.code, 2, late.out);
    assert.match(late.out, /the deferral ran out on 2026-10-01/);
    const none = await go({ env: {} });
    assert.equal(none.code, 2, none.out);
  });

  test('a probe that never answers → exit 2', async () => {
    const { code, out } = await go({ fetchImpl: gates(() => new TypeError('fetch failed')) });
    assert.equal(code, 2, out);
    assert.match(out, /PROBE {2}https:\/\/\w+\.nikatru\.com\/ never answered/);
  });

  test('the export is the records provider-neutral, plus what has no neutral equivalent', () => {
    const x = exportZone(DECL, liveRecords());
    assert.equal(x.provider, 'cloudflare');
    assert.deepEqual(Object.keys(x.records[0]), ['name', 'type', 'content', 'ttl', 'proxied', 'sha256']);
    assert.ok(x.noNeutralEquivalent.some((l) => /Access app\(s\)/.test(l)));
    assert.ok(x.noNeutralEquivalent.some((l) => /tunnel ingress/.test(l)));
  });
});
