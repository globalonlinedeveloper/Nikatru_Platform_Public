// ─────────────────────────────────────────────────────────────────────────────
// package-assets.mjs — the ONE reading of "which files does a resolved pub
// package ship into an app's web bundle, and which licence does its LICENSE
// read as".
//
// [pipeline K-10] "Rights evidence for every third-party asset shipped."
// LEAD RULING NP12B-R2 (LEAD RULING 34, ONE PIPELINE), 2026-09-27.
//
// TWO READERS, ONE ANSWER. assert-licence-register.mjs grades a BUILT bundle
// against the register's `appScopedAssets` rows and reads each row's licence
// from the package's own LICENSE (lead ruling PRL-R1). gen-app-licence-rows.mjs
// WRITES those rows at stamp time, from the resolved workspace, before any build
// exists. Until this module the classifier lived inside the guard, which is a
// script and cannot be imported; a generator carrying a second copy of it could
// classify a LICENSE one way while the guard read it another, and a row the
// generator wrote would be red on its first build for a reason neither file
// could name. So the classifier, the package_config reader and the package's
// LICENSE lookup moved here UNCHANGED, and both files import them.
//
// WHAT "SHIPS" MEANS HERE, measured on this workspace 2026-09-28:
//   · the app's TRANSITIVE `dependencies` closure in the resolver's own
//     `.dart_tool/package_graph.json` (never `devDependencies`: a release build
//     bundles no dev dependency's assets). A package outside the closure ships
//     nothing: the probe resolved in the same workspace as app #1 and its web
//     bundle carried none of app #1's five package files (prlane2, PRL-R1);
//   · of those, only packages OUTSIDE the workspace. A workspace package's
//     declared assets are the shared `assets` rows' domain (declared mode);
//   · each package's `flutter: assets:`, `fonts:` and `shaders:` entries, as
//     Flutter keys them in the bundle: `assets/x` → `packages/<pkg>/assets/x`, while an
//     entry already written `packages/<p>/rest` names `<p>`'s `lib/rest` and keeps
//     its key (flutter_inappwebview 6.1.5 declares its T-Rex page that way, and
//     material_ui 1.4.0 its `packages/material_ui/shaders/ink_sparkle.frag`, which
//     the web build ships compiled under that same key: train W55's red 3);
//     a directory entry ships the files directly inside it, plus any resolution
//     variant (`2.0x/<file>`) of one of them;
//   · an entry with `platforms:` ships in the web bundle only when the list
//     names `web` (purchases_flutter 10.13.1: `- path: assets/web/` for web only).
//
// ⚠️ IT READS A SUBSET OF PUBSPEC YAML AND REFUSES THE REST. An asset entry it
// cannot place — a `flavors:` filter (an unflavoured web build would drop it,
// and this reader does not model which build is which), a mapping with no
// `path:`, an unterminated flow list — comes back in `lost`, never as "ships
// nothing". A reader that guessed would write a register that agrees with
// itself and not with the bundle.
//
// Pure functions over files: no process arguments, no exit. Every caller owns
// its own COVERAGE LOST over the `lost` reasons it is handed.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

/** The row `package` for an engine or web asset of the Flutter SDK itself. */
export const SDK_PACKAGE = 'sdk:flutter';

const lead = (l) => l.length - l.trimStart().length;

// ── the primary licence source: the LICENSE of the package that ships it ────
// Recognised by the operative sentences of each text, whitespace and case
// ignored. A LICENSE that reads as none of these, or as more than one, is a
// finding: the row's licence could not be read from its source.
export const LICENCE_TEXTS = [
  {
    id: 'Apache-2.0',
    all: ['apache license', 'version 2.0, january 2004', 'terms and conditions for use, reproduction, and distribution'],
  },
  {
    id: 'MIT',
    all: [
      'permission is hereby granted, free of charge, to any person obtaining a copy',
      'the above copyright notice and this permission notice shall be included in all copies or substantial portions of the software',
    ],
  },
  {
    id: 'BSD-3-Clause',
    all: [
      'redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met',
      'neither the name of',
    ],
  },
  {
    id: 'BSD-2-Clause',
    all: [
      'redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met',
    ],
    none: ['neither the name of'],
  },
];
export const flat = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
export const classifyLicence = (text) => {
  const t = flat(text);
  return LICENCE_TEXTS.filter((l) => l.all.every((p) => t.includes(p)) && !(l.none ?? []).some((p) => t.includes(p))).map(
    (l) => l.id,
  );
};
export const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE'];

