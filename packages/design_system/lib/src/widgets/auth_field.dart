import 'package:flutter/material.dart';

import '../theme/form_tones.dart';
import '../tokens/app_text.dart';

/// One labelled field on a hand-painted form — and the label reaches a SCREEN
/// READER, which it did not.
///
/// MOVED HERE FROM `apps/subly/lib/features/auth/login_screen.dart` on
/// 2026-09-04 ([ADR 065], chassis step 2), where it was the private `_field`
/// helper of a single screen. Nothing in it is app-specific: it paints a
/// caption, a box and the semantics that tie them together. The reason it had
/// to move is measured, not stylistic — **the app brick had none of it.** On
/// 2026-09-04, against `tooling/bricks/app/__brick__/…/features/auth/`:
/// `grep -c "textInputAction"` → 0, `grep -c "FocusNode"` → 0,
/// `grep -c "MergeSemantics"` → 0. Every app the factory stamps was born with
/// two `TextField`s carrying `labelText` and nothing else, so every one of the
/// findings below shipped again with it.
///
/// 🔴 THE FIELDS ON A FORM LIKE THIS HAVE NO NAME AS SOON AS SOMEBODY TYPES IN
/// THEM, and the empty form is exactly the state that hides it. The name is
/// painted as a separate `Text` ABOVE the box rather than through
/// `InputDecoration.labelText`, so nothing tied the two together: the only
/// string in the field's own semantics was `hintText`, and Flutter fades the
/// hint out — semantics and all, `AnimatedOpacity` excludes a fully
/// transparent child — the moment the field has content. So a reader heard
/// "you@email.com, text field" on arrival and, one character later, a text
/// field announced as NOTHING. Both boxes, on the first screen every
/// signed-out user sees, and the password box is the one where "which box am
/// I in" cannot be answered by listening to the value.
///
/// Measured by `apps/subly/test/a11y_semantics_test.dart`'s naked-controls
/// sweep, which reported two «» NO NAME nodes once the case typed into them —
/// and passed on the pristine form, which is why the typed-in case exists.
///
/// ⚠️ FIXED WITH `MergeSemantics`, NOT WITH `labelText`. Moving the name into
/// the decoration would repaint the box with a floating Material label, and
/// apps/subly is the frozen legacy rail-prover the owner eyeballs. This
/// changes no pixels: the visible capitals are excluded from the tree (a
/// layout compromise has no business in the audio channel — the same rule the
/// calendar's narrow weekday letters are held to) and the sentence-case word
/// is annotated onto the field, where the merge makes label, role, value and
/// tap action ONE node instead of a caption a reader meets on a separate
/// swipe and can just as easily meet afterwards.
///
/// ⚠️ THE KEYBOARD PARAMETERS ARE PASSED IN, NOT DEFAULTED HERE. One widget
/// paints both boxes on a sign-in form, and the two want opposite answers — the
/// email box advances, the password box submits — so a default on this widget
/// would be right for one caller and silently wrong for the other. They are
/// also exactly what `apps/subly/test/login_chassis_parity_test.dart` reads off
/// the `TextField`, so dropping one at a call site goes red rather than merely
/// un-autofilling the live form, which is how they were missing in the first
/// place.
///
/// 🔴 [label] AND [hint] ARE REQUIRED STRINGS WITH NO ENGLISH DEFAULT, AND THAT
/// IS A COVERAGE DECISION RATHER THAN AN API PREFERENCE.
/// `tooling/ci/assert-no-hardcoded-strings.mjs` scans exactly two roots — the
/// brick and `apps/subly/lib` (`:120-131`) — and does **not** scan `packages/`.
/// A default sentence living here would therefore be a user-visible string that
/// left the guard's domain by moving house: the literal would still ship, and
/// the check that exists to catch it would go quiet rather than red. Every
/// string this widget paints is handed in by a caller inside a scanned root, so
/// the move costs no enforcement at all. [hint] is nullable because a form may
/// legitimately have none; it is never defaulted to English.
class AuthField extends StatelessWidget {
  const AuthField({
    required this.label,
    required this.controller,
    required this.keyboardType,
    super.key,
    this.obscure = false,
    this.fieldKey,
    this.hint,
    this.focusNode,
    this.autofillHints,
    this.textInputAction,
    this.onSubmitted,
  });

  /// The field's name, in SENTENCE case. Painted in capitals and announced as
  /// given — see the note on the capitals below.
  final String label;

  final TextEditingController controller;
  final TextInputType keyboardType;
  final bool obscure;

  /// Goes on the inner `TextField`, NOT on this widget.
  ///
  /// 🔴 THE DISTINCTION IS LOAD-BEARING AND A TEST DEPENDS ON IT.
  /// `login_chassis_parity_test.dart:425` does
  /// `tester.widget<TextField>(find.byKey(key))` — it reads `autofillHints`,
  /// `textInputAction` and `focusNode` off the framework widget itself. Putting
  /// the key on this wrapper instead would make that lookup throw a type error
  /// rather than fail an assertion, and the E2E legs that drive
  /// `E2EKeys.login*` would stop resolving. `super.key` stays available for a
  /// caller that wants to key the wrapper as well.
  final Key? fieldKey;

  /// Placeholder copy. Null renders no hint; it is never defaulted to English.
  final String? hint;

  final FocusNode? focusNode;
  final List<String>? autofillHints;
  final TextInputAction? textInputAction;

  /// `ValueChanged<String>` at the framework, `VoidCallback` here: the
  /// submitted text is already in [controller], and taking it as an argument
  /// would invite a second, staler source of truth for what the caller reads.
  final VoidCallback? onSubmitted;

  @override
  Widget build(BuildContext context) {
    final FormTones t = formTones(context);
    return MergeSemantics(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          // The label is PUT INTO CAPITALS BY THE LAYOUT, not by a second arb
          // key shouting in the file. A translator should never have to decide
          // whether Tamil has an upper case (it does not — `toUpperCase()` is a
          // no-op on Tamil script, which is the correct rendering, and it would
          // be frozen wrong if the capitals lived in the value).
          //
          // ⚠️ AND THE CAPITALS ARE EXCLUDED FROM THE SEMANTICS TREE. The same
          // word, in sentence case, is what the field ANNOUNCES below; a reader
          // handed "E-M-A-I-L" is handed a layout compromise read out one
          // letter at a time.
          ExcludeSemantics(
            child: Text(
              label.toUpperCase(),
              style: AppText.label.copyWith(color: t.muted),
            ),
          ),
          const SizedBox(height: 7),
          Semantics(
            label: label,
            child: TextField(
              key: fieldKey,
              controller: controller,
              focusNode: focusNode,
              obscureText: obscure,
              keyboardType: keyboardType,
              autofillHints: autofillHints,
              textInputAction: textInputAction,
              onSubmitted: onSubmitted == null
                  ? null
                  : (String _) => onSubmitted!(),
              style: AppText.body.copyWith(
                fontWeight: FontWeight.w600,
                color: t.ink,
              ),
              decoration: InputDecoration(
                hintText: hint,
                hintStyle: AppText.muted.copyWith(
                  fontWeight: FontWeight.w500,
                  color: t.muted,
                ),
                filled: true,
                fillColor: t.surface,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 15,
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide(color: t.line),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                  borderSide: BorderSide(color: t.accent, width: 1.5),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
