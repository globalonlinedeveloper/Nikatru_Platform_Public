// ─────────────────────────────────────────────────────────────────────────────
// worker-routes.mjs — the ONE reader of what a Hono Worker mounts.
//
// MOVED HERE VERBATIM from assert-platform-register.mjs on 2026-09-26
// (O-SERVICE-KIT-UNBUILT, E-a1), because a second reader needed it:
// tooling/scripts/provision-backend.mjs step [6] writes a new app Worker's
// `appWorkers` row with `routes` DERIVED from its stamped entrypoint, so the
// guard's limb 1 ("the routes EQUAL what the entrypoint mounts, both ways")
// holds for that row by construction. Two copies of this parser would be two
// answers to one question the day one of them was fixed, so there is one,
// imported by both. The guard re-exports `stripComments` from here, so its
// two existing importers are unchanged.
//
// The only change in the move: `mountedRoutes` takes the repository root and
// the array its parse notes go to as arguments. The guard read both from its
// own module scope (`ROOT` from argv, `parseNotes`), which a second caller
// with a different root cannot share.
//
// Usage (a library; it has no CLI):
//   import { mountedRoutes } from './worker-routes.mjs';
//   const notes = [];
//   mountedRoutes(root, 'services/<worker>/src/index.ts', '', notes)
//     → [{ method, path, owningFile, handler }]; `notes` says what it could not follow.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';

const rel = (p) => posix.normalize(p.replace(/\\/g, '/'));

/**
 * Blank comments in TS/Dart source, preserving offsets. Strings are KEPT because
 * every route path and every client URL IS a string literal — the thing being
 * matched. That is why the client rule additionally requires the expression to
 * live outside the serving Worker: keeping strings means a doc comment is the
 * only false positive available, and comments are what this strips.
 */
export function stripComments(src, { alsoStrings = false } = {}) {
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
    // ── 🔴 STRINGS ARE ALWAYS *TRACKED*; `alsoStrings` ONLY DECIDES WHETHER THEY
    // ARE BLANKED. CORRECTED 2026-08-05, AND IT HAD SILENTLY BLINDED THE GUARD.
    //
    // This branch used to be gated entirely on `alsoStrings`, so with it false
    // the scanner walked straight THROUGH string literals — and
    // `services/platform/src/index.ts:263` is:
    //
    //     app.use('/v1/plan/*', platformAuth);
    //
    // The `/*` inside that path opened a block comment that never closed, so
    // EVERY LINE AFTER IT WAS BLANKED — including `:115 app.route('/v1',
    // cancellation);`. The guard then reported "7 mounted route(s) reconciled
    // with 7 register entry(ies)" and exited 0, while `POST /v1/plan/cancel`
    // was mounted, deployed and answering 401 in production, and appeared in
    // `tooling/platform-register.json` exactly ZERO times. Real mount count: 12.
    //
    // The parser-liveness self-check could not catch it: it fires on
    // `mounted.length === 0`, and this was a PARTIAL loss — 7 of 12 — which
    // looks exactly like a healthy read.
    //
    // 📌 This is the same family as the 2026-08-04 finding that
    // `stripSourceComments` returned its input unchanged for unknown
    // extensions, and it arrived the same way: the docstring above already
    // said strings are kept because a route path IS a string literal. The
    // INTENT was right and the implementation only honoured it in one of two
    // modes.
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        if (q !== '`' && src[j] === '\n') break;
        j++;
      }
      // Blank the literal when asked, otherwise copy it through verbatim — but
      // either way, SKIP PAST IT so its contents can never be read as syntax.
      if (alsoStrings) for (const ch of src.slice(i, j)) out += blank(ch);
      else out += src.slice(i, j);
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

/** EVERY `new Hono` instance a file declares, in source order. The first is the
 *  file's own router; the rest are IN-FILE GROUPS, and missing them is not a
 *  cosmetic gap — see the block above `mountedRoutes`. */
function honoIdents(code) {
  return [...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Hono\b/g)].map((m) => m[1]);
}

