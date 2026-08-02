#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-platform-register.mjs — the SHARED SERVER must know what it provides.
//
// [pipeline B-1] company/pipeline/04-backend-platform.md — "the factory declares,
// in one machine-readable place, every capability the shared server provides …
// and a capability with no client is not counted as delivered."
// [pipeline B-18] — "one shared bucket, and every bound bucket has a reader."
// [pipeline B-13] — the residual limb: an unauthenticated route with no limiter
//                   must SAY why, rather than simply not having one.
//
// WHY. This is assert-capability-register.mjs pointed at the server instead of at
// packages/. Six other stage-4 requirements quantify over "the shared capability
// set" or "every binding", and an undefined right-hand side rejects nothing — so
// all six were green over the empty set.
//
// 🔴 THE THREE WAYS THE ORIGINAL ACCEPTANCE CRITERION COULD NOT FAIL, and what
// replaced each:
//
//   1. "…or a register entry declares no client" is FIELD PRESENCE. `"client":
//      "TBD"` satisfies it, which is precisely the condition B-1 exists to
//      detect. Replaced by RESOLUTION: every `client.expression` must appear in
//      comment-stripped source, in a file outside the serving Worker, and must
//      itself contain the route's own static path — so it cannot be satisfied by
//      the server's declaration of the route and cannot outlive a rename.
//   2. It ranged over ROUTES ONLY, so it could not see the violation that was
//      live in production: `services/subly-api` bound a per-app R2 bucket
//      (`EXPORTS` → `subly-exports`, created 2026-07-17) whose only occurrence
//      anywhere in `services/**/*.ts` was its own type declaration. Limb 3 makes
//      bindings first-class, and requires a READER that is not the Env type.
//   3. Its coverage was implicit. Here both floors are RELATIONSHIPS derived from
//      files CI already parses: the route set EQUALS what index.ts mounts, and
//      the binding set EQUALS what the wrangler configs declare. There is no
//      tuned integer to lower — the only integers are self-checks that the
//      PARSER still finds anything at all.
//
// ⚠️ A ROUTE WITH NO CLIENT DOES NOT FAIL THE BUILD; IT PRINTS, ON EVERY RUN.
// Same shape as assert-capability-register.mjs:412-424 and assert-seams-wired's
// owner-gated posture. `GET /v1/health` genuinely has no programmatic caller
// today, and failing the build on a gap that a different stage closes would
// block all CI on work this increment may not do. An UNDECLARED gap still fails.
//
// Usage:  node tooling/ci/assert-platform-register.mjs [repoRoot]
// Exit 0 = the register and the tree agree, 1 = they do not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'platform-register.json');
const SERVICES_DIR = join(ROOT, 'services');
const BRICK_SERVICES_GLOB = join(ROOT, 'tooling', 'bricks', 'app', '__brick__');

/** Bindings live under these keys. `ratelimits` uses `name`, not `binding` — a
 *  binding-only scan cannot see EVENTS_LIMITER, which is exactly the blind spot
 *  assert-vendor-portability.mjs's _why paragraph already records. */
const BINDING_KEYS = [
  ['d1_databases', 'binding'],
  ['kv_namespaces', 'binding'],
  ['r2_buckets', 'binding'],
  ['ratelimits', 'name'],
];

/** The limiter helpers a public route must reach. Derived from the tree in the
 *  sense that both are exported by services/platform/src/lib/edge-ceiling.ts;
 *  named here because a guard cannot guess which function means "bounded". */
const LIMITER_CALLS = ['withinRateLimit', 'withinEdgeCeiling'];

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

const rel = (p) => posix.normalize(p.replace(/\\/g, '/'));

// ── JSONC → JSON ─────────────────────────────────────────────────────────────
// Comments are STRIPPED before parsing, never scanned: this repo has already
// shipped a guard whose `grep '"r2_buckets"'` matched the template comment
// EXPLAINING why there is no r2_buckets. String literals are respected so a `//`
// inside a url is not mistaken for a comment.
function parseJsonc(text, where) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch (err) {
    fail([`✗ ${where} — could not be parsed after stripping comments: ${err.message}`]);
  }
}

/**
 * Blank comments in TS/Dart source, preserving offsets. Strings are KEPT because
 * every route path and every client URL IS a string literal — the thing being
 * matched. That is why the client rule additionally requires the expression to
 * live outside the serving Worker: keeping strings means a doc comment is the
 * only false positive available, and comments are what this strips.
 */
