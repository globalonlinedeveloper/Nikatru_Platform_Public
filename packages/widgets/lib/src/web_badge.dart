// The Badging API on web, a no-op everywhere else. Conditional so a native
// build never compiles `dart:js_interop`'s browser surface.
export 'web_badge_stub.dart' if (dart.library.js_interop) 'web_badge_web.dart';
