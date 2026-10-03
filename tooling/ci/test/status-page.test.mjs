// status-page.test.mjs — lane status-page: the public components and their
// guard, the states read from the ops probe, publishing on change, incidents and
// their guard, the generated site and its smoke (tooling/status/build-status.mjs,
// tooling/ci/assert-status-components.mjs, tooling/ci/assert-incidents.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check as checkComponents, run as runComponents } from '../assert-status-components.mjs';
import { checkIncident, run as runIncidents } from '../assert-incidents.mjs';
import {
  STATES,
  main as buildStatus,
  plan,
  readComponents,
  renderFeed,
  renderIndex,
  shouldPublish,
  smoke,
  statusDoc,
} from '../../status/build-status.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const REG = JSON.parse(read('tooling/monitor-register.json'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const hostRow = (reg, h) => reg.hosts.find((r) => r.hostname === h);

// ── Do 1: components from the register ──────────────────────────────────────

test('the real register: every public component has a monitor and a unique name', () => {
  const r = runComponents(ROOT);
  assert.equal(r.code, 0, r.lines.join('\n'));
  const c = readComponents(ROOT).components;
  assert.ok(c.length >= 5);
  assert.ok(c.some((x) => x.name === 'Sign-in'));
  assert.ok(!c.some((x) => /vault|glitchtip|beszel|logs|ntfy/.test(x.hostname)), 'private infrastructure stays off the page');
});

test('🔴 a public component with no monitor fails (SC-3)', () => {
  const reg = clone(REG);
  hostRow(reg, 'auth-api.nikatru.com').monitor = null;
  const r = checkComponents(reg);
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => l.startsWith('SC-3 auth-api.nikatru.com')));
});

test('🔴 a monitor marked public with no component fails (SC-2)', () => {
  const reg = clone(REG);
  hostRow(reg, 'vault.nikatru.com').statusPage = { public: true };
  const r = checkComponents(reg);
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => l.startsWith('SC-2 vault.nikatru.com')));
});

test('🔴 a component name on a private row, a duplicate name, or a non-boolean public fails', () => {
  const reg = clone(REG);
  hostRow(reg, 'ntfy.nikatru.com').statusPage = { public: false, component: 'Push' };
  hostRow(reg, 'www.nikatru.com').statusPage = { public: true, component: 'Sign-in' };
  hostRow(reg, 'vault.nikatru.com').statusPage = { public: 'yes' };
  const lines = checkComponents(reg).lines.join('\n');
  assert.match(lines, /SC-4 ntfy\.nikatru\.com/);
  assert.match(lines, /SC-5 (www|auth-api)\.nikatru\.com: component "Sign-in"/);
  assert.match(lines, /SC-1 vault\.nikatru\.com/);
});

test('no public component at all is COVERAGE LOST, never a pass', () => {
  const reg = clone(REG);
  for (const h of reg.hosts) {
    delete h.statusPage;
    for (const pm of h.pathMonitors ?? []) delete pm.statusPage;
  }
  assert.equal(checkComponents(reg).code, 2);
});

// ── Do 2: no second checker; no reading is "not monitored" ──────────────────

const COMPONENTS = [
  { name: 'Site', hostname: 'nikatru.com', path: null },
  { name: 'Web app', hostname: 'nikatru.com', path: 'https://nikatru.com/x/' },
  { name: 'Sign-in', hostname: 'auth-api.nikatru.com', path: null },
  { name: 'API', hostname: 'api.nikatru.com', path: null },
];
const T0 = '2026-10-03T07:00:00Z';
const reading = (surfaces, checkedAt = T0) => ({ checkedAt, surfaces });

test('🔴 a component with no reading renders "not monitored", never operational', () => {
  const doc = statusDoc(COMPONENTS, null, null, T0);
  assert.ok(doc.components.every((c) => c.state === STATES.none));
  const html = renderIndex(doc, []);
  assert.match(html, /No reading has been published yet\./);
  assert.equal((html.match(/>Not monitored</g) ?? []).length, COMPONENTS.length);
  assert.doesNotMatch(html, />Operational</);
});

test('the probe\'s own verdicts decide: ok is operational, unhealthy is down, unreached is not monitored', () => {
  const doc = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'ok', 'auth-api.nikatru.com': 'unhealthy', 'api.nikatru.com': 'unreached' }), null, T0);
  const by = Object.fromEntries(doc.components.map((c) => [c.name, c.state]));
  assert.deepEqual(by, { Site: STATES.up, 'Web app': STATES.none, 'Sign-in': STATES.down, API: STATES.none });
  assert.equal(doc.overall, 'degraded');
});

test('a path monitor the probe does not grade is "not monitored" even when its host is ok', () => {
  const doc = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'ok' }), null, T0);
  assert.equal(doc.components.find((c) => c.name === 'Web app').state, STATES.none);
});

