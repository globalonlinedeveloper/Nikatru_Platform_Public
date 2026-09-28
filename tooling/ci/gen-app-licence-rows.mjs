#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// gen-app-licence-rows.mjs — every package asset an app ships gets its licence
// row when the app is stamped, not when its first web build goes red.
//
// [pipeline K-10] "Rights evidence for every third-party asset shipped."
// LEAD RULING NP12B-R2 (LEAD RULING 34, ONE PIPELINE), 2026-09-27: the BRICK's
// stamp step writes the asset-register licence rows for every package asset an
// app ships, through a generator with a guard. This file is both.
//
// ── WHY IT EXISTS ────────────────────────────────────────────────────────────
// Lead ruling PRL-R1 (#1004) gave the register `appScopedAssets`: one row per
// file a pub package ships into ONE app's bundle, its licence read from that
// package's LICENSE by `assert-licence-register.mjs --bundle --app` on every
// web build. Nothing WROTE those rows. App #1's five were typed by hand from a
// red build, and the next app to depend on a package that ships a file would
// meet the same red: train W47 (#1020) ejected NP-12b for exactly that — the
// brick started depending on purchases_flutter, whose web bundle carries
// `purchases_js_hybrid_mappings.js`, and a hand-typed `app:probe` row was
// refused in declared mode because no apps/probe exists in a committed tree.
// The row has to be born WITH the app, in the one command that stamps it.
//
// ── WHAT IT DERIVES, AND FROM WHAT ──────────────────────────────────────────
// From the RESOLVED workspace (`flutter pub get` at the repo root, which
// tooling/kit/stamp-app.mjs now runs before this): the app's runtime closure in
// `.dart_tool/package_graph.json`, each non-workspace package's own
// `flutter: assets:` / `fonts:` declaration, and each package's LICENSE through
// package_config.json — the reading lives in package-assets.mjs and is SHARED
// with the guard, so the row this file writes is the row the guard reads back.
// One row per file the WEB bundle carries (the bundle the app_brick and
// web-artifacts lanes walk), keyed `app:<id>` + bundlePath.
//
// ── WHAT IT OWNS, AND WHAT IT LEAVES TO A PERSON ────────────────────────────
// OWNED (derived every run, compared by --check, rewritten by --write): which
// files have a row (both directions — a row for a file no longer shipped is
// retired), `package`, `licence`, `origin`, `attributionRequired`,
// `attributedIn`. WRITTEN ONCE, then the reader's to edit: `id`, `name`,
// `contentFamily`, `contentFamilyWhy`, `source`, `shippedIn`, any `note`. App
// #1's five hand-written rows keep their prose byte for byte; the generator
// derives the same five keys. A licence the package changes rewrites `source`
// too, because the old note would cite a reading that no longer holds.
//
// ── THE GUARD HALF ──────────────────────────────────────────────────────────
// `--check` exits 1 naming each shipped file with no row (and printing the row
// it would write), each row for a file the app no longer ships (or, run over
// every app, for an app that no longer exists), and each owned field that
// differs. The bundle walk in assert-licence-register.mjs stays the
// SECOND witness: it grades a real build, so a file this reader cannot see
// (a toolchain-injected one, a declaration shape Flutter reads differently)
// still turns a build red.
//
// Usage:  node tooling/ci/gen-app-licence-rows.mjs [repoRoot] (--write | --check) [--app <id>]
//   With no --app, every app under the register's derivation.appRoots.
// Exit 0 = the register carries exactly the derived rows (or --write made it so).
// Exit 1 = --check found a missing, stale or differing row, or a package's
//          LICENSE could not be read to one licence (no row can be written).
// Exit 2 = COVERAGE LOST: no resolved workspace, an app the resolver has never
//          seen, or a declaration this reader cannot place. Never a pass.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';
import {
  packageConfigOf,
  packageGraphOf,
  packageLicence,
  pubspecDependencyNames,
  webShippedPackageAssets,
} from './package-assets.mjs';

export const REGISTER_REL = 'tooling/legal/asset-register.json';
export const GENERATOR_REL = 'tooling/ci/gen-app-licence-rows.mjs';
/** The fields this file derives on every run. Everything else in a row is prose. */
export const OWNED = Object.freeze(['package', 'licence', 'origin', 'attributionRequired', 'attributedIn']);

