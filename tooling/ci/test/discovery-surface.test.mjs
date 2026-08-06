// ─────────────────────────────────────────────────────────────────────────────
// discovery-surface.test.mjs — assert-discovery-surface.mjs must be able to FAIL,
// and tooling/sites/generate-discovery.mjs must be able to produce the input that
// makes it fail.
//
// [pipeline 12]W-1 / W-2 / W-9.
//
// 🔴 THE REAL-TREE MUTATIONS CAME FIRST, and they are what these fixtures encode.
// A fixture you wrote encodes the same misunderstanding as the guard you wrote —
// that is not a maxim in this repository, it is the recorded 2026-07-26 failure
// where assert-seams-wired.mjs passed all six of its own fixtures while matching
// its subject's own declaration. So every case below was first run against a
// scratch COPY of the real tree, restored from memory and byte-compared
// afterwards (never `git checkout --`, which hides whether the restore was
// faithful). Recorded results, in the order they were run:
//
//   M1  sites/nikatru/apps/subly.html: <h1>Subly</h1> -> <h1>Subly Pro</h1>
//         => FAIL "sites/nikatru/apps/subly.html DRIFTED"
//   M2  sites/nikatru/apps/subly.html deleted
//         => FAIL "sites/nikatru/apps/subly.html is MISSING"
//   M3  the <url> block for https://nikatru.com/apps/subly.html deleted from
//       sites/nikatru/sitemap.xml
//         => FAIL "sites/nikatru/sitemap.xml DRIFTED"  (a DISTINCT message from
//            M1, which is what the plan required of these two mutations)
//   M4  sites/nikatru/apps/_template.html: `[APP NAME]` -> `APP NAME`
//         => COVERAGE LOST, naming the lost canary token
//   M5  the generator's JSON-LD gains `aggregateRating`
//         => FAIL "carries `aggregateRating`/`review`"
//   M6  apps.json tagline gains a bracketed slot
//         => FAIL "carries 1 unfilled slot(s)"
//   M7  a second .html hand-added under sites/nikatru/apps/
//         => FAIL "is a page this generator would never write"
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { planDiscovery, renderSitemap, rewriteLlms, urlForPage } from '../../sites/generate-discovery.mjs';
import { today, lastmodFor, isGitRepo } from '../../sites/lastmod.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-discovery-surface.mjs');
const GENERATOR = join(REPO, 'tooling', 'sites', 'generate-discovery.mjs');

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-discovery-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const SITEMAP_BASE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://nikatru.com/</loc>
    <lastmod>2026-08-01</lastmod>
  </url>
</urlset>
`;

/** The one non-generated file in the generated directory, reduced to the parts
 *  this guard classifies: its noindex and its canary tokens. */
const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta name="robots" content="noindex, nofollow">
<title>[APP NAME]</title>
<link rel="canonical" href="https://nikatru.com/apps/[SLUG].html">
<script type="application/ld+json">
{ "price": "[0 or price]" }
</script>
</head>
<body>
<a href="[WEB APP URL]">Open</a>
<a href="[SNAP OR dl.nikatru.com APPIMAGE URL]">Linux</a>
</body>
</html>
`;

/** A minimal deploy tree: registry + the nikatru root the generator writes into. */
function tree(entries, opts = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'sites', '_shared', '_data'), { recursive: true });
  mkdirSync(join(root, 'sites', 'nikatru', 'apps'), { recursive: true });
  writeFileSync(
    join(root, 'sites', '_shared', '_data', 'apps.json'),
    typeof entries === 'string' ? entries : JSON.stringify(entries, null, 2),
  );
  writeFileSync(join(root, 'sites', 'nikatru', 'sitemap.xml'), opts.sitemap ?? SITEMAP_BASE);
  writeFileSync(join(root, 'sites', 'nikatru', 'index.html'), '<html><body>home</body></html>\n');
  if (opts.template !== false) writeFileSync(join(root, 'sites', 'nikatru', 'apps', '_template.html'), opts.template ?? TEMPLATE);
  return root;
}

