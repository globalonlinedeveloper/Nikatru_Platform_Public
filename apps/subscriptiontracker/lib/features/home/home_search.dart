// The shell → Home search request — SH-02. `AppShell` binds / and Ctrl/⌘+F
// (`AppScaffold.onSearch`) and N (`onPrimaryAction`); the search FIELD belongs
// to Home's `ListControls`, two widgets down a different branch. A counter the
// shell bumps and Home listens to is the whole wire: no global key, no focus
// node shared across routes.
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Bumped once per "focus the search" request.
class HomeSearchRequest extends Notifier<int> {
  @override
  int build() => 0;

  /// Asks Home to focus its search field.
  void request() => state++;
}

/// See [HomeSearchRequest].
final NotifierProvider<HomeSearchRequest, int> homeSearchRequestProvider =
    NotifierProvider<HomeSearchRequest, int>(HomeSearchRequest.new);
