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
// THIRD REAL-TREE RUN, 2026-08-21 — the png decoupling on sites/rajasekarselvam.
// Two mutations, on COPIES of this repo in the scratchpad, never in the tree:
//
//   15. sites/rajasekarselvam/_headers `/*.png` returned to
//       `max-age=31536000, immutable` ⇒ guard EXIT 0 (it prints this class, it
//       does not fail it) but `node --test` 37 pass / 3 FAIL. That is the point
//       of pinning it here: the guard alone cannot go red on this defect, so
//       without these three assertions the file could drift back and CI would
//       stay green. Against the tree as it stands: 40 pass / 0 fail.
//   16. sites/rajasekarselvam/og-image.png DELETED, `_headers` left correct ⇒
//       39 pass / 1 FAIL. The anti-vacuity limb: an assertion that no stable
//       name is frozen also passes when there are no names left, and that is
//       the way this suite would quietly stop testing anything.
//
// ⚠️ THOSE THREE TESTS ARE THE ONLY ONES HERE THAT READ THE REAL TREE. The rest
// stay on fixtures on purpose; these do not, because a fixture cannot notice
// the real file drifting, and this defect's guard limb PRINTS rather than fails.
//
// 🔴 CORRECTED THE SAME DAY, 2026-08-21, in the refutation pass. THE COUNT
// "THREE" ABOVE IS WRONG IN BOTH PLACES IT APPEARS — the dated text is left
// unedited because renumbering a dated record falsifies it rather than
// repairing it; read the correction, not the count.
//   · FOUR tests were added by that pass, not three, and all FOUR read the
//     real tree: the .png inventory test (`listDir` on the real root), `🔴 the
//     REAL repository leaves NO stable name declared immutable` (`run(REPO)`),
//     and the two that `readFileSync(RJS_HEADERS)`. Measured:
//     `git show main:tooling/ci/test/web-cache-policy.test.mjs | grep -c "^\s*test("`
//     = 36 and the same grep on the worktree = 40, matching `node --test`'s
//     own `tests 40` exactly. 36 -> 40 is +4.
//     🔴 THE REVISION IN THAT RECIPE CORRECTED 2026-08-24 — it read `HEAD:`,
//     and that spelling SELF-INVALIDATED the moment this branch committed the
//     four tests. Re-taken today: `HEAD:` (e6272bc) returns 40, `main:`
//     (7211ca7) returns 36, worktree 40. So the recipe as shipped disagreed
//     with the number printed beside it — a reader re-taking it got 40 = 40
//     and no `+4` at all. A revision pointer rots exactly the way the line
//     number in pack_verifier.dart's ANCHOR note does: cite the BRANCH POINT,
//     which is fixed, not the tip, which every commit moves.
//   · "three" is the number of tests MUTATION 15 turns red — a different
//     quantity, written under the word "these". The mutation counts
//     themselves (37/3 and 39/1, of 40) do reproduce; see the re-run below.
//
// 🔴 AND ONE OF THE FOUR IS WIDER THAN "these read the real file" SUGGESTS.
// `🔴 the REAL repository leaves NO stable name declared immutable` runs the
// guard over `REPO`, the WHOLE repository, so it goes red for ANY
// assert-web-cache-policy failure on ANY scanned root — apps/subly/web, the
// brick template, sites/nikatru — not only for a rajasekarselvam drift, and it
// duplicates that guard's own CI step's signal. That is deliberate; it is just
// not what the sentence above says.
//
// RE-RUN AFTER THE REFUTATION PASS'S EDIT, 2026-08-21 — the .png inventory test
// was rewritten (its `assert.doesNotMatch(p, /-v\d+\./)` limb compared a source
// constant against a regex and no repository state could fail it; deleting it
// left the suite at 40 pass / 0 fail). The two mutations above re-run, plus two
// the rewrite makes reachable for the first time — all four on a copy in the
// scratchpad holding tooling/ci, tooling/bricks, sites/ and apps/subly/web,
// which are the only trees this guard reads (the copy reproduces the tree's own
// 40 pass / 0 fail before any mutation is applied):
//   15'. `/*.png` returned to `max-age=31536000, immutable` ⇒ 37 pass / 3 FAIL.
//   16'. og-image.png DELETED ⇒ 39 pass / 1 FAIL.
//   17'. NEW, and the case the dead line pretended to cover: icon-16.png
//        RENAMED to icon-16-v2.png ⇒ 39 pass / 1 FAIL.
//   18'. NEW: a subdirectory added under the root ⇒ 39 pass / 1 FAIL.
//   Against the tree as it stands: 40 pass / 0 fail.
//
// 🔴 AND EACH OF THE TWO NEW ASSERTIONS WAS DISABLED ON ITS OWN — the check the
// dead line failed. Rewriting the `.png` set-equality to compare the walked
// list against ITSELF turns 16' and 17' back to 40 pass / 0 fail; doing the
// same to the no-subdirectory assertion turns 18' back to 40 pass / 0 fail.
// Neither survives being switched off, so neither is a decoration. Breaking the
// `.png` predicate instead (dropping the `endsWith` filter) is red against the
// UNMUTATED tree at 39 pass / 1 FAIL.
//
// 🔴 AND SO WERE THE OTHER EIGHT ASSERTIONS THIS PASS ADDED — the two above are
// not a sample. Ten assertions arrived in the four tests below; each is listed
// here with the input that turns THAT ONE red, because an assertion no input
// reaches is a decoration that makes the file look guarded. Same scratch copy,
// one change at a time, restored between, all re-measured 2026-08-21 after the
// last edit to this file (pristine copy: EXIT 0, 40 pass / 0 fail):
//   `…ships EXACTLY the six stable-named .png files`
//     · the no-subdirectory deepEqual — 18' ⇒ 39/1; switched off, 18' ⇒ 40/0.
//     · the .png set equality — 16' ⇒ 39/1 and 17' ⇒ 39/1; switched off, both
//       ⇒ 40/0. Neither assertion covers the other's mutation.
//   `🔴 the REAL repository leaves NO stable name declared immutable`
//     · `assert.equal(code, 0, out)` — apps/subly/web/_headers DELETED ⇒ 39/1
//       with THIS test the only red one, on `1 !== 0`. That is the whole-repo
//       coupling flagged above, measured rather than argued.
//     · `doesNotMatch(/STABLE NAMES…/)` — 15' ⇒ red (one of that mutation's 3).
//   `🔴 …and reverting the real `/*.png` line to `immutable` brings the print back`
//     · `ok(real.includes(FIXED))` — 15' ⇒ red; run alone with
//       `--test-name-pattern="brings the print back"` it is EXIT 1, 0 pass /
//       1 fail, message `the /*.png rule is no longer the line this test mutates`.
//     · `assert.equal(code, 0, out)` — the `/*.css` rule deleted from the real
//       sites/rajasekarselvam/_headers ⇒ 37 pass / 3 FAIL, this test red on
//       `1 !== 0` (C1 above still holds there, so this is the assertion that fires).
//     · `match(/… — 6 file\(s\)/)` — GUARD mutation in the copy: the guard's
//       `frozen.push` condition (search it for `!/-v\d+\./.test(path)`, in the
//       `for (const { dir, kind } of bundles)` loop) → `if (false)` ⇒ 38 pass / 2 FAIL.
//     · the per-name `match` loop — GUARD mutation: `${frozen.join(', ')}` replaced
//       by a literal, the count left intact ⇒ 38 pass / 2 FAIL.
//   `the same fixture, on the file AS IT STANDS, prints nothing`
//     · `assert.equal(code, 0, out)` — the same `/*.css` deletion ⇒ red on `1 !== 0`.
//     · `doesNotMatch(/STABLE NAMES…/)` — 15' ⇒ red (the third of that three).
//   The two GUARD mutations each turn the PRE-EXISTING fixture test `a stable-named
//   site asset declared immutable is PRINTED, never failed` red as well — that is
//   the second failure in both 38/2 lines, not a second real-tree test.
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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
// The ONE shared directory-listing primitive — the real-tree .png inventory
// below is walked with it rather than with a `readdirSync` of its own.
import { listDir } from '../tree-walk.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-web-cache-policy.mjs');
const REPO = resolve(CI_DIR, '..', '..');
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

  // ── the png decoupling, pinned against the REAL tree ──────────────────────
  // 🔴 2026-08-21. Both deploy roots declared `/*.png` `immutable` over icon
  // names that carry no version. sites/nikatru fixed its half earlier the same
  // day; sites/rajasekarselvam's half was fixed in this pass, and on THAT root
  // the defect was LIVE rather than hypothetical — commit a0e0f54 (2026-07-23)
  // replaced the bytes of five of the six .png files under their existing
  // names, so a re-cut brand mark shipped into a year-long freeze.
  //
  // Everything else in this suite runs on fixtures, deliberately. This one pair
  // does not, because a fixture cannot notice the real file drifting back — and
  // the guard PRINTS this class rather than failing it, so nothing else in CI
  // would go red if it did.
  const RJS_ROOT = join(REPO, 'sites', 'rajasekarselvam');
  const RJS_HEADERS = join(RJS_ROOT, '_headers');
  // The whole .png inventory of that root as measured 2026-08-21. It is WRITTEN
  // OUT and also READ OFF DISK, and both halves carry weight: the literal is
  // what the two fixture tests below hand the guard, so deleting an icon cannot
  // make THEM pass by leaving nothing to be wrong about; the `listDir` of the
  // real root is what gives the comparison an input that can turn it red.
  const RJS_PNGS = [
    'apple-touch-icon.png', 'icon-16.png', 'icon-32.png',
    'icon-192.png', 'icon-512.png', 'og-image.png',
  ];
  // The shipped-file set the TWO fixture tests below both hand the guard. ONE
  // binding, read twice, so "the same six files" is true BY CONSTRUCTION — the
  // pair only isolates the Cache-Control line while both sides really are the
  // same tree, and two copies of one expression can drift apart silently.
  //
  // 🔴 HOISTED 2026-08-24, AND THE REASON IS A MEASUREMENT. As two separate
  // `Object.fromEntries(RJS_PNGS.map(...))` expressions, the copy in
  // `…prints nothing` was a GREEN row: measured on a scratch copy of this repo,
  // replacing THAT test's `siteFiles` with `{}` left the unmutated tree at
  // EXIT 0, 40 pass / 0 fail — because that test asserts an ABSENCE, and no
  // .png in the fixture can change whether nothing is printed. The copy in
  // `…brings the print back` is load-bearing on the same mutation: `{}` there
  // is 39 pass / 1 fail. Rather than leave an unpinnable duplicate sitting
  // beside the pinned one, the duplicate is gone and the single survivor is
  // pinned by that test.
  // ⚠️ The `'png'` here is a file BODY, not a kind or an extension — see
  // `fixture()`'s `siteFiles` loop, which writes the value as the file's
  // contents. The guard reads PATHS and header rules and never opens these
  // files, so the string is arbitrary: measured 2026-08-24, changing it to
  // `'jpg'` leaves the unmutated tree at EXIT 0, 40 pass / 0 fail. It is
  // listed here only so the next sweep does not re-enumerate it as a condition.
  const RJS_SITE_FILES = Object.fromEntries(RJS_PNGS.map((p) => [p, 'png']));

  test('the real sites/rajasekarselvam ships EXACTLY the six stable-named .png files', () => {
    // Anti-vacuity for both fixture tests below: they are about these six
    // files, and an assertion about files that are gone is not an assertion.
    //
    // 🔴 DERIVED FROM THE TREE, 2026-08-21 — and it did not start that way.
    // This test was an `existsSync` loop plus
    //   assert.doesNotMatch(p, /-v\d+\./, …)
    // where `p` iterated RJS_PNGS: a source constant checked against a regex,
    // which NO state of the repository could turn red. Measured on a copy of
    // this repo in the scratchpad — deleting that one line left `node --test
    // tooling/ci/test/web-cache-policy.test.mjs` at EXIT 0, tests 40 / pass 40
    // / fail 0. It was a decoration that made the file look guarded, which
    // this corpus rates worse than no assertion at all.
    //
    // Set equality against the LISTED inventory is the honest form of what it
    // was trying to say, and it strictly contains the old `existsSync` loop: a
    // delete, a rename to `icon-16-v2.png`, and a SEVENTH .png arriving under
    // the same `/*.png` rule are each red here now.
    const entries = listDir(RJS_ROOT, { withFileTypes: true });

    // 🔴 THE DOMAIN, ASSERTED RATHER THAN ASSUMED. The listing below is FLAT,
    // and it is only the whole inventory while the root is flat — measured
    // 2026-08-21: sixteen entries, none of them a directory. The guard's own
    // shipped-file walk (assert-web-cache-policy.mjs, the `const walk =`
    // inside `shippedPaths`) RECURSES, and `/*.png` matches at any depth, so a
    // subdirectory is the one way a .png could exist here and not be counted.
    // A recursive walk was written here instead and REMOVED: with no
    // subdirectory in the tree its descent branch could not be reached by any
    // mutation of the current repository, which is the same dead-code-that-
    // looks-like-a-check defect this test was rewritten to remove. Asserting
    // the flatness is reachable — `mkdir sites/rajasekarselvam/img` is red.
    // ⚠️ GREEN AND KEPT, DISCLOSED RATHER THAN PINNED — the
    // `.map((e) => e.name)` on the deepEqual below is verdict-NEUTRAL: no input
    // distinguishes it. It is ONE OF TWO such expressions in this test, not the
    // only one — the other is the `[...]` spread on the expected side of the
    // SECOND deepEqual, disclosed at its own site below.
    // 🔴 CORRECTED 2026-08-24: this paragraph read "is the ONE expression in
    // this test that no input distinguishes", which was false about the very
    // test it scoped itself to. Repaired in place rather than annotated, because
    // a false absolute left standing under a note about it is the defect twice.
    // Re-measured 2026-08-24 on a scratch mirror holding tooling/ci,
    // tooling/bricks, sites/ and apps/subly/web — the only trees this guard
    // reads, and the mirror reproduces the tree's own EXIT 0, 40 pass / 0 fail
    // before any mutation. Replacing it with `.map(() => 'X')` leaves the
    // unmutated tree at EXIT 0, 40 pass / 0 fail, AND still goes red under
    // `mkdir sites/rajasekarselvam/img` at 39 pass / 1 fail — the same verdict
    // in both directions, because `deepEqual` against `[]` fails for ANY
    // non-empty array whatever the projection. So it is verdict-NEUTRAL, not a
    // check: its whole effect is to make the failure name the directory.
    // NEITHER of the two atoms beside it is neutral, and both are pinned by that
    // same `mkdir`, which is red at 39 pass / 1 fail on its own:
    //   · the `.filter((e) => e.isDirectory())` — replace the predicate with
    //     `() => false` and `mkdir` goes green at 40 pass / 0 fail.
    //   · the `[]` EXPECTED side — replace it with the walked expression so both
    //     sides are one and `mkdir` goes green at 40 pass / 0 fail.
    assert.deepEqual(
      entries.filter((e) => e.isDirectory()).map((e) => e.name),
      [],
      'sites/rajasekarselvam has grown a subdirectory. The `/*.png` rule reaches into it and the flat '
        + 'listing below does not — walk the root recursively here, or this test stops seeing the tree',
    );
    // 🔴 DO NOT "DERIVE RJS_PNGS FROM THE TREE", 2026-08-24. It reads like the
    // fix for a hardcoded literal and it is the one change that would make this
    // assertion unfalsifiable. The literal is the EXPECTED side; the `listDir`
    // walk is the ACTUAL side, and having the two come from different places is
    // exactly what gives the comparison an input that can fail. Measured on a
    // scratch copy, with the literal below replaced by the same walked
    // expression so both sides are one: deleting og-image.png, renaming
    // icon-16.png to icon-16-v2.png, and adding a seventh .png each fall from
    // 39 pass / 1 fail back to EXIT 0, 40 pass / 0 fail. All three are red
    // today against the literal. The `.map` and `.filter` on this one ARE both
    // load-bearing, unlike the pair above: breaking either leaves the tree as
    // it stands at 39 pass / 1 fail.
    //
    // AND SO IS THE DOT INSIDE `endsWith('.png')`, which is a THIRD row here and
    // not part of the `.filter` one — recorded 2026-08-24 because an escaped dot
    // inside an otherwise fully-enumerated expression is precisely the atom the
    // last sweep of this corpus missed. Its input is not a .png at all: drop a
    // file named `sprite-png` (ends in `png`, no dot) into the root and the tree
    // is correctly still EXIT 0, 40 pass / 0 fail, while `endsWith('png')` pulls
    // it into the walked set and is EXIT 1, 39 pass / 1 fail. The dot is what
    // scopes this inventory to the same names the `/*.png` rule reaches, so
    // widening it does not loosen the check, it invents a failure.
    //
    // 🔴 THE `.sort()` ON THE ACTUAL SIDE IS PINNED, NOT A GREEN WIDENING —
    // CORRECTED 2026-08-24, and the correction is a measurement. This paragraph
    // disclosed it as green "because readdir already hands back these six names
    // in lexicographic order". That reason is an NTFS accident, not a property
    // of the code: `listDir` sorts NOTHING — grep `export function listDir` in
    // tooling/ci/tree-walk.mjs (ONE hit; `const entries = readdirSync` is TWO,
    // so do not anchor on that) and its body is a filtered `readdirSync`, whose
    // order is defined by the filesystem. On the ext4 CI runs on that is hash
    // order, not name order. So the input that reddens this `.sort()` is a
    // listDir ORDER mutation, not a tree-CONTENT one, which is why rounds of
    // content mutations all found it green. Measured on the scratch mirror with
    // `listDir` returning `kept.reverse()`: the file AS SHIPPED is EXIT 0,
    // 40 pass / 0 fail, and dropping this `.sort()` is EXIT 1, 39 pass / 1 fail.
    //
    // ⚠️ GREEN AND KEPT, DISCLOSED RATHER THAN PINNED — the `[...]` SPREAD on
    // the expected side below, the second of this test's two verdict-neutral
    // expressions (the first is the `.map` above). It is a row no earlier sweep
    // listed. Measured on the same mirror: drop the spread, so the expected side
    // is `RJS_PNGS.sort()`, and the unmutated tree stays EXIT 0, 40 pass /
    // 0 fail — and it is verdict-IDENTICAL under every input that reaches this
    // test, each the same number that input gives on its own: og-image.png
    // deleted 39/1, icon-16.png renamed to icon-16-v2.png 39/1, a seventh .png
    // added 39/1, a subdirectory added 39/1, `listDir` reversed 40/0. It cannot
    // change a verdict because the multiset compared is identical either way.
    // It is KEPT for a reason that is NOT this comparison: without it `.sort()`
    // reorders a module-scope binding IN PLACE, and that binding is read again
    // by the `for (const p of RJS_PNGS)` loop two tests below.
    //
    // The `.sort()` on the EXPECTED side is a THIRD, separate row and is pinned
    // by the tree as it stands: RJS_PNGS is written in icon-SIZE order, where
    // `icon-192` precedes `icon-32`, so dropping THAT one is EXIT 1,
    // 39 pass / 1 fail against the unmutated tree.
    assert.deepEqual(
      entries.filter((e) => e.name.endsWith('.png')).map((e) => e.name).sort(),
      [...RJS_PNGS].sort(),
      'the .png inventory of sites/rajasekarselvam has moved — RJS_PNGS, and the two fixture tests '
        + 'below that feed it to the guard, no longer describe the tree',
    );
  });

  test('🔴 the REAL repository leaves NO stable name declared immutable', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /STABLE NAMES DECLARED IMMUTABLE/);
  });

  test('🔴 …and reverting the real `/*.png` line to `immutable` brings the print back', () => {
    // The negative half, kept in the suite instead of run once by hand: it
    // takes the file as it actually is, applies the exact one-line reversion,
    // and requires the guard to name every one of the six again.
    const real = readFileSync(RJS_HEADERS, 'utf8');
    const FIXED = '/*.png\n  Cache-Control: public, max-age=0, must-revalidate';
    // This `ok` is the whole anti-vacuity check, and it is the assertion that
    // actually fires if the rule drifts. A follow-up `notEqual(broken, real)`
    // was written here and DELETED: once `includes` holds, `replace` cannot
    // leave the string unchanged, so it was an assertion with no input that
    // could fail — which inflates coverage rather than adding any.
    assert.ok(real.includes(FIXED), 'the /*.png rule is no longer the line this test mutates');
    const broken = real.replace(FIXED, '/*.png\n  Cache-Control: public, max-age=31536000, immutable');

    const { code, out } = run(fixture({ sites: { rajasekarselvam: broken }, siteFiles: RJS_SITE_FILES }));
    // ⚠️ SCOPE, MEASURED 2026-08-24 — NO REPOSITORY STATE REDDENS THE NEXT
    // LINE. It is not verdict-neutral the way the rows disclosed above are
    // (the directory-side `.map`, the `[...]` spread, the `'utf8'` below):
    // disabling THIS one can change a verdict, but only under a mutation of
    // the guard itself, never under any state of the tree.
    // The guard's `if (problems.length) {` block ends in `process.exit(1)` and
    // runs BEFORE its `if (prints.length) {` block — grep both in
    // assert-web-cache-policy.mjs — so a matched STABLE NAMES print is already
    // proof the guard exited 0, and the `assert.match` below already implies
    // this `assert.equal`. Measured: delete the real `/*.css` rule and the suite
    // is EXIT 1, 37 pass / 3 fail EITHER WAY, with this line and with it
    // disabled, because the print vanishes together with the exit code.
    // It is KEPT as the canary for exactly that ordering, and it IS reachable by
    // a SUBJECT mutation: emit the prints above that `process.exit(1)` and then
    // delete the `/*.css` rule, and the pair separates — 37 pass / 3 fail
    // shipped, 38 pass / 2 fail with this line disabled.
    // The sibling `assert.equal(code, 0, out)` assertions in the two
    // `doesNotMatch` tests are NOT in this class and need no such note:
    // deleting the `/*.css` rule
    // takes each of them from 37/3 to 38/2 on its own.
    assert.equal(code, 0, out); // still a print, never a failure
    // 🔴 THE ATOMS OF THE NEXT TWO LINES, ENUMERATED 2026-08-24, because a
    // regex and a loop bound are the two shapes this corpus has re-merged into
    // one row before. Each was mutated alone on a scratch mirror; the number
    // beside it is what the SHIPPED file scores under that input, against the
    // 40 pass / 0 fail the mirror gives unmutated.
    //   · the `6` — PINNED twice: guard printing `frozen.length + 1` is
    //     39 pass / 1 fail, and `\d+` in its place is 40 pass / 0 fail; and a
    //     consistent shrink (og-image.png dropped from BOTH the tree and
    //     RJS_PNGS) is 39/1 shipped, 40/0 with `\d+`.
    //   · `sites\/rajasekarselvam` — PINNED: guard naming another root is
    //     38 pass / 2 fail, and `\S+` in its place is 39 pass / 1 fail.
    //   · the escaped `\(s\)` — PINNED against the unmutated tree: unescape
    //     them to a capture group and it is 39 pass / 1 fail.
    //   · THE LOOP BOUND `of RJS_PNGS` — PINNED, and it needs a guard mutation
    //     that keeps the print alive while corrupting ONE name, because any
    //     mutation that EMPTIES `frozen` kills the line above and reddens this
    //     test before the loop runs. The one that works is
    //     `${frozen.join(', ')}` → `${frozen[0]}`: 39 pass / 1 fail shipped,
    //     and 40 pass / 0 fail with the bound narrowed to `.slice(0, 1)` OR
    //     emptied to `[]`. Both narrowings are therefore load-bearing.
    //   · the leading `/` before `${p}` — PINNED: guard printing
    //     `path.slice(1)` is 39/1 shipped, 40/0 without the slash.
    //   · the `\\(via ` open paren — PINNED against the unmutated tree at
    //     39 pass / 1 fail (unescaped it opens a group that never closes).
    //   · the `"` quotes around the rule — PINNED twice: 39/1 against the
    //     unmutated tree, and guard printing `(via ${p})` unquoted is 39/1
    //     shipped against 40/0 with the quotes dropped here.
    //   · the `\\*` escape — PINNED against the unmutated tree at 39/1.
    //   · the `\\.` escape in `p.replace('.', '\\.')` — PINNED, and NOT by any
    //     tree state: guard printing the path with its dots replaced is
    //     38 pass / 2 fail shipped and 39 pass / 1 fail with the escape
    //     dropped. This is the atom an earlier sweep of this corpus missed.
    //   · the `\\.` escape in `/\\*\\.png` — PINNED the same way: guard
    //     printing `rule.pattern` with its dots replaced is 39/1 shipped, 40/0
    //     with that escape dropped.
    //   · THE CLOSING `\\)` — THE ELEVENTH ATOM OF THIS LINE, and the only one
    //     of the eleven that is DECLARED rather than pinned. Added 2026-08-24
    //     because it was missing from the ten above while its mirror image,
    //     the opening `\\(`, was listed. Dropping it only WIDENS the match, and
    //     NO STATE OF ANY TREE separates the two spellings: the `)` is a
    //     CONSTANT in the guard's own template — grep `frozen.push` in
    //     assert-web-cache-policy.mjs, it pushes `… (via "${rule.pattern}")` —
    //     sitting immediately after the closing quote, so no `_headers` rule
    //     and no shipped file can put a different byte there, and the pattern
    //     printed for these six is a literal of THIS file (see `broken`
    //     above), not tree-derived. It IS separable by a mutation of that
    //     template, and that is this row: drop the guard's closing paren and
    //     this file is EXIT 1, 39 pass / 1 fail as shipped, against EXIT 0,
    //     40 pass / 0 fail with the `\\)` dropped here — both measured
    //     2026-08-24 on a scratch mirror that gives 40/0 unmutated.
    //     DECLARED, NOT PINNED, deliberately: killing a matcher's narrowing
    //     needs a SECOND narrowing (a right anchor) whose own removal is green
    //     in exactly the same way, so a "pin" here buys one notch and hands
    //     the next sweep the same finding one character finer.
    // ⚠️ GREEN AND KEPT, DISCLOSED RATHER THAN PINNED — `replace` here takes a
    // STRING, so it rewrites only the FIRST `.`. Measured: `replaceAll` in its
    // place leaves the unmutated tree at EXIT 0, 40 pass / 0 fail. It is
    // verdict-neutral BY CONSTRUCTION, not by luck: each of the six RJS_PNGS
    // entries contains exactly ONE `.`, so first-only and all are the same
    // string. A two-dot name could separate them — and could not arrive
    // unnoticed, because the tree and RJS_PNGS have to agree or the inventory
    // test two above is red first.
    assert.match(out, /STABLE NAMES DECLARED IMMUTABLE on sites\/rajasekarselvam — 6 file\(s\)/);
    for (const p of RJS_PNGS) assert.match(out, new RegExp(`/${p.replace('.', '\\.')} \\(via "/\\*\\.png"\\)`));
  });

  test('the same fixture, on the file AS IT STANDS, prints nothing', () => {
    // The other half of the discriminator: same tree, same six files, only the
    // one Cache-Control value differs. If this went green with the reverted
    // line too, the test above would be measuring the fixture, not the fix.
    // ⚠️ GREEN AND KEPT, DISCLOSED RATHER THAN PINNED, 2026-08-24 — the
    // `'utf8'` on THIS read, a row no earlier sweep listed. `real` is only
    // handed to `fixture()` here, and `writeFileSync` writes a Buffer and a
    // string to identical bytes, so no input distinguishes it: measured on the
    // scratch mirror, dropping it leaves the unmutated tree at EXIT 0,
    // 40 pass / 0 fail and is verdict-identical under the guard mutation that
    // does redden this test — drop the `immutable` test from the freeze
    // condition and it is 37 pass / 3 fail either way. KEPT so both halves of
    // this pair read the file the same way. The `'utf8'` on the sibling read
    // above is NOT in this class: `real.includes(FIXED)` needs a string.
    // `siteFiles: RJS_SITE_FILES` two lines down IS pinned, and its input is
    // also a guard mutation rather than a tree change: make the freeze
    // condition `/\.png$/.test(path)` instead of the `immutable` test, so the
    // guard names every .png whatever its Cache-Control, and it is 38 pass /
    // 2 fail shipped against 39 pass / 1 fail with this test's `siteFiles`
    // emptied to `{}`. (That is this test's REFERENCE to the binding. The
    // binding itself is pinned by the test above, where emptying it to `{}` is
    // 39 pass / 1 fail.)
    // ⚠️ AND THE SITE KEY `rajasekarselvam:` ON THE LINE BELOW — GREEN AND
    // KEPT, DECLARED 2026-08-24. Its sibling in the test above IS load-bearing
    // and IS rowed (that test matches `on sites/rajasekarselvam`); this one is
    // not, and the asymmetry is the reason it needs saying rather than being
    // left to look like an oversight. Nothing here reads the printed root
    // name — the two assertions are an exit code and an ABSENCE — and
    // `fixture()` gives a site key no meaning beyond the directory it makes.
    // So no input separates the spellings, measured all three ways with
    // `zzother:` in its place: EXIT 0, 40 pass / 0 fail on the unmutated tree;
    // 37 pass / 3 fail under the TREE state that reddens this test (the real
    // `/*.png` rule returned to `immutable`); 38 pass / 2 fail under the GUARD
    // mutation that reddens it (freeze condition `/\.png$/.test(path)`) —
    // identical to the shipped key on all three. KEPT so both halves of the
    // pair name the same site.
    const real = readFileSync(RJS_HEADERS, 'utf8');
    const { code, out } = run(fixture({ sites: { rajasekarselvam: real }, siteFiles: RJS_SITE_FILES }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /STABLE NAMES DECLARED IMMUTABLE/);
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

// ─────────────────────────────────────────────────────────────────────────────
// The Pages-Function limb. `_headers` structurally cannot reach a Function, so
// nothing above this line has ever had an opinion about the one route on the
// origin that accepts a POST body.
describe('assert-web-cache-policy · Pages Function security headers', () => {
  const FN_HEADERS =
    '      "x-content-type-options": "nosniff",\n' +
    '      "x-frame-options": "DENY",\n' +
    '      "referrer-policy": "strict-origin-when-cross-origin",\n' +
    '      "strict-transport-security": "max-age=63072000; includeSubDomains; preload",\n' +
    '      "content-security-policy": "default-src \'none\'; frame-ancestors \'none\'",\n';

  const fn = (headers) =>
    'export async function onRequestPost() {\n' +
    '  return new Response(JSON.stringify({ ok: true }), {\n' +
    '    headers: {\n' +
    '      "content-type": "application/json; charset=utf-8",\n' +
    `${headers}` +
    '    },\n' +
    '  });\n' +
    '}\n';

  const withFn = (body) =>
    fixture({ sites: { nikatru: GOOD_SITE }, siteFiles: { 'functions/api/subscribe.js': body } });

  test('passes when the one Response carries the whole security set', () => {
    const { code, out } = run(withFn(fn(FN_HEADERS)));
    assert.equal(code, 0, out);
    assert.match(out, /Pages Functions — 1 file\(s\) building a Response/);
  });

  test('FAILS when a header is missing, and NAMES the missing one', () => {
    const { code, out } = run(withFn(fn(FN_HEADERS.replace(/ *"x-content-type-options".*\n/, ''))));
    assert.equal(code, 1);
    assert.match(out, /builds a Response without x-content-type-options/);
  });

  test('FAILS on a SECOND construction site — the way this regresses', () => {
    // A bare early-return added next to a correct helper. The helper still reads
    // right; the new Response ships with nothing.
    const { code, out } = run(withFn(`${fn(FN_HEADERS)}\nexport const oops = () => new Response("bare");\n`));
    assert.equal(code, 1);
    assert.match(out, /constructs a Response 2 times/);
  });

  test('🔴 a COMMENT naming `new Response(...)` is not a construction site', () => {
    // The first version of this limb counted the warning comment inside
    // subscribe.js — the one telling the next reader not to add a second
    // Response — and failed the build on its own prose.
    const commented = `// a second new Response(...) added later is the way this regresses\n${fn(FN_HEADERS)}` +
      '/* block comment mentioning new Response( too */\n';
    const { code, out } = run(withFn(commented));
    assert.equal(code, 0, out);
  });

  test('a site with NO functions/ directory is not asked to invent one', () => {
    const { code, out } = run(fixture({ sites: { nikatru: GOOD_SITE } }));
    assert.equal(code, 0, out);
    assert.match(out, /Pages Functions — 0 file\(s\)/);
  });

  test('🔴 COVERAGE LOST when a functions/ directory exists and the limb reads nothing', () => {
    // The floor. A functions/ directory the walk enters and returns from empty
    // is the shape that reports "clean" about the endpoint _headers cannot cover.
    const { code, out } = run(
      fixture({ sites: { nikatru: GOOD_SITE }, siteFiles: { 'functions/api/notes.md': 'not code\n' } }),
    );
    assert.equal(code, 1);
    assert.match(out, /director\(ies\) exist and the Pages-Function limb evaluated ZERO files/);
  });
});
