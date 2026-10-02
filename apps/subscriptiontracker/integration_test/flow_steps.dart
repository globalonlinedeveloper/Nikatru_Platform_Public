// ─────────────────────────────────────────────────────────────────────────────
// THE USER FLOWS, WALKED THROUGH THE UI AND READ BACK FROM THE SERVER
// (train st-e2e-parity · EN-07 / EN-08 / XP-02).
//
// One file for both suites: the native leg (native_auth_proof_test.dart, every
// device target) walks the core flow; the web leg (app_test.dart) walks it and
// every other changed flow. Each step taps the real control and then asserts
// BEHAVIOUR — the row the live Worker answers, the prefs the platform Worker
// answers, the feed the public route serves — never only that a widget showed.
//
// The steps take the caller's pump ([FlowPump]) rather than pumping on their
// own: the web suite's `pumpFor` is the test-epoch-guarded loop its header
// explains (#362), and a step that pumped around it would bring back the
// `inTest is not true` nights.
//
// Each native step prints the NK_PROOF line [kCoreFlowLines] names, and
// tooling/e2e/native_auth_proof.mjs (CORE_FLOW_LINES) fails a run whose suite
// walks the flow and whose output lacks any of them. tooling/e2e-leg-register.json
// `flows` anchors each flow here or in the suite that calls it.
//
// ⚠️ STATED LIMIT: "the server row" is read through the app's own repository,
// i.e. `CachedApiClient` over the live Worker. It answers from the device store
// only when the transport FAILS (status 0), so a read here that returned a
// stale cached row would need the network to be down mid-run — and then the
// next write in the same step would fail first.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:dio/dio.dart' show Dio, Options, Response;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/insights/budget_card.dart';
import 'package:subscriptiontracker/features/insights/budget_editor.dart';
import 'package:subscriptiontracker/state/providers.dart';

/// The caller's wall-clock pump (app_test.dart's guarded `pumpFor`, or the
/// native suite's plain one).
typedef FlowPump = Future<void> Function(WidgetTester tester, Duration total);

/// The lines the native core flow prints, in order. The driver
/// (tooling/e2e/native_auth_proof.mjs CORE_FLOW_LINES) requires every one.
const List<String> kCoreFlowLines = <String>[
  'NK_PROOF step=core-add outcome=ok',
  'NK_PROOF step=core-read-back outcome=ok',
  'NK_PROOF step=core-edit-price outcome=ok',
  'NK_PROOF step=core-pause outcome=ok',
  'NK_PROOF step=core-delete-undo outcome=ok',
  'NK_PROOF step=core-delete outcome=ok',
];

/// PARKED (lead ruling on #1143, 2026-10-02): what the native suite prints in
/// place of [kCoreFlowLines] (and the notification tap) when it is built with
/// NK_PROOF_PENDING_FLOWS=skip. tooling/e2e/native_auth_proof.mjs
/// CORE_FLOW_PENDING_LINE is the other copy; the driver requires it.
const String kCoreFlowPendingLine =
    'NK_PROOF step=core-flow outcome=pending row=O-E2E-CORE-FLOW-LEGS-PENDING';

/// The web suite's line for the same park (E2E_PENDING_FLOWS=skip): the 14d
/// changed-flow walk is skipped and SAID, never silently absent.
const String kWebFlowsPendingLine =
    'NK_E2E step=flows outcome=pending row=O-E2E-CORE-FLOW-LEGS-PENDING';

/// Prints [line] AND records it in `reportData` under `e2e_lines`, which
/// test_driver/integration_test.dart prints HOST-SIDE into the tee'd drive log.
///
/// 🔬 E2E 36994942854 (c30850ff): the web walk passed and the run went red at
/// `sign_in_via.mjs --grade` — "the drive printed no sign-in line at all". On
/// web a `debugPrint` lands in the BROWSER console, which nothing copies to the
/// drive log (consent.dart `publishConsent` measured the same for the consent
/// id), so every `NK_E2E` line the graders read must travel this way.
void e2eLine(IntegrationTestWidgetsFlutterBinding binding, String line) {
  debugPrint(line);
  binding.reportData ??= <String, dynamic>{};
  final Object? prior = binding.reportData!['e2e_lines'];
  binding.reportData!['e2e_lines'] = <String>[
    if (prior is List) ...prior.whereType<String>(),
    line,
  ];
}

