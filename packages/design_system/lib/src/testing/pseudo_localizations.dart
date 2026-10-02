// ─────────────────────────────────────────────────────────────────────────────
// pseudo_localizations.dart — the register's PSEUDO-LOCALES (tooling/i18n/
// locales.json `pseudo`: en-XA and ar-XB) for widget tests.
//
// en-XA is English made ACCENTED and LONGER (by the row's `expansion`, 40%), in
// brackets, so a test sees at a glance which strings came from a catalogue (and
// which are hard-coded) and a layout that only fits English overflows here
// first. ar-XB is the same text laid out RIGHT-TO-LEFT: the app resolves an `ar`
// locale, so every Directionality below MaterialApp is rtl and every hard-wired
// left/right layout shows up mirrored-wrong.
//
// ── WHY NO GENERATED CLASS ───────────────────────────────────────────────────
// A pseudo catalogue has to answer every getter and method of a gen-l10n class
// (hundreds). Generating an override per key would be one more file that drifts
// from the ARB. Instead the catalogue is the English ARB ITSELF, read by the
// test, and [PseudoArbMessages] answers through `noSuchMethod`: the member name
// is the ARB key, the positional arguments are the ARB's declared placeholders
// in order, and the ICU message (plural, select, `#`) is formatted here. A key
// added to the ARB is pseudo-localised the day it lands, with no step to forget.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart' show SynchronousFuture;
import 'package:flutter/widgets.dart';

import '../l10n/chassis_localizations.dart';
import '../l10n/locale_register.g.dart';

/// The register's pseudo-locale for [locale], or null when it is not one.
PseudoLocale? pseudoLocaleOf(Locale locale) {
  for (final PseudoLocale p in kPseudoLocales) {
    if (p.languageCode == locale.languageCode &&
        p.countryCode == locale.countryCode) {
      return p;
    }
  }
  return null;
}

const Map<String, String> _accents = <String, String>{
  'a': 'á',
  'b': 'ƀ',
  'c': 'ç',
  'd': 'ð',
  'e': 'é',
  'f': 'ƒ',
  'g': 'ĝ',
  'h': 'ĥ',
  'i': 'î',
  'j': 'ĵ',
  'k': 'ķ',
  'l': 'ļ',
  'm': 'ɱ',
  'n': 'ñ',
  'o': 'ö',
  'p': 'þ',
  'q': 'ǫ',
  'r': 'ŕ',
  's': 'š',
  't': 'ţ',
  'u': 'û',
  'v': 'ṽ',
  'w': 'ŵ',
  'x': 'ẋ',
  'y': 'ý',
  'z': 'ž',
  'A': 'Å',
  'B': 'Ɓ',
  'C': 'Ç',
  'D': 'Ð',
  'E': 'É',
  'F': 'Ƒ',
  'G': 'Ĝ',
  'H': 'Ĥ',
  'I': 'Î',
  'J': 'Ĵ',
  'K': 'Ķ',
  'L': 'Ļ',
  'M': 'Ṁ',
  'N': 'Ñ',
  'O': 'Ö',
  'P': 'Þ',
  'Q': 'Ǫ',
  'R': 'Ŕ',
  'S': 'Š',
  'T': 'Ţ',
  'U': 'Û',
  'V': 'Ṽ',
  'W': 'Ŵ',
  'X': 'Ẋ',
  'Y': 'Ý',
  'Z': 'Ž',
};

/// The opening and closing marks of a pseudo string, so a test can tell a
/// catalogue string from a hard-coded one.
const String kPseudoOpen = '⟦';

/// See [kPseudoOpen].
const String kPseudoClose = '⟧';

/// [text] pseudo-localised for [locale]: accented, padded to
/// `expansion` × its length, bracketed — and, for an rtl pseudo-locale,
/// wrapped in a right-to-left embedding so it also READS right-to-left.
String pseudoText(String text, PseudoLocale locale) {
  if (text.isEmpty) return text;
  final StringBuffer b = StringBuffer();
  for (final int r in text.runes) {
    final String c = String.fromCharCode(r);
    b.write(_accents[c] ?? c);
  }
  final int pad = (text.length * locale.expansion).ceil();
  final String body =
      '$kPseudoOpen$b ${List<String>.filled(pad > 1 ? pad - 1 : 0, '·').join()}$kPseudoClose';
  return locale.direction == TextDirection.rtl
      ? '\u202B$body\u202C'
      : body;
}

