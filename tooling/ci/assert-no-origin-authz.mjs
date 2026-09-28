#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-origin-authz.mjs — `Origin` decides CORS HEADERS and nothing else.
// No route, no middleware and no library under services/*/src may reach an
// authorization, tenant-selection or data-access decision from the request's
// `Origin` (or `Referer`) header.
//
// Pipeline requirement: Private/requirements/ → F-10.
// Owner decision, 2026-09-09 (branch `web-path-routing-2026-09-09`): the web
// app moves off `subly.nikatru.com` and onto `nikatru.com/<app>`.
//
// ── WHY THE PATH MOVE MAKES THIS A GUARD RATHER THAN A CONVENTION ────────────
// Under host-per-app, `Origin` was accidentally a per-app boundary: Subly's tab
// sent `https://subly.nikatru.com` and no other app's tab could. That was never
// a security property — [ADR 020] calls the allowlist HYGIENE and both CORS
// middlewares say in their own headers that it must never stand in for auth —
// but it was TRUE, and a rule that is accidentally true is a rule nobody has to
// obey to stay green.
//
// After the move EVERY app's browser tab sends the SAME `Origin`:
// `https://nikatru.com`. So a branch that reads `Origin` to decide who may do
// what is now
//   · WRONG — it cannot tell app A's tab from app B's, because there is one
//     origin left and the header carries no app in it any more; and
//   · SILENT — it does not throw, does not 403 and does not log. It simply
//     grants, to everyone the shared origin covers. The failure is a widened
//     grant, which is the failure shape that produces no signal at all.
// The authorization inputs after the move are the BEARER TOKEN and the Worker's
// own `APP_ID` var. `Origin` is an input to the CORS response headers, full
// stop.
//
// ⚠️ THE LEGITIMATE USE IS REAL AND IS NOT BANNED. A CORS middleware MUST read
// `Origin` — that is what computing `Access-Control-Allow-Origin` from an exact
// allowlist and answering a preflight 204 consists of. So the rule is not "no
// module reads Origin"; it is "exactly the modules NAMED BELOW read Origin, and
// each of them stays a CORS middleware". Both halves are enforced, because an
// allowlist that only says WHERE would happily cover a cors.ts that had grown a
// database call.
//
// ⚠️ WHY THE RULE IS "ANY READ OUTSIDE THE CORS MODULES", NOT "A READ THAT
// REACHES AN AUTHZ BRANCH". Deciding mechanically whether a value flows into a
// grant needs dataflow this repo has no business growing in a .mjs guard, and a
// heuristic that tried would be exactly the kind of assertion that cannot fail.
// The stronger and simpler property is available instead: after the move
// `Origin` carries NO app, NO tenant and NO caller identity, so a read outside
// a CORS middleware is either dead code or a decision resting on a value that
// no longer distinguishes anything. Both are worth a diff. Adding a new
// `Origin` read anywhere else is RED, and the fix is to name the CORS module or
// to stop reading the header.
//
// Everything is matched against COMMENT-STRIPPED source: a header comment
// explaining that this Worker does not authorize on Origin matches every
// pattern looking for it doing so, and this repository has shipped that defect
// twice (text-reductions.mjs's own header).
//
// LANE-BOUND: none. The subject is the services source tree, which is derived
// (every `services/*/src/**/*.ts`), so a new Worker or a new route file
// acquires the obligation automatically with no edit here.
//
// Usage:  node tooling/ci/assert-no-origin-authz.mjs [repoRoot]
// Exit 0 = every request-`Origin`/`Referer` read under services/*/src is inside
//          a declared CORS module, and every declared CORS module is still only
//          a CORS module.
//      1 = a finding: a read outside the declared CORS modules, a `hono/cors`
//          import outside them, or a declared CORS module that has grown an
//          authorization or data-access reach.
//      2 = COVERAGE LOST — no services/ directory, no .ts files scanned, a
//          service with a `src/index.ts` that contributed no scanned file, a
//          declared CORS-module path that does not exist, a declared CORS
//          module that carries no CORS tell at all, or a matcher self-canary
//          that stopped telling a request read from a response header. "I
//          looked and found nothing wrong" and "I could not look" are different
//          answers and are deliberately different codes.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

