import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// What a platform can do with an external link — [pipeline C-7].
///
/// Pinned to **`url_launcher` 6.x**, the range this package declares. The
/// matrix is a statement about the PLUGIN's federated implementations, not
/// about the OS, so it is re-reviewed on any major bump.
///
/// ## Two rows, because the two schemes fail differently
/// - [canOpenHttps] — the plugin ships an implementation that hands an https
///   URL to the platform's default browser.
/// - [canOpenMailto] — the same call for `mailto:`. The plugin can always ASK;
///   whether anything answers depends on a mail client being registered as the
///   handler, which no platform guarantees. That is why the adapter returns
///   `LinkOutcome.notOpened` instead of assuming success.
@immutable
class ExternalLinkCapabilities {
  const ExternalLinkCapabilities({
    required this.canOpenHttps,
    required this.canOpenMailto,
    required this.why,
  });

  /// Whether this build can hand an https link to a browser at all.
  final bool canOpenHttps;

  /// Whether this build can hand a mailto link to a mail handler at all.
  final bool canOpenMailto;

  /// The one-line reason, never empty: a `false` with no reason is
  /// indistinguishable from an oversight.
  final String why;

  /// The capabilities for [platform]. [isWeb] wins over the host platform,
  /// because a web build still reports one.
  static ExternalLinkCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const ExternalLinkCapabilities(
        canOpenHttps: true,
        canOpenMailto: true,
        why: 'url_launcher_web opens the link in a new browser context; a '
            'popup blocker can refuse one not started by a tap, which the '
            'adapter reports as notOpened.',
      );
    }
    switch (platform) {
      case TargetPlatform.android:
        return const ExternalLinkCapabilities(
          canOpenHttps: true,
          canOpenMailto: true,
          why: 'url_launcher_android starts an activity for the link; a '
              'device with no app for the scheme answers false.',
        );
      case TargetPlatform.iOS:
        return const ExternalLinkCapabilities(
          canOpenHttps: true,
          canOpenMailto: true,
          why: 'url_launcher_ios opens https in the default browser and mailto '
              'in the configured mail app; a device with no mail account '
              'answers false.',
        );
      case TargetPlatform.macOS:
        return const ExternalLinkCapabilities(
          canOpenHttps: true,
          canOpenMailto: true,
          why: 'url_launcher_macos hands the link to the workspace default '
              'handler for its scheme.',
        );
      case TargetPlatform.windows:
        return const ExternalLinkCapabilities(
          canOpenHttps: true,
          canOpenMailto: true,
          why: 'url_launcher_windows hands the link to the shell; a machine '
              'with no mail client associated answers false for mailto.',
        );
      case TargetPlatform.linux:
        return const ExternalLinkCapabilities(
          canOpenHttps: true,
          canOpenMailto: true,
          why: 'url_launcher_linux asks the desktop for the default handler; a '
              'headless or minimal session may have none registered.',
        );
      case TargetPlatform.fuchsia:
        // Declared, and not a target. The plugin has no implementation here,
        // so the call throws MissingPluginException and reads as notOpened.
        return const ExternalLinkCapabilities(
          canOpenHttps: false,
          canOpenMailto: false,
          why: 'Fuchsia is not a distribution target and url_launcher has no '
              'implementation for it.',
        );
    }
  }

  @override
  String toString() => 'ExternalLinkCapabilities(canOpenHttps: $canOpenHttps, '
      'canOpenMailto: $canOpenMailto)';
}
