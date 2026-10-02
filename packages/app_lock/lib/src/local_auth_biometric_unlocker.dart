import 'package:flutter/foundation.dart' show debugPrint;
import 'package:local_auth/local_auth.dart';

import 'app_lock_controller.dart';

/// [BiometricUnlocker] over `local_auth` 3.x — the ONLY file that imports it.
///
/// Every refusal is `false`: no sensor, nothing enrolled, a cancel, a
/// lock-out. The lock screen keeps the PIN in all of them, so a throw here
/// would only turn "use your PIN" into a crash.
class LocalAuthBiometricUnlocker implements BiometricUnlocker {
  LocalAuthBiometricUnlocker([LocalAuthentication? auth])
    : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;

  @override
  Future<bool> isAvailable() async {
    try {
      if (!await _auth.isDeviceSupported()) return false;
      return (await _auth.getAvailableBiometrics()).isNotEmpty;
    } on Object catch (e) {
      debugPrint('app_lock: biometric availability unknown ($e)');
      return false;
    }
  }

  @override
  Future<bool> authenticate(String reason) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        biometricOnly: true,
        persistAcrossBackgrounding: true,
      );
    } on LocalAuthException catch (e) {
      debugPrint('app_lock: biometric refused (${e.code})');
      return false;
    }
  }
}
