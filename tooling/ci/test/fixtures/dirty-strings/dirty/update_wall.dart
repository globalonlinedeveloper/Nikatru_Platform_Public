// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE — DIRTY ON PURPOSE. DO NOT "FIX" THE STRINGS IN THIS FILE.
//
// The DEFAULTED-COPY-PARAMETER family's evidence, in its own file for the same
// reason `entry_tile.dart` is: each family has to show its own hits, because a
// total floor cannot see one matcher die.
//
// 🔴 THIS FAMILY EXISTS BECAUSE THE OTHER TWO WALKED PAST A REAL DEFECT.
// `ForceUpdateGate` in packages/design_system defaulted its three sentences to
// English. A default is not inside a `Text(` call and is not a `label:`
// argument, so neither matcher could see it — and BOTH production call sites
// passed no copy at all, which meant those defaults were the only words any
// stamped app ever shipped. The screen replaces the whole app and cannot be
// dismissed, and no arb key for it had ever existed in either tree. Measured and
// fixed 2026-09-04; this file is the shape that must never come back.
//
// The class below is a deliberate reconstruction of the pre-fix widget.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';

/// A blocking wall whose copy a caller can simply forget to supply.
class FixtureUpdateWall extends StatelessWidget {
  const FixtureUpdateWall({
    super.key,
    required this.mustUpdate,
    required this.child,
    this.title = 'Update required',
    this.message =
        'This version is no longer supported. Please update to keep using the app.',
    this.buttonLabel = 'Update now',
    this.dismissLabel = 'Not now',
  });

  final bool mustUpdate;
  final Widget child;
  final String title;
  final String message;
  final String buttonLabel;
  final String dismissLabel;

  @override
  Widget build(BuildContext context) => mustUpdate ? const Placeholder() : child;
}
