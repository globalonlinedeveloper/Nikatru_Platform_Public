import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/e2e_keys.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../data/seed/demo_data.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/widgets.dart';

Future<void> showAddSubscriptionSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    // The only caller is AppShell's FAB, whose context sits ABOVE the branch
    // navigators — so this sheet already mounted on the root navigator, by
    // accident of who happened to call it. Stating it makes the root-level
    // mount a property of the sheet rather than of its caller.
    useRootNavigator: true,
    backgroundColor: Colors.transparent,
    builder: (_) => const _AddSheet(),
  );
}

class _AddSheet extends ConsumerStatefulWidget {
  const _AddSheet();

  @override
  ConsumerState<_AddSheet> createState() => _AddSheetState();
}

class _AddSheetState extends ConsumerState<_AddSheet> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _price = TextEditingController();
  BillingCycle _cycle = BillingCycle.monthly;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final Subscription draft = Subscription(
      id: '',
      name: _name.text.trim(),
      category: 'Other',
      price: double.tryParse(_price.text.trim()) ?? 9.99,
      cycle: _cycle,
      nextRenewal: DateTime.now().add(const Duration(days: 12)),
    );
    // Resolved BEFORE the await. Reaching through `context` after an async gap
    // is only safe while the element is still mounted, and the failure branch
    // below is precisely the case where that is in doubt.
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(subscriptionsControllerProvider.notifier)
          .addSubscription(draft);
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      // 🔴 THIS FAILURE PATH DID NOT EXIST. `addSubscription` goes through the
      // repository to the network, so one offline moment threw out of an
      // unawaited future: nothing caught it, `_saving` was never cleared, and
      // the button sat disabled on 'Adding…' forever with no message. The only
      // way out was to swipe the sheet away and retype everything.
      //
      // Same surface the sign-in screen uses (ScaffoldMessenger + SnackBar), and
      // the sheet deliberately STAYS UP so the typed draft survives — a retry
      // costs one tap, not a re-entry.
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Could not add that subscription — check your connection and try again.',
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.86,
        ),
        decoration: const BoxDecoration(
          color: AppColors.bg,
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.line,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Add subscription',
                style: AppText.title.copyWith(fontSize: 22),
              ),
              const SizedBox(height: 14),
              Text('POPULAR', style: AppText.label),
              const SizedBox(height: 9),
              // 🔴 THE COLUMN COUNT IS DERIVED, NOT DECLARED. This was
              // `GridView.count(crossAxisCount: 4)` — four columns is a PHONE
              // decision, and the sheet is not phone-only: M3 caps a modal
              // sheet at 640, so from a small tablet upward the same four
              // columns split 604 px of content into 144 px tiles. These are
              // glyph chips drawn at 78 px on a phone; at 144 they render at
              // nearly double size and push the POPULAR block to ~361 px of
              // sheet height before the form starts.
              //
              // `maxCrossAxisExtent: 96` keeps the tile chip-sized at every
              // width and lets the count follow: at 375 the content is 339 →
              // ceil(339 / (96 + 9)) = 4 columns of exactly 78 px, so the
              // PHONE RENDERING IS PIXEL-IDENTICAL TO WHAT SHIPPED — that is
              // the property, and any extent in (84.75, 113] preserves it. At
              // 640 the content is 604 → 6 columns of 93.2.
              //
              // Contrast the calendar grid, where `crossAxisCount: 7` is
              // SEMANTIC (days of the week) and must stay fixed.
              // `width_add_sheet_test.dart` pins 96 and both endpoints.
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                  maxCrossAxisExtent: 96,
                  mainAxisSpacing: 9,
                  crossAxisSpacing: 9,
                  childAspectRatio: 0.82,
                ),
                itemCount: DemoData.popular.length,
                itemBuilder: (BuildContext context, int i) {
                  final List<String> p = DemoData.popular[i];
                  return GestureDetector(
                    onTap: () => _name.text = p[0],
                    child: Column(
                      children: <Widget>[
                        Expanded(
                          child: Container(
                            width: double.infinity,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(13),
                              gradient: const LinearGradient(
                                colors: <Color>[
                                  Color.fromRGBO(100, 89, 245, 0.13),
                                  Color.fromRGBO(155, 107, 255, 0.13),
                                ],
                              ),
                            ),
                            child: Text(
                              p[1],
                              style: const TextStyle(
                                fontFamily: 'Space Grotesk',
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                                color: AppColors.accent,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          p[0],
                          style: AppText.muted.copyWith(fontSize: 10),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  );
                },
              ),
              const SizedBox(height: 16),
              Text('NAME', style: AppText.label),
              const SizedBox(height: 6),
              _input(_name, 'e.g. Hulu', fieldKey: E2EKeys.addName),
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text('PRICE', style: AppText.label),
                        const SizedBox(height: 6),
                        _input(
                          _price,
                          '9.99',
                          keyboard: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          fieldKey: E2EKeys.addPrice,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text('CYCLE', style: AppText.label),
                        const SizedBox(height: 6),
                        Row(
                          children: <Widget>[
                            _cycleBtn('Monthly', BillingCycle.monthly),
                            const SizedBox(width: 6),
                            _cycleBtn('Yearly', BillingCycle.yearly),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                children: <Widget>[
                  SoftButton(
                    label: 'Cancel',
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: GradientButton(
                      key: E2EKeys.addSubmit,
                      label: _saving ? 'Adding…' : 'Add subscription',
                      onPressed: _saving ? null : _save,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _cycleBtn(String label, BillingCycle cycle) {
    final bool sel = _cycle == cycle;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _cycle = cycle),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 15),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            gradient: sel ? AppColors.brandGradient : null,
            color: sel ? null : AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: sel ? Colors.transparent : AppColors.line,
            ),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontFamily: 'Manrope',
              fontWeight: FontWeight.w700,
              fontSize: 13,
              color: sel ? Colors.white : AppColors.ink,
            ),
          ),
        ),
      ),
    );
  }

  Widget _input(
    TextEditingController c,
    String hint, {
    TextInputType keyboard = TextInputType.text,
    Key? fieldKey,
  }) {
    return TextField(
      key: fieldKey,
      controller: c,
      keyboardType: keyboard,
      style: AppText.body.copyWith(fontWeight: FontWeight.w600),
      decoration: InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 15,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: AppColors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: AppColors.accent, width: 1.5),
        ),
      ),
    );
  }
}