/** Run the real generator over a fixture root, exactly as the owner would. */
function generate(root) {
  const r = spawnSync(process.execPath, [GENERATOR, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function guard(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const SUBLY = {
  slug: 'subly',
  name: 'Subly',
  tagline: 'Track every subscription in one place',
  url: 'https://subly.nikatru.com',
  platforms: ['web'],
  status: 'live',
};

const p = (root, ...rel) => join(root, 'sites', 'nikatru', ...rel);

describe('the generator', () => {
  test('a generated tree passes the guard, and is idempotent', () => {
    const root = tree([SUBLY]);
    assert.equal(generate(root).code, 0);
    const first = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    // A second run must change nothing — otherwise CI's regenerate-and-diff can
    // never be green, and the drift limb would fire on every push.
    const second = generate(root);
    assert.equal(second.code, 0);
    assert.match(second.out, /0 changed/);
    assert.equal(readFileSync(p(root, 'apps', 'subly.html'), 'utf8'), first);
    assert.equal(guard(root).code, 0);
  });

  test('a live entry is indexable, carries a canonical, and joins the sitemap', () => {
    const root = tree([SUBLY]);
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.doesNotMatch(html, /noindex/);
    assert.match(html, /<link rel="canonical" href="https:\/\/nikatru\.com\/apps\/subly\.html">/);
    const sitemap = readFileSync(p(root, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/nikatru\.com\/apps\/subly\.html<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/nikatru\.com\/apps\/<\/loc>/);
    // The homepage <loc> that was already there survives untouched.
    assert.match(sitemap, /<loc>https:\/\/nikatru\.com\/<\/loc>/);
  });

  test('STATUS CHANGES THE PAGE, NEVER WHETHER THE PAGE EXISTS — a preview entry is noindex, unlisted and off the hub', () => {
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo', status: 'preview' }]);
    generate(root);
    const html = readFileSync(p(root, 'apps', 'lingo.html'), 'utf8');
    assert.match(html, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(html, /rel="canonical"/);
    const sitemap = readFileSync(p(root, 'sitemap.xml'), 'utf8');
    assert.doesNotMatch(sitemap, /apps\/lingo\.html/);
    // ...and the hub advertises only what the registry calls live. A card for a
    // non-live app is a promise made to a stranger.
    const hub = readFileSync(p(root, 'apps', 'index.html'), 'utf8');
    assert.doesNotMatch(hub, /Lingo/);
    assert.match(hub, /Subly/);
    assert.equal(guard(root).code, 0);
  });

  test('operatingSystem comes from the entry, never from the hardcoded six', () => {
    const root = tree([{ ...SUBLY, platforms: ['web'] }]);
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.match(html, /"operatingSystem": "Web"/);
    assert.doesNotMatch(html, /iOS, Android, Windows, macOS, Linux, Web/);
  });

  test('no price, no offers block, no aggregateRating, no store button it cannot back', () => {
    const root = tree([SUBLY]);
    generate(root);
    const html = readFileSync(p(root, 'apps', 'subly.html'), 'utf8');
    assert.doesNotMatch(html, /offers/);
    assert.doesNotMatch(html, /aggregateRating/);
    assert.doesNotMatch(html, /priceCurrency/);
    assert.doesNotMatch(html, /apps\.apple\.com|play\.google\.com|apps\.microsoft\.com|flathub/i);
  });

  test('a slug that is not a safe filename or URL segment is refused, not written', () => {
    const root = tree([{ ...SUBLY, slug: '../evil' }]);
    const r = generate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /not usable as a filename or a URL/);
    assert.equal(existsSync(join(root, 'sites', 'evil.html')), false);
  });

  test('a duplicate slug is refused — two entries would write one landing', () => {
    const root = tree([SUBLY, { ...SUBLY, name: 'Other' }]);
    assert.match(generate(root).out, /appears more than once/);
  });

  test('an entry with no tagline is refused — the meta description comes from it', () => {
    const root = tree([{ ...SUBLY, tagline: '' }]);
    assert.match(generate(root).out, /has no tagline/);
  });

  test('a platform id the generator has no name for fails rather than publishing the raw token', () => {
    const root = tree([{ ...SUBLY, platforms: ['web', 'fuchsia'] }]);
    assert.match(generate(root).out, /no name for/);
  });

  test('renderSitemap emits <loc> + <lastmod> and nothing else — [12]W-3a', () => {
    const out = renderSitemap([
      { loc: 'https://nikatru.com/', lastmod: '2026-08-04' },
      { loc: 'https://nikatru.com/apps/', lastmod: '2026-08-06' },
    ]);
    assert.match(out, /<loc>https:\/\/nikatru\.com\/<\/loc>\n {4}<lastmod>2026-08-04<\/lastmod>/);
    // Google ignores both entirely, and a field nothing can check is a field
    // that can only ever be wrong. The guard fails a sitemap carrying either.
    assert.doesNotMatch(out, /changefreq|priority/);
  });

  test('urlForPage is the one canonical form — index.html is the bare directory', () => {
    assert.equal(urlForPage('index.html'), 'https://nikatru.com/');
    assert.equal(urlForPage('apps/index.html'), 'https://nikatru.com/apps/');
    assert.equal(urlForPage('privacy.html'), 'https://nikatru.com/privacy.html');
  });

  test('🔴 the sitemap is the WHOLE page set now, not just the /apps/ blocks', () => {
    // The half that used to be carried through byte-for-byte was hand-maintained
    // inside a requirement whose first sentence is "never hand-maintained", and
    // it had drifted on the real tree: six URLs claiming 2026-08-01/03 while
    // every page last changed 2026-08-04.
    const root = tree([SUBLY]);
    writeFileSync(p(root, 'privacy.html'), '<html><head><link rel="canonical" href="x"></head><body>p</body></html>\n');
    generate(root);
    const sitemap = readFileSync(p(root, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/nikatru\.com\/privacy\.html<\/loc>/);
    // …and a noindex page is excluded BY ITS OWN DECLARATION, never by name.
    // `_template.html` is the live proof: it is served and must stay unlisted.
    assert.doesNotMatch(sitemap, /_template/);
  });

  test('🔴 EVERY <url> carries a <lastmod> — an optional one is one a hand edit escapes by deleting', () => {
    const root = tree([SUBLY]);
    generate(root);
    const sitemap = readFileSync(p(root, 'sitemap.xml'), 'utf8');
    const locs = [...sitemap.matchAll(/<loc>/g)].length;
    const mods = [...sitemap.matchAll(/<lastmod>/g)].length;
    assert.ok(locs > 0, 'the fixture must produce at least one URL or this asserts nothing');
    assert.equal(mods, locs);
    // A fixture tree is not a git work tree, so every date degrades to today on
    // BOTH sides — writer and checker evaluate the same function. That is what
    // keeps a synthetic tree self-consistent rather than accidentally green.
    assert.match(sitemap, new RegExp(`<lastmod>${today()}</lastmod>`));
  });

  test('rewriteLlms replaces the ## Apps section and leaves the owner prose alone', () => {
    const before = '# N\n\n## About\n- Studio: N\n\n## Apps\n- Old — stale — https://old.example (web)\n\n## Key pages\n- Home: /\n';
    const out = rewriteLlms(before, [
      { name: 'Subly', tagline: 'Track every subscription in one place', url: 'https://subly.nikatru.com', platforms: ['web'] },
    ]);
    assert.match(out, /## Apps\n- Subly — Track every subscription in one place — https:\/\/subly\.nikatru\.com \(web\)\n\n## Key pages/);
    assert.doesNotMatch(out, /Old — stale/);
    assert.match(out, /## About\n- Studio: N/);
  });

  test('🔴 rewriteLlms leaves exactly ONE blank line — the recorded `m`-flag `$` bug', () => {
    // The first version used /^## Apps\n[\s\S]*?(?=\n## |$)/m. Under `m`, `$`
    // matches at the end of every LINE, so the body stopped at the end of the
    // first entry and left the section's own trailing newline for the
    // replacement to add again. It shipped a double blank line on its first real
    // run and was caught by reading the diff, not by a fixture asserting the
    // Subly line was present — which would have passed.
    const before = '## Apps\n- Old — x — https://o.example (web)\n\n## Key pages\n- Home: /\n';
    const out = rewriteLlms(before, [{ name: 'A', tagline: 'T', url: 'https://a.example', platforms: ['web'] }]);
    assert.doesNotMatch(out, /\n\n\n/);
    assert.equal(out, '## Apps\n- A — T — https://a.example (web)\n\n## Key pages\n- Home: /\n');
  });

  test('rewriteLlms returns null when its anchor heading is gone, rather than guessing', () => {
    assert.equal(rewriteLlms('# N\n\n## Key pages\n- Home: /\n', []), null);
  });

  test('a non-live entry never reaches llms.txt — it is a promise to a stranger', () => {
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo', url: 'https://lingo.nikatru.com', status: 'preview' }]);
    writeFileSync(p(root, 'llms.txt'), '# N\n\n## Apps\n- placeholder\n\n## Key pages\n- Home: /\n');
    generate(root);
    const llms = readFileSync(p(root, 'llms.txt'), 'utf8');
    assert.match(llms, /- Subly —/);
    assert.doesNotMatch(llms, /Lingo|lingo\.nikatru\.com/);
  });

  test('a renamed ## Apps heading FAILS rather than silently returning the catalogue to hand maintenance', () => {
    const root = tree([SUBLY]);
    writeFileSync(p(root, 'llms.txt'), '# N\n\n## Applications\n- whatever\n');
    const r = generate(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /has no `## Apps` heading/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [12]W-3a · lastmodFor, against a REAL git repository.
//
// This is the fixed point the generator's own header said could not be reached:
// a git-derived `<lastmod>` written into a file committed alongside its subject
// cannot know the commit date that does not exist yet. The resolution is the
// three branches below, and they are tested against real commits rather than a
// stubbed `git`, because a fake git would only prove the fake behaves.
// ─────────────────────────────────────────────────────────────────────────────
describe('lastmodFor — the value a URL will carry once this state is committed', () => {
  const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

  function gitRepo() {
    const root = join(TMP, `g${seq++}`);
    mkdirSync(root, { recursive: true });
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    git(root, 'config', 'user.name', 'Fixture');
    return root;
  }

  test('a file with no history at all resolves to today — it is being ADDED in this commit', () => {
    const root = gitRepo();
    writeFileSync(join(root, 'page.html'), 'v1\n');
    assert.equal(lastmodFor(root, 'page.html'), today());
  });

  test('🔴 a committed, unchanged file resolves to its OWN commit date, not to HEAD', () => {
    // The distinction the whole clause turns on. W-3's research note warned the
    // criterion is "satisfied by any generator that touches git, including one
    // that reads the repo's own HEAD date for every URL" — so a later commit
    // that does not touch this file must not move its date.
    const root = gitRepo();
    writeFileSync(join(root, 'page.html'), 'v1\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '--date=2026-03-04T10:00:00', '-m', 'add page');
    writeFileSync(join(root, 'other.html'), 'x\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '--date=2026-05-06T10:00:00', '-m', 'unrelated');
    assert.equal(lastmodFor(root, 'page.html'), '2026-03-04');
    assert.equal(lastmodFor(root, 'other.html'), '2026-05-06');
  });

  test('🔴 a committed file whose PLANNED bytes differ resolves to today — it is being changed now', () => {
    // This is what makes the generator idempotent across `generate → commit →
    // CI regenerates → diff`. Without it the first run would write the OLD
    // commit date for a page it is about to rewrite, and the second run would
    // write a different one — so `0 changed` could never hold and CI's
    // regenerate-and-diff could never be green.
    const root = gitRepo();
    writeFileSync(join(root, 'page.html'), 'v1\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '--date=2026-03-04T10:00:00', '-m', 'add page');
    assert.equal(lastmodFor(root, 'page.html', 'v1\n'), '2026-03-04');
    assert.equal(lastmodFor(root, 'page.html', 'v2\n'), today());
  });

  test('a DIRTY working tree resolves to today even with no planned bytes — the guard reads the tree', () => {
    const root = gitRepo();
    writeFileSync(join(root, 'page.html'), 'v1\n');
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '--date=2026-03-04T10:00:00', '-m', 'add page');
    assert.equal(lastmodFor(root, 'page.html'), '2026-03-04');
    writeFileSync(join(root, 'page.html'), 'edited\n');
    assert.equal(lastmodFor(root, 'page.html'), today());
  });

  test('a tree that is not a git work tree degrades to today, identically for writer and checker', () => {
    const plain = join(TMP, `p${seq++}`);
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, 'page.html'), 'v1\n');
    assert.equal(isGitRepo(plain), false);
    assert.equal(lastmodFor(plain, 'page.html'), today());
  });
});

describe('the drift limb (W-9)', () => {
  test('M1 — a hand-edited landing FAILS, naming that file', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('<h1>Subly</h1>', '<h1>Subly Pro</h1>'));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /sites\/nikatru\/apps\/subly\.html DRIFTED/);
  });

  test('M2 — a deleted landing FAILS as MISSING', () => {
    const root = tree([SUBLY]);
    generate(root);
    unlinkSync(p(root, 'apps', 'subly.html'));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /sites\/nikatru\/apps\/subly\.html is MISSING/);
  });

  test('M3 — a deleted sitemap <url> block FAILS with a DISTINCT message from M1', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'sitemap.xml');
    // ⚠️ MATCHED BY REGEX, NOT BY A LITERAL BLOCK. The literal this replaced
    // stopped matching the moment [12]W-3a put a `<lastmod>` inside every
    // `<url>` — and a `String.replace` that matches nothing removes nothing, so
    // the mutation silently became a no-op and this test passed a guard it was
    // no longer feeding bad input to. Exactly the shape F-10 exists to catch,
    // caught here only because the guard then returned 0 where 1 was asserted.
    const before = readFileSync(f, 'utf8');
    const after = before.replace(/[ \t]*<url>\s*<loc>https:\/\/nikatru\.com\/apps\/subly\.html<\/loc>[\s\S]*?<\/url>\n/, '');
    assert.notEqual(after, before, 'the mutation must actually remove the block, or this test asserts nothing');
    writeFileSync(f, after);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /sites\/nikatru\/sitemap\.xml DRIFTED/);
    assert.doesNotMatch(r.out, /apps\/subly\.html DRIFTED/);
  });

  test('a registry entry added and never regenerated FAILS', () => {
    const root = tree([SUBLY]);
    generate(root);
    writeFileSync(
      join(root, 'sites', '_shared', '_data', 'apps.json'),
      JSON.stringify([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo' }], null, 2),
    );
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /apps\/lingo\.html is MISSING/);
  });
});

describe('the coverage relationship (both directions)', () => {
  test('M7 — a hand-added page under apps/ FAILS, because the diff alone cannot see it', () => {
    const root = tree([SUBLY]);
    generate(root);
    writeFileSync(p(root, 'apps', 'ghost.html'), '<html><body>ghost</body></html>\n');
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /ghost\.html is a page this generator would never write/);
  });

  test('_template.html is the ONE exemption, and it is by name — it does not read as drift', () => {
    const root = tree([SUBLY]);
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /_template\.html \(not generated, noindex, served\)/);
  });

  test('a landing whose registry entry was deleted FAILS in the other direction', () => {
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo' }]);
    generate(root);
    writeFileSync(join(root, 'sites', '_shared', '_data', 'apps.json'), JSON.stringify([SUBLY], null, 2));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /lingo\.html is a page this generator would never write/);
  });
});

describe('the placeholder scanner and its canary', () => {
  test('M6 — a bracketed slot reaching a generated page FAILS', () => {
    const root = tree([{ ...SUBLY, tagline: 'Track every [THING] in one place' }]);
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /unfilled slot\(s\)/);
  });

  test('M4 — the canary going quiet is COVERAGE LOST, and it names the token', () => {
    const root = tree([SUBLY], { template: TEMPLATE.replace('[APP NAME]', 'APP NAME') });
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /\[APP NAME\]/);
  });

  test('the scanner matches the token shapes the stage document\'s own regex missed', () => {
    // `\[[A-Z][A-Z0-9 /_.—-]*\]` — the shape proposed in the plan — cannot match
    // any of these three, all of them live in the real _template.html. Recorded
    // here so nobody "tidies" the matcher back to it.
    const root = tree([SUBLY], {
      template: TEMPLATE.replace('[0 or price]', 'x').replace('[SNAP OR dl.nikatru.com APPIMAGE URL]', 'y'),
    });
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /\[0 or price\]/);
    assert.match(r.out, /\[SNAP OR dl\.nikatru\.com APPIMAGE URL\]/);
  });

  test('the template losing its noindex FAILS — it is served in production', () => {
    const root = tree([SUBLY], { template: TEMPLATE.replace('<meta name="robots" content="noindex, nofollow">', '') });
    generate(root);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /has lost its `noindex`/);
  });
});

