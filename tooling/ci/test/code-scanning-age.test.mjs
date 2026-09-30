// -----------------------------------------------------------------------------
// code-scanning-age.test.mjs - an open high/critical code-scanning alert older
// than MAX_AGE_DAYS is a finding, and "I could not look" is never a pass.
//
// tooling/ops/check-code-scanning-age.mjs is finding P-9. Measured 2026-09-29:
// 146 alerts open, 31 high, none dismissed with a reason, and no reader anywhere.
//
//   C0 GREEN CONTROL - an empty list is exit 0 and SAYS "0 open alerts read"
//   C1 one high alert, open, 8 days old, no dismissal -> exit 1, printed in full
//   C2 the same alert dismissed WITH a reason -> exit 0; WITHOUT one -> exit 1
//   C3 a high alert 6 days old -> exit 0, printed as PENDING
//   C4 a critical alert 8 days old -> exit 1
//   C5 a medium alert 30 days old -> exit 0, counted, never paged
//   C6 malformed input -> exit 2 (COVERAGE LOST): not JSON, not an array, an
//      item missing its fields, a severity outside the enum, no severity at all
//   C7 the API read: pages followed by Link, a 403/404/non-array/over-long list
//      is COULD NOT LOOK, and no token is exit 2
//   W1 WIRED: ops-watch.yml runs it under security-events: read, and a register
//      row anchors it
//
// C1-C6 run the REAL script end to end (--fixture, --now); the exit code is the
// assertion. Fixtures are written to a temp directory. Nothing reads the network.
//
// Run:  node --test tooling/ci/test/code-scanning-age.test.mjs
// -----------------------------------------------------------------------------
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { judge, readAlerts, nextLink, CouldNotLook, DAY_MS, MAX_AGE_DAYS } from '../../ops/check-code-scanning-age.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'check-code-scanning-age.mjs');
const NOW_ISO = '2026-09-29T12:00:00.000Z';
const NOW = Date.parse(NOW_ISO);
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY_MS).toISOString();

