// ───────────────────────────────────────────────────────────
// renovate-reach.test.mjs — assert-renovate-reach.mjs must be able to FAIL.
//
// Row: O-RENOVATE-BUMP-CANNOT-REACH-A-PINNED-COPY. #860 (flutter 3.47.4 →
// 3.47.5) went red at a copy of the pin no Renovate manager read, and nothing
// in CI asked the question before the bump did. The guard asks it by writing a
// sentinel into every span Renovate would rewrite and running the REAL version
// guard on the result.
//
// Every case here copies the REAL target set (the version guard's own
// collectTargets, plus tooling/versions.json and renovate.json) and applies ONE
// mutation, then asserts the exit code AND the sentence that names the limb —
// never the marker alone: a test that accepts any failure is not testing the
// limb it names (update-coverage.test.mjs records the case that taught that).
// Each mutation first asserts it changed something, so no case can pass over
// an edit that silently missed.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ───────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { collectTargets } from '../assert-version-consistency.mjs';
import { matchesPath } from '../assert-update-coverage.mjs';
import { BRICK_LOCK, brickLockProblems } from '../assert-renovate-reach.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-renovate-reach.mjs');
const VERSIONS = 'tooling/versions.json';
const RENOVATE = 'renovate.json';
const BRICK_PKG = BRICK_LOCK.replace(/package-lock\.json$/, 'package.json');
// The brick lockfile is not a version-guard target, so it joins the copy by name.
const COPY_SET = [...new Set([...collectTargets(REPO).map((p) => p.replace(/\\/g, '/')), VERSIONS, RENOVATE, BRICK_LOCK])];
const WORKFLOWS = COPY_SET.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p));
const CI_YML = WORKFLOWS.find((p) => /\/ci\.yml$/.test(p));

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-reach-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
/** A scratch copy of the real target set. */
function scratch() {
  const root = join(TMP, `t${seq++}`);
  for (const rel of COPY_SET) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(root, rel));
  }
  return root;
}
const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
const write = (root, rel, text) => writeFileSync(join(root, rel), text);
function editJson(root, rel, fn) {
  const o = JSON.parse(read(root, rel));
  fn(o);
  write(root, rel, `${JSON.stringify(o, null, 2)}\n`);
}
/** Replace `re` in one file and insist it matched. */
function replaceIn(root, rel, re, to) {
  const before = read(root, rel);
  const afterText = before.replace(re, to);
  assert.notEqual(afterText, before, `the mutation did not change ${rel} — the case would test nothing`);
  write(root, rel, afterText);
}
function reach(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8', timeout: 180_000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
/** Remove the packageRules `pick` selects; insist exactly one went. */
function dropRule(root, pick) {
  editJson(root, RENOVATE, (c) => {
    const n = c.packageRules.length;
    c.packageRules = c.packageRules.filter((r) => !pick(r));
    assert.equal(c.packageRules.length, n - 1, 'expected exactly one packageRule to match the mutation');
  });
}
const isMelosGroup = (r) => Array.isArray(r.matchDepNames) && r.matchDepNames.includes('melos') && r.groupName === 'melos';

test('T1 green control: the real target set gives exit 0 and the summary line', () => {
  const r = reach(scratch());
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^ok {2}renovate reach — \d+ managed key\(s\), 0 unreached$/m);
  assert.match(r.out, /declared FLOOR \(packageRules\[\d+\]\) +java /);
  assert.match(r.out, /declared HAND \(packageRules\[\d+\]\) +gitleaks /);
  assert.match(r.out, /^ok {2}brick lockfile — packages\[""\] carries the package's name and all \d+ of its dependency range\(s\)$/m);
});

test('T2 the ci.yml mason_cli customManager deleted: exit 1 naming ci.yml', () => {
  const root = scratch();
  editJson(root, RENOVATE, (c) => {
    const n = c.customManagers.length;
    c.customManagers = c.customManagers.filter(
      (m) => !(m.depNameTemplate === 'mason_cli' && !m.managerFilePatterns.some((p) => matchesPath(p, VERSIONS))),
    );
    assert.equal(c.customManagers.length, n - 1);
  });
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^ {4}\.github\/workflows\/ci\.yml:\d+ mason_cli — /m);
});

