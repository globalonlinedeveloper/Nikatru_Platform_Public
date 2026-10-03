import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

// Lane dpdp-rights, Do 6 (F-05): a material notice bump re-asks consent for the
// purposes it changed, ONCE; an unchanged version never re-asks.

ConsentArtifact _granted(String purpose, String version) => ConsentArtifact(
  consentId: 'c-$purpose-$version',
  purpose: purpose,
  granted: true,
  policyVersion: version,
  anonId: 'a',
  ts: DateTime.utc(2026, 10, 1),
);

const List<MaterialNoticeChange> _fixture = <MaterialNoticeChange>[
  MaterialNoticeChange(version: '2026-11-01', purposes: <String>{'analytics'}),
];

void main() {
  test(
    '🔴 bumping the version in a fixture re-prompts ONCE, and only that purpose',
    () {
      final ConsentArtifact old = _granted('analytics', '2026-10-04');
      expect(
        needsConsentReprompt(
          artifact: old,
          currentVersion: '2026-11-01',
          register: _fixture,
        ),
        isTrue,
      );
      // The fresh answer under the new version ends it: asked once.
      final ConsentArtifact answered = _granted('analytics', '2026-11-01');
      expect(
        needsConsentReprompt(
          artifact: answered,
          currentVersion: '2026-11-01',
          register: _fixture,
        ),
        isFalse,
      );
      // A purpose the bump did not change is not re-asked.
      expect(
        needsConsentReprompt(
          artifact: _granted('promo', '2026-10-04'),
          currentVersion: '2026-11-01',
          register: _fixture,
        ),
        isFalse,
      );
    },
  );

  test('🔴 an unchanged version never re-prompts', () {
    final ConsentArtifact a = _granted('analytics', '2026-10-04');
    expect(
      needsConsentReprompt(
        artifact: a,
        currentVersion: '2026-10-04',
        register: _fixture,
      ),
      isFalse,
    );
  });

  test('a bump that is not material for the purpose re-asks nobody', () {
    final ConsentArtifact a = _granted('analytics', '2026-09-26');
    expect(
      needsConsentReprompt(
        artifact: a,
        currentVersion: '2026-10-04',
        register: _fixture,
      ),
      isFalse,
    );
  });

  test(
    'a change not yet in force (after the current version) re-asks nobody',
    () {
      final ConsentArtifact a = _granted('analytics', '2026-10-04');
      expect(
        needsConsentReprompt(
          artifact: a,
          currentVersion: '2026-10-20',
          register: _fixture,
        ),
        isFalse,
      );
    },
  );

  test('no artifact is the first-run prompt, not a re-prompt', () {
    expect(
      needsConsentReprompt(
        artifact: null,
        currentVersion: '2026-11-01',
        register: _fixture,
      ),
      isFalse,
    );
  });

  test('the shipped register is empty for 2026-10-04: no purpose changed', () {
    expect(
      kMaterialNoticeChanges.where(
        (MaterialNoticeChange c) => c.version == '2026-10-04',
      ),
      isEmpty,
    );
    expect(
      needsConsentReprompt(
        artifact: _granted('analytics', '2026-10-03'),
        currentVersion: '2026-10-04',
      ),
      isFalse,
    );
  });
}
