import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// Settings — carries the chassis-mandated support contact (E1) and the
/// in-app account-deletion entry (G2).
{{#needs_backend}}/// The Worker-side delete route lives in this app's own service
/// (`services/{{app_id.snakeCase()}}-api`), which purges its APP_DB tables and
/// delegates the shared rows to `platform`.
{{/needs_backend}}{{^needs_backend}}/// This app is client-only, so deletion terminates in the SHARED `platform`
/// Worker keyed by `app_id` — there is no per-app service to wire ([ADR 020]).
{{/needs_backend}}
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
          ListTile(
            leading: const Icon(Icons.delete_outline),
            title: Text(l10n.deleteAccount),
            subtitle: Text(l10n.deleteAccountSubtitle),
            onTap: () => _confirmDelete(context, l10n),
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

  void _confirmDelete(BuildContext context, AppLocalizations l10n) {
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(l10n.deleteAccountConfirmTitle),
        content: Text(l10n.deleteAccountConfirmBody),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(l10n.delete),
          ),
        ],
      ),
    );
  }
}
