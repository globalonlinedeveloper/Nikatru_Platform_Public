import 'dart:math' as math;

/// The help centre's search, the Dart twin of tooling/help/search.mjs (lane
/// help-search). Same tokenizer, same BM25, same tie-break — so the app and
/// the site rank the same articles in the same order for the same query.
/// content/help/_eval/conformance.json holds both to it: queries with the
/// ranked ids and scores the JavaScript produced, which test/search_test.dart
/// reproduces here.

/// BM25's term-frequency saturation.
const double kHelpK1 = 1.2;

/// BM25's length normalisation.
const double kHelpB = 0.75;

/// Words too common to rank on (the same set as search.mjs `STOPWORDS`).
const Set<String> kHelpStopwords = <String>{
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'if', 'in', 'is',
  'it', 'its', 'me', 'my', 'of', 'on', 'or', 'the', 'this', 'to', 'what', 'when', 'where', 'which', 'why', 'with', 'you', 'your',
};

/// A matched synonym counts at this fraction of the word typed (search.mjs `SYNONYM_WEIGHT`).
const double kHelpSynonymWeight = 0.7;

/// A one-edit typo match counts at this fraction (search.mjs `TYPO_WEIGHT`).
const double kHelpTypoWeight = 0.6;

/// Query terms shorter than this are never typo-matched (search.mjs `TYPO_MIN_LENGTH`).
const int kHelpTypoMinLength = 5;

final RegExp _split = RegExp(r'[^\p{L}\p{N}]+', unicode: true);
final RegExp _keepS = RegExp(r'[sui]s$');

/// One token's stem — search.mjs `stem`, rule for rule, in the same order.
String helpStem(String token) {
  var t = token;
  if (t.length > 4 && t.endsWith('ies')) {
    t = '${t.substring(0, t.length - 3)}y';
  } else if (t.length > 3 && t.endsWith('s') && !_keepS.hasMatch(t)) {
    t = t.substring(0, t.length - 1);
  }
  if (t.length > 5 && t.endsWith('ing')) {
    t = t.substring(0, t.length - 3);
  } else if (t.length > 4 && t.endsWith('ed')) {
    t = t.substring(0, t.length - 2);
  }
  if (t.length > 4 && t.endsWith('e')) t = t.substring(0, t.length - 1);
  return t;
}

/// The tokens of [text]: lower-cased, split on every non-letter-non-number
/// run, 2+ characters, no stopwords, each stemmed by [helpStem].
List<String> helpTokenize(String text) => <String>[
  for (final raw in text.toLowerCase().split(_split))
    if (raw.length >= 2 && !kHelpStopwords.contains(raw)) helpStem(raw),
];

/// Is [b] within one edit of [a] — search.mjs `withinOneEdit`.
bool helpWithinOneEdit(String a, String b) {
  if (a == b) return true;
  final la = a.length;
  final lb = b.length;
  if ((la - lb).abs() > 1) return false;
  if (la == lb) {
    final diff = <int>[];
    for (var i = 0; i < la; i++) {
      if (a.codeUnitAt(i) != b.codeUnitAt(i)) diff.add(i);
    }
    if (diff.length == 1) return true;
    return diff.length == 2 &&
        diff[1] == diff[0] + 1 &&
        a.codeUnitAt(diff[0]) == b.codeUnitAt(diff[1]) &&
        a.codeUnitAt(diff[1]) == b.codeUnitAt(diff[0]);
  }
  final s = la < lb ? a : b;
  final l = la < lb ? b : a;
  var i = 0;
  while (i < s.length && s.codeUnitAt(i) == l.codeUnitAt(i)) {
    i++;
  }
  return s.substring(i) == l.substring(i + 1);
}

/// One article in the index.
class HelpDoc {
  const HelpDoc({
    required this.id,
    required this.scope,
    required this.slug,
    required this.title,
    required this.summary,
    required this.body,
    required this.url,
    required this.len,
  });

  factory HelpDoc.fromJson(Map<String, Object?> j) => HelpDoc(
    id: j['id']! as String,
    scope: j['scope']! as String,
    slug: j['slug']! as String,
    title: j['title']! as String,
    summary: j['summary']! as String,
    body: (j['text'] as String?) ?? '',
    url: j['url']! as String,
    len: (j['len']! as num).toDouble(),
  );

  final String id;
  final String scope;
  final String slug;
  final String title;
  final String summary;

  /// The article as plain text (no markup), for the app's reader.
  final String body;
  final String url;
  final double len;
}

