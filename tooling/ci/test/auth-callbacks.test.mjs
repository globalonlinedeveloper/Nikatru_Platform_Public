// Tests for tooling/ci/assert-auth-callbacks.mjs — the native auth callback
// guard (⏱ 2026-09-23, sign-in audit PR A).
//
// Every red case runs against a FIXTURE COPY of the guard's REAL inputs (the
// list is the guard's own APP_INPUTS / REPO_INPUTS export, so a new input
// cannot be forgotten here), mutates ONE thing, and asserts the exit code AND
// that the output names the file that broke. The green control beside them is
// the same copy, unmutated — so a red case proves the mutation, not the copy.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  APP_INPUTS,
  REPO_INPUTS,
  MIN_LINK_CALLS,
  authCallbacksShipped,
  msixProtocols,
  plistUrlSchemes,
} from '../assert-auth-callbacks.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-auth-callbacks.mjs');
const APP = 'subscriptiontracker';
const A = `apps/${APP}`;
const REPOSITORY = 'packages/auth_supabase/lib/src/supabase_auth_repository.dart';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-auth-callbacks-test-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
/** A fresh copy of exactly what the guard reads. */
function fixture() {
  const root = join(TMP, `t${++seq}`);
  const copy = (rel) => {
    const from = join(REPO, rel);
    if (!existsSync(from)) return;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(from, join(root, rel), { recursive: true });
  };
  for (const rel of APP_INPUTS) copy(`${A}/${rel}`);
  for (const rel of REPO_INPUTS) copy(rel);
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

/** Replace in a fixture file, and FAIL the test if nothing matched — a mutation
 *  that silently did nothing would make its red case pass for the wrong reason. */
function mutate(root, rel, from, to) {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = before.replace(from, to);
  assert.notEqual(after, before, `mutation did not apply to ${rel}: ${from}`);
  writeFileSync(p, after);
}

/** A mutated fixture run: expect `code`, and every pattern in the output. */
function red(mutations, code, ...patterns) {
  const root = fixture();
  mutations(root);
  const r = run(root);
  assert.equal(r.code, code, r.out);
  for (const p of patterns) assert.match(r.out, p);
  return r;
}

describe('assert-auth-callbacks — green', () => {
  test('passes on the real tree', () => {
    const r = run(REPO);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /5 native target\(s\)/);
    assert.match(r.out, /confirm, oauth, link, reset, email-change/);
  });

  test('passes on the fixture copy (the control every red case below mutates)', () => {
    const r = run(fixture());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 app\(s\) · 5 native target\(s\)/);
  });

  test('authCallbacksShipped is true on the copy and false once a registration goes', () => {
    const root = fixture();
    assert.equal(authCallbacksShipped(root), true);
    mutate(root, `${A}/macos/Runner/Info.plist`, '<string>com.nikatru.subscriptiontracker</string>', '<string>com.nikatru.other</string>');
    assert.equal(authCallbacksShipped(root), false);
  });

  test('authCallbacksShipped is false on a tree with no apps (0 targets proved)', () => {
    const root = join(TMP, `empty${++seq}`);
    mkdirSync(root, { recursive: true });
    assert.equal(authCallbacksShipped(root), false);
  });
});

