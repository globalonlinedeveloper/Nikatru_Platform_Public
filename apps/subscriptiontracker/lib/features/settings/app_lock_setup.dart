import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_app_lock/nikatru_app_lock.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart' show appLockControllerProvider;

/// XP-03 · Settings › Privacy's "App lock" row. On turns the lock on through
/// the PIN dialog; off forgets the PIN. Built HERE rather than in
/// settings_screen.dart, which is a chassis fork held at its line ceiling
/// (tooling/chassis-parity.json); [row] is that screen's own `_prefRow`, so
/// the row keeps the card's shape and its in-orbit toggle.
class AppLockSettingsRow extends ConsumerWidget {
  const AppLockSettingsRow({super.key, required this.row});

  final Widget Function(BuildContext, String, String, bool, VoidCallback) row;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLockController lock = ref.watch(appLockControllerProvider);
    final AppLocalizations l10n = AppLocalizations.of(context);
    return ListenableBuilder(
      listenable: lock,
      builder: (BuildContext context, Widget? _) => row(
        context,
        l10n.appLockSetting,
        lock.enabled ? l10n.appLockSettingOn : l10n.appLockSettingOff,
        lock.enabled,
        () => lock.enabled ? lock.disable() : showAppLockSetup(context, lock),
      ),
    );
  }
}

/// XP-03 · turns the app lock on: a PIN and the delay before a return locks.
/// Free under ADR 101 — no gate.
Future<void> showAppLockSetup(BuildContext context, AppLockController lock) =>
    showDialog<void>(
      context: context,
      builder: (_) => AppLockSetupDialog(lock: lock),
    );

class AppLockSetupDialog extends StatefulWidget {
  const AppLockSetupDialog({super.key, required this.lock});

  final AppLockController lock;

  static const Key pinFieldKey = ValueKey<String>('app-lock-setup-pin');
  static const Key confirmKey = ValueKey<String>('app-lock-setup-confirm');

  @override
  State<AppLockSetupDialog> createState() => _AppLockSetupDialogState();
}

class _AppLockSetupDialogState extends State<AppLockSetupDialog> {
  final TextEditingController _pin = TextEditingController();
  Duration _delay = AppLockController.delays[1];

  @override
  void initState() {
    super.initState();
    _pin.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  String _delayLabel(AppLocalizations l10n, Duration d) => d == Duration.zero
      ? l10n.appLockDelayImmediately
      : l10n.appLockDelayMinutes(d.inMinutes);

  Future<void> _confirm() async {
    await widget.lock.enable(pin: _pin.text, delay: _delay);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AlertDialog(
      title: Text(l10n.appLockChoosePin),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AuthField(
            fieldKey: AppLockSetupDialog.pinFieldKey,
            label: l10n.appLockPinLabel,
            hint: l10n.appLockPinHint,
            controller: _pin,
            keyboardType: TextInputType.number,
            obscure: true,
            // WCAG 2.2 SC 3.3.8: offer to save the new PIN.
            autofillHints: const <String>[AutofillHints.newPassword],
          ),
          const SizedBox(height: AppSpacing.lg),
          DropdownButtonFormField<Duration>(
            initialValue: _delay,
            decoration: InputDecoration(labelText: l10n.appLockDelayLabel),
            items: <DropdownMenuItem<Duration>>[
              for (final Duration d in AppLockController.delays)
                DropdownMenuItem<Duration>(
                  value: d,
                  child: Text(_delayLabel(l10n, d)),
                ),
            ],
            onChanged: (Duration? d) {
              if (d != null) setState(() => _delay = d);
            },
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.appLockCancel),
        ),
        FilledButton(
          key: AppLockSetupDialog.confirmKey,
          onPressed: AppLockController.isValidPin(_pin.text) ? _confirm : null,
          child: Text(l10n.appLockTurnOn),
        ),
      ],
    );
  }
}
