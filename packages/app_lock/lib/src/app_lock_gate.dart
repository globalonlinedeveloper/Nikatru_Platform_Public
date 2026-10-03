import 'dart:async';

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
    required this.lockedOut,
    required this.unsyncedWarning,
    required this.signOutAnyway,
    required this.keepChanges,
  });

  final String title;
  final String pinLabel;
  final String unlock;
  final String useBiometric;
  final String biometricReason;
  final String forgotPin;

  /// Given the attempts left, the sentence under a wrong PIN.
  final String Function(int attemptsLeft) wrongPin;

  /// The attempts are spent and the sign-out waits (`PinOutcome.lockedOut`).
  final String lockedOut;

  /// Given how many writes a sync could not send, what signing out now loses.
  final String Function(int unsyncedChanges) unsyncedWarning;

  /// The two answers to [unsyncedWarning].
  final String signOutAnyway;
  final String keepChanges;
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

  /// The cover shown until the controller has read the store.
  static const Key pendingKey = ValueKey<String>('app-lock-pending');

  @override
  State<AppLockGate> createState() => _AppLockGateState();
}

/// ⏱ 2026-10-02 · review of #1155, finding 4. The lock screen's OWN Overlay.
///
/// The app mounts the gate in `MaterialApp.router`'s `builder`, which is ABOVE
/// the Navigator and so above its Overlay — and a text field needs an Overlay
/// ancestor for its selection handles, its toolbar (paste, the password
/// manager) and its magnifier. Without one, every tap on the PIN field raised
/// "No Overlay widget found". The entry is rebuilt whenever the gate is.
class _LockOverlay extends StatefulWidget {
  const _LockOverlay({required this.controller, required this.strings});

  final AppLockController controller;
  final AppLockStrings strings;

  @override
  State<_LockOverlay> createState() => _LockOverlayState();
}

class _LockOverlayState extends State<_LockOverlay> {
  late final OverlayEntry _entry = OverlayEntry(
    builder: (BuildContext context) =>
        AppLockScreen(controller: widget.controller, strings: widget.strings),
  );

  @override
  void didUpdateWidget(_LockOverlay old) {
    super.didUpdateWidget(old);
    _entry.markNeedsBuild();
  }

  @override
  void dispose() {
    _entry
      ..remove()
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      Overlay(initialEntries: <OverlayEntry>[_entry]);
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
        final bool ready = widget.controller.ready;
        final bool locked = widget.controller.locked;
        return Stack(
          children: <Widget>[
            ExcludeSemantics(excluding: locked || !ready, child: child!),
            // ⏱ 2026-10-02 · review of #1155, finding 5. A cold start paints
            // before the secure store answers (Keychain, Keystore, DPAPI and
            // IndexedDB all take frames), and the content used to paint and
            // take input in those frames. Until the store has answered, an
            // opaque cover with nothing on it: the lock may be on.
            if (!ready)
              Positioned.fill(
                child: ColoredBox(
                  key: AppLockGate.pendingKey,
                  color: Theme.of(context).colorScheme.surface,
                  child: const AbsorbPointer(child: SizedBox.expand()),
                ),
              )
            else if (locked)
              Positioned.fill(
                child: _LockOverlay(
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
  static const Key unsyncedWarningKey = ValueKey<String>('app-lock-unsynced');
  static const Key keepChangesKey = ValueKey<String>('app-lock-keep');
  static const Key signOutAnywayKey = ValueKey<String>('app-lock-sign-out');

  @override
  State<AppLockScreen> createState() => _AppLockScreenState();
}

class _AppLockScreenState extends State<AppLockScreen> {
  final TextEditingController _pin = TextEditingController();
  String? _error;
  bool _busy = false;

  /// While the sign-out waits on an answer: how many writes it would lose,
  /// and where the answer goes.
  int? _unsent;
  Completer<bool>? _answer;

  @override
  void dispose() {
    final Completer<bool>? answer = _answer;
    if (answer != null && !answer.isCompleted) answer.complete(false);
    _pin.dispose();
    super.dispose();
  }

  /// Asked by the controller when a sign-out would lose unsynced writes. The
  /// question is drawn in place of the buttons — the lock sits above every
  /// Navigator, so there is no route a dialog could take.
  Future<bool> _confirmDiscard(int unsent) {
    if (!mounted) return Future<bool>.value(false);
    final Completer<bool> answer = Completer<bool>();
    setState(() {
      _unsent = unsent;
      _answer = answer;
    });
    return answer.future;
  }

  void _answerDiscard(bool signOut) {
    final Completer<bool>? answer = _answer;
    setState(() {
      _unsent = null;
      _answer = null;
    });
    if (answer != null && !answer.isCompleted) answer.complete(signOut);
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() => _busy = true);
    final PinOutcome outcome = await widget.controller.submitPin(
      _pin.text,
      confirmDiscard: _confirmDiscard,
    );
    if (!mounted) return;
    _pin.clear();
    setState(() {
      _busy = false;
      _error = switch (outcome) {
        PinOutcome.wrong => widget.strings.wrongPin(
          widget.controller.attemptsLeft,
        ),
        PinOutcome.lockedOut => widget.strings.lockedOut,
        PinOutcome.unlocked || PinOutcome.signedOut => null,
      };
    });
  }

  Future<void> _forgot() async {
    if (_busy) return;
    setState(() => _busy = true);
    await widget.controller.forgotPin(confirmDiscard: _confirmDiscard);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final AppLockStrings s = widget.strings;
    final bool lockedOut = widget.controller.lockedOut;
    final int? unsent = _unsent;
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
                  if (lockedOut)
                    Text(s.lockedOut, textAlign: TextAlign.center)
                  else
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
                  if (_error != null && !lockedOut) ...<Widget>[
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.lg),
                  if (unsent != null) ...<Widget>[
                    Text(
                      s.unsyncedWarning(unsent),
                      key: AppLockScreen.unsyncedWarningKey,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    FilledButton(
                      key: AppLockScreen.keepChangesKey,
                      onPressed: () => _answerDiscard(false),
                      child: Text(s.keepChanges),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    TextButton(
                      key: AppLockScreen.signOutAnywayKey,
                      onPressed: () => _answerDiscard(true),
                      child: Text(s.signOutAnyway),
                    ),
                  ] else ...<Widget>[
                    if (!lockedOut)
                      FilledButton(
                        key: AppLockScreen.unlockKey,
                        onPressed: _busy ? null : _submit,
                        child: Text(s.unlock),
                      ),
                    if (widget.controller.biometric != null &&
                        !lockedOut) ...<Widget>[
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
                      onPressed: _busy ? null : _forgot,
                      child: Text(s.forgotPin),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