describe('assert-auth-callbacks — android', () => {
  const MANIFEST = `${A}/android/app/src/main/AndroidManifest.xml`;

  test('FAILS when the auth-callback intent-filter is deleted, naming the manifest', () => {
    red(
      (root) => mutate(root, MANIFEST, /<intent-filter android:autoVerify="false">[\s\S]*?<\/intent-filter>/, ''),
      1,
      /AndroidManifest\.xml:\d+: the launcher activity has no VIEW \+ DEFAULT \+ BROWSABLE/,
    );
  });

  test('FAILS when the filter names another host', () => {
    red((root) => mutate(root, MANIFEST, 'android:host="auth-callback"', 'android:host="callback"'), 1, /no VIEW \+ DEFAULT \+ BROWSABLE/);
  });

  test('FAILS when the filter loses BROWSABLE', () => {
    red(
      (root) => mutate(root, MANIFEST, /\s*<category android:name="android\.intent\.category\.BROWSABLE"\/>\s*(?=<data)/, '\n'),
      1,
      /no VIEW \+ DEFAULT \+ BROWSABLE/,
    );
  });

  test('FAILS when the launcher activity is launchMode standard', () => {
    red((root) => mutate(root, MANIFEST, 'android:launchMode="singleTop"', 'android:launchMode="standard"'), 1, /launchMode is "standard"/);
  });

  test('FAILS when Flutter deep linking is left on', () => {
    red(
      (root) => mutate(root, MANIFEST, /(android:name="flutter_deeplinking_enabled"\s*android:value=)"false"/, '$1"true"'),
      1,
      /flutter_deeplinking_enabled to false/,
    );
  });

  test('FAILS when an overlay manifest removes the intent-filter', () => {
    red(
      (root) => {
        const rel = `${A}/android/app/src/channel/some-store/AndroidManifest.xml`;
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(
          join(root, rel),
          '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">\n' +
            '  <application>\n    <activity android:name=".MainActivity">\n' +
            '      <intent-filter tools:node="remove"/>\n    </activity>\n  </application>\n</manifest>\n',
        );
      },
      1,
      /channel\/some-store\/AndroidManifest\.xml:4: <intent-filter tools:node="remove">/,
    );
  });

  test('a filter inside an XML comment does not count', () => {
    red(
      (root) =>
        mutate(root, MANIFEST, /(<intent-filter android:autoVerify="false">[\s\S]*?<\/intent-filter>)/, '<!-- $1 -->'),
      1,
      /no VIEW \+ DEFAULT \+ BROWSABLE/,
    );
  });
});

describe('assert-auth-callbacks — ios / macos', () => {
  test('FAILS when the iOS plist names another scheme, naming the plist', () => {
    red(
      (root) => mutate(root, `${A}/ios/Runner/Info.plist`, '<string>com.nikatru.subscriptiontracker</string>', '<string>subscriptiontracker</string>'),
      1,
      /ios\/Runner\/Info\.plist: CFBundleURLTypes → CFBundleURLSchemes does not name com\.nikatru\.subscriptiontracker \(found: \[subscriptiontracker\]\)/,
    );
  });

  test('FAILS when the macOS plist has no CFBundleURLTypes at all', () => {
    red(
      (root) => mutate(root, `${A}/macos/Runner/Info.plist`, '<key>CFBundleURLTypes</key>', '<key>CFBundleURLTypesGone</key>'),
      1,
      /macos\/Runner\/Info\.plist: .*no CFBundleURLTypes at all/,
    );
  });

  test('FAILS when iOS Flutter deep linking is left on', () => {
    red(
      (root) => mutate(root, `${A}/ios/Runner/Info.plist`, /(<key>FlutterDeepLinkingEnabled<\/key>\s*)<false\/>/, '$1<true/>'),
      1,
      /FlutterDeepLinkingEnabled is not <false\/>/,
    );
  });

  test('plistUrlSchemes reads the nested schemes array', () => {
    const xml =
      '<dict><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array>' +
      '<string>a.b</string><string>c.d</string></array></dict></array><key>X</key><array><string>no</string></array></dict>';
    assert.deepEqual(plistUrlSchemes(xml), ['a.b', 'c.d']);
    assert.equal(plistUrlSchemes('<dict></dict>'), null);
  });
});

describe('assert-auth-callbacks — windows', () => {
  test('FAILS when msix_config drops protocol_activation, naming the pubspec', () => {
    red(
      (root) => mutate(root, `${A}/pubspec.yaml`, /^  protocol_activation: .*$/m, ''),
      1,
      /pubspec\.yaml: msix_config\.protocol_activation is \[\], not com\.nikatru\.subscriptiontracker/,
    );
  });

  test('FAILS when main.cpp stops forwarding to the running instance', () => {
    red(
      (root) => mutate(root, `${A}/windows/runner/main.cpp`, /if \(SendAppLinkToInstance\(\)\) \{[\s\S]*?\}\n/, ''),
      1,
      /main\.cpp: wWinMain no longer calls SendAppLinkToInstance\(\)/,
    );
  });

  test('msixProtocols reads a comma list and ignores other top-level blocks', () => {
    assert.deepEqual(msixProtocols('name: x\nmsix_config:\n  display_name: X\n  protocol_activation: a.b, c.d  # note\nother:\n  protocol_activation: z\n'), ['a.b', 'c.d']);
    assert.equal(msixProtocols('name: x\n'), null);
  });
});

