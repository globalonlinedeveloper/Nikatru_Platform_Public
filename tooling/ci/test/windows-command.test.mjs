// windows-command.test.mjs — heavy.mjs must never run an invocation that cannot
// work and then report success for it.
//
// 🔴 THE DEFECT, MEASURED 2026-09-20. From the Bash tool on Windows, MSYS
// rewrites a bare `/c` into the PATH `C:/` before node starts, so
// `-- cmd /c flutter test` reaches spawn as `cmd` + `C:/` + …: cmd takes a path
// where its switch should be, opens interactively, reads EOF and exits 0 HAVING
// RUN NOTHING. With the exit code captured on its own line, `cmd /c "exit 7"`
// answered 0 and `cmd //c "exit 7"` answered 7 — a command that must fail,
// reporting success. That form was recommended by heavy.mjs's own header, its
// ENOENT hint and the lane brief, and a lane's full app suite "passed" in four
// seconds because of it.
//
// ⚠️ THE CASES BELOW ARE PLATFORM-INJECTED, NOT PLATFORM-DEPENDENT. The rule is
// about Windows and CI is Linux, so passing `platform` explicitly is what makes
// these assertions run — and fail — on the runner. A suite that quietly skipped
// itself off Windows would be exactly the vacuous green this module exists to
// stop.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { windowsCommand } from '../../scripts/windows-command.mjs';

const onWin = (cmd) => windowsCommand(cmd, 'win32', 'C:\\Windows\\System32\\cmd.exe');

describe('windowsCommand — the mangled cmd invocation is refused, never run', () => {
  test('🔴 the MSYS-rewritten form is REFUSED — the case the module exists for', () => {
    // This is literally what `-- cmd /c flutter test` becomes by the time node
    // sees it: the switch has been turned into a drive path.
    const r = onWin(['cmd', 'C:/', 'flutter', 'test']);
    assert.ok(r.refuse, 'a cmd invocation with a path where its switch belongs must be refused');
    assert.match(r.refuse, /RUN NOTHING/);
    assert.equal(r.file, undefined, 'a refusal must not also hand back something to spawn');
  });

  test('cmd with NO arguments at all is refused rather than opened interactively', () => {
    assert.ok(onWin(['cmd']).refuse);
    assert.ok(onWin(['cmd.exe']).refuse);
  });

  test('a real switch is passed through untouched, including the // form MSYS collapses', () => {
    // `//c` arrives here already collapsed to `/c`, so it is a real switch and
    // must NOT be refused — the module refuses the mangled form, not the escape.
    for (const sw of ['/c', '/C', '/k', '/K']) {
      const r = onWin(['cmd', sw, 'echo', 'hi']);
      assert.equal(r.refuse, undefined, `${sw} is a real switch and must pass through`);
      assert.equal(r.file, 'cmd');
      assert.deepEqual(r.args, [sw, 'echo', 'hi']);
    }
  });
});

describe('windowsCommand — a .bat/.cmd is wrapped here, so no caller types a switch', () => {
  test('a .bat target gains its interpreter and its /c, built inside node', () => {
    const r = onWin(['flutter.bat', 'test', '--coverage']);
    assert.equal(r.refuse, undefined);
    assert.equal(r.file, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(r.args, ['/c', 'flutter.bat', 'test', '--coverage']);
  });

  test('.cmd and mixed case are wrapped too', () => {
    assert.deepEqual(onWin(['melos.CMD', 'run']).args, ['/c', 'melos.CMD', 'run']);
    assert.deepEqual(onWin(['x.Bat']).args, ['/c', 'x.Bat']);
  });

  test('ComSpec is honoured, and an EMPTY one falls back rather than spawning nothing', () => {
    assert.equal(windowsCommand(['a.bat'], 'win32', 'D:\\alt\\cmd.exe').file, 'D:\\alt\\cmd.exe');
    // An empty string is the case that matters: `spawn('')` is not a failure
    // that names itself, so the fallback has to catch it.
    assert.equal(windowsCommand(['a.bat'], 'win32', '').file, 'C:\\Windows\\System32\\cmd.exe');
    // ⚠️ `undefined` is NOT asserted to fall back, and that is deliberate rather
    // than an omission: it is a DEFAULT PARAMETER, so passing it explicitly means
    // "read process.env.ComSpec", which is the real behaviour and is right. The
    // first version of this case asserted the fallback and went red on a machine
    // where ComSpec is set — the test was wrong, not the module.
    assert.equal(
      windowsCommand(['a.bat'], 'win32').file,
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      'omitting comspec must read the environment, not the literal',
    );
  });

  test('an ordinary executable is left exactly as written', () => {
    const r = onWin(['node', '--test', 'tooling/ci/test/*.test.mjs']);
    assert.equal(r.file, 'node');
    assert.deepEqual(r.args, ['--test', 'tooling/ci/test/*.test.mjs'], 'the quoted glob must stay ONE argument');
  });
});

describe('windowsCommand — off Windows none of this applies', () => {
  test('linux passes everything through, including names that look like Windows ones', () => {
    for (const cmd of [['cmd'], ['cmd', 'C:/', 'x'], ['a.bat', 'y'], ['node', '--test']]) {
      const r = windowsCommand(cmd, 'linux');
      assert.equal(r.refuse, undefined, `${cmd.join(' ')} must not be refused off Windows`);
      assert.equal(r.file, cmd[0]);
      assert.deepEqual(r.args, cmd.slice(1));
    }
  });
});
