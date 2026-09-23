#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-one-entitlement-reader.mjs — ONE READER OF THE MONEY TABLES, MOUNTED BY
// EVERY WORKER. [ADR 057] §5 · [ADR 067] decision 2 · [5]M-4 · [5]M-12.
//
// 🔴 THE DEFECT, MEASURED ON origin/main 543b3220 (2026-09-10). Two files read
// `FROM entitlements` to answer `GET /v1/entitlements`:
//   services/platform/src/routes/entitlements.ts            — the union read
//                                                              ([ADR 057] §5, #587,
//                                                              #612, #603)
//   services/subscriptiontracker-api/src/routes/entitlements.ts — its own SELECT,
//                                                              ZERO references to
//                                                              bundle_grants,
//                                                              granted_via or a
//                                                              feature set
// Same path, same table, same customer — two answers. A live bundle grant with no
// per-app row was `is_pro: true` on one host and `is_pro: false` on the other.
// Every test in the tree was green, because each Worker's suite graded ITS
// reader against ITS expectation. The doctrine says ONE reader; nothing in the
// tree could say the tree held two.
//
// The read now lives in services/_shared/src/entitlement-read.ts and both Workers
// mount it. THIS GUARD is what stops a second one growing back — in either
// Worker, or in a third stamped from the brick.
//
// ── FOUR LIMBS, each with a constructible failing input ─────────────────────
//   1 THE CENSUS. Every `FROM|JOIN entitlements` and `FROM|JOIN bundle_grants`
//     under services/*/src — comments stripped, string literals KEPT (SQL is a
//     string) — is counted per file, and the count table must EQUAL the
//     DECLARED table below: no undeclared file, no count drift, no declared
//     row the tree no longer carries. Every read of a money table is a decision
//     somebody recorded here, with its role, and a role other than "THE reader"
//     may not decide access.
//   2 THE READER IS THE ONE THAT DECIDES. Outside the declared reader, an
//     `is_pro:` object key — THE access decision — may only carry the reader's
//     answer through (`is_pro: read.is_pro`). Any other spelling is a second
//     decision wearing the reader's vocabulary. (`granted_via` is provenance,
//     not a decision — the receipts route answers it for a WRITE it just made —
//     so it is not ranged over; assert-analytics-contract.mjs says the same of
//     the client side.) Inside the reader, `grantsAccess(` is called for BOTH
//     branches and `is_pro` is `appPro || bundlePro` — the union.
//   3 EVERY CARRIER MOUNTS IT. Every `services/*/src/routes/entitlements.ts`
//     (derived from the tree; a third Worker joins by existing) imports
//     `readProductEntitlement` from the shared home AND calls it. An import
//     without a call is a delegation wearing a passing grep.
//   4 COVERAGE. services/ exists, the reader file exists and reads the table,
//     at least two carriers were found, and the census read files. A scan over
//     nothing prints "ok" — this repository's single most repeated failure.
//
// ⚠️ EVERYTHING IS PARSED FROM COMMENT-STRIPPED CODE. Both route files and the
// reader's own header contain the phrase `FROM entitlements` in PROSE, explaining
// what moved. A raw grep would count the sentence describing the defect as the
// defect (the `grep '"r2_buckets"'` mistake this corpus keeps recording).
//
// Usage:  node tooling/ci/assert-one-entitlement-reader.mjs [repoRoot]
// Exit 0 = one reader, mounted everywhere. 1 = a second reader, an undeclared
// read, an unmounted carrier, or coverage lost. It exits NON-ZERO on an absent or
// empty subject tree, by design.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
// 🔴 THE ONE DIRECTORY LISTING and THE ONE COMMENT STRIPPER — never a rival.
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const SERVICES = 'services';
/** THE reader. Named once. */
const READER = 'services/_shared/src/entitlement-read.ts';
/** The specifier tail every carrier must import the reader by. */
const READER_SPECIFIER = /from\s+['"][^'"]*_shared\/src\/entitlement-read['"]/;
/** The function a carrier must CALL, not merely import. */
const READ_FN = 'readProductEntitlement';
/** The two tables whose rows are a customer's access. */
const MONEY_TABLES = ['entitlements', 'bundle_grants'];
const READ_RE = /\b(?:FROM|JOIN)\s+(entitlements|bundle_grants)\b/gi;

/**
 * THE DECLARED TABLE — every file under services/*​/src that reads a money
 * table, with its role and its EXACT count per table. A new read anywhere is a
 * red build until it is written down here with a reason; a declared read that
 * disappears is a red build too, because a table describing a tree that no
 * longer exists is how a guard keeps passing after its subject moved.
 *
 * ⚠️ ONLY ONE ROW MAY CARRY `role: 'reader'`. Every other role is a lookup
 * that decides NOTHING about access, and limb 2 holds that to be true.
 */
