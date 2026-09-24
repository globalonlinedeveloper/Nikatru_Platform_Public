// ─────────────────────────────────────────────────────────────────────────────
// mail-auth-dns.test.mjs — the records that make sent mail verifiable are judged
// from what two public resolvers RETURN, against what the register declares,
// and "I could not look" is never a pass.
//
// tooling/ops/check-mail-auth-dns.mjs closes row O-MAIL-AUTH-DNS-UNGUARDED:
// `authRecords` in tooling/mail-transport.json declares the SPF, DKIM, DMARC and
// bounce-MX records of both [ADR 029] rails, and until it existed nothing read
// them. The fixture answers below are the SHAPES read live on 2026-09-24 from
// cloudflare-dns.com (quoted character-strings) and dns.google (joined,
// unquoted). 🔴 THE KEYS ARE FAKE: base64 characters of the measured lengths,
// 392 and 216, and no real key is typed anywhere in this file.
//
//   D1  GREEN CONTROL — six live-shaped answers, six ok lines, lengths not keys
//   D2  a key split across two character-strings is joined with NOTHING between
//   D3  a DKIM record with no k= takes the RFC 6376 default, rsa
//   D4  an EMPTY p= is a revoked key, RED
//   D5  a k= other than the declared one, or no p= at all, is RED
//   D6  NXDOMAIN is RED — the record is gone
//   D7  a name holding no record of the type is RED
//   D8  SERVFAIL, REFUSED, a Status-less body and the whole-run ceiling are NOT
//       JUDGED, never RED and never ok
//   D9  two v=spf1 records are a permerror, RED — two copies of the declared one too
//   D10 an SPF include missing or added, or its `all` term changed, is RED
//   D11 a DMARC policy other than the declared one is RED, naming both
//   D12 a DMARC rua drift, a record not starting v=DMARC1, or two records, RED
//   D13 an MX exchange or preference drift, or a second MX, is RED; an
//       unreadable MX NOT JUDGED
//   D14 a SPLIT between the resolvers is NOT JUDGED, never RED
//   D15 end to end: one resolver down, the other decides, and the line says so
//   D16 the exit: RED 1 beats NOT JUDGED 2 beats ok 0; zero records is 2
//   D17 dns.google's shape (U1) gives the same verdicts as cloudflare-dns.com's
//   D18 an added `+include:` is RED, named as an undeclared term
//   D19 a `?include:` is RED, named with its qualifier
//   D20 a `~include:` is RED, named with its qualifier
//   D21 `-include:` of the declared target is RED: qualifier named, include missing
//   D22 an `ip4:0.0.0.0/0` term is RED, named
//   D23 an `a` term is RED, named
//   D24 a `redirect=` modifier is RED, named
//   D25 a repeated declared include is RED, named
//   D26 an `all` that is not the last term is RED (RFC 7208 §5.1)
//   D27 GREEN CONTROL — `+include:` of the declared target, any letter case
//   P1  --plan on the real register: six records, both resolvers, no request
//   P2  --plan with no register is exit 2
//   P3  an empty `authRecords.records` is REFUSED, exit 2, before any request
//   P4  an `expect` key the checker does not read is REFUSED — a pinned key too
//   P5  a `rail` the register's `rails` does not name is REFUSED, exit 2
//   S1  the file never calls process.exit, and its resolvers are its own two
//   W11-twin  ops-watch runs it in a job a duty row claims (DERIVED)
//   W11b      the step: `if: always()`, its own `timeout-minutes`, no `env:`
//
// Red controls, each run and restored (predictions written first):
//   R0 this file's W11-twin alone against the unmodified ops-watch.yml → exit 1
//   R2 the `k` default dropped (`tags.k ?? 'rsa'` → `tags.k`)   → D3 RED
//   R3 TXT character-strings joined with ' '                    → D2 RED
//   R4 combine()'s SPLIT branch returning `red`                 → D14 RED
//   R5 loadDeclaration's empty-records refusal removed          → P3 RED (the
//      exit stayed 2 through judgeRun's zero-records branch; P3 reads the refusal)
//   R1 LIVE: `google._domainkey` → `nonexistent-r1._domainkey` in the register
//      → the checker exit 1 naming dkim-google, both resolvers NXDOMAIN; restored
//      → exit 0, six ok lines, both resolvers 6/6
//   R7 a whole-run `new AbortController()` armed in the checker itself
//      → ops-bounded-retry.test.mjs B8 "NO RIVAL CEILING" RED, which is why the
//      whole-run ceiling is `runDeadline` in bounded-retry.mjs
//
// ⚠️ NO CASE HERE TOUCHES THE NETWORK. Every read goes through an injected
// fetch; the process cases run `--plan` or a temp root that is refused before a
// request is made.
//
// Run:  node --test tooling/ci/test/mail-auth-dns.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CouldNotLook,
  RESOLVERS,
  DOH_TIMEOUT_MS,
  RUN_CEILING_MS,
  loadDeclaration,
  txtValue,
  judgeAnswer,
  combine,
  judgeRun,
  readAll,
} from '../../ops/check-mail-auth-dns.mjs';
import { READ_ATTEMPTS } from '../../ops/bounded-retry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'check-mail-auth-dns.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-mail-auth-dns-'));
});
after(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** FAKE key material: base64 characters only, of the measured length. */
const fakeKey = (n) => 'FAKEdkimKEYnotReal0123456789+/'.repeat(Math.ceil(n / 30)).slice(0, n);
const KEY_GOOGLE = fakeKey(392);
const KEY_RESEND = fakeKey(216);

/** The six records, declared as the register declares them. Loaded through the
 *  checker's own loader so the declaration's validation is exercised too. */
const RECORDS = loadDeclaration({
  rails: [{ id: 'workspace' }, { id: 'resend' }],
  authRecords: {
    records: [
      { id: 'spf-google', rail: 'workspace', kind: 'spf', name: 'nikatru.com', expect: { include: ['_spf.google.com'], all: '~all' } },
      { id: 'dkim-google', rail: 'workspace', kind: 'dkim', name: 'google._domainkey.nikatru.com', expect: { k: 'rsa' } },
      { id: 'dmarc', rail: 'workspace', kind: 'dmarc', name: '_dmarc.nikatru.com', expect: { p: 'none', rua: 'mailto:dmarc@nikatru.com' } },
      { id: 'spf-resend', rail: 'resend', kind: 'spf', name: 'send.mail.nikatru.com', expect: { include: ['amazonses.com'], all: '~all' } },
      { id: 'mx-resend', rail: 'resend', kind: 'mx', name: 'send.mail.nikatru.com', expect: { exchange: 'feedback-smtp.ap-northeast-1.amazonses.com', preference: 10 } },
      { id: 'dkim-resend', rail: 'resend', kind: 'dkim', name: 'resend._domainkey.mail.nikatru.com', expect: { k: 'rsa' } },
    ],
  },
});
const rec = (id) => RECORDS.find((r) => r.id === id);

const TXT = 16;
const MX = 15;
/** cloudflare-dns.com's shape: each TXT character-string quoted, space-separated. */
const cf = (type, ...data) => ({ Status: 0, Answer: data.map((d) => ({ name: 'n', type, TTL: 60, data: d })) });
/** dns.google's shape (U1, read 2026-09-24): unquoted, names ending in a dot. */
const gg = (type, ...data) => ({ Status: 0, Answer: data.map((d) => ({ name: 'n.', type, TTL: 60, data: d })) });

const LIVE_CF = {
  'spf-google': cf(TXT, '"google-site-verification=FAKEverificationTOKEN"', '"v=spf1 include:_spf.google.com ~all"'),
  'dkim-google': cf(TXT, `"v=DKIM1;k=rsa;p=${KEY_GOOGLE.slice(0, 239)}" "${KEY_GOOGLE.slice(239)}"`),
  dmarc: cf(TXT, '"v=DMARC1; p=none; rua=mailto:dmarc@nikatru.com; fo=1; adkim=r; aspf=r"'),
  'spf-resend': cf(TXT, '"v=spf1 include:amazonses.com ~all"'),
  'mx-resend': cf(MX, '10 feedback-smtp.ap-northeast-1.amazonses.com.'),
  'dkim-resend': cf(TXT, `"p=${KEY_RESEND}"`),
};
const LIVE_GG = {
  'spf-google': gg(TXT, 'google-site-verification=FAKEverificationTOKEN', 'v=spf1 include:_spf.google.com ~all'),
  'dkim-google': gg(TXT, `v=DKIM1;k=rsa;p=${KEY_GOOGLE}`),
  dmarc: gg(TXT, 'v=DMARC1; p=none; rua=mailto:dmarc@nikatru.com; fo=1; adkim=r; aspf=r'),
  'spf-resend': gg(TXT, 'v=spf1 include:amazonses.com ~all'),
  'mx-resend': gg(MX, '10 feedback-smtp.ap-northeast-1.amazonses.com.'),
  'dkim-resend': gg(TXT, `p=${KEY_RESEND}`),
};

/** A result row as readAll builds it, for the pure verdict cases. */
const row = (id, ...observations) => ({ record: rec(id), observations, ...combine(observations) });
const obs = (resolver, state, detail = state) => ({ resolver, state, detail });

/** An injected fetch answering from a table keyed by resolver host and name. */
function router(answer) {
  const calls = [];
  const doFetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ host: u.host, name: u.searchParams.get('name'), type: u.searchParams.get('type'), signal: init?.signal });
    const a = await answer(u.host, u.searchParams.get('name'), u.searchParams.get('type'), calls.length);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(a) };
  };
  doFetch.calls = calls;
  return doFetch;
}

