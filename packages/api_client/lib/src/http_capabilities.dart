/// What the HTTP layer can actually do on a platform — [pipeline C-7].
///
/// ⚠️ THIS FILE IS PURE DART, DELIBERATELY, and that is why it does not use
/// `TargetPlatform` like the other capability matrices. `packages/api_client`
/// declares no Flutter dependency: it runs under `dart test`, not
/// `flutter test`. Importing `package:flutter/foundation.dart` here would both
/// break that and be an undeclared dependency that a pub workspace resolves
/// anyway — the exact silent-boundary-death [pipeline C-5] exists to catch. So
/// the platform is named by a local enum and the CALLER maps its
/// `TargetPlatform` onto it.
///
/// 🔴 WEB IS A DIFFERENT NETWORK STACK, not the same one under another name.
/// dio is pure Dart, which makes it tempting to call this adapter portable and
/// stop. On web every request goes through the browser's fetch/XHR, so:
///   · **CORS is enforced by the browser and cannot be bypassed by the client.**
///     A request that works on all five other platforms fails on web unless the
///     SERVER sends the right headers — which is why the Worker's
///     `ALLOWED_ORIGINS` is a client-facing concern with its own CI guard.
///   · **User-Agent cannot be set** — the browser owns it, and the assignment is
///     silently IGNORED rather than refused, so the bug looks like a server
///     problem.
///   · **Certificate pinning is impossible** — the page never sees the socket.
///
/// A "six platforms" claim about HTTP that does not name web separately is
/// claiming something untrue.
library;

/// The platforms this matrix distinguishes. Deliberately mirrors
/// `TargetPlatform` + web without depending on Flutter to say so.
enum HttpPlatform { android, iOS, macOS, windows, linux, web, fuchsia }

class HttpCapabilities {
  const HttpCapabilities({
    required this.customHeaders,
    required this.certificatePinning,
    required this.corsEnforcedByBrowser,
    required this.note,
  });

  /// Whether the app controls ALL request headers, User-Agent included.
  final bool customHeaders;

  /// Whether certificate pinning is possible at all.
  final bool certificatePinning;

  /// Whether a browser enforces CORS on every request — a SERVER-side fix, not
  /// a client-side one.
  final bool corsEnforcedByBrowser;

  /// Why this platform differs, in one line. Empty when it does not.
  final String note;

  /// The capabilities for [platform].
  static HttpCapabilities forPlatform(HttpPlatform platform) {
    return switch (platform) {
      HttpPlatform.web => const HttpCapabilities(
          // The browser owns User-Agent; assignment is silently IGNORED.
          customHeaders: false,
          certificatePinning: false,
          corsEnforcedByBrowser: true,
          note:
              'Web: requests go through the browser. CORS is enforced and can '
              'only be fixed SERVER-side (see the Worker ALLOWED_ORIGINS guard); '
              'User-Agent cannot be set and the assignment is silently ignored; '
              'certificate pinning is impossible because the page never sees the '
              'socket.',
        ),
      HttpPlatform.android ||
      HttpPlatform.iOS ||
      HttpPlatform.macOS ||
      HttpPlatform.windows ||
      HttpPlatform.linux =>
        const HttpCapabilities(
          customHeaders: true,
          certificatePinning: true,
          corsEnforcedByBrowser: false,
          note: '',
        ),
      HttpPlatform.fuchsia => const HttpCapabilities(
          customHeaders: true,
          certificatePinning: false,
          corsEnforcedByBrowser: false,
          note: 'Fuchsia is not a target platform for this portfolio.',
        ),
    };
  }

  @override
  String toString() => 'HttpCapabilities(customHeaders: $customHeaders, '
      'certificatePinning: $certificatePinning, '
      'corsEnforcedByBrowser: $corsEnforcedByBrowser)';
}
