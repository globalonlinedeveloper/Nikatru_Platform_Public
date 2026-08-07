import 'dart:convert';
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
  //
  // `appIdValid` tracks THIS var, and nothing else. It used to be recomputed
  // further down as `problems.isEmpty`, which conflates "app_id is usable" with
  // "nothing anywhere is wrong": a bad `needs_backend` or an unsourced category
  // — checked in between — suppressed the subdomain/api_domain rules entirely,
  // so a spec with two real problems reported one and looked fixed after one
  // edit. Diagnostics only (no stamp result ever depended on it), but a
  // diagnostic that hides a second problem costs a whole extra round trip.
  final String appId = v('app_id');
  bool appIdValid = true;
  if (!RegExp(r'^[a-z][a-z0-9_]*$').hasMatch(appId)) {
    appIdValid = false;
    problems.add(
      'app_id must be lowercase snake_case starting with a letter — got "$appId". '
      'It becomes the Dart package, the database, the subdomain and the store '
      'identity, so it cannot hold a capital, a dash or a space.',
    );
  } else if (appId.length < 2 || appId.length > 63) {
    appIdValid = false;
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
  // to fix the wrong line. The app_id error is the actionable one — and it is
  // the ONLY one that may silence these two, which is why the condition reads
  // `appIdValid` rather than "no problem has been recorded yet".
  final String subdomain = v('subdomain');
  if (appIdValid && subdomain.isNotEmpty && subdomain != '$appId.nikatru.com') {
    problems.add(
      'subdomain must be "$appId.nikatru.com" or empty to derive — got '
      '"$subdomain". The catalogue entry, the CORS origin and the analytics key '
      'all follow app_id, so a divergence here never re-converges.',
    );
  }

  // ── api_domain ────────────────────────────────────────────────────────────
  final String apiDomain = v('api_domain');
  if (appIdValid &&
      apiDomain.isNotEmpty &&
      apiDomain != 'api-$appId.nikatru.com') {
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
      'seed_hex must be exactly 6 hex digits (RRGGBB) — got "$seed".$hint',
    );
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
      'category must be one of ${categories.join(', ')} — got "$category".',
    );
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
  // [pipeline 10]D-5 — EMPTY IS NO LONGER ALLOWED, and the reason changed under
  // it. This used to be "a listing line, not a build input", true while the
  // brick stamped no listing: a blank line reached nobody. The brick now
  // GENERATES `store/<channel>/short-description.txt` from this var for all five
  // store channels, and a store's short description may not be blank — so a
  // blank here stamps an app whose listing fails its own build the moment it is
  // registered in the catalogue.
  if (description.isEmpty) {
    problems.add(
      'description must not be empty — it is the SHORT DESCRIPTION of every '
      'store listing this stamp generates (and the catalogue tagline). One '
      'sentence saying what the app does for somebody who has never seen it.',
    );
  }

  // ── subtitle ──────────────────────────────────────────────────────────────
  // [pipeline 10]D-5. A real App Store field, and the one listing value that
  // cannot be derived from anything else in this spec: Apple caps it at 30
  // characters and condensing a free-length description to 30 would either
  // truncate mid-word or invent copy. So the SPEC carries it, exactly as it
  // carries the description, and both App Store trees interpolate it.
  final String subtitle = v('subtitle');
  if (subtitle.isEmpty) {
    problems.add(
      'subtitle must not be empty — it is the App Store subtitle in the '
      'ios-appstore and macos-appstore listings this stamp generates.',
    );
  }
  if (subtitle.contains('\n')) {
    problems.add('subtitle must be a single line.');
  }
  // 🔴 THE LENGTH CAP WAS REMOVED, and how it went is the point. "120 characters
  // or fewer" came from nothing — no store publishes that number — and it
  // immediately rejected THIS REPO'S OWN backend probe fixture at 129
  // characters. I could not source a replacement (Play's listing page does not
  // publish its limits), so the rule is gone rather than re-guessed.
  //
  // A validation rule nobody can defend fires on CORRECT input. That is the
  // same defect as an assertion that cannot fire at all, pointed the other way.
  //
  // 🔴 …AND THAT IS EXACTLY WHY THE CAPS BELOW ARE NOT WRITTEN HERE. They are
  // READ from tooling/channel-register.json, where each one sits beside the
  // primary-source URL and the date it was fetched, and a limit whose `source`
  // is missing is IGNORED rather than enforced — the same rule
  // assert-store-metadata.mjs applies to the same block. Nothing in this file
  // may invent a number; it may only refuse to stamp a spec that a sourced
  // number already forbids.
  final String shortName = _shortName(displayName);
  problems.addAll(
    _sourcedListingLimits(
      <String, String>{
        'title.txt': shortName,
        'short-description.txt': description,
        'subtitle.txt': subtitle,
      },
      <String, String>{
        'title.txt':
            'title.txt is DERIVED from the catalogue `name`, which is the display '
            'name up to its subtitle separator ("$shortName")',
        'short-description.txt':
            'short-description.txt is DERIVED from `description`',
        'subtitle.txt': 'subtitle.txt is DERIVED from `subtitle`',
      },
    ),
  );

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

  // ── NORMALISE, so the templates are dumb ──────────────────────────────────
  // 🔴 THE "EMPTY MEANS DERIVE" CONTRACT IS IMPLEMENTED HERE, AND ONLY HERE.
  // The rules above bless a blank `subdomain`/`api_domain` — "or empty to
  // derive" — and `brick.yaml` defaults both to "". But nothing derived them
  // for the STAMP: `post_gen` derived only for the apps.json row and the
  // printed checklist, while every template interpolated the raw var. The
  // documented-normal input therefore stamped `"ALLOWED_ORIGINS": "https://"`
  // into the app's own Worker (an allowlist matching no origin at all, which
  // `cors.ts` cannot even fall back from because "https://" is non-empty),
  // `_phApiBase = 'https://'`, and the same into config/defaults.json. Silent
  // at analyze, at build and at deploy.
  //
  // Derivation lives in the hook rather than in mustache inverted sections
  // because the templates then hold ONE spelling of each value and cannot
  // disagree with post_gen. mason feeds `updatedVars ?? vars` to BOTH
  // generation and post_gen (mason_cli 0.1.3, make.dart:194/211), so a write
  // here reaches every consumer.
  vars['subdomain'] = subdomain.isEmpty ? '$appId.nikatru.com' : subdomain;
  // A client-only app has NO API host of its own, so this stays empty on
  // purpose — deriving `api-<id>.nikatru.com` would stamp a hostname that will
  // never resolve. `api_base_url` below is what such an app actually calls.
  final String resolvedApiDomain = !needsBackend
      ? ''
      : (apiDomain.isEmpty ? 'api-$appId.nikatru.com' : apiDomain);
  vars['api_domain'] = resolvedApiDomain;
  vars['api_base_url'] = needsBackend
      ? 'https://$resolvedApiDomain'
      : 'https://platform.nikatru.com/v1';

  // ── ESCAPE, per destination LANGUAGE ──────────────────────────────────────
  // 🔴 mason renders with mustache's HTML escaping ON (mason 0.1.2 builds
  // `Template(lenient: true)` without `htmlEscapeValues: false`, and
  // mustache_template defaults it to true), and its escape map covers
  // & < > " ' AND '/'. So a double-stached `{{display_name}}` stamps
  // "Traveler&#x27;s Guide &amp; Notes 24&#x2F;7" into the Dart `appName`
  // const, the ARB app title, the PWA install name and the pubspec — all of
  // which are read as TEXT, never as HTML. It compiles and analyzes clean, so
  // every gate stayed green while the OS window title shipped corrupted.
  //
  // The templates now triple-stache those sites. Triple-staching ALONE is not
  // enough, though: raw text is not a valid Dart or JSON string body, and an
  // apostrophe in `'{{{display_name}}}'` is a Dart SYNTAX ERROR. So each
  // destination gets a value escaped for ITS language, computed once here.
  //
  // `web/index.html` deliberately keeps its DOUBLE stache: there the value
  // really is HTML (an attribute value and the <title> text), and `&#x27;`
  // renders as an apostrophe while a raw `"` would end the attribute early.
  vars['display_name'] = displayName;
  vars['description'] = description;
  vars['subtitle'] = subtitle;
  // [pipeline 10]D-5. The catalogue `name` and `store/*/title.txt` must be the
  // SAME string — assert-store-metadata.mjs compares them on every run — so the
  // split runs ONCE, here, and both consumers read the result. post_gen used to
  // own `_shortName` and the templates had no access to it at all, which is how
  // a listing title could only ever have been hand-typed.
  vars['short_name'] = shortName;
  vars['display_name_dart'] = _dartSingleQuoted(displayName);
  vars['display_name_json'] = _jsonBody(displayName);
  vars['description_json'] = _jsonBody(description);

  context.logger.info('Stamping $displayName ($appId)…');
}