test('T3 the melos group rule deleted: exit 1 naming pubspec.yaml', () => {
  const root = scratch();
  dropRule(root, isMelosGroup);
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^ {4}pubspec\.yaml:\d+ melos — /m);
});

test('T4 a later "dev tooling" group shadows the melos group: exit 1 naming pubspec.yaml', () => {
  const root = scratch();
  editJson(root, RENOVATE, (c) => {
    const i = c.packageRules.findIndex(isMelosGroup);
    assert.ok(i >= 0);
    c.packageRules.splice(i + 1, 0, { matchDepTypes: ['dev_dependencies'], groupName: 'dev tooling' });
  });
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^ {4}pubspec\.yaml:\d+ melos — /m);
});

test('T5 the wsl-setup.sh FLUTTER_VERSION literal restored: exit 1 naming tooling/wsl-setup.sh', () => {
  const root = scratch();
  const flutter = JSON.parse(read(root, VERSIONS)).flutter;
  replaceIn(root, 'tooling/wsl-setup.sh', /^FLUTTER_VERSION="\$\(sed .*$/m, `FLUTTER_VERSION="${flutter}"`);
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^ {4}tooling\/wsl-setup\.sh:\d+ flutter — /m);
});

test('T6 the gitleaks hand rule deleted: exit 1 naming scan-secrets.mjs AND the HAND_ONLY disagreement', () => {
  const root = scratch();
  dropRule(root, (r) => (r.matchDepNames ?? []).includes('gitleaks') && (r.labels ?? []).includes('needs-manual-check'));
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^ {4}tooling\/ci\/scan-secrets\.mjs:\d+ gitleaks — /m);
  assert.match(
    r.err,
    /HAND_ONLY \(tooling\/scripts\/propagate-versions\.mjs\) names "gitleaks \(scan-secrets VALIDATED_AGAINST\)" \(key gitleaks\) a hand decision, but no renovate\.json packageRule labels gitleaks needs-manual-check\./,
  );
});

test('T7 renovate.json deleted: exit 2 naming the missing file', () => {
  const root = scratch();
  rmSync(join(root, RENOVATE));
  const r = reach(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /^✗ COVERAGE LOST — renovate\.json is missing under .+, so no Renovate bump can be modelled\.$/m);
});

test('T7b tooling/versions.json deleted: exit 2 naming the missing file', () => {
  const root = scratch();
  rmSync(join(root, VERSIONS));
  const r = reach(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /^✗ COVERAGE LOST — tooling\/versions\.json is missing under .+, so no Renovate bump can be modelled\.$/m);
});

test('T7c renovate.json that does not parse: exit 2', () => {
  const root = scratch();
  write(root, RENOVATE, `${read(root, RENOVATE)}\n}`);
  const r = reach(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /^✗ COVERAGE LOST — renovate\.json or tooling\/versions\.json does not parse \(/m);
});

test('T8 a string pin with no manager and no exemption: exit 2 naming the key', () => {
  const root = scratch();
  editJson(root, VERSIONS, (v) => {
    v.reach_probe_tool = '1.2.3';
  });
  const r = reach(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /declares "reach_probe_tool" with no customManager and no \$updateExemptions entry\./);
});

test('T9 every workflow wranglerVersion requoted while wrangler stays grouped: exit 2, the built-in row went blind', () => {
  const root = scratch();
  let n = 0;
  for (const rel of WORKFLOWS) {
    const text = read(root, rel);
    const requoted = text.replace(/wranglerVersion:(\s*)'([0-9][^']*)'/g, (_, ws, v) => {
      n++;
      return `wranglerVersion:${ws}"${v}"`;
    });
    if (requoted !== text) write(root, rel, requoted);
  }
  assert.ok(n > 0, 'no wranglerVersion input was requoted — the case would test nothing');
  const r = reach(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /^✗ COVERAGE LOST — the grouped built-in github-actions row for "wrangler" matched no site in the version guard's targets\.$/m);
});

