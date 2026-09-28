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
//   · after mason, `flutter pub get` runs AT THE REPO ROOT and then
//     gen-app-licence-rows.mjs --write --app <id> (LEAD RULING NP12B-R2): the
//     new app's package files get their licence rows in the stamp itself;
//   · the four post-conditions exist, in order, and a failing one makes the
//     exit non-zero;
//   · no workflow stamps with a raw `mason make`: a stamp step that skips this
//     file skips its post-conditions too. The one raw `mason make` a workflow
//     may carry is over a vars file whose app_id the contract refuses, which
//     can only prove that pre_gen refuses it too (ci.yml's "A bad app id is
//     refused before anything is written"); this file refuses such an id
//     before mason runs, so routed through it, pre_gen would never be asked.
//
// The suite reads the PLAN and drives the runner with an injected `run`: it
// spawns no mason and stamps nothing. No test is declared inside a loop
// (assert-no-loop-cases.mjs).
//
// Run:  node --single-threaded --test tooling/ci/test/stamp-app.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appIdProblems } from '../../../contracts/app-id/app-id.js';
import { planStamp, runStamp, REPO, REGEN, TAG_OWNER, APP_LICENCE_ROWS } from '../../kit/stamp-app.mjs';

let ROOT;
const GOOD = 'good-vars.json';

/** Where a workflow's steps can live: the workflows themselves, and the local
 *  composite actions a `uses: ./.github/actions/<x>` step runs in their place. */
const WORKFLOW_DIRS = ['.github/workflows', '.github/actions'];

/** Every workflow or local-action YAML file under `rel`, repo-relative. */
function yamlFiles(rel) {
  const abs = join(REPO, ...rel.split('/'));
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true })
    .map((f) => String(f).split('\\').join('/'))
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => `${rel}/${f}`);
}

/** True when the line's `-c <vars>` names a vars file whose app_id the contract
 *  refuses: mason's pre_gen throws on it before writing anything, so the line
 *  cannot stamp an app. Anything unreadable is false. */
