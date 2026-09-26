// ─────────────────────────────────────────────────────────────────────────────
// smoke-site-deploy.test.mjs — tooling/sites/smoke-site-deploy.mjs: the apex site's
// host serves THIS commit's version.json, and its Function answers an empty POST with
// the validation error (row O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE, D3a).
//
// The host is a LOOPBACK server this file starts, never a Cloudflare origin. The
// Function's answer is not assumed: the last block runs the SHIPPING subscribe.js on the
// exact request the smoke sends, with bindings that throw on any touch, so the status
// the smoke asserts is the status the code gives, and the request provably writes nothing.
//
// Red control RC2: version.json's sha ≠ the run's SHA → the smoke exits 1.
//
// Run:  timeout 600 node --single-threaded --test tooling/ci/test/smoke-site-deploy.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, smokeVersion, smokeFunction, originOf, EMPTY_BODY_STATUS } from '../../sites/smoke-site-deploy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SMOKE = join(ROOT, 'tooling', 'sites', 'smoke-site-deploy.mjs');
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

/** What the loopback host answers, set per test, and every request it saw. */
let host = { version: { status: 200, body: JSON.stringify({ sha: SHA, build_number: 7 }) }, subscribe: { status: 400, body: '{"ok":false,"error":"Could not read your submission. Please try again."}' } };
const seen = [];
let server;
let ORIGIN;
before(async () => {
  server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, contentType: req.headers['content-type'] ?? null, body: Buffer.concat(chunks).toString('utf8') });
      const a = req.method === 'GET' && req.url === '/version.json' ? host.version : req.method === 'POST' && req.url === '/api/subscribe' ? host.subscribe : { status: 404, body: 'nope' };
      res.writeHead(a.status, { 'content-type': 'application/json' });
      res.end(a.body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  ORIGIN = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

/** The CLI in a child process, asynchronously: the loopback host lives in THIS process. */
function cli(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [SMOKE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });
}
const noSleep = async () => {};
const realGet = async (url) => {
  const r = await fetch(url);
  return { status: r.status, body: await r.text() };
};
const realPost = async (url) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '' });
  return { status: r.status, body: await r.text() };
};

