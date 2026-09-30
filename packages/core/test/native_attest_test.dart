// ⏱ 2026-09-29 · native sign-in attestation — the client's binding and the
// per-install Ed25519 key. ⏱ 2026-09-30 · wire protocol v2: clientData carries
// the request TARGET (path + canonical query) between challenge and bodyHash.
//
// 🔴 THE LITERALS BELOW ARE THE CROSS-RUNTIME AGREEMENT. The server's tests
// assert the same vector (same app, op, challenge, target, body, seed); a client
// and a server that each pass their own tests but disagree on one byte would
// refuse every real sign-in. Recomputed independently with node:crypto (and the
// canonical queries with node's URLSearchParams + encodeURIComponent) before
// being pasted here — never derived from this file's own output.
import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

const String _app = 'subscriptiontracker';
const String _challenge = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const String _body = '{"email":"a@example.test","password":"pw"}';
const String _bodyHash = '6iU0klSWpvzudfyl590CwvA54eDW4neVBb9Nc2Uk35U';
const String _origin = 'https://platform.nikatru.test';
const String _tokenPath = '/v1/auth/native/subscriptiontracker/token';
const String _target =
    '/v1/auth/native/subscriptiontracker/token'
    '?grant_type=password';
const String _requestHash = 'OxAuf5vrL3xArivihIdBI7-GjML5J9Fb8l28ubtBYac';
const String _publicKey = '6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw';
const String _keyId = '_oEsEvOrTOasXbaaw1L5BssbEe9D-zPiUu9_9VImOIk';
const String _signature =
    'WOSt3gJcbYAB3xE8nnRjK7WYZKBy4xmc6H4WIRce6RzC9b_WyHtdIl5vucGMk0wAnXlM1fqs'
    'YxAasbFASMR_BA';

/// The install URL's target: a path, no query.
const String _installTarget =
    '/v1/auth/native/subscriptiontracker/attest/install';

/// The sign-up vector's redirect, and its canonical target.
const String _redirect =
    'com.nikatru.subscriptiontracker://auth-callback?nk_auth=confirm';
const String _signupTarget =
    '/v1/auth/native/subscriptiontracker/signup'
    '?foo=b%20a%2Br'
    '&redirect_to=com.nikatru.subscriptiontracker%3A%2F%2Fauth-callback'
    '%3Fnk_auth%3Dconfirm';

/// The contract's seed, 32 × 0x07, as the store keeps it.
String get _seed => nativeAttestBase64Url(List<int>.filled(32, 7));

String _clientData({
  String app = _app,
  String op = 'token',
  String challenge = _challenge,
  String target = _target,
  String body = _body,
}) => nativeAttestClientData(
  app: app,
  op: op,
  challenge: challenge,
  target: target,
  body: utf8.encode(body),
);

/// A store whose every call throws — a Linux box without libsecret.
class _BrokenStore implements SecureStore {
  @override
  Future<String?> read(String key) async => throw StateError('no keyring');
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('no keyring');
  @override
  Future<void> delete(String key) async => throw StateError('no keyring');
  @override
  Future<void> deleteAll() async => throw StateError('no keyring');
}

