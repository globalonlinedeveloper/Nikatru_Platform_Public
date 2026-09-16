#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-bundle-provenance.mjs — INVARIANT G7. NO ENTITLEMENT WITHOUT A VERIFIED
// RECEIPT.
//
// 🔴 THE DEFECT, NAMED. A bundle grant is access to everything this portfolio
// sells. The row that carries it has a `source` column, and five of the seven
// seeded sources mean "somebody paid a rail" — for those, the ONLY thing that may
// bring a row into existence is a statement the SERVER obtained from that rail:
// an HMAC-verified notification, or an answer the server pulled from the store's
// own API. The two remaining sources (`promo_code`, `owner_comp`) mean "nobody
// paid", and their authority is an operator record instead.
//
// The failure this guard exists to make loud is a code path that writes a grant
// from A CLIENT-SUPPLIED BODY. It is attractive because it is short, it looks
// exactly like the correct path in a diff, every signature check upstream stays
// green, and on iOS and Android the resulting unlock CANNOT BE REVERSED.
//
// ── THE EXEMPT LIST IS READ, NEVER HARD-CODED ───────────────────────────────
// `requires_receipt` is seeded in services/platform/migrations/0009_bundle_grants.sql
// section B and mirrored in contracts/entitlement/bundle.js. THIS GUARD READS THE
// MIRROR. A hard-coded pair of names here would be a third copy — and the copy
// that stops being updated is always the one inside the checker, which then keeps
// passing while the set it is checking has moved underneath it. limb 9 of
// assert-entitlement-contract.mjs holds the SQL and the mirror equal in both
// directions, so reading the mirror is reading the seed.
//
// ── WHAT IT ACTUALLY CHECKS ─────────────────────────────────────────────────
//   1 · The exemption table can be READ and is non-degenerate (at least one
//       receipt-requiring source and at least one exempt one). A table that
//       parses to nothing would make every limb below vacuous.
//   2 · A writer into `bundle_grants` EXISTS under services/. Zero is COVERAGE
//       LOST, not a clean run: the whole invariant is about writers.
//   3 · Every CALL SITE of that writer sits in a file that reaches a verifier —
//       it must both import a verification seam and call it ABOVE the write.
//       A route that writes first and verifies afterwards is the same defect
//       wearing a passing import.
//   4 · No call site takes a grant-deciding field from a request body. The
//       object handed to the writer may not derive `source`, the feature set,
//       the expiry, the period end or the subject from `body`, `payload`,
//       `c.req.*` or a parsed request JSON.
//   5 · No call site writes an EXEMPT source unless the same call carries an
//       operator record. Nobody paid, so a receipt is the wrong evidence — but
//       "no evidence" is not the alternative.
//   6 · The route surface that reaches the writer refuses a body carrying those
//       fields, rather than silently ignoring them: an attempt must be visible.
//
// Usage:  node tooling/ci/assert-bundle-provenance.mjs [repoRoot]
// Exit 0 = every bundle grant has provenance. 1 = one does not, or coverage was
// lost. It exits NON-ZERO on an absent or empty subject tree, by design.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// 🔴 THE ONE DIRECTORY LISTING. `readdirSync` here would descend into a nested
// checkout — a git worktree, a submodule, a stray clone — and read another
// repository's files as this tree's. Green in CI, which creates no worktrees, and
// wrong on the machine of whoever is actually looking at it.
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/** The tree every deployed Worker lives in. The writer must be inside it. */
const SERVICES = 'services';
/** The mirror of the seeded `bundle_sources` set, INCLUDING `requiresReceipt`. */
const BUNDLE_CONTRACT = 'contracts/entitlement/bundle.js';
/** The table a grant is a row in. Named once. */
const GRANT_TABLE = 'bundle_grants';

/**
 * Identifiers whose value came from the caller. A property in the writer's
 * argument that derives from one of these is a grant decided by the client.
 *
 * ⚠️ `input` AND `receipt` ARE NOT HERE, and the distinction is the guard.
 * `receipt` is what a verifier returned — the store's word — and `input.token`
 * is an opaque handle that decides nothing on its own. What is banned is the
 * request BODY reaching a field that decides ACCESS.
 */
