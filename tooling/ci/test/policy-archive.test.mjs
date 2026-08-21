// ─────────────────────────────────────────────────────────────────────────────
// policy-archive.test.mjs — assert-policy-archive.mjs must be able to FAIL.
//
// [pipeline K-4] Every fixture below is a REAL GIT REPOSITORY, not a directory
// of files, because half this guard's limbs read `git log`. A fixture with no
// history would exercise the present-tense limbs only — and the whole point of
// this guard is the tense nothing else in the repo can see.
//
// ⚠️ The recorded mutation run is against a CLONE OF THE REAL REPOSITORY (11/11
// caught, including a `--depth 1` clone). Two of those mutations initially
// proved the WRONG limb — an uncommitted version bump reported "COVERAGE LOST:
// the walk is broken" when the walk was fine and the snapshot was missing, and a
// parked directory left beside the tree read as a malformed locale. Fixtures
// agree with whatever misunderstanding wrote them; the real tree does not.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-policy-archive.mjs');

const LIVE = join('sites', 'nikatru', 'privacy.html');
const DART_SUBLY = join('apps', 'subly', 'lib', 'state', 'analytics_providers.dart');
const DART_BRICK = join('tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib', 'state', 'providers.dart');
/** The brick's ARB directory — the app's own locale list, and the domain of the
 *  [pipeline K-14] notice-per-locale limb. */
const L10N = join('tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib', 'l10n');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-archive-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

const write = (root, relPath, body) => {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};

/** A published policy page. `extraHead` and `body` are what the tests vary. */
const policyPage = (version, { robots = 'index,follow', canonical = true, body = 'The policy text.' } = {}) =>
  `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta name="robots" content="${robots}">\n` +
  (canonical ? '<link rel="canonical" href="https://nikatru.com/privacy.html">\n' : '') +
  `</head>\n<body>\n<main>\n<h1>Privacy Policy</h1>\n` +
  `<p class="updated" data-policy-version="${version}">Last updated (version ${version})</p>\n` +
  `<p>${body}</p>\n</main>\n</body>\n</html>\n`;

/** An archived copy: the page with the three permitted differences applied. */
const snapshot = (version, opts = {}) =>
  policyPage(version, { robots: 'noindex,follow', canonical: false, ...opts });

/** The same page with a <footer> appended. The live pages take their footer from
  * tooling/sites/chrome.mjs and the dated snapshots deliberately do not, so the two
  * sides legitimately differ there and nowhere else. */
const withFooter = (html, text) => html.replace('</body>', '<footer>' + text + '</footer>\n</body>');

const g = (root, ...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });

/**
 * A fixture repo with REAL history.
 * `versions` is the ordered list of versions that have been in force; each one
 * becomes a commit that edits the page and the two Dart constants IN PLACE —
 * which is the exact edit `git log -S` cannot see.
 */
function repo({ versions = ['2026-07-26', '2026-08-01'], snapshots, workingVersion, initGit = true, locales = ['en', 'ta'] } = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(root, { recursive: true });
  if (initGit) {
    g(root, 'init', '-q');
    g(root, 'config', 'user.email', 'test@example.test');
    g(root, 'config', 'user.name', 'fixture');
    g(root, 'config', 'commit.gpgsign', 'false');
  }
  for (const v of versions) {
    write(root, LIVE, policyPage(v));
    write(root, DART_SUBLY, `const String kPrivacyPolicyVersion = '${v}';\n`);
    write(root, DART_BRICK, `const String kPrivacyPolicyVersion = '${v}';\n`);
    if (initGit) {
      g(root, 'add', '-A');
      g(root, 'commit', '-q', '-m', `policy ${v}`);
    }
  }
  // An UNCOMMITTED bump, when a test wants one.
  if (workingVersion) write(root, LIVE, policyPage(workingVersion));

  const snaps = snapshots ?? versions.map((v) => [v, 'en', snapshot(v)]);
  for (const [version, locale, html] of snaps) {
    if (html === null) continue;
    write(root, join('sites', 'nikatru', 'legal', version, locale, 'privacy.html'), html);
  }
  // [pipeline K-14] The app's OWN locale list is the domain of the notice-per-
  // locale limb, and it is read from the brick's ARB files. Every fixture needs
  // it: without one the limb is COVERAGE LOST, which is the correct answer for a
  // tree that has lost its locale declarations and the wrong one for a fixture
  // that never had any.
  for (const locale of locales) {
    write(root, join(L10N, `app_${locale}.arb`), `{ "@@locale": "${locale}" }\n`);
  }
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });

