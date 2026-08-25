import 'package:flutter/material.dart';

/// The semantic role a [FocusableTap] announces.
///
/// Two values rather than a bag of booleans because they are mutually
/// exclusive: a control is a button or it is a link, and `Semantics` treats
/// them as different node kinds. The distinction is the one a person wants
/// BEFORE activating something — "link" warns you that you are about to leave
/// the app — and `apps/subly`'s legal footer already made that call by hand.
enum TapRole {
  /// Does something here. `Semantics(button: true)`.
  button,

  /// Leaves the app. `Semantics(link: true)`.
  link,
}

/// A TAP TARGET A KEYBOARD CAN REACH — the primitive `Semantics(button: true)`
/// + `GestureDetector` was always missing.
///
/// ── WHY THIS EXISTS, MEASURED ───────────────────────────────────────────────
/// `tooling/dod-register.json`'s `insideTheClaim` row records SC 2.1.1 Keyboard
/// (Level A) as MEASURED AND FAILING on `apps/subly`, and the measurement points
/// at ONE cause rather than 25: every keyboard-dead control in that app is a
/// hand-rolled `Semantics(button: true)` wrapped round a `GestureDetector`.
/// `Semantics(button: true)` tells a SCREEN READER what a thing is. It creates
/// no [FocusNode], so it does nothing whatever for a KEYBOARD, and the two
/// defects have been mistaken for one another before. The controls that DID
/// traverse were the ones that happened to be built on a Material `InkWell` or
/// `ListTile` — i.e. the ones that inherited a focus node from a primitive
/// somebody else wrote.
///
/// 🔴 SO THE FIX BELONGS HERE AND NOWHERE ELSE. Doing it at each call site is
/// doing it 50 times in stamped apps and getting it wrong in at least one of
/// them; the register's own `why` says so. A control built on this widget cannot
/// be added keyboard-dead, because the focus node is not something the caller
/// remembers to pass — it is the thing the widget IS.
///
/// ── WHAT IT ACTUALLY ADDS, AND WHY EACH PART IS LOAD-BEARING ────────────────
/// · A real [FocusNode], via [FocusableActionDetector], so `Tab` can land on it.
/// · `ActivateIntent` **and** `ButtonActivateIntent` bound to [onTap].
///   BOTH, deliberately: `WidgetsApp`'s default shortcut map sends Space as
///   `ActivateIntent` and Enter as `ButtonActivateIntent`, so binding one leaves
///   the control reachable and half-inoperable — focusable, and silent on one of
///   the two keys every keyboard user tries. Material's own `InkWell` registers
///   the same pair for the same reason.
/// · A focus ring, painted as a FOREGROUND decoration.
///   🔴 [DecorationPosition.foreground] on a [DecoratedBox] rather than a
///   [Stack] or a [Container] border, because this widget wraps controls whose
///   sizes are already pinned by `a11y_semantics_test.dart` and
///   `chassis_properties_test.dart` at a 48 px floor. `DecoratedBox` passes its
///   constraints through unchanged and paints over the child, so wrapping a
///   control in this cannot move a single pixel of layout. A border that
///   participated in layout would shrink the very tap targets another suite
///   pins — trading a Level A failure for a different one.
/// · The [Semantics] annotation the call site used to write itself, so migrating
///   a control is a substitution rather than a rewrite and nothing about what a
///   screen reader hears changes.
///
/// ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
/// It does NOT request focus on tap. Material's `InkWell` does; SC 2.1.1 does
/// not ask for it, and a pointer user who suddenly acquires a focus ring by
/// touching something is a change to live behaviour that this widget has no
/// mandate to make. The ring answers `onFocusChange` — i.e. it appears exactly
/// when something has focus — rather than `onShowFocusHighlight`, whose
/// traditional/touch highlight mode is a global that a test can only set by
/// side effect and that a real user changes by picking up a mouse.
///
/// ⚠️ THE RING IS NOT A CONFORMANCE CLAIM FOR SC 2.4.7 OR SC 2.4.11. What
/// `focusable_tap_test.dart` asserts is that the focused state paints something
/// the unfocused state does not, and that is all it asserts: no contrast ratio
/// against any of the grounds this widget can be dropped on has been measured,
/// and the register carries no row for either criterion. The ring is here
/// because making 23 controls focusable with no visible indication of where
/// focus went would trade one Level A failure for a Level AA one, not because
/// anybody has measured it.
class FocusableTap extends StatefulWidget {
  const FocusableTap({
    super.key,
    required this.child,
    required this.onTap,
    this.role = TapRole.button,
    this.label,
    this.toggled,
    this.selected,
    this.mergeDescendants = true,
    this.behavior = HitTestBehavior.opaque,
    this.borderRadius = const BorderRadius.all(Radius.circular(12)),
    this.focusColor,
    this.focusNode,
  });