const DECLARED = [
  {
    file: READER,
    role: 'reader',
    counts: { entitlements: 2, bundle_grants: 2 },
    why: 'THE reader: the per-product union read and the subject read, one statement each per table.',
  },
  {
    file: 'services/platform/src/lib/mor/store.ts',
    role: 'writer-lookup',
    counts: { entitlements: 3 },
    why:
      'the ONE writer, and every read decides a WRITE, never access: (1) it reads back the (user, app, entitlement) row a ' +
      'refund/chargeback lands on before it adjusts it; (2) ⏱ 2026-09-22 [ADR 092] §4.4 — the RevenueCat link upsert moves a ' +
      'purchase only when its CURRENT owner holds no live row on it (a NOT EXISTS inside the upsert); (3) [ADR 092] §4.3 — ' +
      'the TRANSFER tripwire refuses the move while any source account still holds a live RevenueCat row for the app.',
  },
  {
    file: 'services/platform/src/lib/mor/bundle-store.ts',
    role: 'writer-lookup',
    counts: { bundle_grants: 1 },
    why: '`liveGrantsFor` — the bundle writer\'s own scan of a subject\'s live grants, used by the receipts double-billing pre-check; it renders no envelope.',
  },
  {
    file: 'services/platform/src/routes/cancellation.ts',
    role: 'lookup',
    counts: { entitlements: 1 },
    why: 'finds the provider subscription to cancel ([5]M-9); decides nothing about access.',
  },
  {
    file: 'services/platform/src/routes/receipts.ts',
    role: 'lookup',
    counts: { entitlements: 1 },
    why: 'the double-billing pre-check before a store receipt is honoured; decides nothing about access.',
  },
  {
    file: 'services/platform/src/index.ts',
    role: 'probe',
    counts: { entitlements: 1 },
    why: '`SELECT 1 FROM entitlements LIMIT 1` — the health probe that fails on a bound-but-unmigrated database.',
  },
  {
    file: 'services/subscriptiontracker-api/src/index.ts',
    role: 'probe',
    counts: { entitlements: 1 },
    why: 'the same health probe on the per-app Worker.',
  },
];

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
const ok = (m) => notes.push(m);

function done() {
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-one-entitlement-reader: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error('');
    console.error('  [ADR 057] §5 — ONE reader of the entitlement tables. Two readers of one money table drift');
    console.error('  in the one way every suite stays green over: each Worker grades its own answer.');
    // ⏱ 2026-09-16 — O-EXIT2-CONVENTION-GAP. Exit 2 when EVERY problem is a COVERAGE LOST: the run did
    // not check enough to be evidence. Exit 1 when any is a finding — a proven defect outranks a blind
    // limb. This exited 1 for both until today. assert-guard-coverage.mjs reads this exact idiom.
    process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
  }
  console.log(
    `✓ assert-one-entitlement-reader: ${READER} is the one reader of ${MONEY_TABLES.join(' + ')}, ` +
      'every other read is declared with a role that decides nothing, and every carrier mounts it.',
  );
  process.exit(0);
}

const rel = (abs) => abs.replace(ROOT, '').replace(/^[\\/]/, '').replaceAll('\\', '/');

/** Every deployable `.ts` under services/*​/src, the shared home included. */
function tsFilesUnder(dir, acc = []) {
  let entries;
  try { entries = listDir(dir); } catch { return acc; }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.wrangler' || name === 'test') continue;
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) tsFilesUnder(abs, acc);
    else if (abs.endsWith('.ts') && !abs.endsWith('.d.ts')) acc.push(abs);
  }
  return acc;
}

// ── LIMB 4 (first, because everything below ranges over it) · COVERAGE ──────
const servicesAbs = join(ROOT, SERVICES);
if (!existsSync(servicesAbs)) {
  coverageLost(`${SERVICES}/ does not exist, so no reader and no carrier could be found and nothing was graded.`);
  done();
}
const sources = tsFilesUnder(servicesAbs)
  .filter((abs) => /[\\/]src[\\/]/.test(abs))
  .map((abs) => ({ abs, rel: rel(abs), code: stripSourceComments(readFileSync(abs, 'utf8'), extname(abs)) }));
if (sources.length === 0) {
  coverageLost(`${SERVICES}/ holds no TypeScript under any src/, so the census counted nothing.`);
  done();
}
const readerSrc = sources.find((f) => f.rel === READER);
if (readerSrc === undefined) {
  coverageLost(`${READER} does not exist. The one reader is gone, or moved without this guard following it.`);
  done();
}

// ── LIMB 1 · THE CENSUS ─────────────────────────────────────────────────────
const census = new Map(); // rel → { entitlements: n, bundle_grants: n }
let readsSeen = 0;
for (const f of sources) {
  for (const m of f.code.matchAll(READ_RE)) {
    const table = m[1].toLowerCase();
    const row = census.get(f.rel) ?? {};
    row[table] = (row[table] ?? 0) + 1;
    census.set(f.rel, row);
    readsSeen++;
  }
}
if (readsSeen === 0) {
  coverageLost(
    `${sources.length} file(s) read under ${SERVICES}/*/src and not ONE \`FROM entitlements\` or ` +
      '`FROM bundle_grants` was found. The census regex stopped matching; a tree of money Workers with no read is a broken scan.',
  );
  done();
}
const readerRows = DECLARED.filter((d) => d.role === 'reader');
if (readerRows.length !== 1 || readerRows[0].file !== READER) {
  coverageLost(`DECLARED must carry exactly ONE row with role 'reader', and it must be ${READER}.`);
  done();
}

