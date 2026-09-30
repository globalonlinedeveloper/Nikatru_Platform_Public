import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// ⏱ 2026-09-30 · ST-N6 (D11), review #1080 finding 6: the ONE line a user
/// sees when the account refused a preference change this device sent (a 400
/// or 413). The change is dropped rather than retried forever, and the
/// account's value comes back on the next read — so the user is told once, at
/// the moment it happens, wherever they are in the signed-in app.
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
    return child;
  }
}