describe('assert-auth-callbacks — linux', () => {
  const DESKTOP = `${A}/linux/packaging/com.nikatru.subscriptiontracker.desktop`;
  const RUNNER = `${A}/linux/runner/my_application.cc`;

  test('FAILS when the .desktop entry loses its MimeType', () => {
    red((root) => mutate(root, DESKTOP, /^MimeType=.*\n/m, ''), 1, /\.desktop: MimeType does not name x-scheme-handler\/com\.nikatru\.subscriptiontracker/);
  });

  test('FAILS when Exec carries no %u', () => {
    red((root) => mutate(root, DESKTOP, /^(Exec=\S+) %u$/m, '$1'), 1, /\.desktop: Exec \(subscription-tracker\) carries no %u/);
  });

  test('FAILS when the runner goes back to NON_UNIQUE', () => {
    red(
      (root) => mutate(root, RUNNER, 'G_APPLICATION_HANDLES_COMMAND_LINE | G_APPLICATION_HANDLES_OPEN,\n      nullptr', 'G_APPLICATION_NON_UNIQUE,\n      nullptr'),
      1,
      /my_application\.cc:\d+: the GApplication is created G_APPLICATION_NON_UNIQUE/,
    );
  });

  test('the NON_UNIQUE fallback inside local_command_line is not the creation flag', () => {
    // The file already carries G_APPLICATION_NON_UNIQUE in the fallback path;
    // the real tree passing is the proof it is not read as the creation flag.
    assert.match(readFileSync(join(REPO, RUNNER), 'utf8'), /G_APPLICATION_NON_UNIQUE/);
    assert.equal(run(fixture()).code, 0);
  });

  test('FAILS when local_command_line handles the line itself (return TRUE)', () => {
    red(
      (root) => mutate(root, RUNNER, /return FALSE;\n\}/, 'return TRUE;\n}'),
      1,
      /my_application_local_command_line does not end in `return FALSE;`/,
    );
  });
});

describe('assert-auth-callbacks — declared targets', () => {
  const AUTH = `${A}/lib/state/providers/auth.dart`;

  test('FAILS when kAuthCallbackTargets drops a target whose directory ships', () => {
    red((root) => mutate(root, AUTH, /\n\s*TargetPlatform\.linux,\n(?=\};)/, '\n'), 1, /apps\/subscriptiontracker\/linux\/ ships, but kAuthCallbackTargets does not name TargetPlatform\.linux/);
  });

  test('FAILS when kAuthCallbackTargets claims a target with no native directory', () => {
    red(
      (root) => rmSync(join(root, A, 'linux'), { recursive: true, force: true }),
      1,
      /names TargetPlatform\.linux, but apps\/subscriptiontracker\/linux\/ does not exist/,
    );
  });

  test('FAILS when the declared set is not passed to AuthCapabilities', () => {
    red(
      (root) => mutate(root, AUTH, 'registeredCallbacks: kAuthCallbackTargets', 'registeredCallbacks: const <TargetPlatform>{}'),
      1,
      /kAuthCallbackTargets is declared but not passed/,
    );
  });
});