describe('the structured-data limb', () => {
  test('M5 — a fabricated aggregateRating in a served landing FAILS', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace('"@type": "SoftwareApplication",', '"@type": "SoftwareApplication",\n  "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.8", "ratingCount": "312" },'),
    );
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /aggregateRating/);
  });

  test('an offers block in a served landing FAILS — no price may be written here', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace('"@type": "SoftwareApplication",', '"@type": "SoftwareApplication",\n  "offers": { "@type": "Offer", "price": "4.99", "priceCurrency": "USD" },'),
    );
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /carries an `offers` block/);
  });

  test('a JSON-LD block that stops parsing FAILS rather than being skipped', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"@context": "https://schema.org",', '"@context": ,'));
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /does not parse/);
  });

  test('a canonical and a JSON-LD url that disagree FAIL', () => {
    const root = tree([SUBLY]);
    generate(root);
    const f = p(root, 'apps', 'subly.html');
    writeFileSync(
      f,
      readFileSync(f, 'utf8').replace('"url": "https://nikatru.com/apps/subly.html"', '"url": "https://nikatru.com/apps/subly"'),
    );
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /Two self-references that disagree/);
  });
});

describe('coverage self-checks — the scan itself must be loud when it stops scanning', () => {
  test('an EMPTY registry is COVERAGE LOST, never a quiet pass over nothing', () => {
    const root = tree([]);
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /planned ZERO files/);
    assert.match(r.out, /reason: .*carries no entries/);
  });

  test('an unparseable registry names the PARSE ERROR as the reason, not just "I scanned nothing"', () => {
    const root = tree('{not json');
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /reason: .*not valid JSON/);
  });

  test('a missing apps/ directory is COVERAGE LOST — losing it loses two guards at once', () => {
    const root = tree([SUBLY]);
    generate(root);
    rmSync(join(root, 'sites', 'nikatru', 'apps'), { recursive: true, force: true });
    const r = guard(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('planDiscovery over a root with no registry reports it rather than throwing', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { files, problems } = planDiscovery(root);
    assert.equal(files.size, 0);
    assert.match(problems.join('\n'), /does not exist/);
  });
});

