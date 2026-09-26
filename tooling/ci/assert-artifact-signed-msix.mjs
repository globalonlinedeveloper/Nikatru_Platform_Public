#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-artifact-signed-msix.mjs — the .msix that was BUILT carries the
// identity the register DECLARES, and carries no signature.
//
// Pipeline requirement: Private/requirements/ → F-2.
//
// ── THE LOOP THIS CLOSES ─────────────────────────────────────────────────────
// 🔴 TWO GUARDS ALREADY COMPARE THE IDENTITY AND NEITHER HAS EVER OPENED THE
// PACKAGE. tooling/ci/assert-store-metadata.mjs compares
// channel-register.json's `packageIdentity` against apps/*/pubspec.yaml's
// `msix_config` — declaration against declaration, which is worth doing and is
// not this. Between the second declaration and the shipped bytes sits
// `dart run msix:create`, and nothing in this repository has ever asked what it
// actually wrote.
//
// That is the gap assert-artifact-shape.mjs's own header names in a different
// lane: "every guard that reads a workflow reads its TEXT … the failure is that
// no step ever compared the declaration to the disk". Same shape, one artifact
// over. A package built under the wrong Identity submits cleanly and is
// UNRECOVERABLE once published — Partner Center binds the identity to the
// product, not to the upload.
//
// ── AND THE ABSENT SIGNATURE IS A POSITIVE ASSERTION, NOT A SKIPPED ONE ──────
// apps/*/pubspec.yaml sets `store: true`, which makes `msix` skip signing
// entirely because the Store re-signs on submission. The observable consequence
// is that the package contains NO `AppxSignature.p7x`. So its absence is
// EVIDENCE THAT store MODE TOOK EFFECT — the one cheap positive proof available
// that the package was built for submission rather than with a test certificate
// nobody owns. `store: false` silently re-introduces such a certificate, and
// this is what notices.
//
// ⚠️ SO THIS GUARD IS NOT THE WINDOWS TWIN OF assert-artifact-signed.mjs. That
// one proves a signature is present and pinned. This one proves a signature is
// ABSENT and an identity matches. Reading the name as "the Android check, for
// Windows" and adding a signature requirement would fail every correct package
// this factory can currently produce.
//
// ── THE SENTINEL IS THE ANSWER TODAY, AND IT IS STILL AN ASSERTION ───────────
// All three identity fields are assigned by Partner Center (OWNER_QUEUE A-2)
// and carry `notYetConfiguredSentinel` until it completes. This guard does NOT
// treat the sentinel as "skip": it requires the package to carry EXACTLY what
// the register declares, sentinel included. A package built with a plausible
// invented identity while the register still says PARTNER-CENTER-PENDING is
// precisely the unrecoverable case, and it is what this catches today.
// ⏱ 2026-09-22 — "today" above is past for the windows-store row: it carries the
// real Partner Center values. Nothing in this guard changes; it requires the
// package to carry EXACTLY the declared identity, real or sentinel. The Package
// Family Name is not read here (it is not in the manifest's Identity element);
// assert-channel-register.mjs §6e recomputes it from the declared publisher.
//
// ── APPENDED 2026-08-25: THE PACKAGE IS ZIP64 AND THE READER WAS NOT ─────────
// Nothing above is withdrawn; this is the third thing that had to be true
// before any of it could run. With PR #366's argv defect fixed, the Windows leg
// of build-platforms reached the real package on run 32814517717 and this guard
// did not fail — it CRASHED, `RangeError [ERR_OUT_OF_RANGE] … Received
// 4294967295` out of the `unzip` call in main(). The trace read
// `assert-artifact-signed-msix.mjs:214`, which is where that call sat in the
// file AS IT THEN STOOD (18b8641) and is recorded as history, not as a pointer
// into this text. The other five platforms were green on that same run.
//
// 4294967295 is 0xFFFFFFFF, the ZIP64 sentinel, in a package of 16.6 MB — so
// this was never a ">4 GB" overflow. An .msix is an OPC/APPX package and the
// packaging tool writes the ZIP64 end-of-central-directory record, its locator
// and the sentinels REGARDLESS OF SIZE. `unzip` read the central-directory
// offset as a bare 32-bit field and used the sentinel as an index.
//
// 🔴 AND THE FIX BELONGED IN THE SHARED READER, NOT HERE. `unzip` is declared
// in tooling/ci/apple-signing.mjs and its own header said it existed for Apple
// provisioning profiles — "a handful of small files" — while this file had been
// handing it a Windows app package since F-2 landed. Giving this guard a
// private second zip reader would have left that contradiction standing AND put
// two readers of the same format in one repository, which drift in the one way
// that reports clean. So `unzip` now handles ZIP64 and its header names BOTH
// callers; the Apple release-signing path, which was green throughout, is
// pinned byte-for-byte in test/apple-signing.test.mjs.
//
// ── APPENDED 2026-09-25: THE IDENTITY A PERSON SEES WAS NEVER GRADED ─────────
// (O-MSIX-IDENTITY-UNGRADED.) Everything above grades the identity Partner
// Center binds. Nothing graded the three things a reviewer and a user read:
// the Store title, the Start-menu label and the tiles. `msix` writes ONE
// `display_name` into both `Properties/DisplayName` and
// `uap:VisualElements/@DisplayName`, so the pubspec could carry the title or the
// ADR 074 label, never both; and with no `logo_path` it copies its own bundled
// tiles into every package it builds. `--app <id>` names the app, and four
// limbs follow:
//   1. `Properties/DisplayName` equals the app's store/windows-store/title.txt;
//   2. `uap:VisualElements/@DisplayName` (and `uap:DefaultTile/@ShortName`)
//      equal the app's `shortName`, read through render.mjs's `readDeclaration`;
//   3. no tile PNG the manifest references hashes to a file in
//      MSIX_PLUGIN_DEFAULT_TILE_HASHES, and that table's version is the one
//      pubspec.lock pins (a pin bump without a re-measure is COVERAGE LOST);
//   4. the app's pubspec sets `msix_config.logo_path`, and the file exists.
// The package gets 1 and 2 from tooling/store/msix-visual-name.mjs, which runs
// in the packaging step, after `msix:create` and before this guard.
//
// Usage:
//   node tooling/ci/assert-artifact-signed-msix.mjs [--repo-root <path>] --app <id> <pkg.msix>…
// Exit 0 = every package carries the declared identity and no signature.
//      1 = one does not.
//      2 = COVERAGE LOST — the question could not be asked.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { unzip } from './apple-signing.mjs';
import { APPS_DIR, readDeclaration } from '../app-yaml/render.mjs';

