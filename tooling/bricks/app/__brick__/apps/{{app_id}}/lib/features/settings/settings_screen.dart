import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// Settings — carries the chassis-mandated support contact (E1) and the
/// in-app account-deletion entry (G2).
/// This app is client-only, so deletion terminates in the SHARED `platform`
/// Worker keyed by `app_id` — there is no per-app service to wire ([ADR 020]).

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeMode mode = ref.watch(themeModeProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ListView(
        children: <Widget>[
          // [pipeline C-16] The on-switch for the persisted themeMode. A stored
          // preference with no control is a dead setting — the same shape as the
          // consent recorder that had no prompt and silently discarded every
          // event. Shipped together, or not at all.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Text(
              l10n.appearance,
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: SegmentedButton<ThemeMode>(
              segments: <ButtonSegment<ThemeMode>>[
                ButtonSegment<ThemeMode>(
                  value: ThemeMode.system,
                  label: Text(l10n.themeSystem),
                ),
                ButtonSegment<ThemeMode>(
                  value: ThemeMode.light,
                  label: Text(l10n.themeLight),
                ),
                ButtonSegment<ThemeMode>(
                  value: ThemeMode.dark,
                  label: Text(l10n.themeDark),
                ),
              ],
              selected: <ThemeMode>{mode},
              onSelectionChanged: (Set<ThemeMode> s) =>
                  ref.read(themeModeProvider.notifier).set(s.first),
            ),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.mail_outline),
            title: Text(l10n.contactSupport),
            subtitle: const Text(AppConfig.supportEmail),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: _contactSupport,
          ),
          // [pipeline C-13] Only when there is an account to delete. Both
          // stores require an in-app deletion path where accounts EXIST; an
          // entry shown to a signed-out user is an offer the app cannot honour.
          if (ref.watch(authRepositoryProvider).currentUser != null)
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: Text(l10n.deleteAccount),
              subtitle: Text(l10n.deleteAccountSubtitle),
              onTap: () => _confirmDelete(context, ref, l10n),
            ),
          AboutListTile(
            applicationName: AppConfig.appName,
            applicationLegalese: l10n.legalese,
            child: Text(l10n.about),
          ),
        ],
      ),
    );
  }

  Future<void> _contactSupport() async {
    final Uri uri = Uri.parse(
      'mailto:${AppConfig.supportEmail}'
      '?subject=${Uri.encodeComponent('${AppConfig.appName} support')}',
    );
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // No mail client / launch failed — best-effort; never crash settings.
    }
  }

  /// 🔴 [pipeline C-13] THIS BUTTON USED TO DO NOTHING. Its confirm action was
  /// `Navigator.pop(dialogContext)` and no more — no API call, no reauth. Both
  /// stores require a working in-app deletion path where accounts exist, so that
  /// was a store-compliance defect rather than a missing nicety. It was also
  /// unbuildable until [pipeline C-15] gave the chassis an AuthRepository with a
  /// real `deleteAccount()`.
  ///
  /// REAUTH FIRST, deliberately. Deletion is irreversible, so a borrowed or
  /// unattended device must not be enough to destroy an account — the password
  /// is proof that the person at the keyboard is the account holder. The reauth
  /// runs through the same seam as sign-in, so it works against whatever
  /// identity provider is wired.
  void _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
  ) {
    final TextEditingController password = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => _DeleteAccountDialog(
        l10n: l10n,
        password: password,
        onConfirm: () =>
            _deleteAccount(dialogContext, ref, l10n, password.text),
      ),
    );
  }

  Future<void> _deleteAccount(
    BuildContext dialogContext,
    WidgetRef ref,
    AppLocalizations l10n,
    String password,
  ) async {
    final NavigatorState nav = Navigator.of(dialogContext);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(
      dialogContext,
    );
    final core.AuthRepository auth = ref.read(authRepositoryProvider);
    final String? email = auth.currentUser?.email;
    try {
      if (email == null) throw core.AuthFailure('Not signed in');
      // Re-authenticate through the SAME seam sign-in uses.
      await auth.signInWithEmail(email: email, password: password);
      await auth.deleteAccount();
      nav.pop();
    } catch (_) {
      // Deliberately NOT "deleted" on failure. AuthRepository.deleteAccount
      // signs out regardless and then throws, so the user may be signed out
      // WITHOUT being deleted — saying otherwise would be the one lie they can
      // never detect and never recover from.
      nav.pop();
      messenger.showSnackBar(SnackBar(content: Text(l10n.deleteAccountFailed)));
    }
  }
}

/// Split out so the confirm action can be driven directly in a test — a dialog
/// only reachable through a tap on a tile is one nobody writes a test for, which
/// is how the dead button survived in the first place.
class _DeleteAccountDialog extends StatelessWidget {
  const _DeleteAccountDialog({
    required this.l10n,
    required this.password,
    required this.onConfirm,
  });

  final AppLocalizations l10n;
  final TextEditingController password;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(l10n.deleteAccountConfirmTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(l10n.deleteAccountConfirmBody),
          const SizedBox(height: 16),
          Text(l10n.deleteAccountReauthHint),
          const SizedBox(height: 8),
          TextField(
            controller: password,
            obscureText: true,
            decoration: InputDecoration(labelText: l10n.deleteAccountPassword),
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(onPressed: onConfirm, child: Text(l10n.delete)),
      ],
    );
  }
}
