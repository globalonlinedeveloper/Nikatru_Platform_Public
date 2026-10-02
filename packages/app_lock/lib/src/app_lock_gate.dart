import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'app_lock_controller.dart';

/// Every word the lock screen shows, from the app's l10n. The package owns
/// no copy ([pipeline] no hardcoded strings), so a stamped app translates it.
@immutable
class AppLockStrings {
  const AppLockStrings({
    required this.title,
    required this.pinLabel,
    required this.unlock,
    required this.useBiometric,
    required this.biometricReason,
    required this.forgotPin,
    required this.wrongPin,
  });

  final String title;
  final String pinLabel;
  final String unlock;
  final String useBiometric;
  final String biometricReason;
  final String forgotPin;

  /// Given the attempts left, the sentence under a wrong PIN.
  final String Function(int attemptsLeft) wrongPin;
}

/// Puts the lock screen over [child] while [controller] is locked, and feeds
/// the controller the app lifecycle.
///
/// 🔴 OVER, NOT INSTEAD OF. The child stays mounted under an opaque screen, so
/// a router's state, a half-typed form and the shell's tab survive a lock; the
/// [ExcludeSemantics] and [Offstage]-free stack keep a screen reader from
/// walking the content the lock is hiding.
class AppLockGate extends StatefulWidget {
  const AppLockGate({
    super.key,
    required this.controller,
    required this.strings,
    required this.child,
  });

  final AppLockController controller;
  final AppLockStrings strings;
  final Widget child;

  @override
  State<AppLockGate> createState() => _AppLockGateState();
}

class _AppLockGateState extends State<AppLockGate> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        widget.controller.backgrounded();
      case AppLifecycleState.resumed:
        widget.controller.resumed();
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (BuildContext context, Widget? child) {
        final bool locked = widget.controller.locked;
        return Stack(
          children: <Widget>[
            ExcludeSemantics(excluding: locked, child: child!),
            if (locked)
              Positioned.fill(
                child: AppLockScreen(
                  controller: widget.controller,
                  strings: widget.strings,
                ),
              ),
          ],
        );
      },
      child: widget.child,
    );
  }
}

/// The lock screen: a PIN field, the biometric door where there is one, and
/// the sign-out recovery.
class AppLockScreen extends StatefulWidget {
  const AppLockScreen({
    super.key,
    required this.controller,
    required this.strings,
  });

  final AppLockController controller;
  final AppLockStrings strings;

  /// Stable keys for tests and the e2e driver.
  static const Key pinFieldKey = ValueKey<String>('app-lock-pin');
  static const Key unlockKey = ValueKey<String>('app-lock-unlock');
  static const Key biometricKey = ValueKey<String>('app-lock-biometric');
  static const Key forgotKey = ValueKey<String>('app-lock-forgot');

  @override
  State<AppLockScreen> createState() => _AppLockScreenState();
}

class _AppLockScreenState extends State<AppLockScreen> {
  final TextEditingController _pin = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _busy = true);
    final PinOutcome outcome = await widget.controller.submitPin(_pin.text);
    if (!mounted) return;
    _pin.clear();
    setState(() {
      _busy = false;
      _error = outcome == PinOutcome.wrong
          ? widget.strings.wrongPin(widget.controller.attemptsLeft)
          : null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLockStrings s = widget.strings;
    return Material(
      color: Theme.of(context).colorScheme.surface,
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.xl),
            // A PIN form, so the form cap: on a 1920 px desktop the field and
            // buttons stay a form's width instead of spanning the display.
            child: ContentPane.form(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Text(
                    s.title,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: AppSpacing.xl),
                  AuthField(
                    fieldKey: AppLockScreen.pinFieldKey,
                    label: s.pinLabel,
                    controller: _pin,
                    keyboardType: TextInputType.number,
                    obscure: true,
                    // WCAG 2.2 SC 3.3.8: a password manager may hold the PIN,
                    // so the person need not recall it.
                    autofillHints: const <String>[AutofillHints.password],
                    textInputAction: TextInputAction.done,
                    onSubmitted: _submit,
                  ),
                  if (_error != null) ...<Widget>[
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.lg),
                  FilledButton(
                    key: AppLockScreen.unlockKey,
                    onPressed: _busy ? null : _submit,
                    child: Text(s.unlock),
                  ),
                  if (widget.controller.biometric != null) ...<Widget>[
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton(
                      key: AppLockScreen.biometricKey,
                      onPressed: () => widget.controller.unlockWithBiometric(
                        s.biometricReason,
                      ),
                      child: Text(s.useBiometric),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.sm),
                  TextButton(
                    key: AppLockScreen.forgotKey,
                    onPressed: widget.controller.forgotPin,
                    child: Text(s.forgotPin),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