/** Mount prefix + leaf path, joined the way Hono's own `mergePath` joins them.
 *
 *  🔴 THE TRAILING SLASH IS NOT COSMETIC AND IT IS NOT GUESSED. `posix.join`
 *  turns ('/v1/subscriptions', '/') into '/v1/subscriptions/', and a register
 *  entry written against that string would describe a path the Worker does not
 *  serve. Measured against hono 4.12.34 before this line was written: mounting a
 *  sub-router whose leaf is '/' answers 200 on '/v1/subscriptions' and 404 on
 *  '/v1/subscriptions/'. Five of subscriptiontracker-api's twelve routes declare their leaf as
 *  '/', so without this the register and the Worker would disagree on five paths
 *  while limb 1 reported perfect agreement with the register it was handed. */
function joinPath(prefix, p) {
  const j = rel(posix.join(prefix || '/', p));
  return j.length > 1 ? j.replace(/\/+$/, '') : j;
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

/** Walk ONE Hono identifier inside an already-stripped file, at `prefix`.
 *
 *  🔴 THE SUB-ROUTER A FILE DECLARES ITSELF IS STILL A SUB-ROUTER. The walk used
 *  to follow `app.route(prefix, ident)` ONLY when `ident` resolved to a default
 *  import, and pushed a parse note otherwise. services/platform/src/index.ts
 *  happens to mount every group from an import, so nothing was lost there — but
 *  services/subscriptiontracker-api/src/index.ts builds its authenticated group in the file:
 *
 *      const api = new Hono<AppEnv>();
 *      api.use('*', supabaseAuth);
 *      api.route('/subscriptions', subscriptions);
 *      …
 *      app.route('/v1', api);
 *
 *  `api` is not imported, so the old walk stopped at that line and reported
 *  THREE mounted routes for a Worker that mounts TWELVE. That is the same
 *  PARTIAL loss as the 2026-08-05 `/*`-in-a-string defect recorded above — 7 of
 *  12 then, 3 of 12 here — and the liveness self-check cannot see either,
 *  because it fires on zero. */
function walkHono(ctx, code, fileRel, id, prefix, localIdents, out, seenLocal) {
  const localKey = `${id}@${prefix}`;
  if (seenLocal.has(localKey)) return;
  seenLocal.add(localKey);

  const methodRe = new RegExp(`\\b${id}\\s*\\.\\s*(${METHODS.join('|')})\\s*\\(\\s*(['"\`])([^'"\`]*)\\2`, 'g');
  for (const m of code.matchAll(methodRe)) {
    const openParen = code.indexOf('(', m.index + id.length);
    out.push({
      method: m[1].toUpperCase(),
      path: joinPath(prefix, m[3]),
      owningFile: fileRel,
      handler: balanced(code, openParen),
    });
  }

  const routeRe = new RegExp(`\\b${id}\\s*\\.\\s*route\\s*\\(\\s*(['"\`])([^'"\`]*)\\1\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\)`, 'g');
  for (const m of code.matchAll(routeRe)) {
    const target = m[3];
    const nextPrefix = joinPath(prefix, m[2]);
    if (localIdents.includes(target)) {
      walkHono(ctx, code, fileRel, target, nextPrefix, localIdents, out, seenLocal);
      continue;
    }
    const sub = resolveDefaultImport(code, target, fileRel);
    if (!sub) {
      ctx.notes.push(`${fileRel} mounts \`${target}\` at ${m[2]} but no default import and no in-file \`new Hono\` resolves it`);
      continue;
    }
    out.push(...mountedRoutes(ctx.root, sub, nextPrefix, ctx.notes, ctx.seen));
  }
}

/** Returns [{ method, path, owningFile, handler }] mounted at `prefix`, reading
 *  `fileRel` (repo-relative, posix) under `root`. What the walk could not follow
 *  is pushed onto `notes`; `seen` stops a file being walked twice. */
export function mountedRoutes(root, fileRel, prefix = '', notes = [], seen = new Set()) {
  if (seen.has(fileRel)) return [];
  seen.add(fileRel);
  const abs = join(root, fileRel);
  if (!existsSync(abs)) {
    notes.push(`route file ${fileRel} does not exist`);
    return [];
  }
  const code = stripComments(readFileSync(abs, 'utf8'));
  const idents = honoIdents(code);
  if (idents.length === 0) {
    notes.push(`${fileRel} declares no \`new Hono\` instance — the parser found nothing to walk`);
    return [];
  }
  const out = [];
  walkHono({ root, notes, seen }, code, fileRel, idents[0], prefix, idents, out, new Set());
  return out;
}
