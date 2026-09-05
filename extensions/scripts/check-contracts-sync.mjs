/* check-contracts-sync.mjs — has the runtime's contract copy drifted?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/check-contracts-sync.mjs

   The CI half of the bargain `scripts/sync-contracts.mjs` strikes, and the same
   bargain `check-core-sync.mjs` already makes for `core/v1`: vendoring buys a
   runtime that loads with zero setup and an adoption that is visible as a diff,
   and it costs the one thing an import would have given for free — the copies
   can silently diverge. This is the gate that makes divergence loud.

   IT READS THE SYNC SCRIPT'S OWN TABLE, not a second list. A gate with its own
   copy of "which files are mirrored" is a third transcription of the fact this
   whole directory exists to hold once, and the copy is the one that rots.

   WHEN THE ONLY DIFFERENCE IS LINE ENDINGS, IT SAYS SO. A CRLF that sneaks in
   changes the sha256 and fails with a diff nobody can see in an editor —
   `.gitattributes` declares `* text=auto eol=lf` for exactly this. The mismatch
   is re-tested against LF-normalised bytes and reported as what it is.

   ⚠️ THIS IS NOT THE ONLY THING HOLDING THESE COPIES TOGETHER, and saying so
   here is the point. `tooling/ci/assert-entitlement-contract.mjs` limb 4 parses
   the revocation-reason set out of FIVE places — the SQL seed, the authored
   contract, its generated JSON, this vendored copy, and the generated Dart — and
   fails if any pair disagrees about a single `restores` flag. This gate is the
   cheaper, sharper check: byte equality, with a message that names the fix.

   Exit codes: 0 in sync · 1 drifted · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, sha256 } from './lib/toolinfo.mjs';
import { SYNCED, contractsRoot } from './sync-contracts.mjs';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['repo-root', 'contracts-root']);
const extRoot = repoRoot(args);
const monoRoot = contractsRoot(extRoot, args);

const r = new Report('check-contracts-sync');

/* REQUIRED COVERAGE, first, because every limb below ranges over this table.
   Zero rows compares nothing and prints a clean run — the failure this corpus
   names before any other. */
if (!Array.isArray(SYNCED) || SYNCED.length === 0) {
  die('scripts/sync-contracts.mjs exports an EMPTY sync table, so this gate compared nothing and\n' +
    'was about to report a pass over an empty set. That is indistinguishable from a runtime whose\n' +
    'contract copies are perfectly in sync, and only one of the two is a real state.');
}

if (!fs.existsSync(path.join(monoRoot, 'contracts'))) {
  die('no contracts/ directory at ' + monoRoot + '.\n' +
    'The shared contracts live at the monorepo root, one level above this subtree. Without them\n' +
    'there is nothing to compare the vendored copies against, and a gate that cannot look must not\n' +
    'report a pass. Pass --contracts-root <path> if this tree is checked out on its own.');
}

const lf = (buf) => Buffer.from(buf.toString('binary').replace(/\r\n/g, '\n'), 'binary');

const problems = [];
let compared = 0;

for (const row of SYNCED) {
  const srcAbs = path.join(monoRoot, row.from);
  const dstAbs = path.join(extRoot, row.to);

  if (!fs.existsSync(srcAbs)) {
    problems.push('SOURCE GONE  ' + row.from + '  — the authored contract this runtime copy mirrors is not in the ' +
      'tree. Either it moved and sync-contracts.mjs\'s table is stale, or it was deleted while a copy of it ' +
      'is still shipping.');
    continue;
  }
  const src = fs.readFileSync(srcAbs);
  if (src.length === 0) {
    problems.push('SOURCE EMPTY  ' + row.from + '  — zero bytes. Every hash comparison below would pass against ' +
      'an equally empty copy, and the runtime would carry no vocabulary at all.');
    continue;
  }
  if (!fs.existsSync(dstAbs)) {
    problems.push('MISSING  ' + row.to + '  — ' + row.why + ', and the runtime has no copy of it.\n' +
      '          Run:  node scripts/sync-contracts.mjs');
    continue;
  }
  compared++;
  const dst = fs.readFileSync(dstAbs);
  if (sha256(dst) === sha256(src)) continue;

  if (sha256(lf(dst)) === sha256(lf(src))) {
    problems.push('LINE ENDINGS  ' + row.to + '  — the content is identical; only CRLF/LF differs. .gitattributes ' +
      'declares "* text=auto eol=lf" for exactly this. Re-run sync-contracts, and check that nothing rewrote the ' +
      'file with a Windows-default editor or a PowerShell redirect.');
  } else {
    problems.push('MODIFIED  ' + row.to + '  — differs from ' + row.from + '. A vendored contract is a COPY, not a ' +
      'fork: edit the contract and re-sync, or the edit is lost the next time anyone syncs — and until then the ' +
      'extension and the Worker disagree about ' + row.why + '.\n' +
      '          Run:  node scripts/sync-contracts.mjs');
  }
}

if (problems.length) {
  r.fail(problems.length + ' contract copy/copies have drifted from contracts/', problems.join('\n'));
} else {
  r.pass(compared + ' contract file(s) byte-identical to the authored copy under contracts/',
    SYNCED.map((s) => '  ' + s.to + '  <-  ' + s.from).join('\n'));
}

/* The second coverage limb: rows can exist and still compare nothing, if every
   one of them failed before the hash. `compared` counts only real comparisons. */
if (compared === 0) {
  r.fail('at least one contract copy was actually compared',
    'Every row in the sync table failed before its bytes could be hashed, so this gate has not ' +
    'compared a single pair. "Nothing to compare" is not "nothing wrong".');
}

process.exit(r.finish());