  /// What the control looks like. Untouched — this widget adds no padding, no
  /// constraint and no colour of its own.
  final Widget child;

  /// The action, for pointer AND keyboard alike.
  ///
  /// 🔴 `null` MEANS INERT, AND INERT MEANS UNFOCUSABLE. `_LinkRow` in
  /// `apps/subly` renders rows that are deliberately dead until their feature is
  /// wired ("Connected accounts", "Export data (CSV)"), and its own comment
  /// records why `button:` is conditional there: announcing a role for a row
  /// that does nothing sends somebody tapping at a dead surface and blaming
  /// their reader. A focus stop on the same row is the same lie one sense over —
  /// so [onTap] `== null` drops the role AND the focus node together.
  final VoidCallback? onTap;

  /// Button or link. See [TapRole].
  final TapRole role;

  /// What a screen reader calls this control, when the control's own painted
  /// content is not its name (an icon, an account initial, a bare switch).
  /// `null` leaves the merged descendant text to speak for itself, which is what
  /// every prose control in `apps/subly` already relies on.
  final String? label;

  /// `Semantics(toggled:)` — for a control that is a switch.
  final bool? toggled;

  /// `Semantics(selected:)` — for one chip of a set of which exactly one is on.
  final bool? selected;

  /// Wrap in [MergeSemantics], so a label and its subtitle arrive as ONE stop
  /// rather than two. Default true because that is what the migrated call sites
  /// did by hand; the icon-only controls pass false.
  final bool mergeDescendants;

  /// Pointer hit-test behaviour, passed straight to the inner
  /// [GestureDetector]. `opaque` by default: the controls this replaces set it
  /// so the whole band is the target rather than the glyphs.
  final HitTestBehavior behavior;

  /// The focus ring's corner radius. Matched to the control it wraps by the
  /// caller — a ring squared off round a pill reads as a rendering fault.
  final BorderRadius borderRadius;

  /// Overrides the ring colour for a control sitting on a ground the theme's
  /// primary does not survive (a brand gradient, a dark hero).
  final Color? focusColor;

  /// An externally owned node, for a caller that needs to drive focus itself.
  /// When null this widget owns one, which is the point of the widget.
  final FocusNode? focusNode;

  @override
  State<FocusableTap> createState() => _FocusableTapState();
}

class _FocusableTapState extends State<FocusableTap> {
  bool _focused = false;

  /// The action map is built once and reused, not rebuilt per frame: it closes
  /// over `widget.onTap` through the element, so a changed callback is picked up
  /// without the map identity churning.
  late final Map<Type, Action<Intent>> _actions = <Type, Action<Intent>>{
    ActivateIntent: CallbackAction<ActivateIntent>(
      onInvoke: (ActivateIntent _) => _activate(),
    ),
    ButtonActivateIntent: CallbackAction<ButtonActivateIntent>(
      onInvoke: (ButtonActivateIntent _) => _activate(),
    ),
  };

  Object? _activate() {
    widget.onTap?.call();
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final bool enabled = widget.onTap != null;
    final Color ring =
        widget.focusColor ?? Theme.of(context).colorScheme.primary;

    Widget result = GestureDetector(
      behavior: widget.behavior,
      onTap: widget.onTap,
      child: widget.child,
    );

    result = DecoratedBox(
      position: DecorationPosition.foreground,
      decoration: _focused && enabled
          ? BoxDecoration(
              borderRadius: widget.borderRadius,
              border: Border.all(color: ring, width: 2),
            )
          : const BoxDecoration(),
      child: result,
    );

    result = FocusableActionDetector(
      enabled: enabled,
      focusNode: widget.focusNode,
      actions: _actions,
      onFocusChange: (bool has) {
        if (has != _focused) setState(() => _focused = has);
      },
      child: result,
    );

    result = Semantics(
      button: enabled && widget.role == TapRole.button,
      link: enabled && widget.role == TapRole.link,
      label: widget.label,
      toggled: widget.toggled,
      selected: widget.selected,
      child: result,
    );

    return widget.mergeDescendants ? MergeSemantics(child: result) : result;
  }
}