/// The notification-tap leg's lines: the host taps the notification titled
/// [kTapProofTitle] once the suite prints [kAwaitNotificationMarker].
const String kAwaitNotificationMarker = 'NK_PROOF_AWAIT_NOTIFICATION';
const String kTapProofTitle = 'NK tap proof';
const String kNotificationTapOkLine =
    'NK_PROOF step=notification-tap outcome=ok';

/// The running app's provider container, from any mounted element under it.
ProviderContainer appContainer() {
  final Iterable<Element> under = find.byType(Scaffold).evaluate();
  if (under.isEmpty) fail('no Scaffold is mounted — the app is not running');
  return ProviderScope.containerOf(under.first, listen: false);
}

/// Every text on screen, for a failure message.
String flowOnScreen() => find
    .byType(RichText)
    .evaluate()
    .map((Element e) => (e.widget as RichText).text.toPlainText())
    .where((String s) => s.trim().isNotEmpty)
    .take(40)
    .join(' | ');

/// Pumps through [pumpFor] until [ok] holds, for at most [timeout].
Future<bool> pumpUntil(
  WidgetTester tester,
  FlowPump pumpFor,
  bool Function() ok, {
  Duration timeout = const Duration(seconds: 20),
}) async {
  final DateTime end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    if (ok()) return true;
    await pumpFor(tester, const Duration(milliseconds: 250));
  }
  return ok();
}

/// Every row the live Worker holds for this user, through the app's
/// repository (see the STATED LIMIT above).
Future<List<Subscription>> serverRows(WidgetTester tester) async {
  final List<Subscription>? rows = await tester.runAsync(
    () => appContainer().read(subscriptionRepositoryProvider).fetchAll(),
  );
  return rows ?? const <Subscription>[];
}

/// Re-reads the list from the live Worker until [ok] holds for the row named
/// [name] (null when absent), for at most [timeout]. Returns the last read.
Future<Subscription?> serverRowWhere(
  WidgetTester tester,
  FlowPump pumpFor,
  String name,
  bool Function(Subscription? row) ok, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  final DateTime end = DateTime.now().add(timeout);
  Subscription? row;
  while (true) {
    final List<Subscription> all =
        await tester.runAsync(
          () => appContainer().read(subscriptionRepositoryProvider).fetchAll(),
        ) ??
        const <Subscription>[];
    row = null;
    for (final Subscription s in all) {
      if (s.name == name) row = s;
    }
    if (ok(row) || !DateTime.now().isBefore(end)) return row;
    await pumpFor(tester, const Duration(seconds: 1));
  }
}

/// Taps [f] once a tap on it would land, failing with what is on screen.
Future<void> tapLanding(
  WidgetTester tester,
  FlowPump pumpFor,
  Finder f,
  String what,
) async {
  expect(
    await pumpUntil(
      tester,
      pumpFor,
      () => f.evaluate().isNotEmpty,
      timeout: const Duration(seconds: 15),
    ),
    isTrue,
    reason: '$what never showed. On screen: ${flowOnScreen()}',
  );
  await tester.ensureVisible(f.first);
  await pumpFor(tester, const Duration(milliseconds: 300));
  // 🔬 WEB E2E 36987311361: the edit sheet's submit was inside the viewport
  // after `ensureVisible` and still not hit-testable — `ensureVisible` scrolls
  // the MINIMUM into the viewport rect and knows nothing about what is painted
  // over its bottom edge (app_test.dart `tapWhenHittable` tells the history).
  // So drive the scroll view holding [f] a little further while the hit test
  // misses, then wait for the control to be enabled before tapping.
  final Finder holder = find.ancestor(
    of: f.first,
    matching: find.byType(Scrollable),
  );
  for (int i = 0; i < 15; i++) {
    if (f.first.hitTestable().evaluate().isNotEmpty) break;
    if (holder.evaluate().isEmpty) break;
    await tester.drag(holder.first, const Offset(0, -120), warnIfMissed: false);
    await pumpFor(tester, const Duration(milliseconds: 250));
  }
  expect(
    await pumpUntil(
      tester,
      pumpFor,
      () => _enabled(f.first),
      timeout: const Duration(seconds: 15),
    ),
    isTrue,
    reason: '$what stayed disabled. On screen: ${flowOnScreen()}',
  );
  expect(
    f.first.hitTestable(),
    findsOneWidget,
    reason:
        '$what is covered, so a tap would not land. On screen: '
        '${flowOnScreen()}',
  );
  await tester.tap(f.first);
  await pumpFor(tester, const Duration(milliseconds: 500));
}

