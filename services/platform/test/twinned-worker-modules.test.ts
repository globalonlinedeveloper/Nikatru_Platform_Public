import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// twinned-worker-modules.test.ts — the two Workers carry the SAME module twice,
// and this is what makes a fix applied to one and not the other a RED BUILD.
//
// 🔴 THE CLAIM THAT WAS FALSE. `services/subly-api/src/lib/error-sink.ts` said,
// in its own header, that "tooling/ci/assert-worker-error-sink.mjs asserts BOTH
// copies exist and are wired, so a fix applied to one and not the other is a
// build failure rather than a discovery." Read that guard: it asserts each copy
// EXISTS, exports `reportWorkerError`, calls `fetch`, carries `server_name` and
// `release`, and does not read `API_VERSION`. Every one of those limbs is
// satisfied by each copy ALONE. Nothing in this repository has ever compared the
// two files. The `res.ok`-not-`true` correction of 2026-08-04 landed in both by
// hand, and had it landed in one, every check in the tree would have stayed
// green — which is precisely the "guard that silently stopped checking" shape
// CLAUDE.md's verification discipline is written about.
//
// ── WHY A GUARD AND NOT ONE SHARED HOME ──────────────────────────────────────
// The obvious repair is to give each module one home and have the other import
// it. Measured before choosing, because "a shared home that requires inventing a
// build step may be worse than a guard":
//
//   · NO MODULE BOUNDARY EXISTS BETWEEN THE TWO WORKERS TODAY. They are separate
//     npm packages with their own `package.json` + `package-lock.json`, their own
//     `tsconfig.json` with NO `paths` mapping between them, and their own
//     `npm ci` in CI. `pnpm-workspace.yaml` lists `sites/_shared` and
//     `tooling/content_pipeline` — neither Worker is a member, so a
//     `workspace:*` dependency would not resolve under the `npm ci` both lanes
//     actually run.
//   · A BARE RELATIVE IMPORT INTO A `services/_shared/` WOULD BUILD AND WOULD
//     BREAK THE DEPLOY. `.github/workflows/deploy-workers.yml` triggers on
//     `services/subly-api/**` and `services/platform/**`, and its inner
//     `paths-filter` decides PER SERVICE from the same two globs. A shared file
//     outside both directories matches neither, so an edit to it would deploy
//     NOTHING while CI went green — the exact failure that workflow's own header
//     records as incident #155, where a merged fix reported success and
//     production stayed broken for six hours. Repairing that means editing the
//     deploy workflow's filters, i.e. buying one copy of thirty lines with a new
//     class of silent staleness in the release path.
//
// So: the duplication stays a deliberate choice, and this test is the thing that
// makes it a CHECKED one.
//
// ── WHAT IS HELD EQUAL, AND HOW THE EXCEPTIONS CANNOT ROT ────────────────────
// Comments are stripped first: the two copies' headers are deliberately
// different documents (each explains what the defect cost ITS Worker) and
// holding prose equal would only teach people to stop writing it. What is held
// equal is the CODE, declaration by declaration.
//
// 🔴 AN EXEMPTION IS THE SIZE OF THE LINES IT NAMES, NOT THE SIZE OF THE
// DECLARATION. A `DECLARED_DIVERGENCES` row does NOT stop `SinkContext` or
// `buildEnvelope` from being compared. It names the exact normalised source
// lines that are allowed to be present in some copies and absent from others;
// those lines are removed from EVERY copy, and the remainder is still compared
// line for line. Written that way after measuring the alternative: while the row
// was a whole-declaration pass, changing `logger: 'worker'` to anything else in
// the platform copy of `buildEnvelope` ALONE left this file green — 5 passed,
// exit 0, measured 2026-08-17 — so a ~40-line function was excused by a one-line
// difference. That is the "guard that silently stopped checking" shape this file
// was written to close, reproduced inside the file itself.
//
// Real, principled divergences exist, so there is an exception table — and it is
// checked in BOTH directions, the same anti-rot floor `check-selection-record`
// applies to its EXEMPT list:
//
//   · a declaration in every copy that differs OUTSIDE
//     the lines its row exempts                        → FAIL
//   · an exempt LINE now carried by every copy, or by
//     none of them                                     → FAIL (stale permission:
//     the copies converged on that line, or it is gone — either way the row
//     excuses a difference that does not exist, and the next real drift on that
//     line would pass unreported)
//   · a divergence row naming NO exempt line           → FAIL (that is exactly
//     the whole-declaration pass described above)
//   · a declaration in only some copies                → must be DECLARED
//   · a DECLARED sole owner that the others now carry  → FAIL (same reason)
//   · a DECLARED row naming a module/declaration that
//     no longer exists                                 → FAIL (the row outlived
//     its subject)
//
// THE SUBJECT SET IS DERIVED, NOT LISTED. Every `services/*/src/lib/*.ts`
// basename carried by two or more Workers is a twin. Worker #3 stamped from the
// brick therefore acquires the obligation by existing, and a rename that empties
// the derived set fails the coverage limb instead of iterating nothing and
// printing green.
//
// ⚠️ AND BECAUSE IT IS DERIVED, THE BRICK'S STARTER STUB IS ALREADY DECLARED —
// STAMPING APP #2 MUST NOT BE A RED BUILD FOR A DIFFERENCE NOBODY INTRODUCED.
// `tooling/bricks/app/__brick__/…/{{app_id}}-api/src/lib/d1.ts` is four lines
// carrying `nowIso` alone, because `nowIso` is the only helper the stamped
// Worker imports (`src/index.ts` stamps it on the health route; `routes/
// account.ts` calls `.run()` on the D1 statement itself). So the day app #2 is
// stamped, `services/<app>-api/src/lib/d1.ts` joins the derived set WITHOUT
// `allRows`, `uuid` and `todayYmd`. Measured 2026-08-17 rather than predicted:
// that stub was copied to a scratch `services/probe2-api/` and this file run —
// exactly those three names, undeclared, one red limb, and the equality limb
// stayed green, which is also the proof that the stub's `nowIso` is byte-for-
// byte the same function as both real copies. The three are declared in
// DECLARED_SOLE_OWNERS below; the brick itself is NOT edited from here, and is
// not scanned by this file (it lives under `tooling/`, not `services/`).
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

