#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-account-ids.mjs — no store-account id is written in full in this
// PUBLIC tree.
//
// ⏱ 2026-10-03 · rv2-business 009. Both
// Microsoft Partner Center seller ids, the Chrome Web Store publisher id and the
// Apple Developer Enrollment ID were written in full in tracked files of this
// public repository — a register note, a guard's `why` string, a compliance
// checklist and the iOS privacy audit — while every one of them has a home in
// the shared business brain (`nikatru/vendors/<vendor>.md`). Each was replaced by
// a pointer to that home. This guard is what keeps them out.
//
// 🔴 THE VALUES ARE READ FROM THE BRAIN AT RUN TIME, NEVER WRITTEN HERE. A list of
// the ids in this file would be the leak it exists to prevent. Each kind below
// says which brain file holds it and how its line is recognised; the guard reads
// the values in-process, hands them to `git grep -F` on stdin (never argv, so no
// process listing shows them), and prints only the KIND, the file and the line:
// "match" or "no match". It never prints a value, a prefix or a suffix.
//
// ⚠️ THE BRAIN IS NOT ON THE CI CHECKOUT, so this cannot be a CI guard: it runs
// from the git hooks (tooling/scripts/spec-guards.mjs), on the machine that has
// the brain. Brain absent → exit 2, COVERAGE LOST — nothing was checked, and
// nothing is not a pass. A kind whose brain file is missing or yields no value
// is exit 2 too: the label moved, and a guard searching for zero values would
// print "clean" forever.
//
// ⚠️ HISTORY IS NOT REWRITTEN. The values remain in git history before
// 2026-10-01; rewriting a public repository's history is the owner's call and is
// recorded as such in rv2-business 009.
//
// The last four characters of an id are not a full id and do not match: where an
// old and a live id must be told apart, the last four may be written.
//
// Usage:  node tooling/scripts/assert-no-account-ids.mjs [--repo <dir>]
//   brain: $NIKATRU_BUSINESS_ROOT, else `<anchor>/nikatru`, the anchor being the
//   nearest ancestor of this file holding BOTH `Projects/` and `nikatru/` (the
//   same walk tooling/scripts/spec-guards.mjs and assert-public-citations.mjs do).
// Exit 0 = no full id in any tracked file · 1 = one or more found · 2 = COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The kinds. `file` is brain-relative; `line` picks the lines of that file the
 *  value is written on; `value` extracts it from such a line (capture group 1 if
 *  present, else the whole match). Every kind must yield at least one value. */
export const ID_KINDS = Object.freeze([
  Object.freeze({
    kind: 'microsoft-seller-id',
    file: 'vendors/microsoft.md',
    line: /seller\s*id/i,
    // The 6–12 digit number that FOLLOWS a "Seller ID" label (an optional `(live)` and
    // table punctuation between): the account has carried TWO seller ids that differ by
    // three digits, and both are kept out. ⏱ 2026-10-03: this took EVERY such number on
    // a line mentioning the seller, and the brain's "Seller / approver / customer contact"
    // row carries the published business phone number, which it then failed on
    // contact.html, support.html and tooling/house-identity.json.
    value: /seller\s*id(?:\s*\([^)]{0,12}\))?\W{0,12}(\d{6,12})(?![\d-])/gi,
  }),
  Object.freeze({
    kind: 'chrome-publisher-id',
    file: 'vendors/google.md',
    line: /publisher/i,
    value: /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi,
  }),
  Object.freeze({
    kind: 'apple-enrollment-id',
    file: 'vendors/apple.md',
    line: /enrol{1,2}ment\s+id/i,
    // The token that FOLLOWS the label, with at least one digit — so neither the
    // word ENROLLMENT nor a Team ID written elsewhere on the line is taken for it.
    // Up to 12 non-word characters between them: the brain writes it as a table
    // cell, `| **Enrollment ID** | **<backtick>id…`, eight of them (measured 2026-10-03).
    value: /enrol{1,2}ment\s+id\W{0,12}((?=[A-Z0-9]*\d)[A-Z0-9]{10})\b/gi,
  }),
]);

/** The values of every kind in `brain`, or a refusal naming what is missing.
 *  Exported for the test; never logs a value. */
