#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-session-revocation.mjs — every Worker that verifies a Supabase token
// also refuses a SIGNED-OUT session's token, and the revocation record lives
// exactly as long as the longest token it can refuse.
//
// ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS. Signing a session out deletes its row
// in `auth.sessions`, which stops the NEXT refresh — and does nothing to the
// access token already issued, which every Worker keeps admitting on its
// signature alone for up to `jwt_exp` (3600 s). The fix is a revocation list in
// ONE shared KV namespace (SESSION_REVOKED, key `rev:<sub>`), read after
// `jwtVerify` in every auth middleware; the decision is `revocationRefusal` in
// services/_shared/src/auth.ts.
//
// The failure this guard exists for is QUIET: a Worker added later (or stamped
// from the brick) that verifies tokens but never consults the list. Nothing
// breaks — it simply keeps admitting signed-out sessions — and because the
// middleware FAILS OPEN when the binding is absent (deliberately: a KV incident
// must not become a portfolio-wide 401), a config that forgot the binding is
// equally silent at runtime. So both are made CI reds here instead.
//
//   limb 1  CARRIERS. Every non-test `.ts` under `services/*/src/**` and under
//           the brick's stamped Worker (`tooling/bricks/**/src/**`) whose CODE
//           calls `jwtVerify(` — derived, never listed — must import
//           `revocationRefusal` from services/_shared/src/auth, call it, read
//           `env.SESSION_REVOKED`, and sit under a `wrangler.jsonc` whose
//           `kv_namespaces` binds SESSION_REVOKED.
//   limb 2  THE TTL. `REVOCATION_TTL_SECONDS` must equal `jwt_exp`
//           (tooling/mail-transport.json → supabaseAuth.jwt_exp, the value read
//           back from the live project) + `CLOCK_SKEW_SECONDS`. Shorter, and a
//           record expires while a token it refuses is still inside its `exp`;
//           the constant carries `@ceiling none`, so nothing else holds it.
//
// Exit codes: 0 green · 1 a finding · 2 COVERAGE LOST (no carrier found in a
// root that must have one, or a limb-2 input could not be read) — "did not
// check enough to be evidence", never a pass.
//
// Usage:  node tooling/ci/assert-session-revocation.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { boundedGlob } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const SHARED_AUTH = 'services/_shared/src/auth.ts';
const MAIL_TRANSPORT = 'tooling/mail-transport.json';
const BINDING = 'SESSION_REVOKED';

/** Vendored code and build output are not part of the tree under test. */
const EXCLUDED_SEGMENTS = new Set([
  'node_modules', '.git', '.dart_tool', '.wrangler', 'build', 'dist', 'coverage', '.next', 'out',
]);

const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};

const toPosix = (p) => String(p).replaceAll('\\', '/');
const readCode = (rel) => stripSourceComments(readFileSync(join(ROOT, rel), 'utf8'), '.ts');
const jsoncParse = (text) => JSON.parse(stripSourceComments(text, '.ts').replace(/,(\s*[}\]])/g, '$1'));
const isTest = (rel) => /(?:^|\/)test\//.test(rel) || /\.(?:test|spec)\.ts$/.test(rel) || rel.endsWith('.d.ts');

if (!existsSync(join(ROOT, 'services'))) {
  coverageLost([
    `${join(ROOT, 'services')} does not exist, so the carrier walk ranged over nothing.`,
    'Limb 1 quantifies over the Workers that verify a token; with none found it is vacuously green.',
  ]);
}

// ── limb 1: the carriers, DERIVED from who calls jwtVerify ──────────────────
const LIVE = 'services/';
const TEMPLATE = 'tooling/bricks/';
const candidates = new Set();
for (const pattern of ['services/*/src/**/*.ts', 'tooling/bricks/**/src/**/*.ts']) {
  for await (const match of boundedGlob(pattern, { cwd: ROOT })) {
    const rel = toPosix(match);
    if (rel.split('/').some((seg) => EXCLUDED_SEGMENTS.has(seg))) continue;
    if (isTest(rel)) continue;
    candidates.add(rel);
  }
}

