// ─────────────────────────────────────────────────────────────────────────────
// policy-claims.test.mjs — assert-policy-claims.mjs must be able to FAIL.
//
// [pipeline K-3]/[K-5]. The recorded mutation run is against a scratch COPY OF
// THE REAL REPOSITORY, 14/14 as intended, and two of those results changed the
// guard:
//   · the `absent` assertion over `cf-connecting-ip` fired on a COMMENT saying
//     the header is never read — the guard now strips comments before matching,
//     and the inverse mutation (the token inside a comment) is proven SILENT;
//   · the route-segment extractor matched `c.get('requestId')`,
//     `headers.get('content-length')` and `CONFIG_KV.get('config:…')` — three
//     map lookups reported as undeclared payment webhooks. Requiring a leading
//     slash fixed it.
// A third mutation reported NOT CAUGHT for a mutation that never happened (the
// anchor was wrong and `.replace()` silently did nothing), which is why the
// harness now throws on a missing anchor.
//
// ⚠️ A FIXTURE AGREES WITH WHATEVER MISUNDERSTANDING WROTE IT. These are the
// regression net; the mutation run against the real tree is the proof.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TAX_SENTENCES } from '../../sites/generate-discovery.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-policy-claims.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-claims-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const write = (root, relPath, body) => {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

const page = (title, spans) =>
  `<!DOCTYPE html><html lang="en"><body><main><h1>${title}</h1>` +
  spans.map((s) => `<p><b>${s}</b></p>`).join('') +
  '</main></body></html>\n';

const DEFAULT_CLAIMS = {
  pages: ['privacy.html', 'terms.html', 'refund.html'],
  siteRoot: 'sites/nikatru',
  claims: [
    { page: 'privacy.html', claim: 'NIKATRU', type: 'descriptive', why: 'the trading name' },
    {
      page: 'privacy.html',
      claim: 'we store only your email',
      type: 'code',
      assert: {
        kind: 'present',
        files: ['functions/subscribe.js'],
        pattern: 'const record = \\{ email, ts:',
        why: 'the whole record, one line of code',
      },
    },
    {
      page: 'privacy.html',
      claim: 'we never read your address',
      type: 'code',
      assert: {
        kind: 'absent',
        files: ['services/api/src/routes/events.ts'],
        pattern: '(?i)cf-connecting-ip',
        why: 'the route never reads the header',
      },
    },
    { page: 'terms.html', claim: 'Cloudmark', type: 'provider', providers: ['cloudmark'] },
    { page: 'refund.html', claim: '7 days', type: 'descriptive', why: 'our own commitment' },
    { type: 'seller-by-rail', rail: 'paddle', pages: ['terms.html', 'refund.html'], note: 'the merchant of record sells' },
    { type: 'seller-by-rail', rail: 'razorpay', pages: ['terms.html', 'refund.html'], note: 'Nikatru sells; the gateway processes' },
  ],
};

const DEFAULT_PROVIDERS = {
  nonProviderRouteSegments: { segments: ['v1', 'health', 'webhooks', 'events'] },
  roles: {
    merchant_of_record: { means: 'the legal seller', sellerIs: 'provider' },
    payment_gateway: { means: 'takes the payment on our behalf', sellerIs: 'nikatru' },
    infrastructure: { means: 'hosts the service', sellerIs: 'not-applicable' },
    iap_aggregator: { means: 'normalises purchase events', sellerIs: 'never' },
  },
  statuses: {
    live: { means: 'in use', silent: false },
    'not-yet-applied': { means: 'applied for, not live', silent: false },
    'wired-not-live': { means: 'reached by code, not live', silent: false },
    deferred: { means: 'a decision not yet taken', silent: true },
    retired: { means: 'a decision taken and reversed', silent: true },
    'not-named-not-wired': { means: 'named nowhere, reached by nothing', silent: true },
  },
  providers: [
    {
      id: 'cloudmark',
      name: 'Cloudmark',
      role: 'infrastructure',
      status: 'live',
      reachableAt: null,
      tells: ['cloudmark'],
      namedIn: ['terms.html'],
    },
    {
      id: 'seller-co',
      name: 'Seller Co',
      role: 'merchant_of_record',
      status: 'not-yet-applied',
      ownerItem: 'A-1',
      reachableAt: null,
      tells: ['seller co'],
      namedIn: [],
      requiredWhen: { kind: 'channelRail', rail: 'paddle' },
    },
    {
      id: 'payrail',
      name: 'PayRail',
      role: 'iap_aggregator',
      status: 'wired-not-live',
      reachableAt: '/payrail',
      tells: ['payrail'],
      namedIn: ['terms.html'],
    },
    {
      id: 'gatepay',
      name: 'GatePay',
      role: 'payment_gateway',
      status: 'wired-not-live',
      reachableAt: null,
      tells: ['gatepay'],
      namedIn: [],
      requiredWhen: { kind: 'channelRail', rail: 'razorpay', regionToo: true },
    },
  ],
  disclosureGaps: [],
};

