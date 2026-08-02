#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-analytics-contract.mjs — [pipeline E-1 · E-2 · E-3]
//
// ONE analytics envelope serves every app, and it is written down in FOUR
// places that cannot import each other:
//
//   the DDL          services/platform/migrations/*.sql        (what D1 stores)
//   the route        services/platform/src/routes/events.ts    (what the edge writes)
//   the client event packages/core/lib/src/analytics/analytics.dart
//   the client wire  packages/api_client/lib/src/dio_event_transport.dart
//                    + the per-app `envelope:` literals
//
// WHY THIS GUARD EXISTS. E-1's acceptance — "one locked taxonomy and envelope
// serves every app" — could not fail. `services/platform/test/events.test.ts`
// posts ONE fixture batch through the route and asserts the response; nothing
// in the tree ever compared the three sets. A column added to the DDL that no
// route writes, a column dropped from the route's INSERT that the DDL still
// declares NOT NULL, or a client that stops sending `consent_id` are all
// silent: the fixture keeps passing because the fixture only carries the fields
// somebody remembered to put in it. The one place this parity IS already
// enforced is `services/platform/test/analytics-contract.test.ts`, which reads
// the Dart source with `?raw` and pins two integer caps across the language
// boundary. This is that idea applied to the envelope instead of to 2 constants.
//
// 🔴 EVERYTHING HERE PARSES STRUCTURE. Nothing greps prose, and that is not
// stylistic: this exact subject has already fooled two text scans in this repo.
// `services/platform/test/events.test.ts:141` and `:663` assert "no ip column"
// by searching the INSERT **string** for `ip` — which can only ever describe
// what the route happens to write today, and says nothing at all about what the
// schema declares. A migration adding `ip TEXT` to `events` passes both. And
// `assert-policy-claims.mjs`'s first draft failed on the COMMENT that says
// CF-Connecting-IP is never read. So: comments blanked via the shared
// `text-reductions.mjs` reductions, string literals blanked for SQL, columns
// read out of balanced parens rather than off a regex over a line.
//
// FOUR LIMBS
//   1 · COLUMN PARITY. The column set the migrations declare for `events` and
//       `consent_artifacts` must EQUAL the column set the route's INSERT names,
//       in both directions, plus the placeholder/bind-argument arity of each
//       statement. A column in the DDL nobody writes is dead storage; a column
//       in the INSERT the DDL lacks is a 500 on the shared database.
//   2 · CLIENT COVERAGE. Every key the Dart client puts on the wire must be a
//       real column, and every column the schema REQUIRES (NOT NULL with no
//       DEFAULT) must be supplied by the client — except the four the edge
//       writes on the client's behalf, which are allowlisted HERE rather than
//       fixed in the schema, so nobody "repairs" the asymmetry by making the
//       client send its own `server_ts` or its own `country`.
//   3 · NO IP COLUMN, FROM THE DDL. The one limb the two string-grep
//       assertions structurally cannot make. `events` and `consent_artifacts`
//       are pseudonymous by construction ([ADR 011], [ADR 020]); a network
//       address column is the single change that converts them into erasure-
//       subject personal data, and it would arrive as a migration, not as an
//       edit to the route.
//   4 · APPEND-ONLY CONSENT. No `UPDATE` and no `DELETE` targeting
//       `consent_artifacts` ANYWHERE under services/ — code as well as
//       migrations. DPDP §6(3) needs the withdrawal to be able to reference
//       what was consented to, so a withdrawal is a NEW row with granted=0.
//       `check-migrations.mjs` cannot cover this: it reads migrations only, and
//       it exempts any statement carrying a WHERE — correctly, because a
//       filtered backfill is legitimate there. A filtered
//       `DELETE FROM consent_artifacts WHERE consent_id=?` is still not
//       append-only, so this limb grants NO such exemption.
//
// Usage:  node tooling/ci/assert-analytics-contract.mjs [repoRoot]
// Exit 0 = clean, 1 = violation or lost coverage.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const MIGRATIONS_DIR = 'services/platform/migrations';
const ROUTE = 'services/platform/src/routes/events.ts';
const SERVICES = 'services';

