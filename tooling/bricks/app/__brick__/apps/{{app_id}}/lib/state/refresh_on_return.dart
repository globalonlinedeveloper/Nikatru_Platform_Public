// ⏱ 2026-09-30 · ST-N6 — WHAT A RETURN TO THE APP RE-READS, and nothing else.
//
// WHEN is the chassis's: `RefreshOnResume` (packages/chassis_screens) fires
// this on every "back to the front" edge, throttled by core's `ResumeRefresh`.
// A stamped app adds its own server-backed lists here and nowhere else.
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'money_providers.dart';

/// Re-read what the server may have changed while the app was away.
///
/// The entitlement is INVALIDATED, not read: an app that sells nothing never
/// watches it, and a return must not be the thing that starts asking.
Future<void> refreshOnReturn(WidgetRef ref) async {
  ref.invalidate(entitlementsProvider);
}
