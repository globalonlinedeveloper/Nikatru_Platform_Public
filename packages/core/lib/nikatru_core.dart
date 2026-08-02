/// Core domain layer for NIKATRU apps: data models, Result/Failure and content
/// packs. Pure Dart — safe to depend on from any app or package.
library;

export 'src/analytics/analytics.dart';
export 'src/auth/account_deletion.dart';
export 'src/auth/auth_models.dart';
export 'src/auth/auth_repository.dart';
export 'src/analytics/analytics_recorder.dart';
export 'src/analytics/consent.dart';
export 'src/analytics/consent_transport.dart';
export 'src/analytics/ids.dart';
export 'src/content/content_pack.dart';
export 'src/content/content_pack_loader.dart';
export 'src/content/content_pack_source.dart';
export 'src/content/ed25519_pack_verifier.dart';
export 'src/content/pack_verifier.dart';
export 'src/cancellation_transport.dart';
export 'src/entitlement_cache.dart';
export 'src/entitlement_transport.dart';
export 'src/result.dart';
export 'src/config/app_config.dart';
export 'src/config/config_loader.dart';
export 'src/config/default_configs.dart';
export 'src/config/flag_resolver.dart';
export 'src/config/observed_feature_flags.dart';
export 'src/config/version_gate.dart';
export 'src/models/entitlement.dart';
export 'src/notifications/notification_service.dart';
export 'src/review/review_gate.dart';
export 'src/review/review_prompter.dart';
export 'src/storage/key_value_store.dart';
export 'src/storage/secure_store.dart';
