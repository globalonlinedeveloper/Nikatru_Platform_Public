#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// verify-auth-providers.mjs — the app's federated-provider declaration must
// agree with the identity server, IN BOTH DIRECTIONS.
//
// `AuthProviders.configured` (packages/auth_supabase/lib/src/auth_providers.dart)
// declares which federated sign-in providers Supabase will actually honour. The
// login screens gate their OAuth limb on it. It is a MEASURED constant, and a
// measured constant is exactly the kind of fact that rots: enabling Apple is a
// dashboard toggle in a browser, and nothing in this repository would notice.
//
// 🔴 WHY THIS GUARD EXISTS — IT IS THE SECOND FIX FOR THE SAME DEFECT.
// Subly shipped a "Continue with Apple" button that answered 400 "Unsupported
// provider: provider is not enabled" on every platform. The first fix gated it
// on `AuthCapabilities.oauthRedirect` — a fact about the PLATFORM — which is
// true for web, android, iOS, macOS, windows and linux and false only for
// fuchsia, which this portfolio does not ship. So the gate hid the button on no
// shipping target and the user-visible defect survived its own fix, reviewed and
// merged. The missing axis was the SERVER's answer, and that is what this
// compares against.
//
// ⚠️ BOTH DIRECTIONS ARE FAILURES, and the second is the one people forget:
//   · declared ON, server OFF  → the shipped button 400s. The original defect.
//   · declared OFF, server ON  → the owner did the work of standing up an
//     identity provider and the app hides it from every user. Silent, costs
//     real money, and nothing else in the tree would ever say so.
//
// THE SOURCE OF TRUTH IS GOTRUE'S OWN SETTINGS ENDPOINT:
//   GET $SUPABASE_URL/auth/v1/settings   (apikey + Authorization: Bearer)
// It answers `{"external": {"apple": false, "google": false, …, "email": true}}`
// and needs only the PUBLISHABLE key — the same value the app ships with — which
// is why this guard can run in CI without holding a privileged secret.
//
// Usage:  node tooling/ops/verify-auth-providers.mjs
//   Reads SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY from the environment, and
//   falls back to .claude/secrets.env for a local run.
//
// Exit 0 = the declaration and the live project agree on every provider.
// Exit 1 = they disagree, or the Dart declaration could not be PARSED (an
//          unreadable declaration is a failure, never a pass — see below).
// Exit 2 = could not look at all — no credentials, or the endpoint was
//          unreachable. A DIFFERENT code on purpose: "I could not look" must
//          never read as "I looked and it was fine".
//
// 🔴 NO `process.exit()` ANYWHERE BELOW. Calling it while an undici (fetch)
// keep-alive handle is open crashes libuv on Windows and the process reports 127
// instead of the code documented above — which broke the exit contract of all
// three sibling verifiers until 2026-08-05, on every path that had actually
// talked to the network. `process.exitCode` + return, as they now do.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DECL = join(
  ROOT,
  'packages',
  'auth_supabase',
  'lib',
  'src',
  'auth_providers.dart',
);
const VAULT = join(ROOT, '.claude', 'secrets.env');

