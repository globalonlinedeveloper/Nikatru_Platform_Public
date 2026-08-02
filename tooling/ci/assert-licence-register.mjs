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
// Usage:  node tooling/ci/assert-licence-register.mjs [repoRoot] [--bundle DIR]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

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
const positional = argv.filter((a, i) => !a.startsWith('--') && !(bundleAt !== -1 && i === bundleAt + 1));
const repoRoot = resolve(positional[0] ?? process.cwd());
const REGISTER = join(repoRoot, 'tooling', 'legal', 'asset-register.json');

const problems = [];
const prints = [];
const rel = (p) => relative(repoRoot, p).split(sep).join('/');

const coverageLost = (msg, ...detail) => {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  for (const d of detail) console.error(`  ${d}`);
  process.exit(1);
};

if (!existsSync(REGISTER)) {
  coverageLost(
    `${rel(REGISTER)} does not exist.`,
    'The register is the left-hand side of every comparison here. Absent, this guard compares a real',
    'bundle to nothing and prints ok — see tooling/legal/README.md for why it is in-tree and not under',
    'company/, which is gitignored and invisible to CI.',
  );
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (err) {
  coverageLost(`${rel(REGISTER)} is not valid JSON (${err.message}).`);
}
const D = register.derivation ?? {};

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
const matchKey = (shippedId, shippedName) => {
  if (byKey.has(shippedId)) return byKey.get(shippedId);
  if (bundleDir !== null) {
    for (const a of assets) {
      const base = (a.path ?? '').split('/').pop();
      if (base && base === shippedName) return a;
      if (a.fromFlag && /^MaterialIcons/i.test(shippedName)) return a;
    }
  }
  return null;
};

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
let generatedSeen = 0;
for (const [id, s] of shipped) {
  if (generated.has(s.name)) {
    generatedSeen++;
    continue;
  }
  const row = matchKey(id, s.name);
  if (!row) {
    problems.push(
      `${s.name} ships (${[...new Set(s.where)].join(', ')}) and has NO row in tooling/legal/asset-register.json. ` +
        'A store can ask for evidence of rights to it, and the answer would be a search rather than a file. Add the ' +
        'row — including when the answer is "our own work, all rights reserved", or (if the BUILD emitted it to ' +
        'describe the bundle rather than to ship material) name it in `generatedBundleFiles` with a reason.',
    );
    continue;
  }
  matched.add(keyOf(row));
}

// ── the reverse direction, and WHICH MODE MAY ASSERT IT ─────────────────────
// 🔴 A SINGLE APP'S BUNDLE CANNOT WITNESS THE WHOLE WORKSPACE, and the first CI
// run of the bundle step proved it: the lane walks apps/probe (a throwaway stamp
// with no brand assets) and the guard reported all three of apps/subly's brand
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
  const has = walk(libDir)
    .filter((f) => f.endsWith('.dart'))
    .some((f) => {
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