/// Whether the button [f] finds (if it is one) would act on a tap: a
/// `ButtonStyleButton` with a null `onPressed` swallows the tap silently.
bool _enabled(Finder f) {
  final Iterable<Element> els = f.evaluate();
  if (els.isEmpty) return false;
  final Widget w = els.first.widget;
  return w is! ButtonStyleButton || w.onPressed != null;
}

/// Scrolls Home until the row named [name] shows, then opens it.
Future<void> openRowOnHome(
  WidgetTester tester,
  FlowPump pumpFor,
  String name,
) async {
  final Finder row = find.text(name);
  final Finder list = find.descendant(
    of: find.byType(HomeScreen),
    matching: find.byType(Scrollable),
  );
  for (int i = 0; i < 40 && row.hitTestable().evaluate().isEmpty; i++) {
    if (list.evaluate().isEmpty) break;
    await tester.drag(list.first, const Offset(0, -200), warnIfMissed: false);
    await pumpFor(tester, const Duration(milliseconds: 300));
  }
  await tapLanding(tester, pumpFor, row, 'the row "$name" on Home');
  await pumpFor(tester, const Duration(seconds: 2));
}

/// Back from the detail to Home, where the layout has a back control (a phone
/// layout pushes the detail; a wide one shows it in a pane beside the list).
Future<void> backToHome(WidgetTester tester, FlowPump pumpFor) async {
  final Finder back = find.byKey(E2EKeys.detailBack);
  if (back.hitTestable().evaluate().isNotEmpty) {
    await tester.tap(back.first);
    await pumpFor(tester, const Duration(seconds: 2));
  }
}

/// The detail's More options, then the action labelled [label].
Future<void> moreOption(
  WidgetTester tester,
  FlowPump pumpFor,
  String label,
) async {
  await tapLanding(
    tester,
    pumpFor,
    find.byKey(E2EKeys.detailMoreOptions),
    'the detail\'s More options',
  );
  await tapLanding(tester, pumpFor, find.text(label).last, '"$label"');
  await pumpFor(tester, const Duration(seconds: 3));
}

/// ADD: the add sheet, as a person fills it, closed by its own submit.
Future<void> addPlanThroughSheet(
  WidgetTester tester,
  FlowPump pumpFor, {
  required String name,
  required String price,
  bool weekly = false,
}) async {
  await tapLanding(tester, pumpFor, find.byKey(E2EKeys.fabAdd), 'Add (+)');
  await pumpFor(tester, const Duration(seconds: 1));
  // 🔬 NATIVE PROOF 36987269922, ALL FIVE TARGETS: `enterText(addName)` threw
  // `Bad state: No element`. ST-T9 (AD-03, #1130) opens an ADD on a PICK step
  // (catalogue search, "Add by hand"); the form carrying `addName` is one tap
  // further — the web suite's `openAddFormByHand` already walks it.
  await tapLanding(
    tester,
    pumpFor,
    find.byKey(E2EKeys.addByHand),
    'the pick step\'s "Add by hand"',
  );
  expect(
    await pumpUntil(
      tester,
      pumpFor,
      () => find.byKey(E2EKeys.addName).evaluate().isNotEmpty,
      timeout: const Duration(seconds: 10),
    ),
    isTrue,
    reason:
        '"Add by hand" did not open the add form. On screen: '
        '${flowOnScreen()}',
  );
  await tester.enterText(find.byKey(E2EKeys.addName), name);
  await tester.enterText(find.byKey(E2EKeys.addPrice), price);
  if (weekly) {
    // The cadence dropdown reads its value ("Monthly") until changed.
    await tapLanding(tester, pumpFor, find.text('Monthly').last, 'the cadence');
    await tapLanding(tester, pumpFor, find.text('Weekly').last, '"Weekly"');
  }
  await submitSheet(tester, pumpFor, 'the add sheet for "$name"');
}