/// 🔴 THE VALUES IN secrets.env ARE QUOTED. A reader that keeps the quotes
/// sends `Bearer "…"` and the server answers 400 — which reads exactly like a
/// revoked credential, and cost two sessions before it was diagnosed as a
/// property of the READER rather than of the token.
const unquote = (v) => v.replace(/^(['"])([\s\S]*)\1$/, '$2');

function fromVault(key) {
  if (!existsSync(VAULT)) return null;
  for (const line of readFileSync(VAULT, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    if (line.slice(0, i).trim() === key) return unquote(line.slice(i + 1).trim());
  }
  return null;
}

const cred = (key) => process.env[key]?.trim() || fromVault(key);

/// Parse the declared flags out of the Dart source.
///
/// ⚠️ PARSED ON STRUCTURE, NOT GREPPED FROM PROSE. This file is mostly a long
/// comment that repeatedly uses the words "apple", "google", "false" and "true";
/// a loose `grep 'apple: false'` would match the comment explaining why the flag
/// is false and keep passing after somebody changed the flag. So the match is
/// anchored to the `static const AuthProviders configured = AuthProviders(…)`
/// initialiser specifically, and an initialiser that does not parse is a
/// FAILURE — an assertion that cannot find its subject must never report ok.
function declared() {
  const src = readFileSync(DECL, 'utf8');
  const m = src.match(
    /static\s+const\s+AuthProviders\s+configured\s*=\s*AuthProviders\s*\(([^;]*?)\)\s*;/s,
  );
  if (!m) return null;
  const body = m[1];
  const flag = (name) => {
    const f = body.match(new RegExp(`\\b${name}\\s*:\\s*(true|false)\\b`));
    return f ? f[1] === 'true' : null;
  };
  const apple = flag('apple');
  const google = flag('google');
  if (apple === null || google === null) return null;
  return { apple, google };
}

async function main() {
  const url = cred('SUPABASE_URL');
  const key = cred('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) {
    console.error(
      'verify-auth-providers: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not set and ' +
        'no local vault was readable. I COULD NOT LOOK — this is exit 2, not a pass.',
    );
    return 2;
  }

  const want = declared();
  if (!want) {
    console.error(
      `✗ could not parse \`AuthProviders.configured\` out of ${DECL}. The declaration this ` +
        `guard exists to check is unreadable, so it asserts nothing — that is a FAILURE, ` +
        `because a guard whose subject has moved must go red rather than quietly pass.`,
    );
    return 1;
  }

  let body;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.error(
        `verify-auth-providers: GET /auth/v1/settings returned HTTP ${res.status}. The live answer ` +
          `is unreadable, so I could not look. (If this is 400/401, check the reader before the ` +
          `credential: the vault quotes its values.)`,
      );
      return 2;
    }
    body = await res.json();
  } catch (e) {
    console.error(`verify-auth-providers: ${url} was unreachable — ${e.message}. I COULD NOT LOOK.`);
    return 2;
  }

  const external = body?.external;
  if (!external || typeof external !== 'object') {
    console.error(
      'verify-auth-providers: the settings response carried no `external` map. Shape changed; ' +
        'this guard cannot answer and must not pretend to.',
    );
    return 2;
  }

  const problems = [];
  for (const name of ['apple', 'google']) {
    const live = external[name];
    if (typeof live !== 'boolean') {
      problems.push(
        `the live settings response has no boolean \`external.${name}\`. GoTrue stopped reporting ` +
          `this provider, so the declaration can no longer be checked against anything.`,
      );
      continue;
    }
    if (live === want[name]) {
      console.log(`ok   ${name}: declared ${want[name]}, live ${live}`);
      continue;
    }
    problems.push(
      want[name]
        ? `🔓 ${name}: DECLARED ENABLED, but the server says disabled. The login screens will ` +
            `render a "Continue with ${name}" button and Supabase will answer 400 "provider is not ` +
            `enabled" — this is the exact defect AuthProviders was created to end. Either enable ` +
            `${name} in the Supabase dashboard, or set \`${name}: false\` in auth_providers.dart.`
        : `🙈 ${name}: DECLARED DISABLED, but the server says ENABLED. Somebody stood the provider ` +
            `up and the app is hiding it from every user on every platform. Set \`${name}: true\` ` +
            `in auth_providers.dart to ship the button.`,
    );
  }

  if (problems.length) {
    console.error('');
    for (const p of problems) console.error(`✗ ${p}`);
    return 1;
  }
  console.log(
    '\nverify-auth-providers — AuthProviders.configured agrees with the live project on every ' +
      'federated provider. The OAuth limb shows exactly what the server will honour.',
  );
  return 0;
}

process.exitCode = await main();
