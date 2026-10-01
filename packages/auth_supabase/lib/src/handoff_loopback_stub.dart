/// ⏱ 2026-10-01 · The loopback return of the system-browser hand-off, where
/// there is no `dart:io` (web). A web build signs in in its own page and never
/// hands off, so asking for a loopback there is a programming error.
library;

import 'browser_handoff_client.dart';

/// Unsupported without `dart:io`.
Future<HandoffReturn> openHandoffLoopback() =>
    throw UnsupportedError('The browser hand-off loopback needs dart:io');