/** The package_config.json an app resolves through: its own, or — in a pub
 *  workspace, measured on this tree 2026-09-26 — the workspace root's, which
 *  `.dart_tool/pub/workspace_ref.json` names relative to its own directory. */
export function packageConfigOf(appDir) {
  const own = join(appDir, '.dart_tool', 'package_config.json');
  if (existsSync(own)) return readPackageConfig(own);
  const ref = join(appDir, '.dart_tool', 'pub', 'workspace_ref.json');
  if (!existsSync(ref)) return null;
  let root;
  try {
    root = JSON.parse(readFileSync(ref, 'utf8')).workspaceRoot;
  } catch {
    return null;
  }
  if (typeof root !== 'string' || root.trim() === '') return null;
  const cfg = join(resolve(dirname(ref), ...root.split(/[\\/]+/)), '.dart_tool', 'package_config.json');
  return existsSync(cfg) ? readPackageConfig(cfg) : null;
}

export function readPackageConfig(path) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(doc.packages)) return null;
  return { path, doc, byName: new Map(doc.packages.map((p) => [p.name, p])) };
}

/** The directory a resolved package lives in, or { error }. `shown` renders a
 *  path for a message; the guard passes its repo-relative renderer. */
export function packageRootOf(packageConfig, pkg, shown = (p) => p) {
  if (pkg === SDK_PACKAGE) {
    const fr = packageConfig.doc.flutterRoot;
    if (typeof fr !== 'string' || fr.trim() === '') {
      return { error: `${shown(packageConfig.path)} carries no flutterRoot, so the Flutter SDK's LICENSE cannot be found` };
    }
    return { root: fileURLToPath(new URL(fr.endsWith('/') ? fr : `${fr}/`, pathToFileURL(packageConfig.path))) };
  }
  const p = packageConfig.byName.get(pkg);
  if (!p || typeof p.rootUri !== 'string') {
    return { error: `package ${pkg} is not in ${shown(packageConfig.path)}, so this app does not resolve it` };
  }
  return { root: fileURLToPath(new URL(p.rootUri.endsWith('/') ? p.rootUri : `${p.rootUri}/`, pathToFileURL(packageConfig.path))) };
}

/** { file, text, ids } for a package this app resolved, or { error }. */
export function packageLicence(packageConfig, pkg, shown = (p) => p) {
  const at = packageRootOf(packageConfig, pkg, shown);
  if (at.error) return { error: at.error };
  const file = LICENCE_FILES.map((n) => join(at.root, n)).find((f) => existsSync(f));
  if (!file) return { error: `${pkg} carries no LICENSE file at ${shown(at.root)}` };
  const text = readFileSync(file, 'utf8');
  return { file, text, ids: classifyLicence(text) };
}

// ── the resolver's dependency graph ─────────────────────────────────────────

/** `.dart_tool/package_graph.json` beside a package_config, or null. pub writes
 *  both on every `pub get` (pub 3.8+); `roots` are the workspace's own packages. */
export function packageGraphOf(packageConfig) {
  const path = join(dirname(packageConfig.path), 'package_graph.json');
  if (!existsSync(path)) return null;
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(doc.packages) || !Array.isArray(doc.roots)) return null;
  return { path, roots: new Set(doc.roots), byName: new Map(doc.packages.map((p) => [p.name, p])) };
}

/** The app's runtime closure, breadth first with sorted edges so the chain each
 *  package is reached through is the same on every machine. Returns
 *  { via: Map<name, string[]> } — the dependency chain from the app — or
 *  { error } when the app or an edge is not in the graph. */
export function runtimeClosure(graph, appPackage) {
  const app = graph.byName.get(appPackage);
  if (!app) return { error: `package ${appPackage} is not in ${graph.path}` };
  const via = new Map();
  const queue = [...(app.dependencies ?? [])].sort().map((n) => [n, [appPackage, n]]);
  while (queue.length) {
    const [name, chain] = queue.shift();
    if (via.has(name)) continue;
    const node = graph.byName.get(name);
    if (!node) return { error: `${chain.join(' → ')}: ${name} is not in ${graph.path}` };
    via.set(name, chain);
    for (const d of [...(node.dependencies ?? [])].sort()) if (!via.has(d)) queue.push([d, [...chain, d]]);
  }
  return { via };
}

/** The names under a pubspec's top-level `dependencies:` block, comments
 *  stripped. A resolution that lacks one of them is older than the pubspec. */
