import 'dart:io';

import 'package:mason/mason.dart';

/// [pipeline S-1 · S-8 · S-13] THE INPUT CONTRACT.
///
/// Every var `brick.yaml` declares gets a rule here, and the count is asserted
/// by `tooling/ci/assert-input-contract.mjs` — add a ninth var and the build
/// fails until it has one too. The previous version validated **2 of 8**, under
/// an acceptance criterion that said *"every load-bearing var is validated"* —
/// which names no set and is therefore satisfied by validating one.
///
/// 🔴 REFUSAL IS ATOMIC, which is why every check throws rather than warns. A
/// throwing `pre_gen` makes mason exit 64 having written **nothing** (mason_cli
/// 0.1.3, the version pinned in `ci.yml`). So a rejected spec cannot leave a
/// half-stamped app behind, and [pipeline S-13]'s refusal cannot eat the app it
/// declined to overwrite.
void run(HookContext context) {
  final Map<String, dynamic> vars = context.vars;
  final List<String> problems = <String>[];

  String v(String key) => (vars[key] ?? '').toString().trim();

  // ── app_id ────────────────────────────────────────────────────────────────
  // [pipeline S-8] The one name every other name derives from — and two of those
  // derivations are IRREVERSIBLE: the analytics `app_id` column keys every
  // historical row, and a store bundle id is immutable after first submission.
  // A rename is not a rename; it is an orphaning.
  final String appId = v('app_id');
  if (!RegExp(r'^[a-z][a-z0-9_]*$').hasMatch(appId)) {
    problems.add(
      'app_id must be lowercase snake_case starting with a letter — got "$appId". '
      'It becomes the Dart package, the database, the subdomain and the store '
      'identity, so it cannot hold a capital, a dash or a space.',
    );
  } else if (appId.length < 2 || appId.length > 63) {
    // 63 is not a taste. `<app_id>.nikatru.com` makes app_id a DNS LABEL, and a
    // label cannot exceed 63 octets — a longer one produces a hostname that
    // cannot exist, surfacing as a deploy failure long after stamping.
    problems.add(
      'app_id must be 2-63 characters — got "$appId" (${appId.length}). It '
      'becomes a DNS label in $appId.nikatru.com, which cannot exceed 63.',
    );
  }

  // ── needs_backend ─────────────────────────────────────────────────────────
  // A typo'd boolean must not silently read as false: "yes" is not a bool, and
  // letting it default would hand the app the shared Worker when it asked for
  // its own database.
  final Object? backendRaw = vars['needs_backend'];
  final bool needsBackend = backendRaw == true;
  if (backendRaw is! bool) {
    problems.add(
      'needs_backend must be a boolean — got ${backendRaw.runtimeType} '
      '("$backendRaw"). A string here reads as "no", silently giving the app the '
      'shared platform Worker when it asked for a private database.',
    );
  }

  // ── display_name ──────────────────────────────────────────────────────────
  final String displayName = v('display_name');
  if (displayName.isEmpty) {
    problems.add(
      'display_name must not be empty — it is what a user sees in the OS task '
      'switcher and in the public catalogue.',
    );
  }
  // ⚠️ NO LENGTH CAP, deliberately. An earlier draft capped this at 60 — a
  // number I invented. Store name limits are real, but they are STAGE 10's to
  // source and own. An unsourced cap here would reject legitimate input while
  // looking authoritative.

  // ── subdomain ─────────────────────────────────────────────────────────────
  // [pipeline S-8] Empty means DERIVE. A value disagreeing with the convention
  // is refused rather than honoured: `lingo` hosted at `phrasebook.nikatru.com`
  // is a divergence the identifiers never re-converge from.
  // Only meaningful once app_id itself is valid: suggesting
  // "Bad-App.nikatru.com" to someone whose app_id was just rejected sends them
  // to fix the wrong line. The app_id error is the actionable one.
  final bool appIdOk = problems.isEmpty;
  final String subdomain = v('subdomain');
  if (appIdOk && subdomain.isNotEmpty && subdomain != '$appId.nikatru.com') {
    problems.add(
      'subdomain must be "$appId.nikatru.com" or empty to derive — got '
      '"$subdomain". The catalogue entry, the CORS origin and the analytics key '
      'all follow app_id, so a divergence here never re-converges.',
    );
  }

  // ── api_domain ────────────────────────────────────────────────────────────
  final String apiDomain = v('api_domain');
  if (appIdOk && apiDomain.isNotEmpty && apiDomain != 'api-$appId.nikatru.com') {
    problems.add(
      'api_domain must be "api-$appId.nikatru.com" or empty to derive — got '
      '"$apiDomain".',
    );
  }
  if (apiDomain.isNotEmpty && !needsBackend) {
    problems.add(
      'api_domain is "$apiDomain" but needs_backend is false. A client-only app '
      'talks to the shared platform Worker and never has a host of its own, so '
      'this value would be silently ignored — say what you mean.',
    );
  }

  // ── seed_hex ──────────────────────────────────────────────────────────────
  // [pipeline C-11] Drives the whole palette. The leading "#" is the likely typo
  // and is named explicitly, because "invalid" alone sends people hunting.
  final String seed = v('seed_hex');
  if (!RegExp(r'^[0-9A-Fa-f]{6}$').hasMatch(seed)) {
    final String hint = seed.startsWith('#') ? ' Drop the leading "#".' : '';
    problems.add(
        'seed_hex must be exactly 6 hex digits (RRGGBB) — got "$seed".$hint');
  }

  // ── category ──────────────────────────────────────────────────────────────
  // Reaches the store listing, so a free-text typo becomes a submission problem
  // long after anyone remembers stamping the app.
  const List<String> categories = <String>[
    'education',
    'entertainment',
    'finance',
    'health',
    'lifestyle',
    'productivity',
    'reference',
    'travel',
    'utilities',
  ];
  final String category = v('category');
  if (!categories.contains(category)) {
    problems.add(
        'category must be one of ${categories.join(', ')} — got "$category".');
  }

  // ── description ───────────────────────────────────────────────────────────
  // Empty is allowed: it is a listing line, not a build input. A newline is not,
  // because this is a ONE-LINE field that ends up in a store form.
  final String description = v('description');
  if (description.contains('\n')) {
    problems.add(
      'description must be a single line — got ${description.split('\n').length} lines.',
    );
  }
  // 🔴 THE LENGTH CAP WAS REMOVED, and how it went is the point. "120 characters
  // or fewer" came from nothing — no store publishes that number — and it
  // immediately rejected THIS REPO'S OWN backend probe fixture at 129
  // characters. I could not source a replacement (Play's listing page does not
  // publish its limits), so the rule is gone rather than re-guessed.
  //
  // A validation rule nobody can defend fires on CORRECT input. That is the
  // same defect as an assertion that cannot fire at all, pointed the other way.

  // ── [pipeline S-13] REFUSE, NEVER OVERWRITE ───────────────────────────────
  // Checked LAST, after the spec is known good, so the message is about the one
  // thing the user can act on.
  //
  // 🔴 The failure this prevents: stamping an id that already exists silently
  // replaced months of work with an empty template. `--on-conflict overwrite` is
  // correct for CI's throwaway probe and one careless copy-paste from being
  // pointed at something real, so the guard lives here rather than in the
  // invocation.
  if (problems.isEmpty && appId.isNotEmpty) {
    final bool allowOverwrite =
        Platform.environment['NIKATRU_ALLOW_OVERWRITE'] == '1';
    final Directory target = Directory('apps/$appId');
    if (target.existsSync() && !allowOverwrite) {
      problems.add(
        'apps/$appId already exists. Stamping it again would overwrite that app '
        'with an empty template. Nothing has been written. Choose another '
        'app_id, or set NIKATRU_ALLOW_OVERWRITE=1 if you genuinely mean to '
        'replace it (CI sets this for its throwaway probe).',
      );
    }
  }

  if (problems.isNotEmpty) {
    context.logger.err('The app spec was rejected. NOTHING has been written.');
    for (final String p in problems) {
      context.logger.err('  · $p');
    }
    throw Exception('invalid app spec: ${problems.length} problem(s)');
  }

  context.logger.info('Stamping $displayName ($appId)…');
}
