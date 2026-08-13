import 'dart:async';

import 'package:flutter/foundation.dart';

/// Registers the licences of assets that ship in the bundle but that Flutter's
/// own NOTICES collector never sees.
///
/// ─────────────────────────────────────────────────────────────────────────────
/// 🔴 WHY THIS FILE EXISTS — A MEASURED, FACTORY-WIDE ATTRIBUTION BREACH
///
/// Flutter builds `assets/NOTICES` from the LICENSE files of Dart **packages**.
/// `MaterialIcons-Regular.otf` does not arrive as a package — it comes from the
/// **SDK artifact cache** (`bin/cache/artifacts/material_fonts/`, pinned by
/// `bin/internal/material_fonts.version`), which that collector never reads. So
/// the font ships and its licence does not, in **every app this factory stamps**.
///
/// Measured in Subly's shipped bundle on 2026-08-13 — `build/web/assets/NOTICES`,
/// 33,785 lines:
///   · `Attribution 4.0 International` → **0**
///   · `CC BY` → **0**
///   · `material-design-icons` / `materialicons` / `Material Icons` → **0**
/// Its single `creativecommons.org` hit is a CC0 zero-waive for the unrelated
/// W3C Ahem test font. The control case is in the same file: `cupertino_icons`
/// IS a pub package and its licence IS present.
///
/// ⚠️ THE LICENCE IS CC BY 4.0, NOT APACHE-2.0, and both readings were true of
/// different artefacts — which is why the corpus could hold them at once. The
/// `google/material-design-icons` repository is Apache-2.0; the font Flutter
/// actually **vendors** carries CC BY 4.0 (`materialicons_license.txt:1` in the
/// artifact cache reads *"Attribution 4.0 International"* verbatim). The
/// tie-breaker is not which repository is upstream but **which bytes are in the
/// bundle**.
///
/// ── WHY A NOTICE AND NOT THE FULL LEGALCODE ─────────────────────────────────
/// CC BY 4.0 **§3(a)(2)**: *"You may satisfy the conditions in Section 3(a)(1)
/// in any reasonable manner based on the medium, means, and context in which You
/// Share the Licensed Material. For example, it may be reasonable to satisfy the
/// conditions by providing a URI or hyperlink to a resource that includes the
/// required information."* So the five §3(a)(1)(A) retentions plus the
/// §3(a)(1)(B) modification indication, carried with a URI to the legalcode, is
/// a compliant discharge. Vendoring ~7,000 words of legalcode into every binary
/// is not required and is not what §3(a)(2) asks for.
///
/// 🔴 §3(a)(1)(B) IS OWED BECAUSE THE ASSET IS **ADAPTED**, measured: the shipped
/// `MaterialIcons-Regular.otf` is **11,524 B** against the vendored
/// **1,645,184 B** — 0.7%, i.e. tree-shaken to the glyphs actually used. That is
/// a modification, so *"indicate if You modified the Licensed Material"* applies
/// **on top of** the five retentions. It is stated explicitly below.
///
/// ── WHAT THIS DOES NOT COVER ────────────────────────────────────────────────
/// **Roboto** comes from the same `material_fonts/` artifact and is likewise
/// absent from NOTICES. It is NOT registered here because it is not a live
/// obligation: `FontManifest.json` ships neither Roboto nor a reference to it,
/// so no Roboto bytes are distributed. **If a future build ever ships Roboto,
/// this file is where its entry belongs** — and the asset register's row is what
/// should catch it.
///
/// ─────────────────────────────────────────────────────────────────────────────
/// Call this ONCE, early, from the app's `main()` — before `runApp`. It is
/// idempotent by [_registered] so a hot restart or a second call cannot stack
/// duplicate entries into `LicenseRegistry`, which would show the same notice
/// twice on the `LicensePage` every app's Settings offers.
void registerVendoredAssetLicences() {
  if (_registered) return;
  _registered = true;
  LicenseRegistry.addLicense(_vendoredFontLicences);
}

@visibleForTesting
bool get vendoredAssetLicencesRegistered => _registered;

/// Resets the idempotence latch. Tests only — a test that registers into the
/// process-wide [LicenseRegistry] and then asserts on a later registration
/// otherwise reads the FIRST test's state and passes for the wrong reason.
@visibleForTesting
void debugResetVendoredAssetLicences() {
  _registered = false;
}

bool _registered = false;

Stream<LicenseEntry> _vendoredFontLicences() async* {
  yield const LicenseEntryWithLineBreaks(
    <String>['flutter-material-icons'],
    // §3(a)(1)(A)(i) identification of the creator — the licence file Flutter
    // vendors names Google as the licensor of the icon font.
    'Material Icons font (MaterialIcons-Regular.otf)\n'
    'Copyright (c) Google Inc.\n'
    '\n'
    // §3(a)(1)(A)(iii) a notice referring to this Public License, with
    // §3(a)(2)'s URI to the resource carrying the required information.
    'Licensed under the Creative Commons Attribution 4.0 International '
    'License (CC BY 4.0).\n'
    'You may obtain a copy of the License at:\n'
    '    https://creativecommons.org/licenses/by/4.0/legalcode\n'
    '\n'
    // §3(a)(1)(A)(v) a URI to the Licensed Material.
    'Licensed Material:\n'
    '    https://github.com/google/material-design-icons\n'
    'The bytes distributed with this application are the icon font vendored by '
    'the Flutter SDK (bin/cache/artifacts/material_fonts/), which carries CC BY '
    '4.0. This is a different artefact from the upstream repository tree, which '
    'is published under Apache-2.0.\n'
    '\n'
    // §3(a)(1)(B) indicate if You modified the Licensed Material.
    'MODIFICATIONS: this font has been MODIFIED. It is subset ("tree-shaken") '
    'at build time to contain only the glyphs this application actually '
    'references. No other modification is made.\n'
    '\n'
    // §3(a)(1)(A)(iv) a notice referring to the disclaimer of warranties.
    'DISCLAIMER: Unless otherwise separately undertaken by the Licensor, to the '
    'extent possible, the Licensor offers the Licensed Material as-is and '
    'as-available, and makes no representations or warranties of any kind '
    'concerning the Licensed Material, whether express, implied, statutory or '
    'other. See Section 5 of the License for the full disclaimer of warranties '
    'and limitation of liability.\n',
  );
}