/// The add/edit sheet's submit, and the sheet gone.
Future<void> submitSheet(
  WidgetTester tester,
  FlowPump pumpFor,
  String what,
) async {
  await tapLanding(
    tester,
    pumpFor,
    find.byKey(E2EKeys.addSubmit),
    'the submit of $what',
  );
  expect(
    await pumpUntil(
      tester,
      pumpFor,
      () => find.byKey(E2EKeys.addSubmit).evaluate().isEmpty,
      timeout: const Duration(seconds: 30),
    ),
    isTrue,
    reason:
        '$what did not close after submit (the write failed?). '
        'On screen: ${flowOnScreen()}',
  );
}

/// EDIT: the detail's Edit plan, the price replaced, read back from the server.
Future<Subscription> editPriceAndReadBack(
  WidgetTester tester,
  FlowPump pumpFor, {
  required String name,
  required String newPrice,
  required int expectMinorUnits,
}) async {
  await tapLanding(
    tester,
    pumpFor,
    find.byKey(E2EKeys.detailEdit),
    'Edit plan',
  );
  await pumpFor(tester, const Duration(seconds: 1));
  await tester.enterText(find.byKey(E2EKeys.addPrice), newPrice);
  await submitSheet(tester, pumpFor, 'the edit sheet for "$name"');
  final Subscription? row = await serverRowWhere(
    tester,
    pumpFor,
    name,
    (Subscription? r) => r?.price.minorUnits == expectMinorUnits,
  );
  expect(
    row?.price.minorUnits,
    expectMinorUnits,
    reason:
        'the edited price did not reach the server: the Worker answers '
        '${row?.price.minorUnits} minor units for "$name"',
  );
  return row!;
}

/// A status change from More options, the chip on the detail, and the row's
/// status read back from the server.
Future<void> statusAndReadBack(
  WidgetTester tester,
  FlowPump pumpFor, {
  required String name,
  required String action,
  required SubscriptionStatus want,
  String? chip,
}) async {
  await moreOption(tester, pumpFor, action);
  if (chip != null) {
    expect(
      await pumpUntil(
        tester,
        pumpFor,
        () => find.text(chip).evaluate().isNotEmpty,
      ),
      isTrue,
      reason:
          'after "$action" the detail shows no "$chip" status chip. '
          'On screen: ${flowOnScreen()}',
    );
  }
  final Subscription? row = await serverRowWhere(
    tester,
    pumpFor,
    name,
    (Subscription? r) => r?.status == want,
  );
  expect(
    row?.status,
    want,
    reason:
        '"$action" did not reach the server: the Worker answers '
        '${row?.status} for "$name"',
  );
}

/// DELETE → UNDO: Delete from tracker, the snackbar's Undo, the row back on the
/// server. Then (when [thenDelete]) delete again and see it gone.
Future<void> deleteUndoThenDelete(
  WidgetTester tester,
  FlowPump pumpFor, {
  required String name,
  bool thenDelete = true,
  void Function()? onUndone,
}) async {
  await moreOption(tester, pumpFor, 'Delete from tracker');
  final Finder undo = find.text('Undo');
  expect(
    await pumpUntil(
      tester,
      pumpFor,
      () => undo.evaluate().isNotEmpty,
      timeout: const Duration(seconds: 10),
    ),
    isTrue,
    reason: 'Delete from tracker offered no Undo. On screen: ${flowOnScreen()}',
  );
  await tester.tap(undo.last);
  final Subscription? back = await serverRowWhere(
    tester,
    pumpFor,
    name,
    (Subscription? r) => r != null,
  );
  expect(
    back,
    isNotNull,
    reason: 'Undo did not bring "$name" back on the server',
  );
  onUndone?.call();
  if (!thenDelete) return;
  await pumpFor(tester, const Duration(seconds: 5)); // the snackbar leaves
  await openRowOnHome(tester, pumpFor, name);
  await moreOption(tester, pumpFor, 'Delete from tracker');
  await pumpFor(tester, const Duration(seconds: 6)); // past the Undo window
  final Subscription? gone = await serverRowWhere(
    tester,
    pumpFor,
    name,
    (Subscription? r) => r == null,
  );
  expect(gone, isNull, reason: 'the second delete left "$name" on the server');
}

