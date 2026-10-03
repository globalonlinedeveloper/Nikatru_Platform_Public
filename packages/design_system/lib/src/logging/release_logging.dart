import 'package:flutter/foundation.dart';

/// [rv2-security-006, app half] `debugPrint` IS NOT A DEBUG-ONLY CALL. Flutter
/// keeps it in a release build, where it writes to the device log: logcat on
/// Android, the browser console on web, the unified log on Apple — readable by
/// anyone holding the device or the tab. Every app's first line silences it,
/// through this function: `bootstrapNikatru` (every stamped app) and the
/// flagship's own `main()` call it before anything else can log.
///
/// HERE, beside `registerVendoredAssetLicences`, because this package is the one
/// both boot paths already import: the chassis's `bootstrapNikatru` and an app's
/// own `main()`. A second chassis-screens import in an app's main.dart would
/// break the chassis-delegation resolver (one chassis path per app file).
///
/// [release] defaults to `kReleaseMode`, a compile-time constant, so a debug
/// or profile build keeps its logging. It is a parameter only so the property
/// test, which runs in debug mode, can drive the release branch; production
/// callers pass nothing. Pinned by `tooling/ci/assert-stamp-properties.mjs`
/// (property `release-silences-debugprint`).
void silenceDebugPrintInRelease({bool release = kReleaseMode}) {
  if (release) debugPrint = (String? message, {int? wrapWidth}) {};
}
