// ─────────────────────────────────────────────────────────────────────────────
// channel-claims.test.mjs — assert-channel-claims.mjs must be able to FAIL.
//
// [pipeline D-1] limb (ii) · no surface advertises an unserved channel
// [pipeline D-7] the sites half · the dead channel's tells are purged
//
// ⚠️ SECOND LINE OF EVIDENCE, NOT THE FIRST. 15 mutations were run against the
// REAL tree first, with a harness that re-asserts a green baseline after every
// restore and ABORTS if it cannot — because the previous guard's first mutation
// run reported 14/14 caught while restoring nothing, and every result after the
// first was a leftover. Two of those 15 changed the design rather than passing:
//   · six placeholder store URLs inside the `/* … */` example blocks failed the
//     first version. Crying wolf, and the fix a reader reaches for is
//     comment-stripping — which would silently kill D-7's limb, whose payload IS
//     a comment. Hence destination-vs-placeholder, not comment-vs-code.
//   · a surface reading "install the flatpak from your distro store" passed
//     clean, because `flatpak` is the package format and `flathub` is the
//     channel id. Hence the register's `tells` array.
// Neither would have been found by a fixture I wrote to match the guard I wrote.
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
const GUARD = join(CI_DIR, 'assert-channel-claims.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-claims-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** The affordance floor needs at least one store link to exist, or the guard
 *  correctly reports COVERAGE LOST. Every fixture therefore ships the same
 *  placeholder template the real sites carry. */
const TEMPLATE_BLOCK = `
<script>
/* Example — add one object per published app.
   links: {
     ios:     "https://apps.apple.com/app/id0000000000",
     android: "https://play.google.com/store/apps/details?id=com.nikatru.XXXXXXXX",
     windows: "https://apps.microsoft.com/detail/XXXXXXXX"
   }
*/
const APPS = [];
</script>
`;

function tree({
  nikatruBody = '',
  rajaBody = '',
  platforms = ['web'],
  minSites = 2,
  siblingConst = 'MIN_SITES',
  roots = ['nikatru', 'rajasekarselvam'],
  disqualified = [{ id: 'flathub', adr: 'knowledge/decisions/015-linux.md', date: '2026-07-25', tells: ['flathub', 'flatpak'] }],
  // The guard derives its artifact patterns from these rows — an empty channels
  // array is COVERAGE LOST by design, so every fixture carries a minimal set.
  channels = [
    { id: 'android-play', platforms: ['android'], artifactFormats: ['.apk', '.aab'] },
    { id: 'windows-direct', platforms: ['windows'], artifactFormats: ['.msix', '.exe'] },
    { id: 'macos-appstore', platforms: ['macos'], artifactFormats: ['.pkg'] },
    { id: 'linux-appimage', platforms: ['linux'], artifactFormats: ['.AppImage'] },
    { id: 'web', platforms: ['web'], artifactFormats: ['static-bundle'] },
  ],
  omitRegister = false,
  // The guard's REQUIRED_COVERAGE (review 2026-07-31) demands the walk still
  // reach site.webmanifest and both sitemaps, so every fixture ships them —
  // same reason every fixture ships TEMPLATE_BLOCK for the affordance floor.
  webmanifestDescription = 'Apps.',
  sitemapExtra = '',
  redirectsBody = null,
  omitWebmanifest = false,
} = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  };

  for (const r of roots) {
    const body = r === 'nikatru' ? nikatruBody : rajaBody;
    write(`sites/${r}/index.html`, `<!doctype html><html><body>${body}${TEMPLATE_BLOCK}</body></html>`);
    write(`sites/${r}/sitemap.xml`, `<?xml version="1.0"?><urlset><url><loc>https://${r}.example.org/</loc></url>${r === 'nikatru' ? sitemapExtra : ''}</urlset>`);
    if (r === 'nikatru' && !omitWebmanifest) {
      write(`sites/${r}/site.webmanifest`, JSON.stringify({ name: 'NIKATRU', description: webmanifestDescription }));
    }
  }
  if (redirectsBody !== null) write('sites/nikatru/_redirects', redirectsBody);
  write('sites/_shared/_data/apps.json', JSON.stringify([{ slug: 'subly', platforms, status: 'live' }]));
  write(`tooling/ci/check-site-integrity.mjs`, `const ${siblingConst} = ${minSites};\n`);
  if (!omitRegister) {
    write('tooling/channel-register.json', JSON.stringify({ channels, disqualified }, null, 2));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-claims — [D-7] the dead channel has no honest mention', () => {
  test('PASSES a tree whose tells are purged', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /assert-channel-claims: ok/);
  });

  // D-7's own recorded failing case: "delete :474 and re-add it".
  test('FAILS on the bare label "Snap / Flathub" — no domain, still an advert', () => {
    const { code, out } = run(tree({ nikatruBody: '<script>var L={linux:"Snap / Flathub"};</script>' }));
    assert.equal(code, 1, out);
    assert.match(out, /advertises "Flathub"/);
  });

  test('FAILS on a flathub.org link INSIDE a comment — the house rule inverts here', () => {
    const { code, out } = run(tree({ nikatruBody: '<script>/* linux: "https://flathub.org/apps/x" */</script>' }));
    assert.equal(code, 1, out);
    assert.match(out, /advertises "flathub"/);
  });

  test('FAILS on the [FLATHUB/SNAP URL] placeholder — a placeholder is still a tell', () => {
    // Explicitly asserts the D-1 placeholder exemption does NOT leak into D-7.
    const { code, out } = run(tree({ nikatruBody: '<a href="[FLATHUB/SNAP URL]">Linux</a>' }));
    assert.equal(code, 1, out);
    assert.match(out, /advertises "FLATHUB"/);
  });

  test('FAILS on "flatpak" alone — the format, not the channel id', () => {
    const { code, out } = run(tree({ rajaBody: '<p>Install the flatpak from your distro store.</p>' }));
    assert.equal(code, 1, out);
    assert.match(out, /advertises "flatpak" — a tell of "flathub"/);
  });

  test('FAILS when a tells list is narrowed to drop its own id', () => {
    const { code, out } = run(
      tree({ disqualified: [{ id: 'flathub', adr: 'a/b.md', tells: ['flatpak'] }] }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /do not include its own id/);
  });

  // Hardened 2026-07-31 (review, mutation-proven): the old fallback made
  // deleting or emptying `tells` a SILENT narrowing to the id alone.
  test('FAILS when the tells key is DELETED from a disqualified entry', () => {
    const { code, out } = run(tree({ disqualified: [{ id: 'flathub', adr: 'a/b.md' }] }));
    assert.equal(code, 1, out);
    assert.match(out, /no `tells` array/);
  });

  test('FAILS when tells is EMPTIED on a disqualified entry', () => {
    const { code, out } = run(tree({ disqualified: [{ id: 'flathub', adr: 'a/b.md', tells: [] }] }));
    assert.equal(code, 1, out);
    assert.match(out, /no `tells` array/);
  });

  test('FAILS on a direct GitHub-release download button ([ADR 015] §4)', () => {
    const { code, out } = run(tree({ nikatruBody: '<a href="https://github.com/x/y/releases/latest">Download</a>' }));
    assert.equal(code, 1, out);
    assert.match(out, /Releases is the artifact ORIGIN/);
  });
});