/// THE CORE FLOW (XP-02), the native leg's: add a weekly plan → read it back →
/// edit its price → pause (status chip) → delete → Undo → delete. Each step
/// prints its [kCoreFlowLines] line.
Future<void> walkCoreFlow(WidgetTester tester, FlowPump pumpFor) async {
  final String name = 'Core flow ${DateTime.now().millisecondsSinceEpoch}';
  await addPlanThroughSheet(
    tester,
    pumpFor,
    name: name,
    price: '4.20',
    weekly: true,
  );
  debugPrint(kCoreFlowLines[0]);

  final Subscription? added = await serverRowWhere(
    tester,
    pumpFor,
    name,
    (Subscription? r) => r != null,
  );
  expect(added, isNotNull, reason: 'the added plan is not on the server');
  expect(added!.price.minorUnits, 420, reason: 'the added price read back');
  expect(
    added.cycle?.toString().toLowerCase().contains('week') ?? false,
    isTrue,
    reason: 'the added plan is not weekly on the server: ${added.cycle}',
  );
  debugPrint(kCoreFlowLines[1]);

  await openRowOnHome(tester, pumpFor, name);
  await editPriceAndReadBack(
    tester,
    pumpFor,
    name: name,
    newPrice: '5.75',
    expectMinorUnits: 575,
  );
  debugPrint(kCoreFlowLines[2]);

  await statusAndReadBack(
    tester,
    pumpFor,
    name: name,
    action: 'Pause',
    want: SubscriptionStatus.paused,
    chip: 'Paused',
  );
  debugPrint(kCoreFlowLines[3]);

  await deleteUndoThenDelete(
    tester,
    pumpFor,
    name: name,
    onUndone: () => debugPrint(kCoreFlowLines[4]),
  );
  debugPrint(kCoreFlowLines[5]);
  await backToHome(tester, pumpFor);
}

/// BUDGET: Insights' budget card → Edit → an amount → Save, then the budget
/// read back from the server (GET /v1/budget through the app's repository).
Future<void> saveBudgetAndReadBack(
  WidgetTester tester,
  FlowPump pumpFor, {
  required String amount,
  required int expectMinorUnits,
}) async {
  await tapLanding(
    tester,
    pumpFor,
    find.byKey(BudgetCard.editButton),
    'Edit budget',
  );
  await pumpFor(tester, const Duration(seconds: 1));
  await tester.enterText(find.byKey(BudgetEditor.amountField), amount);
  await tapLanding(
    tester,
    pumpFor,
    find.byKey(BudgetEditor.saveButton),
    'Save budget',
  );
  expect(
    await pumpUntil(
      tester,
      pumpFor,
      () => find.byType(BudgetEditor).evaluate().isEmpty,
      timeout: const Duration(seconds: 30),
    ),
    isTrue,
    reason:
        'the budget editor did not close after Save. On screen: '
        '${flowOnScreen()}',
  );
  final BudgetInfo? read = await tester.runAsync(
    () => appContainer().read(subscriptionRepositoryProvider).budget(),
  );
  expect(
    read?.monthlyBudget.minorUnits,
    expectMinorUnits,
    reason:
        'the saved budget did not reach the server: GET /v1/budget '
        'answers ${read?.monthlyBudget.minorUnits} minor units',
  );
}

Future<String?> _accessToken() =>
    appContainer().read(authRepositoryProvider).currentAccessToken();

/// REMINDER PREFS: the e-mail reminders switch in Settings, then the prefs read
/// back from the platform Worker (the PUT landed).
Future<void> toggleEmailRemindersAndReadBack(
  WidgetTester tester,
  FlowPump pumpFor,
) async {
  final core.ReminderChannelsTransport t = appContainer().read(
    reminderChannelsTransportProvider,
  );
  Future<core.ReminderPrefs?> read() async {
    final core.Result<core.ReminderPrefs>? r = await tester.runAsync(
      () async => t.readPrefs(
        appId: AppConfig.appId,
        accessToken: await _accessToken(),
      ),
    );
    return r is core.Ok<core.ReminderPrefs> ? r.value : null;
  }

  final core.ReminderPrefs? before = await read();
  expect(
    before,
    isNotNull,
    reason: 'GET reminder prefs failed before the toggle',
  );
  await tapLanding(
    tester,
    pumpFor,
    find.byKey(const Key('settings.reminder.email')),
    'the e-mail reminders switch',
  );
  core.ReminderPrefs? after;
  final DateTime end = DateTime.now().add(const Duration(seconds: 20));
  while (DateTime.now().isBefore(end)) {
    after = await read();
    if (after != null && after.emailOptIn != before!.emailOptIn) break;
    await pumpFor(tester, const Duration(seconds: 1));
  }
  expect(
    after?.emailOptIn,
    !before!.emailOptIn,
    reason:
        'the e-mail reminders switch did not PUT: the platform Worker '
        'still answers emailOptIn=${after?.emailOptIn}',
  );
}

