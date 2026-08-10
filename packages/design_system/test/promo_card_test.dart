// [research/44 §7 rung 3] The promo card's shape, asserted where the shape is.
//
// The first group is the one that matters most and it is the least interesting
// to read: WITH THE CAMPAIGN OFF, NOTHING RENDERS AND THE SLOT COLLAPSES. That
// is the state every stamped app ships in — `features.promo_card_enabled` is
// absent by default — so it is the state that will be true of fifty apps for
// however long the flag stays off, and "renders nothing" is precisely the kind
// of claim that is never checked because nothing about it looks broken.
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show PipelineOwner;
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  /// A fully-populated card, so each test can turn exactly one thing off.
  Widget host({
    required bool show,
    String? priceLabel = r'$4.99',
    String? primaryActionLabel = 'Upgrade',
    VoidCallback? onPrimaryAction,
    String? dismissLabel = 'Not now',
    VoidCallback? onDismiss,
    VoidCallback? onManageAction,
  }) =>
      MaterialApp(
        home: Scaffold(
          body: Column(
            children: <Widget>[
              PromoCard(
                show: show,
                label: 'FROM THIS APP',
                title: 'Unlock the full experience',
                message: 'Everything, on every device you use.',
                priceLabel: priceLabel,
                primaryActionLabel: primaryActionLabel,
                onPrimaryAction: onPrimaryAction ?? () {},
                manageLabel: 'Manage plan',
                onManageAction: onManageAction ?? () {},
                dismissLabel: dismissLabel,
                onDismiss: onDismiss ?? () {},
                dismissSemanticLabel: 'Dismiss this offer',
              ),
              const Text('the rest of the page'),
            ],
          ),
        ),
      );

  group('PromoCard — the OFF state is the shipped state', () {
    testWidgets('show:false renders ZERO promotional widgets', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(host(show: false));

      // Not "the title is absent" — EVERY part of it, because a card that lost
      // its heading and kept its buttons would pass a one-string assertion.
      expect(find.text('FROM THIS APP'), findsNothing);
      expect(find.text('Unlock the full experience'), findsNothing);
      expect(find.text('Everything, on every device you use.'), findsNothing);
      expect(find.text(r'$4.99'), findsNothing);
      expect(find.text('Upgrade'), findsNothing);
      expect(find.text('Manage plan'), findsNothing);
      expect(find.text('Not now'), findsNothing);
      expect(find.byType(Card), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
      expect(find.byType(TextButton), findsNothing);
      expect(find.byIcon(Icons.close), findsNothing);

      // …and the page below it is untouched.
      expect(find.text('the rest of the page'), findsOneWidget);
    });

    testWidgets('show:false leaves NO HEIGHT behind — the slot collapses', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(host(show: false));
      // The defect a "findsNothing" test cannot see: a hidden card that still
      // draws its own Padding reserves a strip of dead space at the top of
      // every home screen in the portfolio, forever, and nothing looks wrong
      // enough for anyone to go looking.
      expect(tester.getSize(find.byType(PromoCard)), Size.zero);
    });
  });

  group('PromoCard — the open path', () {
    testWidgets('show:true renders the label, the copy and the price', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(host(show: true));
      expect(find.text('FROM THIS APP'), findsOneWidget);
      expect(find.text('Unlock the full experience'), findsOneWidget);
      expect(find.text('Everything, on every device you use.'), findsOneWidget);
      expect(find.text(r'$4.99'), findsOneWidget);
      expect(
        find.byType(Card),
        findsOneWidget,
        reason: 'the distinct container IS the labelling requirement — Apple '
            '2.5.18, MS 10.10.4 and Play all ask that a promotional surface not '
            'be styled as app content',
      );
    });

    testWidgets('the primary action fires', (WidgetTester tester) async {
      int taps = 0;
      await tester.pumpWidget(host(show: true, onPrimaryAction: () => taps++));
      await tester.tap(find.text('Upgrade'));
      expect(taps, 1);
    });

    testWidgets('the manage entry fires', (WidgetTester tester) async {
      int taps = 0;
      await tester.pumpWidget(host(show: true, onManageAction: () => taps++));
      await tester.tap(find.text('Manage plan'));
      expect(taps, 1);
    });

    testWidgets('both the close icon and the neutral decline dismiss', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await tester.pumpWidget(host(show: true, onDismiss: () => taps++));
      await tester.tap(find.byIcon(Icons.close));
      expect(taps, 1);
      await tester.tap(find.text('Not now'));
      expect(taps, 2);
    });
  });

  group('PromoCard — what the caller can withhold, and what it cannot', () {
    // 🔒 THE ROW THAT KEEPS AN APP OUT OF A REJECTION. `canStartCheckout` is
    // false on ios-appstore, macos-appstore and android-play (ADR 039 D3), and
    // the caller expresses that by passing no primary action. The card must
    // still be a card — refusing to render at all there would delete the
    // manage/cancel entry too, which is the one control that must not go away.
    testWidgets(
      'no primary action ⇒ no buy button, and the card still stands',
      (WidgetTester tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: PromoCard(
                show: true,
                label: 'FROM THIS APP',
                title: 'Unlock the full experience',
                message: 'Not available to buy inside this app.',
                manageLabel: 'Manage plan',
                onManageAction: () {},
              ),
            ),
          ),
        );
        expect(find.byType(FilledButton), findsNothing);
        expect(find.text('Manage plan'), findsOneWidget);
        expect(find.text('Unlock the full experience'), findsOneWidget);
      },
    );

    testWidgets('a label with no callback draws no button', (
      WidgetTester tester,
    ) async {
      // A labelled control that does nothing is worse than no control: the user
      // presses it, nothing happens, and they conclude the app is broken.
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PromoCard(
              show: true,
              label: 'FROM THIS APP',
              title: 'T',
              message: 'M',
              primaryActionLabel: 'Upgrade',
              manageLabel: 'Manage plan',
              onManageAction: () {},
            ),
          ),
        ),
      );
      expect(find.text('Upgrade'), findsNothing);
    });

    testWidgets('no price is a card with no number, not a card with a guess', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(host(show: true, priceLabel: null));
      expect(find.text(r'$4.99'), findsNothing);
      expect(find.text('Unlock the full experience'), findsOneWidget);
    });

    testWidgets('the close icon is not drawn when nothing can name it', (
      WidgetTester tester,
    ) async {
      // An icon-only control with no accessible name is a control a screen
      // reader user does not have. Drawing it silently is worse than omitting
      // it: the neutral text decline below is still reachable either way.
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PromoCard(
              show: true,
              label: 'FROM THIS APP',
              title: 'T',
              message: 'M',
              manageLabel: 'Manage plan',
              onManageAction: () {},
              onDismiss: () {},
            ),
          ),
        ),
      );
      expect(find.byIcon(Icons.close), findsNothing);
    });

    testWidgets('the close control announces itself and not its glyph', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pumpWidget(host(show: true));

      // ⚠️ THE COMPILED TREE, NOT `find.bySemanticsLabel`. That finder reads
      // `renderObject.debugSemantics` — the node one PARTICULAR render object
      // owns — and whether an annotation owns a node or merges into an
      // ancestor's is a property of Flutter's fragment compiler, not of this
      // widget. It went red here on a control that announces perfectly. The
      // same reasoning is written out at length in
      // `apps/subly/test/a11y_semantics_test.dart`; the walk below is what a
      // screen reader actually traverses.
      final List<SemanticsNode> nodes = <SemanticsNode>[];
      void visit(SemanticsNode n) {
        nodes.add(n);
        n.visitChildren((SemanticsNode c) {
          visit(c);
          return true;
        });
      }

      void collect(PipelineOwner owner) {
        final SemanticsNode? root = owner.semanticsOwner?.rootSemanticsNode;
        if (root != null) visit(root);
        owner.visitChildren(collect);
      }

      collect(tester.binding.rootPipelineOwner);
      expect(
        nodes,
        isNotEmpty,
        reason: 'COVERAGE LOST — no semantics tree was compiled, so the '
            'assertion below would be looking at nothing.',
      );

      // The name AND the action on the same reachable node: a label stranded
      // on a node the reader reaches separately from the control is worse than
      // no label, because it reads as a working control.
      expect(
        nodes.any(
          (SemanticsNode n) =>
              n.getSemanticsData().label == 'Dismiss this offer' &&
              n.getSemanticsData().hasAction(SemanticsAction.tap),
        ),
        isTrue,
        reason: 'an icon-only close control that a screen reader cannot name '
            'is a dismissal a user cannot perform, which turns a dismissible '
            'card into an undismissable one for exactly the people least able '
            'to work around it',
      );

      // 🔴 THE OTHER TWO HALVES, AND BOTH WERE REAL FAILING SHAPES OF THIS
      // WIDGET BEFORE THE ONE THAT SHIPPED. Neither is visible from the
      // assertion above, and neither raises an exception or clips a pixel.
      //
      //   · `Semantics + IconButton` under `MergeSemantics` announced the
      //     close control correctly AND left IconButton's own node nested
      //     inside it with an empty name — a NAKED CONTROL by
      //     `apps/subly/test/a11y_semantics_test.dart`'s definition, hiding
      //     inside a control that reads perfectly.
      //   · `Semantics + InkResponse` without the merge put the label and the
      //     tap on the CARD's text node, so the entire 420×172 card became one
      //     activatable thing that announces the whole advertisement.
      final Iterable<SemanticsData> tappable = nodes
          .map((SemanticsNode n) => n.getSemanticsData())
          .where((SemanticsData d) => d.hasAction(SemanticsAction.tap));
      expect(
        tappable.where((SemanticsData d) => d.label.trim().isEmpty),
        isEmpty,
        reason: 'a node a user can activate and cannot identify is announced '
            'as nothing at all',
      );
      expect(
        tappable.where((SemanticsData d) => d.label.contains('\n')),
        isEmpty,
        reason: 'a tappable node carrying several lines of the card\'s copy is '
            'the whole card having become one control — the promotional label, '
            'the headline and the body read out as the name of a button',
      );

      handle.dispose();
    });
  });

  group('PromoCard — the width decision belongs to the chassis', () {
    testWidgets('capped at AppBreakpoints.form on a wide window', (
      WidgetTester tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(1920, 1080));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(host(show: true));
      // The card never spans the display. Nothing overflows and nothing clips
      // when it does, which is why only a measurement can see it.
      expect(
        tester.getSize(find.byType(Card)).width,
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });
  });
}
