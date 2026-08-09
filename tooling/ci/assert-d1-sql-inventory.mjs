#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-d1-sql-inventory.mjs — NO STATEMENT THIS REPOSITORY SENDS TO D1 IS ONE
// D1's AUTHORIZER REFUSES TO RUN. The secretless half; the live half is
// tooling/ops/check-d1-accepts-live-sql.mjs.
//
// ── THE DEFECT, AND WHY EVERY EXISTING CHECK WAS GREEN THROUGH IT ───────────
// 🔴 EVERY IN-APP ACCOUNT DELETION IN PRODUCTION FAILED FROM THE DAY THE ROUTES
// SHIPPED UNTIL 2026-08-09. Both erasure routes derived their table set from
// `FROM sqlite_master m JOIN pragma_table_info(m.name) p`. D1 rejects that
// statement at RUNTIME — 7500 `not authorized: SQLITE_AUTH` — so the derivation
// threw before a row was read and the route answered 503
// `account_deletion_failed`. Nothing in this repository could see it:
//
//   · the unit suite runs real SQL through `node:sqlite`, which has NO D1
//     authorizer and happily accepts the join — verified, not assumed;
//   · assert-erasure-reach.mjs proves the route REACHES every user-owned table
//     by parsing MIGRATION FILES, so a query D1 refuses to execute looks
//     perfectly reachable to it;
//   · the e2e delete leg exercised the same rejected shape from its own
//     verifier, so it failed for the same invisible reason.
//
// The gap was not a missing assertion about the schema. It was that NOTHING IN
// CI HAD EVER EXECUTED A STATEMENT, and a statement's legality is a property of
// the engine, not of the text. This file closes the half that needs no
// credential; the live half closes the half that does.
//
// ── WHAT IS CHECKED ─────────────────────────────────────────────────────────
//   R1 THE MEASURED PROHIBITION, over every source file that can send SQL to
//      these databases: `services/*/src/**` AND `tooling/{e2e,ops,ci,scripts}/**`
//      (the harnesses talk to the SAME production databases over the same HTTP
//      API, and one of them was a second casualty of this exact defect).
//   R2 REQUIRED COVERAGE, BOTH DIRECTIONS. A prohibition over an empty set
//      prints ok. So: every database-owning service must contribute at least one
//      introspective statement; a per-file fingerprint floor names the nine
//      statements this class is actually about; and no service may carry a
//      `.prepare(` whose argument this scan could not read.
//   R3 EVERY INTERPOLATED IDENTIFIER IS CONSTRAINED. D1 cannot bind an
//      identifier, so `DELETE FROM ${table}` is unavoidable — the question is
//      what stops `table` being anything. Four kinds of evidence are accepted,
//      all derived from the file; there is no exemption list.
//   R4 THE CAUSE SENTENCE IS PINNED. The prose that shipped with the fix was
//      WRONG in all three files at once — "a table-valued function whose
//      argument is a COLUMN of another table is not allowed", which the measured
//      VALUES and bound-parameter cases both falsify, and which would have
//      licensed a CTE rewrite that is ALSO rejected. Three copies of one wrong
//      sentence corroborate each other; one constant cannot.
//
// ── THE POSITIVE CONTROL, AND WHY THE SKIP LIST IS NOT AN EXEMPTION ─────────
// The rejected statement has to exist somewhere in the tree — the live half
// sends it as its negative control. It is declared ONCE, in d1-sql-inventory
// .mjs, and R1 skips the files that carry that mechanism, DERIVED by which files
// name that module rather than listed. The skip is then turned into an
// assertion: this guard requires its own detector to FLAG that fixture and to
// CLEAR the four shapes D1 was measured to accept. An over-broad R1 is not a
// safe error — a guard that reddens on `SELECT name FROM pragma_table_info(?)`
// is a guard somebody switches off — so both directions are self-checked before
// a single tree file is read.
//
// Usage:  node tooling/ci/assert-d1-sql-inventory.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  MEASURED_CAUSE,
  REJECTED_FIXTURE,
  holePlaceholder,
  identifierRole,
  inventoryFile,
  inventoryServices,
  normaliseProse,
  sourceFilesUnder,
  violatesD1Authorizer,
} from './d1-sql-inventory.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());

const problems = [];
const notes = [];