function stripComments(src, { alsoStrings = false } = {}) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2; out += '  ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += blank(src[i]); i++; }
      i += 2; out += '  ';
      continue;
    }
    if (alsoStrings && (c === "'" || c === '"' || c === '`')) {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        if (q !== '`' && src[j] === '\n') break;
        j++;
      }
      for (const ch of src.slice(i, j)) out += blank(ch);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The balanced `(...)` starting at `open`, or '' — used to scope a check to ONE
 *  route handler instead of to the whole file. Without it, a new unlimited route
 *  added beside a limited one in the same file passes on its sibling's limiter. */
function balanced(src, open) {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '(') depth++;
    else if (src[k] === ')') { depth--; if (depth === 0) return src.slice(open, k + 1); }
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE MOUNT PARSER — structural, following app.route() into each sub-router.
// Grepping for a path string would match the header comment at the top of
// index.ts, which lists three of these routes in prose.
// ─────────────────────────────────────────────────────────────────────────────
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];

function honoIdent(code) {
  const m = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Hono\b/.exec(code);
  return m ? m[1] : null;
}

/** `import <ident> from '<spec>'` → repo-relative .ts path, resolved from `from`. */
function resolveDefaultImport(code, ident, fromFileRel) {
  const re = new RegExp(`import\\s+${ident}\\s+from\\s+['"]([^'"]+)['"]`);
  const m = re.exec(code);
  if (!m) return null;
  const spec = m[1];
  if (!spec.startsWith('.')) return null;
  return rel(posix.join(posix.dirname(fromFileRel), `${spec}.ts`));
}

const parseNotes = [];

/** Returns [{ method, path, owningFile, handler }] mounted at `prefix`. */
function mountedRoutes(fileRel, prefix, seen = new Set()) {
  if (seen.has(fileRel)) return [];
  seen.add(fileRel);
  const abs = join(ROOT, fileRel);
  if (!existsSync(abs)) {
    parseNotes.push(`route file ${fileRel} does not exist`);
    return [];
  }
  const code = stripComments(readFileSync(abs, 'utf8'));
  const id = honoIdent(code);
  if (!id) {
    parseNotes.push(`${fileRel} declares no \`new Hono\` instance — the parser found nothing to walk`);
    return [];
  }
  const out = [];

  const methodRe = new RegExp(`\\b${id}\\s*\\.\\s*(${METHODS.join('|')})\\s*\\(\\s*(['"\`])([^'"\`]*)\\2`, 'g');
  for (const m of code.matchAll(methodRe)) {
    const openParen = code.indexOf('(', m.index + id.length);
    out.push({
      method: m[1].toUpperCase(),
      path: rel(posix.join(prefix || '/', m[3])),
      owningFile: fileRel,
      handler: balanced(code, openParen),
    });
  }

  const routeRe = new RegExp(`\\b${id}\\s*\\.\\s*route\\s*\\(\\s*(['"\`])([^'"\`]*)\\1\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\)`, 'g');
  for (const m of code.matchAll(routeRe)) {
    const sub = resolveDefaultImport(code, m[3], fileRel);
    if (!sub) {
      parseNotes.push(`${fileRel} mounts \`${m[3]}\` at ${m[2]} but no default import resolves it`);
      continue;
    }
    out.push(...mountedRoutes(sub, rel(posix.join(prefix || '/', m[2])), seen));
  }
  return out;
}

