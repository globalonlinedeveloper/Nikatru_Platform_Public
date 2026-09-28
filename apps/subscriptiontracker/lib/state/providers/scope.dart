// SECTION 0 of the spine — the root `ProviderScope`, and the provider POLICY it
// sets for the whole app. Re-exported from `../providers.dart`.

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

/// The app's root [ProviderScope]. `main.dart` builds its scope through this,
/// so the policy is set in ONE place — and outside `main.dart`, which is a
/// private copy of the chassis entry point whose size
/// `tooling/ci/assert-chassis-parity.mjs` holds to a ceiling that only falls.
Widget rootProviderScope({
  required List<Override> overrides,
  required Widget child,
}) => ProviderScope(retry: noProviderRetry, overrides: overrides, child: child);

/// No automatic retry: the root scope's policy.
///
/// Riverpod 3 retries a failing provider by default (exponential backoff, ten
/// attempts over ~38 s) and holds its `future` in loading meanwhile. Off,
/// deliberately: every failure path in this app already has its own answer (a
/// retry button, a fallback, a sign-in), and a silent retry would hold an error
/// screen in "loading" and double every failing network call. A test container
/// that stands in for the app's root takes the same policy.
Duration? noProviderRetry(int retryCount, Object error) => null;
