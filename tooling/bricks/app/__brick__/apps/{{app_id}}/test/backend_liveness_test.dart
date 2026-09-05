// ─────────────────────────────────────────────────────────────────────────────
// [B-8] THE DEMO/LIVE GATE MUST NOT READ THE API HOST.
//
// 🔴 THE DEFECT THIS FILE EXISTS FOR. `AppConfig.isBackendLive` decides whether
// a build talks to real services: `main.dart` calls `initNikatruAuth` only when
// it is true, `providers.dart` hands out the real auth repository and the real
// REST client only when it is true, and `remoteConfigEnabled` is `it && !skip`.
// On the `needs_backend` branch it also required `apiBaseUrl != _phApiBase` —
// a clause copied from `apps/subly`, where `_phApiBase` is a self-describing
// fake no build ever passes. In a STAMPED app it is not: `hooks/pre_gen.dart`
// derives it to `https://api-<app_id>.nikatru.com`, the app's own Worker binds
// exactly that hostname as a custom domain, and the stamped README tells the
// owner to pass exactly that value as `--dart-define=API_BASE_URL`. So the
// comparison was FALSE for a correctly deployed, correctly built app, which
// then ran in demo mode in production — no error, no log, no failing gate, and
// every one of the 148 CI guards green.
//
// WHY THIS IS A SOURCE WALK AND NOT A CALL. `isBackendLive` is composed of
// `String.fromEnvironment` constants, and `flutter test` passes no
// `--dart-define`s: with identity absent the getter is false either way, so
// CALLING it can never tell the two versions apart. What CAN be observed is
// which configuration the getter READS — the same thing
// `tooling/ci/assert-store-build-config.mjs` reads out of this getter to derive
// the set of defines a store artifact must supply. The walk follows the getter
// chain, so renaming or re-nesting the getters does not lose it.
//
// ⚠️ THIS FILE IS INHERITED BY EVERY STAMPED APP, both variants. On a
// client-only stamp the property already held; the test still runs there,
// because "the branch that was right" is exactly the one that rots unwatched.
//
// IF YOU EVER MAKE `_phApiBase` A REAL PLACEHOLDER (a string no deployed build
// can pass, as subly has), the FIRST test below goes red — it asserts the
// premise, not just the shape. Fix the premise test in the same change that
// changes the premise, and only then is an API-host clause defensible again.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:{{app_id.snakeCase()}}/core/app_config.dart';

/// This app's own compiled config, read off disk. `flutter test` runs with the
/// package root as its working directory — the same access
/// `chassis_properties_test.dart` uses to derive the screen set from the router.
const String kConfigRel = 'lib/core/app_config.dart';

/// The runtime-config defaults the app ships with. Its `api_base_url` is
/// stamped from the same derived value as `_phApiBase`, which is the whole
/// point: one of them is not a placeholder for the other.
const String kDefaultsRel = 'config/defaults.json';

