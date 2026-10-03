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
// ⏱ 2026-10-02 · limb 3 (AB-A4-01): the register names the route, the sender
// carries its path, and the app and the brick wire the sender in.
const REGISTER = 'tooling/platform-register.json';
const SENDER = 'packages/api_client/lib/src/session_revocation_request.dart';
const APP_AUTH = 'apps/subscriptiontracker/lib/state/providers/auth.dart';
const BRICK_PROVIDERS = 'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart';
// ⏱ 2026-10-02 · review 1 of #1140: the hook is handed the bearer to send.
const WIRING = 'revokeAtWorkers: (String accessToken) =>';

function realTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-session-revocation-'));
  mkdirSync(join(root, 'tooling'), { recursive: true });
  cpSync(join(REPO, MAIL), join(root, MAIL));
  cpSync(join(REPO, SHARED), join(root, SHARED), { recursive: true });
  for (const rel of [REGISTER, SENDER, APP_AUTH, BRICK_PROVIDERS]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(root, rel));
  }
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
  test('green control: the tree as it is exits 0 and names four carriers', () => {
    withRoot(realTree(), ({ code, out }) => {
      assert.equal(code, 0, out);
      // ⏱ 2026-10-03 · lane feedback-intake: services/platform/src/routes/feedback.ts verifies an
      // optional sign-in token with the kit's verifier, so it is a carrier (3 → 4, 2 → 3 live).
      assert.match(out, /4 carrier\(s\) \(3 live, 1 template\)/);
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

  test('limb 3 green control: the sender and both constructions are named', () => {
    withRoot(realTree(), ({ code, out }) => {
      assert.equal(code, 0, out);
      assert.match(out, /\/v1\/sessions\/revoke-all is sent by packages\/api_client\/lib\/src\/session_revocation_request\.dart and wired into 2 SupabaseAuthRepository construction\(s\)/);
    });
  });

  test('🔴 limb 3: the app builds SupabaseAuthRepository WITHOUT revokeAtWorkers ⇒ exit 1 (AB-A4-01, the state before 2026-10-02)', () => {
    withRoot(mutated([[APP_AUTH, WIRING, 'unusedHook: (String accessToken) =>']]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /providers\/auth\.dart: builds SupabaseAuthRepository without `revokeAtWorkers:`/);
    });
  });

  test('🔴 limb 3: the BRICK loses the wiring ⇒ exit 1 (every stamped app would inherit the gap)', () => {
    withRoot(mutated([[BRICK_PROVIDERS, WIRING, 'unusedHook: (String accessToken) =>']]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /lib\/state\/providers\.dart: builds SupabaseAuthRepository without/);
    });
  });

  test('🔴 limb 3: no sender carries the path any more ⇒ exit 1', () => {
    withRoot(mutated([[SENDER, "'/v1/sessions/revoke-all'", "'/v1/sessions/revoke'"]]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /no Dart file under packages\/\*\/lib sends \/v1\/sessions\/revoke-all/);
    });
  });

  test('🔴 limb 3: a path left only in a COMMENT is not a sender ⇒ exit 1', () => {
    withRoot(mutated([[SENDER, "const String workerRevokeAllRoute = '/v1/sessions/revoke-all';", "// '/v1/sessions/revoke-all'\nconst String workerRevokeAllRoute = '/x';"]]), ({ code, out }) => {
      assert.equal(code, 1, out);
      assert.match(out, /no Dart file under packages/);
    });
  });

  test('COVERAGE LOST: limb 3 finds no SupabaseAuthRepository construction ⇒ exit 2', () => {
    const root = realTree();
    rmSync(join(root, APP_AUTH));
    rmSync(join(root, BRICK_PROVIDERS));
    withRoot(root, ({ code, out }) => {
      assert.equal(code, 2, out);
      assert.match(out, /limb 3 found no `SupabaseAuthRepository\(` construction/);
    });
  });

  test('COVERAGE LOST: the register no longer names the revoke-all route ⇒ exit 2', () => {
    withRoot(mutated([[REGISTER, '"id": "sessions-revoke-all"', '"id": "sessions-revoke-everything"']]), ({ code, out }) => {
      assert.equal(code, 2, out);
      assert.match(out, /limb 3 could not read the path of route "sessions-revoke-all"/);
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
