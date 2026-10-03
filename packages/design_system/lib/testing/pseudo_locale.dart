/// PSEUDO LOCALES for tests — accented, expanded text (`en-XA`) and a mirrored,
/// right-to-left layout (`ar-XB`), built from an app's ENGLISH ARB at run time.
///
/// Lane i18n-pipeline (tooling/i18n/locales.json `pseudo`). Tamil already runs
/// about 1.27x the English length and Hindi ships beside it, but a screen is
/// only ever proven in the languages somebody wrote a test for, and no locale
/// that ships today is right-to-left. A pseudo locale proves every screen at
/// once against BOTH failure classes without a translator:
///   - `en-XA` turns "Settings" into "[Śéţţîñĝš ·····]": every string is ~40%
///     longer and visibly bracketed, so truncation, overflow and any string
///     that is NOT localised (it stays plain English) show up on any screen;
///   - `ar-XB` does the same under an Arabic Material locale, so the whole tree
///     lays out right to left and every hard-wired left/right shows.
///
/// HOW. [PseudoMessages] answers every getter and method of a gen-l10n class
/// through `noSuchMethod`, from the English ARB: a getter returns the pseudo
/// form of its message, a method renders its ICU message (placeholders,
/// `plural`, `select`) with the arguments in the ARB's declared placeholder
/// order — which is the parameter order gen-l10n generates. A test declares one
/// line per localisations class:
///
/// ```dart
/// class _PseudoApp extends PseudoMessages implements AppLocalizations {
///   _PseudoApp(super.arb, super.pseudo);
/// }
/// ```
///
/// 🔴 TESTS ONLY. Nothing under `lib/src` imports this library and an app's
/// `lib/` must not: it answers every member by name, which only works in a
/// JIT test VM (`Symbol.toString`), and its text is deliberately unreadable.
library;

import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart' as intl;

import '../src/l10n/chassis_localizations.dart';
import '../src/l10n/locale_register.g.dart';

/// The register's pseudo rows, by code (`en-XA`, `ar-XB`).
RegisteredLocale pseudoRow(String code) =>
    kPseudoLocales.firstWhere((RegisteredLocale r) => r.code == code);

/// The [Locale] a pseudo row is pumped under. `ar-XB` keeps the `ar` language
/// so Material and Widgets localisations resolve to right-to-left.
Locale pseudoLocale(String code) => pseudoRow(code).locale;

const Map<String, String> _accents = <String, String>{
  'a': 'á', 'b': 'ƀ', 'c': 'ç', 'd': 'ð', 'e': 'é', 'f': 'ƒ', 'g': 'ĝ', //
  'h': 'ĥ', 'i': 'î', 'j': 'ĵ', 'k': 'ķ', 'l': 'ļ', 'm': 'ɱ', 'n': 'ñ', //
  'o': 'ö', 'p': 'þ', 'q': 'ǫ', 'r': 'ŕ', 's': 'š', 't': 'ţ', 'u': 'û', //
  'v': 'ṽ', 'w': 'ŵ', 'x': 'ẋ', 'y': 'ý', 'z': 'ž', 'A': 'Å', 'B': 'Ɓ', //
  'C': 'Ç', 'D': 'Ð', 'E': 'É', 'F': 'Ƒ', 'G': 'Ĝ', 'H': 'Ĥ', 'I': 'Î', //
  'J': 'Ĵ', 'K': 'Ķ', 'L': 'Ļ', 'M': 'Ṁ', 'N': 'Ñ', 'O': 'Ö', 'P': 'Þ', //
  'Q': 'Ǫ', 'R': 'Ŕ', 'S': 'Š', 'T': 'Ţ', 'U': 'Û', 'V': 'Ṽ', 'W': 'Ŵ', //
  'X': 'Ẋ', 'Y': 'Ý', 'Z': 'Ž',
};

/// The accented form of [text] (letters only; digits and punctuation stay).
String pseudoAccent(String text) =>
    text.split('').map((String ch) => _accents[ch] ?? ch).join();

/// Messages of one gen-l10n class, pseudo-localised. See the library doc.
class PseudoMessages {
  PseudoMessages(this.arb, this.pseudo);

  /// The decoded ENGLISH (template) ARB.
  final Map<String, dynamic> arb;

  /// The register's pseudo row (`en-XA` or `ar-XB`).
  final RegisteredLocale pseudo;

  /// Dates and numbers inside a pseudo message format as English: the point
  /// is the LAYOUT, and `intl` has no data for a pseudo tag.
  String get localeName => 'en';

