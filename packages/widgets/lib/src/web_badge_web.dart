import 'dart:js_interop';
import 'dart:js_interop_unsafe';

/// `navigator.setAppBadge(count)`, or `clearAppBadge()` at zero.
///
/// Feature-tested, never assumed: Firefox and a non-installed page have no
/// Badging API, and calling a missing member would throw into a sync.
Future<void> setAppBadge(int count) async {
  final JSObject navigator = globalContext['navigator']! as JSObject;
  if (!navigator.has('setAppBadge')) return;
  try {
    final JSAny? pending = count > 0
        ? navigator.callMethod('setAppBadge'.toJS, count.toJS)
        : navigator.callMethod('clearAppBadge'.toJS);
    if (pending.isA<JSPromise>()) await (pending! as JSPromise).toDart;
  } on Object {
    // A refused badge (no permission, not installed) is not an error.
  }
}