/** The rails the seller-by-rail limb quantifies over, and one channel moving
 *  India off its base rail — the shape tooling/channel-register.json has. */
const DEFAULT_CHANNELS = {
  purchaseRails: { rails: { paddle: 'merchant of record', razorpay: 'the India gateway', none: 'sells nothing' } },
  channels: [{ id: 'web', purchaseRail: { rail: 'paddle', regionRails: [{ region: 'IN', rail: 'razorpay' }] } }],
};

/** Who sells, said the way the published pages say it. Plain text, no emphasis:
 *  these blocks are not claim spans, so the span pairing never sees them. */
const TERMS_SELLERS =
  '<p>For every other purchase, Seller Co is our merchant of record and the legal seller, in every country we sell to except India.</p>' +
  '<ul><li>In India, GatePay takes the payment on our behalf; Nikatru remains the seller.</li></ul>' +
  '<p>PayRail records store purchases on our behalf and is never the seller.</p>';
const REFUND_SELLERS =
  '<ul><li>Outside India, Seller Co is the merchant of record.</li>' +
  '<li>In India, GatePay is our payment gateway and Nikatru is the seller.</li></ul>';
const withText = (html, extra) => html.replace('</main>', `${extra}</main>`);

/** A synthetic tree with the shape the guard reads. Every option mutates one
 *  limb's input and nothing else. `channels: null` writes no channel register. */
function fixture({ claims = {}, providers = {}, pages = {}, channels = DEFAULT_CHANNELS, routes = null, subscribe, events } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(root, { recursive: true });

  const claimsReg = { ...structuredClone(DEFAULT_CLAIMS), ...claims };
  const providerReg = { ...structuredClone(DEFAULT_PROVIDERS), ...providers };
  write(root, join('tooling', 'legal', 'policy-claims.json'), JSON.stringify(claimsReg, null, 2));
  write(root, join('tooling', 'legal', 'provider-register.json'), JSON.stringify(providerReg, null, 2));
  if (channels !== null) write(root, join('tooling', 'channel-register.json'), JSON.stringify(channels, null, 2));

  const defaults = {
    'privacy.html': page('Privacy', ['NIKATRU', 'we store only your email', 'we never read your address']),
    'terms.html': withText(page('Terms', ['Cloudmark']), TERMS_SELLERS),
    'refund.html': withText(page('Refunds', ['7 days']), REFUND_SELLERS),
  };
  for (const [name, body] of Object.entries({ ...defaults, ...pages })) {
    if (body !== null) write(root, join('sites', 'nikatru', name), body);
  }

  write(
    root,
    join('functions', 'subscribe.js'),
    subscribe ?? 'export async function onRequestPost() {\n  const record = { email, ts: now };\n}\n',
  );
  write(
    root,
    join('services', 'api', 'src', 'routes', 'events.ts'),
    events ?? '// CF-Connecting-IP is NEVER read.\nevents.post(\'/events\', async (c) => c.json({}));\n',
  );
  write(
    root,
    join('services', 'api', 'src', 'index.ts'),
    routes ?? "app.get('/v1/health', (c) => c.json({}));\napp.route('/v1/webhooks', webhooks);\napp.post('/payrail', h);\n",
  );
  write(root, join('services', 'api', 'src', 'lib', 'util.ts'), 'export const x = 1;\n');
  write(root, join('services', 'api', 'src', 'lib', 'more.ts'), 'export const y = 2;\n');
  write(root, join('services', 'api', 'src', 'lib', 'even-more.ts'), 'export const z = 3;\n');
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-policy-claims — the baseline fixture is valid input', () => {
  test('a complete, consistent tree passes', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
  });
});

describe('the claims relation — both directions', () => {
  test('a newly emphasised sentence with no row FAILS', () => {
    const root = fixture({
      pages: { 'privacy.html': page('Privacy', ['NIKATRU', 'we store only your email', 'we never read your address', 'we never log anything']) },
    });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /has no row for it/);
  });

  test('a row whose sentence is no longer emphasised FAILS', () => {
    const root = fixture({ pages: { 'refund.html': page('Refunds', ['30 days']) } });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /no longer emphasises it/);
  });

  test('two rows for one claim FAIL — the comparison would be ambiguous', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims.push({ page: 'refund.html', claim: '7 days', type: 'descriptive', why: 'again' });
    const r = run(fixture({ claims }));
    assert.equal(r.status, 1);
    assert.match(out(r), /has TWO rows for the claim/);
  });

  test('an unknown row type FAILS rather than being treated as the weakest kind', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims[0].type = 'probably-fine';
    const r = run(fixture({ claims }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which is not one of/);
  });
});

