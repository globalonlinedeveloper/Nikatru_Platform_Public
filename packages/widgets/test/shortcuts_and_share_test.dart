import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_widgets/nikatru_widgets.dart';

const List<AppShortcut> _shortcuts = <AppShortcut>[
  AppShortcut(type: 'add', route: '/home?add=1', title: 'Add a subscription'),
  AppShortcut(type: 'next', route: '/calendar', title: 'What renews next?'),
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('RED CONTROL: the add shortcut routes to the add sheet', () {
    final List<String> routed = <String>[];
    LauncherShortcuts(shortcuts: _shortcuts, onRoute: routed.add).handle('add');
    expect(routed, <String>['/home?add=1']);
  });

  test('an unknown shortcut type opens nothing', () {
    final List<String> routed = <String>[];
    LauncherShortcuts(shortcuts: _shortcuts, onRoute: routed.add)
      ..handle('drop-tables')
      ..handle('');
    expect(routed, isEmpty);
    expect(routeForShortcut(null, _shortcuts), isNull);
  });

  group('share intake', () {
    test(
      'RED CONTROL: an extension fixture hands text to the import route',
      () async {
        final List<SharedPayload> got = <SharedPayload>[];
        final ShareIntake intake = ShareIntake(onShared: got.add);
        final Object? ok = await intake.handle(
          const MethodCall('shared', <String, Object?>{
            'text': 'name,price\nNetflix,649',
            'name': 'subs.csv',
            'mime': 'text/csv',
          }),
        );
        expect(ok, isTrue);
        expect(got.single.text, startsWith('name,price'));
        expect(got.single.isCsv, isTrue);
        expect(shareIntakeRoute, '/import');
      },
    );

    test('a malformed or empty share is dropped', () async {
      final List<SharedPayload> got = <SharedPayload>[];
      final ShareIntake intake = ShareIntake(onShared: got.add);
      expect(await intake.handle(const MethodCall('shared', 'text')), isFalse);
      expect(
        await intake.handle(
          const MethodCall('shared', <String, Object?>{'text': ''}),
        ),
        isFalse,
      );
      expect(
        await intake.handle(
          const MethodCall('other', <String, Object?>{'text': 'x'}),
        ),
        isFalse,
      );
      expect(got, isEmpty);
    });

    test('an oversized share is refused', () {
      expect(
        SharedPayload.fromChannel(<String, Object?>{
          'text': 'x' * (SharedPayload.maxChars + 1),
        }),
        isNull,
      );
    });

    test('a share that launched the app is delivered by install', () async {
      const MethodChannel ch = MethodChannel(ShareIntake.channelName);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(ch, (MethodCall c) async {
            if (c.method == 'initial') {
              return <String, Object?>{'text': 'Spotify 119 monthly'};
            }
            return null;
          });
      final List<SharedPayload> got = <SharedPayload>[];
      await ShareIntake(onShared: got.add).install();
      expect(got.single.text, 'Spotify 119 monthly');
      expect(got.single.isCsv, isFalse);
    });

    test('a target with no native receiver installs quietly', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            const MethodChannel(ShareIntake.channelName),
            null,
          );
      final List<SharedPayload> got = <SharedPayload>[];
      await ShareIntake(onShared: got.add).install();
      expect(got, isEmpty);
    });
  });
}
