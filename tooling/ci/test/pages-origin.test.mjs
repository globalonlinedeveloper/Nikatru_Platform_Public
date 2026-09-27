// ─────────────────────────────────────────────────────────────────────────────
// tooling/web/pages-origin.mjs — the Pages origin is read back from Cloudflare at
// creation and checked offline against app.yaml (O-PRODUCT-RECORD-UNBUILT, G-a).
//
// Every Cloudflare call goes through the injected fetch and wrangler runner, so
// nothing here leaves the process. Fixtures live in os.tmpdir() (ADR no.072).
//
//   RC-G4  --check on an app.yaml whose `web` != `pagesOrigin`   -> exit 1, both named
//   --apply with no tooling/wrangler island (the real runner)    -> exit 2, never fetched
//
// Run:  node --test tooling/ci/test/pages-origin.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main, originFindings } from '../../web/pages-origin.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-pages-origin-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A tree holding one apps/<id>/app.yaml with the given hosts block. */
function tree(id, hostsLines) {
  const root = join(TMP, `r${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(join(root, 'apps', id), { recursive: true });
  writeFileSync(join(root, 'apps', id, 'app.yaml'), `id: ${id}\nhosts:\n${hostsLines.map((l) => `  ${l}`).join('\n')}\n`);
  return root;
}

/** Captures what `main` prints. */
function io() {
  const out = [];
  const err = [];
  return { out, err, log: (s) => out.push(s), err: (s) => err.push(s), text: () => [...out, ...err].join('\n') };
}

/** A fetch stub that answers one Cloudflare project GET and records the URL it was asked. */
function cloudflare(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init?.headers?.Authorization });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

const CREDS = { CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'acct123' };

test('--check passes on app #1: its app.yaml declares a *.pages.dev pagesOrigin equal to hosts.web', async () => {
  const c = io();
  assert.equal(await main(['--check', 'subscriptiontracker'], { root: REPO, ...c }), 0, c.text());
  assert.match(c.text(), /pagesOrigin subscriptiontracker-7qg\.pages\.dev/);
});

test('🔴 RC-G4: --check on an app.yaml whose web differs from pagesOrigin is exit 1, naming both', async () => {
  const root = tree('lingo', ['web: lingo.nikatru.com', 'pagesOrigin: lingo-4hk.pages.dev']);
  const c = io();
  assert.equal(await main(['--check', 'lingo'], { root, ...c }), 1, c.text());
  assert.match(c.text(), /hosts\.web` is "lingo\.nikatru\.com" and `hosts\.pagesOrigin` is "lingo-4hk\.pages\.dev"/);
});

test('--check on an app.yaml with NO pagesOrigin is exit 1, naming the field and where the value comes from', async () => {
  const root = tree('lingo', ['web: lingo-4hk.pages.dev']);
  const c = io();
  assert.equal(await main(['--check', 'lingo'], { root, ...c }), 1, c.text());
  assert.match(c.text(), /declares no `hosts\.pagesOrigin`/);
  assert.match(c.text(), /--apply <app>/);
});

test('--check refuses a pagesOrigin outside pages.dev (the retired <id>.nikatru.com shape)', async () => {
  const root = tree('lingo', ['web: lingo.nikatru.com', 'pagesOrigin: lingo.nikatru.com']);
  const c = io();
  assert.equal(await main(['--check', 'lingo'], { root, ...c }), 1, c.text());
  assert.match(c.text(), /"lingo\.nikatru\.com", which is not a \*\.pages\.dev host/);
});

test('--check on an app with no app.yaml is COVERAGE LOST (exit 2), not a pass', async () => {
  const c = io();
  assert.equal(await main(['--check', 'nosuchapp'], { root: TMP, ...c }), 2, c.text());
  assert.match(c.text(), /COVERAGE LOST/);
});

test('no mode or no app id is COVERAGE LOST (exit 2)', async () => {
  const c = io();
  assert.equal(await main(['--read'], { root: TMP, ...c }), 2);
  assert.equal(await main([], { root: TMP, ...c }), 2);
});

