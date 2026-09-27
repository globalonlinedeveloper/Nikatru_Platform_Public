// ─────────────────────────────────────────────────────────────────────────────
// tooling/web/pages-origin.mjs — the Pages origin is read back from Cloudflare at
// creation and checked offline against app.yaml (O-PRODUCT-RECORD-UNBUILT, G-a).
//
// Every Cloudflare call goes through the injected fetch and wrangler runner, so
// nothing here leaves the process. Fixtures live in os.tmpdir() (ADR no.072).
//
//   RC-G4  --check on an app.yaml whose `web` != `pagesOrigin`   -> exit 1, both named
//   RC-G5  --verify on app #1's REAL app.yaml, the project answering
//          subscriptiontracker-xyz.pages.dev (stubbed read-back)   -> exit 1, both named,
//          the lines to write printed, no match line (G-b)
//   RC-G5b is NOT here and cannot be: it is the first deploy-web run on main after
//          the merge, whose log prints
//          `pagesOrigin subscriptiontracker-7qg.pages.dev = the project's subdomain`.
//          Possibility is not observation: the parent reads that run.
//
// Run:  node --test tooling/ci/test/pages-origin.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { main, originFindings, verifyFindings } from '../../web/pages-origin.mjs';

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

test('--apply with no locked wrangler island is COVERAGE LOST (exit 2): never an npx fetch, and nothing is read', async () => {
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } });
  const c = io();
  assert.equal(await main(['--apply', 'lingo'], { root: TMP, env: CREDS, fetchImpl: cf.fetchImpl, ...c }), 2, c.text());
  assert.equal(cf.calls.length, 0);
  assert.match(c.text(), /COVERAGE LOST — the wrangler island is not installed \(tooling\/wrangler\/node_modules\/\.bin\/wrangler\)/);
});

test('originFindings is empty for a sound record and names each fault once', () => {
  assert.deepEqual(originFindings({ hosts: { web: 'a-1x.pages.dev', pagesOrigin: 'a-1x.pages.dev' } }, 'x'), []);
  assert.equal(originFindings({ hosts: { web: 'a.nikatru.com', pagesOrigin: 'a.nikatru.com' } }, 'x').length, 1);
  assert.equal(originFindings({ hosts: {} }, 'x').length, 1);
});

// ── G-b: --verify, the check deploy-web.yml runs before it publishes ─────────

/** A fetch stub that answers each GET from a script of answers, in order. */
function scripted(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init?.headers?.Authorization, signal: init?.signal });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, headers: new Headers(), json: async () => a.body };
  };
  return { calls, fetchImpl };
}

/** The wire dropping, in the shape undici's fetch rejects with. */
function dropped() {
  const e = new TypeError('fetch failed');
  e.cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
  return e;
}

const noWait = { sleep: async () => {} };

test('🔴 RC-G5: --verify on app #1 whose project answers another subdomain is exit 1, naming both and the lines to write', async () => {
  const cf = cloudflare(200, { success: true, result: { name: 'subscriptiontracker', subdomain: 'subscriptiontracker-xyz.pages.dev' } });
  const c = io();
  assert.equal(await main(['--verify', 'subscriptiontracker'], { root: REPO, env: CREDS, fetchImpl: cf.fetchImpl, ...noWait, ...c }), 1, c.text());
  assert.equal(c.out.length, 0, 'a mismatch prints no match line');
  const lines = c.text().split('\n');
  assert.match(lines[0], /^::error title=Pages origin::apps\/subscriptiontracker\/app\.yaml declares hosts\.pagesOrigin "subscriptiontracker-7qg\.pages\.dev"/);
  assert.match(lines[0], /answers subdomain "subscriptiontracker-xyz\.pages\.dev"\. Nothing was deployed\./);
  assert.ok(lines.includes('  web: subscriptiontracker-xyz.pages.dev'), c.text());
  assert.ok(lines.includes('  pagesOrigin: subscriptiontracker-xyz.pages.dev'), c.text());
  assert.equal(cf.calls.length, 1);
  assert.match(cf.calls[0].url, /\/accounts\/acct123\/pages\/projects\/subscriptiontracker$/);
});