export const REGISTER_REL = 'tooling/channel-register.json';
export const CHANNEL_ID = 'windows-store';
export const MANIFEST_MEMBER = 'AppxManifest.xml';
export const SIGNATURE_MEMBER = 'AppxSignature.p7x';

/**
 * Identity out of an AppxManifest.xml, or null.
 *
 * Pure, and an XML ATTRIBUTE READ rather than a parse: the three values sit on
 * two well-known elements and the alternative is a dependency this repository
 * does not carry. Anchored to the element name so a `Name=` on some other
 * element cannot answer for `Identity`.
 */
export function readIdentity(xml) {
  if (typeof xml !== 'string') return null;
  const identityEl = /<Identity\b([^>]*)\/?>/.exec(xml);
  if (!identityEl) return null;
  const attr = (source, name) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(source);
    return m ? m[1] : null;
  };
  const propsEl = /<Properties\b[^>]*>([\s\S]*?)<\/Properties>/.exec(xml);
  const displayName = propsEl
    ? (/<PublisherDisplayName\s*>([\s\S]*?)<\/PublisherDisplayName>/.exec(propsEl[1]) ?? [])[1] ?? null
    : null;
  return {
    identityName: attr(identityEl[1], 'Name'),
    publisher: attr(identityEl[1], 'Publisher'),
    version: attr(identityEl[1], 'Version'),
    publisherDisplayName: displayName === null ? null : displayName.trim(),
  };
}

/** Pure. The register field each manifest field must equal. */
export const IDENTITY_FIELDS = Object.freeze([
  ['identityName', 'identityName', 'Package/Identity/@Name'],
  ['publisher', 'publisher', 'Package/Identity/@Publisher'],
  ['publisherDisplayName', 'publisherDisplayName', 'Package/Properties/PublisherDisplayName'],
]);

const xmlDecode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Pure. What a person sees, out of an AppxManifest.xml: the Store title
 * (`Properties/DisplayName`), the Start-menu label (`VisualElements/@DisplayName`),
 * the tile's short name (`DefaultTile/@ShortName`) and every `.png` the manifest
 * references. Each value is XML-decoded, or null when absent. The namespace
 * prefix is not assumed: `uap:` is the plugin's, not the schema's.
 */
