import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:nikatru_core/nikatru_core.dart' show sha256Hex;
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

/// What a native sign-in sheet hands back: the provider's ID token, and the
/// RAW nonce GoTrue must check it against (Apple), or null (Google, whose
/// token carries no nonce on this path).
@immutable
class NativeIdToken {
  const NativeIdToken({
    required this.idToken,
    this.rawNonce,
    this.authorizationCode,
  });

  final String idToken;
  final String? rawNonce;

  /// ⏱ 2026-10-02 · review of #1155, finding 1. Apple's one-time
  /// authorization code (valid five minutes). An ID-token sign-in carries no
  /// provider refresh token, and without one an account deletion has nothing
  /// to revoke at Apple — so the code goes to the platform Worker, which
  /// exchanges it with the Sign in with Apple key and keeps the refresh token
  /// for the revoke. Never logged, never stored on the device.
  final String? authorizationCode;
}

/// ⏱ 2026-10-01 · EN-19. One provider's NATIVE sheet — the OS's own Apple or
/// Google account picker, in-process, with no browser.
///
/// 🔴 A CANCEL IS `null`, NEVER A THROW. The person closed the sheet; the
/// sign-in screen they started from is exactly where they should be, with no
/// error banner. A real failure (no network, a misconfigured client id)
/// still throws, and the repository maps it to `AuthFailure`.
abstract interface class NativeSignInSheet {
  Future<NativeIdToken?> obtain();
}

/// The sheets this build may use, per provider. A null sheet means "take the
/// PKCE browser door", which is what web, Windows and Linux always do.
@immutable
class NativeSignInSheets {
  const NativeSignInSheets({this.apple, this.google});

  static const NativeSignInSheets none = NativeSignInSheets();

  final NativeSignInSheet? apple;
  final NativeSignInSheet? google;

  /// The sheets for [platform]:
  ///   · Apple's sheet on iOS and macOS (AuthenticationServices);
  ///   · Google's on NO target yet. Its slot is here and the repository
  ///     already takes it ([NativeSignInSheets.google]); the adapter waits
  ///     for two owner inputs — the web client id GoTrue's Google provider
  ///     trusts (the ID token's audience) and the iOS client id — and for a
  ///     privacy audit of the GoogleSignIn, AppAuth, GTMAppAuth and
  ///     GTMSessionFetcher frameworks read from a built bundle, which every
  ///     iOS build would link the day `google_sign_in` is a dependency.
  /// Everything without a sheet (web, Windows, Linux, and Google everywhere)
  /// keeps the PKCE browser door.
  static NativeSignInSheets forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) return none;
    final bool appleSheet =
        platform == TargetPlatform.iOS || platform == TargetPlatform.macOS;
    return NativeSignInSheets(apple: appleSheet ? AppleSignInSheet() : null);
  }
}

/// Apple's sheet through `sign_in_with_apple`.
///
/// The nonce: Apple embeds `sha256(raw)` in the ID token, GoTrue is given the
/// raw value and checks the hash. A token replayed from another sign-in
/// carries another hash, which is the whole point of minting one per call.
class AppleSignInSheet implements NativeSignInSheet {
  AppleSignInSheet({Random? random}) : _random = random ?? Random.secure();

  final Random _random;

  @override
  Future<NativeIdToken?> obtain() async {
    final String raw = base64UrlEncode(
      List<int>.generate(32, (_) => _random.nextInt(256)),
    );
    try {
      final AuthorizationCredentialAppleID cred =
          await SignInWithApple.getAppleIDCredential(
            scopes: const <AppleIDAuthorizationScopes>[
              AppleIDAuthorizationScopes.email,
            ],
            nonce: sha256Hex(raw),
          );
      final String? token = cred.identityToken;
      if (token == null) return null;
      return NativeIdToken(
        idToken: token,
        rawNonce: raw,
        authorizationCode: cred.authorizationCode,
      );
    } on SignInWithAppleAuthorizationException catch (e) {
      if (e.code == AuthorizationErrorCode.canceled) return null;
      rethrow;
    }
  }
}
