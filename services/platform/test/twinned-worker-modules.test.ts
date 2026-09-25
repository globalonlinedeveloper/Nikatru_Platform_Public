import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// twinned-worker-modules.test.ts — a module carried by more than one Worker is
// either ONE FILE THAT THEY ALL RE-EXPORT, or a set of copies held equal
// declaration by declaration. Nothing in between, and never unchecked.
//
// 🔴 THE CLAIM THAT WAS FALSE. `services/subscriptiontracker-api/src/lib/error-sink.ts` said,
// in its own header, that "tooling/ci/assert-worker-error-sink.mjs asserts BOTH
// copies exist and are wired, so a fix applied to one and not the other is a
// build failure rather than a discovery." Read that guard: it asserts each copy
// EXISTS, exports `reportWorkerError`, calls `fetch`, carries `server_name` and
// `release`, and does not read `API_VERSION`. Every one of those limbs is
// satisfied by each copy ALONE. Nothing in this repository had ever compared the
// two files. The `res.ok`-not-`true` correction of 2026-08-04 landed in both by
// hand, and had it landed in one, every check in the tree would have stayed
// green — which is precisely the "guard that silently stopped checking" shape
// CLAUDE.md's verification discipline is written about.
//
// ── 🔴 THE TWO OBJECTIONS TO ONE SHARED HOME WERE RE-MEASURED, AND ONE OF THEM
//      HELD (2026-09-06, [ADR 067] decision 2) ────────────────────────────────
// This file used to argue that the duplication should STAY, on two grounds
// recorded on 2026-08-17. Both were re-measured on the real tree:
//
//   · "NO MODULE BOUNDARY EXISTS BETWEEN THE TWO WORKERS." Still true as
//     written — the Workers are separate npm packages with their own
//     `package-lock.json` and their own `npm ci` (`ci.yml` jobs
//     `worker-subscriptiontracker-api`, `worker-platform`), and `pnpm-workspace.yaml` lists
//     only `sites/_shared` and `tooling/content_pipeline`, so a `workspace:*`
//     dependency would not resolve. But a bare RELATIVE import needs no package
//     boundary at all: esbuild inlines it, which is exactly how
//     `services/platform/src/lib/mor/contract.ts` has been reaching
//     `contracts/entitlement/contract.js` since [ADR 067] decision 1 — proven
//     with `wrangler deploy --dry-run --outdir`, whose sourcemap names the file.
//     So this objection was about packaging and did not survive.
//
//   · "A BARE RELATIVE IMPORT INTO A `services/_shared/` WOULD BUILD AND WOULD
//     BREAK THE DEPLOY." That one was REAL and is now closed by the repair it
//     always implied: `tooling/ci/lane-map.json` names `services/_shared/**` in
//     BOTH Worker `deployUnits` (what decides deploy-workers.yml's publishes since
//     ADR 095 §4), and `tooling/ci/assert-deploy-triggers-deploy.mjs` fails the build
//     when a unit claims a source tree without claiming what that tree imports
//     from outside itself. The incident it names — #155, a merged fix reporting
//     success with production broken for six hours — is why that guard's
//     mutation is part of the acceptance of this change rather than an extra.
//
// ⚠️ AND THERE IS A THIRD CONSTRAINT, MEASURED THE SAME DAY, WHICH IS WHY
// `middleware/auth.ts` DID NOT MOVE WHOLE. Nothing under `services/_shared/src/`
// may carry a BARE import: Node, tsc and esbuild all resolve a bare specifier by
// walking up from the file that writes it, and there is no `node_modules` at
// `services/_shared/`, at `services/`, or at the repo root. A probe importing
// `jose` failed both readers (`error TS2307: Cannot find module 'jose'`;
// `X [ERROR] Could not resolve "jose"`), and wrangler's suggested `alias` repair
// is refused because it resolves a DIRECTORY and bypasses the package's
// `exports` conditions — the exact way the `workerd` build of jose was lost once
// before (`vitest.config.ts`'s header). So `services/_shared/src/auth.ts` holds
// the deciding (the ES256 pin, `isKeySetUnavailable`, the KV key and TTL, the
// bearer parse, the empty-JWKS refusal) and each Worker keeps its own plumbing —
// which is also what keeps `services/platform`'s "no HS256 fallback" and
// `services/subscriptiontracker-api`'s `erasureAuth` true, since collapsing those would be a
// security change and not a refactor.
//
// ── WHAT THIS FILE NOW HOLDS ────────────────────────────────────────────────
// THE SUBJECT SET IS DERIVED, NOT LISTED. Every `services/*/src/lib/*.ts`
// basename carried by two or more Workers is a twin. Worker #3 stamped from the
// brick therefore acquires the obligation by existing, and a rename that empties
// the derived set fails the coverage limb instead of iterating nothing and
// printing green. Each twin then falls into exactly one of two groups:
//
//   · A SHARED-HOME twin — `services/_shared/src/<basename>` exists. Every
//     carrier's copy must be EXACTLY a re-export of it: comments stripped, the
//     whole remaining source must be the single line
//     `export * from '../../../_shared/src/<name>';`. Not "contains" — IS. A
//     copy that re-exports the shared home AND declares something of its own is
//     a fork wearing a delegation, and this limb refuses it.
//
//   · A COMPARED twin — no shared home. The copies are held equal declaration by
//     declaration, with the exception tables below. `lib/d1.ts` is the one that
//     is still in this group, deliberately: the brick's Worker template ships it
//     as a four-line starter stub (see DECLARED_SOLE_OWNERS), so the copies are
//     legitimately unequal and a single home would have to be a superset nobody
//     imports.
//
// Both groups carry their own floor, because a twin that silently moves from one
// group to the other must not be able to leave both limbs ranging over nothing.
//
// ── WHAT IS HELD EQUAL IN THE COMPARED GROUP, AND HOW THE EXCEPTIONS CANNOT ROT
// Comments are stripped first: the copies' headers are deliberately different
// documents (each explains what the defect cost ITS Worker) and holding prose
// equal would only teach people to stop writing it. What is held equal is the
// CODE, declaration by declaration.
//
// 🔴 AN EXEMPTION IS THE SIZE OF THE LINES IT NAMES, NOT THE SIZE OF THE
// DECLARATION. A `DECLARED_DIVERGENCES` row does NOT stop a declaration from
// being compared. It names the exact normalised source lines that are allowed to
// be present in some copies and absent from others; those lines are removed from
// EVERY copy, and the remainder is still compared line for line. Written that way
// after measuring the alternative: while the row was a whole-declaration pass,
// changing `logger: 'worker'` to anything else in the platform copy of
// `buildEnvelope` ALONE left this file green — 5 passed, exit 0, measured
// 2026-08-17 — so a ~40-line function was excused by a one-line difference.
//
// ⚠️ `DECLARED_DIVERGENCES` IS EMPTY TODAY, AND AN EMPTY TABLE IS THE STRICTEST
// SETTING, NOT A WEAKENED ONE. Its only two rows were `error-sink.ts ::
// SinkContext` and `:: buildEnvelope`, exempting the `appId` field and the
// `app_id` envelope tag. That module now has ONE home, where `appId` is a single
// OPTIONAL field — so the asymmetry is expressed in the type system instead of in
// an exemption table, and the anti-rot limb below would have called both rows
// stale had they been left. The machinery stays because `d1.ts` is still
// compared with zero exemptions, which is what an empty table means.
//
// The exception tables are checked in BOTH directions, the same anti-rot floor
// `check-selection-record` applies to its EXEMPT list:
//
//   · a declaration in every copy that differs OUTSIDE
//     the lines its row exempts                        → FAIL
//   · an exempt LINE now carried by every copy, or by
//     none of them                                     → FAIL (stale permission)
//   · a divergence row naming NO exempt line           → FAIL (a whole-
//     declaration pass, which is what this file was rewritten to end)
//   · a declaration in only some copies                → must be DECLARED
//   · a DECLARED sole owner that the others now carry  → FAIL (same reason)
//   · a DECLARED row naming a module/declaration that
//     no longer exists                                 → FAIL (the row outlived
//     its subject)
//   · a DECLARED row naming a module that now has a
//     SHARED HOME                                      → FAIL (one file cannot
//     differ from itself; the row excuses a difference that has become
//     unrepresentable, and would sit there excusing the next real one)
//
// ⚠️ AND BECAUSE THE SUBJECT SET IS DERIVED, THE BRICK'S STARTER STUB IS ALREADY
// DECLARED — STAMPING APP #2 MUST NOT BE A RED BUILD FOR A DIFFERENCE NOBODY
// INTRODUCED. `tooling/bricks/app/__brick__/…/{{app_id}}-api/src/lib/d1.ts` is
// four lines carrying `nowIso` alone, because `nowIso` is the only helper the
// stamped Worker imports (`src/index.ts` stamps it on the health route;
// `routes/account.ts` calls `.run()` on the D1 statement itself). So the day app
// #2 is stamped, `services/<app>-api/src/lib/d1.ts` joins the derived twin set
// without `allRows`, `uuid` and `todayYmd`. Measured 2026-08-17 rather than
// predicted: that stub was copied to a scratch `services/probe2-api/` and this
// file run — exactly those three names, undeclared, one red limb. The three are
// declared in DECLARED_SOLE_OWNERS below. The stamped `health.ts` needs no such
// row: the template's copy is a re-export of the same shared home, so app #2
// joins the SHARED-HOME group and is held to the stricter limb from day one.
// The brick itself is NOT edited from here, and is not scanned by this file (it
// lives under `tooling/`, not `services/`).
// ─────────────────────────────────────────────────────────────────────────────

