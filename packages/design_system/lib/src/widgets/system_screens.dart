import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/material.dart';

/// The app-neutral system screens — [pipeline C-13].
///
/// These are the screens that are identical in all fifty apps: nothing here
/// knows what the app sells, which is what lets them live in the design system
/// at all ([pipeline C-5] limb b). They take their copy as parameters so a
/// stamped app supplies localised strings without this package ever gaining a
/// dependency on l10n.
///
/// Deliberately NO new package dependency. An offline notice built on
/// `connectivity_plus` would be a plugin that has to earn its place under
/// [pipeline C-4] — and it would earn it for the wrong reason, because knowing
/// the radio is on says nothing about whether the API is reachable. The honest
/// signal is a failed request, which the app already has.

/// The screen a user sees when a widget throws during build.
///
/// 🔴 WHY THIS EXISTS. Flutter's default `ErrorWidget` is the grey-and-yellow
/// "RenderFlex overflowed"-style box in profile/release, and the red screen in
/// debug. Shipping either to a user is the difference between "something went
/// wrong, here is a way out" and a screen that looks like the app is broken
/// beyond use — and it leaks widget internals and stack details to anyone
/// looking. Installing a replacement is one line at startup and cannot be
/// retrofitted across fifty shipped apps.
class AppErrorScreen extends StatelessWidget {
  const AppErrorScreen({
    required this.title,
    required this.message,
    this.onRetry,
    this.retryLabel,
    this.details,
    super.key,
  });

  final String title;
  final String message;

  /// Omit to show no way out — but a screen with no exit is a dead end, so
  /// prefer supplying one.
  final VoidCallback? onRetry;
  final String? retryLabel;

  /// Technical detail. Shown ONLY in debug: in release it would leak internals
  /// to a user who cannot act on them, and to anyone shoulder-surfing.
  final String? details;

  /// LAST-RESORT copy, used when the error happens before Localizations exist.
  ///
  /// 🔴 THIS CANNOT COME FROM THE APP'S ARB. [install] runs before `runApp`, so
  /// there is no `BuildContext` and no `Localizations` to read — and an error
  /// during the FIRST build is exactly the case this screen exists for. English
  /// in the wrong locale beats no error screen at all.
  ///
  /// It lives in the design system rather than the brick because it is a
  /// property of this widget, not of any app: the design system already takes
  /// its copy as parameters and has no l10n dependency by design. A stamped app
  /// that wants localised copy passes it to the constructor, which is what every
  /// in-tree error screen does.
  static const String fallbackTitle = 'Something went wrong';
  static const String fallbackMessage =
      'The app hit an unexpected problem. Restarting usually helps.';

  /// Install this as Flutter's global build-error widget.
  ///
  /// Call once at startup, before `runApp`. Returns the previous builder so a
  /// test can restore it — a global left mutated across tests is a flake
  /// generator.
  static ErrorWidgetBuilder install({
    String title = fallbackTitle,
    String message = fallbackMessage,
  }) {
    final ErrorWidgetBuilder previous = ErrorWidget.builder;
    ErrorWidget.builder = (FlutterErrorDetails details) => AppErrorScreen(
          title: title,
          message: message,
          details: details.exceptionAsString(),
        );
    return previous;
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.error_outline,
                size: 48,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                title,
                style: theme.textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                message,
                style: theme.textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
              // Debug only — see [details].
              if (details != null && !kReleaseMode) ...<Widget>[
                const SizedBox(height: 16),
                Text(
                  details!,
                  style: theme.textTheme.bodySmall,
                  textAlign: TextAlign.center,
                  maxLines: 6,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              if (onRetry != null) ...<Widget>[
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: onRetry,
                  child: Text(retryLabel ?? 'Retry'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Shown when a route does not exist — the router's `errorBuilder`.
///
/// A 404 matters more on web than anywhere else: a user can type a URL, follow a
/// stale link, or land on a route removed in an update. Without this the app
/// shows go_router's own default error page, which names internal route
/// patterns.
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({
    required this.title,
    required this.message,
    required this.goHomeLabel,
    required this.onGoHome,
    this.attemptedLocation,
    super.key,
  });

  final String title;
  final String message;
  final String goHomeLabel;
  final VoidCallback onGoHome;

  /// The path that did not resolve. Shown so a user can see what they typed;
  /// harmless because it is their own input.
  final String? attemptedLocation;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(title, style: theme.textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(
                message,
                style: theme.textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
              if (attemptedLocation != null) ...<Widget>[
                const SizedBox(height: 8),
                Text(attemptedLocation!, style: theme.textTheme.bodySmall),
              ],
              const SizedBox(height: 24),
              FilledButton(onPressed: onGoHome, child: Text(goHomeLabel)),
            ],
          ),
        ),
      ),
    );
  }
}

/// A dismissible bar telling the user the app could not reach the network.
///
/// ⚠️ DRIVEN BY A FAILED REQUEST, not by a connectivity plugin. Knowing the
/// radio is on says nothing about whether the API is reachable — captive
/// portals, DNS failures, an outage and airplane mode all look different to
/// `connectivity_plus` and identical to the user. The app already knows when a
/// request failed, and that is the honest signal.
class OfflineNotice extends StatelessWidget {
  const OfflineNotice({
    required this.message,
    this.onRetry,
    this.retryLabel,
    super.key,
  });

  final String message;
  final VoidCallback? onRetry;
  final String? retryLabel;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.errorContainer,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: <Widget>[
              Icon(
                Icons.cloud_off,
                size: 18,
                color: theme.colorScheme.onErrorContainer,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  message,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onErrorContainer,
                  ),
                ),
              ),
              if (onRetry != null)
                TextButton(
                  onPressed: onRetry,
                  child: Text(retryLabel ?? 'Retry'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
