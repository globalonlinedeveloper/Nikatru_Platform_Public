// ⏱ 2026-10-01 · O-APPS-GOV-IN-VAPT-CHECKLIST — root detection and the runtime
// signature check, decided in core and driven here through the fake probe.
//
// The two checks have OPPOSITE failure policies, and each case below pins one
// side of that: a root signal never blocks and a failed root probe is never
// "rooted"; a signer mismatch blocks ONLY on a complete pin set in a non-debug
// build, and anything the signer check cannot decide is recorded, never
// blocked.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

const String _ours =
    '43:C8:4D:11:62:C4:D1:9C:0F:A0:C5:E0:01:90:5B:89:52:3D:C0:82:A6:80:83:C9:93:06:9B:86:3C:28:A6:16';
const String _oursHex =
    '43C84D1162C4D19C0FA0C5E001905B89523DC082A68083C993069B863C28A616';
// Play's app signing certificate: what a Play-delivered install carries.
const String _play =
    '98:FA:5F:DC:A1:49:1B:EC:84:19:8D:3D:AB:E7:97:B0:43:29:85:74:15:81:BB:FE:A2:55:5B:17:6C:83:3A:3C';
const String _playHex =
    '98FA5FDCA1491BEC84198D3DABE797B0432985741581BBFEA2555B176C833A3C';
final String _theirs = 'AB' * 32;
final String _second = 'CD' * 32;

const SignerPins _complete = SignerPins(
  digests: <String>[_oursHex],
  complete: true,
);
const SignerPins _incomplete = SignerPins(
  digests: <String>[_oursHex],
  complete: false,
);

SigningCertificates _signed(List<String> sha, {bool multiple = false}) =>
    SigningCertificates(sha256: sha, multipleSigners: multiple);