// `process.getBuiltinModule` rather than `import 'node:fs'`, for the same reason
// harness.ts uses it for node:sqlite and insights-queries.test.ts uses it for
// node:fs: this project's `types` array is deliberately just
// ["@cloudflare/workers-types"], so that production code cannot reach for an API
// the Workers runtime does not have. A `?raw` import cannot serve here — the
// subject set is a DIRECTORY of a SIBLING package, and the whole point is to
// notice a file that appeared or vanished.
const nodeProcess = (
  globalThis as unknown as {
    process: {
      cwd(): string;
      getBuiltinModule(id: 'node:fs'): {
        existsSync(p: string): boolean;
        readFileSync(p: string, enc: 'utf8'): string;
        readdirSync(p: string): string[];
      };
    };
  }
).process;
const fs = nodeProcess.getBuiltinModule('node:fs');

/** Two Workers exist today; both carry `d1.ts`, `error-sink.ts` and `health.ts`.
 *  Floors, not expectations — a derived set that shrinks below them means the
 *  scan broke, not that the duplication was resolved. */
const MIN_WORKERS = 2;
const MIN_TWINNED_MODULES = 2;
/** …and each twin falls into exactly one of two groups, each with its own floor.
 *  Without both, a twin that moved from one group to the other would leave one
 *  limb ranging over nothing while the other still printed a healthy count —
 *  which is the shape this whole file exists to refuse.
 *
 *  ⏱ 2026-09-12 · THE COMPARED FLOOR IS NOW ZERO, AND THE SHARED-HOME FLOOR
 *  WENT UP TO PAY FOR IT. `d1.ts` was the last COMPARED twin; it now has a home
 *  under `services/_shared/src` and all three carriers — both Workers and the app
 *  template's stamped Worker — re-export it. So the compared group is empty, and
 *  that is the END STATE THIS FILE WANTS, not a regression: a module that is one
 *  file cannot drift from itself, which is strictly stronger than holding copies
 *  equal. Today: `d1.ts`, `error-sink.ts` and `health.ts` have a shared home; the
 *  compared group is empty.
 *
 *  ⚠️ THE CONSTRAINT DID NOT MOVE, IT CHANGED HANDS. A floor of 0 on a group
 *  cannot catch that group emptying by accident, so the shared-home floor rose
 *  from 2 to 3 IN THE SAME CHANGE: every module that left the compared group had
 *  to arrive in the other one, and the count proves it did. Deleting a shared home
 *  still turns this red through that floor. If a future twin is legitimately a
 *  compared copy again, raise this back to 1 with the reason, rather than leaving
 *  a zero nobody can see the cost of. */
