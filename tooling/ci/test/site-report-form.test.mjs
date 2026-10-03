// site-report-form.test.mjs — nikatru.com's "Report a problem" form arriving
// from a link: the help centre's "Ask us" (lane help-search) and an extension's
// report button (lane feedback-intake, extensions/core/v1/report-link.js).
//   · js/report.js fills the category and the search words, and carries an
//     extension's own facts as hidden fields — run here in a vm over a stub DOM;
//   · functions/api/report.js forwards them to the platform Worker as the
//     extension's report (its id, surface, version, locale, browser), and drops
//     any value that is not its key's shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = readFileSync(path.join(ROOT, 'sites/nikatru/js/report.js'), 'utf8');
const { onRequestPost } = await import(pathToFileURL(path.join(ROOT, 'sites/nikatru/functions/api/report.js')).href);

/** A stub of the support page's form: the elements report.js touches, nothing else. */
function page(search) {
  const appended = [];
  const els = {
    'report-category': { value: 'bug', querySelector: (sel) => (/value="(bug|crash|billing|accessibility|translation|question|other)"/.test(sel) ? {} : null) },
    'report-description': { value: '' },
    'report-elapsed': { value: '' },
    'report-key': { value: '' },
    'report-outcome': { textContent: '', hidden: true },
  };
  const form = { addEventListener() {}, appendChild: (n) => appended.push(n) };
  const document = {
    querySelector: (sel) => (sel === 'form.report' ? form : null),
    getElementById: (id) => els[id] ?? null,
    createElement: () => ({}),
  };
  vm.runInNewContext(SCRIPT, { document, window: { location: { search } }, URLSearchParams, Date, Math, String });
  return { els, hidden: Object.fromEntries(appended.map((n) => [n.name, n.value])) };
}

test('"Ask us" from the help centre fills category question and the search words', () => {
  const { els, hidden } = page('?category=question&q=reminder%20never%20arrived');
  assert.equal(els['report-category'].value, 'question');
  assert.equal(els['report-description'].value, 'reminder never arrived');
  assert.deepEqual(hidden, {});
});

test('🔴 an unknown category is ignored, not forced into the select', () => {
  const { els } = page('?category=<script>&q=x');
  assert.equal(els['report-category'].value, 'bug');
});

test('an extension link carries its own facts as hidden fields', () => {
  const { hidden } = page('?app=fullshot&v=1.10.3&loc=en_GB&plat=chromium%20130&category=question&q=blank%20capture');
  assert.deepEqual(hidden, { app: 'fullshot', v: '1.10.3', loc: 'en_GB', plat: 'chromium 130' });
});

/** The Worker request the Function forwards for `fields`, as parsed JSON. */
async function forwarded(fields) {
  let sent = null;
  const env = { PLATFORM: { fetch: async (req) => { sent = JSON.parse(await req.text()); return new Response(JSON.stringify({ id: 'FB-0000000001' }), { status: 201 }); } } };
  const body = new URLSearchParams({ description: 'x', elapsed: '5000', key: 'site-test-0001', ...fields });
  const request = new Request('https://nikatru.com/api/report', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const res = await onRequestPost({ request, env });
  assert.equal(res.status, 303);
  return sent;
}

test('the site form with no extension facts is the site\'s own report', async () => {
  const r = await forwarded({ category: 'question' });
  assert.equal(r.appId, 'nikatru');
  assert.equal(r.surface, 'site');
  assert.deepEqual(r.diagnostics, { platform: 'web', channel: 'site' });
  assert.equal(r.category, 'question');
});

test('🔴 an extension\'s facts reach the Worker as the extension\'s report', async () => {
  const r = await forwarded({ app: 'fullshot', v: '1.10.3', loc: 'en_GB', plat: 'chromium 130' });
  assert.equal(r.appId, 'fullshot');
  assert.equal(r.surface, 'extension');
  assert.deepEqual(r.diagnostics, { platform: 'chromium 130', channel: 'extension', appVersion: '1.10.3', locale: 'en-GB' });
});

test('🔴 a fact that is not its key\'s shape is dropped, never forwarded', async () => {
  const r = await forwarded({ app: 'fullshot', v: 'https://evil.example/x', loc: 'evil.example', plat: 'Mozilla/5.0 (X11)' });
  assert.deepEqual(r.diagnostics, { platform: 'other', channel: 'extension' });
  const bad = await forwarded({ app: 'Not An Id' });
  assert.equal(bad.appId, 'nikatru');
});