test('`since` carries over while a state holds, and moves when it changes', () => {
  const first = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'ok' }, '2026-10-03T07:00:00Z'), null, '2026-10-03T07:00:05Z');
  const same = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'ok' }, '2026-10-03T08:50:00Z'), first, '2026-10-03T08:50:05Z');
  assert.equal(same.components[0].since, '2026-10-03T07:00:00Z');
  const down = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'unhealthy' }, '2026-10-03T19:30:00Z'), same, '2026-10-03T19:30:05Z');
  assert.equal(down.components[0].since, '2026-10-03T19:30:00Z');
});

test('tooling/ops/status.mjs --json writes its verdicts and changes nothing else', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'status-json-'));
  try {
    const probes = path.join(tmp, 'probes.json');
    writeFileSync(probes, JSON.stringify({ 'nikatru.com': { status: 200, body: '<link rel="canonical" href="https://nikatru.com/">' } }));
    const out = path.join(tmp, 'readings.json');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tooling/ops/status.mjs'), '--probes-file', probes, '--json', out], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'every other surface is missing from the fixture, so the run is still graded unhealthy');
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.match(j.checkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(j.surfaces['nikatru.com'], 'ok');
    assert.equal(j.surfaces['auth-api.nikatru.com'], 'unhealthy');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Do 4: on change, not on a timer ─────────────────────────────────────────

test('🔴 two identical beats publish once', () => {
  const a = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'ok' }), null, '2026-10-03T07:30:00Z');
  assert.equal(shouldPublish(null, a), true, 'the first beat publishes');
  const b = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'ok' }, '2026-10-03T08:50:00Z'), a, '2026-10-03T08:50:00Z');
  assert.equal(shouldPublish(a, b), false, 'the same picture on the same day does not');
});

test('🔴 a state change publishes once', () => {
  const a = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'ok' }), null, '2026-10-03T07:30:00Z');
  const b = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'unhealthy' }), a, '2026-10-03T08:50:00Z');
  assert.equal(shouldPublish(a, b), true);
  const c = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'unhealthy' }), b, '2026-10-03T19:30:00Z');
  assert.equal(shouldPublish(b, c), false);
});

test('the first beat of a new UTC day publishes, so "last checked" stays honest', () => {
  const a = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'ok' }), null, '2026-10-03T19:30:00Z');
  const b = statusDoc(COMPONENTS, reading({ 'nikatru.com': 'ok' }), a, '2026-10-04T00:30:00Z');
  assert.equal(shouldPublish(a, b), true);
});

// ── Do 5: incidents ─────────────────────────────────────────────────────────

const KNOWN = new Set(['Sign-in', 'Site']);
const INCIDENT = `---
title: Sign-in was unavailable
started: 2026-10-05T09:12:00Z
resolved: 2026-10-05T09:40:00Z
components: [Sign-in]
impact: major
---
**What broke.** The sign-in service stopped answering.

- 09:12 the monitor went red
- 09:40 restored
`;

test('a well-formed incident passes, and renders into the history and the feed', () => {
  assert.deepEqual(checkIncident('ops/incidents/2026-10-05-sign-in.md', INCIDENT, KNOWN), []);
  const inc = [{ slug: '2026-10-05-sign-in', fm: { title: 'Sign-in was unavailable', started: '2026-10-05T09:12:00Z', resolved: '2026-10-05T09:40:00Z', components: ['Sign-in'] }, html: '<p>x</p>' }];
  assert.match(renderIndex(statusDoc(COMPONENTS, null, null, T0), inc), /id="2026-10-05-sign-in"/);
  const feed = renderFeed(inc);
  assert.match(feed, /<id>tag:status\.nikatru\.com,2026:2026-10-05-sign-in<\/id>/);
  assert.match(feed, /<updated>2026-10-05T09:40:00Z<\/updated>/);
});

test('🔴 an incident file with an e-mail address fails', () => {
  const bad = INCIDENT.replace('stopped answering.', 'stopped answering; ask ops@example.com.');
  assert.ok(checkIncident('ops/incidents/2026-10-05-sign-in.md', bad, KNOWN).some((f) => /IN-3 an e-mail address/.test(f)));
});

test('🔴 a bad shape fails: name, timestamps, impact, an unknown component, a phone number, a foreign link', () => {
  const f = checkIncident('ops/incidents/sign-in.md', INCIDENT, KNOWN);
  assert.ok(f.some((x) => /IN-1/.test(x)));
  const g = checkIncident(
    'ops/incidents/2026-10-05-x.md',
    INCIDENT.replace('2026-10-05T09:40:00Z', '2026-10-05T09:00:00Z').replace('impact: major', 'impact: huge').replace('[Sign-in]', '[Billing]') +
      'Call 98765 43210 or see https://example.com/x\n',
    KNOWN,
  ).join('\n');
  assert.match(g, /resolved is before started/);
  assert.match(g, /impact must be/);
  assert.match(g, /"Billing" is not a component/);
  assert.match(g, /IN-4/);
  assert.match(g, /IN-5/);
});

