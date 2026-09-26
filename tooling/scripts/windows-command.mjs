// ─────────────────────────────────────────────────────────────────────────────
// windows-command.mjs — what `heavy.mjs` should actually spawn, or why the
// invocation it was handed cannot be run honestly.
//
// 🔴 IT IS ITS OWN MODULE SO IT CAN BE TESTED. `heavy.mjs` is a CLI: importing
// it runs it, and it exits 2 on a usage error before a test can reach anything.
// That is why the rule below shipped untested on 2026-09-20 and had to be
// separated the same day.
//
// ── THE DEFECT THIS ENCODES ─────────────────────────────────────────────────
// From the Bash tool on Windows, MSYS rewrites a bare `/c` argument into the
// PATH `C:/` before node is even started. So `-- cmd /c flutter test` reaches
// `spawn` as `cmd` + `C:/` + …: cmd takes a path where its switch should be,
// opens INTERACTIVELY, reads EOF from a non-tty stdin, and exits 0 — HAVING RUN
// NOTHING. Measured 2026-09-20 with the exit code captured on its own line:
//
//     cmd /c  "exit 7"   ->  0     ← a command that must fail, reporting success
//     cmd //c "exit 7"   ->  7
//
// `-- cmd /c …` was the form `heavy.mjs`'s own header, its ENOENT hint and the
// lane brief all recommended, and a lane's full app suite "passed" in four
// seconds because of it. A runner that reports success without running is the
// precise failure `docs/verification-discipline.md` exists to prevent.
//
// ⚠️ TELLING CALLERS TO TYPE `//c` IS NOT THE REPAIR. That is a workaround for a
// tool which accepts an invocation that cannot work and then calls it a pass.
//
// ⏱ 2026-09-22 (O-HEAVY-CMD-C-IDIOM-IS-A-SILENT-FALSE-GREEN). `C:\Windows\System32\cmd.exe` and `$COMSPEC` are
// cmd too. The rule below used to compare the WHOLE word against `cmd`, so a
// full-path invocation walked straight past the refusal, fell through to the
// final pass-through, and reproduced the exact vacuous green this module exists
// to stop — with the mangled `C:/` still sitting where the switch belongs. It is
// the basename that decides, never the spelling the caller happened to use.
//
// ── ⏱ 2026-09-24: ANY PROGRAM'S SWITCH, NOT ONLY cmd's (O-HEAVY-CMD-C-IDIOM-IS-A-SILENT-FALSE-GREEN)
// The rewrite is MSYS's, not cmd's: every bare `/switch` typed in the Bash tool
// reaches every native program as a path. What node receives from the Bash tool
// on this laptop (the `/c` rows are the 2026-09-20 measurement above; `/PID` is
// the one recorded with this change):
//
//     typed          node receives                   rule below
//     /c             C:/                             (a) a bare drive root
//     /PID           C:/Program Files/Git/PID        (b) one segment under the MSYS root
//     //c            /c                              passed: the escape collapses to the switch
//
// So `taskkill /PID 123 /T /F` runs as `taskkill <path> 123 T:/ F:/`. Both
// shapes are REFUSED, for any program, before the lock is taken:
//   (a) an argument that is exactly a drive root, `X:/`;
//   (b) an argument that is the MSYS root (from EXEPATH) plus ONE segment, when
//       no such file exists — a real file there is a path someone meant.
// Both apply only when MSYSTEM is set (the caller is an MSYS shell) and
// MSYS_NO_PATHCONV is not (with it, nothing was rewritten): from PowerShell or
// cmd, `C:/` is just a path.
//
// ⚠️ WHAT IT MISSES: a switch whose rewrite exists on disk under the root
// (`/etc`, `/usr`, `/bin`); a switch MSYS maps to a mount other than the root
// (`/tmp`); a switch inside an argument (`--x=/c`) or one with a `/` in it; and
// an MSYS without EXEPATH, where limb (b) has no root to compare against.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';

