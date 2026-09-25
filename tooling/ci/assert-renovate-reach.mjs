#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-renovate-reach.mjs — every Renovate bump reaches every copy the
// version guard reads. Row: O-RENOVATE-BUMP-CANNOT-REACH-A-PINNED-COPY.
//
// 🔴 WHY THIS EXISTS. Renovate advances tooling/versions.json. The version guard
// (assert-version-consistency.mjs) then refuses every OTHER copy of that value
// that still says the old one. Both are right, and together they produced a bump
// PR that can never go green without a human: #860 (flutter 3.47.4 → 3.47.5)
// went red at exactly one site, the FLUTTER_VERSION literal in
// tooling/wsl-setup.sh, which no customManager read. assert-update-coverage.mjs
// could not see it, because it asks "does some manager reach the DECLARATION?",
// and the declaration was reached. The question nobody asked is the reverse one:
// "does the bump reach every COPY the version guard compares against it?"
//
// WHAT IT PROVES, per Renovate-managed key (a customManager depName whose
// managerFilePatterns match tooling/versions.json and whose value is a string):
//   1. copy only the version guard's own target set (collectTargets) plus
//      tooling/versions.json and renovate.json into a temp directory;
//   2. write a sentinel version into every `currentValue` span of every
//      customManager with that depName — exactly the spans Renovate rewrites;
//   3. run the REAL version guard on the copy, and name every site it still
//      reports. A site it still reports is a site the bump PR goes red at.
// The sentinel is 99.98.97, or 99 when the value is a bare major.
//
// A site the guard still reports is NOT a finding when renovate.json declares
// that no bump is meant to land by itself:
//   · FLOOR — an `enabled: false` rule whose matchDatasources holds the key's
//     datasource and whose matchUpdateTypes disables minor and patch but not
//     major. A major is then a hand landing by design (java, node).
//   · HAND  — a rule labelled needs-manual-check with no matchUpdateTypes that
//     names the key (matchDepNames) or its package (matchPackageNames). It must
//     agree, in BOTH directions, with HAND_ONLY in
//     tooling/scripts/propagate-versions.mjs, which says the same thing to the
//     script that writes these sites. A hand decision declared in two places
//     drifts; this guard turns that drift into a finding.
//
// ⚠️ WHAT IT MODELS RATHER THAN OBSERVES. Renovate's BUILT-IN managers also
// write some of these copies: pub writes `melos:` in pubspec.yaml, npm writes
// `wrangler` in the brick package.json, github-actions writes `wranglerVersion:`
// in the workflows. BUILTIN below is this guard's model of those writes, taken
// from the detections on the Dependency Dashboard (#417, read 2026-09-21), NOT
// from running Renovate. A built-in write counts as reaching a copy only when a
// packageRule puts that depName on ONE branch (groupedByDepName) — otherwise it
// lands on a different PR than the versions.json bump, and each PR is red alone.
// A grouped BUILTIN row that matches no site is COVERAGE LOST: the model has
// gone blind to the copy it claims the built-in manager writes.
//
// Usage:  node tooling/ci/assert-renovate-reach.mjs [repoRoot]
// Exit 0 = every managed key's bump leaves the version guard green, or is a
//          declared FLOOR / HAND decision;
//      1 = a site no bump reaches, or HAND_ONLY and renovate.json disagree;
//      2 = COVERAGE LOST — it could not look (a missing input, a guard that is
//          not green before any mutation, a key that is neither managed nor
//          exempted, a grouped BUILTIN row that matched nothing, a run the
//          version guard could not finish).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RULES, collectTargets } from './assert-version-consistency.mjs';
import { matchesPath } from './assert-update-coverage.mjs';
import { boundedSpawn, timeoutFromEnv } from './bounded-spawn.mjs';
import { HAND_ONLY } from '../scripts/propagate-versions.mjs';