describe('the code assertions', () => {
  test('a `present` assertion whose pattern stops matching FAILS', () => {
    const r = run(fixture({ subscribe: 'const record = { email, referrer, ts: now };\n' }));
    assert.equal(r.status, 1);
    assert.match(out(r), /the page publishes this claim and NOTHING in/);
  });

  test('an `absent` assertion whose pattern starts matching FAILS', () => {
    const r = run(fixture({ events: "const ip = c.req.header('cf-connecting-ip');\nevents.post('/events', h);\n" }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which the claim says does not happen/);
  });

  test('an `absent` assertion is NOT fooled by the token inside a comment', () => {
    // The mutation that changed this guard. A comment saying the thing never
    // happens matched a pattern looking for it happening — the guard reported
    // the opposite of the truth exactly when the code was right.
    const r = run(fixture({ events: "/* cf-connecting-ip is never read here */\nevents.post('/events', h);\n" }));
    assert.equal(r.status, 0, out(r));
  });

  test('a `code` row with no assert block FAILS — it inflates the register\'s apparent strength', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    delete claims.claims[1].assert;
    const r = run(fixture({ claims }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no usable `assert` block/);
  });

  test('a `code` row whose assertion has no `why` FAILS — an unreviewable regex', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    delete claims.claims[1].assert.why;
    const r = run(fixture({ claims }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries an assertion with no `why`/);
  });

  test('a `code` row pointing at a deleted file FAILS rather than being skipped', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims[1].assert.files = ['functions/gone.js'];
    const r = run(fixture({ claims }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which do\(es\) not exist/);
  });

  test('a walk that under-reaches its floor is COVERAGE LOST, not a pass', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims[1].assert = {
      kind: 'absent',
      walk: { root: 'services', filenameRe: '^nothing\\.yaml$', minFiles: 3 },
      pattern: 'anything',
      why: 'a walk with a floor',
    };
    const r = run(fixture({ claims }));
    assert.equal(r.status, 2);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /would pass by finding nothing to look at/);
  });
});

describe('the provider relation [pipeline K-5]', () => {
  test('a claims row naming a provider the register does not know FAILS', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims[3].providers = ['nobody-inc'];
    const r = run(fixture({ claims }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which has no row in/);
  });

  test('a register claiming a disclosure the page never made FAILS', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[0].namedIn = ['terms.html', 'refund.html'];
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is recorded as named in/);
  });

  test('a LIVE merchant of record missing from terms or refund FAILS', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[1].status = 'live';
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is a LIVE merchant of record and is not named in/);
  });

  test('a NOT-live merchant of record PRINTS instead of failing', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /MERCHANT OF RECORD NOT YET NAMED/);
  });

  test('a register with no merchant-of-record row at all FAILS — the rule would range over nothing', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers = providers.providers.filter((p) => p.role !== 'merchant_of_record');
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares NO merchant_of_record row/);
  });

  test('a role outside the register\'s own dictionary FAILS', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[0].role = 'vibes';
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is not defined in the register's own/);
  });

  test('a provider row with no tells FAILS — it could never be found missing', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[0].tells = [];
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares no `tells`/);
  });
});

