// ─────────────────────────────────────────────────────────────────────────────
// web-cache-policy.test.mjs — assert-web-cache-policy.mjs must be able to FAIL.
//
// 🔴 THE REAL-TREE RUN CAME FIRST. Eight mutations against a full COPY of this
// repository, 2026-08-03, all eight caught and restored byte-identically:
//
//   1. apps/subly/web/_headers deleted ⇒ exit 1.
//   2. `/flutter_bootstrap.js` given `max-age=3600, must-revalidate` ⇒ exit 1.
//      This is the case the requirement is named after, and the message says
//      why `must-revalidate` beside a long max-age is not a revalidation.
//   3. the `/index.html` rule removed ⇒ exit 1.
//   4. the rules COMMENTED OUT ⇒ exit 1. Prose about caching is not a policy —
//      the same shape as a commented-out build step keeping a guard green.
//   5. the BRICK template's _headers deleted ⇒ exit 1. That is the file whose
//      absence reaches every future app.
//   6. the brick web path broken in the guard ⇒ COVERAGE LOST.
//   7. a single `/*` rule with `max-age=0` covering all three entry points ⇒
//      exit 0. The guard resolves wildcards; it does not demand a spelling.
//   8. `assets/*` staying `immutable` ⇒ exit 0. Hashed output is the opposite
//      case and must never fire, or the guard is switched off within a day.
//
// 🔴 MUTATION 8 WAS WRONG, AND IT IS THE REASON THIS SUITE GREW. "Hashed output
// under assets/" described a bundle Flutter does not produce. Measured against
// the live channel on 2026-08-04: `flutter_bootstrap.js` names `main.dart.js`,
// `canvaskit.js` and `canvaskit.wasm` with no hash-shaped token anywhere, and
// the only `?v=` in it is on `flutter_service_worker.js`, which
// `--pwa-strategy=none` never emits. NOTHING in the bundle is content-addressed
// — so `/icons/*` and `/assets/*` were declared `immutable, max-age=31536000`
// over stable names, and `/icons/Icon-192.png` is exactly the bytes PR #149
// replaced. `immutable` suppresses revalidation even on a hard reload.
//
// The guard was green throughout, because it only ever asked about three entry
// points, AND THIS FILE ASSERTED THE DEFECT WAS CORRECT. A test that encodes the
// author's belief protects the belief, not the tree. Mutation 8 is kept below,
// re-pointed at what it can honestly claim: an immutable rule over a path the
// repository ships nothing under is not evidence of anything either way.
//
// SECOND REAL-TREE RUN, 2026-08-04 — six mutations on a COPY of this repo, each
// caught, each restored byte-identically:
//
//   9.  apps/subly/web/_headers `/icons/*` returned to
//       `max-age=31536000, immutable` ⇒ exit 1, naming
//       apps/subly/web/icons/Icon-192.png. This is the shipped-file limb, and
//       the defect it was written for.
//   10. the `/favicon.png` rule deleted ⇒ exit 1 ("no rule covering
//       /favicon.png"). It had never been declared; it was correct only by
//       inheriting the platform default.
//   11. sites/nikatru/_headers `/*.css` deleted ⇒ exit 1. The class probe.
//   12. sites/nikatru/_headers `/*.css` narrowed to `/assets/*.css` ⇒ exit 1 at
//       depth 0 (`/probe.css`) — a directory-scoped rule reopens the gap.
//   13. sites/nikatru/index.html deleted ⇒ COVERAGE LOST (sites/ present,
//       zero deploy roots) rather than a quiet drop to one site.
//   14. `flutter build web` copies web/ verbatim, so shippedPaths() pointed at
//       a nonexistent dir ⇒ COVERAGE LOST (zero shipped files evaluated).
//
// ⚠️ EVERY ASSERTION IS AGAINST THE DECLARED FILE, so the suite fails offline.
// What the edge actually returns is deliberately out of scope — see the
// CANNOT-SEE list in the guard's header.
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
const GUARD = join(CI_DIR, 'assert-web-cache-policy.mjs');
const BRICK_WEB = 'tooling/bricks/app/__brick__/apps/{{app_id}}/web';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-cache-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const GOOD = `# a real policy
/
  Cache-Control: public, max-age=0, must-revalidate
/index.html
  Cache-Control: public, max-age=0, must-revalidate
/flutter_bootstrap.js
  Cache-Control: public, max-age=0, must-revalidate
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

/** A static deploy root's policy: entry points plus the two asset CLASSES a
 *  hand-written site inevitably grows, declared at any depth. */
const GOOD_SITE = `# security headers carry no Cache-Control, so nothing overlaps
/*
  X-Frame-Options: DENY
/
  Cache-Control: public, max-age=0, must-revalidate
/*.html
  Cache-Control: public, max-age=0, must-revalidate
/*.css
  Cache-Control: public, max-age=0, must-revalidate
/*.js
  Cache-Control: public, max-age=0, must-revalidate
`;

/**
 * @param {object} o
 * @param {string|null} o.app      apps/subly/web/_headers contents (null = absent)
 * @param {string|null} o.brick    the brick template's _headers
 * @param {Record<string,string|null>|null} o.sites  site name → _headers
 * @param {Record<string,string>} o.appFiles  extra files shipped under web/
 * @param {Record<string,string>} o.siteFiles extra files shipped on every site
 */