/// String-aware comment stripper, so a doc comment that NAMES an identifier
/// cannot be mistaken for code that reads it — and so a `//` inside a URL
/// literal is not mistaken for a comment.
String stripDartComments(String src) {
  final StringBuffer out = StringBuffer();
  int i = 0;
  String? quote;
  while (i < src.length) {
    final String ch = src[i];
    final String next = i + 1 < src.length ? src[i + 1] : '';
    if (quote != null) {
      out.write(ch);
      if (ch == r'\') {
        if (next.isNotEmpty) out.write(next);
        i += 2;
        continue;
      }
      if (ch == quote) quote = null;
      i++;
      continue;
    }
    if (ch == "'" || ch == '"') {
      quote = ch;
      out.write(ch);
      i++;
      continue;
    }
    if (ch == '/' && next == '/') {
      while (i < src.length && src[i] != '\n') {
        i++;
      }
      continue;
    }
    if (ch == '/' && next == '*') {
      i += 2;
      while (i < src.length &&
          !(src[i] == '*' && i + 1 < src.length && src[i + 1] == '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    out.write(ch);
    i++;
  }
  return out.toString();
}

/// Every `static bool get <name> => <body>;` in [src], by name. The shape
/// `isBackendLive` and everything it names are written in.
Map<String, String> boolGetters(String src) {
  final Map<String, String> out = <String, String>{};
  final RegExp decl = RegExp(
    r'static\s+bool\s+get\s+(\w+)\s*=>\s*([^;]+);',
    multiLine: true,
  );
  for (final RegExpMatch m in decl.allMatches(src)) {
    out[m.group(1)!] = m.group(2)!;
  }
  return out;
}

/// Every identifier reachable from [root] by following the getters it names.
/// Mirrors the transitive walk `assert-store-build-config.mjs` performs, so the
/// two cannot disagree about what this getter depends on.
Set<String> reachableIdentifiers(Map<String, String> getters, String root) {
  final Set<String> seenGetters = <String>{};
  final Set<String> reached = <String>{};
  final List<String> queue = <String>[root];
  while (queue.isNotEmpty) {
    final String g = queue.removeLast();
    if (!seenGetters.add(g)) continue;
    for (final RegExpMatch m in RegExp(
      r'[A-Za-z_][A-Za-z0-9_]*',
    ).allMatches(getters[g]!)) {
      final String id = m.group(0)!;
      reached.add(id);
      if (getters.containsKey(id)) queue.add(id);
    }
  }
  return reached;
}

void main() {
  late String source;

  setUpAll(() {
    final File f = File(kConfigRel);
    expect(
      f.existsSync(),
      isTrue,
      reason:
          'COVERAGE LOST — $kConfigRel is not readable from the test working '
          'directory, so both assertions below would be about nothing.',
    );
    source = stripDartComments(f.readAsStringSync());
  });

  group('backend-liveness-ignores-the-api-host', () {
    test('🔴 the compiled-in API default IS the host this app calls', () {
      final RegExpMatch? m = RegExp(
        r"static const String _phApiBase = '([^']*)';",
      ).firstMatch(source);
      expect(
        m,
        isNotNull,
        reason:
            'COVERAGE LOST — no `_phApiBase` literal in $kConfigRel. The premise '
            'of the second test cannot be established, and CI '
            '(assert-stamp-text-fidelity.mjs) refuses the same absence.',
      );
      final String stamped = m!.group(1)!;

      // 1 · It is the value a build with no --dart-define actually uses.
      expect(
        AppConfig.apiBaseUrl,
        stamped,
        reason:
            'A build that passes no API_BASE_URL calls the stamped default, so '
            'the default and the sentinel are the same string.',
      );

      // 2 · It is a real nikatru host, not a placeholder. This is what makes an
      //     `apiBaseUrl != _phApiBase` liveness clause a production defect here
      //     while it is correct in apps/subly.
      expect(
        stamped,
        matches(RegExp(r'^https://[a-z0-9][a-z0-9.-]*\.nikatru\.com(/v1)?$')),
        reason:
            'The stamped default reads as a deployable host. If it is ever '
            'replaced by a self-describing placeholder no build can pass, '
            'update this test and the note on isBackendLive together.',
      );

      // 3 · The shipped runtime-config default names the same host, so the
      //     value is operational and not a stand-in for a missing one.
      final File defaults = File(kDefaultsRel);
      expect(
        defaults.existsSync(),
        isTrue,
        reason: 'COVERAGE LOST — $kDefaultsRel is missing.',
      );
      final Map<String, dynamic> json =
          jsonDecode(defaults.readAsStringSync()) as Map<String, dynamic>;
      expect(
        json['api_base_url'],
        stamped,
        reason:
            'config/defaults.json and _phApiBase are stamped from one derived '
            'value; the app really does call it.',
      );
    });

    test('🔴 isBackendLive reaches identity defines and NOT the API host', () {
      final Map<String, String> getters = boolGetters(source);
      expect(
        getters.containsKey('isBackendLive'),
        isTrue,
        reason:
            'COVERAGE LOST — no `static bool get isBackendLive => …;` parsed out '
            'of $kConfigRel. An unparsed getter reaches nothing and this test '
            'would pass by measuring nothing.',
      );

      final Set<String> reached = reachableIdentifiers(
        getters,
        'isBackendLive',
      );

      // Coverage first: the walk must have found the identity it is named for,
      // otherwise "it does not reach the API host" is vacuously true.
      expect(
        reached,
        containsAll(<String>['supabaseUrl', 'supabaseAnonKey']),
        reason:
            'COVERAGE LOST — the walk did not reach the identity constants, so '
            'it is not walking isBackendLive.',
      );

      for (final String banned in <String>['apiBaseUrl', '_phApiBase']) {
        expect(
          reached.contains(banned),
          isFalse,
          reason:
              'isBackendLive reads `$banned`. For a STAMPED app the compiled-in '
              'API default is the production host (asserted above), so any '
              'comparison against it is false for exactly the builds that are '
              'configured correctly — a deployed app silently running in demo '
              'mode. Identity decides demo mode; the API host is evidence of '
              'nothing. See the note on isBackendLive in $kConfigRel.',
        );
      }
    });
  });
}
