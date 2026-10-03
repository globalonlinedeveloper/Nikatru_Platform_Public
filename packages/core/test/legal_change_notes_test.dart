import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ⏱ 2026-10-01 · EN-23 — which notes the re-acceptance screen shows.
void main() {
  const LegalVersions accepted = LegalVersions(
    terms: '2026-09-25',
    privacy: '2026-09-26',
  );
  const LegalVersions bumped = LegalVersions(
    terms: '2026-10-01',
    privacy: '2026-09-26',
  );

  const LegalChangeNote termsNote = LegalChangeNote(
    document: LegalDocument.terms,
    version: '2026-10-01',
    date: '2026-10-01',
    lines: <String>['one', 'two', 'three', 'four'],
  );

  test('a stamp reads back into its versions', () {
    final LegalVersions? v = legalVersionsOfStamp(accepted.stamp);
    expect(v?.terms, '2026-09-25');
    expect(v?.privacy, '2026-09-26');
    expect(legalVersionsOfStamp(null), isNull);
    expect(legalVersionsOfStamp('garbage'), isNull);
  });

  test('only the documents that moved are changed', () {
    expect(
      changedLegalDocuments(acceptedStamp: accepted.stamp, current: bumped),
      <LegalDocument>[LegalDocument.terms],
    );
    expect(
      changedLegalDocuments(acceptedStamp: null, current: bumped),
      LegalDocument.values,
    );
  });

  test('🔴 a version bump renders ITS note, three lines at most', () {
    final List<LegalChangeNote> notes = legalChangesSince(
      acceptedStamp: accepted.stamp,
      current: bumped,
      register: const <LegalChangeNote>[termsNote],
    );
    expect(notes, hasLength(1));
    expect(notes.single.version, '2026-10-01');
    expect(notes.single.lines, <String>['one', 'two', 'three']);
  });

  test('no note for the new version → nothing, so the plain sentence', () {
    expect(
      legalChangesSince(
        acceptedStamp: accepted.stamp,
        current: bumped,
        register: const <LegalChangeNote>[],
      ),
      isEmpty,
    );
    // A note written for ANOTHER version is not this version's note.
    expect(
      legalChangesSince(
        acceptedStamp: accepted.stamp,
        current: const LegalVersions(
          terms: '2026-11-01',
          privacy: '2026-09-26',
        ),
        register: const <LegalChangeNote>[termsNote],
      ),
      isEmpty,
    );
    // An unchanged document's note is never shown.
    expect(
      legalChangesSince(
        acceptedStamp: bumped.stamp,
        current: bumped,
        register: const <LegalChangeNote>[termsNote],
      ),
      isEmpty,
    );
  });
}
