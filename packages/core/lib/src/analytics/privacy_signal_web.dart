// [pipeline K-15] — the Web arm of the conditional import.
//
// Reads `navigator.globalPrivacyControl`. The property is absent in browsers
// that do not implement GPC and in those where the user has not enabled it, so
// the read must tolerate `undefined` rather than assume a boolean.
//
// The matching `Sec-GPC: 1` request header is the SERVER-side half of the same
// signal and is not readable from the page — a client cannot see its own
// request headers. Honouring it server-side is a separate concern and is not
// claimed here.
import 'dart:js_interop';

import 'privacy_signal.dart';

@JS('navigator')
external _Navigator? get _navigator;

@JS()
@staticInterop
class _Navigator {}

extension on _Navigator {
  external JSAny? get globalPrivacyControl;
}

class WebPrivacySignal implements PrivacySignal {
  const WebPrivacySignal();

  @override
  bool get optedOut {
    try {
      final JSAny? raw = _navigator?.globalPrivacyControl;
      if (raw == null) return false;
      // 🔴 ONLY the boolean `true` counts. GPC's spec value is a boolean, and
      // the string "false" is truthy in JS — coercing here would opt a user out
      // because their browser reported the opposite.
      final bool? asBool = raw.dartify() as bool?;
      return asBool ?? false;
    } catch (_) {
      // Fail-OPEN: unreadable means "no signal", which falls through to the
      // ordinary prompt and asks the user. See privacy_signal.dart for why this
      // direction is right here and wrong for the consent seam itself.
      return false;
    }
  }
}

PrivacySignal createPrivacySignal() => const WebPrivacySignal();
