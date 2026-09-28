#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-licence-register.mjs — rights evidence for everything we ship.
//
// [pipeline K-10] "Rights evidence for every third-party asset shipped."
// [pipeline K-11] "The in-app licences surface covers what the app ships."
//
// Both stores can ask for evidence of rights to material an app ships, and a
// review can be held or a listing pulled while that evidence is produced. The
// demand arrives without warning and is answered in hours or not at all. Before
// this guard the answer would have been a search through a build directory.
//
// TWO MODES, and the weaker one is the one that runs everywhere:
//   DECLARED (default) — every file under a `flutter: assets:` entry in every
//     workspace pubspec, every declared font file, plus the icon font implied by
//     `uses-material-design: true`. No Flutter toolchain needed, so it runs in
//     the guards lane on every push. ⚠️ It reads INTENT, not output.
//   BUNDLE (`--bundle <dir>`) — walks a real built bundle, which is where the
//     declared set and the shipped set can be seen to differ. Runs in the
//     app_brick lane after `flutter build web`.
//
// 🔴 THE RULE THAT MAKES THE REGISTER WORTH HAVING: a row's licence claim must
// carry a SOURCE. A third-party licence needs a URL and the date it was read; an
// unread one is recorded as UNVERIFIED with what would settle it, and is never
// given a plausible value. The stage document states Flutter's bundled icon font
// is CC-BY 4.0; the upstream repository has published under Apache-2.0 since
// 2016. Both are plausible, one is wrong, and a register that picked is worth
// nothing in the one conversation it exists for. This is the same rule
// assert-store-metadata.mjs enforces for numeric limits — an invented limit
// fires on CORRECT input while looking authoritative.
//
// 🔴 AND THE LICENCES THAT CANNOT SHIP HERE AT ALL are refused rather than
// printed: CC-BY-NC excludes commercial distribution, and CC-BY-SA's anti-ETM
// term is refuted by the Ed25519 signature on our content packs, which exists to
// make shipped content verifiable and cannot be removed without removing the
// fail-closed verifier. An asset under either is a build failure.
//
// ── APP-SCOPED ROWS: `--bundle DIR --app ID` (lead ruling PRL-R1, 2026-09-26) ──
// A pub package an app depends on ships its own assets into that app's bundle
// (`packages/<pkg>/…`), and no workspace manifest declares them. The register's
// `assets` rows describe the whole workspace, so they could not say "this app
// ships that file"; the first PR-lane web build of app #1 failed on five such
// files (O-PR-LANE-BUILDS-ONLY-ANDROID-ARTIFACTS, run 36233164494). The register's
// `appScopedAssets` rows each name a scope `app:<id>`, the path as it appears in
// that app's bundle, the PACKAGE that ships it, and a licence id. With `--app`,
// every file in the bundle must resolve to EXACTLY ONE row — a shared row, or an
// `app:<id>` row for THIS app; an `app:<other>` row never satisfies it. A file a
// hosted (non-workspace) package ships is claimed only by a row naming that
// package, never by a shared row's basename. The row's licence id is not taken
// on trust: this guard reads the package's own LICENSE through the app's
// resolved `.dart_tool/package_config.json` (or the pub workspace's, via
// `.dart_tool/pub/workspace_ref.json`) and exits 1 when the two differ. No
// package_config means `pub get` never ran: COVERAGE LOST (exit 2), never a pass.
//
// ── WHO WRITES THOSE ROWS (LEAD RULING NP12B-R2, 2026-09-28) ─────────────────
// The app's STAMP does: tooling/kit/stamp-app.mjs runs gen-app-licence-rows.mjs
// --write after a root `pub get`, deriving one row per package file from the
// resolved workspace. This guard stays the second witness — it grades a REAL
// bundle — and the two share one LICENSE classifier (package-assets.mjs), so a
// row the stamp writes is a row this walk reads back.
//
// Usage:  node tooling/ci/assert-licence-register.mjs [repoRoot] [--bundle DIR [--app ID]]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';
// The seam against [7]P-5's content-licence register. Imported by BOTH guards on
// purpose: a disagreement between the two registers must turn both red, or the
// one that stays green is the one somebody quotes. See licence-cross-assert.mjs.
import { crossAssertLicenceRegisters } from './licence-cross-assert.mjs';
// ── DELEGATION — THE LICENCES SURFACE FOLLOWS THE SCREEN INTO THE CHASSIS ────
// (ADR 067 decision 2; the same resolver eleven sibling guards carry.)
//
// [ADR 066] step 4 empties a brick screen into `package:nikatru_chassis_screens`
// and leaves an ADAPTER at the same path. `AboutListTile` and `showLicensePage`
// are PAINTED, so they moved with the settings body — and read at the adapter
// alone this limb reports that the template ships no licences surface at all.
// That is a K-11 claim about a tree that ships one, which is exactly as bad as
// missing a real gap. So the scan below reads each app's own lib AND the chassis
// files it delegates to. This only ever ADDS text: a surface that was found is
// still found, and one that is genuinely absent is still absent.
//
// ONE LEVEL, ONE IMPORT, EVERY REFUSAL LOUD. A delegation this resolver cannot
// follow is COVERAGE LOST, never a quiet fall-back to reading the adapter alone.
import { delegationOf } from './chassis-delegation.mjs';
import { SDK_PACKAGE, flat, packageConfigOf, packageLicence as packageLicenceOf } from './package-assets.mjs';

