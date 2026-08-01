/// The identity adapter — the ONLY package that imports the Supabase SDK.
///
/// [pipeline C-15] Apps program against `AuthRepository` in `packages/core` and
/// take this package as the implementation. Nothing above the data layer names
/// a vendor, which is what makes the identity provider swappable.
library;

import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'src/secure_session_storage.dart';

export 'src/auth_capabilities.dart';
export 'src/in_memory_auth_repository.dart';
export 'src/secure_session_storage.dart';
export 'src/supabase_auth_repository.dart';

/// Initialise Supabase with the session in the platform SECURE store.
///
/// 🔴 [G-43] THE DEFAULT IS WRONG FOR US and this is the one call site that
/// fixes it. `Supabase.initialize` defaults to `SharedPreferencesLocalStorage`,
/// which writes the access AND refresh tokens as plaintext. Passing
/// [SecureSessionStorage] routes them through the Keychain / KeyStore / DPAPI /
/// libsecret instead.
///
/// It is a function rather than a note in a README because a security default
/// that depends on every future app remembering an argument is one that will be
/// forgotten by app #3. The brick calls this; nothing else should call
/// `Supabase.initialize` directly.
///
/// [publishableKey] is what the dart-define still calls SUPABASE_ANON_KEY. The
/// SDK deprecated `anonKey` in favour of `publishableKey` and the value is the
/// same string — passing it under the old name still compiles and would rot at
/// the next major, so it is passed under the new one here and the define keeps
/// its name until stage 4 renames it deliberately.
///
/// [detectSessionInUri] must stay TRUE on web: the OAuth token arrives in the
/// URL **fragment**, and the SDK reads it. Hand-rolled query parsing finds
/// nothing and fails silently — a login that simply never completes.
Future<void> initNikatruAuth({
  required String url,
  required String publishableKey,
  required core.SecureStore secureStore,
  bool detectSessionInUri = true,
}) async {
  await sb.Supabase.initialize(
    url: url,
    publishableKey: publishableKey,
    authOptions: nikatruAuthOptions(
      secureStore: secureStore,
      detectSessionInUri: detectSessionInUri,
    ),
  );
}

/// The auth options [initNikatruAuth] hands to `Supabase.initialize`.
///
/// SPLIT OUT SO IT CAN BE TESTED. `Supabase.initialize` needs plugin channels a
/// unit test has not got, so for as long as the storage override lived inside
/// it the ONE line that keeps refresh tokens out of plaintext was unassertable —
/// and the guard that stood in for a test matched the text of this file rather
/// than any call site, which is how the shipping app came to persist its
/// session in `shared_preferences` with CI green [G-43].
///
/// A test can build these options with a fake [core.SecureStore], call
/// `options.localStorage!.persistSession(...)` and prove the write LANDS IN THE
/// SECURE STORE. Drop the `localStorage:` argument below and that test fails,
/// which is the whole point of it being reachable.
sb.FlutterAuthClientOptions nikatruAuthOptions({
  required core.SecureStore secureStore,
  bool detectSessionInUri = true,
}) {
  return sb.FlutterAuthClientOptions(
    localStorage: SecureSessionStorage(store: secureStore),
    detectSessionInUri: detectSessionInUri,
    // PKCE is the flow that survives a redirect on a public client — the
    // implicit flow puts the token in the URL where history and referrers can
    // see it.
    authFlowType: sb.AuthFlowType.pkce,
  );
}
