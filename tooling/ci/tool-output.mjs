// ─────────────────────────────────────────────────────────────────────────────
// tool-output.mjs — THE ONE way a guard in tooling/ci says what an external tool
// returned when that return is why it stopped.
//
// A COVERAGE LOST over a tool's output that does not SHOW the output leaves the
// next person to re-run the job with a print added, and the first real run of a
// guard is the run most likely to meet a format nobody wrote a fixture for. So
// every such stop prints the same block: which binary ran, which version it
// was, how it exited, and the first 20 lines of each stream.
//
// `toolOutputLines` moved here from assert-apps-gov-in-apk.mjs (row
// O-APPS-GOV-IN-APK-SIGNER-UNREAD), unchanged, on 2026-09-24, when the two Apple
// guards needed the same block (row O-APPLE-GUARDS-PARSE-HAND-WRITTEN-OUTPUT).
// assert-apps-gov-in-apk.mjs re-exports it, so its test's import still resolves.
//
// Pure functions: strings and a spawnSync-shaped result in, lines out. It runs
// nothing, reads nothing and exits nowhere — the caller owns the stop and the
// sentence that names it.
// ─────────────────────────────────────────────────────────────────────────────

/** One stream of a tool's output → at most `max` lines, each prefixed `<name>| `, control characters escaped. */
export function toolOutputLines(name, text, max = 20) {
  const s = String(text ?? '');
  if (s === '') return [`${name}: (empty, 0 bytes)`];
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const esc = (l) => l.replace(/[\x00-\x1f\x7f]/g, (c) => ({ '\r': '\\r', '\t': '\\t' })[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  const out = [`${name}: ${lines.length} line(s), ${Buffer.byteLength(s)} bytes${lines.length > max ? `, first ${max} shown` : ''}`];
  for (const l of lines.slice(0, max)) out.push(`${name}| ${esc(l)}`);
  return out;
}

/** How a spawnSync-shaped result ended: its exit status, its error code, or the signal that stopped it. */
export function exitOf(result) {
  if (!result) return 'not run';
  if (result.error) return `error ${result.error.code ?? result.error.message}`;
  if (result.status === null || result.status === undefined) return result.signal ? `signal ${result.signal}` : 'no status';
  return String(result.status);
}

/**
 * What a tool returned, as the lines a COVERAGE LOST prints: `tool:` (its path,
 * or "not found" naming it), `version:`, `exit:`, then the first `max` lines of
 * stdout and of stderr. `result` is the `{ status, stdout, stderr, error }` a
 * spawnSync (or a guard's injected `run`) returned.
 */
export function whatToolReturned({ name, path = null, version = null, result = null, max = 20 } = {}) {
  return [
    `tool: ${path ? path : `not found (${name})`}`,
    `version: ${version ? version : 'unknown'}`,
    `exit: ${exitOf(result)}`,
    ...toolOutputLines('stdout', result?.stdout, max),
    ...toolOutputLines('stderr', result?.stderr, max),
  ];
}
