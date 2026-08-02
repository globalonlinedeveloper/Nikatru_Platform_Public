#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-mor-adapters.mjs — ONE VERIFIER STANDS BETWEEN A PROVIDER AND THE
// ENTITLEMENT TABLE, and the rail reports its own gaps honestly.
//
// [pipeline 5]M-1 · [5]M-14 · [ADR 004] (Paddle / Lemon Squeezy, provider-
// agnostic behind a `MoRWebhookVerifier`) · [ADR 020]:18 (a per-app Worker must
// never see a webhook).
//
// 🔴 THE MISTAKE THIS GUARD IS SHAPED TO AVOID, named because it is this repo's
// most expensive recurring one: a guard scoped to the NEW thing cannot see the
// OLD thing. `services/subly-api/src/routes/webhooks.ts` upserts the SHARED
// `entitlements` table behind a shared bearer secret, and it is deployed. Scope
// this guard to `services/platform` — the obvious choice — and it prints clean
// standing right next to it. So limb 1 enumerates entitlement writes across ALL
// of `services/**` AND the brick template, with a REQUIRED_COVERAGE naming every
// one of them: a scan that stops reaching a Worker is COVERAGE LOST, not a pass.
//
// THREE LIMBS.
//   1 EVERY WRITER OF `entitlements` IS DECLARED AND GATED. An undeclared write
//     anywhere in services/** or the brick fails the build. A declared writer
//     must name its gate, and a gate weaker than a signature must ALSO prove,
//     structurally, that it fails closed on an unset secret — and it is PRINTED
//     on every run, because a legacy exception nobody sees is how a rule becomes
//     a formality.
//   2 THE PROVIDER SET IS DERIVED FROM THE REGISTRY, NEVER FROM A LIST HERE.
//     Registering a rail automatically puts it inside this floor. An EMPTY
//     registry is COVERAGE LOST — "a test per registered provider" over zero
//     providers is a check that cannot fail.
//   3 [5]M-14's TWO HALVES, kept apart. FAIL when a piece of the rail is absent
//     OR PRESENT-BUT-UNCALLED (matched as CALLS, never as bare identifiers, and
//     never in the file that declares it — assert-seams-wired.mjs carries the
//     scar where a check matched its own function's declaration after every
//     caller was deleted). PRINT, never fail, on the owner-gated half: the
//     seller account (OWNER_QUEUE A-1) and the destination secret only the owner
//     can generate. Failing the build on those would block ALL CI on work no
//     agent can do; hiding them would let "finished, waiting on one signup" be
//     indistinguishable from "nothing built", which is the exact defect [5]M-14
//     was rewritten to fix.
//
// Usage:  node tooling/ci/assert-mor-adapters.mjs [repoRoot]
// Exit 0 = the rail is sound (gaps printed), 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const problems = [];
const printed = [];
const fail = (m) => problems.push(m);

/** Roots the entitlement-write scan MUST reach. A missing one is coverage lost,
 *  never a clean run — see the header. */
const REQUIRED_COVERAGE = [
  { dir: 'services/platform', label: 'the shared Worker that owns the money rail' },
  {
    dir: 'services/subly-api',
    label: "the LEGACY app Worker, which upserts the SAME shared table behind a bearer secret and is DEPLOYED — the whole reason this scan is not scoped to services/platform",
  },
  {
    dir: 'tooling/bricks/app/__brick__',
    label: "the brick's service template — [ADR 020]:18, a stamped app's Worker must NEVER see a webhook, and it scales to 50 apps",
  },
];

const REGISTRY = 'services/platform/src/lib/mor/registry.ts';
const CONTRACT = 'services/platform/src/lib/mor/contract.ts';
const ROUTE = 'services/platform/src/routes/money.ts';
const STORE = 'services/platform/src/lib/mor/store.ts';
const TEST_DIR = 'services/platform/test';
const WRANGLER = 'services/platform/wrangler.jsonc';

