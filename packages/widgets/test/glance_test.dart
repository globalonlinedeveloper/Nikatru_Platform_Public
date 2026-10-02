import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_widgets/nikatru_widgets.dart';

const List<GlanceFact> _facts = <GlanceFact>[
  GlanceFact(label: 'Next renewal', value: 'Netflix · 3 Oct'),
  GlanceFact(label: 'This month', value: '₹1,240'),
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'RED CONTROL: a Pro snapshot renders the next renewal for the widget',
    () {
      final Map<String, String> data = GlanceSnapshot.forPlan(
        isPro: true,
        facts: _facts,
        proPrompt: 'Widgets are Pro',
        badgeCount: 2,
      ).toWidgetData();
      expect(data[GlanceSnapshot.keyLocked], '0');
      expect(data[GlanceSnapshot.keyLabel(0)], 'Next renewal');
      expect(data[GlanceSnapshot.keyValue(0)], 'Netflix · 3 Oct');
      expect(data[GlanceSnapshot.keyValue(1)], '₹1,240');
      expect(data[GlanceSnapshot.keyBadge], '2');
      expect(data[GlanceSnapshot.keyPrompt], '');
    },
  );

  test('RED CONTROL: a Free snapshot carries the Pro prompt and NO facts', () {
    final GlanceSnapshot s = GlanceSnapshot.forPlan(
      isPro: false,
      facts: _facts,
      proPrompt: 'Widgets are Pro',
      badgeCount: 2,
    );
    expect(s.locked, isTrue);
    expect(s.facts, isEmpty);
    final Map<String, String> data = s.toWidgetData();
    expect(data[GlanceSnapshot.keyLocked], '1');
    expect(data[GlanceSnapshot.keyPrompt], 'Widgets are Pro');
    expect(data[GlanceSnapshot.keyLink], '/paywall');
    expect(data[GlanceSnapshot.keyBadge], '0');
    expect(
      data.values.join(),
      isNot(contains('Netflix')),
      reason: 'a Free widget must not carry the data the plan sells',
    );
  });

  test('the widget contract is a fixed key set', () {
    final Set<String> keys = GlanceSnapshot.forPlan(
      isPro: true,
      facts: const <GlanceFact>[],
      proPrompt: '',
      badgeCount: 0,
    ).toWidgetData().keys.toSet();
    expect(keys, <String>{
      'glance_locked',
      'glance_prompt',
      'glance_link',
      'glance_badge',
      'glance_fact0_label',
      'glance_fact0_value',
      'glance_fact1_label',
      'glance_fact1_value',
    });
  });

  test('at most two facts and never a negative badge', () {
    final GlanceSnapshot s = GlanceSnapshot.forPlan(
      isPro: true,
      facts: <GlanceFact>[
        ..._facts,
        const GlanceFact(label: 'x', value: 'y'),
      ],
      proPrompt: '',
      badgeCount: -3,
    );
    expect(s.facts, hasLength(GlanceSnapshot.maxFacts));
    expect(s.badgeCount, 0);
  });

  test(
    'the Pro publisher writes every key and asks for a widget update',
    () async {
      final List<MethodCall> calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(const MethodChannel('home_widget'), (
            MethodCall call,
          ) async {
            calls.add(call);
            return true;
          });
      await HomeWidgetGlancePublisher(
        androidProvider: 'com.nikatru.app.GlanceWidgetProvider',
        iOSKind: 'GlanceWidget',
      ).publish(
        GlanceSnapshot.forPlan(
          isPro: true,
          facts: _facts,
          proPrompt: '',
          badgeCount: 1,
        ),
      );
      final Map<String, Object?> saved = <String, Object?>{
        for (final MethodCall c in calls.where(
          (MethodCall c) => c.method == 'saveWidgetData',
        ))
          (c.arguments as Map)['id'] as String: (c.arguments as Map)['data'],
      };
      expect(saved['glance_fact0_value'], 'Netflix · 3 Oct');
      expect(calls.last.method, 'updateWidget');
      expect(
        (calls.last.arguments as Map)['qualifiedAndroidName'],
        'com.nikatru.app.GlanceWidgetProvider',
      );
    },
  );

  test('a publisher with no native widget does not fail a sync', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(const MethodChannel('home_widget'), null);
    await HomeWidgetGlancePublisher(androidProvider: 'x', iOSKind: 'y').publish(
      GlanceSnapshot.forPlan(
        isPro: true,
        facts: _facts,
        proPrompt: '',
        badgeCount: 0,
      ),
    );
  });

  test('every target names its surface and says why', () {
    for (final TargetPlatform p in TargetPlatform.values) {
      final GlanceCapabilities c = GlanceCapabilities.forPlatform(
        p,
        isWeb: false,
      );
      expect(c.why, isNotEmpty, reason: '$p');
    }
    expect(
      GlanceCapabilities.forPlatform(
        TargetPlatform.android,
        isWeb: true,
      ).surface,
      GlanceSurface.appBadge,
    );
    expect(
      GlanceCapabilities.forPlatform(
        TargetPlatform.android,
        isWeb: false,
      ).surface,
      GlanceSurface.homeWidget,
    );
    expect(
      GlanceCapabilities.forPlatform(
        TargetPlatform.windows,
        isWeb: false,
      ).surface,
      GlanceSurface.trayItem,
    );
  });

  test('the publisher for each target follows the matrix', () {
    GlancePublisher of(TargetPlatform p, {bool web = false}) =>
        glancePublisherFor(p, isWeb: web, androidProvider: 'a', iOSKind: 'i');
    expect(of(TargetPlatform.android), isA<HomeWidgetGlancePublisher>());
    expect(of(TargetPlatform.iOS), isA<HomeWidgetGlancePublisher>());
    expect(of(TargetPlatform.linux, web: true), isA<WebBadgeGlancePublisher>());
    expect(of(TargetPlatform.windows), isA<NoGlancePublisher>());
  });
}
