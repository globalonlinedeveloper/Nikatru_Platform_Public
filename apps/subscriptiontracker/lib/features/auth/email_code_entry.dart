import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/auth/email_code_form.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../state/providers.dart';

/// ⏱ 2026-10-01 · EN-21 — the sign-in screen's "E-mail me a code", bound to
/// THIS app: the shared `EmailCodeForm` and the persisted per-address cooldown.
///
/// 🔴 A CALL-THROUGH IN A FILE OF ITS OWN, for the reason
/// `auth_error_sentence.dart` gives: `tooling/ci/chassis-delegation.mjs` reads
/// a routed screen importing one `package:nikatru_chassis_screens/…` path as a
/// screen emptied into it, so `login_screen.dart` must not import the form.
/// The SEND stays in `login_screen.dart`, beside the `TurnstileGate` whose
/// token it spends (`assert-captcha-gated-call-sites` R1/R2).
Widget emailCodeEntry({
  required String email,
  required Duration cooldown,
  required Future<void> Function(String code) onVerify,
  required Future<Duration> Function() onResend,
  required VoidCallback onCancel,
}) => EmailCodeForm(
  email: email,
  cooldown: cooldown,
  onVerify: onVerify,
  onResend: onResend,
  onCancel: onCancel,
);

/// How long [email] must still wait before another code — read from the
/// key-value store, so the cooldown holds across a reload.
Future<Duration> emailCodeWait(WidgetRef ref, String email) async {
  final core.KeyValueStore kv = await ref.read(keyValueStoreProvider.future);
  return core.EmailCodeCooldown.decode(
    await kv.read(core.EmailCodeCooldown.storageKey),
  ).remaining(email, DateTime.now().toUtc());
}

/// Records a send to [email]; resolves to the full cooldown it starts.
Future<Duration> recordEmailCodeSent(WidgetRef ref, String email) async {
  final core.KeyValueStore kv = await ref.read(keyValueStoreProvider.future);
  final DateTime now = DateTime.now().toUtc();
  final core.EmailCodeCooldown ledger = core.EmailCodeCooldown.decode(
    await kv.read(core.EmailCodeCooldown.storageKey),
  )..record(email, now);
  await kv.write(core.EmailCodeCooldown.storageKey, ledger.encode(now));
  return core.emailCodeCooldown;
}
