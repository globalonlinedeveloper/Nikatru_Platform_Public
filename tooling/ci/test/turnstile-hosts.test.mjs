// ─────────────────────────────────────────────────────────────────────────────
// turnstile-hosts.test.mjs — check-turnstile-hosts.mjs must catch the outage it
// was written for, and must refuse to grade a console it could not read.
//
// 🔴 THE OUTAGE, 2026-09-12: the `nikatru-auth` widget allowed `localhost` and
// `subly.nikatru.com` while the app was served from `nikatru.com`. Turnstile
// answered "Domain not allowed.", the challenge never rendered, and sign-in and
// sign-up were dead for every user — silently. The first case below is that exact
// state, reproduced from the values the live account actually held.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { servedHosts, judge, readWidget, CouldNotLook } from '../../ops/check-turnstile-hosts.mjs';

const SITEKEY = '0x4AAAAAAEmJbm3bI8bk4wno';

describe('servedHosts — derived from the catalogue, never listed', () => {
  test('reads the host out of every app address, deduped and sorted', () => {
    const hosts = servedHosts([
      { slug: 'a', url: 'https://nikatru.com/a', listings: { web: 'https://nikatru.com/a' } },
      { slug: 'b', url: 'https://other.example/b' },
    ]);
    assert.deepEqual(hosts, ['nikatru.com', 'other.example']);
  });

  test('accepts either catalogue shape — a bare array or { apps: [...] }', () => {
    const rows = [{ slug: 'a', url: 'https://nikatru.com/a' }];
    assert.deepEqual(servedHosts(rows), servedHosts({ apps: rows }));
  });

  test('a null listing beside a real url is skipped, not treated as a host', () => {
    assert.deepEqual(
      servedHosts([{ slug: 'a', url: 'https://nikatru.com/a', listings: { web: null, play: null } }]),
      ['nikatru.com'],
    );
  });

  // Each of these would otherwise make the comparison range over nothing, which is
  // the shape that prints ok about a question it never asked.
  for (const [what, value] of [
    ['an empty catalogue', []],
    ['rows with no address at all', [{ slug: 'a' }]],
  ]) {
    test(`${what} is COULD NOT LOOK, never an empty pass`, () => {
      assert.throws(() => servedHosts(value), CouldNotLook);
    });
  }

  test('an address that is not a URL is refused rather than guessed at', () => {
    assert.throws(() => servedHosts([{ slug: 'a', url: 'nikatru.com/a' }]), CouldNotLook);
  });
});

describe('judge — every host we SERVE must be allowed', () => {
  test('🔴 the real outage: the widget names the retired subdomain and not the apex', () => {
    const v = judge({
      sitekey: SITEKEY,
      served: ['nikatru.com'],
      allowed: ['localhost', 'subly.nikatru.com'],
    });
    assert.equal(v.ok, false);
    assert.deepEqual(v.missing, ['nikatru.com']);
    assert.match(v.line, /does not allow 1 host\(s\)/);
    // The MISSING host, in the clause that names it — `subly.nikatru.com` in the
    // "It allows" clause must not satisfy this (CodeQL js/regex/missing-regexp-anchor).
    assert.match(v.line, /we serve: nikatru\.com\. It allows /);
    // the message has to say what the user SEES, or the next reader cannot connect
    // a red check to a form that merely looks broken
    assert.match(v.line, /Domain not allowed/);
    assert.match(v.line, /SIGN-IN AND SIGN-UP ARE DEAD/);
  });

  test('the fixed state passes', () => {
    const v = judge({ sitekey: SITEKEY, served: ['nikatru.com'], allowed: ['localhost', 'nikatru.com'] });
    assert.equal(v.ok, true);
    assert.match(v.line, /every served host is allowed/);
  });

  // ⚠️ ONE-DIRECTIONAL ON PURPOSE. A widget that allows more than the catalogue
  // names is not a finding: local development needs `localhost`, and a staging
  // host is nobody's emergency. Asserting equality here would make the check
  // fire on every legitimate extra and teach everyone to ignore it.
  test('extra allowed hosts are not a finding', () => {
    const v = judge({
      sitekey: SITEKEY,
      served: ['nikatru.com'],
      allowed: ['localhost', 'nikatru.com', 'staging.nikatru.com', '127.0.0.1'],
    });
    assert.equal(v.ok, true);
  });

  test('matching ignores case, because hostnames are case-insensitive', () => {
    const v = judge({ sitekey: SITEKEY, served: ['nikatru.com'], allowed: ['NIKATRU.COM'] });
    assert.equal(v.ok, true);
  });

  test('a widget allowing nothing names every served host, and says so readably', () => {
    const v = judge({ sitekey: SITEKEY, served: ['a.example', 'b.example'], allowed: [] });
    assert.equal(v.ok, false);
    assert.deepEqual(v.missing, ['a.example', 'b.example']);
    assert.match(v.line, /It allows \(none\)/);
  });

  test('a second app on a new host is asked about with no edit to the check', () => {
    const v = judge({
      sitekey: SITEKEY,
      served: ['nikatru.com', 'newapp.example'],
      allowed: ['nikatru.com'],
    });
    assert.equal(v.ok, false);
    assert.deepEqual(v.missing, ['newapp.example']);
  });
});

describe('readWidget — fail-closed, and by SITEKEY not by name', () => {
  test('asks for the widget carrying the sitekey the build ships', async () => {
    let asked = null;
    const api = async (path) => {
      asked = path;
      return { name: 'nikatru-auth', domains: ['nikatru.com'] };
    };
    const w = await readWidget({ accountId: 'acct', sitekey: SITEKEY, token: 't' }, api);
    assert.equal(asked, `/accounts/acct/challenges/widgets/${SITEKEY}`);
    assert.deepEqual(w.domains, ['nikatru.com']);
    assert.equal(w.name, 'nikatru-auth');
  });

  test('a widget with no `domains` array is COULD NOT LOOK, not an empty list', async () => {
    const api = async () => ({ name: 'x' });
    await assert.rejects(
      () => readWidget({ accountId: 'a', sitekey: SITEKEY, token: 't' }, api),
      CouldNotLook,
    );
  });

  test('an API that throws surfaces as COULD NOT LOOK rather than a pass', async () => {
    const api = async () => {
      throw new CouldNotLook('the Cloudflare API answered HTTP 403');
    };
    await assert.rejects(
      () => readWidget({ accountId: 'a', sitekey: SITEKEY, token: 't' }, api),
      CouldNotLook,
    );
  });
});
