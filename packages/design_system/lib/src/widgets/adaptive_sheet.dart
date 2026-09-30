import 'package:flutter/material.dart';

import 'app_scaffold.dart' show AppBreakpoints, WindowClass, windowClassFor;

/// Opens [builder] as a BOTTOM SHEET on a compact window and as a CENTRED
/// DIALOG, at most [maxWidth] wide, on every wider one — the one editing
/// surface every stamped app needs (canvas v2 `BudgetEditor` on a phone, the
/// `DesktopAddDialog` pattern from 600 dp up).
///
/// 🔴 A SHEET STRETCHED ACROSS A DESKTOP IS NOT A SHEET, IT IS A BANNER. A
/// full-width bottom sheet at 1440 puts a 1440-wide form at the bottom edge of
/// the window with its fields 1300 px from the pointer that opened it. The
/// window class, not the platform, decides: a phone-sized browser window gets
/// the sheet, a tablet in landscape gets the dialog.
///
/// Both arms are MODAL ROUTES, so what the platform owns comes for free and is
/// not re-implemented here: Esc and the system back dismiss either one, the
/// barrier is a dismiss target, and when the route pops the framework returns
/// focus to the control that opened it. The sheet arm pads for the on-screen
/// keyboard, which a bottom sheet does not do by itself; the builder's content
/// is expected to scroll.
///
/// Both push onto the ROOT navigator: an editor opened from a shell tab covers
/// the navigation bar rather than sitting under it.
Future<T?> showAdaptiveSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  double maxWidth = AppBreakpoints.medium,
}) {
  final WindowClass windowClass = windowClassFor(
    MediaQuery.sizeOf(context).width,
  );
  if (windowClass == WindowClass.compact) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      useRootNavigator: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (BuildContext sheetContext) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
        ),
        child: builder(sheetContext),
      ),
    );
  }
  return showDialog<T>(
    context: context,
    useRootNavigator: true,
    builder: (BuildContext dialogContext) => Dialog(
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: builder(dialogContext),
      ),
    ),
  );
}
