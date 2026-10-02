// The web arm of web_page.dart.
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'web_page.dart' show kVersionReadGlobal;

@JS('location')
external _Location get _location;

extension type _Location(JSObject _) implements JSObject {
  external void reload();
}

void reloadPage() {
  try {
    _location.reload();
  } catch (_) {
    // Best-effort, like every other exit: the wall stays up and can be tapped again.
  }
}

void publishVersionRead(String? version) {
  try {
    globalContext.setProperty(kVersionReadGlobal.toJS, version?.toJS);
  } catch (_) {
    // A page that refuses the write leaves the smoke reading `undefined`, which it fails.
  }
}
