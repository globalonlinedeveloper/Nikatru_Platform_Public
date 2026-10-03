// ─────────────────────────────────────────────────────────────────────────────
// site-identity-client.test.mjs — sites/nikatru/js/identity-client.js, the one
// module through which a nikatru.com page calls the identity provider
// (port-auth, 2026-10-03). The wire it sends is the wire signin.js sent before
// the move; the refusals keep their fixed phrases (never a response body).
// assert-ports limb 4's site half holds every other site file to it.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { identityClient } from '../../../sites/nikatru/js/identity-client.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function serve(answer) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return seen;
}

const client = identityClient({ endpoint: 'https://id.test', publicKey: 'sb_publishable_test' });

describe('identity-client.js', () => {
  test('token: POST <endpoint>/auth/v1/token?grant_type=<grant> with the public key, the body as JSON', async () => {
    const seen = serve(new Response(JSON.stringify({ access_token: 't' }), { status: 200 }));
    assert.deepEqual(await client.token('password', { email: 'a@b.test', password: 'p' }), { access_token: 't' });
    assert.equal(seen[0].url, 'https://id.test/auth/v1/token?grant_type=password');
    assert.equal(seen[0].init.method, 'POST');
    assert.deepEqual(seen[0].init.headers, { apikey: 'sb_publishable_test', 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(seen[0].init.body), { email: 'a@b.test', password: 'p' });
  });

  test('refusals are fixed phrases: network, credentials (400/401), unavailable (else, or no token)', async () => {
    serve(new TypeError('Failed to fetch'));
    await assert.rejects(client.token('pkce', {}), { message: 'network' });
    for (const status of [400, 401]) {
      serve(new Response('{"msg":"echo of input"}', { status }));
      await assert.rejects(client.token('password', {}), { message: 'credentials' });
    }
    serve(new Response('', { status: 503 }));
    await assert.rejects(client.token('password', {}), { message: 'unavailable' });
    serve(new Response('{}', { status: 200 }));
    await assert.rejects(client.token('password', {}), { message: 'unavailable' });
  });

  test('authorizeUrl: <endpoint>/auth/v1/authorize?<query>', () => {
    const q = new URLSearchParams({ provider: 'apple', redirect_to: 'https://nikatru.com/ext/connect' });
    assert.equal(client.authorizeUrl(q), `https://id.test/auth/v1/authorize?${q.toString()}`);
  });
});