describe('the route limb — a provider arriving in CODE', () => {
  test('an undeclared payment webhook FAILS', () => {
    const r = run(fixture({ routes: "app.get('/v1/health', h);\napp.post('/payrail', h);\napp.post('/stripe', h);\n" }));
    assert.equal(r.status, 1);
    assert.match(out(r), /nor listed in its `nonProviderRouteSegments`/);
  });

  test('a map lookup is NOT a route — `c.get(\'requestId\')` must not read as a webhook', () => {
    // Three of these existed in the real tree and were reported as undeclared
    // payment webhooks by the first draft. The leading slash is what fixed it.
    const r = run(
      fixture({
        routes:
          "const id = c.get('requestId');\nconst len = h.get('content-length');\nconst v = KV.get('config:x');\n" +
          "app.get('/v1/health', h);\napp.post('/payrail', h);\n",
      }),
    );
    assert.equal(r.status, 0, out(r));
  });

  test('a route registration inside a comment is not a route', () => {
    const r = run(fixture({ routes: "// app.post('/stripe', h);\napp.get('/v1/health', h);\napp.post('/payrail', h);\n" }));
    assert.equal(r.status, 0, out(r));
  });

  test('a register row whose reachableAt no longer resolves FAILS', () => {
    const r = run(fixture({ routes: "app.get('/v1/health', h);\napp.route('/v1/webhooks', w);\n" }));
    assert.equal(r.status, 1);
    assert.match(out(r), /and no Worker registers that path/);
  });

  test('a provider reachable in code but recorded as reachableAt:null FAILS', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[2].reachableAt = null;
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /The register is behind the code/);
  });

  // ⏱ 2026-09-28 · ST-N1 — `/resend` is GoTrue's endpoint and also Resend's tell.
  // `gatepay` stands in for it here: a provider row with reachableAt null.
  const collide = "app.get('/v1/health', h);\napp.post('/payrail', h);\napp.post('/v1/gatepay', h);\n";
  const withCollision = (decl) => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.nonProviderRouteSegments = { ...providers.nonProviderRouteSegments, tellCollisions: decl };
    return providers;
  };

  test('🔴 a segment that spells a provider\'s tell, undeclared, still FAILS as a provider reachable in code', () => {
    const r = run(fixture({ routes: collide, providers: withCollision(undefined) }));
    assert.equal(r.status, 1);
    assert.match(out(r), /registers a route segment \/gatepay, which is provider gatepay .*The register is behind the code/s);
  });

  test('a declared collision against THAT provider, with a reason, passes and PRINTS', () => {
    const r = run(fixture({ routes: collide, providers: withCollision({ gatepay: { provider: 'gatepay', why: 'our own endpoint name' } }) }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /ROUTE SEGMENT \/gatepay SPELLS Gatepay's tell and is declared OURS: our own endpoint name/i);
  });

  test('🔴 a collision naming ANOTHER provider, or giving no reason, FAILS', () => {
    const other = run(fixture({ routes: collide, providers: withCollision({ gatepay: { provider: 'payrail', why: 'x' } }) }));
    assert.equal(other.status, 1);
    assert.match(out(other), /tellCollisions\.gatepay names provider "payrail" instead/);
    const bare = run(fixture({ routes: collide, providers: withCollision({ gatepay: { provider: 'gatepay', why: ' ' } }) }));
    assert.equal(bare.status, 1);
    assert.match(out(bare), /tellCollisions\.gatepay gives no `why`/);
  });

  test('🔴 a collision declared for a segment no Worker registers FAILS as stale', () => {
    const r = run(fixture({ providers: withCollision({ gatepay: { provider: 'gatepay', why: 'our own endpoint name' } }) }));
    assert.equal(r.status, 1);
    assert.match(out(r), /tellCollisions declares \/gatepay, and no Worker registers that segment/);
  });

  test('an empty nonProviderRouteSegments list is COVERAGE LOST', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.nonProviderRouteSegments = { segments: [] };
    const r = run(fixture({ providers }));
    assert.equal(r.status, 2);
    assert.match(out(r), /COVERAGE LOST/);
  });
});

describe('owner-gated gaps print, and cannot outlive their reason', () => {
  const withGap = (extra = {}) => ({
    ...structuredClone(DEFAULT_PROVIDERS),
    disclosureGaps: [
      {
        id: 'a-gap',
        ownerItem: 'O-3',
        page: 'terms.html',
        what: 'the page names the wrong company',
        stillTrue: 'Cloudmark',
        ...extra,
      },
    ],
  });

  test('a gap whose reason still holds PRINTS and does not fail the build', () => {
    const r = run(fixture({ providers: withGap() }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /OWNER-GATED \(O-3\) · a-gap/);
  });

  test('a gap whose reason has been fixed FAILS, demanding the row be retired', () => {
    // The sentence the gap complains about is gone from the page — i.e. the
    // owner published the correction. An exemption nobody has to re-earn is one
    // that never expires, so the guard turns red asking for the row to go.
    const r = run(fixture({ providers: withGap({ stillTrue: 'processed securely by Razorpay' }) }));
    assert.equal(r.status, 1);
    assert.match(out(r), /is EXEMPT for a reason that is no longer true/);
  });

  test('a gap with no ownerItem FAILS — a permanent exemption with a polite label', () => {
    const providers = withGap();
    delete providers.disclosureGaps[0].ownerItem;
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no `ownerItem`/);
  });

  test('a gap with no stillTrue probe FAILS — nothing could ever close it', () => {
    const providers = withGap();
    delete providers.disclosureGaps[0].stillTrue;
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no `stillTrue` probe/);
  });
});

