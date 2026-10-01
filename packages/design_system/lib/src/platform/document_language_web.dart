// The web arm of `document_language.dart`.
import 'dart:js_interop';

@JS('document.documentElement')
external _Root? get _root;

extension type _Root(JSObject _) implements JSObject {
  external String get lang;
  external set lang(String value);
}

void setDocumentLanguage(String languageTag) {
  if (languageTag.isEmpty) return;
  try {
    final _Root? root = _root;
    if (root != null && root.lang != languageTag) root.lang = languageTag;
  } catch (_) {
    // A page with no document element has nothing to label.
  }
}
