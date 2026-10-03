// ─────────────────────────────────────────────────────────────────────────────
// dead-repo-names.test.mjs — the mutation test for assert-no-dead-repo-names.
//
// THE GREEN CONTROL COMES FIRST, AND IT IS NOT A FORMALITY. A guard that exits 1
// on everything "catches" every mutation and is worthless; a guard that exits 1
// on nothing is worse, because it reads as a pass. So every case here builds a
// throwaway tree, proves the guard is GREEN on it, then changes exactly one
// thing and requires RED. Without the paired control, a red is evidence of
// nothing.
//
// The tree is synthetic on purpose. Running the guard against the real
// repository would make this test's verdict depend on whatever else is in
// flight — the very coupling that let a dead name sit in renovate.yml for a day.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { RECORDED_ORG } from './fixtures/recorded-org.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, '..', 'assert-no-dead-repo-names.mjs');
const REAL_DECL = join(HERE, '..', '..', 'dead-repos.json');

/** The guard's data file, shrunk to what these cases need. Floors are lowered to
 *  match the fixture — the REAL floors are asserted separately below, against the
 *  real declaration, so lowering them here cannot quietly lower them there. */
const DECL = {
  repos: [
    { name: 'Nikatru_Extensions_Public', died: '2026-09-05', wentTo: 'Nikatru_Platform_Public/extensions/' },
    { name: 'Project_Cross_Platform_Apps', died: '2026-08-19', wentTo: 'Nikatru_Platform_Public' },
    { name: 'Project_Cross_Platform_Apps_Private', died: '2026-08-19', wentTo: 'Nikatru_Platform_Private' },
  ],
  allowedSuffixes: ['_GITHUB_PAT'],
  scan: { globs: ['.github/workflows/**/*.yml', 'tooling/**/*.json', 'renovate.json', '**/package.json', 'catalog/**/*.json'] },
  excludedPaths: ['tooling/ci/test/', 'tooling/dead-repos.json'],
  floors: { files: 3, repos: 3 },
};

let root;
const write = (rel, body) => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
};
const run = () => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
/** Rebuild the clean tree. Every case starts from this exact state. */
const seed = (decl = DECL) => {
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'dead-repo-names-'));
  write('tooling/dead-repos.json', JSON.stringify(decl, null, 2));
  write('.github/workflows/ci.yml', 'name: ci\njobs:\n  a:\n    runs-on: ubuntu-latest\n');
  write('renovate.json', '{ "extends": ["config:recommended"] }\n');
  write('package.json', '{ "name": "fixture", "private": true }\n');
  write('tooling/some-register.json', '{ "rows": [] }\n');
  write('catalog/apps.json', '{ "apps": [] }\n');
};

before(() => seed());
after(() => { if (root && existsSync(root)) rmSync(root, { recursive: true, force: true }); });

describe('assert-no-dead-repo-names — the green control', () => {
  test('a tree naming no dead repository exits 0', () => {
    seed();
    const { code, out } = run();
    assert.equal(code, 0, `expected a clean tree to pass, got ${code}:\n${out}`);
    assert.match(out, /no live surface names a dead repository/);
  });
});