const declaredByFile = new Map(DECLARED.map((d) => [d.file, d]));
for (const [file, counts] of census) {
  const d = declaredByFile.get(file);
  if (d === undefined) {
    fail(
      `${file} reads a money table (${Object.entries(counts).map(([t, n]) => `${t}×${n}`).join(', ')}) and is NOT ` +
        `declared. If this is a lookup that decides nothing, add a DECLARED row with its role and why; if it decides ` +
        `access, it is a SECOND READER — delete it and mount ${READER}.`,
    );
    continue;
  }
  for (const table of MONEY_TABLES) {
    const want = d.counts[table] ?? 0;
    const have = counts[table] ?? 0;
    if (want !== have) {
      fail(
        `${file} carries ${have} read(s) of \`${table}\`; DECLARED says ${want} (${d.role}: ${d.why}). A read ` +
          'that appeared is a decision nobody recorded; one that vanished leaves this table describing a tree that no longer exists.',
      );
    }
  }
}
for (const d of DECLARED) {
  if (!census.has(d.file)) {
    const exists = sources.some((f) => f.rel === d.file);
    fail(
      `DECLARED names ${d.file} (${d.role}) and the tree carries no money-table read there` +
        `${exists ? '' : ' — the file does not exist'}. Delete the row in the same change and say why.`,
    );
  }
}
if (problems.length === 0) {
  ok(`census: ${readsSeen} money-table read(s) across ${census.size} file(s), every one declared with a role`);
}

// ── LIMB 2 · THE READER IS THE ONE THAT DECIDES ─────────────────────────────
// `is_pro` ONLY — the access decision. `granted_via` is provenance (the receipts
// route answers `granted_via: 'bundle'` for a write it just made) and a client
// that branched on it would be re-deriving access from provenance.
const DECIDES = /\b(is_pro)\s*:\s*([^,\n}]+)/g;
for (const f of sources) {
  if (f.rel === READER) continue;
  for (const m of f.code.matchAll(DECIDES)) {
    const value = m[2].trim();
    if (value === `read.${m[1]}`) continue; // carrying the reader's answer through
    fail(
      `${f.rel} spells \`${m[1]}: ${value}\` — an access decision outside ${READER}. A carrier may only render ` +
        `\`${m[1]}: read.${m[1]}\`; anything else is a second reader wearing the reader's vocabulary.`,
    );
  }
}
const grantsCalls = (readerSrc.code.match(/\bgrantsAccess\s*\(/g) ?? []).length;
const definesGrants = /\bfunction\s+grantsAccess\s*\(/.test(readerSrc.code);
// The definition is one match; both branches of the union are two more.
if (!definesGrants || grantsCalls < 3) {
  fail(
    `${READER} defines grantsAccess=${definesGrants} and reaches it ${Math.max(0, grantsCalls - 1)} time(s); the union ` +
      'needs the per-app branch AND the bundle branch to pass through the ONE decision function.',
  );
}
if (!/\bis_pro\s*:\s*appPro\s*\|\|\s*bundlePro\b/.test(readerSrc.code)) {
  fail(`${READER} no longer computes \`is_pro: appPro || bundlePro\` — the union is not a union.`);
}
if (problems.length === 0) ok(`only ${READER} decides; both branches pass through grantsAccess`);

// ── LIMB 3 · EVERY CARRIER MOUNTS IT ────────────────────────────────────────
const carriers = sources.filter((f) => /^services\/[^/]+\/src\/routes\/entitlements\.ts$/.test(f.rel));
if (carriers.length < 2) {
  coverageLost(
    `${carriers.length} carrier(s) matched services/*/src/routes/entitlements.ts; two Workers serve the route ` +
      'today, so fewer than two means the walk stopped reaching them.',
  );
}
for (const c of carriers) {
  const imports = READER_SPECIFIER.test(c.code);
  // A CALL is `readProductEntitlement(` on a line that is not an import line.
  // The import itself is multi-line (`{ type …, readProductEntitlement, }`) and
  // carries no `(`, so it cannot be mistaken for one.
  const callRe = new RegExp(`\\b${READ_FN}\\s*\\(`);
  const calls = c.code.split('\n').some((l) => callRe.test(l) && !/^\s*import\b/.test(l));
  if (!imports) {
    fail(`${c.rel} does not import from ${READER}. This Worker is answering /v1/entitlements from somewhere else.`);
  } else if (!calls) {
    fail(`${c.rel} imports the reader and never CALLS ${READ_FN}(). An import is not a mount.`);
  }
}
if (problems.length === 0) ok(`${carriers.length} carrier(s) import and call ${READ_FN}: ${carriers.map((c) => c.rel).join(', ')}`);

done();
