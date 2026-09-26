import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_external_links/nikatru_external_links.dart';

// O-LINK-LAUNCHER-SEAM-UNOWNED · the adapter enforces the policy BEFORE the
// platform. Observed at the platform channel, not at a stub: a refusal that
// still reached `url_launcher` would show up here as a recorded call.

const MethodChannel _channel = MethodChannel('plugins.flutter.io/url_launcher');

/// Every call that reached the platform channel, answered by [reply].
List<MethodCall> _platformCalls(Future<Object?> Function(MethodCall) reply) {
  final List<MethodCall> calls = <MethodCall>[];
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(_channel, (MethodCall call) {
    calls.add(call);
    return reply(call);
  });
  addTearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null),
  );
  return calls;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final UrlLauncherExternalLinks links = UrlLauncherExternalLinks(
    policy: LinkPolicy.fromUrls(
      httpsUrls: <String>['https://nikatru.com/privacy'],
      supportEmail: 'support@nikatru.com',
    ),
  );

  test('an allowed link reaches the platform, exactly as configured', () async {
    final List<MethodCall> calls = _platformCalls((_) async => true);
    expect(
      await links.open(Uri.parse('https://nikatru.com/privacy')),
      LinkOutcome.opened,
    );
    expect(calls, hasLength(1));
    expect(calls.single.method, 'launch');
    expect(
      (calls.single.arguments as Map<Object?, Object?>)['url'],
      'https://nikatru.com/privacy',
    );
  });

  test('RC3 at the adapter · javascript: never reaches the platform', () async {
    final List<MethodCall> calls = _platformCalls((_) async => true);
    expect(
      await links.open(Uri.parse('javascript:alert(1)')),
      LinkOutcome.refused,
    );
    expect(calls, isEmpty);
  });

  test('RC4 at the adapter · a foreign mailto never reaches the platform',
      () async {
    final List<MethodCall> calls = _platformCalls((_) async => true);
    expect(
      await links.open(Uri.parse('mailto:someone-else@example.com')),
      LinkOutcome.refused,
    );
    expect(calls, isEmpty);
  });

  test('the platform declining is notOpened', () async {
    _platformCalls((_) async => false);
    expect(
      await links.open(Uri.parse('mailto:support@nikatru.com')),
      LinkOutcome.notOpened,
    );
  });

  test('the platform throwing is notOpened, never an exception', () async {
    _platformCalls((_) async {
      throw PlatformException(code: 'ACTIVITY_NOT_FOUND');
    });
    expect(
      await links.open(Uri.parse('https://nikatru.com/privacy')),
      LinkOutcome.notOpened,
    );
  });
}