describe('assert-channel-claims — [D-1] an affordance is a promise only if real', () => {
  test('FAILS on a REAL App Store URL while no app claims ios', () => {
    const { code, out } = run(tree({ nikatruBody: '<a href="https://apps.apple.com/app/id6503219871">iOS</a>' }));
    assert.equal(code, 1, out);
    assert.match(out, /offers an App Store link for platform\(s\) "ios"/);
    assert.match(out, /The destination is REAL, not a placeholder/);
  });

  test('FAILS on a REAL Play URL — the com.nikatru.notes shape that shipped', () => {
    const { code, out } = run(tree({ nikatruBody: '<a href="https://play.google.com/store/apps/details?id=com.nikatru.notes">Android</a>' }));
    assert.equal(code, 1, out);
    assert.match(out, /offers a Google Play link/);
  });

  test('FAILS on an .apk offered for download', () => {
    const { code, out } = run(tree({ rajaBody: '<a href="/dl/subly-1.0.75.apk">Get the APK</a>' }));
    assert.equal(code, 1, out);
    assert.match(out, /a \.apk artifact \(register: android-play\)/);
  });

  test('FAILS on a snapcraft.io link while no app claims linux', () => {
    const { code, out } = run(tree({ rajaBody: '<a href="https://snapcraft.io/subly">Linux</a>' }));
    assert.equal(code, 1, out);
    assert.match(out, /a Snap Store link/);
  });

  // The distinction the design turns on.
  test('PASSES the same store links when they are template placeholders', () => {
    const { code, out } = run(tree({ nikatruBody: '<a href="https://apps.apple.com/app/id0000000000">iOS</a>' }));
    assert.equal(code, 0, out);
    assert.match(out, /template placeholders/);
  });

  test('PASSES a REAL store link once an app actually claims that platform', () => {
    // BOTH Apple platforms — an ambiguous apps.apple.com link is all-of since
    // the 2026-07-31 triage; the all-of/disambiguation cases have their own
    // describe below.
    const { code, out } = run(
      tree({ nikatruBody: '<a href="https://apps.apple.com/app/id6503219871">iOS</a>', platforms: ['web', 'ios', 'macos'] }),
    );
    assert.equal(code, 0, out);
  });

  test('PRINTS platform-count prose rather than failing — site copy is the owner\'s voice', () => {
    const { code, out } = run(tree({ nikatruBody: '<p>One codebase, six platforms.</p>' }));
    assert.equal(code, 0, out);
    assert.match(out, /platform-count claim/);
    assert.match(out, /six platforms/);
  });

  // Derived-from-register patterns (review 2026-07-31): the hand-copied list
  // had already drifted — .exe passed while sitting in the register next door.
  test('FAILS on a REAL .exe download — the pattern comes from the register now', () => {
    const { code, out } = run(tree({ nikatruBody: '<a href="/dl/Subly-Setup.exe">Windows</a>' }));
    assert.equal(code, 1, out);
    assert.match(out, /a \.exe artifact \(register: windows-direct\)/);
  });

  test('FAILS COVERAGE LOST when a register format cannot resolve to a pattern', () => {
    const { code, out } = run(
      tree({ channels: [{ id: 'android-play', platforms: ['android'], artifactFormats: ['aab-bundle'] }] }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /resolve to NO scan pattern/);
  });

  test("FAILS on a REAL dl.nikatru.com link — the guard's own prescribed remedy is a promise too", () => {
    const { code, out } = run(tree({ rajaBody: '<a href="https://dl.nikatru.com/subly/latest">Get it</a>' }));
    assert.equal(code, 1, out);
    assert.match(out, /dl\.nikatru\.com download link/);
  });

  test('PASSES a bracketed dl.nikatru.com placeholder — spaces and all', () => {
    // The QUOTED value is the placeholder; the tight token around the match is
    // not. quotedValueAround() exists exactly for this shape.
    const { code, out } = run(tree({ nikatruBody: '<a href="[SNAP OR dl.nikatru.com APPIMAGE URL]">Linux</a>' }));
    assert.equal(code, 0, out);
  });
});

describe('assert-channel-claims — coverage is a relationship, not a number', () => {
  test('FAILS COVERAGE LOST when fewer deploy roots exist than the sibling floor', () => {
    const { code, out } = run(tree({ roots: ['nikatru'] }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /requires at least 2/);
  });

  test('FAILS COVERAGE LOST when MIN_SITES can no longer be read from the sibling', () => {
    const { code, out } = run(tree({ siblingConst: 'MIN_SITE_ROOTS' }));
    assert.equal(code, 1, out);
    assert.match(out, /could not read MIN_SITES/);
    assert.match(out, /do not reintroduce a local number/);
  });

  test('tracks the sibling UPWARD — raising MIN_SITES raises this floor too', () => {
    const { code, out } = run(tree({ minSites: 3 }));
    assert.equal(code, 1, out);
    assert.match(out, /requires at least 3/);
  });

  test('FAILS COVERAGE LOST when apps.json claims no platforms', () => {
    const { code, out } = run(tree({ platforms: [] }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO platforms/);
  });

  test('FAILS COVERAGE LOST when the register lists no disqualified channels', () => {
    const { code, out } = run(tree({ disqualified: [] }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO disqualified channels/);
  });

  test('FAILS COVERAGE LOST when the register is absent entirely', () => {
    const { code, out } = run(tree({ omitRegister: true }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('FAILS COVERAGE LOST when no store affordance matches anywhere', () => {
    // The pattern set silently ceasing to match is indistinguishable from a
    // clean tree, and the real sites always carry the app-card template.
    const root = tree();
    writeFileSync(join(root, 'sites/nikatru/index.html'), '<!doctype html><p>nothing here</p>');
    writeFileSync(join(root, 'sites/rajasekarselvam/index.html'), '<!doctype html><p>nor here</p>');
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /ZERO store or artifact affordances/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2026-07-31 medium/low triage — the four scan-hardening defects, each
// mutation-proven against a scratch copy of the REAL tree before these
// fixtures were written (a fixture I wrote encodes the same misunderstanding
// as the guard I wrote; the real-tree mutation is the proof of record).
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-channel-claims — the walk reaches every public surface', () => {
  test('FAILS on a flathub tell inside site.webmanifest — the file that already carried the claim', () => {
    const { code, out } = run(tree({ webmanifestDescription: 'Apps. Also on Flathub.' }));
    assert.equal(code, 1, out);
    assert.match(out, /site\.webmanifest:\d+ advertises "Flathub"/);
  });

  test('FAILS on a _redirects line 302-ing to a real store URL', () => {
    const { code, out } = run(
      tree({ redirectsBody: '/android https://play.google.com/store/apps/details?id=com.nikatru.subly 302\n' }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /_redirects:1 offers a Google Play link/);
  });

  test('FAILS on a flathub <loc> inside sitemap.xml', () => {
    const { code, out } = run(
      tree({ sitemapExtra: '<url><loc>https://flathub.org/apps/com.nikatru.subly</loc></url>' }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /sitemap\.xml:1 advertises "flathub"/);
  });

  test('FAILS COVERAGE LOST when the walk stops reaching site.webmanifest — re-narrowing is loud', () => {
    const { code, out } = run(tree({ omitWebmanifest: true }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no longer reaches: sites\/nikatru\/site\.webmanifest/);
  });
});

describe('assert-channel-claims — the Apple domain fronts TWO stores (all-of)', () => {
  test('FAILS an ambiguous apps.apple.com link when ios is claimed but macos is not — naming macos', () => {
    const { code, out } = run(
      tree({ nikatruBody: '<a href="https://apps.apple.com/app/id6503219871">Get it</a>', platforms: ['web', 'ios'] }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /offers an App Store link for platform\(s\) "ios"\/"macos"/);
    assert.match(out, /"macos" is claimed by no app/);
  });

  test('PASSES the same ambiguous link once BOTH Apple platforms are claimed', () => {
    const { code, out } = run(
      tree({ nikatruBody: '<a href="https://apps.apple.com/app/id6503219871">Get it</a>', platforms: ['web', 'ios', 'macos'] }),
    );
    assert.equal(code, 0, out);
  });

  test('PASSES an mt=8 destination with only ios claimed — the URL disambiguates to the iOS store', () => {
    const { code, out } = run(
      tree({ nikatruBody: '<a href="https://apps.apple.com/app/id6503219871?mt=8">Get it</a>', platforms: ['web', 'ios'] }),
    );
    assert.equal(code, 0, out);
  });

  test('PASSES an itunes.apple.com destination with only ios claimed', () => {
    const { code, out } = run(
      tree({ nikatruBody: '<a href="https://itunes.apple.com/app/id6503219871">Get it</a>', platforms: ['web', 'ios'] }),
    );
    assert.equal(code, 0, out);
  });

  test('PASSES an mt=12 destination with only macos claimed — the Mac store', () => {
    const { code, out } = run(
      tree({ nikatruBody: '<a href="https://apps.apple.com/app/id6503219871?mt=12">Get it</a>', platforms: ['web', 'macos'] }),
    );
    assert.equal(code, 0, out);
  });

  test('FAILS an mt=12 destination when macos is not claimed, even with ios claimed', () => {
    const { code, out } = run(
      tree({ nikatruBody: '<a href="https://apps.apple.com/app/id6503219871?mt=12">Get it</a>', platforms: ['web', 'ios'] }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /for platform\(s\) "macos"/);
  });

  test('PASSES dl.nikatru.com with only windows claimed — ANY-OF is preserved where it is honest', () => {
    const { code, out } = run(
      tree({ rajaBody: '<a href="https://dl.nikatru.com/subly/latest">Get it</a>', platforms: ['web', 'windows'] }),
    );
    assert.equal(code, 0, out);
  });
});

describe('assert-channel-claims — every exemption is printed, every cue anchored', () => {
  test('the template id0000000000 stays exempt AND appears in the printed exemption list with its cue', () => {
    const { code, out } = run(tree({ nikatruBody: '<a href="https://apps.apple.com/app/id0000000000">iOS</a>' }));
    assert.equal(code, 0, out);
    assert.match(out, /placeholder-exempted destination\(s\)/);
    assert.match(out, /id0000000000" \(cue: zero-run id\)/);
  });

  test('FAILS a real-shaped id6500001234 — four zeros INSIDE an id are not a placeholder', () => {
    const { code, out } = run(tree({ nikatruBody: '<a href="https://apps.apple.com/app/id6500001234">iOS</a>' }));
    assert.equal(code, 1, out);
    assert.match(out, /The destination is REAL, not a placeholder: "https:\/\/apps\.apple\.com\/app\/id6500001234"/);
  });

  test('FAILS a com.your-apps Play package — YOUR- inside a package name is not a slot', () => {
    const { code, out } = run(
      tree({ nikatruBody: '<a href="https://play.google.com/store/apps/details?id=com.your-apps.subly">Get</a>' }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /offers a Google Play link/);
    assert.match(out, /REAL, not a placeholder/);
  });

  test('PASSES a YOUR_ slot at a path-segment boundary — still scaffolding, still printed', () => {
    const { code, out } = run(tree({ nikatruBody: '<a href="https://apps.apple.com/app/YOUR_APP_ID">iOS</a>' }));
    assert.equal(code, 0, out);
    assert.match(out, /\(cue: YOUR- slot\)/);
  });
});

describe('assert-channel-claims — enumeration claims join the every-run print', () => {
  test('PRINTS the six-name enumeration — the same claim without the magic word', () => {
    const { code, out } = run(
      tree({ nikatruBody: '<p>Apps for every screen - iOS, Android, Windows, macOS, Linux and Web.</p>' }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /platform-count claim/);
    assert.match(out, /iOS, Android, Windows, macOS, Linux and Web/);
  });

  test('does NOT print ordinary prose naming only two platforms', () => {
    const { code, out } = run(tree({ nikatruBody: '<p>Now on Android and Windows phones near you.</p>' }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /Android and Windows phones/);
  });

  test('still PRINTS the classic "six platforms" wording alongside', () => {
    const { code, out } = run(
      tree({ nikatruBody: '<p>One codebase, six platforms: iOS, Android, Windows, macOS, Linux, Web.</p>' }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /"six platforms"/);
    assert.match(out, /iOS, Android, Windows, macOS, Linux, Web/);
  });
});