describe('check-mail-auth-dns — each kind, judged', () => {
  test('D1 GREEN CONTROL — six live-shaped answers are six ok lines, and a key is reported by its length only', () => {
    const results = RECORDS.map((r) =>
      row(r.id, { resolver: 'cloudflare-dns.com', ...judgeAnswer(r, LIVE_CF[r.id]) }, { resolver: 'dns.google', ...judgeAnswer(r, LIVE_GG[r.id]) }),
    );
    const v = judgeRun(results);
    assert.equal(v.code, 0, v.lines.join('\n'));
    const text = v.lines.join('\n');
    assert.equal(v.lines.filter((l) => l.startsWith('ok  ')).length, 6);
    assert.match(text, /ok {2}dkim-google {2}google\._domainkey\.nikatru\.com TXT — key present, 392 chars, k=rsa/);
    assert.match(text, /ok {2}dkim-resend {2}resend\._domainkey\.mail\.nikatru\.com TXT — key present, 216 chars, k=rsa \(the default\)/);
    assert.match(text, /6 record\(s\): 6 ok · 0 RED · 0 NOT JUDGED — read over DoH from cloudflare-dns\.com \(6\/6 answered\) and dns\.google \(6\/6 answered\)/);
    assert.ok(!text.includes(KEY_GOOGLE.slice(0, 40)), 'the key itself must never be printed');
    assert.ok(!text.includes(KEY_RESEND.slice(0, 40)), 'the key itself must never be printed');
  });

  test('D2 a key split across TWO character-strings is joined with NOTHING between them', () => {
    // A 2048-bit key does not fit one 255-byte string. A space at the join sits
    // inside the key, and an SPF term split the same way stops matching.
    const data = LIVE_CF['dkim-google'].Answer[0].data;
    assert.equal(txtValue(data), `v=DKIM1;k=rsa;p=${KEY_GOOGLE}`);
    assert.equal(txtValue('"v=spf1 include:_spf.goo" "gle.com ~all"'), 'v=spf1 include:_spf.google.com ~all');
    assert.equal(judgeAnswer(rec('spf-google'), cf(TXT, '"v=spf1 include:_spf.goo" "gle.com ~all"')).state, 'ok');
    const v = judgeAnswer(rec('dkim-google'), LIVE_CF['dkim-google']);
    assert.equal(v.state, 'ok', v.detail);
    assert.match(v.detail, /392 chars/);
  });

  test('D3 a DKIM record with NO k= takes the RFC 6376 default, rsa — the shape Resend publishes', () => {
    const v = judgeAnswer(rec('dkim-resend'), cf(TXT, `"p=${KEY_RESEND}"`));
    assert.equal(v.state, 'ok', v.detail);
    assert.match(v.detail, /216 chars, k=rsa \(the default\)/);
  });

  test('D4 an EMPTY p= is a REVOKED key, and RED', () => {
    const v = judgeAnswer(rec('dkim-google'), cf(TXT, '"v=DKIM1;k=rsa;p="'));
    assert.equal(v.state, 'red');
    assert.match(v.detail, /p= is EMPTY — the key is REVOKED/);
  });

  test('D5 a k= other than the declared one, or no p= at all, is RED', () => {
    const ed = judgeAnswer(rec('dkim-google'), cf(TXT, `"v=DKIM1;k=ed25519;p=${fakeKey(44)}"`));
    assert.equal(ed.state, 'red');
    assert.match(ed.detail, /k=ed25519, where the register declares k=rsa/);
    const nop = judgeAnswer(rec('dkim-google'), cf(TXT, '"v=DKIM1;k=rsa"'));
    assert.equal(nop.state, 'red');
    assert.match(nop.detail, /no p= tag/);
  });

  test('D6 NXDOMAIN is RED — the record is gone, which is the defect this row exists for', () => {
    const v = judgeAnswer(rec('dkim-google'), { Status: 3 });
    assert.equal(v.state, 'red');
    assert.match(v.detail, /does not exist \(NXDOMAIN\)/);
  });

  test('D7 a name that exists and holds no record of the type is RED, CNAME-only included', () => {
    const empty = judgeAnswer(rec('dmarc'), { Status: 0 });
    assert.equal(empty.state, 'red');
    assert.match(empty.detail, /holds no TXT record/);
    const cnameOnly = judgeAnswer(rec('dkim-resend'), { Status: 0, Answer: [{ name: 'n', type: 5, TTL: 60, data: 'gone.example.' }] });
    assert.equal(cnameOnly.state, 'red');
  });

  test('D8 SERVFAIL, REFUSED, a Status-less body and the whole-run ceiling are NOT JUDGED — never RED, never ok', async () => {
    assert.equal(judgeAnswer(rec('dmarc'), { Status: 2 }).state, 'unjudged');
    assert.match(judgeAnswer(rec('dmarc'), { Status: 2 }).detail, /status 2 \(SERVFAIL\)/);
    assert.equal(judgeAnswer(rec('dmarc'), { Status: 5 }).state, 'unjudged');
    assert.equal(judgeAnswer(rec('dmarc'), { error: 'bad' }).state, 'unjudged');
    assert.equal(judgeAnswer(rec('dmarc'), null).state, 'unjudged');
    // The run's own ceiling, already passed: nothing is asked, and every record
    // says why it was not judged.
    const doFetch = router(() => LIVE_CF.dmarc);
    const signal = AbortSignal.abort(new CouldNotLook('the whole-run ceiling of 90s passed before every read answered'));
    const results = await readAll([rec('dmarc')], { doFetch, sleep: async () => {}, signal });
    assert.equal(doFetch.calls.length, 0);
    assert.equal(results[0].state, 'unjudged');
    const v = judgeRun(results);
    assert.equal(v.code, 2);
    assert.match(v.lines.join('\n'), /whole-run ceiling of 90s passed/);
  });

  test('D9 two v=spf1 records are a permerror, which a receiver reads as no SPF at all', () => {
    const v = judgeAnswer(rec('spf-google'), cf(TXT, '"v=spf1 include:_spf.google.com ~all"', '"v=spf1 include:other.example ~all"'));
    assert.equal(v.state, 'red');
    assert.match(v.detail, /2 `v=spf1` records — RFC 7208 §4\.5/);
    // The COUNT is the permerror, not the content: two copies of the declared record are RED too.
    const twin = judgeAnswer(rec('spf-google'), cf(TXT, '"v=spf1 include:_spf.google.com ~all"', '"v=spf1 include:_spf.google.com ~all"'));
    assert.equal(twin.state, 'red');
    assert.match(twin.detail, /2 `v=spf1` records — RFC 7208 §4\.5/);
  });

  test('D10 an SPF include that went missing, or an `all` term that changed, is RED', () => {
    const gone = judgeAnswer(rec('spf-google'), cf(TXT, '"v=spf1 include:other.example ~all"'));
    assert.equal(gone.state, 'red');
    assert.match(gone.detail, /does not include _spf\.google\.com/);
    const open = judgeAnswer(rec('spf-google'), cf(TXT, '"v=spf1 include:_spf.google.com +all"'));
    assert.equal(open.state, 'red');
    assert.match(open.detail, /ends in \+all, where the register declares ~all/);
    const none = judgeAnswer(rec('spf-resend'), cf(TXT, '"v=spf1 include:amazonses.com"'));
    assert.equal(none.state, 'red');
    assert.match(none.detail, /no `all` term/);
    // The TERM SET is judged: one more authorised sender is a change too.
    const added = judgeAnswer(rec('spf-google'), cf(TXT, '"v=spf1 include:_spf.google.com include:other.example ~all"'));
    assert.equal(added.state, 'red');
    assert.match(added.detail, /has an undeclared term `include:other\.example`/);
  });

  test('D11 a DMARC policy other than the declared one is RED, and the line names both', () => {
    const v = judgeAnswer(rec('dmarc'), cf(TXT, '"v=DMARC1; p=quarantine; rua=mailto:dmarc@nikatru.com"'));
    assert.equal(v.state, 'red');
    assert.match(v.detail, /p=quarantine, where the register declares p=none/);
  });

  test('D12 a DMARC rua drift, a record not starting v=DMARC1, or two records are RED', () => {
    const rua = judgeAnswer(rec('dmarc'), cf(TXT, '"v=DMARC1; p=none; rua=mailto:someone@else.example"'));
    assert.equal(rua.state, 'red');
    assert.match(rua.detail, /rua=mailto:someone@else\.example, where the register declares rua=mailto:dmarc@nikatru\.com/);
    const order = judgeAnswer(rec('dmarc'), cf(TXT, '"p=none; v=DMARC1; rua=mailto:dmarc@nikatru.com"'));
    assert.equal(order.state, 'red');
    assert.match(order.detail, /no record starts `v=DMARC1`/);
    const two = judgeAnswer(rec('dmarc'), cf(TXT, '"v=DMARC1; p=none"', '"v=DMARC1; p=reject"'));
    assert.equal(two.state, 'red');
    assert.match(two.detail, /2 DMARC records — RFC 7489 §6\.6\.3: with more than one, NO policy is applied/);
  });

  test('D13 an MX exchange or preference drift is RED; an MX this file cannot read is NOT JUDGED', () => {
    const moved = judgeAnswer(rec('mx-resend'), cf(MX, '10 feedback-smtp.us-east-1.amazonses.com.'));
    assert.equal(moved.state, 'red');
    assert.match(moved.detail, /no MX names feedback-smtp\.ap-northeast-1\.amazonses\.com; the name holds 10 feedback-smtp\.us-east-1\.amazonses\.com/);
    const pref = judgeAnswer(rec('mx-resend'), cf(MX, '20 feedback-smtp.ap-northeast-1.amazonses.com.'));
    assert.equal(pref.state, 'red');
    assert.match(pref.detail, /preference 20, where the register declares 10/);
    // One exchange is declared; a second one appearing is a register edit, not a pass.
    const second = judgeAnswer(rec('mx-resend'), cf(MX, '10 feedback-smtp.ap-northeast-1.amazonses.com.', '20 backup.example.'));
    assert.equal(second.state, 'red');
    assert.match(second.detail, /2 MX records \(10 feedback-smtp\.ap-northeast-1\.amazonses\.com, 20 backup\.example\), where the register declares one/);
    assert.equal(judgeAnswer(rec('mx-resend'), cf(MX, 'garbled')).state, 'unjudged');
  });

  test('D14 a SPLIT between the resolvers is NOT JUDGED — exit 2, never RED and never ok', () => {
    const split = combine([obs('cloudflare-dns.com', 'ok'), obs('dns.google', 'red')]);
    assert.deepEqual(split, { state: 'unjudged', split: true });
    const v = judgeRun([row('dkim-google', obs('cloudflare-dns.com', 'ok', 'key present'), obs('dns.google', 'red', 'the name does not exist (NXDOMAIN)'))]);
    assert.equal(v.code, 2, v.lines.join('\n'));
    assert.match(v.lines.join('\n'), /⬜ NOT JUDGED \(SPLIT — the resolvers disagree\) {2}dkim-google/);
    assert.match(v.lines.join('\n'), /dns\.google: RED — the name does not exist/);
  });

  test('D15 END TO END: a resolver that never answers is set aside, the other decides, and the line says which', async () => {
    const slept = [];
    const doFetch = router((host, name) => {
      if (host === 'cloudflare-dns.com') throw new TypeError('fetch failed');
      assert.equal(name, 'google._domainkey.nikatru.com');
      return LIVE_GG['dkim-google'];
    });
    const results = await readAll([rec('dkim-google')], { doFetch, sleep: async (ms) => void slept.push(ms) });
    const cfCalls = doFetch.calls.filter((c) => c.host === 'cloudflare-dns.com').length;
    assert.equal(cfCalls, READ_ATTEMPTS, 'the silent resolver is re-asked on the shared plan, then set aside');
    assert.ok(doFetch.calls.every((c) => c.signal instanceof AbortSignal), 'every request carries the per-request signal');
    assert.equal(results[0].state, 'ok');
    const v = judgeRun(results);
    assert.equal(v.code, 0, v.lines.join('\n'));
    const text = v.lines.join('\n');
    assert.match(text, /\(cloudflare-dns\.com did not answer, so dns\.google decided: /);
    assert.match(text, /cloudflare-dns\.com \(0\/1 answered\) and dns\.google \(1\/1 answered\)/);
    // Both silent is NOT JUDGED, never ok.
    const dark = await readAll([rec('dkim-google')], {
      doFetch: router(() => {
        throw new TypeError('fetch failed');
      }),
      sleep: async () => {},
    });
    assert.equal(judgeRun(dark).code, 2);
  });

  test('D16 the exit: any RED is 1 even beside a NOT JUDGED; NOT JUDGED alone is 2; all ok is 0; zero records is 2', () => {
    const okRow = row('dmarc', obs('cloudflare-dns.com', 'ok'), obs('dns.google', 'ok'));
    const redRow = row('dkim-google', obs('cloudflare-dns.com', 'red', 'the name does not exist (NXDOMAIN)'), obs('dns.google', 'red', 'the name does not exist (NXDOMAIN)'));
    const darkRow = row('spf-google', obs('cloudflare-dns.com', 'unjudged', 'x'), obs('dns.google', 'unjudged', 'y'));
    assert.equal(judgeRun([okRow]).code, 0);
    assert.equal(judgeRun([okRow, darkRow]).code, 2);
    const both = judgeRun([okRow, redRow, darkRow]);
    assert.equal(both.code, 1);
    assert.match(both.lines.join('\n'), /✗ dkim-google {2}google\._domainkey\.nikatru\.com TXT — RED: the name does not exist \(NXDOMAIN\)/);
    assert.match(both.lines.join('\n'), /3 record\(s\): 1 ok · 1 RED · 1 NOT JUDGED/);
    assert.equal(judgeRun([]).code, 2);
    assert.match(judgeRun([]).lines.join('\n'), /never a pass/);
  });

  test('D17 dns.google\'s shape (unquoted, trailing-dot names) gives the SAME verdict as cloudflare-dns.com\'s', () => {
    // U1, read 2026-09-24: dns.google returned `_dmarc.nikatru.com.` and the TXT
    // value unquoted. The two resolvers must not disagree on shape alone, or
    // every run would be a SPLIT.
    for (const r of RECORDS) {
      const a = judgeAnswer(r, LIVE_CF[r.id]);
      const b = judgeAnswer(r, LIVE_GG[r.id]);
      assert.equal(a.state, 'ok', `${r.id}: ${a.detail}`);
      assert.deepEqual(b, a, `${r.id}: the two shapes must judge alike`);
    }
  });

  // ⏱ 2026-09-24, review #1 of PR #917: the include compare skipped any term that
  // did not start `include:`, so a QUALIFIED include, and every other mechanism or
  // modifier, passed with exit 0. D18-D26 each read ok on that code. The rule is
  // now the whole term set, exactly: the declared includes (unqualified or `+`),
  // the declared `all`, each once, `all` last.
  const spfGoogle = (text) => judgeAnswer(rec('spf-google'), cf(TXT, `"${text}"`));

  test('D18 an ADDED `+include:` is RED — an explicit `+` is the same include (RFC 7208 §4.6.2), and its target is undeclared', () => {
    const v = spfGoogle('v=spf1 include:_spf.google.com +include:evil.example ~all');
    assert.equal(v.state, 'red', v.detail);
    assert.match(v.detail, /has an undeclared term `\+include:evil\.example`/);
  });

  test('D19 an added `?include:` is RED — an include with qualifier `?`', () => {
    const v = spfGoogle('v=spf1 include:_spf.google.com ?include:evil.example ~all');
    assert.equal(v.state, 'red', v.detail);
    assert.match(v.detail, /has an include with qualifier `\?`: `\?include:evil\.example`/);
  });

  test('D20 an added `~include:` is RED — an include with qualifier `~`', () => {
    const v = spfGoogle('v=spf1 include:_spf.google.com ~include:evil.example ~all');
    assert.equal(v.state, 'red', v.detail);
    assert.match(v.detail, /has an include with qualifier `~`: `~include:evil\.example`/);
  });

  test('D21 the declared include written `-include:` is RED — qualified, so the declared include is missing', () => {
    const v = spfGoogle('v=spf1 -include:_spf.google.com ~all');
    assert.equal(v.state, 'red', v.detail);
    assert.match(v.detail, /does not include _spf\.google\.com/);
    assert.match(v.detail, /has an include with qualifier `-`: `-include:_spf\.google\.com`/);
  });

  test('D22 an added `ip4:0.0.0.0/0` is RED — an undeclared term that authorises every IPv4 sender', () => {
    const v = spfGoogle('v=spf1 include:_spf.google.com ip4:0.0.0.0/0 ~all');
    assert.equal(v.state, 'red', v.detail);
    assert.match(v.detail, /has an undeclared term `ip4:0\.0\.0\.0\/0`/);
  });

  test('D23 an added bare `a` mechanism is RED — an undeclared term', () => {
    const v = spfGoogle('v=spf1 a include:_spf.google.com ~all');
    assert.equal(v.state, 'red', v.detail);
    assert.match(v.detail, /has an undeclared term `a`/);
  });

  test('D24 an added `redirect=` modifier is RED — an undeclared term', () => {
    const v = spfGoogle('v=spf1 include:_spf.google.com redirect=evil.example ~all');
    assert.equal(v.state, 'red', v.detail);
    assert.match(v.detail, /has an undeclared term `redirect=evil\.example`/);
  });

  test('D25 the declared include written TWICE is RED — each declared term once', () => {
    const v = spfGoogle('v=spf1 include:_spf.google.com +include:_spf.google.com ~all');
    assert.equal(v.state, 'red', v.detail);
    assert.match(v.detail, /repeats the term `\+include:_spf\.google\.com`/);
  });

  test('D26 an `all` that is not the LAST term is RED — RFC 7208 §5.1 never evaluates a term after it', () => {
    const v = spfGoogle('v=spf1 ~all include:_spf.google.com');
    assert.equal(v.state, 'red', v.detail);
    assert.match(v.detail, /has terms after `~all`, which RFC 7208 §5\.1 never evaluates/);
  });

  test('D27 GREEN CONTROL — the declared include with an explicit `+`, in any letter case, is the declared record', () => {
    const plus = spfGoogle('v=spf1 +include:_spf.google.com ~all');
    assert.equal(plus.state, 'ok', plus.detail);
    const upper = spfGoogle('V=SPF1 INCLUDE:_SPF.GOOGLE.COM ~ALL');
    assert.equal(upper.state, 'ok', upper.detail);
  });
});

describe('check-mail-auth-dns — the process, with no request made', () => {
  const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60_000 });
  const tempRoot = (register) => {
    const root = join(TMP, `r${seq++}`);
    mkdirSync(join(root, 'tooling'), { recursive: true });
    if (register !== undefined) writeFileSync(join(root, 'tooling', 'mail-transport.json'), JSON.stringify(register));
    return root;
  };

  test('P1 --plan on the REAL register: six records, each to both resolvers, and no request', () => {
    const r = run(['--plan']);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal((r.stdout.match(/^plan {2}\S+ {2}\S+ (TXT|MX) {2}→ cloudflare-dns\.com, dns\.google$/gm) ?? []).length, 6, r.stdout);
    assert.match(r.stdout, /plan {2}dkim-google {2}google\._domainkey\.nikatru\.com TXT/);
    assert.match(r.stdout, /6 record\(s\) × 2 resolver\(s\) = 12 DoH read\(s\) planned; --plan makes none of them/);
  });

  test('P2 --plan with NO register is exit 2 — the register is what the plan is made of', () => {
    const r = run(['--plan', '--root', tempRoot(undefined)]);
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /mail-transport\.json does not exist under/);
    assert.match(r.stderr, /That is exit 2, never a pass/);
  });

  test('P3 an EMPTY `authRecords.records` is REFUSED before any request — zero records is not a clean run', () => {
    // Run WITHOUT --plan: this is the live path, and it must refuse, not read nothing and print a clean count.
    const r = run(['--root', tempRoot({ authRecords: { records: [] } })]);
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /`authRecords\.records` is empty or not an array/);
    assert.doesNotMatch(r.stdout, /^ok /m);
  });

  test('P4 an `expect` key the checker does not read is REFUSED — a pinned DKIM key included', () => {
    const r = run([
      '--root',
      tempRoot({ authRecords: { records: [{ id: 'dkim-x', rail: 'workspace', kind: 'dkim', name: 'x._domainkey.example.test', expect: { k: 'rsa', p: KEY_RESEND } }] } }),
    ]);
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /dkim-x: `expect` carries p, which the dkim check does not read\. An expectation nothing compares is refused, never ignored/);
  });

  test('P5 a `rail` that names none of the register\'s `rails[].id` is REFUSED before any request', () => {
    const r = run([
      '--root',
      tempRoot({
        rails: [{ id: 'workspace' }],
        authRecords: { records: [{ id: 'dkim-x', rail: 'marketing', kind: 'dkim', name: 'x._domainkey.example.test', expect: { k: 'rsa' } }] },
      }),
    ]);
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /dkim-x: rail "marketing" is not one of the register's rails \(workspace\)/);
    assert.doesNotMatch(r.stdout, /^ok /m);
  });
});