const MIN_SHARED_HOME_MODULES = 3;
const MIN_COMPARED_MODULES = 0;

/** The repo root, found by walking up from the cwd. `npm test` runs with the cwd
 *  at `services/platform`, but a run from the repo root (or from an editor) must
 *  find the same tree rather than quietly range over nothing. */
function repoRoot(): string {
  const cwd = nodeProcess.cwd().replaceAll('\\', '/');
  for (const up of ['', '/..', '/../..', '/../../..']) {
    const root = `${cwd}${up}`;
    if (fs.existsSync(`${root}/services/platform/package.json`)) return root;
  }
  throw new Error(
    `COVERAGE LOST — no ancestor of ${cwd} holds services/platform/package.json, so this test cannot ` +
      'reach either Worker. Every assertion below would range over an empty set and pass.',
  );
}

const ROOT = repoRoot();
const SERVICES = `${ROOT}/services`;
/** The one home. A module basename that exists here is a SHARED-HOME twin and
 *  every carrier must re-export it; a basename that does not is compared copy
 *  against copy, as everything was before [ADR 067] decision 2. */
const SHARED_SRC = `${SERVICES}/_shared/src`;

/** Every Worker that has a `src/lib` directory. Derived from the tree rather
 *  than listed, so Worker #3 is covered the day it is stamped.
 *
 *  `_shared` is excluded BY NAME as well as by the `src/lib` test: it is the one
 *  home, not a carrier, and a future `services/_shared/src/lib/` would otherwise
 *  make the shared file its own twin and compare it against itself. */
