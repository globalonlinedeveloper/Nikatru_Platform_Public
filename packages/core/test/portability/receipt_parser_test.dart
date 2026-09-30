import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

import 'test_fields.dart';

// Pure and inline — no fixture file — so the chrome lane runs every case too.

const ReceiptFieldIds _ids = ReceiptFieldIds(
  seller: 'name',
  amount: 'price',
  currency: 'currency',
  date: 'next_renewal',
  period: 'cycle',
);

ImportPlan _plan(
  String text, {
  String? defaultCurrency,
  DateOrder? dateOrder,
  Iterable<String> existingKeys = const <String>[],
}) => ReceiptParser.plan(
  text,
  fields: TestFields.all,
  ids: _ids,
  keyOf: testKey,
  defaultCurrency: defaultCurrency,
  dateOrder: dateOrder,
  existingKeys: existingKeys,
);

/// A hand-authored ₹ receipt in the shape Indian mail and SMS receipts take:
/// a title, the seller, line items, tax, and a total inclusive of GST.
const String _rupeeReceipt = '''
Payment Receipt
Netflix
Order ID 4839201775
Date: 12 Sep 2026
Plan: Premium (Monthly)
Subtotal ₹550.00
GST @18% ₹99.00
Total (incl. GST) ₹649.00
Paid via UPI
''';

void main() {
  group('the RED control — a ₹ receipt is one candidate', () {
    test('price, currency and date are read into ONE ImportPlan candidate', () {
      final ImportPlan p = _plan(_rupeeReceipt);
      expect(p.rowCount, 1);
      expect(p.errors, isEmpty, reason: '${p.errors.map((e) => e.problems)}');
      expect(p.candidates, hasLength(1));
      final ImportCandidate c = p.candidates.single;
      expect(c.money('price'), Money(64900, 'INR'));
      expect(c.text('currency'), 'INR');
      expect(c.date('next_renewal'), DateTime.utc(2026, 9, 12));
      expect(c.text('name'), 'Netflix');
      expect(c.text('cycle'), 'monthly');
      expect(p.accountedFor, p.rowCount);
    });

    test('the subtotal and the tax are offered, never charged', () {
      final ReceiptReading r = ReceiptParser.read(_rupeeReceipt);
      expect(r.amount, '₹649.00');
      expect(r.amounts, <String>['₹550.00', '₹99.00', '₹649.00']);
    });

    test('a "Total GST" line after the total is still not the charge', () {
      // Without the tax rule this line ranks as a total and, being last, wins.
      final ReceiptReading r = ReceiptParser.read(
        'Netflix\nTotal ₹649.00\nTotal GST ₹99.00',
      );
      expect(r.amount, '₹649.00');
    });

    test('the grand total outranks an earlier "Amount" line', () {
      final ReceiptReading r = ReceiptParser.read(
        'Netflix\nGrand total ₹649.00\nAmount ₹550.00',
      );
      expect(r.amount, '₹649.00');
    });
  });

  group('it does not guess', () {
    test('a slash date whose order nothing settles is ASKED, not read', () {
      final ImportPlan p = _plan('Spotify\n03/04/2026\nTotal ₹119');
      expect(p.candidates, isEmpty);
      expect(p.awaiting, <int>[1]);
      expect(p.questions.single, isA<DateOrderQuestion>());
      final ImportPlan answered = _plan(
        'Spotify\n03/04/2026\nTotal ₹119',
        dateOrder: DateOrder.dayFirst,
      );
      expect(
        answered.candidates.single.date('next_renewal'),
        DateTime.utc(2026, 4, 3),
      );
    });

    test(
      r'`$` names no currency: the default prices it, or the row is refused',
      () {
        const String text = 'Acme Cloud\nAmount charged \$9.99\nAug 3, 2026';
        expect(ReceiptParser.read(text).currencyCode, isNull);
        final ImportPlan priced = _plan(text, defaultCurrency: 'USD');
        expect(priced.candidates.single.money('price'), Money(999, 'USD'));
        expect(
          priced.candidates.single.date('next_renewal'),
          DateTime.utc(2026, 8, 3),
        );
        final ImportPlan refused = _plan(text);
        expect(refused.candidates, isEmpty);
        expect(refused.errors.single.problems.single.fieldId, 'price');
      },
    );

    test('Rs names the rupee family, so a euro default is refused', () {
      final ImportPlan p = _plan(
        'Hotstar\nTotal Rs. 1,499/-',
        defaultCurrency: 'EUR',
      );
      expect(p.candidates, isEmpty);
      expect(p.errors.single.problems.single.fieldId, 'price');
      final ImportPlan ok = _plan(
        'Hotstar\nTotal Rs. 1,499/-',
        defaultCurrency: 'INR',
      );
      expect(ok.candidates.single.money('price'), Money(149900, 'INR'));
    });

    test('two different unlabelled amounts are offered, not chosen', () {
      final ReceiptReading r = ReceiptParser.read(
        'Some Shop\nWidget €4.00\nGadget €6.50',
      );
      expect(r.amount, isNull);
      expect(r.amounts, <String>['€4.00', '€6.50']);
      final ImportPlan p = _plan('Some Shop\nWidget €4.00\nGadget €6.50');
      expect(p.errors.single.problems.single.fieldId, 'price');
      expect(p.accountedFor, 1, reason: 'an unread receipt is an error row');
    });

    test('a three-letter word is a currency only when it is a known code', () {
      final ReceiptReading r = ReceiptParser.read(
        'Seller: Example Ltd\nGST 98.82\nTotal INR 647.82',
      );
      expect(r.seller, 'Example Ltd');
      expect(r.amount, 'INR 647.82');
      expect(r.currencyCode, 'INR');
    });

    test('monthly and yearly both named: no period', () {
      expect(
        ReceiptParser.read(
          'X\n₹99 per month or ₹999 per year\nTotal ₹99',
        ).period,
        isNull,
      );
    });
  });

  test('a receipt the caller already has is a duplicate, not a candidate', () {
    final String key = ImportPlan.keyFor(
      name: 'netflix',
      price: Money(64900, 'INR'),
      cycle: 'monthly',
    );
    final ImportPlan p = _plan(_rupeeReceipt, existingKeys: <String>[key]);
    expect(p.candidates, isEmpty);
    expect(p.duplicates, hasLength(1));
  });
}
