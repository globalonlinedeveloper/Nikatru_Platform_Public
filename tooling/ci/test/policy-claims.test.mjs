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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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
  ],
};

const DEFAULT_PROVIDERS = {
  nonProviderRouteSegments: { segments: ['v1', 'health', 'webhooks', 'events'] },
  roles: {
    merchant_of_record: 'the legal seller',
    infrastructure: 'hosts the service',
    iap_aggregator: 'normalises purchase events',
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
    },
    {
      id: 'payrail',
      name: 'PayRail',
      role: 'iap_aggregator',
      status: 'wired-not-live',
      reachableAt: '/payrail',
      tells: ['payrail'],
      namedIn: [],
    },
  ],
  disclosureGaps: [],
};

/** A synthetic tree with the shape the guard reads. Every option mutates one
 *  limb's input and nothing else. */
function fixture({ claims = {}, providers = {}, pages = {}, routes = null, subscribe, events } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(root, { recursive: true });

  const claimsReg = { ...structuredClone(DEFAULT_CLAIMS), ...claims };
  const providerReg = { ...structuredClone(DEFAULT_PROVIDERS), ...providers };
  write(root, join('tooling', 'legal', 'policy-claims.json'), JSON.stringify(claimsReg, null, 2));
  write(root, join('tooling', 'legal', 'provider-register.json'), JSON.stringify(providerReg, null, 2));

  const defaults = {
    'privacy.html': page('Privacy', ['NIKATRU', 'we store only your email', 'we never read your address']),
    'terms.html': page('Terms', ['Cloudmark']),
    'refund.html': page('Refunds', ['7 days']),
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
    assert.equal(r.status, 1);
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

  test('an empty nonProviderRouteSegments list is COVERAGE LOST', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.nonProviderRouteSegments = { segments: [] };
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
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
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
    assert.match(out(r), /An absent register is not an empty one/);
  });

  test('an unparseable register is COVERAGE LOST', () => {
    const root = fixture();
    writeFileSync(join(root, 'tooling', 'legal', 'provider-register.json'), '{ not json');
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /is not valid JSON/);
  });

  test('a page stripped of all emphasis is COVERAGE LOST', () => {
    const r = run(fixture({ pages: { 'refund.html': '<html><body><p>plain</p></body></html>' } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /yielded ZERO emphasised spans/);
  });

  test('a declared page that does not exist is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'sites', 'nikatru', 'terms.html'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /The pages ARE the domain/);
  });

  test('zero route files under services/ is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'services'), { recursive: true, force: true });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /COVERAGE LOST/);
  });
});
