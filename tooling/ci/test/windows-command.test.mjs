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
import { test, describe, after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  /* ⏱ 2026-09-22 (O-HEAVY-CMD-C-IDIOM-IS-A-SILENT-FALSE-GREEN). The refusal used to compare the WHOLE word
     against `cmd`, so every spelling that carries a directory walked past it:
     `C:\Windows\System32\cmd.exe` is what `$COMSPEC` holds, what an ENOENT hint
     prints, and what this module itself hands back when it wraps a .bat. The
     mangled argument is identical in every one of those forms — MSYS rewrote it
     before node started — so a full-path invocation fell through to the final
     pass-through and reproduced the vacuous green untouched. */
  test('🔴 a FULL-PATH cmd is cmd: the refusal is not escaped by spelling it out', () => {
    for (const file of [
      'C:\\Windows\\System32\\cmd.exe',
      'C:/Windows/System32/cmd.exe',
      'C:\\Windows\\System32\\CMD.EXE',
      'C:/Windows/System32/cmd',            // no extension, still cmd
    ]) {
      const r = onWin([file, 'C:/', 'exit', '7']);
      assert.ok(r.refuse, `${file} took a path where its switch belongs and was NOT refused`);
      assert.match(r.refuse, /RUN NOTHING/);
      assert.equal(r.file, undefined, 'a refusal must not also hand back something to spawn');
    }
  });

  test('a full-path cmd with a REAL switch still passes through, spelling and all', () => {
    const r = onWin(['C:\\Windows\\System32\\cmd.exe', '/c', 'echo', 'hi']);
    assert.equal(r.refuse, undefined, 'a real switch is a real switch at any spelling');
    assert.equal(r.file, 'C:\\Windows\\System32\\cmd.exe', 'the file must be handed back exactly as written');
    assert.deepEqual(r.args, ['/c', 'echo', 'hi']);
  });

  test('a path that merely ENDS in .cmd is not cmd, and is still wrapped as a script', () => {
    // The guard rests on the basename, so `foo.cmd` must not be mistaken for the
    // interpreter — it is a batch script and belongs to the wrapping branch.
    const r = onWin(['C:\\tools\\flutter.cmd', 'test']);
    assert.equal(r.refuse, undefined);
    assert.equal(r.file, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(r.args, ['/c', 'C:\\tools\\flutter.cmd', 'test']);
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

// ── END TO END, THROUGH THE CLI — the closes clause's "mutation-proven: a
// command that must fail, run through the fixed path, must FAIL". Every case
// above calls windowsCommand directly, so none of them would notice heavy.mjs
// no longer CALLING it: spawn the raw argv again and the mangled form is back to
// a four-second green, with all of the above still passing. These two go red on
// exactly that. They need a real cmd.exe, so off Windows they are a NAMED skip.
const WIN = process.platform === 'win32';
const OFF_WIN = WIN ? false : 'spawns a real cmd.exe; the platform-injected cases above carry the rule on every OS';
const HEAVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'heavy.mjs');
const E2E = mkdtempSync(join(tmpdir(), 'windows-command-e2e-'));
after(() => { try { rmSync(E2E, { recursive: true, force: true }); } catch {} });
let k = 0;
/** heavy.mjs against a temp lock, no backup wait, not CI, stdin at EOF (the
 *  condition under which an interactive cmd exits 0 having run nothing). */
const heavy = (...cmd) => {
  const lock = join(E2E, `case-${++k}`, 'heavy-run.lock');
  const env = { ...process.env, NIKATRU_HEAVY_LOCK: lock, NIKATRU_HEAVY_BACKUP_TASK: '', NIKATRU_HEAVY_LOCK_POLL_MS: '100', CI: '' };
  delete env.NIKATRU_HEAVY_LOCK_TOKEN;
  const r = spawnSync(process.execPath, [HEAVY, '--lock-wait', '0.05', '--', ...cmd], { encoding: 'utf8', env, input: '', timeout: 60_000 });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, lock };
};

describe('heavy.mjs end to end — a command that must fail, FAILS', () => {
  test('a .bat named directly that exits 7 answers 7 through heavy.mjs (wrapped inside node)', { skip: OFF_WIN }, () => {
    const bat = join(E2E, 'must-fail.bat');
    writeFileSync(bat, '@echo off\r\necho ran-the-bat\r\nexit /b 7\r\n');
    const r = heavy(bat);
    assert.equal(r.status, 7, `a .bat that exits 7 must make heavy.mjs exit 7\n${r.out}`);
    assert.match(r.out, /ran-the-bat/);
    assert.equal(existsSync(r.lock), false, 'the lock must be released');
  });

  test('🔴 the argv MSYS makes of `cmd /c "exit 7"` is REFUSED — exit 2, and the lock is never taken', { skip: OFF_WIN }, () => {
    // Exactly what node receives after MSYS rewrote the switch: 'C:/' where /c was.
    const r = heavy('cmd', 'C:/', 'exit 7');
    assert.equal(r.status, 2, `the mangled cmd invocation must be COVERAGE LOST, never 0\n${r.out}`);
    assert.match(r.out, /COVERAGE LOST/);
    assert.doesNotMatch(r.out, /heavy-run lock taken/);
    assert.equal(existsSync(r.lock), false);
  });
});