function refusedIdVars(line) {
  const vars = /\s-c\s+(\S+)/.exec(line)?.[1];
  if (!vars) return false;
  let spec;
  try {
    spec = JSON.parse(readFileSync(join(REPO, ...vars.split('/')), 'utf8'));
  } catch {
    return false;
  }
  return typeof spec?.app_id === 'string' && appIdProblems(spec.app_id).length > 0;
}

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
  test('mason get, mason make, the root pub get and the licence rows run in that order, all from the repo root', () => {
    const p = plan(['--vars', GOOD]);
    assert.deepEqual(p.problems, []);
    assert.deepEqual(
      p.steps.map((s) => [s.command, ...s.args]),
      [
        ['mason', 'get'],
        ['mason', 'make', 'app', '-c', GOOD, '-o', '.', '--on-conflict', 'overwrite'],
        ['flutter', 'pub', 'get'],
        [process.execPath, join(ROOT, ...APP_LICENCE_ROWS.split('/')), '--write', '--app', 'habittracker'],
      ],
    );
    assert.deepEqual(p.steps.map((s) => s.cwd), [ROOT, ROOT, ROOT, ROOT]);
  });

  test('on Windows every mason and flutter step is cmd.exe /d /s /c <tool>.bat with the same arguments', () => {
    const p = plan(['--vars', GOOD], { platform: 'win32' });
    assert.deepEqual(p.problems, []);
    assert.deepEqual(
      p.steps.slice(0, 3).map((s) => [s.command, ...s.args]),
      [
        ['cmd.exe', '/d', '/s', '/c', 'mason.bat', 'get'],
        ['cmd.exe', '/d', '/s', '/c', 'mason.bat', 'make', 'app', '-c', GOOD, '-o', '.', '--on-conflict', 'overwrite'],
        ['cmd.exe', '/d', '/s', '/c', 'flutter.bat', 'pub', 'get'],
      ],
    );
    assert.equal(p.steps[3].command, process.execPath, 'the licence-row generator is node, spawned without a shell');
  });

  test('the licence rows are written only after the root pub get, and a failed pub get stops the stamp before them', () => {
    const p = plan(['--vars', GOOD]);
    const labels = p.steps.map((s) => s.label);
    assert.ok(labels.indexOf('flutter pub get (repo root)') < labels.indexOf(`node ${APP_LICENCE_ROWS} --write --app habittracker`));
    const ran = [];
    const errors = [];
    const code = runStamp(p, {
      run: (command, args) => {
        ran.push([command, ...args].join(' '));
        return command === 'flutter' ? 1 : 0;
      },
      exists: () => true,
      log: () => {},
      error: (l) => errors.push(l),
    });
    assert.equal(code, 1);
    assert.match(errors.join('\n'), /flutter pub get \(repo root\) exited 1; the post-conditions were not checked/);
    assert.ok(!ran.some((r) => r.includes('gen-app-licence-rows')), `the generator ran after a failed pub get: ${ran.join(' | ')}`);
  });

  test('NIKATRU_ALLOW_OVERWRITE=1 is set only by --overwrite, and an inherited one is stripped', () => {
    const without = plan(['--vars', GOOD], { env: { PATH: '/bin', NIKATRU_ALLOW_OVERWRITE: '1' } });
    assert.deepEqual(without.problems, []);
    assert.equal(without.steps.length, 4);
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

  test('the post-conditions are the pubspec, regen.mjs, tag-owner.mjs and the licence rows --check, in that order', () => {
    const p = plan(['--vars', GOOD]);
    assert.deepEqual(p.problems, []);
    assert.deepEqual(
      p.post.map((c) => c.label),
      [
        'apps/habittracker/pubspec.yaml exists',
        `node ${REGEN} --check`,
        `node ${TAG_OWNER} --check`,
        `node ${APP_LICENCE_ROWS} --check --app habittracker`,
      ],
    );
    assert.equal(p.post[0].path, join(ROOT, 'apps', 'habittracker', 'pubspec.yaml'));
    assert.deepEqual(p.post[1].args, [join(ROOT, 'tooling', 'sites', 'regen.mjs'), '--check']);
    assert.deepEqual(p.post[2].args, [join(ROOT, 'tooling', 'ci', 'tag-owner.mjs'), '--check']);
    assert.deepEqual(p.post[3].args, [join(ROOT, 'tooling', 'ci', 'gen-app-licence-rows.mjs'), '--check', '--app', 'habittracker']);
  });

  test('a stamp whose licence rows check red exits 1 and names the generator', () => {
    const p = plan(['--vars', GOOD]);
    const errors = [];
    const rowsRed = (command, args) => (args.includes('--check') && args[0].endsWith('gen-app-licence-rows.mjs') ? 1 : 0);
    const code = runStamp(p, { run: rowsRed, exists: () => true, log: () => {}, error: (l) => errors.push(l) });
    assert.equal(code, 1);
    assert.match(errors.join('\n'), /1 post-condition\(s\) failed: node tooling\/ci\/gen-app-licence-rows\.mjs --check --app habittracker/);
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
    assert.equal(calls.length, 7, `expected mason get, mason make, pub get, the --write and the three --check runs; got ${calls.join(' | ')}`);

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

  test('no workflow under .github/workflows runs mason make itself', () => {
    const files = WORKFLOW_DIRS.flatMap(yamlFiles);
    assert.ok(files.includes('.github/workflows/ci.yml'), `the scan found no .github/workflows/ci.yml; it read ${files.length} file(s)`);
    const raw = [];
    for (const rel of files) {
      const lines = readFileSync(join(REPO, ...rel.split('/')), 'utf8').split(/\r?\n/);
      for (const [i, line] of lines.entries()) {
        if (/^\s*#/.test(line) || !/\bmason(?:\.bat)?\s+make\b/.test(line)) continue;
        if (!refusedIdVars(line)) raw.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    }
    assert.deepEqual(raw, [], 'a workflow stamps with a raw `mason make`; call `node tooling/kit/stamp-app.mjs --vars <file.json>` instead, so the stamp runs its post-conditions');
  });
});