test('T10 a drifted literal before any mutation: exit 2, nothing can be attributed', () => {
  const root = scratch();
  replaceIn(root, CI_YML, /(dart pub global activate mason_cli )[0-9][^\s'"#]*/, (_, head) => `${head}0.0.1`);
  const r = reach(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /^✗ COVERAGE LOST — the version guard is not green on the unmutated tree \(.+\), so no site can be attributed to a bump\.$/m);
});

test('T11 no customManager at all: exit 2, zero managed keys', () => {
  const root = scratch();
  editJson(root, RENOVATE, (c) => {
    c.customManagers = [];
  });
  const r = reach(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /has no customManager that reads a string key of tooling\/versions\.json, so there are zero managed keys to bump\./);
});

test('T12 a needs-manual-check rule for melos with no HAND_ONLY entry: exit 1, the reverse disagreement', () => {
  const root = scratch();
  editJson(root, RENOVATE, (c) => {
    c.packageRules.push({ matchDepNames: ['melos'], labels: ['dependencies', 'needs-manual-check'] });
  });
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /labels melos needs-manual-check, but HAND_ONLY \(tooling\/scripts\/propagate-versions\.mjs\) does not name it/);
});

test('T13 the java/node floor rule deleted: exit 1 naming the node and java copies', () => {
  const root = scratch();
  dropRule(root, (r) => r.enabled === false && Array.isArray(r.matchUpdateTypes) && (r.matchDatasources ?? []).includes('node-version'));
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^ {4}\.github\/workflows\/extensions\.yml:\d+ node — /m);
  assert.match(r.err, /^ {4}tooling\/wsl-setup\.sh:\d+ java — /m);
});

test('T14 a floor that also disables majors is no floor: exit 1', () => {
  const root = scratch();
  editJson(root, RENOVATE, (c) => {
    const floor = c.packageRules.find((r) => r.enabled === false && Array.isArray(r.matchUpdateTypes) && (r.matchDatasources ?? []).includes('java-version'));
    assert.ok(floor);
    floor.matchUpdateTypes = [...floor.matchUpdateTypes, 'major'];
  });
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^ {4}\.github\/workflows\/build-platforms\.yml:\d+ java — /m);
});

test('T15 a declaration already at the sentinel: exit 2, the bump would move nothing', () => {
  const root = scratch();
  editJson(root, VERSIONS, (v) => {
    assert.equal(typeof v.zizmor, 'string');
    v.zizmor = '99.98.97';
  });
  const r = reach(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /zizmor: its declared value already equals the sentinel 99\.98\.97, so a bump to it moves nothing\./);
});

test('T16 a versions.json manager whose matchString misses its own key: exit 2, the modelled bump is not the real one', () => {
  const root = scratch();
  editJson(root, RENOVATE, (c) => {
    const m = c.customManagers.find((x) => x.depNameTemplate === 'zizmor' && x.managerFilePatterns.some((p) => matchesPath(p, VERSIONS)));
    assert.ok(m);
    m.matchStrings = ['"zizmor_never":\\s*"(?<currentValue>[^"]+)"'];
  });
  const r = reach(root);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /zizmor: its customManager did not move tooling\/versions\.json \(it now reads "[^"]+"\), so the bump modelled here is not the one Renovate makes\./);
});

