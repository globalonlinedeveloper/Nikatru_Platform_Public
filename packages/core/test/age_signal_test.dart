// [ADR 082] §5 "Same gate everywhere" — the age gate every sign-up door uses.
//
// Each host is tested on its own, with each signal, so a change to one target's
// selection cannot hide behind another's: a store signal below adult refuses on
// the hosts that read one, no signal proceeds on the declaration everywhere, and
// a host with no store API never reads an injected adapter.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

final class _Fixed implements AgeSignalSource {
  const _Fixed(this.signal);
  final AgeSignal signal;
  @override
  Future<AgeSignal> read() async => signal;
}

final class _Throws implements AgeSignalSource {
  const _Throws();
  @override
  Future<AgeSignal> read() async => throw StateError('store read failed');
}

const AgeSignalSource _adult = _Fixed(AdultAgeSignal());
const AgeSignalSource _minor = _Fixed(BelowAdultAgeSignal());
const AgeSignalSource _declined =
    _Fixed(NoAgeSignal(NoAgeSignalReason.declined));

Future<SignUpAgeGate> _gate(AgeSignalHost host) async =>
    signUpAgeGate(await readAgeSignal(
        ageSignalSourceFor(host, android: _minor, ios: _minor)));

void main() {
  group('signUpAgeGate — the three outcomes', () {
    test('adult proceeds on the store signal', () {
      expect(signUpAgeGate(const AdultAgeSignal()),
          SignUpAgeGate.proceedOnStoreSignal);
    });
    test('below adult refuses', () {
      expect(signUpAgeGate(const BelowAdultAgeSignal()), SignUpAgeGate.refuse);
    });
    test(
        'no signal proceeds on the declaration — for a stated reason, never as "adult"',
        () {
      expect(signUpAgeGate(const NoAgeSignal(NoAgeSignalReason.declined)),
          SignUpAgeGate.proceedOnDeclaration);
      expect(signUpAgeGate(const NoAgeSignal(NoAgeSignalReason.error)),
          isNot(SignUpAgeGate.proceedOnStoreSignal));
    });
  });

  group('readAgeSignal never throws', () {
    test(
        'a source that throws is NoAgeSignal(error), which proceeds on the declaration',
        () async {
      final AgeSignal s = await readAgeSignal(const _Throws());
      expect(s, const NoAgeSignal(NoAgeSignalReason.error));
      expect(signUpAgeGate(s), SignUpAgeGate.proceedOnDeclaration);
    });
    test('the default source states its reason', () async {
      expect(
        await readAgeSignal(
            const NoAgeSignalSource(NoAgeSignalReason.notEligible)),
        const NoAgeSignal(NoAgeSignalReason.notEligible),
      );
    });
  });

  group('android — reads the injected Play Age Signals adapter', () {
    test('below adult refuses', () async {
      expect(await signUpAgeGateFor(AgeSignalHost.android, _minor),
          SignUpAgeGate.refuse);
    });
    test('adult proceeds on the store signal', () async {
      expect(await signUpAgeGateFor(AgeSignalHost.android, _adult),
          SignUpAgeGate.proceedOnStoreSignal);
    });
    test('declined proceeds on the declaration', () async {
      expect(await signUpAgeGateFor(AgeSignalHost.android, _declined),
          SignUpAgeGate.proceedOnDeclaration);
    });
    test('an adapter that throws proceeds on the declaration', () async {
      expect(await signUpAgeGateFor(AgeSignalHost.android, const _Throws()),
          SignUpAgeGate.proceedOnDeclaration);
    });
    test('no adapter built in reads unavailable, not "no API on target"',
        () async {
      expect(await ageSignalSourceFor(AgeSignalHost.android).read(),
          const NoAgeSignal(NoAgeSignalReason.unavailable));
    });
  });

  group('ios — reads the injected Declared Age Range adapter', () {
    test('below adult refuses', () async {
      expect(await signUpAgeGateFor(AgeSignalHost.ios, _minor),
          SignUpAgeGate.refuse);
    });
    test('adult proceeds on the store signal', () async {
      expect(await signUpAgeGateFor(AgeSignalHost.ios, _adult),
          SignUpAgeGate.proceedOnStoreSignal);
    });
    test('declined proceeds on the declaration', () async {
      expect(await signUpAgeGateFor(AgeSignalHost.ios, _declined),
          SignUpAgeGate.proceedOnDeclaration);
    });
    test('an adapter that throws proceeds on the declaration', () async {
      expect(await signUpAgeGateFor(AgeSignalHost.ios, const _Throws()),
          SignUpAgeGate.proceedOnDeclaration);
    });
    test('no adapter built in reads unavailable, not "no API on target"',
        () async {
      expect(await ageSignalSourceFor(AgeSignalHost.ios).read(),
          const NoAgeSignal(NoAgeSignalReason.unavailable));
    });
  });

  // The hosts with no store API ignore an injected adapter entirely: even a
  // below-adult adapter supplied by mistake cannot refuse there, and a
  // sign-up proceeds on the declaration for the stated reason.
  group('no store API — proceeds on the declaration', () {
    test('web', () async {
      expect(
          await _gate(AgeSignalHost.web), SignUpAgeGate.proceedOnDeclaration);
      expect(await ageSignalSourceFor(AgeSignalHost.web).read(),
          const NoAgeSignal(NoAgeSignalReason.noApiOnTarget));
    });
    test('macos', () async {
      expect(
          await _gate(AgeSignalHost.macos), SignUpAgeGate.proceedOnDeclaration);
      expect(await ageSignalSourceFor(AgeSignalHost.macos).read(),
          const NoAgeSignal(NoAgeSignalReason.noApiOnTarget));
    });
    test('windows', () async {
      expect(await _gate(AgeSignalHost.windows),
          SignUpAgeGate.proceedOnDeclaration);
      expect(await ageSignalSourceFor(AgeSignalHost.windows).read(),
          const NoAgeSignal(NoAgeSignalReason.noApiOnTarget));
    });
    test('linux', () async {
      expect(
          await _gate(AgeSignalHost.linux), SignUpAgeGate.proceedOnDeclaration);
      expect(await ageSignalSourceFor(AgeSignalHost.linux).read(),
          const NoAgeSignal(NoAgeSignalReason.noApiOnTarget));
    });
    test('other', () async {
      expect(
          await _gate(AgeSignalHost.other), SignUpAgeGate.proceedOnDeclaration);
      expect(await ageSignalSourceFor(AgeSignalHost.other).read(),
          const NoAgeSignal(NoAgeSignalReason.noApiOnTarget));
    });
  });

  group('ageSignalHostNamed — every platform name', () {
    test('web wins over the platform name', () {
      expect(
          ageSignalHostNamed(isWeb: true, platform: 'iOS'), AgeSignalHost.web);
    });
    test('android, iOS, macOS, windows, linux map to their hosts', () {
      expect(ageSignalHostNamed(isWeb: false, platform: 'android'),
          AgeSignalHost.android);
      expect(
          ageSignalHostNamed(isWeb: false, platform: 'iOS'), AgeSignalHost.ios);
      expect(ageSignalHostNamed(isWeb: false, platform: 'macOS'),
          AgeSignalHost.macos);
      expect(ageSignalHostNamed(isWeb: false, platform: 'windows'),
          AgeSignalHost.windows);
      expect(ageSignalHostNamed(isWeb: false, platform: 'linux'),
          AgeSignalHost.linux);
    });
    test(
        'an unknown name (fuchsia, or a future platform) is other, which reads no signal',
        () {
      expect(ageSignalHostNamed(isWeb: false, platform: 'fuchsia'),
          AgeSignalHost.other);
      expect(ageSignalHostNamed(isWeb: false, platform: 'ios'),
          AgeSignalHost.other);
    });
  });

  group('Play Age Signals — what each answer means', () {
    test('SHARED with ageLower 18 and no upper bound is adult', () {
      expect(ageSignalFromPlay(accessStatus: 'SHARED', ageLower: 18),
          const AdultAgeSignal());
    });
    test('SHARED with a closed range under 18 (13–15) is below adult', () {
      expect(
          ageSignalFromPlay(accessStatus: 'SHARED', ageLower: 13, ageUpper: 15),
          const BelowAdultAgeSignal());
    });
    test('SHARED with ageUpper 17 (16–17) is below adult', () {
      expect(
          ageSignalFromPlay(accessStatus: 'SHARED', ageLower: 16, ageUpper: 17),
          const BelowAdultAgeSignal());
    });
    test('SHARED with both bounds null is unavailable', () {
      expect(ageSignalFromPlay(accessStatus: 'SHARED'),
          const NoAgeSignal(NoAgeSignalReason.unavailable));
    });
    test(
        'SHARED with an open band starting under 18 cannot decide, so unavailable',
        () {
      expect(ageSignalFromPlay(accessStatus: 'SHARED', ageLower: 15),
          const NoAgeSignal(NoAgeSignalReason.unavailable));
    });
    test('NOT_SHARED is declined', () {
      expect(ageSignalFromPlay(accessStatus: 'NOT_SHARED'),
          const NoAgeSignal(NoAgeSignalReason.declined));
    });
    test(
        '🔴 VERIFICATION_REQUIRED is NO SIGNAL and proceeds on the 18+ declaration: a deliberate ADR 082 §5 reading, and making it refuse is an owner decision',
        () {
      final AgeSignal s =
          ageSignalFromPlay(accessStatus: 'VERIFICATION_REQUIRED');
      expect(s, const NoAgeSignal(NoAgeSignalReason.unavailable));
      expect(signUpAgeGate(s), SignUpAgeGate.proceedOnDeclaration);
    });
    test('an unknown status is unavailable, never adult', () {
      expect(ageSignalFromPlay(accessStatus: 'SOMETHING_NEW', ageLower: 18),
          const NoAgeSignal(NoAgeSignalReason.unavailable));
    });
  });

  group('Apple Declared Age Range — what each answer means', () {
    test('no API on this OS is unavailable', () {
      expect(ageSignalFromApple(eligible: null),
          const NoAgeSignal(NoAgeSignalReason.unavailable));
    });
    test('not eligible is notEligible, whatever else came back', () {
      expect(
          ageSignalFromApple(
              eligible: false, response: 'sharing', lowerBound: 18),
          const NoAgeSignal(NoAgeSignalReason.notEligible));
    });
    test('declinedSharing is declined', () {
      expect(ageSignalFromApple(eligible: true, response: 'declinedSharing'),
          const NoAgeSignal(NoAgeSignalReason.declined));
    });
    test('sharing with lowerBound 18 is adult', () {
      expect(
          ageSignalFromApple(
              eligible: true, response: 'sharing', lowerBound: 18),
          const AdultAgeSignal());
    });
    test(
        'sharing below the single gate (no lowerBound, upperBound 17) is below adult',
        () {
      expect(
          ageSignalFromApple(
              eligible: true, response: 'sharing', upperBound: 17),
          const BelowAdultAgeSignal());
    });
    test('sharing with neither bound is unavailable', () {
      expect(ageSignalFromApple(eligible: true, response: 'sharing'),
          const NoAgeSignal(NoAgeSignalReason.unavailable));
    });
  });
}

Future<SignUpAgeGate> signUpAgeGateFor(
        AgeSignalHost host, AgeSignalSource adapter) async =>
    signUpAgeGate(await readAgeSignal(
        ageSignalSourceFor(host, android: adapter, ios: adapter)));
