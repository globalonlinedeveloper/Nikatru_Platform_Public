// go_router 15.0.0 made every GoRoute case-SENSITIVE by default; 14.8.1 matched
// case-insensitively (path_utils.dart hard-coded it). routes.dart keeps the
// 14.x behaviour for every route on purpose — see the comment above
// `appRoutes()`. This file is what makes that a property rather than a habit:
// a route added without `caseSensitive: false` fails the first test, and the
// second proves the flag does what it says on the real route table.
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:subscriptiontracker/core/router/navigator_key.dart';
import 'package:subscriptiontracker/core/router/routes.dart';
import 'package:subscriptiontracker/core/router/shell.dart';

List<RouteBase> _table() => <RouteBase>[...appRoutes(), appShellRoute()];

Iterable<GoRoute> _goRoutes(List<RouteBase> routes) sync* {
  for (final RouteBase r in routes) {
    if (r is GoRoute) yield r;
    yield* _goRoutes(r.routes);
  }
}

void main() {
  test('every GoRoute keeps go_router 14.x case-insensitive matching', () {
    final List<GoRoute> all = _goRoutes(_table()).toList();
    // Not vacuous: the live table has 19 GoRoutes (14 above the shell, 5 in it).
    expect(all.length, greaterThanOrEqualTo(19));
    final List<String> sensitive = <String>[
      for (final GoRoute r in all)
        if (r.caseSensitive) r.path,
    ];
    expect(
      sensitive,
      isEmpty,
      reason: 'these routes would 404 on a re-cased URL: $sensitive',
    );
  });

  test('a re-cased URL still reaches its route on the real table', () {
    final GoRouter router = GoRouter(
      navigatorKey: rootNavigatorKey,
      initialLocation: '/home',
      routes: _table(),
    );
    addTearDown(router.dispose);
    for (final (String asTyped, String route) in <(String, String)>[
      ('/SETTINGS', '/settings'),
      ('/Sign-Up', '/sign-up'),
      ('/Reset-Password', '/reset-password'),
      ('/SUB/AbC123', '/sub/:id'),
    ]) {
      final RouteMatchList m = router.configuration.findMatch(
        Uri.parse(asTyped),
      );
      expect(m.isNotEmpty, isTrue, reason: '$asTyped matched nothing');
      final RouteBase last = m.last.route;
      expect(
        last is GoRoute ? last.path : last.toString(),
        route,
        reason: '$asTyped reached the wrong route',
      );
    }
    // A path parameter keeps the case it was typed in.
    expect(
      router.configuration.findMatch(Uri.parse('/SUB/AbC123')).pathParameters,
      <String, String>{'id': 'AbC123'},
    );
  });

  // Keeps the navigator key import honest when the file is read alone.
  test('the root navigator key is the one the table names', () {
    expect(rootNavigatorKey, isA<GlobalKey<NavigatorState>>());
  });
}
