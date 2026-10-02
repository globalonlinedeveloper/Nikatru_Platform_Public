// THE PRIVATE CALENDAR FEED, ONE IMPLEMENTATION FOR TWO SCREENS — T12 (CA-06).
//
// The feed (ST-R2, the ST-T4a client) lived only in Settings, two screens away
// from the calendar where a user looks for it. The calls moved HERE so the
// calendar's Subscribe / Download .ics / Copy link and Settings' "Add to
// calendar" / "Reset calendar link" are the SAME calls: one mint, one URL rule,
// one launcher. A second implementation is what this file exists to prevent.
//
// 🔴 ONE FEED PER SESSION, ROTATED ONLY ON PURPOSE. `POST /v1/calendar/feed`
// ROTATES: every mint kills the URL the last one answered. Three controls that
// each minted would hand out three links of which only the last worked — so
// [CalendarFeedController.ensure] mints once and reuses, and only "Reset
// calendar link" ([CalendarFeedController.rotate]) asks for a new one.
// (Train T4 makes the feed stable on the server; this memo then costs nothing.)
//
// ⚠️ THE URL IS A CREDENTIAL. It is held in memory only, cleared with the
// signed-in user, never logged, and Copy link says what it is.

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppCard, AppSpacing;

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// The feed minted this session, or null before the first mint.
class CalendarFeedController extends Notifier<core.CalendarFeed?> {
  @override
  core.CalendarFeed? build() {
    // A different (or no) account must never be handed the last one's link.
    ref.watch(authUserProvider);
    return null;
  }

  /// The session's feed — minted on first use, reused after.
  Future<core.Result<core.CalendarFeed>> ensure() async {
    final core.CalendarFeed? have = state;
    if (have != null) return core.Result<core.CalendarFeed>.ok(have);
    return rotate();
  }

  /// A NEW feed: the old URL stops working at once (Reset calendar link).
  Future<core.Result<core.CalendarFeed>> rotate() async {
    final String? token = await ref
        .read(authRepositoryProvider)
        .currentAccessToken();
    final core.Result<core.CalendarFeed> r = await ref
        .read(reminderChannelsTransportProvider)
        .mintCalendarFeed(appId: AppConfig.appId, accessToken: token);
    if (r is core.Ok<core.CalendarFeed> && ref.mounted) state = r.value;
    return r;
  }
}

final NotifierProvider<CalendarFeedController, core.CalendarFeed?>
calendarFeedProvider =
    NotifierProvider<CalendarFeedController, core.CalendarFeed?>(
      CalendarFeedController.new,
    );

/// What a feed control does with the feed.
enum CalendarFeedAction { subscribe, download, copy }

/// The URL [action] uses. Subscribe is `webcal:` where a calendar app takes
/// it (native) and the https subscribe URL in a browser, which a calendar web
/// app takes; Download is the https URL with the route's `?download=1`.
Uri calendarFeedUri(
  core.CalendarFeed feed,
  CalendarFeedAction action, {
  bool web = kIsWeb,
}) => switch (action) {
  CalendarFeedAction.subscribe => web ? feed.httpsUrl : feed.webcalUrl,
  CalendarFeedAction.download => feed.httpsUrl.replace(
    queryParameters: <String, String>{
      ...feed.httpsUrl.queryParameters,
      'download': '1',
    },
  ),
  CalendarFeedAction.copy => feed.httpsUrl,
};

/// Writes text to the clipboard — a provider so a test reads what was copied
/// without a platform channel.
final Provider<Future<void> Function(String text)> clipboardWriterProvider =
    Provider<Future<void> Function(String text)>(
      (ref) =>
          (String text) => Clipboard.setData(ClipboardData(text: text)),
    );

/// Whether this build and session can reach the feed at all: a live platform
/// and a signed-in account (the same rule as Settings' card).
bool calendarFeedAvailable(WidgetRef ref) =>
    ref.watch(reminderChannelsAvailableProvider) &&
    ref.watch(authUserProvider).value != null;

/// Runs [action] on the session's feed: mint-or-reuse, then open or copy.
/// A failure is SAID. Returns whether it went through.
Future<bool> runCalendarFeedAction(
  BuildContext context,
  WidgetRef ref,
  CalendarFeedAction action,
) async {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(context);
  final core.Result<core.CalendarFeed> r = await ref
      .read(calendarFeedProvider.notifier)
      .ensure();
  if (r is! core.Ok<core.CalendarFeed>) {
    messenger?.showSnackBar(
      SnackBar(content: Text(l10n.reminderChannelsFailed)),
    );
    return false;
  }
  final Uri uri = calendarFeedUri(r.value, action);
  if (action == CalendarFeedAction.copy) {
    await ref.read(clipboardWriterProvider)(uri.toString());
    messenger?.showSnackBar(SnackBar(content: Text(l10n.calendarFeedCopied)));
    return true;
  }
  await ref.read(calendarLinkLauncherProvider).open(uri);
  return true;
}

/// The calendar screen's three feed controls, on one card. Renders nothing
/// where the feed cannot be reached (a demo build, signed out).
class CalendarFeedBar extends ConsumerStatefulWidget {
  const CalendarFeedBar({super.key});

  static const Key subscribeKey = Key('calendar.feed.subscribe');
  static const Key downloadKey = Key('calendar.feed.download');
  static const Key copyKey = Key('calendar.feed.copy');

  @override
  ConsumerState<CalendarFeedBar> createState() => _CalendarFeedBarState();
}

class _CalendarFeedBarState extends ConsumerState<CalendarFeedBar> {
  bool _busy = false;

  Future<void> _go(CalendarFeedAction a) async {
    if (_busy) return;
    setState(() => _busy = true);
    await runCalendarFeedAction(context, ref, a);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    if (!calendarFeedAvailable(ref)) return const SizedBox.shrink();
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.lg),
      child: AppCard(
        key: const Key('calendar.feed'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Semantics(
              header: true,
              child: Text(
                l10n.calendarFeedTitle,
                style: theme.textTheme.labelLarge?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: <Widget>[
                FilledButton.tonalIcon(
                  key: CalendarFeedBar.subscribeKey,
                  onPressed: _busy
                      ? null
                      : () => _go(CalendarFeedAction.subscribe),
                  icon: const Icon(Icons.event_available_outlined),
                  label: Text(l10n.calendarFeedSubscribe),
                ),
                OutlinedButton.icon(
                  key: CalendarFeedBar.downloadKey,
                  onPressed: _busy
                      ? null
                      : () => _go(CalendarFeedAction.download),
                  icon: const Icon(Icons.download_outlined),
                  label: Text(l10n.calendarFeedDownload),
                ),
                OutlinedButton.icon(
                  key: CalendarFeedBar.copyKey,
                  onPressed: _busy ? null : () => _go(CalendarFeedAction.copy),
                  icon: const Icon(Icons.link),
                  label: Text(l10n.calendarFeedCopy),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