const CLIENT_SOURCES = [
  'body',
  'reqBody',
  'requestBody',
  'clientBody',
  'payload',
  'parsedBody',
  'json',
];

/** The fields that DECIDE ACCESS. A client may not reach any of them. */
const DECIDING_FIELDS = [
  'source',
  'featureSetName',
  'featureSetVersion',
  'expiresAt',
  'currentPeriodEnd',
  'userId',
  'trialEnd',
  'creditDaysApplied',
];

/**
 * Evidence that a file reaches a server-side verification before it writes.
 * Matched as SOURCE TEXT, so a rename of the seam is a diff here rather than a
 * silent pass — the same reason INSTANT_PATHS in assert-entitlement-contract.mjs
 * names its two canonicalisers by file.
 */
const VERIFY_CALL = /\.\s*verify\s*\(|verifierFor\s*\(|receiptVerifierFor\s*\(/;
// ⏱ RE-POINTED 2026-09-09, AND THE RENAME IS EXACTLY WHY THIS IS MATCHED AS
// SOURCE TEXT. `services/platform/src/lib/receipts/registry.ts` became
// `verifiers.ts` in the same change that made its modules reachable — two files
// named `registry.ts` in one service is a name collision waiting to confuse a
// reader — and this guard went RED on the real tree the moment it did, reporting
// `imports=false` for a route that plainly does verify. That is the design
// working: a rename of the seam is a DIFF HERE rather than a silent pass, which
// is the same reason INSTANT_PATHS in assert-entitlement-contract.mjs names its
// two canonicalisers by file. Both spellings are accepted so a merge from either
// side of the rename is not a false red.
const VERIFY_IMPORT = /from\s+['"][^'"]*(?:receipts|mor)\/(?:registry|verifiers)['"]/;

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
const ok = (m) => notes.push(m);

function done() {
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-bundle-provenance: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error('');
    console.error('  G7 — no entitlement without a verified receipt. A bundle grant is access to everything');
    console.error('  this portfolio sells, and on iOS and Android the resulting unlock cannot be reversed.');
    // ⏱ 2026-09-16 — O-EXIT2-CONVENTION-GAP. Exit 2 when EVERY problem is a COVERAGE LOST: the run did
    // not check enough to be evidence. Exit 1 when any is a finding — a proven defect outranks a blind
    // limb. This exited 1 for both until today. assert-guard-coverage.mjs reads this exact idiom.
    process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
  }
  console.log(
    `✓ assert-bundle-provenance: every writer into ${GRANT_TABLE} is downstream of a server-side ` +
      'verification, and none of them takes a grant-deciding field from a request body.',
  );
  process.exit(0);
}

// ── Comment-blind reading. A rule proven by a comment is proven by nothing. ──
function stripComments(src) {
  // Blanks `//` and `/* */` while preserving length, so line numbers survive.
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (two === '/*') {
      while (i < src.length && src.slice(i, i + 2) !== '*/') { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
      continue;
    }
    out += src[i]; i++;
  }
  return out;
}

function tsFilesUnder(dir, acc = []) {
  let entries;
  try { entries = listDir(dir); } catch { return acc; }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.wrangler') continue;
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) tsFilesUnder(abs, acc);
    else if (abs.endsWith('.ts') && !abs.endsWith('.d.ts')) acc.push(abs);
  }
  return acc;
}

const rel = (abs) => abs.replace(ROOT, '').replace(/^[\\/]/, '').replaceAll('\\', '/');

/** The balanced argument text of `name(` starting at `from`. */
function callArgs(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return src.slice(from + 1, i);
    }
  }
  return '';
}

