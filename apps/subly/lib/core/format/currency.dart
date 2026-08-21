import 'package:intl/intl.dart';

/// Formats a stored amount under the user's chosen symbol. It RE-SYMBOLS ONLY —
/// it does not convert, and there is deliberately no rate table here any more.
///
/// 🔴 A hardcoded FX table (`{$:1.0, €:0.92, £:0.79, ₹:83.0}`) used to multiply
/// EVERY displayed figure, so the Settings currency switcher visibly changed
/// each number. That was a design-demo behaviour, and it stopped being
/// acceptable the moment this app was served at a public URL rather than shown
/// as a mockup: the stored value carries no currency of its own, so a user in
/// India who picked ₹ and typed 499 for a plan costing ₹499 was shown
/// **₹41,417** (499 × 83). Re-symboling shows back exactly what was typed,
/// which is the only thing this class can honestly claim to know.
///
/// ⚠️ The price of that honesty: a cross-currency TOTAL stays impossible. Two
/// prices entered under different symbols are unlike units, and no rate table
/// repairs that, because the unit was never recorded alongside the number.
/// The fix is a currency stored PER SUBSCRIPTION; that is a later increment.
/// Until it lands, do not re-introduce a rate table to make the totals "work".
class Currency {
  const Currency(this.symbol);
  final String symbol;

  static final NumberFormat _f2 = NumberFormat('#,##0.00', 'en_US');
  static final NumberFormat _f0 = NumberFormat('#,##0', 'en_US');

  String fmt(double n) => '$symbol${_f2.format(n)}';
  String fmt0(double n) => '$symbol${_f0.format(n)}';
}
