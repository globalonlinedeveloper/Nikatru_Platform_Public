import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// Proof that the CC BY 4.0 notice for the vendored Material Icons font
/// ACTUALLY REACHES `LicenseRegistry`.
///
/// 🔴 WHY THIS FILE IS LOAD-BEARING AND NOT CEREMONY.
/// `tooling/ci/assert-licence-register.mjs` discharges the attribution
/// obligation by checking that `attributedIn` names a **file that exists**
/// (`existsSync`). That is all it can check from outside Dart — so the register
/// row would stay green if this file were emptied to a no-op tomorrow, or if the
/// `addLicense` call were deleted while the file remained. **The guard proves a
/// path resolves; only this test proves the licence is served.** That gap is
/// exactly the "fail-closed seam with no proven open path" shape the corpus
/// keeps getting caught by, so the seam gets an executable open path here.
///
/// Each assertion below names the CC BY 4.0 clause it enforces. Deleting any one
/// of the six retentions from the notice turns a specific case red rather than
/// dropping coverage silently.
void main() {
  setUp(() {
    // Both resets matter and they are NOT the same thing. `LicenseRegistry` is
    // process-wide, and the latch inside the subject is module-global — so
    // without the second reset, every case after the first would exercise the
    // early-return path and assert on the FIRST case's registration. That is a
    // suite that passes while testing nothing after case one.
    LicenseRegistry.reset();
    debugResetVendoredAssetLicences();
  });

  Future<LicenseEntry> theEntry() async {
    registerVendoredAssetLicences();
    final List<LicenseEntry> found = await LicenseRegistry.licenses.toList();
    expect(
      found,
      hasLength(1),
      reason:
          'Expected exactly one entry from the vendored-asset collector. Zero '
          'means registerVendoredAssetLicences() no longer reaches '
          'LicenseRegistry.addLicense — in which case the asset register row '
          'points at a file that discharges nothing and the CC BY condition is '
          'unmet again, silently.',
    );
    return found.single;
  }

  String textOf(LicenseEntry e) =>
      e.paragraphs.map((LicenseParagraph p) => p.text).join('\n');

  test('THE FALSIFIER · nothing is registered until the call is made',
      () async {
    // If this fails, every assertion below is vacuous: the entry would be
    // arriving from somewhere else and this file would be measuring Flutter's
    // own collector rather than the subject.
    final List<LicenseEntry> before = await LicenseRegistry.licenses.toList();
    expect(
      before,
      isEmpty,
      reason:
          'LicenseRegistry already had entries BEFORE the subject ran, so a '
          'passing test below would not be evidence that the subject did '
          'anything. Check setUp ordering and LicenseRegistry.reset().',
    );
  });

  test('the entry is filed under the package name the register names',
      () async {
    final LicenseEntry e = await theEntry();
    expect(
      e.packages,
      contains('flutter-material-icons'),
      reason:
          'The package key must match the asset-register row id, or a reader '
          'cross-checking the register against the shipped LicensePage finds '
          'nothing under that name.',
    );
  });

  group('CC BY 4.0 §3(a)(1)(A) — the five retentions', () {
    test('(i) identification of the creator', () async {
      expect(textOf(await theEntry()), contains('Google'));
    });

    test('(ii) a copyright notice', () async {
      expect(textOf(await theEntry()), contains('Copyright'));
    });

    test('(iii) a notice referring to this Public License', () async {
      final String t = textOf(await theEntry());
      expect(t, contains('Creative Commons Attribution 4.0 International'));
      // §3(a)(2) lets a URI carry the required information; without it the
      // notice references a licence the reader cannot obtain.
      expect(t, contains('creativecommons.org/licenses/by/4.0/legalcode'));
    });

    test('(iv) a notice referring to the disclaimer of warranties', () async {
      final String t = textOf(await theEntry());
      expect(t, contains('DISCLAIMER'));
      expect(t, contains('as-is'));
    });

    test('(v) a URI to the Licensed Material', () async {
      expect(
        textOf(await theEntry()),
        contains('github.com/google/material-design-icons'),
      );
    });
  });

  test('§3(a)(1)(B) — the MODIFICATION is stated, because the font is subset',
      () async {
    // The half nobody was looking at. Tree-shaking rewrites the font
    // (1,645,184 -> 11,524 bytes measured), so this is an adaptation and the
    // duty to indicate modification is live ON TOP OF the five retentions.
    final String t = textOf(await theEntry());
    expect(t, contains('MODIFIED'));
    expect(
      t.toLowerCase(),
      anyOf(contains('subset'), contains('tree-shaken')),
      reason:
          'The notice must say HOW it was modified. "Modified" with no stated '
          'modification is not an indication, it is a hedge.',
    );
  });

  test('registration is IDEMPOTENT — a second call adds no duplicate',
      () async {
    registerVendoredAssetLicences();
    registerVendoredAssetLicences();
    registerVendoredAssetLicences();
    final List<LicenseEntry> found = await LicenseRegistry.licenses.toList();
    expect(
      found,
      hasLength(1),
      reason:
          'Three calls produced ${found.length} entries. The stamped chassis and '
          'the app can both call this; without the latch the LicensePage shows '
          'the same notice once per caller, which reads as a bug in the app.',
    );
    expect(vendoredAssetLicencesRegistered, isTrue);
  });
}
