import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// ⏱ 2026-09-30 · ST-N6 (D11): the ONE line a user sees when the account did
/// not take a preference change this device sent — wherever they are in the
/// signed-in app, at the moment it happens. Two cases, each said once:
///
///  - REFUSED (review #1080 finding 6): a 400 or 413. The change is dropped
///    rather than retried forever, and the account's value comes back.
///  - CONFLICT (delta finding 3): another device had already saved a newer
///    value; the server kept it and this screen just flipped to it. Naming the
///    setting makes the flip visible instead of silent.
///
/// Mounted around the signed-in shell; it draws nothing of its own.
class PreferenceRefusedNotice extends ConsumerWidget {
  const PreferenceRefusedNotice({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<String?>(preferenceRefusedProvider, (_, String? key) {
      if (key == null) return;
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context).preferenceNotSaved),
        ),
      );
      // Consumed: the same key refused again later is a new notice.
      ref.read(preferenceRefusedProvider.notifier).state = null;
    });
    ref.listen<String?>(preferenceConflictProvider, (_, String? key) {
      if (key == null) return;
      final AppLocalizations l10n = AppLocalizations.of(context);
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(
          content: Text(
            l10n.preferenceChangedElsewhere(settingNameOf(l10n, key)),
          ),
        ),
      );
      ref.read(preferenceConflictProvider.notifier).state = null;
    });
    return child;
  }

  /// The settings screen's own name for the section [key] lives in.
  static String settingNameOf(AppLocalizations l10n, String key) =>
      switch (key) {
        kPrefCurrencyCode => l10n.currency,
        kPrefThemeMode => l10n.appearance,
        kPrefLocale => l10n.language,
        kPrefReminderLeadDays ||
        kPrefReminderMinuteOfDay => l10n.remindersEnabled,
        _ => l10n.notifications,
      };
}
