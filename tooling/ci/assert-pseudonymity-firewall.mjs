#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-pseudonymity-firewall.mjs — [pipeline 5]M-16.
// "Measure revenue without ever joining the paid id to the pseudonymous one."
//
// ── WHY THIS IS A ONE-WAY DOOR ──────────────────────────────────────────────
// [ADR 020]:21 — never create a `(user_id, anon_id)` mapping. The obvious way to
// answer "which cohort paid?" is exactly that join, and performing it ONCE
// retroactively reclassifies the ENTIRE analytics store as personal data subject
// to DPDP erasure, for every app in the portfolio, forever. Deleting the join
// afterwards does not undo it: the events were linkable at the moment they were
// stored, and that is the fact a regulator asks about.
//
// ⚠️ THE DDL LIMB WILL SOON BE UNABLE TO CATCH THE REAL RISK. `events` is decided
// to move to its own D1, which makes a cross-database join impossible in SQL and
// moves the whole risk into APPLICATION code and into any KV or in-memory map
// that pairs the two ids. So this scans for the PAIRING — in code as well as in
// DDL — rather than for a join.
//
// TWO PARTS:
//   A · THE FOUR EVENTS HAVE REAL CALLERS, resolved BY SYMBOL, never by path.
//       `analytics_funnel.dart` is scheduled to move out of apps/subly under
//       [2]C-3, and a path-hardcoded guard passes trivially the day it moves.
//   B · NOTHING PAIRS THE TWO IDS, in Dart, in TypeScript, or in SQL.
//
// Usage:  node tooling/ci/assert-pseudonymity-firewall.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const problems = [];
const ok = (m) => console.log(`ok   ${m}`);

const SKIP_DIR = new Set(['build', '.dart_tool', 'node_modules', 'dist', '.wrangler']);
const SKIP_PATH = [join('apps', 'probe')];

