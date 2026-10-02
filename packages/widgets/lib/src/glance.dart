import 'package:flutter/foundation.dart';

/// One line a glance shows: a short label and its value, both already
/// localized and formatted by the app ("Next renewal" · "Netflix, 3 Oct").
@immutable
class GlanceFact {
  const GlanceFact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  bool operator ==(Object other) =>
      other is GlanceFact && other.label == label && other.value == value;

  @override
  int get hashCode => Object.hash(label, value);
}

/// What every out-of-window surface shows: the home-screen widget, the
/// desktop tray/menu-bar item and the web app badge. Built by the app on each
/// sync and WRITTEN, never fetched: the widget process has no network and no
/// session, so a snapshot is all it will ever know.
///
/// 🔴 ADR 101: THE GLANCE IS PRO, GATED PER CARD. A Free snapshot carries NO
/// facts — not hidden ones, none — and the Pro prompt in their place. A
/// widget that rendered the facts and greyed them would be leaking the very
/// data the plan sells, to anyone with a home screen.
@immutable
class GlanceSnapshot {
  const GlanceSnapshot._({
    required this.facts,
    required this.proPrompt,
    required this.badgeCount,
    required this.deepLink,
  });

  /// The snapshot for a plan. [facts] are dropped unless [isPro]; the badge
  /// count is dropped with them (it is a fact too).
  factory GlanceSnapshot.forPlan({
    required bool isPro,
    required List<GlanceFact> facts,
    required String proPrompt,
    required int badgeCount,
    String deepLink = '/home',
    String paywallLink = '/paywall',
  }) {
    if (!isPro) {
      return GlanceSnapshot._(
        facts: const <GlanceFact>[],
        proPrompt: proPrompt,
        badgeCount: 0,
        deepLink: paywallLink,
      );
    }
    return GlanceSnapshot._(
      facts: List<GlanceFact>.unmodifiable(facts.take(maxFacts)),
      proPrompt: null,
      badgeCount: badgeCount < 0 ? 0 : badgeCount,
      deepLink: deepLink,
    );
  }

  /// ⏱ 2026-10-02 · review of #1155, finding 7. The snapshot while the APP
  /// LOCK is on: no facts and no badge — the same shape as a Free snapshot —
  /// and [prompt] in their place. A home screen is outside the lock, so a
  /// locked app must not show its renewals and its month's total there.
  factory GlanceSnapshot.hidden({
    required String prompt,
    String deepLink = '/home',
  }) => GlanceSnapshot._(
    facts: const <GlanceFact>[],
    proPrompt: prompt,
    badgeCount: 0,
    deepLink: deepLink,
  );

  /// A small widget has room for two lines; the brief names two facts.
  static const int maxFacts = 2;

  final List<GlanceFact> facts;

  /// Non-null exactly when the glance is locked behind Pro.
  final String? proPrompt;

  /// The web app badge and the tray count: renewals due this week.
  final int badgeCount;

  /// Where a tap on the widget opens the app.
  final String deepLink;

  bool get locked => proPrompt != null;

  /// The flat string map the native widget reads from its shared store.
  ///
  /// Flat on purpose: AppWidget reads SharedPreferences and WidgetKit reads
  /// `UserDefaults(suiteName:)`, and both read strings with no JSON parser in
  /// the widget's budget. The key set is the CONTRACT with the Kotlin and
  /// Swift readers, so it is fixed here and asserted by a test.
  Map<String, String> toWidgetData() => <String, String>{
    keyLocked: locked ? '1' : '0',
    keyPrompt: proPrompt ?? '',
    keyLink: deepLink,
    keyBadge: '$badgeCount',
    for (int i = 0; i < maxFacts; i++) ...<String, String>{
      keyLabel(i): i < facts.length ? facts[i].label : '',
      keyValue(i): i < facts.length ? facts[i].value : '',
    },
  };

  /// Every key [toWidgetData] writes — what a clear forgets.
  static List<String> get widgetKeys => <String>[
    keyLocked,
    keyPrompt,
    keyLink,
    keyBadge,
    for (int i = 0; i < maxFacts; i++) ...<String>[keyLabel(i), keyValue(i)],
  ];

  static const String keyLocked = 'glance_locked';
  static const String keyPrompt = 'glance_prompt';
  static const String keyLink = 'glance_link';
  static const String keyBadge = 'glance_badge';
  static String keyLabel(int i) => 'glance_fact${i}_label';
  static String keyValue(int i) => 'glance_fact${i}_value';
}