const VERSIONS_REL = 'tooling/versions.json';
const RENOVATE_REL = 'renovate.json';
const VERSION_GUARD = fileURLToPath(new URL('./assert-version-consistency.mjs', import.meta.url));
const SENTINEL_SEMVER = '99.98.97';
const SENTINEL_MAJOR = '99';
const HAND_LABEL = 'needs-manual-check';
const BRICK_PKG = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/package.json';
const WRANGLER_ISLAND_PKG = 'tooling/wrangler/package.json';
// One version-guard run is about a second; the bound only has to catch a hang.
const GUARD_TIMEOUT_MS = timeoutFromEnv('RENOVATE_REACH_TIMEOUT_MS', 60_000);

/** The built-in manager writes this guard MODELS (see the header). Each row's
 *  `re` names the span Renovate would rewrite as the `currentValue` group. */
export const BUILTIN = [
  { key: 'melos', manager: 'pub', file: (p) => p === 'pubspec.yaml', re: '\\n\\s+melos:\\s*(?<currentValue>[0-9][^\\s#]*)' },
  // npm also reaches the tooling/wrangler island (2026-09-24, EXT-3): it is not under renovate.json ignorePaths.
  { key: 'wrangler', manager: 'npm', file: (p) => p === BRICK_PKG || p === WRANGLER_ISLAND_PKG, re: '"wrangler":\\s*"(?<currentValue>[^"]+)"' },
  { key: 'wrangler', manager: 'github-actions', file: (p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p), re: "wranglerVersion:\\s*'(?<currentValue>[0-9][^']*)'" },
];

/** Replace every `currentValue` span `reSrc` finds in `text` with `value`. */
export function spliceAll(text, reSrc, value) {
  const spans = [];
  for (const hit of text.matchAll(new RegExp(reSrc, 'gd'))) {
    const g = hit.indices?.groups?.currentValue;
    if (g) spans.push(g);
  }
  let out = text;
  for (const [s, e] of spans.sort((a, b) => b[0] - a[0])) out = out.slice(0, s) + value + out.slice(e);
  return { out, n: spans.length };
}

const matchersOf = (r) => Object.keys(r).filter((k) => k.startsWith('match'));

/** True when renovate.json puts every update of `key` on ONE branch: a rule
 *  whose only matcher is matchDepNames holding the key sets groupName, and no
 *  LATER rule that can match the key sets another (later rules win). */
export function groupedByDepName(rules, key) {
  let idx = -1;
  rules.forEach((r, i) => {
    const m = matchersOf(r);
    if (m.length === 1 && m[0] === 'matchDepNames' && r.matchDepNames.includes(key) && typeof r.groupName === 'string') idx = i;
  });
  if (idx < 0) return false;
  // A later groupName wins only if that rule CAN match this dep: one whose matchDepNames excludes it cannot.
  const canMatch = (r) => !Array.isArray(r.matchDepNames) || r.matchDepNames.includes(key);
  return !rules.slice(idx + 1).some((r) => 'groupName' in r && canMatch(r));
}

/** The index of the rule that declares `key` a FLOOR, or -1. */
export function floorRuleIndex(rules, key, datasource) {
  const allowed = new Set(['matchDatasources', 'matchUpdateTypes']);
  const namesKey = (r, k) => (k === 'matchDepNames' || k === 'matchPackageNames') && Array.isArray(r[k]) && r[k].includes(key);
  const idx = rules.findIndex(
    (r) =>
      r.enabled === false &&
      Array.isArray(r.matchDatasources) &&
      r.matchDatasources.includes(datasource) &&
      Array.isArray(r.matchUpdateTypes) &&
      r.matchUpdateTypes.includes('minor') &&
      r.matchUpdateTypes.includes('patch') &&
      !r.matchUpdateTypes.includes('major') &&
      matchersOf(r).every((k) => allowed.has(k) || namesKey(r, k)),
  );
  // A later rule that switches updates back on undoes the floor.
  if (idx >= 0 && rules.slice(idx + 1).some((r) => r.enabled === true)) return -1;
  return idx;
}