/** Two Workers exist today; both carry `d1.ts` and `error-sink.ts`. Floors, not
 *  expectations — a derived set that shrinks below them means the scan broke,
 *  not that the duplication was resolved. */
const MIN_WORKERS = 2;
const MIN_TWINNED_MODULES = 2;

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

/** Every Worker that has a `src/lib` directory. Derived from the tree rather
 *  than listed, so Worker #3 is covered the day it is stamped. */
const workers: string[] = fs
  .readdirSync(SERVICES)
  .filter((name) => !name.startsWith('.'))
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

const DECLARED_DIVERGENCES: Divergence[] = [
  {
    module: 'error-sink.ts',
    declaration: 'SinkContext',
    exemptLines: ['appId: string | undefined;'],
    why:
      'platform carries an `appId` field and subly-api does not, and that asymmetry is [pipeline B-16]. ' +
      'platform is the ONE Worker every stamped app posts to, so a report there has to say WHOSE app broke; ' +
      'subly-api serves exactly one app, so `service: "subly-api"` already answers that question and an ' +
      '`appId` field here would be a value no caller could ever fill in differently.',
  },
  {
    module: 'error-sink.ts',
    declaration: 'buildEnvelope',
    exemptLines: ['...(ctx.appId ? { app_id: ctx.appId } : {}),'],
    why:
      'The other half of the same divergence: platform spreads `...(ctx.appId ? { app_id: ctx.appId } : {})` ' +
      'into the envelope TAGS so "show me every error for app X" is answerable across a 50-app portfolio on ' +
      'one shared host. That ONE line is the whole exemption. Everything else in this function — the event ' +
      'id shape, the timestamp, the transaction line, the stack frame, the three-line envelope join — is ' +
      'held identical by this test, line for line, because the equality limb subtracts the line above from ' +
      'both copies and compares what is left.',
  },
];

