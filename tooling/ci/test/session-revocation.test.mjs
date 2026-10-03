// ─────────────────────────────────────────────────────────────────────────────
// session-revocation.test.mjs — the negative cases for
// assert-session-revocation.mjs (AUTH-REVOKE-AT-WORKERS).
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE — the real three auth
// middlewares, the real three wrangler configs, the real shared core and the
// real tooling/mail-transport.json — never a hand-built fixture, so every
// mutation is one a diff could actually make. The green control runs first: a
// red case over a copy that was already red would prove nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-session-revocation.mjs');

const PLATFORM = 'services/platform';
const STA = 'services/subscriptiontracker-api';
const TEMPLATE = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';
const SHARED = 'services/_shared/src';
const MAIL = 'tooling/mail-transport.json';

function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-session-revocation-'));
  mkdirSync(join(root, 'tooling'), { recursive: true });
  cpSync(join(REPO, MAIL), join(root, MAIL));
  cpSync(join(REPO, SHARED), join(root, SHARED), { recursive: true });
  for (const svc of [PLATFORM, STA, TEMPLATE]) {
    mkdirSync(join(root, svc), { recursive: true });
    cpSync(join(REPO, svc, 'src'), join(root, svc, 'src'), { recursive: true });
    cpSync(join(REPO, svc, 'wrangler.jsonc'), join(root, svc, 'wrangler.jsonc'));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Replace `from` with `to` in one file of a fresh copy, asserting the anchor
 *  was really there — a mutation that silently matched nothing is a green that
 *  proves nothing. */
function mutated(edits) {
  const root = realTree();
  for (const [rel, from, to] of edits) {
    const p = join(root, rel);
    const before = readFileSync(p, 'utf8');
    assert.ok(before.includes(from), `anchor not found in ${rel}: ${from}`);
    writeFileSync(p, before.split(from).join(to));
  }
  return root;
}

function withRoot(root, fn) {
  try {
    fn(run(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const KIT_AUTH = `${SHARED}/auth-middleware.ts`;
const IMPORT_LINE = '  revocationRefusal,\n';
const CALL = 'return revocationRefusal(payload, record) !== null;';
const STA_BINDING = '{ "binding": "SESSION_REVOKED", "id": "aa46ad5002874231931cc5dc5b6e2904" }';
const PLATFORM_BINDING = '{ "binding": "SESSION_REVOKED", "id": "aa46ad5002874231931cc5dc5b6e2904" },';

describe('assert-session-revocation over a copy of the real tree', () => {
  test('green control: the tree as it is exits 0 and names three carriers', () => {
    withRoot(realTree(), ({ code, out }) => {
      assert.equal(code, 0, out);
      assert.match(out, /3 carrier\(s\) \(2 live, 1 template\)/);
    });
  });

  // ⏱ 2026-10-01: the one verifier is the kit's auth-middleware.ts, which every
  // Worker and the brick delegate to, so the import and call mutations land there.
  test('🔴 the kit verifier stops importing revocationRefusal ⇒ exit 1', () => {
    withRoot(mutated([[KIT_AUTH, IMPORT_LINE, '']]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /_shared\/src\/auth-middleware\.ts: calls jwtVerify\( but does not import revocationRefusal/);
    });
  });

  test('🔴 the kit verifier keeps the import but never CALLS it ⇒ exit 1', () => {
    withRoot(mutated([[KIT_AUTH, CALL, 'return record === undefined;']]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /_shared\/src\/auth-middleware\.ts: calls jwtVerify\( but never calls revocationRefusal\(/);
    });
  });

  test('🔴 a call left only in a COMMENT is not a call ⇒ exit 1', () => {
    withRoot(mutated([[KIT_AUTH, CALL, `// ${CALL}\n  return false;`]]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /never calls revocationRefusal/);
    });
  });

  // ⏱ 2026-10-03 (review of #1152, minor 1): limb 1b. A delegate is exempt from
  // limb 1's call checks, so each of these exited 0 before it.
  const PLATFORM_AUTH = `${PLATFORM}/src/middleware/auth.ts`;
  const PLATFORM_IMPORT = 'NO_SYMMETRIC_FALLBACK, sessionRevoked, verifySupabaseToken';
  const REVOKED_IF = 'if (await sessionRevoked(c.env.SESSION_REVOKED, payload.sub, payload as Record<string, unknown>, logPrefix)) {';
  test('🔴 platformAuth drops its sessionRevoked import AND call ⇒ exit 1', () => {
    withRoot(
      mutated([[PLATFORM_AUTH, PLATFORM_IMPORT, 'NO_SYMMETRIC_FALLBACK, verifySupabaseToken'], [PLATFORM_AUTH, REVOKED_IF, 'if (false) {']]),
      ({ code, out }) => {
        assert.equal(code, 1, out);
        assert.match(out, /platform\/src\/middleware\/auth\.ts: verifies a token directly but does not import sessionRevoked/);
        assert.match(out, /platform\/src\/middleware\/auth\.ts: verifies a token directly but never calls sessionRevoked\(/);
      },
    );
  });

  test('🔴 a kit boundary drops its sessionRevoked call ⇒ exit 1, for each boundary', () => {
    // The kit holds the same `if` twice (supabaseAuthWith, then erasureAuth); cut one at a time.
    for (const [nth, name] of [[0, 'supabaseAuthWith'], [1, 'erasureAuth']]) {
      const root = realTree();
      const p = join(root, KIT_AUTH);
      const parts = readFileSync(p, 'utf8').split(REVOKED_IF);
      assert.equal(parts.length, 3, 'the kit no longer holds the two boundary calls this case cuts');
      writeFileSync(p, parts[0] + (nth === 0 ? 'if (false) {' : REVOKED_IF) + parts[1] + (nth === 1 ? 'if (false) {' : REVOKED_IF) + parts[2]);
      withRoot(root, ({ code, out }) => {
        assert.equal(code, 1, out);
        assert.match(out, new RegExp(`the boundary ${name} never calls sessionRevoked\\(`));
      });
    }
  });

  test('COVERAGE LOST: a kit boundary renamed ⇒ exit 2', () => {
    withRoot(mutated([[KIT_AUTH, 'export async function erasureAuth<', 'export async function erasureAuthV2<']]), ({ code, out }) => {
      assert.equal(code, 2, out);
      assert.match(out, /COVERAGE LOST — .*declares no function erasureAuth/);
    });
  });

  test('🔴 SESSION_REVOKED removed from the sta-api wrangler ⇒ exit 1', () => {
    withRoot(mutated([[`${STA}/wrangler.jsonc`, STA_BINDING, '']]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /subscriptiontracker-api\/wrangler\.jsonc: kv_namespaces does not bind SESSION_REVOKED/);
    });
  });

  test('🔴 SESSION_REVOKED removed from the brick wrangler ⇒ exit 1 (every stamped app would lack it)', () => {
    withRoot(mutated([[`${TEMPLATE}/wrangler.jsonc`, STA_BINDING, '']]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /\{\{app_id\}\}-api\/wrangler\.jsonc: kv_namespaces does not bind SESSION_REVOKED/);
    });
  });

  test('🔴 SESSION_REVOKED removed from the platform wrangler ⇒ exit 1', () => {
    withRoot(mutated([[`${PLATFORM}/wrangler.jsonc`, PLATFORM_BINDING, '']]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /services\/platform\/wrangler\.jsonc: kv_namespaces does not bind/);
    });
  });

  test('🔴 the carrier set is DERIVED: a new Worker that verifies tokens and ignores the list ⇒ exit 1', () => {
    const root = realTree();
    mkdirSync(join(root, 'services', 'newapp-api', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'services', 'newapp-api', 'src', 'auth.ts'),
      "import { jwtVerify } from 'jose';\nexport const v = (t: string, k: Uint8Array) => jwtVerify(t, k);\n",
    );
    writeFileSync(join(root, 'services', 'newapp-api', 'wrangler.jsonc'), '{ "name": "newapp-api" }\n');
    withRoot(root, ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /newapp-api\/src\/auth\.ts: calls jwtVerify\( but does not import revocationRefusal/);
      assert.match(out, /newapp-api\/wrangler\.jsonc: kv_namespaces does not bind SESSION_REVOKED/);
    });
  });

  test('a TEST file and a comment that name jwtVerify( are not carriers ⇒ still exit 0', () => {
    const root = realTree();
    writeFileSync(join(root, PLATFORM, 'src', 'probe.test.ts'), "import { jwtVerify } from 'jose';\njwtVerify('', new Uint8Array());\n");
    writeFileSync(join(root, PLATFORM, 'src', 'note.ts'), '// jwtVerify( is called in middleware/auth.ts only\nexport {};\n');
    withRoot(root, ({ code, out }) => assert.equal(code, 0, out));
  });

  test('🔴 jwt_exp raised to 7200 ⇒ exit 1 — a record would expire while a token it refuses is live', () => {
    withRoot(mutated([[MAIL, '"jwt_exp": 3600,', '"jwt_exp": 7200,']]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /REVOCATION_TTL_SECONDS is 3660, but jwt_exp \(7200/);
      assert.match(out, /EXPIRE while a token it refuses is still valid/);
    });
  });

  test('🔴 REVOCATION_TTL_SECONDS shortened ⇒ exit 1', () => {
    withRoot(
      mutated([[`${SHARED}/auth.ts`, 'export const REVOCATION_TTL_SECONDS = 3660;', 'export const REVOCATION_TTL_SECONDS = 3600;']]),
      ({ code, out }) => {
        assert.equal(code, 1, out);
        assert.match(out, /REVOCATION_TTL_SECONDS is 3600/);
      },
    );
  });

  test('COVERAGE LOST: REVOCATION_TTL_SECONDS no longer a literal ⇒ exit 2', () => {
    withRoot(
      mutated([[`${SHARED}/auth.ts`, 'export const REVOCATION_TTL_SECONDS = 3660;', 'export const REVOCATION_TTL_SECONDS = 3600 + CLOCK_SKEW_SECONDS;']]),
      ({ code, out }) => {
        assert.equal(code, 2, out);
        assert.match(out, /COVERAGE LOST — limb 2 could not read REVOCATION_TTL_SECONDS/);
      },
    );
  });

  test('COVERAGE LOST: no live carrier found ⇒ exit 2, never a vacuous pass', () => {
    const root = realTree();
    for (const svc of [PLATFORM, STA]) rmSync(join(root, svc, 'src'), { recursive: true, force: true });
    withRoot(root, ({ code, out }) => {
      assert.equal(code, 2, out);
      assert.match(out, /COVERAGE LOST — no file under services\/\*\/src calls jwtVerify\(/);
    });
  });

  test('COVERAGE LOST: the brick has a Worker but the walk found no template carrier ⇒ exit 2', () => {
    const root = realTree();
    rmSync(join(root, TEMPLATE, 'src'), { recursive: true, force: true });
    withRoot(root, ({ code, out }) => {
      assert.equal(code, 2, out);
      assert.match(out, /COVERAGE LOST — the brick carries a Worker/);
    });
  });

  test('COVERAGE LOST: no services/ at all ⇒ exit 2', () => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-session-revocation-empty-'));
    withRoot(root, ({ code, out }) => {
      assert.equal(code, 2, out);
      assert.match(out, /COVERAGE LOST/);
    });
  });
});