/**
 * Every file allowed to write the shared `entitlements` table, and HOW its write
 * is gated. Adding a writer means adding an entry here, in the diff, with a
 * reason — which is the point.
 */
const DECLARED_WRITERS = [
  {
    file: 'services/platform/src/lib/mor/store.ts',
    gate: 'signature',
    why: 'the money rail. Reached only from POST /v1/money/:provider, after MoRWebhookVerifier.verify has checked an HMAC over the raw body.',
  },
  {
    file: 'services/subly-api/src/routes/webhooks.ts',
    gate: 'shared_secret',
    why: 'LEGACY. The RevenueCat route, live and deployed, authenticated by a shared bearer secret rather than a signature over the body. A bearer secret proves the sender knows a string; an HMAC proves THIS BODY came from the holder of that string.',
    retire:
      'RevenueCat is the deferred SECOND rail for native store IAP (39-CHASSIS §4 cut 5 defers native mobile; [ADR 004]:30 keeps the rail on the roadmap). It is retired or migrated behind MoRWebhookVerifier when stage 10 takes native IAP off the shelf. Until then it stays, it stays FAIL-CLOSED, and it is printed on every CI run.',
    // The structural property that keeps a weaker gate acceptable: an unset
    // secret must REFUSE, not wave the request through.
    proof: /if\s*\(\s*!\s*configured\s*\)/,
    proofWhat: 'a fail-closed branch on an unset webhook secret',
  },
  {
    // 🔴 FOUND BY THIS GUARD ON ITS FIRST RUN AGAINST THE REAL TREE, and it is
    // the reason limb 1 scans the brick template rather than services/** alone:
    // every app this factory stamps inherits a Worker that deletes rows from the
    // SHARED entitlements table. That is not a money write and it is entirely
    // correct — but it IS a per-app Worker touching the portfolio's money table,
    // which is precisely the class of thing that must be declared rather than
    // discovered.
    file: 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/src/routes/account.ts',
    gate: 'authenticated_erasure',
    why: 'G2 in-app account deletion. It DELETES the calling user\'s own entitlement rows as part of a DPDP erasure — it never grants, never revokes-for-non-payment, and never writes a row. Reached only behind the Supabase JWT middleware, and narrowed to the authenticated subject.',
    retire:
      'NOT scheduled for retirement — erasure is identity, not money ([ADR 020]:57 lists DELETE /v1/account beside the MoR webhook as a separate concern). It is declared here so that a per-app Worker touching the shared money table is a line in a diff rather than something a later reader has to notice.',
    // The structural property: the delete must be narrowed to the authenticated
    // user. An unfiltered DELETE here would empty the portfolio's entitlements.
    proof: /DELETE\s+FROM\s+entitlements\s+WHERE\s+user_id\s*=\s*\?/i,
    proofWhat: 'a DELETE narrowed to `WHERE user_id = ?`',
  },
];

// ── the scan ─────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let entries;
  try { entries = listDir(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === '.wrangler') continue;
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else if (e.endsWith('.ts')) out.push(p);
  }
  return out;
}

const rel = (p) => p.replace(ROOT + sep, '').replaceAll('\\', '/');

/**
 * Blank // and /* comments, KEEPING string and template literals — the SQL being
 * looked for IS a string literal, so stripping strings would strip the subject.
 * Comments are what must go: this file's own header names `INSERT INTO
 * entitlements` in prose, and so does store.ts's.
 */