// ── LIMB 1 · THE EXEMPTION TABLE, READ FROM THE MIRROR ──────────────────────
const contractAbs = join(ROOT, BUNDLE_CONTRACT);
let exempt = [];
let requiring = [];
if (!existsSync(contractAbs)) {
  coverageLost(
    `${BUNDLE_CONTRACT} does not exist, so which sources are exempt from needing a receipt could not be ` +
      'read. This guard refuses to hard-code that list: a third copy is the copy that stops being updated.',
  );
} else {
  const src = readFileSync(contractAbs, 'utf8');
  const arr = /BUNDLE_SOURCES\s*=\s*\[([\s\S]*?)\n\]/.exec(src);
  const rows = arr === null
    ? []
    : [...arr[1].matchAll(/source:\s*'([^']+)'\s*,\s*requiresReceipt:\s*(true|false)/g)];
  exempt = rows.filter((m) => m[2] === 'false').map((m) => m[1]);
  requiring = rows.filter((m) => m[2] === 'true').map((m) => m[1]);
  if (rows.length === 0) {
    coverageLost(
      `${BUNDLE_CONTRACT} parsed to ZERO bundle sources. An empty table exempts nothing and requires ` +
        'nothing, so every limb below would have graded a rule that says nothing.',
    );
  } else if (exempt.length === 0 || requiring.length === 0) {
    coverageLost(
      `${BUNDLE_CONTRACT} yields ${requiring.length} receipt-requiring and ${exempt.length} exempt ` +
        'source(s). G7 is the DIFFERENCE between the two; a table that is all one kind cannot express it.',
    );
  } else {
    ok(
      `${requiring.length} source(s) require a verified receipt and ${exempt.length} (${exempt.join(', ')}) ` +
        `are exempt, read from ${BUNDLE_CONTRACT} rather than restated here`,
    );
  }
}

// ── LIMB 2 · A WRITER EXISTS, AND IT IS THE SUBJECT ─────────────────────────
const servicesAbs = join(ROOT, SERVICES);
if (!existsSync(servicesAbs)) {
  coverageLost(
    `${SERVICES}/ does not exist, so this guard swept no writers at all and "every grant has provenance" ` +
      'was asserted over an empty tree.',
  );
  done();
}

const sources = tsFilesUnder(servicesAbs).map((abs) => ({
  abs,
  rel: rel(abs),
  raw: readFileSync(abs, 'utf8'),
  code: stripComments(readFileSync(abs, 'utf8')),
}));

if (sources.length === 0) {
  coverageLost(
    `${SERVICES}/ contains no TypeScript source, so no writer could be found and nothing was graded.`,
  );
  done();
}

const writerFiles = sources.filter((f) =>
  new RegExp(`INSERT\\s+INTO\\s+${GRANT_TABLE}\\b`, 'i').test(f.code),
);
if (writerFiles.length === 0) {
  coverageLost(
    `no file under ${SERVICES}/ contains an INSERT INTO ${GRANT_TABLE}. G7 is a rule ABOUT writers; with ` +
      'none in the tree this guard graded nothing, and a silent pass here is how a missing writer becomes ' +
      'a missing invariant.',
  );
  done();
}
ok(`${writerFiles.length} writer file(s) into ${GRANT_TABLE}: ${writerFiles.map((f) => f.rel).join(', ')}`);

/**
 * The exported function names that perform the write. Derived from the writer
 * file rather than named here, so renaming the function is a diff and not a
 * silent loss of every call-site limb below.
 */
const writerFns = new Set();
for (const f of writerFiles) {
  for (const m of f.code.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)) {
    // Only the one whose body carries the INSERT.
    const start = m.index;
    const body = f.code.slice(start, start + 4000);
    if (new RegExp(`INSERT\\s+INTO\\s+${GRANT_TABLE}\\b`, 'i').test(body)) writerFns.add(m[1]);
  }
}
if (writerFns.size === 0) {
  coverageLost(
    `the writer file(s) carry an INSERT INTO ${GRANT_TABLE} but no exported function containing it could ` +
      'be identified, so no call site could be located and limbs 3-5 graded nothing.',
  );
  done();
}
ok(`the write is reached through ${[...writerFns].join(', ')}`);

