import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// shared-home.test.ts — THE ONE RULE THAT MAKES `services/_shared/` WORK AT ALL:
// nothing in it may carry a BARE import.
//
// 🔴 THIS IS A MEASURED CONSTRAINT, NOT HOUSE STYLE. Node, tsc and esbuild all
// resolve a bare specifier by walking up from the FILE that writes it, and there
// is no `node_modules` at `services/_shared/`, at `services/`, or at the repo
// root: each Worker runs its own `npm ci` inside its own directory (its leg of
// lane-workers.yml's `worker` job), and `pnpm-workspace.yaml` lists only
// `sites/_shared` and `tooling/content_pipeline`. Measured 2026-09-06 with a
// probe module importing `jose`:
//
//   services/platform $ npx tsc --noEmit
//   ../_shared/src/_probe.ts(1,27): error TS2307: Cannot find module 'jose'
//   services/platform $ npx wrangler deploy --dry-run --outdir <scratch>
//   X [ERROR] Could not resolve "jose"  ../_shared/src/_probe.ts:1:26
//
// ⚠️ WRANGLER'S OWN SUGGESTED REPAIR IS REFUSED. Its error text offers an
// `alias` entry; aliasing `jose` to `./node_modules/jose` resolves a DIRECTORY
// and bypasses the package's `exports` conditions, which is exactly how the
// `workerd` build of jose was lost once already — `vitest.config.ts`'s header
// records the 44 platform tests that turned red when the equivalent slip
// happened through Vite. A shared home that silently changes which build of a
// crypto library is verified is worse than three copies of a predicate.
//
// So a bare import here is not a lint finding, it is a BROKEN BUILD in both
// Workers and in every app stamped from the brick — and it would be broken at
// `wrangler deploy`, i.e. after CI. This file is what makes it a red test
// instead, in both lanes, before the merge.
//
// ⚠️ IT IS A TEST AND NOT A `tooling/ci` GUARD ON PURPOSE. The property is about
// the Workers' own module graph and must hold in whatever tree each Worker's
// lane checks out; running it inside both `npm test` invocations puts it in
// front of the same `tsc`/`wrangler` steps that would otherwise discover it, and
// costs no new workflow wiring (`assert-guard-coverage` requires a workflow to
// invoke every guard under tooling/ci; both lanes already invoke `npm test`).
// ─────────────────────────────────────────────────────────────────────────────

// `process.getBuiltinModule` rather than `import 'node:fs'`, for the same reason
// twinned-worker-modules.test.ts uses it: `types` is deliberately just
// ["@cloudflare/workers-types"], so production code cannot reach for an API the
// Workers runtime does not have.
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

/** The repo root, found by walking up from the cwd — which is the SERVICE
 *  directory under `npm test`, and may be the repo root from an editor. */
function repoRoot(): string {
  const cwd = nodeProcess.cwd().replaceAll('\\', '/');
  for (const up of ['', '/..', '/../..', '/../../..']) {
    const root = `${cwd}${up}`;
    if (fs.existsSync(`${root}/services/_shared/src`)) return root;
  }
  throw new Error(
    `COVERAGE LOST — no ancestor of ${cwd} holds services/_shared/src, so this file cannot reach the ` +
      'shared home. Every assertion below would range over an empty set and pass.',
  );
}

const ROOT = repoRoot();
const SHARED_SRC = `${ROOT}/services/_shared/src`;

/** Every `.ts` under the shared home, derived from the tree. */
const modules: string[] = fs
  .readdirSync(SHARED_SRC)
  .filter((f) => f.endsWith('.ts'))
  .sort();

/** Floor. Three modules live here today (auth, error-sink, health); a reader
 *  that finds none would iterate nothing and print a clean tree. */
const MIN_SHARED_MODULES = 3;

/** Every module specifier the file imports or re-exports from, static forms
 *  only — which is all a Worker bundle may contain anyway. */
function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) out.push(m[1]);
  // `import 'x';` and `import('x')` carry no `from`.
  for (const m of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

const isRelative = (spec: string): boolean => spec.startsWith('./') || spec.startsWith('../');

describe('services/_shared is dependency-free', () => {
  it('the scan still finds the shared modules', () => {
    expect(
      modules.length,
      `only ${modules.length} module(s) under ${SHARED_SRC} — the scan is broken, not the tree`,
    ).toBeGreaterThanOrEqual(MIN_SHARED_MODULES);
  });

  it('no module carries a BARE import', () => {
    const offenders: string[] = [];
    for (const m of modules) {
      for (const spec of specifiersOf(fs.readFileSync(`${SHARED_SRC}/${m}`, 'utf8'))) {
        if (isRelative(spec)) continue;
        offenders.push(
          `services/_shared/src/${m} imports \`${spec}\`. There is no node_modules any carrier can reach ` +
            'from here, so this resolves for nobody: `tsc --noEmit` fails with TS2307 and `wrangler deploy` ' +
            'fails with "Could not resolve" — in BOTH Workers and in every app stamped from the brick. ' +
            'Keep the dependency in the Worker and share only the decision (see src/auth.ts, which is ' +
            'exactly that split). Do NOT reach for wrangler\'s suggested `alias`: it resolves a directory ' +
            "and bypasses the package's `exports` conditions.",
        );
      }
    }
    expect(offenders, offenders.join('\n\n')).toEqual([]);
  });

  it('every relative specifier resolves to a file that exists', () => {
    // A shared module may import a sibling shared module. Nothing else: a
    // specifier that climbs out of `services/_shared/src` would make the one
    // home depend on one carrier, which is the shape being removed.
    const broken: string[] = [];
    for (const m of modules) {
      for (const spec of specifiersOf(fs.readFileSync(`${SHARED_SRC}/${m}`, 'utf8'))) {
        if (!isRelative(spec)) continue;
        if (spec.includes('..')) {
          broken.push(
            `services/_shared/src/${m} imports \`${spec}\`, which leaves the shared home. The one home cannot ` +
              'depend on one carrier.',
          );
          continue;
        }
        const target = `${SHARED_SRC}/${spec.replace(/^\.\//, '')}`;
        if (!fs.existsSync(target) && !fs.existsSync(`${target}.ts`)) {
          broken.push(`services/_shared/src/${m} imports \`${spec}\`, which is not a file.`);
        }
      }
    }
    expect(broken, broken.join('\n\n')).toEqual([]);
  });
});