test('--read prints the subdomain Cloudflare answers, from the account and project it names', async () => {
  const cf = cloudflare(200, { success: true, result: { name: 'lingo', subdomain: 'lingo-4hk.pages.dev' } });
  const c = io();
  assert.equal(await main(['--read', 'lingo'], { root: TMP, env: CREDS, fetchImpl: cf.fetchImpl, ...c }), 0, c.text());
  assert.deepEqual(c.out, ['pagesOrigin=lingo-4hk.pages.dev']);
  assert.equal(cf.calls.length, 1);
  assert.match(cf.calls[0].url, /\/accounts\/acct123\/pages\/projects\/lingo$/);
  assert.equal(cf.calls[0].auth, 'Bearer test-token');
});

test('--read on a refused answer (404, no result) is exit 1 and prints no origin', async () => {
  const cf = cloudflare(404, { success: false, errors: [{ code: 8000007 }] });
  const c = io();
  assert.equal(await main(['--read', 'lingo'], { root: TMP, env: CREDS, fetchImpl: cf.fetchImpl, ...c }), 1);
  assert.equal(c.out.length, 0);
  assert.match(c.text(), /HTTP 404 with no result\.subdomain/);
});

test('--read refuses a subdomain that is not a pages.dev host', async () => {
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo.nikatru.com' } });
  const c = io();
  assert.equal(await main(['--read', 'lingo'], { root: TMP, env: CREDS, fetchImpl: cf.fetchImpl, ...c }), 1);
  assert.match(c.text(), /not a \*\.pages\.dev host/);
});

test('--read without credentials is COVERAGE LOST (exit 2) and calls nothing', async () => {
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } });
  const c = io();
  assert.equal(await main(['--read', 'lingo'], { root: TMP, env: {}, fetchImpl: cf.fetchImpl, ...c }), 2);
  assert.equal(cf.calls.length, 0);
});

test('--apply creates the project with deploy-web.yml\'s flags, then prints the subdomain it reads back', async () => {
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } });
  const ran = [];
  const wrangler = (args) => {
    ran.push(args);
    return { code: 0, out: 'Successfully created the project' };
  };
  const c = io();
  assert.equal(await main(['--apply', 'lingo'], { root: TMP, env: CREDS, fetchImpl: cf.fetchImpl, wrangler, ...c }), 0, c.text());
  assert.deepEqual(ran, [['pages', 'project', 'create', 'lingo', '--production-branch=main']]);
  assert.deepEqual(c.out, ['pagesOrigin=lingo-4hk.pages.dev']);
});

test('--apply is idempotent: a project that already exists is read back, not an error', async () => {
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } });
  const wrangler = () => ({ code: 1, out: 'A project with this name already exists. [code: 8000002]' });
  const c = io();
  assert.equal(await main(['--apply', 'lingo'], { root: TMP, env: CREDS, fetchImpl: cf.fetchImpl, wrangler, ...c }), 0, c.text());
  assert.deepEqual(c.out, ['pagesOrigin=lingo-4hk.pages.dev']);
});

test('--apply whose create fails for another reason is exit 1 and never reads', async () => {
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } });
  const wrangler = () => ({ code: 1, out: 'Authentication error [code: 10000]' });
  const c = io();
  assert.equal(await main(['--apply', 'lingo'], { root: TMP, env: CREDS, fetchImpl: cf.fetchImpl, wrangler, ...c }), 1);
  assert.equal(cf.calls.length, 0);
  assert.match(c.text(), /Authentication error/);
});

test('--apply with the real runner and no tooling/wrangler island is COVERAGE LOST (exit 2): nothing is fetched, nothing is read', async () => {
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } });
  const c = io();
  assert.equal(await main(['--apply', 'lingo'], { root: TMP, env: CREDS, fetchImpl: cf.fetchImpl, ...c }), 2, c.text());
  assert.equal(cf.calls.length, 0);
  assert.match(c.text(), /COVERAGE LOST — the wrangler island is not installed \(tooling\/wrangler\/node_modules\/wrangler\/bin\/wrangler\.js\)/);
});

test('originFindings is empty for a sound record and names each fault once', () => {
  assert.deepEqual(originFindings({ hosts: { web: 'a-1x.pages.dev', pagesOrigin: 'a-1x.pages.dev' } }, 'x'), []);
  assert.equal(originFindings({ hosts: { web: 'a.nikatru.com', pagesOrigin: 'a.nikatru.com' } }, 'x').length, 1);
  assert.equal(originFindings({ hosts: {} }, 'x').length, 1);
});
