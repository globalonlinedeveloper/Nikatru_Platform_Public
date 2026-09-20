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
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string[]} cmd            the argv after `--`
 * @param {string} [platform]       process.platform, injectable for the tests
 * @param {string} [comspec]        %ComSpec%, injectable for the tests
 * @returns {{file: string, args: string[], refuse?: undefined} | {refuse: string}}
 */
export function windowsCommand(cmd, platform = process.platform, comspec = process.env.ComSpec) {
  const [file, ...args] = cmd;
  // Nothing here applies off Windows: `/c` is not a switch, `.bat` is not
  // executable, and a POSIX shell does not rewrite arguments into drive paths.
  if (platform !== 'win32') return { file, args };

  if (/^cmd(\.exe)?$/i.test(file)) {
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