describe('assert-no-dead-repo-names — the mutations', () => {
  test('THE ORIGINAL DEFECT: a workflow naming a dead repo exits 1', () => {
    seed();
    assert.equal(run().code, 0, 'control must be green before the mutation');
    write('.github/workflows/renovate.yml',
      `name: renovate\njobs:\n  r:\n    steps:\n      - env:\n          RENOVATE_REPOSITORIES: |\n            ${RECORDED_ORG}/Nikatru_Extensions_Public\n`);
    const { code, out } = run();
    assert.equal(code, 1, `a workflow naming a deleted repository must FAIL, got ${code}:\n${out}`);
    assert.match(out, /renovate\.yml/);
    assert.match(out, /Nikatru_Extensions_Public/);
    // The finding must carry the replacement, or the guard refuses without
    // being able to say what to write instead.
    assert.match(out, /Nikatru_Platform_Public\/extensions\//);
  });

  test('a dead name in a machine-read register exits 1', () => {
    seed();
    assert.equal(run().code, 0, 'control must be green before the mutation');
    write('tooling/some-register.json', `{ "rows": [{ "repo": "${RECORDED_ORG}/Project_Cross_Platform_Apps" }] }\n`);
    const { code, out } = run();
    assert.equal(code, 1, `a register naming a renamed-away repository must FAIL, got ${code}:\n${out}`);
    assert.match(out, /some-register\.json/);
  });

  test('a dead name in a package.json exits 1', () => {
    seed();
    write('services/x/package.json', `{ "repository": "github:${RECORDED_ORG}/Nikatru_Extensions_Public" }\n`);
    assert.equal(run().code, 1);
  });

  test('THE FALSE POSITIVE THAT WOULD GET THIS GUARD SWITCHED OFF: the vault key is not a repo reference', () => {
    seed();
    write('tooling/some-register.json', '{ "tokenKey": "Project_Cross_Platform_Apps_GITHUB_PAT" }\n');
    const { code, out } = run();
    assert.equal(code, 0, `\`Project_Cross_Platform_Apps_GITHUB_PAT\` is a live vault key, not a dead repo name — it must NOT fail:\n${out}`);
  });

  test('the longest dead name wins, so _Private is not reported as the shorter name', () => {
    seed();
    write('tooling/some-register.json', '{ "repo": "Project_Cross_Platform_Apps_Private" }\n');
    const { code, out } = run();
    assert.equal(code, 1);
    assert.match(out, /Project_Cross_Platform_Apps_Private/);
    assert.doesNotMatch(out, /`Project_Cross_Platform_Apps` \(died/);
  });

  test('A YAML COMMENT IS A RECORD, THE VALUE BESIDE IT IS A DEFECT — both, one fixture', () => {
    // The pair that matters, and the first thing this guard met in the wild:
    // PR #502 removed the dead repo from RENOVATE_REPOSITORIES and left a comment
    // saying which name had gone and why. A guard that refuses that comment forbids
    // a fix from explaining itself, and gets deleted. A guard that skips the whole
    // line instead would have missed the defect it was written for.
    seed();
    write('.github/workflows/renovate.yml',
      `name: renovate\n# Nikatru_Extensions_Public was removed here on 2026-09-05 - it was deleted.\njobs:\n  r:\n    steps:\n      - env:\n          RENOVATE_REPOSITORIES: ${RECORDED_ORG}/Nikatru_Platform_Public\n`);
    const clean = run();
    assert.equal(clean.code, 0, `a dead name in a YAML COMMENT is a record, not a defect:\n${clean.out}`);

    // Same file, same name, now in the VALUE a machine reads.
    write('.github/workflows/renovate.yml',
      `name: renovate\n# Nikatru_Extensions_Public was removed here on 2026-09-05 - it was deleted.\njobs:\n  r:\n    steps:\n      - env:\n          RENOVATE_REPOSITORIES: ${RECORDED_ORG}/Nikatru_Extensions_Public\n`);
    const dirty = run();
    assert.equal(dirty.code, 1, `the same name in a VALUE must FAIL:\n${dirty.out}`);
    // Exactly one finding: the comment on line 2 must not also be counted.
    assert.match(dirty.out, /1 live reference\(s\)/);
    assert.match(dirty.out, /renovate\.yml:7:/);
  });

  test('a quoted # does not truncate the value it sits in', () => {
    seed();
    write('.github/workflows/x.yml', `name: x\non:\n  s: 'a # b ${RECORDED_ORG}/Nikatru_Extensions_Public'\n`);
    const { code, out } = run();
    assert.equal(code, 1, `a # INSIDE quotes is data, not a comment marker:\n${out}`);
  });

  test('prose is OUT OF SCOPE — a dead name in a README does not fail', () => {
    seed();
    write('README.md', 'This repository was called Nikatru_Extensions_Public until 2026-09-05.\n');
    const { code, out } = run();
    assert.equal(code, 0, `a dated record must not be rewritten by this guard:\n${out}`);
  });

  test('the glob metacharacters are ESCAPED — a near-miss filename is not scanned', () => {
    // Pinned because the first version of toRe() shipped an escape function that
    // was a no-op: `.` matched any character, so `catalog/appsXjson` would have
    // been scanned as if it were `catalog/apps.json`. Widening a scan set by
    // accident is the quiet half of the same defect as narrowing it.
    seed();
    write('catalog/appsXjson', '{ "repo": "Nikatru_Extensions_Public" }\n');
    const { code, out } = run();
    assert.equal(code, 0, `a file the globs do not name must not be scanned:\n${out}`);
    // ...and the file the glob DOES name is still scanned.
    write('catalog/apps.json', '{ "repo": "Nikatru_Extensions_Public" }\n');
    assert.equal(run().code, 1, 'the control: the real glob target is still scanned');
  });

  test('an excluded path is excluded, and the exclusion is PRINTED not hidden', () => {
    seed();
    write('tooling/ci/test/fixture-register.json', '{ "repo": "Nikatru_Extensions_Public" }\n');
    const { code, out } = run();
    assert.equal(code, 0);
    assert.match(out, /excluded \(dated records and fixtures, declared not hidden\)/);
    assert.match(out, /tooling\/ci\/test\//);
  });
});

describe('assert-no-dead-repo-names — it cannot be silenced quietly', () => {
  test('emptying the dead list is COVERAGE LOST (2), not a pass', () => {
    seed({ ...DECL, repos: [] });
    const { code, out } = run();
    assert.equal(code, 2, `an empty list must refuse, not pass:\n${out}`);
    assert.match(out, /COVERAGE LOST/);
  });

  test('emptying the scan set is COVERAGE LOST (2), not a pass', () => {
    seed({ ...DECL, scan: { globs: [] } });
    const { code, out } = run();
    assert.equal(code, 2, `a guard with no subject must refuse:\n${out}`);
    assert.match(out, /no subject|COVERAGE LOST/);
  });

  test('a row with no `wentTo` is COVERAGE LOST (2) — a refusal must name the replacement', () => {
    seed({ ...DECL, repos: [{ name: 'Nikatru_Extensions_Public', died: '2026-09-05' }, ...DECL.repos.slice(1)] });
    const { code, out } = run();
    assert.equal(code, 2);
    assert.match(out, /wentTo/);
  });

  test('a missing declaration file is COVERAGE LOST (2)', () => {
    seed();
    rmSync(join(root, 'tooling/dead-repos.json'));
    assert.equal(run().code, 2);
  });

  test('dropping the file floor below what the tree holds is COVERAGE LOST (2)', () => {
    seed({ ...DECL, floors: { files: 999, repos: 3 } });
    const { code, out } = run();
    assert.equal(code, 2);
    assert.match(out, /did not prove it still scanned/);
  });
});

describe('assert-no-dead-repo-names — the REAL declaration', () => {
  test('the shipped dead-repos.json is well formed and every row carries its measurement', async () => {
    const { readFileSync } = await import('node:fs');
    const real = JSON.parse(readFileSync(REAL_DECL, 'utf8'));
    assert.ok(Array.isArray(real.repos) && real.repos.length >= 11,
      'the real list must not shrink — a name is never removed once declared dead');
    for (const r of real.repos) {
      assert.match(r.died, /^\d{4}-\d{2}-\d{2}$/, `${r.name}: \`died\` must be a date, not a shrug`);
      assert.ok(r.wentTo?.trim(), `${r.name}: must say where it went`);
      assert.ok(r.measured?.trim(), `${r.name}: must carry the measurement that established it is dead`);
    }
    assert.ok(real.floors?.files >= 8 && real.floors?.repos >= 11,
      'the real floors must not be lowered to make a run go green');
    for (const p of real.excludedPaths ?? []) {
      assert.ok(typeof p === 'string' && p.length, 'every exclusion must be a real path');
    }
    assert.ok(real._excludedPathsWhy?.trim(), 'the exclusion list must state its reasons');
  });
});

// ⏱ 2026-10-03 · port-codehost — the LIVE org held to its one register: the PINS limb (each
// pubspec, podspec, CODEOWNERS owner and issue-chooser url checked against github-org.json) and
// the LITERAL limb (the org refused everywhere else). Green control first, one mutation each.
describe('assert-no-dead-repo-names — the code-host limbs (port-codehost)', () => {
  const ORG = { org: RECORDED_ORG, platform: [{ repo: 'Nikatru_Platform_Public', visibility: 'PUBLIC' }] };
  const WANT = `https://github.com/${RECORDED_ORG}/Nikatru_Platform_Public`;
  const HOST = {
    register: 'tooling/github-org.json',
    globs: ['**/*.mjs', '**/*.json', '**/*.yml', '**/*.yaml', '**/*.podspec', '.github/CODEOWNERS'],
    excludedPaths: ['tooling/github-org.json', 'tooling/dead-repos.json', 'tooling/generated/'],
    fixtureConstant: { path: 'tooling/ci/test/fixtures/recorded-org.mjs', count: 1 },
    mentions: [],
    floors: { files: 3 },
  };
  const seedHost = (host = HOST) => {
    seed({ ...DECL, codehost: host });
    write('tooling/github-org.json', JSON.stringify(ORG));
    write('tooling/generated/codehost.mjs', `export const CODEHOST = { org: '${RECORDED_ORG}' };\n`);
    write('tooling/ci/test/fixtures/recorded-org.mjs', `export const RECORDED_ORG = '${RECORDED_ORG}';\n`);
    write('tooling/ops/script.mjs', "import { CODEHOST } from '../generated/codehost.mjs';\n// the org used to be typed here\nexport const repo = `${CODEHOST.org}/Nikatru_Platform_Public`;\n");
    write('packages/core/pubspec.yaml', `name: core\nrepository: ${WANT}\n`);
    write('.github/CODEOWNERS', `# one owner\n* @${RECORDED_ORG}\n`);
  };

  test('green control: the org only in the register, the generated module, the fixture constant, a comment and checked pins', () => {
    seedHost();
    const { code, out } = run();
    assert.equal(code, 0, out);
    assert.match(out, /code-host limbs: \d+ code\/config file\(s\) scanned/);
    assert.match(out, /2 pinned file\(s\) checked against/);
  });

  test('🔴 RED: a fixture .mjs with the literal exits 1, naming the file', () => {
    seedHost();
    assert.equal(run().code, 0);
    write('tooling/ops/typed.mjs', `export const DEFAULT_REPO = '${RECORDED_ORG}/Nikatru_Platform_Public';\n`);
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /tooling\/ops\/typed\.mjs:1 — names the org/);
  });

  test('🔴 RED: a fixture pubspec naming ANOTHER org exits 1 (the pin is checked, not trusted)', () => {
    seedHost();
    write('packages/core/pubspec.yaml', 'name: core\nrepository: https://github.com/another-org/Nikatru_Platform_Public\n');
    const { code, out } = run();
    assert.equal(code, 1, out);
    assert.match(out, /packages\/core\/pubspec\.yaml:2 — pubspec `repository: https:\/\/github\.com\/another-org\/Nikatru_Platform_Public` is not/);
  });

  test('🔴 RED: a CODEOWNERS owner outside the org exits 1; a workflow typing the org exits 1', () => {
    seedHost();
    write('.github/CODEOWNERS', `* @${RECORDED_ORG}\n/docs/ @someone-else\n`);
    assert.equal(run().code, 1);
    seedHost();
    write('.github/workflows/renovate.yml', `name: r\njobs:\n  r:\n    env:\n      RENOVATE_REPOSITORIES: ${RECORDED_ORG}/Nikatru_Platform_Public\n`);
    assert.equal(run().code, 1);
  });

  test('a counted mention excuses exactly its count: one more is a finding, one fewer is COVERAGE LOST', () => {
    seedHost({ ...HOST, mentions: [{ path: 'tooling/notes.json', count: 1, why: 'a dated evidence string recording a live read, history rather than config' }] });
    write('tooling/notes.json', `{ "evidence": "read on ${RECORDED_ORG}/x" }\n`);
    assert.equal(run().code, 0);
    write('tooling/notes.json', `{ "evidence": "read on ${RECORDED_ORG}/x and ${RECORDED_ORG}/y" }\n`);
    assert.equal(run().code, 1);
    write('tooling/notes.json', '{ "evidence": "read on x" }\n');
    assert.equal(run().code, 2);
  });

  test('`movingTo` in the register is refused the same way, once declared', () => {
    seedHost();
    write('tooling/github-org.json', JSON.stringify({ ...ORG, movingTo: 'nikatru-com' }));
    write('tooling/ops/early.mjs', "export const NEXT = 'nikatru-com/Nikatru_Platform_Public';\n");
    assert.equal(run().code, 1);
  });

  // ⏱ 2026-10-03 · CodeQL js/incomplete-sanitization on #1182: the literal limb's
  // pattern is built from the register, so a `movingTo` that is not an org name
  // (a backslash, a regex metacharacter) refuses to build it rather than matching wrong.
  test('a `movingTo` that is not an org name is COVERAGE LOST, never a pattern', () => {
    seedHost();
    for (const bad of ['nikatru\\com', 'nik.*', 'a']) {
      write('tooling/github-org.json', JSON.stringify({ ...ORG, movingTo: bad }));
      const r = run();
      assert.equal(r.code, 2, `${bad}: ${r.out ?? ''}`);
    }
    // green control: a well-formed movingTo builds the limb.
    write('tooling/github-org.json', JSON.stringify({ ...ORG, movingTo: 'nikatru-com' }));
    assert.equal(run().code, 0);
  });

  test('the fixture constant is the ONE test literal: gone is COVERAGE LOST', () => {
    seedHost();
    write('tooling/ci/test/fixtures/recorded-org.mjs', 'export const RECORDED_ORG = process.env.X;\n');
    assert.equal(run().code, 2);
  });

  test('the REAL declaration carries the code-host block, its floor and its fixture constant', () => {
    const real = JSON.parse(readFileSync(REAL_DECL, 'utf8'));
    assert.equal(real.codehost?.register, 'tooling/github-org.json');
    assert.ok(real.codehost.floors.files >= 2600, 'the floor must not be lowered to make a run go green');
    assert.equal(real.codehost.fixtureConstant.path, 'tooling/ci/test/fixtures/recorded-org.mjs');
    for (const p of ['tooling/generated/', 'services/platform/src/generated/']) assert.ok(real.codehost.excludedPaths.includes(p));
  });
});
