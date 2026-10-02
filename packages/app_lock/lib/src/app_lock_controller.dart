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

  /// The attempts are spent, but this device holds changes that did not sync
  /// and nobody agreed to lose them ([DiscardConfirm]). The lock STAYS: no
  /// further PIN is checked, and the only way on is the sign-out
  /// ([AppLockController.forgotPin]), which asks again.
  lockedOut,
}

/// Asked before the lock's sign-out throws away [unsyncedChanges] writes that
/// a sync just failed to send. True to sign out anyway; false keeps them, and
/// the device, locked.
typedef DiscardConfirm = Future<bool> Function(int unsyncedChanges);

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
    Future<int> Function()? unsyncedChanges,
    this.biometric,
    DateTime Function()? clock,
    this.maxAttempts = defaultMaxAttempts,
    Random? random,
  }) : _store = store,
       _signOut = signOut,
       _unsyncedChanges = unsyncedChanges,
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

  /// ⏱ 2026-10-02 · review of #1155, finding 2. The wrong-PIN count and the
  /// moment the attempts ran out, beside the PIN record and in the same
  /// store. A sibling key rather than a field of [storeKey], so a count
  /// written on every attempt never rewrites (and can never corrupt) the hash.
  ///
  /// 🔴 IT OUTLIVES THE PROCESS. It was a field: swiping the app away and
  /// reopening it gave four more tries, every time, and a 4-digit space is a
  /// few thousand relaunches — scriptable. Now a relaunch reads the count
  /// back, so five wrong PINs sign out across any number of relaunches.
  static const String attemptsKey = 'nikatru.app_lock.attempts.v1';

  final SecureStore _store;
  final Future<void> Function() _signOut;

  /// ⏱ 2026-10-02 · review of #1155, finding 6. Tries a sync, then answers how
  /// many of this user's writes are STILL unsent. Null (a test, a build with
  /// no offline queue) is "none".
  final Future<int> Function()? _unsyncedChanges;
  final DateTime Function() _now;
  final Random _random;

  /// Null on a target with no biometric; the PIN still works everywhere.
  final BiometricUnlocker? biometric;
  final int maxAttempts;

  _LockRecord? _record;
  bool _ready = false;
  bool _locked = false;
  DateTime? _backgroundedAt;
  int _wrong = 0;
  DateTime? _lockedOutAt;

  bool get enabled => _record != null;
  bool get locked => _locked;
  Duration get delay => _record?.delay ?? Duration.zero;
  int get attemptsLeft => maxAttempts - _wrong;

  /// ⏱ 2026-10-02 · review of #1155, finding 5. False until [load] has had
  /// the store's answer (or [enable] / [disable] has set the lock by hand).
  /// [AppLockGate] covers the app while it is false: whether the lock is on
  /// is not known yet, and "not known" must not paint the content.
  bool get ready => _ready;

  /// The attempts ran out and the sign-out was not (yet) agreed to — see
  /// [PinOutcome.lockedOut]. Survives a relaunch ([attemptsKey]).
  bool get lockedOut => _lockedOutAt != null;

  /// Reads the stored record. A cold start with the lock on starts LOCKED:
  /// a process the OS killed in the background must not reopen unlocked.
  ///
  /// A store that cannot be READ (no keychain session, a plugin missing on
  /// this target) loads as "no lock" and says so in the log rather than
  /// throwing into the app's first frame: a lock that crashes launch locks
  /// the person out of everything, PIN or not.
  ///
  /// The wrong-PIN count is read back too ([attemptsKey]): a relaunch is not
  /// a fresh set of attempts. Until the store has answered, [ready] is false.
  Future<void> load() async {
    String? raw;
    String? attempts;
    try {
      raw = await _store.read(storeKey);
      attempts = raw == null ? null : await _store.read(attemptsKey);
    } on Object catch (e) {
      debugPrint('app_lock: the store could not be read, lock off ($e)');
    }
    _record = _LockRecord.tryParse(raw);
    final _Attempts a = _Attempts.tryParse(attempts);
    _wrong = enabled ? a.wrong.clamp(0, maxAttempts) : 0;
    _lockedOutAt = enabled ? a.lockedOutAt : null;
    _locked = enabled;
    _ready = true;
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
    await _store.delete(attemptsKey);
    _record = record;
    _wrong = 0;
    _lockedOutAt = null;
    _ready = true;
    notifyListeners();
  }

  /// Turns the lock off and forgets the hash and the attempt count.
  Future<void> disable() async {
    await _store.delete(storeKey);
    await _store.delete(attemptsKey);
    _record = null;
    _locked = false;
    _wrong = 0;
    _lockedOutAt = null;
    _ready = true;
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
  ///
  /// 🔴 THE ATTEMPT IS COUNTED, AND WRITTEN, BEFORE THE PIN IS COMPARED, so a
  /// process killed between the two still spent it. Only a correct PIN or a
  /// biometric pass gives the attempts back.
  ///
  /// [confirmDiscard] is asked when the attempts run out and a sync could not
  /// send everything; without it, nothing unsynced is ever thrown away.
  Future<PinOutcome> submitPin(
    String pin, {
    DiscardConfirm? confirmDiscard,
  }) async {
    final _LockRecord? record = _record;
    if (record == null) return PinOutcome.unlocked;
    // Out of attempts: no PIN is checked any more, whatever it is.
    if (lockedOut) return PinOutcome.lockedOut;
    _wrong++;
    await _saveAttempts();
    if (_hash(record.salt, pin) == record.hash) {
      await _unlock();
      return PinOutcome.unlocked;
    }
    if (_wrong < maxAttempts) {
      notifyListeners();
      return PinOutcome.wrong;
    }
    _lockedOutAt = _now().toUtc();
    await _saveAttempts();
    notifyListeners();
    return await forgotPin(confirmDiscard: confirmDiscard)
        ? PinOutcome.signedOut
        : PinOutcome.lockedOut;
  }

  /// The recovery path, and where the attempt cap lands: clear the lock,
  /// then sign out. The lock is cleared FIRST so a sign-out that fails still
  /// cannot leave a lock nobody knows the PIN of.
  ///
  /// ⏱ 2026-10-02 · review of #1155, finding 6. The sign-out discards this
  /// user's queued offline writes, and anyone holding the phone can reach
  /// it. So a sync is tried first ([unsyncedChanges]); when writes are still
  /// unsent, [confirmDiscard] is told how many and decides. No answer, or
  /// false, keeps them: the lock stays and nothing is signed out. Returns
  /// whether the sign-out happened.
  Future<bool> forgotPin({DiscardConfirm? confirmDiscard}) async {
    int unsent = 0;
    final Future<int> Function()? count = _unsyncedChanges;
    if (count != null) {
      try {
        unsent = await count();
      } on Object catch (e) {
        // Not knowing is not "none": it is asked about like a count of one.
        debugPrint('app_lock: unsynced changes could not be counted ($e)');
        unsent = 1;
      }
    }
    if (unsent > 0) {
      final bool agreed = await confirmDiscard?.call(unsent) ?? false;
      if (!agreed) return false;
    }
    await disable();
    await _signOut();
    return true;
  }

  /// Ask the device sheet. Unlocks only on a pass.
  Future<bool> unlockWithBiometric(String reason) async {
    final BiometricUnlocker? b = biometric;
    if (b == null || !_locked) return false;
    if (!await b.isAvailable()) return false;
    if (!await b.authenticate(reason)) return false;
    await _unlock();
    return true;
  }

  Future<void> _unlock() async {
    _locked = false;
    _wrong = 0;
    _lockedOutAt = null;
    await _saveAttempts();
    notifyListeners();
  }

  /// Writes the count. A write that fails is logged and the attempt still
  /// counts in memory: the lock must not open because the store hiccuped.
  Future<void> _saveAttempts() async {
    try {
      if (_wrong == 0 && _lockedOutAt == null) {
        await _store.delete(attemptsKey);
      } else {
        await _store.write(
          attemptsKey,
          _Attempts(wrong: _wrong, lockedOutAt: _lockedOutAt).encode(),
        );
      }
    } on Object catch (e) {
      debugPrint('app_lock: the attempt count could not be saved ($e)');
    }
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

/// The persisted wrong-PIN count ([AppLockController.attemptsKey]).
@immutable
class _Attempts {
  const _Attempts({required this.wrong, this.lockedOutAt});

  final int wrong;
  final DateTime? lockedOutAt;

  String encode() => jsonEncode(<String, Object?>{
    'wrong': wrong,
    'lockedOutAt': lockedOutAt?.toIso8601String(),
  });

  /// A count that does not parse is NO count — but only when there is none
  /// at all. A present, unreadable record reads as the attempts spent:
  /// editing the store must not be a way to get the tries back.
  static _Attempts tryParse(String? raw) {
    if (raw == null) return const _Attempts(wrong: 0);
    try {
      final Object? j = jsonDecode(raw);
      if (j is Map<String, Object?>) {
        final Object? wrong = j['wrong'];
        final Object? at = j['lockedOutAt'];
        if (wrong is int && wrong >= 0 && (at == null || at is String)) {
          return _Attempts(
            wrong: wrong,
            lockedOutAt: at is String ? DateTime.tryParse(at) : null,
          );
        }
      }
    } on FormatException {
      // Falls through to "spent".
    }
    return _Attempts(
      wrong: AppLockController.defaultMaxAttempts,
      lockedOutAt: DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }
}
