// ─────────────────────────────────────────────────────────────────────────────
// site-integrity.test.mjs — the legal-pages half of check-site-integrity.mjs.
//
// Store rule, not style rule: Apple and Google both require a reachable privacy
// policy, and `sites/nikatru` hosts it for every app we publish. Before this,
// `rm sites/nikatru/privacy.html` passed ci-gate and deployed — Cloudflare ships
// sites/ on push to main with no workflow in the way, so the first signal would
// have been a takedown notice.
//
// A guard for that is only worth having if it can fail, so every check below is
// exercised with the input that breaks it. The same mutations were also run
// against the REAL tree (delete privacy.html · stub it · empty its <h1> · rename
// sites/nikatru away · add a dangling /privacy.html link to the brochure site),
// because a fixture written by the author of the guard encodes the author's
// misunderstandings too — that exact failure shipped here on 2026-07-26.
//
// Two modes are covered, and they differ:
//   · repoRoot is a synthetic tree  → the REQUIRED_LEGAL_ROOTS name list is off,
//     so only the structural signals (apps/ directory, same-site link) apply.
//   · repoRoot contains the script  → the name list is enforced, and losing
//     sites/nikatru is COVERAGE LOST rather than a quiet "0 roots, all clean".
//   The second mode is reached by running a COPY of the guard from inside the
//   fixture, which is exactly how CI runs it from inside the repo.
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-9 / F-10.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = 'check-site-integrity.mjs';

let ROOT;
before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-site-'));
});
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** [pipeline 12]W-3b, 2026-08-02: `sitemap.xml` and `llms.txt` joined
 *  REQUIRED_FILES, so EVERY deploy root a fixture builds now owes both. They are
 *  filled in centrally rather than case by case for one reason — a case that
 *  spells them out is a case that can forget to, and forty cases each carrying
 *  two lines of boilerplate is forty places for the boilerplate to drift.
 *
 *  A case that is ABOUT one of these files supplies it (or names it in `omit`
 *  to delete it), and that override always wins. The empty `<urlset>` default is
 *  safe for the roots that get it: a root declaring no homepage canonical never
 *  reaches the sitemap↔page comparison, which is the same reason
 *  sites/rajasekarselvam is out of the URL-form limb's scope. */
const DEFAULT_LLMS = '# Fixture\n\n> A deploy root with nothing to say.\n';
const DEFAULT_SITEMAP =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n';