/** The two tables the analytics rail is made of. Written out rather than
 *  discovered: a derived list loses an entry at exactly the moment the table it
 *  names disappears from the scan, which is the failure this guard exists to
 *  catch. */
const TABLES = ['events', 'consent_artifacts'];

/** Columns of `events` the EDGE writes and the client deliberately does not.
 *  Allowlisted here, in the guard, and not "fixed" in the schema: `server_ts` is
 *  the authoritative clock precisely because the client's is untrusted, and
 *  country/region/city come from `request.cf` precisely so that no address ever
 *  reaches us. A client that started supplying them would be undoing both. */
const EDGE_WRITTEN = new Set(['server_ts', 'country', 'region', 'city']);

/** THE COVERAGE FLOOR. These ten names are the client-supplied half of the
 *  `events` envelope — the 14 columns minus the 4 the edge writes. If the client
 *  parse stops yielding one of them, the derivation broke; the client did not
 *  silently become correct. Emptying either Dart source is COVERAGE LOST here
 *  rather than a pass over nothing. */
const REQUIRED_COVERAGE = [
  'event_id', 'app_id', 'anon_id', 'session_id', 'platform',
  'app_version', 'event', 'params', 'client_ts', 'consent_id',
];

/** Dart wire key → column name. Exactly one field is spelled differently on the
 *  two sides, and it is spelled differently ON PURPOSE: `ts` is the client's own
 *  clock and the column says so. Any OTHER disagreement is a bug, which is why
 *  this map has one entry and must stay small enough to read. */
const WIRE_TO_COLUMN = new Map([['ts', 'client_ts']]);

/** Keys the wire literal carries that are structure, not columns. */
const NOT_A_COLUMN = new Set(['events']);

/** Dart sources the client key set is derived from, each with the MARKER that
 *  opens the literal to read. All four are needed for the set to be complete:
 *  the event object carries the per-row fields, the transport carries the batch
 *  fields, and `platform`/`app_version` exist only in the per-app `envelope:`
 *  literal that the transport spreads.
 *
 *  🔴 THE REGION IS NOT DECORATION. The first version of this limb scanned each
 *  WHOLE file for `'key':` and picked up `true` — out of a Dart conditional
 *  expression `cond ? 'true' : 'false'`, where the literal really is followed by
 *  a colon and really is not a map key. It then failed the build saying the
 *  client sends a column called `true`. Reading only the balanced body of the
 *  named literal is what makes "is this a map key" a structural question. */
const CLIENT_SOURCES = [
  {
    file: join('packages', 'core', 'lib', 'src', 'analytics', 'analytics.dart'),
    marker: 'toJson() =>',
    what: 'the per-event fields',
  },
  {
    file: join('packages', 'api_client', 'lib', 'src', 'dio_event_transport.dart'),
    marker: 'data: <String, Object?>',
    what: 'the batch wire literal',
  },
  {
    file: join('apps', 'subly', 'lib', 'state', 'analytics_providers.dart'),
    marker: 'envelope: <String, Object?>',
    what: "the flagship app's per-batch envelope",
  },
  {
    file: join('tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'lib', 'state', 'providers.dart'),
    marker: 'envelope: <String, Object?>',
    what: 'the envelope every future stamped app starts from',
  },
];

/** Column names that are a network address by any spelling. Matched on the NAME
 *  as parsed out of the DDL, never on the file text. */
const IP_NAMED = /(^|_)(ip|ips|ipv4|ipv6|ipaddr|ipaddress|addr)($|_)|ip_address|remote_addr|client_ip|peer_addr/i;

let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => {
  console.error(`✗ COVERAGE LOST — ${m}`);
  process.exit(1);
};

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const has = (rel) => existsSync(join(ROOT, rel));

// ── balanced-delimiter helpers ──────────────────────────────────────────────
// Everything below reads a span between matching delimiters rather than to the
// next `)` or `}` on the line. A column list wraps over 5 lines and a `.bind()`
// argument list contains nested calls; a line-oriented regex reads a prefix of
// either and calls it the whole.

/** The span inside the delimiter pair that OPENS at `from` (which must be the
 *  index of the opening delimiter). Quote- and template-aware, so a `,` or a `)`
 *  inside a string cannot close it early. Returns null when unbalanced. */
function balanced(text, from) {
  const OPEN = { '(': ')', '[': ']', '{': '}' };
  const close = OPEN[text[from]];
  if (!close) return null;
  const stack = [close];
  let quote = null;
  for (let i = from + 1; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (OPEN[ch]) { stack.push(OPEN[ch]); continue; }
    if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return { body: text.slice(from + 1, i), end: i };
    }
  }
  return null;
}

