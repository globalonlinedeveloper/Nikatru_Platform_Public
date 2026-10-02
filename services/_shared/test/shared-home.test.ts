import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// shared-home.test.ts — THE ONE RULE THAT MAKES `services/_shared/` WORK AT ALL:
// nothing in it may carry a BARE import — except a module LISTED below as needing
// one, importing a package `services/_shared/package.json` DECLARES.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-012).
// services/_shared became a package (`@nikatru/worker-kit`) that declares `jose`,
// and each Worker installs its dependencies into services/_shared/node_modules
// (`npm ci --prefix ../_shared`, the Worker's postinstall — npm does not install a
// `file:` link's own dependencies). That is what let the auth plumbing move here
// whole (src/auth-middleware.ts). The measurement below is still the rule for
// everything else: a module that needs no dependency must not grow one, because
// a bare import of an UNDECLARED package resolves for nobody, and a module that
// needs no dependency is one every carrier can read without installing anything.
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
        readdirSync(p: string, o: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
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

/** Every `.ts` under the shared home, derived from the tree, as a path relative
 *  to it. RECURSIVE since 2026-10-01: `src/ports/` and `src/ports/fakes/` are
 *  reserved for the port trains, and a module there must meet the same rule. */
function tsUnder(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    if (e.isDirectory()) out.push(...tsUnder(`${dir}/${e.name}`, `${prefix}${e.name}/`));
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(`${prefix}${e.name}`);
  }
  return out;
}
const modules: string[] = tsUnder(SHARED_SRC).sort();

/** Collapse `.` and `..` segments of a forward-slash relative path; null when it
 *  climbs above its root. */
function within(path: string): string | null {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

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

/** The modules that NEED a dependency, and the packages each may import. Every
 *  other module stays dependency-free. A package named here must also be declared
 *  in services/_shared/package.json `dependencies`, or no install provides it. */
const DEPENDENT_MODULES: Readonly<Record<string, readonly string[]>> = {
  'auth-middleware.ts': ['jose'],
};

/** The specifiers that climb out of the home and PREDATE this limb: named, not
 *  forgiven. Each row is checked in both directions (a row whose import is gone
 *  fails as stale), so the list can only shrink; a new escape is never a new row. */
const KNOWN_ESCAPES: Readonly<Record<string, readonly string[]>> = {
  // #1127 (port-pay-core) re-exports the normalized MoR vocabulary from the
  // platform carrier, whose lib/mor/contract.ts its header names as that
  // vocabulary's home. Moving it is a payments change, not a kit move.
  'ports/payments.ts': ['../../../platform/src/lib/mor/contract'],
};

/** `dependencies` of services/_shared/package.json — what `npm ci --prefix ../_shared` installs. */
const declaredDependencies: string[] = Object.keys(
  (JSON.parse(fs.readFileSync(`${ROOT}/services/_shared/package.json`, 'utf8')) as { dependencies?: Record<string, string> })
    .dependencies ?? {},
);

/** The package a bare specifier names: `jose` of `jose/jwt/verify`, `@a/b` of `@a/b/c`. */
const packageOf = (spec: string): string => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

describe('services/_shared is dependency-free except where it declares otherwise', () => {
  it('the scan still finds the shared modules', () => {
    expect(
      modules.length,
      `only ${modules.length} module(s) under ${SHARED_SRC} — the scan is broken, not the tree`,
    ).toBeGreaterThanOrEqual(MIN_SHARED_MODULES);
  });

  it('every listed dependent module exists and imports only declared packages', () => {
    const problems: string[] = [];
    for (const [m, packages] of Object.entries(DEPENDENT_MODULES)) {
      if (!modules.includes(m)) problems.push(`DEPENDENT_MODULES names ${m}, which is not a module under ${SHARED_SRC} — a stale row.`);
      for (const pkg of packages) {
        if (!declaredDependencies.includes(pkg)) {
          problems.push(
            `${m} may import \`${pkg}\`, but services/_shared/package.json does not declare it, so ` +
              '`npm ci --prefix ../_shared` installs nothing for it to resolve against.',
          );
        }
      }
    }
    expect(problems, problems.join('\n\n')).toEqual([]);
  });

  it('no module carries a BARE import it is not listed for', () => {
    const offenders: string[] = [];
    for (const m of modules) {
      for (const spec of specifiersOf(fs.readFileSync(`${SHARED_SRC}/${m}`, 'utf8'))) {
        if (isRelative(spec)) continue;
        if ((DEPENDENT_MODULES[m] ?? []).includes(packageOf(spec))) continue;
        offenders.push(
          `services/_shared/src/${m} imports \`${spec}\`, and DEPENDENT_MODULES does not list ${m} for ` +
            `\`${packageOf(spec)}\`. A module that needs no dependency must not grow one; a package that is ` +
            'not declared in services/_shared/package.json resolves for nobody (`tsc --noEmit` fails with ' +
            'TS2307 and `wrangler deploy` with "Could not resolve", in every Worker and every stamped app). ' +
            'Declare it there and list the module here, or keep the dependency in the Worker and share only ' +
            "the decision. Do NOT reach for wrangler's suggested `alias`: it resolves a directory and " +
            "bypasses the package's `exports` conditions.",
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
        const dir = m.includes('/') ? m.slice(0, m.lastIndexOf('/') + 1) : '';
        const resolved = within(`${dir}${spec}`);
        if (resolved === null) {
          if ((KNOWN_ESCAPES[m] ?? []).includes(spec)) continue;
          broken.push(
            `services/_shared/src/${m} imports \`${spec}\`, which leaves the shared home. The one home cannot ` +
              'depend on one carrier.',
          );
          continue;
        }
        const target = `${SHARED_SRC}/${resolved}`;
        if (!fs.existsSync(target) && !fs.existsSync(`${target}.ts`)) {
          broken.push(`services/_shared/src/${m} imports \`${spec}\`, which is not a file.`);
        }
      }
    }
    expect(broken, broken.join('\n\n')).toEqual([]);
  });

  it('every KNOWN_ESCAPES row still names a real escape (the list can only shrink)', () => {
    const stale: string[] = [];
    for (const [m, specs] of Object.entries(KNOWN_ESCAPES)) {
      const imported = modules.includes(m) ? specifiersOf(fs.readFileSync(`${SHARED_SRC}/${m}`, 'utf8')) : [];
      for (const spec of specs) {
        if (!imported.includes(spec)) {
          stale.push(`KNOWN_ESCAPES names ${m} importing \`${spec}\`, which it no longer does — delete the row.`);
        }
      }
    }
    expect(stale, stale.join('\n\n')).toEqual([]);
  });
});