const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ─────────────────────────────────────────────────────────────────────────────
// THE DETECTOR'S OWN CONTROLS, BEFORE ANY TREE IS READ.
//
// Both directions, because they fail differently and both failures are silent.
// Under-detection prints ok over the outage. OVER-detection reddens main on
// correct code — and the fix a hurried reader reaches for is deleting the limb,
// which is how this repository has lost checks before. Each of these five has a
// recorded failing input: they are the exact shapes measured against production
// D1 on 2026-08-09.
// ─────────────────────────────────────────────────────────────────────────────
{
  if (!violatesD1Authorizer(REJECTED_FIXTURE)) {
    coverageLost([
      'the prohibition does not flag its own fixture — the statement production D1 was measured to REJECT.',
      'R1 would then range over the tree finding nothing, which is exactly what it looked like on the day',
      'every account deletion in production was failing. The fixture and the detector are one mechanism.',
    ]);
  }
  const mustBeAccepted = [
    ["SELECT name FROM pragma_table_info('subscriptions')", 'a pragma fed a LITERAL'],
    ['SELECT name FROM pragma_table_info(?)', 'a pragma fed a BOUND PARAMETER'],
    [
      "WITH t(name) AS (VALUES ('subscriptions')) SELECT t.name, p.name FROM t JOIN pragma_table_info(t.name) p",
      'a pragma fed a VALUES list',
    ],
    ["SELECT name FROM sqlite_master WHERE type = 'table'", 'a plain sqlite_master read'],
  ];
  for (const [sql, what] of mustBeAccepted) {
    if (violatesD1Authorizer(sql)) {
      coverageLost([
        `the prohibition flags ${what}, which production D1 ACCEPTS (measured 2026-08-09).`,
        'A guard that reddens the build on legal SQL gets disabled, and then the illegal shape it was really',
        'about walks back in behind the switch somebody flipped. Over-broad is not the safe direction.',
      ]);
    }
  }
}

// ── the domain ──────────────────────────────────────────────────────────────
const services = inventoryServices(ROOT);
for (const svc of services) {
  if (svc.configError) {
    problems.push(
      `services/${svc.id}/wrangler.jsonc could not be parsed (${svc.configError}), so neither its databases nor ` +
        'its statements could be enumerated and every limb below is unanswerable for that Worker.',
    );
  }
}
const owners = services.filter((s) => s.databases.some((d) => d.owns));
if (owners.length < 2) {
  coverageLost([
    `only ${owners.length} service(s) declare a D1 binding with a \`migrations_dir\` (${owners.map((s) => s.id).join(', ') || 'none'}).`,
    'Expected the shared Worker AND at least one app Worker. Every limb below quantifies over the Workers that',
    'own a database; a domain that has collapsed prints ok over the exact statements this guard exists to read.',
  ]);
}

/** Repo-relative source files that can send SQL to these databases. */
const TOOLING_DIRS = ['tooling/e2e', 'tooling/ops', 'tooling/ci', 'tooling/scripts'];
const toolingFiles = TOOLING_DIRS.flatMap((d) => sourceFilesUnder(ROOT, d));
if (toolingFiles.length === 0) {
  coverageLost([
    `not one source file was found under ${TOOLING_DIRS.join(', ')}.`,
    'The e2e purge, the erasure verifier, the provenance reader and the provisioner all send SQL to the SAME',
    'production databases the Workers do, and one of them shipped the rejected join too. A walk that finds',
    'none of them is a walk that has stopped reaching the second half of the domain.',
  ]);
}

/**
 * THE SKIP SET, DERIVED. A file that IMPORTS the inventory module is part of
 * this mechanism — it carries the fixture on purpose. Nothing is listed by hand,
 * the set is printed on every run, and the fixture itself is asserted above
 * rather than trusted.
 *
 * 🔴 IT IS THE COMMENT-STRIPPED CODE THAT IS ASKED, AND THE FIRST VERSION ASKED
 * THE RAW SOURCE. Correcting the cause paragraph in both erasure routes made
 * them mention this module BY NAME in prose — and both routes silently dropped
 * out of R1, taking six of the nine fingerprints with them. The floor caught it
 * (that is what a floor naming WHICH statements is for; a count would not have),
 * but the lesson is the older one: a rule that reads comments lets prose decide
 * what gets checked.
 */
const MECHANISM = 'd1-sql-inventory.mjs';
const skipped = [];
const isMechanism = (rel, code) => rel.endsWith(`/${MECHANISM}`) || code.includes(MECHANISM);

// ─────────────────────────────────────────────────────────────────────────────
// R1 · THE MEASURED PROHIBITION
// ─────────────────────────────────────────────────────────────────────────────
/** rel → { statements, unparsed, code } for every file in the domain. */
const scanned = new Map();
const readInto = (rel) => {
  const abs = join(ROOT, ...rel.split('/'));
  if (!existsSync(abs)) return;
  const inv = inventoryFile(rel, readFileSync(abs, 'utf8'));
  if (isMechanism(rel, inv.code)) {
    skipped.push(rel);
    return;
  }
  scanned.set(rel, inv);
};
for (const svc of services) for (const rel of svc.files) readInto(rel);
for (const rel of toolingFiles) readInto(rel);

