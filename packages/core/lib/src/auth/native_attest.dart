/// ⏱ 2026-09-29 · NATIVE SIGN-IN ATTESTATION — the CLIENT's half of the binding
/// every native sign-in, sign-up, reset and resend carries. ⏱ 2026-09-30 · now
/// WIRE PROTOCOL v2: the proof also covers the request's path and query.
///
/// 🔴 WHY IT EXISTS. The platform Worker's captcha-free native route
/// (`POST /v1/auth/native/<app>/{token,signup,recover,resend}`) was reachable by
/// any script: it forwards to GoTrue with the service-role bearer, which GoTrue
/// does not captcha, so it was a sign-up / reset-mail cannon with no brake but a
/// rate limit. The server now REFUSES every op that carries no attestation. This
/// file is what lets a real install of a real app produce one.
///
/// THE BINDING. A proof is over `clientData`, never over the body alone:
///
///     clientData = "nk-native-auth/v2\n<app>\n<op>\n<challenge>\n<target>\n<bodyHash>"
///
/// so a proof minted for one app, one op, one single-use server challenge, one
/// request target and one exact body is worth nothing for any other.
/// `bodyHash` is over the EXACT bytes sent — the caller hashes what goes on the
/// wire, not a re-encoding of it.
///
/// ⏱ 2026-09-30 · v2, from a security review: v1 bound app, op, challenge and
/// body but NOT the query, so a proof captured for `/signup?redirect_to=A` also
/// stood for `/signup?redirect_to=B`. `target` ([nativeAttestTarget]) is the
/// URL's path plus its canonical query, which the server recomputes from the
/// URL it received. The challenge is an OPAQUE server token: the client only
/// requires it to be non-empty and one line, and never parses it.
///
/// THREE KINDS, one seam ([NativeAttestor]):
///   · `play-integrity` (android) — a Play Integrity classic token whose nonce is
///     [nativeAttestRequestHash]; no install step.
///   · `app-attest` (ios, macos) — an App Attest assertion over
///     [nativeAttestClientDataHash]; the key is attested once at install.
///   · `install-key` (windows, linux, and wherever platform attestation is
///     unavailable) — [InstallKeyAttestor]: an Ed25519 signature by a key made
///     on this install. It proves continuity of an install, not a genuine
///     device, and the server grants it less for that reason.
///
/// PURE DART, like the rest of core: the platform kinds implement this seam in
/// `packages/platform_storage`, and the HTTP half that attaches the headers is
/// `packages/auth_supabase` (`NativeAttestationClient`).
library;

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart' show sha256;
import 'package:cryptography/cryptography.dart';

import '../storage/secure_store.dart';

/// The protocol prefix — the first line of every `clientData`.
const String kNativeAttestProtocol = 'nk-native-auth/v2';

/// Header: which kind of proof this request carries.
const String kNativeAttestKindHeader = 'X-NK-Attest-Kind';

/// Header: the single-use challenge the proof is bound to.
const String kNativeAttestChallengeHeader = 'X-NK-Attest-Challenge';

/// Header: the registered key's id (`app-attest`, `install-key`; absent for
/// `play-integrity`).
const String kNativeAttestKeyHeader = 'X-NK-Attest-Key';

/// Header: the proof itself.
const String kNativeAttestProofHeader = 'X-NK-Attest-Proof';

/// Android: a Play Integrity CLASSIC token, nonce = the request hash.
const String kNativeAttestKindPlayIntegrity = 'play-integrity';

/// iOS / macOS: an App Attest assertion over the clientData hash.
const String kNativeAttestKindAppAttest = 'app-attest';

/// Windows / Linux / no platform attestation: an Ed25519 per-install key.
const String kNativeAttestKindInstallKey = 'install-key';

/// The four ops gotrue-dart appends to the native base, and the only requests
/// that carry an attestation.
const Set<String> kNativeAttestOps = <String>{
  'token',
  'signup',
  'recover',
  'resend',
};

/// The op named in the clientData of an install registration.
const String kNativeAttestInstallOp = 'install';

