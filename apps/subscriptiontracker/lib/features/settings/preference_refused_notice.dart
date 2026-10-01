import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// ⏱ 2026-09-30 · ST-N6 (D11): the ONE line a user sees when the account did
/// not take a preference change this device sent — wherever they are in the
/// signed-in app. Two cases, each said once:
///
///  - REFUSED (review #1080 finding 6): the change is dropped rather than
///    retried forever, and the account's value comes back.
///  - CONFLICT (delta finding 3): another device had already saved a newer
///    value; the server kept it and this screen just flipped to it. Naming the
///    setting makes the flip visible instead of silent.
///
/// 🔴 NOTHING RAISED IS LOST (review 3 of #1080). A notice raised before this
/// is mounted — the sign-in send runs before the shell exists — waits in
/// [preferenceNoticesProvider] and is shown when this attaches; two notices for
/// the same setting are two lines, queued by the messenger.
///
/// Mounted around the signed-in shell; it draws nothing of its own.
class PreferenceRefusedNotice extends ConsumerStatefulWidget {
  const PreferenceRefusedNotice({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<PreferenceRefusedNotice> createState() =>
      _PreferenceRefusedNoticeState();

  /// The line [notice] is shown as.
  static String messageOf(AppLocalizations l10n, PreferenceNotice notice) =>
      switch (notice.kind) {
        PreferenceNoticeKind.refused => l10n.preferenceNotSaved,
        PreferenceNoticeKind.conflict => changedElsewhereOf(l10n, notice.key),
      };

  /// A whole sentence per settings section, never a name spliced into one
  /// template: "Notifications WERE changed", and Tamil agrees its verb with
  /// the plural too (review 3 of #1080, nit).
  static String changedElsewhereOf(AppLocalizations l10n, String key) =>
      switch (key) {
        kPrefCurrencyCode => l10n.preferenceCurrencyChangedElsewhere,
        kPrefThemeMode => l10n.preferenceAppearanceChangedElsewhere,
        kPrefLocale => l10n.preferenceLanguageChangedElsewhere,
        kPrefReminderLeadDays ||
        kPrefReminderMinuteOfDay => l10n.preferenceRemindersChangedElsewhere,
        _ => l10n.preferenceNotificationsChangedElsewhere,
      };
}

class _PreferenceRefusedNoticeState
    extends ConsumerState<PreferenceRefusedNotice> {
  @override
  void initState() {
    super.initState();
    // Raised before this screen existed: shown now that one does. After the
    // frame, because a provider may not change while the tree is building.
    WidgetsBinding.instance.addPostFrameCallback((_) => _showWaiting());
  }

  void _showWaiting() {
    if (!mounted) return;
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    if (messenger == null) return; // stays queued for a screen that can show it
    final AppLocalizations l10n = AppLocalizations.of(context);
    for (final PreferenceNotice notice
        in ref.read(preferenceNoticesProvider.notifier).takeAll()) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(PreferenceRefusedNotice.messageOf(l10n, notice)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<List<PreferenceNotice>>(preferenceNoticesProvider, (
      _,
      List<PreferenceNotice> waiting,
    ) {
      if (waiting.isNotEmpty) _showWaiting();
    });
    return widget.child;
  }
}