/// CALENDAR FEED: mint (the call the "Add to calendar" row makes), fetch the
/// .ics → 200 VCALENDAR; then the Reset row rotates it and the old URL stops.
Future<void> mintFetchAndRotateCalendarFeed(
  WidgetTester tester,
  FlowPump pumpFor,
) async {
  final core.ReminderChannelsTransport t = appContainer().read(
    reminderChannelsTransportProvider,
  );
  final core.Result<core.CalendarFeed>? minted = await tester.runAsync(
    () async => t.mintCalendarFeed(
      appId: AppConfig.appId,
      accessToken: await _accessToken(),
    ),
  );
  expect(
    minted,
    isA<core.Ok<core.CalendarFeed>>(),
    reason: 'POST /v1/calendar/feed failed',
  );
  final Uri url = (minted! as core.Ok<core.CalendarFeed>).value.httpsUrl;
  Future<Response<String>?> get(Uri u) => tester.runAsync(
    () => Dio().getUri<String>(
      u,
      options: Options(validateStatus: (int? _) => true),
    ),
  );
  final Response<String>? feed = await get(url);
  expect(feed?.statusCode, 200, reason: 'the minted feed did not answer 200');
  expect(
    feed?.data ?? '',
    contains('BEGIN:VCALENDAR'),
    reason: 'the minted feed is not an iCalendar body',
  );
  await tapLanding(
    tester,
    pumpFor,
    find.byKey(const Key('settings.reminder.calendar.reset')),
    'the calendar Reset row',
  );
  int? stale;
  final DateTime end = DateTime.now().add(const Duration(seconds: 20));
  while (DateTime.now().isBefore(end)) {
    stale = (await get(url))?.statusCode;
    if (stale != 200) break;
    await pumpFor(tester, const Duration(seconds: 1));
  }
  expect(
    stale,
    isNot(200),
    reason: 'the Reset row did not rotate the feed: the old URL still serves',
  );
}

/// NOTIFICATION TAP: a reminder for a fresh row, scheduled one minute out
/// through the instance `main()` initialised (`notificationTapSourceProvider`
/// — its taps arrive on its own stream), then [kAwaitNotificationMarker] for
/// the HOST to tap it (tooling/e2e/native_auth_proof.mjs tapNotification),
/// and the app must land on that row's `/sub/<id>`.
Future<void> proveNotificationTap(WidgetTester tester, FlowPump pumpFor) async {
  final String name = 'Tap proof ${DateTime.now().millisecondsSinceEpoch}';
  final Subscription? row = await tester.runAsync(
    () => appContainer()
        .read(subscriptionRepositoryProvider)
        .add(
          Subscription(
            id: '',
            name: name,
            category: 'AI tools',
            price: const Money(100, 'USD'),
            cycle: BillingCycle.monthly,
            nextRenewal: DateTime.now().add(const Duration(days: 30)),
          ),
        ),
  );
  expect(row?.id, isNotEmpty, reason: 'the tap-proof row was not written');
  await tester.runAsync(
    () => appContainer()
        .read(notificationTapSourceProvider)
        .scheduleAt(
          core.ScheduledNotification(
            id: 990417,
            title: kTapProofTitle,
            body: name,
            at: DateTime.now().add(const Duration(minutes: 1)),
            payload: 'sub:${row!.id}',
          ),
        ),
  );
  debugPrint('$kAwaitNotificationMarker title=$kTapProofTitle');
  expect(
    await pumpUntil(
      tester,
      pumpFor,
      () =>
          find.text(name).evaluate().isNotEmpty &&
          find.byKey(E2EKeys.detailMoreOptions).evaluate().isNotEmpty,
      timeout: const Duration(minutes: 6),
    ),
    isTrue,
    reason:
        'the tapped reminder did not land on /sub/${row!.id} ("$name"). '
        'On screen: ${flowOnScreen()}',
  );
  debugPrint(kNotificationTapOkLine);
  await tester.runAsync(
    () => appContainer().read(subscriptionRepositoryProvider).cancel(row.id),
  );
  await backToHome(tester, pumpFor);
}
