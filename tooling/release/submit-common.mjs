// ─────────────────────────────────────────────────────────────────────────────
// submit-common.mjs — the preamble every tooling/release/submit-*.mjs runs.
//
// ⏱ ADDED 2026-09-25 (O-SUBMIT-SCRIPTS-SHARE-NO-MODULE). The argument reader,
// the repo root, the ok/step printers and the two stops were a byte-identical
// block in each submit script. Four copies of a stop is four places its exit
// code can be wrong, and all four WERE: every `coverageLost` exited 1, which the
// exit-code convention (AGENTS.md, O-EXIT2-CONVENTION-GAP) reserves for a
// finding. Here it exits 2, once.
//
// NOT a release script: no channel row names it, and assert-channel-register's
// orphan check admits it by name through RELEASE_LIBRARIES, which refuses the
// entry the day no submit script imports it.
//
// Exit convention of the two stops:
//   coverageLost(lines) → 2  the script could not look, so "clean" would be a lie
//   die(lines)          → 1  a finding, or a refused invocation
//
// The environment-protection read stays in each script on purpose: its move is
// a separate change (C4b), and assert-release-provenance limb 4(b) reads it in
// the invoked script's OWN source.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The COVERAGE LOST exit. A finding is 1; a guard that could not look is 2. */
export const EXIT_COVERAGE_LOST = 2;

/**
 * The shared preamble for the submit script called `name` (its basename without
 * `.mjs`; it is the word on every FAILED line).
 *
 * `root` is `--repo-root` when given (tests point it at a fixture tree), else
 * the repository this file sits in, two levels up — the same directory every
 * submit script computed from its own location, since they live beside it.
 */
export function submitCli(name) {
  const argv = process.argv.slice(2);
  const flag = (f) => argv.includes(`--${f}`);
  const opt = (o, fallback = null) => {
    const i = argv.indexOf(`--${o}`);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
  };
  const root = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const ok = (m) => console.log(`ok   ${m}`);
  const step = (m) => console.log(`→    ${m}`);
  const abs = (rel) => join(root, rel);
  // One read, no existsSync first (CodeQL js/file-system-race): a missing file is null.
  const read = (rel) => {
    try {
      return readFileSync(abs(rel), 'utf8');
    } catch (e) {
      if (e?.code === 'ENOENT' || e?.code === 'EISDIR') return null;
      throw e;
    }
  };

  /** The scan cannot continue and reporting "clean" would be a lie about nothing. */
  function coverageLost(lines) {
    console.error('');
    console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
    for (const l of lines.slice(1)) console.error(`     ${l}`);
    console.error(`\n${name}: FAILED`);
    process.exit(2);
  }

  function die(lines) {
    console.error('');
    for (const l of lines) console.error(l);
    console.error(`\n${name}: FAILED`);
    process.exit(1);
  }

  return { argv, flag, opt, root, ok, step, abs, read, coverageLost, die };
}