const workers: string[] = fs
  .readdirSync(SERVICES)
  .filter((name) => !name.startsWith('.') && name !== '_shared')
  .filter((name) => fs.existsSync(`${SERVICES}/${name}/src/lib`))
  .sort();

/** `src/lib/*.ts` basenames for one Worker. Top level only — `mor/` is a
 *  platform-only subtree and has no twin to compare against. */
function libModules(worker: string): string[] {
  return fs
    .readdirSync(`${SERVICES}/${worker}/src/lib`)
    .filter((f) => f.endsWith('.ts'))
    .sort();
}

/** A module basename carried by two or more Workers, with the Workers that carry
 *  it. This is the whole subject set, and it is a FACT ABOUT THE TREE. */
const twins: Array<{ module: string; carriers: string[] }> = (() => {
  const byModule = new Map<string, string[]>();
  for (const w of workers) {
    for (const m of libModules(w)) byModule.set(m, [...(byModule.get(m) ?? []), w]);
  }
  return [...byModule.entries()]
    .filter(([, carriers]) => carriers.length >= 2)
    .map(([module, carriers]) => ({ module, carriers }))
    .sort((a, b) => a.module.localeCompare(b.module));
})();

/** Does this twin have one home under `services/_shared/src/`? A FACT ABOUT THE
 *  TREE, read the same way the twin set is. */
const hasSharedHome = (module: string): boolean => fs.existsSync(`${SHARED_SRC}/${module}`);

/** The exact source a carrier's copy must consist of, once comments are stripped
 *  and lines are trimmed. `services/<worker>/src/lib/<m>.ts` sits three
 *  directories below `services/`, and so does the stamped
 *  `services/<app>-api/src/lib/<m>.ts` the brick produces — one depth, one
 *  string, no per-carrier arithmetic to get wrong. */
const expectedReexport = (module: string): string =>
  `export * from '../../../_shared/src/${module.replace(/\.ts$/, '')}';`;

const sharedTwins = twins.filter((t) => hasSharedHome(t.module));
const comparedTwins = twins.filter((t) => !hasSharedHome(t.module));

// ── the exception table ──────────────────────────────────────────────────────

/** A declaration that exists in every carrier and is DIFFERENT on purpose —
 *  differing ONLY on the lines this row names. */
interface Divergence {
  module: string;
  declaration: string;
  /** The exact normalised source lines (comments stripped, indentation dropped,
   *  everything inside the line kept byte for byte) that some carriers may have
   *  and others may not. These lines are subtracted from every copy and the
   *  REMAINDER IS COMPARED — so the hole this row opens is the size of this
   *  array, not the size of the declaration. Each line must still be a real
   *  difference: present in at least one copy and absent from at least one, or
   *  the anti-rot limb calls the row stale. */
  exemptLines: string[];
  why: string;
}

/** A declaration only some carriers have, on purpose. */
interface SoleOwner {
  module: string;
  declaration: string;
  /** The Workers that carry it. Every other carrier of the module must not. */
  carriers: string[];
  why: string;
}

/**
 * EMPTY, AND DELIBERATELY SO — see the header. Its only two rows were
 * `error-sink.ts :: SinkContext` (exempting `appId: string | undefined;`) and
 * `error-sink.ts :: buildEnvelope` (exempting the `app_id` tag spread). That
 * module has ONE home since [ADR 067] decision 2, where `appId` is a single
 * OPTIONAL field — so the asymmetry is now expressed in the type system, one
 * file cannot differ from itself, and the anti-rot limb below refuses a row
 * naming a shared-home module at all.
 *
 * An empty table is the STRICTEST setting for the compared group, not a
 * weakened one: `d1.ts` is held equal with zero exemptions.
 */
const DECLARED_DIVERGENCES: Divergence[] = [];

