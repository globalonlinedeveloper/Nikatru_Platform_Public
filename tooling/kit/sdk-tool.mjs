// ─────────────────────────────────────────────────────────────────────────────
// sdk-tool.mjs — the REAL executable behind `flutter`, `dart` and `mason`, so no
// kit script ever hands an argument to a shell.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
// On Windows the three are batch files (flutter.bat, dart.bat, mason.bat), which
// Node will not spawn without a shell (EINVAL since the 2024 argument-injection
// fix). The kit used to reach them as `cmd.exe /d /s /c <tool>.bat …` with every
// argument pattern-checked first. CodeQL #578 (js/shell-command-injection-from-
// environment, club apply-ci) still read that as a shell command built from the
// environment — the flutter create destination is under os.tmpdir(), i.e. TMP —
// and the lead ruled it FIXED, not dispositioned: resolve the executable the
// batch file runs and spawn THAT, `shell: false`, every value its own argument.
//
// ── WHAT EACH BATCH FILE RUNS (Flutter SDK layout, bin/internal/shared.bat) ──
//   flutter.bat → <root>\bin\cache\dart-sdk\bin\dart.exe
//                   --packages=<root>\packages\flutter_tools\.dart_tool\package_config.json
//                   <root>\bin\cache\flutter_tools.snapshot <args>
//   dart.bat    → <root>\bin\cache\dart-sdk\bin\dart.exe <args>
//   mason.bat   → (a pub global binstub) dart pub global run mason_cli:mason <args>;
//                 a mason.exe on PATH is used as it is.
// <root> is the directory above the bin\ that holds flutter.bat on PATH.
// The batch files also rebuild a STALE tool snapshot; this does not. A missing
// snapshot or dart.exe is refused with the one command that builds it
// (`flutter --version`), never worked around through cmd.exe.
//
// Off Windows each tool is its own executable (a script with a shebang), spawned
// by name without a shell, exactly as before.
// ─────────────────────────────────────────────────────────────────────────────
import { statSync } from 'node:fs';
import { posix, win32 } from 'node:path';

const isFileOnDisk = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The PATH entries of `env`, read case-insensitively on Windows (`Path`). */
function pathEntries(env, platform) {
  const key = platform === 'win32' ? Object.keys(env).find((k) => k.toUpperCase() === 'PATH') : 'PATH';
  const raw = key === undefined ? '' : env[key] ?? '';
  const sep = platform === 'win32' ? ';' : ':';
  return raw
    .split(sep)
    .map((e) => e.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

/** The first `<dir>/<name>` on PATH that is a file, or null. */
export function findOnPath(name, { platform = process.platform, env = process.env, isFile = isFileOnDisk } = {}) {
  const path = platform === 'win32' ? win32 : posix;
  for (const dir of pathEntries(env, platform)) {
    const candidate = path.join(dir, name);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** The Flutter SDK's real executables on Windows, or `{ problem }`. */
function windowsFlutterSdk({ env, isFile }) {
  const bat = findOnPath('flutter.bat', { platform: 'win32', env, isFile });
  if (bat === null) return { problem: 'flutter.bat is not on PATH, so the Flutter SDK (and its dart.exe) could not be found.' };
  const root = win32.dirname(win32.dirname(bat));
  const dart = win32.join(root, 'bin', 'cache', 'dart-sdk', 'bin', 'dart.exe');
  const snapshot = win32.join(root, 'bin', 'cache', 'flutter_tools.snapshot');
  const packages = win32.join(root, 'packages', 'flutter_tools', '.dart_tool', 'package_config.json');
  const absent = [dart, snapshot, packages].filter((p) => !isFile(p));
  if (absent.length) {
    return { problem: `the Flutter SDK at ${root} has not built its tool yet (${absent.join(', ')} absent); run \`flutter --version\` once, then re-run.` };
  }
  return { root, dart, snapshot, packages };
}

/**
 * How to spawn `tool` (flutter | dart | mason) with `args`, without a shell.
 * Returns `{ command, args, env }` — `env` holds only what the tool needs ADDED
 * to the caller's environment — or `{ problem }` when the tool cannot be found.
 * `env` and `isFile` are injectable so the suite drives the Windows branch on any host.
 */
export function sdkTool(tool, args, { platform = process.platform, env = process.env, isFile = isFileOnDisk } = {}) {
  if (!['flutter', 'dart', 'mason'].includes(tool)) throw new Error(`sdkTool: unknown tool ${tool}`);
  if (platform !== 'win32') return { command: tool, args: [...args], env: {} };
  if (tool === 'mason') {
    const exe = findOnPath('mason.exe', { platform, env, isFile });
    if (exe !== null) return { command: exe, args: [...args], env: {} };
  }
  const sdk = windowsFlutterSdk({ env, isFile });
  if (sdk.problem) return { problem: `${tool}: ${sdk.problem}` };
  const added = { FLUTTER_ROOT: sdk.root };
  if (tool === 'flutter') return { command: sdk.dart, args: [`--packages=${sdk.packages}`, sdk.snapshot, ...args], env: added };
  if (tool === 'dart') return { command: sdk.dart, args: [...args], env: added };
  return { command: sdk.dart, args: ['pub', 'global', 'run', 'mason_cli:mason', ...args], env: added };
}
