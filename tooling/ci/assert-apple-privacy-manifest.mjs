#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-apple-privacy-manifest.mjs — the Apple half of "a store declaration is
// a sworn statement about what the code does".
//
// [G-49] Apple's enforcement is at UPLOAD, not review: "Starting May 1, 2024,
// apps that don't describe their use of required reason API in their privacy
// manifest file aren't accepted by App Store Connect." Nothing in App Store
// Connect watches a repository, so the only place the manifest can be kept true
// is here, on every commit — the same argument assert-play-declarations.mjs
// makes about the Data safety form, applied to the artefact that gates the first
// byte reaching Apple at all.
//
// ── WHAT IS CHECKED, IN THE ORDER A REAL DRIFT WOULD HIT IT ─────────────────
//   1. REGENERATE AND COMPARE. Both `PrivacyInfo.xcprivacy` files are re-derived
//      from `store/ios-appstore/privacy-manifest.json` and compared BYTE FOR
//      BYTE. A hand edit to either is a build failure. Never a checksum stored
//      beside the data — the same argument as assert-enforcement-index.mjs: a
//      digest next to the thing it digests is one edit away from agreeing with
//      whatever replaced it.
//   2. BUNDLE MEMBERSHIP. Each manifest is referenced by its
//      `Runner.xcodeproj/project.pbxproj` AND is in the **Runner** target's
//      `PBXResourcesBuildPhase`. 🔴 THE iOS PROJECT HAS TWO RESOURCES PHASES AND
//      THE EMPTY ONE IS RunnerTests. Asserting that the string appears somewhere
//      in the file passes over exactly the mistake that matters — a manifest on
//      disk and not in the bundle is the silent half of this failure, because
//      the repository looks completely correct while Apple receives nothing. So
//      the phase is reached THROUGH the Runner target's `buildPhases` list, and
//      the build file is resolved through `fileRef` to a real `PBXFileReference`.
//      The same parse also requires the header's named source files to EQUAL the
//      Runner target's `PBXSourcesBuildPhase` set — the generator owns the
//      sentence's ORDER, the tree owns its MEMBERSHIP.
//   3. CLOSED VOCABULARY. Every declared category, reason code, collected-data
//      type and purpose must appear in the audit's `vocabulary` block, and every
//      reason code must belong to the category it is declared under. A misspelt
//      constant is a plist key Apple IGNORES, not an error it reports, which is
//      why this is a build failure rather than something a submission surfaces.
//      Constants whose `witness` is `knowledge` — never read out of a real
//      manifest on this machine — are PRINTED, not failed: the audit states in
//      as many words that no local witness exists for any collected-data-type
//      constant, and failing on that would fail on correct input.
//   4. THE PLUGIN-SET EQUALITY. The iOS and macOS plugin sets are derived from
//      `.flutter-plugins-dependencies` and must EQUAL the audit's
//      `binaryInventory` rows. 🔴 EQUALITY, NOT SUBSET, AND THE DIFFERENCE IS
//      THE WHOLE LIMB. A subset check answers "did anything FORBIDDEN appear",
//      which needs a forbidden list that can never be complete. Equality answers
//      "did anything appear AT ALL", so a new plugin fails with `nobody said
//      what required-reason APIs this uses` — the only honest thing to say about
//      a binary nobody has audited. Versions are cross-checked against
//      `pubspec.lock` for the same reason: 9.2.4's manifest is not 9.3.0's.
//   5. THE CROSS-FILE CONTRADICTION. The App Privacy answers and the Play Data
//      safety answers are the same sworn claim asked twice by two companies,
//      months apart. Every row here names a `fromPlayRow`; the set of Play rows
//      `collected` under `buildPosture.current` must EQUAL that set, and the
//      posture itself must match. Answering the two inconsistently is invisible
//      to a human and obvious to a comparison. Same relation limb (E) of
//      assert-play-declarations.mjs already holds between Data safety and the
//      content rating.
//   6. TRACKING COHERENCE, ASSERTED AS A PAIR. `NSPrivacyTracking` false with a
//      non-empty `NSPrivacyTrackingDomains` is a contradiction Apple names, and
//      so is a row carrying `NSPrivacyCollectedDataTypeTracking` true under it.
//      Checking the two fields separately would pass both halves of a broken
//      pair — each field is individually well-formed; it is the RELATION that is
//      false.
//   7. NOT-EMPTY / NOT-VACUOUS. No audit, an empty `binaryInventory`, no
//      collected rows, no app directory, or zero manifests actually compared is
//      COVERAGE LOST, not a pass. A scan over nothing prints ok — this
//      repository's single most repeated defect.
//
// ── ⚠️ WHAT THIS GUARD CANNOT SEE, PRINTED ON EVERY RUN ─────────────────────
// Not buried in this header, because a header is read once and a green line is
// read every day. The wording comes from the audit's own `cannotSee` and
// `unresolved` blocks rather than being restated here, so the two cannot drift:
// the CocoaPods closure (Sentry-Cocoa 8.58.4's own manifest and signature were
// never fetched — the audit ran on Windows), the built `.app` bundle (Apple
// assembles its aggregate report from what is EMBEDDED, and no compiled bundle
// has been inspected on any platform), and U-1 (whether Apple's upload scan
// attributes a dynamic `objc_msgSend` to App.framework, which is not knowable
// outside App Store Connect).
//
// Usage:  node tooling/ci/assert-apple-privacy-manifest.mjs [repoRoot]
// Exit:   0 = both manifests re-derive, are in the bundle, and agree with Play
//         1 = drift, contradiction, or a scan that could not be trusted
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// NOT `readdirSync` — a raw listing descends into a nested checkout (a git
// worktree, a submodule, a stray clone) and reads another repository's files as
// this tree's. THE one directory listing.
import { listDir } from './tree-walk.mjs';
// The generator, imported rather than reimplemented. A guard with its own idea
// of what the file should contain certifies its own misunderstanding — and this
// repository has already paid for a fixture that encoded the same mistake as the
// check it was testing. One serialisation, one source-file table, one set of
// paths, used by the thing that writes and the thing that judges.
import {
  AUDIT_REL,
  MANIFEST_REL,
  PBXPROJ_REL,
  PLATFORMS,
  APP_TARGET_NAME,
  APP_TARGET_SOURCES,
  AppleManifestUnavailable,
  readAudit,
  renderAll,
} from '../store/render-apple-privacy-manifest.mjs';