export const SERVICES = 'services';

/**
 * The modules that are ALLOWED to read the request `Origin`, BY PATH, each with
 * the reason it is there. Not a waiver list: every entry is a claim that the
 * file's whole job is emitting CORS response headers, and the reason has to
 * survive being read aloud — same idiom as assert-cors-allowlist.mjs's EXTRAS
 * and assert-guard-coverage.mjs's NOT_A_SCANNER.
 *
 * A path here that does not exist is COVERAGE LOST, never a pass: a renamed or
 * deleted middleware would otherwise leave this guard granting an exemption to
 * nothing while the real reads moved somewhere unexamined.
 */
export const CORS_MODULES = new Map([
  [
    'services/_shared/src/cors.ts',
    'the ONE CORS middleware (O-SERVICE-KIT-UNBUILT, E-b1, 2026-09-27): every Worker binds it in its ' +
      'own src/middleware/cors.ts with a policy and implements nothing, so a Worker file that reads ' +
      'Origin or imports `hono/cors` again is a finding here. It reads Origin to reflect it into ' +
      '`Access-Control-Allow-Origin` when it is on the exact ALLOWED_ORIGINS list (owner decision ' +
      '2026-07-25; plus any localhost port for an `own-app` Worker, the recorded trade for the ' +
      '`flutter drive -d web-server` harness) and to answer an OPTIONS preflight 204. It grants ' +
      'nothing: every /v1 data route behind it is Bearer-gated, and [ADR 020] records the allowlist ' +
      'as hygiene.',
  ],
]);

/**
 * Reaches that do not belong in a CORS middleware. Origin is allowed to pick a
 * response header; it is not allowed to pick a token, an app or a row, and a
 * cors.ts that touches any of these has stopped being the thing the allowlist
 * above vouches for.
 *
 * 🔴 `Authorization` IS DELIBERATELY NOT ON THIS LIST. Both real middlewares
 * name it as an ALLOWED REQUEST HEADER — `Access-Control-Allow-Headers:
 * 'Authorization, Content-Type, …'` and `allowHeaders: ['Authorization', …]` —
 * so a tell matching it would fire on both files on the day this guard landed.
 * A tell that reds the correct tree is not a strict guard; it is a guard that
 * gets an exemption written for it within the week.
 */
