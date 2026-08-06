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
// 🔵 WIDENED 2026-08-06 — [pipeline 4]B-14, "the shared server's wire contract
// never breaks a released client". Limbs 1-4 pin ONE route's envelope end to
// end. B-14 quantifies over EVERY shared route, and its own audit note records
// why that read as done at one-of-four: *"the criterion's set is unnamed"*.
// `tooling/platform-register.json` now names it — eight routes — so limb 5 takes
// that register as its domain and requires each route to carry a wire pin, a
// resolvable pointer to the pin that already exists, or a PRINTED gap. The
// register is read, never written, by this guard: a route added to
// `services/platform/src/index.ts` is forced into the register by
// assert-platform-register.mjs, and forced from there into limb 5 here.
//
// FIVE LIMBS
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
//   5 · THE WIRE CONTRACT OF EVERY SHARED ROUTE. [4]B-14. Its domain is
//       `tooling/platform-register.json`'s `routes[]`, and the FLOOR is a
//       relationship, not an integer: the contract ids here must EQUAL the
//       register's route ids in both directions, so a ninth route cannot be
//       mounted without either a pin or a written, printed gap. Four shapes:
//         · BODY   — the response keys the server actually emits, read out of
//                    the balanced object literal of each `c.json(…)`, against
//                    the keys the released Dart client actually subscripts out
//                    of its `fromJson`. Both directions: a key the client reads
//                    and the server stopped sending BREAKS a shipped app, and a
//                    key the server sends that nobody reads must be DECLARED
//                    (with its reason) rather than accumulate silently. Same
//                    shape as config.test.ts's REQUIRED_KEYS + no-stray-keys,
//                    which is the one limb of B-14 that was already built.
//         · STATUS — for `DELETE /v1/account` the released client reads NO body
//                    key at all: `requestAccountDeletion` throws
//                    `AccountDeletionFailure.forStatus(status)`, so the STATUS
//                    SET *is* the wire contract. Every literal status the route
//                    can answer must be one the client's `forStatus` maps; an
//                    unmapped one resolves to `unknown`, and 502 specifically
//                    means "data gone, login alive" — the one outcome a user
//                    cannot discover for themselves.
//         · FLAGS  — `GET /v1/health`'s consumer is not an app, it is
//                    `post-deploy-smoke.mjs` as invoked by deploy-workers.yml.
//                    The `--field` it joins on and `--require-ok` are parsed out
//                    of the workflow and must be real keys of the handler's
//                    literal. Renaming `build` there does not break an app — it
//                    breaks every deploy, after deploying.
//         · GAP    — a route with no in-repo client PRINTS on every run
//                    ([pipeline C-6] posture, as assert-platform-register.mjs
//                    and assert-capability-register.mjs already do) instead of
//                    ranging over nothing and reporting ok. The gap's CLAIM is
//                    checked, not asserted: `POST /v1/money/:provider` prints
//                    "no client by construction", and the limb fails the day any
//                    .dart file in the tree builds that path.
//       ⚠️ `elsewhere`/`here` entries are POINTERS, and a pointer that resolves
//       to nothing is the failure this repo has shipped six times. Each names a
//       file AND a marker inside it, both of which must exist.
//
//       🔵 WIDENED AGAIN 2026-08-06 — B-14's LAST OPEN CLAUSE. An `elsewhere`
//       pointer must now also declare a `clientHalf` that RESOLVES INSIDE THE
//       BRICK'S TEST TREE. The config route pointed at
//       `apps/subly/test/config_default_test.dart`: the pointer resolved, the
//       marker was found, and the route printed `pinned` — while `apps/subly` is
//       ONE stamped app, so the property "a change to the config route's shape
//       turns the client red" held for Subly and for nothing the factory stamps
//       next. Every new app was born outside the one contract stage 4 had built.
//       The client half is now `tooling/bricks/app/__brick__/apps/{{app_id}}/
//       test/config_contract_test.dart`, and three things are checked, not one:
//       its PATH is under the brick test root; its declared key list EQUALS the
//       server's `REQUIRED_KEYS` in both directions; and every key in it is one
//       `AppConfig.fromJson` actually subscripts. The list's own declaration is
//       stripped before a USE of it is looked for — anchoring on a symbol's own
//       declaration is how `assert-seams-wired` passed with every real caller
//       deleted, fixtures and all.
//
// Usage:  node tooling/ci/assert-analytics-contract.mjs [repoRoot]
// Exit 0 = clean, 1 = violation or lost coverage.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

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

// ─── limb 5 · the shared server's wire contract, [pipeline 4]B-14 ────────────

/** The register that NAMES the shared route set. Read-only here. Its `routes[]`
 *  ids are limb 5's domain, and `assert-platform-register.mjs` already asserts
 *  that set EQUALS what `services/platform/src/index.ts` mounts, in both
 *  directions. Depending on it rather than re-parsing index.ts means there is
 *  one derivation of "what the shared routes are" in this repo, not two that can
 *  disagree in the way that reports clean. */
const WIRE_REGISTER = 'tooling/platform-register.json';

/** A `c.json(…)` body carrying this key is a REFUSAL, not an answer. Structural,
 *  and it is what lets the success shape be a union over every success response
 *  without having to classify a computed status code (`c.json({error}, read.status)`
 *  is real in two routes). Asserted non-vacuous per contract: a body pin that
 *  found no error response, or no success response, is COVERAGE LOST. */
const ERROR_ENVELOPE_KEY = 'error';

/** WHERE A CLIENT HALF HAS TO LIVE FOR A STAMPED APP TO INHERIT IT.
 *
 *  🔴 [4]B-14's residual open clause, and the reason it stayed open at BUILT:
 *  *"the client half of each pair must live where a stamped app inherits it —
 *  the brick's test tree — not in `apps/subly`."* `apps/subly` is ONE stamped
 *  app. A pin there says the config route's shape is protected for Subly and
 *  says NOTHING about app #2, which is the entire subject of an app factory —
 *  and it says nothing in the way that reads as done, because the pointer
 *  resolves, the marker is found, and the route prints `pinned`.
 *
 *  So the path is asserted, not merely recorded. A `clientHalf` outside this
 *  root is COVERAGE LOST rather than a pass. */
