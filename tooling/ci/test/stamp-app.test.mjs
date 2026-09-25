// ─────────────────────────────────────────────────────────────────────────────
// stamp-app.test.mjs — tooling/kit/stamp-app.mjs is the one command that
// stamps an app, and it is loud where post_gen is not.
//
// What is pinned here, and why each matters:
//   · `mason get` runs before `mason make`, from the repo root — a fresh
//     checkout has no brick registry and `make` exits 64 having stamped nothing;
//   · on Windows mason is `mason.bat`, reached through cmd.exe `/d /s /c`, and
//     an argument cmd would read as syntax is refused before anything runs;
//   · NIKATRU_ALLOW_OVERWRITE=1 comes from --overwrite and from nothing else;
//   · a vars file that cannot be read, or an app id the contract refuses, stops
//     the stamp before mason;
//   · the three post-conditions exist, in order, and a failing one makes the
//     exit non-zero.
//
// The suite reads the PLAN and drives the runner with an injected `run`: it
// spawns no mason and stamps nothing. No test is declared inside a loop
// (assert-no-loop-cases.mjs).
//
// Run:  node --single-threaded --test tooling/ci/test/stamp-app.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planStamp, runStamp, REGEN, TAG_OWNER } from '../../kit/stamp-app.mjs';

let ROOT;
const GOOD = 'good-vars.json';

before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-stamp-app-'));
  writeFileSync(join(ROOT, GOOD), JSON.stringify({ app_id: 'habittracker', display_name: 'Habit Tracker' }));
  writeFileSync(join(ROOT, 'bad-id-vars.json'), JSON.stringify({ app_id: 'habit_tracker' }));
  writeFileSync(join(ROOT, 'no-id-vars.json'), JSON.stringify({ display_name: 'No Id' }));
  writeFileSync(join(ROOT, 'not-json-vars.json'), '{ app_id: habittracker');
});

after(() => {
  if (ROOT) rmSync(ROOT, { recursive: true, force: true });
});

const plan = (argv, extra = {}) => planStamp({ argv, root: ROOT, platform: 'linux', env: {}, ...extra });