/** Split a delimiter body on its TOP-LEVEL commas — the ones not nested inside
 *  another pair and not inside a string. This is what makes "how many arguments
 *  does `.bind()` take" answerable when the arguments are `str(e?.x, 32)` and
 *  `geo.country ?? null`. */
function splitTopLevel(body) {
  const OPEN = { '(': ')', '[': ']', '{': '}' };
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (OPEN[ch]) { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
    if (ch === ',' && depth === 0) { parts.push(body.slice(start, i)); start = i + 1; }
  }
  const tail = body.slice(start);
  if (tail.trim() !== '') parts.push(tail);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

// ── 0 · the DDL ─────────────────────────────────────────────────────────────
// Every migration under services/platform, not just 0002: an additive schema
// grows by ALTER TABLE … ADD COLUMN, and a guard that read only the file where a
// table was born would call every later column "not in the DDL".

if (!has(MIGRATIONS_DIR)) {
  coverageLost(`${MIGRATIONS_DIR} does not exist, so no schema was read at all.`);
}
const migrationFiles = readdirSync(join(ROOT, MIGRATIONS_DIR))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => join(MIGRATIONS_DIR, f));
if (migrationFiles.length === 0) {
  coverageLost(`no .sql file under ${MIGRATIONS_DIR}; the column parity below would compare the route against an empty schema and pass.`);
}

/** Column definitions per table: name → the raw definition text, which limb 2
 *  reads NOT NULL and DEFAULT off. Constraint clauses (PRIMARY KEY (…), CHECK
 *  (…), FOREIGN KEY …) are skipped — they are not columns. */
const CONSTRAINT_WORD = /^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i;
const ddl = new Map(TABLES.map((t) => [t, new Map()]));