const BRICK_TEST_ROOT = 'tooling/bricks/app/__brick__/apps/{{app_id}}/test';

/** The config route's client half, and the three things that make it a contract
 *  rather than a file that exists.
 *
 *  1 · `declares` — a list of wire keys parsed out of the brick test, which must
 *      EQUAL the server's `REQUIRED_KEYS` in both directions. The two files are
 *      in different languages and cannot import each other, so this equality is
 *      the whole mechanism: a key added on the server alone, or deleted from the
 *      brick alone, fails here.
 *  2 · ⚠️ THE LIST MUST BE USED, NOT MERELY DECLARED. Its own declaration is
 *      stripped before the usage is looked for. This repo has shipped a check
 *      whose anchor matched the symbol's own declaration — `assert-seams-wired`
 *      passed with every real caller deleted, and all six of its fixture tests
 *      passed too. A `const kConfigWireKeys = [...]` nothing iterates is a
 *      comment with brackets.
 *  3 · `reads` — the keys must be ones the RELEASED client genuinely subscripts
 *      out of `AppConfig.fromJson`. A key nobody parses cannot break an app when
 *      it changes, so pinning it would inflate the count without protecting
 *      anything. */
const CONFIG_CLIENT_HALF = {
  file: `${BRICK_TEST_ROOT}/config_contract_test.dart`,
  declares: 'kConfigWireKeys',
  server: { file: 'services/platform/test/config.test.ts', marker: 'const REQUIRED_KEYS = ' },
  reads: {
    file: join('packages', 'core', 'lib', 'src', 'config', 'app_config.dart'),
    member: 'factory AppConfig.fromJson(',
    reader: 'json',
  },
  /** THE FLOOR. Two keys whose absence from either side is the failure this pin
   *  was widened for: `update_url` is the force-update wall's destination, which
   *  a build cannot change by shipping (that build is the one the wall exists to
   *  replace), and `min_supported_version` is what arms the wall at all. Both
   *  landed server-side while the runtime branch was unreachable and nothing was
   *  red, because falling back is correct when a value is absent. */
  floor: ['min_supported_version', 'update_url'],
};

/** ONE ENTRY PER SHARED ROUTE, and the id must be the register's id. The set is
 *  checked against the register in BOTH directions before anything below runs,
 *  so this array cannot silently fall behind the server. */
const WIRE_CONTRACTS = [
  {
    id: 'health',
    kind: 'flags',
    // Both Workers answer this shape and both are smoked by the same script, so
    // both are pinned: a rename in ONE of them breaks that one's deploy only,
    // which is exactly the failure that is easiest to miss.
    servers: [
      { file: 'services/platform/src/index.ts', marker: "'/v1/health'" },
      { file: 'services/subly-api/src/index.ts', marker: "'/v1/health'" },
    ],
    // 🔴 THE CONSUMER IS FOUND, NOT NAMED. This read `.github/workflows/deploy-workers.yml`
    // until 2026-08-06, and naming one workflow had two costs. It tripped
    // `assert-release-lane-generic.mjs`, whose rule is that a guard naming exactly one
    // workflow must declare `// LANE-BOUND: <file> — <why>` — and this guard is NOT
    // lane-bound: its subject is the wire contract, and `deploy-workers.yml` is merely
    // where the smoke happens to live today. More importantly, a hardcoded consumer means
    // that **moving the smoke to another workflow would silently empty this limb** while it
    // kept printing ok. Same reasoning `assert-deploy-triggers-deploy.mjs:66-79` records for
    // choosing a scan over a LANE-BOUND declaration.
    consumer: { dir: '.github/workflows', script: 'post-deploy-smoke.mjs' },
    /** THE FLOOR. `build` is the field the smoke joins a deploy to and `ok` is
     *  the field `--require-ok` reads; a workflow that stopped passing either
     *  would leave this limb quantifying over a smaller set and still print ok. */
    requiredFields: ['build', 'ok'],
  },
  {
    id: 'config',
    kind: 'elsewhere',
    why: 'the one limb of B-14 that was already BUILT — a REQUIRED_KEYS list plus a no-stray-keys assertion on the server, mirrored by an equality test on the client. Pointed at rather than duplicated, because a second copy of a contract is a second thing to drift.',
    pins: [
      { file: 'services/platform/test/config.test.ts', marker: 'REQUIRED_KEYS' },
      // Subly's own bundled-default pin. STILL REAL and still checked — it pins
      // Subly's VALUES against the server's — but it is no longer what satisfies
      // this route: see `clientHalf` below for why one stamped app cannot.
      { file: 'apps/subly/test/config_default_test.dart', marker: 'kSublyDefaultConfig equals the server contract values' },
    ],
    clientHalf: CONFIG_CLIENT_HALF,
  },
  {
    id: 'events',
    kind: 'here',
    table: 'events',
    why: 'limbs 1 and 2 of this guard: DDL ↔ route INSERT ↔ four client sources, plus placeholder and bind arity.',
  },
  {
    id: 'consent',
    kind: 'here',
    table: 'consent_artifacts',
    why: 'limb 1 of this guard (column parity + arity), and limb 4 for the append-only property the wire shape depends on.',
  },
  {
    id: 'account',
    kind: 'status',
    // Two servers, one released client. apps/subly points its deletion at
    // services/subly-api and the brick's stamped backend answers the same
    // contract, so a status either of them invents lands on the same Dart enum.
    servers: [
      'services/platform/src/routes/account.ts',
      'services/subly-api/src/routes/account.ts',
    ],
    client: {
      file: 'packages/core/lib/src/auth/account_deletion.dart',
      member: 'static AccountDeletionOutcome forStatus(',
    },
    /** THE FLOOR. Deleting `case 502` from the enum is the mutation that matters
     *  most and the one no server-side test can see: 502 is "your data was
     *  deleted and your sign-in was not", and folding it into a generic refusal
     *  tells a user nothing happened when their data is gone. */
    mustMap: [401, 501, 502, 503],
    bodyIsNotTheContract:
      'requestAccountDeletion() awaits client.delete(path) and reads only ApiException.statusCode — no key of `{ ok, deleted, unlinked, apps }` is ever subscripted. Pinning that body would be pinning something no released client can break on; the STATUS SET is the contract, so that is what is pinned.',
  },
  {
    id: 'entitlements',
    kind: 'body',
    server: 'services/platform/src/routes/entitlements.ts',
    client: {
      file: 'packages/core/lib/src/models/entitlement.dart',
      member: 'factory Entitlements.fromJson(',
      reader: 'j',
    },
    requiredBoth: ['app_id', 'is_pro', 'entitlements'],
    clientOnly: {
      verified_at:
        'NOT A WIRE FIELD. The client stamps it itself via verifiedAtNow() on the success path of a read; it exists to bound how long an unrefreshed answer is honoured ([5]M-8) and travels only through the persisted cache. A server that started sending it would let the host refresh its own staleness ceiling.',
    },
    serverOnly: {},
    nested: {
      key: 'entitlements',
      client: {
        file: 'packages/core/lib/src/models/entitlement.dart',
        member: 'factory Entitlement.fromJson(',
        reader: 'j',
      },
      requiredBoth: ['entitlement', 'product_id', 'store', 'is_active', 'expires_at'],
      clientOnly: {},
      serverOnly: {
        provider: 'support-visible provenance. The route returns rows that grant NOTHING so a locked-out paying user is explainable; the client models only what decides access.',
        provider_status: 'same — the row is returned inert with the provider\'s own word for why.',
        current_period_end: 'the provider\'s billing period, not our expiry. `expires_at` is the field access is decided on and the one the client reads.',
        trial_end: 'same class as current_period_end.',
        revocation_reason: 'why a row was revoked. Its enum is pinned SQL-side by assert-entitlement-contract.mjs limb 3/4; the client fails closed on is_active alone and must not branch on the reason.',
      },
    },
  },
  {
    id: 'plan-cancel',
    kind: 'body',
    server: 'services/platform/src/routes/cancellation.ts',
    client: {
      file: 'packages/core/lib/src/cancellation_transport.dart',
      member: 'static CancellationReceipt fromJson(',
      reader: 'j',
    },
    requiredBoth: ['has_active_plan', 'recorded', 'executed'],
    clientOnly: {},
    serverOnly: {
      not_executed_reason:
        'a recovery hint for a human (`no_provider_on_row` vs `provider_not_configured`), stored on the row and returned for support. The receipt models three INDEPENDENT booleans on purpose; a client that branched on the reason would be re-deriving "did it happen" from a string.',
    },
    /** The REQUEST half. The client posts exactly this literal and the host
     *  resolves the plan from the session — never from a body field — so the one
     *  key on the wire is the app id, and a rename on either side is a 404 for
     *  every cancel attempt from every released build. */
    request: {
      client: { file: 'packages/api_client/lib/src/dio_cancellation_transport.dart', marker: 'data: <String, Object?>' },
      keys: ['app_id'],
    },
  },
  {
    id: 'money-webhook',
    kind: 'gap',
    reason:
      'NO CLIENT IN THIS REPO, BY CONSTRUCTION — the caller is the merchant of record\'s own delivery system. There is no released client of ours to break, so there is no wire contract to pin; what stands in for it is assert-mor-adapters.mjs, which asserts the HMAC verifier exists, is CALLED, and is the only path to an entitlements write across services/**.',
    /** THE CLAIM IS CHECKED, NOT ASSERTED. The day any Dart source builds this
     *  path there IS a released client, the printed gap becomes a false
     *  statement, and this fails rather than going on printing it. */
    absentFromDart: '/v1/money',
  },
];