export function pubspecDependencyNames(pubspecText) {
  const lines = stripSourceComments(pubspecText, '.yaml').split(/\r?\n/);
  const top = lines.findIndex((l) => /^dependencies:\s*$/.test(l));
  if (top === -1) return [];
  const names = [];
  let indent = null;
  for (let i = top + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    const n = lead(l);
    if (n === 0) break;
    indent ??= n;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(l.trim());
    if (n === indent && m) names.push(m[1]);
  }
  return names.sort();
}

// ── a package's own declaration of what it ships ────────────────────────────

const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2');

/** A flow list `[a, b]` or a block list under `key:` starting at line i. */
function readList(lines, i, indent) {
  const inline = lines[i].trim().replace(/^[^:]+:\s*/, '');
  if (inline !== '') {
    const m = /^\[(.*)\]$/.exec(inline);
    return m ? { values: m[1].split(',').map(unquote).filter(Boolean), next: i + 1 } : { error: `\`${lines[i].trim()}\`` };
  }
  const values = [];
  let j = i + 1;
  for (; j < lines.length && (lines[j].trim() === '' || lead(lines[j]) > indent); j++) {
    const m = /^-\s*(.+)$/.exec(lines[j].trim());
    if (m) values.push(unquote(m[1]));
  }
  return { values, next: j };
}

/**
 * The `flutter: assets:`, `fonts:` and `shaders:` entries of one pubspec, comments
 * stripped. Returns { assets: [{entry, platforms}], fonts: [entry], shaders: [entry],
 * unread: [] }
 * where `platforms` is null for an entry every platform ships. Anything this
 * reader cannot place is an `unread` reason, never a silent omission.
 */
export function flutterAssetEntries(pubspecText) {
  const lines = stripSourceComments(pubspecText, '.yaml').split(/\r?\n/);
  const out = { assets: [], fonts: [], shaders: [], unread: [] };
  const top = lines.findIndex((l) => /^flutter:\s*$/.test(l));
  if (top === -1) return out;
  let end = top + 1;
  while (end < lines.length && (lines[end].trim() === '' || lead(lines[end]) > 0)) end++;
  const block = lines.slice(top + 1, end);
  const childIndent = block.find((l) => l.trim() !== '');
  if (childIndent === undefined) return out;
  const ci = lead(childIndent);
  for (let i = 0; i < block.length; i++) {
    const l = block[i];
    if (l.trim() === '' || lead(l) !== ci) continue;
    const key = /^(assets|fonts|shaders):\s*(.*)$/.exec(l.trim());
    if (!key) continue;
    if (key[2] !== '') {
      out.unread.push(`\`flutter: ${key[1]}:\` carries an inline value (${key[2]}), which this reader does not read`);
      continue;
    }
    let j = i + 1;
    const body = [];
    for (; j < block.length && (block[j].trim() === '' || lead(block[j]) > ci); j++) body.push(block[j]);
    if (key[1] === 'fonts') {
      for (const b of body) {
        const m = /^(?:-\s*)?asset:\s*(.+)$/.exec(b.trim());
        if (m) out.fonts.push(unquote(m[1]));
      }
      continue;
    }
    if (key[1] === 'shaders') {
      // A shader entry is a plain path; anything else is refused, not skipped.
      for (const b of body) {
        if (b.trim() === '') continue;
        const m = /^-\s*(.+)$/.exec(b.trim());
        if (m && !/^[A-Za-z_]+:(\s|$)/.test(m[1])) out.shaders.push(unquote(m[1]));
        else out.unread.push(`a shader line \`${b.trim()}\` is not a plain list item`);
      }
      continue;
    }
    const items = body.filter((b) => b.trim() !== '');
    const ii = items.length ? lead(items[0]) : 0;
    for (let k = 0; k < body.length; k++) {
      const b = body[k];
      if (b.trim() === '' || lead(b) !== ii) continue;
      const item = /^-\s*(.*)$/.exec(b.trim());
      if (!item) {
        out.unread.push(`an asset line \`${b.trim()}\` is not a list item`);
        continue;
      }
      const map = /^([A-Za-z_]+):\s*(.*)$/.exec(item[1]);
      if (!map) {
        out.assets.push({ entry: unquote(item[1]), platforms: null });
        continue;
      }
      // The mapping form: `- path: x` and its keys, on this line and below it.
      const fields = new Map([[map[1], { line: k, text: `${' '.repeat(ii + 2)}${item[1]}` }]]);
      let m2 = k + 1;
      for (; m2 < body.length && (body[m2].trim() === '' || lead(body[m2]) > ii); m2++) {
        const f = /^([A-Za-z_]+):/.exec(body[m2].trim());
        if (f && lead(body[m2]) === ii + 2) fields.set(f[1], { line: m2, text: body[m2] });
      }
      const path = fields.get('path');
      if (!path) {
        out.unread.push(`an asset mapping \`${item[1]}\` has no \`path:\``);
        continue;
      }
      if (fields.has('flavors')) {
        out.unread.push(
          `the asset ${unquote(path.text.trim().replace(/^path:\s*/, ''))} is filtered by \`flavors:\`, and this reader does not model which build carries a flavour`,
        );
        continue;
      }
      let platforms = null;
      const pf = fields.get('platforms');
      if (pf) {
        const lines2 = body.slice(0);
        lines2[pf.line] = pf.text;
        const list = readList(lines2, pf.line, ii + 2);
        if (list.error) {
          out.unread.push(`the platforms of an asset read ${list.error}, which this reader does not read`);
          continue;
        }
        platforms = list.values;
      }
      out.assets.push({ entry: unquote(path.text.trim().replace(/^path:\s*/, '')), platforms });
    }
  }
  return out;
}