for (const rel of migrationFiles) {
  const sql = stripStringLiterals(stripSourceComments(read(rel), '.sql'));
  // CREATE TABLE — the column list is the balanced paren block after the name.
  for (const m of sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?(\w+)["'`\]]?\s*(?=\()/gi)) {
    const table = m[1];
    if (!ddl.has(table)) continue;
    const span = balanced(sql, m.index + m[0].length);
    if (!span) {
      coverageLost(`${rel}: the CREATE TABLE ${table} column list is unbalanced, so no column could be parsed out of it.`);
    }
    for (const part of splitTopLevel(span.body)) {
      if (CONSTRAINT_WORD.test(part)) continue;
      const name = part.match(/^["'`[]?(\w+)/)?.[1];
      if (name) ddl.get(table).set(name, part);
    }
  }
  // ALTER TABLE … ADD [COLUMN] — an additive schema's second and later columns.
  for (const m of sql.matchAll(/\bALTER\s+TABLE\s+["'`[]?(\w+)["'`\]]?\s+ADD\s+(?:COLUMN\s+)?([^;]*)/gi)) {
    const table = m[1];
    if (!ddl.has(table)) continue;
    const name = m[2].trim().match(/^["'`[]?(\w+)/)?.[1];
    if (name) ddl.get(table).set(name, m[2].trim());
  }
}

for (const t of TABLES) {
  if (ddl.get(t).size === 0) {
    coverageLost(
      `no columns were parsed for \`${t}\` out of ${migrationFiles.length} migration file(s) under ${MIGRATIONS_DIR}. ` +
        'Every limb below quantifies over that column set, so an empty one certifies the route, the client and the ' +
        'privacy invariants all correct against nothing.',
    );
  }
}

// ── 0b · the route's INSERTs ────────────────────────────────────────────────
if (!has(ROUTE)) {
  coverageLost(`${ROUTE} does not exist — the edge half of the contract was not read.`);
}
const routeSrc = stripSourceComments(read(ROUTE), '.ts');

/** For one table: the column names the INSERT names, the count of `?`
 *  placeholders in its VALUES list, and the number of top-level arguments the
 *  `.bind()` that follows it passes. */
function parseInsert(src, table) {
  const re = new RegExp(`\\bINSERT\\s+INTO\\s+["'\`\\[]?${table}["'\`\\]]?\\s*(?=\\()`, 'i');
  const m = re.exec(src);
  if (!m) return null;
  const cols = balanced(src, m.index + m[0].length);
  if (!cols) return null;
  const names = splitTopLevel(cols.body).map((c) => c.replace(/["'`[\]]/g, '').trim());

  const afterCols = src.slice(cols.end + 1);
  const vm = /\bVALUES\s*(?=\()/i.exec(afterCols);
  if (!vm) return null;
  const values = balanced(afterCols, vm.index + vm[0].length);
  if (!values) return null;
  const placeholders = splitTopLevel(values.body).length;

  // The nearest `.bind(` after the statement. A prepare()/bind() pair that has
  // drifted apart is itself worth failing on — this guard would rather say
  // "could not find it" than assume arity is fine.
  const bindIdx = afterCols.indexOf('.bind(');
  let binds = null;
  if (bindIdx !== -1) {
    const args = balanced(afterCols, bindIdx + '.bind'.length);
    if (args) binds = splitTopLevel(args.body).length;
  }
  return { names, placeholders, binds };
}

const inserts = new Map();
for (const t of TABLES) {
  const parsed = parseInsert(routeSrc, t);
  if (!parsed) {
    coverageLost(
      `${ROUTE} has no parseable \`INSERT INTO ${t} (…) VALUES (…)\`. The edge half of limb 1 would compare the ` +
        'schema against nothing and report parity.',
    );
  }
  inserts.set(t, parsed);
}

// ── 1 · column parity ───────────────────────────────────────────────────────
for (const t of TABLES) {
  const declared = new Set(ddl.get(t).keys());
  const written = new Set(inserts.get(t).names);
  const unwritten = [...declared].filter((c) => !written.has(c)).sort();
  const undeclared = [...written].filter((c) => !declared.has(c)).sort();

  if (undeclared.length) {
    fail(
      `${ROUTE} INSERTs column(s) \`${t}\` does not declare: ${undeclared.join(', ')}. ` +
        'D1 rejects the statement at runtime, so this is a 503 on the shared ingest for every app in the portfolio.',
    );
  }
  if (unwritten.length) {
    fail(
      `\`${t}\` declares column(s) the route never writes: ${unwritten.join(', ')}. ` +
        'A column no INSERT names is either dead storage or a field the client thinks it is sending; the schema and ' +
        'the route are the two halves of one envelope and there is no third place to reconcile them.',
    );
  }
  if (!undeclared.length && !unwritten.length) {
    ok(`${t} — ${declared.size} column(s), schema and route agree exactly`);
  }

  const { names, placeholders, binds } = inserts.get(t);
  if (placeholders !== names.length) {
    fail(
      `${ROUTE} INSERT INTO ${t} names ${names.length} column(s) and supplies ${placeholders} placeholder(s). ` +
        'The statement cannot execute; a mismatch here is a total ingest outage, not a degraded one.',
    );
  } else if (binds === null) {
    fail(
      `${ROUTE} INSERT INTO ${t} has no \`.bind(\` this scan could find after it. The bound-parameter arity is ` +
        'the half of the contract D1 checks at runtime rather than at build time, so leaving it unchecked is what ' +
        'made a dropped argument a production-only failure.',
    );
  } else if (binds !== names.length) {
    fail(
      `${ROUTE} INSERT INTO ${t} names ${names.length} column(s) and binds ${binds} value(s). ` +
        'Every column after the missing one shifts by one, so the rows are not rejected — they are WRONG.',
    );
  } else {
    ok(`${t} — ${names.length} column(s), ${placeholders} placeholder(s), ${binds} bound value(s)`);
  }
}

// ── 2 · client coverage ─────────────────────────────────────────────────────
const clientKeys = new Set();
const perSource = [];
for (const { file, marker, what } of CLIENT_SOURCES) {
  if (!has(file)) {
    coverageLost(`${file} is named as a source of the client envelope (${what}) and does not exist.`);
  }
  const dart = stripSourceComments(read(file), '.dart');
  const at = dart.indexOf(marker);
  if (at === -1) {
    coverageLost(
      `${file} no longer contains \`${marker}\` (${what}). The literal moved or was renamed, so this source ` +
        'contributes nothing and limb 2 would report the remaining keys all covered.',
    );
  }
  const open = dart.indexOf('{', at + marker.length);
  const span = open === -1 ? null : balanced(dart, open);
  if (!span) {
    coverageLost(`${file}: the literal after \`${marker}\` is unbalanced, so no key could be parsed out of it.`);
  }
  // Map keys only, and only inside the literal's own balanced body.
  const found = [...span.body.matchAll(/'([a-z][a-z0-9_]*)'\s*:/g)].map((m) => m[1]);
  if (found.length === 0) {
    coverageLost(
      `${file}: the literal after \`${marker}\` (${what}) declares no keys. The client key set below would be ` +
        'short by everything this file contributes, and limb 2 would report the remainder covered.',
    );
  }
  perSource.push(`${file.replaceAll('\\', '/')} → ${found.length}`);
  for (const k of found) {
    if (NOT_A_COLUMN.has(k)) continue;
    clientKeys.add(WIRE_TO_COLUMN.get(k) ?? k);
  }
}

const missingCoverage = REQUIRED_COVERAGE.filter((k) => !clientKeys.has(k));
if (missingCoverage.length) {
  coverageLost(
    `the client parse yielded no key for: ${missingCoverage.join(', ')}. These ten names ARE the client-supplied ` +
      "half of the `events` envelope — every column minus the four the edge writes — so a parse that lost one of " +
      'them makes every assertion below true of a smaller set. Sources: ' +
      perSource.join(', '),
  );
}

const eventsCols = ddl.get('events');
const notAColumn = [...clientKeys].filter((k) => !eventsCols.has(k)).sort();
if (notAColumn.length) {
  fail(
    `the client sends key(s) \`events\` has no column for: ${notAColumn.join(', ')}. ` +
      'The value is collected on the device, shipped over the network and then dropped on the floor at the edge — ' +
      'the worst of both: a privacy cost with no analytical benefit.',
  );
}

/** REQUIRED = NOT NULL with no DEFAULT. A NOT NULL column WITH a default is
 *  satisfiable without the client (`params TEXT NOT NULL DEFAULT '{}'` is
 *  omitted whenever an event carries none), so demanding it would be an
 *  assertion that only holds by accident. */
const required = [...eventsCols.entries()]
  .filter(([name, def]) => /\bNOT\s+NULL\b/i.test(def) && !/\bDEFAULT\b/i.test(def) && !EDGE_WRITTEN.has(name))
  .map(([name]) => name);
if (required.length === 0) {
  coverageLost(
    'no NOT-NULL-without-DEFAULT column was parsed out of `events`, so "the client supplies every required field" ' +
      'quantified over the empty set and held vacuously.',
  );
}
const unsupplied = required.filter((c) => !clientKeys.has(c)).sort();
if (unsupplied.length) {
  fail(
    `\`events\` REQUIRES column(s) no client source supplies: ${unsupplied.join(', ')}. ` +
      'The row is rejected by D1, the client keeps the batch and retries it forever, and the queue never drains.',
  );
} else if (notAColumn.length === 0) {
  ok(
    `client envelope — ${clientKeys.size} key(s) across ${CLIENT_SOURCES.length} source(s) (${perSource.join(', ')}), ` +
      `all real columns; ${required.length} required column(s) supplied; ${[...EDGE_WRITTEN].join(', ')} written by the edge`,
  );
}

// ── 3 · no IP column, from the DDL ──────────────────────────────────────────
let ipHits = 0;
for (const t of TABLES) {
  for (const name of ddl.get(t).keys()) {
    if (IP_NAMED.test(name)) {
      ipHits++;
      fail(
        `\`${t}.${name}\` is a network-address column. Rows on this rail are PSEUDONYMOUS by construction ` +
          '([ADR 011], [ADR 020]) and sites/nikatru/privacy.html says so; an address column converts the whole ' +
          'table into erasure-subject personal data and cannot be walked back once it is in a backup.',
      );
    }
  }
}
if (ipHits === 0) {
  ok(`no IP column on ${TABLES.map((t) => `\`${t}\``).join(' or ')} — read from the schema, not from the INSERT string`);
}

// ── 4 · append-only consent ─────────────────────────────────────────────────
// The WHOLE of services/, code and migrations. No WHERE exemption: a filtered
// DELETE from an audit trail is still a deleted audit trail.
const SCANNABLE = new Set(['.ts', '.tsx', '.js', '.mjs', '.sql']);
const SKIP_DIR = new Set(['node_modules', 'dist', '.wrangler', 'build', 'coverage']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) {
      if (!SKIP_DIR.has(e)) walk(p, out);
    } else if (SCANNABLE.has(extname(e))) {
      out.push(p);
    }
  }
  return out;
}

const serviceFiles = walk(join(ROOT, SERVICES)).map((p) => relative(ROOT, p).replaceAll('\\', '/'));
if (serviceFiles.length === 0) {
  coverageLost(`no scannable file under ${SERVICES}/, so the append-only limb ran over nothing and would print ok.`);
}
// The two files that MUST be in the set. Both are where a violation would
// plausibly be written, and both have been moved before.
for (const must of [ROUTE.replaceAll('\\', '/'), `${MIGRATIONS_DIR.replaceAll('\\', '/')}/`]) {
  if (!serviceFiles.some((f) => f.startsWith(must) || f === must)) {
    coverageLost(`the append-only scan never reached ${must}. The scan stopped covering it; the file did not become safe.`);
  }
}

const DML = [
  { name: 'DELETE', re: /\bDELETE\s+FROM\s+["'`[]?consent_artifacts\b/gi },
  { name: 'UPDATE', re: /\bUPDATE\s+(?:OR\s+\w+\s+)?["'`[]?consent_artifacts\b/gi },
];
let dmlHits = 0;
for (const rel of serviceFiles) {
  const ext = extname(rel);
  // SQL: comments AND string literals go, because a column name inside a quoted
  // string is not a statement. TypeScript: comments only — the SQL LIVES in
  // string literals there, so blanking them would blank the subject.
  const raw = read(rel);
  const text = ext === '.sql'
    ? stripStringLiterals(stripSourceComments(raw, ext))
    : stripSourceComments(raw, ext);
  for (const { name, re } of DML) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      dmlHits++;
      const line = text.slice(0, m.index).split('\n').length;
      fail(
        `${rel}:${line} ${name} on \`consent_artifacts\` — the consent trail is APPEND-ONLY. ` +
          'DPDP §6(3) requires a withdrawal to reference what was consented to, so a withdrawal is a NEW row with ' +
          'granted=0. A WHERE clause does not make this acceptable: check-migrations.mjs exempts filtered statements ' +
          'because a backfill is legitimate THERE; nothing narrows an edit to an audit record enough to be one.',
      );
    }
  }
}
if (dmlHits === 0) {
  ok(`append-only holds — ${serviceFiles.length} file(s) under ${SERVICES}/ carry no UPDATE or DELETE on consent_artifacts`);
}

if (failed) {
  console.error('\nassert-analytics-contract: FAILED');
  process.exit(1);
}
console.log(
  `\nassert-analytics-contract: ok — ${TABLES.length} table(s) parsed from ${migrationFiles.length} migration(s), ` +
    `route parity + arity, ${clientKeys.size} client key(s), no address column, append-only across ${serviceFiles.length} service file(s)`,
);
