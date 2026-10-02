import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:nikatru_core/nikatru_core.dart' show SecureStore, sha256Hex;

/// The device check a lock screen may offer beside the PIN.
///
/// An interface so the controller never imports the plugin: a test hands in a
/// fake, and a target with no biometric hands in nothing.
abstract interface class BiometricUnlocker {
  /// Whether this device has an enrolled biometric (or Windows Hello) now.
  Future<bool> isAvailable();

  /// Ask the OS sheet; true only when the person passed it. A cancel, a
  /// lock-out or a missing sensor is false, never a throw.
  Future<bool> authenticate(String reason);
}

/// What one PIN attempt did.
enum PinOutcome {
  /// The PIN matched; the lock is off until the next resume after the delay.
  unlocked,

  /// The PIN did not match and attempts remain.
  wrong,

  /// The last attempt failed: the lock is cleared and the person is signed
  /// out. Signing back in is the recovery, by design — there is no PIN reset
  /// that skips the account.
  signedOut,
}

/// The app-lock policy: whether it is on, when a resume locks, and what a
/// wrong PIN costs.
///
/// 🔴 THE PIN IS NEVER STORED. A random salt and `sha256(salt + pin)` go to the
/// [SecureStore] (Keychain, Keystore, DPAPI, libsecret; the web store is the
/// weakest and the capability matrix says so). A device backup that carries
/// the store carries a hash of a 4–8 digit space, which is why the attempt cap
/// and the sign-out exist: the lock guards a glance, not a forensic copy.
class AppLockController extends ChangeNotifier {
  AppLockController({
    required SecureStore store,
    required Future<void> Function() signOut,
    this.biometric,
    DateTime Function()? clock,
    this.maxAttempts = defaultMaxAttempts,
    Random? random,
  }) : _store = store,
       _signOut = signOut,
       _now = clock ?? DateTime.now,
       _random = random ?? Random.secure();

  /// The brief's number: five wrong PINs sign the person out.
  static const int defaultMaxAttempts = 5;

  /// The delays a settings row offers. `Duration.zero` locks on every resume.
  static const List<Duration> delays = <Duration>[
    Duration.zero,
    Duration(minutes: 1),
    Duration(minutes: 5),
    Duration(minutes: 15),
  ];

  /// The store key. Versioned so a format change is a new key, not a parse.
  static const String storeKey = 'nikatru.app_lock.v1';

  final SecureStore _store;
  final Future<void> Function() _signOut;
  final DateTime Function() _now;
  final Random _random;

  /// Null on a target with no biometric; the PIN still works everywhere.
  final BiometricUnlocker? biometric;
  final int maxAttempts;

  _LockRecord? _record;
  bool _locked = false;
  DateTime? _backgroundedAt;
  int _wrong = 0;

  bool get enabled => _record != null;
  bool get locked => _locked;
  Duration get delay => _record?.delay ?? Duration.zero;
  int get attemptsLeft => maxAttempts - _wrong;

  /// Reads the stored record. A cold start with the lock on starts LOCKED:
  /// a process the OS killed in the background must not reopen unlocked.
  ///
  /// A store that cannot be READ (no keychain session, a plugin missing on
  /// this target) loads as "no lock" and says so in the log rather than
  /// throwing into the app's first frame: a lock that crashes launch locks
  /// the person out of everything, PIN or not.
  Future<void> load() async {
    String? raw;
    try {
      raw = await _store.read(storeKey);
    } on Object catch (e) {
      debugPrint('app_lock: the store could not be read, lock off ($e)');
    }
    _record = _LockRecord.tryParse(raw);
    _locked = enabled;
    _wrong = 0;
    notifyListeners();
  }

  /// A PIN is 4 to 8 digits. Anything else is refused before it is hashed.
  static bool isValidPin(String pin) => RegExp(r'^\d{4,8}$').hasMatch(pin);

  /// Turns the lock on (or changes the PIN or delay). Does not lock now: the
  /// person who just chose a PIN is the person holding the device.
  Future<void> enable({required String pin, required Duration delay}) async {
    if (!isValidPin(pin)) {
      throw ArgumentError.value('<redacted>', 'pin', 'must be 4–8 digits');
    }
    final String salt = base64Encode(
      List<int>.generate(16, (_) => _random.nextInt(256)),
    );
    final _LockRecord record = _LockRecord(
      salt: salt,
      hash: _hash(salt, pin),
      delay: delay,
    );
    await _store.write(storeKey, record.encode());
    _record = record;
    _wrong = 0;
    notifyListeners();
  }

  /// Turns the lock off and forgets the hash.
  Future<void> disable() async {
    await _store.delete(storeKey);
    _record = null;
    _locked = false;
    _wrong = 0;
    notifyListeners();
  }

  /// The app went to the background (paused or hidden).
  void backgrounded() {
    if (!enabled || _locked) return;
    _backgroundedAt ??= _now();
  }

  /// The app came back. Locks when the lock is on and the delay has passed.
  void resumed() {
    final DateTime? since = _backgroundedAt;
    _backgroundedAt = null;
    if (!enabled || _locked || since == null) return;
    if (_now().difference(since) >= delay) {
      _locked = true;
      notifyListeners();
    }
  }

  /// One PIN attempt. See [PinOutcome].
  Future<PinOutcome> submitPin(String pin) async {
    final _LockRecord? record = _record;
    if (record == null) return PinOutcome.unlocked;
    if (_hash(record.salt, pin) == record.hash) {
      _unlock();
      return PinOutcome.unlocked;
    }
    _wrong++;
    if (_wrong < maxAttempts) {
      notifyListeners();
      return PinOutcome.wrong;
    }
    await forgotPin();
    return PinOutcome.signedOut;
  }

  /// The recovery path, and where the attempt cap lands: clear the lock,
  /// then sign out. The lock is cleared FIRST so a sign-out that fails still
  /// cannot leave a lock nobody knows the PIN of.
  Future<void> forgotPin() async {
    await disable();
    await _signOut();
  }

  /// Ask the device sheet. Unlocks only on a pass.
  Future<bool> unlockWithBiometric(String reason) async {
    final BiometricUnlocker? b = biometric;
    if (b == null || !_locked) return false;
    if (!await b.isAvailable()) return false;
    if (!await b.authenticate(reason)) return false;
    _unlock();
    return true;
  }

  void _unlock() {
    _locked = false;
    _wrong = 0;
    notifyListeners();
  }

  static String _hash(String salt, String pin) => sha256Hex('$salt:$pin');
}

@immutable
class _LockRecord {
  const _LockRecord({
    required this.salt,
    required this.hash,
    required this.delay,
  });

  final String salt;
  final String hash;
  final Duration delay;

  String encode() => jsonEncode(<String, Object>{
    'salt': salt,
    'hash': hash,
    'delaySeconds': delay.inSeconds,
  });

  /// A record that does not parse is NO record: a corrupt store must not
  /// leave a lock with no PIN that can open it.
  static _LockRecord? tryParse(String? raw) {
    if (raw == null) return null;
    try {
      final Object? j = jsonDecode(raw);
      if (j is! Map<String, Object?>) return null;
      final Object? salt = j['salt'];
      final Object? hash = j['hash'];
      final Object? delay = j['delaySeconds'];
      if (salt is! String || hash is! String || delay is! int) return null;
      return _LockRecord(
        salt: salt,
        hash: hash,
        delay: Duration(seconds: delay),
      );
    } on FormatException {
      return null;
    }
  }
}