/** Where limb 5's "no Dart client" claims are checked. Roots rather than the
 *  whole tree: these are every place first-party Dart lives, and a root that
 *  yields zero .dart files is COVERAGE LOST — a claim of absence proved by a
 *  scan that read nothing is the exact failure this file's header describes. */
const DART_ROOTS = ['packages', 'apps', join('tooling', 'bricks')];

/** Column names that are a network address by any spelling. Matched on the NAME
 *  as parsed out of the DDL, never on the file text. */
const IP_NAMED = /(^|_)(ip|ips|ipv4|ipv6|ipaddr|ipaddress|addr)($|_)|ip_address|remote_addr|client_ip|peer_addr/i;

let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);
/** A declared, checked hole. PRINTS ON EVERY RUN and does not fail the build —
 *  the [pipeline C-6] posture: failing on a gap that only another stage (or a
 *  vendor) can close blocks all CI on work this increment cannot do, while
 *  hiding it is how "one route of four" reads as done. */
const gap = (m) => console.log(`GAP  ${m}`);
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
const migrationFiles = listDir(join(ROOT, MIGRATIONS_DIR))
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
  try { entries = listDir(dir); } catch { return out; }
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

// ── 5 · the shared server's wire contract ───────────────────────────────────
// [pipeline 4]B-14. Everything here reads structure: response keys come out of
// the balanced object literal of a `c.json(…)` call, client keys come out of the
// balanced body of a named Dart member, statuses come out of `case` labels and
// numeric literal arguments. Nothing matches prose, for the reason the header
// gives — and because a doc comment above `fromJson` naming every field it reads
// would satisfy any text scan of this exact subject.

/** Top-level keys of the balanced `{…}` that OPENS at `openIdx` in `text`.
 *  Shorthand (`{ ok, deleted }`) is a key. A spread and anything this cannot
 *  classify are COUNTED, never skipped quietly: an under-count is what makes a
 *  set comparison pass for the wrong reason. */