function walk(dir, exts, out = []) {
  let entries;
  try {
    entries = listDir(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (!SKIP_DIR.has(e)) walk(p, exts, out);
    } else if (exts.some((x) => e.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

const rel = (f) => f.replace(ROOT + sep, '').replaceAll('\\', '/');

/** COMMENTS ONLY — this repo has shipped a guard that matched the comment
 *  explaining why the thing it looked for was absent. */
const noComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** Comments AND string literals stripped. Used for part A, where the subject is
 *  a CALL SITE and a symbol named inside a string is prose. */
const code = (s) =>
  noComments(s)
    .replace(/r?'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/r?"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

/**
 * Comments stripped; string literals KEPT unless they are PROSE. Used for part B.
 *
 * 🔴 STRIPPING STRINGS MADE THE PAIRING SCAN BLIND TO THE MOST LIKELY PAIRING
 * THERE IS. Mutation-proven on the real tree: a provider returning
 * `<String, String>{'user_id': u, 'anon_id': a}` — a map keyed by the two ids,
 * which is precisely the [ADR 020]:21 violation — passed cleanly, because both
 * keys had been blanked before the matcher ran. So had a KV key, a request body,
 * and every column name in a `CREATE TABLE`. Part B's subject is IDENTIFIERS AND
 * KEYS, and in Dart, TypeScript and SQL alike those are frequently strings.
 *
 * 🔴 AND KEEPING THEM ALL FIRED ON A TEST TITLE. `services/platform/test/auth.test.ts`
 * names a test *"they have NO user_id, by design"* in the same `it(...)` call as
 * an `INSERT … anon_id …`, and the two are unrelated — the title is an argument
 * ABOUT the separation. So a literal that reads as a SENTENCE is blanked and one
 * that reads as a key, a column or a query is kept: five or more words with no
 * SQL verb in sight is prose, and prose is not a pairing.
 */
// Five or more whitespace runs is a sentence; a key, a column name and a KV
// path have none. Counted rather than pattern-matched: the first attempt used a
// token class that excluded backticks, and the very title that motivated this —
// "leaves `events` … NO user_id, by design" — slipped through because its
// backticked words broke the token run.
const isSentence = (lit) => (lit.match(/\s/g) ?? []).length >= 5;
// Anything that smells of a query is KEPT, spaces or not: `'user_id = ? AND
// anon_id = ?'` is a real pairing living in a WHERE clause, and it is a sentence
// by the count above.
// ⚠️ THE VERBS ARE CASE-INSENSITIVE AND THE OPERATORS ARE NOT, and the split is
// not fussiness: adding `AND` to the case-INSENSITIVE list made every English
// sentence containing the word "and" count as SQL, which is most of them — the
// test title this rule exists for was kept again, one round later.
const SQL_VERB =
  /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|FROM|WHERE|VALUES|TABLE|INDEX|JOIN)\b/i;
const SQL_OP = /\bAND\b|\bOR\b|=\s*\?/;
const blankProse = (lit) =>
  isSentence(lit) && !SQL_VERB.test(lit) && !SQL_OP.test(lit) ? "''" : lit;

const codeWithStrings = (s, isSql = false) =>
  (isSql ? s.replace(/^\s*--.*$/gm, '') : noComments(s))
    .replace(/r?'(?:[^'\\\n]|\\.)*'/g, blankProse)
    .replace(/r?"(?:[^"\\\n]|\\.)*"/g, blankProse)
    .replace(/`(?:[^`\\]|\\.)*`/g, blankProse);

// ═══════════════════════════════════════════════════════════════════════════
// A · THE FOUR EVENTS, BY SYMBOL
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 REQUIRED_COVERAGE names all four. Four methods with zero callers is the
// state this replaces: the analytics rail emitted launch, activation and
// notification opens — everything except the money.
const REQUIRED_EVENTS = [
  { symbol: 'onPaywallViewed', what: "the funnel's DENOMINATOR" },
  { symbol: 'onCheckoutStarted', what: 'intent to pay' },
  { symbol: 'onPurchaseSuccess', what: 'the SERVER-confirmed unlock' },
  { symbol: 'onPurchaseFailed', what: 'every refusal, with an enumerable reason' },
];

const dartFiles = ['apps', 'packages', 'tooling/bricks']
  .flatMap((r) => walk(join(ROOT, r), ['.dart']))
  .filter((f) => !SKIP_PATH.some((s) => f.startsWith(join(ROOT, s) + sep)));

const MIN_DART = 40;
if (dartFiles.length < MIN_DART) {
  problems.push(
    `COVERAGE LOST — scanned only ${dartFiles.length} dart file(s), expected >= ${MIN_DART}. Every clean result below would come from a scan that reaches nothing.`,
  );
} else {
  ok(`scan reaches ${dartFiles.length} dart file(s)`);
}

const bodies = new Map(dartFiles.map((f) => [f, code(readFileSync(f, 'utf8'))]));

for (const ev of REQUIRED_EVENTS) {
  // A CALL through a receiver — `x.onPaywallViewed(` — never a bare name and
  // never a declaration. `Future<void> onPaywallViewed(String t) =>` matches
  // `onPaywallViewed\s*\(` perfectly well, which is how "does anything call
  // this?" checks come to pass with every real caller deleted.
  const call = new RegExp(String.raw`\.\s*${ev.symbol}\s*\(`);
  const declares = new RegExp(String.raw`Future<void>\s+${ev.symbol}\s*\(`);
  const callers = [...bodies]
    .filter(([, src]) => call.test(src) && !declares.test(src))
    .map(([f]) => rel(f))
    // A caller inside a test is exactly the state this guard rejects.
    .filter((r) => !/(^|\/)(test|integration_test)\//.test(r));

  if (callers.length === 0) {
    problems.push(
      `\`${ev.symbol}\` has NO non-test caller anywhere (${ev.what}). Four methods with zero callers is the state [5]M-16 was written about: the analytics rail measured everything except the money.`,
    );
  } else {
    ok(`${ev.symbol} — called from ${callers[0]}${callers.length > 1 ? ` (+${callers.length - 1} more)` : ''}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// B · NOTHING PAIRS THE PAID ID WITH THE PSEUDONYMOUS ONE
// ═══════════════════════════════════════════════════════════════════════════
// The pairing, not the join: an in-memory map, a KV key, a request body or a
// table row that carries both is the same one-way door as a SQL join.
const ID_PAID = /\b(?:user_?[Ii]d|userId|sub_claim|account_?[Ii]d|accountId)\b/;
const ID_PSEUDO = /\b(?:anon_?[Ii]d|anonId|install_?[Ii]d|installId|device_?[Ii]d|deviceId)\b/;

/**
 * The INNERMOST BALANCED BLOCK around [i] — the map literal, the argument list,
 * the `CREATE TABLE (…)`, the interface body.
 *
 * 🔴 A CHARACTER WINDOW IS THE WRONG UNIT, and the first version of this guard
 * used one. A ±400-char window fired on `services/platform/src/types.ts`, where
 * `interface ConsentArtifact { anon_id }` and `interface Subscription { user_id }`
 * are two unrelated declarations that happen to sit near each other in a shared
 * types file. They pair nothing. A guard that cries wolf on the tree's most
 *-edited file is a guard somebody deletes.
 *
 * The block is the unit that actually means "these two travel together": a
 * literal, a bound tuple, a table definition, a function's parameters.
 */
function innermostBlock(src, i) {
  const OPEN = { '}': '{', ')': '(', ']': '[' };
  const CLOSE = { '{': '}', '(': ')', '[': ']' };
  let depth = 0;
  let start = -1;
  let opener = '';
  for (let k = i - 1; k >= 0; k--) {
    const c = src[k];
    if (OPEN[c]) depth++;
    else if (CLOSE[c]) {
      if (depth === 0) {
        start = k;
        opener = c;
        break;
      }
      depth--;
    }
  }
  if (start === -1) return null;
  depth = 0;
  for (let k = start + 1; k < src.length; k++) {
    const c = src[k];
    if (c === opener) depth++;
    else if (c === CLOSE[opener]) {
      if (depth === 0) return src.slice(start + 1, k);
      depth--;
    }
  }
  return src.slice(start + 1);
}

function pairingsIn(src) {
  const out = [];
  let m;
  const paid = new RegExp(ID_PAID.source, 'g');
  while ((m = paid.exec(src)) !== null) {
    const block = innermostBlock(src, m.index);
    if (block === null) continue;
    const p = block.match(ID_PSEUDO);
    if (p) out.push(`${m[0]} beside ${p[0]}`);
  }
  return out;
}

const srcFiles = [
  ...dartFiles,
  ...walk(join(ROOT, 'services'), ['.ts']),
  ...walk(join(ROOT, 'services'), ['.sql']),
];
const MIN_SRC = 80;
if (srcFiles.length < MIN_SRC) {
  problems.push(
    `COVERAGE LOST — the pairing scan reaches only ${srcFiles.length} file(s), expected >= ${MIN_SRC}. It must cover Dart, the Workers' TypeScript AND their migrations: the events store is moving to its own D1, so the risk is migrating out of SQL and into application code.`,
  );
} else {
  ok(`pairing scan reaches ${srcFiles.length} dart/ts/sql file(s)`);
}

// 🔴 THE MATCHER IS PROVEN AGAINST A CONSTRUCTED PAIRING BEFORE IT IS TRUSTED.
// The tree is (correctly) clean, so a clean result and a broken regex are
// indistinguishable without this.
{
  const CANARY = [
    "const row = { user_id: u, anon_id: a };",
    "db.prepare('INSERT INTO paid_cohort (userId, anonId) VALUES (?,?)')",
    'CREATE TABLE cohort (user_id TEXT, anon_id TEXT);',
    'await kv.write(userId, installId);',
  ];
  const CLEAN = [
    'const row = { user_id: u, app_id: a };',
    'CREATE TABLE events (anon_id TEXT, event TEXT);',
    'final String anonId = await ref.read(installIdProvider.future);',
    // The real false positive that made `blankProse` necessary: a test title
    // ARGUING for the separation, in the same call as an unrelated insert.
    "it('leaves `events` and `consent_artifacts` alone — they have NO user_id, by design', () => {\n" +
      '  db.prepare(`INSERT INTO events (anon_id, event) VALUES (?,?)`);\n});',
  ];
  // …and the one that must STILL fire despite reading like a sentence: a real
  // pairing in a WHERE clause. Without this the prose rule is a hole.
  CANARY.push("db.prepare('DELETE FROM x WHERE user_id = ? AND anon_id = ?')");
  const missed = CANARY.filter((c) => pairingsIn(codeWithStrings(c)).length === 0);
  const fp = CLEAN.filter((c) => pairingsIn(codeWithStrings(c)).length > 0);
  if (missed.length) {
    problems.push(
      `COVERAGE LOST — the pairing matcher no longer sees ${missed.length} constructed pairing(s), e.g. ${JSON.stringify(missed[0])}. The tree is clean; without this canary a broken matcher and a clean tree print identically.`,
    );
  } else if (fp.length) {
    problems.push(`the pairing matcher fires on ${JSON.stringify(fp[0])}, which pairs nothing.`);
  } else {
    ok(`pairing matcher verified: ${CANARY.length} constructed pairing(s) seen, ${CLEAN.length} clean sample(s) ignored`);
  }
}

// ⚠️ EMPTY, AND DELIBERATELY SO. The block-scoped matcher above needs no
// exemptions against the tree as it stands: the erasure route names `user_id`
// while operating on a schema that also holds `anon_id` tables, and the shared
// types file declares both kinds of interface — neither is a pairing, and
// neither now fires. An exemption for a file that no longer trips the guard is
// worse than none: it inflates apparent coverage and it hides the day the file
// starts tripping it for real. Add an entry only with a reason that survives
// being read aloud.
const PAIRING_EXEMPT = new Map([]);

const pairings = [];
for (const f of srcFiles) {
  const r = rel(f);
  const src = codeWithStrings(readFileSync(f, 'utf8'), r.endsWith('.sql'));
  const hits = pairingsIn(src);
  if (hits.length === 0) continue;
  const why = PAIRING_EXEMPT.get(r);
  if (why) {
    console.log(`--   ${r} — exempt: ${why}`);
    continue;
  }
  pairings.push({ file: r, hits });
}

for (const p of pairings) {
  problems.push(
    `\`${p.file}\` places a PAID identifier beside a PSEUDONYMOUS one (${p.hits[0]}). [ADR 020]:21 — creating that mapping once retroactively reclassifies the whole analytics store as personal data subject to DPDP erasure, for every app, forever, and deleting the pairing afterwards does not undo it.`,
  );
}
if (pairings.length === 0) ok('no paid/pseudonymous identifier pairing in dart, ts or sql');

// The funnel itself must have no way to carry an identity. An API with no such
// parameter is stronger than a rule about not passing one.
{
  const FUNNEL = 'packages/purchases/lib/src/money_funnel.dart';
  const p = join(ROOT, FUNNEL);
  if (!existsSync(p)) {
    problems.push(`COVERAGE LOST — ${FUNNEL} is missing, so part A resolved four symbols that belong to nothing.`);
  } else {
    const src = code(readFileSync(p, 'utf8'));
    const bad = ['userId', 'user_id', 'anonId', 'email'].filter((t) => src.includes(t));
    if (bad.length) {
      problems.push(
        `${FUNNEL} mentions ${bad.join(', ')} in code. The money funnel must have NO identity parameter to forget to leave out — that is what makes the firewall a property of the API rather than of everyone's memory.`,
      );
    } else {
      ok('the money funnel has no identity parameter at all');
    }
  }
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-pseudonymity-firewall: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-pseudonymity-firewall: ok');
}