/** The index of the rule that declares `key` a HAND decision, or -1. */
export function handRuleIndex(rules, key, packageNames) {
  return rules.findIndex(
    (r) =>
      Array.isArray(r.labels) &&
      r.labels.includes(HAND_LABEL) &&
      !('matchUpdateTypes' in r) &&
      ((Array.isArray(r.matchDepNames) && r.matchDepNames.includes(key)) ||
        (Array.isArray(r.matchPackageNames) && r.matchPackageNames.some((n) => n === key || packageNames.has(n)))),
  );
}

const sentinelFor = (value) => (/^[0-9]+$/.test(value) ? SENTINEL_MAJOR : SENTINEL_SEMVER);
const firstLines = (text, n) => text.split(/\r?\n/).filter((l) => l.trim()).slice(0, n);

/** Copy `rels` out of `root` into a fresh temp directory. */
function copyInto(root, rels) {
  const dir = mkdtempSync(join(tmpdir(), 'renovate-reach-'));
  for (const rel of rels) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    copyFileSync(join(root, rel), join(dir, rel));
  }
  return dir;
}

/** Run the REAL version guard on `dir` and parse the sites it reports. */
function runGuard(dir) {
  const r = boundedSpawn(process.execPath, [VERSION_GUARD, dir], { timeoutMs: GUARD_TIMEOUT_MS, label: 'assert-version-consistency.mjs' });
  const text = `${r.stdout}\n${r.stderr}`;
  const sites = [...text.matchAll(/^ {4}(\S+?):(\d+) (.+)$/gm)].map((m) => ({
    file: m[1].replace(/\\/g, '/'),
    line: Number(m[2]),
    msg: m[3].trim(),
  }));
  const okLine = r.stdout.split(/\r?\n/).find((l) => l.startsWith('ok  ')) ?? '';
  return { ...r, text, sites, okLine };
}