// 🔴 IT MUST WALK STRING LITERALS, NOT JUST COMMENTS. A naive stripper treats
// the `//` in `'https://x/v1/money/paddle'` as the start of a line comment and
// blanks the rest of the line — which silently deleted the provider name from
// the test corpus (caught while writing this guard's own tests) and, worse,
// would hide an `INSERT INTO entitlements` written after a URL on the same line.
// So string, char and template literals are walked and COPIED THROUGH; only real
// comments are blanked.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2; out += '  ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      i += 2; out += '  ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === quote) { out += src[i]; i++; break; }
        // An unterminated single/double-quoted literal cannot span a newline;
        // bailing keeps one stray apostrophe from swallowing the whole file.
        if (quote !== '`' && src[i] === '\n') break;
        out += src[i];
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Every `it(...)` / `test(...)` call's balanced argument list. The unit of a
 * test is a BLOCK, not a file: two facts in different tests are not one test.
 *
 * ⚠️ `.skip` AND `.todo` ARE EXCLUDED. A skipped test is text, not evidence —
 * mutation-proven 2026-08-01: with the whole [5]M-12 suite changed to
 * `describe.skip`, a text scan still "found" the assertions it had stopped
 * running. `describe.skip` is caught separately, by refusing it outright.
 */
function testBlocks(src) {
  const out = [];
  if (/\bdescribe\s*\.\s*(?:skip|todo)\s*\(/.test(src)) return out;
  for (const m of src.matchAll(/\b(?:it|test)(?!\s*\.\s*(?:skip|todo))\s*\(/g)) {
    const open = src.indexOf('(', m.index);
    let depth = 0;
    for (let k = open; k < src.length; k++) {
      if (src[k] === '(') depth++;
      else if (src[k] === ')') {
        depth--;
        if (depth === 0) { out.push(src.slice(open, k + 1)); break; }
      }
    }
  }
  return out;
}

const scanned = [];
for (const { dir, label } of REQUIRED_COVERAGE) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) {
    fail(`COVERAGE LOST — ${dir} does not exist (${label}). The scan cannot reach it, so any entitlement write inside it is invisible and this guard would still print ok.`);
    continue;
  }
  const files = walk(abs);
  if (files.length === 0) {
    fail(`COVERAGE LOST — no .ts files found under ${dir} (${label}). The scan is broken, not the tree.`);
    continue;
  }
  for (const f of files) scanned.push({ rel: rel(f), abs, dir });
}
if (scanned.length === 0) {
  console.error('✗ COVERAGE LOST — the entitlement-write scan reached ZERO files. Every limb below would pass over nothing.');
  process.exit(1);
}

/** SQL that WRITES the shared entitlements table. */
const WRITE_RE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+entitlements\b/i;

const writers = new Map(); // rel -> statements found
for (const f of scanned) {
  // Tests are excluded: a test that writes the table directly is a fixture, not
  // a production path, and forbidding it would ban the only way to assert what
  // a read route does with a row it did not write.
  if (/(^|\/)test\//.test(f.rel) || f.rel.endsWith('.test.ts')) continue;
  const code = stripComments(readFileSync(join(ROOT, f.rel), 'utf8'));
  if (WRITE_RE.test(code)) writers.set(f.rel, (code.match(new RegExp(WRITE_RE, 'gi')) ?? []).length);
}

// ── LIMB 1 · every writer is declared, and its gate is real ──────────────────
const declaredByFile = new Map(DECLARED_WRITERS.map((w) => [w.file, w]));
for (const [file] of writers) {
  const decl = declaredByFile.get(file);
  if (!decl) {
    fail(
      `${file} WRITES the shared \`entitlements\` table and is NOT declared in DECLARED_WRITERS. ` +
        '[5]M-1: exactly one verifier stands between a provider and this table. A new write path is a new door — ' +
        'declare it with the gate that protects it, or route it through services/platform/src/lib/mor/store.ts.',
    );
  }
}
for (const w of DECLARED_WRITERS) {
  if (!writers.has(w.file)) {
    fail(
      `DECLARED_WRITERS names \`${w.file}\`, which no longer writes \`entitlements\` (or no longer exists). ` +
        'A stale entry inflates apparent coverage and its gate claim can never fail. Remove it.',
    );
    continue;
  }
  if (w.gate === 'signature') continue;
  // A gate weaker than a signature has to earn its place, every run.
  const src = readFileSync(join(ROOT, w.file), 'utf8');
  if (w.proof && !w.proof.test(stripComments(src))) {
    fail(
      `${w.file} is declared with the weaker \`${w.gate}\` gate, and ${w.proofWhat} could not be found in it. ` +
        'A gate weaker than a signature is only tolerable while the property that makes it safe is still there; ' +
        'without it, the declaration is a claim about code that no longer holds.',
    );
    continue;
  }
  printed.push(
    `⚠  ${w.file} — WRITES entitlements behind a \`${w.gate}\` gate, not a signature. ${w.why} RETIREMENT: ${w.retire}`,
  );
}

// ── LIMB 2 · the provider set comes from the registry ────────────────────────
const registryPath = join(ROOT, REGISTRY);
let providers = [];
if (!existsSync(registryPath)) {
  fail(`COVERAGE LOST — ${REGISTRY} does not exist, so the provider set is empty and limb 2 asserts nothing.`);
} else {
  const registry = stripComments(readFileSync(registryPath, 'utf8'));
  const arr = /MOR_VERIFIERS\s*:\s*readonly\s+MoRWebhookVerifier\[\]\s*=\s*\[([^\]]*)\]/.exec(registry);
  const idents = arr ? [...arr[1].matchAll(/([A-Za-z_$][\w$]*)Verifier/g)].map((m) => m[1]) : [];
  providers = [...new Set(idents)];
  if (providers.length === 0) {
    fail(
      `COVERAGE LOST — ${REGISTRY} registers ZERO verifiers. [5]M-1's "a test per registered provider" over an ` +
        'empty provider set is a check that cannot fail, which is how the original acceptance criterion passed on ' +
        'a repo with no rail at all.',
    );
  }
}