export function readBrainIds(brain) {
  const out = [];
  const missing = [];
  for (const k of ID_KINDS) {
    let src;
    try {
      src = readFileSync(join(brain, ...k.file.split('/')), 'utf8');
    } catch {
      missing.push(`${k.kind}: ${k.file} does not exist in the brain`);
      continue;
    }
    const values = new Set();
    for (const l of src.split(/\r?\n/)) {
      if (!k.line.test(l)) continue;
      for (const m of l.matchAll(k.value)) values.add(m[1] ?? m[0]);
    }
    if (values.size === 0) missing.push(`${k.kind}: ${k.file} has no line matching ${k.line} that carries a value of the id's shape`);
    for (const v of values) out.push({ kind: k.kind, value: v });
  }
  return { ids: out, missing };
}

function findBrain() {
  if (process.env.NIKATRU_BUSINESS_ROOT) return { brain: resolve(process.env.NIKATRU_BUSINESS_ROOT), via: '$NIKATRU_BUSINESS_ROOT' };
  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  for (let d = HERE; ; d = dirname(d)) {
    if (isDir(join(d, 'Projects')) && isDir(join(d, 'nikatru'))) return { brain: join(d, 'nikatru'), via: `the workspace anchor ${d}` };
    if (dirname(d) === d) return { brain: null, via: null };
  }
}

function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--repo');
  const repo = resolve(at >= 0 ? argv[at + 1] ?? '' : join(HERE, '..', '..'));

  const { brain, via } = findBrain();
  if (!brain || !existsSync(brain)) {
    console.error('✗ COVERAGE LOST — account ids: the business brain was not found, so NOTHING was checked.');
    console.error(`  Looked at ${via ? `${brain} (from ${via})` : '$NIKATRU_BUSINESS_ROOT (unset) and every ancestor of this file for `Projects/` + `nikatru/`'}.`);
    console.error('  The ids are read from the brain at run time and written nowhere else; without it there is nothing to search for.');
    process.exit(2);
  }
  const { ids, missing } = readBrainIds(brain);
  if (missing.length) {
    console.error('✗ COVERAGE LOST — account ids: a kind yielded no value from the brain, so it was not searched for.');
    for (const m of missing) console.error(`  ${m}`);
    console.error('  The label or the file moved. Fix ID_KINDS in tooling/scripts/assert-no-account-ids.mjs; a kind that searches for nothing passes forever.');
    process.exit(2);
  }

  const grep = spawnSync('git', ['-C', repo, 'grep', '-F', '-n', '-I', '--null', '--full-name', '-f', '-'], {
    input: `${ids.map((i) => i.value).join('\n')}\n`,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  // git grep: 0 = matches, 1 = none, anything else = it did not search.
  if (grep.status !== 0 && grep.status !== 1) {
    console.error(`✗ COVERAGE LOST — account ids: \`git grep\` in ${repo} exited ${grep.status}, so the tree was not searched.`);
    console.error(`  ${String(grep.stderr).trim().split('\n')[0] ?? ''}`);
    process.exit(2);
  }

  const hits = [];
  for (const rec of grep.stdout.split('\n')) {
    if (!rec) continue;
    const [file, line, ...rest] = rec.split('\0');
    const text = rest.join('\0');
    const kinds = [...new Set(ids.filter((i) => text.includes(i.value)).map((i) => i.kind))];
    hits.push({ file, line, kinds });
  }
  const perKind = ID_KINDS.map((k) => ({ kind: k.kind, n: ids.filter((i) => i.kind === k.kind).length, hit: hits.some((h) => h.kinds.includes(k.kind)) }));

  if (hits.length) {
    console.error(`✗ account ids — ${hits.length} tracked line(s) carry a full store-account id (values not printed):`);
    for (const h of hits) console.error(`    ${h.file}:${h.line}  ${h.kinds.join(', ')}  match`);
    console.error('  Replace each with a pointer to its home in the brain (nikatru/vendors/<vendor>.md, by heading). Keep at most the');
    console.error('  last four characters, and only where an old and a live id must be told apart. rv2-business 009.');
    process.exit(1);
  }
  console.log(`ok  account ids — ${perKind.map((k) => `${k.kind} (${k.n} value(s)): no match`).join(' · ')} — over the tracked tree of ${repo}, brain from ${via}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