/** The MSYS install root EXEPATH names — its `bin` or `usr/bin` stripped — in
 *  forward slashes, as MSYS spells the rewritten switch. null without EXEPATH. */
export function msysRoot(exepath) {
  if (!exepath) return null;
  const root = String(exepath).replace(/\\/g, '/').replace(/\/+$/, '').replace(/\/(usr\/)?bin$/i, '');
  return root || null;
}

/**
 * @param {string[]} cmd            the argv after `--`
 * @param {string} [platform]       process.platform, injectable for the tests
 * @param {string} [comspec]        %ComSpec%, injectable for the tests
 * @param {object} [env]            the environment (MSYSTEM, EXEPATH, MSYS_NO_PATHCONV), injectable
 * @param {(p: string) => boolean} [exists]  existsSync, injectable
 * @returns {{file: string, args: string[], refuse?: undefined} | {refuse: string}}
 */
export function windowsCommand(cmd, platform = process.platform, comspec = process.env.ComSpec, env = process.env, exists = existsSync) {
  const [file, ...args] = cmd;
  // Nothing here applies off Windows: `/c` is not a switch, `.bat` is not
  // executable, and a POSIX shell does not rewrite arguments into drive paths.
  if (platform !== 'win32') return { file, args };

  // The MSYS limb, for EVERY program (see the header). Before the cmd rule, so a
  // mangled switch is refused whatever program it was typed to.
  if (env.MSYSTEM && env.MSYS_NO_PATHCONV == null) {
    const root = msysRoot(env.EXEPATH);
    for (const a of args.map(String)) {
      let sw = null;
      if (/^[A-Za-z]:\/$/.test(a)) sw = `/${a[0].toLowerCase()}`;
      else if (root && a.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        const rest = a.slice(root.length + 1);
        if (rest && !rest.includes('/') && !exists(a)) sw = `/${rest}`;
      }
      if (sw) {
        return {
          refuse:
            `\`${a}\` is what MSYS makes of a bare \`${sw}\` switch: \`${file}\` would receive a PATH where its switch ` +
            `belongs and run something other than what was typed — cmd given one opens interactively and would RUN NOTHING, answering 0.\n` +
            `  Type the switch as \`/${sw}\` (MSYS collapses it to \`${sw}\`), or run with \`MSYS_NO_PATHCONV=1\`; ` +
            `for a .bat/.cmd, name it directly — \`-- flutter.bat test\` — and it is wrapped for you.`,
        };
      }
    }
  }

  // ⏱ 2026-09-22: the BASENAME decides. `cmd`, `cmd.exe`, `C:\Windows\System32\cmd.exe`
  // and whatever `$COMSPEC` holds are all the same program, and all of them are
  // mangled the same way by MSYS.
  if (/^cmd(\.exe)?$/i.test(String(file).split(/[\\/]/).pop())) {
    const sw = args[0] ?? '';
    // `//c` is NOT refused: MSYS collapses it to `/c`, so by the time it is read
    // here it is already a real switch. Only the mangled and the missing forms
    // are refused.
    if (!/^\/[ck]$/i.test(sw)) {
      return {
        refuse:
          `\`${file}${sw ? ` ${sw}` : ''}\` is not a runnable invocation: cmd's /c switch is missing, so cmd ` +
          `would open interactively, read EOF and exit 0 HAVING RUN NOTHING — a green that grades nothing.\n` +
          `  This is almost always MSYS rewriting a bare \`/c\` into a path before node started.\n` +
          `  Name the .bat/.cmd directly instead — \`-- flutter.bat test\` — and it is wrapped for you.`,
      };
    }
    return { file, args };
  }

  // A .bat/.cmd cannot be spawned without its interpreter. The wrapping happens
  // HERE, inside node, where no shell can rewrite the switch — which is the
  // whole point: the caller never types `/c`, so it can never be mangled.
  if (/\.(bat|cmd)$/i.test(file)) {
    return { file: comspec || 'C:\\Windows\\System32\\cmd.exe', args: ['/c', file, ...args] };
  }
  return { file, args };
}