if (skipped.length === 0) {
  coverageLost([
    `no file in the domain names \`${MECHANISM}\`, so the negative-control fixture lives nowhere this scan can see.`,
    'Either the module was renamed on one side only, or the live half no longer sends a statement it KNOWS is',
    'refused — and a live check with no negative control cannot distinguish a healthy authorizer from an',
    'endpoint that stopped judging anything.',
  ]);
}

let statementsRead = 0;
for (const [rel, inv] of scanned) {
  statementsRead += inv.statements.length;
  for (const st of inv.statements) {
    if (!st.violates) continue;
    problems.push(
      `[R1] ${rel}:${st.line} sends a statement D1 REFUSES TO RUN: it names sqlite_master/sqlite_schema AND ` +
        `calls a pragma_* table-valued function in one statement — \`${st.sql.replace(/\s+/g, ' ').slice(0, 110)}\`. ` +
        'Measured 2026-08-09 against both production databases: 7500 `not authorized: SQLITE_AUTH`, for the join, ' +
        'the subquery, the CTE and the correlated scalar subquery alike. Ask the schema in TWO steps — read ' +
        'sqlite_master, then call the pragma per table with a literal or a bound argument. This exact statement ' +
        'made every in-app account deletion fail in production, silently, for months.',
    );
  }
}
if (statementsRead === 0) {
  coverageLost([
    `${scanned.size} file(s) were read across the domain and NOT ONE SQL statement was found in them.`,
    'The literal walk stopped matching. R1 then holds vacuously over a repository whose Workers are nothing but',
    'D1 queries — zero is a broken scan, not a codebase without SQL.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// R2 · REQUIRED COVERAGE, BOTH DIRECTIONS
// ─────────────────────────────────────────────────────────────────────────────
// (i) every Worker that OWNS a database asks that database about its own schema.
// The erasure routes derive their DELETE targets from the schema by design — a
// service that owns a database and introspects it nowhere has either lost that
// derivation (back to a hand list, the failure the routes' own headers argue
// against) or moved it somewhere this scan no longer reads.
for (const svc of owners) {
  const introspective = svc.statements.filter((s) => s.kind === 'introspective');
  if (introspective.length === 0) {
    problems.push(
      `[R2 i] services/${svc.id} owns ${svc.databases.filter((d) => d.owns).map((d) => d.name).join(', ')} and not one of its ` +
        `${svc.statements.length} statement(s) asks the database about its own schema. The live half has nothing to ` +
        'execute for it, so THAT check goes green over this service too — the two halves fail open together.',
    );
  }
  // (iii) …and no statement is hidden behind a call this scan cannot read.
  if (svc.unparsed.length > 0) {
    for (const u of svc.unparsed) {
      problems.push(
        `[R2 iii] services/${svc.id} — ${u.file}:${u.line} calls \`.${u.method}(\` and ${u.why}, so the statement it ` +
          'sends is invisible to both halves of this check. A `.prepare` moved behind a helper does not make the ' +
          'SQL safer; it makes the scan smaller while every count still looks healthy.',
      );
    }
  }
  if (svc.files.length === 0) {
    problems.push(
      `[R2 iii] services/${svc.id} owns a database and this scan read ZERO source files under its src/. Every ` +
        'statement it sends is outside the domain.',
    );
  }
}

// (ii) THE FINGERPRINT FLOOR — the nine statements this class is about, named
// per file. A count would drift with any refactor; these say WHICH. Deleting the
// subly-api pragma step (the mutation that re-creates half the outage) removes a
// row here even though the service still has a statement, which a count cannot
// see.
const FINGERPRINTS = [
  ['services/platform/src/routes/account.ts', 'introspective', /FROM sqlite_master/i, 'the shared erasure route lists the tables'],
  ['services/platform/src/routes/account.ts', 'introspective', /pragma_table_info\(/i, 'the shared erasure route asks each table for its columns'],
  ['services/platform/src/routes/account.ts', 'dynamic-identifier', /^DELETE FROM /i, 'the shared erasure route empties a user-owned table'],
  ['services/platform/src/routes/account.ts', 'dynamic-identifier', /^UPDATE .* SET /i, 'the shared erasure route unlinks a *_user_id reference'],
  ['services/subly-api/src/routes/account.ts', 'introspective', /FROM sqlite_master/i, "Subly's erasure route lists the tables"],
  ['services/subly-api/src/routes/account.ts', 'introspective', /pragma_table_info\(/i, "Subly's erasure route asks each table for its columns"],
  ['services/subly-api/src/routes/account.ts', 'dynamic-identifier', /^DELETE FROM /i, "Subly's erasure route empties a user-owned table"],
  ['services/subly-api/src/routes/account.ts', 'dynamic-identifier', /^UPDATE .* SET /i, "Subly's erasure route unlinks a *_user_id reference"],
  ['services/subly-api/src/routes/subscriptions.ts', 'dynamic-identifier', /^UPDATE subscriptions SET /i, 'the allowlisted-column subscription PATCH'],
];
for (const [file, kind, pattern, what] of FINGERPRINTS) {
  const inv = scanned.get(file);
  if (!inv) {
    problems.push(
      `[R2 ii] ${file} is not in this scan at all, and it carries ${what}. Either the file moved and this floor ` +
        'did not follow it, or the walk stopped reaching it — and a floor that silently loses a row is the ' +
        'guard-that-stopped-guarding shape this whole file is written against.',
    );
    continue;
  }
  if (!inv.statements.some((s) => s.kind === kind && pattern.test(s.sql))) {
    problems.push(
      `[R2 ii] ${file} no longer carries a \`${kind}\` statement matching ${pattern} — ${what}. If it was ` +
        'deliberately removed, remove its line from FINGERPRINTS in the same change and say why; if it was not, ' +
        'this scan has stopped seeing a statement that is still there.',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// R3 · EVERY INTERPOLATED IDENTIFIER IS CONSTRAINED
//
// D1 cannot bind an identifier, so `DELETE FROM ${table}` is the only spelling
// available and forbidding it would be forbidding the feature. The question is
// what stops the hole being anything, and FOUR kinds of evidence are accepted —
// each derived from the file, none listed:
//
//   (a) the file applies the identifier regex `[A-Za-z_][A-Za-z0-9_$]*`;
//   (b) it declares a closed string-literal union type the column comes from;
//   (c) the hole's root symbol is bound from an inline array of string literals;
//   (d) the hole sits inside SQL identifier quotes in the statement itself.
//
// ⚠️ WHAT THIS IS NOT: dataflow. It cannot prove the regex is applied to THIS
// value, and it does not claim to. What it CAN prove, and what no reviewer
// reliably does, is that a file which interpolates identifiers into SQL and
// carries no identifier discipline at all fails the build. Deleting either
// filter from an erasure route, or widening subscriptions.ts's `Column` union to
// `string`, reddens this limb — both are recorded failing cases.
// ─────────────────────────────────────────────────────────────────────────────
const IDENTIFIER_REGEX_TEXT = '[A-Za-z_][A-Za-z0-9_$]*';
const CLOSED_UNION = /\btype\s+[A-Za-z_$][\w$]*\s*=\s*\|?\s*'[^'\n]*'(?:\s*\|\s*'[^'\n]*')+/;
const literalArrayFor = (sym) =>
  new RegExp(
    `\\b(?:for\\s*\\(\\s*(?:const|let|var)\\s+${sym}\\s+of|(?:const|let|var)\\s+${sym}\\s*=)\\s*\\[\\s*'[^'\\n]*'(?:\\s*,\\s*'[^'\\n]*')+`,
  );
const rootSymbol = (expr) => /^([A-Za-z_$][\w$]*)/.exec(String(expr))?.[1] ?? null;
const quotedHole = (sql, i) => {
  const at = sql.indexOf(holePlaceholder(i));
  if (at <= 0) return false;
  return /["`[]$/.test(sql.slice(0, at)) && /^["`\]]/.test(sql.slice(at + holePlaceholder(i).length));
};

let constrained = 0;
for (const [rel, inv] of scanned) {
  // A test fixture is INPUT to a guard, not a statement this repository sends to
  // a database. Derived from the path, counted, and printed — not a list.
  if (rel.includes('/test/')) continue;
  for (const st of inv.statements) {
    if (st.kind !== 'dynamic-identifier') continue;
    const evidence = [];
    if (inv.code.includes(IDENTIFIER_REGEX_TEXT)) evidence.push('the identifier regex is applied in this file');
    if (CLOSED_UNION.test(inv.code)) evidence.push('the file declares a closed string-literal union');
    st.holes.forEach((expr, i) => {
      const sym = rootSymbol(expr);
      if (sym && literalArrayFor(sym).test(inv.code)) evidence.push(`\`${sym}\` is bound from an inline literal array`);
      if (quotedHole(st.sql, i)) evidence.push(`hole ${i} sits inside SQL identifier quotes`);
    });
    if (evidence.length === 0) {
      problems.push(
        `[R3] ${rel}:${st.line} interpolates ${st.holes.length} identifier(s) into SQL — ` +
          `\`${st.sql.replace(/\s+/g, ' ').slice(0, 100)}\` (${st.holes.map((h) => `\${${h}}`).join(', ')}) — and nothing ` +
          'in the file constrains them: no identifier regex, no closed union, no inline literal set, and the holes ' +
          'are not identifier-quoted in the statement. D1 cannot bind an identifier, so this string is built by hand ' +
          'every time; a schema is not a trust boundary anybody audits.',
      );
      continue;
    }
    constrained++;
    const roles = st.holes.map((h, i) => `${identifierRole(st.sql, i) ?? 'unclassified'}:${h}`).join(', ');
    notes.push(`⬜ [R3] ${rel}:${st.line} — ${roles} — ${[...new Set(evidence)].join('; ')}`);
  }
}
if (constrained === 0 && problems.length === 0) {
  coverageLost([
    'not one dynamic-identifier statement was found anywhere in the domain.',
    'Both erasure routes build their DELETE and UPDATE targets by interpolation because D1 cannot bind an',
    'identifier. Zero means the classification stopped working, and R3 then passes over every hand-built',
    'statement in the tree.',
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// R4 · THE CAUSE SENTENCE IS PINNED WHERE IT IS EXPLAINED
//
// 🔴 THE SENTENCE THAT SHIPPED WITH THE FIX WAS WRONG IN ALL THREE FILES AT
// ONCE: "a table-valued function whose argument is a COLUMN of another table is
// not allowed". Production D1 accepts a pragma fed a VALUES list and a pragma
// fed a bound parameter, and REJECTS the CTE rewrite — so the sentence both
// over-describes the rule and points the next reader at a "fix" that is also
// refused. Three copies of one wrong sentence look like three sources agreeing.
// Compared on a normalised reduction, so each file may wrap it to its own width.
// ─────────────────────────────────────────────────────────────────────────────
const CAUSE_SITES = [
  'services/platform/src/routes/account.ts',
  'services/subly-api/src/routes/account.ts',
  'tooling/e2e/verify_purged.mjs',
];
const wanted = normaliseProse(MEASURED_CAUSE);
for (const rel of CAUSE_SITES) {
  const abs = join(ROOT, ...rel.split('/'));
  if (!existsSync(abs)) {
    problems.push(`[R4] ${rel} does not exist, and it is one of the three places this rejection is explained to a reader.`);
    continue;
  }
  // RAW, not comment-stripped: the subject here IS the comment.
  if (!normaliseProse(readFileSync(abs, 'utf8')).includes(wanted)) {
    problems.push(
      `[R4] ${rel} does not carry the measured cause sentence. It is the one place a reader learns WHY the schema ` +
        'is asked in two steps, and the version that shipped was falsified by the same run that measured the ' +
        'rejection. Paste it from `MEASURED_CAUSE` in tooling/ci/d1-sql-inventory.mjs (re-wrap freely — the ' +
        'comparison normalises whitespace and comment markers):\n' +
        `          ${MEASURED_CAUSE}`,
    );
  }
}

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ d1 sql inventory — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  A statement D1 refuses to run is not a bug the type checker, the unit suite or any guard that');
  console.error('  reads migrations can see — the local engine has no authorizer and the text looks fine. This is');
  console.error('  the half that needs no credential; tooling/ops/check-d1-accepts-live-sql.mjs executes them.');
  console.error('  [pipeline K-7] · [ADR 027]');
  process.exit(1);
}

for (const n of notes) console.log(n);
console.log(
  `ok  d1 sql inventory — ${statementsRead} statement(s) across ${scanned.size} file(s) in ${services.length} service(s) ` +
    `and ${TOOLING_DIRS.length} tooling director(ies); none names sqlite_master and calls a pragma_* function in one ` +
    'statement (the shape production D1 answers 7500 SQLITE_AUTH to)',
);
console.log(
  `    ${owners.length} database-owning service(s) each introspect their own schema, all ${FINGERPRINTS.length} named ` +
    `statements are still where they were, and no \`.prepare(\` in any service hides a statement from this scan`,
);
console.log(
  `    ${constrained} interpolated-identifier statement(s) sit in a file that constrains the identifier, and the ` +
    `cause sentence is pinned in all ${CAUSE_SITES.length} places it is explained`,
);
console.log(
  `    ⬜ ${skipped.length} file(s) carry the negative-control fixture and are outside R1 by derivation ` +
    `(they name ${MECHANISM}): ${skipped.join(', ')}`,
);
