/// ⏱ 2026-09-29 · NATIVE SIGN-IN ATTESTATION — the platform kinds of core's
/// [core.NativeAttestor] seam, and the one function that picks this build's.
///
/// 🔴 WHY. The platform Worker refuses every native sign-in, sign-up, reset and
/// resend that carries no attestation (wire protocol v1, `core`'s
/// `native_attest.dart`). What proves "a real install of a real app" differs by
/// platform, so the proof is platform code — and platform capabilities land in
/// THIS package (39-CHASSIS §2, `packageEarnReasons`), never in a new one:
///   · android — [PlayIntegrityAttestor]: a Play Integrity CLASSIC token whose
///     nonce is the request hash (android/…/NativeAttestHandler.kt);
///   · ios, macos — [AppAttestAttestor]: an App Attest key attested once at
///     install, then an assertion per op (ios/…/NativeAttestPlugin.swift);
///     where App Attest is unsupported (iOS 13, a simulator, macOS — which has
///     no native side in this package yet) the per-install Ed25519 key instead
///     ([AppAttestOrInstallKeyAttestor]);
///   · windows, linux — core's [core.InstallKeyAttestor].
///
/// Every platform failure is a [core.NativeAttestationException]: the sign-in
/// call fails, and the op is never sent without a proof.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/services.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// The one channel both native adapters answer on.
const MethodChannel nativeAttestChannel = MethodChannel(
  'nikatru/native_attest',
);

/// This build's attestor, or null where there is no native route (web; a
/// target with no callback). Pass the app's own secure store — the install key
/// and the App Attest key id live there.
///
/// [playCloudProjectNumber] is only for an android build distributed OUTSIDE
/// Google Play; a Play build's project is linked in the Play Console.
core.NativeAttestor? platformNativeAttestor({
  required core.SecureStore secureStore,
  int? playCloudProjectNumber,
  TargetPlatform? platform,
  bool isWeb = kIsWeb,
}) {
  if (isWeb) return null;
  switch (platform ?? defaultTargetPlatform) {
    case TargetPlatform.android:
      return PlayIntegrityAttestor(cloudProjectNumber: playCloudProjectNumber);
    case TargetPlatform.iOS:
    case TargetPlatform.macOS:
      return AppAttestOrInstallKeyAttestor(
        appAttest: AppAttestAttestor(store: secureStore),
        installKey: core.InstallKeyAttestor(store: secureStore),
      );
    case TargetPlatform.windows:
    case TargetPlatform.linux:
      return core.InstallKeyAttestor(store: secureStore);
    case TargetPlatform.fuchsia:
      return null;
  }
}

core.NativeAttestationException _channelFailure(String kind, Object error) =>
    core.NativeAttestationException(
      kind,
      error is PlatformException ? error.code : 'channel_failed',
      error is PlatformException ? error.message : '${error.runtimeType}',
    );

/// android: a Play Integrity CLASSIC token, nonce = the request hash. No
/// install step — Google vouches for the app and device on every op.
final class PlayIntegrityAttestor implements core.NativeAttestor {
  const PlayIntegrityAttestor({
    this.cloudProjectNumber,
    this.channel = nativeAttestChannel,
  });

  final int? cloudProjectNumber;
  final MethodChannel channel;

  @override
  String get kind => core.kNativeAttestKindPlayIntegrity;

  @override
  bool get needsInstall => false;

  @override
  Future<bool> isRegistered({required String app}) async => true;

  @override
  Future<core.NativeAttestInstall> register({
    required String app,
    required String challenge,
  }) => throw StateError('play-integrity has no install step');

  @override
  Future<void> markRegistered({required String app}) async {}

  @override
  Future<void> forget({required String app}) async {}

  @override
  Future<core.NativeAttestProof> prove({required String clientData}) async {
    final Map<Object?, Object?>? raw;
    try {
      raw = await channel.invokeMapMethod<Object?, Object?>(
        'playIntegrityToken',
        <String, Object?>{
          'nonce': core.nativeAttestRequestHash(clientData),
          'cloudProjectNumber': ?cloudProjectNumber,
        },
      );
    } on Object catch (e) {
      throw _channelFailure(kind, e);
    }
    final Object? token = raw?['token'];
    if (raw == null ||
        raw['error'] == true ||
        token is! String ||
        token.isEmpty) {
      final Object? code = raw?['code'];
      throw core.NativeAttestationException(
        kind,
        code is String ? code : 'no_token',
      );
    }
    return core.NativeAttestProof(kind: kind, proof: token);
  }
}

/// ios (and macos, once it has a native side): App Attest. The key is made in
/// the Secure Enclave on first use and its id kept in the secure store;
/// registration attests it over the clientData hash of op `install`, and each
/// op is an assertion over its own clientData hash.
///
/// The key header is Apple's keyId exactly as `DCAppAttestService` returns it
/// (standard base64); the proofs are base64url.
final class AppAttestAttestor implements core.NativeAttestor {
  AppAttestAttestor({
    required core.SecureStore store,
    this.channel = nativeAttestChannel,
  }) : _store = store;

  static const String keyIdStoreKey = 'nk.native_attest.app_attest.key_id';

  static String registeredStoreKey(String app) =>
      'nk.native_attest.app_attest.registered.$app';

  final core.SecureStore _store;
  final MethodChannel channel;
  String? _keyId;
  final Map<String, String> _registered = <String, String>{};

  @override
  String get kind => core.kNativeAttestKindAppAttest;

  @override
  bool get needsInstall => true;

  Future<String?> _read(String key) async {
    try {
      return await _store.read(key);
    } on Object {
      return null;
    }
  }

