// ─────────────────────────────────────────────────────────────────────────────
// sink-disclosure.test.mjs — assert-sink-disclosure.mjs must be able to FAIL.
//
// [pipeline K-5]. The recorded mutation run is against THE REAL REPOSITORY, not
// a fixture, because a fixture agrees with whatever misunderstanding wrote it:
//
//   · `oracle-cloud.receives += "ip_address"` (the honest-declaration-undone
//     mutation, i.e. the state the tree was actually in until 2026-08-06) →
//     exit 1, naming BOTH the published claim and the provider:
//       "sites/nikatru/privacy.html publishes "do not collect or store your IP
//        address with these records" — which DENIES the category "ip_address" —
//        and 1 LIVE sink(s) declare receiving it: oracle-cloud (Oracle Cloud)."
//     Restored → exit 0.
//
// 🔴 AND ONE RESULT THAT CHANGED THE GUARD, recorded because it is the trap this
// whole file is built around. The real sentence on privacy.html is
//     "We do not collect or store your IP address with these records; an
//      approximate location (country, region, city) is determined at our network
//      edge and the IP address itself is discarded."
// Scoped to the SENTENCE it contains the tell for `approximate_location`, which
// Cloudflare genuinely receives — so the first draft went RED on a page that is
// TRUE, and the tempting fix would have been to weaken the tell. Scoping to the
// text AFTER the denial verb is what fixed it, and both directions are pinned
// below: the tail must NOT fire, and the same category as the OBJECT must.
//
// ⚠️ A PASSING TEST HERE IS THE REGRESSION NET. The proof is the mutation above.
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
const GUARD = join(CI_DIR, 'assert-sink-disclosure.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-sink-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const write = (root, relPath, body) => {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

const DEFAULT_CATEGORIES = {
  ip_address: { what: 'the network address a request came from', tells: ['ip address'] },
  approximate_location: { what: 'country, region, city', tells: ['approximate location'] },
  email_address: { what: 'a plain email address', tells: ['email address'] },
  crash_report: { what: 'an exception and its stack trace', tells: ['crash report', 'crash reports'] },
};

const DEFAULT_PROVIDERS = {
  dataCategories: structuredClone(DEFAULT_CATEGORIES),
  denialsOutOfScope: {
    rows: [
      {
        page: 'privacy.html',
        denial: 'do not knowingly collect personal information from them',
        why: 'scoped by WHO, not by WHAT — a class of person, not a category of data',
      },
    ],
  },
  providers: [
    {
      id: 'edge-co',
      name: 'Edge Co',
      role: 'infrastructure',
      status: 'live',
      receives: ['approximate_location', 'email_address'],
      receivesBasis: 'derived from the store inventory, 2026-08-06',
      transits: { ip_address: 'terminates TLS, so the address is inherent in the connection; nothing writes it' },
    },
    {
      id: 'crashbox',
      name: 'Crashbox',
      role: 'infrastructure',
      status: 'live',
      receives: ['crash_report'],
      receivesBasis: 'observed against the live instance, 2026-08-06',
    },
    {
      id: 'storeco',
      name: 'Store Co',
      role: 'store_billing',
      status: 'deferred',
      receives: ['everything-unchecked'],
    },
  ],
};

/** The baseline page carries all three shapes at once, so the fixture itself is
 *  the regression net for the two decisions that were nearly got wrong:
 *    · the ip denial's TAIL names a category the live sink really receives;
 *    · "never stored" is not a denial, and its object is one too. */
const DEFAULT_PRIVACY =
  '<!DOCTYPE html><html lang="en"><body><main>' +
  '<p>We <b>do not collect or store your IP address</b> with these records; an approximate location ' +
  '(country, region, city) is determined at our network edge and the IP address itself is discarded.</p>' +
  '<p>We do not sell your email address.</p>' +
  '<p>The fingerprint is never stored alongside your email address.</p>' +
  '<p>Our Services are not directed to children, and we do not knowingly collect personal information ' +
  'from them.</p>' +
  '</main></body></html>\n';

function fixture({ providers = {}, claims = {}, pages = {} } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(root, { recursive: true });

  const providerReg = { ...structuredClone(DEFAULT_PROVIDERS), ...providers };
  const claimsReg = { pages: ['privacy.html'], siteRoot: 'sites/nikatru', ...claims };
  write(root, join('tooling', 'legal', 'provider-register.json'), JSON.stringify(providerReg, null, 2));
  write(root, join('tooling', 'legal', 'policy-claims.json'), JSON.stringify(claimsReg, null, 2));

  for (const [name, body] of Object.entries({ 'privacy.html': DEFAULT_PRIVACY, ...pages })) {
    if (body !== null) write(root, join('sites', 'nikatru', name), body);
  }
  return root;
}

/** A page whose only denial is the given clause, plus the children's sentence so
 *  the default out-of-scope row never goes stale by accident. */
const pageDenying = (clause) =>
  `<!DOCTYPE html><html><body><main><p>We <b>${clause}</b>.</p>` +
  '<p>We do not knowingly collect personal information from them.</p></main></body></html>\n';

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;

describe('assert-sink-disclosure — the baseline fixture is valid input', () => {
  test('a consistent register and page set passes', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
  });

  test('a transit-only declaration PRINTS the escape route rather than hiding it', () => {
    // `transits` is the one declaration that silences the intersection limb, so
    // it must be enumerated on every run — this print IS the list a human has to
    // re-verify against the live sink.
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /TRANSIT-ONLY, NOT PROVEN/);
    assert.match(out(r), /edge-co/);
  });

  test('the passing line states the ceiling — a gate on the declaration, not on the sink', () => {
    const r = run(fixture());
    assert.match(out(r), /GATE ON THE DECLARATION, NOT ON THE SINK/);
  });
});