// ⚠️ ARGUMENT PARSING, AND IT ALREADY BIT ONCE. The first draft read
// `argv.find((a, i) => !a.startsWith('--') && i !== bundleAt + 1)`; with no
// --bundle flag, `bundleAt` is -1 and `bundleAt + 1` is 0, so it skipped
// argument ZERO — the repoRoot — and silently fell back to process.cwd(). Every
// mutation against a scratch copy then ran the guard against the REAL tree and
// reported "NOT CAUGHT" for nine limbs that all worked. A guard pointed at the
// wrong tree passes for the same reason a guard with no subject passes.
const argv = process.argv.slice(2);
const bundleAt = argv.indexOf('--bundle');
const bundleDir = bundleAt === -1 ? null : argv[bundleAt + 1];
const appAt = argv.indexOf('--app');
const appId = appAt === -1 ? null : argv[appAt + 1];
// The same trap as above, for two flags: only a flag that IS present owns the
// argument after it.
const flagValues = new Set([bundleAt, appAt].filter((i) => i !== -1).map((i) => i + 1));
const positional = argv.filter((a, i) => !a.startsWith('--') && !flagValues.has(i));
const repoRoot = resolve(positional[0] ?? process.cwd());
const REGISTER = join(repoRoot, 'tooling', 'legal', 'asset-register.json');

const problems = [];
const prints = [];
const rel = (p) => relative(repoRoot, p).split(sep).join('/');

const coverageLost = (msg, ...detail) => {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  for (const d of detail) console.error(`  ${d}`);
  // ⏱ 2026-09-15 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
};