/// Formats one ICU message ([source]) with [args] by name: `{name}`, and
/// `{n, plural, =0{…} one{…} other{…}}` / `{x, select, a{…} other{…}}`, with
/// `#` in a plural arm. Enough ICU for every message gen-l10n accepts in this
/// factory's ARB files; anything else is kept as written.
String formatIcu(String source, Map<String, Object?> args) {
  int i = 0;
  late String Function(String? hash) message;

  void space() {
    while (i < source.length && source[i].trim().isEmpty) {
      i++;
    }
  }

  String token() {
    final int start = i;
    while (i < source.length && !', {}\t\n\r'.contains(source[i])) {
      i++;
    }
    return source.substring(start, i);
  }

  /// One `{…}` after its opening brace.
  String argument(String? hash) {
    space();
    final String name = token();
    space();
    if (i < source.length && source[i] == '}') {
      i++;
      return '${args[name] ?? ''}';
    }
    // `, type` [`, style` | arms]
    i++; // ,
    space();
    final String type = token();
    space();
    if (type == 'plural' || type == 'select' || type == 'selectordinal') {
      if (i < source.length && source[i] == ',') i++;
      final Map<String, String> arms = <String, String>{};
      final Object? value = args[name];
      while (i < source.length) {
        space();
        if (i >= source.length || source[i] == '}') break;
        final String selector = token();
        space();
        if (i < source.length && source[i] == '{') {
          i++;
          arms[selector] = message(type == 'select' ? hash : '$value');
          if (i < source.length && source[i] == '}') i++;
        } else {
          i++;
        }
      }
      if (i < source.length && source[i] == '}') i++;
      if (type == 'select') return arms['$value'] ?? arms['other'] ?? '';
      final num n = value is num ? value : num.tryParse('$value') ?? 0;
      return arms['=$n'] ??
          (n == 1 ? arms['one'] : null) ??
          (n == 0 ? arms['zero'] : null) ??
          arms['other'] ??
          '';
    }
    // A formatted argument (`number`, `date`…): the value as text.
    int depth = 0;
    while (i < source.length && !(source[i] == '}' && depth == 0)) {
      if (source[i] == '{') depth++;
      if (source[i] == '}') depth--;
      i++;
    }
    if (i < source.length) i++;
    return '${args[name] ?? ''}';
  }

  message = (String? hash) {
    final StringBuffer out = StringBuffer();
    while (i < source.length) {
      final String c = source[i];
      if (c == '}') return out.toString();
      i++;
      if (c == '{') {
        out.write(argument(hash));
      } else if (c == '#' && hash != null) {
        out.write(hash);
      } else {
        out.write(c);
      }
    }
    return out.toString();
  };
  return message(null);
}

/// The engine of a pseudo catalogue: answers ANY getter or method of a gen-l10n
/// class from the English ARB [arb], pseudo-localised for [pseudo]. A subclass
/// `implements` the generated class (see [PseudoChassisLocalizations]).
abstract class PseudoArbMessages {
  /// [arb] is the decoded template ARB (`<prefix>_en.arb`).
  PseudoArbMessages(this.arb, this.pseudo);

  /// The decoded English ARB, metadata included.
  final Map<String, dynamic> arb;

  /// The pseudo-locale every answer is rendered in.
  final PseudoLocale pseudo;

  /// The base language's name: dates, numbers and plurals resolve as English.
  String get localeName => 'en';

  static String _nameOf(Symbol s) {
    // `Symbol("name")` on the VM, which is where widget tests run.
    final String raw = s.toString();
    final int open = raw.indexOf('"');
    return open < 0 ? raw : raw.substring(open + 1, raw.lastIndexOf('"'));
  }

  @override
  Object? noSuchMethod(Invocation invocation) {
    final String key = _nameOf(invocation.memberName);
    final Object? source = arb[key];
    if (source is! String) return super.noSuchMethod(invocation);
    final Map<String, dynamic> meta =
        (arb['@$key'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final List<String> names = <String>[
      ...((meta['placeholders'] as Map<String, dynamic>?)?.keys ??
          const <String>[]),
    ];
    final Map<String, Object?> args = <String, Object?>{
      for (int n = 0; n < invocation.positionalArguments.length; n++)
        if (n < names.length) names[n]: invocation.positionalArguments[n],
    };
    return pseudoText(formatIcu(source, args), pseudo);
  }
}

/// The chassis strings in a pseudo-locale.
class PseudoChassisLocalizations extends PseudoArbMessages
    implements ChassisLocalizations {
  /// [arb] is the decoded `chassis_en.arb`.
  PseudoChassisLocalizations(super.arb, super.pseudo);
}

/// A delegate that answers the register's pseudo-locales with [build], and
/// nothing else — so it can sit BEFORE the real delegates of the same type.
class PseudoLocalizationsDelegate<T> extends LocalizationsDelegate<T> {
  /// [build] makes the catalogue for one pseudo-locale.
  const PseudoLocalizationsDelegate(this.build);

  /// Makes the catalogue for one pseudo-locale.
  final T Function(PseudoLocale pseudo) build;

  @override
  bool isSupported(Locale locale) => pseudoLocaleOf(locale) != null;

  @override
  Future<T> load(Locale locale) =>
      SynchronousFuture<T>(build(pseudoLocaleOf(locale)!));

  @override
  bool shouldReload(PseudoLocalizationsDelegate<T> old) => false;
}
