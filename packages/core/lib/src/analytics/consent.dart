import 'dart:convert';

import '../storage/key_value_store.dart';
import 'ids.dart';
import 'privacy_signal.dart';

/// What legal ground a purpose stands on — and therefore **which way silence
/// falls**.
///
/// 🔴 THE WHOLE REASON THIS TYPE EXISTS. `ConsentStatus.unknown` means opposite
/// things for the two bases, and writing that difference as a comment would put
/// a legal rule where an `==` can quietly disagree with it:
///
///   * [consent] — nothing may happen until the person says yes. Unknown is a
///     refusal. (Analytics: DPDP §6, GDPR Art 6(1)(a).)
///   * [legitimateInterest] — the processing is lawful from the start and
///     STOPS when the person objects. Unknown is permission. (In-app
///     first-party promotion: GDPR Recital 47 + Art 21(2)/(3) — research/44 V4,
///     which is explicit that adding a consent gate here would be *"legally
///     unnecessary friction"* that *"wrongly implies the processing becomes
///     unlawful when refused"*.)
///
/// Both bases share this file's machinery on purpose: one append-only artifact
/// trail, one server route, one withdrawal surface. What differs is exactly one
/// predicate, [ConsentController.permits], and it reads the basis rather than
/// guessing from the purpose name.
enum ConsentBasis {
  /// Opt-IN. Unknown blocks.
  consent,

  /// Opt-OUT. Only an explicit objection blocks.
  legitimateInterest,
}

/// What a consent decision covers. Consent is **per purpose**, never a single
/// blanket flag — a user who accepts analytics has not thereby accepted cloud
/// backup of their data.
class ConsentPurpose {
  const ConsentPurpose(this.value, {this.basis = ConsentBasis.consent});
  final String value;

  /// Which way [ConsentStatus.unknown] falls for this purpose. Defaults to
  /// [ConsentBasis.consent] — the strict direction — so a purpose added without
  /// thinking about it is opt-in rather than silently opt-out.
  final ConsentBasis basis;

  static const ConsentPurpose analytics = ConsentPurpose('analytics');
  static const ConsentPurpose syncBackup = ConsentPurpose('sync_backup');

  /// Acceptance of the Terms of Service + acknowledgement of the privacy
  /// notice, taken at sign-up as an UNTICKED blocking clickwrap (research/43).
  ///
  /// Recorded through the same append-only trail as every other purpose so the
  /// question "what did this person agree to, and which version" has ONE
  /// answer. The artifact's `policyVersion` carries `LegalVersions.stamp` —
  /// both documents, not just the privacy one — because a terms-only change has
  /// to be visible to the re-acceptance check.
  static const ConsentPurpose terms = ConsentPurpose('terms');

  /// Express opt-in to MARKETING EMAIL, and nothing else (research/44 rider,
  /// [ADR 040]).
  ///
  /// 🔴 COLLECTION ONLY. No sender exists, no list exists, and nothing reads
  /// this yet. It is taken now because consent has to be contemporaneous with
  /// the signup it belongs to — retro-fitting it later means either emailing
  /// people who never opted in or re-asking everybody. It is its OWN purpose,
  /// never a limb of [analytics] or [terms]: the shipped signups KV is
  /// purpose-limited and repurposing it is exactly what the purpose split
  /// forbids.
  ///
  /// ⚠️ AND THE RECORD AS SHIPPED CANNOT BE JOINED TO A MAILBOX. Say it here,
  /// beside the justification, because the justification alone reads as though
  /// this row is ready to act on. [ConsentArtifact] carries `consentId`,
  /// `purpose`, `granted`, `policyVersion`, `anonId`, `ts`, `appVersion` and
  /// `platform` — no user id and no address, and `applyLegalAcceptance` passes
  /// the INSTALL id on purpose ("carries no PII, an anon id, never the
  /// address"). So a future sender holding these rows knows that SOMEBODY on
  /// install X opted in, and has no way to learn who. On today's shape the
  /// honest reading is that the "re-ask everybody" branch is where this lands
  /// either way.
  ///
  /// That is not an argument for deleting the row — a granted/declined pair
  /// taken at the right moment is evidence the box existed and was answered,
  /// which is worth having whichever way the list is eventually built. It IS an
  /// argument for deciding, before any list exists, whether marketing consent
  /// becomes an identifiable record (and inherits the erasure obligation that
  /// comes with one) or stays pseudonymous and is re-asked. OWNER DECISION,
  /// open: `assert-data-inventory` already prints RETENTION UNDECIDED for these
  /// stores, and this is the same question arriving one purpose earlier.
  ///
  /// DEFAULT OFF, and the checkbox that produces it may never be pre-ticked —
  /// the same Planet49/EDPB · DPDP Rules 2025 · CPRA line the research verdict
  /// drew, and unlike the terms tick this one may NOT block the button.
  static const ConsentPurpose marketingEmail = ConsentPurpose(
    'marketing-email',
  );