if (!existsSync(REGISTER)) {
  coverageLost(
    `${rel(REGISTER)} does not exist.`,
    'The register is the left-hand side of every comparison here. Absent, this guard compares a real',
    'bundle to nothing and prints ok — see tooling/legal/README.md for why it is in-tree and not under',
    'Private/, which is gitignored and invisible to CI.',
  );
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (err) {
  coverageLost(`${rel(REGISTER)} is not valid JSON (${err.message}).`);
}
const D = register.derivation ?? {};

// ── `--app`: whose bundle this is, and the packages it resolved ─────────────
// Checked before anything is walked: a caller error here would otherwise grade
// the bundle against the shared rows alone and print a finding about the wrong
// question.
let appDirAbs = null;
let packageConfig = null;
if (appAt !== -1) {
  if (!appId || appId.startsWith('--')) {
    coverageLost('--app was given no app id.', 'Name the app whose bundle --bundle points at: --app <id>.');
  }
  if (bundleDir === null) {
    coverageLost(
      `--app ${appId} names the app a BUNDLE belongs to, and no --bundle was given.`,
      'App-scoped rows are witnessed by that app\'s built bundle and by nothing else.',
    );
  }
  appDirAbs =
    (D.appRoots ?? []).map((r) => join(repoRoot, ...r.split('/'), appId)).find((d) => existsSync(join(d, 'pubspec.yaml'))) ??
    null;
  if (appDirAbs === null) {
    coverageLost(
      `--app ${appId} names no app: no ${(D.appRoots ?? []).map((r) => `${r}/${appId}/pubspec.yaml`).join(' or ') || 'derivation.appRoots'} exists.`,
      'The scope `app:<id>` rows are graded against is the directory the build came from.',
    );
  }
  packageConfig = packageConfigOf(appDirAbs);
  if (packageConfig === null) {
    coverageLost(
      `${rel(appDirAbs)} has no resolved packages: neither .dart_tool/package_config.json nor a ` +
        '.dart_tool/pub/workspace_ref.json that leads to one.',
      'An app-scoped row\'s licence is READ from the LICENSE of the package that ships it, and the package is',
      'found through package_config.json, which `flutter pub get` writes. Run it before this step: with no',
      'resolved packages nothing was read, and a licence nobody read is not evidence.',
    );
  }
}

const walk = (dir, out = []) => {
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'build' || e.name === '.git' || e.name === '.dart_tool') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const under = (roots) => (roots ?? []).flatMap((r) => walk(join(repoRoot, ...r.split('/'))));

// ── enumerate what ships ────────────────────────────────────────────────────
const pubspecs = [
  ...under(D.workspaceRoots).filter((f) => f.split(sep).pop() === 'pubspec.yaml'),
  ...(existsSync(join(repoRoot, 'pubspec.yaml')) ? [join(repoRoot, 'pubspec.yaml')] : []),
];
if (pubspecs.length < Number(D.minPubspecs ?? 0)) {
  coverageLost(
    `found ${pubspecs.length} pubspec.yaml file(s), floor ${D.minPubspecs}.`,
    'The declared-asset walk hangs off these manifests. Finding fewer means the walk under-reached, and',
    'an asset register that enumerates nothing reports every asset accounted for.',
  );
}

/** The workspace's own package names. A bundle file under `packages/<name>/`
 *  whose <name> is NOT one of these was shipped by a hosted pub package. */
const workspacePackages = new Set(
  pubspecs
    .map((f) => stripSourceComments(readFileSync(f, 'utf8'), '.yaml').match(/^name:\s*(\S+)\s*$/m)?.[1])
    .filter(Boolean),
);

/** Which pubspecs turn the icon font on. A relationship to a flag in the tree,
 *  so a bundle path that stops finding assets fails instead of reporting clean. */
const materialDesignPubspecs = pubspecs.filter((f) =>
  /^\s*uses-material-design:\s*true\s*$/m.test(stripSourceComments(readFileSync(f, 'utf8'), '.yaml')),
);

/** Every path a pubspec declares as a shipped asset: the `- entry` lines under
 *  `flutter: assets:`, and the `- asset: path` lines under `flutter: fonts:`.
 *
 *  Scanned line by line rather than matched as a regex block. The block form is
 *  where a subtle miss hides: it looked right, matched the real manifest, and
 *  returned nothing for a manifest whose assets: block ran to end of file.
 *  Membership of the block is decided by INDENTATION, which is what YAML itself
 *  uses, so there is nothing to get subtly wrong about the terminator. */
function declaredAssetEntries(yaml) {
  const lines = yaml.split(/\r?\n/);
  const entries = [];
  let indent = null;
  let kind = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const lead = line.length - line.trimStart().length;
    if (indent !== null && lead > indent) {
      const item = line.trim();
      if (kind === 'assets') {
        const m = item.match(/^-\s*(\S.*?)\s*$/);
        if (m) entries.push(m[1].replace(/^["']|["']$/g, ''));
      } else if (kind === 'fonts') {
        const m = item.match(/^-?\s*asset:\s*(\S.*?)\s*$/);
        if (m) entries.push(m[1].replace(/^["']|["']$/g, ''));
      }
      continue;
    }
    indent = null;
    kind = null;
    const head = line.match(/^(\s*)(assets|fonts):\s*$/);
    if (head) {
      indent = head[1].length;
      kind = head[2];
    }
  }
  return entries;
}

/** id → { id, name, where } — what is actually shipped. */
const shipped = new Map();
const shipAsset = (id, name, where) => {
  if (!shipped.has(id)) shipped.set(id, { id, name, where: [] });
  shipped.get(id).where.push(where);
};

let declaredAssetFiles = 0;
if (bundleDir === null) {
  // DECLARED MODE. `flutter: assets:` entries are either a directory (trailing
  // slash — every file directly inside it ships) or a single file.
  for (const f of pubspecs) {
    const src = stripSourceComments(readFileSync(f, 'utf8'), '.yaml');
    const dir = f.slice(0, f.lastIndexOf(sep));
    // ⚠️ A LINE SCANNER, NOT A REGEX BLOCK MATCH. The first draft used
    // /^\s{2}assets:\s*$([\s\S]*?)(?=^\s{0,2}\S|\Z)/m and silently matched
    // NOTHING when the assets: block was the last thing in the file — `\Z` is
    // not a JavaScript anchor, it is a literal "Z", so the lazy body had no
    // terminator to find. It worked against the real pubspec (which has more
    // content after the block) and failed against a fixture that did not, which
    // is the wrong way round for a check to fail.
    for (const entry of declaredAssetEntries(src)) {
      const abs = join(dir, ...entry.split('/'));
      if (!existsSync(abs)) {
        problems.push(
          `${rel(f)} declares asset ${JSON.stringify(entry)} and no such path exists. Flutter would fail the build; ` +
            'this guard fails first, and says which manifest is wrong.',
        );
        continue;
      }
      const files = statSync(abs).isDirectory()
        ? listDir(abs, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(abs, e.name))
        : [abs];
      for (const file of files) {
        declaredAssetFiles++;
        shipAsset(rel(file), file.split(sep).pop(), rel(f));
      }
    }
  }
  if (declaredAssetFiles < Number(D.minDeclaredAssets ?? 0)) {
    coverageLost(
      `enumerated ${declaredAssetFiles} declared asset file(s), floor ${D.minDeclaredAssets}, while ` +
        `${materialDesignPubspecs.length} pubspec(s) still declare uses-material-design: true.`,
      'The assets: walk stopped finding files — an entry renamed, a directory moved — and an asset',
      'register that enumerates nothing reports every shipped asset accounted for. This floor is the',
      'relationship the plan asked for: the icon-font flag is still on, so assets are still shipping.',
    );
  }
} else {
  const abs = resolve(bundleDir);
  if (!existsSync(abs)) {
    coverageLost(
      `--bundle ${bundleDir} does not exist.`,
      'The caller claimed a built bundle to walk and there is none. A bundle mode that silently falls',
      'back to enumerating nothing is the strongest limb reporting clean.',
    );
  }
  for (const file of walk(abs)) {
    declaredAssetFiles++;
    shipAsset(relative(abs, file).split(sep).join('/'), file.split(sep).pop(), `bundle:${bundleDir}`);
  }
  if (declaredAssetFiles === 0 && materialDesignPubspecs.length > 0) {
    coverageLost(
      `walked ${bundleDir} and found ZERO assets, while ${materialDesignPubspecs.length} pubspec(s) declare ` +
        'uses-material-design: true.',
      'Flutter bundles an icon font under that flag, so a bundle with no assets at all means the walk is',
      'pointed at the wrong directory — not that the build ships nothing.',
    );
  }
}

// The icon font is implied by a FLAG rather than by a file, so it is enumerated
// from the flag. That keeps the register honest in declared mode, where no
// build output exists to find it in.
if (materialDesignPubspecs.length > 0) {
  shipAsset(
    'flag:uses-material-design',
    'MaterialIcons (bundled by uses-material-design)',
    materialDesignPubspecs.map(rel).join(', '),
  );
}

// ── the register ↔ shipped relation, both directions ────────────────────────
const assets = Array.isArray(register.assets) ? register.assets : [];
if (assets.length === 0) {
  coverageLost('the asset register declares no `assets`, so every comparison below had an empty left side.');
}
/** A row's key: its declared path, or the flag it comes from. */
const keyOf = (a) => (a.fromFlag ? `flag:${a.fromFlag}` : a.path ?? a.id);
const byKey = new Map();
for (const a of assets) {
  const k = keyOf(a);
  if (byKey.has(k)) problems.push(`the asset register carries TWO rows keyed ${JSON.stringify(k)}. One asset, one row.`);
  byKey.set(k, a);
}

// In BUNDLE mode a shipped file is keyed by its path INSIDE the bundle, which is
// not the repo path a declared row carries. Matching by BASENAME there is the
// honest comparison: the register describes the artefact, and the bundle
// rearranges where it sits. In declared mode the keys are repo paths and match
// exactly, which is the stronger comparison — said plainly rather than glossed.
// Every shared row a file matches is returned, so a file two rows claim is
// reported rather than handed to whichever row came first.
const sharedMatches = (shippedId, shippedName) => {
  if (byKey.has(shippedId)) return [byKey.get(shippedId)];
  if (bundleDir === null) return [];
  return assets.filter((a) => {
    const base = (a.path ?? '').split('/').pop();
    return (base && base === shippedName) || (a.fromFlag && /^MaterialIcons/i.test(shippedName));
  });
};

// ── app-scoped rows: the shape (PRL-R1) ─────────────────────────────────────
// A separate array, not a `scope` field on `assets`: every shared row keeps its
// shape byte for byte, and a guard that predates this array reads the register
// exactly as it did (its declared mode would call an app row orphaned, and its
// probe walk would call it a bundleOnly row the build stopped emitting).
const APP_SCOPE = /^app:([a-z][a-z0-9_]*)$/;
const PUB_NAME = /^[a-z_][a-z0-9_]*$/;
let appRows = [];
if (register.appScopedAssets !== undefined) {
  if (Array.isArray(register.appScopedAssets)) appRows = register.appScopedAssets;
  else problems.push('the asset register\'s `appScopedAssets` is not an array, so no app-scoped row was read.');
}
const appKey = (a) => `${a.scope}#${a.bundlePath}`;
const scopeOfApp = appId === null ? null : `app:${appId}`;
const appInScope = scopeOfApp === null ? [] : appRows.filter((a) => a.scope === scopeOfApp);
const scopedByPath = new Map(appInScope.map((a) => [a.bundlePath, a]));
/** The hosted pub package a BUNDLE path was shipped by, or null. Bundle mode
 *  only: in declared mode `packages/<dir>/` is a repo directory, not a package. */
const hostedPackageOf = (shippedId) => {
  if (bundleDir === null) return null;
  const m = /^packages\/([^/]+)\//.exec(shippedId);
  return m && !workspacePackages.has(m[1]) ? m[1] : null;
};
const shown = (p) => {
  const r = relative(repoRoot, p);
  return (r.startsWith('..') ? p : r).split(sep).join('/');
};

// ── the primary licence source: the LICENSE of the package that ships it ────
// The classifier and the LICENSE lookup live in package-assets.mjs since
// 2026-09-28 (NP12B-R2), UNCHANGED: gen-app-licence-rows.mjs writes the rows this
// guard grades, and one classifier means the two cannot read a LICENSE apart.
const packageLicence = (pkg) => packageLicenceOf(packageConfig, pkg, shown);

/** Files the BUILD emits to describe or license the bundle. Named individually
 *  in the register — never a suffix rule, so a new one still fails until
 *  somebody writes it down. Empty is COVERAGE LOST in bundle mode: with no list,
 *  every generated file would be reported as an unlicensed asset and the step
 *  would be red forever, which is a step somebody deletes. */
const generated = new Set(Object.keys(register.generatedBundleFiles?.files ?? {}));
if (bundleDir !== null && generated.size === 0) {
  coverageLost(
    'the register declares no `generatedBundleFiles.files`, and this is BUNDLE mode.',
    'Every build emits manifests and a NOTICES file. With no list they are all reported as unlicensed',
    'assets, the step is red on a correct tree, and a step that cries wolf is one somebody deletes.',
  );
}

const matched = new Set();
const matchedApp = new Set();
let generatedSeen = 0;
for (const [id, s] of shipped) {
  if (generated.has(s.name)) {
    generatedSeen++;
    continue;
  }
  // EXACTLY ONE ROW: a shared row, or an `app:<id>` row for THIS bundle's app. A
  // file a hosted package ships is never claimed by a shared row's basename — a
  // shared row names no package, so it cannot say whose LICENSE the file is under.
  const hosted = hostedPackageOf(id);
  const shared = hosted === null ? sharedMatches(id, s.name) : [];
  const scoped = scopedByPath.has(id) ? [scopedByPath.get(id)] : [];
  const rows = [...shared, ...scoped];
  if (rows.length === 1) {
    if (scoped.length === 1) matchedApp.add(appKey(scoped[0]));
    else matched.add(keyOf(shared[0]));
    continue;
  }
  if (rows.length > 1) {
    // Every claimant WAS emitted, so none of them is also reported as stale.
    for (const r of scoped) matchedApp.add(appKey(r));
    for (const r of shared) matched.add(keyOf(r));
    problems.push(
      `${id} ships (${[...new Set(s.where)].join(', ')}) and resolves to ${rows.length} rows ` +
        `(${rows.map((r) => JSON.stringify(r.id)).join(', ')}). One file, one row: two rows are two licence ` +
        'answers for one artefact, and the register cannot say which one a store is given.',
    );
    continue;
  }
  if (hosted === null) {
    problems.push(
      `${s.name} ships (${[...new Set(s.where)].join(', ')}) and has NO row in tooling/legal/asset-register.json. ` +
        'A store can ask for evidence of rights to it, and the answer would be a search rather than a file. Add the ' +
        'row — including when the answer is "our own work, all rights reserved", or (if the BUILD emitted it to ' +
        'describe the bundle rather than to ship material) name it in `generatedBundleFiles` with a reason.',
    );
    continue;
  }
  const elsewhere = appRows.filter((a) => a.bundlePath === id && a.scope !== scopeOfApp).map((a) => a.scope);
  let derived = '';
  if (appId !== null) {
    const lic = packageLicence(hosted);
    const read = lic.error ? `UNREAD — ${lic.error}` : lic.ids.length === 1 ? lic.ids[0] : `UNREAD — ${shown(lic.file)} names ${lic.ids.length} licences`;
    derived =
      ' The row this bundle and the package\'s own LICENSE derive (write its `name` and `contentFamilyWhy` ' +
      `yourself): ${JSON.stringify({ id: `${appId}-${hosted}-${s.name}`, scope: scopeOfApp, bundlePath: id, package: hosted, origin: 'third-party', licence: read, attributionRequired: true, attributedIn: 'bundle:NOTICES', contentFamily: null, source: { note: `the ${hosted} package's own LICENSE, read by assert-licence-register.mjs --bundle --app on every run` } })}`;
  }
  problems.push(
    `${id} ships (${[...new Set(s.where)].join(', ')}), shipped by the hosted package ${hosted}, and no row ` +
      (appId === null
        ? 'claims it. This walk was given no --app, so only shared rows were eligible, and a shared row never claims ' +
          'a file a package ships. Pass --app <id>, and add an `app:<id>` row to `appScopedAssets`.'
        : `in scope shared or ${scopeOfApp} claims it. Add an \`appScopedAssets\` row for ${scopeOfApp}.`) +
      (elsewhere.length
        ? ` A row scoped ${[...new Set(elsewhere)].join(', ')} names this path; an app-scoped row belongs to ONE app, ` +
          'and every other app needs its own, read from its own bundle.'
        : '') +
      derived,
  );
}

// ── the reverse direction, and WHICH MODE MAY ASSERT IT ─────────────────────
// 🔴 A SINGLE APP'S BUNDLE CANNOT WITNESS THE WHOLE WORKSPACE, and the first CI
// run of the bundle step proved it: the lane walks apps/probe (a throwaway stamp
// with no brand assets) and the guard reported all three of apps/subscriptiontracker's brand
// rows as "no such asset is shipped". They ARE shipped — by a different app.
//
// So the row-with-no-asset direction belongs to DECLARED mode, which reads every
// manifest in the workspace and therefore has the standing to say a row is
// orphaned. BUNDLE mode asserts the direction it CAN: every row marked
// `bundleOnly` — material the toolchain injects, which no manifest declares —
// must actually be in the bundle. Neither mode is given a claim it cannot back.
if (bundleDir === null) {
  for (const a of assets) {
    if (a.bundleOnly) continue; // declared by no manifest; the bundle mode owns it
    if (matched.has(keyOf(a))) continue;
    problems.push(
      `the asset register carries a row for ${JSON.stringify(a.id)} (${keyOf(a)}) and no such asset is shipped. ` +
        'Either it was removed and the row outlived it, or it moved and the row still points at the old path. A ' +
        'register describing assets nobody ships is a register nobody trusts about the ones they do.',
    );
  }
} else {
  for (const a of assets) {
    if (!a.bundleOnly || matched.has(keyOf(a))) continue;
    problems.push(
      `the asset register carries a bundleOnly row for ${JSON.stringify(a.id)} (${keyOf(a)}) and the build did NOT ` +
        'emit it. A bundleOnly row exists precisely because no manifest declares the file, so this walk is the only ' +
        'thing that can ever notice it has gone — retire the row, or find out what stopped shipping it.',
    );
  }
}

// ── per-row obligations ─────────────────────────────────────────────────────
const bad = (register.incompatibleLicences?.prefixes ?? []).map((p) => String(p).toUpperCase());
if (bad.length === 0) {
  coverageLost(
    'the register declares no `incompatibleLicences.prefixes`.',
    'With that list empty every licence is acceptable, including the two that architecturally cannot',
    'ship here. An empty blocklist is not a permissive policy; it is a check that stopped checking.',
  );
}
let sourced = 0;
for (const a of assets) {
  const where = `asset row ${JSON.stringify(a.id)}`;
  const licence = String(a.licence ?? '');
  if (licence.trim() === '') {
    problems.push(`${where} declares no \`licence\`. "UNVERIFIED" is a valid answer; blank is not.`);
    continue;
  }
  if (bad.some((p) => licence.toUpperCase().startsWith(p))) {
    problems.push(
      `${where} declares licence ${JSON.stringify(licence)}, which is architecturally incompatible with how this ` +
        'factory ships and is refused rather than printed. CC-BY-NC excludes commercial distribution, which is the ' +
        "business; CC-BY-SA's anti-ETM term is refuted by the Ed25519 signature on our content packs, which cannot " +
        'be removed without removing the fail-closed verifier that makes shipped content trustworthy.',
    );
  }
  if (!a.source || typeof a.source !== 'object') {
    problems.push(
      `${where} carries no \`source\` for its licence claim. A licence nobody can point at the origin of is a claim, ` +
        'not evidence — and evidence is the entire reason this register exists.',
    );
    continue;
  }
  if (typeof a.source.note !== 'string' || a.source.note.trim() === '') {
    problems.push(`${where} carries a \`source\` with no \`note\` explaining where the claim comes from.`);
    continue;
  }
  if (licence === 'UNVERIFIED') {
    if (typeof a.wouldNeed !== 'string' || a.wouldNeed.trim() === '') {
      problems.push(
        `${where} is UNVERIFIED and does not say what would settle it. "We do not know" is only useful with "here ` +
          'is what to open".',
      );
    }
    if (a.source.url) {
      problems.push(
        `${where} is UNVERIFIED and carries a source URL. The mark means nobody has read the licence; a URL beside ` +
          'it converts an honest gap into a false citation.',
      );
    }
    prints.push(`UNVERIFIED LICENCE · ${a.id} (${a.name}) — WOULD NEED: ${a.wouldNeed ?? '(unrecorded)'}`);
  } else if (a.origin === 'third-party') {
    if (typeof a.source.url !== 'string' || !/^https?:\/\//.test(a.source.url)) {
      problems.push(
        `${where} claims a third-party licence ${JSON.stringify(licence)} with no source URL. A third-party licence ` +
          'claim is only worth the document it was read from.',
      );
    } else if (typeof a.source.fetched !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.source.fetched)) {
      problems.push(`${where} cites a source URL with no \`fetched\` date. Upstream licences change.`);
    } else {
      sourced++;
    }
  } else if (a.origin === 'own-work') {
    if (typeof a.owner !== 'string' || a.owner.trim() === '') {
      problems.push(`${where} claims own-work origin and names no \`owner\`. Whose work it is IS the evidence.`);
    } else {
      sourced++;
    }
  } else {
    problems.push(
      `${where} declares origin ${JSON.stringify(a.origin ?? null)}, which is neither "own-work" nor "third-party". ` +
        'The origin is what decides which evidence the row owes.',
    );
  }

  if (a.attributionRequired === true) {
    const target = a.attributedIn;
    const ok =
      typeof target === 'string' && target.trim() !== '' && existsSync(join(repoRoot, ...target.split('/')));
    if (!ok) {
      problems.push(
        `${where} carries an attribution obligation and names no existing file that discharges it. An attribution ` +
          'requirement is a licence CONDITION: unmet, the licence does not apply and the asset is shipping ' +
          'unlicensed. Name a NOTICES file in the bundle, or a LicenseRegistry.addLicense call site.',
      );
    }
  }
}
// Gated on `problems.length === 0`: coverageLost exits immediately, so raising
// it while a specific row fault is already recorded would replace "this row
// carries no source" with "no row produced a claim" and send the fix elsewhere.
if (sourced === 0 && problems.length === 0) {
  coverageLost('NOT ONE asset row produced a checkable licence claim, so the source rule ran over nothing.');
}

// ── app-scoped rows: per-row obligations, in every mode ─────────────────────
const appExists = (id) => (D.appRoots ?? []).some((r) => existsSync(join(repoRoot, ...r.split('/'), id, 'pubspec.yaml')));
const idsSeen = new Set(assets.map((a) => a.id));
const appKeysSeen = new Set();
const validApp = new Set();
for (const a of appRows) {
  const where = `app-scoped row ${JSON.stringify(a?.id ?? null)}`;
  if (typeof a?.id !== 'string' || a.id.trim() === '') {
    problems.push('an `appScopedAssets` row carries no `id`. Every row is named, so a reader can cite it.');
    continue;
  }
  if (idsSeen.has(a.id)) problems.push(`${where}: another row already carries that id. One id, one row.`);
  idsSeen.add(a.id);
  const sm = APP_SCOPE.exec(String(a.scope ?? ''));
  if (!sm) {
    problems.push(`${where} declares scope ${JSON.stringify(a.scope ?? null)}. An app-scoped row's scope is \`app:<app_id>\`.`);
    continue;
  }
  if (!appExists(sm[1])) {
    problems.push(
      `${where} is scoped to ${a.scope}, and no app ${sm[1]} exists under ${(D.appRoots ?? []).join(', ')}. A row for an ` +
        'app nobody builds is a row nobody checks: retire it.',
    );
  }
  const bp = a.bundlePath;
  if (
    typeof bp !== 'string' ||
    bp === '' ||
    bp.includes('\\') ||
    bp.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    problems.push(
      `${where} declares bundlePath ${JSON.stringify(bp ?? null)}. It is the file's path inside the app's built ` +
        'assets directory, as that directory lists it: forward slashes, relative, no `.` or `..` segment.',
    );
    continue;
  }
  if (appKeysSeen.has(appKey(a))) problems.push(`${where}: another row already claims ${bp} for ${a.scope}. One file, one row.`);
  appKeysSeen.add(appKey(a));
  const pkg = a.package;
  if (pkg !== SDK_PACKAGE && !(typeof pkg === 'string' && PUB_NAME.test(pkg))) {
    problems.push(
      `${where} names package ${JSON.stringify(pkg ?? null)}. A row names the pub package that ships the file, or ` +
        `"${SDK_PACKAGE}" for an engine or web asset of the Flutter SDK: the package is where its licence is read.`,
    );
    continue;
  }
  const pathPkg = /^packages\/([^/]+)\//.exec(bp)?.[1] ?? null;
  if (pkg === SDK_PACKAGE ? pathPkg !== null : pathPkg !== pkg) {
    problems.push(
      `${where} names package ${pkg} for ${bp}, and ` +
        (pathPkg === null ? 'a pub package ships its assets under packages/<name>/.' : `that path is shipped by package ${pathPkg}.`) +
        ' The wrong package would be the wrong LICENSE.',
    );
    continue;
  }
  const licence = String(a.licence ?? '').trim();
  if (licence === '' || licence === 'UNVERIFIED') {
    problems.push(
      `${where} declares licence ${JSON.stringify(a.licence ?? null)}. An app-scoped row's licence is READ from the ` +
        'package that ships it, so there is no unread state to record: write the id its LICENSE reads, and the ' +
        '--bundle --app walk checks it against that file.',
    );
    continue;
  }
  if (bad.some((p) => licence.toUpperCase().startsWith(p))) {
    problems.push(`${where} declares licence ${JSON.stringify(licence)}, which cannot ship here (see incompatibleLicences).`);
  }
  if (a.origin !== 'third-party') {
    problems.push(`${where} declares origin ${JSON.stringify(a.origin ?? null)}; a file a package ships is "third-party" material.`);
  }
  if (typeof a.source?.note !== 'string' || a.source.note.trim() === '') {
    problems.push(`${where} carries no \`source.note\` saying where its licence is read from.`);
  }
  if (typeof a.attributionRequired !== 'boolean') {
    problems.push(
      `${where} leaves attributionRequired at ${JSON.stringify(a.attributionRequired ?? null)}. Its licence is read, so ` +
        'its duty is known: true or false, never a blank nobody re-opens.',
    );
  } else if (a.attributionRequired) {
    const t = a.attributedIn;
    const ok = t === 'bundle:NOTICES' || (typeof t === 'string' && t.trim() !== '' && existsSync(join(repoRoot, ...t.split('/'))));
    if (!ok) {
      problems.push(
        `${where} carries an attribution obligation and names neither "bundle:NOTICES" (the notices file the build ` +
          'assembles from each package\'s LICENSE) nor an existing file that discharges it.',
      );
    }
  }
  validApp.add(appKey(a));
}

// ── `--bundle --app`: both directions for THIS app, and the licence READ ────
// An app's bundle witnesses every row scoped to that app, so the reverse
// direction is fully assertable here: a row the build did not emit is stale.
const readLines = [];
if (appId !== null) {
  for (const a of appInScope) {
    if (matchedApp.has(appKey(a))) continue;
    problems.push(
      `app-scoped row ${JSON.stringify(a.id)} claims ${a.bundlePath} for ${scopeOfApp}, and the build did NOT emit it. ` +
        'Retire the row, or find out what stopped shipping the file.',
    );
  }
  const noticesPath = join(resolve(bundleDir), 'NOTICES');
  const noticesRaw = existsSync(noticesPath) ? readFileSync(noticesPath, 'utf8') : null;
  const noticesFlat = noticesRaw === null ? null : flat(noticesRaw);
  const noticesNames = noticesRaw === null ? new Set() : new Set(noticesRaw.split(/\r?\n/).map((l) => l.trim()));
  for (const a of appInScope) {
    if (!validApp.has(appKey(a))) continue; // its shape fault is already reported above
    const where = `app-scoped row ${JSON.stringify(a.id)}`;
    const lic = packageLicence(a.package);
    if (lic.error) {
      problems.push(`${where}: ${lic.error}. Its licence was not read, so it is not evidence.`);
      continue;
    }
    if (lic.ids.length !== 1) {
      problems.push(
        `${where}: ${shown(lic.file)} reads as ${lic.ids.length === 0 ? 'no licence this guard can name' : lic.ids.join(' AND ')}. ` +
          'A row\'s licence is read from the package that ships the file, and this one could not be read to one answer.',
      );
      continue;
    }
    if (String(a.licence).trim().toLowerCase() !== lic.ids[0].toLowerCase()) {
      problems.push(
        `${where} declares licence ${JSON.stringify(a.licence)}, and the ${a.package} package's own LICENSE ` +
          `(${shown(lic.file)}) reads ${lic.ids[0]}. The package is the primary source; the row follows it.`,
      );
      continue;
    }
    let discharged = '';
    if (a.attributionRequired && a.attributedIn === 'bundle:NOTICES') {
      const named = a.package === SDK_PACKAGE || noticesNames.has(a.package);
      if (noticesFlat === null || !named || !noticesFlat.includes(flat(lic.text))) {
        problems.push(
          `${where} says the bundle's NOTICES discharges its attribution, and ` +
            (noticesFlat === null
              ? `${shown(noticesPath)} does not exist.`
              : `${shown(noticesPath)} does not carry ${named ? '' : `the name ${a.package} or `}the text of ${shown(lic.file)}.`) +
            ' An attribution condition unmet is a licence that does not apply.',
        );
        continue;
      }
      discharged = '; NOTICES carries it';
    }
    readLines.push(`${scopeOfApp} · ${a.bundlePath} — the ${a.package} LICENSE reads ${lic.ids[0]}${discharged}`);
  }
}

// ── K-11 · every app shows the licences of what it ships ────────────────────
const appDirs = [];
for (const root of D.appRoots ?? []) {
  const abs = join(repoRoot, ...root.split('/'));
  if (!existsSync(abs)) continue;
  for (const e of listDir(abs, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (existsSync(join(abs, e.name, 'pubspec.yaml'))) appDirs.push(`${root}/${e.name}`);
  }
}
if (D.brickAppRoot && existsSync(join(repoRoot, ...D.brickAppRoot.split('/')))) appDirs.push(D.brickAppRoot);
if (appDirs.length < Number(D.minApps ?? 0)) {
  coverageLost(
    `found ${appDirs.length} app(s), floor ${D.minApps}.`,
    'The licences-surface limb ranges over apps. With none found it is vacuously satisfied, and the one',
    'app that actually has no surface would stop being reported.',
  );
}

const surfacePatterns = (register.licenceSurfaceCalls?.patterns ?? []).map((p) => new RegExp(p));
if (surfacePatterns.length === 0) {
  coverageLost(
    'the register declares no `licenceSurfaceCalls.patterns`.',
    'With none, no app can ever be found to have a licences surface OR to be missing one — the limb',
    'would fail every app, which is a check nobody keeps, or (if inverted) pass every app, which is worse.',
  );
}
const exempt = new Map((register.licenceSurfaceGaps ?? []).map((g) => [g.app, g]));
// 🔴 THE DOMAIN IS "APPS NOT EXEMPTED", NOT "APPS THAT PASS".
// The first draft made COVERAGE LOST fire when NO app resolved a surface, and a
// mutation exposed it immediately: deleting the brick's AboutListTile — a real
// regression this limb exists to catch — produced "your pattern set is probably
// broken" instead of "the brick ships no licences surface". A guard that reports
// the wrong fault sends the fix to the wrong file. What can genuinely empty out
// is the SCOPE: exempt every app and the limb ranges over nothing.
const inScope = appDirs.filter((a) => !exempt.has(a));
if (inScope.length === 0) {
  coverageLost(
    `all ${appDirs.length} app(s) are exempted in licenceSurfaceGaps, so the limb ranged over nothing.`,
    'An exemption list that has grown to cover the whole domain is a check that has been switched off',
    'one entry at a time, which is how every waiver list in this repository went stale.',
  );
}
let appsWithSurface = 0;
for (const app of appDirs) {
  const libDir = join(repoRoot, ...app.split('/'), 'lib');
  // A CALL SITE, not a string: comments stripped, and each pattern is an
  // invocation. A declaration is not a call — [3]S-2 proved that here already.
  const ownFiles = walk(libDir).filter((f) => f.endsWith('.dart'));
  // The chassis files this app's lib delegates to, resolved one level.
  const delegated = new Set();
  for (const f of ownFiles) {
    const rel = relative(repoRoot, f).split(sep).join('/');
    const d = delegationOf(repoRoot, rel, { describe: () => `\`${rel}\`` });
    if (d && d.lost) {
      problems.push(
        `COVERAGE LOST — \`${rel}\` ${d.lost} The licences-surface limb is read over the stamped ` +
          'chassis, and a delegation it cannot follow is a surface it cannot see.',
      );
      continue;
    }
    for (const t of (d && d.files) || []) delegated.add(join(repoRoot, ...t.split('/')));
  }
  if (delegated.size) {
    prints.push(
      `${app} — the licences-surface scan also read ${delegated.size} chassis file(s) it delegates to: ` +
        `${[...delegated].map((f) => relative(repoRoot, f).split(sep).join('/')).sort().join(', ')}`,
    );
  }
  const has = [...ownFiles, ...delegated].some((f) => {
    const src = stripSourceComments(readFileSync(f, 'utf8'), '.dart');
    return surfacePatterns.some((re) => re.test(src));
  });
  const gap = exempt.get(app);
  if (has) {
    appsWithSurface++;
    if (gap) {
      prints.push(
        `PROMOTE ME: ${app} now ships a licences surface, so it no longer needs its exemption in ` +
          `tooling/legal/asset-register.json licenceSurfaceGaps. Delete that entry (owned by ${gap.owningIncrement}) ` +
          '— after which this app fails the build if the surface is ever removed.',
      );
    }
    continue;
  }
  if (gap) {
    prints.push(
      `NO LICENCES SURFACE (${gap.owningIncrement}) · ${app} — ${gap.why} ${gap.whyPrintedNotFailed}`,
    );
    continue;
  }
  problems.push(
    `${app} ships NO licences surface: nothing under its lib/ constructs an AboutListTile, calls showLicensePage or ` +
      'registers a licence. Every app ships at least the framework and an icon font, so every app owes the reader a ' +
      'way to see what it is built from. (The brick has shipped one since it was written — an app without one has ' +
      'diverged from the chassis rather than made a choice.)',
  );
}

// ── the seam against [7]P-5's content-licence register ──────────────────────
// K-10 owns BUILT-BUNDLE contents; P-5 owns content-pipeline INPUTS. A family
// can be in both, and until 2026-08-13 nothing compared what the two files said
// about one. Both requirement texts now carry the boundary sentence verbatim;
// this is the half of it that fails a build. Runs in BOTH modes — the registers
// are files, so nothing about this comparison depends on a bundle being present.
const seam = crossAssertLicenceRegisters(repoRoot, { side: 'asset' });
problems.push(...seam.problems);
prints.push(...seam.prints);
// The seam module never exits; its could-not-look stops come back in `lost`. When they are ALL
// this run has, the run could not look and exits 2 — with a finding beside them it stays 1.
const seamLost = seam.lost.map((l) => `CROSS-ASSERT COVERAGE LOST — ${l}`);
if (seamLost.length && problems.length === 0) {
  coverageLost(`the licence-register seam was not checked (${seamLost.length} stop(s)):`, ...seamLost);
}
problems.push(...seamLost);

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ licence register — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline K-10/K-11] A store can ask for evidence of rights without warning. The answer is');
  console.error('  a file, or it is a search nobody finishes in time.');
  process.exit(1);
}

console.log(
  `ok  licence register — ${shipped.size} file(s) enumerated in ${bundleDir === null ? 'DECLARED' : 'BUNDLE'} mode, ` +
    `${shipped.size - generatedSeen} of them shipped material with a row` +
    (generatedSeen > 0 ? ` and ${generatedSeen} build-generated (named, with reasons)` : '') +
    `; ${sourced} licence claim(s) carry their evidence`,
);
console.log(
  `    ${appsWithSurface}/${appDirs.length} app(s) construct a real licences surface; ` +
    `${materialDesignPubspecs.length} pubspec(s) still bundle the icon font`,
);
if (appId !== null) {
  console.log(
    `    ${scopeOfApp}: ${appInScope.length} app-scoped row(s), each licence read from the package that ships it ` +
      `(${shown(packageConfig.path)})`,
  );
  for (const l of readLines) console.log(`      ${l}`);
} else if (appRows.length > 0) {
  console.log(
    `    ${appRows.length} app-scoped row(s) shape-checked; each one's licence is read from its package only by a ` +
      '--bundle <dir> --app <id> walk of that app\'s build',
  );
}
if (bundleDir === null) {
  console.log(
    '    ⚠️ DECLARED mode reads what the manifests INTEND to ship. The app_brick lane runs this again with',
  );
  console.log('       --bundle against a real build, which is where intent and output can be seen to differ.');
}
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (an unread upstream licence, or a gap another increment owns) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