describe('the intersection — a live sink receiving what a page denies', () => {
  test('THE DEFECT THIS FILE EXISTS FOR: a denied category on a live sink FAILS', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[1].receives.push('ip_address');
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which DENIES the category "ip_address"/);
  });

  test('the failure names BOTH the published claim and the provider', () => {
    // A message naming only one of them sends the fix to the wrong artefact:
    // "a page is wrong" and "a sink is wrong" have opposite repairs, and the
    // published wording is usually the stronger commitment.
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[1].receives.push('ip_address');
    const r = run(fixture({ providers }));
    assert.match(out(r), /do not collect or store your IP address with these records/);
    assert.match(out(r), /crashbox \(Crashbox\)/);
  });

  test('a NON-live infrastructure row is not scoped — the register carries rows for things we are not doing', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[1].status = 'wired-not-live';
    providers.providers[1].receives.push('ip_address');
    const r = run(fixture({ providers }));
    assert.equal(r.status, 0, out(r));
  });

  test('a NON-infrastructure row is not scoped, however it declares itself', () => {
    // storeco is store_billing and declares an undeclared category; the limb is
    // about SINKS WE RUN OR HOST, and a store's own records are outside this tree.
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
  });
});

describe('the denial extractor — scope the OBJECT, never the sentence', () => {
  test('a category named in the denial TAIL does not fire (the trap that changed the guard)', () => {
    // edge-co really receives `approximate_location`, and the tail of the ip
    // sentence names it. Sentence-scoped, this guard would be RED on a true page.
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
  });

  test('…and the SAME category as the denial OBJECT does fire, so the tell is not dead', () => {
    // Without this, the test above would pass just as happily against a tell
    // that matches nothing — an assertion that cannot fail inflates coverage.
    const r = run(fixture({ pages: { 'privacy.html': pageDenying('do not collect or store your approximate location') } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which DENIES the category "approximate_location"/);
  });

  test('"do not sell" is NOT a possession denial — holding is not selling', () => {
    // The baseline page says "We do not sell your email address" while edge-co
    // declares receiving `email_address`. If `sell` were in the verb set this
    // would be RED — and it would be red on a TRUE sentence, because we hold the
    // address precisely so we can operate, and holding is not selling.
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
  });

  test('"never stored" is not a denial verb — its object is a co-location, not a category', () => {
    // Same page, same category: "never stored alongside your email address"
    // denies a CO-LOCATION. Including `never` made this guard red on a true page.
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
  });

  test('…and "do not store <that same object>" does fire, so the silence is about the VERB', () => {
    const r = run(fixture({ pages: { 'privacy.html': pageDenying('do not store your email address') } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which DENIES the category "email_address"/);
  });
});

describe('an unscoped denial cannot be published', () => {
  test('a denial resolving to no declared category FAILS', () => {
    const r = run(fixture({ pages: { 'privacy.html': pageDenying('do not collect or store your precise coordinates') } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /resolves to NO category in the register's `dataCategories`/);
  });

  test('the failure quotes the exact string to classify — a message you cannot act on is one people work around', () => {
    const r = run(fixture({ pages: { 'privacy.html': pageDenying('do not collect or store your precise coordinates') } }));
    assert.match(out(r), /using exactly: "do not collect or store your precise coordinates"/);
  });

  test('a classified denial PRINTS its reason and passes', () => {
    const r = run(fixture());
    assert.equal(r.status, 0, out(r));
    assert.match(out(r), /OUT OF SCOPE · privacy\.html/);
  });

  test('a classification with no `why` FAILS — a permanent exemption with a polite label', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    delete providers.denialsOutOfScope.rows[0].why;
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /carries no `why`/);
  });

  test('a classification whose sentence is no longer published FAILS as stale', () => {
    const r = run(fixture({ pages: { 'privacy.html': pageDenying('do not collect or store your IP address').replace('<p>We do not knowingly collect personal information from them.</p>', '') } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /no such denial is published there any more/);
  });

  test('a classification whose denial NOW resolves to a category FAILS as inert', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.dataCategories.personal_information = {
      what: 'anything about a person',
      tells: ['personal information'],
    };
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /The exemption is inert/);
  });
});

describe('the declaration itself must be reviewable', () => {
  test('a LIVE infrastructure row with no `receives` FAILS', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    delete providers.providers[1].receives;
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares no `receives` array/);
  });

  test('an EMPTY `receives` is a legitimate declaration, not an omission', () => {
    // "This provider retains no personal data at all" is a strong claim and the
    // register must be able to make it; the union coverage check below is what
    // stops EVERY row saying it.
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[1].receives = [];
    const r = run(fixture({ providers }));
    assert.equal(r.status, 0, out(r));
  });

  test('a declaration with no `receivesBasis` FAILS — nothing here can observe the sink', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    delete providers.providers[1].receivesBasis;
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /no `receivesBasis`/);
  });

  test('a category outside the register\'s own vocabulary FAILS', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[1].receives.push('vibes');
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /which is not in the register's own `dataCategories`/);
  });

  test('a category with no tells FAILS — it could never be found intersecting', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.dataCategories.ip_address.tells = [];
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares no usable `tells`/);
  });

  test('a transit-only claim with no reason FAILS — it is the one way to silence the check', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[0].transits = { ip_address: '' };
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /transit-only with no reason/);
  });

  test('a category in BOTH receives and transits FAILS — the row cannot be read', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.providers[0].receives.push('ip_address');
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /in BOTH `receives` and `transits`/);
  });
});

