// The FRAME's own contract, independent of any app wiring: a promotional
// surface is labelled, it is distinct, and it carries the Art 21 objection —
// and there is no way to render the creative without either.
//
// The app-level proof that an objection means zero renders lives in
// `apps/subly/test/promo_objection_surface_test.dart` and its brick twin. This
// file is the layer below: those tests would still pass if the frame quietly
// dropped its label or its control, because neither is what they assert on.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const String _creative = 'promotional creative';

Widget _host({
  required bool show,
  required bool objected,
  ValueChanged<bool>? onChanged,
}) =>
    MaterialApp(
      home: Scaffold(
        body: PromoSurface(
          show: show,
          objected: objected,
          onObjectionChanged: onChanged ?? (_) {},
          child: const Text(_creative),
        ),
      ),
    );

void main() {
  group('PromoSurface', () {
    testWidgets('renders NOTHING when the caller says no', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(show: false, objected: false));
      expect(find.text(_creative), findsNothing);
      expect(
        find.byKey(PromoSurface.rootKey),
        findsNothing,
        reason:
            'not an empty frame and not a collapsed container — an objection '
            'ends the surface rather than emptying it, and a labelled box with '
            'nothing in it is still a promotional surface on screen',
      );
      expect(
        find.byKey(PromoObjectionControl.actionKey),
        findsNothing,
        reason:
            'and the control goes with it. A stop-offers button floating on a '
            'screen with no offer on it is a control for nothing',
      );
    });

    testWidgets('a rendered surface ALWAYS carries the label and the control', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(show: true, objected: false));
      expect(find.text(_creative), findsOneWidget);
      expect(
        find.text('Promotion'),
        findsOneWidget,
        reason: 'one chassis rule satisfies Apple 2.5.18, Microsoft 10.10.4, '
            "Play's native-ads trigger and India's Disguised Advertisement "
            'pattern at once. An unlabelled promotional surface is forbidden '
            'in all configurations (research/44 V5)',
      );
      expect(
        find.byKey(PromoObjectionControl.rootKey),
        findsOneWidget,
        reason:
            'Art 21(4) wants the objection presented at the LATEST at the time '
            'of the first communication. There is deliberately no constructor '
            'argument that renders the creative without it — passing the '
            'obligation as a parameter is how it becomes optional in practice',
      );
    });

    testWidgets('the container is visually distinct from app content', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(show: true, objected: false));
      final Container box = tester.widget<Container>(
        find.byKey(PromoSurface.rootKey),
      );
      final BoxDecoration d = box.decoration! as BoxDecoration;
      expect(
        d.border,
        isNotNull,
        reason:
            '"clearly distinguishable from other content" is a claim about how '
            'the surface reads NEXT TO the app, so the frame does not inherit '
            "whatever the host app decided its own cards look like",
      );
    });

    testWidgets('🔴 IT REFUSES TO RENDER TO SOMEONE IT WAS TOLD HAS OBJECTED', (
      WidgetTester tester,
    ) async {
      // `show: true, objected: true` is a CONTRADICTION, and it is reachable:
      // `PromoGateVerdict.suppressedByUser` outranks everything, so the only
      // way to produce it is a caller that reached `PromoGate.decide` without
      // projecting the rail first — the bypass limbs 5/6 of
      // assert-consent-withdrawal-surface.mjs now fail the build for.
      //
      // The frame used to gate on `!show` alone and trust the caller. That is a
      // fail-OPEN leaf in a control whose entire purpose is a legal stop: the
      // one caller shape that can construct this is precisely the one that has
      // already been shown not to consult the objection.
      //
      // 🔬 AND THIS IS WHY THERE IS NO `assert` IN THE CONSTRUCTOR. One was
      // written first. It throws in every debug build — which is every widget
      // test — so THIS CASE could not exist: the refusal that matters in release
      // would have had no evidence behind it at all. The loud half is
      // `assert-consent-withdrawal-surface.mjs` limbs 5/6, which fail the build
      // for the only caller shape that can construct this.
      await tester.pumpWidget(_host(show: true, objected: true));
      expect(find.text(_creative), findsNothing);
      expect(find.byKey(PromoSurface.rootKey), findsNothing);
      expect(find.text('Promotion'), findsNothing);
    });

    testWidgets('the objection travels out of the frame', (
      WidgetTester tester,
    ) async {
      final List<bool> raised = <bool>[];
      await tester.pumpWidget(
        _host(show: true, objected: false, onChanged: raised.add),
      );
      await tester.tap(find.byKey(PromoObjectionControl.actionKey));
      expect(raised, <bool>[true]);
    });
  });

  group('PromoObjectionControl', () {
    testWidgets('it reflects its state and offers the way back', (
      WidgetTester tester,
    ) async {
      final List<bool> raised = <bool>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PromoObjectionControl(
              objected: true,
              onChanged: raised.add,
            ),
          ),
        ),
      );
      expect(
        find.text('Offers are off.'),
        findsOneWidget,
        reason: 'a control whose state the user cannot see is a button that '
            'appears to do nothing — the same limb assert-consent-withdrawal-'
            'surface.mjs enforces for the analytics row',
      );
      expect(find.text('Stop showing offers'), findsNothing);

      await tester.tap(find.byKey(PromoObjectionControl.actionKey));
      expect(
        raised,
        <bool>[false],
        reason:
            'Art 21 gives a right to object, not a duty to stay objected. A '
            'control that only travels one way is a trap',
      );
    });

    testWidgets(
        '🔴 WHILE THE RAIL IS UNREAD IT CLAIMS NOTHING AND CANNOT BE '
        'TAPPED', (WidgetTester tester) async {
      // A promotional SURFACE must read "not loaded yet" as objected — showing
      // an offer against an objection nobody has read is what Art 21(3) forbids.
      // A CONTROL that reads the same boolean tells a person who has never
      // objected "Offers are off" on every visit to Settings, and a tap in that
      // window records — and uploads — a `promo granted: true` artifact for a
      // withdrawal they never made. Falling closed protects them from a card; it
      // does not license a claim about what they chose.
      final List<bool> raised = <bool>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: PromoObjectionControl(
              // The fail-closed value the card gets, with `known: false`.
              objected: true,
              known: false,
              onChanged: raised.add,
            ),
          ),
        ),
      );
      expect(find.text('Offers are off.'), findsNothing);
      expect(find.text('Show offers again'), findsNothing);
      expect(find.text('Stop showing offers'), findsNothing);
      expect(
        find.byKey(PromoObjectionControl.actionKey),
        findsNothing,
        reason: 'nothing to tap means nothing to forge',
      );
      expect(
        find.byKey(PromoObjectionControl.rootKey),
        findsOneWidget,
        reason: 'the row is still reserved, so the settings screen does not '
            'jump when the rail lands — and a test can SEE this window rather '
            'than pump past it',
      );
      expect(raised, isEmpty);
    });

    testWidgets('one key drives it in both states', (
      WidgetTester tester,
    ) async {
      for (final bool objected in <bool>[false, true]) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: PromoObjectionControl(
                objected: objected,
                onChanged: (_) {},
              ),
            ),
          ),
        );
        expect(
          find.byKey(PromoObjectionControl.actionKey),
          findsOneWidget,
          reason:
              'a test that had to know which state it was in before it could '
              'find the control would be asserting on the implementation '
              'rather than on the affordance',
        );
      }
    });
  });
}