describe('check-mail-auth-dns — the source and the wiring', () => {
  test('S1 the file never calls process.exit, and its two resolvers are its own constants, not register rows', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
      .join('\n');
    assert.doesNotMatch(code, /process\.exit\(/, 'called after a fetch it aborts the process on Windows; set process.exitCode');
    assert.match(code, /process\.exitCode = v\.code/);
    assert.deepEqual(RESOLVERS.map((r) => r.host), ['cloudflare-dns.com', 'dns.google']);
    assert.equal(DOH_TIMEOUT_MS, 10_000);
    assert.equal(RUN_CEILING_MS, 90_000);
    const register = readFileSync(join(REPO, 'tooling', 'mail-transport.json'), 'utf8');
    // The hosts come from RESOLVERS, pinned to the two names one line up.
    assert.deepEqual(RESOLVERS.map((r) => r.host).filter((h) => register.includes(h)), [], 'whom to ask is the checker\'s question, not the register\'s');
    assert.match(code, /import \{ CouldNotLook, fetchWithBoundedRetry, runDeadline \} from '\.\/bounded-retry\.mjs';/);
  });

  test('W11-twin ops-watch runs it in a job that a duty row ALREADY claims', () => {
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    const CALL = 'node tooling/ops/check-mail-auth-dns.mjs';
    assert.ok(wf.includes(CALL), 'ops-watch must run the check, or nothing reads the mail-auth records');
    // WHICH job runs it is DERIVED from the workflow, never typed here: the job a
    // step belongs to is the nearest `  <id>:` header above it.
    const lines = wf.split('\n');
    const at = lines.findIndex((l) => l.includes(CALL));
    let job = null;
    for (let i = at; i >= 0; i -= 1) {
      const m = lines[i].match(/^ {2}([a-z][a-z0-9-]*):$/);
      if (m) {
        job = m[1];
        break;
      }
    }
    assert.ok(job, 'could not derive which job runs the check');
    const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'ops', 'register.json'), 'utf8'));
    const rows = register.rows ?? register.duties ?? [];
    assert.ok(rows.length > 0, 'the register must have rows, or this check is vacuous');
    const claiming = rows.filter((r) => (r.mechanism?.recordQuery?.unit?.jobs ?? []).includes(job)).map((r) => r.id);
    assert.ok(claiming.length > 0, `the \`${job}\` job is the unit of no duty row, so a red record would be watched by nobody`);
  });

  test('W11b the step runs after a red sibling, bounds itself, and takes no secret', () => {
    const lines = readFileSync(join(REPO, '.github', 'workflows', 'ops-watch.yml'), 'utf8').split('\n');
    const at = lines.findIndex((l) => l.includes('node tooling/ops/check-mail-auth-dns.mjs'));
    assert.ok(at > 0, 'the step is gone');
    let start = at;
    while (start > 0 && !/^ {6}- name: /.test(lines[start])) start -= 1;
    const step = lines.slice(start, at + 1).join('\n');
    assert.match(step, /^ {8}if: always\(\)$/m, 'a red step before it must not skip it');
    const t = step.match(/^ {8}timeout-minutes: (\d+)$/m);
    assert.ok(t && Number(t[1]) <= 3, 'its own ceiling, so a hung resolver cannot spend the steps after it');
    assert.doesNotMatch(step, /^ {8}env:/m, 'it needs no secret; an unset one must never be the reason it is red');
    const wildcard = lines.findIndex((l) => l.includes('node tooling/ops/check-wildcard-dns.mjs'));
    assert.ok(wildcard > 0 && wildcard < at, 'it sits after the wildcard step it takes its reasoning from');
  });
});
