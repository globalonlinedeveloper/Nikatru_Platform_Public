/* sha256.mjs — the hex digest of one file, on stdout, and nothing else.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/sha256.mjs dist/fullshot-chromium.zip
     node scripts/sha256.mjs <file> --repo-root <dir>

   Two call sites, both inside ci.yml's determinism check -- the `package`
   job's step named "Determinism check (zip is byte-reproducible)" -- and the
   whole of this script's contract is visible in them:

     node scripts/pack.mjs <tool> --target <target> --out dist2
     a=$(node scripts/sha256.mjs dist/<tool>-<target>.zip)
     b=$(node scripts/sha256.mjs dist2/<tool>-<target>.zip)
     echo "$a"; echo "$b"
     [ "$a" = "$b" ] || { echo "::error::zip is not reproducible"; exit 1; }

   Two independent builds of the same commit, packed into two directories,
   hashed, compared. That comparison is what turns "this extension makes no
   network calls" from a claim into something a reviewer can check for
   themselves: rebuild from the tag, hash the zip, compare. release.yml's
   "Checksums" step publishes the digests with coreutils `sha256sum`, so what
   this prints must be the same shape — a bare lowercase hex digest, no prefix.

   THIS IS THE ONE SCRIPT IN scripts/ WHOSE STDOUT IS DATA, NOT A REPORT

   Every sibling here prints a `Report` — a title, PASS/FAIL lines, a summary.
   This one must not, and the reason is mechanical rather than stylistic: the
   two invocations above are compared to each other while their INPUT PATHS
   DIFFER (`dist/...` versus `dist2/...`). Anything path-dependent on stdout —
   the filename, a banner, a "1 passed" tail — makes `[ "$a" = "$b" ]` false on
   every single run, and the step then reports "zip is not reproducible" about
   two zips that are byte-identical. A gate that fails correct code gets
   switched off, and then it guards nothing.

   So: stdout carries the digest and one newline (`$( )` strips it). Every
   diagnostic goes to stderr, where the runner log still shows it and no shell
   captures it. The three exit codes of scripts/README.md still hold.

   THE ONLY WAY THIS SCRIPT CAN LIE, AND IT IS A QUIET ONE

   `[ "$a" = "$b" ]` is TRUE when both are the empty string. So the entire
   safety of that step rests on one property of this file: it must never exit 0
   without having printed a real digest. Two ways that could happen, and both
   are guarded below:

     1. Exiting 0 on a file it could not read. Then a="" and b="" and the
        determinism check announces a reproducible build over two zips that do
        not exist. Every failure path here exits 2, so `set -e` -- that step
        opens `set -euo pipefail` -- aborts the step at the assignment — verified, a bare `a=$(cmd)` does
        propagate the substitution's status.

     2. Hashing an EMPTY file and reporting success. A zero-byte input hashes to
        e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 on both
        sides, the two digests agree, and the step passes over a build that
        produced nothing. That is the same defect toolinfo.mjs refuses for a
        manifest that parses as `[]`: the input is technically readable, every
        downstream answer it produces is the shape that gets graded as
        compliance, and the report is confident and wrong. An empty artifact is
        an unusable input for a byte-for-byte comparison, so it exits 2 and says
        which file and how many bytes.

   BYTES, NOT TEXT

   `readText()` in lib/toolinfo.mjs strips a UTF-8 BOM and decodes UTF-8, which
   is right for every gate that reads JSON and catastrophic here: it would
   change the digest of any artifact whose first three bytes happen to be
   EF BB BF, and mangle every zip on the way through. This reads a Buffer.
   For the same reason it does not reuse `sha256()` from lib/toolinfo.mjs — that
   helper returns `'sha256-' + hex`, the SRI-ish form recorded in vendor hash
   files, and scripts/README.md:95 asks for "the hex digest".

   Exit codes: 0 a digest was printed · 2 could not run.
   There is deliberately no 1. This script grades nothing — it reports a fact
   about one file, and the determinism step's own `[ "$a" = "$b" ]` line owns
   the verdict. An exit-1 branch here would be an assertion nothing can reach, and an assertion that cannot fail is worse
   than none: it inflates apparent coverage. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { die, parseArgs } from './lib/report.mjs';

const USAGE = 'usage: node scripts/sha256.mjs <file> [--repo-root <dir>]';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['repo-root']);

/* ---------------- 1. exactly one subject ---------------- */
/* The floor is one file and the ceiling is one file, and both ends are refused
   rather than papered over. Zero would print nothing and exit 0 if this were
   lenient — the empty-subject pass, in its purest form. More than one would put
   two digests on stdout, which `$( )` folds into a single two-line string that
   compares equal to another two-line string only by coincidence; the caller
   would be diffing a pair of pairs and would never be told. */