const testFiles = existsSync(join(ROOT, TEST_DIR))
  ? listDir(join(ROOT, TEST_DIR)).filter((f) => f.endsWith('.test.ts'))
  : [];
const testCorpus = new Map(
  testFiles.map((f) => [f, stripComments(readFileSync(join(ROOT, TEST_DIR, f), 'utf8'))]),
);
if (testCorpus.size === 0) {
  fail(`COVERAGE LOST — no test files under ${TEST_DIR}, so "every registered provider has a passing tampered-body test" ranges over nothing.`);
}

// ── LIMB 2b · every registered rail has a LEGAL row ─────────────────────────
// 🔴 THIS LIMB EXISTS BECAUSE THE MONEY ROUTE IS PARAMETERISED. [8]K-5's
// route-segment check in tooling/ci/assert-policy-claims.mjs turns the build red
// when a NEW payment webhook lands as a literal path segment — `/paddle`,
// `/stripe`, `/lemonsqueezy`. This rail mounts `POST /v1/money/:provider`, and
// that check drops `:param` segments by design, so adding a second rail tomorrow
// would add no literal segment and K-5 would not fire.
//
// That is not a hole to be noted in a comment; it is an obligation to be moved.
// The provider set is DATA here, in MOR_VERIFIERS, so the guard that owns that
// set is the one that can enforce it: a merchant of record is the LEGAL SELLER,
// and a rail this repo can verify a signature from, with no row in the legal
// register, is a seller nobody has decided how to disclose.
const LEGAL_REGISTER = 'tooling/legal/provider-register.json';
{
  const legalPath = join(ROOT, LEGAL_REGISTER);
  if (!existsSync(legalPath)) {
    fail(
      `COVERAGE LOST — ${LEGAL_REGISTER} does not exist, so "every registered rail has a legal row" ranges over ` +
        'nothing. The disclosure obligation for a merchant of record would be enforced by neither guard.',
    );
  } else {
    let legal;
    try {
      legal = JSON.parse(readFileSync(legalPath, 'utf8'));
    } catch (err) {
      fail(`COVERAGE LOST — ${LEGAL_REGISTER} is not valid JSON (${err.message}), so no row could be matched.`);
      legal = { providers: [] };
    }
    const rows = Array.isArray(legal.providers) ? legal.providers : [];
    if (rows.length === 0 && providers.length > 0) {
      fail(`COVERAGE LOST — ${LEGAL_REGISTER} declares zero providers, so every membership check below passes over an empty set.`);
    }
    const known = new Set();
    for (const row of rows) {
      if (typeof row?.id === 'string') known.add(row.id.replace(/[^a-z0-9]/gi, '').toLowerCase());
      for (const t of row?.tells ?? []) {
        if (typeof t === 'string') known.add(t.replace(/[^a-z0-9]/gi, '').toLowerCase());
      }
    }
    for (const p of providers) {
      if (!known.has(p.replace(/[^a-z0-9]/gi, '').toLowerCase())) {
        fail(
          `registered rail \`${p}\` has NO row in ${LEGAL_REGISTER}. A merchant of record is the LEGAL SELLER of ` +
            'every purchase it processes, and terms/refund/privacy have to name it. [8]K-5 catches a new payment ' +
            'webhook that arrives as a literal route segment; this rail is mounted at /v1/money/:provider, so a new ' +
            'provider adds no segment and that check cannot see it. Add the row — including a disclosure gap if the ' +
            'pages do not name it yet.',
        );
      }
    }
  }
}