/// Under the native base: where a fresh single-use challenge is minted.
const String kNativeAttestChallengePath = '/attest/challenge';

/// Under the native base: where an `app-attest` / `install-key` key registers.
const String kNativeAttestInstallPath = '/attest/install';

/// The one refusal the client answers by itself: the server has no registered
/// key by that id, so re-register once and retry once.
const String kNativeAttestKeyUnknown = 'attestation_key_unknown';

/// base64url with the padding stripped — every encoded value in the protocol.
String nativeAttestBase64Url(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');

/// `base64url-no-pad(SHA-256(body))` over the EXACT request body bytes. An empty
/// body hashes zero bytes.
String nativeAttestBodyHash(List<int> body) =>
    nativeAttestBase64Url(sha256.convert(body).bytes);

/// The canonical request target of [url] — the `target` line of clientData.
///
/// The URL's path exactly as sent (`Uri.path`, still percent-encoded), then,
/// only when the query holds at least one parameter, `?` and the canonical
/// query: every DECODED parameter (duplicates kept; `+` decodes to a space, as
/// the server's `URLSearchParams` does), sorted by key and then by value in
/// UTF-16 code-unit order, each re-encoded as
/// `encodeComponent(key)=encodeComponent(value)` and joined with `&`.
/// `Uri.encodeComponent` leaves `A-Za-z0-9-_.!~*'()` unescaped, the same set as
/// JS `encodeURIComponent`, so the intent is that both runtimes render one
/// query the same way however the sender spelled or ordered it.
///
/// ⏱ 2026-09-30 · wire protocol v2. A relative [url] (path and query only, as
/// a server's `HttpRequest.uri` is) gives the same target as the absolute one.
String nativeAttestTarget(Uri url) {
  final List<(String, String)> params = <(String, String)>[
    for (final MapEntry<String, List<String>> entry
        in url.queryParametersAll.entries)
      for (final String value in entry.value) (entry.key, value),
  ];
  if (params.isEmpty) return url.path;
  params.sort(((String, String) a, (String, String) b) {
    final int byKey = a.$1.compareTo(b.$1);
    return byKey != 0 ? byKey : a.$2.compareTo(b.$2);
  });
  final String query = params
      .map(
        ((String, String) p) =>
            '${Uri.encodeComponent(p.$1)}=${Uri.encodeComponent(p.$2)}',
      )
      .join('&');
  return '${url.path}?$query';
}

/// The string every proof is over. [target] is [nativeAttestTarget] of the
/// URL the request is sent to; [body] is the exact bytes sent.
///
/// Refuses a field containing a newline: the lines are the framing, and a field
/// that could carry one could make two different requests frame the same.
String nativeAttestClientData({
  required String app,
  required String op,
  required String challenge,
  required String target,
  required List<int> body,
}) {
  for (final String field in <String>[app, op, challenge, target]) {
    if (field.isEmpty || field.contains('\n')) {
      throw ArgumentError.value(
        field,
        'clientData field',
        'must be non-empty and hold no newline',
      );
    }
  }
  return '$kNativeAttestProtocol\n$app\n$op\n$challenge\n$target\n'
      '${nativeAttestBodyHash(body)}';
}

/// `SHA-256(UTF-8(clientData))`, raw — App Attest's `clientDataHash`.
List<int> nativeAttestClientDataHash(String clientData) =>
    sha256.convert(utf8.encode(clientData)).bytes;

/// `base64url-no-pad(SHA-256(UTF-8(clientData)))` — 43 characters. The Play
/// Integrity nonce.
String nativeAttestRequestHash(String clientData) =>
    nativeAttestBase64Url(nativeAttestClientDataHash(clientData));

/// What [NativeAttestor.prove] hands the HTTP client for one op.
final class NativeAttestProof {
  const NativeAttestProof({
    required this.kind,
    required this.proof,
    this.keyId,
  });

  /// The `X-NK-Attest-Kind` value.
  final String kind;

  /// The `X-NK-Attest-Key` value, or null when the kind has none
  /// (`play-integrity`).
  final String? keyId;

  /// The `X-NK-Attest-Proof` value.
  final String proof;

  /// The headers an op carries for [challenge] — three or four of them.
  Map<String, String> headers(String challenge) => <String, String>{
    kNativeAttestKindHeader: kind,
    kNativeAttestChallengeHeader: challenge,
    kNativeAttestKeyHeader: ?keyId,
    kNativeAttestProofHeader: proof,
  };
}

/// What [NativeAttestor.register] hands the HTTP client: the install request's
/// exact [body] and the [proof] over its clientData (op `install`, and the
/// install URL's target).
final class NativeAttestInstall {
  const NativeAttestInstall({
    required this.kind,
    required this.body,
    required this.proof,
  });

  final String kind;

  /// The exact JSON bytes to POST to `<base>/attest/install`.
  final List<int> body;

  /// Proof of possession: over the clientData of op `install` and [body].
  final String proof;

  /// The headers the install request carries for [challenge].
  Map<String, String> headers(String challenge) => <String, String>{
    kNativeAttestKindHeader: kind,
    kNativeAttestChallengeHeader: challenge,
    kNativeAttestProofHeader: proof,
  };
}

/// A platform could not produce a proof. NEVER answered by sending the op
/// without one: the caller fails, and the request is not made.
final class NativeAttestationException implements Exception {
  const NativeAttestationException(this.kind, this.code, [this.detail]);

  final String kind;

  /// A short machine code (`unsupported`, `channel_failed`, `play_error`, …).
  final String code;
  final String? detail;

  @override
  String toString() =>
      'NativeAttestationException($kind, $code'
      '${detail == null ? '' : ': $detail'})';
}

/// The seam: one per build, chosen by the platform
/// (`platformNativeAttestor` in `nikatru_platform_storage`).
abstract interface class NativeAttestor {
  /// The kind this attestor proves with. A selecting attestor that picks its
  /// kind at first use answers with its preference until then; the headers
  /// always take the kind from [NativeAttestProof] / [NativeAttestInstall].
  String get kind;

  /// Whether a key must be registered (`<base>/attest/install`) before an op.
  bool get needsInstall;

  /// Whether this install's CURRENT key is registered for [app].
  Future<bool> isRegistered({required String app});

  /// The install request for [challenge]: the body naming the key, and the
  /// proof over its clientData (op `install`). [target] is
  /// [nativeAttestTarget] of the URL the install is POSTed to
  /// (`<base>/attest/install`) — ⏱ 2026-09-30, wire protocol v2.
  Future<NativeAttestInstall> register({
    required String app,
    required String challenge,
    required String target,
  });

  /// The server accepted [register]'s request (200/201): remember it.
  Future<void> markRegistered({required String app});

  /// The proof for one op's [clientData].
  Future<NativeAttestProof> prove({required String clientData});

  /// The server answered `attestation_key_unknown`: forget the registration so
  /// the next op registers again.
  Future<void> forget({required String app});
}

/// `install-key`: an Ed25519 key made on this install, its 32-byte seed kept in
/// the [SecureStore] seam (Keychain / Keystore / DPAPI / libsecret through
/// `FlutterSecureStore`).
///
/// keyId = `base64url(SHA-256(raw public key))`; proof = `base64url(Ed25519
/// signature over UTF-8 clientData)`. Registration is remembered per app as the
/// keyId it registered, so a new key is never mistaken for a registered one.
///
/// A store that throws (a Linux box without libsecret) does not stop sign-in:
/// the key lives in memory for this run and registers again next run.
final class InstallKeyAttestor implements NativeAttestor {
  InstallKeyAttestor({required SecureStore store, Ed25519? algorithm})
    : _store = store,
      _ed = algorithm ?? Ed25519();

  /// Where the seed lives, base64url.
  static const String seedStoreKey = 'nk.native_attest.install_key.seed';

  /// Where "registered for [app]" lives: the keyId that was registered.
  static String registeredStoreKey(String app) =>
      'nk.native_attest.install_key.registered.$app';

  final SecureStore _store;
  final Ed25519 _ed;
  Future<_InstallKey>? _key;
  final Map<String, String> _registered = <String, String>{};

  @override
  String get kind => kNativeAttestKindInstallKey;

  @override
  bool get needsInstall => true;

  Future<_InstallKey> get _current {
    final Future<_InstallKey> key = _key ??= _load();
    // A failed load is not cached: the next call tries again.
    key.then<void>(
      (_) {},
      onError: (Object _) {
        if (identical(_key, key)) _key = null;
      },
    );
    return key;
  }

  Future<_InstallKey> _load() async {
    List<int>? seed;
    try {
      final String? stored = await _store.read(seedStoreKey);
      if (stored != null) {
        final List<int> bytes = base64Url.decode(base64Url.normalize(stored));
        if (bytes.length == 32) seed = bytes;
      }
    } on Object {
      seed = null;
    }
    if (seed == null) {
      final Random random = Random.secure();
      seed = List<int>.generate(32, (_) => random.nextInt(256));
      try {
        await _store.write(seedStoreKey, nativeAttestBase64Url(seed));
      } on Object {
        // Memory only for this run; see the class comment.
      }
    }
    final SimpleKeyPair pair = await _ed.newKeyPairFromSeed(seed);
    final List<int> publicKey = (await pair.extractPublicKey()).bytes;
    return _InstallKey(
      pair,
      publicKey,
      nativeAttestBase64Url(sha256.convert(publicKey).bytes),
    );
  }

  /// The raw 32-byte public key, base64url — what the install body names.
  Future<String> publicKey() async =>
      nativeAttestBase64Url((await _current).publicKey);

  /// This install's keyId.
  Future<String> keyId() async => (await _current).keyId;

  Future<String> _sign(String clientData) async {
    final _InstallKey key = await _current;
    final Signature signature = await _ed.sign(
      utf8.encode(clientData),
      keyPair: key.pair,
    );
    return nativeAttestBase64Url(signature.bytes);
  }

  @override
  Future<bool> isRegistered({required String app}) async {
    final String keyId = (await _current).keyId;
    if (_registered[app] == keyId) return true;
    try {
      return await _store.read(registeredStoreKey(app)) == keyId;
    } on Object {
      return false;
    }
  }

  @override
  Future<NativeAttestInstall> register({
    required String app,
    required String challenge,
    required String target,
  }) async {
    final List<int> body = utf8.encode(
      jsonEncode(<String, String>{
        'kind': kNativeAttestKindInstallKey,
        'public_key': await publicKey(),
      }),
    );
    final String clientData = nativeAttestClientData(
      app: app,
      op: kNativeAttestInstallOp,
      challenge: challenge,
      target: target,
      body: body,
    );
    return NativeAttestInstall(
      kind: kNativeAttestKindInstallKey,
      body: body,
      proof: await _sign(clientData),
    );
  }

  @override
  Future<void> markRegistered({required String app}) async {
    final String keyId = (await _current).keyId;
    _registered[app] = keyId;
    try {
      await _store.write(registeredStoreKey(app), keyId);
    } on Object {
      // Remembered in memory for this run.
    }
  }

  @override
  Future<NativeAttestProof> prove({required String clientData}) async =>
      NativeAttestProof(
        kind: kNativeAttestKindInstallKey,
        keyId: (await _current).keyId,
        proof: await _sign(clientData),
      );

  /// Forgets the REGISTRATION, not the key: the server lost the row, and the
  /// same key registers again.
  @override
  Future<void> forget({required String app}) async {
    _registered.remove(app);
    try {
      await _store.delete(registeredStoreKey(app));
    } on Object {
      // Nothing persisted to forget.
    }
  }
}

final class _InstallKey {
  const _InstallKey(this.pair, this.publicKey, this.keyId);
  final SimpleKeyPair pair;
  final List<int> publicKey;
  final String keyId;
}