test('--verify on app #1 whose project answers the declared subdomain prints the proof line RC-G5b reads, exit 0', async () => {
  const cf = cloudflare(200, { success: true, result: { name: 'subscriptiontracker', subdomain: 'subscriptiontracker-7qg.pages.dev' } });
  const c = io();
  assert.equal(await main(['--verify', 'subscriptiontracker'], { root: REPO, env: CREDS, fetchImpl: cf.fetchImpl, ...noWait, ...c }), 0, c.text());
  assert.deepEqual(c.out, ["pagesOrigin subscriptiontracker-7qg.pages.dev = the project's subdomain"]);
  assert.equal(c.text(), c.out.join('\n'), 'nothing is printed to stderr on a match');
  assert.equal(cf.calls[0].auth, 'Bearer test-token');
});

test('--verify on an app.yaml that declares no pagesOrigin is exit 1 BEFORE any Cloudflare call', async () => {
  const root = tree('lingo', ['web: lingo-4hk.pages.dev']);
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } });
  const c = io();
  assert.equal(await main(['--verify', 'lingo'], { root, env: CREDS, fetchImpl: cf.fetchImpl, ...noWait, ...c }), 1, c.text());
  assert.equal(cf.calls.length, 0);
  assert.match(c.text(), /declares no `hosts\.pagesOrigin`/);
});

test('--verify on an app.yaml whose web differs from pagesOrigin is exit 1 BEFORE any Cloudflare call', async () => {
  const root = tree('lingo', ['web: lingo.nikatru.com', 'pagesOrigin: lingo-4hk.pages.dev']);
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } });
  const c = io();
  assert.equal(await main(['--verify', 'lingo'], { root, env: CREDS, fetchImpl: cf.fetchImpl, ...noWait, ...c }), 1, c.text());
  assert.equal(cf.calls.length, 0);
});

test('--verify on an app with no app.yaml is COVERAGE LOST (exit 2) and calls nothing', async () => {
  const cf = cloudflare(200, { success: true, result: { subdomain: 'x-1a.pages.dev' } });
  const c = io();
  assert.equal(await main(['--verify', 'nosuchapp'], { root: TMP, env: CREDS, fetchImpl: cf.fetchImpl, ...noWait, ...c }), 2, c.text());
  assert.equal(cf.calls.length, 0);
});

test('--verify without credentials is COVERAGE LOST (exit 2) and calls nothing', async () => {
  const root = tree('lingo', ['web: lingo-4hk.pages.dev', 'pagesOrigin: lingo-4hk.pages.dev']);
  const cf = cloudflare(200, { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } });
  const c = io();
  assert.equal(await main(['--verify', 'lingo'], { root, env: {}, fetchImpl: cf.fetchImpl, ...noWait, ...c }), 2, c.text());
  assert.equal(cf.calls.length, 0);
  assert.match(c.text(), /COVERAGE LOST/);
});

test('--verify on a project Cloudflare does not have (404) is exit 1 and prints no proof line', async () => {
  const root = tree('lingo', ['web: lingo-4hk.pages.dev', 'pagesOrigin: lingo-4hk.pages.dev']);
  const cf = cloudflare(404, { success: false, errors: [{ code: 8000007 }] });
  const c = io();
  assert.equal(await main(['--verify', 'lingo'], { root, env: CREDS, fetchImpl: cf.fetchImpl, ...noWait, ...c }), 1, c.text());
  assert.equal(c.out.length, 0);
  assert.match(c.text(), /HTTP 404 with no result\.subdomain/);
  assert.equal(cf.calls.length, 1, 'a 404 is an answer, never re-asked');
});

