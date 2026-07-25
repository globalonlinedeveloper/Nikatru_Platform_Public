import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:{{app_id.snakeCase()}}/features/home/home_screen.dart';

void main() {
  testWidgets('home renders on the design-system AppScaffold', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(theme: buildAppTheme(), home: const HomeScreen()),
      ),
    );
    expect(find.byType(AppScaffold), findsOneWidget);
    expect(find.textContaining('Welcome to'), findsOneWidget);
  });
}
