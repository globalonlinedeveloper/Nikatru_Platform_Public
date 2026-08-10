import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  group('AppSpacing — the page gutters', () {
    // 🪦 THE `pagePadding(WindowClass)` TABLE THIS GROUP USED TO ASSERT WENT
    // WITH THE FUNCTION on 2026-08-11 (the reasoning is at the tombstone in
    // app_spacing.dart). Four tests went with it, and losing them costs nothing
    // real: every one of them was a statement about a function no production
    // file could call, so none of them could ever have gone red for a reason a
    // user would feel.
    //
    // ⚠️ ONLY `gutterCompact` IS LOAD-BEARING TODAY — measured, not assumed: 5
    // consumer files (home, calendar, insights, budget, notifications) against
    // ZERO for the other two, which `pagePadding` was the sole reader of. Both
    // are still asserted, because the failure a token test exists to stop is a
    // published number changing VALUE while nothing reads it and then being
    // adopted at the new one.
    test('the named gutters hold their published values', () {
      expect(AppSpacing.gutterCompact, 18);
      expect(AppSpacing.gutterExpanded, 24);
      expect(AppSpacing.gutterLarge, 32);
    });
  });
}