function fixture(name, files, { omit = [] } = {}) {
  const dir = join(ROOT, name);
  const all = { ...files };
  for (const rel of Object.keys(files)) {
    const m = rel.match(/^(sites\/[^/]+)\/index\.html$/);
    if (!m) continue;
    if (!(`${m[1]}/llms.txt` in all)) all[`${m[1]}/llms.txt`] = DEFAULT_LLMS;
    if (!(`${m[1]}/sitemap.xml` in all)) all[`${m[1]}/sitemap.xml`] = DEFAULT_SITEMAP;
  }
  for (const rel of omit) delete all[rel];
  for (const [rel, body] of Object.entries(all)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run the guard as CI runs it: real subprocess, real exit code.
 *  `from` selects WHICH copy of the script runs, which is what decides whether
 *  the guard thinks it is scanning its own repository. */
function run(dir, { from = join(CI_DIR, GUARD) } = {}) {
  const r = spawnSync(process.execPath, [from, dir], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * Drop a copy of the guard inside the fixture so it scans "its own repo", AND
 * give the fixture the minimum a real repository has.
 *
 * Both halves belong together. In self-hosted mode the guard enforces coverage
 * floors — a homepage canonical, a `data-policy-version`, a store listing URL,
 * the APPS array, a Function that reads the client IP, a SITE PROMISE marker —
 * each of which exists because the limb above it would otherwise range over an
 * empty set and print "ok" forever. A fixture that claims to be the repository
 * while carrying none of them is not modelling the repository, and satisfying
 * the floors here is what keeps them from being quietly deleted to make a test
 * pass.
 *
 * Scaffolding lands on the FIRST deploy root the fixture already has, never on a
 * root of its own: the `lp-cov-lost` case works by there being no sites/nikatru,
 * and a helper that conjured one would delete the test.
 */
const FIXTURE_ORIGIN = 'https://fixture.test/';
const FIXTURE_VERSION = '2026-01-02';
const FIXTURE_PROMISE = 'We keep only what this fixture says we keep.';
/** Must equal SELLER_LEGAL_NAME in check-site-integrity.mjs. Duplicated rather
 *  than imported because that file is a script that runs its whole scan on
 *  import — and duplicated ON PURPOSE as a second reader of the same fact: if
 *  the guard's constant changes without these fixtures following, the
 *  self-hosted cases go red instead of the requirement quietly relaxing. */
const SELLER_LEGAL_NAME = 'Rajasekar Selvam';

/** Modules the guard IMPORTS, which therefore have to travel with it into a
 *  self-hosted fixture. `check-site-integrity.mjs` decides it is scanning its
 *  own repository by comparing its own location to the root it was given, so
 *  these cases copy it into the fixture — and a copy that leaves its imports
 *  behind does not fail the assertion under test, it fails to START, and the
 *  test then reports whatever the module loader said. (Found the moment
 *  `stripInert`/`visibleText` moved into the shared reduction module.) */
const GUARD_IMPORTS = ['text-reductions.mjs', 'tree-walk.mjs'];

function selfHosted(dir, { root = 'a' } = {}) {
  const to = join(dir, 'tooling', 'ci', GUARD);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(CI_DIR, GUARD), to);
  for (const dep of GUARD_IMPORTS) copyFileSync(join(CI_DIR, dep), join(dirname(to), dep));

  const site = join(dir, 'sites', root);
  // Only the homepage is indexable; every other page declares noindex, so the
  // canonical/sitemap relationship stays a one-line fact and these tests keep
  // testing the legal-pages half they were written for.
  for (const f of readdirSync(site, { withFileTypes: true })) {
    if (!f.isFile() || !f.name.endsWith('.html') || f.name === 'index.html') continue;
    const abs = join(site, f.name);
    let html = readFileSync(abs, 'utf8').replace('<html', '<meta name="robots" content="noindex"><html');
    // The seller's legal person, on the two pages that owe it [pipeline K-2a].
    // Same bargain as the coverage floors above: a fixture claiming to BE this
    // repository has to carry what this repository is required to carry, or the
    // requirement can be deleted to make a test pass.
    if (f.name === 'terms.html' || f.name === 'privacy.html') {
      html = html.replace('</main>', `<p>NIKATRU is a proprietorship of ${SELLER_LEGAL_NAME}.</p></main>`);
    }
    writeFileSync(abs, html);
  }
  writeFileSync(
    join(site, 'index.html'),
    `<html><head><link rel="canonical" href="${FIXTURE_ORIGIN}"></head><body>` +
      `<p data-policy-version="${FIXTURE_VERSION}">${FIXTURE_PROMISE}</p>` +
      '<script>const APPS = [\n];</script></body></html>\n',
  );
  writeFileSync(
    join(site, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>${FIXTURE_ORIGIN}</loc><lastmod>${FIXTURE_VERSION}</lastmod></url></urlset>\n`,
  );
  const fn = join(site, 'functions', 'api', 'probe.js');
  mkdirSync(dirname(fn), { recursive: true });
  writeFileSync(
    fn,
    `// SITE PROMISE: "${FIXTURE_PROMISE}"\n` +
      'export async function onRequestPost({ request, env }) {\n' +
      '  const ip = request.headers.get("cf-connecting-ip") || "";\n' +
      '  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.FIXTURE_SALT || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);\n' +
      '  await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));\n' +
      '  return new Response("ok");\n' +
      '}\n',
  );
  const url = join(dir, 'apps', 'demo', 'store', 'fixture-store', 'privacy-policy-url.txt');
  mkdirSync(dirname(url), { recursive: true });
  writeFileSync(url, `${FIXTURE_ORIGIN}\n`);
  return to;
}

const REQUIRED = ['index.html', '404.html', 'robots.txt', '_headers'];
const ESM_FN = 'export async function onRequestPost() {\n  return new Response("ok");\n}\n';

/** A policy page that clears the floor: an <h1> plus >1000 visible characters. */
const realPage = (title, pad = 300) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main>` +
  `<h1>${title}</h1><p>${'policy sentence. '.repeat(pad)}</p></main></body></html>\n`;

/**
 * Two deploy roots (clears MIN_SITES) and one Pages Function (clears
 * MIN_FUNCTIONS), so any failure below is the legal-pages check and not a
 * coverage floor firing first.
 */
function build(name, { sites = ['a', 'b'], legal = {}, appDirs = [], extra = {} } = {}) {
  const files = {};
  for (const s of sites) {
    for (const f of REQUIRED) files[`sites/${s}/${f}`] = f.endsWith('.html') ? '<html></html>\n' : 'x\n';
  }
  files[`sites/${sites[0]}/functions/api/handler.js`] = ESM_FN;
  for (const s of appDirs) files[`sites/${s}/apps/_template.html`] = '<html><h1>App</h1></html>\n';
  for (const [path, body] of Object.entries(legal)) files[`sites/${path}`] = body;
  for (const [path, body] of Object.entries(extra)) files[path] = body;
  return fixture(name, files);
}

/** Every page in LEGAL_PAGES, as a real page. Named for the count it used to
 *  be; `delete-account.html` joined the set on 2026-08-03 ([pipeline K-7]) and
 *  the helper grew with it rather than the tests each gaining a fourth line. */
const allThree = (site) => ({
  [`${site}/privacy.html`]: realPage('Privacy Policy'),
  [`${site}/terms.html`]: realPage('Terms of Service'),
  [`${site}/refund.html`]: realPage('Refund Policy'),
  [`${site}/delete-account.html`]: realPage('Delete your account'),
});

// ─────────────────────────────────────────────────────────────────────────────
describe('check-site-integrity · legal pages', () => {
  test('a brochure site owes nothing — no apps/, no policy links, no demand', () => {
    // The exemption for sites/rajasekarselvam has to come from the structure of
    // the site, not from a hardcoded skip list that would rot the moment it
    // starts publishing an app.
    const { code, out } = run(build('lp-brochure'));
    assert.equal(code, 0, out);
    assert.match(out, /legal pages enforced on 0 deploy root\(s\)/);
  });

  test('PASSES when a site that ships apps/ publishes every real legal page', () => {
    const dir = build('lp-ok', { appDirs: ['a'], legal: allThree('a') });
    const { code, out } = run(dir);
    assert.equal(code, 0, out);
    assert.match(out, /sites\/a — 4 page\(s\)/);
  });

  test('FAILS when an app-facing site publishes no deletion page — [pipeline K-7]', () => {
    // 🔴 THE NEGATIVE TEST FOR delete-account.html JOINING LEGAL_PAGES. Without
    // it, dropping the page from that constant would leave every other case here
    // green: they were all written when the set had three members, and a set
    // that quietly shrinks is the failure this whole file exists for. A deletion
    // route with no published way to find it is the orphan K-7 is named after,
    // and it is the URL a store reviewer opens when an app offers accounts.
    const legal = allThree('a');
    delete legal['a/delete-account.html'];
    const { code, out } = run(build('lp-nodelete', { appDirs: ['a'], legal }));
    assert.equal(code, 1);
    assert.match(out, /missing .*delete-account\.html/);
    assert.match(out, /app-facing site/);
  });

  test('FAILS when an app-facing site is missing privacy.html, and names it', () => {
    const legal = allThree('a');
    delete legal['a/privacy.html'];
    const { code, out } = run(build('lp-missing', { appDirs: ['a'], legal }));
    assert.equal(code, 1);
    assert.match(out, /missing .*privacy\.html/);
    assert.match(out, /app-facing site/);
  });

  test('FAILS when a legal page is an empty stub', () => {
    const legal = { ...allThree('a'), 'a/refund.html': '<html><main><h1>Refunds</h1><p>Coming soon.</p></main></html>\n' };
    const { code, out } = run(build('lp-stub', { appDirs: ['a'], legal }));
    assert.equal(code, 1);
    assert.match(out, /refund\.html is a stub/);
  });

  test('the size floor counts VISIBLE text — a fat <script> cannot pad a stub past it', () => {
    // Measuring bytes would make this trivially defeatable, and a page that is
    // 40 KB of inline JSON-LD with one sentence of policy is still a stub.
    const padded =
      '<html><main><h1>Refunds</h1><p>Coming soon.</p></main>' +
      `<script>const x = "${'x'.repeat(5000)}";</script></html>\n`;
    const { code, out } = run(build('lp-scriptpad', { appDirs: ['a'], legal: { ...allThree('a'), 'a/refund.html': padded } }));
    assert.equal(code, 1);
    assert.match(out, /refund\.html is a stub/);
  });

  test('FAILS when a long page has no rendered <h1> — a redirect shell is not a policy', () => {
    const headless = realPage('Terms').replace(/<h1>.*?<\/h1>/, '<h1></h1>');
    const { code, out } = run(build('lp-noh1', { appDirs: ['a'], legal: { ...allThree('a'), 'a/terms.html': headless } }));
    assert.equal(code, 1);
    assert.match(out, /terms\.html has no rendered <h1>/);
  });

  test('FAILS on a dangling same-site policy link — and demands ONLY the linked page', () => {
    // A site that links /privacy.html has promised a privacy policy. It has not
    // thereby promised a refund policy, and a guard that says otherwise would
    // fail honest changes until someone deleted it.
    const dir = build('lp-dangling', {
      extra: { 'sites/b/index.html': '<html><body><a href="/privacy.html">Privacy</a></body></html>\n' },
    });
    const { code, out } = run(dir);
    assert.equal(code, 1);
    assert.match(out, /missing .*privacy\.html — a same-site link points at it/);
    assert.doesNotMatch(out, /refund\.html/);
    assert.doesNotMatch(out, /terms\.html/);
  });

  test('a linked policy that EXISTS and is real satisfies the link rule', () => {
    const dir = build('lp-linked-ok', {
      extra: { 'sites/b/index.html': '<html><body><a href="privacy.html">Privacy</a></body></html>\n' },
      legal: { 'b/privacy.html': realPage('Privacy Policy') },
    });
    const { code, out } = run(dir);
    assert.equal(code, 0, out);
    assert.match(out, /sites\/b — 1 page\(s\)/);
  });

  test('does NOT bind on a commented-out link, nor on an absolute URL to another property', () => {
    // Parse, do not grep prose: sites/nikatru links https://nikatru.com/privacy.html
    // from its own footer, and resolving cross-origin URLs would need a host map
    // this guard has no business owning.
    const dir = build('lp-inert', {
      extra: {
        'sites/b/index.html':
          '<html><body><!-- <a href="/privacy.html">Privacy</a> -->' +
          '<a href="https://nikatru.com/privacy.html">Policy</a></body></html>\n',
      },
    });
    const { code, out } = run(dir);
    assert.equal(code, 0, out);
    assert.match(out, /enforced on 0 deploy root\(s\)/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Self-hosted mode: the guard is scanning the tree it lives in, so the name
  // list is live. This is the mode CI actually runs.
  describe('REQUIRED_LEGAL_ROOTS (real-repository mode)', () => {
    test('COVERAGE LOST when the named deploy root is no longer scanned', () => {
      // Renaming sites/nikatru away, on the real tree, prints exactly this.
      // Without the name list it would have printed "ok — 0 roots enforced".
      const dir = build('lp-cov-lost');
      const { code, out } = run(dir, { from: selfHosted(dir) });
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST/);
      assert.match(out, /sites\/nikatru/);
    });

    test('the named root is enforced even with no apps/ dir and no links at all', () => {
      // The heuristics are for sites nobody added to the list. They are not
      // trusted to keep covering the one we already know about.
      const dir = build('lp-cov-named', { sites: ['nikatru', 'b'] });
      const missing = run(dir, { from: selfHosted(dir, { root: 'nikatru' }) });
      assert.equal(missing.code, 1);
      assert.match(missing.out, /missing .*privacy\.html/);
      assert.match(missing.out, /named in REQUIRED_LEGAL_ROOTS/);

      const dir2 = build('lp-cov-ok', { sites: ['nikatru', 'b'], legal: allThree('nikatru') });
      const ok = run(dir2, { from: selfHosted(dir2, { root: 'nikatru' }) });
      assert.equal(ok.code, 0, ok.out);
      assert.match(ok.out, /sites\/nikatru — 4 page\(s\)/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The pre-existing checks still work. Re-asserted here because the legal-page
  // scan reads every .html in every deploy root, which is new I/O on the same
  // walk() these depend on.
  test('the older checks are intact — required files and Function syntax', () => {
    const noHeaders = build('lp-legacy-file');
    rmSync(join(noHeaders, 'sites', 'b', '_headers'));
    const a = run(noHeaders);
    assert.equal(a.code, 1);
    assert.match(a.out, /_headers/);

    const b = run(build('lp-legacy-syntax', { extra: { 'sites/a/functions/api/handler.js': 'export async function x( {\n' } }));
    assert.equal(b.code, 1);
    assert.match(b.out, /does not parse/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-08-01 — the limbs added because the public sites contradicted their own
// SSoT, their own privacy policy and their own served URLs.
//
// 🔴 EVERY CASE BELOW WAS RUN AGAINST A COPY OF THE REAL TREE FIRST, and only
// then written here. The order matters and is not ceremony: on 2026-07-26 a
// guard in this repo shipped with all six of its fixture tests green and its
// real-tree behaviour broken, because the fixture encoded the same
// misunderstanding as the guard. The 16 real-tree mutations (revert the
// canonical to the extensionless form · make a link document-relative · point a
// store listing at a URL we do not serve · put the sitemap lastmod back to
// 2026-07-18 · revert the IP fingerprint to sha256(ip) · rename `const APPS`…)
// each failed with the message named here, from a green baseline, and the tree
// went green again on restore. These fixtures pin those behaviours; they did not
// discover them.
//
// Run non-self-hosted on purpose: the coverage FLOORS are the real repository's
// business (exercised above), and these tests are about whether each limb can
// fail on the input that should fail it.
// ─────────────────────────────────────────────────────────────────────────────
const ORIGIN = 'https://one.test/';

/** An indexable page that names itself in the one canonical form. */
const page = (url, body = '', head = '') =>
  `<html><head><link rel="canonical" href="${url}">${head}</head><body><h1>Page</h1>${body}</body></html>\n`;

/** The homepage links /privacy.html, which binds this root to a REAL privacy
 *  page under the pre-existing legal-pages limb. Padding it keeps these tests
 *  failing for the reason each one names, instead of tripping the stub floor. */
const POLICY_BODY = `<p data-policy-version="2026-03-04">${'policy sentence. '.repeat(80)}</p>`;

const sitemap = (entries) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset>\n' +
  entries.map(([loc, lastmod]) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>\n`).join('') +
  '</urlset>\n';

/** A Function that fingerprints the client IP the way the requirement demands. */
const KEYED_FN =
  'export async function onRequestPost({ request, env }) {\n' +
  '  const ip = request.headers.get("cf-connecting-ip") || "";\n' +
  '  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.PROBE_SALT || ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);\n' +
  '  await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ip));\n' +
  '  return new Response("ok");\n' +
  '}\n';

/**
 * A consistent one-root tree: `nikatru` carries the canonical set (named so the
 * apps.json limb, which is about that homepage, is reachable), `b` is a second
 * root that claims no canonical at all and is therefore out of the URL-form
 * limb's scope — which is itself the behaviour that keeps sites/rajasekarselvam
 * from being dragged into a form it never adopted.
 */
function urlTree(name, over = {}, opts = {}) {
  const files = {
    'sites/nikatru/index.html': page(ORIGIN, '<a href="/privacy.html">Privacy</a>', '<script>const APPS = [\n];</script>'),
    'sites/nikatru/privacy.html': page(`${ORIGIN}privacy.html`, POLICY_BODY),
    'sites/nikatru/404.html': '<meta name="robots" content="noindex"><html><body>gone</body></html>\n',
    'sites/nikatru/robots.txt': 'x\n',
    'sites/nikatru/_headers': 'x\n',
    'sites/nikatru/sitemap.xml': sitemap([[ORIGIN, '2026-01-01'], [`${ORIGIN}privacy.html`, '2026-03-04']]),
    'sites/nikatru/functions/api/probe.js': KEYED_FN,
    'sites/b/index.html': '<html><body>brochure</body></html>\n',
    'sites/b/404.html': '<html></html>\n',
    'sites/b/robots.txt': 'x\n',
    'sites/b/_headers': 'x\n',
    'sites/_shared/_data/apps.json': '[]\n',
  };
  return fixture(name, { ...files, ...over }, opts);
}

describe('check-site-integrity · one canonical URL form', () => {
  test('PASSES on a root whose canonicals, sitemap and links all agree', () => {
    const { code, out } = run(urlTree('uf-ok'));
    assert.equal(code, 0, out);
    assert.match(out, /one canonical URL form on 1 root\(s\)/);
  });

  test('FAILS when a canonical is written in a second form', () => {
    const { code, out } = run(
      urlTree('uf-form', { 'sites/nikatru/privacy.html': page(`${ORIGIN}privacy`, POLICY_BODY) }),
    );
    assert.equal(code, 1);
    assert.match(out, /canonical is "https:\/\/one\.test\/privacy", and the one form this site uses makes it "https:\/\/one\.test\/privacy\.html"/);
  });

  test('FAILS when an indexable page declares no canonical at all', () => {
    const { code, out } = run(urlTree('uf-none', { 'sites/nikatru/privacy.html': '<html><h1>P</h1></html>\n' }));
    assert.equal(code, 1);
    assert.match(out, /declares no <link rel="canonical"> and is not noindex/);
  });

  test('FAILS when the homepage canonical is not the bare origin', () => {
    // Everything else is derived from it, so a wrong one would move every
    // expected URL in lockstep and the whole limb would agree with itself.
    const { code, out } = run(urlTree('uf-origin', { 'sites/nikatru/index.html': page(`${ORIGIN}index.html`) }));
    assert.equal(code, 1);
    assert.match(out, /it must be the bare origin with a trailing slash/);
  });

  test('FAILS on a document-relative page link, and on the extensionless one', () => {
    const rel = run(urlTree('uf-rel', { 'sites/nikatru/index.html': page(ORIGIN, '<a href="privacy.html">P</a>', '<script>const APPS = [\n];</script>') }));
    assert.equal(rel.code, 1);
    assert.match(rel.out, /links "privacy\.html" document-relative/);

    const ext = run(urlTree('uf-ext', { 'sites/nikatru/index.html': page(ORIGIN, '<a href="/privacy">P</a>', '<script>const APPS = [\n];</script>') }));
    assert.equal(ext.code, 1);
    assert.match(ext.out, /the extensionless form of \/privacy\.html/);
  });

  test('FAILS on a root-relative link to a page that does not exist', () => {
    const { code, out } = run(urlTree('uf-dangling', { 'sites/nikatru/index.html': page(ORIGIN, '<a href="/nope.html">N</a>', '<script>const APPS = [\n];</script>') }));
    assert.equal(code, 1);
    assert.match(out, /no such file exists on this deploy root/);
  });

  test('FAILS both ways when the sitemap and the pages disagree', () => {
    const missing = run(urlTree('uf-sm-missing', { 'sites/nikatru/sitemap.xml': sitemap([[ORIGIN, '2026-01-01']]) }));
    assert.equal(missing.code, 1);
    assert.match(missing.out, /does not list https:\/\/one\.test\/privacy\.html/);

    const extra = run(
      urlTree('uf-sm-extra', {
        'sites/nikatru/sitemap.xml': sitemap([[ORIGIN, '2026-01-01'], [`${ORIGIN}privacy.html`, '2026-03-04'], [`${ORIGIN}ghost.html`, '2026-01-01']]),
      }),
    );
    assert.equal(extra.code, 1);
    assert.match(extra.out, /lists https:\/\/one\.test\/ghost\.html, which is not the canonical URL of any indexable page/);
  });

  test('FAILS when og:url disagrees with the canonical on the same page', () => {
    const { code, out } = run(
      urlTree('uf-og', {
        'sites/nikatru/index.html': page(ORIGIN, '', '<meta property="og:url" content="https://one.test/home"><script>const APPS = [\n];</script>'),
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /og:url is "https:\/\/one\.test\/home" but its canonical/);
  });

  test('a noindex page owes no canonical and must not appear in the sitemap', () => {
    // This is what exempts sites/nikatru/apps/_template.html and both 404s —
    // by their own declaration, not by a filename list that would rot.
    const ok = run(urlTree('uf-noindex-ok', { 'sites/nikatru/draft.html': '<meta name="robots" content="noindex, nofollow"><html><body>draft</body></html>\n' }));
    assert.equal(ok.code, 0, ok.out);

    const listed = run(
      urlTree('uf-noindex-listed', {
        'sites/nikatru/draft.html': '<meta name="robots" content="noindex"><html><body>draft</body></html>\n',
        'sites/nikatru/sitemap.xml': sitemap([[ORIGIN, '2026-01-01'], [`${ORIGIN}privacy.html`, '2026-03-04'], [`${ORIGIN}draft.html`, '2026-01-01']]),
      }),
    );
    assert.equal(listed.code, 1);
    assert.match(listed.out, /lists https:\/\/one\.test\/draft\.html/);
  });

  test('a root that claims no canonical at all is out of scope, not failed', () => {
    // sites/rajasekarselvam has one page with a canonical and one deliberate
    // noindex template. A limb that demanded the whole relationship of every
    // root would fail honest brochure sites until somebody deleted it.
    const { code, out } = run(urlTree('uf-scope'));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /sites\/b\//);
  });
});

describe('check-site-integrity · policy version vs sitemap lastmod', () => {
  test('FAILS when the sitemap date drifts from the declared policy version', () => {
    // The real defect: privacy.html said version 2026-07-26 while the sitemap
    // said the page last changed 2026-07-18.
    const { code, out } = run(
      urlTree('pv-drift', { 'sites/nikatru/sitemap.xml': sitemap([[ORIGIN, '2026-01-01'], [`${ORIGIN}privacy.html`, '2026-01-01']]) }),
    );
    assert.equal(code, 1);
    assert.match(out, /declares data-policy-version="2026-03-04" and .*lastmod 2026-01-01/);
  });

  test('FAILS when the sitemap gives a policy page no lastmod at all', () => {
    const { code, out } = run(
      urlTree('pv-none', { 'sites/nikatru/sitemap.xml': sitemap([[ORIGIN, '2026-01-01'], [`${ORIGIN}privacy.html`, null]]) }),
    );
    assert.equal(code, 1);
    assert.match(out, /lastmod \(none\)/);
  });

  test('a page with no policy version is not held to a date', () => {
    const { code, out } = run(urlTree('pv-exempt', { 'sites/nikatru/privacy.html': page(`${ORIGIN}privacy.html`, '<p>' + 'policy sentence. '.repeat(80) + '</p>') }));
    assert.equal(code, 0, out);
    assert.match(out, /0 policy version\(s\) vs sitemap lastmod/);
  });
});

describe('check-site-integrity · store listings point at pages we serve', () => {
  const withStore = (name, url) =>
    urlTree(name, { 'apps/demo/store/ios-appstore/privacy-policy-url.txt': `${url}\n` });

  test('PASSES when the store URL is a canonical URL of an indexable page', () => {
    const { code, out } = run(withStore('st-ok', `${ORIGIN}privacy.html`));
    assert.equal(code, 0, out);
    assert.match(out, /1 store listing URL\(s\) matched to a page we serve/);
  });

  test('FAILS when the store URL is a second spelling of a real page', () => {
    const { code, out } = run(withStore('st-form', `${ORIGIN}privacy`));
    assert.equal(code, 1);
    assert.match(out, /points a store listing at https:\/\/one\.test\/privacy, which is not the canonical URL/);
  });

  test('FAILS when the store URL points at a page this repo does not ship', () => {
    const { code, out } = run(withStore('st-gone', `${ORIGIN}legal.html`));
    assert.equal(code, 1);
    assert.match(out, /not the canonical URL of any indexable page this repo deploys/);
  });

  test('a URL on a host we do not deploy is left alone', () => {
    // Resolving a foreign host would need a host map this guard has no business
    // owning — the same line check-site-integrity already draws for links.
    const { code, out } = run(withStore('st-foreign', 'https://example.org/privacy'));
    assert.equal(code, 0, out);
    assert.match(out, /0 store listing URL\(s\)/);
  });
});

describe('check-site-integrity · what a Function does with a visitor IP', () => {
  const fn = (name, body) => urlTree(name, { 'sites/nikatru/functions/api/probe.js': body });

  test('FAILS on an UNKEYED digest of the client IP', () => {
    // The shipped defect: `sha256(ip)` as a rate-limit key. IPv4 is 2^32 values.
    const { code, out } = run(
      fn(
        'ip-unkeyed',
        'export async function onRequestPost({ request, env }) {\n' +
          '  const ip = request.headers.get("cf-connecting-ip") || "";\n' +
          '  const salt = env.PROBE_SALT;\n' +
          '  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + salt));\n' +
          '  return new Response("ok");\n' +
          '}\n',
      ),
    );
    assert.equal(code, 1);
    assert.match(out, /never calls crypto\.subtle\.sign with HMAC/);
  });

  test('FAILS when the key material is in the repo instead of the environment', () => {
    const { code, out } = run(fn('ip-nosalt', KEYED_FN.replace('env.PROBE_SALT || ""', '"hardcoded-pepper"')));
    assert.equal(code, 1);
    assert.match(out, /reads no salt\/secret\/key from `env`/);
  });

  test('a Function that never touches the IP is not asked for a secret', () => {
    const { code, out } = run(
      urlTree('ip-none', {
        'sites/nikatru/functions/api/probe.js': KEYED_FN,
        'sites/nikatru/functions/api/other.js': 'export async function onRequestGet() { return new Response("ok"); }\n',
      }),
    );
    assert.equal(code, 0, out);
  });

  test('the env secret name is PRINTED on every clean run', () => {
    // It is set in the Cloudflare dashboard, not the repo. A guard that silently
    // requires a secret nobody was told to set ships a disabled feature.
    const { code, out } = run(urlTree('ip-print'));
    assert.equal(code, 0, out);
    assert.match(out, /must be set in Cloudflare: PROBE_SALT/);
  });
});

describe('check-site-integrity · a promise the code quotes is a promise the site makes', () => {
  const PROMISE = 'We store your email address and the time you signed up, and nothing else.';

  test('PASSES while the page still carries the quoted sentence', () => {
    const { code, out } = run(
      urlTree('sp-ok', {
        'sites/nikatru/functions/api/probe.js': `// SITE PROMISE: "${PROMISE}"\n${KEYED_FN}`,
        'sites/nikatru/index.html': page(ORIGIN, `<p>${PROMISE}</p>`, '<script>const APPS = [\n];</script>'),
      }),
    );
    assert.equal(code, 0, out);
  });

  test('FAILS the moment the copy changes underneath it', () => {
    const { code, out } = run(
      urlTree('sp-drift', {
        'sites/nikatru/functions/api/probe.js': `// SITE PROMISE: "${PROMISE}"\n${KEYED_FN}`,
        'sites/nikatru/index.html': page(ORIGIN, '<p>We store your email. Nothing else, ever.</p>', '<script>const APPS = [\n];</script>'),
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /quotes a SITE PROMISE that no page under sites\/nikatru makes/);
  });

  test('the promise must live on the SAME deploy root as the Function', () => {
    const { code, out } = run(
      urlTree('sp-wrongroot', {
        'sites/nikatru/functions/api/probe.js': `// SITE PROMISE: "${PROMISE}"\n${KEYED_FN}`,
        'sites/b/index.html': `<html><body>${PROMISE}</body></html>\n`,
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /no page under sites\/nikatru makes/);
  });
});

describe('check-site-integrity · the site app list vs apps.json', () => {
  const registry = (status) => `[{ "slug": "subly", "name": "Subly", "url": "https://subly.test", "status": "${status}" }]\n`;
  const withApps = (name, body, status) =>
    urlTree(name, {
      'sites/nikatru/index.html': page(ORIGIN, '', `<script>const APPS = [${body}];</script>`),
      'sites/_shared/_data/apps.json': registry(status),
    });

  test('FAILS when the homepage lists an app the registry does not mark live', () => {
    // This direction is a promise made to a stranger, and an agent can fix it.
    const { code, out } = run(withApps('aj-unbacked', '{ name: "Drift" }', 'live'));
    assert.equal(code, 1);
    assert.match(out, /lists an app "drift" in its APPS array/);
  });

  test('PRINTS, and does not fail, when the registry says live and the site is silent', () => {
    // 🔴 The limb must NOT presuppose the answer. Whether a live app is publicly
    // announced is a launch decision the owner makes; failing here would block
    // every build on owner-only work, which is [pipeline C-6]'s recorded rule.
    const { code, out } = run(withApps('aj-unannounced', '\n', 'live'));
    assert.equal(code, 0, out);
    assert.match(out, /UNANNOUNCED: .*marks "Subly" status "live"/);
    assert.match(out, /WHICH ONE IS RIGHT IS AN OWNER DECISION/);
  });

  test('either resolution silences it — and the guard says which without choosing', () => {
    // Resolution A: the registry stops claiming live.
    const registryMoved = run(withApps('aj-not-live', '\n', 'beta'));
    assert.equal(registryMoved.code, 0, registryMoved.out);
    assert.doesNotMatch(registryMoved.out, /UNANNOUNCED/);

    // Resolution B: the site announces it. Both are accepted, which is exactly
    // what "decidable without knowing which is right" means.
    const siteMoved = run(withApps('aj-announced', '{ name: "Subly" }', 'live'));
    assert.equal(siteMoved.code, 0, siteMoved.out);
    assert.doesNotMatch(siteMoved.out, /UNANNOUNCED/);
  });

  test('the array is read RAW — stripping <script> would find nothing at all', () => {
    // The APPS array lives inside a <script>, which stripInert() removes. Every
    // other limb here reads the stripped text; this one must not, and the way to
    // notice it started to is that the array becomes invisible and the limb goes
    // vacuously quiet rather than loud.
    const { code, out } = run(withApps('aj-raw', '{ name: "Ghost" }', 'beta'));
    assert.equal(code, 1);
    assert.match(out, /lists an app "ghost"/);
  });

  test('the instructional comment above the array is NOT read as a listed app', () => {
    // sites/nikatru/index.html carries a worked example — `name: "My Notes App"`
    // and five store URLs — in the comment a human copies from. A scan that
    // started at the file rather than at the array would report it as an app.
    const { code, out } = run(
      urlTree('aj-comment', {
        'sites/nikatru/index.html': page(
          ORIGIN,
          '',
          '<script>/* Example:\n{ name: "My Notes App", links: { ios: "..." } }\n*/\nconst APPS = [\n  // add your first app here\n];</script>',
        ),
        'sites/_shared/_data/apps.json': registry('beta'),
      }),
    );
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /My Notes App/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 12]W-3b · A DISCOVERY SURFACE MAY NOT BE DELETED.
//
// `REQUIRED_FILES` held index.html, 404.html, robots.txt and _headers, and the
// sitemap relationship sat behind an `if (existsSync(...))`. So deleting
// `sites/rajasekarselvam/sitemap.xml` passed this lane, passed ci-gate, and
// shipped — and the check that would have caught a drifted sitemap silently
// skipped instead of failing.
//
// Mutation-proven by DELETING the real files first (2026-08-02): removing
// sites/rajasekarselvam/sitemap.xml → red naming that root; removing
// sites/nikatru/llms.txt → red naming that root. Both restored byte-identical
// and the baseline re-verified green.
// ─────────────────────────────────────────────────────────────────────────────
describe('check-site-integrity · a deploy root owes its discovery surfaces', () => {
  // Built on urlTree so each case is a ONE-DELETION difference from a tree that
  // PASSES. A hand-rolled minimal tree stops at an unrelated coverage floor
  // (MIN_SITES, then MIN_FUNCTIONS) and the assertion never reaches the check it
  // is about — which is a test that fails for the wrong reason, i.e. a test that
  // would keep passing after the limb it names was deleted.
  test('FAILS when a root ships no sitemap.xml', () => {
    const { code, out } = run(urlTree('req-sitemap', {}, { omit: ['sites/b/sitemap.xml'] }));
    assert.equal(code, 1);
    assert.match(out.replaceAll('\\', '/'), /missing sites\/b\/sitemap\.xml/);
  });

  test('FAILS when a root ships no llms.txt', () => {
    const { code, out } = run(urlTree('req-llms', {}, { omit: ['sites/b/llms.txt'] }));
    assert.equal(code, 1);
    assert.match(out.replaceAll('\\', '/'), /missing sites\/b\/llms\.txt/);
  });

  // …and the same tree with nothing deleted PASSES, or the two cases above
  // prove only that the fixture was broken to begin with.
  test('PASSES when both are present', () => {
    const { code, out } = run(urlTree('req-both'));
    assert.equal(code, 0, out);
    assert.match(out, /required files present/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 12]W-3c · llms.txt MAY NOT CONTRADICT THE APP REGISTRY.
//
// Repo-wide, `llms.txt` appeared in guard code exactly once — inside a comment —
// and the file was measurably lying: sites/nikatru/llms.txt said "First releases
// are on the way" and "Status: pre-launch" while apps.json marked `subly` live
// and assert-catalog-reachable.mjs proved its URL answers.
//
// 🔴 THE STRONGEST NEGATIVE TEST THIS LIMB WILL EVER GET is that it was RED ON
// THE REAL TREE the moment it was written, before a word of copy changed — five
// problems across both deploy roots, including one the first (narrower) pattern
// missed: the mirror said "first NIKATRU releases in active development", the
// same claim with a brand dropped into the middle.
//
// This FAILS where the homepage limb only PRINTS, and the difference is not
// arbitrary. The homepage limb refuses to decide whether a live app is
// ANNOUNCED — an owner's launch-timing call. This limb decides nothing of the
// kind: a file whose whole job is to state what the site IS cannot say the
// studio has shipped nothing while the registry says it has and the app answers
// on the public internet. Either side of that contradiction is an agent-sized
// edit.
// ─────────────────────────────────────────────────────────────────────────────
describe('check-site-integrity · llms.txt vs the app registry', () => {
  const LIVE = '[{ "slug": "subly", "name": "Subly", "url": "https://subly.test", "status": "live" }]\n';
  const PREVIEW = '[{ "slug": "subly", "name": "Subly", "url": "https://subly.test", "status": "preview" }]\n';
  const honest = '# N\n\n> The studio ships apps.\n\n## Apps\n- Subly — https://subly.test (web)\n';

  /** An APP-FACING root: it ships an apps/ directory, which is the heuristic
   *  that catches a new site nobody added to REQUIRED_LEGAL_ROOTS. Only an
   *  app-facing root owes the catalogue — the personal mirror points readers at
   *  the studio instead, and forcing it to duplicate the list would be inventing
   *  a requirement nobody wrote. */
  /** A noindex legal page with enough visible text to clear the stub floor.
   *  noindex so it owes no canonical and must stay OUT of the sitemap, which
   *  keeps these cases about llms.txt rather than about the sitemap limb. */
  const legalPage = `<html><head><meta name="robots" content="noindex"></head><body><h1>Legal</h1><p>${'legal sentence. '.repeat(80)}</p></body></html>\n`;

  const appFacing = (name, over = {}) =>
    urlTree(name, {
      'sites/nikatru/apps/_template.html': '<meta name="robots" content="noindex"><html><body>t</body></html>\n',
      // Shipping an apps/ directory makes this root APP-FACING, which is the
      // whole point — and app-facing roots owe the full legal set.
      'sites/nikatru/terms.html': legalPage,
      'sites/nikatru/refund.html': legalPage,
      'sites/nikatru/delete-account.html': legalPage,
      'sites/_shared/_data/apps.json': LIVE,
      'sites/nikatru/llms.txt': honest,
      ...over,
    });

  test('PASSES when llms.txt names every live app and claims nothing false', () => {
    const { code, out } = run(appFacing('llms-ok'));
    assert.equal(code, 0, out);
  });

  test('FAILS on "pre-launch" while the registry marks an app live', () => {
    const { code, out } = run(appFacing('llms-prelaunch', {
      'sites/nikatru/llms.txt': `${honest}- Status: pre-launch\n`,
    }));
    assert.equal(code, 1);
    assert.match(out, /says "pre-launch" while/);
    assert.match(out, /contradict each other/);
  });

  // The same claim with a brand dropped into the middle — the exact phrasing
  // the first version of the pattern walked straight past on the real mirror.
  test('FAILS on "first <brand> releases in active development" too', () => {
    const { code, out } = run(appFacing('llms-dev', {
      'sites/nikatru/llms.txt': `${honest}- Status: first NIKATRU releases in active development\n`,
    }));
    assert.equal(code, 1);
    assert.match(out, /in active development" while/);
  });

  test('FAILS when an app-facing root omits a live app entirely', () => {
    const { code, out } = run(appFacing('llms-omits', {
      'sites/nikatru/llms.txt': '# N\n\n> The studio ships apps.\n',
    }));
    assert.equal(code, 1);
    assert.match(out, /does not name https:\/\/subly\.test/);
  });

  // The other direction, and the one that matches the homepage limb's rule: a
  // name with nothing behind it is a promise made to a stranger.
  test('FAILS when llms.txt advertises an app the registry does not call live', () => {
    const { code, out } = run(appFacing('llms-unbacked', { 'sites/_shared/_data/apps.json': PREVIEW }));
    assert.equal(code, 1);
    assert.match(out, /names https:\/\/subly\.test, and .* status "preview"/);
  });

  // A root that is NOT app-facing ships an llms.txt too and is deliberately out
  // of scope for the catalogue half — it may still not advertise a non-live app.
  test('a non-app-facing root is not required to carry the catalogue', () => {
    const { code, out } = run(urlTree('llms-mirror', {
      'sites/_shared/_data/apps.json': LIVE,
      'sites/nikatru/llms.txt': '# N\n\n> A studio. See the catalogue elsewhere.\n',
    }));
    assert.equal(code, 0, out);
  });

  // Platform-count claims belong to assert-channel-claims.mjs, which PRINTS
  // rather than fails because site copy is the owner's voice. Two guards on one
  // fault is how a fix chases the wrong message.
  test('does NOT touch the six-platform claim', () => {
    const { code, out } = run(appFacing('llms-platforms', {
      'sites/nikatru/llms.txt': `${honest}- Platforms: iOS, Android, Windows, macOS, Linux, Web\n`,
    }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /platform/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The floors themselves. Every limb above ranges over something a single edit
// can empty — an attribute, an array name, a header string, a marker — and an
// empty domain is not a clean tree, it is a check that stopped checking and kept
// printing "ok". Real-repository mode only, because these are claims about THIS
// repository; the synthetic fixtures above legitimately have none of them.
//
// The scaffolding selfHosted() writes is what makes each case a ONE-EDIT
// difference from a passing tree, which is the only way to tell a floor that
// fires from a fixture that was never going to pass anyway.
// ─────────────────────────────────────────────────────────────────────────────
describe('check-site-integrity · the new limbs cannot go vacuously quiet', () => {
  /** A self-hosted fixture that PASSES, then one edit that empties one limb. */
  function afterEdit(name, edit) {
    const dir = build(name, { sites: ['nikatru', 'b'], legal: allThree('nikatru') });
    const from = selfHosted(dir, { root: 'nikatru' });
    edit(dir);
    return run(dir, { from });
  }

  const patch = (dir, rel, from, to) => {
    const abs = join(dir, rel);
    const text = readFileSync(abs, 'utf8');
    assert.ok(text.includes(from), `fixture no longer contains ${from} — the scaffolding moved`);
    writeFileSync(abs, text.replace(from, to));
  };

  test('the scaffolded fixture passes, so every case below is a one-edit difference', () => {
    const clean = afterEdit('cf-clean', () => {});
    assert.equal(clean.code, 0, clean.out);
  });

  // ── [pipeline K-2a] the commercial surface names a legal person ───────────
  // Mutation-proven against the real tree as well (6/6): removing the name from
  // terms.html, from privacy.html, burying it in an HTML comment, and emptying
  // MUST_NAME_SELLER each turn the real run red.
  test('terms.html that names only the brand FAILS', () => {
    const r = afterEdit('cf-noseller-terms', (d) =>
      patch(d, 'sites/nikatru/terms.html', `proprietorship of ${SELLER_LEGAL_NAME}`, 'proprietorship'),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /terms\.html does not name "Rajasekar Selvam"/);
    assert.match(r.out, /NIKATRU is a trading name/);
  });

  test('privacy.html that names only the brand FAILS — two pages, not one', () => {
    // Two independently authored documents, because the name lives in a constant
    // in the guard and a constant in a guard is a second source of truth. A wrong
    // value has to fail on both, not quietly agree with the one it was copied from.
    const r = afterEdit('cf-noseller-priv', (d) =>
      patch(d, 'sites/nikatru/privacy.html', `proprietorship of ${SELLER_LEGAL_NAME}`, 'proprietorship'),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /privacy\.html does not name "Rajasekar Selvam"/);
  });

  test('the name surviving only inside an HTML comment does NOT count', () => {
    const r = afterEdit('cf-seller-comment', (d) =>
      patch(d, 'sites/nikatru/terms.html', `proprietorship of ${SELLER_LEGAL_NAME}.`, `proprietorship of <!-- ${SELLER_LEGAL_NAME} --> the publisher.`),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /terms\.html does not name/);
  });

  test('COVERAGE LOST when the seller-name limb has no pages left in scope', () => {
    const r = afterEdit('cf-seller-empty', (d) =>
      patch(
        d,
        join('tooling', 'ci', GUARD),
        "const MUST_NAME_SELLER = ['terms.html', 'privacy.html'];",
        'const MUST_NAME_SELLER = [];',
      ),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /NO app-facing page was in scope for the seller's legal name/);
  });

  // ── the owner-gated half: printed, never failed ───────────────────────────
  test('the missing pricing page is PRINTED on an otherwise green run, keyed to the owner item', () => {
    // Failing on it would block every CI run on copy only the owner can write —
    // the rule this repo already applies to the unannounced-app case.
    const r = afterEdit('cf-pricing-gap', () => {});
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /MISSING \(owner-gated\): sites\/nikatru\/pricing\.html/);
    assert.match(r.out, /OWNER_QUEUE O-3/);
  });

  test('once pricing.html exists the print flips to PROMOTE ME, so the exemption cannot outlive its reason', () => {
    const r = afterEdit('cf-pricing-landed', (d) =>
      writeFileSync(
        join(d, 'sites', 'nikatru', 'pricing.html'),
        '<html><head><meta name="robots" content="noindex"></head><body><h1>Pricing</h1></body></html>\n',
      ),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /PROMOTE ME: sites\/nikatru\/pricing\.html now exists/);
    assert.match(r.out, /into LEGAL_PAGES/);
  });

  test('COVERAGE LOST when no root declares a homepage canonical', () => {
    const r = afterEdit('cf-nocanon', (d) => patch(d, 'sites/nikatru/index.html', 'rel="canonical"', 'rel="alternate"'));
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /ZERO deploy roots declared a homepage canonical/);
  });

  test('COVERAGE LOST when the policy-version attribute is gone', () => {
    const r = afterEdit('cf-nover', (d) => patch(d, 'sites/nikatru/index.html', ` data-policy-version="${FIXTURE_VERSION}"`, ''));
    assert.equal(r.code, 1);
    assert.match(r.out, /NO page carries a `data-policy-version`/);
  });

  test('COVERAGE LOST when no store listing resolves to a host we deploy', () => {
    const r = afterEdit('cf-nostore', (d) =>
      patch(d, 'apps/demo/store/fixture-store/privacy-policy-url.txt', FIXTURE_ORIGIN, 'https://elsewhere.test/privacy.html'),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /NO apps\/\*\/store\/\*\/\*-url\.txt resolved to a host this repo deploys/);
  });

  test('COVERAGE LOST when the APPS array is renamed out from under the check', () => {
    // The exact edit that would silently retire the apps.json comparison — and
    // the reason it is a floor and not a comment.
    const r = afterEdit('cf-noapps', (d) => patch(d, 'sites/nikatru/index.html', 'const APPS = [', 'const NIKATRU_APPS = ['));
    assert.equal(r.code, 1);
    assert.match(r.out, /`const APPS = \[` was not found/);
  });

  test('COVERAGE LOST when no Function reads the client IP header any more', () => {
    const r = afterEdit('cf-noip', (d) =>
      patch(d, 'sites/nikatru/functions/api/probe.js', 'cf-connecting-ip', 'x-forwarded-for'),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /NO Pages Function reads the cf-connecting-ip header/);
  });

  test('COVERAGE LOST when the last SITE PROMISE marker is deleted', () => {
    const r = afterEdit('cf-nopromise', (d) =>
      patch(d, 'sites/nikatru/functions/api/probe.js', `// SITE PROMISE: "${FIXTURE_PROMISE}"`, '// (no promise)'),
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /NO Pages Function carries a `SITE PROMISE/);
  });

  test('the OLDER floor still wins when the named legal root is gone', () => {
    // Ordering, asserted rather than assumed: sites/nikatru disappearing is the
    // oldest and most specific claim this file makes, and a tree that has lost
    // it must hear about THAT, not about a policy-version attribute.
    const dir = build('cf-order', { sites: ['a', 'b'] });
    const r = run(dir, { from: selfHosted(dir, { root: 'a' }) });
    assert.equal(r.code, 1);
    assert.match(r.out, /sites\/nikatru is no longer scanned for legal pages/);
  });
});
