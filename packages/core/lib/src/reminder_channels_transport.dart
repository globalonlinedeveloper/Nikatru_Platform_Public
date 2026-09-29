import 'result.dart';

/// The renewal reminder EMAIL preference for one (account, app) — ST-R1.
///
/// Mirrors the platform Worker's `GET|PUT /v1/reminders/prefs` answer
/// (`services/platform/src/routes/reminders.ts`): `email_opt_in` and
/// `lead_days`, the days before a renewal the reminder is sent.
class ReminderPrefs {
  const ReminderPrefs({required this.emailOptIn, required this.leadDays});

  /// What the host answers for a person who never wrote a preference: not
  /// opted in, with the default lead.
  static const ReminderPrefs defaults = ReminderPrefs(
    emailOptIn: false,
    leadDays: defaultLeadDays,
  );

  /// `DEFAULT_LEAD_DAYS` in `services/platform/src/lib/reminders.ts`.
  static const int defaultLeadDays = 3;

  /// `MAX_LEAD_DAYS` there: the host answers 400 to anything outside
  /// `0..maxLeadDays`, so a client refuses it before spending a request.
  static const int maxLeadDays = 30;

  final bool emailOptIn;
  final int leadDays;

  /// Whether [days] is a lead the host accepts.
  static bool isValidLead(int days) => days >= 0 && days <= maxLeadDays;

  /// The host's answer, or null when it is not one.
  ///
  /// 🔴 NULL, NOT [defaults]. A half-understood answer must not read as "you
  /// are not opted in": the settings screen would show a switch that is off
  /// for a person whose reminders are on.
  static ReminderPrefs? tryParse(Map<String, Object?> j) {
    final Object? optIn = j['email_opt_in'];
    final Object? lead = j['lead_days'];
    if (optIn is! bool || lead is! int || !isValidLead(lead)) return null;
    return ReminderPrefs(emailOptIn: optIn, leadDays: lead);
  }

  /// The PUT body's two preference fields (the caller adds `app_id`).
  Map<String, Object?> toJson() => <String, Object?>{
    'email_opt_in': emailOptIn,
    'lead_days': leadDays,
  };

  @override
  bool operator ==(Object other) =>
      other is ReminderPrefs &&
      other.emailOptIn == emailOptIn &&
      other.leadDays == leadDays;

  @override
  int get hashCode => Object.hash(emailOptIn, leadDays);

  @override
  String toString() =>
      'ReminderPrefs(emailOptIn: $emailOptIn, leadDays: $leadDays)';
}

/// The private calendar feed's two URLs — ST-R2 (`POST /v1/calendar/feed`).
///
/// Google Calendar and Outlook subscribe to [httpsUrl], Apple Calendar to
/// [webcalUrl]. The URL IS the credential (the token in its path is the whole
/// capability), so it is shown once, on the screen that minted it, and never
/// logged.
class CalendarFeed {
  const CalendarFeed({required this.httpsUrl, required this.webcalUrl});

  final Uri httpsUrl;
  final Uri webcalUrl;

  /// The host's 201 answer, or null when it is not one.
  ///
  /// 🔴 ONLY `https:` AND `webcal:` ARE ACCEPTED. A caller hands these URLs
  /// to a calendar app or a browser; an `http:` feed would carry the token in
  /// the clear, so a reply offering one is refused rather than opened.
  static CalendarFeed? tryParse(Map<String, Object?> j) {
    final Uri? https = _url(j['https_url'], 'https');
    final Uri? webcal = _url(j['webcal_url'], 'webcal');
    if (https == null || webcal == null) return null;
    return CalendarFeed(httpsUrl: https, webcalUrl: webcal);
  }

  static Uri? _url(Object? raw, String scheme) {
    if (raw is! String) return null;
    final Uri? u = Uri.tryParse(raw);
    if (u == null || u.scheme != scheme || u.host.isEmpty) return null;
    return u;
  }

  @override
  bool operator ==(Object other) =>
      other is CalendarFeed &&
      other.httpsUrl == httpsUrl &&
      other.webcalUrl == webcalUrl;

  @override
  int get hashCode => Object.hash(httpsUrl, webcalUrl);
}

/// How the app reaches the two reminder CHANNELS the platform host serves:
/// the renewal email preference and the private calendar feed.
///
/// A seam in `core` beside [EntitlementTransport] and [CancellationTransport]
/// for the same reason: `core` states the contract and stays pure Dart, the
/// HTTP client lives in the adapter layer (ADR 005), and a widget test can
/// drive the whole reminders screen without a network.
///
/// Every call is AUTHED: [accessToken] null or empty is a signed-out user,
/// and an implementation refuses rather than send a request the host would
/// answer 401 to anyway.
abstract interface class ReminderChannelsTransport {
  /// This person's email preference for [appId] — the host's default (not
  /// opted in) when they never wrote one.
  Future<Result<ReminderPrefs>> readPrefs({
    required String appId,
    required String? accessToken,
  });

  /// Write the email preference. A null [leadDays] keeps the stored lead (or
  /// the default, on a first write); the answer is the stored preference.
  Future<Result<ReminderPrefs>> writePrefs({
    required String appId,
    required String? accessToken,
    required bool emailOptIn,
    int? leadDays,
  });

  /// Mint the calendar feed — or ROTATE it: a second call replaces the token,
  /// and the URL the first call answered stops working at once. Rotation is
  /// also how an app RESETS a leaked link; nothing here revokes without a
  /// replacement (the route's DELETE has no in-repo client).
  Future<Result<CalendarFeed>> mintCalendarFeed({
    required String appId,
    required String? accessToken,
  });
}

/// The default for demo builds, widget tests and any app with no backend: it
/// cannot ask, and says so.
///
/// Deliberately NOT [ReminderPrefs.defaults] — that is an answer, and this
/// transport has none. A settings screen must be able to
/// tell "you are not opted in" from "this build has no host".
class UnavailableReminderChannelsTransport
    implements ReminderChannelsTransport {
  const UnavailableReminderChannelsTransport();

  static const Failure _unavailable = Failure(
    'reminder channels unavailable in this build',
  );

  @override
  Future<Result<ReminderPrefs>> readPrefs({
    required String appId,
    required String? accessToken,
  }) async => const Result<ReminderPrefs>.err(_unavailable);

  @override
  Future<Result<ReminderPrefs>> writePrefs({
    required String appId,
    required String? accessToken,
    required bool emailOptIn,
    int? leadDays,
  }) async => const Result<ReminderPrefs>.err(_unavailable);

  @override
  Future<Result<CalendarFeed>> mintCalendarFeed({
    required String appId,
    required String? accessToken,
  }) async => const Result<CalendarFeed>.err(_unavailable);
}