  /// The pseudo form of a rendered message whose literal (non-placeholder)
  /// text was [literalLength] characters long.
  String wrap(String rendered, int literalLength) {
    if (rendered.isEmpty) return rendered;
    final int pad = math.max(1, (literalLength * 0.4).ceil());
    final String body = '[$rendered ${'·' * pad}]';
    // A right-to-left mark either side keeps the brackets with the text under
    // ar-XB, the way a real RTL string's neutral punctuation would sit.
    return pseudo.rtl ? '‏$body‏' : body;
  }

  /// Renders the message [key] with [args] (in declared placeholder order).
  String render(String key, List<Object?> args) {
    final Object? message = arb[key];
    if (message is! String) {
      throw ArgumentError('$key is not a message of this ARB');
    }
    final Map<String, dynamic>? meta = arb['@$key'] as Map<String, dynamic>?;
    final List<String> names = <String>[
      ...((meta?['placeholders'] as Map<String, dynamic>?)?.keys ??
          const <String>[]),
    ];
    final Map<String, Object?> values = <String, Object?>{
      for (int i = 0; i < names.length && i < args.length; i++)
        names[i]: args[i],
    };
    final _Icu icu = _Icu(message, values);
    final String out = icu.render();
    return wrap(out, icu.literalLength);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) {
    // `Symbol("name")` in the JIT test VM; mirrors are not available here.
    final String raw = invocation.memberName.toString();
    final String name = raw.startsWith('Symbol("')
        ? raw.substring(8, raw.length - 2)
        : raw;
    if (arb[name] is String && (invocation.isGetter || invocation.isMethod)) {
      return render(name, invocation.positionalArguments);
    }
    return super.noSuchMethod(invocation);
  }
}

/// A minimal ICU MessageFormat renderer: `{name}`, `{n, plural, …}`,
/// `{x, select, …}` — the subset gen-l10n accepts. Literal text is accented.
class _Icu {
  _Icu(this.src, this.values);

  final String src;
  final Map<String, Object?> values;
  int literalLength = 0;

  String render() => _segment(src);

  String _segment(String s) {
    final StringBuffer out = StringBuffer();
    int i = 0;
    while (i < s.length) {
      final int open = s.indexOf('{', i);
      if (open == -1) {
        out.write(_literal(s.substring(i)));
        break;
      }
      out.write(_literal(s.substring(i, open)));
      final int close = _matching(s, open);
      out.write(_argument(s.substring(open + 1, close)));
      i = close + 1;
    }
    return out.toString();
  }

  String _literal(String text) {
    literalLength += text.length;
    return pseudoAccent(text);
  }

  int _matching(String s, int open) {
    int depth = 0;
    for (int i = open; i < s.length; i++) {
      if (s[i] == '{') depth++;
      if (s[i] == '}' && --depth == 0) return i;
    }
    throw FormatException('unbalanced braces', s, open);
  }

  String _argument(String body) {
    final int c1 = body.indexOf(',');
    if (c1 == -1) return _format(values[body.trim()]);
    final String name = body.substring(0, c1).trim();
    final int c2 = body.indexOf(',', c1 + 1);
    final String kind = body.substring(c1 + 1, c2).trim();
    final Map<String, String> arms = _arms(body.substring(c2 + 1));
    final Object? v = values[name];
    String? pick;
    if (kind == 'plural') {
      final num n = v is num ? v : num.tryParse('$v') ?? 0;
      pick =
          arms['=${n is int ? n : n.toInt()}'] ??
          (n == 1 ? arms['one'] : null) ??
          (n == 0 ? arms['zero'] : null) ??
          arms['other'];
    } else {
      pick = arms['$v'] ?? arms['other'];
    }
    return _segment(pick ?? '');
  }

  Map<String, String> _arms(String s) {
    final Map<String, String> arms = <String, String>{};
    int i = 0;
    while (i < s.length) {
      final int open = s.indexOf('{', i);
      if (open == -1) break;
      final String key = s.substring(i, open).trim();
      final int close = _matching(s, open);
      arms[key] = s.substring(open + 1, close);
      i = close + 1;
    }
    return arms;
  }

  String _format(Object? v) {
    if (v is DateTime) return intl.DateFormat.yMMMd('en').format(v);
    return '$v';
  }
}

/// The chassis strings, pseudo-localised.
class PseudoChassisLocalizations extends PseudoMessages
    implements ChassisLocalizations {
  PseudoChassisLocalizations(super.arb, super.pseudo);
}

/// A delegate that loads [build] for any locale — the pseudo locale a test
/// pumps is never one the real delegates support.
class PseudoDelegate<T> extends LocalizationsDelegate<T> {
  const PseudoDelegate(this.build);

  final T Function() build;

  @override
  bool isSupported(Locale locale) => true;

  @override
  Future<T> load(Locale locale) async => build();

  @override
  bool shouldReload(PseudoDelegate<T> old) => false;
}