/** One alert, in the REST API's shape. */
const alert = (number, daysAgo, severity, extra = {}) => ({
  number,
  state: 'open',
  created_at: iso(daysAgo),
  dismissed_reason: null,
  dismissed_comment: null,
  html_url: `https://github.com/o/r/security/code-scanning/${number}`,
  rule: { id: 'js/polynomial-redos', severity: 'warning', security_severity_level: severity },
  most_recent_instance: { location: { path: 'services/platform/src/scheduled.ts', start_line: 123 } },
  ...extra,
});

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'code-scanning-age-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Run the real script over `content` (an object is JSON-encoded, a string is written raw). */
function run(content, args = ['--now', NOW_ISO]) {
  const file = join(TMP, `f${seq++}.json`);
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  const r = spawnSync(process.execPath, [SCRIPT, '--fixture', file, ...args], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' } });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe('check-code-scanning-age - the fixture cases the brief names, end to end', () => {
  test('C0 GREEN CONTROL: an empty list is exit 0 and says so', () => {
    const r = run([]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0 open alerts read/);
    assert.match(r.out, /OFFLINE FIXTURE MODE/);
  });

  test('🔴 C1: one HIGH alert, open, 8 days old, no dismissal -> exit 1, printed with rule, age and path:line', () => {
    const r = run([alert(7, 8, 'high')]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /1 CRITICAL\/HIGH CODE-SCANNING ALERT\(S\) UNTRIAGED FOR MORE THAN 7 DAYS/);
    assert.match(r.out, /#7 {2}js\/polynomial-redos {2}high {2}8\.0d {2}services\/platform\/src\/scheduled\.ts:123/);
    assert.match(r.out, /critical 0 · high 1 · medium 0 · low 0 · none 0 · by state: open 1 · dismissed 0 · fixed 0/);
  });

  test('C2: the same alert DISMISSED WITH A REASON -> exit 0; dismissed with NO reason is still a finding', () => {
    const withReason = run([alert(7, 8, 'high', { state: 'dismissed', dismissed_reason: 'false positive' })]);
    assert.equal(withReason.code, 0, withReason.out);
    assert.match(withReason.out, /high 0 .*dismissed 1/);
    for (const reason of [null, '', '   ']) {
      const r = run([alert(7, 8, 'high', { state: 'dismissed', dismissed_reason: reason })]);
      assert.equal(r.code, 1, `reason ${JSON.stringify(reason)}: ${r.out}`);
      assert.match(r.out, /dismissed WITHOUT a reason/);
    }
    const fixed = run([alert(7, 30, 'critical', { state: 'fixed' })]);
    assert.equal(fixed.code, 0, fixed.out);
  });

  test('C3: a HIGH alert 6 days old -> exit 0, printed as PENDING', () => {
    const r = run([alert(9, 6, 'high')]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 critical\/high alert\(s\) PENDING, inside the 7-day triage window/);
    assert.match(r.out, /#9 .* 6\.0d/);
  });

  test('C4: a CRITICAL alert 8 days old -> exit 1', () => {
    const r = run([alert(11, 8, 'critical'), alert(12, 1, 'high')]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /#11 {2}js\/polynomial-redos {2}critical {2}8\.0d/);
    assert.match(r.out, /PENDING[\s\S]*#12 /, 'the young one is printed as pending, not as overdue');
  });

  test('C5: a MEDIUM alert 30 days old -> exit 0; medium, low and no-severity are counted and never page', () => {
    const r = run([alert(13, 30, 'medium'), alert(14, 90, 'low'), alert(15, 90, null)]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /critical 0 · high 0 · medium 1 · low 1 · none 1/);
  });

  test('the boundary: exactly MAX_AGE_DAYS is not yet overdue; a minute past it is', () => {
    assert.equal(judge([alert(1, MAX_AGE_DAYS, 'high')], { now: NOW }).code, 0);
    assert.equal(judge([alert(1, MAX_AGE_DAYS + 1 / 1440, 'high')], { now: NOW }).code, 1);
  });

  test('C6: malformed input -> exit 2 (COVERAGE LOST), never 0', () => {
    const cases = [
      ['not JSON', '{not json'],
      ['an object, not an array', { message: 'Not Found' }],
      ['null', 'null'],
      ['an item with no number', [{ ...alert(1, 8, 'high'), number: undefined }]],
      ['an item with no created_at', [{ ...alert(1, 8, 'high'), created_at: undefined }]],
      ['an item with no rule', [{ ...alert(1, 8, 'high'), rule: undefined }]],
      ['an unknown state', [alert(1, 8, 'high', { state: 'closed' })]],
      ['a severity outside the enum', [alert(1, 8, 'severe')]],
      ['a list in which NO alert carries a security severity', [alert(1, 8, null), alert(2, 8, undefined)]],
    ];
    for (const [what, content] of cases) {
      const r = run(content);
      assert.equal(r.code, 2, `${what}: ${r.out}`);
      assert.match(r.out, /COULD NOT LOOK/, what);
    }
    const badClock = run([alert(1, 8, 'high')], ['--now', 'yesterday-ish']);
    assert.equal(badClock.code, 2, badClock.out);
    const noFile = spawnSync(process.execPath, [SCRIPT, '--now', NOW_ISO, '--fixture'], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: 'x' } });
    assert.equal(noFile.status, 2, noFile.stdout + noFile.stderr);
    assert.match(noFile.stderr, /--fixture was given with no file/);
    const missing = spawnSync(process.execPath, [SCRIPT, '--now', NOW_ISO, '--fixture', join(TMP, 'absent.json')], { encoding: 'utf8' });
    assert.equal(missing.status, 2, missing.stdout + missing.stderr);
  });
});

/** A fake fetch: `pages` maps URL -> { status, body, link }. Records every URL asked. */
function fakeFetch(pages) {
  const asked = [];
  const doFetch = async (url) => {
    asked.push(url);
    const p = pages[url];
    if (!p) throw new Error(`unexpected URL ${url}`);
    const text = typeof p.body === 'string' ? p.body : JSON.stringify(p.body);
    return {
      status: p.status ?? 200,
      ok: (p.status ?? 200) < 300,
      headers: { get: (h) => (h.toLowerCase() === 'link' ? p.link ?? null : null) },
      text: async () => text,
    };
  };
  return { doFetch, asked };
}
const FIRST = 'https://api.github.com/repos/o/r/code-scanning/alerts?state=open&per_page=100';
const SECOND = 'https://api.github.com/repos/o/r/code-scanning/alerts?state=open&per_page=100&page=2';

describe('C7 - the API read', () => {
  test('pages are followed by the Link header, and every page is kept', async () => {
    const { doFetch, asked } = fakeFetch({
      [FIRST]: { body: [alert(1, 8, 'high'), alert(2, 1, 'low')], link: `<${SECOND}>; rel="next", <${SECOND}>; rel="last"` },
      [SECOND]: { body: [alert(3, 2, 'medium')], link: `<${FIRST}>; rel="prev", <${FIRST}>; rel="first"` },
    });
    const all = await readAlerts({ repository: 'o/r', token: 't', doFetch, sleep: async () => {} });
    assert.deepEqual(all.map((a) => a.number), [1, 2, 3]);
    assert.deepEqual(asked, [FIRST, SECOND]);
    assert.equal(judge(all, { now: NOW }).code, 1);
  });

  test('an empty first page is a legitimate zero', async () => {
    const { doFetch } = fakeFetch({ [FIRST]: { body: [] } });
    const all = await readAlerts({ repository: 'o/r', token: 't', doFetch, sleep: async () => {} });
    assert.deepEqual(all, []);
    assert.equal(judge(all, { now: NOW }).code, 0);
  });

  test('a 403, a 404, a non-array page and a list that never ends are COULD NOT LOOK', async () => {
    const refusals = [
      [{ [FIRST]: { status: 403, body: { message: 'Resource not accessible by integration' } } }, /HTTP 403.*security-events: read/],
      [{ [FIRST]: { status: 404, body: { message: 'no analysis found' } } }, /HTTP 404.*code scanning may be off/],
      [{ [FIRST]: { body: { message: 'weird' } } }, /not an array of alerts/],
      [{ [FIRST]: { body: 'not json' } }, /unparseable JSON/],
    ];
    for (const [pages, re] of refusals) {
      const { doFetch } = fakeFetch(pages);
      await assert.rejects(readAlerts({ repository: 'o/r', token: 't', doFetch, sleep: async () => {} }), (e) => e instanceof CouldNotLook && re.test(e.message));
    }
    const loop = fakeFetch({ [FIRST]: { body: [alert(1, 1, 'high')], link: `<${FIRST}>; rel="next"` } });
    await assert.rejects(
      readAlerts({ repository: 'o/r', token: 't', doFetch: loop.doFetch, sleep: async () => {}, maxPages: 3 }),
      (e) => e instanceof CouldNotLook && /still continued after 3 page/.test(e.message),
    );
    assert.equal(loop.asked.length, 3);
  });

  test('nextLink reads only rel="next"', () => {
    assert.equal(nextLink(`<${SECOND}>; rel="next", <${FIRST}>; rel="first"`), SECOND);
    assert.equal(nextLink(`<${FIRST}>; rel="prev"`), null);
    assert.equal(nextLink(null), null);
  });

  test('no token and no fixture is exit 2, never a pass', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' } });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /neither GH_TOKEN nor GITHUB_TOKEN/);
  });
});

describe('W1 - WIRED', () => {
  test('ops-watch.yml runs it in its own job, under security-events: read, and alert needs that job', () => {
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    const start = wf.indexOf('\n  code-scanning-age:\n');
    assert.ok(start > 0, 'ops-watch.yml has no code-scanning-age job');
    const job = wf.slice(start, wf.indexOf('\n  alert:\n'));
    assert.match(job, /\n {6}security-events: read\n/);
    assert.match(job, /\n {10}node tooling\/ops\/check-code-scanning-age\.mjs\n/);
    assert.match(job, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    const needs = /\n {2}alert:\n[\s\S]*?needs:\s*\n?\s*\[([^\]]+)\]/.exec(wf);
    assert.ok(needs && needs[1].split(',').map((s) => s.trim()).includes('code-scanning-age'), 'alert.needs must hold code-scanning-age');
  });

  test('a register row anchors it', () => {
    const reg = JSON.parse(readFileSync(join(REPO, 'tooling', 'ops', 'register.json'), 'utf8'));
    const row = reg.rows.find((r) => r?.mechanism?.anchor === 'tooling/ops/check-code-scanning-age.mjs');
    assert.ok(row, 'no register row anchors tooling/ops/check-code-scanning-age.mjs');
    assert.deepEqual(row.mechanism.recordQuery.unit, { jobs: ['code-scanning-age'] });
  });
});
