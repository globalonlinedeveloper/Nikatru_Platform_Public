// ─────────────────────────────────────────────────────────────────────────────
// THE ACCOUNT ROWS SETTINGS DRAWS — change e-mail and password (SE-02), "Your
// devices" (SE-03) and "Log out of all devices" (SE-05).
//
// ⏱ 2026-10-01 · train ST-SETTINGS. They live HERE and not in
// `features/settings/settings_screen.dart` because that file is a private copy
// of a chassis screen held at its ceiling by `assert-chassis-parity`: a fork may
// not grow. Each piece is this app's wiring — its providers, its l10n, its
// `SoftButton` — around chassis parts (`DevicesSection`) and `core` seams, and
// moves into the chassis `SettingsView` slots when this app adopts it (SE-01).
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../shared/chassis_adapters.dart' show DevicesSection;
import '../shared/widgets.dart' show SoftButton;
import 'account_security.dart';

/// Draws one account row: the settings screen passes its own link row's
/// constructor, so these sit in the "Account & data" card looking like their
/// neighbours.
typedef AccountRowBuilder =
    Widget Function({
      Key? key,
      required String icon,
      required String label,
      required bool last,
      String? subtitle,
      VoidCallback? onTap,
    });

/// The change-e-mail and change-password rows (SE-02), for [account]. Both
/// re-authenticate before they change anything (account_security.dart).
/// Change password only where there IS a password: an Apple or Google
/// account has none to change.
abstract final class AccountSecurityRows {
  static const Key changeEmail = Key('settingsChangeEmail');
  static const Key changePassword = Key('settingsChangePassword');

  static List<Widget> of(
    BuildContext context,
    core.AuthUser? account,
    AccountRowBuilder row,
  ) {
    if (account == null) return const <Widget>[];
    final AppLocalizations l10n = AppLocalizations.of(context);
    return <Widget>[
      row(
        key: changeEmail,
        icon: '@',
        label: l10n.changeEmailTitle,
        subtitle: account.email,
        last: false,
        onTap: () => showAccountChange(context, AccountChange.email),
      ),
      if (account.hasPasswordIdentity)
        row(
          key: changePassword,
          icon: '•',
          label: l10n.changePasswordTitle,
          last: false,
          onTap: () => showAccountChange(context, AccountChange.password),
        ),
    ];
  }
}

/// "Your devices" (SE-03): the chassis [DevicesSection] on this app's
/// sessions client — every signed-in session, with "Sign out this device" on
/// each OTHER one. Drawn for an account, where the platform Worker is.
class YourDevicesSection extends ConsumerWidget {
  const YourDevicesSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(authRepositoryProvider).currentUser == null ||
        !ref.watch(sessionsAvailableProvider)) {
      return const SizedBox.shrink();
    }
    Future<String?> token() =>
        ref.read(authRepositoryProvider).currentAccessToken();
    return DevicesSection(
      load: () async =>
          ref.read(sessionsTransportProvider).list(accessToken: await token()),
      revoke: (String id) async => ref
          .read(sessionsTransportProvider)
          .revoke(id: id, accessToken: await token()),
    );
  }
}

/// "Log out of all devices".
///
/// 🔴 ONE TAP MUST NOT LOG THE ACCOUNT OUT EVERYWHERE, the device in the
/// user's hand included — so it asks first (AUTH-LOGOUT-ALL, parent ruling
/// L2, 2026-09-24). [onConfirmed] — the settings screen's global sign-out —
/// runs exactly once on "Log out everywhere" and never on Cancel, a barrier
/// tap or a back gesture (all three answer `false` or `null`).
/// `test/sign_out_forgets_user_test.dart` taps both buttons.
///
/// SE-05: while it runs the row SAYS so ("Logging out everywhere…") and
/// refuses taps — it is a network round trip plus this device's forget, and a
/// row that draws nothing for that long invites a second tap. The label
/// covers the revoke, not the time spent reading the dialog. On success the
/// router usually replaces the page, so the reset is skipped once unmounted.
class LogOutEverywhereButton extends StatefulWidget {
  const LogOutEverywhereButton({required this.onConfirmed, super.key});

  /// The button itself, so a test can watch it say it is working.
  static const Key button = Key('settingsLogOutAll');

  final Future<void> Function() onConfirmed;

  @override
  State<LogOutEverywhereButton> createState() => _LogOutEverywhereState();
}

class _LogOutEverywhereState extends State<LogOutEverywhereButton> {
  bool _busy = false;

  Future<void> _run() async {
    if (_busy) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool confirmed =
        await showDialog<bool>(
          context: context,
          builder: (BuildContext c) => AlertDialog(
            title: Text(l10n.logOutAllDevicesConfirmTitle),
            content: Text(l10n.logOutAllDevicesConfirmBody),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.pop(c, false),
                child: Text(l10n.cancel),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(c, true),
                child: Text(l10n.logOutAllDevicesConfirmAction),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.onConfirmed();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return SoftButton(
      key: LogOutEverywhereButton.button,
      label: _busy ? l10n.logOutAllDevicesBusy : l10n.logOutAllDevices,
      color: AppColors.danger,
      onPressed: _busy ? null : _run,
    );
  }
}
