import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// THE FIELD THAT LOSES ITS NAME THE MOMENT SOMEBODY TYPES IN IT.
///
/// [AuthField] was the private `_field` helper of one screen in one app, and the
/// defect it exists to end is invisible on a pristine form: the label is painted
/// as a separate `Text` above the box, so the only string in the field's own
/// semantics was `hintText` — and Flutter fades a hint out, semantics and all,
/// as soon as the field has content. A reader heard the placeholder on arrival
/// and, one character later, a text field announced as NOTHING.
///
/// 🔴 EVERY NAMING CASE HERE TYPES FIRST. A case that pumps an empty field and
/// asserts a name passes against the broken widget, because the hint is still
/// there to be read — which is exactly why the app-level sweep that found this
/// had to grow a typed-in case. Repeating the mistake at the primitive would
/// give the portfolio a green test for the wrong state.
///
/// `apps/subly/test/a11y_semantics_test.dart` measures the CRITERION on the real
/// screens. This file measures the PROPERTY on the widget those screens are
/// built out of, which is the assertion that survives a screen being rewritten.
void main() {
  const Key kInner = Key('af-inner');

  Future<void> pump(
    WidgetTester tester,
    Widget field, {
    Brightness brightness = Brightness.light,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(brightness: brightness),
        home: Scaffold(body: field),
      ),
    );
  }

  AuthField field({
    String label = 'Email',
    String? hint,
    bool obscure = false,
    TextEditingController? controller,
    List<String>? autofillHints,
    TextInputAction? textInputAction,
    FocusNode? focusNode,
    VoidCallback? onSubmitted,
  }) =>
      AuthField(
        label: label,
        controller: controller ?? TextEditingController(),
        keyboardType: TextInputType.emailAddress,
        fieldKey: kInner,
        hint: hint,
        obscure: obscure,
        autofillHints: autofillHints,
        textInputAction: textInputAction,
        focusNode: focusNode,
        onSubmitted: onSubmitted,
      );

  group('the name reaches a screen reader', () {
    testWidgets('a field WITH CONTENT still announces its label', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pump(tester, field(hint: 'you@email.com'));

      await tester.enterText(find.byKey(kInner), 'someone@example.test');
      // ⚠️ `pumpAndSettle`, NOT `pump`. The hint does not vanish on the frame
      // the text lands — `InputDecorator` fades it, and MEASURED here, one
      // `pump` later the merged label still carries the hint after the name.
      // A test
      // written with a single pump therefore reads a label that is about to
      // stop existing, and would go green against the very widget this
      // replaces. Settling is what makes the assertion be about the end state
      // a real user's screen reader meets.
      await tester.pumpAndSettle();

      final SemanticsNode node = tester.getSemantics(find.byType(AuthField));
      final SemanticsData data = node.getSemanticsData();
      // The hint is gone from the label at this point — that is the whole
      // defect — so `Email` can only be coming from the annotation.
      expect(
        data.label,
        'Email',
        reason: 'a typed-in field with no name is the defect this widget ends',
      );
      // And the typed text is the VALUE, not the name: "which box am I in"
      // cannot be answered from the value, which is the reason the password
      // box was the worse of the two.
      expect(data.value, 'someone@example.test');
      handle.dispose();
    });

    testWidgets('THE PAINTED CAPITALS ARE NOT IN THE SEMANTICS TREE', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pump(tester, field());

      // Painted: EMAIL. Announced: Email. A reader handed the capitals is
      // handed a layout compromise read out one letter at a time.
      expect(find.text('EMAIL'), findsOneWidget);
      expect(find.bySemanticsLabel('EMAIL'), findsNothing);
      expect(find.bySemanticsLabel('Email'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('label, role and value are ONE node, not two swipes', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pump(tester, field());
      // `MergeSemantics` is the mechanism; the observable consequence is that
      // the caption is not a separately reachable node beside the box.
      expect(find.byType(MergeSemantics), findsOneWidget);
      // ⚠️ `descendant`-scoped, and MEASURED rather than assumed: a bare
      // `findsOneWidget` over the whole tree finds TWO, because Material's own
      // `InputDecorator` wraps part of the box in one. Asserting the count
      // tree-wide would be an assertion about Flutter's internals that breaks
      // on an engine upgrade and says nothing about this widget.
      expect(
        find.descendant(
          of: find.byType(Column).first,
          matching: find.byType(ExcludeSemantics),
        ),
        findsWidgets,
      );
      handle.dispose();
    });
  });

  group('the key goes on the TextField, not on the wrapper', () {
    testWidgets('fieldKey resolves to a TextField', (
      WidgetTester tester,
    ) async {
      await pump(tester, field());
      // 🔴 `apps/subly/test/login_chassis_parity_test.dart:425` does exactly
      // this cast to read autofill and keyboard properties off the framework
      // widget. Keying the wrapper instead would make that lookup THROW rather
      // than fail an assertion, and the E2E legs driving `E2EKeys.login*`
      // would stop resolving.
      expect(tester.widget<TextField>(find.byKey(kInner)), isA<TextField>());
    });
  });

  group('the keyboard and browser properties are passed through, never defaulted', () {
    testWidgets('nothing is invented when the caller supplies nothing', (
      WidgetTester tester,
    ) async {
      await pump(tester, field());
      final TextField t = tester.widget<TextField>(find.byKey(kInner));
      // One widget paints both boxes on a sign-in form and the two want
      // OPPOSITE answers — the email box advances, the password box submits. A
      // default here would be right for one caller and silently wrong for the
      // other, so the absence is the assertion.
      expect(t.autofillHints, isNull);
      expect(t.textInputAction, isNull);
      expect(t.onSubmitted, isNull);
    });

    testWidgets('what the caller supplies arrives verbatim', (
      WidgetTester tester,
    ) async {
      final FocusNode node = FocusNode();
      addTearDown(node.dispose);
      await pump(
        tester,
        field(
          autofillHints: const <String>[AutofillHints.password],
          textInputAction: TextInputAction.done,
          focusNode: node,
          obscure: true,
          onSubmitted: () {},
        ),
      );
      final TextField t = tester.widget<TextField>(find.byKey(kInner));
      expect(t.autofillHints, <String>[AutofillHints.password]);
      expect(t.textInputAction, TextInputAction.done);
      expect(t.focusNode, same(node));
      expect(t.obscureText, isTrue);
    });

    testWidgets('a REAL Enter reaches the callback', (
      WidgetTester tester,
    ) async {
      // ⚠️ THE PROPERTY CHECK ABOVE IS NOT ENOUGH ON ITS OWN: it passes against
      // a field that declares `done` and wires it to nothing. This drives the
      // action the platform actually sends.
      int fired = 0;
      await pump(
        tester,
        field(
          textInputAction: TextInputAction.done,
          onSubmitted: () => fired++,
        ),
      );
      await tester.tap(find.byKey(kInner));
      await tester.pump();
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      expect(fired, 1);
    });
  });

  group('formTones — the two arms are asymmetric on purpose', () {
    testWidgets('LIGHT is the literal token, not a scheme slot', (
      WidgetTester tester,
    ) async {
      late FormTones tones;
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(brightness: Brightness.light),
          home: Builder(
            builder: (BuildContext context) {
              tones = formTones(context);
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      // `apps/subly` is the frozen legacy rail-prover the owner eyeballs, so a
      // "tidy-up" to `scheme.surface` in the light arm would repaint the login
      // screen while every scheme-to-scheme assertion kept passing. These
      // equalities are what make that edit go red.
      expect(tones.bg, AppColors.bg);
      expect(tones.surface, AppColors.surface);
      expect(tones.line, AppColors.line);
      expect(tones.ink, AppColors.ink);
      expect(tones.muted, AppColors.muted);
      expect(tones.accent, AppColors.accent);
      expect(tones.danger, AppColors.danger);
    });

    testWidgets('DARK follows the scheme, and none of it is the light token', (
      WidgetTester tester,
    ) async {
      late FormTones tones;
      late ColorScheme scheme;
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(brightness: Brightness.dark),
          home: Builder(
            builder: (BuildContext context) {
              tones = formTones(context);
              scheme = Theme.of(context).colorScheme;
              return const SizedBox.shrink();
            },
          ),
        ),
      );
      expect(tones.bg, scheme.surface);
      expect(tones.surface, scheme.surfaceContainerHighest);
      expect(tones.line, scheme.outlineVariant);
      expect(tones.ink, scheme.onSurface);
      expect(tones.muted, scheme.onSurfaceVariant);
      expect(tones.accent, scheme.primary);
      expect(tones.danger, scheme.error);

      // 🔴 THE ONE THAT MATTERS. Before the dark arm existed this resolved to
      // `AppColors.bg` (#F4F4F8, near-white) behind `AppColors.ink` (#141420,
      // near-black) inside dark chassis chrome — a white sheet in a dark app.
      // Asserting the scheme slots alone would still pass if somebody put the
      // light literal back for `bg` on a theme whose surface happened to match.
      expect(tones.bg, isNot(AppColors.bg));
      expect(tones.ink, isNot(AppColors.ink));
    });

    testWidgets('the painted field takes its colours from the arm in force', (
      WidgetTester tester,
    ) async {
      await pump(tester, field(), brightness: Brightness.dark);
      final TextField t = tester.widget<TextField>(find.byKey(kInner));
      // The fill is the resolved surface, so a field on a dark scaffold is not
      // a white box. This is the widget-level consequence of the arm above.
      expect(t.decoration!.fillColor, isNot(AppColors.surface));
      expect(t.decoration!.filled, isTrue);
    });
  });
}