const VARIANT = /^\d+(\.\d+)?x$/;

/**
 * Every file the app's resolved runtime closure ships into its WEB bundle from a
 * package outside the workspace, keyed as the bundle keys it.
 *
 * @returns {{assets: {bundlePath: string, package: string, file: string, declaredBy: string, entry: string,
 *                     webOnly: boolean, via: string[]}[], lost: string[], problems: string[]}}
 */
export function webShippedPackageAssets({ packageConfig, graph, appPackage, shown = (p) => p }) {
  const assets = [];
  const lost = [];
  const problems = [];
  const closure = runtimeClosure(graph, appPackage);
  if (closure.error) return { assets, lost: [closure.error], problems };
  const seen = new Set();
  for (const [pkg, via] of [...closure.via].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (graph.roots.has(pkg)) continue; // a workspace package: the shared rows' domain
    const at = packageRootOf(packageConfig, pkg, shown);
    if (at.error) {
      lost.push(at.error);
      continue;
    }
    const pubspec = join(at.root, 'pubspec.yaml');
    if (!existsSync(pubspec)) continue; // the SDK's sky_engine and friends declare nothing
    const decl = flutterAssetEntries(readFileSync(pubspec, 'utf8'));
    for (const u of decl.unread) lost.push(`${shown(pubspec)}: ${u}`);
    const ship = (entry, platforms) => {
      if (platforms !== null && !platforms.includes('web')) return;
      // `packages/<p>/rest` names <p>'s lib/rest and keeps its key.
      const pref = /^packages\/([^/]+)\/(.+)$/.exec(entry);
      let owner = pkg;
      let base = at.root;
      let key = `packages/${pkg}/${entry}`;
      let rel = entry;
      if (pref) {
        owner = pref[1];
        const o = packageRootOf(packageConfig, owner, shown);
        if (o.error) {
          lost.push(`${shown(pubspec)} declares ${entry}: ${o.error}`);
          return;
        }
        base = join(o.root, 'lib');
        key = entry;
        rel = pref[2];
      }
      const abs = join(base, ...rel.split('/').filter(Boolean));
      if (!existsSync(abs)) {
        problems.push(`${shown(pubspec)} declares the asset ${entry} and ${shown(abs)} does not exist; Flutter would fail the build.`);
        return;
      }
      const add = (bundlePath, file) => {
        if (seen.has(bundlePath)) return;
        seen.add(bundlePath);
        assets.push({ bundlePath, package: owner, file, declaredBy: pkg, entry, webOnly: platforms !== null, via });
      };
      if (!statSync(abs).isDirectory()) {
        add(key, abs);
        return;
      }
      const dirKey = key.endsWith('/') ? key : `${key}/`;
      const entries = listDir(abs, { withFileTypes: true });
      for (const e of entries.filter((x) => x.isFile())) add(`${dirKey}${e.name}`, join(abs, e.name));
      for (const v of entries.filter((x) => x.isDirectory() && VARIANT.test(x.name))) {
        for (const e of entries.filter((x) => x.isFile())) {
          const variant = join(abs, v.name, e.name);
          if (existsSync(variant)) add(`${dirKey}${v.name}/${e.name}`, variant);
        }
      }
    };
    for (const a of decl.assets) ship(a.entry, a.platforms);
    for (const f of decl.fonts) ship(f, null);
    for (const s of decl.shaders) ship(s, null);
  }
  assets.sort((a, b) => (a.bundlePath < b.bundlePath ? -1 : a.bundlePath > b.bundlePath ? 1 : 0));
  return { assets, lost, problems };
}