export const NON_CORS_REACHES = [
  { re: /\bBearer\b/, why: 'it inspects a bearer token' },
  { re: /\bAPP_ID\b/, why: 'it reads the Worker\'s APP_ID — app selection is the token\'s job, not the header\'s' },
  { re: /\.prepare\s*\(/, why: 'it issues a D1 statement' },
  { re: /\benv\.DB\b/, why: 'it reaches the database binding' },
  { re: /\b(jwt|verifyToken|verifyJwt)\b/i, why: 'it verifies a token' },
  { re: /\bc\.set\s*\(/, why: 'it writes context state, which is how an origin reaches a later handler\'s decision' },
];

/** A file that is allowed to read Origin must still LOOK like CORS. Any one of
 *  these is enough; none of them is COVERAGE LOST, because an allowlisted file
 *  with no CORS tell means either the middleware moved or the matcher went
 *  blind, and both make this guard's exemption meaningless. */
export const CORS_TELLS = [
  /Access-Control-Allow-Origin/,
  /from\s+['"]hono\/cors['"]/,
];

/**
 * Floors. Deliberately WELL under what the tree measures today (43 `.ts` files
 * across 3 service directories with a `src/`, 2026-09-09) rather than pinned to
 * it: a floor equal to the measurement is a ratchet every new file must raise,
 * and three consecutive merges collided on exactly that shape
 * (assert-guard-coverage.mjs's header). Stated honestly: these catch a scan
 * that COLLAPSES, not one that quietly shrinks — the `srcIndexCovered`
 * relationship below is what catches a service dropping out.
 */
export const MIN_TS_FILES = 20;
export const MIN_SERVICES_WITH_SRC = 2;

/**
 * Every read of the REQUEST's `Origin`/`Referer`, plus every `hono/cors`
 * import, with its 1-based line. Pure, exported, and unit-tested on its own.
 *
 * 🔴 THE FIRST ARGUMENT IS THE WHOLE TRICK. `c.header('Vary', 'Origin')` and
 * `c.header('Access-Control-Allow-Origin', allowed)` are RESPONSE writes and
 * both mention Origin; a pattern that looked anywhere on the line would call
 * every correct CORS middleware a violation, which is the cry-wolf direction
 * that gets a guard deleted. So the header NAME must be the argument, matched
 * with its closing quote immediately after it — `'Origin'`, never
 * `'Access-Control-Allow-Origin'` and never `'Vary'`.
 */
export function originReads(source, extension = '.ts') {
  const code = stripSourceComments(source, extension);
  const hits = [];
  const PATTERNS = [
    // c.req.header('Origin') · request.header("referer")
    { kind: 'request-header', re: /\.header\(\s*(['"`])(origin|referer|referrer)\1/gi },
    // request.headers.get('origin') · c.req.raw.headers.get('Referer')
    { kind: 'headers-get', re: /\.headers\.get\(\s*(['"`])(origin|referer|referrer)\1/gi },
    // a per-route CORS policy is a per-route origin decision
    { kind: 'hono-cors-import', re: /from\s+['"]hono\/cors['"]/g },
  ];
  code.split('\n').forEach((text, i) => {
    for (const { kind, re } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        hits.push({ line: i + 1, kind, text: text.trim() });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  });
  return hits;
}

/** Every `.ts` under a `services/<name>/src` tree, relative to `root`, sorted.
 *  (The glob is written out in words on purpose: the literal pattern contains a
 *  comment terminator and closes this block early — measured, not guessed.)
 *  `listDir` is the
 *  ONE directory listing (tree-walk.mjs) — a nested agent worktree under this
 *  tree is a full second copy of services/ and reading it as our own is the
 *  defect that file exists to prevent. */
export function scanServiceSources(root) {
  const servicesAbs = join(root, SERVICES);
  const files = [];
  const servicesWithSrc = [];
  const srcIndexServices = [];
  if (!existsSync(servicesAbs)) return { files, servicesWithSrc, srcIndexServices, missing: true };

  for (const entry of listDir(servicesAbs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const srcAbs = join(servicesAbs, entry.name, 'src');
    if (!existsSync(srcAbs)) continue;
    servicesWithSrc.push(entry.name);
    if (existsSync(join(srcAbs, 'index.ts'))) srcIndexServices.push(entry.name);
    const walk = (absDir, rel) => {
      for (const e of listDir(absDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const abs = join(absDir, e.name);
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(abs, r);
        else if (e.name.endsWith('.ts')) files.push(r);
      }
    };
    walk(srcAbs, `${SERVICES}/${entry.name}/src`);
  }
  return { files, servicesWithSrc, srcIndexServices, missing: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// tooling/ci/test/no-origin-authz.test.mjs imports the pure functions above, and
// at module scope a guard that calls process.exit takes the whole suite down
// with it — the defect assert-platform-register.mjs records in its own header
// and assert-workflow-timeouts.mjs guards the same way. The SPAWNED path is
// unchanged: every case in that suite runs this file through
// `spawnSync(node, [GUARD, root])`, the shipping invocation. The comparison is
// `import.meta.url` against `pathToFileURL(process.argv[1])` rather than a
// string compare: on win32 argv[1] carries backslashes while import.meta.url is
// a `file:///C:/…` URL, and `?? ''` keeps pathToFileURL from throwing under
// `node -e`, where argv[1] does not exist at all.
// ─────────────────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const ROOT = resolve(process.argv[2] ?? '.');
  const findings = [];

  /** The first line NAMES THE LIMB THAT REFUSED, so a reader of a CI log can
   *  tell a broken scan from a broken tree without opening this file. */
  const coverageLost = (limb, lines) => {
    console.error(`✗ COVERAGE LOST [${limb}] — ${lines[0]}`);
    for (const l of lines.slice(1)) console.error(`  ${l}`);
    if (findings.length) {
      console.error('  Findings established before the refusal, printed rather than dropped:');
      for (const f of findings) console.error(`    ${f}`);
    }
    process.exit(2);
  };

  // ── LIMB MATCHER-CANARY ───────────────────────────────────────────────────
  // The matcher is the whole guard, and its failure mode is SILENCE: a pattern
  // that stopped matching would report a clean tree for ever. So it is
  // exercised on every run against shapes whose answers are not a matter of
  // opinion — including the two RESPONSE writes that a lazier pattern would
  // call violations, because widening to "the line mentions Origin" is the
  // obvious change somebody makes and it inverts this guard's meaning.
  const canary = [
    { src: "const o = c.req.header('Origin') ?? '';", want: 1, note: 'a hono request read' },
    { src: 'const r = request.headers.get("referer");', want: 1, note: 'a raw Headers read' },
    { src: "c.header('Vary', 'Origin');", want: 0, note: 'a RESPONSE write naming Origin' },
    { src: "c.header('Access-Control-Allow-Origin', allowed);", want: 0, note: 'the CORS response header itself' },
    { src: "// c.req.header('Origin') — explained in prose, not performed", want: 0, note: 'a comment' },
    { src: "import { cors } from 'hono/cors';", want: 1, note: 'a per-route CORS policy import' },
  ];
  for (const { src, want, note } of canary) {
    const got = originReads(src).length;
    if (got !== want) {
      coverageLost('MATCHER-CANARY', [
        `the matcher answered ${got} for a shape whose answer is ${want}: ${note}.`,
        `Input: ${src}`,
        'Every limb below quantifies over what this matcher returns, so a matcher that has',
        'stopped telling a request read from a response header certifies nothing at all.',
      ]);
    }
  }

  // ── LIMB SERVICES-DIR ─────────────────────────────────────────────────────
  const { files, servicesWithSrc, srcIndexServices, missing } = scanServiceSources(ROOT);
  if (missing) {
    coverageLost('SERVICES-DIR', [
      `no ${SERVICES}/ directory under ${ROOT}.`,
      'The scan is broken, not the tree: with no services/ this guard reads zero files and',
      'reports that no route authorizes on Origin, which it would also report over a tree where',
      'every route did.',
    ]);
  }

  // ── LIMB FILE-FLOOR ───────────────────────────────────────────────────────
  if (files.length < MIN_TS_FILES || servicesWithSrc.length < MIN_SERVICES_WITH_SRC) {
    coverageLost('FILE-FLOOR', [
      `${files.length} .ts file(s) across ${servicesWithSrc.length} service source tree(s), under the ` +
        `floor of ${MIN_TS_FILES} across ${MIN_SERVICES_WITH_SRC}.`,
      'A rename, a moved directory or a walk that stopped descending shrinks this scan silently,',
      'and a scan over nothing prints ok for every route it can no longer see.',
    ]);
  }

  // Relationship, not a count: a service with a Worker entrypoint that
  // contributed no scanned file means the walk stopped descending into it,
  // which a floor set below today's measurement cannot see.
  for (const name of srcIndexServices) {
    const prefix = `${SERVICES}/${name}/src/`;
    if (!files.some((f) => f.startsWith(prefix))) {
      coverageLost('FILE-FLOOR', [
        `${SERVICES}/${name}/src/index.ts exists but the walk collected no .ts file under ${prefix}.`,
        'That Worker is unexamined while the tally still looks healthy.',
      ]);
    }
  }

  // ── LIMB ALLOWLIST-PATHS ──────────────────────────────────────────────────
  for (const [rel, why] of CORS_MODULES) {
    if (!existsSync(join(ROOT, ...rel.split('/')))) {
      coverageLost('ALLOWLIST-PATHS', [
        `CORS_MODULES names ${rel}, and no such file exists.`,
        `Its recorded reason: ${why}`,
        'Either the middleware moved (name the new path in the same change) or it was deleted.',
        'Until then this guard is granting an exemption to nothing, while the reads it exists to',
        'find have moved somewhere it is not looking.',
      ]);
    }
  }

  // ── the scan ──────────────────────────────────────────────────────────────
  let readsInCorsModules = 0;
  let readsOutside = 0;

  for (const rel of files) {
    const source = readFileSync(join(ROOT, ...rel.split('/')), 'utf8');
    const hits = originReads(source, '.ts');
    const declared = CORS_MODULES.has(rel);

    if (declared) {
      readsInCorsModules += hits.length;

      const code = stripSourceComments(source, '.ts');
      if (!CORS_TELLS.some((re) => re.test(code))) {
        coverageLost('CORS-TELL', [
          `${rel} is declared in CORS_MODULES but carries no CORS tell — it neither names ` +
            '`Access-Control-Allow-Origin` nor imports `hono/cors`.',
          'A file exempted for being a CORS middleware, that is no longer recognisable as one, is an',
          'exemption over an unknown subject. Either the middleware moved, or the tells are stale.',
        ]);
      }

      // ── LIMB (finding): the exemption is for CORS, not for the file ───────
      for (const { re, why } of NON_CORS_REACHES) {
        const m = re.exec(code);
        if (m) {
          const line = code.slice(0, m.index).split('\n').length;
          findings.push(
            `✗ ${rel}:${line} — this file is exempted to read Origin because it is a CORS middleware, ` +
              `and ${why}: \`${m[0]}\`.\n` +
              '    CORS may pick a response header. It may not pick a token, an app or a row. Since the\n' +
              '    move to nikatru.com/<app> every app\'s tab sends the same Origin, so a middleware that\n' +
              '    both reads Origin and reaches an authorization or data path is one edit away from\n' +
              '    granting across apps with nothing logged.',
          );
        }
      }
      continue;
    }

    for (const hit of hits) {
      readsOutside++;
      const what =
        hit.kind === 'hono-cors-import'
          ? 'imports `hono/cors`, which is a per-module Origin policy'
          : `reads the request \`Origin\`/\`Referer\` header (${hit.kind})`;
      findings.push(
        `✗ ${rel}:${hit.line} — ${what}.\n` +
          `    ${hit.text}\n` +
          '    Only the declared CORS middleware may read that header. Since the web app moved to\n' +
          '    nikatru.com/<app> every app shares ONE browser origin, so Origin names no app, no\n' +
          '    tenant and no caller: a branch resting on it cannot tell one app\'s tab from another\'s,\n' +
          '    and it fails by GRANTING — no throw, no 403, no log. Authorization rests on the bearer\n' +
          '    token and this Worker\'s own APP_ID var. To make a legitimate CORS module, name its path\n' +
          '    in CORS_MODULES in tooling/ci/assert-no-origin-authz.mjs with the reason.',
      );
    }
  }

  // ── LIMB ORIGIN-SIGHTING ──────────────────────────────────────────────────
  // The declared CORS modules are the one place in this tree that MUST match.
  // If they stop matching, the matcher has gone blind and every "no read found"
  // above is an artefact of the scan rather than a fact about the tree.
  if (readsInCorsModules === 0) {
    coverageLost('ORIGIN-SIGHTING', [
      'not one Origin read or hono/cors import was found in ANY declared CORS module.',
      `Declared: ${[...CORS_MODULES.keys()].join(', ')}`,
      'Those files are the known-positive control for this scan. Zero hits there means the matcher',
      'no longer recognises the shape it is looking for, so the clean result over the other',
      `${files.length - CORS_MODULES.size} file(s) is evidence of nothing.`,
    ]);
  }

  if (findings.length > 0) {
    for (const f of findings) console.error(f);
    console.error(
      `\nassert-no-origin-authz: ${findings.length} finding(s) over ${files.length} file(s) in ` +
        `${servicesWithSrc.join(', ')}.\n` +
        'One origin now serves every app. Origin decides CORS headers; the bearer token and APP_ID\n' +
        'decide everything else.',
    );
    process.exit(1);
  }

  console.log(
    `assert-no-origin-authz: ${files.length} .ts file(s) under ${SERVICES}/*/src across ` +
      `${servicesWithSrc.length} service tree(s) (${servicesWithSrc.join(', ')}); ` +
      `${readsInCorsModules} Origin read(s)/CORS import(s), all ${readsInCorsModules} inside the ` +
      `${CORS_MODULES.size} declared CORS module(s), each still CORS-only; ${readsOutside} elsewhere.`,
  );
}