describe('coverage self-checks', () => {
  test('a missing register is COVERAGE LOST, not an empty pass', () => {
    const root = fixture();
    rmSync(join(root, 'tooling', 'legal', 'policy-claims.json'));
    const r = run(root);
    assert.equal(r.status, 2);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /An absent register is not an empty one/);
  });

  test('an unparseable register is COVERAGE LOST', () => {
    const root = fixture();
    writeFileSync(join(root, 'tooling', 'legal', 'provider-register.json'), '{ not json');
    const r = run(root);
    assert.equal(r.status, 2);
    assert.match(out(r), /is not valid JSON/);
  });

  test('a page stripped of all emphasis is COVERAGE LOST', () => {
    const r = run(fixture({ pages: { 'refund.html': '<html><body><p>plain</p></body></html>' } }));
    assert.equal(r.status, 2);
    assert.match(out(r), /yielded ZERO emphasised spans/);
  });

  test('a declared page that does not exist is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'sites', 'nikatru', 'terms.html'));
    const r = run(root);
    assert.equal(r.status, 2);
    assert.match(out(r), /The pages ARE the domain/);
  });

  test('zero route files under services/ is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'services'), { recursive: true, force: true });
    const r = run(root);
    assert.equal(r.status, 2);
    assert.match(out(r), /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 — THE EGRESS LIMB (REVIEW-stores-2026-09-10 #11). The web build's CSP let the
// browser reach browser.sentry-cdn.com and gstatic.com while neither company had a row, and
// the route limb — the only half that caught a provider arriving in code — reads Workers.
describe('the egress limb — every host a shipped CSP lets a browser reach is ours or a provider row', () => {
  const csp = (sources) => `/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${sources.join(' ')}; img-src 'self' data: blob:\n`;
  const withHeaders = (sources, providers = {}) => {
    const root = fixture({ providers: { firstPartyDomains: { domains: ['example.test'] }, ...providers } });
    write(root, join('apps', 'demo', 'web', '_headers'), csp(sources));
    return root;
  };

  test('PASSES when every third-party host carries a tell and the rest are ours, and COUNTS them', () => {
    const r = run(withHeaders(['https://cdn.cloudmark.net', 'https://api.example.test', 'https://example.test']));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /1 third-party browser egress host\(s\) matched to a row/);
  });

  test('🔴 FAILS a host no provider row has a tell for — the Sentry CDN before it was registered', () => {
    const r = run(withHeaders(['https://browser.sentry-cdn.com']));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /apps\/demo\/web\/_headers lets a browser reach browser\.sentry-cdn\.com \(script-src\) and no row/);
  });

  test('registering the provider with its tell makes the same policy pass', () => {
    const r = run(
      withHeaders(['https://browser.sentry-cdn.com'], {
        roles: { ...DEFAULT_PROVIDERS.roles, content_delivery: { means: 'serves a file the browser loads', sellerIs: 'not-applicable' } },
        providers: [
          ...DEFAULT_PROVIDERS.providers,
          { id: 'sentry-cdn', name: 'Sentry', role: 'content_delivery', status: 'live', reachableAt: null, tells: ['sentry'], namedIn: [] },
        ],
      }),
    );
    assert.equal(r.status, 0, out(r));
  });

  test('FAILS a host whose only matching row says the integration is not happening', () => {
    const r = run(
      withHeaders(['https://checkout.razorpay.test'], {
        providers: [
          ...DEFAULT_PROVIDERS.providers,
          { id: 'razorpay', name: 'Razorpay', role: 'infrastructure', status: 'not-named-not-wired', reachableAt: null, tells: ['razorpay'], namedIn: [] },
        ],
      }),
    );
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /every matching row says that integration is not happening: razorpay \(status not-named-not-wired\)/);
  });

  test('COVERAGE LOST when header files exist and no firstPartyDomains is declared', () => {
    const root = fixture();
    write(root, join('sites', 'nikatru', '_headers'), csp(['https://cdn.cloudmark.net']));
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST — provider-register\.json declares no `firstPartyDomains\.domains`/);
  });

  test('COVERAGE LOST when a header file yields no CSP source at all', () => {
    const root = fixture({ providers: { firstPartyDomains: { domains: ['example.test'] } } });
    write(root, join('apps', 'demo', 'web', '_headers'), '/*\n  X-Frame-Options: DENY\n');
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /ZERO Content-Security-Policy sources were extracted/);
  });
});