// ── 0. the register ──────────────────────────────────────────────────────────
if (!existsSync(REGISTER)) {
  fail([
    `✗ COVERAGE LOST — no platform register at ${REGISTER}.`,
    '  [pipeline B-1] requires a machine-readable register of every shared-server capability.',
  ]);
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (err) {
  fail([`✗ platform register is not valid JSON: ${err.message}`]);
}

const serving = register.servingWorker ?? {};
if (!serving.entrypoint) fail(['✗ platform register declares no `servingWorker.entrypoint` — limb 1 has no subject.']);
const routes = Array.isArray(register.routes) ? register.routes : null;
if (!routes) fail(['✗ platform register has no `routes` array — nothing to enforce.']);
const bindings = Array.isArray(register.bindings) ? register.bindings : null;
if (!bindings) fail(['✗ platform register has no `bindings` array — [B-18] could never fail.']);
const declaredConfigs = (register.bindingSources?.configs ?? []).map(rel);
if (declaredConfigs.length === 0) {
  fail(['✗ platform register declares no `bindingSources.configs` — the binding scan has no coverage assertion.']);
}

const problems = [];
const printed = [];

// ── LIMB 1 · route set == what the entrypoint mounts, both directions ────────
const entrypoint = rel(serving.entrypoint);
if (!existsSync(join(ROOT, entrypoint))) {
  fail([
    `✗ COVERAGE LOST — servingWorker.entrypoint \`${entrypoint}\` does not exist.`,
    '  The register names a Worker this scan cannot read; every route claim below would pass over nothing.',
  ]);
}
const mounted = mountedRoutes(entrypoint, '');

// Self-check: a parser that matches nothing agrees perfectly with any register.
// This is the ONLY integer in the guard and it is a parser liveness floor, not a
// coverage number — the coverage floor is the set equality immediately below.
if (mounted.length === 0) {
  fail([
    `✗ COVERAGE LOST — parsed ${entrypoint} and found ZERO mounted routes.`,
    '  The parser is broken, not the Worker. Notes:',
    ...parseNotes.map((n) => `    · ${n}`),
  ]);
}
// …and it must have followed at least one `app.route()` into a sub-router, or it
// is only seeing the routes declared inline in the entrypoint. Today that would
// silently drop three of four.
if (!mounted.some((r) => r.owningFile !== entrypoint)) {
  fail([
    `✗ COVERAGE LOST — every route the parser found is declared inline in ${entrypoint};`,
    '  it followed no `app.route(prefix, subRouter)` into a sub-router file. Notes:',
    ...parseNotes.map((n) => `    · ${n}`),
  ]);
}

const key = (m, p) => `${m} ${p}`;
const mountedByKey = new Map(mounted.map((r) => [key(r.method, r.path), r]));
const registeredByKey = new Map(routes.map((r) => [key(String(r.method).toUpperCase(), rel(String(r.path))), r]));

for (const [k, r] of mountedByKey) {
  if (!registeredByKey.has(k)) {
    problems.push(
      `${k} — MOUNTED by ${r.owningFile} and absent from the register. [B-1] An unregistered shared ` +
        'route is one no other requirement can quantify over: B-13 cannot ask whether it is limited, ' +
        'B-14 cannot ask whether its wire shape is pinned, B-4a cannot ask whether it validates app_id.',
    );
  }
}
for (const [k, entry] of registeredByKey) {
  if (!mountedByKey.has(k)) {
    problems.push(
      `${k} (register id \`${entry.id ?? '?'}\`) — registered but NOT mounted by ${entrypoint}. ` +
        'The register is describing a capability the shared server does not provide.',
    );
  }
}

// owningFile must be where the route is really declared, not merely a real file.
for (const [k, entry] of registeredByKey) {
  const m = mountedByKey.get(k);
  if (!m) continue;
  if (rel(String(entry.owningFile ?? '')) !== m.owningFile) {
    problems.push(
      `${k} — register says \`${entry.owningFile}\` owns it; the parser found it declared in ` +
        `\`${m.owningFile}\`. A wrong owningFile silently re-points limb 4 at a different file's limiters.`,
    );
  }
  if (!['required', 'public'].includes(entry.auth)) {
    problems.push(`${k} — \`auth\` must be exactly "required" or "public" (got ${JSON.stringify(entry.auth)}).`);
  }
  if (!String(entry.purpose ?? '').trim()) {
    problems.push(`${k} — no \`purpose\`. A register that says only that a route exists is a routing table.`);
  }
}

// ── LIMB 2 · every client RESOLVES to a real call site, or PRINTS its reason ──
const servingDir = posix.dirname(posix.dirname(entrypoint)); // services/platform
for (const entry of routes) {
  const k = key(String(entry.method).toUpperCase(), rel(String(entry.path)));
  const c = entry.client;
  if (!c) {
    if (String(entry.unconsumedReason ?? '').trim()) {
      printed.push(`⚠  ${k} — NO CLIENT. ${entry.unconsumedReason}`);
    } else {
      problems.push(
        `${k} — declares no \`client\` and no \`unconsumedReason\`. [B-1] A capability with no client is ` +
          'not delivered; say who calls it, or say in writing why nothing does.',
      );
    }
    continue;
  }
  if (!c.file || !c.expression) {
    problems.push(`${k} — \`client\` needs both a \`file\` and an \`expression\`. A bare string is the "TBD" defect.`);
    continue;
  }
  const cf = rel(c.file);
  // 🔴 The expression may not come from the Worker that SERVES the route. This is
  // the HTTP analogue of "matched as a usage, never as the symbol's own
  // declaration" — the server declaring `POST /v1/events` is not evidence that
  // anything calls it.
  if (cf.startsWith(`${servingDir}/`)) {
    problems.push(
      `${k} — client file \`${cf}\` is inside the serving Worker (${servingDir}). That is the route's own ` +
        'declaration, not a caller. [B-1]',
    );
    continue;
  }
  if (!existsSync(join(ROOT, cf))) {
    problems.push(`${k} — client file \`${cf}\` does not exist on disk.`);
    continue;
  }
  const src = stripComments(readFileSync(join(ROOT, cf), 'utf8'));
  if (!src.includes(c.expression)) {
    problems.push(
      `${k} — client expression \`${c.expression}\` does not appear in \`${cf}\` once comments are stripped. ` +
        'Either the call site moved or the only occurrence was a doc comment — this repo has shipped ' +
        'exactly that bug before (assert-capability-register.mjs, 2026-08-01).',
    );
    continue;
  }
  // …and the expression must be about THIS route. Without this, one correct
  // client expression would satisfy every entry that named the same file.
  const staticPrefix = rel(String(entry.path)).split('/:')[0];
  if (!c.expression.includes(staticPrefix)) {
    problems.push(
      `${k} — client expression \`${c.expression}\` does not contain the route's own path \`${staticPrefix}\`, ` +
        'so it would keep resolving after the route was renamed.',
    );
  }
}

// ── LIMB 4 · a public route is bounded, or SAYS why it is not ────────────────
// (Numbered 4 in the register's _readme; run here because it needs limb 1's
// parse and nothing from limb 3.)
for (const entry of routes) {
  if (entry.auth !== 'public') continue;
  const k = key(String(entry.method).toUpperCase(), rel(String(entry.path)));
  const m = mountedByKey.get(k);
  if (!m) continue; // already reported by limb 1
  const handler = stripComments(m.handler, { alsoStrings: true });
  const bounded = LIMITER_CALLS.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(handler));
  if (bounded) continue;
  if (String(entry.noLimiterReason ?? '').trim()) {
    printed.push(`⚠  ${k} — PUBLIC AND UNLIMITED. ${entry.noLimiterReason}`);
  } else {
    problems.push(
      `${k} — \`auth: public\` and its handler reaches neither ${LIMITER_CALLS.join(' nor ')}, and it ` +
        'declares no `noLimiterReason`. [B-13] An unauthenticated route that can be made expensive is a ' +
        'bill anyone can run up; one that genuinely cannot must say so in writing.',
    );
  }
}