/// Escape [s] for use inside a Dart SINGLE-quoted string literal.
///
/// Backslash first, or the escapes we add would themselves be re-escaped.
/// `$` matters as much as `'`: `'50$ a month'` is a compile error, and
/// `'{{{display_name}}}'` is exactly where a display name lands. The control
/// characters are here for completeness rather than taste — a raw newline
/// inside a single-quoted literal is also a compile error, and nothing in the
/// input contract forbids one in `display_name`.
String _dartSingleQuoted(String s) => s
    .replaceAll(r'\', r'\\')
    .replaceAll(r'$', r'\$')
    .replaceAll("'", r"\'")
    .replaceAll('\r', r'\r')
    .replaceAll('\n', r'\n')
    .replaceAll('\t', r'\t');

/// "Lingo — Offline Phrasebook" -> "Lingo". "E-Book Reader" -> "E-Book Reader".
///
/// 🔴 THE SPLIT IS ON A SUBTITLE SEPARATOR, NOT ON "A DASH". `brick.yaml`'s own
/// example is `Lingo — Offline Phrasebook`: the catalogue wants the NAME and the
/// display name carries `<name> <separator> <tagline>`. The separator is a dash
/// **surrounded by whitespace** — that whitespace is the entire signal, and it
/// is what tells a separator apart from a hyphen inside a word.
///
/// An earlier spelling was `indexOf(RegExp(r'[—-]'))`. Inside a character class a
/// trailing `-` is a literal, so that matched an ordinary hyphen too, anywhere —
/// and "E-Book Reader" entered the public catalogue as **"E"**. Not a contrived
/// name: hyphens are ordinary in product names (E-Book, Wi-Fi, To-Do, Co-op).
///
/// En dash is accepted alongside em dash and hyphen because a `–` between spaces
/// is the same authorial gesture; nothing in the input contract prefers one.
///
/// ⚠️ LIVES HERE, NOT IN post_gen.dart, SINCE [10]D-5. Two consumers now need
/// the result — the catalogue row post_gen appends AND the `title.txt` the
/// templates stamp — and a guard compares them to each other. Two spellings of
/// one split is how they would come to disagree.
String _shortName(String displayName) {
  final trimmed = displayName.trim();
  final separator = RegExp(r'\s+[—–-]\s+').firstMatch(trimmed);
  final base = (separator != null && separator.start > 0)
      ? trimmed.substring(0, separator.start)
      : trimmed;
  return base.trim();
}

/// Refuse a spec that a SOURCED store limit already forbids.
///
/// [values] maps a listing FILE to the spec value the templates stamp into it;
/// [why] explains the derivation in the refusal message, because "title.txt is
/// 34 characters" is useless to somebody who typed a display name.
///
/// ── WHY THE NUMBERS ARE READ AND NOT WRITTEN ────────────────────────────────
/// `tooling/channel-register.json` -> `storeMetadataContract.perChannel.<id>
/// .maxChars` is the ONE declaration of every store's field limits, and every
/// entry carries the URL and date it was fetched from. The same block is read by
/// `tooling/ci/assert-store-metadata.mjs`. Restating a number here would make
/// this the second declaration and the first to drift — and a drifted cap that
/// rejects correct input is the failure this brick has already paid for once.
///
/// 🔴 AN ENTRY WITHOUT A `source` IS IGNORED, exactly as the guard ignores it.
/// A limit nobody sourced must never refuse somebody's app.
///
/// ⚠️ THE BINDING LIMIT ACROSS CHANNELS, not each channel's own: one spec stamps
/// all five trees, so the value has to satisfy the tightest max and the loosest
/// min. Apple's name minimum of 2 and Play's maximum of 30 are both real, and an
/// app must clear both.
///
/// COUNTED IN UNICODE CODE POINTS, never `String.length`, which in Dart is UTF-16
/// units: a 30-character name made of astral characters scores 60 and would be
/// refused at a limit both stores accept. Same rule as the guard's `charCount`.
List<String> _sourcedListingLimits(
  Map<String, String> values,
  Map<String, String> why,
) {
  final problems = <String>[];
  final file = File('tooling/channel-register.json');
  if (!file.existsSync()) {
    // REFUSE rather than skip. This brick edits the root pubspec and the shared
    // catalogue; it is repo-local by construction, so a missing register means
    // the stamp is running somewhere it cannot complete — and silently skipping
    // a check is how a limit stops being enforced without anybody noticing.
    return <String>[
      'tooling/channel-register.json was not found from the current directory '
          '(${Directory.current.path}). Stamp from the repository root: the '
          'store listing this brick generates takes its field limits from that '
          'file, and it also has to append the app to the shared catalogue and '
          'the workspace.',
    ];
  }
  Map<String, dynamic> perChannel;
  try {
    final decoded = jsonDecode(file.readAsStringSync());
    final contract = (decoded as Map)['storeMetadataContract'];
    perChannel = ((contract as Map)['perChannel'] as Map)
        .cast<String, dynamic>();
  } catch (e) {
    return <String>[
      'tooling/channel-register.json could not be read for its store field '
          'limits ($e). Nothing was stamped: a listing generated against limits '
          'nobody could read is a listing nobody has checked.',
    ];
  }

  for (final MapEntry<String, String> entry in values.entries) {
    int? boundMax;
    int? boundMin;
    String maxSource = '';
    String minSource = '';
    for (final Object? channel in perChannel.values) {
      if (channel is! Map) continue;
      final Object? limits = channel['maxChars'];
      if (limits is! Map) continue;
      final Object? limit = limits[entry.key];
      if (limit is! Map) continue;
      final Object? source = limit['source'];
      if (source is! String || source.trim().isEmpty) continue; // unsourced
      final Object? max = limit['max'];
      if (max is int && (boundMax == null || max < boundMax)) {
        boundMax = max;
        maxSource = source;
      }
      final Object? min = limit['min'];
      if (min is int && (boundMin == null || min > boundMin)) {
        boundMin = min;
        minSource = source;
      }
    }
    final int n = entry.value.runes.length;
    if (boundMax != null && n > boundMax) {
      problems.add(
        '${entry.key} would be $n characters and the limit is $boundMax. '
        '${why[entry.key] ?? ''}. Source: $maxSource',
      );
    }
    if (boundMin != null && n < boundMin) {
      problems.add(
        '${entry.key} would be $n characters and the minimum is $boundMin. '
        '${why[entry.key] ?? ''}. Source: $minSource',
      );
    }
  }
  return problems;
}

/// Escape [s] for use inside a JSON string, WITHOUT the surrounding quotes.
///
/// Also correct inside a YAML double-quoted scalar (pubspec `description:`):
/// YAML 1.2's double-quoted escapes are a superset of JSON's.
String _jsonBody(String s) {
  final String encoded = jsonEncode(s);
  return encoded.substring(1, encoded.length - 1);
}
