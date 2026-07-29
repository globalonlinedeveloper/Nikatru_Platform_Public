/// Plugin-backed implementations of the NIKATRU core storage seams
/// (`KeyValueStore`, `SecureStore`) for all six platforms. Inject these in the
/// app/brick layer so `packages/core` stays pure Dart (ADR 005).
library;

export 'src/storage_capabilities.dart';
export 'src/review_capabilities.dart';
export 'src/in_app_review_prompter.dart';
export 'src/flutter_secure_store.dart';
export 'src/prefs_key_value_store.dart';