describe('coverage self-checks — an empty domain must be LOUD', () => {
  test('a missing provider register is COVERAGE LOST, not an empty pass', () => {
    const root = fixture();
    rmSync(join(root, 'tooling', 'legal', 'provider-register.json'));
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

  test('no `dataCategories` at all is COVERAGE LOST', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    providers.dataCategories = {};
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares no `dataCategories`/);
  });

  test('ZERO live infrastructure rows is COVERAGE LOST', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    for (const p of providers.providers) if (p.role === 'infrastructure') p.status = 'deferred';
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /NO `infrastructure` provider with status `live`/);
  });

  test('an EMPTY declared union is COVERAGE LOST — every denial would be scoped against nothing', () => {
    const providers = structuredClone(DEFAULT_PROVIDERS);
    for (const p of providers.providers) if (p.role === 'infrastructure') p.receives = [];
    const r = run(fixture({ providers }));
    assert.equal(r.status, 1);
    assert.match(out(r), /NOT ONE live infrastructure provider declared a single personal-data category/);
  });

  test('ZERO denials extracted from the pages is COVERAGE LOST', () => {
    const r = run(fixture({ pages: { 'privacy.html': '<html><body><p>We keep information only as long as necessary.</p></body></html>' } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /ZERO "we do not collect \/ do not store" denials/);
  });

  test('every denial excused as out of scope is COVERAGE LOST — the failing limb would run over nothing', () => {
    const r = run(fixture({ pages: { 'privacy.html': '<html><body><p>We do not knowingly collect personal information from them.</p></body></html>' } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /NOT ONE resolved to a declared category/);
  });

  test('an empty `pages` set is COVERAGE LOST', () => {
    const r = run(fixture({ claims: { pages: [] } }));
    assert.equal(r.status, 1);
    assert.match(out(r), /declares no `pages`/);
  });

  test('a declared page that does not exist is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'sites', 'nikatru', 'privacy.html'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(out(r), /The pages ARE the domain/);
  });
});