  Future<void> _write(String key, String value) async {
    try {
      await _store.write(key, value);
    } on Object {
      // Memory only for this run: the next run attests a new key.
    }
  }

  Future<void> _delete(String key) async {
    try {
      await _store.delete(key);
    } on Object {
      // Nothing persisted to drop.
    }
  }

  /// The stored key id, without making one.
  Future<String?> _existingKeyId() async =>
      _keyId ??= await _read(keyIdStoreKey);

  /// The key id, made on first use.
  Future<String> _currentKeyId() async {
    final String? existing = await _existingKeyId();
    if (existing != null && existing.isNotEmpty) return existing;
    final String? made;
    try {
      made = await channel.invokeMethod<String>('appAttestGenerateKey');
    } on Object catch (e) {
      throw _channelFailure(kind, e);
    }
    if (made == null || made.isEmpty) {
      throw core.NativeAttestationException(kind, 'no_key');
    }
    _keyId = made;
    await _write(keyIdStoreKey, made);
    return made;
  }

  /// Apple: after any attest failure but a busy server, "discard the key
  /// identifier and create a new key". Discarding on every failure costs one
  /// key generation at worst.
  Future<void> _discardKey() async {
    _keyId = null;
    _registered.clear();
    await _delete(keyIdStoreKey);
  }

  Future<Uint8List> _bytes(
    String method,
    String keyId,
    String clientData,
  ) async {
    final Object? answer;
    try {
      answer = await channel.invokeMethod<Object?>(method, <String, Object?>{
        'keyId': keyId,
        'clientDataHash': Uint8List.fromList(
          core.nativeAttestClientDataHash(clientData),
        ),
      });
    } on Object catch (e) {
      throw _channelFailure(kind, e);
    }
    if (answer is! Uint8List || answer.isEmpty) {
      throw core.NativeAttestationException(kind, 'no_bytes', method);
    }
    return answer;
  }

  @override
  Future<bool> isRegistered({required String app}) async {
    final String? keyId = await _existingKeyId();
    if (keyId == null || keyId.isEmpty) return false;
    if (_registered[app] == keyId) return true;
    return await _read(registeredStoreKey(app)) == keyId;
  }

  @override
  Future<core.NativeAttestInstall> register({
    required String app,
    required String challenge,
  }) async {
    final String keyId = await _currentKeyId();
    final List<int> body = utf8.encode(
      jsonEncode(<String, String>{
        'kind': core.kNativeAttestKindAppAttest,
        'key_id': keyId,
      }),
    );
    final String clientData = core.nativeAttestClientData(
      app: app,
      op: core.kNativeAttestInstallOp,
      challenge: challenge,
      body: body,
    );
    final Uint8List attestation;
    try {
      attestation = await _bytes('appAttestAttestKey', keyId, clientData);
    } on core.NativeAttestationException {
      await _discardKey();
      rethrow;
    }
    return core.NativeAttestInstall(
      kind: kind,
      body: body,
      proof: core.nativeAttestBase64Url(attestation),
    );
  }

  @override
  Future<void> markRegistered({required String app}) async {
    final String? keyId = await _existingKeyId();
    if (keyId == null) return;
    _registered[app] = keyId;
    await _write(registeredStoreKey(app), keyId);
  }

  @override
  Future<core.NativeAttestProof> prove({required String clientData}) async {
    final String keyId = await _currentKeyId();
    final Uint8List assertion = await _bytes(
      'appAttestAssert',
      keyId,
      clientData,
    );
    return core.NativeAttestProof(
      kind: kind,
      keyId: keyId,
      proof: core.nativeAttestBase64Url(assertion),
    );
  }

  /// The server has no key by this id: an attested key cannot be attested
  /// again, so the key goes too, and the next registration makes a new one.
  @override
  Future<void> forget({required String app}) async {
    await _delete(registeredStoreKey(app));
    await _discardKey();
  }
}

/// ios / macos: App Attest where `DCAppAttestService.isSupported`, else the
/// per-install key — the contract's own rule for a build where platform
/// attestation is unavailable. Chosen once, at first use; a platform with no
/// native side (MissingPluginException) is "unsupported".
final class AppAttestOrInstallKeyAttestor implements core.NativeAttestor {
  AppAttestOrInstallKeyAttestor({
    required this.appAttest,
    required this.installKey,
    this.channel = nativeAttestChannel,
  });

  final AppAttestAttestor appAttest;
  final core.InstallKeyAttestor installKey;
  final MethodChannel channel;
  Future<core.NativeAttestor>? _choice;
  core.NativeAttestor? _chosen;

  /// The attestor chosen, once [kind] has been decided by a first use.
  core.NativeAttestor? get chosen => _chosen;

  Future<core.NativeAttestor> get _pick => _choice ??= _choose();

  Future<core.NativeAttestor> _choose() async {
    bool supported;
    try {
      supported =
          await channel.invokeMethod<bool>('appAttestSupported') ?? false;
    } on Object {
      supported = false;
    }
    return _chosen = supported ? appAttest : installKey;
  }

  @override
  String get kind => _chosen?.kind ?? core.kNativeAttestKindAppAttest;

  @override
  bool get needsInstall => true;

  @override
  Future<bool> isRegistered({required String app}) async =>
      (await _pick).isRegistered(app: app);

  @override
  Future<core.NativeAttestInstall> register({
    required String app,
    required String challenge,
  }) async => (await _pick).register(app: app, challenge: challenge);

  @override
  Future<void> markRegistered({required String app}) async =>
      (await _pick).markRegistered(app: app);

  @override
  Future<core.NativeAttestProof> prove({required String clientData}) async =>
      (await _pick).prove(clientData: clientData);

  @override
  Future<void> forget({required String app}) async =>
      (await _pick).forget(app: app);
}
