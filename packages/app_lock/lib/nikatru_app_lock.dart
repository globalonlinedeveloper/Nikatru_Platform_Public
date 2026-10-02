/// App lock — XP-03, Free under ADR 101.
///
/// [AppLockController] is the whole policy (PIN, delay, attempts) and is pure
/// enough to test with a fake clock; [AppLockGate] puts its lock screen over an
/// app; [LocalAuthBiometricUnlocker] is the only file that imports the plugin.
/// An app builds ONE controller at its composition root and wraps its router
/// output in ONE gate.
library;

export 'src/app_lock_capabilities.dart';
export 'src/app_lock_controller.dart';
export 'src/app_lock_gate.dart';
export 'src/local_auth_biometric_unlocker.dart';
