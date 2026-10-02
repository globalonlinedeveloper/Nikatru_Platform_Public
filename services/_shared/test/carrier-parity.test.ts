import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// carrier-parity.test.ts — NO CARRIER RE-IMPLEMENTS WHAT THE KIT EXPORTS.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-012).
// The auth plumbing was three hand copies for a reason no test could see:
// services/platform/test/twinned-worker-modules.test.ts holds `src/lib/*.ts`
// twins to their one home, and the plumbing lived in `src/middleware/`. So the
// copies drifted twice (#433 reaching one Worker; the JWKS cache's absent-binding
// check in one copy only) with every test green. The plumbing now lives once, in
// src/auth-middleware.ts, and THIS is the limb that keeps it once — and keeps
// every other kit module once too, wherever in a carrier a copy would land.
//
// THE RULE. For every name a module under services/_shared/src EXPORTS (derived
// from the tree), no CARRIER source file may DECLARE a top-level binding of the
// same name. A carrier is every services/<w>/src whose code imports from
// `_shared/src` — derived, so a stamped Worker is one the day it exists — plus
// the brick's Worker template, so the template every future app is stamped from
// is held here in every Worker's suite rather than only after a stamp. A
// re-export (`export * from` / `export { x } from`) declares nothing and passes:
// that is the shape this limb wants.
//
// ⚠️ KNOWN_DUPLICATES ARE THE DUPLICATES THAT PREDATE THIS LIMB, NAMED, NOT
// FORGIVEN. Each row is checked in BOTH directions: a row whose declaration is
// gone is stale and fails, so the list can only shrink. A new copy is never a new
// row; it is a re-export.
//
// ⚠️ `process.getBuiltinModule` rather than `import 'node:fs'`, for the reason
// shared-home.test.ts gives: each Worker's `types` is just
// ["@cloudflare/workers-types"].
// ─────────────────────────────────────────────────────────────────────────────

interface Dirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
const nodeProcess = (
  globalThis as unknown as {
    process: {
      cwd(): string;
      getBuiltinModule(id: 'node:fs'): {
        existsSync(p: string): boolean;
        readFileSync(p: string, enc: 'utf8'): string;
        readdirSync(p: string, o: { withFileTypes: true }): Dirent[];
      };
    };
  }
).process;
const fs = nodeProcess.getBuiltinModule('node:fs');

function repoRoot(): string {
  const cwd = nodeProcess.cwd().replaceAll('\\', '/');
  for (const up of ['', '/..', '/../..', '/../../..']) {
    const root = `${cwd}${up}`;
    if (fs.existsSync(`${root}/services/_shared/src`)) return root;
  }
  throw new Error(
    `COVERAGE LOST — no ancestor of ${cwd} holds services/_shared/src, so no carrier can be found and every ` +
      'assertion below would range over an empty set.',
  );
}

const ROOT = repoRoot();
const SHARED_SRC = `${ROOT}/services/_shared/src`;
/** The brick's Worker template. Its directory names are mustache, read literally. */
const BRICK_WORKER = `${ROOT}/tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api`;

const SKIP = new Set(['node_modules', '.wrangler', 'dist', 'coverage']);
function tsFilesUnder(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // no such directory
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) tsFilesUnder(p, out);
    else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Comments out, so a name spelled in prose is not a declaration. */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Top-level declarations: a line that STARTS with one, so a nested helper or a
 *  parameter is not counted. */
const DECLARATION = /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORTED = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

export function declaredNames(source: string): string[] {
  return [...stripComments(source).matchAll(DECLARATION)].map((m) => m[1]);
}

/** Every name the kit exports, with the module that exports it. */
const kitExports = new Map<string, string>();
for (const file of tsFilesUnder(SHARED_SRC)) {
  for (const m of stripComments(fs.readFileSync(file, 'utf8')).matchAll(EXPORTED)) {
    kitExports.set(m[1], file.slice(SHARED_SRC.length + 1));
  }
}