export function readVisualIdentity(xml) {
  if (typeof xml !== 'string') return null;
  const attr = (source, name) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(source);
    return m ? xmlDecode(m[1]) : null;
  };
  const propsEl = /<Properties\b[^>]*>([\s\S]*?)<\/Properties>/.exec(xml);
  const title = propsEl ? (/<DisplayName\s*>([\s\S]*?)<\/DisplayName>/.exec(propsEl[1]) ?? [])[1] ?? null : null;
  const visual = /<(?:\w+:)?VisualElements\b([^>]*)>/.exec(xml);
  const tile = /<(?:\w+:)?DefaultTile\b([^>]*)>/.exec(xml);
  const tileRefs = [...new Set([...xml.matchAll(/[>"]([^"<>]+?\.png)["<]/gi)].map((m) => xmlDecode(m[1]).trim()))];
  return {
    displayName: title === null ? null : xmlDecode(title.trim()),
    visualDisplayName: visual ? attr(visual[1], 'DisplayName') : null,
    tileShortName: tile ? attr(tile[1], 'ShortName') : null,
    hasVisualElements: visual !== null,
    tileRefs,
  };
}

/**
 * 🔴 THE TILES `msix` SHIPS WHEN NOBODY GAVE IT A MARK. With no
 * `msix_config.logo_path` the plugin copies these files into the package's
 * `Images/` folder (lib/src/assets.dart `createIcons`), and every app built
 * that way wears the same placeholder. A tile whose bytes hash to one of these
 * is that placeholder, whatever it is named.
 */
export const MSIX_PLUGIN_DEFAULT_TILE_HASHES = Object.freeze({
  _why:
    'sha256 of each of the 57 PNGs in msix 3.18.0 lib/assets/icons/ (43 distinct hashes), measured 2026-09-25 ' +
    'from the local pub cache, hosted/pub.dev/msix-3.18.0/lib/assets/icons, read-only. 3.18.0 is the version ' +
    'pubspec.lock pins; `version` below is compared to that pin, so a bump re-measures this table.',
  version: '3.18.0',
  files: Object.freeze([
    ['BadgeLogo.scale-100.png', 'af912848b38c4589c1bea1bad34a47223b090211950b785e4502af978add8054'],
    ['BadgeLogo.scale-125.png', 'b692310f82e1664493824928e48889a2fece31ed864cbbf9d0639965bdefa02c'],
    ['BadgeLogo.scale-150.png', '70602b62726a09cc8225dc8878c2dd38a83e694cfca9a352a0a9bb25c79d3ed2'],
    ['BadgeLogo.scale-200.png', '58428effaf6a21d733fcd4ffb2e1feb60ff6124e1ed32f88a976fd603c60672c'],
    ['BadgeLogo.scale-400.png', 'e34b8c8e93b3bca3fb2e3215b735a22ff6919d96eb6b21f62c8b150d9c3345d5'],
    ['LargeTile.scale-100.png', 'a42f18648085cda4005a8ece934105e72c95504583f9366d8bc66555fb83acf4'],
    ['LargeTile.scale-125.png', '6d85a09a4d4674185342ee23041b3881c9bb4dd4e33f0fa51e34bee9d6df2024'],
    ['LargeTile.scale-150.png', '2aebd3646115c3cf428bf109658dd6fc50540c90572cc5b4fca80396fa23dc13'],
    ['LargeTile.scale-200.png', '3028889bd9bbbee86979a8377f6d6772b185c08d01dd51e63c85d947e8200623'],
    ['LargeTile.scale-400.png', 'd8a5aeb0dd5f45efeea86fcb2bbe41069fb3daabc26278a73b00a661e69993a5'],
    ['LockScreenLogo.scale-200.png', '332c77d0ebd2b274d13dd4cae9f73ff5de3196284f535446f5627417a59363fa'],
    ['SmallTile.scale-100.png', '32e0fd18e9d328a4624d5c2dc69b692351618bb207733e195d5fd6fd621d10ff'],
    ['SmallTile.scale-125.png', 'b95ebc4586c005633982c9221da594d701efb7f23f2ebe170636e70e77cb8cf0'],
    ['SmallTile.scale-150.png', '422af3dab023f3c6a9e78a7fc4c15531526b261f78720e2a70697fed0b6094b0'],
    ['SmallTile.scale-200.png', 'c6c02851922dd77bae64be381cdca0989f9c85bc559a97b7170b6ed1fa51631b'],
    ['SmallTile.scale-400.png', 'e6393e0e92a1a13ef746220b2e3f4de1be615467928fb14cda31bd9ce3bbf6f6'],
    ['SplashScreen.scale-100.png', 'b14723aadc2aa502068fe0d4591aeeb85fa9b39bd80f8fdb98f08453f32be84a'],
    ['SplashScreen.scale-125.png', '1895f1d1e6e5d1fed7d53625874cd16049bb794865ff6643138f4cb9ed2c2dd8'],
    ['SplashScreen.scale-150.png', '2726cc22d631542fcc50fb2e7e8e3b3aaab22ae171df16203e1d092a6f98ccc6'],
    ['SplashScreen.scale-200.png', '6f1febd951159da1d85d3ab7e14176e4e1f0ac19aed0735438fce30f106ba00e'],
    ['SplashScreen.scale-400.png', '0a8191194aab269c0d93b41eca96f0f918cf9f312c627e836c47ffc9c0f0581f'],
    ['Square150x150Logo.scale-100.png', '594ad7bfbe0b6d6fb68a7069ab5b7d9dd596b4b61aba7fa4312946e277553a2d'],
    ['Square150x150Logo.scale-125.png', '3d3204083970e8c6bb93393f1a17ac22d7017fb0daaf594478fc0b82b3feb1fe'],
    ['Square150x150Logo.scale-150.png', '9baf6a497275ce828a8bf0d36c8d38965dcebb32b5ede5a4d28565b021497fb5'],
    ['Square150x150Logo.scale-200.png', '6c01a5dfb73e78081069badee32dae3dd0a21119e93a71c96e9e4af1fe9e77cc'],
    ['Square150x150Logo.scale-400.png', '8ef20cdf44f2060953c5f3c7c463df966581ef1541756d0de1eacd9e74019933'],
    ['Square44x44Logo.altform-lightunplated_targetsize-16.png', '653f8f864f476aa5e467afe7096658a6405c899713b3adb29ff785441d700a98'],
    ['Square44x44Logo.altform-lightunplated_targetsize-24.png', '19d9902f8f60ffcdaf13e67ea5ae073f44a2c9bea08b22ab99e250937cb22aac'],
    ['Square44x44Logo.altform-lightunplated_targetsize-256.png', '828af4d84d0ea621a40d6f0eba9b96e31ca75bb9a0c44fb622220be3a4f17909'],
    ['Square44x44Logo.altform-lightunplated_targetsize-32.png', '8427564bc23bd3b73a2c96ee180b6f889f79c8fec388587d49f56013cd3e3375'],
    ['Square44x44Logo.altform-lightunplated_targetsize-48.png', '332c77d0ebd2b274d13dd4cae9f73ff5de3196284f535446f5627417a59363fa'],
    ['Square44x44Logo.altform-unplated_targetsize-16.png', '653f8f864f476aa5e467afe7096658a6405c899713b3adb29ff785441d700a98'],
    ['Square44x44Logo.altform-unplated_targetsize-256.png', '828af4d84d0ea621a40d6f0eba9b96e31ca75bb9a0c44fb622220be3a4f17909'],
    ['Square44x44Logo.altform-unplated_targetsize-32.png', '8427564bc23bd3b73a2c96ee180b6f889f79c8fec388587d49f56013cd3e3375'],
    ['Square44x44Logo.altform-unplated_targetsize-48.png', '332c77d0ebd2b274d13dd4cae9f73ff5de3196284f535446f5627417a59363fa'],
    ['Square44x44Logo.scale-100.png', '2e37ee75f955b8a447e5c4421fe4e4cf78609f5494d84d34ddd99837e1e6493b'],
    ['Square44x44Logo.scale-125.png', '683265a41e5a1255a4e66a1c915a77ee79eed22aa990d91093fe4a6a27820904'],
    ['Square44x44Logo.scale-150.png', '99ea6d6d7ce128bf65e56c1ef19cda1183e31afb0e2abc92f5afca6ef4717a8a'],
    ['Square44x44Logo.scale-200.png', 'fba2797ad6b0a71141cc68fc329979445ff95d8ae9e9627d27ecdc9e9a26e6f4'],
    ['Square44x44Logo.scale-400.png', '4f8a5ca11ca0e6f65baf0dbea56889fdc09b3a167586eabbb65c875d06f77d80'],
    ['Square44x44Logo.targetsize-16.png', 'deb8c394594ffe18eb7522604b42330a669bee3827f03d8156462391694b8bbd'],
    ['Square44x44Logo.targetsize-24.png', '691a0b1bcc0c2a94715906f5ea9517e8d9ac3041ff36bdd82fe9b4ec77ec0207'],
    ['Square44x44Logo.targetsize-24_altform-unplated.png', '19d9902f8f60ffcdaf13e67ea5ae073f44a2c9bea08b22ab99e250937cb22aac'],
    ['Square44x44Logo.targetsize-256.png', 'f84a21762583e622ceba4089393130ce43efbaaafbec4bd785eadc56df822906'],
    ['Square44x44Logo.targetsize-32.png', '04c8b882b7b6ac1bf75db035eb305181f77c1f267c72902511b85aedc39ffae6'],
    ['Square44x44Logo.targetsize-48.png', '0eaf431dfb4fd1a11dcfb7962d59e023ff29fc38909da08310417c2ba1b96ddc'],
    ['StoreLogo.backup.png', '332c77d0ebd2b274d13dd4cae9f73ff5de3196284f535446f5627417a59363fa'],
    ['StoreLogo.scale-100.png', 'af912848b38c4589c1bea1bad34a47223b090211950b785e4502af978add8054'],
    ['StoreLogo.scale-125.png', 'b692310f82e1664493824928e48889a2fece31ed864cbbf9d0639965bdefa02c'],
    ['StoreLogo.scale-150.png', '70602b62726a09cc8225dc8878c2dd38a83e694cfca9a352a0a9bb25c79d3ed2'],
    ['StoreLogo.scale-200.png', '58428effaf6a21d733fcd4ffb2e1feb60ff6124e1ed32f88a976fd603c60672c'],
    ['StoreLogo.scale-400.png', 'e34b8c8e93b3bca3fb2e3215b735a22ff6919d96eb6b21f62c8b150d9c3345d5'],
    ['Wide310x150Logo.scale-100.png', '9847a5513847a0f66b014f97451a58274b9dfcfea48c319575976c75e35e75e7'],
    ['Wide310x150Logo.scale-125.png', 'a797a20626d71cd2d412ca9a401d083eb4a837216533b52364a843582053c0f8'],
    ['Wide310x150Logo.scale-150.png', '73f2eb1dc0676e69c431d836f9dde3f35426192916484bd61f5e69fe09eb83f3'],
    ['Wide310x150Logo.scale-200.png', 'b14723aadc2aa502068fe0d4591aeeb85fa9b39bd80f8fdb98f08453f32be84a'],
    ['Wide310x150Logo.scale-400.png', '6f1febd951159da1d85d3ab7e14176e4e1f0ac19aed0735438fce30f106ba00e'],
  ]),
});

/** Pure. The tile members a manifest reference names: the file itself, or its
 *  resource-qualified variants (`X.scale-200.png`, `X.targetsize-16_altform-unplated.png`). */
export function tileMembersFor(ref, names) {
  const norm = ref.replace(/\\/g, '/');
  const stem = norm.replace(/\.png$/i, '');
  return names.filter((n) => n === norm || (n.startsWith(`${stem}.`) && /\.png$/i.test(n)));
}

/**
 * Pure. Limb 3 over one package: every referenced tile resolves to at least one
 * member, and no member's sha256 is in `table`. `entries` is unzip()'s output.
 */
export function tileProblems(rel, entries, tileRefs, table = MSIX_PLUGIN_DEFAULT_TILE_HASHES) {
  const problems = [];
  const byHash = new Map();
  for (const [file, hash] of table.files) byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
  const names = entries.map((e) => e.name);
  let graded = 0;
  for (const ref of tileRefs) {
    const members = tileMembersFor(ref, names);
    if (members.length === 0) {
      problems.push(`${rel} — the manifest references ${JSON.stringify(ref)} and the package holds no file for it, so that tile cannot be graded.`);
      continue;
    }
    for (const name of members) {
      const entry = entries.find((e) => e.name === name);
      if (!entry || entry.bytes === null) {
        problems.push(`${rel} — tile ${name} could not be decoded, so its bytes were not compared with the plugin defaults.`);
        continue;
      }
      graded++;
      const hash = createHash('sha256').update(entry.bytes).digest('hex');
      const same = byHash.get(hash);
      if (same) {
        problems.push(
          `${rel} — tile ${name} is byte-identical to msix ${table.version}'s default ${same.join(', ')}. ` +
            'That is the placeholder every app gets when `msix_config.logo_path` is absent; point it at the app\'s own mark.',
        );
      }
    }
  }
  if (tileRefs.length === 0) problems.push(`${rel} — the manifest references no .png at all, so the package carries no tile to grade.`);
  return { problems, graded };
}

/** Pure. `msix_config.logo_path` out of a pubspec's text, or null. Scoped to the
 *  `msix_config:` block, so a `logo_path:` under another key cannot answer. */
export function msixLogoPath(pubspecText) {
  const lines = pubspecText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^msix_config:\s*$/.test(l));
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = /^ {2}logo_path:\s*(.*?)\s*$/.exec(l);
    if (m) {
      const v = m[1].replace(/^(["'])(.*)\1$/, '$2');
      return v === '' ? null : v;
    }
  }
  return null;
}

/** Pure. The `msix` version a pubspec.lock pins, or null. */
export function pinnedMsixVersion(lockText) {
  const m = /^ {2}msix:\r?\n(?: {4}.*\r?\n)*? {4}version: "([^"]+)"/m.exec(lockText);
  return m ? m[1] : null;
}

/**
 * Pure. Split argv into the `--repo-root` value and the positional package paths.
 *
 * 🔴 THIS IS A FUNCTION BECAUSE ITS ONE-LINE PREDECESSOR SHIPPED A BUG THAT NO
 * TEST COULD REACH. It read:
 *
 *     const rootIdx = argv.indexOf('--repo-root');            // -1 when ABSENT
 *     const packages = argv.filter((a, i) => !a.startsWith('--') && i !== rootIdx + 1);
 *
 * With `--repo-root` absent, `rootIdx` is -1, so `rootIdx + 1` is 0 and the
 * filter dropped index 0 — the FIRST positional. CI passes exactly one
 * positional and no `--repo-root` (build-platforms.yml, "The MSIX carries the
 * identity the register declares"), so the only path it had was discarded and
 * the guard reported COVERAGE LOST while the packaging step had done its job.
 * Every test in the suite passed `--repo-root`, which is the shape that hides it.
 *
 * `rootFlagSeen` and `rootArg` are kept SEPARATE so "no flag" (use the default
 * root) and "flag with nothing usable after it" (the caller asked for a root and
 * named none) cannot collapse into the same answer.
 */
export function parseArgs(argv) {
  const packages = [];
  let rootFlagSeen = false;
  let rootArg;
  let app;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // `--app` takes its value the way `--repo-root` does, and for the same
    // reason: a value left in the positional list would be graded as a package.
    if (a === '--app') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        app = next;
        i++;
      }
      continue;
    }
    if (a === '--repo-root') {
      rootFlagSeen = true;
      const next = argv[i + 1];
      // A following flag is not a path. Consuming one would silently root the
      // whole comparison at a string like "--verbose".
      if (next !== undefined && !next.startsWith('--')) {
        rootArg = next;
        i++;
      }
      continue;
    }
    if (a.startsWith('--')) continue;
    packages.push(a);
  }
  return { rootFlagSeen, rootArg, packages, app };
}