describe('smoke-site-deploy — the CLI against a loopback host', () => {
  test('green control: version.json carries the SHA and the Function answers 400 { ok: false } → exit 0', async () => {
    host = { ...host, version: { status: 200, body: JSON.stringify({ sha: SHA, build_number: 7 }) } };
    seen.length = 0;
    const r = await cli(['--origin', ORIGIN, '--expect-sha', SHA]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /serves sha a{40}/);
    assert.match(r.out, /answered 400 \{ ok: false \}/);
  });

  test('the POST the smoke sends is EMPTY: no body, no address, JSON content type', async () => {
    seen.length = 0;
    const r = await cli(['--origin', ORIGIN, '--expect-sha', SHA]);
    assert.equal(r.code, 0, r.out);
    const posts = seen.filter((s) => s.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body, '');
    assert.equal(posts[0].contentType, 'application/json');
    assert.ok(!seen.some((s) => s.body.includes('@')), 'a request carried an address');
  });

  test('a host with no Function answers the POST 405 → exit 1, naming the missing functions/', async () => {
    const saved = host.subscribe;
    host = { ...host, subscribe: { status: 405, body: 'Method Not Allowed' } };
    try {
      const r = await cli(['--origin', ORIGIN, '--expect-sha', SHA]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /answered 405, expected 400, which is what a host with NO Function answers/);
    } finally {
      host = { ...host, subscribe: saved };
    }
  });

  test('a 400 that is not the Function\'s JSON → exit 1', async () => {
    const saved = host.subscribe;
    host = { ...host, subscribe: { status: 400, body: '<html>bad request</html>' } };
    try {
      const r = await cli(['--origin', ORIGIN, '--expect-sha', SHA]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /without subscribe\.js's JSON/);
    } finally {
      host = { ...host, subscribe: saved };
    }
  });

  test('a 200 version.json that is not JSON fails at once, without waiting out the retries → exit 1', async () => {
    const saved = host.version;
    host = { ...host, version: { status: 200, body: '<!doctype html>' } };
    try {
      const t0 = Date.now();
      const r = await cli(['--origin', ORIGIN, '--expect-sha', SHA]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /not JSON/);
      assert.ok(Date.now() - t0 < 9000, 'the smoke waited on a served page');
    } finally {
      host = { ...host, version: saved };
    }
  });

  test('usage: no --expect-sha → exit 2', async () => {
    const r = await cli(['--origin', ORIGIN]);
    assert.equal(r.code, 2, r.out);
  });

  test('usage: an http origin that is not loopback → exit 2', async () => {
    const r = await cli(['--origin', 'http://nikatru-apex.pages.dev', '--expect-sha', SHA]);
    assert.equal(r.code, 2, r.out);
  });
});

describe('smoke-site-deploy — main() over the loopback host, retries not slept', () => {
  test('RC2: version.json sha ≠ the run SHA → exit 1 after every attempt', async () => {
    const saved = host.version;
    host = { ...host, version: { status: 200, body: JSON.stringify({ sha: OTHER, build_number: 7 }) } };
    try {
      seen.length = 0;
      const code = await main(['--origin', ORIGIN, '--expect-sha', SHA], { get: realGet, post: realPost, sleep: noSleep });
      assert.equal(code, 1);
      assert.equal(seen.filter((s) => s.method === 'GET').length, 6, 'the mismatch was not retried to the ceiling');
      assert.equal(seen.filter((s) => s.method === 'POST').length, 0, 'the Function was probed on a host not serving this commit');
    } finally {
      host = { ...host, version: saved };
    }
  });

  test('a version.json with no sha field → exit 1', async () => {
    const saved = host.version;
    host = { ...host, version: { status: 200, body: JSON.stringify({ build_number: 7 }) } };
    try {
      const code = await main(['--origin', ORIGIN, '--expect-sha', SHA], { get: realGet, post: realPost, sleep: noSleep });
      assert.equal(code, 1);
    } finally {
      host = { ...host, version: saved };
    }
  });

  test('propagation: the previous SHA twice, then this one → exit 0', async () => {
    const answers = [OTHER, OTHER, SHA];
    let i = 0;
    const get = async () => ({ status: 200, body: JSON.stringify({ sha: answers[Math.min(i++, answers.length - 1)] }) });
    const code = await main(['--origin', ORIGIN, '--expect-sha', SHA], { get, post: realPost, sleep: noSleep });
    assert.equal(code, 0);
    assert.equal(i, 3);
  });
});

describe('smoke-site-deploy — the pure parts', () => {
  test('originOf: https or loopback http, no path', () => {
    assert.equal(originOf('https://nikatru-apex.pages.dev'), 'https://nikatru-apex.pages.dev');
    assert.equal(originOf('https://nikatru-apex.pages.dev/'), 'https://nikatru-apex.pages.dev');
    assert.equal(originOf('https://nikatru-apex.pages.dev/version.json'), null);
    assert.equal(originOf('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    assert.equal(originOf('http://example.com'), null);
    assert.equal(originOf('not a url'), null);
  });

  test('smokeVersion: a network error is retried, never a pass', async () => {
    const r = await smokeVersion({ origin: 'https://x.invalid', sha: SHA, get: async () => { throw new Error('ECONNRESET'); }, attempts: 2, sleep: noSleep });
    assert.equal(r.ok, false);
    assert.match(r.detail, /request failed: ECONNRESET/);
  });

  test('smokeFunction: a 200 on an empty body is a failure (nothing should accept it)', async () => {
    const r = await smokeFunction({ origin: 'https://x.invalid', post: async () => ({ status: 200, body: '{"ok":true}' }) });
    assert.equal(r.ok, false);
    assert.match(r.detail, /answered 200, expected 400/);
  });
});

describe('the SHIPPING subscribe.js answers the smoke\'s request with the status the smoke asserts', () => {
  test('an empty JSON-typed POST → 400 { ok: false }, and no binding is touched', async () => {
    const { onRequestPost } = await import(pathToFileURL(join(ROOT, 'sites', 'nikatru', 'functions', 'api', 'subscribe.js')).href);
    const touched = [];
    const env = new Proxy({}, {
      get(_t, key) {
        touched.push(String(key));
        throw new Error(`the empty-body request touched env.${String(key)}`);
      },
    });
    const request = new Request('https://nikatru-apex.pages.dev/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '' });
    const res = await onRequestPost({ request, env });
    assert.equal(res.status, EMPTY_BODY_STATUS);
    assert.equal((await res.json()).ok, false);
    assert.deepEqual(touched, []);
  });
});
