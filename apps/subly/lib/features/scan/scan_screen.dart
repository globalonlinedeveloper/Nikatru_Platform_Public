import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/painters.dart';
import '../shared/widgets.dart';

/// First-run setup screen. It loads subscriptions from the repository and
/// prepares the derived views, and the step labels now say exactly that.
///
/// 2026-07-27 - these labels previously read "Connecting to accounts",
/// "Reading bank statements", "Scanning inbox receipts", "Matching merchants",
/// "Detecting recurring charges". The app does NONE of those: there is no bank
/// or mail integration anywhere in the dependency graph, and this widget is a
/// timer over a fixed list. Telling a user their bank statements are being read
/// when they are not is a false claim about access to financial data, and a
/// store-submission and payment-processor risk on top of that. If real import is
/// ever built, these labels earn their way back one at a time, as each becomes
/// true.
class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  static const List<String> _steps = <String>[
    'Preparing your board',
    'Loading your subscriptions',
    'Building your renewal calendar',
    'Working out your totals',
    'Finalising',
  ];

  Timer? _timer;
  int _step = 0;
  int _pct = 0;
  String _status = 'Setting things up';
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 560), (Timer t) {
      if (_step < _steps.length) {
        setState(() {
          _status = _steps[_step];
          _pct = (((_step + 1) / _steps.length) * 100).round();
          _step++;
        });
      } else {
        t.cancel();
        setState(() => _done = true);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
            const <Subscription>[];
    final double total = SubMath.totalMonthly(subs);

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(_done ? 'All set' : 'Setting up your board',
                  style: AppText.title.copyWith(fontSize: 28)),
              const SizedBox(height: 6),
              Text(
                _done
                    ? 'Your subscriptions. Add or edit any time.'
                    : 'This only takes a moment.',
                style: AppText.muted.copyWith(fontSize: 14),
              ),
              const SizedBox(height: 8),
              Expanded(child: _done ? _results(currency, subs, total) : _scanning()),
              const SizedBox(height: 12),
              GradientButton(
                label: _done ? 'Go to dashboard' : 'Scanning…',
                onPressed: _done ? () => context.go('/home') : null,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _scanning() {
    // Center, not just Column(mainAxisAlignment: center). The PARENT column uses
    // CrossAxisAlignment.start, so this child is never stretched - it shrink-wrapped
    // to the 158px ring and sat hard against the left edge. mainAxisAlignment only
    // centred it vertically, which is why it looked half-right: centred down the
    // page, pinned to the left across it. Center() takes the full available width.
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          SizedBox(
            width: 158,
            height: 158,
            child: CustomPaint(
              painter: RingPainter(
                  progress: _pct / 100, color: AppColors.accent, stroke: 14),
              child: Center(
                child: Text('$_pct%', style: AppText.fig.copyWith(fontSize: 34)),
              ),
            ),
          ),
          const SizedBox(height: 28),
          SizedBox(
            width: 200,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: _pct / 100,
                minHeight: 6,
                backgroundColor: AppColors.line,
                color: AppColors.accent,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(_status, style: AppText.muted.copyWith(fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  Widget _results(Currency currency, List<Subscription> subs, double total) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Container(
          margin: const EdgeInsets.symmetric(vertical: 16),
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: AppColors.brandGradient,
            borderRadius: BorderRadius.circular(22),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('YOUR SUBSCRIPTIONS',
                  style: AppText.label.copyWith(
                      color: const Color.fromRGBO(255, 255, 255, 0.85))),
              const SizedBox(height: 4),
              Text('${subs.length} subscriptions',
                  style: AppText.fig.copyWith(fontSize: 34, color: Colors.white)),
              Text('${currency.fmt(total)} / month',
                  style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                      color: Color.fromRGBO(255, 255, 255, 0.92))),
            ],
          ),
        ),
        Expanded(
          child: ListView.separated(
            itemCount: subs.length,
            separatorBuilder: (_, __) => const SizedBox(height: 9),
            itemBuilder: (BuildContext context, int i) {
              final Subscription s = subs[i];
              return RowCard(
                padding: 11,
                leading: GlyphTile(glyph: s.glyph, size: 38, fontSize: 11),
                title: s.name,
                subtitle: Text(s.category, style: AppText.muted.copyWith(fontSize: 12)),
                trailing: Text(currency.fmt(s.monthlyPrice),
                    style: AppText.fig.copyWith(fontSize: 15)),
              );
            },
          ),
        ),
      ],
    );
  }
}