// ── LIMB 3 · bindings, in both directions, each with a REAL reader ───────────
function wranglerConfigsOnDisk() {
  const found = [];
  if (existsSync(SERVICES_DIR)) {
    for (const e of listDir(SERVICES_DIR, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      for (const f of ['wrangler.jsonc', 'wrangler.json']) {
        const p = join(SERVICES_DIR, e.name, f);
        if (existsSync(p)) found.push(rel(`services/${e.name}/${f}`));
      }
    }
  }
  // The brick's service template — invisible to assert-clone-contract.mjs, which
  // only ever inspects the throwaway CI probe stamp.
  const walk = (dir, base) => {
    let entries;
    try { entries = listDir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(dir, e.name), `${base}/${e.name}`);
      else if (e.name === 'wrangler.jsonc' || e.name === 'wrangler.json') found.push(rel(`${base}/${e.name}`));
    }
  };
  walk(BRICK_SERVICES_GLOB, 'tooling/bricks/app/__brick__');
  return found.sort();
}

const onDiskConfigs = wranglerConfigsOnDisk();
if (onDiskConfigs.length === 0) {
  fail([
    '✗ COVERAGE LOST — found ZERO wrangler configs on disk. The scan is broken, not the tree.',
    `  looked under ${SERVICES_DIR} and ${BRICK_SERVICES_GLOB}`,
  ]);
}
// The coverage assertion, in both directions: the declared list and the glob
// must be the SAME SET. A config that appears on disk and not in the register's
// list would otherwise be scanned silently — or, worse, a config removed from the
// list would shrink the subject while every binding claim stayed green.
for (const c of onDiskConfigs) {
  if (!declaredConfigs.includes(c)) {
    problems.push(
      `${c} — a wrangler config on disk that \`bindingSources.configs\` does not name. Every binding it ` +
        'declares is outside the subject of [B-1] limb 3 until it is listed.',
    );
  }
}
for (const c of declaredConfigs) {
  if (!onDiskConfigs.includes(c)) {
    problems.push(`${c} — named in \`bindingSources.configs\` but not found on disk. The scan and the tree disagree.`);
  }
}

