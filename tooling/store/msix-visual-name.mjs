#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// msix-visual-name.mjs — the Start-menu label of a packaged .msix.
//
// O-MSIX-IDENTITY-UNGRADED. `msix` 3.18.0 has ONE setting for two names: its
// `display_name` is written into both Properties/DisplayName (the name Partner
// Center compares to the name reserved for the product) and
// uap:VisualElements/@DisplayName (the label under the Start-menu tile), and
// it copies it again, cut at 40 characters, into uap:DefaultTile/@ShortName.
// Measured 2026-09-25 in the pinned plugin's lib/src/appx_manifest.dart, read
// from the local pub cache. There is no second setting to point at shortName.
//
// So the pubspec carries the STORE title (tooling/app-yaml/render.mjs renders
// it from app.yaml `name`), and the packaging step runs this script right after
// `dart run msix:create`, in the same step: it rewrites @DisplayName and
// @ShortName to app.yaml `shortName` and repacks with the plugin's own
// MakeAppx. Properties/DisplayName is never touched.
//
// ── WHY A REPACK AND NOT A ZIP EDIT ──────────────────────────────────────────
// A .msix is a ZIP64 archive whose AppxBlockMap.xml hashes every member in
// 64 KiB blocks. Changing one byte of AppxManifest.xml inside the archive
// leaves the block map describing bytes that are not there, which the Store and
// every installer refuse. MakeAppx `unpack` → edit → `pack` writes a new block
// map; the footprint files of the old package (the block map, the content-type
// map, a signature, AppxMetadata/) are deleted between the two, because `pack`
// refuses a directory that already carries them.
//
// The package is unsigned (`store: true`: the Store signs it), so a repack
// breaks no signature. tooling/ci/assert-artifact-signed-msix.mjs, the step
// after this one, grades the result — this script is not its own evidence.
//
// Usage (Windows, from the app directory, which is where `msix` itself runs):
//   node <repo>/tooling/store/msix-visual-name.mjs --app <id> <pkg.msix>
//   node <repo>/tooling/store/msix-visual-name.mjs --app <id> <AppxManifest.xml>
// The .xml form rewrites that file in place and needs no MakeAppx.
//
// Exit codes: 0 rewritten · 1 MakeAppx failed · 2 COVERAGE LOST — no --app, no
// `shortName`, no uap:VisualElements/@DisplayName in the manifest, or no
// MakeAppx under the msix package the workspace resolves.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readDeclaration } from '../app-yaml/render.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** XML double-quoted attribute value. */
const xmlAttr = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Sets uap:VisualElements/@DisplayName, and uap:DefaultTile/@ShortName where
 * the manifest has one, to `label`. Returns the new XML, or null when the
 * manifest has no VisualElements element carrying a DisplayName attribute —
 * the caller treats null as COVERAGE LOST, never as "nothing to do".
 */
export function setVisualName(xml, label) {
  const value = xmlAttr(label);
  let hit = false;
  let out = xml.replace(/<((?:\w+:)?VisualElements)\b([^>]*)>/, (whole, tag, attrs) => {
    const next = attrs.replace(/(\sDisplayName\s*=\s*)"[^"]*"/, (_m, pre) => {
      hit = true;
      return `${pre}"${value}"`;
    });
    return `<${tag}${next}>`;
  });
  if (!hit) return null;
  out = out.replace(/<((?:\w+:)?DefaultTile)\b([^>]*)>/, (_whole, tag, attrs) =>
    `<${tag}${attrs.replace(/(\sShortName\s*=\s*)"[^"]*"/, (_m, pre) => `${pre}"${value}"`)}>`);
  return out;
}

/**
 * MakeAppx the way `msix` 3.18.0 finds it (lib/src/configuration.dart
 * `_getMsixAssetsFolderPath`): the nearest `.dart_tool/package_config.json`
 * at or above `from`, its `msix` package's packageUriRoot, then
 * `assets/MSIX-Toolkit/Redist.x64/makeappx.exe`. Returns null when any link is
 * missing.
 */