describe('stamp-app.mjs — one command, and loud about what it left behind', () => {
  test('mason get runs before mason make, and both run from the repo root with the root-oriented recipe', () => {
    const p = plan(['--vars', GOOD]);
    assert.deepEqual(p.problems, []);
    assert.deepEqual(
      p.steps.map((s) => [s.command, ...s.args]),
      [
        ['mason', 'get'],
        ['mason', 'make', 'app', '-c', GOOD, '-o', '.', '--on-conflict', 'overwrite'],
      ],
    );
    assert.deepEqual(p.steps.map((s) => s.cwd), [ROOT, ROOT]);
  });

  test('on Windows every mason step is cmd.exe /d /s /c mason.bat with the same arguments', () => {
    const p = plan(['--vars', GOOD], { platform: 'win32' });
    assert.deepEqual(p.problems, []);
    assert.deepEqual(
      p.steps.map((s) => [s.command, ...s.args]),
      [
        ['cmd.exe', '/d', '/s', '/c', 'mason.bat', 'get'],
        ['cmd.exe', '/d', '/s', '/c', 'mason.bat', 'make', 'app', '-c', GOOD, '-o', '.', '--on-conflict', 'overwrite'],
      ],
    );
  });

  test('NIKATRU_ALLOW_OVERWRITE=1 is set only by --overwrite, and an inherited one is stripped', () => {
    const without = plan(['--vars', GOOD], { env: { PATH: '/bin', NIKATRU_ALLOW_OVERWRITE: '1' } });
    assert.deepEqual(without.problems, []);
    assert.equal(without.steps.length, 2);
    assert.ok(without.steps.every((s) => !('NIKATRU_ALLOW_OVERWRITE' in s.env)), 'a stamp without --overwrite carries NIKATRU_ALLOW_OVERWRITE');
    assert.ok(without.steps.every((s) => s.env.PATH === '/bin'), 'the caller environment is not passed through');

    const withIt = plan(['--vars', GOOD, '--overwrite'], { env: { PATH: '/bin' } });
    assert.deepEqual(withIt.problems, []);
    assert.ok(withIt.steps.every((s) => s.env.NIKATRU_ALLOW_OVERWRITE === '1'), '--overwrite did not set NIKATRU_ALLOW_OVERWRITE=1');
  });

  test('a vars path cmd.exe would read as syntax is refused, and nothing is planned', () => {
    const amp = plan(['--vars', 'a&calc.json'], { platform: 'win32' });
    assert.equal(amp.steps.length, 0);
    assert.match(amp.problems.join('\n'), /--vars "a&calc\.json" is refused/);

    const pct = plan(['--vars', '%TEMP%.json'], { platform: 'win32' });
    assert.equal(pct.steps.length, 0);
    assert.match(pct.problems.join('\n'), /is refused/);

    const space = plan(['--vars', 'my vars.json'], { platform: 'win32' });
    assert.equal(space.steps.length, 0);
    assert.match(space.problems.join('\n'), /is refused/);
  });

  test('a missing, unparseable or id-less vars file is refused before mason', () => {
    const missing = plan(['--vars', 'absent-vars.json']);
    assert.equal(missing.steps.length, 0);
    assert.match(missing.problems.join('\n'), /could not be read as JSON \(ENOENT\)/);

    const notJson = plan(['--vars', 'not-json-vars.json']);
    assert.equal(notJson.steps.length, 0);
    assert.match(notJson.problems.join('\n'), /could not be read as JSON/);

    const noId = plan(['--vars', 'no-id-vars.json']);
    assert.equal(noId.steps.length, 0);
    assert.match(noId.problems.join('\n'), /carries no string "app_id"/);

    const noVars = plan([]);
    assert.equal(noVars.steps.length, 0);
    assert.match(noVars.problems.join('\n'), /--vars <file\.json> is required/);
  });

  test('the post-conditions are the pubspec, regen.mjs --check and tag-owner.mjs --check, in that order', () => {
    const p = plan(['--vars', GOOD]);
    assert.deepEqual(p.problems, []);
    assert.deepEqual(
      p.post.map((c) => c.label),
      ['apps/habittracker/pubspec.yaml exists', `node ${REGEN} --check`, `node ${TAG_OWNER} --check`],
    );
    assert.equal(p.post[0].path, join(ROOT, 'apps', 'habittracker', 'pubspec.yaml'));
    assert.deepEqual(p.post[1].args, [join(ROOT, 'tooling', 'sites', 'regen.mjs'), '--check']);
    assert.deepEqual(p.post[2].args, [join(ROOT, 'tooling', 'ci', 'tag-owner.mjs'), '--check']);
  });

  test('a failing post-condition makes the exit 1 and is named; all green is exit 0', () => {
    const p = plan(['--vars', GOOD]);
    const calls = [];
    const errors = [];
    const regenFails = (command, args) => {
      calls.push([command, ...args].join(' '));
      return args.includes('--check') && args[0].endsWith('regen.mjs') ? 1 : 0;
    };
    const red = runStamp(p, { run: regenFails, exists: () => true, log: () => {}, error: (l) => errors.push(l) });
    assert.equal(red, 1);
    assert.match(errors.join('\n'), /1 post-condition\(s\) failed: node tooling\/sites\/regen\.mjs --check/);
    assert.equal(calls.length, 4, `expected mason get, mason make and the two --check runs; got ${calls.join(' | ')}`);

    const green = runStamp(p, { run: () => 0, exists: () => true, log: () => {}, error: () => {} });
    assert.equal(green, 0);

    const noApp = runStamp(p, { run: () => 0, exists: () => false, log: () => {}, error: () => {} });
    assert.equal(noApp, 1, 'a stamp that wrote no apps/<id>/pubspec.yaml exited 0');
  });

  test('an app id the contract refuses stops the stamp before mason, with the contract message', () => {
    const p = plan(['--vars', 'bad-id-vars.json']);
    assert.equal(p.steps.length, 0);
    assert.match(p.problems.join('\n'), /app id "habit_tracker" breaks the pattern/);
    assert.match(p.problems.join('\n'), /contracts\/app-id/);
    const ran = [];
    const code = runStamp(p, { run: (c) => { ran.push(c); return 0; }, exists: () => true, log: () => {}, error: () => {} });
    assert.equal(code, 1);
    assert.deepEqual(ran, [], 'a refused stamp ran a command');
  });
});