// ── LIMBS 3-5 · EVERY CALL SITE ─────────────────────────────────────────────
let callSites = 0;
for (const f of sources) {
  if (writerFiles.some((w) => w.abs === f.abs)) continue; // the writer itself
  for (const fn of writerFns) {
    const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
    for (const m of f.code.matchAll(re)) {
      // An import line naming the function is not a call site.
      const lineStart = f.code.lastIndexOf('\n', m.index) + 1;
      const line = f.code.slice(lineStart, f.code.indexOf('\n', m.index));
      if (/^\s*import\b/.test(line)) continue;
      callSites += 1;
      const args = callArgs(f.code, f.code.indexOf('(', m.index));

      // LIMB 3 · verification stands ABOVE the write, in this file.
      const importsSeam = VERIFY_IMPORT.test(f.code);
      const verifyAt = f.code.search(VERIFY_CALL);
      if (!importsSeam || verifyAt < 0) {
        fail(
          `${f.rel} calls ${fn}() but never reaches a verification seam (imports=${importsSeam}, ` +
            `verify-call=${verifyAt >= 0}). A grant may only be written on a statement the SERVER obtained ` +
            'from the rail — a signed notification or a pull from the store\'s own API.',
        );
      } else if (verifyAt > m.index) {
        fail(
          `${f.rel} calls ${fn}() at offset ${m.index} but its only verification call is at ${verifyAt} — ` +
            'AFTER the write. Verifying afterwards is the same defect wearing a passing import: the row ' +
            'already exists, and on iOS and Android the unlock it produced cannot be reversed.',
        );
      }

      // LIMB 4 · no grant-deciding field derives from a request body.
      for (const field of DECIDING_FIELDS) {
        const prop = new RegExp(`\\b${field}\\s*:\\s*([^,\\n}]+)`).exec(args);
        if (prop === null) continue;
        const value = prop[1];
        const tainted = CLIENT_SOURCES.find((id) => new RegExp(`\\b${id}\\b`).test(value));
        if (tainted !== undefined || /\bc\.req\b/.test(value)) {
          fail(
            `${f.rel} passes \`${field}\` to ${fn}() from ${tainted ?? 'c.req'} — a CLIENT-SUPPLIED BODY. ` +
              'This is the exact failing input G7 exists for: the field that decides access must come from ' +
              "the store's verified answer or from the verified session, never from the request.",
          );
        }
      }

      // LIMB 5 · an exempt source needs an operator record, not silence.
      for (const src of exempt) {
        if (new RegExp(`['"]${src}['"]`).test(args) && !/operator/i.test(args)) {
          fail(
            `${f.rel} writes the EXEMPT source '${src}' with no operator record in the same call. Exempt ` +
              'means "no receipt exists because nobody paid" — it does not mean "no evidence is needed". ' +
              'An exemption that is recorded can be audited; one that is not is indistinguishable from the bug.',
          );
        }
      }
    }
  }
}

if (callSites === 0) {
  coverageLost(
    `${writerFns.size} writer function(s) exist and NOTHING under ${SERVICES}/ calls them, so limbs 3-5 ` +
      'graded zero call sites. A writer with no caller is either dead code or a call this scan cannot see, ' +
      'and both make this guard vacuous.',
  );
  done();
}
// Counted, not congratulated: whether each site is downstream of a verification
// seam is decided by the limbs above, and printing the verdict here as well would
// mean one sentence claiming a thing another limb had just refused.
ok(`${callSites} call site(s) of the writer were graded by limbs 3-5`);

// ── LIMB 6 · THE ROUTE REFUSES A GRANT-DECIDING BODY OUT LOUD ───────────────
// Ignoring an unexpected key leaves the attempt invisible; refusing it puts a 400
// in the log. This is asserted on the files that actually call the writer.
const routeCallers = sources.filter(
  (f) =>
    !writerFiles.some((w) => w.abs === f.abs) &&
    [...writerFns].some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(f.code)),
);
const refusing = routeCallers.filter((f) => /client_supplied_grant/.test(f.code));
if (routeCallers.length > 0 && refusing.length === 0) {
  fail(
    `${routeCallers.length} file(s) call the ${GRANT_TABLE} writer and none of them refuses a body ` +
      'carrying grant-deciding keys (no `client_supplied_grant` refusal found). A request that tries to ' +
      'name its own feature set or expiry must produce a 400 that somebody can see, not a silently ' +
      'ignored key.',
  );
} else if (refusing.length > 0) {
  ok(`${refusing.length} route file(s) refuse a grant-deciding body explicitly`);
}

done();