  /// In-app promotion of our own apps — the GDPR **Art 21 objection**, carried
  /// on the consent rail rather than in a second store of its own.
  ///
  /// 🔴 IT IS NOT A CONSENT GATE, AND THE BASIS IS THE POINT. research/44 V4:
  /// *"Do NOT add a consent gate for first-party in-app promotion… **Do** add
  /// the toggle."* So `unknown` (nobody has ever touched the control) permits,
  /// `denied` (they objected) forbids absolutely, and `granted` is an objection
  /// that was later withdrawn — a state Art 21 has to allow, because it gives a
  /// person the right to object, not a duty to stay objected.
  ///
  /// It rides this rail rather than a private flag so that the append-only
  /// artifact trail, the server verification and the withdrawal surface all
  /// apply to it unchanged — which is also what stops the objection having two
  /// homes. `PromoGateState.suppressed` is a projection of THIS value; see
  /// `PromoObjection` in `src/promo/promo_objection.dart`.
  static const ConsentPurpose promo = ConsentPurpose(
    'promo',
    basis: ConsentBasis.legitimateInterest,
  );

  @override
  String toString() => value;
}

/// Where a purpose currently stands. [unknown] is the launch state and is
/// **not** consent: nothing may be collected until it becomes [granted].
enum ConsentStatus { unknown, granted, denied }

/// One consent decision, as stored. APPEND-ONLY: a withdrawal is a NEW artifact
/// with [granted] false, never a mutation of the old one — the audit trail is
/// the artifact, and it is what a DPDP §6(3) withdrawal has to reference.
///
/// Deliberately carries NO IP and NO device fingerprint. A record that proves
/// compliance must not itself be a tracking record.
class ConsentArtifact {
  const ConsentArtifact({
    required this.consentId,
    required this.purpose,
    required this.granted,
    required this.policyVersion,
    required this.anonId,
    required this.ts,
    this.appVersion,
    this.platform,
  });

  /// Client-generated UUIDv4 — the idempotency key, and what each event's
  /// `consent_id` points at.
  final String consentId;
  final String purpose;
  final bool granted;

  /// Which privacy policy the user was actually shown. Without this the record
  /// proves someone tapped a button, not what they agreed to.
  final String policyVersion;

  /// The same pseudonymous per-install id events carry.
  final String anonId;
  final DateTime ts;
  final String? appVersion;
  final String? platform;

  factory ConsentArtifact.create({
    required ConsentPurpose purpose,
    required bool granted,
    required String policyVersion,
    required String anonId,
    required DateTime now,
    String? appVersion,
    String? platform,
  }) =>
      ConsentArtifact(
        consentId: uuidV4(),
        purpose: purpose.value,
        granted: granted,
        policyVersion: policyVersion,
        anonId: anonId,
        ts: now,
        appVersion: appVersion,
        platform: platform,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'consent_id': consentId,
        'purpose': purpose,
        'granted': granted,
        'policy_version': policyVersion,
        'anon_id': anonId,
        'ts': ts.toUtc().toIso8601String(),
        if (appVersion != null) 'app_version': appVersion,
        if (platform != null) 'platform': platform,
      };