const repoRoot = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? process.cwd());
const APPS = join(repoRoot, 'apps');

const problems = [];
const prints = [];
const warnings = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
function coverageLost(lines) {
  console.error(`COVERAGE LOST: ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
}

const sameSet = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const sorted = (it) => [...new Set(it)].sort();

// ─────────────────────────────────────────────────────────────────────────────
// A MINIMAL PLIST READER — enough for the shape this repository generates.
//
// 🔴 THE ASSERTIONS BELOW RUN ON PARSED STRUCTURE, NEVER ON GREPPED PROSE. The
// rendered file opens with a twenty-line comment that names
// `NSPrivacyAccessedAPICategoryUserDefaults`, `CA92.1` and `1C8F.1` in a
// sentence explaining why they are NOT declared. A text search for a constant
// finds the explanation and concludes the opposite of what the file says — the
// exact failure assert-clone-contract.mjs already recorded once, where a grep
// matched the comment saying why the key was absent.
// ─────────────────────────────────────────────────────────────────────────────

class PlistUnreadable extends Error {}

/** `<plist>`'s single root value, as JS. Objects for `<dict>`, arrays for
 *  `<array>`, strings, booleans. Comments and the XML/DOCTYPE prologue are
 *  skipped. Anything unexpected THROWS rather than being ignored: a tag this
 *  reader silently dropped would be a declaration the guard cannot see. */
export function parsePlist(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt);
      if (end === -1) throw new PlistUnreadable('unterminated comment');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      if (end === -1) throw new PlistUnreadable('unterminated prologue');
      i = end + 1;
      continue;
    }
    const gt = text.indexOf('>', lt);
    if (gt === -1) throw new PlistUnreadable('unterminated tag');
    const raw = text.slice(lt + 1, gt).trim();
    const selfClosing = raw.endsWith('/');
    const name = (selfClosing ? raw.slice(0, -1) : raw).trim().split(/\s+/)[0];
    const closing = name.startsWith('/');
    tokens.push({ name: closing ? name.slice(1) : name, closing, selfClosing, at: gt + 1 });
    i = gt + 1;
  }

  const unescape = (s) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  let t = 0;
  const textBetween = (from, to) => text.slice(from, to);

  function readValue() {
    if (t >= tokens.length) throw new PlistUnreadable('value expected, end of document');
    const tok = tokens[t++];
    if (tok.closing) throw new PlistUnreadable(`unexpected </${tok.name}>`);
    switch (tok.name) {
      case 'true':
        if (!tok.selfClosing) throw new PlistUnreadable('<true> must be self-closing');
        return true;
      case 'false':
        if (!tok.selfClosing) throw new PlistUnreadable('<false> must be self-closing');
        return false;
      case 'string': {
        if (tok.selfClosing) return '';
        const close = tokens[t];
        if (!close || !close.closing || close.name !== 'string') throw new PlistUnreadable('unterminated <string>');
        // The token's `at` is the offset just past its own `>`; the closing
        // token's start is `at` minus the length of `</string>`.
        const value = textBetween(tok.at, close.at - '</string>'.length);
        t++;
        return unescape(value);
      }
      case 'array': {
        if (tok.selfClosing) return [];
        const out = [];
        while (t < tokens.length && !(tokens[t].closing && tokens[t].name === 'array')) out.push(readValue());
        if (t >= tokens.length) throw new PlistUnreadable('unterminated <array>');
        t++;
        return out;
      }
      case 'dict': {
        if (tok.selfClosing) return {};
        const out = {};
        while (t < tokens.length && !(tokens[t].closing && tokens[t].name === 'dict')) {
          const keyTok = tokens[t++];
          if (keyTok.name !== 'key' || keyTok.closing) throw new PlistUnreadable('<dict> expects <key>');
          const close = tokens[t];
          if (!close || !close.closing || close.name !== 'key') throw new PlistUnreadable('unterminated <key>');
          const key = unescape(textBetween(keyTok.at, close.at - '</key>'.length));
          t++;
          out[key] = readValue();
        }
        if (t >= tokens.length) throw new PlistUnreadable('unterminated <dict>');
        t++;
        return out;
      }
      default:
        throw new PlistUnreadable(`unsupported <${tok.name}> — this reader must not silently drop a declaration`);
    }
  }

  while (t < tokens.length && tokens[t].name !== 'plist') t++;
  if (t >= tokens.length) throw new PlistUnreadable('no <plist> element');
  t++;
  return readValue();
}

// ─────────────────────────────────────────────────────────────────────────────
// A TARGETED pbxproj READER.
//
// It is a real parse — objects, `isa`, name, and the two list fields limb 2
// needs — with braces matched OUTSIDE strings and comments, because a
// `shellScript = "…{…}…";` value in every Flutter project would otherwise close
// an object early and silently truncate the object table. Truncation here would
// LOSE the Runner target, and a lost target reads exactly like a missing
// manifest, so this is the one place a lazy reader would produce a confident
// wrong answer in both directions.
// ─────────────────────────────────────────────────────────────────────────────

/** Every `<24-hex> = { … }` object in the file, keyed by id. */
export function parsePbxproj(text) {
  // 🔴 THE COMMENT CLAUSE IS `(?:[^*]|\*(?!\/))*`, NOT `[\s\S]*?`, AND THE
  // DIFFERENCE WAS A LIVE BUG. A lazy any-character run still backtracks PAST
  // the first `*/` when that makes the whole pattern match, so
  // `<id> /* Foo.swift */; };\n\t\t<id2> /* Bar in Sources */ = {` matched with
  // the FIRST id and swallowed the second object whole. Measured on
  // apps/subly/macos: 74 "objects", the PBXNativeTarget section entirely
  // absent, and the guard reported COVERAGE LOST — which is the good outcome
  // only because it refuses rather than guesses. The clause below cannot cross
  // a `*/`, so an id is only an object header when the very next thing after
  // its own annotation is `= {`.
  const re = /(?:^|[\n;(])\s*([0-9A-Fa-f]{24})\s*(?:\/\*(?:[^*]|\*(?!\/))*\*\/\s*)?=\s*\{/g;
  let m;
  const out = new Map();
  while ((m = re.exec(text)) !== null) {
    const bodyStart = m.index + m[0].length;
    const bodyEnd = matchBrace(text, bodyStart);
    if (bodyEnd === -1) continue;
    const body = text.slice(bodyStart, bodyEnd);
    // The scan continues INSIDE each body rather than skipping past it, so an
    // object declared within another is still found.
    re.lastIndex = bodyStart;
    // 🔴 AN OBJECT IS A BLOCK WITH AN `isa`, AND THAT CLAUSE WAS THE SECOND LIVE
    // BUG. `PBXProject` carries
    //     attributes = { TargetAttributes = { <targetId> = { … }; }; };
    // which re-uses THE NATIVE TARGET'S OWN ID for a plain settings dictionary
    // with no `isa`. Keying without this test let that inner block overwrite the
    // real target, and the guard reported `no PBXNativeTarget was found` on a
    // project containing two. It refused rather than guessing, which is the only
    // reason the bug surfaced as a message instead of as a green run over the
    // wrong build phase.
    const isa = scalarField(body, 'isa');
    if (isa === null) continue;
    out.set(m[1], {
      id: m[1],
      isa,
      name: scalarField(body, 'name'),
      path: scalarField(body, 'path'),
      fileRef: scalarField(body, 'fileRef'),
      buildPhases: listField(body, 'buildPhases'),
      files: listField(body, 'files'),
    });
  }
  return out;
}

/** Index of the `}` closing the block that starts at `from`, skipping quoted
 *  strings (with backslash escapes) and `/* … *\/` comments. */
function matchBrace(text, from) {
  let depth = 1;
  let i = from;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** `key = value;` at this object's own level — quoted or bare, comment stripped. */
function scalarField(body, key) {
  const re = new RegExp(`(?:^|[;{\\s])${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|[^;]*?)\\s*(?:/\\*[\\s\\S]*?\\*/\\s*)?;`);
  const m = body.match(re);
  if (!m) return null;
  const raw = m[1].trim().replace(/\s*\/\*[\s\S]*?\*\/\s*$/, '').trim();
  return raw.startsWith('"') ? raw.slice(1, -1) : raw;
}

/** `key = ( a, b, c );` reduced to the 24-hex ids it names. */
function listField(body, key) {
  const at = body.search(new RegExp(`(?:^|[;{\\s])${key}\\s*=\\s*\\(`));
  if (at === -1) return null;
  const open = body.indexOf('(', at);
  let depth = 1;
  let i = open + 1;
  while (i < body.length && depth > 0) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') depth--;
    i++;
  }
  const inner = body.slice(open + 1, i - 1);
  return [...inner.matchAll(/([0-9A-Fa-f]{24})/g)].map((x) => x[1]);
}

/**
 * The one question limb 2 exists to ask, answered structurally.
 *
 * Returns `{ resourceFiles, sourceFiles, referencedPaths, resourcesPhaseCount }`
 * where the first two are the BASENAMES the **Runner** target actually builds.
 */
function readRunnerTarget(pbxText) {
  const objects = parsePbxproj(pbxText);
  if (objects.size === 0) return { error: 'no pbxproj objects could be parsed at all' };
  const targets = [...objects.values()].filter((o) => o.isa === 'PBXNativeTarget');
  if (targets.length === 0) return { error: 'no PBXNativeTarget was found' };
  const runner = targets.find((o) => o.name === APP_TARGET_NAME);
  if (!runner) {
    return { error: `no PBXNativeTarget named ${APP_TARGET_NAME} (found: ${targets.map((t) => t.name).join(', ')})` };
  }
  const phases = (runner.buildPhases ?? []).map((id) => objects.get(id)).filter(Boolean);
  const resolveFiles = (phase) =>
    (phase?.files ?? [])
      .map((id) => objects.get(id))
      .filter((bf) => bf && bf.fileRef)
      .map((bf) => objects.get(bf.fileRef))
      .filter(Boolean)
      .map((ref) => basename(ref.path ?? ref.name ?? ''));
  const resources = phases.find((p) => p.isa === 'PBXResourcesBuildPhase');
  const sources = phases.find((p) => p.isa === 'PBXSourcesBuildPhase');
  if (!resources) return { error: `the ${APP_TARGET_NAME} target has no PBXResourcesBuildPhase in its buildPhases` };
  return {
    resourceFiles: resolveFiles(resources),
    sourceFiles: sources ? resolveFiles(sources) : [],
    hasSourcesPhase: Boolean(sources),
    referencedPaths: [...objects.values()]
      .filter((o) => o.isa === 'PBXFileReference' && o.path)
      .map((o) => basename(o.path)),
    resourcesPhaseCount: [...objects.values()].filter((o) => o.isa === 'PBXResourcesBuildPhase').length,
    resourcesPhaseId: resources.id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SCAN
//
// Wrapped in `main()` and gated on `process.argv[1]` — the same shape
// assert-ops-register.mjs and assert-alert-disposition.mjs already use — so that
// test/apple-privacy-manifest.test.mjs can import `parsePlist` and `parsePbxproj`
// and feed them the REAL pbxproj without the guard exiting the test process. The
// readers are the half of this guard most able to be silently wrong (a truncated
// object table loses the Runner target, and a lost target reads exactly like a
// missing manifest), so they are the half that most needs to be testable
// directly rather than only through an exit code.
// ─────────────────────────────────────────────────────────────────────────────
function main() {
if (!existsSync(APPS)) {
  coverageLost([
    `${APPS} does not exist, so no Apple privacy manifest was examined.`,
    'Apple refuses an upload whose manifest does not describe its required-reason API use, and nothing in',
    'App Store Connect watches a repository. "I could not look" must never read as "nothing was wrong".',
  ]);
}

let appDirs;
try {
  appDirs = listDir(APPS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
} catch (e) {
  coverageLost([`apps/ could not be listed — ${e.message}`]);
}

const subjects = appDirs.filter((a) => existsSync(join(APPS, a, AUDIT_REL)));
if (subjects.length === 0) {
  coverageLost([
    `${appDirs.length} app director${appDirs.length === 1 ? 'y' : 'ies'} under apps/ and NOT ONE carries ${AUDIT_REL}.`,
    'This guard then ranges over nothing and prints ok, which is indistinguishable from every Apple privacy',
    'manifest being correct. If the Apple channels were retired, retire this guard deliberately.',
  ]);
}

let manifestsCompared = 0;
let bundleMembershipsChecked = 0;
let vocabularyConstantsChecked = 0;
let pluginRowsChecked = 0;
let playRowsCompared = 0;

for (const app of subjects) {
  const appDir = join(APPS, app);
  const rel = (p) => `apps/${app}/${p}`.replace(/\\/g, '/');

  // ── the audit ─────────────────────────────────────────────────────────────
  let audit;
  try {
    ({ audit } = readAudit(appDir));
  } catch (e) {
    if (!(e instanceof AppleManifestUnavailable)) throw e;
    // A malformed or vacuous audit is COVERAGE LOST, not a problem in a list:
    // every limb below reads it, so continuing would report a dozen derived
    // failures for one cause and bury the cause.
    coverageLost(e.lines);
  }

  // ── limb 7 (a): the audit must not be vacuous ────────────────────────────
  const inventory = audit.binaryInventory ?? {};
  for (const platform of PLATFORMS) {
    const rows = inventory[platform];
    if (!Array.isArray(rows) || rows.length === 0) {
      coverageLost([
        `${rel(AUDIT_REL)} declares an empty binaryInventory.${platform}.`,
        'THE UNIT OF APPLE\'S RULE IS A BINARY, NOT AN APP: the aggregate privacy report is assembled from the',
        'app target and EVERY framework in the bundle. An empty inventory is not "no frameworks", it is an',
        'audit that was never done, and limb 4 would then compare the plugin set against nothing.',
      ]);
    }
  }

  // ── limb 1: regenerate and compare ───────────────────────────────────────
  let rendered;
  try {
    rendered = renderAll(audit, app);
  } catch (e) {
    if (!(e instanceof AppleManifestUnavailable)) throw e;
    coverageLost([`${rel(AUDIT_REL)} could not be rendered.`, ...e.lines]);
  }

  const onDisk = {};
  for (const platform of PLATFORMS) {
    const path = join(appDir, MANIFEST_REL[platform]);
    if (!existsSync(path)) {
      problems.push(
        `${rel(MANIFEST_REL[platform])} does not exist. The audit describes this platform, so the manifest ` +
          'is owed; regenerate with `node tooling/store/render-apple-privacy-manifest.mjs --app ' +
          `${app}\`.`,
      );
      continue;
    }
    const have = readFileSync(path, 'utf8');
    onDisk[platform] = have;
    manifestsCompared++;
    if (have !== rendered[platform]) {
      const haveLines = have.split('\n');
      const wantLines = rendered[platform].split('\n');
      const at = haveLines.findIndex((l, i) => l !== wantLines[i]);
      problems.push(
        `${rel(MANIFEST_REL[platform])} is NOT what ${rel(AUDIT_REL)} renders — first difference at line ` +
          `${at + 1}:\n        on disk : ${JSON.stringify(haveLines[at] ?? '(end of file)')}\n` +
          `        audit   : ${JSON.stringify(wantLines[at] ?? '(end of file)')}\n` +
          '      This file is GENERATED. Edit the audit and regenerate; a hand edit to a sworn declaration is ' +
          'a declaration nobody audited.',
      );
    }
  }

  // ── limb 2: bundle membership, through the Runner target ─────────────────
  for (const platform of PLATFORMS) {
    const pbxPath = join(appDir, PBXPROJ_REL[platform]);
    if (!existsSync(pbxPath)) {
      problems.push(
        `${rel(PBXPROJ_REL[platform])} does not exist, so nothing carries ` +
          `${basename(MANIFEST_REL[platform])} into the ${platform} bundle.`,
      );
      continue;
    }
    const parsed = readRunnerTarget(readFileSync(pbxPath, 'utf8'));
    if (parsed.error) {
      coverageLost([
        `${rel(PBXPROJ_REL[platform])} — ${parsed.error}.`,
        'Limb 2 resolves the manifest THROUGH the Runner target rather than searching the file for a string,',
        'because the iOS project carries two PBXResourcesBuildPhase blocks and the empty one is RunnerTests.',
        'A parse that cannot find the target cannot tell those apart, and reporting either answer would be a',
        'guess about the exact mistake this limb exists to catch.',
      ]);
    }
    bundleMembershipsChecked++;
    const wanted = basename(MANIFEST_REL[platform]);
    if (!parsed.referencedPaths.includes(wanted)) {
      problems.push(
        `${rel(PBXPROJ_REL[platform])} contains no PBXFileReference for ${wanted}. Xcode does not know the ` +
          'file exists, so it cannot be copied into the bundle no matter what is on disk.',
      );
    } else if (!parsed.resourceFiles.includes(wanted)) {
      problems.push(
        `${wanted} is referenced by ${rel(PBXPROJ_REL[platform])} but is NOT in the ${APP_TARGET_NAME} ` +
          `target's PBXResourcesBuildPhase (${parsed.resourcesPhaseId}). This is the SILENT HALF of the ` +
          'failure: the repository looks completely correct and Apple receives no privacy manifest at all. ' +
          `The project has ${parsed.resourcesPhaseCount} Resources phase(s) — on iOS the other one is ` +
          'RunnerTests, which never ships. Members of the Runner phase: ' +
          `${parsed.resourceFiles.join(', ') || '(none)'}`,
      );
    }
    // The header sentence's source-file MEMBERSHIP, against the target itself.
    if (!parsed.hasSourcesPhase) {
      problems.push(
        `the ${APP_TARGET_NAME} target in ${rel(PBXPROJ_REL[platform])} has no PBXSourcesBuildPhase, so the ` +
          'manifest header\'s claim about which files were read cannot be checked against anything.',
      );
    } else {
      const declared = sorted(APP_TARGET_SOURCES[platform]);
      const actual = sorted(parsed.sourceFiles);
      if (!sameSet(declared, actual)) {
        problems.push(
          `the ${platform} manifest header says the app target's own code is [${declared.join(', ')}], and ` +
            `the ${APP_TARGET_NAME} target actually compiles [${actual.join(', ')}]. The header's whole claim ` +
            'is that THOSE files were read in full and reach no Required Reason API; a file the audit never ' +
            'saw makes the claim false. Re-read the target and update APP_TARGET_SOURCES in ' +
            'tooling/store/render-apple-privacy-manifest.mjs.',
        );
      }
    }
  }

  // ── the parsed manifests, for limbs 3 and 6 ──────────────────────────────
  const parsedManifest = {};
  for (const platform of PLATFORMS) {
    if (onDisk[platform] === undefined) continue;
    try {
      parsedManifest[platform] = parsePlist(onDisk[platform]);
    } catch (e) {
      problems.push(`${rel(MANIFEST_REL[platform])} is not a readable plist — ${e.message}`);
    }
  }

  // ── limb 3: the closed vocabulary ────────────────────────────────────────
  const vocab = audit.vocabulary ?? {};
  const categoryWitness = new Map(
    (vocab.accessedApiCategories ?? []).map((c) => [c.id, c.witness]),
  );
  const reasonRows = new Map((vocab.reasonCodes ?? []).map((r) => [r.id, r]));
  const purposeValues = new Set(vocab.purposes?.values ?? []);
  const purposeWitness = vocab.purposes?.witness ?? null;
  // The audit deliberately enumerates NO collected-data-type ids — it states
  // that no local witness exists for a single one of them and routes the check
  // through data-safety.json instead (limb 5). Honour an enumeration if one is
  // ever added, and say out loud when there is none rather than pretending the
  // membership test ran.
  const collectedEnum = Array.isArray(vocab.collectedDataTypes?.values)
    ? new Set(vocab.collectedDataTypes.values)
    : null;
  const collectedWitness = vocab.collectedDataTypes?.witness ?? null;

  if (purposeValues.size === 0) {
    coverageLost([
      `${rel(AUDIT_REL)} enumerates no vocabulary.purposes.values.`,
      'Limb 3 would then accept every purpose string ever written, which is a membership test against the',
      'empty closed set — an assertion that cannot fail.',
    ]);
  }

  const knowledgeAccepted = new Set();
  for (const platform of PLATFORMS) {
    const doc = parsedManifest[platform];
    if (!doc) continue;
    for (const row of doc.NSPrivacyCollectedDataTypes ?? []) {
      const type = row.NSPrivacyCollectedDataType;
      vocabularyConstantsChecked++;
      if (collectedEnum) {
        if (!collectedEnum.has(type)) {
          problems.push(
            `${rel(MANIFEST_REL[platform])} declares \`${type}\`, which is not in the audit's ` +
              'vocabulary.collectedDataTypes. A misspelt constant is a key Apple IGNORES, not one it reports.',
          );
        }
      } else if (!/^NSPrivacyCollectedDataType[A-Z]/.test(String(type))) {
        problems.push(
          `${rel(MANIFEST_REL[platform])} declares \`${type}\`, which is not even shaped like an Apple ` +
            'collected-data-type constant.',
        );
      }
      if (collectedWitness === 'knowledge') knowledgeAccepted.add(`collectedDataType ${type}`);
      for (const purpose of row.NSPrivacyCollectedDataTypePurposes ?? []) {
        vocabularyConstantsChecked++;
        if (!purposeValues.has(purpose)) {
          problems.push(
            `${rel(MANIFEST_REL[platform])} declares purpose \`${purpose}\` for \`${type}\`, which is not in ` +
              "the audit's vocabulary.purposes.values.",
          );
        } else if (purposeWitness === 'knowledge') {
          knowledgeAccepted.add(`purpose ${purpose}`);
        }
      }
    }
    for (const entry of doc.NSPrivacyAccessedAPITypes ?? []) {
      const category = entry.NSPrivacyAccessedAPIType;
      vocabularyConstantsChecked++;
      if (!categoryWitness.has(category)) {
        problems.push(
          `${rel(MANIFEST_REL[platform])} declares accessed-API category \`${category}\`, which is not in the ` +
            "audit's vocabulary.accessedApiCategories. Apple ignores a category it does not recognise, so " +
            'the declaration silently covers nothing.',
        );
      } else if (categoryWitness.get(category) === 'knowledge') {
        knowledgeAccepted.add(`accessedApiCategory ${category}`);
      }
      for (const reason of entry.NSPrivacyAccessedAPITypeReasons ?? []) {
        vocabularyConstantsChecked++;
        const row = reasonRows.get(reason);
        if (!row) {
          problems.push(
            `${rel(MANIFEST_REL[platform])} declares reason code \`${reason}\`, which is not in the audit's ` +
              'vocabulary.reasonCodes.',
          );
        } else if (row.category !== category) {
          problems.push(
            `${rel(MANIFEST_REL[platform])} declares reason code \`${reason}\` under \`${category}\`, and the ` +
              `audit says that code belongs to \`${row.category}\`. A reason code is only valid for its own ` +
              'category; under any other one it is an unanswered question wearing an answer\'s clothes.',
          );
        } else if (row.witness === 'knowledge') {
          knowledgeAccepted.add(`reasonCode ${reason}`);
        }
      }
    }
  }
  if (knowledgeAccepted.size) {
    warnings.push(
      `${app}: ${knowledgeAccepted.size} accepted constant(s) have witness \`knowledge\` — the exact spelling ` +
        'was never read out of a real manifest on this machine, only recorded from Apple documentation. A ' +
        'misspelling here is a plist key Apple IGNORES rather than an error it reports: ' +
        `${[...knowledgeAccepted].sort().join(' · ')}`,
    );
  }

  // ── limb 4: the plugin-set EQUALITY ──────────────────────────────────────
  const fpdPath = join(appDir, '.flutter-plugins-dependencies');
  if (!existsSync(fpdPath)) {
    coverageLost([
      `${rel('.flutter-plugins-dependencies')} does not exist.`,
      'It is what the Apple build actually links, so it is the only derivation of the plugin set that cannot',
      'go stale. Without it limb 4 compares the audit against nothing and a new plugin ships unaudited.',
      'Run `flutter pub get` in the app before this guard.',
    ]);
  }
  let fpd;
  try {
    fpd = JSON.parse(readFileSync(fpdPath, 'utf8'));
  } catch (e) {
    coverageLost([`${rel('.flutter-plugins-dependencies')} is not valid JSON — ${e.message}`]);
  }

  // A row is a PLUGIN row iff it is `name` or `name version`. Lexical and
  // deliberately narrow: `Runner (the app target)`, `Flutter.framework (engine
  // 3.44.9)` and `App.framework (the Dart AOT snapshot)` are binaries with no
  // pub package behind them, and a row that stops matching this shape DROPS OUT
  // of the derived set and fails the equality below rather than being waved
  // through — the comparison fails safe in both directions.
  const PLUGIN_ROW = /^([a-z][a-z0-9_]*)(?: (\d[^\s]*))?$/;

  const lock = readPubspecLockVersions(repoRoot);
  for (const platform of PLATFORMS) {
    const linked = sorted((fpd.plugins?.[platform] ?? []).map((p) => p.name));
    const rows = inventory[platform].map((r) => String(r.binary).match(PLUGIN_ROW)).filter(Boolean);
    const declared = sorted(rows.map((m) => m[1]));
    pluginRowsChecked += declared.length;
    if (linked.length === 0) {
      coverageLost([
        `${rel('.flutter-plugins-dependencies')} lists no ${platform} plugins.`,
        'Limb 4 then compares two empty sets and reports equality, which is the vacuous pass this whole guard',
        'exists to refuse.',
      ]);
    }
    const missing = linked.filter((n) => !declared.includes(n));
    const extra = declared.filter((n) => !linked.includes(n));
    if (missing.length) {
      problems.push(
        `${platform}: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} linked into the build by ` +
          `${rel('.flutter-plugins-dependencies')} and ${missing.length === 1 ? 'has' : 'have'} NO row in ` +
          `${rel(AUDIT_REL)} binaryInventory.${platform} — nobody said what required-reason APIs this uses. ` +
          'Apple asks each BINARY why it uses an API; a binary nobody audited cannot answer.',
      );
    }
    if (extra.length) {
      problems.push(
        `${platform}: ${rel(AUDIT_REL)} binaryInventory.${platform} declares ${extra.join(', ')}, which the ` +
          'build no longer links. A row for a binary that is not in the bundle is an audit of code that is ' +
          'not there — and it hides the fact that nothing checked the code that IS.',
      );
    }
    // A version bump is a different binary with a different manifest. Checked
    // where the audit names one, against pubspec.lock (the resolution the build
    // uses), not against the machine-specific pub-cache path in the file above.
    for (const m of rows) {
      const [, name, version] = m;
      if (!version || !lock) continue;
      const locked = lock.get(name);
      if (locked && locked !== version) {
        problems.push(
          `${platform}: ${rel(AUDIT_REL)} audits ${name} ${version} and pubspec.lock resolves ${name} ` +
            `${locked}. The manifest read during the audit was ${version}'s; ${locked} may declare different ` +
            'required-reason APIs, and nothing here has read it.',
        );
      }
    }
  }

  // ── limb 5: the cross-file contradiction ─────────────────────────────────
  const dsPath = join(appDir, 'store', 'android-play', 'data-safety.json');
  if (!existsSync(dsPath)) {
    coverageLost([
      `${rel('store/android-play/data-safety.json')} does not exist.`,
      'The App Privacy answers are DERIVED from the Play Data safety answers — the same sworn claim asked',
      'twice by two companies. Without the Play file the eleven rows here are unchecked against anything,',
      'and answering the two inconsistently is invisible to a human and obvious to a comparison.',
    ]);
  }
  let dataSafety;
  try {
    dataSafety = JSON.parse(readFileSync(dsPath, 'utf8'));
  } catch (e) {
    coverageLost([`${rel('store/android-play/data-safety.json')} is not valid JSON — ${e.message}`]);
  }
  const playPosture = dataSafety.buildPosture?.current;
  if (!playPosture) {
    coverageLost([`${rel('store/android-play/data-safety.json')} declares no buildPosture.current.`]);
  }
  if (audit.collectedDataTypes.posture !== playPosture) {
    problems.push(
      `${rel(AUDIT_REL)} answers for posture \`${audit.collectedDataTypes.posture}\` and ` +
        `${rel('store/android-play/data-safety.json')} builds \`${playPosture}\`. The two forms would then ` +
        'describe different artefacts while claiming to describe the same app.',
    );
  }
  const playCollected = sorted(
    (dataSafety.answers ?? []).filter((a) => a.collected?.[playPosture] === true).map((a) => a.type),
  );
  const appleFrom = sorted(audit.collectedDataTypes.rows.map((r) => r.fromPlayRow));
  playRowsCompared += playCollected.length;
  if (playCollected.length === 0) {
    coverageLost([
      `${rel('store/android-play/data-safety.json')} marks NO row collected under \`${playPosture}\`.`,
      'Limb 5 then compares the Apple rows against the empty set. An app that collects nothing is a real',
      'answer, but it is not this one, and a comparison against nothing cannot tell the two apart.',
    ]);
  }
  if (!sameSet(playCollected, appleFrom)) {
    const onlyPlay = playCollected.filter((t) => !appleFrom.includes(t));
    const onlyApple = appleFrom.filter((t) => !playCollected.includes(t));
    problems.push(
      `the two sworn declarations CONTRADICT each other under posture \`${playPosture}\`.` +
        (onlyPlay.length
          ? `\n        Play says collected, Apple does not declare: ${onlyPlay.join(', ')}`
          : '') +
        (onlyApple.length
          ? `\n        Apple names fromPlayRow, Play does not collect: ${onlyApple.join(', ')}`
          : '') +
        '\n      A Play row flipping without this file moving is the failure this limb exists for: both are the ' +
        'same claim, asked twice, months apart, and nobody reads them side by side.',
    );
  }
  const knownPlayRows = new Set((dataSafety.answers ?? []).map((a) => a.type));
  for (const row of audit.collectedDataTypes.rows) {
    if (!knownPlayRows.has(row.fromPlayRow)) {
      problems.push(
        `${rel(AUDIT_REL)} row \`${row.type}\` names fromPlayRow \`${row.fromPlayRow}\`, which is not a row in ` +
          `${rel('store/android-play/data-safety.json')} at all. The derivation points at nothing.`,
      );
    }
  }

  // ── limb 6: tracking coherence, as a PAIR ────────────────────────────────
  for (const platform of PLATFORMS) {
    const doc = parsedManifest[platform];
    if (!doc) continue;
    const tracking = doc.NSPrivacyTracking;
    const domains = doc.NSPrivacyTrackingDomains ?? [];
    if (tracking === false && domains.length > 0) {
      problems.push(
        `${rel(MANIFEST_REL[platform])} declares NSPrivacyTracking false AND ${domains.length} ` +
          `NSPrivacyTrackingDomains (${domains.join(', ')}). Apple's rule is that a non-empty domain list ` +
          'with tracking false is a contradiction — each field is well-formed on its own, so only the PAIR ' +
          'is checkable.',
      );
    }
    if (tracking === true && domains.length === 0) {
      problems.push(
        `${rel(MANIFEST_REL[platform])} declares NSPrivacyTracking true with an EMPTY NSPrivacyTrackingDomains. ` +
          'Tracking traffic to an undeclared domain is what the list exists to declare.',
      );
    }
    for (const row of doc.NSPrivacyCollectedDataTypes ?? []) {
      if (row.NSPrivacyCollectedDataTypeTracking === true && tracking === false) {
        problems.push(
          `${rel(MANIFEST_REL[platform])} says \`${row.NSPrivacyCollectedDataType}\` is used for TRACKING while ` +
            'NSPrivacyTracking is false. The app-level answer and the row-level answer are the same question.',
        );
      }
    }
  }

  // ── what this guard cannot see, in the audit's own words ─────────────────
  for (const item of audit.cannotSee?.items ?? []) prints.push(`CANNOT SEE — ${item}`);
  for (const u of audit.unresolved ?? []) {
    prints.push(
      `UNRESOLVED ${u.id} — ${u.title}` +
        (u.decision ? `\n      decision: ${u.decision}` : '') +
        (u.owner ? `\n      owner: ${u.owner}` : ''),
    );
  }
}

/** `package: version` out of pubspec.lock, without a YAML dependency. The file's
 *  shape is fixed by pub and the two lines are adjacent within a package block;
 *  returns null (and the version cross-check is skipped, and said so) rather
 *  than guessing if the file is absent. */
function readPubspecLockVersions(root) {
  const path = join(root, 'pubspec.lock');
  if (!existsSync(path)) return null;
  const out = new Map();
  let current = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const pkg = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*$/);
    if (pkg) {
      current = pkg[1];
      continue;
    }
    const ver = line.match(/^ {4}version:\s*"?([^"\s]+)"?\s*$/);
    if (ver && current) {
      out.set(current, ver[1]);
      current = null;
    }
  }
  return out.size ? out : null;
}

// ── limb 7 (b): the scan must have ranged over something ────────────────────
if (manifestsCompared === 0) {
  coverageLost([
    `${subjects.length} app(s) carry ${AUDIT_REL} and ZERO .xcprivacy files were compared against it.`,
    'Every limb above reads the rendered manifest, so this is not "the manifests are fine" — it is the',
    're-derivation ranging over nothing while printing ok.',
  ]);
}
if (bundleMembershipsChecked === 0) {
  coverageLost([
    'no Runner.xcodeproj was parsed, so nothing proved a manifest is in the bundle.',
    'A manifest on disk that Xcode never copies is the silent half of this failure: the repository looks',
    'completely correct and Apple receives nothing.',
  ]);
}
if (vocabularyConstantsChecked === 0) {
  coverageLost([
    'not one Apple constant was checked against the audit\'s closed vocabulary.',
    'A misspelt constant is a plist key Apple IGNORES rather than an error it reports, so a vocabulary check',
    'that ranges over nothing is exactly as green as one that passes.',
  ]);
}

prints.push(
  `${subjects.length} app(s) · ${manifestsCompared} .xcprivacy file(s) RE-DERIVED from ${AUDIT_REL} and ` +
    'compared byte for byte · never a checksum stored beside the data',
);
prints.push(
  `${bundleMembershipsChecked} Runner.xcodeproj(s) parsed structurally — the manifest is resolved THROUGH the ` +
    `${APP_TARGET_NAME} target's buildPhases to its PBXResourcesBuildPhase and through fileRef to a real ` +
    'PBXFileReference. The iOS project has TWO Resources phases and the empty one is RunnerTests; asserting ' +
    'the string appears in the file would pass over exactly that mistake.',
);
prints.push(
  `${vocabularyConstantsChecked} Apple constant(s) checked against the audit's closed vocabulary, on PARSED ` +
    'plist structure — the file\'s own header names UserDefaults, CA92.1 and 1C8F.1 in a sentence explaining ' +
    'why they are NOT declared, so a text search would read the explanation and conclude the opposite.',
);
prints.push(
  `${pluginRowsChecked} plugin row(s) required to EQUAL .flutter-plugins-dependencies — equality, not subset: ` +
    'a subset check answers "did anything forbidden appear" and needs a forbidden list that can never be ' +
    'complete; equality answers "did anything appear at all".',
);
prints.push(
  `${playRowsCompared} Play row(s) compared against the Apple rows under the shared build posture — the App ` +
    'Privacy and Data safety answers are the same sworn claim asked twice, and nobody reads them side by side.',
);
for (const w of warnings) prints.push(`⚠️ ${w}`);

if (problems.length) {
  console.error('assert-apple-privacy-manifest: FAIL');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  console.error('  Apple refuses the UPLOAD, not the review: "Starting May 1, 2024, apps that don\'t describe');
  console.error('  their use of required reason API in their privacy manifest file aren\'t accepted by App Store');
  console.error('  Connect." Fix the audit and regenerate — never the .xcprivacy by hand:');
  console.error('      node tooling/store/render-apple-privacy-manifest.mjs --app <app>');
  for (const p of prints) console.error(`  · ${p}`);
  process.exit(1);
}

console.log('assert-apple-privacy-manifest: OK');
for (const p of prints) console.log(`  · ${p}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