/// A published known issue, from content/known-issues/.
class HelpKnownIssue {
  const HelpKnownIssue({required this.title, required this.apps, required this.versions, required this.status, this.fixedIn, required this.text});

  factory HelpKnownIssue.fromJson(Map<String, Object?> j) => HelpKnownIssue(
    title: j['title']! as String,
    apps: (j['apps']! as List<Object?>).cast<String>(),
    versions: j['versions']! as String,
    status: j['status']! as String,
    fixedIn: j['fixedIn'] as String?,
    text: j['text']! as String,
  );

  final String title;
  final List<String> apps;
  final String versions;
  final String status;
  final String? fixedIn;
  final String text;
}

/// One ranked match.
class HelpHit {
  const HelpHit(this.doc, this.score);

  final HelpDoc doc;
  final double score;
}

/// The index tooling/help/build-index.mjs writes, for one locale.
class HelpIndex {
  HelpIndex._(this.locale, this.docs, this.avgdl, this._postings, this._synonyms, this.knownIssues);

  factory HelpIndex.fromJson(Map<String, Object?> j) {
    final postings = <String, List<(int, double)>>{};
    (j['postings']! as Map<String, Object?>).forEach((term, list) {
      postings[term] = <(int, double)>[
        for (final p in list! as List<Object?>) ((p! as List<Object?>)[0]! as int, ((p as List<Object?>)[1]! as num).toDouble()),
      ];
    });
    return HelpIndex._(
      j['locale']! as String,
      <HelpDoc>[for (final d in j['docs']! as List<Object?>) HelpDoc.fromJson(d! as Map<String, Object?>)],
      (j['avgdl']! as num).toDouble(),
      postings,
      <String, List<String>>{
        for (final e in ((j['synonyms'] as Map<String, Object?>?) ?? const <String, Object?>{}).entries)
          e.key: (e.value! as List<Object?>).cast<String>(),
      },
      <HelpKnownIssue>[for (final k in (j['knownIssues'] as List<Object?>?) ?? const <Object?>[]) HelpKnownIssue.fromJson(k! as Map<String, Object?>)],
    );
  }

  final String locale;
  final List<HelpDoc> docs;
  final double avgdl;
  final Map<String, List<(int, double)>> _postings;
  final Map<String, List<String>> _synonyms;

  /// The query's terms with their weights, sorted by term — search.mjs `expandQuery`.
  List<(String, double)> expandQuery(String query) {
    final weights = <String, double>{};
    void put(String t, double w) {
      if ((weights[t] ?? 0) < w) weights[t] = w;
    }

    for (final t in <String>{...helpTokenize(query)}) {
      put(t, 1);
      for (final s in _synonyms[t] ?? const <String>[]) {
        put(s, kHelpSynonymWeight);
      }
      if (!_postings.containsKey(t) && t.length >= kHelpTypoMinLength) {
        for (final v in _postings.keys) {
          if (v != t && v.codeUnitAt(0) == t.codeUnitAt(0) && helpWithinOneEdit(t, v)) put(v, kHelpTypoWeight);
        }
      }
    }
    final keys = weights.keys.toList()..sort();
    return <(String, double)>[for (final k in keys) (k, weights[k]!)];
  }
  final List<HelpKnownIssue> knownIssues;

  /// The ranked matches of [query], best first, at most [limit], only from
  /// [scopes] when given. Identical to search.mjs `search`.
  List<HelpHit> search(String query, {Set<String>? scopes, int limit = 10}) {
    final scores = <int, double>{};
    final n = docs.length;
    for (final (term, weight) in expandQuery(query)) {
      final posting = _postings[term];
      if (posting == null) continue;
      final idf = math.log(1 + (n - posting.length + 0.5) / (posting.length + 0.5));
      for (final (d, tf) in posting) {
        final doc = docs[d];
        if (scopes != null && !scopes.contains(doc.scope)) continue;
        final norm = tf + kHelpK1 * (1 - kHelpB + (kHelpB * doc.len) / avgdl);
        scores[d] = (scores[d] ?? 0) + (weight * idf * tf * (kHelpK1 + 1)) / norm;
      }
    }
    final hits = <HelpHit>[for (final e in scores.entries) HelpHit(docs[e.key], e.value)]
      ..sort((a, b) {
        final byScore = b.score.compareTo(a.score);
        return byScore != 0 ? byScore : a.doc.id.compareTo(b.doc.id);
      });
    return hits.take(limit).toList();
  }
}