// ⏱ 2026-09-12 - THE TABLE IS EMPTY, AND THAT IS THE POINT OF THE CHANGE THAT
// EMPTIED IT. Every row here named `d1.ts`: `firstRow` and `run` as belonging to one
// Worker, and `allRows`, `uuid`, `TRANSIENT_D1_MESSAGES` and `todayYmd` as absent from
// the app template's four-line starter stub on stamp day. All six described the same
// underlying fact - d1.ts was TWO copies plus a stub - and the stub is exactly why the
// transient-retry fix reached both live Workers and never the template every future app
// is stamped from.
//
// 🔴 d1.ts now has a SHARED HOME (services/_shared/src/d1.ts) and all three carriers
// re-export it, so it left the COMPARED group for the SHARED-HOME group and is held to
// the stricter limb instead. A sole-owner row would now be excusing a difference that
// has become unrepresentable - one file cannot differ from itself - which this test's
// own anti-rot limb refuses, correctly.
//
// An empty table is NOT a weaker test. The floors above still demand a minimum number
// of workers, twinned modules, shared-home modules and compared modules, so a tree that
// stopped having twins at all cannot pass by declaring nothing. The next real sole owner
// goes here with its own measurement.
const DECLARED_SOLE_OWNERS: SoleOwner[] = [];

// ── the reader ───────────────────────────────────────────────────────────────

/** Comments out, string and template literals preserved. A `//` inside
 *  `` `${u.protocol}//${u.host}/api/...` `` must survive, which is why quotes are
 *  tracked before comment starts. Regex literals are NOT tracked — a regex whose
 *  first character is `/` or `*` is a comment or a syntax error respectively, so
 *  the only shapes this cannot see are ones that cannot occur. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      out += ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Indentation and blank lines dropped; everything INSIDE a line kept byte for
 *  byte, so a string literal's contents are never silently normalised away. */
function normalise(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** A declaration's normalised text with every DECLARED exempt line removed.
 *
 *  This is the whole of what "sub-declaration exemption" means here: the lines a
 *  row names are subtracted from EVERY copy, and what is left is compared as
 *  usual. Removing rather than ignoring-in-place is deliberate — the exempt line
 *  sits at a different index in each copy (the copy that lacks it is one line
 *  shorter), so a positional comparison would report the whole tail as drifted. */
function withoutExemptLines(text: string, exempt: readonly string[]): string {
  if (exempt.length === 0) return text;
  const drop = new Set(exempt);
  return text
    .split('\n')
    .filter((l) => !drop.has(l))
    .join('\n');
}

/** The divergence row for one declaration, or undefined. */
function divergenceFor(module: string, declaration: string): Divergence | undefined {
  return DECLARED_DIVERGENCES.find((d) => d.module === module && d.declaration === declaration);
}

const DECL_NAME =
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function|interface|type|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/;

/** The file's top-level declarations, by name, normalised.
 *
 *  Everything that is NOT a named declaration — imports, side-effecting
 *  statements, `export default` of an expression — is joined in source order
 *  under the single key `<module prologue>` and compared as one unit. That is
 *  what stops a divergence from hiding in the one part of the file this reader
 *  cannot name; an unnamed statement added to one copy alone still turns the
 *  comparison red. */
function declarations(source: string): Map<string, string> {
  const src = stripComments(source);
  const named = new Map<string, string>();
  const prologue: string[] = [];

  let depth = 0;
  let start = 0;
  let i = 0;
  const flush = (end: number): void => {
    const text = src.slice(start, end);
    start = end;
    if (!text.trim()) return;
    const name = DECL_NAME.exec(text)?.[1];
    if (name === undefined) {
      prologue.push(normalise(text));
      return;
    }
    // A repeated name would silently overwrite. It cannot happen in valid TS at
    // one scope, but if it ever does the comparison must not quietly halve.
    named.set(named.has(name) ? `${name} (duplicate)` : name, normalise(text));
  };

  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      i++;
      if (depth === 0 && ch === '}') flush(i);
      continue;
    }
    if (ch === ';' && depth === 0) {
      i++;
      flush(i);
      continue;
    }
    i++;
  }
  flush(src.length);

  if (prologue.length > 0) named.set('<module prologue>', prologue.join('\n'));
  return named;
}