function fixture({ app = GOOD, brick = GOOD, sites = null, appFiles = {}, siteFiles = {} } = {}) {
  const root = join(TMP, `f${seq++}`);
  mkdirSync(join(root, 'apps', 'subly', 'web'), { recursive: true });
  mkdirSync(join(root, BRICK_WEB), { recursive: true });
  writeFileSync(join(root, 'apps', 'subly', 'web', 'index.html'), '<html></html>');
  writeFileSync(join(root, BRICK_WEB, 'index.html'), '<html></html>');
  if (app !== null) writeFileSync(join(root, 'apps', 'subly', 'web', '_headers'), app);
  if (brick !== null) writeFileSync(join(root, BRICK_WEB, '_headers'), brick);
  for (const [rel, body] of Object.entries(appFiles)) {
    const abs = join(root, 'apps', 'subly', 'web', ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  if (sites !== null) {
    for (const [name, headers] of Object.entries(sites)) {
      const dir = join(root, 'sites', name);
      mkdirSync(dir, { recursive: true });
      // A deploy root is a sites/* directory that ships an index.html; a value
      // of `null` for the whole site means "directory with no index.html",
      // which is how a root silently stops being one.
      if (headers !== null) {
        writeFileSync(join(dir, 'index.html'), '<html></html>');
        writeFileSync(join(dir, '_headers'), headers);
        for (const [rel, body] of Object.entries(siteFiles)) {
          const abs = join(dir, ...rel.split('/'));
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, body);
        }
      }
    }
  }
  return root;
}

function run(root, ...claims) {
  const r = spawnSync(process.execPath, [GUARD, root, ...claims], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('assert-web-cache-policy', () => {
  test('passes when every web output declares a revalidating entry-point policy', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /2 flutter-web/);
  });

  test('FAILS when an app web directory has no _headers at all', () => {
    const { code, out } = run(fixture({ app: null }));
    assert.equal(code, 1);
    assert.match(out, /apps\/subly\/web\/_headers does not exist/);
    assert.match(out, /NOTHING in this repository chooses a cache policy/);
  });

  test('FAILS when the BRICK template has no _headers — the defect every future app inherits', () => {
    const { code, out } = run(fixture({ brick: null }));
    assert.equal(code, 1);
    assert.match(out, /__brick__/);
  });

  test('FAILS when _headers is empty', () => {
    const { code, out } = run(fixture({ app: '   \n' }));
    assert.equal(code, 1);
    assert.match(out, /is empty/);
  });

  test('FAILS when the file is only comments — prose about caching is not a policy', () => {
    const { code, out } = run(fixture({ app: '# we cache the entry points for zero seconds\n# /index.html max-age=0\n' }));
    assert.equal(code, 1);
    assert.match(out, /declares no rule at all outside comments/);
  });

  // The case the requirement is named after.
  test('FAILS when flutter_bootstrap.js carries a real max-age', () => {
    const { code, out } = run(fixture({ app: GOOD.replace('/flutter_bootstrap.js\n  Cache-Control: public, max-age=0, must-revalidate', '/flutter_bootstrap.js\n  Cache-Control: public, max-age=14400') }));
    assert.equal(code, 1);
    assert.match(out, /covering "\/flutter_bootstrap\.js"\) is "public, max-age=14400"/);
    assert.match(out, /governs what happens once the response is STALE/);
  });

  test('FAILS when an entry point has no rule covering it', () => {
    const { code, out } = run(fixture({ app: GOOD.replace('/index.html\n  Cache-Control: public, max-age=0, must-revalidate\n', '') }));
    assert.equal(code, 1);
    assert.match(out, /no rule covering "\/index\.html"/);
  });

  test('FAILS when a rule exists but sets no Cache-Control at all', () => {
    const { code, out } = run(fixture({ app: '/\n  X-Frame-Options: DENY\n/index.html\n  X-Frame-Options: DENY\n/flutter_bootstrap.js\n  X-Frame-Options: DENY\n' }));
    assert.equal(code, 1);
    assert.match(out, /sets no Cache-Control/);
  });

  test('`must-revalidate` ALONE, with a long max-age, is not a revalidation', () => {
    const { code, out } = run(fixture({ app: '/*\n  Cache-Control: public, max-age=86400, must-revalidate\n' }));
    assert.equal(code, 1);
    assert.match(out, /must be revalidated/);
  });

  // ── the shipped-file limb — the 2026-08-04 defect ─────────────────────────
  // `flutter build web` copies web/ verbatim, so a file in the repo reaches the
  // edge under the name it has here. Nothing in a Flutter bundle is
  // content-addressed, so nothing shipped may be frozen.
  test('FAILS when a file the repo ships under web/ is declared immutable', () => {
    const { code, out } = run(
      fixture({
        app: `${GOOD}/icons/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
        appFiles: { 'icons/Icon-192.png': 'png-bytes' },
      }),
    );
    assert.equal(code, 1);
    assert.match(out, /covering "\/icons\/Icon-192\.png"\) is "public, max-age=31536000, immutable"/);
    assert.match(out, /copied verbatim into the deployed bundle/);
    assert.match(out, /suppresses revalidation even on a reload/);
  });

  test('FAILS when a file the repo ships under web/ has no rule at all', () => {
    const { code, out } = run(fixture({ app: GOOD, appFiles: { 'favicon.png': 'png-bytes' } }));
    assert.equal(code, 1);
    assert.match(out, /no rule covering "\/favicon\.png"/);
  });

  test('_headers itself is not an asset and is never demanded of itself', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /covering "\/_headers"/);
  });

  // ── static-site deploy roots ──────────────────────────────────────────────
  test('passes when a static deploy root declares its entry points and the css/js classes', () => {
    const { code, out } = run(fixture({ sites: { nikatru: GOOD_SITE, mirror: GOOD_SITE } }));
    assert.equal(code, 0, out);
    assert.match(out, /2 static-site/);
    assert.match(out, /class probe/);
  });

  test('FAILS when a static deploy root declares no policy for .css', () => {
    const { code, out } = run(fixture({ sites: { nikatru: GOOD_SITE.replace('/*.css\n  Cache-Control: public, max-age=0, must-revalidate\n', '') } }));
    assert.equal(code, 1);
    // The site's `/*` security-header rule still MATCHES the probe, so the
    // honest complaint is "that rule sets no Cache-Control" rather than "no
    // rule at all" — a distinction that matters, because a reader chasing the
    // first message would go looking for a missing rule that is right there.
    assert.match(out, /rule "\/\*" \(covering "\/probe\.css"\) sets no Cache-Control/);
    assert.match(out, /would inherit whatever the platform or the Cloudflare zone happens to default to/);
  });

  test('FAILS when a static deploy root declares .css for ONE DIRECTORY instead of the class', () => {
    const { code, out } = run(fixture({ sites: { nikatru: GOOD_SITE.replace('/*.css', '/assets/*.css') } }));
    assert.equal(code, 1);
    assert.match(out, /covering "\/probe\.css"/);
    assert.match(out, /covering "\/a\/b\/probe\.css"/);
    // …and the one depth the narrowed rule DOES cover must not be reported,
    // or the message stops telling anyone where the hole actually is.
    assert.doesNotMatch(out, /covering "\/assets\/probe\.css"/);
    assert.match(out, /Declare the CLASS at any depth/);
  });

  test('FAILS when a static deploy root has no rule for /index.html', () => {
    const { code, out } = run(fixture({ sites: { nikatru: GOOD_SITE.replace('/*.html', '/deep/*.html') } }));
    assert.equal(code, 1);
    assert.match(out, /covering "\/index\.html"\) sets no Cache-Control/);
  });

  // The resolver bug this replaced: the old `prefix + '*'` test could not match
  // a mid-path splat, so `/index.html` resolved to `/*` — the security-headers
  // rule — and the guard would have failed a file that is perfectly correct.
  test('a MID-PATH splat (`/*.html`) is resolved, not skipped past to `/*`', () => {
    const { code, out } = run(fixture({ sites: { nikatru: GOOD_SITE } }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /covering "\/index\.html"\) sets no Cache-Control/);
  });

  // ── what must NOT fire ────────────────────────────────────────────────────
  test('a single `/*` rule with max-age=0 covers every entry point and PASSES', () => {
    const { code, out } = run(fixture({ app: '/*\n  Cache-Control: public, max-age=0, must-revalidate\n' }));
    assert.equal(code, 0, out);
  });

  test('`no-store` and `no-cache` are accepted spellings', () => {
    const { code, out } = run(fixture({ app: '/*\n  Cache-Control: no-store\n' }));
    assert.equal(code, 0, out);
  });

  // ⚠️ THIS WAS "hashed output under assets/ staying immutable does NOT fire",
  // and that name asserted something false about Flutter (see the header). What
  // it can honestly claim is narrower: an immutable rule over a path this
  // repository ships NOTHING under is not evidence either way, so the guard
  // must not invent a complaint about it.
  test('an immutable rule over a path the repo ships nothing under does not fire', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
  });

  test('an exact rule wins over a wildcard that would also match', () => {
    const app = `/*
  Cache-Control: public, max-age=31536000, immutable
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/flutter_bootstrap.js
  Cache-Control: no-cache
`;
    const { code, out } = run(fixture({ app }));
    assert.equal(code, 0, out);
  });

  test('the LONGEST matching wildcard is the one that governs', () => {
    const app = `/*
  Cache-Control: public, max-age=0, must-revalidate
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
    const { code, out } = run(fixture({ app }));
    assert.equal(code, 0, out);
  });

  // ── printed, not failed ───────────────────────────────────────────────────
  test('two Cache-Control rules matching one path is PRINTED, never failed', () => {
    const app = `/*
  Cache-Control: public, max-age=31536000, immutable
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/flutter_bootstrap.js
  Cache-Control: no-cache
`;
    const { code, out } = run(fixture({ app }));
    assert.equal(code, 0, out);
    assert.match(out, /OVERLAPPING RULES/);
    assert.match(out, /joined with a comma/);
    assert.match(out, /PRINTED, not failed/);
  });

  test('a stable-named site asset declared immutable is PRINTED, never failed', () => {
    const { code, out } = run(
      fixture({
        sites: { nikatru: `${GOOD_SITE}/*.png\n  Cache-Control: public, max-age=31536000, immutable\n` },
        siteFiles: { 'og-image.png': 'png', 'founder-v4.png': 'png' },
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /STABLE NAMES DECLARED IMMUTABLE on sites\/nikatru/);
    assert.match(out, /og-image\.png/);
    // The hand-versioning convention is what makes immutable honest, so a name
    // that carries a version must NOT be reported.
    assert.doesNotMatch(out, /founder-v4\.png \(via/);
  });

  // ── coverage self-check ───────────────────────────────────────────────────
  test('COVERAGE LOST when there is no web output directory anywhere', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /found no deployed bundle/);
  });

  test('COVERAGE LOST when the brick template is not in the scan', () => {
    const root = join(TMP, `nobrick${seq++}`);
    mkdirSync(join(root, 'apps', 'subly', 'web'), { recursive: true });
    writeFileSync(join(root, 'apps', 'subly', 'web', '_headers'), GOOD);
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /is not in the scan/);
    assert.match(out, /one wrong line/);
  });

  test('COVERAGE LOST when sites/ exists and yields ZERO deploy roots', () => {
    // The site directory is there; its index.html is not, which is exactly how
    // a deploy root silently stops being one and the walk reports clean.
    const { code, out } = run(fixture({ sites: { nikatru: null } }));
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /produced ZERO static-site deploy roots/);
  });

  test('COVERAGE LOST when the shipped-file limb evaluates nothing', () => {
    // A web/ directory holding only _headers: the limb that catches a
    // stable-named asset frozen as immutable has nothing left to range over.
    const root = join(TMP, `noship${seq++}`);
    mkdirSync(join(root, 'apps', 'subly', 'web'), { recursive: true });
    mkdirSync(join(root, BRICK_WEB), { recursive: true });
    writeFileSync(join(root, 'apps', 'subly', 'web', '_headers'), GOOD);
    writeFileSync(join(root, BRICK_WEB, '_headers'), GOOD);
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /evaluated ZERO files/);
  });

  test('COVERAGE LOST when the caller claims a bundle the scan never found', () => {
    const { code, out } = run(fixture({ sites: { nikatru: GOOD_SITE } }), 'sites/gone');
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /claims sites\/gone/);
    assert.match(out, /promising coverage this script does not deliver/);
  });

  test('a claimed bundle that IS scanned passes, so the claim is usable', () => {
    const { code, out } = run(fixture({ sites: { nikatru: GOOD_SITE } }), 'sites/nikatru');
    assert.equal(code, 0, out);
  });
});