describe('assert-auth-callbacks — allow list', () => {
  const MAIL = 'tooling/mail-transport.json';

  test('FAILS when one marker entry is removed from uri_allow_list', () => {
    red(
      (root) => mutate(root, MAIL, ',com.nikatru.subscriptiontracker://auth-callback?nk_auth=reset', ''),
      1,
      /uri_allow_list has no exact "com\.nikatru\.subscriptiontracker:\/\/auth-callback\?nk_auth=reset"/,
    );
  });

  // Grades the guard header's claim that the markers are read off `enum AuthFlow`
  // (judged `proven` in tooling/mechanism-claims.json): a flow added to the enum
  // and not to the allow list goes red. A marker list typed into the guard would
  // stay green here.
  test('FAILS when enum AuthFlow gains a marker the allow list does not admit', () => {
    red(
      (root) =>
        mutate(
          root,
          'packages/auth_supabase/lib/src/auth_redirect.dart',
          "  emailChange('email-change');",
          "  emailChange('email-change'),\n\n  magicLink('magic-link');",
        ),
      1,
      /uri_allow_list has no exact "com\.nikatru\.subscriptiontracker:\/\/auth-callback\?nk_auth=magic-link"/,
    );
  });

  test('FAILS when the bare callback entry is removed', () => {
    red(
      (root) => mutate(root, MAIL, ',com.nikatru.subscriptiontracker://auth-callback,', ','),
      1,
      /has no exact "com\.nikatru\.subscriptiontracker:\/\/auth-callback"/,
    );
  });

  test('FAILS on a wildcard over the custom scheme', () => {
    red(
      (root) => mutate(root, MAIL, 'http://localhost:8080/**', 'http://localhost:8080/**,com.nikatru.subscriptiontracker://**'),
      1,
      /entry "com\.nikatru\.subscriptiontracker:\/\/\*\*" is a wildcard on a custom scheme/,
    );
  });

  test('COVERAGE LOST (exit 2) when uri_allow_list is absent', () => {
    red((root) => mutate(root, MAIL, /"uri_allow_list": "[^"]*",\n/, ''), 2, /COVERAGE LOST — tooling\/mail-transport\.json supabaseAuth\.uri_allow_list/);
  });
});

describe('assert-auth-callbacks — link-sending calls', () => {
  test('FAILS when signUp drops emailRedirectTo, naming file and line', () => {
    const root = fixture();
    const src = readFileSync(join(root, REPOSITORY), 'utf8');
    const line = src.slice(0, src.indexOf('_auth.signUp(')).split('\n').length;
    mutate(root, REPOSITORY, /(_auth\.signUp\([\s\S]*?)\n\s*emailRedirectTo: redirects\(AuthFlow\.signUpConfirm\),/, '$1');
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`supabase_auth_repository\\.dart:${line}: \\.signUp\\( passes no \`emailRedirectTo\``));
  });

  test('FAILS when resetPasswordForEmail passes another flow', () => {
    red(
      (root) => mutate(root, REPOSITORY, 'redirectTo: redirects(AuthFlow.reset)', 'redirectTo: redirects(AuthFlow.oauth)'),
      1,
      /\.resetPasswordForEmail\( passes redirects\(AuthFlow\.oauth\) — this call's link is AuthFlow\.reset/,
    );
  });

  test('FAILS when a call passes a literal URL instead of the derivation', () => {
    red(
      (root) => mutate(root, REPOSITORY, 'redirectTo: redirects(AuthFlow.linkIdentity)', "redirectTo: 'https://nikatru.com/'"),
      1,
      /\.linkIdentity\( passes `redirectTo: 'https:\/\/nikatru\.com\/'`/,
    );
  });

  test('FAILS on an email change (updateUser with email:) that passes no redirect', () => {
    red(
      (root) =>
        mutate(
          root,
          REPOSITORY,
          'sb.UserAttributes(password: newPassword),',
          'sb.UserAttributes(email: newPassword),',
        ),
      1,
      /\.updateUser\( passes no `emailRedirectTo`/,
    );
  });

  test('a password-only updateUser is not a link-sending call', () => {
    // The real repository calls updateUser twice without `email:`; green proves they are skipped.
    assert.match(readFileSync(join(REPO, REPOSITORY), 'utf8'), /updateUser\(\s*sb\.UserAttributes\(password:/);
    assert.equal(run(fixture()).code, 0);
  });

  test(`COVERAGE LOST (exit 2) when fewer than ${MIN_LINK_CALLS} calls are found`, () => {
    red(
      (root) => mutate(root, REPOSITORY, /_auth\.linkIdentity\(/, '_auth.linkIdentityRenamed('),
      2,
      new RegExp(`found ${MIN_LINK_CALLS - 1} link-sending GoTrue call\\(s\\).*below the floor of ${MIN_LINK_CALLS}`),
    );
  });
});

describe('assert-auth-callbacks — derivation and wiring', () => {
  const REDIRECT = 'packages/auth_supabase/lib/src/auth_redirect.dart';

  test('FAILS when the scheme derivation changes', () => {
    red((root) => mutate(root, REDIRECT, "'com.nikatru.$appId'", "'nikatru.$appId'"), 1, /authCallbackScheme\(\) no longer builds 'com\.nikatru\.\$appId'/);
  });

  test('COVERAGE LOST (exit 2) when auth_redirect.dart is missing', () => {
    red((root) => rmSync(join(root, REDIRECT)), 2, /COVERAGE LOST — packages\/auth_supabase\/lib\/src\/auth_redirect\.dart is missing/);
  });

  test('FAILS when the brick builds the repository without redirects', () => {
    red(
      (root) =>
        mutate(
          root,
          'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart',
          /redirects: AuthRedirects\.current\([^)]*\),/,
          '',
        ),
      1,
      /__brick__\/apps\/\{\{app_id\}\}\/lib\/state\/providers\.dart:\d+: SupabaseAuthRepository\( is built without `redirects: AuthRedirects\.current/,
    );
  });

  test('FAILS when the app builds the repository without redirects', () => {
    red(
      (root) => mutate(root, `${A}/lib/state/providers/auth.dart`, /redirects: AuthRedirects\.current\([^)]*\),/, ''),
      1,
      /providers\/auth\.dart:\d+: SupabaseAuthRepository\( is built without/,
    );
  });

  test('COVERAGE LOST (exit 2) when no app constructs SupabaseAuthRepository', () => {
    red((root) => rmSync(join(root, 'apps'), { recursive: true, force: true }), 2, /COVERAGE LOST — no app under apps\/ constructs SupabaseAuthRepository/);
  });
});

// ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT · limb PROVIDER-POLICY. Google is
// never shipped without Apple (App Store Review Guideline 4.8). Each case sets
// BOTH flags in the fixture's `AuthProviders.configured`, written out by hand.
// ⏱ 2026-09-26 — Google went live, so the REAL tree is now the google: true,
// apple: true case, and the state PR B shipped (google off beside Apple) is
// kept as a mutation below so that arm is still read.
describe('assert-auth-callbacks — provider policy', () => {
  const PROVIDERS = 'packages/auth_supabase/lib/src/auth_providers.dart';
  const CONFIGURED = /apple: true,\s*google: true,/;

  test('the real tree reads apple=true google=true and passes', () => {
    const r = run(fixture());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /providers apple=true google=true/);
  });

  test('🔴 google: true with apple: false FAILS, naming the file', () => {
    red(
      (root) => mutate(root, PROVIDERS, CONFIGURED, 'apple: false,\n    google: true,'),
      1,
      /auth_providers\.dart:\d+: `google: true` with `apple: false` — App Store Review Guideline 4\.8/,
    );
  });

  test('google: false with apple: true passes', () => {
    const root = fixture();
    mutate(root, PROVIDERS, CONFIGURED, 'apple: true,\n    google: false,');
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /providers apple=true google=false/);
  });

  test('google: false with apple: false passes', () => {
    const root = fixture();
    mutate(root, PROVIDERS, CONFIGURED, 'apple: false,\n    google: false,');
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /providers apple=false google=false/);
  });

  test('a flag that is not a literal is COVERAGE LOST (exit 2), not a guess', () => {
    red(
      (root) => mutate(root, PROVIDERS, CONFIGURED, 'apple: true,\n    google: kIsWeb,'),
      2,
      /COVERAGE LOST — packages\/auth_supabase\/lib\/src\/auth_providers\.dart:\d+: `google:` is `kIsWeb`/,
    );
  });

  test('a renamed declaration is COVERAGE LOST (exit 2)', () => {
    red(
      (root) => mutate(root, PROVIDERS, 'static const AuthProviders configured', 'static const AuthProviders live'),
      2,
      /COVERAGE LOST — packages\/auth_supabase\/lib\/src\/auth_providers\.dart: no `static const AuthProviders configured = AuthProviders\(`/,
    );
  });
});