describe('assert-policy-archive', () => {
  test('a fully archived tree passes and names what it covered', () => {
    const r = run(repo());
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /2 version\(s\) snapshotted \(2026-07-26, 2026-08-01\)/);
  });

  // ── LIMB 1 · the snapshot for the live version IS the live text ───────────
  test('the live page edited without a version bump FAILS', () => {
    const root = repo();
    write(root, LIVE, policyPage('2026-08-01', { body: 'We now share data with partners.' }));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /do not carry the same text/);
    assert.match(r.stderr, /one version number/);
  });

  test('the SNAPSHOT edited instead of the page FAILS — the comparison is symmetric', () => {
    const root = repo({
      snapshots: [
        ['2026-07-26', 'en', snapshot('2026-07-26')],
        ['2026-08-01', 'en', snapshot('2026-08-01', { body: 'A friendlier retelling.' })],
      ],
    });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /do not carry the same text/);
  });

  test('head-tag differences alone do NOT fail — only text a reader saw counts', () => {
    // The archive is deliberately not byte-identical (noindex, no canonical, and
    // root-relative links). A byte comparison would forbid all three and get
    // switched off; this pins that the permitted differences stay permitted.
    const root = repo();
    write(
      root,
      join('sites', 'nikatru', 'legal', '2026-08-01', 'en', 'privacy.html'),
      snapshot('2026-08-01').replace('<head>', '<head>\n<meta name="generator" content="archive">'),
    );
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
  });

  test('a version bumped in place with NO snapshot FAILS, naming the missing path', () => {
    const root = repo({ versions: ['2026-07-26', '2026-08-01', '2026-09-15'], snapshots: [
      ['2026-07-26', 'en', snapshot('2026-07-26')],
      ['2026-08-01', 'en', snapshot('2026-08-01')],
    ] });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /2026-09-15 has NO snapshot/);
  });

  test('an UNCOMMITTED bump reports the missing snapshot, not a broken walk', () => {
    // The moment this guard is most useful is before the bump is committed. It
    // used to report COVERAGE LOST here — the right answer to the wrong question,
    // sending the fix to the wrong file. Found by mutation, not by a fixture.
    const root = repo({ workingVersion: '2026-09-15' });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /2026-09-15 has NO snapshot/);
    assert.doesNotMatch(r.stderr, /the walk cannot see the present/i);
  });

  // ── LIMB 2 · the superset relation, derived from real history ────────────
  test('a version that WAS in force and lost its snapshot FAILS', () => {
    const root = repo({ snapshots: [['2026-08-01', 'en', snapshot('2026-08-01')]] });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /version 2026-07-26 was in force at some point/);
    assert.match(r.stderr, /names a document nobody can produce/);
  });

  test('THE `-S` TRAP: an in-place value change is still detected', () => {
    // `git log -S kPrivacyPolicyVersion` counts OCCURRENCES, so editing the value
    // in place leaves the count unchanged and the commit invisible. Measured on
    // the real repository: -S returns 6 commits and misses BOTH bumps; -G returns
    // 8. Every version in this fixture arrived by exactly that kind of edit, so a
    // guard rebuilt on -S would compute "one version ever" and pass this suite's
    // first test while failing to require the 2026-07-26 snapshot at all.
    const root = repo({ versions: ['2026-05-01', '2026-07-26', '2026-08-01'], snapshots: [
      ['2026-07-26', 'en', snapshot('2026-07-26')],
      ['2026-08-01', 'en', snapshot('2026-08-01')],
    ] });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /version 2026-05-01 was in force at some point/);
  });

  // ── the schema is <version>/<locale> ─────────────────────────────────────
  test('a snapshot filed under a version its own declaration contradicts FAILS', () => {
    const root = repo({
      snapshots: [
        ['2026-07-26', 'en', snapshot('2026-07-26')],
        ['2026-08-01', 'en', snapshot('2026-07-26')],
      ],
    });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is filed under 2026-08-01/);
  });

  test('a version directory with NO locale directory FAILS — the key is never <version> alone', () => {
    const root = repo({ snapshots: [['2026-08-01', 'en', snapshot('2026-08-01')]] });
    mkdirSync(join(root, 'sites', 'nikatru', 'legal', '2026-07-26'), { recursive: true });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /holds no <locale>\/ directory/);
  });

  test('a locale segment that is not a locale tag FAILS', () => {
    const root = repo({
      snapshots: [
        ['2026-07-26', 'english', snapshot('2026-07-26')],
        ['2026-08-01', 'en', snapshot('2026-08-01')],
      ],
    });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not a locale tag/);
  });

  test('a regional locale tag like pt-BR is accepted', () => {
    const root = repo();
    write(
      root,
      join('sites', 'nikatru', 'legal', '2026-08-01', 'pt-BR', 'privacy.html'),
      snapshot('2026-08-01', { body: 'O texto da politica.' }),
    );
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
  });

  test('a locale directory with no document FAILS', () => {
    const root = repo();
    mkdirSync(join(root, 'sites', 'nikatru', 'legal', '2026-08-01', 'ta'), { recursive: true });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /contains no privacy\.html/);
  });

  // ── an archive is not a second live policy ───────────────────────────────
  test('an archived policy that is still indexable FAILS', () => {
    const root = repo({
      snapshots: [
        ['2026-07-26', 'en', snapshot('2026-07-26', { robots: 'index,follow' })],
        ['2026-08-01', 'en', snapshot('2026-08-01')],
      ],
    });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not marked noindex/);
  });

  test('an archived policy carrying a canonical FAILS', () => {
    const root = repo({
      snapshots: [
        ['2026-07-26', 'en', snapshot('2026-07-26', { canonical: true })],
        ['2026-08-01', 'en', snapshot('2026-08-01')],
      ],
    });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /still carries a <link rel="canonical">/);
  });

  // ── COVERAGE — a scan that stopped reaching must say so ──────────────────
  test('COVERAGE: a SHALLOW clone is refused, not passed', () => {
    // `actions/checkout` clones at depth 1 by default. In a depth-1 clone
    // `git log -p` shows ONE commit adding the whole file, which is
    // indistinguishable from "there has only ever been one version" — the guard
    // would pass forever while checking nothing about the past.
    const origin = repo();
    const shallow = join(TMP, `shallow${seq++}`);
    const cloned = spawnSync(
      'git',
      ['clone', '--depth', '1', '--no-local', `file:///${origin.replaceAll('\\', '/')}`, shallow],
      { encoding: 'utf8' },
    );
    assert.equal(cloned.status, 0, cloned.stderr);
    assert.ok(existsSync(join(shallow, LIVE)));
    const r = run(shallow);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /SHALLOW clone/);
    assert.match(r.stderr, /fetch-depth: 0/);
  });

  test('COVERAGE: not a git work tree at all is refused', () => {
    const r = run(repo({ initGit: false }));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a git work tree/);
  });

  test('COVERAGE: a live page with no data-policy-version is refused', () => {
    const root = repo();
    write(root, LIVE, '<html><body><main><h1>Privacy</h1></main></body></html>');
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /declares no data-policy-version/);
  });

  test('COVERAGE: a missing live page is refused, not reported clean', () => {
    const root = repo();
    rmSync(join(root, LIVE));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — cannot read sites\/nikatru\/privacy\.html/);
  });

  test('COVERAGE: an empty archive is refused — nothing to check is not "all clear"', () => {
    const root = repo({ snapshots: [] });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /COVERAGE LOST — no snapshot resolved/);
  });

  test('COVERAGE: a declaring file that yields NO history is reported, not silently skipped', () => {
    // A source that contributes zero values silently shrinks the set of versions
    // that need archiving — the "scanner that stopped scanning" shape.
    const root = repo();
    write(root, DART_SUBLY, "const String kPrivacyPolicyVersion = '2026-08-01';\n");
    // Untracked-but-present: it exists and declares a version, and history has none.
    const fresh = join(TMP, `fresh${seq++}`);
    mkdirSync(fresh, { recursive: true });
    spawnSync('git', ['-C', fresh, 'init', '-q'], { encoding: 'utf8' });
    spawnSync('git', ['-C', fresh, 'config', 'user.email', 't@e.test'], { encoding: 'utf8' });
    spawnSync('git', ['-C', fresh, 'config', 'user.name', 'f'], { encoding: 'utf8' });
    write(fresh, LIVE, policyPage('2026-08-01'));
    spawnSync('git', ['-C', fresh, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', fresh, 'commit', '-q', '-m', 'live only'], { encoding: 'utf8' });
    write(fresh, DART_SUBLY, "const String kPrivacyPolicyVersion = '2026-08-01';\n");
    write(fresh, join('sites', 'nikatru', 'legal', '2026-08-01', 'en', 'privacy.html'), snapshot('2026-08-01'));
    const r = run(fresh);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /exists and declares a policy version, and its history yielded none/);
  });
});