const carriers = [...candidates].filter((rel) => /\bjwtVerify\s*\(/.test(readCode(rel))).sort();
const liveCarriers = carriers.filter((r) => r.startsWith(LIVE));
const templateCarriers = carriers.filter((r) => r.startsWith(TEMPLATE));

if (liveCarriers.length === 0) {
  coverageLost([
    `no file under services/*/src calls jwtVerify( — read ${candidates.size} candidate file(s).`,
    'Every Worker behind a sign-in verifies a token; finding none means the walk missed them (a moved',
    'directory, a renamed call), and "every carrier consults the revocation list" would be true of nothing.',
  ]);
}
// The brick ships a backend with an auth middleware. A template root that holds
// a Worker config but no carrier is a walk that stopped reaching the template.
let templateHasWorker = false;
for await (const match of boundedGlob('tooling/bricks/**/wrangler.jsonc', { cwd: ROOT })) {
  if (!toPosix(match).split('/').some((seg) => EXCLUDED_SEGMENTS.has(seg))) templateHasWorker = true;
}
if (templateHasWorker && templateCarriers.length === 0) {
  coverageLost([
    'the brick carries a Worker (a wrangler.jsonc under tooling/bricks/) but no template file calls jwtVerify(.',
    'Every app stamped from it would inherit an auth middleware this guard never read.',
  ]);
}

/** The nearest `wrangler.jsonc` at or above the carrier's directory, inside ROOT. */
function configFor(rel) {
  let dir = dirname(rel);
  while (dir && dir !== '.' && dir !== '/') {
    const candidate = `${dir}/wrangler.jsonc`;
    if (existsSync(join(ROOT, candidate))) return candidate;
    dir = dirname(dir);
  }
  return null;
}

const problems = [];
for (const rel of carriers) {
  const code = readCode(rel);
  const bare = stripStringLiterals(code);
  const imports = [...code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)];
  const imported = imports.some(
    ([, names, from]) => /_shared\/src\/auth$/.test(from) && /(?:^|[\s,])revocationRefusal(?:\s*[,}]|\s*$)/.test(names),
  );
  // A CALL outside the import line: strip the imports, then look for `name(`.
  const body = bare.replace(/import\s*(?:type\s*)?\{[^}]*\}\s*from\s*[^;\n]+;?/g, '');
  const called = /\brevocationRefusal\s*\(/.test(body);
  const reads = new RegExp(String.raw`\benv\s*\.\s*${BINDING}\b`).test(bare);
  if (!imported) problems.push(`${rel}: calls jwtVerify( but does not import revocationRefusal from services/_shared/src/auth.`);
  if (!called) problems.push(`${rel}: calls jwtVerify( but never calls revocationRefusal( — a signed-out session's token is admitted here.`);
  if (!reads) problems.push(`${rel}: calls jwtVerify( but never reads env.${BINDING}, so the list it would consult is never fetched.`);

  const cfg = configFor(rel);
  if (cfg === null) {
    problems.push(`${rel}: no wrangler.jsonc at or above it, so nothing shows the Worker binds ${BINDING}.`);
    continue;
  }
  let parsed;
  try {
    parsed = jsoncParse(readFileSync(join(ROOT, cfg), 'utf8'));
  } catch (err) {
    problems.push(`${cfg}: does not parse as JSONC (${err instanceof Error ? err.message : err}), so its ${BINDING} binding cannot be read.`);
    continue;
  }
  const kv = Array.isArray(parsed?.kv_namespaces) ? parsed.kv_namespaces : [];
  if (!kv.some((k) => k?.binding === BINDING && typeof k?.id === 'string' && k.id !== '')) {
    problems.push(
      `${cfg}: kv_namespaces does not bind ${BINDING}, and ${rel} verifies tokens under it — the middleware would fail OPEN on every request (auth_revocation_binding_missing).`,
    );
  }
}

// ── limb 2: the record lives exactly as long as the longest token it refuses ─
const numberOf = (code, name) => {
  const m = code.match(new RegExp(String.raw`\bconst\s+${name}\s*(?::\s*number\s*)?=\s*([0-9][0-9_]*)\s*;`));
  return m ? Number(m[1].replaceAll('_', '')) : null;
};
if (!existsSync(join(ROOT, SHARED_AUTH))) {
  coverageLost([`${SHARED_AUTH} does not exist, so REVOCATION_TTL_SECONDS could not be read.`]);
}
const shared = readCode(SHARED_AUTH);
const ttl = numberOf(shared, 'REVOCATION_TTL_SECONDS');
const skew = numberOf(shared, 'CLOCK_SKEW_SECONDS');
let jwtExp = null;
try {
  jwtExp = JSON.parse(readFileSync(join(ROOT, MAIL_TRANSPORT), 'utf8'))?.supabaseAuth?.jwt_exp ?? null;
} catch {
  jwtExp = null;
}
const unread = [
  ttl === null && `REVOCATION_TTL_SECONDS (a numeric literal in ${SHARED_AUTH})`,
  skew === null && `CLOCK_SKEW_SECONDS (a numeric literal in ${SHARED_AUTH})`,
  !Number.isFinite(jwtExp) && `supabaseAuth.jwt_exp (a number in ${MAIL_TRANSPORT})`,
].filter(Boolean);
if (unread.length) {
  coverageLost([
    `limb 2 could not read ${unread.join(' and ')}.`,
    'Without all three the TTL relation is unchecked, and a revocation record could expire while a token',
    'it refuses is still inside its exp.',
  ]);
}
if (ttl !== jwtExp + skew) {
  problems.push(
    `${SHARED_AUTH}: REVOCATION_TTL_SECONDS is ${ttl}, but jwt_exp (${jwtExp}, ${MAIL_TRANSPORT}) + CLOCK_SKEW_SECONDS (${skew}) is ${jwtExp + skew}. ` +
      (ttl < jwtExp + skew
        ? 'A record would EXPIRE while a token it refuses is still valid, re-admitting a signed-out session.'
        : 'Records would outlive every token they can refuse — harmless, but the constant no longer means what its comment says.'),
  );
}

if (problems.length) {
  console.error(`✗ assert-session-revocation: ${problems.length} finding(s).`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(
  `✓ assert-session-revocation: ${carriers.length} carrier(s) (${liveCarriers.length} live, ${templateCarriers.length} template) ` +
    `import and call revocationRefusal and bind ${BINDING}; REVOCATION_TTL_SECONDS ${ttl} = jwt_exp ${jwtExp} + skew ${skew}.`,
);