export function findMakeAppx(from) {
  let dir = resolve(from);
  for (;;) {
    const config = join(dir, '.dart_tool', 'package_config.json');
    if (existsSync(config)) {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(config, 'utf8'));
      } catch {
        return null;
      }
      const pkg = (parsed.packages ?? []).find((p) => p.name === 'msix');
      if (!pkg) return null;
      const root = new URL(pkg.rootUri.endsWith('/') ? pkg.rootUri : `${pkg.rootUri}/`, pathToFileURL(config));
      const uriRoot = new URL(pkg.packageUri ?? 'lib/', root);
      const exe = join(fileURLToPath(uriRoot), 'assets', 'MSIX-Toolkit', 'Redist.x64', 'makeappx.exe');
      return existsSync(exe) ? exe : null;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const FOOTPRINT = ['AppxBlockMap.xml', '[Content_Types].xml', 'AppxSignature.p7x', 'AppxMetadata'];

function coverageLost(msg) {
  console.error(`COVERAGE LOST  msix visual name — ${msg}`);
  process.exit(2);
}

function main(argv) {
  let app;
  const targets = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--app') {
      app = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : '';
    } else {
      targets.push(argv[i]);
    }
  }
  if (app === undefined || app === '') coverageLost('--app <id> is required: the label is app.yaml `shortName` and no app was named.');
  if (targets.length !== 1) coverageLost(`exactly one .msix or AppxManifest.xml is required, got ${targets.length}.`);

  let doc;
  try {
    doc = readDeclaration(REPO_ROOT, app);
  } catch (e) {
    coverageLost(`apps/${app}/app.yaml could not be read (${e.message}).`);
  }
  const label = doc?.shortName;
  if (typeof label !== 'string' || label === '') coverageLost(`apps/${app}/app.yaml declares no \`shortName\`; there is no label to write.`);

  const target = resolve(targets[0]);
  if (!existsSync(target)) coverageLost(`${targets[0]} does not exist.`);

  if (/\.xml$/i.test(target)) {
    const next = setVisualName(readFileSync(target, 'utf8'), label);
    if (next === null) coverageLost(`${targets[0]} has no uap:VisualElements/@DisplayName to set.`);
    writeFileSync(target, next);
    console.log(`ok  msix visual name — ${targets[0]}: VisualElements/@DisplayName = "${label}"`);
    return;
  }

  const makeappx = findMakeAppx(process.cwd());
  if (makeappx === null) {
    coverageLost(
      `no makeappx.exe under the msix package that ${process.cwd()}'s .dart_tool/package_config.json resolves. ` +
        'Run this from the app directory after `dart run msix:create`, as the packaging step does.',
    );
  }
  const work = mkdtempSync(join(tmpdir(), 'msix-visual-name-'));
  try {
    const unpacked = join(work, 'pkg');
    try {
      execFileSync(makeappx, ['unpack', '/o', '/p', target, '/d', unpacked], { stdio: ['ignore', 'ignore', 'inherit'] });
    } catch (e) {
      console.error(`✗ makeappx unpack ${targets[0]} failed (${e.status ?? e.message})`);
      process.exit(1);
    }
    const manifestPath = join(unpacked, 'AppxManifest.xml');
    if (!existsSync(manifestPath)) coverageLost(`${targets[0]} unpacked with no AppxManifest.xml.`);
    const next = setVisualName(readFileSync(manifestPath, 'utf8'), label);
    if (next === null) coverageLost(`${targets[0]}'s AppxManifest.xml has no uap:VisualElements/@DisplayName to set.`);
    writeFileSync(manifestPath, next);
    for (const f of FOOTPRINT) rmSync(join(unpacked, f), { recursive: true, force: true });
    try {
      execFileSync(makeappx, ['pack', '/o', '/d', unpacked, '/p', target], { stdio: ['ignore', 'ignore', 'inherit'] });
    } catch (e) {
      console.error(`✗ makeappx pack ${targets[0]} failed (${e.status ?? e.message})`);
      process.exit(1);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`ok  msix visual name — ${targets[0]} repacked: VisualElements/@DisplayName = "${label}"`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