/** binding -> Set(config paths declaring it), derived from the parsed configs. */
const declaredBindings = new Map();
for (const cfgRel of onDiskConfigs) {
  const cfg = parseJsonc(readFileSync(join(ROOT, cfgRel), 'utf8'), cfgRel);
  for (const [section, field] of BINDING_KEYS) {
    for (const item of cfg[section] ?? []) {
      const name = item?.[field];
      if (typeof name !== 'string' || !name) continue;
      if (!declaredBindings.has(name)) declaredBindings.set(name, { kind: section, configs: new Set() });
      declaredBindings.get(name).configs.add(cfgRel);
    }
  }
}
if (declaredBindings.size === 0) {
  fail([
    `✗ COVERAGE LOST — parsed ${onDiskConfigs.length} wrangler config(s) and found ZERO bindings.`,
    `  Sections scanned: ${BINDING_KEYS.map(([s]) => s).join(', ')}.`,
  ]);
}

const registeredBindings = new Map(bindings.map((b) => [b.binding, b]));
for (const [name, info] of declaredBindings) {
  if (!registeredBindings.has(name)) {
    problems.push(
      `${name} — declared as a \`${info.kind}\` binding in ${[...info.configs].join(', ')} and absent from the ` +
        'register. [B-1, B-18] An unregistered binding is a live resource nobody has to justify — which is ' +
        'how a per-app R2 bucket stayed bound with no reader from 2026-07-17 with every guard green.',
    );
  }
}
for (const [name, entry] of registeredBindings) {
  const info = declaredBindings.get(name);
  if (!info) {
    problems.push(
      `${name} — in the register but no wrangler config declares it. Remove it: a stale entry inflates ` +
        'apparent coverage and its "reader" claim can never fail.',
    );
    continue;
  }
  if (entry.kind !== info.kind) {
    problems.push(`${name} — register says \`${entry.kind}\`, the config declares it under \`${info.kind}\`.`);
  }
  if (!String(entry.purpose ?? '').trim()) {
    problems.push(`${name} — no \`purpose\`. Say what the binding is FOR; a name is not a justification.`);
  }

  // THE READER LIMB. `env.<BINDING>` in comment- AND string-stripped code, in a
  // file that is NOT an Env type declaration.
  //
  // ⚠️ WHY types.ts CANNOT COUNT, stated where it is enforced:
  // assert-vendor-portability.mjs derives its surface set from the UNION of
  // `interface Env` and the wrangler configs, so an optional field in types.ts
  // keeps a surface "alive" after its binding is gone — mutation-proven
  // 2026-07-29 and still true. A type declaration is a promise about a binding,
  // never a use of one.
  const readers = (entry.readers ?? []).map(rel);
  const resolved = [];
  for (const r of readers) {
    if (/(^|\/)types\.ts$/.test(r)) {
      problems.push(
        `${name} — claims \`${r}\` as a reader. A types.ts declares the binding's TYPE; it never reads it. ` +
          'That is the exact shape that kept EXPORTS looking alive.',
      );
      continue;
    }
    if (!existsSync(join(ROOT, r))) {
      problems.push(`${name} — claimed reader \`${r}\` does not exist on disk.`);
      continue;
    }
    const code = stripComments(readFileSync(join(ROOT, r), 'utf8'), { alsoStrings: true });
    if (!new RegExp(`\\benv\\s*\\.\\s*${name}\\b`).test(code)) {
      problems.push(
        `${name} — claimed reader \`${r}\` contains no \`env.${name}\` once comments and string literals ` +
          'are stripped. The register is describing a use that no longer exists.',
      );
      continue;
    }
    resolved.push(r);
  }
  if (resolved.length === 0) {
    if (String(entry.unreadReason ?? '').trim()) {
      printed.push(`⚠  ${name} — BOUND WITH NO READER. ${entry.unreadReason}`);
    } else {
      problems.push(
        `${name} — bound by ${[...info.configs].join(', ')} and read by NOTHING. [B-18] A binding with no ` +
          'reader is a live resource with a lifecycle, a quota and an attack surface, bought for nothing. ' +
          'Give it a reader, delete the binding, or record an `unreadReason` that will be printed every run.',
      );
    }
  }
}

if (problems.length) {
  console.error(`✗ platform register — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [B-1] one declared home per shared capability · [B-18] every binding has a reader ·');
  console.error('  [B-13] a public route is bounded, or says why not.');
  console.error('  Register: tooling/platform-register.json');
  process.exit(1);
}

// ── the gaps print whether or not the build passes ───────────────────────────
for (const line of printed) console.log(line);

console.log(
  `ok  platform register — ${mounted.length} mounted route(s) reconciled with ${routes.length} register ` +
    `entry(ies); ${declaredBindings.size} binding(s) across ${onDiskConfigs.length} wrangler config(s), ` +
    `each with a resolved reader; ${printed.length} declared gap(s) printed above`,
);
