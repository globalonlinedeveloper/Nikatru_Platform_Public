import 'package:flutter/material.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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
    // WATCHED as a stream, not read off `currentUser`: the tile below shows a
    // value the user can edit from this very screen, and a snapshot read would
    // go on showing the old name after a successful save. [pipeline C-13]
    final core.AuthUser? user = ref.watch(authUserProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.settingsTitle)),
      body: ListView(
        children: <Widget>[
          // ── PROFILE ──────────────────────────────────────────────────────
          // Only when there is an account. Offering "edit your name" to a
          // signed-out user is an offer the app cannot honour — the same reason
          // the deletion entry is gated further down.
          if (user != null) ...<Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text(
                l10n.profile,
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            ListTile(
              leading: CircleAvatar(child: Text(user.initial)),
              title: Text(
                (user.displayName == null || user.displayName!.isEmpty)
                    ? l10n.displayNameNotSet
                    : user.displayName!,
              ),
              subtitle: Text(user.email),
              trailing: const Icon(Icons.edit_outlined),
              onTap: () => _editProfile(context, ref, l10n, user),
            ),
            const Divider(),
          ],
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

          // ── LANGUAGE ─────────────────────────────────────────────────────
          // Language names are shown in their OWN language, so a speaker can
          // find theirs without first being able to read the current one.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Text(
              l10n.language,
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          RadioGroup<String>(
            groupValue: ref.watch(localeProvider)?.languageCode ?? '',
            onChanged: (String? code) => ref
                .read(localeProvider.notifier)
                .set((code == null || code.isEmpty) ? null : Locale(code)),
            child: Column(
              children: <Widget>[
                RadioListTile<String>(
                  value: '',
                  title: Text(l10n.languageSystem),
                ),
                RadioListTile<String>(
                  value: 'en',
                  title: Text(l10n.languageEnglish),
                ),
                RadioListTile<String>(
                  value: 'ta',
                  title: Text(l10n.languageTamil),
                ),
              ],
            ),
          ),
          const Divider(),

          // ── NOTIFICATIONS ────────────────────────────────────────────────
          // [pipeline C-7 earning its keep in real UI] The platform matrix is
          // consulted BEFORE a control is offered. On Linux the plugin shows but
          // cannot schedule; on Windows (pinned 17.x) it does neither. A toggle
          // that silently does nothing on those platforms is worse than an
          // honest sentence, because the user believes reminders are on.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Text(
              l10n.notifications,
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          Builder(
            builder: (BuildContext context) {
              final NotificationCapabilities caps =
                  NotificationCapabilities.forPlatform(
                    defaultTargetPlatform,
                    isWeb: kIsWeb,
                  );
              if (!caps.canSchedule) {
                return ListTile(
                  leading: const Icon(Icons.notifications_off_outlined),
                  title: Text(l10n.remindersUnavailable),
                  enabled: false,
                );
              }
              return SwitchListTile(
                secondary: const Icon(Icons.notifications_outlined),
                title: Text(l10n.remindersEnabled),
                value: ref.watch(remindersEnabledProvider),
                onChanged: (bool on) =>
                    _setReminders(context, ref, l10n, on: on),
              );
            },
          ),
          const Divider(),

          // ── SUBSCRIPTION ([pipeline 5]M-6 · M-9) ──────────────────────────
          //
          // 🔴 THE TWO ENTRY POINTS SIT SIDE BY SIDE ON PURPOSE. ROSCA's rule
          // is that cancelling must be no harder than subscribing, and the
          // cheapest way to be sure of that is to reach both from the same
          // place, one tap each. A cancel path buried a level deeper than the
          // upgrade path is the specific pattern the rule exists to stop.
          //
          // Gated on a session because both terminate in a call keyed to an
          // account: offering "manage your subscription" to a signed-out user
          // is an offer the app cannot honour, the same reason the profile and
          // deletion entries are gated.
          if (ref.watch(authRepositoryProvider).currentUser !=
              null) ...<Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
              child: Text(
                l10n.plan,
                style: Theme.of(context).textTheme.labelLarge,
              ),
            ),
            ListTile(
              leading: const Icon(Icons.workspace_premium_outlined),
              title: Text(l10n.paywallUpgrade),
              onTap: () => context.go('/paywall'),
            ),
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text(l10n.managePlanTitle),
              onTap: () => context.go('/manage-plan'),
            ),
            const Divider(),
          ],

          // ── LEGAL. Both stores require these to be reachable IN-APP, not
          //    only from a store listing. [pipeline C-13]
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Text(
              l10n.legal,
              style: Theme.of(context).textTheme.labelLarge,
            ),
          ),
          ListTile(
            leading: const Icon(Icons.privacy_tip_outlined),
            title: Text(l10n.privacyPolicy),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () => _openUrl(AppConfig.privacyUrl),
          ),
          ListTile(
            leading: const Icon(Icons.description_outlined),
            title: Text(l10n.termsOfService),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () => _openUrl(AppConfig.termsUrl),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.mail_outline),
            title: Text(l10n.contactSupport),
            subtitle: const Text(AppConfig.supportEmail),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: _contactSupport,
          ),
          // Sign out sits ABOVE delete: it is the action a user wants
          // hundreds of times more often, and putting the irreversible one
          // first invites a misfire.
          if (ref.watch(authRepositoryProvider).currentUser != null)
            ListTile(
              leading: const Icon(Icons.logout),
              title: Text(l10n.signOut),
              onTap: () => ref.read(authRepositoryProvider).signOut(),
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

  /// PERMISSION PRIMING — explain, THEN ask the OS.
  ///
  /// 🔴 The OS prompt can be shown ONCE on most platforms. A user who declines
  /// it has effectively declined permanently, and the only route back is the
  /// system settings app. So the cost of asking at a bad moment is not a
  /// dismissed dialog — it is the feature, forever. Priming first means the one
  /// prompt is spent on someone who has already said yes in principle.
  ///
  /// 🔴 AND THEN IT MUST ACTUALLY SCHEDULE. This used to end at
  /// `requestPermission()` — the prompt was spent, the switch read ON, and no
  /// notification was ever scheduled in any app this factory stamps. The
  /// scheduling lives in [RemindersEnabledController.applyReminderChoice] so it
  /// is reachable from a property test without a widget, and so the intent and
  /// the OS state can never be written apart.
  Future<void> _setReminders(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n, {
    required bool on,
  }) async {
    if (!on) {
      await ref
          .read(remindersEnabledProvider.notifier)
          .applyReminderChoice(
            on: false,
            title: l10n.reminderTitle,
            body: l10n.reminderBody,
          );
      return;
    }
    final bool proceed =
        await showDialog<bool>(
          context: context,
          builder: (BuildContext c) => AlertDialog(
            title: Text(l10n.permissionPrimingTitle),
            content: Text(l10n.permissionPrimingBody),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.pop(c, false),
                child: Text(l10n.notNow),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(c, true),
                child: Text(l10n.continueLabel),
              ),
            ],
          ),
        ) ??
        false;
    // Declining the PRIMING must not spend the OS prompt — that is the whole
    // point of asking twice.
    if (!proceed) return;
    await ref
        .read(remindersEnabledProvider.notifier)
        .applyReminderChoice(
          on: true,
          title: l10n.reminderTitle,
          body: l10n.reminderBody,
        );
  }

  Future<void> _openUrl(String url) async {
    try {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (_) {
      // Best-effort — never crash settings.
    }
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

  /// [pipeline C-13] EDIT DISPLAY NAME.
  ///
  /// This screen was refused on the grounds that "there is no profile data
  /// model". There is: every identity provider worth using stores user
  /// metadata, and Supabase's gotrue exposes `updateUser` for exactly this. The
  /// original reason described a field nothing wrote and concluded from that
  /// that it could never be written.
  ///
  /// Split into its own dialog widget for the same reason the delete dialog is —
  /// a confirm action only reachable through a tap on a tile is one nobody
  /// writes a test for, which is how a dead button survives.
  void _editProfile(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
    core.AuthUser user,
  ) {
    final TextEditingController name = TextEditingController(
      text: user.displayName ?? '',
    );
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => _EditProfileDialog(
        l10n: l10n,
        name: name,
        onSave: () => _saveProfile(dialogContext, ref, l10n, name.text),
      ),
    );
  }

  Future<void> _saveProfile(
    BuildContext dialogContext,
    WidgetRef ref,
    AppLocalizations l10n,
    String displayName,
  ) async {
    final NavigatorState nav = Navigator.of(dialogContext);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(
      dialogContext,
    );
    try {
      await ref
          .read(authRepositoryProvider)
          .updateProfile(displayName: displayName.trim());
      nav.pop();
    } catch (_) {
      // Says plainly that nothing changed. "Saved" on a failed write is the
      // kind of lie the user only discovers on their next launch.
      nav.pop();
      messenger.showSnackBar(SnackBar(content: Text(l10n.profileUpdateFailed)));
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

/// [pipeline C-13] The display-name editor. No confirmation step and no reauth,
/// deliberately: renaming yourself is reversible in one tap, and guarding a
/// harmless action trains people to click through the guards on the dangerous
/// one two tiles below.
class _EditProfileDialog extends StatelessWidget {
  const _EditProfileDialog({
    required this.l10n,
    required this.name,
    required this.onSave,
  });

  final AppLocalizations l10n;
  final TextEditingController name;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(l10n.editProfile),
      content: TextField(
        controller: name,
        autofocus: true,
        textCapitalization: TextCapitalization.words,
        decoration: InputDecoration(labelText: l10n.displayName),
        onSubmitted: (_) => onSave(),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.cancel),
        ),
        FilledButton(onPressed: onSave, child: Text(l10n.save)),
      ],
    );
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
