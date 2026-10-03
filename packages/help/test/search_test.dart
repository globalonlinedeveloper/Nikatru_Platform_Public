import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_help/nikatru_help.dart';

/// One search, two runtimes, one behaviour (lane help-search, Do 4): every
/// query in content/help/_eval/conformance.json — written by
/// tooling/help/build-index.mjs from the JavaScript ranker — ranks the same
/// articles in the same order here, each score within 1e-9. The JS suite
/// (tooling/ci/test/help-search.test.mjs) reds a mutated JS ranker against the
/// same file.
void main() {
  final Map<String, Object?> fixture =
      jsonDecode(
            File(
              '../../content/help/_eval/conformance.json',
            ).readAsStringSync(),
          )
          as Map<String, Object?>;
  final List<Object?> cases = fixture['cases']! as List<Object?>;
  // The full index (every scope) the site serves, which is what the fixture was
  // ranked over; an app's own table carries a subset of it.
  final HelpIndex index = HelpIndex.fromJson(
    jsonDecode(
          File(
            '../../sites/nikatru/help/index.${fixture['locale']! as String}.json',
          ).readAsStringSync(),
        )
        as Map<String, Object?>,
  );

  test('the fixture is not empty: a vacuous conformance proves nothing', () {
    expect(cases.length, greaterThanOrEqualTo(50));
  });

  test(
    'every conformance query ranks the same ids, in order, with the same scores',
    () {
      var compared = 0;
      for (final Object? c in cases) {
        final Map<String, Object?> m = c! as Map<String, Object?>;
        final String query = m['query']! as String;
        final List<Object?> want = m['hits']! as List<Object?>;
        final List<HelpHit> got = index.search(query, limit: 5);
        expect(
          got.map((HelpHit h) => h.doc.id).toList(),
          want.map((Object? w) => (w! as Map<String, Object?>)['id']).toList(),
          reason: query,
        );
        for (var i = 0; i < want.length; i++) {
          final double score =
              ((want[i]! as Map<String, Object?>)['score']! as num).toDouble();
          expect(got[i].score, closeTo(score, 1e-9), reason: '$query #$i');
          compared++;
        }
      }
      expect(compared, greaterThan(100));
    },
  );

  test('the tokenizer folds plurals and suffixes exactly as search.mjs', () {
    expect(helpTokenize('Reminders renewing cancelled categories'), <String>[
      'reminder',
      'renew',
      'cancell',
      'category',
    ]);
    expect(helpTokenize('How do I share?'), <String>['shar']);
  });

  test('a one-edit typo still finds the article', () {
    expect(
      index.search('remnder email', limit: 1).single.doc.id,
      'subscriptiontracker/renewal-reminders',
    );
  });

  test('a scope filter never changes a score, only what is shown', () {
    final List<HelpHit> all = index.search('delete', limit: 20);
    final List<HelpHit> account = index.search(
      'delete',
      scopes: <String>{'account'},
      limit: 20,
    );
    for (final HelpHit h in account) {
      expect(h.doc.scope, 'account');
      expect(
        h.score,
        all.firstWhere((HelpHit a) => a.doc.id == h.doc.id).score,
      );
    }
  });
}