const subjects = args.positional;
if (subjects.length === 0) {
  die('no file given.\n' + USAGE + '\n' +
    'This script exists to be captured — the determinism step does a=$(node scripts/sha256.mjs ...) — so\n' +
    'printing nothing and exiting 0 would hand the determinism check an empty string that\n' +
    'compares equal to the other empty string. Refusing instead.');
}
if (subjects.length > 1) {
  die('expected exactly one file, got ' + subjects.length + ': ' + subjects.join(', ') + '\n' + USAGE + '\n' +
    'stdout here is a single value read by a shell command substitution. Two digests would be\n' +
    'captured as one two-line string, and the determinism-step comparison would silently become a\n' +
    'comparison of pairs. Call it once per file.');
}

/* ---------------- 2. where a relative path is relative TO ---------------- */
/* ONE base, stated in one sentence: `--repo-root` when it is given, the current
   directory otherwise. Not a fallback chain — trying one base and then another
   is how a gate ends up hashing a file nobody asked about and reporting a
   perfectly valid digest for it.

   CI passes no flag and runs from the repo root (ci.yml's `package` job sets no
   working-directory), so both readings give the identical path there. The flag
   is honoured rather than accepted-and-ignored because scripts/README.md:36
   promises `--repo-root` on every script and test/selftest.node.js appends it
   unconditionally to every gate it runs: a flag that silently does nothing
   would point this script at the real tree while the suite believed it was
   grading a synthetic one. */
const rootFlag = args.get('repo-root');
let base = process.cwd();
if (rootFlag !== undefined) {
  if (typeof rootFlag !== 'string' || !rootFlag) die('--repo-root needs a directory: --repo-root <dir>');
  base = path.resolve(rootFlag);
  if (!fs.existsSync(base)) die('--repo-root does not exist: ' + base);
}
const abs = path.resolve(base, subjects[0]);

/* ---------------- 3. read it as bytes ---------------- */
let buf;
try {
  buf = fs.readFileSync(abs);
} catch (e) {
  /* ENOENT is the common one and it is never an answer here: "the artifact is
     not there" is precisely the state the determinism check must not survive.
     EISDIR gets named because a stale directory sitting where the zip should be
     is a plausible way to arrive here, and "illegal operation on a directory"
     alone does not say which directory. */
  die('cannot read ' + abs + ': ' + e.code + ' — ' + e.message + '\n' +
    (e.code === 'EISDIR' ? 'That path is a directory. This hashes one file; the caller names the artifact.\n' : '') +
    'Exiting 2 rather than 0, because the determinism step captures stdout: a silent empty answer here\n' +
    'compares equal to the other silent empty answer and passes the determinism check over a\n' +
    'build that produced no zip at all.');
}

/* ---------------- 4. an empty artifact is not a subject ---------------- */
if (buf.length === 0) {
  die(abs + ' is zero bytes long.\n' +
    'An empty file hashes to e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855,\n' +
    'and so does every other empty file — so two empty builds agree, the determinism step reports a\n' +
    'byte-reproducible package, and the thing it proved is that nothing was built. This is the\n' +
    'same refusal lib/toolinfo.mjs makes for a manifest that parses as []: readable, useless, and\n' +
    'shaped exactly like the answer that gets graded as compliance.');
}

/* ---------------- 5. the digest ---------------- */
const hex = crypto.createHash('sha256').update(buf).digest('hex');

/* Coverage on stderr rather than assumed — the byte count is what tells a
   reader of the log that two agreeing digests were agreeing about something. */
process.stderr.write('sha256  ' + abs + '  ' + buf.length + ' byte(s)\n');
process.stdout.write(hex + '\n');

/* NO process.exit() HERE, AND IT IS NOT AN OVERSIGHT.
   process.exit() does not wait for a stdout write that has not drained, and
   stdout here is a PIPE — that is what `a=$(node scripts/sha256.mjs ...)` makes
   it. Falling off the end of the module exits 0 only after node has flushed;
   an added `process.exit(0)` one line down would exit 0 whether or not
   the digest arrived, and an empty capture is the single failure that comparison
   cannot see (see the header).

   Stated at the honest strength: measured on this host — node 24, Windows, Git
   Bash — a 2 MiB write followed immediately by process.exit(0) DID arrive
   intact through a pipe, so pipe writes are synchronous here and this is a
   hazard avoided rather than one observed. It is avoided anyway because it
   costs nothing, it varies by platform and node version, and the failure it
   would produce is the silent one. */