  static ConsentArtifact? tryFromJson(Map<String, Object?> j) {
    final Object? id = j['consent_id'];
    final Object? purpose = j['purpose'];
    final Object? ts = j['ts'];
    if (id is! String || purpose is! String || ts is! String) return null;
    final DateTime? parsed = DateTime.tryParse(ts);
    if (parsed == null) return null;
    return ConsentArtifact(
      consentId: id,
      purpose: purpose,
      granted: j['granted'] == true,
      policyVersion:
          j['policy_version'] is String ? j['policy_version']! as String : '',
      anonId: j['anon_id'] is String ? j['anon_id']! as String : '',
      ts: parsed,
      appVersion:
          j['app_version'] is String ? j['app_version'] as String : null,
      platform: j['platform'] is String ? j['platform'] as String : null,
    );
  }
}

/// The consent seam. Holds the CURRENT decision per purpose, durably, and hands
/// out the artifact that collection must reference.
///
/// FAIL-CLOSED: an unreadable or absent store resolves to [ConsentStatus.unknown],
/// which blocks collection. A storage failure must never be readable as consent.
class ConsentController {
  ConsentController({
    required KeyValueStore store,
    String keyPrefix = 'nikatru.consent.',
    PrivacySignal? privacySignal,
  })  : _store = store,
        _keyPrefix = keyPrefix,
        _privacySignal = privacySignal ?? const NoPrivacySignal();

  final KeyValueStore _store;
  final String _keyPrefix;
  final PrivacySignal _privacySignal;
  final Map<String, ConsentArtifact> _cache = <String, ConsentArtifact>{};

  /// [pipeline K-15] Purposes a device-level opt-out speaks for.
  ///
  /// GPC is a "do not sell or share" signal. It says nothing about whether the
  /// user wants their own data synced to their own devices, so it must NOT
  /// suppress [ConsentPurpose.syncBackup] — treating one signal as blanket
  /// consent-withdrawal is the same error as a single blanket consent flag,
  /// which this file rejects at the top.
  ///
  /// 🔴 `promo` IS ON THIS LIST, AND FOR A STRONGER REASON THAN ANALYTICS IS.
  /// GDPR **Art 21(5)**: *"the data subject may exercise his or her right to
  /// object by automated means using technical specifications."* A direct-
  /// marketing objection is the one right the Regulation names an automated
  /// signal for, so a browser already sending one has objected — asking the same
  /// person again through a toggle is asking them to say it twice. California
  /// arrives at the same place from the other side: §1798.140(k) defines
  /// cross-context behavioral advertising across *"distinctly branded"*
  /// properties and **common ownership is not a carve-out** (research/44 V12),
  /// so a portfolio promo surface is exactly what a GPC user is opting out of.
  ///
  /// ⚠️ It is a SUPPRESSION, not a stored objection. `hydrate` returns `denied`
  /// without touching the artifact, so switching GPC off restores whatever the
  /// person actually chose — the signal speaks for them while it is on, and
  /// never writes in their name.
  static const Set<String> _signalGovernedPurposes = <String>{
    'analytics',
    'promo',
  };

  /// True when a device-level opt-out is speaking for [purpose] right now.
  ///
  /// Read live on every consult — the user can toggle GPC mid-session, and a
  /// cached `false` would outlive their turning it on.
  bool optedOutBySignal(ConsentPurpose purpose) =>
      _signalGovernedPurposes.contains(purpose.value) &&
      _privacySignal.optedOut;

  String _key(ConsentPurpose p) => '$_keyPrefix${p.value}';