test('T17 the pubspec Flutter-floor customManager deleted: exit 1 naming a member pubspec and the brick template', () => {
  // O-PUBSPEC-FLOORS-UNTIED-TO-THE-PIN: the version guard reads every Flutter
  // pubspec's `flutter: ">=<flutter>"` floor, so a Flutter bump that reaches
  // versions.json and the workflows but not those floors is red the day it lands.
  const root = scratch();
  const member = COPY_SET.find((p) => /^apps\/[^/]+\/pubspec\.yaml$/.test(p));
  assert.ok(member, 'the real target set must carry an app member pubspec');
  editJson(root, RENOVATE, (c) => {
    const n = c.customManagers.length;
    c.customManagers = c.customManagers.filter((m) => !(m.depNameTemplate === 'flutter' && m.managerFilePatterns.some((p) => matchesPath(p, member))));
    assert.equal(c.customManagers.length, n - 1);
  });
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, new RegExp(`^ {4}${member.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}:\\d+ flutter — `, 'm'));
  assert.match(r.err, /^ {4}tooling\/bricks\/app\/__brick__\/apps\/\{\{app_id\}\}\/pubspec\.yaml:\d+ flutter — /m);
});

// ── the brick lockfile (O-SERVICE-KIT-UNBUILT, E-a1) ─────────────────────────

test('T18 (RC3) the brick lockfile loses a dependency its package.json keeps: exit 1 naming it', () => {
  const root = scratch();
  editJson(root, BRICK_LOCK, (l) => {
    assert.equal(typeof l.packages[''].dependencies.hono, 'string', 'the brick lockfile has no hono to delete — the case would test nothing');
    delete l.packages[''].dependencies.hono;
  });
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /is not the lockfile of the package\.json beside it \(1 finding\(s\)\):/);
  assert.match(r.err, /^ {4}dependencies\.hono: package\.json asks for "[^"]+" and packages\[""\] does not list it\.$/m);
});

test('T19 the brick package.json moves a range the lockfile does not: exit 1 naming both values', () => {
  const root = scratch();
  replaceIn(root, BRICK_PKG, /"jose": "[^"]+"/, '"jose": "^6.0.0"');
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^ {4}dependencies\.jose: package\.json asks for "\^6\.0\.0"; packages\[""\] records "[^"]+"\.$/m);
});

test('T20 the brick lockfile deleted: exit 1, it is missing', () => {
  const root = scratch();
  rmSync(join(root, BRICK_LOCK));
  const r = reach(root);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^ {4}it is missing\. Without it a stamped Worker resolves its ranges on the day it is provisioned/m);
});

test('T21 brickLockProblems: a range only the lockfile root records is a finding (the reverse direction)', () => {
  const pkg = { name: '{{app_id}}-api', dependencies: { hono: '^4.6.0' } };
  const lock = { name: '{{app_id}}-api', packages: { '': { name: '{{app_id}}-api', dependencies: { hono: '^4.6.0' }, devDependencies: { left: '1.0.0' } } } };
  assert.deepEqual(brickLockProblems(pkg, lock), ['devDependencies.left: packages[""] records "1.0.0" and package.json does not ask for it.']);
});

test('T22 brickLockProblems: a lockfile named for another package is a finding, once per name field', () => {
  const pkg = { name: '{{app_id}}-api', dependencies: { hono: '^4.6.0' } };
  const lock = { name: 'subscriptiontracker-api', packages: { '': { name: 'subscriptiontracker-api', dependencies: { hono: '^4.6.0' } } } };
  assert.deepEqual(brickLockProblems(pkg, lock), [
    'its name is "subscriptiontracker-api"; the package.json beside it is "{{app_id}}-api".',
    'its packages[""].name is "subscriptiontracker-api"; the package.json beside it is "{{app_id}}-api".',
  ]);
});

test('T23 brickLockProblems: the package itself is a match, and a lockfile with no root entry is not', () => {
  const pkg = { name: '{{app_id}}-api', dependencies: { hono: '^4.6.0' }, devDependencies: { wrangler: '4.135.0' } };
  const same = { name: '{{app_id}}-api', packages: { '': { name: '{{app_id}}-api', dependencies: { hono: '^4.6.0' }, devDependencies: { wrangler: '4.135.0' } } } };
  assert.deepEqual(brickLockProblems(pkg, same), []);
  assert.deepEqual(brickLockProblems(pkg, { name: '{{app_id}}-api', packages: {} }), [
    'it has no `packages[""]` entry, so it records no root package at all.',
  ]);
});