test('--verify re-asks a 503 through the bounded retry and grades the answer that follows', async () => {
  const root = tree('lingo', ['web: lingo-4hk.pages.dev', 'pagesOrigin: lingo-4hk.pages.dev']);
  const cf = scripted([{ status: 503, body: null }, { status: 200, body: { success: true, result: { subdomain: 'lingo-4hk.pages.dev' } } }]);
  const slept = [];
  const c = io();
  assert.equal(await main(['--verify', 'lingo'], { root, env: CREDS, fetchImpl: cf.fetchImpl, sleep: async (ms) => slept.push(ms), ...c }), 0, c.text());
  assert.equal(cf.calls.length, 2);
  assert.equal(slept.length, 1);
  assert.ok(cf.calls[0].signal, 'each attempt carries the shared per-request ceiling');
  assert.deepEqual(c.out, ["pagesOrigin lingo-4hk.pages.dev = the project's subdomain"]);
});

test('--verify whose wire drops on every attempt is COVERAGE LOST (exit 2): never a pass, never a mismatch', async () => {
  const root = tree('lingo', ['web: lingo-4hk.pages.dev', 'pagesOrigin: lingo-4hk.pages.dev']);
  const cf = scripted([dropped()]);
  const c = io();
  assert.equal(await main(['--verify', 'lingo'], { root, env: CREDS, fetchImpl: cf.fetchImpl, ...noWait, ...c }), 2, c.text());
  assert.equal(cf.calls.length, 3);
  assert.equal(c.out.length, 0);
  assert.match(c.text(), /COVERAGE LOST — GET pages\/projects\/lingo: the request did not answer/);
  assert.doesNotMatch(c.text(), /::error title=Pages origin::/);
});

test('verifyFindings is empty for the same host and names both hosts otherwise', () => {
  assert.deepEqual(verifyFindings('a-1x.pages.dev', 'a-1x.pages.dev', 'a'), []);
  const f = verifyFindings('a-1x.pages.dev', 'a-2y.pages.dev', 'a');
  assert.equal(f.length, 4);
  assert.match(f[0], /^::error title=Pages origin::apps\/a\/app\.yaml declares hosts\.pagesOrigin "a-1x\.pages\.dev", but the Pages project "a" answers subdomain "a-2y\.pages\.dev"/);
  assert.deepEqual(f.slice(2), ['  web: a-2y.pages.dev', '  pagesOrigin: a-2y.pages.dev']);
});

/** deploy-web.yml's `deploy-web` job, cut into its steps (each from its `      - ` line). */
function deployWebSteps() {
  const text = readFileSync(join(REPO, '.github', 'workflows', 'deploy-web.yml'), 'utf8');
  const job = text.slice(text.indexOf('\n  deploy-web:\n'), text.indexOf('\n  site:\n'));
  assert.ok(job.length > 1000, 'the deploy-web job was not found in deploy-web.yml; this case lost its subject');
  return job.split(/\n(?=      - )/).slice(1);
}

test('🔴 R-1: deploy-web.yml runs --verify after the idempotent create and BEFORE the deploy, on the same plan gate', () => {
  const steps = deployWebSteps();
  const create = steps.findIndex((s) => s.includes('pages project create "$APP"'));
  const verify = steps.findIndex((s) => s.includes('tooling/web/pages-origin.mjs --verify'));
  const deploy = steps.findIndex((s) => s.includes('command: pages deploy build/web'));
  assert.ok(create >= 0 && verify >= 0 && deploy >= 0, `create ${create} verify ${verify} deploy ${deploy}`);
  assert.ok(create < verify, 'the verify runs after the project is ensured to exist');
  assert.ok(verify < deploy, 'the verify runs BEFORE the deploy, so a mismatch publishes nothing');
  const step = steps[verify];
  assert.match(step, /if: steps\.plan\.outputs\.deploy == 'true'/);
  assert.match(step, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(step, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(step, /run: node tooling\/web\/pages-origin\.mjs --verify "\$APP"\n/);
  assert.doesNotMatch(step, /continue-on-error/);
});
