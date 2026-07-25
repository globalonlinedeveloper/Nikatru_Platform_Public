import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';

/// Settings — carries the chassis-mandated support contact (E1) and the
/// in-app account-deletion entry (G2).
{{#needs_backend}}/// The Worker-side delete route lives in this app's own service
/// (`services/{{app_id.snakeCase()}}-api`), which purges its APP_DB tables and
/// delegates the shared rows to `platform`.
{{/needs_backend}}{{^needs_backend}}/// This app is client-only, so deletion terminates in the SHARED `platform`
/// Worker keyed by `app_id` — there is no per-app service to wire ([ADR 020]).
{{/needs_backend}}
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ListView(
        children: <Widget>[
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
            subtitle: const Text('Permanently delete your account and data'),
            onTap: () => _confirmDelete(context),
          ),
          const AboutListTile(
            applicationName: AppConfig.appName,
            applicationLegalese: '© Nikatru',
            child: Text('About'),
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

  void _confirmDelete(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Delete account?'),
        content: const Text(
          'This permanently deletes your account and all its data. '
          'This cannot be undone.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}
