// [pipeline K-15] · The WEB arm of the GPC seam, in a REAL browser.
//
// privacy_signal_test.dart proves the CONTRACT on the VM — but on the VM
// `navigator` does not exist, so the conditional import resolves to the io arm
// and every GPC-on case there is driven by `StaticPrivacySignal`, a double this
// repo wrote. The file that actually ships to web users,
// `privacy_signal_web.dart`, has no test that executes a single line of it.
// Two things are therefore asserted NOWHERE today:
//
//   1. ARM SELECTION. That a web build gets `WebPrivacySignal` at all is what
//      makes the seam live on web. A conditional import that silently fell back
//      to the stub would pass the entire existing suite while shipping a signal
//      that can never see GPC.
//   2. THE TRUTHY-STRING TRAP the web arm's own comment warns about
//      (privacy_signal_web.dart:34-37). In JS the string "false" is truthy, so a
//      coercing read opts a user OUT because their browser reported the
//      opposite. No Dart double can produce a JS string in a JSAny slot; only a
//      browser can.
//
// `@TestOn('browser')` keeps this out of the VM lane (`melos run test`);
// `dart test -p chrome` compiles it with dart2js and runs it against the real
// `navigator`.
@TestOn('browser')
library;

import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:nikatru_core/nikatru_core.dart';
// Same package, so this is not an implementation import across a package
// boundary. The type is deliberately not exported: nothing outside the seam
// should name it — but the arm-selection proof has to.
import 'package:nikatru_core/src/analytics/privacy_signal_web.dart'
    show WebPrivacySignal;
import 'package:test/test.dart';

@JS('navigator')
external JSObject get _navigator;

@JS('Object.defineProperty')
external void _defineProperty(
    JSObject target, JSString name, JSObject descriptor);

const String _prop = 'globalPrivacyControl';

/// Installs `navigator.globalPrivacyControl` as a **configurable** own property.
///
/// Chrome does not implement GPC, so the property is absent and has to be
/// planted. `configurable: true` is load-bearing: without it [_clearGpc] cannot
/// remove it again and every later case would inherit the previous case's
/// value — the absent-property case in particular would silently stop testing
/// absence.
void _setGpc(JSAny value) {
  final JSObject descriptor = JSObject();
  descriptor.setProperty('value'.toJS, value);
  descriptor.setProperty('configurable'.toJS, true.toJS);
  descriptor.setProperty('writable'.toJS, true.toJS);
  _defineProperty(_navigator, _prop.toJS, descriptor);
}

void _clearGpc() {
  if (_navigator.has(_prop)) _navigator.delete(_prop.toJS);
}

ConsentController _controller() => ConsentController(
      store: InMemoryKeyValueStore(),
      privacySignal: createPrivacySignal(),
    );

void main() {
  setUp(_clearGpc);
  tearDown(_clearGpc);

  group('[8]K-15 · GPC web arm, driven through the real navigator', () {
    test('property ABSENT ⇒ the WEB arm is selected and reports no opt-out',
        () {
      expect(_navigator.has(_prop), isFalse,
          reason: 'Chrome ships no GPC property; the fixture must start clean');
      final PrivacySignal signal = createPrivacySignal();
      // 🔴 THE ARM-SELECTION PROOF — the assertion nothing in this repo makes.
      expect(signal, isA<WebPrivacySignal>());
      expect(signal.optedOut, isFalse);
    });

    test('=== true ⇒ optedOut, statusOf DENIED, hydrate DENIED', () async {
      _setGpc(true.toJS);
      expect(createPrivacySignal().optedOut, isTrue);

      // The acceptance sentence, verbatim: "With
      // navigator.globalPrivacyControl === true (or Sec-GPC: 1), analytics
      // consent resolves to denied and no prompt is shown." "No prompt" is read
      // through the property a prompt is DRIVEN BY — a UI prompts while the
      // status is `unknown`, and a GPC user never sees `unknown`.
      final ConsentController c = _controller();
      expect(c.statusOf(ConsentPurpose.analytics), ConsentStatus.denied);
      expect(await c.hydrate(ConsentPurpose.analytics), ConsentStatus.denied);
      expect(
          c.statusOf(ConsentPurpose.analytics), isNot(ConsentStatus.unknown));
    });

    test('=== false ⇒ no signal, so the ordinary prompt still happens',
        () async {
      _setGpc(false.toJS);
      expect(createPrivacySignal().optedOut, isFalse);
      // A user whose browser explicitly says "not opted out" must still be
      // ASKED. Denying them would be the fail-CLOSED direction that
      // privacy_signal.dart rejects for this seam and only for this seam.
      final ConsentController c = _controller();
      expect(c.statusOf(ConsentPurpose.analytics), ConsentStatus.unknown);
      expect(await c.hydrate(ConsentPurpose.analytics), ConsentStatus.unknown);
    });

    test('= the STRING "false" ⇒ NOT opted out (the truthy-string trap)', () {
      // 🔴 THE CASE THIS FILE EXISTS FOR. `if (navigator.globalPrivacyControl)`
      // is TRUE for the string "false", so a coercing read opts the user out
      // because their browser said the opposite.
      _setGpc('false'.toJS);
      expect(createPrivacySignal().optedOut, isFalse);
    });

    test('= the STRING "true" ⇒ still NOT opted out — only the boolean counts',
        () {
      // The mirror of the case above: the read must not be string-matching
      // either. GPC's spec value is a boolean; anything else is not the signal.
      _setGpc('true'.toJS);
      expect(createPrivacySignal().optedOut, isFalse);
    });

    test('= 1 ⇒ NOT opted out — a number is not the spec value', () {
      _setGpc(1.toJS);
      expect(createPrivacySignal().optedOut, isFalse);
    });

    test('the property is read LIVE, so a mid-session toggle takes effect', () {
      final PrivacySignal signal = createPrivacySignal();
      expect(signal.optedOut, isFalse);
      _setGpc(true.toJS);
      // Same instance, re-read. A cached `false` would outlive the user turning
      // GPC on — which is exactly why privacy_signal.dart forbids caching.
      expect(signal.optedOut, isTrue);
      _clearGpc();
      expect(signal.optedOut, isFalse);
    });
  });
}
