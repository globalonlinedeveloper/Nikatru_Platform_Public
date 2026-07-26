import 'app_config.dart';

/// Compiled-in fallback configs, keyed by `app_id`, so an app resolves config
/// even when the config host is unreachable.
///
/// 🔒 **DELIBERATELY EMPTY, and it must stay that way. [pipeline C-10]**
///
/// This map used to carry a hardcoded `'subly'` entry — an app-specific value in
/// the shared core, exported from the barrel that *every* stamped app imports.
/// That is the "clone tell" the chassis charter exists to prevent: core must not
/// know the name of any app, or app #7 inherits app #1's vocabulary.
///
/// **Each app seeds its OWN default** at wiring time instead:
/// ```dart
/// ConfigLoader(
///   transport: ...,
///   cache: ConfigCache(seed: <String, AppConfig>{AppConfig.appId: kMyAppDefault}),
/// )
/// ```
/// The brick template has always done this (`kAppDefaultConfig` in its
/// `providers.dart`); `apps/subly` now does too (`kSublyDefaultConfig`), and the
/// server-contract test that pinned these values moved there with them.
///
/// The MECHANISM is kept rather than deleted: `ConfigCache.get` still falls
/// through to here, so a future portfolio-wide default has somewhere to live.
/// What is gone is any specific app's name.
const Map<String, AppConfig> kDefaultConfigs = <String, AppConfig>{};

/// The compiled-in fallback for [appId], or null when the app seeds its own
/// default — which is now every app (see [kDefaultConfigs]).
///
/// A null result is NOT an error: it means "the app's own seed answers this".
/// Callers that treat null as fatal must supply a seed to `ConfigCache`.
AppConfig? defaultConfigFor(String appId) => kDefaultConfigs[appId];