/** The row for one derived asset, as it is first written. */
export function generatedRow(app, a, licence) {
  const tail = a.bundlePath.replace(/^packages\//, '').split('/').join('-');
  const name = a.bundlePath.split('/').pop();
  return {
    id: `${app}-${tail}`,
    scope: `app:${app}`,
    bundlePath: a.bundlePath,
    package: a.package,
    contentFamily: null,
    contentFamilyWhy:
      'A file a pub package ships into the app\'s bundle. Nothing in the content pipeline reads or produces it.',
    name: `${name} — a file the ${a.package} package ships into this app's web bundle`,
    origin: 'third-party',
    licence,
    attributionRequired: true,
    attributedIn: 'bundle:NOTICES',
    source: {
      note:
        `The ${a.package} package's own LICENSE, read through the resolved workspace's package_config.json by ` +
        `${GENERATOR_REL} when the app was stamped, and re-read by assert-licence-register.mjs --bundle --app on ` +
        'every web build of this app, where the row\'s licence is checked against it and the bundle\'s NOTICES must ' +
        'carry its text.',
    },
    shippedIn:
      `apps/${app}'s web bundle, through ${a.via.join(' → ')}, whose pubspec declares ${a.entry}` +
      (a.webOnly ? ' for the web platform' : '') +
      (a.declaredBy === a.package ? '.' : ` (declared by ${a.declaredBy}).`) +
      ` Derived by ${GENERATOR_REL}.`,
  };
}

/** The app directories under the register's appRoots, repo-relative, sorted. */
function workspaceApps(root, appRoots) {
  const out = [];
  for (const r of appRoots) {
    const abs = join(root, ...r.split('/'));
    if (!existsSync(abs)) continue;
    for (const e of listDir(abs, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(abs, e.name, 'pubspec.yaml'))) out.push({ id: e.name, dir: join(abs, e.name) });
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Plan the register for `root`: every derived row compared with the register.
 * Pure over the files it reads; writes nothing.
 *
 * @returns {{lost: string[], problems: string[], findings: string[], next: object|null,
 *            changed: boolean, apps: {id: string, derived: number, kept: number, added: number,
 *            retired: number, updated: number}[]}}
 */
export function planAppLicenceRows(root, { app = null } = {}) {
  const lost = [];
  const problems = [];
  const findings = [];
  const rel = (p) => {
    const r = relative(root, p);
    return (r.startsWith('..') ? p : r).split(sep).join('/');
  };
  const regPath = join(root, ...REGISTER_REL.split('/'));
  let register;
  try {
    register = JSON.parse(readFileSync(regPath, 'utf8'));
  } catch (e) {
    return { lost: [`${REGISTER_REL} could not be read as JSON (${e.code ?? e.message}).`], problems, findings, next: null, changed: false, apps: [] };
  }
  const appRoots = register.derivation?.appRoots ?? [];
  if (appRoots.length === 0) lost.push(`${REGISTER_REL} declares no derivation.appRoots, so no app could be found.`);
  if (register.appScopedAssets !== undefined && !Array.isArray(register.appScopedAssets)) {
    lost.push(`${REGISTER_REL}'s \`appScopedAssets\` is not an array; nothing was compared.`);
  }
  let apps = workspaceApps(root, appRoots);
  if (app !== null) {
    apps = apps.filter((a) => a.id === app);
    if (apps.length === 0) lost.push(`--app ${app} names no app: no ${appRoots.map((r) => `${r}/${app}/pubspec.yaml`).join(' or ')}.`);
  } else if (apps.length === 0 && appRoots.length > 0) {
    lost.push(`no app was found under ${appRoots.join(', ')}; a generator over no app writes nothing and would print ok.`);
  }
  if (lost.length) return { lost, problems, findings, next: null, changed: false, apps: [] };

  let rows = Array.isArray(register.appScopedAssets) ? register.appScopedAssets.map((r) => ({ ...r })) : [];
  const summary = [];
  let changed = false;
  for (const { id, dir } of apps) {
    const scope = `app:${id}`;
    const pc = packageConfigOf(dir);
    if (pc === null) {
      lost.push(
        `${rel(dir)} has no resolved packages (no .dart_tool/package_config.json, and no workspace_ref.json that leads to ` +
          'one). Run `flutter pub get` AT THE REPO ROOT (never in the app directory): which files an app ships is a ' +
          'question only the resolver answers.',
      );
      continue;
    }
    const graph = packageGraphOf(pc);
    if (graph === null) {
      lost.push(`${rel(pc.path)} has no readable package_graph.json beside it, so the app's dependency closure is unknown.`);
      continue;
    }
    const pubspecText = readFileSync(join(dir, 'pubspec.yaml'), 'utf8');
    const pkgName = stripSourceComments(pubspecText, '.yaml').match(/^name:\s*(\S+)\s*$/m)?.[1];
    if (!pkgName || !graph.byName.has(pkgName)) {
      lost.push(
        `${rel(dir)} (package ${pkgName ?? '?'}) is not in ${rel(graph.path)}: the workspace was resolved before this app ` +
          'joined it. Run `flutter pub get` at the repo root.',
      );
      continue;
    }
    // A resolution older than the pubspec derives the closure the app USED to
    // have. Measured 2026-09-28: a package_graph.json from 2026-09-24 lacked app
    // #1's billing dependency, and the derivation called its purchases_flutter
    // row stale. pub would re-resolve; this reader refuses instead of guessing.
    const resolved = new Set(graph.byName.get(pkgName).dependencies ?? []);
    const unresolved = pubspecDependencyNames(pubspecText).filter((d) => !resolved.has(d));
    if (unresolved.length) {
      lost.push(
        `${rel(dir)}/pubspec.yaml depends on ${unresolved.join(', ')}, and ${rel(graph.path)} does not: the workspace ` +
          'was resolved before the pubspec last changed. Run `flutter pub get` at the repo root.',
      );
      continue;
    }
    const derived = webShippedPackageAssets({ packageConfig: pc, graph, appPackage: pkgName, shown: rel });
    lost.push(...derived.lost.map((l) => `${scope}: ${l}`));
    problems.push(...derived.problems.map((p) => `${scope}: ${p}`));
    if (derived.lost.length) continue;

    const licences = new Map();
    for (const pkg of new Set(derived.assets.map((a) => a.package))) {
      const lic = packageLicence(pc, pkg, rel);
      if (lic.error) problems.push(`${scope}: ${lic.error}; no row can be written for what it ships.`);
      else if (lic.ids.length !== 1) {
        problems.push(
          `${scope}: ${rel(lic.file)} reads as ${lic.ids.length === 0 ? 'no licence this reader can name' : lic.ids.join(' AND ')}. ` +
            'An app-scoped row\'s licence is READ, never UNVERIFIED, so no row can be written: a person reads that LICENSE, and ' +
            'package-assets.mjs learns its text.',
        );
      } else licences.set(pkg, lic.ids[0]);
    }
    const want = new Map(derived.assets.filter((a) => licences.has(a.package)).map((a) => [a.bundlePath, a]));
    const tally = { id, derived: derived.assets.length, kept: 0, added: 0, retired: 0, updated: 0 };

    // Retire, and update owned fields, in place: a row keeps its position.
    const next = [];
    for (const r of rows) {
      if (r.scope !== scope) {
        next.push(r);
        continue;
      }
      const a = want.get(r.bundlePath);
      if (!a) {
        if (derived.assets.some((d) => d.bundlePath === r.bundlePath)) {
          next.push(r); // its package's LICENSE could not be read: the problem above says so
          continue;
        }
        findings.push(
          `${scope}: row ${JSON.stringify(r.id)} claims ${r.bundlePath}, and the app's resolved closure no longer ships it. ` +
            'Retire the row (--write does).',
        );
        tally.retired++;
        changed = true;
        continue;
      }
      const g = generatedRow(id, a, licences.get(a.package));
      const differs = OWNED.filter((f) => JSON.stringify(r[f]) !== JSON.stringify(g[f]));
      if (differs.length) {
        findings.push(
          `${scope}: row ${JSON.stringify(r.id)} (${r.bundlePath}) says ${differs.map((f) => `${f} ${JSON.stringify(r[f] ?? null)}`).join(', ')}; ` +
            `the resolved package reads ${differs.map((f) => `${f} ${JSON.stringify(g[f])}`).join(', ')}. The package is the primary source; the row follows it.`,
        );
        const u = { ...r };
        for (const f of differs) u[f] = g[f];
        if (differs.includes('licence')) u.source = g.source;
        next.push(u);
        tally.updated++;
        changed = true;
      } else {
        next.push(r);
        tally.kept++;
      }
      want.delete(r.bundlePath);
    }
    // Add what is missing, after this app's last row (or at the end), in bundlePath order.
    const add = [...want.values()].map((a) => generatedRow(id, a, licences.get(a.package)));
    for (const g of add) {
      findings.push(
        `${scope}: ${g.bundlePath} ships (package ${g.package}, ${g.licence}) and has NO row in ${REGISTER_REL}. ` +
          `The row ${GENERATOR_REL} --write adds: ${JSON.stringify(g)}`,
      );
    }
    if (add.length) {
      const last = next.map((r) => r.scope).lastIndexOf(scope);
      next.splice(last === -1 ? next.length : last + 1, 0, ...add);
      tally.added += add.length;
      changed = true;
    }
    rows = next;
    summary.push(tally);
  }
  // Every app graded: a row scoped to an app that no longer exists is stale too.
  // assert-licence-register.mjs refuses it in declared mode ("a row for an app
  // nobody builds is a row nobody checks"); --write retires it here.
  if (app === null) {
    const known = new Set(apps.map((a) => `app:${a.id}`));
    const orphans = rows.filter((r) => typeof r.scope === 'string' && r.scope.startsWith('app:') && !known.has(r.scope));
    for (const r of orphans) {
      findings.push(`${r.scope}: row ${JSON.stringify(r.id)} is scoped to an app that no longer exists under ${appRoots.join(', ')}. Retire it (--write does).`);
    }
    if (orphans.length) {
      rows = rows.filter((r) => !orphans.includes(r));
      changed = true;
    }
  }
  // One id, one row, across the whole register (the guard refuses a repeat).
  const ids = new Map();
  for (const r of [...(register.assets ?? []), ...rows]) ids.set(r.id, (ids.get(r.id) ?? 0) + 1);
  for (const [rid, n] of ids) if (n > 1) problems.push(`${n} rows would carry the id ${JSON.stringify(rid)}; rename the hand-written one.`);
  const next = { ...register, appScopedAssets: rows };
  return { lost, problems, findings, next, changed, apps: summary };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const appAt = argv.indexOf('--app');
  const appId = appAt === -1 ? null : argv[appAt + 1] ?? null;
  const known = new Set(['--write', '--check', '--app']);
  const unknown = argv.filter((a) => a.startsWith('--') && !known.has(a));
  // Only a flag that IS present owns the argument after it (assert-licence-register.mjs's trap).
  const flagValues = new Set([appAt].filter((i) => i !== -1).map((i) => i + 1));
  const positional = argv.filter((a, i) => !a.startsWith('--') && !flagValues.has(i));
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  const coverageLost = (lines) => {
    console.error(`✗ COVERAGE LOST — app licence rows: ${lines.length} stop(s); nothing was ${write ? 'written' : 'compared'}.`);
    for (const l of lines) console.error(`    ${l}`);
    process.exit(2);
  };
  if (unknown.length) coverageLost([`unknown flag(s) ${unknown.join(', ')}. Known: ${[...known].join(', ')}.`]);
  if (write === check) coverageLost(['pass exactly one of --write or --check.']);
  if (appAt !== -1 && (appId === null || appId.startsWith('--'))) coverageLost(['--app was given no app id.']);
  const root = resolve(positional[0] ?? process.cwd());
  const plan = planAppLicenceRows(root, { app: appId });
  if (plan.lost.length) coverageLost(plan.lost);
  const regAbs = join(root, ...REGISTER_REL.split('/'));
  if (write && plan.changed && plan.problems.length === 0) writeFileSync(regAbs, `${JSON.stringify(plan.next, null, 2)}\n`);
  const bad = [...plan.problems, ...(check ? plan.findings : [])];
  for (const a of plan.apps) {
    console.log(
      `${bad.length ? '  ' : 'ok '} app:${a.id} — ${a.derived} package file(s) in its web bundle; ${a.kept} row(s) kept` +
        (a.added || a.retired || a.updated
          ? `, ${a.added} ${write ? 'added' : 'missing'}, ${a.retired} ${write ? 'retired' : 'stale'}, ${a.updated} ${write ? 'updated' : 'differing'}`
          : ''),
    );
  }
  if (bad.length) {
    console.error(`✗ app licence rows — ${bad.length} problem(s)${write ? '; the register was NOT written' : ''}:`);
    for (const p of bad) console.error(`    ${p}`);
    console.error('');
    console.error(`  [pipeline K-10] Every file a package ships into an app carries a licence row in ${REGISTER_REL},`);
    console.error(`  written when the app is stamped: node ${GENERATOR_REL} --write --app <id>.`);
    process.exit(1);
  }
  console.log(
    write
      ? `ok  app licence rows — ${plan.changed ? `${REGISTER_REL} written` : `${REGISTER_REL} already carried every derived row; nothing written`}`
      : `ok  app licence rows — ${REGISTER_REL} carries exactly the rows the resolved workspace derives`,
  );
}