test('the real tree has an incidents folder, and zero incidents renders "No incidents recorded."', () => {
  assert.equal(runIncidents(ROOT).code, 0);
  assert.match(read('sites/status/index.html'), /No incidents recorded\./);
});

// ── Do 3: hosted apart; the committed site is the generator's ───────────────

test('the committed sites/status is a fresh render (build-status --check)', () => {
  const lines = [];
  assert.equal(buildStatus([ROOT, '--check'], (l) => lines.push(l)), 0, lines.join('\n'));
});

test('🔴 a hand edit of the committed page fails --check', () => {
  const p = plan(ROOT);
  const want = p.files.get('sites/status/index.html');
  assert.notEqual(want.replace('Nikatru status', 'Nikatru STATUS'), want);
  // The check compares bytes: the same plan over an edited copy is stale.
  const tmp = mkdtempSync(path.join(tmpdir(), 'status-check-'));
  try {
    for (const rel of ['tooling/monitor-register.json', 'ops/incidents/README.md']) {
      const to = path.join(tmp, rel);
      mkdirSync(path.dirname(to), { recursive: true });
      writeFileSync(to, read(rel));
    }
    const out = [];
    assert.equal(buildStatus([tmp], () => {}), 0);
    writeFileSync(path.join(tmp, 'sites/status/index.html'), want.replace('Nikatru status', 'Nikatru STATUS'));
    assert.equal(buildStatus([tmp, '--check'], (l) => out.push(l)), 1);
    assert.ok(out.some((l) => l.includes('stale sites/status/index.html')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the page loads nothing from another origin: no script, a same-origin stylesheet, a default-src none CSP', () => {
  const html = read('sites/status/index.html');
  assert.doesNotMatch(html, /<script/i);
  for (const m of html.matchAll(/<(?:link|img|iframe)[^>]*(?:href|src)="([^"]+)"/g)) {
    if (/rel="(canonical|alternate)"/.test(m[0])) continue;
    assert.ok(m[1].startsWith('/'), `a subresource from another origin: ${m[1]}`);
  }
  assert.match(read('sites/status/_headers'), /Content-Security-Policy: default-src 'none'; style-src 'self';/);
});

test('every output is a POSIX repo-relative path', () => {
  for (const rel of plan(ROOT).files.keys()) assert.ok(!rel.includes('\\') && rel.startsWith('sites/status/'), rel);
  assert.equal(path.win32.join('C:\\repo', ...'sites/status/index.html'.split('/')), 'C:\\repo\\sites\\status\\index.html');
});

test('--out builds a deployable copy and says whether to publish', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'status-out-'));
  try {
    const readings = path.join(tmp, 'r.json');
    writeFileSync(readings, JSON.stringify(reading({ 'nikatru.com': 'ok' })));
    const gh = path.join(tmp, 'gh.txt');
    assert.equal(buildStatus([ROOT, '--out', path.join(tmp, 'site'), '--readings', readings, '--github-output', gh], () => {}), 0);
    assert.equal(readFileSync(gh, 'utf8'), 'publish=true\n');
    const doc = JSON.parse(readFileSync(path.join(tmp, 'site', 'status.json'), 'utf8'));
    assert.equal(doc.components.find((c) => c.name === 'nikatru.com website').state, STATES.up);
    // The same picture again, against what was just published: no publish.
    const gh2 = path.join(tmp, 'gh2.txt');
    assert.equal(buildStatus([ROOT, '--out', path.join(tmp, 'site2'), '--readings', readings, '--prev', path.join(tmp, 'site', 'status.json'), '--github-output', gh2], () => {}), 0);
    assert.equal(readFileSync(gh2, 'utf8'), 'publish=false\n');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('the smoke passes only when the origin serves this build\'s document', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'status-smoke-'));
  try {
    const built = path.join(tmp, 'status.json');
    writeFileSync(built, JSON.stringify({ publishedAt: '2026-10-03T07:30:00Z', components: [] }));
    const fake = (doc) => async () => ({ ok: true, json: async () => doc });
    assert.equal(await smoke('https://status.example', built, { fetchImpl: fake({ publishedAt: '2026-10-03T07:30:00Z' }), log: () => {} }), 0);
    assert.equal(await smoke('https://status.example', built, { fetchImpl: fake({ publishedAt: '2026-10-02T07:30:00Z' }), log: () => {} }), 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── Do 6: linked where people look ──────────────────────────────────────────

test('the apex footer, /support, the 404 and the help content link the status page', () => {
  const link = 'href="https://status.nikatru.com/"';
  assert.ok(read('sites/nikatru/index.html').includes(link));
  assert.ok(read('sites/nikatru/support.html').includes(link));
  assert.ok(read('sites/nikatru/404.html').includes(link));
  assert.match(read('content/help/platform/en/service-status.md'), /\(https:\/\/status\.nikatru\.com\/\)/);
});
