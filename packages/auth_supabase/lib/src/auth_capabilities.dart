import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, immutable, kIsWeb;

/// What identity can actually do on the platform this build is running on.
///
/// [pipeline C-15] DECLARED, NOT ASSUMED — the same pattern
/// `NotificationCapabilities` established, for the same reason: a caller must be
/// able to ask before promising the user something the platform cannot do.
///
/// 🔴 THE "LINUX HAS NO DEEP LINKS" CLAIM IS FALSE and this matrix says so.
/// Checked against the primary source 2026-07-28: `app_links` 7.2.1 (Apache-2.0)
/// supports **all six platforms**, Linux included. Carrying Linux as unsupported
/// would have written a real capability out of the portfolio on a wrong belief.
///
/// ⚠️ WEB IS THE PLATFORM TO WATCH, not Linux. Two separate traps, both real:
///   · the OAuth token arrives in the **URL fragment**, so any query-parameter
///     parsing finds nothing and fails SILENTLY — a login that just never
///     completes, with no error anywhere;
///   · `app_links` on web only reports the INITIAL link on first call.
/// Which is why web uses a full-page redirect and lets the SDK read the fragment
/// itself rather than hand-rolling callback parsing.
@immutable
class AuthCapabilities {
  const AuthCapabilities({
    required this.emailPassword,
    required this.oauthRedirect,
    required this.secureSessionStorage,
    required this.note,
  });

  /// Email + password sign-in. Pure REST, so it works everywhere.
  final bool emailPassword;

  /// OAuth (Apple/Google) completing via a redirect or deep link back into the
  /// app. Needs a registered callback on every platform.
  final bool oauthRedirect;

  /// Whether the session lands in an OS-backed secure store rather than
  /// ordinary app storage.
  final bool secureSessionStorage;

  /// Why this platform differs, in one line. Empty when it does not.
  final String note;

  /// The matrix for the platform this build is running on.
  ///
  /// Thin wrapper over [forPlatform] so the six rows stay reachable from a test.
  /// A matrix that can only be evaluated on the host is one where five of six
  /// rows are never exercised — a comment with a type.
  static AuthCapabilities current() =>
      forPlatform(defaultTargetPlatform, isWeb: kIsWeb);

  /// The capabilities for [platform], with [isWeb] taking precedence: a web
  /// build still reports a host [TargetPlatform], but a browser is its own
  /// platform for every question this class answers.
  static AuthCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const AuthCapabilities(
        emailPassword: true,
        oauthRedirect: true,
        // A browser exposes no OS keychain to a page. Stated, not hidden.
        secureSessionStorage: false,
        note:
            'Web: full-page redirect, never a popup (COOP/COEP blocks popups, '
            'and they break in embedded webviews and standalone PWAs). The '
            'token arrives in the URL FRAGMENT — query parsing fails silently. '
            'No OS keychain exists for a page, so the session is in ordinary '
            'web storage; short token lifetimes carry the risk instead.',
      );
    }
    return switch (platform) {
      TargetPlatform.android || TargetPlatform.iOS => const AuthCapabilities(
        emailPassword: true,
        oauthRedirect: true,
        secureSessionStorage: true,
        note: '',
      ),
      TargetPlatform.macOS => const AuthCapabilities(
        emailPassword: true,
        oauthRedirect: true,
        secureSessionStorage: true,
        note: 'macOS: Keychain, and a custom URL scheme for the callback.',
      ),
      TargetPlatform.windows => const AuthCapabilities(
        emailPassword: true,
        oauthRedirect: true,
        secureSessionStorage: true,
        note:
            'Windows: DPAPI for the session; the OAuth callback needs a '
            'registered custom URI scheme.',
      ),
      TargetPlatform.linux => const AuthCapabilities(
        emailPassword: true,
        // 🔒 SUPPORTED. app_links covers Linux — the contrary claim was false.
        oauthRedirect: true,
        secureSessionStorage: true,
        note:
            'Linux: libsecret for the session, and a .desktop entry declaring '
            'the URI scheme for the callback. Deep links ARE supported here — '
            'the claim that they are not was checked and is false.',
      ),
      TargetPlatform.fuchsia => const AuthCapabilities(
        emailPassword: true,
        oauthRedirect: false,
        secureSessionStorage: false,
        note: 'Fuchsia is not a target platform for this portfolio.',
      ),
    };
  }
}