void main() {
  group('RootSignal wire names', () {
    test('every signal round-trips its wire name', () {
      for (final RootSignal s in RootSignal.values) {
        expect(RootSignal.named(s.wire), s);
      }
    });

    test('an unknown name is ignored, not trusted', () {
      expect(RootSignal.named('definitely_rooted'), isNull);
    });
  });

  group('detectRoot', () {
    test('no signal is clean', () async {
      final RootReport r = await detectRoot(const FixedDeviceIntegrityProbe());
      expect(r.status, RootStatus.clean);
      expect(r.signals, isEmpty);
    });

    test('any one signal is rooted, and the signals are kept', () async {
      for (final RootSignal s in RootSignal.values) {
        final RootReport r = await detectRoot(
          FixedDeviceIntegrityProbe(signals: <RootSignal>{s}),
        );
        expect(r.status, RootStatus.rooted, reason: s.wire);
        expect(r.signals, <RootSignal>{s});
      }
    });

    test('a failed probe is unknown — never rooted, never thrown', () async {
      final RootReport r = await detectRoot(
        const FixedDeviceIntegrityProbe(rootThrows: true),
      );
      expect(r.status, RootStatus.unknown);
    });
  });

  group('normalizeCertificateDigest', () {
    test('keytool colon form and bare hex, any case, are one spelling', () {
      expect(normalizeCertificateDigest(_ours), _oursHex);
      expect(normalizeCertificateDigest(_oursHex.toLowerCase()), _oursHex);
      expect(normalizeCertificateDigest(' $_ours\n'), _oursHex);
    });

    test('anything that is not 32 bytes of hex is no digest', () {
      expect(normalizeCertificateDigest(''), isNull);
      expect(normalizeCertificateDigest('AB' * 20), isNull); // SHA-1 length
      expect(normalizeCertificateDigest('ZZ' * 32), isNull);
    });
  });

  group('compareSigner — the comparison', () {
    test('our key on a complete set is verified', () {
      expect(
        compareSigner(
          actual: _signed(<String>[_ours]),
          pins: _complete,
          isDebugBuild: false,
        ),
        SignerVerdict.verified,
      );
    });

    test(
      'a foreign key on a complete set is a mismatch, and only that blocks',
      () {
        final SignerVerdict v = compareSigner(
          actual: _signed(<String>[_theirs]),
          pins: _complete,
          isDebugBuild: false,
        );
        expect(v, SignerVerdict.mismatch);
        expect(
          DeviceIntegrity(
            root: const RootReport(RootStatus.clean),
            signer: v,
          ).blocksDataAccess,
          isTrue,
        );
      },
    );

    test('a foreign key on an INCOMPLETE set is reported, never blocked', () {
      final SignerVerdict v = compareSigner(
        actual: _signed(<String>[_theirs]),
        pins: _incomplete,
        isDebugBuild: false,
      );
      expect(v, SignerVerdict.mismatchReported);
      expect(
        DeviceIntegrity(
          root: const RootReport(RootStatus.clean),
          signer: v,
        ).blocksDataAccess,
        isFalse,
      );
    });

    test('a channel with no pin set at all reports, never blocks', () {
      expect(
        compareSigner(
          actual: _signed(<String>[_theirs]),
          pins: const SignerPins(digests: <String>[], complete: false),
          isDebugBuild: false,
        ),
        SignerVerdict.mismatchReported,
      );
    });

    test('a debug-signed build is exempt in DEBUG only', () {
      // The same foreign (debug) key: exempt in a debug build...
      expect(
        compareSigner(
          actual: _signed(<String>[_theirs]),
          pins: _complete,
          isDebugBuild: true,
        ),
        SignerVerdict.exemptDebug,
      );
      // ...and a mismatch in a release or profile build.
      expect(
        compareSigner(
          actual: _signed(<String>[_theirs]),
          pins: _complete,
          isDebugBuild: false,
        ),
        SignerVerdict.mismatch,
      );
    });

    test('a rotated key whose lineage holds ours is verified', () {
      expect(
        compareSigner(
          actual: _signed(<String>[_ours, _second]),
          pins: _complete,
          isDebugBuild: false,
        ),
        SignerVerdict.verified,
      );
    });

    test('with several signers at once, ONE foreign signer is a mismatch', () {
      expect(
        compareSigner(
          actual: _signed(<String>[_ours, _theirs], multiple: true),
          pins: _complete,
          isDebugBuild: false,
        ),
        SignerVerdict.mismatch,
      );
      expect(
        compareSigner(
          actual: _signed(<String>[_ours], multiple: true),
          pins: _complete,
          isDebugBuild: false,
        ),
        SignerVerdict.verified,
      );
    });

    test('no certificate, or one that is not a digest, is unreadable', () {
      expect(
        compareSigner(
          actual: _signed(<String>[]),
          pins: _complete,
          isDebugBuild: false,
        ),
        SignerVerdict.unreadable,
      );
      expect(
        compareSigner(
          actual: _signed(<String>['not-a-digest']),
          pins: _complete,
          isDebugBuild: false,
        ),
        SignerVerdict.unreadable,
      );
    });
  });

  group('the generated pins', () {
    test('android-play compiles in both pins, and is complete', () {
      final SignerPins? play = signerPinsFor('android-play');
      expect(play, isNotNull);
      expect(play!.digests, contains(_oursHex));
      // ⏱ 2026-10-03: the app signing pin, read off the Play Developer API.
      expect(play.digests, contains(_playHex));
      expect(play.complete, isTrue);
    });

    test('apps-gov-in has a row and no pin yet', () {
      final SignerPins? agi = signerPinsFor('apps-gov-in');
      expect(agi, isNotNull);
      expect(agi!.digests, isEmpty);
      expect(agi.complete, isFalse);
    });

    test('a channel with no row has no pins', () {
      expect(signerPinsFor('web'), isNull);
      expect(signerPinsFor(''), isNull);
    });

    test('every generated digest is already normalised', () {
      for (final SignerPins p in kSignerPinsByChannel.values) {
        for (final String d in p.digests) {
          expect(normalizeCertificateDigest(d), d);
        }
        if (p.complete) expect(p.digests, isNotEmpty);
      }
    });
  });

  group('assessDeviceIntegrity', () {
    Future<DeviceIntegrity> assess(
      DeviceIntegrityProbe probe, {
      String channel = 'android-play',
      bool debug = false,
      bool android = true,
    }) => assessDeviceIntegrity(
      probe: probe,
      releaseChannel: channel,
      isDebugBuild: debug,
      checksSigner: android,
    );

    test('our upload key on android-play is verified', () async {
      final DeviceIntegrity i = await assess(
        FixedDeviceIntegrityProbe(certificates: _signed(<String>[_ours])),
      );
      expect(i.signer, SignerVerdict.verified);
      expect(i.blocksDataAccess, isFalse);
    });

    test('Play\'s app signing key on android-play is verified', () async {
      final DeviceIntegrity i = await assess(
        FixedDeviceIntegrityProbe(certificates: _signed(<String>[_play])),
      );
      expect(i.signer, SignerVerdict.verified);
      expect(i.blocksDataAccess, isFalse);
    });

    test('a foreign key on android-play blocks: its set is complete', () async {
      final DeviceIntegrity i = await assess(
        FixedDeviceIntegrityProbe(certificates: _signed(<String>[_theirs])),
      );
      expect(i.signer, SignerVerdict.mismatch);
      expect(i.reportsSigner, isTrue);
      expect(i.blocksDataAccess, isTrue);
    });

    test(
      'a foreign key on an INCOMPLETE set is reported, never blocked',
      () async {
        final DeviceIntegrity i = await assessDeviceIntegrity(
          probe: FixedDeviceIntegrityProbe(
            certificates: _signed(<String>[_theirs]),
          ),
          releaseChannel: 'android-play',
          isDebugBuild: false,
          checksSigner: true,
          pinsFor: (_) => _incomplete,
        );
        expect(i.signer, SignerVerdict.mismatchReported);
        expect(i.reportsSigner, isTrue);
        expect(i.blocksDataAccess, isFalse);
      },
    );

    test('off android the signer is not checked', () async {
      final DeviceIntegrity i = await assess(
        FixedDeviceIntegrityProbe(certificates: _signed(<String>[_theirs])),
        android: false,
      );
      expect(i.signer, SignerVerdict.notChecked);
    });

    test('a channel with no pins row is not checked', () async {
      final DeviceIntegrity i = await assess(
        FixedDeviceIntegrityProbe(certificates: _signed(<String>[_theirs])),
        channel: 'web',
      );
      expect(i.signer, SignerVerdict.notChecked);
    });

    test('a debug build is exempt without reading a certificate', () async {
      final DeviceIntegrity i = await assess(
        const FixedDeviceIntegrityProbe(signerThrows: true),
        debug: true,
      );
      expect(i.signer, SignerVerdict.exemptDebug);
    });

    test('a failed certificate read is unreadable and never blocks', () async {
      final DeviceIntegrity i = await assess(
        const FixedDeviceIntegrityProbe(signerThrows: true),
      );
      expect(i.signer, SignerVerdict.unreadable);
      expect(i.blocksDataAccess, isFalse);
    });

    test('a rooted device is rooted, recorded, and never blocked', () async {
      final DeviceIntegrity i = await assess(
        FixedDeviceIntegrityProbe(
          signals: const <RootSignal>{RootSignal.suBinary, RootSignal.testKeys},
          certificates: _signed(<String>[_ours]),
        ),
      );
      expect(i.rooted, isTrue);
      expect(i.blocksDataAccess, isFalse);
      expect(i.reportsSigner, isFalse);
      expect(
        i.record,
        'integrity root=rooted(su_binary+test_keys) signer=verified',
      );
    });
  });

  group('the session', () {
    test('a rooted device gets the notice once per session', () {
      final IntegritySession s = IntegritySession(
        const DeviceIntegrity(
          root: RootReport(RootStatus.rooted, <RootSignal>{
            RootSignal.magiskPath,
          }),
          signer: SignerVerdict.verified,
        ),
      );
      expect(s.takeRootNotice(), isTrue);
      expect(s.takeRootNotice(), isFalse);
      expect(s.takeRootNotice(), isFalse);
    });

    test('a clean or unreadable device never gets it', () {
      for (final RootStatus st in <RootStatus>[
        RootStatus.clean,
        RootStatus.unknown,
      ]) {
        final IntegritySession s = IntegritySession(
          DeviceIntegrity(root: RootReport(st), signer: SignerVerdict.verified),
        );
        expect(s.takeRootNotice(), isFalse, reason: st.name);
      }
    });
  });

  group('confirmSensitiveAction', () {
    const DeviceIntegrity rooted = DeviceIntegrity(
      root: RootReport(RootStatus.rooted, <RootSignal>{RootSignal.suBinary}),
      signer: SignerVerdict.verified,
    );
    const DeviceIntegrity clean = DeviceIntegrity(
      root: RootReport(RootStatus.clean),
      signer: SignerVerdict.verified,
    );

    test('a clean device goes straight through, never asked', () async {
      int asked = 0;
      for (final SensitiveAction a in SensitiveAction.values) {
        expect(
          await confirmSensitiveAction(
            integrity: clean,
            action: a,
            reauthenticate: () async {
              asked++;
              return false;
            },
          ),
          isTrue,
        );
      }
      expect(asked, 0);
    });

    test('a rooted device proceeds only on a successful re-auth', () async {
      for (final SensitiveAction a in SensitiveAction.values) {
        expect(
          await confirmSensitiveAction(
            integrity: rooted,
            action: a,
            reauthenticate: () async => true,
          ),
          isTrue,
        );
        expect(
          await confirmSensitiveAction(
            integrity: rooted,
            action: a,
            reauthenticate: () async => false,
          ),
          isFalse,
        );
        expect(
          await confirmSensitiveAction(
            integrity: rooted,
            action: a,
            reauthenticate: () async => throw StateError('cancelled'),
          ),
          isFalse,
        );
      }
    });
  });
}
