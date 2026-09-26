// ─────────────────────────────────────────────────────────────────────────────
// msix-visual-name.test.mjs — tooling/store/msix-visual-name.mjs writes the
// Start-menu label into a packaged manifest and leaves the Store title alone.
//
// O-MSIX-IDENTITY-UNGRADED. The MakeAppx half runs only on the Windows runner;
// what is tested here is the rewrite, the refusals and the way MakeAppx is
// found. The package that comes out is graded by
// assert-artifact-signed-msix.mjs, the step after it.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setVisualName, findMakeAppx } from '../../store/msix-visual-name.mjs';
import { readVisualIdentity } from '../assert-artifact-signed-msix.mjs';
import { readDeclaration } from '../../app-yaml/render.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'store', 'msix-visual-name.mjs');
const REPO_ROOT = resolve(dirname(SCRIPT), '..', '..');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-msix-visual-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;
const dir = () => { const d = join(TMP, `c${(seq += 1)}`); mkdirSync(d, { recursive: true }); return d; };

/** The shape `msix` 3.18.0 writes (lib/src/appx_manifest.dart): one display
 *  name in Properties, VisualElements and, cut at 40, DefaultTile. */
const MANIFEST = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10">',
  '  <Properties>',
  '    <DisplayName>Nikatru Subscription Tracker</DisplayName>',
  '  </Properties>',
  '  <Applications>',
  '    <Application Id="subscriptiontracker">',
  '      <uap:VisualElements BackgroundColor="transparent"',
  '          DisplayName="Nikatru Subscription Tracker" Square150x150Logo="Images\\Square150x150Logo.png"',
  '          Square44x44Logo="Images\\Square44x44Logo.png" Description="x">',
  '          <uap:DefaultTile ShortName="Nikatru Subscription Tracker" Square310x310Logo="Images\\LargeTile.png"/>',
  '      </uap:VisualElements>',
  '    </Application>',
  '  </Applications>',
  '</Package>',
  '',
].join('\n');

const run = (args, cwd = REPO_ROOT) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

describe('setVisualName', () => {
  test('sets VisualElements/@DisplayName and leaves Properties/DisplayName as the Store title', () => {
    const v = readVisualIdentity(setVisualName(MANIFEST, 'Subscriptions'));
    assert.equal(v.visualDisplayName, 'Subscriptions');
    assert.equal(v.displayName, 'Nikatru Subscription Tracker');
  });

  test('sets DefaultTile/@ShortName to the same label', () => {
    const v = readVisualIdentity(setVisualName(MANIFEST, 'Subscriptions'));
    assert.equal(v.tileShortName, 'Subscriptions');
  });

  test('escapes the label for an XML attribute', () => {
    const out = setVisualName(MANIFEST, 'Subs & "Co"');
    assert.match(out, /DisplayName="Subs &amp; &quot;Co&quot;"/);
    assert.equal(readVisualIdentity(out).visualDisplayName, 'Subs & "Co"');
  });

  test('changes nothing outside the two attributes', () => {
    const out = setVisualName(MANIFEST, 'Subscriptions');
    assert.equal(
      out.replace(/Subscriptions/g, 'Nikatru Subscription Tracker'),
      MANIFEST,
    );
  });

  test('RC5: a manifest with no VisualElements returns null, never the manifest unchanged', () => {
    const bare = MANIFEST.replace(/<uap:VisualElements[\s\S]*<\/uap:VisualElements>\n/, '');
    assert.equal(setVisualName(bare, 'Subscriptions'), null);
  });

  test('a VisualElements with no DisplayName attribute returns null', () => {
    const noName = MANIFEST.replace('DisplayName="Nikatru Subscription Tracker" Square150x150Logo', 'Square150x150Logo');
    assert.equal(setVisualName(noName, 'Subscriptions'), null);
  });
});

describe('findMakeAppx — the plugin\'s own lookup', () => {
  test('resolves makeappx.exe under the msix package root the nearest package_config names', () => {
    const d = dir();
    const pkgRoot = join(d, 'cache', 'msix-3.18.0');
    const exeDir = join(pkgRoot, 'lib', 'assets', 'MSIX-Toolkit', 'Redist.x64');
    mkdirSync(exeDir, { recursive: true });
    writeFileSync(join(exeDir, 'makeappx.exe'), 'not a real exe');
    mkdirSync(join(d, 'ws', '.dart_tool'), { recursive: true });
    mkdirSync(join(d, 'ws', 'apps', 'a'), { recursive: true });
    writeFileSync(join(d, 'ws', '.dart_tool', 'package_config.json'), JSON.stringify({
      configVersion: 2,
      packages: [{ name: 'msix', rootUri: pathToFileURL(pkgRoot).href, packageUri: 'lib/' }],
    }));
    assert.equal(findMakeAppx(join(d, 'ws', 'apps', 'a')), join(exeDir, 'makeappx.exe'));
  });

  test('a package_config with no msix entry resolves nothing', () => {
    const d = dir();
    mkdirSync(join(d, '.dart_tool'), { recursive: true });
    writeFileSync(join(d, '.dart_tool', 'package_config.json'), JSON.stringify({ configVersion: 2, packages: [] }));
    assert.equal(findMakeAppx(d), null);
  });

  test('an msix entry whose toolkit is absent resolves nothing', () => {
    const d = dir();
    mkdirSync(join(d, '.dart_tool'), { recursive: true });
    writeFileSync(join(d, '.dart_tool', 'package_config.json'), JSON.stringify({
      configVersion: 2,
      packages: [{ name: 'msix', rootUri: pathToFileURL(join(d, 'nowhere')).href, packageUri: 'lib/' }],
    }));
    assert.equal(findMakeAppx(d), null);
  });
});

describe('the CLI', () => {
  test('an AppxManifest.xml is rewritten in place to the declared shortName', () => {
    const f = join(dir(), 'AppxManifest.xml');
    writeFileSync(f, MANIFEST);
    const r = run(['--app', 'subscriptiontracker', f]);
    assert.equal(r.status, 0, r.stderr);
    const label = readDeclaration(REPO_ROOT, 'subscriptiontracker').shortName;
    const v = readVisualIdentity(readFileSync(f, 'utf8'));
    assert.equal(v.visualDisplayName, label);
    assert.equal(v.displayName, 'Nikatru Subscription Tracker');
  });

  test('RC5: a manifest with no VisualElements is COVERAGE LOST (exit 2)', () => {
    const f = join(dir(), 'AppxManifest.xml');
    writeFileSync(f, MANIFEST.replace(/<uap:VisualElements[\s\S]*<\/uap:VisualElements>\n/, ''));
    const r = run(['--app', 'subscriptiontracker', f]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /no uap:VisualElements\/@DisplayName/);
  });

  test('no --app is COVERAGE LOST (exit 2)', () => {
    const f = join(dir(), 'AppxManifest.xml');
    writeFileSync(f, MANIFEST);
    const r = run([f]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--app <id> is required/);
  });

  test('an app with no declaration is COVERAGE LOST (exit 2)', () => {
    const f = join(dir(), 'AppxManifest.xml');
    writeFileSync(f, MANIFEST);
    const r = run(['--app', 'no-such-app', f]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /apps\/no-such-app\/app\.yaml could not be read/);
  });

  test('a .msix with no MakeAppx reachable from the working directory is COVERAGE LOST (exit 2)', () => {
    const d = dir();
    writeFileSync(join(d, 'a.msix'), 'PK');
    const r = run(['--app', 'subscriptiontracker', join(d, 'a.msix')], d);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /no makeappx\.exe/);
  });
});
