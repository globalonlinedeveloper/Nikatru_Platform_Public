import 'package:flutter/widgets.dart';
import 'package:nikatru_chassis_screens/auth/auth_error_text.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisL10nX;

/// The sentence an auth failure shows on THIS app's own auth screens — the
/// ONE shared mapper, `authErrorText`, bound to the chassis strings.
///
/// ⏱ 2026-09-24 — the mapper that lived beside this file as
/// `auth_error_text.dart` moved to `package:nikatru_chassis_screens`, so the
/// app's screens and every chassis view answer a failure with the same
/// function and the same strings. This is a call-through, not a copy: it
/// decides nothing.
///
/// 🔴 WHY THE SCREENS DO NOT IMPORT THE PACKAGE THEMSELVES — measured, not
/// preferred. `tooling/ci/chassis-delegation.mjs` reads a routed screen that
/// imports exactly one `package:nikatru_chassis_screens/…` path as a screen
/// whose body was EMPTIED into that path. Imported straight into
/// `login_screen`, `sign_up_screen`, `verify_email_screen` and
/// `reset_password_screen`, the mapper made all four read as delegated to a
/// file with no widget in it, and `assert-a11y-coverage` answered COVERAGE LOST
/// (exit 2) for each. They are not delegated: they call a function, and their
/// widgets are still judged where they are. So the one import lives here, in
/// a file no route builds, and `tooling/chassis-parity.json` records it.
String authErrorSentence(BuildContext context, Object e) =>
    authErrorText(context.chassisL10n, e);