const DECLARED_SOLE_OWNERS: SoleOwner[] = [
  {
    module: 'd1.ts',
    declaration: 'firstRow',
    carriers: ['subly-api'],
    why:
      'subly-api reads single rows through this helper in routes/budget.ts and routes/subscriptions.ts. ' +
      'platform calls `stmt.first<T>()` directly (scheduled.ts, lib/mor/store.ts) and has no caller for it, ' +
      'so adding it there would ship an exported function with zero callers — dead code that this repo finds ' +
      'by mutation testing and deletes rather than keeps "for symmetry".',
  },
  {
    module: 'd1.ts',
    declaration: 'run',
    carriers: ['subly-api'],
    why:
      'Same shape as `firstRow`: used by subly-api routes/subscriptions.ts, while platform calls ' +
      '`stmt.run()` directly in ten places and never imports a wrapper for it.',
  },

  // ── the three rows below are about a Worker that does not exist yet ─────────
  // What they buy is stamp day, not today: every carrier currently has all three,
  // so the missing-declaration limb skips them. They are still CHECKED today —
  // the anti-rot limb reads them on every run, so deleting `uuid` from either
  // real copy turns this file red through the row for it. See the brick
  // paragraph in the header for how the three names were measured.
  {
    module: 'd1.ts',
    declaration: 'allRows',
    carriers: ['platform', 'subly-api'],
    why:
      "The brick's backend template ships `src/lib/d1.ts` as a FOUR-LINE STARTER STUB carrying `nowIso` " +
      'alone — that is the only helper a stamped Worker imports (`src/index.ts` for the health route; ' +
      '`routes/account.ts` calls `.run()` on the D1 statement directly). So Worker #3 joins the derived ' +
      'twin set without `allRows`, and that is the template being deliberately minimal, not a fix that ' +
      'failed to reach a copy. Declared ahead of the stamp so app #2 does not open on a red build for a ' +
      'difference nobody introduced. The day the stamped Worker grows its own `allRows`, this row stops ' +
      'matching the tree and the anti-rot limb says so — at which point it belongs under the equality limb.',
  },
  {
    module: 'd1.ts',
    declaration: 'uuid',
    carriers: ['platform', 'subly-api'],
    why:
      'Same brick stub, same reason as `allRows` directly above: the stamped Worker starts with `nowIso` ' +
      'only, so `uuid` is absent on stamp day by design. A stamped app that later needs an id generator ' +
      'copies this function, at which point the row goes stale and this test demands it be deleted so the ' +
      'two (then three) copies are held equal instead of excused.',
  },
  {
    module: 'd1.ts',
    declaration: 'todayYmd',
    carriers: ['platform', 'subly-api'],
    why:
      'Same brick stub, same reason as `allRows` and `uuid` above. Measured, not assumed: copying the ' +
      'brick stub to a scratch `services/probe2-api/` on 2026-08-17 and running this file reported exactly ' +
      'these three names as undeclared sole owners and nothing else, which is how the list was derived ' +
      'rather than guessed.',
  },
];

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
  twins.map(({ module, carriers }) => [
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
    for (const { module, carriers } of twins) {
      for (const w of carriers) {
        const decls = parsed.get(module)?.get(w);
        expect(
          decls?.size ?? 0,
          `services/${w}/src/lib/${module} parsed to ZERO declarations — the reader stopped reading`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('every declaration present in all carriers is IDENTICAL outside its declared exempt lines', () => {
    const drifted: string[] = [];
    for (const { module, carriers } of twins) {
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
    for (const { module, carriers } of twins) {
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

    for (const d of DECLARED_DIVERGENCES) {
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
