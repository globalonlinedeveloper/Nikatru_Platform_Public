import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:flutter/semantics.dart';

// The one handle this process holds. Private, and reachable only through the
// two functions below, so no call site can drop it on the floor again.
SemanticsHandle? _heldHandle;

/// 🔴 THE WEB BUILD HAD NO ACCESSIBILITY TREE AT ALL, AND NOTHING WENT RED.
///
/// Flutter web does not build the semantics DOM until something asks for it.
/// The engine ships a hidden "Enable accessibility" placeholder button and only
/// starts emitting `aria-*` nodes once that button is activated — so a screen
/// reader landing on the served page finds a `<flt-glass-pane>` with a canvas
/// inside it and nothing else. Measured: the only occurrence of
/// `ensureSemantics` anywhere in this app's tree was a PROSE MENTION in a
/// comment at `lib/app.dart:449` describing what a widget TEST does. A comment
/// naming an API is not a call to it.
///
/// The reason this survived a guard sweep is worth recording, because it will
/// recur: `tooling/ci/assert-a11y-coverage.mjs` reports this app at full
/// coverage, and it is not wrong. It measures WIDGET semantics — that every
/// screen's controls carry labels — by walking the Dart tree. This defect is a
/// BINDING-LEVEL switch one layer below every widget: the labels are all
/// present and correct, and on web nothing ever asks the framework to compile
/// them into a tree. No widget test can see it either, because `flutter_test`
/// runs with semantics forced on whenever a `SemanticsHandle` is held by the
/// harness, which is exactly the state this function creates. The bug is
/// "production does not do what the test harness does for free".
///
/// [kIsWeb] is a compile-time constant, so the six non-web targets tree-shake
/// the call away entirely; they get their semantics tree from the platform
/// (TalkBack / VoiceOver / Narrator / Orca announce themselves and the engine
/// turns semantics on in response), which is why this is web-only and not a
/// blanket "always on". Forcing it on everywhere would keep the semantics tree
/// compiled on every frame on five platforms that had already asked for it
/// only when a reader was actually running.
///
/// 🔴 THE HANDLE IS OWNED HERE, AND FOR A REAL USER IT IS NEVER RELEASED.
/// `SemanticsBinding` counts outstanding handles and drops back to "collect
/// nothing" the moment the count reaches zero (`_didDisposeSemanticsHandle`),
/// so holding one for the process lifetime is the documented way to say "this
/// app always has a client interested in semantics". No app code path
/// releases it.
///
/// 🔬 UNTIL 2026-09-11 THE HANDLE WAS RETURNED, AND `main()` DISCARDED IT. That
/// kept semantics on for users and broke the nightly live suite on every run
/// after #591: `integration_test/app_test.dart` boots `app.main()` three times
/// in one process, flutter_test counts handles per test, and
/// `_verifySemanticsHandlesWereDisposed` (flutter_test widget_tester.dart:1074)
/// failed the first test with "A SemanticsHandle was active at the end of the
/// test." (e2e run 34453685391). A handle nobody holds is a handle nobody can
/// dispose, so the choice was to suppress that framework check — the one that
/// would catch a real leak — or to give the handle an owner. This is the owner:
///
///   · repeated calls hold ONE handle, not one per boot, so three `main()`
///     calls in one process cannot stack three;
///   · [releaseWebSemantics] hands it back, for a harness that boots `main()`
///     inside a test and nothing else.
///
/// Returns whether this process now holds the handle (always `false` off web).
///
/// [isWeb] and [binding] are injected so the two arms are decidable from a unit
/// test. Without them this would be one unreachable `if` guarded by a
/// compile-time constant that is `false` under `flutter test` — i.e. a line no
/// test in this repository could ever execute, which is the same as an
/// unproven line.
bool enableWebSemantics({bool isWeb = kIsWeb, SemanticsBinding? binding}) {
  if (!isWeb) return false;
  _heldHandle ??= (binding ?? SemanticsBinding.instance).ensureSemantics();
  return true;
}

/// Disposes the handle [enableWebSemantics] holds, if it holds one, so the
/// next call takes a fresh one.
///
/// ⛔ FOR A TEST HARNESS THAT BOOTS `main()`, AND NOTHING ELSE. Called from app
/// code it re-creates the defect [enableWebSemantics] exists to close: the
/// count drops to zero and the web build stops compiling a semantics tree.
/// flutter_test verifies handles right after a test body returns and BEFORE
/// any `tearDown`, so a harness calls this on the body's last line, beside its
/// `ErrorWidget.builder` restore.
@visibleForTesting
void releaseWebSemantics() {
  final SemanticsHandle? held = _heldHandle;
  _heldHandle = null;
  held?.dispose();
}
