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
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
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

function fixture(name, files) {
  const dir = join(ROOT, name);
  for (const [rel, body] of Object.entries(files)) {
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

/** Drop a copy of the guard inside the fixture so it scans "its own repo". */
function selfHosted(dir) {
  const to = join(dir, 'tooling', 'ci', GUARD);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(CI_DIR, GUARD), to);
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

const allThree = (site) => ({
  [`${site}/privacy.html`]: realPage('Privacy Policy'),
  [`${site}/terms.html`]: realPage('Terms of Service'),
  [`${site}/refund.html`]: realPage('Refund Policy'),
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

  test('PASSES when a site that ships apps/ publishes all three real pages', () => {
    const dir = build('lp-ok', { appDirs: ['a'], legal: allThree('a') });
    const { code, out } = run(dir);
    assert.equal(code, 0, out);
    assert.match(out, /sites\/a — 3 page\(s\)/);
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
      const missing = run(dir, { from: selfHosted(dir) });
      assert.equal(missing.code, 1);
      assert.match(missing.out, /missing .*privacy\.html/);
      assert.match(missing.out, /named in REQUIRED_LEGAL_ROOTS/);

      const dir2 = build('lp-cov-ok', { sites: ['nikatru', 'b'], legal: allThree('nikatru') });
      const ok = run(dir2, { from: selfHosted(dir2) });
      assert.equal(ok.code, 0, ok.out);
      assert.match(ok.out, /sites\/nikatru — 3 page\(s\)/);
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