for (const p of providers) {
  const adapter = `services/platform/src/lib/mor/${p}.ts`;
  if (!existsSync(join(ROOT, adapter))) {
    fail(`registered provider \`${p}\` has no adapter at ${adapter}. The registry names a rail whose facts live nowhere.`);
    continue;
  }
  const src = stripComments(readFileSync(join(ROOT, adapter), 'utf8'));
  for (const method of ['verify', 'parse']) {
    if (!new RegExp(`\\b(?:async\\s+)?${method}\\s*\\(`).test(src)) {
      fail(`adapter ${adapter} does not implement \`${method}\`. A verifier that cannot ${method} is a registry entry, not a rail.`);
    }
  }
  // THE TAMPERED-BODY TEST — scoped to ONE test block, not to the file.
  //
  // 🔴 THE FIRST VERSION OF THIS CHECK COULD NOT FAIL, and the mutation run
  // proved it: "the file mentions `tamper` and the file mentions 401" stayed
  // true after the tampered-body test was renamed away, because the words
  // survive anywhere in a 500-line suite. What is asserted now is structural and
  // is the thing itself: a SINGLE `it(...)`/`test(...)` block that BOTH alters
  // the signed body AND expects the rejection status. A block is the unit,
  // because two facts in one file are not one test.
  const named = [...testCorpus].filter(([, body]) => body.includes(`${p}Verifier`) || body.includes(`'${p}'`) || body.includes(`/${p}`));
  if (named.length === 0) {
    fail(`registered provider \`${p}\` is named by no test under ${TEST_DIR}. Its rejection path has never run.`);
    continue;
  }
  const proven = named.some(([, body]) =>
    testBlocks(body).some(
      (b) => /\b401\b/.test(b) && /\.replace\s*\(/.test(b) && /\bexpect\s*\(/.test(b),
    ),
  );
  if (!proven) {
    fail(
      `registered provider \`${p}\` has tests, but NO SINGLE test block both alters a signed body and expects 401. ` +
        '[5]M-1: the assertion the whole rail rests on is that a body altered after signing is REFUSED — without it, ' +
        'anyone who finds the URL can grant themselves Pro. Two facts scattered across a file are not that test.',
    );
  }
}

// ── LIMB 3 · [5]M-14, the two halves ─────────────────────────────────────────
/**
 * Is `symbol` CALLED somewhere other than the file that declares it? Matched as
 * a call, and the declaring file is excluded — assert-seams-wired.mjs:64-73
 * records what happens otherwise: a check that matched its own function's
 * declaration kept passing after every real caller was deleted.
 */
function calledOutside(symbol, declaringFile, candidates) {
  const callRe = new RegExp(`\\b${symbol}\\s*\\(`);
  return candidates.filter((f) => {
    if (f.rel === declaringFile) return false;
    if (/(^|\/)test\//.test(f.rel) || f.rel.endsWith('.test.ts')) return false;
    return callRe.test(stripComments(readFileSync(join(ROOT, f.rel), 'utf8')));
  });
}

const PIECES = [
  {
    symbol: 'verifierFor',
    declaredIn: REGISTRY,
    what: 'the MoR verifier registry — [5]M-1, the one door between a provider and the entitlement table',
  },
  {
    symbol: 'persistNotification',
    declaredIn: STORE,
    what: '[5]M-2, the verbatim notification store. Present-but-uncalled means the rail acks money it never recorded',
  },
  {
    symbol: 'deriveAndApply',
    declaredIn: STORE,
    what: '[5]M-2/M-3, the entitlement derivation. Present-but-uncalled means a payment is filed and never honoured',
  },
];
for (const piece of PIECES) {
  if (!existsSync(join(ROOT, piece.declaredIn))) {
    fail(`${piece.declaredIn} is ABSENT — ${piece.what}.`);
    continue;
  }
  const callers = calledOutside(piece.symbol, piece.declaredIn, scanned);
  if (callers.length === 0) {
    fail(
      `\`${piece.symbol}\` is declared in ${piece.declaredIn} and CALLED BY NOTHING outside it. ${piece.what}. ` +
        '[5]M-14: a rail that is built and inert certifies itself green — a fail-closed seam with no proven open path ' +
        'is a dead feature that reports healthy.',
    );
  }
}
if (!existsSync(join(ROOT, CONTRACT))) {
  fail(`${CONTRACT} is ABSENT — [ADR 004] specifies the MoRWebhookVerifier interface by name; without it there is no seam to swap providers behind.`);
} else if (!/interface\s+MoRWebhookVerifier\b/.test(readFileSync(join(ROOT, CONTRACT), 'utf8'))) {
  fail(`${CONTRACT} no longer declares \`interface MoRWebhookVerifier\`. [ADR 004] locks the provider-agnostic shape; without the interface, per-provider adapters are just files.`);
}

// The entrypoint must MOUNT both ends of the rail — the door money comes in
// through, and the door an app reads the result out of. A verifier nothing
// routes to is a library; an entitlement nothing can read is a database row.
{
  const indexPath = 'services/platform/src/index.ts';
  const idx = existsSync(join(ROOT, indexPath)) ? stripComments(readFileSync(join(ROOT, indexPath), 'utf8')) : '';
  if (!/app\.route\(\s*['"`]\/v1\/money['"`]\s*,\s*money\s*\)/.test(idx)) {
    fail(
      `${indexPath} does not mount the money router at /v1/money. [ADR 020]:18 puts the webhook on the SHARED host; ` +
        'an unmounted route is a rail no provider can reach.',
    );
  }
  // 🔴 [5]M-4 WAS A PRINTED "BLOCKED" GAP HERE UNTIL STAGE 4'S [4]B-3 LANDED
  // `platformAuth` ON THIS WORKER. The moment the blocker cleared, a printed gap
  // became a lie that prints on every run — so it is a FAILING LIMB now. This is
  // [5]M-14's third piece: the shared entitlement route must be present AND
  // reachable, because a rail that can take money and cannot tell an app the
  // user paid is only half a rail.
  const ENTITLEMENTS_ROUTE = 'services/platform/src/routes/entitlements.ts';
  if (!existsSync(join(ROOT, ENTITLEMENTS_ROUTE))) {
    fail(
      `${ENTITLEMENTS_ROUTE} is ABSENT — [5]M-4. The brick's DEFAULT stamp is CLIENT-ONLY, so without this route ` +
        'every app the factory stamps has no way to ask whether its user paid, and the only working entitlement read ' +
        'in the repo is inside one legacy app that happens to have a backend.',
    );
  } else if (!/app\.route\(\s*['"`]\/v1['"`]\s*,\s*entitlements\s*\)/.test(idx)) {
    fail(
      `${indexPath} does not mount the shared entitlement read at /v1/entitlements. [5]M-4 — an unmounted route is ` +
        'a row nobody can read.',
    );
  } else if (!/app\.use\(\s*['"`]\/v1\/entitlements['"`]\s*,\s*platformAuth\s*\)/.test(idx)) {
    // The scoping limb the whole shared-table design rests on starts here: an
    // unauthenticated entitlement read has no `user_id` to scope by.
    fail(
      `${indexPath} mounts /v1/entitlements WITHOUT platformAuth. [5]M-4's first replacement criterion is that an ` +
        'unauthenticated request returns 401 SPECIFICALLY — and an unauthenticated read of a per-user table has no ' +
        'subject to scope by, so it would answer for everybody or for nobody.',
    );
  }
}

// ── the OWNER-GATED half — PRINTED, NEVER FAILED ─────────────────────────────
// Copied in shape from assert-seams-wired.mjs's pack-verifier split. Half (a) is
// the agent's and is asserted above; half (b) is the owner's and can only be
// reported, or every CI run blocks on a signup no agent can perform.
{
  const wrangler = existsSync(join(ROOT, WRANGLER)) ? readFileSync(join(ROOT, WRANGLER), 'utf8') : '';
  // The secret must NOT be a committed var — that half IS a failure.
  if (/"PADDLE_NOTIFICATION_SECRET"\s*:/.test(wrangler)) {
    fail(
      `${WRANGLER} declares PADDLE_NOTIFICATION_SECRET as a committed var. It is a SECRET: \`wrangler secret put\`, ` +
        'never a var in a file this public repository tracks.',
    );
  }
  printed.push(
    '⬜ MONEY RAIL — OWNER-GATED HALF, printed on every run so "finished, waiting on one signup" can never look like "nothing built":',
  );
  printed.push(
    '     · NO PROVIDER ACCOUNT YET. OWNER_QUEUE A-1 (Paddle + Lemon Squeezy seller signup, KYC, Indian bank/Wise payout) is PENDING, ' +
      'and upstream of it OWNER_QUEUE D-5 (SBI current account in the trade name) is decided but not opened — Paddle KYC needs the ' +
      'account name to match the registered business.',
  );
  printed.push(
    '     · NO DESTINATION SECRET. PADDLE_NOTIFICATION_SECRET can only be generated in the Paddle seller console. Until it is set with ' +
      '`wrangler secret put`, POST /v1/money/paddle answers 503 and NO money can be accepted. The rail is otherwise complete: routes, ' +
      'verifier, verbatim store, ordering, attribution and the entitlement contract are built and tested against fixtures.',
  );
  printed.push(
    '     · [ADR 004] 2026-07-24 — applying BEFORE a reviewable product with a live paywall and complete legal pages exists is the main ' +
      'documented cause of hold or rejection. The sequencing is deliberate, not a delay.',
  );
  printed.push(
    '⬜ THE LEGACY REVENUECAT RAIL WRITES NO `provider_environment`, so any row it writes is UNDECIDABLE and the shared read denies it ' +
      '([5]M-12, fail closed). That is safe today — `entitlements` has never held a row and native IAP is deferred with native mobile ' +
      '(39-CHASSIS §4 cut 5) — and it is a REQUIREMENT on whoever un-defers that rail: set the column, or every purchase it records is inert.',
  );
}

// ── report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ MoR adapters — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [5]M-1 one verifier between a provider and the entitlement table ·');
  console.error('  [5]M-14 the rail is green with no provider account, WITHOUT certifying an empty rail ·');
  console.error('  [ADR 004] provider-agnostic behind MoRWebhookVerifier · [ADR 020]:18 no webhook in a per-app Worker.');
  process.exit(1);
}

for (const line of printed) console.log(line);
console.log(
  `ok  MoR adapters — ${scanned.length} file(s) scanned across ${REQUIRED_COVERAGE.length} tree(s); ` +
    `${writers.size} entitlements writer(s), all declared and gated; ${providers.length} registered provider(s), ` +
    `each with an adapter and a tampered-body rejection test; ${PIECES.length} rail piece(s) present AND called`,
);