describe('the real repository', () => {
  test('the committed surfaces match a fresh generator run, and the guard says so', () => {
    const r = guard(REPO);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /generated file\(s\) match a fresh run/);
  });

  test('🔴 THE D-12 OWNER PRINT SURVIVES — the generator does not touch the homepage APPS array', () => {
    const home = readFileSync(join(REPO, 'sites', 'nikatru', 'index.html'), 'utf8');
    assert.match(home, /const APPS = \[\n\s*\/\/ add your first app here\n\];/);
    // ...and check-site-integrity.mjs still prints the unannounced gap, which is
    // the owner-reserved decision this increment deliberately did not take.
    const site = spawnSync(process.execPath, [join(CI_DIR, 'check-site-integrity.mjs'), REPO], { encoding: 'utf8' });
    assert.equal(site.status, 0, site.stdout + site.stderr);
    assert.match(site.stdout, /UNANNOUNCED: sites\/_shared\/_data\/apps\.json marks "Subly" status "live"/);
  });

  test('the deferred stage-12 triggers are MEASURED and printed, not asserted from prose', () => {
    const r = guard(REPO);
    for (const id of ['W-4', 'W-5', 'W-6', 'W-8']) {
      assert.match(r.out, new RegExp(`\\[12\\]${id}`), `${id} must be reported every run`);
    }
    assert.match(r.out, /DEFERRED \[12\]W-8[\s\S]*?0 pack\(s\) owned by a registry slug/);
  });

  test('a second live registry entry FLIPS W-4\'s trigger print — the watcher is not a constant', () => {
    // The writable failing input for the trigger watcher: without this the four
    // prints would be prose wearing a guard's clothes.
    const root = tree([SUBLY, { ...SUBLY, slug: 'lingo', name: 'Lingo' }]);
    generate(root);
    const { live } = planDiscovery(root);
    assert.equal(live.length, 2);
  });
});