/** module basename -> carrier -> (declaration -> normalised text). */
const parsed = new Map<string, Map<string, Map<string, string>>>(
  comparedTwins.map(({ module, carriers }) => [
    module,
    new Map(
      carriers.map((w) => [
        w,
        declarations(fs.readFileSync(`${SERVICES}/${w}/src/lib/${module}`, 'utf8')),
      ]),
    ),
  ]),
);

describe('the modules duplicated across services/* are held equal', () => {
  it('the derived subject set still finds both Workers and both twinned modules', () => {
    // Without this the whole file is vacuous: a rename, a moved `src/lib`, or a
    // cwd this reader cannot resolve would leave every assertion below ranging
    // over an empty map and reporting a clean tree.
    expect(
      workers.length,
      `only ${workers.length} Worker(s) with a src/lib under ${SERVICES} — the scan is broken, not the tree`,
    ).toBeGreaterThanOrEqual(MIN_WORKERS);
    expect(
      twins.length,
      `only ${twins.length} twinned module(s) across ${workers.join(', ')} — ` +
        'a module carried by two Workers stopped being seen as one, so nothing is being compared',
    ).toBeGreaterThanOrEqual(MIN_TWINNED_MODULES);
    // Each GROUP is floored separately. A twin that moves between them silently
    // — a shared home deleted, or a compared module quietly given one — would
    // otherwise leave one limb iterating an empty list and printing green while
    // the total above still looked healthy.
    expect(
      sharedTwins.length,
      `only ${sharedTwins.length} twinned module(s) have a home under ${SHARED_SRC} ` +
        `(${sharedTwins.map((t) => t.module).join(', ') || 'none'}) — the re-export limb below would range ` +
        'over nothing. Either the shared directory moved, or a module was copied back into the carriers.',
    ).toBeGreaterThanOrEqual(MIN_SHARED_HOME_MODULES);
    expect(
      comparedTwins.length,
      `only ${comparedTwins.length} twinned module(s) are still compared copy-against-copy ` +
        `(${comparedTwins.map((t) => t.module).join(', ') || 'none'}) — the equality, sole-owner and ` +
        'anti-rot limbs below would range over nothing.',
    ).toBeGreaterThanOrEqual(MIN_COMPARED_MODULES);
    for (const { module, carriers } of comparedTwins) {
      for (const w of carriers) {
        const decls = parsed.get(module)?.get(w);
        expect(
          decls?.size ?? 0,
          `services/${w}/src/lib/${module} parsed to ZERO declarations — the reader stopped reading`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('every carrier of a shared-home module is EXACTLY a re-export of it', () => {
    // 🔴 "IS", NOT "CONTAINS". A copy that re-exports the shared home and then
    // declares one more thing of its own is a fork wearing a delegation: the
    // import line makes the file look delegated to every reader and to every
    // guard that follows delegations, while the declaration it adds is checked
    // by nothing. So the whole of the comment-stripped, trimmed source must be
    // the one expected line — which is also what makes `wc -l` on these files a
    // meaningful number rather than a coincidence.
    const wrong: string[] = [];
    for (const { module, carriers } of sharedTwins) {
      const home = `${SHARED_SRC}/${module}`;
      const homeDecls = declarations(fs.readFileSync(home, 'utf8'));
      if (homeDecls.size === 0) {
        wrong.push(
          `services/_shared/src/${module} parsed to ZERO declarations. Every carrier below re-exports it, so ` +
            'an empty home means every carrier exports nothing and every consumer of them fails to compile — ' +
            'or, worse, the reader stopped reading and this limb is comparing nothing.',
        );
      }
      const want = expectedReexport(module);
      for (const w of carriers) {
        const rel = `services/${w}/src/lib/${module}`;
        const got = normalise(stripComments(fs.readFileSync(`${SERVICES}/${w}/src/lib/${module}`, 'utf8')));
        if (got === want) continue;
        wrong.push(
          `${rel} is not a re-export of services/_shared/src/${module}.\n` +
            `    expected exactly: ${want}\n` +
            `    found:            ${got.split('\n').join(' ⏎ ') || '(nothing)'}\n` +
            '    That module has ONE home since [ADR 067] decision 2. A carrier that declares anything of its ' +
            'own has forked it back, and nothing compares the fork to the home — which is the state this file ' +
            'was written to end. Move the change into services/_shared/src/, or, if the difference is ' +
            'principled, delete the shared home and let the copies be COMPARED again (the other limbs here ' +
            'take over, and the deploy filter globs in .github/workflows/deploy-workers.yml come out with it).',
        );
      }
    }
    expect(wrong, wrong.join('\n\n')).toEqual([]);
  });

  it('every declaration present in all carriers is IDENTICAL outside its declared exempt lines', () => {
    const drifted: string[] = [];
    for (const { module, carriers } of comparedTwins) {
      const byWorker = parsed.get(module)!;
      const [reference, ...others] = carriers;
      const ref = byWorker.get(reference)!;
      for (const [name, text] of ref) {
        const everywhere = others.every((w) => byWorker.get(w)!.has(name));
        if (!everywhere) continue; // the sole-owner limb below owns this case
        // A declared row narrows the comparison to the lines it did NOT name. It
        // does not switch the comparison off, which is what it used to do.
        const row = divergenceFor(module, name);
        const exempt = row?.exemptLines ?? [];
        const refBody = withoutExemptLines(text, exempt);
        const disagreeing = others.filter(
          (w) => withoutExemptLines(byWorker.get(w)!.get(name)!, exempt) !== refBody,
        );
        if (disagreeing.length === 0) continue;
        drifted.push(
          `services/*/src/lib/${module} :: ${name} — services/${reference} and ` +
            `${disagreeing.map((w) => `services/${w}`).join(', ')} disagree` +
            (row === undefined
              ? '. '
              : ` OUTSIDE the ${exempt.length} line(s) DECLARED_DIVERGENCES exempts here ` +
                `(${exempt.map((l) => JSON.stringify(l)).join(' · ')}). An exemption covers the lines it ` +
                'names and nothing else, so this is real drift inside an otherwise-declared declaration. ') +
            'These files are duplicated ON PURPOSE and the duplication is only safe while a fix reaches every ' +
            'copy. Apply the change to the other copy, or — if the difference is principled — say so in ' +
            'DECLARED_DIVERGENCES in this file: a new row for a new declaration, or another entry in the ' +
            "existing row's `exemptLines`, with the reason.",
        );
      }
    }
    expect(drifted, drifted.join('\n\n')).toEqual([]);
  });

  it('every declaration missing from some carrier is a declared sole owner', () => {
    const undeclared: string[] = [];
    for (const { module, carriers } of comparedTwins) {
      const byWorker = parsed.get(module)!;
      const union = new Set(carriers.flatMap((w) => [...byWorker.get(w)!.keys()]));
      for (const name of [...union].sort()) {
        const has = carriers.filter((w) => byWorker.get(w)!.has(name));
        if (has.length === carriers.length) continue;
        const row = DECLARED_SOLE_OWNERS.find((d) => d.module === module && d.declaration === name);
        if (row !== undefined && [...row.carriers].sort().join(',') === [...has].sort().join(',')) continue;
        undeclared.push(
          `services/*/src/lib/${module} :: ${name} — present in ${has.map((w) => `services/${w}`).join(', ')} ` +
            `and absent from ${carriers.filter((w) => !has.includes(w)).map((w) => `services/${w}`).join(', ')}. ` +
            'Either the other copy never got the change, or the asymmetry is deliberate and needs a row in ' +
            'DECLARED_SOLE_OWNERS naming the carriers and the reason.',
        );
      }
    }
    expect(undeclared, undeclared.join('\n\n')).toEqual([]);
  });

  it('no exception row has outlived what it excuses', () => {
    // An exemption list with no floor under it is how a permission granted once
    // becomes a permission nobody can revoke: the difference gets fixed, the row
    // stays, and the next real divergence lands under a name already excused.
    const stale: string[] = [];

    // A row naming a module that now has ONE home excuses a difference that has
    // become unrepresentable — one file cannot differ from itself — and would
    // sit there excusing the next real one. Checked before the tables' own
    // limbs, because `parsed` deliberately holds only the compared group and
    // such a row would otherwise be reported as "no longer a twinned module",
    // which is a different and less useful sentence.
    for (const d of [...DECLARED_DIVERGENCES, ...DECLARED_SOLE_OWNERS]) {
      if (!hasSharedHome(d.module)) continue;
      stale.push(
        `an exception row names ${d.module} :: ${d.declaration}, and ${d.module} now has ONE home at ` +
          `services/_shared/src/${d.module}. Every carrier re-exports it, so there is no second copy for this ` +
          'row to excuse. Delete the row.',
      );
    }

    for (const d of DECLARED_DIVERGENCES) {
      if (hasSharedHome(d.module)) continue;
      const byWorker = parsed.get(d.module);
      if (byWorker === undefined) {
        stale.push(`DECLARED_DIVERGENCES names ${d.module}, which is no longer a twinned module. Delete the row.`);
        continue;
      }
      const texts = [...byWorker.entries()].map(([w, decls]) => ({ w, text: decls.get(d.declaration) }));
      const missing = texts.filter((t) => t.text === undefined).map((t) => t.w);
      if (missing.length > 0) {
        stale.push(
          `DECLARED_DIVERGENCES names ${d.module} :: ${d.declaration}, which services/${missing.join(', services/')} ` +
            'no longer declares. A divergence row for a declaration that does not exist everywhere is either a ' +
            'DECLARED_SOLE_OWNERS row now, or nothing at all.',
        );
        continue;
      }
      // LINE BY LINE, because the exemption is line-scoped. A row that named a
      // whole declaration could only be checked as "do the copies still differ
      // at all"; naming lines means each one can be asked the sharper question —
      // is THIS line still a difference? A line every copy now carries, or that
      // no copy carries, excuses nothing and hides the next drift on it.
      const carried = new Map<string, string[]>(
        d.exemptLines.map((line) => [
          line,
          texts.filter((t) => t.text!.split('\n').includes(line)).map((t) => t.w),
        ]),
      );
      for (const line of d.exemptLines) {
        const withLine = carried.get(line)!;
        if (withLine.length === texts.length) {
          stale.push(
            `DECLARED_DIVERGENCES exempts the line \`${line}\` in ${d.module} :: ${d.declaration}, and EVERY ` +
              `copy now carries it (services/${withLine.join(', services/')}) — it is not a divergence any ` +
              'more. Drop the line from `exemptLines` (and the row, if that empties it), or the next real ' +
              'drift on it passes unreported.',
          );
        } else if (withLine.length === 0) {
          stale.push(
            `DECLARED_DIVERGENCES exempts the line \`${line}\` in ${d.module} :: ${d.declaration}, and NO copy ` +
              'carries it. The row outlived the line it was written for — it now widens the comparison for ' +
              'nothing. Delete the line.',
          );
        }
      }
    }

    for (const d of DECLARED_SOLE_OWNERS) {
      if (hasSharedHome(d.module)) continue;
      const byWorker = parsed.get(d.module);
      if (byWorker === undefined) {
        stale.push(`DECLARED_SOLE_OWNERS names ${d.module}, which is no longer a twinned module. Delete the row.`);
        continue;
      }
      const has = [...byWorker.entries()].filter(([, decls]) => decls.has(d.declaration)).map(([w]) => w);
      if ([...has].sort().join(',') !== [...d.carriers].sort().join(',')) {
        stale.push(
          `DECLARED_SOLE_OWNERS says ${d.module} :: ${d.declaration} is carried by ` +
            `${d.carriers.join(', ') || '(nobody)'}, and the tree says ${has.join(', ') || '(nobody)'}. ` +
            'Either the other Worker grew its own copy — in which case the two are now twins and belong under ' +
            'the equality limb, not under an exemption — or the declaration was deleted and the row outlived it.',
        );
      }
    }

    expect(stale, stale.join('\n\n')).toEqual([]);
  });

  it('every exception row says WHO and WHY in prose a reader can act on', () => {
    // A one-word reason is how an exemption list becomes a list of names. The
    // floor is deliberately crude — it cannot judge a reason, only refuse an
    // absent one.
    for (const d of [...DECLARED_DIVERGENCES, ...DECLARED_SOLE_OWNERS]) {
      expect(
        d.why.length,
        `the exception for ${d.module} :: ${d.declaration} carries no usable reason`,
      ).toBeGreaterThan(80);
    }
    for (const d of DECLARED_SOLE_OWNERS) {
      expect(d.carriers.length, `${d.module} :: ${d.declaration} declares no carrier`).toBeGreaterThan(0);
    }
    // The floor that keeps the exemption sub-declaration. An empty `exemptLines`
    // subtracts nothing, so the comparison would be the ordinary one and the row
    // would be a note rather than a permission — but a reader seeing the name in
    // the table would reasonably believe the declaration was excused. Refuse the
    // shape outright.
    for (const d of DECLARED_DIVERGENCES) {
      expect(
        d.exemptLines.length,
        `${d.module} :: ${d.declaration} is declared as a divergence but names no exempt line — say WHICH ` +
          'lines differ, or delete the row',
      ).toBeGreaterThan(0);
    }
  });
});