function main() {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

  // ── inputs ──────────────────────────────────────────────────────────────────
  for (const rel of [RENOVATE_REL, VERSIONS_REL]) {
    if (!existsSync(join(root, rel))) {
      coverageLost([
        `${rel} is missing under ${root}, so no Renovate bump can be modelled.`,
        'Without it this guard would judge nothing and read as agreement.',
      ]);
    }
  }
  let config;
  let versions;
  try {
    config = JSON.parse(readFileSync(join(root, RENOVATE_REL), 'utf8'));
    versions = JSON.parse(readFileSync(join(root, VERSIONS_REL), 'utf8'));
  } catch (e) {
    coverageLost([`${RENOVATE_REL} or ${VERSIONS_REL} does not parse (${e.message}).`]);
  }
  const managers = Array.isArray(config.customManagers) ? config.customManagers : [];
  const rules = Array.isArray(config.packageRules) ? config.packageRules : [];
  const patternsOf = (m) => (Array.isArray(m.managerFilePatterns) ? m.managerFilePatterns : []);

  const declManagers = managers.filter((m) => patternsOf(m).some((p) => matchesPath(p, VERSIONS_REL)));
  const managedKeys = [...new Set(declManagers.map((m) => m.depNameTemplate))].filter((k) => typeof versions[k] === 'string');
  if (managedKeys.length === 0) {
    coverageLost([
      `renovate.json has no customManager that reads a string key of ${VERSIONS_REL}, so there are zero managed keys to bump.`,
      'A reach check over zero keys proves nothing.',
    ]);
  }

  const exempt = new Set((Array.isArray(versions.$updateExemptions) ? versions.$updateExemptions : []).map((e) => e?.key));
  const orphans = Object.entries(versions)
    .filter(([k, v]) => !k.startsWith('$') && typeof v === 'string' && !managedKeys.includes(k) && !exempt.has(k))
    .map(([k]) => k);
  if (orphans.length) {
    coverageLost([
      `${VERSIONS_REL} declares ${orphans.map((k) => `"${k}"`).join(', ')} with no customManager and no $updateExemptions entry.`,
      'No bump moves it and nothing says why, so its copies cannot be judged either way.',
    ]);
  }

  // ── the copy set, and a baseline the mutations can be attributed against ──────
  const targets = collectTargets(root).map((p) => p.replace(/\\/g, '/'));
  const files = [...new Set([...targets, VERSIONS_REL])];
  const copySet = [...files, RENOVATE_REL];

  const base = runGuard(root);
  if (!base.ok) {
    coverageLost([
      `the version guard is not green on the unmutated tree (${base.detail}), so no site can be attributed to a bump.`,
      ...firstLines(base.text, 6),
    ]);
  }
  const pristineDir = copyInto(root, copySet);
  let pristine;
  try {
    pristine = runGuard(pristineDir);
  } finally {
    rmSync(pristineDir, { recursive: true, force: true });
  }
  if (!pristine.ok || pristine.okLine !== base.okLine) {
    coverageLost([
      `the copy this guard mutates does not reproduce the version guard's own reading of the tree (${pristine.detail}).`,
      `tree: ${base.okLine}`,
      `copy: ${pristine.okLine || firstLines(pristine.text, 1)[0] || '(no output)'}`,
    ]);
  }

  // ── one mutation per managed key ─────────────────────────────────────────────
  const unreached = [];
  const couldNotJudge = [];
  for (const key of managedKeys) {
    const ds = declManagers.find((m) => m.depNameTemplate === key).datasourceTemplate;
    const keyManagers = managers.filter((m) => m.depNameTemplate === key);
    const packageNames = new Set(keyManagers.map((m) => m.packageNameTemplate).filter((n) => typeof n === 'string'));
    const sentinel = sentinelFor(versions[key]);
    if (versions[key] === sentinel) {
      couldNotJudge.push(`${key}: its declared value already equals the sentinel ${sentinel}, so a bump to it moves nothing.`);
      continue;
    }
    const moved = [];
    const dir = copyInto(root, copySet);
    let after;
    let blind = null;
    try {
      for (const m of keyManagers) {
        for (const f of files) {
          if (!patternsOf(m).some((p) => matchesPath(p, f))) continue;
          let text = readFileSync(join(dir, f), 'utf8');
          let n = 0;
          for (const ms of Array.isArray(m.matchStrings) ? m.matchStrings : []) {
            const r = spliceAll(text, ms, sentinel);
            text = r.out;
            n += r.n;
          }
          if (n) {
            writeFileSync(join(dir, f), text);
            moved.push(`${f} x${n}`);
          }
        }
      }
      let declared;
      try {
        declared = JSON.parse(readFileSync(join(dir, VERSIONS_REL), 'utf8'))[key];
      } catch (e) {
        declared = `(unparseable: ${e.message})`;
      }
      if (declared !== sentinel) {
        couldNotJudge.push(`${key}: its customManager did not move ${VERSIONS_REL} (it now reads ${JSON.stringify(declared)}), so the bump modelled here is not the one Renovate makes.`);
        continue;
      }
      if (groupedByDepName(rules, key)) {
        for (const b of BUILTIN.filter((x) => x.key === key)) {
          let n = 0;
          for (const f of files.filter(b.file)) {
            const r = spliceAll(readFileSync(join(dir, f), 'utf8'), b.re, sentinel);
            if (r.n) {
              writeFileSync(join(dir, f), r.out);
              moved.push(`${f} x${r.n} (${b.manager}, grouped)`);
              n += r.n;
            }
          }
          if (n === 0) {
            blind = [
              `the grouped built-in ${b.manager} row for "${key}" matched no site in the version guard's targets.`,
              `renovate.json groups "${key}" onto one branch because the ${b.manager} manager writes a copy of it; that copy is no longer where this guard's model looks (${b.re}).`,
              'Re-read the Dependency Dashboard and correct BUILTIN, or remove the group rule if the copy is gone.',
            ];
            break;
          }
        }
      }
      if (!blind) after = runGuard(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (blind) coverageLost(blind);

    const floorIdx = floorRuleIndex(rules, key, ds);
    const handIdx = handRuleIndex(rules, key, packageNames);
    let status;
    if (after.status === 0) status = 'ok';
    else if (after.status === 1 && after.sites.length > 0) {
      if (floorIdx >= 0) status = `declared FLOOR (packageRules[${floorIdx}])`;
      else if (handIdx >= 0) status = `declared HAND (packageRules[${handIdx}])`;
      else {
        status = 'UNREACHED';
        for (const s of after.sites) unreached.push(`${s.file}:${s.line} ${key} — ${s.msg}`);
      }
    } else {
      status = 'COULD NOT JUDGE';
      couldNotJudge.push(`${key}: the version guard on the mutated copy answered ${after.detail} — ${firstLines(after.text, 1)[0] ?? '(no output)'}`);
    }
    console.log(`  ${status.padEnd(32)} ${key} [${ds}] — moved ${moved.join(', ') || 'nothing'}`);
    if (status !== 'ok') for (const s of after.sites) console.log(`      ${s.file}:${s.line} ${s.msg}`);
  }

  // ── HAND_ONLY and the hand rules must say the same thing ──────────────────────
  const disagreements = [];
  const keyOfLabel = new Map(RULES.map((r) => [r.label, r.key]));
  const handOnlyKeys = new Set();
  for (const label of HAND_ONLY.keys()) {
    const key = keyOfLabel.get(label);
    if (!key) {
      disagreements.push(`HAND_ONLY names "${label}", which is no rule label in assert-version-consistency.mjs RULES.`);
      continue;
    }
    handOnlyKeys.add(key);
    const pkgs = new Set(managers.filter((m) => m.depNameTemplate === key).map((m) => m.packageNameTemplate).filter((n) => typeof n === 'string'));
    if (handRuleIndex(rules, key, pkgs) < 0) {
      disagreements.push(`HAND_ONLY (tooling/scripts/propagate-versions.mjs) names "${label}" (key ${key}) a hand decision, but no renovate.json packageRule labels ${key} ${HAND_LABEL}.`);
    }
  }
  for (const key of new Set(RULES.map((r) => r.key))) {
    const pkgs = new Set(managers.filter((m) => m.depNameTemplate === key).map((m) => m.packageNameTemplate).filter((n) => typeof n === 'string'));
    const idx = handRuleIndex(rules, key, pkgs);
    if (idx >= 0 && !handOnlyKeys.has(key)) {
      disagreements.push(`renovate.json packageRules[${idx}] labels ${key} ${HAND_LABEL}, but HAND_ONLY (tooling/scripts/propagate-versions.mjs) does not name it, so propagate-versions.mjs --write would still write its copies.`);
    }
  }

  // ── one report, then one exit ───────────────────────────────────────────────
  if (unreached.length) {
    console.error(`✗ ${unreached.length} site(s) no Renovate bump reaches — the bump PR goes red there and nothing on its branch can turn it green:`);
    for (const u of unreached) console.error(`    ${u}`);
    console.error(`  ${SENTINEL_SEMVER} (or ${SENTINEL_MAJOR} for a bare major) is this guard's sentinel: the value the bump wrote into every copy Renovate reaches.`);
    console.error('  Fix one of: read tooling/versions.json at run time; add a customManager with the SAME depName for that copy;');
    console.error('  group a built-in manager onto the key\'s branch; or declare a hand decision (a needs-manual-check rule AND HAND_ONLY).');
  }
  if (disagreements.length) {
    console.error(`✗ ${disagreements.length} hand decision(s) declared in one place and not the other:`);
    for (const d of disagreements) console.error(`    ${d}`);
  }
  if (couldNotJudge.length) {
    coverageLost([
      `${couldNotJudge.length} managed key(s) could not be judged, so "0 unreached" would be a claim about keys this guard never saw:`,
      ...couldNotJudge,
    ]);
  }
  if (unreached.length || disagreements.length) process.exit(1);
  console.log(`ok  renovate reach — ${managedKeys.length} managed key(s), 0 unreached`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();

function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  console.error('  This guard could not look, which is not a pass.');
  process.exit(2);
}