void main() {
  group('the binding — the contract vector', () {
    test('the challenge is bytes 0..31, base64url without padding', () {
      expect(
        nativeAttestBase64Url(List<int>.generate(32, (int i) => i)),
        _challenge,
      );
    });

    test('bodyHash over the exact body bytes', () {
      expect(nativeAttestBodyHash(utf8.encode(_body)), _bodyHash);
    });

    test('the token target is the path and its one query parameter', () {
      expect(
        nativeAttestTarget(
          Uri.parse('$_origin$_tokenPath?grant_type=password'),
        ),
        _target,
      );
    });

    test('clientData is the six lines, in order', () {
      expect(
        _clientData(),
        'nk-native-auth/v2\n$_app\ntoken\n$_challenge\n$_target\n$_bodyHash',
      );
    });

    test('requestHash is 43 characters, no padding', () {
      final String hash = nativeAttestRequestHash(_clientData());
      expect(hash, _requestHash);
      expect(hash, hasLength(43));
      expect(hash, isNot(contains('=')));
    });

    test('clientDataHash is the 32 raw bytes the requestHash encodes', () {
      final List<int> raw = nativeAttestClientDataHash(_clientData());
      expect(raw, hasLength(32));
      expect(nativeAttestBase64Url(raw), _requestHash);
    });

    test('an empty body hashes zero bytes', () {
      expect(
        nativeAttestBodyHash(const <int>[]),
        '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU',
      );
    });

    test('the header names and kinds are the contract\'s', () {
      expect(kNativeAttestKindHeader, 'X-NK-Attest-Kind');
      expect(kNativeAttestChallengeHeader, 'X-NK-Attest-Challenge');
      expect(kNativeAttestKeyHeader, 'X-NK-Attest-Key');
      expect(kNativeAttestProofHeader, 'X-NK-Attest-Proof');
      expect(kNativeAttestProtocol, 'nk-native-auth/v2');
      expect(
        <String>[
          kNativeAttestKindPlayIntegrity,
          kNativeAttestKindAppAttest,
          kNativeAttestKindInstallKey,
        ],
        <String>['play-integrity', 'app-attest', 'install-key'],
      );
      expect(kNativeAttestOps, <String>{
        'token',
        'signup',
        'recover',
        'resend',
      });
    });

    test('the challenge is OPAQUE: a server token of any shape is bound '
        'verbatim, never parsed', () {
      const String opaque =
          'c1.subscriptiontracker.1790000000.AQEBAQEBAQEBAQEBAQEBAQ.'
          'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI';
      expect(
        _clientData(challenge: opaque),
        'nk-native-auth/v2\n$_app\ntoken\n$opaque\n$_target\n$_bodyHash',
      );
      expect(_clientData(challenge: 'ch-1'), contains('\nch-1\n'));
    });
  });

  group('the canonical target (wire protocol v2)', () {
    test('the sign-up vector: every param decoded (+ is a space), sorted by '
        'key, re-encoded as encodeURIComponent does', () {
      final Uri url = Uri.parse(
        '$_origin/v1/auth/native/$_app/signup'
        '?redirect_to=${Uri.encodeComponent(_redirect)}&foo=b+a%2Br',
      );
      expect(url.queryParametersAll['foo'], <String>['b a+r']);
      expect(nativeAttestTarget(url), _signupTarget);
    });

    test('the same parameters, spelled and ordered differently, are one '
        'target', () {
      expect(
        nativeAttestTarget(
          Uri.https(
            'platform.nikatru.test',
            '/v1/auth/native/$_app/signup',
            <String, String>{'foo': 'b a+r', 'redirect_to': _redirect},
          ),
        ),
        _signupTarget,
      );
      expect(
        nativeAttestTarget(
          Uri.parse(
            '$_origin/v1/auth/native/$_app/signup'
            '?foo=b%20a%2br&redirect_to=${Uri.encodeComponent(_redirect)}',
          ),
        ),
        _signupTarget,
      );
    });

    test('the install target is the path alone, with no "?"', () {
      expect(
        nativeAttestTarget(Uri.parse('$_origin$_installTarget')),
        _installTarget,
      );
      expect(
        nativeAttestTarget(Uri.parse('$_origin$_installTarget?')),
        _installTarget,
        reason: 'an empty query holds no parameter',
      );
    });

    test('a relative URL (a server\'s request uri) is the same target', () {
      expect(nativeAttestTarget(Uri.parse(_target)), _target);
    });

    test('duplicates are kept and sorted by value; UTF-16 order puts '
        'upper case before lower and non-ASCII last', () {
      expect(
        nativeAttestTarget(Uri.parse('https://x/p?b=2&a=z&a=y&%C3%A9=1&Z=0')),
        '/p?Z=0&a=y&a=z&b=2&%C3%A9=1',
      );
    });

    test('encodeURIComponent\'s unreserved set stays bare; an empty value '
        'keeps its "="', () {
      expect(
        nativeAttestTarget(Uri.parse('https://x/p?k=%21%27%28%29%2A~-_.&e=')),
        "/p?e=&k=!'()*~-_.",
      );
    });
  });

  group('🔴 red controls — the binding moves with what it binds', () {
    test('a one-byte body change changes bodyHash and requestHash', () {
      final List<int> changed = utf8.encode(_body)..[2] ^= 0x01;
      expect(nativeAttestBodyHash(changed), isNot(_bodyHash));
      expect(
        nativeAttestRequestHash(
          nativeAttestClientData(
            app: _app,
            op: 'token',
            challenge: _challenge,
            target: _target,
            body: changed,
          ),
        ),
        isNot(_requestHash),
      );
    });

    test('changing ONLY the query changes the target and requestHash', () {
      final String other = nativeAttestTarget(
        Uri.parse(
          '$_origin/v1/auth/native/$_app/signup'
          '?redirect_to=${Uri.encodeComponent('https://evil.test/cb')}'
          '&foo=b+a%2Br',
        ),
      );
      expect(other, isNot(_signupTarget));
      expect(
        nativeAttestRequestHash(_clientData(op: 'signup', target: other)),
        isNot(
          nativeAttestRequestHash(
            _clientData(op: 'signup', target: _signupTarget),
          ),
        ),
      );
      expect(
        nativeAttestRequestHash(
          _clientData(target: '$_tokenPath?grant_type=refresh_token'),
        ),
        isNot(_requestHash),
      );
      expect(
        nativeAttestRequestHash(_clientData(target: _tokenPath)),
        isNot(_requestHash),
        reason: 'dropping the query is a change too',
      );
    });

    test('changing ONLY the path changes requestHash', () {
      expect(
        nativeAttestRequestHash(
          _clientData(
            target: '/v1/auth/native/otherapp/token?grant_type=password',
          ),
        ),
        isNot(_requestHash),
      );
    });

    test('a different challenge, op or app changes requestHash', () {
      final String other = nativeAttestBase64Url(
        List<int>.generate(32, (int i) => 31 - i),
      );
      expect(
        nativeAttestRequestHash(_clientData(challenge: other)),
        isNot(_requestHash),
      );
      expect(
        nativeAttestRequestHash(_clientData(op: 'signup')),
        isNot(_requestHash),
      );
      expect(
        nativeAttestRequestHash(_clientData(app: 'otherapp')),
        isNot(_requestHash),
      );
    });

    test('a field holding a newline cannot reframe the lines', () {
      expect(
        () => _clientData(op: 'token\nsignup'),
        throwsA(isA<ArgumentError>()),
      );
      expect(() => _clientData(challenge: ''), throwsA(isA<ArgumentError>()));
      expect(
        () => _clientData(target: '$_tokenPath\nX'),
        throwsA(isA<ArgumentError>()),
      );
      expect(() => _clientData(target: ''), throwsA(isA<ArgumentError>()));
    });
  });

  group('InstallKeyAttestor — the contract seed', () {
    late InMemorySecureStore store;
    late InstallKeyAttestor attestor;
    setUp(() {
      store = InMemorySecureStore(<String, String>{
        InstallKeyAttestor.seedStoreKey: _seed,
      });
      attestor = InstallKeyAttestor(store: store);
    });

    test(
      'the persisted seed yields the contract public key and keyId',
      () async {
        expect(await attestor.publicKey(), _publicKey);
        expect(await attestor.keyId(), _keyId);
      },
    );

    test('prove signs UTF-8 clientData: the contract signature', () async {
      final NativeAttestProof proof = await attestor.prove(
        clientData: _clientData(),
      );
      expect(proof.kind, 'install-key');
      expect(proof.keyId, _keyId);
      expect(proof.proof, _signature);
      expect(proof.headers(_challenge), <String, String>{
        'X-NK-Attest-Kind': 'install-key',
        'X-NK-Attest-Challenge': _challenge,
        'X-NK-Attest-Key': _keyId,
        'X-NK-Attest-Proof': _signature,
      });
    });

    test('red control: a signature over another clientData does not verify '
        'for this one', () async {
      final NativeAttestProof other = await attestor.prove(
        clientData: _clientData(op: 'signup'),
      );
      expect(other.proof, isNot(_signature));
      final bool ok = await Ed25519().verify(
        utf8.encode(_clientData()),
        signature: Signature(
          base64Url.decode(base64Url.normalize(other.proof)),
          publicKey: SimplePublicKey(
            base64Url.decode(base64Url.normalize(_publicKey)),
            type: KeyPairType.ed25519,
          ),
        ),
      );
      expect(ok, isFalse);
    });

    test('register: the install body names the public key, and the proof '
        'verifies over op=install clientData for the install target', () async {
      final NativeAttestInstall install = await attestor.register(
        app: _app,
        challenge: _challenge,
        target: _installTarget,
      );
      expect(install.kind, 'install-key');
      expect(
        utf8.decode(install.body),
        '{"kind":"install-key","public_key":"$_publicKey"}',
      );
      Future<bool> verifiesFor(String target) => Ed25519().verify(
        utf8.encode(
          nativeAttestClientData(
            app: _app,
            op: 'install',
            challenge: _challenge,
            target: target,
            body: install.body,
          ),
        ),
        signature: Signature(
          base64Url.decode(base64Url.normalize(install.proof)),
          publicKey: SimplePublicKey(
            base64Url.decode(base64Url.normalize(_publicKey)),
            type: KeyPairType.ed25519,
          ),
        ),
      );
      expect(await verifiesFor(_installTarget), isTrue);
      expect(
        await verifiesFor(_tokenPath),
        isFalse,
        reason: 'red control: the install proof is bound to its target',
      );
      expect(install.headers(_challenge), <String, String>{
        'X-NK-Attest-Kind': 'install-key',
        'X-NK-Attest-Challenge': _challenge,
        'X-NK-Attest-Proof': install.proof,
      });
    });

    test('registered is remembered per app, as the keyId, and forget drops '
        'the registration but keeps the key', () async {
      expect(await attestor.isRegistered(app: _app), isFalse);
      await attestor.markRegistered(app: _app);
      expect(await attestor.isRegistered(app: _app), isTrue);
      expect(await attestor.isRegistered(app: 'otherapp'), isFalse);
      expect(
        await store.read(InstallKeyAttestor.registeredStoreKey(_app)),
        _keyId,
      );
      // A second attestor over the same store (the next launch) agrees.
      expect(
        await InstallKeyAttestor(store: store).isRegistered(app: _app),
        isTrue,
      );

      await attestor.forget(app: _app);
      expect(await attestor.isRegistered(app: _app), isFalse);
      expect(await attestor.keyId(), _keyId, reason: 'the key is kept');
      expect(await store.read(InstallKeyAttestor.seedStoreKey), _seed);
    });

    test(
      'a registration recorded for ANOTHER key is not this key\'s',
      () async {
        await store.write(InstallKeyAttestor.registeredStoreKey(_app), 'stale');
        expect(await attestor.isRegistered(app: _app), isFalse);
      },
    );
  });

  group('InstallKeyAttestor — first use', () {
    test('generates a key once, persists the seed, and the next launch loads '
        'the same key', () async {
      final InMemorySecureStore store = InMemorySecureStore();
      final InstallKeyAttestor first = InstallKeyAttestor(store: store);
      final String keyId = await first.keyId();
      final String? seed = await store.read(InstallKeyAttestor.seedStoreKey);
      expect(seed, isNotNull);
      expect(base64Url.decode(base64Url.normalize(seed!)), hasLength(32));
      expect(await first.keyId(), keyId, reason: 'stable within a run');
      expect(
        await InstallKeyAttestor(store: store).keyId(),
        keyId,
        reason: 'stable across runs',
      );
      expect(keyId, isNot(_keyId));
    });

    test(
      'a store that throws still yields a working key for this run',
      () async {
        final InstallKeyAttestor attestor = InstallKeyAttestor(
          store: _BrokenStore(),
        );
        final NativeAttestProof proof = await attestor.prove(
          clientData: _clientData(),
        );
        expect(proof.proof, isNotEmpty);
        expect(proof.keyId, await attestor.keyId());
        expect(await attestor.isRegistered(app: _app), isFalse);
        await attestor.markRegistered(app: _app);
        expect(await attestor.isRegistered(app: _app), isTrue);
      },
    );

    test('a corrupt stored seed is replaced, never used', () async {
      final InMemorySecureStore store = InMemorySecureStore(<String, String>{
        InstallKeyAttestor.seedStoreKey: 'AAAA',
      });
      final InstallKeyAttestor attestor = InstallKeyAttestor(store: store);
      await attestor.keyId();
      final String? seed = await store.read(InstallKeyAttestor.seedStoreKey);
      expect(base64Url.decode(base64Url.normalize(seed!)), hasLength(32));
    });
  });
}