// ── [pipeline K-14] a notice per locale the app already supports ─────────────
// The domain is the app's OWN locale list, read from the brick's ARB files, so
// it cannot be shrunk without deleting a locale — and deleting one fails the
// brick's `supportedLocales.length >= 2` property test. Mutation-proven against
// a scratch copy of the real repository, 3/3 as intended.
describe('assert-policy-archive — the notice-per-locale relation [pipeline K-14]', () => {
  test('a locale with no notice PRINTS and does not fail the build', () => {
    // Owner-gated on purpose: an unreviewed machine translation of a statutory
    // notice is itself a legal-accuracy exposure, and failing CI on a
    // translation nobody has commissioned blocks every other lane for weeks.
    const r = run(repo());
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /NO NOTICE IN ta/);
    assert.match(r.stdout, /notice locales — 2 supported \(en, ta\)/);
  });

  test('a translated notice citing a SUPERSEDED version FAILS', () => {
    // Worse than no translation: the reader believes they have read the policy,
    // and they have read a different one.
    const root = repo({
      snapshots: [
        ['2026-07-26', 'en', snapshot('2026-07-26')],
        ['2026-08-01', 'en', snapshot('2026-08-01')],
        ['2026-08-01', 'ta', snapshot('2026-07-26')],
      ],
    });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /while the English notice in force is 2026-08-01/);
  });

  test('every locale covered flips the print to PROMOTE ME', () => {
    // The exemption cannot outlive its reason: once the translation lands, the
    // guard asks to be turned into a build failure.
    const root = repo({
      snapshots: [
        ['2026-07-26', 'en', snapshot('2026-07-26')],
        ['2026-08-01', 'en', snapshot('2026-08-01')],
        ['2026-08-01', 'ta', snapshot('2026-08-01')],
      ],
    });
    const r = run(root);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /PROMOTE ME/);
  });

  test('a tree that has lost its locale declarations is COVERAGE LOST', () => {
    const root = repo({ locales: [] });
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no locale resolved from/);
  });

  test('a THIRD locale added to the app immediately owes a notice', () => {
    // The domain grows with the app. Adding a language is what makes this limb
    // demand more, which is why it is a relationship and not a list.
    const r = run(repo({ locales: ['en', 'ta', 'hi'] }));
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /NO NOTICE IN hi, ta/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The shared footer is chrome, not policy text. Added 2026-08-21 with
// tooling/sites/chrome.mjs, which gave the live pages one footer and left the
// dated snapshots frozen -- so the two sides now differ THERE by design.
describe('assert-policy-archive · the comparison is <main>, positively', () => {
  test('a footer that differs from the snapshot does NOT report the text as edited', () => {
    // Without this the guard would report a policy edit on every footer change,
    // and the honest response to that report is a version bump -- telling users
    // the policy changed when not one word of it had.
    const root = repo({ versions: ['2026-07-26'], workingVersion: '2026-07-26' });
    const live = join(root, 'sites', 'nikatru', 'privacy.html');
    writeFileSync(live, withFooter(readFileSync(live, 'utf8'), 'Nikatru - Chennai - UDYAM-TN-02-0487004'));
    const snapPath = join(root, 'sites', 'nikatru', 'legal', '2026-07-26', 'en', 'privacy.html');
    writeFileSync(snapPath, withFooter(readFileSync(snapPath, 'utf8'), 'an older footer, frozen on its date'));
    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('🔴 …but an edit to the POLICY TEXT is still caught', () => {
    // The half that makes the reduction above safe. A reduction that removed the
    // subject would pass this guard and mean nothing.
    const root = repo({ versions: ['2026-07-26'], workingVersion: '2026-07-26' });
    const live = join(root, 'sites', 'nikatru', 'privacy.html');
    const src = withFooter(readFileSync(live, 'utf8'), 'identical footer');
    writeFileSync(live, src.replace('The policy text.', 'We may now share your data with partners.'));
    const snapPath = join(root, 'sites', 'nikatru', 'legal', '2026-07-26', 'en', 'privacy.html');
    writeFileSync(snapPath, withFooter(readFileSync(snapPath, 'utf8'), 'identical footer'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /do not carry the same text/);
  });

  test('🔴 ANY chrome outside <main> is out of scope — not just the footer', () => {
    // The rule was subtractive first (strip <footer>) and that was wrong TWICE IN
    // ONE DAY: the accessibility chrome landed hours later and a skip link
    // contributes visible text too. A positive rule cannot fall behind a region
    // that has not been invented yet, so this asserts the general property.
    const root = repo({ versions: ['2026-07-26'], workingVersion: '2026-07-26' });
    const live = join(root, 'sites', 'nikatru', 'privacy.html');
    const src = readFileSync(live, 'utf8');
    writeFileSync(
      live,
      src.replace('<body>', '<body>\n<a class="skip-link" href="#main">Skip to content</a>')
        .replace('</body>', '<footer>a footer the snapshot has never seen</footer>\n</body>'),
    );
    const r = run(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test('🔴 a live page with NO <main> is COVERAGE LOST, never a silent whole-document fallback', () => {
    // Extracting nothing and comparing it to nothing is the shape that passes
    // hardest exactly when the reduction has stopped working.
    const root = repo({ versions: ['2026-07-26'], workingVersion: '2026-07-26' });
    const live = join(root, 'sites', 'nikatru', 'privacy.html');
    const src = readFileSync(live, 'utf8');
    writeFileSync(live, src.replace('<main>', '<div>').replace('</main>', '</div>'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /COVERAGE LOST/);
  });

  test('🔴 a SNAPSHOT with no <main> is reported, not skipped', () => {
    const root = repo({ versions: ['2026-07-26'], workingVersion: '2026-07-26' });
    const snapPath = join(root, 'sites', 'nikatru', 'legal', '2026-07-26', 'en', 'privacy.html');
    const src = readFileSync(snapPath, 'utf8');
    writeFileSync(snapPath, src.replace('<main>', '<div>').replace('</main>', '</div>'));
    const r = run(root);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /has no <main> element/);
  });
});