  /// Load the persisted decision for [purpose] into memory. Call once at start
  /// up before consulting [statusOf].
  Future<ConsentStatus> hydrate(ConsentPurpose purpose) async {
    // [pipeline K-15] The device signal is consulted BEFORE the store, and it
    // wins. It is not merged with the stored decision and it does not overwrite
    // it: a user who once granted and then switched GPC on gets `denied` now,
    // and their original artifact is left untouched so switching GPC off
    // restores what they actually chose. Nothing is collected in between.
    if (optedOutBySignal(purpose)) return ConsentStatus.denied;
    try {
      final String? raw = await _store.read(_key(purpose));
      if (raw == null || raw.isEmpty) return ConsentStatus.unknown;
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map) return ConsentStatus.unknown;
      final ConsentArtifact? a = ConsentArtifact.tryFromJson(
        decoded.cast<String, Object?>(),
      );
      if (a == null) return ConsentStatus.unknown;
      _cache[purpose.value] = a;
      return a.granted ? ConsentStatus.granted : ConsentStatus.denied;
    } catch (_) {
      // Corrupt or unreadable ⇒ unknown ⇒ nothing is collected.
      return ConsentStatus.unknown;
    }
  }

  /// The in-memory decision. [ConsentStatus.unknown] until [hydrate] or
  /// [record] has run — and unknown never permits collection.
  ConsentStatus statusOf(ConsentPurpose purpose) {
    // [pipeline K-15] The signal wins here too, and this is the line that makes
    // "no prompt is shown" true: a UI that prompts on `unknown` never sees
    // `unknown` for a GPC user — it sees `denied`, which is a decided state.
    if (optedOutBySignal(purpose)) return ConsentStatus.denied;
    final ConsentArtifact? a = _cache[purpose.value];
    if (a == null) return ConsentStatus.unknown;
    return a.granted ? ConsentStatus.granted : ConsentStatus.denied;
  }

  /// The artifact currently in force for [purpose], or null.
  ConsentArtifact? artifactOf(ConsentPurpose purpose) => _cache[purpose.value];

  /// **May processing for [purpose] happen right now?** — the one place the
  /// opt-in/opt-out asymmetry is written down.
  ///
  /// [ConsentBasis.consent] ⇒ only `granted` permits: unknown is a refusal.
  /// [ConsentBasis.legitimateInterest] ⇒ only `denied` forbids: unknown is
  /// permission, because the basis is lawful until objected to (GDPR Recital 47
  /// + Art 21(2)/(3)).
  ///
  /// ⚠️ [AnalyticsRecorder] deliberately does NOT call this, and that is not an
  /// oversight to tidy up later. Its `hydrate` needs all THREE states kept
  /// apart — `denied` deletes the persisted queue, `unknown` refuses to load it
  /// but must not destroy it, because *"destroying a legitimate queue because a
  /// read failed is not fail-closed, it is data loss."* Collapsing three states
  /// to a boolean there would turn an unreadable store into deletion. This
  /// predicate is for callers that genuinely have a two-way decision to make.
  bool permits(ConsentPurpose purpose) {
    final ConsentStatus s = statusOf(purpose);
    return switch (purpose.basis) {
      ConsentBasis.consent => s == ConsentStatus.granted,
      ConsentBasis.legitimateInterest => s != ConsentStatus.denied,
    };
  }

  /// Record a NEW decision. Returns the artifact so the caller can ship it to
  /// the server. Persisting is best-effort: an in-memory grant still applies to
  /// this session, and a failed write only means the prompt reappears next
  /// launch — the safe direction.
  Future<ConsentArtifact> record(
    ConsentPurpose purpose, {
    required bool granted,
    required String policyVersion,
    required String anonId,
    required DateTime now,
    String? appVersion,
    String? platform,
  }) async {
    final ConsentArtifact a = ConsentArtifact.create(
      purpose: purpose,
      granted: granted,
      policyVersion: policyVersion,
      anonId: anonId,
      now: now,
      appVersion: appVersion,
      platform: platform,
    );
    _cache[purpose.value] = a;
    try {
      await _store.write(_key(purpose), jsonEncode(a.toJson()));
    } catch (_) {
      // best-effort
    }
    return a;
  }
}
