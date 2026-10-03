// ─────────────────────────────────────────────────────────────────────────────
// cli.mjs — the few things every autopilot CLI needs, Windows-safe, in one place.
//
// WHY ITS OWN MODULE. The heartbeat writer, post-verdict and handback run on the
// owner's WINDOWS laptop; the reviewer, runner and fixer routines run on Linux.
// #1148 shipped two Windows-only defects, and the entry-point test is the classic
// one: `resolve(argv[1]) === fileURLToPath(import.meta.url)` is FALSE on Windows
// whenever the drive letter's case differs (`c:\…` typed, `C:\…` resolved), and a
// CLI whose main never runs exits 0 having done nothing. Tested with path.win32
// semantics in tooling/ci/test/autopilot-heartbeat.test.mjs.
//
// SPAWN RULE. `gh` and `git` are spawned with execFileSync, `shell: false`, never a
// shebang or .sh helper: on Windows libuv finds gh.exe / git.exe on PATH itself.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The failover contract (tooling/autopilot/contract.json), read once. */
export const CONTRACT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'contract.json'), 'utf8'));

/** Two paths name the same file: win32 compares case-insensitively, after resolving. */
export function samePath(a, b, platform = process.platform) {
  if (platform === 'win32') return win32.resolve(String(a)).toLowerCase() === win32.resolve(String(b)).toLowerCase();
  return posix.resolve(String(a)) === posix.resolve(String(b));
}

/** Was this module run as the CLI (`node <it> …`)? Windows-safe. */
export function isMain(metaUrl, argv1 = process.argv[1], platform = process.platform) {
  if (!argv1) return false;
  const self = fileURLToPath(metaUrl, { windows: platform === 'win32' });
  return samePath(argv1, self, platform);
}

/** The value after `--flag`, or `def`. */
export function flag(argv, name, def = null) {
  const at = argv.indexOf(name);
  return at === -1 || at + 1 >= argv.length ? def : argv[at + 1];
}

/** All of stdin as text (for the `… < snapshot.json` subcommands). */
export function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** A token from the environment, never printed: GH_TOKEN first (gh's own name). */
export const envToken = (env = process.env) => env.GH_TOKEN || env.GITHUB_TOKEN || null;

/** The ONE way a `gh` call is spawned: file `gh`, an argv array, no shell, a ceiling. */
export function ghSpawnSpec(args, { input = null, ceilingS = CONTRACT.heartbeat.CALL_CEILING_S } = {}) {
  return {
    file: 'gh',
    args: [...args],
    options: { shell: false, windowsHide: true, timeout: ceilingS * 1000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...(input === null ? {} : { input }), stdio: ['pipe', 'pipe', 'pipe'] },
  };
}

/** Redact anything token-shaped from a message before it is printed. */
export function redact(text) {
  return String(text ?? '').replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[redacted]');
}
