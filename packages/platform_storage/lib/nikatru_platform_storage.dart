/// Plugin-backed implementations of the NIKATRU core storage seams
/// (`KeyValueStore`, `SecureStore`) for all six platforms. Inject these in the
/// app/brick layer so `packages/core` stays pure Dart (ADR 005).
library;

export 'src/asset_content_pack_source.dart';
export 'src/export_capabilities.dart';
export 'src/selector_file_importer.dart';
export 'src/share_plus_file_exporter.dart';
export 'src/storage_capabilities.dart';
export 'src/review_capabilities.dart';
export 'src/in_app_review_prompter.dart';
export 'src/flutter_secure_store.dart';
// ⏱ 2026-09-29 · native sign-in attestation: this build's proof of install.
export 'src/device_integrity_probe.dart';
export 'src/native_attestors.dart';
export 'src/prefs_key_value_store.dart';