function coverageLost(first, ...more) {
  console.error(`✗ COVERAGE LOST — ${first}`);
  for (const m of more) console.error(`    ${m}`);
  console.error('  A package nobody opened is not a package anybody checked.');
  console.error('assert-artifact-signed-msix: FAILED');
  // ⏱ 2026-09-16 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const { rootFlagSeen, rootArg, packages, app } = parseArgs(argv);
  if (rootFlagSeen && rootArg === undefined) {
    coverageLost(
      '`--repo-root` was given with no path after it, so the root to compare against is unknown.',
      `The ${argv.length} argument(s) received were: ${argv.map((a) => JSON.stringify(a)).join(' ')}.`,
      'Falling back to the default root here would compare the package against a register the caller did',
      'not choose, and report that as a verdict.',
    );
  }
  const ROOT = resolve(rootArg === undefined ? join(dirname(fileURLToPath(import.meta.url)), '..', '..') : rootArg);

  // No package given is COVERAGE LOST, never a pass. The whole defect class
  // here is a check that ranged over nothing while printing a verdict.
  if (packages.length === 0) {
    // 🔴 THIS MESSAGE PRINTS THE ARGV AND DIAGNOSES NOTHING ELSE. It used to say
    // "the packaging step produced no path to hand over, which is itself the
    // finding" — a false diagnosis that sent every reader upstream to a step
    // this guard cannot see and which, on run 32699518559, had SUCCEEDED. What
    // is observable at this line is the argument list and nothing more, so that
    // is what it shows.
    coverageLost(
      'no .msix path was given, so this guard would certify the empty set.',
      `The ${argv.length} argument(s) this process received were: ${argv.length === 0 ? '(none)' : argv.map((a) => JSON.stringify(a)).join(' ')}.`,
      'That list is the whole of what is observable here — this guard cannot see whether `Package MSIX`',
      'succeeded, so it does not claim to. Read the list directly: if it ALREADY NAMES a .msix path then',
      'the path arrived and argument parsing dropped it, which is a defect in this file; if it is empty or',
      'flags-only, the caller in build-platforms.yml sent no path.',
    );
  }

  const registerAbs = join(ROOT, REGISTER_REL);
  if (!existsSync(registerAbs)) coverageLost(`${REGISTER_REL} does not exist under ${ROOT}, so no identity is declared to compare against.`);
  let register;
  try {
    register = JSON.parse(readFileSync(registerAbs, 'utf8'));
  } catch (e) {
    coverageLost(`${REGISTER_REL} is not valid JSON (${e.message}).`);
  }
  const row = (register.channels ?? []).find((c) => c && c.id === CHANNEL_ID);
  if (!row) coverageLost(`${REGISTER_REL} declares no channel "${CHANNEL_ID}", so the identity this package must carry is unknown.`);
  const declared = row.packageIdentity;
  if (!declared || typeof declared !== 'object') {
    coverageLost(
      `channel "${CHANNEL_ID}" declares no \`packageIdentity\`.`,
      'It is the SINGLE declaration of this identity. With it absent every comparison below would pass by',
      'having nothing to disagree with.',
    );
  }
  for (const [regField] of IDENTITY_FIELDS) {
    if (typeof declared[regField] !== 'string' || declared[regField].trim() === '') {
      coverageLost(`${REGISTER_REL} packageIdentity.${regField} is missing or empty — a hole, not a placeholder.`);
    }
  }

  const problems = [];
  const prints = [];
  const graded = [];
  let opened = 0;

  for (const rel of packages) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(abs)) {
      problems.push(`${rel} — no such file. The packaging step is declared to have produced it.`);
      continue;
    }
    const entries = unzip(readFileSync(abs));
    if (entries === null) {
      // "Could not open" and "is wrong" must never share an exit code, but this
      // one IS a failure: an .msix that is not a readable zip is not a package.
      problems.push(`${rel} — could not be read as a zip. An .msix IS a zip; one that will not open is not a package a store can accept.`);
      continue;
    }
    opened++;

    const unsupported = entries.filter((e) => e.unsupportedMethod !== undefined);
    for (const u of unsupported) {
      prints.push(`${rel} — member "${u.name}" uses compression method ${u.unsupportedMethod}, which the reader does not decode. It is named rather than skipped.`);
    }

    // ── the signature must be ABSENT, and that is the positive proof ────────
    const signature = entries.find((e) => e.name.split('/').pop() === SIGNATURE_MEMBER);
    if (signature) {
      problems.push(
        `${rel} — carries ${SIGNATURE_MEMBER}. apps/*/pubspec.yaml sets \`store: true\`, under which \`msix\` ` +
          'skips signing because the Store re-signs. A signature here means store mode did NOT take effect, and ' +
          'the likeliest cause is the test certificate `store: false` re-introduces — one nobody owns and the ' +
          'Store will reject.',
      );
    }

    const manifest = entries.find((e) => e.name.split('/').pop() === MANIFEST_MEMBER && e.bytes !== null);
    if (!manifest) {
      problems.push(`${rel} — holds ${entries.length} member(s) and no readable ${MANIFEST_MEMBER}. Every .msix carries one; without it the identity is unreadable.`);
      continue;
    }
    const seen = readIdentity(manifest.bytes.toString('utf8'));
    graded.push({ rel, entries, visual: readVisualIdentity(manifest.bytes.toString('utf8')) });
    if (seen === null) {
      problems.push(`${rel} — ${MANIFEST_MEMBER} carries no <Identity> element, so the packaged identity cannot be read.`);
      continue;
    }

    for (const [regField, seenField, where] of IDENTITY_FIELDS) {
      const want = declared[regField];
      const got = seen[seenField];
      if (got === null) {
        problems.push(`${rel} — ${where} is absent from ${MANIFEST_MEMBER}; ${REGISTER_REL} declares ${JSON.stringify(want)}.`);
      } else if (got !== want) {
        problems.push(
          `${rel} — ${where} is ${JSON.stringify(got)} and ${REGISTER_REL} declares ${JSON.stringify(want)}. ` +
            'Partner Center binds the identity to the PRODUCT, not to the upload, so a package submitted under the ' +
            'wrong one is unrecoverable rather than re-uploadable.',
        );
      }
    }

    if (seen.version) prints.push(`${rel} — Package/Identity/@Version is ${JSON.stringify(seen.version)}, read and printed; nothing in the register declares it, so it is reported rather than compared.`);
    if (declared.notYetConfiguredSentinel && seen.identityName === declared.notYetConfiguredSentinel) {
      prints.push(
        `${rel} — the packaged identity is the NOT-YET-CONFIGURED sentinel ${JSON.stringify(declared.notYetConfiguredSentinel)}, ` +
          'which matches the register and is the correct state until OWNER_QUEUE A-2 assigns the real values. ' +
          'This package cannot be submitted, and it is not pretending it can.',
      );
    }
  }

  if (opened === 0) {
    for (const p of problems) console.error(`FAIL ${p}`);
    coverageLost(
      `${packages.length} package path(s) were given and NOT ONE opened as a zip.`,
      'Every assertion above ranged over an empty set, which looks exactly like a clean run.',
    );
  }

  // ── what a person sees: the title, the label, the tiles (limbs 1-4) ──────
  if (app === undefined) {
    coverageLost(
      '`--app <id>` was not given, so the title, the launcher label and the logo this package must carry are unknown.',
      'The identity above was graded; the half a reviewer reads first was not.',
    );
  }
  const appRel = `${APPS_DIR}/${app}`;
  if (typeof row.storeMetadataDir !== 'string' || !row.storeMetadataDir.includes('{app}')) {
    coverageLost(`channel "${CHANNEL_ID}" declares no \`storeMetadataDir\` with an {app} slot, so the app's store title cannot be found.`);
  }
  const titleRel = `${row.storeMetadataDir.replace('{app}', app)}/title.txt`;
  if (!existsSync(join(ROOT, titleRel))) coverageLost(`${titleRel} does not exist, so the Store title the package must carry is unknown.`);
  const title = readFileSync(join(ROOT, titleRel), 'utf8').trim();
  if (title === '') coverageLost(`${titleRel} is empty — a hole, not a title.`);
  let declaration;
  try {
    declaration = readDeclaration(ROOT, app);
  } catch (e) {
    coverageLost(`${appRel}/app.yaml could not be read (${e.message}), so the launcher label is unknown.`);
  }
  const label = declaration && declaration.shortName;
  if (typeof label !== 'string' || label === '') {
    coverageLost(`${appRel}/app.yaml declares no \`shortName\`, so the Start-menu label (ADR 074) this package must carry is unknown.`);
  }
  const lockText = existsSync(join(ROOT, 'pubspec.lock')) ? readFileSync(join(ROOT, 'pubspec.lock'), 'utf8') : '';
  const pinned = pinnedMsixVersion(lockText);
  if (pinned !== MSIX_PLUGIN_DEFAULT_TILE_HASHES.version) {
    coverageLost(
      `pubspec.lock pins msix ${pinned === null ? '(no msix entry found)' : pinned} and MSIX_PLUGIN_DEFAULT_TILE_HASHES was measured from ` +
        `${MSIX_PLUGIN_DEFAULT_TILE_HASHES.version}, so the default tiles of the plugin that built this package are unknown.`,
      'Re-measure the table from the pinned version in the pub cache and move its `version` with it.',
    );
  }

  let tilesGraded = 0;
  for (const { rel, entries, visual } of graded) {
    if (visual.displayName === null) {
      problems.push(`${rel} — Package/Properties/DisplayName is absent; ${titleRel} declares ${JSON.stringify(title)}.`);
    } else if (visual.displayName !== title) {
      problems.push(
        `${rel} — Package/Properties/DisplayName is ${JSON.stringify(visual.displayName)} and ${titleRel} declares ` +
          `${JSON.stringify(title)}. This is the name the Store lists the package under; Partner Center refuses a ` +
          'package whose DisplayName is not a name reserved for the product.',
      );
    }
    if (!visual.hasVisualElements) {
      problems.push(`${rel} — carries no uap:VisualElements, so no Start-menu entry; ${appRel}/app.yaml declares the label ${JSON.stringify(label)}.`);
    } else if (visual.visualDisplayName !== label) {
      problems.push(
        `${rel} — uap:VisualElements/@DisplayName is ${JSON.stringify(visual.visualDisplayName)} and ${appRel}/app.yaml ` +
          `declares \`shortName: ${label}\` (ADR 074: the launcher label). tooling/store/msix-visual-name.mjs sets it in the ` +
          'packaging step; a package that skipped it shows the Store title under its tile.',
      );
    }
    if (visual.tileShortName !== null && visual.tileShortName !== label) {
      problems.push(`${rel} — uap:DefaultTile/@ShortName is ${JSON.stringify(visual.tileShortName)} and the declared label is ${JSON.stringify(label)}.`);
    }
    const tiles = tileProblems(rel, entries, visual.tileRefs);
    problems.push(...tiles.problems);
    tilesGraded += tiles.graded;
  }

  const pubspecRel = `${appRel}/pubspec.yaml`;
  if (!existsSync(join(ROOT, pubspecRel))) coverageLost(`${pubspecRel} does not exist, so the logo the package was built from is unknown.`);
  const logoPath = msixLogoPath(readFileSync(join(ROOT, pubspecRel), 'utf8'));
  if (logoPath === null) {
    problems.push(
      `${pubspecRel} — msix_config sets no \`logo_path\`, so \`msix\` builds every tile from its own bundled placeholder. ` +
        "Point it at the app's own mark.",
    );
  } else if (!existsSync(join(ROOT, appRel, logoPath))) {
    problems.push(`${pubspecRel} — msix_config.logo_path is ${JSON.stringify(logoPath)} and ${appRel}/${logoPath} does not exist.`);
  }

  if (prints.length) {
    console.log('   ── printed, not failed ──');
    for (const p of prints) console.log(`   ⬜ ${p}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error('assert-artifact-signed-msix: FAILED');
    process.exit(1);
  }
  console.log(
    `ok  msix identity — ${opened} package(s) opened; each carries the ${IDENTITY_FIELDS.length} identity field(s) ` +
      `${REGISTER_REL} declares for "${CHANNEL_ID}" and NO ${SIGNATURE_MEMBER}, which is the positive evidence that ` +
      '`store: true` took effect and the Store will re-sign [pipeline F-2]',
  );
  console.log(
    `ok  msix face — the Store title ${JSON.stringify(title)}, the launcher label ${JSON.stringify(label)}, ` +
      `${tilesGraded} tile file(s) none of which is an msix ${MSIX_PLUGIN_DEFAULT_TILE_HASHES.version} default, and ` +
      `logo_path ${JSON.stringify(logoPath)} [O-MSIX-IDENTITY-UNGRADED]`,
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