/** Carriers: every Worker whose src imports the kit, plus the brick's template. */
const carrierRoots: string[] = fs
  .readdirSync(`${ROOT}/services`, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== '_shared' && !e.name.startsWith('.'))
  .map((e) => `${ROOT}/services/${e.name}/src`)
  .filter((src) => tsFilesUnder(src).some((f) => /from\s*['"][^'"]*_shared\/src\//.test(fs.readFileSync(f, 'utf8'))));
if (fs.existsSync(BRICK_WORKER)) carrierRoots.push(`${BRICK_WORKER}/src`);

const rel = (p: string): string => p.slice(ROOT.length + 1);

interface KnownDuplicate {
  file: string;
  name: string;
  why: string;
}

/** The duplicates that predate this limb. Only ever shrinks — see the header. */
const KNOWN_DUPLICATES: KnownDuplicate[] = [
  ...['src/config.ts', 'src/lib/mor/paddle-cancel.ts', 'src/lib/mor/paddle-rail.ts', 'src/lib/mor/paddle.ts', 'src/routes/checkout.ts', 'src/routes/native-auth.ts'].map(
    (f) => ({
      file: `services/platform/${f}`,
      name: 'isPlainObject',
      why: 'a module-private one-line guard written before services/_shared/src/validate.ts reached platform; same rule, one import away',
    }),
  ),
  {
    file: 'services/platform/src/fx.ts',
    name: 'isCalendarDate',
    why: 'the ECB rate table\'s own date check, written before validate.ts reached platform',
  },
  {
    file: 'services/platform/src/lib/mor/bundle-store.ts',
    name: 'BundleGrantRow',
    why: 'the store\'s write-side row type; entitlement-read.ts exports the read-side row of the same name',
  },
  {
    file: 'services/platform/src/lib/native-attest/index.ts',
    name: 'Outcome',
    why: 'the attestation verdict (#1133); ports/payments.ts (#1127) exports an unrelated generic `Outcome<T>` of the same name',
  },
];

/** Floors: the scan must still be reaching both sides. */
const MIN_KIT_EXPORTS = 40;
const MIN_CARRIERS = 3; // services/platform, services/subscriptiontracker-api, the brick's template

describe('no carrier re-implements a kit export', () => {
  it('the scan still reaches the kit and the carriers', () => {
    expect(kitExports.size, `only ${kitExports.size} kit export(s) — the scan is broken, not the tree`).toBeGreaterThanOrEqual(MIN_KIT_EXPORTS);
    expect(carrierRoots.length, `carriers found: ${carrierRoots.map(rel).join(', ')}`).toBeGreaterThanOrEqual(MIN_CARRIERS);
    expect(kitExports.get('verifyAsymmetric')).toBe('auth-middleware.ts');
  });

  it('🔴 no carrier declares a name the kit exports (re-export it instead)', () => {
    const found: string[] = [];
    for (const root of carrierRoots) {
      for (const file of tsFilesUnder(root)) {
        for (const name of declaredNames(fs.readFileSync(file, 'utf8'))) {
          const home = kitExports.get(name);
          if (home === undefined) continue;
          if (KNOWN_DUPLICATES.some((d) => d.file === rel(file) && d.name === name)) continue;
          found.push(
            `${rel(file)} declares \`${name}\`, which services/_shared/src/${home} exports. A carrier's copy of a ` +
              'kit export is how the auth plumbing drifted twice: every later fix reaches the kit and not this ' +
              `file. Import or re-export it from services/_shared/src/${home.replace(/\.ts$/, '')}; a difference a ` +
              'carrier needs is an OPTION the kit takes (see supabaseAuthWith), not a copy.',
          );
        }
      }
    }
    expect(found, found.join('\n\n')).toEqual([]);
  });

  it('every KNOWN_DUPLICATES row still names a real duplicate (the list can only shrink)', () => {
    const stale: string[] = [];
    for (const d of KNOWN_DUPLICATES) {
      let source: string | null = null;
      try {
        source = fs.readFileSync(`${ROOT}/${d.file}`, 'utf8');
      } catch {
        // gone: the row is stale
      }
      const still = source !== null && declaredNames(source).includes(d.name) && kitExports.has(d.name);
      if (!still) stale.push(`KNOWN_DUPLICATES row ${d.file} :: ${d.name} names no duplicate any more — delete the row.`);
    }
    expect(stale, stale.join('\n')).toEqual([]);
  });

  it('the declaration reader sees the shapes a copy takes, and not a re-export', () => {
    const sample = [
      'export async function verifyAsymmetric(t: string) {}',
      'const remoteSets = new Map();',
      'export const warmJwksCache = async () => {};',
      'interface AuthContext {}',
      "export * from '../../../_shared/src/auth-middleware';",
      "export { bearer } from '../../../_shared/src/auth';",
      '// export function sessionRevoked() {}',
      '  function nested() {}',
    ].join('\n');
    expect(declaredNames(sample)).toEqual(['verifyAsymmetric', 'remoteSets', 'warmJwksCache', 'AuthContext']);
  });
});