describe('an owner-gated gap about an OMISSION closes itself when the page names the provider', () => {
  const GAP = {
    id: 'cdn-unnamed',
    page: 'privacy.html',
    ownerItem: 'O-3',
    stillTrue: 'we store only your email',
    closedWhenNamed: ['cloudmark'],
    what: 'the privacy page does not name Cloudmark',
  };

  test('PRINTS while the page is silent about the provider', () => {
    const r = run(fixture({ providers: { disclosureGaps: [GAP] } }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /OWNER-GATED \(O-3\) · cdn-unnamed \[privacy\.html\]/);
  });

  test('FAILS, demanding retirement, once the page names it — even with the stillTrue sentence intact', () => {
    const named = page('Privacy', ['NIKATRU', 'we store only your email', 'we never read your address']).replace('</main>', '<p>We use Cloudmark to host.</p></main>');
    const r = run(fixture({ providers: { disclosureGaps: [GAP] }, pages: { 'privacy.html': named } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /gap cdn-unnamed is CLOSED: privacy\.html now names Cloudmark/);
  });

  test('FAILS a closedWhenNamed entry with no provider row — the gap could never see itself closed', () => {
    const r = run(fixture({ providers: { disclosureGaps: [{ ...GAP, closedWhenNamed: ['nobody'] }] } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /closedWhenNamed names "nobody", which has no provider row/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-26 — THE SELLER BY RAIL (O-PRIVACY-OMITS-THE-INDIA-SELLER). terms.html sold
// India through Paddle "in every country we sell to, including India" three lines above
// the item naming Nikatru the India seller, and privacy.html named no India seller at all;
// every span was paired, so nothing failed. One case per `sellerIs` value, the
// contradiction, the row relation and the coverage exits, each written out by hand.
describe('the seller by rail — every page names one seller per purchase rail', () => {
  const termsWith = (sellers) => withText(page('Terms', ['Cloudmark']), sellers);
  const refundWith = (sellers) => withText(page('Refunds', ['7 days']), sellers);

  test('PASSES the baseline, and counts the rows, the rails and the statements it read', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /sellers — 2 seller-by-rail row\(s\) covering all 2 selling rail\(s\), 5 page statement\(s\) of who sells verified/);
  });

  test('sellerIs provider: a page naming the merchant of record without saying it sells FAILS', () => {
    const refund = refundWith(
      '<ul><li>Seller Co handles support for these purchases.</li><li>In India, GatePay is our payment gateway and Nikatru is the seller.</li></ul>',
    );
    const r = run(fixture({ pages: { 'refund.html': refund } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /refund\.html: rail paddle — no <p> or <li> names Seller Co together with "merchant of record"/);
  });

  test('sellerIs nikatru: deleting the India sentence FAILS (the row\'s own red control)', () => {
    const terms = termsWith(
      '<p>For every other purchase, Seller Co is our merchant of record and the legal seller, in every country we sell to except India.</p>' +
        '<p>PayRail records store purchases on our behalf and is never the seller.</p>',
    );
    const r = run(fixture({ pages: { 'terms.html': terms } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /terms\.html: rail razorpay — no <p> or <li> names GatePay together with "Nikatru is the seller"/);
  });

  test('sellerIs nikatru: a block naming the gateway the seller FAILS, even beside a correct one', () => {
    const refund = refundWith(
      '<ul><li>Outside India, Seller Co is the merchant of record.</li>' +
        '<li>In India, GatePay is our payment gateway and GatePay is the seller.</li></ul>' +
        '<p>For purchases made in India, Nikatru is the seller and GatePay collects the money.</p>',
    );
    const r = run(fixture({ pages: { 'refund.html': refund } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /refund\.html: rail razorpay — a block names GatePay as the seller \("GatePay is the seller"\)/);
  });

  // ⏱ 2026-10-01 · fix-india-rail-tax-data (C-25): terms.html §4 now carries the GENERATED India
  // tax sentence (generate-discovery.mjs TAX_SENTENCES), which names the gateway. It must keep
  // satisfying this limb (green), and the same sentence turned to make the gateway the seller
  // must fail it (red) — a seller disagreement between the page and the register is a finding.
  test('C-25: the generated India tax sentence states the register\'s seller; flipped, it FAILS', () => {
    const generated = TAX_SENTENCES.razorpay.inclusive.replaceAll('Razorpay', 'GatePay');
    const sellers = (india) =>
      termsWith(
        '<p>For every other purchase, Seller Co is our merchant of record and the legal seller, in every country we sell to except India.</p>' +
          `<ul><li>${india}</li></ul>` +
          '<p>PayRail records store purchases on our behalf and is never the seller.</p>',
      );
    const green = run(fixture({ pages: { 'terms.html': sellers(generated) } }));
    assert.equal(green.status, 0, out(green));
    const flipped = generated.replace('Nikatru is the seller and GatePay processes the payment', 'GatePay is the seller and Nikatru processes the payment');
    assert.notEqual(flipped, generated, 'the mutation must change the sentence, or the red case proves nothing');
    const red = run(fixture({ pages: { 'terms.html': sellers(flipped) } }));
    assert.equal(red.status, 1, out(red));
    assert.match(out(red), /terms\.html: rail razorpay — a block names GatePay as the seller \("GatePay is the seller"\)/);
  });

  test('sellerIs never: an aggregator no longer called never the seller FAILS', () => {
    const terms = termsWith(TERMS_SELLERS.replace('and is never the seller', 'and is the seller'));
    const r = run(fixture({ pages: { 'terms.html': terms } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /terms\.html: provider payrail — no <p> or <li> names PayRail together with "is never the seller"/);
  });

  test('sellerIs never: an aggregator named the seller FAILS, even beside the never sentence', () => {
    const terms = termsWith(`${TERMS_SELLERS}<p>For an app purchase, PayRail is the seller.</p>`);
    const r = run(fixture({ pages: { 'terms.html': terms } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /terms\.html: provider payrail — a block names PayRail as the seller \("PayRail is the seller"\)/);
  });

  test('sellerIs not-applicable: a rail resolving to a provider whose role takes no payment FAILS', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[3].role = 'infrastructure';
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /rail "razorpay" resolves to gatepay \(GatePay\), whose role infrastructure says sellerIs not-applicable/);
  });

  test('a role that does not answer who sells FAILS', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.roles.payment_gateway = { means: 'takes the payment on our behalf' };
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /role "payment_gateway" carries sellerIs null/);
  });

  test('the contradiction: the base rail\'s seller "in every country, including India" FAILS', () => {
    const terms = termsWith(TERMS_SELLERS.replace('in every country we sell to except India.', 'in every country we sell to, including India.'));
    const r = run(fixture({ pages: { 'terms.html': terms } }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /terms\.html: a block states Seller Co \(rail paddle\) sells in "every country" and names India with no "except" or "outside"/);
  });

  test('a selling rail with no seller-by-rail row FAILS', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims = claims.claims.filter((c) => c.rail !== 'razorpay');
    const r = run(fixture({ claims }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /sells on rail "razorpay" and tooling\/legal\/policy-claims\.json has no `seller-by-rail` row for it/);
  });

  test('a seller-by-rail row for a rail nobody sells on FAILS', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims.push({ type: 'seller-by-rail', rail: 'stripe', pages: ['terms.html'], note: 'a rail that does not exist' });
    const r = run(fixture({ claims }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /seller-by-rail row "stripe" names a rail that is not a selling rail/);
  });

  test('COVERAGE LOST: zero seller-by-rail rows', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims = claims.claims.filter((c) => c.type !== 'seller-by-rail');
    const r = run(fixture({ claims }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST — tooling\/legal\/policy-claims\.json declares no `seller-by-rail` row/);
  });

  test('COVERAGE LOST: a rail no provider row resolves to', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    delete providers.providers[3].requiredWhen;
    const r = run(fixture({ providers }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST — rail "razorpay" resolves to 0 provider row\(s\) through requiredWhen\.rail \(none\)/);
  });

  test('COVERAGE LOST: a regionRails region this guard has no name for', () => {
    const channels = structuredClone(DEFAULT_CHANNELS);
    channels.channels[0].purchaseRail.regionRails[0].region = 'ZZ';
    const r = run(fixture({ channels }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST — channel web carries regionRails for region "ZZ"/);
  });

  test('COVERAGE LOST: no channel register to read the rails from', () => {
    const r = run(fixture({ channels: null }));
    assert.equal(r.status, 2, out(r));
    assert.match(out(r), /COVERAGE LOST — tooling\/channel-register\.json does not exist/);
  });
});

// ⏱ 2026-10-03 · rv2-business 024. `status` is read
// against the register's own `statuses`, and `retired` is silent in §3(c) as `deferred` is.
describe('the status vocabulary — declared in the register, and `retired` is silent', () => {
  const withRetiredMor = (statuses) => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers.push({
      id: 'old-mor', name: 'Old MoR', role: 'merchant_of_record', status: 'retired',
      reachableAt: null, tells: ['old mor'], namedIn: [], requiredWhen: { kind: 'never', why: 'withdrawn' },
    });
    if (statuses) providers.statuses = statuses(providers.statuses);
    return providers;
  };

  test('a RETIRED merchant of record named on no page passes and prints nothing about it', () => {
    const r = run(fixture({ providers: withRetiredMor() }));
    assert.equal(r.status, 0, out(r));
    assert.doesNotMatch(out(r), /Old MoR \(status retired\)/);
  });

  test('RED CONTROL: the vocabulary without `retired` FAILS the retired row by name', () => {
    const r = run(fixture({ providers: withRetiredMor((s) => { const { retired, ...rest } = s; return rest; }) }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /provider "old-mor" has status "retired", which is not defined in the register's own `statuses`/);
  });

  test('a `retired` that is NOT silent prints the missing disclosure — `silent` is what keeps it quiet', () => {
    const r = run(fixture({ providers: withRetiredMor((s) => ({ ...s, retired: { means: 'x', silent: false } })) }));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /MERCHANT OF RECORD NOT YET NAMED: Old MoR \(status retired\)/);
  });

  test('a misspelt status FAILS instead of reading as "being pursued"', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[0].status = 'Live';
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /provider "cloudmark" has status "Live", which is not defined/);
  });

  test('the REAL register: lemon-squeezy is `retired` and `retired` is a silent status', () => {
    const real = JSON.parse(readFileSync(join(CI_DIR, '..', 'legal', 'provider-register.json'), 'utf8'));
    assert.equal(real.providers.find((p) => p.id === 'lemon-squeezy').status, 'retired');
    assert.equal(real.statuses.retired.silent, true);
    for (const p of real.providers) assert.ok(Object.hasOwn(real.statuses, p.status), `${p.id}: ${p.status}`);
  });
});

// ⏱ 2026-10-03 · rv2-business 021. A `seller-by-rail` row with
// `channelList: true` holds each of its pages to ONE <!-- SELLER-CHANNELS:<rail> --> block equal to what
// tooling/sites/seller-channels.mjs renders from the register's rail rows that are not `ruledOutBy`.
describe('the channel list — where a rail sells is rendered from the register, never typed', () => {
  const block = (text) => `<p>Where Seller Co sells: <!-- SELLER-CHANNELS:paddle -->${text}<!-- /SELLER-CHANNELS:paddle -->.</p>`;
  /** The register with a ruled-out Windows download on the paddle rail, as the real one has. */
  const CHANNELS_WITH_RULED_OUT = (() => {
    const c = structuredClone(DEFAULT_CHANNELS);
    c.channels.push({ id: 'windows-store', purchaseRail: { rail: 'paddle', regionRails: [{ region: 'IN', rail: 'razorpay' }] } });
    c.channels.push({ id: 'windows-direct', purchaseRail: { rail: 'paddle', regionRails: [{ region: 'IN', rail: 'razorpay' }] }, deferral: { reason: 'x', ruledOutBy: 'C-WINDOWS-STORE-ONLY' } });
    return c;
  })();
  const withList = (pageText, channels = CHANNELS_WITH_RULED_OUT) => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims.find((r) => r.type === 'seller-by-rail' && r.rail === 'paddle').channelList = true;
    return fixture({
      claims,
      channels,
      pages: {
        'terms.html': withText(withText(page('Terms', ['Cloudmark']), TERMS_SELLERS), block(pageText)),
        'refund.html': withText(withText(page('Refunds', ['7 days']), REFUND_SELLERS), block(pageText)),
      },
    });
  };

  test('GREEN CONTROL: both pages carry the rendered list — the ruled-out channel is left out', () => {
    const r = run(withList('this website and the Microsoft Store'));
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /2 page channel list\(s\) equal to the register's rendering/);
  });

  test('RED CONTROL: a ruled-out channel in a page FAILS, by name', () => {
    const r = run(withList('this website, the Microsoft Store and our Windows download'));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /terms\.html: the paddle channel list reads "this website, the Microsoft Store and our Windows download", and tooling\/channel-register\.json renders "this website and the Microsoft Store"\. 🔴 It names RULED-OUT channel\(s\) windows-direct/);
  });

  test('a channel that joined the rail without a re-render FAILS', () => {
    const r = run(withList('this website'));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /renders "this website and the Microsoft Store"/);
  });

  test('a page with no block FAILS — the list cannot be typed outside it', () => {
    const claims = structuredClone(DEFAULT_CLAIMS);
    claims.claims.find((r) => r.type === 'seller-by-rail' && r.rail === 'paddle').channelList = true;
    const r = run(fixture({ claims, channels: CHANNELS_WITH_RULED_OUT }));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /terms\.html: seller-by-rail row "paddle" has channelList, and the page holds 0 <!-- SELLER-CHANNELS:paddle --> block\(s\)/);
  });

  test('a channel on the rail with no legal phrase FAILS rather than leaving the list short', () => {
    const channels = structuredClone(CHANNELS_WITH_RULED_OUT);
    channels.channels.push({ id: 'new-store', purchaseRail: { rail: 'paddle', regionRails: [{ region: 'IN', rail: 'razorpay' }] } });
    const r = run(withList('this website and the Microsoft Store', channels));
    assert.equal(r.status, 1, out(r));
    assert.match(out(r), /channel\(s\) new-store sell on rail paddle and have no phrase/);
  });

  test('the REAL register renders no ruled-out channel and no macOS download, and the paddle row carries channelList', async () => {
    const { renderChannelList, channelsOnRail } = await import('../../sites/seller-channels.mjs');
    const reg = JSON.parse(readFileSync(join(CI_DIR, '..', 'channel-register.json'), 'utf8'));
    const text = renderChannelList(reg, 'paddle');
    assert.ok(channelsOnRail(reg, 'paddle').ruledOut.includes('windows-direct'));
    assert.doesNotMatch(text, /Windows download|macOS/);
    const claims = JSON.parse(readFileSync(join(CI_DIR, '..', 'legal', 'policy-claims.json'), 'utf8'));
    assert.equal(claims.claims.find((r) => r.type === 'seller-by-rail' && r.rail === 'paddle').channelList, true);
  });
});