function objectKeysAt(text, openIdx) {
  const span = balanced(text, openIdx);
  if (!span) return null;
  const keys = [];
  let spreads = 0;
  let unparsed = 0;
  for (const part of splitTopLevel(span.body)) {
    if (part.startsWith('...')) { spreads++; continue; }
    const m = part.match(/^['"`]?([A-Za-z_$][A-Za-z0-9_$]*)['"`]?\s*(:|$)/);
    if (m) keys.push(m[1]);
    else unparsed++;
  }
  return { keys, spreads, unparsed, end: span.end };
}

/** Every `c.json(…)` in `src` (comment-stripped), as
 *  `{ keys | null, spreads, unparsed, status | null, statusLiteral }`.
 *  `keys: null` = the first argument is not an object literal (a hoisted const
 *  such as RATE_LIMITED_BATCH); `statusLiteral: false` = a computed status. Both
 *  are reported so a caller can refuse rather than assume. */
function parseJsonResponses(src) {
  const out = [];
  const re = /\bc\.json\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const span = balanced(src, open);
    const line = src.slice(0, m.index).split('\n').length;
    if (!span) { out.push({ line, keys: null, spreads: 0, unparsed: 0, status: null, statusLiteral: false }); continue; }
    const args = splitTopLevel(span.body);
    const first = args[0] ?? '';
    let parsed = null;
    if (first.startsWith('{')) parsed = objectKeysAt(first, 0);
    const rawStatus = args[1]?.trim();
    const isLiteral = rawStatus === undefined || /^\d{3}$/.test(rawStatus);
    out.push({
      line,
      keys: parsed ? parsed.keys : null,
      spreads: parsed ? parsed.spreads : 0,
      unparsed: parsed ? parsed.unparsed : 0,
      status: rawStatus === undefined ? 200 : (isLiteral ? Number(rawStatus) : null),
      statusLiteral: isLiteral,
    });
  }
  return out;
}

/** The balanced body of the Dart member that `marker` opens — `{ … }` for a
 *  block body, or everything up to the terminating `;` for an `=>` body. Both
 *  forms are real here (`Entitlement.fromJson` is a block, `CancellationReceipt.
 *  fromJson` is an arrow), and reading the WHOLE FILE instead is what let a
 *  ternary's string literal be counted as a map key the first time this repo
 *  parsed Dart. */
function dartMemberBody(src, marker) {
  const at = src.indexOf(marker);
  if (at === -1) return null;
  const paren = src.indexOf('(', at + marker.length - 1);
  if (paren === -1) return null;
  const params = balanced(src, paren);
  if (!params) return null;
  let i = params.end + 1;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === '{') {
    const body = balanced(src, i);
    return body ? body.body : null;
  }
  if (src.startsWith('=>', i)) {
    // To the `;` that is not nested inside a call and not inside a string.
    let depth = 0;
    let quote = null;
    for (let k = i + 2; k < src.length; k++) {
      const ch = src[k];
      if (quote) {
        if (ch === '\\') { k++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth--; continue; }
      if (ch === ';' && depth === 0) return src.slice(i + 2, k);
    }
  }
  return null;
}

/** The map keys a Dart member SUBSCRIPTS — `j['app_id']`. This is what a
 *  released client actually depends on: a field it never reads cannot break it,
 *  and a field it reads that stops arriving breaks it silently, in the field. */
const dartSubscripts = (body, reader) => [
  ...new Set([...body.matchAll(new RegExp(`\\b${reader}\\s*\\[\\s*'([a-z_][a-z0-9_]*)'\\s*\\]`, 'g'))].map((m) => m[1])),
];

/** Every .dart file under the declared roots. */
function walkExt(dir, ext, out = []) {
  let entries;
  try { entries = listDir(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) { if (!SKIP_DIR.has(e)) walkExt(p, ext, out); }
    else if (extname(e) === ext) out.push(p);
  }
  return out;
}

// ── 5a · the domain, and the floor that keeps it honest ─────────────────────
if (!has(WIRE_REGISTER)) {
  coverageLost(
    `${WIRE_REGISTER} does not exist, so limb 5 has no route set to quantify over. B-14's own audit records that ` +
      'an unnamed set is how "one route of four" satisfied "every shared route".',
  );
}
let register;
try {
  register = JSON.parse(read(WIRE_REGISTER));
} catch (err) {
  coverageLost(`${WIRE_REGISTER} does not parse as JSON (${err instanceof Error ? err.message : err}).`);
}
const registerIds = (register.routes ?? []).map((r) => r.id);
if (registerIds.length === 0) {
  coverageLost(`${WIRE_REGISTER} declares no routes[], so every wire assertion below would range over the empty set.`);
}
const contractIds = WIRE_CONTRACTS.map((c) => c.id);
const unpinned = registerIds.filter((id) => !contractIds.includes(id)).sort();
const unmounted = contractIds.filter((id) => !registerIds.includes(id)).sort();
if (unpinned.length || unmounted.length) {
  coverageLost(
    `WIRE_CONTRACTS and ${WIRE_REGISTER} name different route sets. ` +
      (unpinned.length ? `Mounted with NO wire contract: ${unpinned.join(', ')}. ` : '') +
      (unmounted.length ? `A contract for a route the register does not name: ${unmounted.join(', ')}. ` : '') +
      'The floor is a RELATIONSHIP, not a count: a ninth shared route must arrive here with a pin or with a written, ' +
      'printed gap, and it cannot arrive by being ignored.',
  );
}
if (new Set(contractIds).size !== contractIds.length) {
  coverageLost('WIRE_CONTRACTS has a duplicate id, so one route\'s contract is shadowing another\'s.');
}

/** Success/error split for one route file, plus the refusals it can answer. */
function routeShape(rel) {
  if (!has(rel)) {
    coverageLost(`${rel} is named as a shared route's server half and does not exist.`);
  }
  const responses = parseJsonResponses(stripSourceComments(read(rel), extname(rel)));
  if (responses.length === 0) {
    coverageLost(`${rel} has no parseable \`c.json(\` call, so its wire shape would be compared against nothing.`);
  }
  const success = new Set();
  const errorShapes = [];
  let opaque = 0;
  let spreads = 0;
  let unparsedParts = 0;
  const statuses = new Set();
  let computedStatus = 0;
  for (const r of responses) {
    if (r.keys === null) { opaque++; continue; }
    spreads += r.spreads;
    unparsedParts += r.unparsed;
    if (r.statusLiteral && r.status !== null) statuses.add(r.status);
    else computedStatus++;
    if (r.keys.includes(ERROR_ENVELOPE_KEY)) errorShapes.push(r);
    else for (const k of r.keys) success.add(k);
  }
  return { rel, responses, success, errorShapes, opaque, spreads, unparsedParts, statuses, computedStatus };
}

/** A `[ … ]` list of quoted lower-snake names opening after `marker`, plus the
 *  span of the declaration itself so a caller can STRIP it before looking for a
 *  use. Comment-stripped text only: `REQUIRED_KEYS` carries eighteen lines of
 *  prose naming other keys, and a scan that read those would pin a set nobody
 *  wrote. */
function declaredStringList(text, marker) {
  const at = text.indexOf(marker);
  if (at === -1) return null;
  const open = text.indexOf('[', at + marker.length);
  if (open === -1) return null;
  const span = balanced(text, open);
  if (!span) return null;
  return {
    keys: [...span.body.matchAll(/['"]([a-z][a-z0-9_]*)['"]/g)].map((m) => m[1]),
    start: at,
    end: span.end,
  };
}

/** [4]B-14's residual clause, enforced: the client half of a delegated pin must
 *  resolve INSIDE the brick's test tree, must agree with the server key for key,
 *  and must name keys the released client actually reads.
 *
 *  Returns `{ keys, pinned }`. `pinned:false` means a real disagreement was
 *  reported with `fail()` — the route is not counted as pinned, because a
 *  contract whose two halves disagree is the thing this limb exists to find. */
function clientHalfOf(contract) {
  const half = contract.clientHalf;
  if (!half) {
    coverageLost(
      `${contract.id}: this route delegates its pin ELSEWHERE and declares no \`clientHalf\`. B-14's acceptance is ` +
        'that a change on either side turns the OTHER red for every app the factory stamps, so a delegated pin with ' +
        'no inherited client half is the "one route of four reads as done" shape at the level of one route.',
    );
  }
  const rel = half.file.replaceAll('\\', '/');
  if (!rel.startsWith(`${BRICK_TEST_ROOT}/`)) {
    coverageLost(
      `${contract.id}: its client half is declared at ${rel}, which is not under ${BRICK_TEST_ROOT}/. ` +
        'apps/subly is ONE stamped app: a pin there protects Subly and says nothing about the next app the brick ' +
        'stamps, which is the whole point of an app factory. B-14: "the client half of each pair must live where a ' +
        'stamped app inherits it — the brick\'s test tree — not in apps/subly".',
    );
  }
  if (!has(half.file)) {
    coverageLost(`${contract.id}: the inherited client half ${rel} does not exist, so no stamped app carries this pin.`);
  }
  const dart = stripSourceComments(read(half.file), '.dart');
  const declared = declaredStringList(dart, half.declares);
  if (!declared || declared.keys.length === 0) {
    coverageLost(
      `${contract.id}: no wire-key list was parsed out of \`${half.declares}\` in ${rel}. The client half of this ` +
        'contract would be compared against the empty set, which every server key set satisfies.',
    );
  }
  // ⚠️ THE DECLARATION IS STRIPPED BEFORE THE USE IS LOOKED FOR. Anchoring on
  // the symbol's own declaration is the defect assert-seams-wired shipped with:
  // it passed with every real caller deleted, and its fixtures passed too.
  const withoutDecl = dart.slice(0, declared.start) + dart.slice(declared.end + 1);
  if (!withoutDecl.includes(half.declares)) {
    coverageLost(
      `${contract.id}: \`${half.declares}\` is DECLARED in ${rel} and used nowhere else in it. A list no test ` +
        'iterates is a comment with brackets: the stamped app would carry the contract as data and assert nothing ' +
        'about it, while this guard went on comparing it to the server and printing ok.',
    );
  }

  if (!has(half.server.file)) {
    coverageLost(`${contract.id}: the server half ${half.server.file} does not exist.`);
  }
  const serverList = declaredStringList(stripSourceComments(read(half.server.file), '.ts'), half.server.marker);
  if (!serverList || serverList.keys.length === 0) {
    coverageLost(
      `${contract.id}: no key list was parsed out of \`${half.server.marker}\` in ${half.server.file}, so the ` +
        'equality below would hold against nothing.',
    );
  }
  const floorMissing = half.floor.filter((k) => !serverList.keys.includes(k) || !declared.keys.includes(k));
  if (floorMissing.length) {
    coverageLost(
      `${contract.id}: key(s) ${floorMissing.join(', ')} are the declared floor of the config contract and are no ` +
        'longer on both sides. `update_url` is where the force-update wall sends users — a value a broken build ' +
        'cannot change by shipping, because that build is the one the wall exists to replace.',
    );
  }

  const serverOnly = serverList.keys.filter((k) => !declared.keys.includes(k)).sort();
  const brickOnly = declared.keys.filter((k) => !serverList.keys.includes(k)).sort();
  if (serverOnly.length || brickOnly.length) {
    fail(
      `${contract.id} — the config contract's two halves name different key sets. ` +
        (serverOnly.length ? `On the server (${half.server.file}) and NOT in the brick: ${serverOnly.join(', ')}. ` : '') +
        (brickOnly.length ? `In the brick (${rel}) and NOT on the server: ${brickOnly.join(', ')}. ` : '') +
        'They are in different languages and cannot import each other, so this equality IS the contract: a field ' +
        'added on one side alone reaches production as a field every stamped app silently ignores.',
    );
    return { keys: declared.keys, pinned: false };
  }

  if (!has(half.reads.file)) {
    coverageLost(`${contract.id}: ${half.reads.file} — the parse the pinned keys must be read by — does not exist.`);
  }
  const body = dartMemberBody(stripSourceComments(read(half.reads.file), '.dart'), half.reads.member);
  if (body === null) {
    coverageLost(
      `${contract.id}: ${half.reads.file} no longer contains \`${half.reads.member}\`. Every "is this key read" ` +
        'question below would be asked of an empty body and answered yes.',
    );
  }
  const subscripted = new Set(dartSubscripts(body, half.reads.reader));
  if (subscripted.size === 0) {
    coverageLost(`${contract.id}: \`${half.reads.member}\` subscripts no key off \`${half.reads.reader}\`.`);
  }
  const unread = declared.keys.filter((k) => !subscripted.has(k)).sort();
  if (unread.length) {
    fail(
      `${contract.id} — key(s) ${unread.join(', ')} are pinned on both sides and ` +
        `${half.reads.file.replaceAll('\\', '/')} never reads ` +
        `them off \`${half.reads.reader}\`. The shared server sends the field to every app in the portfolio and ` +
        'every app drops it on the floor — which no server test can see, and which the config route answering 200 ' +
        'actively conceals.',
    );
    return { keys: declared.keys, pinned: false };
  }
  return { keys: declared.keys, pinned: true };
}

let wireGaps = 0;
let wirePinned = 0;

for (const contract of WIRE_CONTRACTS) {
  // ── pointers ───────────────────────────────────────────────────────────────
  if (contract.kind === 'elsewhere') {
    for (const pin of contract.pins) {
      if (!has(pin.file)) {
        coverageLost(`${contract.id}: its pin is declared to live in ${pin.file}, which does not exist.`);
      }
      if (!read(pin.file).includes(pin.marker)) {
        coverageLost(
          `${contract.id}: ${pin.file} no longer contains \`${pin.marker}\`. The pin this route delegates to moved or ` +
            'was deleted, and a pointer to a pin that is gone is exactly the "covered" that covers nothing.',
        );
      }
    }
    const half = clientHalfOf(contract);
    if (half.pinned) {
      wirePinned++;
      ok(
        `wire ${contract.id} — pinned by ${contract.pins.map((p) => p.file).join(' + ')}; client half INHERITED by ` +
          `every stamped app: ${half.keys.length} key(s) in ${contract.clientHalf.file.replaceAll('\\', '/')} equal ` +
          `the server's \`${contract.clientHalf.server.marker.replace(/^const\s+/, '').replace(/\s*=\s*$/, '')}\`, ` +
          'all of them read by ' +
          `${contract.clientHalf.reads.member.replace('(', '')}`,
      );
    }
    continue;
  }

  if (contract.kind === 'here') {
    if (!inserts.has(contract.table)) {
      coverageLost(`${contract.id}: limbs 1-2 are cited as its pin but no INSERT was parsed for \`${contract.table}\`.`);
    }
    wirePinned++;
    ok(`wire ${contract.id} — pinned by limbs 1-4 of this guard (\`${contract.table}\`)`);
    continue;
  }

  // ── a declared gap, whose claim is CHECKED ────────────────────────────────
  if (contract.kind === 'gap') {
    if (!contract.reason || contract.reason.trim() === '') {
      coverageLost(`${contract.id} declares a gap with no reason. An empty reason is a hidden gap wearing a label.`);
    }
    const dartFiles = DART_ROOTS.flatMap((r) => walkExt(join(ROOT, r), '.dart')).map((p) => relative(ROOT, p).replaceAll('\\', '/'));
    if (dartFiles.length === 0) {
      coverageLost(
        `${contract.id}: the "no Dart client" claim was checked against ZERO .dart files under ${DART_ROOTS.join(', ')}. ` +
          'An absence proved by a scan that read nothing is not an absence.',
      );
    }
    const clients = dartFiles.filter((f) => stripSourceComments(read(f), '.dart').includes(contract.absentFromDart));
    if (clients.length) {
      fail(
        `${contract.id} is declared to have no in-repo client, and ${clients.join(', ')} now builds \`${contract.absentFromDart}\`. ` +
          'The printed gap has become a false statement: there is a released client, so the route needs a real pin rather ' +
          'than a reason.',
      );
    } else {
      wireGaps++;
      gap(`wire ${contract.id} — NO CLIENT PINNED. ${contract.reason} (checked: ${dartFiles.length} .dart file(s), none builds \`${contract.absentFromDart}\`)`);
    }
    continue;
  }

  // ── the status set IS the contract ────────────────────────────────────────
  if (contract.kind === 'status') {
    if (!has(contract.client.file)) {
      coverageLost(`${contract.id}: the client half ${contract.client.file} does not exist.`);
    }
    const body = dartMemberBody(stripSourceComments(read(contract.client.file), '.dart'), contract.client.member);
    if (body === null) {
      coverageLost(
        `${contract.id}: ${contract.client.file} no longer contains \`${contract.client.member}\`. The status mapping ` +
          'moved or was renamed, so every server status below would be compared against an empty set and pass.',
      );
    }
    const mapped = new Set([...body.matchAll(/\bcase\s+(\d{1,3})\s*:/g)].map((m) => Number(m[1])));
    if (mapped.size === 0) {
      coverageLost(`${contract.id}: no \`case <status>:\` was parsed out of \`${contract.client.member}\`.`);
    }
    const floorMissing = contract.mustMap.filter((s) => !mapped.has(s));
    if (floorMissing.length) {
      coverageLost(
        `${contract.id}: the released client no longer maps status(es) ${floorMissing.join(', ')}. ` +
          '502 in particular is "your data was deleted and your sign-in was NOT" — the one outcome a user cannot ' +
          'discover for themselves, and the one a generic refusal message actively misreports.',
      );
    }
    let serverStatuses = new Set();
    for (const rel of contract.servers) {
      const shape = routeShape(rel);
      if (shape.computedStatus) {
        coverageLost(
          `${rel}: ${shape.computedStatus} \`c.json(…)\` call(s) answer a COMPUTED status. For this route the status ` +
            'set is the whole wire contract, so a status this scan cannot read is a hole in it, not a detail.',
        );
      }
      if (shape.statuses.size === 0) {
        coverageLost(`${rel}: no literal status was parsed out of its responses.`);
      }
      serverStatuses = new Set([...serverStatuses, ...shape.statuses]);
    }
    const unmapped = [...serverStatuses].filter((s) => s >= 400 && !mapped.has(s)).sort((a, b) => a - b);
    if (unmapped.length) {
      fail(
        `${contract.id} — the server can answer status(es) ${unmapped.join(', ')} that the released client does not map ` +
          `(${contract.servers.join(', ')} vs ${contract.client.file}). \`forStatus\` resolves an unmodelled status to ` +
          '`unknown`, whose message says we cannot tell how much was removed — so a new status ships as a shrug to the ' +
          'user rather than as a build failure here.',
      );
    } else {
      wirePinned++;
      ok(
        `wire ${contract.id} — status set pinned: server answers {${[...serverStatuses].sort((a, b) => a - b).join(', ')}} ` +
          `across ${contract.servers.length} host(s), client maps {${[...mapped].sort((a, b) => a - b).join(', ')}}`,
      );
    }
    continue;
  }

  // ── the consumer is a deploy step, not an app ─────────────────────────────
  if (contract.kind === 'flags') {
    // Scan EVERY workflow, so the domain cannot shrink by a file being renamed.
    // 🔴 `listDir` THROUGH `ROOT`, and both halves of that were earned today.
    // The first version called `readdirSync` on the raw relative path, which
    // resolves against process.cwd() — so under the test fixtures it LISTED the
    // real .github/workflows and READ the fixture's, and died on a file that
    // existed in one tree and not the other. A guard with two notions of "the
    // repo" tests a different tree than it reports on.
    // Then `assert-walks-bounded.mjs` rejected the raw `readdirSync` outright:
    // every listing in tooling/ci must go through `listDir`, which is the one
    // place that knows about nested checkouts. That is the same defect class
    // that made `.claude/worktrees` — eleven full copies of this repo — resolve
    // citations into stale branches earlier today. The rule is not pedantry.
    const wfFiles = listDir(join(ROOT, contract.consumer.dir))
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((f) => `${contract.consumer.dir}/${f}`);
    if (wfFiles.length === 0) {
      coverageLost(`${contract.id}: no workflow files under ${contract.consumer.dir}. The scan is broken, not the repo.`);
    }
    const invocations = [];
    for (const file of wfFiles) {
      const wf = stripSourceComments(read(file), '.yml');
      let from = 0;
      for (;;) {
        const at = wf.indexOf(contract.consumer.script, from);
        if (at === -1) break;
        // To the next step boundary, so one step's flags cannot be read as another's.
        const nextStep = wf.indexOf('\n      - name:', at);
        invocations.push({ file, text: wf.slice(at, nextStep === -1 ? wf.length : nextStep) });
        from = at + contract.consumer.script.length;
      }
    }
    const healthCalls = invocations.filter((s) => /--url\s+\S*\/v1\/health\b/.test(s.text));
    if (healthCalls.length === 0) {
      coverageLost(
        `${contract.id}: NO workflow under ${contract.consumer.dir} invokes ${contract.consumer.script} against ` +
          "/v1/health. The route's only machine consumer stopped consuming it, so the field pin below would range " +
          'over nothing — and the deploy would stop being joined to a build at the same moment.',
      );
    }
    const consumed = new Set();
    for (const call of healthCalls) {
      for (const f of call.text.matchAll(/--field\s+([A-Za-z_][A-Za-z0-9_]*)/g)) consumed.add(f[1]);
      if (/--require-ok\b/.test(call.text)) consumed.add('ok');
    }
    const floorMissing = contract.requiredFields.filter((f) => !consumed.has(f));
    if (floorMissing.length) {
      coverageLost(
        `${contract.id}: the deploy smoke no longer reads field(s) ${floorMissing.join(', ')}. ` +
          '`build` is the only thing that distinguishes "the Worker answered" from "the OLD Worker answered", and ' +
          '`--require-ok` is what separates a deployed Worker from a deployed-and-well one.',
      );
    }
    let allOk = true;
    for (const server of contract.servers) {
      if (!has(server.file)) coverageLost(`${contract.id}: ${server.file} does not exist.`);
      const src = stripSourceComments(read(server.file), '.ts');
      const at = src.indexOf(server.marker);
      if (at === -1) {
        coverageLost(`${contract.id}: ${server.file} no longer declares a route at \`${server.marker}\`.`);
      }
      const jm = /\bc\.json\s*\(/g;
      jm.lastIndex = at;
      const found = jm.exec(src);
      const parsed = found ? objectKeysAt(splitTopLevel(balanced(src, found.index + found[0].length - 1)?.body ?? '')[0] ?? '', 0) : null;
      if (!parsed || parsed.keys.length === 0) {
        coverageLost(`${contract.id}: no response literal was parsed for \`${server.marker}\` in ${server.file}.`);
      }
      const absent = [...consumed].filter((f) => !parsed.keys.includes(f)).sort();
      if (absent.length) {
        allOk = false;
        fail(
          `${contract.id} — ${server.file} does not answer field(s) the deploy smoke joins on: ${absent.join(', ')}. ` +
            'The smoke fails AFTER the Worker is live, so the rename ships and the deploy job reports the failure; ' +
            'this is the same fact, one build step earlier.',
        );
      }
    }
    if (allOk) {
      wirePinned++;
      ok(
        `wire ${contract.id} — deploy-smoke fields {${[...consumed].sort().join(', ')}} answered by all ` +
          `${contract.servers.length} health handler(s), from ${healthCalls.length} invocation(s)`,
      );
    }
    continue;
  }

  // ── body parity, both directions ──────────────────────────────────────────
  const shape = routeShape(contract.server);
  if (shape.errorShapes.length === 0) {
    coverageLost(
      `${contract.server}: no \`c.json(\` body carries an \`${ERROR_ENVELOPE_KEY}\` key, so the success/refusal split ` +
        'that separates the answer shape from the refusal shape found no refusals. Either the split broke or the route ' +
        'can no longer refuse; both make the success set below the union of everything.',
    );
  }
  if (shape.success.size === 0) {
    coverageLost(`${contract.server}: no success response body was parsed, so the server half of this pin is empty.`);
  }
  if (shape.spreads || shape.unparsedParts) {
    coverageLost(
      `${contract.server}: ${shape.spreads} spread(s) and ${shape.unparsedParts} unreadable member(s) in a response ` +
        'literal. A key this scan cannot name is a key it cannot compare, and an under-counted server set makes the ' +
        '"no stray keys" direction pass by being blind.',
    );
  }

  /** One level of the pin: a server key set against a Dart member's subscripts. */
  const pinLevel = (label, serverKeys, spec) => {
    if (!has(spec.client.file)) {
      coverageLost(`${contract.id}${label}: the client half ${spec.client.file} does not exist.`);
    }
    const body = dartMemberBody(stripSourceComments(read(spec.client.file), '.dart'), spec.client.member);
    if (body === null) {
      coverageLost(
        `${contract.id}${label}: ${spec.client.file} no longer contains \`${spec.client.member}\`. The parse that ` +
          'yields what the released client reads found nothing, so every comparison below would hold vacuously.',
      );
    }
    const reads = new Set(dartSubscripts(body, spec.client.reader));
    if (reads.size === 0) {
      coverageLost(
        `${contract.id}${label}: \`${spec.client.member}\` subscripts no key off \`${spec.client.reader}\`. ` +
          'A client that reads nothing cannot be broken by anything, which is not a contract — it is an empty domain.',
      );
    }
    const floorMissing = spec.requiredBoth.filter((k) => !reads.has(k) || !serverKeys.has(k));
    if (floorMissing.length) {
      coverageLost(
        `${contract.id}${label}: key(s) ${floorMissing.join(', ')} are the declared floor of this route's shape and are ` +
          `missing from ${floorMissing.filter((k) => !serverKeys.has(k)).length ? 'the server' : 'the client'} parse. ` +
          'A pin whose floor stopped being found is a pin over a smaller set, and a smaller set passes more easily.',
      );
    }
    const dropped = [...reads].filter((k) => !serverKeys.has(k) && !(k in spec.clientOnly)).sort();
    if (dropped.length) {
      fail(
        `${contract.id}${label} — the released client READS key(s) the server does not send: ${dropped.join(', ')}. ` +
          `(${spec.client.file} vs ${contract.server}.) There is no forced-update mechanism on Windows, macOS or Linux, ` +
          'so "everyone has updated" is never a fact: a field renamed here breaks builds that are already installed.',
      );
    }
    const stray = [...serverKeys].filter((k) => !reads.has(k) && !(k in spec.serverOnly)).sort();
    if (stray.length) {
      fail(
        `${contract.id}${label} — the server SENDS key(s) no client reads and that are not declared server-only: ` +
          `${stray.join(', ')}. B-14 is "adding or changing a field fails the build rather than a shipped app": an ` +
          'undeclared extra is either a field the client was meant to read and does not, or dead weight on every ' +
          'response — and both are decided here, once, rather than discovered per app.',
      );
    }
    return { reads, dropped, stray };
  };

  const top = pinLevel('', shape.success, contract);

  let nestedNote = '';
  if (contract.nested) {
    // The item shape lives inside the value expression of ONE key, so it is read
    // out of that expression's own first balanced literal — never off the file.
    const src = stripSourceComments(read(contract.server), '.ts');
    let itemKeys = null;
    const jsonRe = /\bc\.json\s*\(/g;
    let m;
    while ((m = jsonRe.exec(src)) !== null) {
      const span = balanced(src, m.index + m[0].length - 1);
      if (!span) continue;
      const first = splitTopLevel(span.body)[0] ?? '';
      if (!first.startsWith('{')) continue;
      const objSpan = balanced(first, 0);
      if (!objSpan) continue;
      const member = splitTopLevel(objSpan.body).find((p) => p.startsWith(`${contract.nested.key}:`));
      if (!member) continue;
      const value = member.slice(member.indexOf(':') + 1);
      const open = value.indexOf('{');
      if (open === -1) continue;
      const parsed = objectKeysAt(value, open);
      if (parsed && parsed.keys.length) { itemKeys = parsed; break; }
    }
    if (!itemKeys) {
      coverageLost(
        `${contract.id}: the item shape under \`${contract.nested.key}\` could not be parsed out of ${contract.server}. ` +
          'The list is the part of this response the client actually walks; a top-level pin alone would certify the ' +
          'envelope and say nothing about the rows inside it.',
      );
    }
    if (itemKeys.spreads || itemKeys.unparsed) {
      coverageLost(`${contract.server}: the \`${contract.nested.key}\` item literal has members this scan cannot name.`);
    }
    const nested = pinLevel(`.${contract.nested.key}[]`, new Set(itemKeys.keys), contract.nested);
    nestedNote = `, item ${itemKeys.keys.length} sent / ${nested.reads.size} read`;
  }

  if (contract.request) {
    const spec = contract.request;
    if (!has(spec.client.file)) {
      coverageLost(`${contract.id}: the request half ${spec.client.file} does not exist.`);
    }
    const dart = stripSourceComments(read(spec.client.file), '.dart');
    const at = dart.indexOf(spec.client.marker);
    if (at === -1) {
      coverageLost(`${contract.id}: ${spec.client.file} no longer contains \`${spec.client.marker}\` — the request literal moved.`);
    }
    const open = dart.indexOf('{', at + spec.client.marker.length);
    const parsed = open === -1 ? null : objectKeysAt(dart, open);
    if (!parsed || parsed.keys.length === 0) {
      coverageLost(`${contract.id}: no key was parsed out of the request literal at \`${spec.client.marker}\`.`);
    }
    const sent = parsed.keys.map((k) => k.replace(/^['"]|['"]$/g, ''));
    const missing = spec.keys.filter((k) => !sent.includes(k));
    const extra = sent.filter((k) => !spec.keys.includes(k));
    if (missing.length || extra.length) {
      fail(
        `${contract.id} — the request literal sends {${sent.join(', ')}}, the pinned shape is {${spec.keys.join(', ')}}.`,
      );
    }
    const serverSrc = stripSourceComments(read(contract.server), '.ts');
    const unread = spec.keys.filter((k) => !new RegExp(`(\\.${k}\\b|['"\`]${k}['"\`])`).test(serverSrc));
    if (unread.length) {
      fail(
        `${contract.id} — the client sends request key(s) ${unread.join(', ')} that ${contract.server} never reads. ` +
          'The host would resolve the app from nothing and answer 404 to every cancel attempt from every released build.',
      );
    }
  }

  if (!top.dropped.length && !top.stray.length) {
    wirePinned++;
    ok(
      `wire ${contract.id} — body pinned: ${shape.success.size} key(s) sent / ${top.reads.size} read` +
        `${nestedNote}${contract.request ? `, request {${contract.request.keys.join(', ')}}` : ''}`,
    );
  }
}

console.log(
  `     [4]B-14 — ${WIRE_CONTRACTS.length} shared route(s) from ${WIRE_REGISTER}: ${wirePinned} pinned, ` +
    `${wireGaps} printed gap(s).`,
);

if (failed) {
  console.error('\nassert-analytics-contract: FAILED');
  process.exit(1);
}
console.log(
  `\nassert-analytics-contract: ok — ${TABLES.length} table(s) parsed from ${migrationFiles.length} migration(s), ` +
    `route parity + arity, ${clientKeys.size} client key(s), no address column, append-only across ${serviceFiles.length} service file(s), ` +
    `${wirePinned}/${WIRE_CONTRACTS.length} shared route wire contract(s) pinned + ${wireGaps} printed`,
);
