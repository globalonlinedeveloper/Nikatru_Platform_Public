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
  //
  // THE RULE IS contracts/app-id, read from its generated app-id.json (Dart
  // cannot import app-id.js), and this hook carries no copy of it. The id
  // becomes a Worker name and a DNS label (no `_`), a Dart package and an
  // Android package name (no `-`, a letter first, no language keyword) and an
  // Apple bundle id. The length limit is the platform Worker's: services/
  // platform/src/config.ts APP_ID_PATTERN serves at most 32 characters and
  // DROPS a longer id with no error. (The limit here used to be 63, for an
  // `<app_id>.nikatru.com` host that [ADR 075] retired.)
  final String appId = v('app_id');
  bool appIdValid = true;
  final _AppIdContract idRule = _readAppIdContract();
  if (idRule.error != null) {
    appIdValid = false;
    problems.add(idRule.error!);
  } else if (!idRule.pattern!.hasMatch(appId)) {
    appIdValid = false;
    final String offending = appId
        .split('')
        .where((String c) {
          final int u = c.codeUnitAt(0);
          return !((u >= 0x61 && u <= 0x7a) || (u >= 0x30 && u <= 0x39));
        })
        .toSet()
        .map((String c) => '"$c"')
        .join(', ');
    problems.add(
      'app_id must be lowercase letters and digits, starting with a letter '
      '(${idRule.pattern!.pattern}, contracts/app-id) — got "$appId"'
      '${offending.isEmpty ? '' : ', which contains $offending'}. It becomes a '
      'Worker name and a DNS label, which cannot hold "_", and a Dart package '
      'and an Android package name, which cannot hold "-".',
    );
  } else if (appId.length < idRule.minLength ||
      appId.length > idRule.maxLength) {
    appIdValid = false;
    problems.add(
      'app_id must be ${idRule.minLength}-${idRule.maxLength} characters '
      '(contracts/app-id) — got "$appId" (${appId.length}). The platform '
      'Worker serves no longer id: services/platform/src/config.ts '
      'APP_ID_PATTERN drops it without an error.',
    );
  } else if (idRule.reserved.contains(appId)) {
    appIdValid = false;
    problems.add(
      'app_id "$appId" is a reserved word in Dart, Java or Kotlin '
      '(contracts/app-id), so it cannot name the Dart package or the Android '
      'package it becomes.',
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

  // ── icon_label ────────────────────────────────────────────────────────────
  // The name an OPERATING SYSTEM shows, as against the name a STORE shows. See
  // brick.yaml's var description for why they are two fields; the four rules
  // here are the same four tooling/ci/assert-app-naming.mjs holds over
  // apps/*/app.yaml, so a stamp cannot produce an app the gate then refuses.
  //
  // 🔴 THE SHARED-TOKEN RULE IS THE ONE WITH A SOURCE. Apple QA1892 ("the name
  // displayed on the device should be similar to the name in the App Store")
  // makes an icon label with nothing in common with the listing a review risk,
  // not a style choice. "At least one whole token in common" is the weakest
  // mechanical reading of "similar" that still refuses the real failure — a
  // label naming a different product entirely. A common STEM of four characters
  // or more counts as shared, so a plural does not fail it — see _sharesToken.
  //
  // ⚠️ THE CAP IS 15, NOT 30. The store cap is a store's; this one is a home
  // screen's, where iOS truncates around 12-13 glyphs and Android around 11-14.
  // A label longer than that is one no user ever reads in full, so accepting it
  // would be accepting a value that cannot do its job.
  final String iconLabel = v('icon_label');
  if (iconLabel.isEmpty) {
    problems.add(
      'icon_label must not be empty — it is what a home screen, a launcher and '
      'a task switcher print under the app\'s mark, and it is written into the '
      'stamped app.yaml as `shortName:`.',
    );
  } else if (iconLabel.length > 15) {
    problems.add(
      'icon_label must be <= 15 characters — got "$iconLabel" '
      '(${iconLabel.length}). iOS truncates a home-screen label at about 12-13 '
      'glyphs and Android at about 11-14, so a longer one is a label no user '
      'ever reads in full. The STORE title has its own, larger cap and is the '
      '`display_name` var.',
    );
  } else if (iconLabel.contains('\n')) {
    problems.add('icon_label must be a single line.');
  } else if (displayName.isNotEmpty &&
      !_sharesToken(iconLabel, displayName)) {
    problems.add(
      'icon_label "$iconLabel" shares no word with display_name '
      '"$displayName". Apple QA1892 asks that the name shown on the device and '
      'the name shown in the App Store be similar; a label naming a different '
      'product is a review risk rather than a style choice. Pick a word the '
      'listing already uses.',
    );
  }

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
      apiDomain != '$appId-api.nikatru.com') {
    problems.add(
      'api_domain must be "$appId-api.nikatru.com" or empty to derive — got '
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
  // ── markets · audience ────────────────────────────────────────────────────
  // [pipeline K-1 · K-16] Both are resolved against the SAME file — the duty
  // matrix — so it is read once, and a matrix that cannot be read is a refusal
  // rather than a skip, for the same reason `_sourcedListingLimits` refuses:
  // silently skipping a check is how a rule stops being enforced with nobody
  // noticing.
  final _DutyMatrix matrix = _readDutyMatrix();
  if (matrix.error != null) {
    problems.add(matrix.error!);
  }

  // ── markets ───────────────────────────────────────────────────────────────
  // [pipeline K-1] "Every app declares the markets it is offered in." The
  // declaration is only worth having if it RESOLVES to something, which is the
  // second limb: `global` is a word, not a market, and an app declared into
  // `global` has had no per-market duty looked at at all.
  //
  // 🔴 THE VOCABULARY IS COMPUTED FROM THE DUTY MATRIX, NEVER WRITTEN HERE. A
  // list of "markets we support" in this file would be a second declaration and
  // the first to drift — and the drift is silent in the dangerous direction:
  // add `global` to the list, every stamp passes, and the thing the list was
  // for is gone. Computing it means a market can only become declarable by
  // adding the duty row that makes a duty resolvable in it.
  final List<String> markets = v('markets')
      .split(',')
      .map((String s) => s.trim().toLowerCase())
      .where((String s) => s.isNotEmpty)
      .toList();
  if (markets.isEmpty) {
    problems.add(
      'markets must name at least one market — got "${v('markets')}". Every '
      'per-market duty in tooling/legal/duty-matrix.json is resolved from this '
      'list, and a duty resolved from a blank is a duty nobody resolved. '
      'Resolvable today: ${matrix.vocabulary.join(', ')}.',
    );
  } else if (markets.toSet().length != markets.length) {
    problems.add(
      'markets lists the same market twice — got "${markets.join(', ')}". Two '
      'spellings of one market is how a per-market duty gets discharged once '
      'and counted twice.',
    );
  } else if (matrix.error == null) {
    // COVERAGE SELF-CHECK, and it is the one this limb genuinely needs. If no
    // row in the matrix carries a `markets` array the vocabulary is EMPTY, and
    // then every market on earth "resolves to zero rows" — the check would
    // refuse every correct spec while looking like it was working. That is the
    // mirror image of an assertion that cannot fail, and it must be named
    // rather than left to be inferred from a confusing per-market failure.
    if (matrix.vocabulary.isEmpty) {
      problems.add(
        'COVERAGE LOST — not one row in tooling/legal/duty-matrix.json carries a '
        '`markets` array, so the market vocabulary is empty and EVERY declared '
        'market would resolve to zero duties. This check would then refuse every '
        'correct spec. Either the tags were deleted, or this hook has stopped '
        'seeing them.',
      );
    } else {
      final List<String> unresolvable =
          markets.where((String m) => matrix.rowsFor(m).isEmpty).toList();
      if (unresolvable.isNotEmpty) {
        problems.add(
          'these declared market(s) resolve to ZERO duty rows in '
          'tooling/legal/duty-matrix.json: ${unresolvable.join(', ')}. A market '
          'nothing in the compliance corpus is scoped to is a market nobody has '
          'done the work for, so declaring it would record a promise the tree '
          'cannot keep — that is exactly how "global" comes to mean nothing. '
          'Resolvable today: ${matrix.vocabulary.join(', ')}. To add one, tag '
          'the duty row that applies there with its market and stamp again.',
        );
      }
    }
  }

  // ── audience ──────────────────────────────────────────────────────────────
  // [pipeline K-16] "No kids app without the children's surface."
  //
  // 🔴 THE VERDICT IS READ OUT OF THE DUTY MATRIX, NOT WRITTEN HERE. A bare
  // `if (audience == 'children') throw` would be a rule that can never pass:
  // correct once, then permanently wrong the day somebody builds the surface,
  // and the only thing standing between the two is a person remembering to come
  // back and delete a line. So the condition is the ROW's own state — status
  // `implemented` AND an `artefact` that is really on disk. Both halves matter:
  // the status alone can be flipped by anybody, and an artefact path alone
  // proves nothing about whether the duty was discharged.
  const List<String> audiences = <String>['general', 'children'];
  final String audience = v('audience').toLowerCase();
  if (!audiences.contains(audience)) {
    problems.add(
      'audience must be one of ${audiences.join(', ')} — got "$audience". '
      'Nothing in a repository can derive an intended audience; this is a '
      'declaration, and it decides which duties the app has taken on.',
    );
  } else if (audience == 'children' && matrix.error == null) {
    final Map<String, dynamic>? row = matrix.rowById(
      'children-surface-before-a-kids-app',
    );
    if (row == null) {
      problems.add(
        'COVERAGE LOST — tooling/legal/duty-matrix.json has no '
        '`children-surface-before-a-kids-app` row, so a children\'s audience '
        'has nothing to be checked against. An absent row reads exactly like a '
        'discharged one and must not be treated as a pass.',
      );
    } else if (!_surfaceExists(row)) {
      problems.add(
        'audience is "children" and the children\'s surface does not exist. '
        'tooling/legal/duty-matrix.json row `children-surface-before-a-kids-app` '
        '[K-16] is "${row['status']}" and names '
        '${row['artefact'] == null ? 'no artefact' : 'artefact ${row['artefact']}'}'
        ' — the duty is "no app is offered to children without the surface a '
        'children\'s audience requires", and this spec would offer one. Build '
        'the surface, set that row to `implemented` naming it, and stamp again; '
        'until then declare audience: general.',
      );
    }
  }

  final String shortName = _shortName(displayName);
  // ── THE SNAP NAME IS DERIVED FROM THE STORE TITLE, NEVER THE SLUG ────────
  // store/linux-snap/snap-name.txt is the GLOBAL Snap Store namespace, claimed
  // once at `snapcraft register` and never released. tooling/ci/
  // assert-store-identity.mjs requires it to EQUAL param-case(apps/<id>/app.yaml
  // name), and post_gen writes that `name` as `shortName`. Until 2026-09-11 the
  // template stamped `app_id` through mason's paramCase — the slug — so every
  // stamped app failed that guard on its first run (probe: `probe` against
  // `probe-s-e-book-co`). The value is derived HERE, once, and the template
  // stamps it; the algorithm is the guard's, restated in `_snapName`.
  final String? snapName = _snapName(shortName);
  if (snapName == null) {
    problems.add(
      'the snap name cannot be derived from the store title "$shortName". '
      'store/linux-snap/snap-name.txt must equal param-case(apps/<id>/app.yaml '
      'name) (tooling/ci/assert-store-identity.mjs), and this hook derives it '
      'only from an ASCII title with at least one letter or digit: it has no '
      'Unicode normalisation, and a snap name is a GLOBAL, permanent claim that '
      'can only be ASCII anyway. Give the display name an ASCII store title '
      'before its subtitle separator.',
    );
  }
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
  // purpose — deriving `<id>-api.nikatru.com` would stamp a hostname that will
  // never resolve. `api_base_url` below is what such an app actually calls.
  // 🔴 THE SHAPE IS `<id>-api`, NOT `api-<id>`. [ADR 080] §3 retired [ADR 006]'s
  // prefix form on 2026-09-11 so that every host an app owns sorts together;
  // the live one is `subscriptiontracker-api.nikatru.com`. Both forms are one
  // label deep, so assert-hostname-depth.mjs could not tell them apart until
  // its second limb was added — this template stamped the retired form for a
  // day and nothing went red.
  final String resolvedApiDomain = !needsBackend
      ? ''
      : (apiDomain.isEmpty ? '$appId-api.nikatru.com' : apiDomain);
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
  // The GLOBAL snap name, derived above from the same `shortName` post_gen writes
  // as app.yaml `name`. Only [a-z0-9-] can reach it, so a double stache is safe.
  vars['snap_name'] = snapName ?? '';
  // The ICON label, not the store title — see the icon_label rules above. The
  // JSON-escaped twin exists for the same reason `display_name_json` does: it
  // lands inside a PWA manifest string body, where a raw `"` ends the value.
  vars['icon_label'] = iconLabel;
  vars['icon_label_json'] = _jsonBody(iconLabel);
  vars['display_name_dart'] = _dartSingleQuoted(displayName);
  vars['display_name_json'] = _jsonBody(displayName);
  vars['description_json'] = _jsonBody(description);
  // [pipeline K-1] THE RESOLVED LIST, so the declaration OUTLIVES THE STAMP. A
  // var that is validated and then dropped makes "every app declares its
  // markets" true for the duration of one command and false forever after —
  // post_gen writes these into the app's catalogue row, which is where a person
  // asking "where is this offered?" actually looks.
  vars['markets'] = markets.join(',');
  vars['audience'] = audience;

  context.logger.info('Stamping $displayName ($appId)…');
}

/// The app-id rule as this hook needs it: the pattern, the length bounds and the
/// reserved words of `contracts/app-id`. O-APP-ID-FORM-UNVALIDATED (a).
///
/// FAIL-CLOSED BY CONSTRUCTION, like [_DutyMatrix]: every way of failing to read
/// the rule produces an [error], which the caller turns into a refusal. There is
/// no fallback rule in this file, because a fallback is a second copy of the rule.
class _AppIdContract {
  _AppIdContract(this.pattern, this.minLength, this.maxLength, this.reserved)
      : error = null;
  _AppIdContract.failed(String this.error)
      : pattern = null,
        minLength = 0,
        maxLength = 0,
        reserved = const <String>{};

  final String? error;
  final RegExp? pattern;
  final int minLength;
  final int maxLength;
  final Set<String> reserved;
}

/// Read `contracts/app-id/app-id.json`, or say why not.
///
/// The file is GENERATED from `contracts/app-id/app-id.js` by
/// `contracts/app-id/generate.mjs`, because Dart cannot import the JavaScript
/// that every node caller imports. Read relative to the repository root, like
/// [_readDutyMatrix] and [_sourcedListingLimits], and for the same reason: an id
/// checked against a rule nobody could open is an id nobody checked.
_AppIdContract _readAppIdContract() {
  final File file = File('contracts/app-id/app-id.json');
  if (!file.existsSync()) {
    return _AppIdContract.failed(
      'contracts/app-id/app-id.json was not found from the current directory '
      '(${Directory.current.path}), so app_id could not be checked against '
      'the app-id rule. Stamp from the repository root. Nothing was stamped.',
    );
  }
  try {
    final Map<String, dynamic> decoded =
        (jsonDecode(file.readAsStringSync()) as Map).cast<String, dynamic>();
    final Map<String, dynamic> rule =
        (decoded['rule'] as Map).cast<String, dynamic>();
    final String pattern = rule['pattern'] as String;
    final int minLength = rule['minLength'] as int;
    final int maxLength = rule['maxLength'] as int;
    final Set<String> reserved =
        (decoded['reserved'] as List).cast<String>().toSet();
    return _AppIdContract(RegExp(pattern), minLength, maxLength, reserved);
  } catch (e) {
    return _AppIdContract.failed(
      'contracts/app-id/app-id.json could not be read as the app-id rule ($e), '
      'so app_id could not be checked. Regenerate it with '
      '`node contracts/app-id/generate.mjs`. Nothing was stamped.',
    );
  }
}

/// The duty matrix as this hook needs it: the rows, plus the market vocabulary
/// they imply. [pipeline K-1 · K-16]
///
/// FAIL-CLOSED BY CONSTRUCTION. Every way of failing to read the file produces
/// an [error], and the caller turns that into a refusal — it never produces an
/// empty row list, which would read to every check downstream as "nothing to
/// worry about" and pass a spec nobody validated.
class _DutyMatrix {
  _DutyMatrix.failed(String this.error) : rows = const <Map<String, dynamic>>[];
  _DutyMatrix.of(this.rows) : error = null;

  final String? error;
  final List<Map<String, dynamic>> rows;

  /// Every market token any row declares, sorted. THIS IS THE VOCABULARY —
  /// there is no other list, deliberately (see the caller's 🔴 note).
  List<String> get vocabulary {
    final Set<String> seen = <String>{};
    for (final Map<String, dynamic> r in rows) {
      final Object? m = r['markets'];
      if (m is! List) continue;
      for (final Object? token in m) {
        if (token is String && token.trim().isNotEmpty) {
          seen.add(token.trim().toLowerCase());
        }
      }
    }
    final List<String> out = seen.toList()..sort();
    return out;
  }

  /// The rows scoped to [market]. Empty means the market resolves to no duty.
  List<Map<String, dynamic>> rowsFor(String market) =>
      rows.where((Map<String, dynamic> r) {
        final Object? m = r['markets'];
        if (m is! List) return false;
        return m.any(
          (Object? t) => t is String && t.trim().toLowerCase() == market,
        );
      }).toList();

  Map<String, dynamic>? rowById(String id) {
    for (final Map<String, dynamic> r in rows) {
      if (r['id'] == id) return r;
    }
    return null;
  }
}

/// Read `tooling/legal/duty-matrix.json`, or say why not.
///
/// Same refusal-not-skip rule as [_sourcedListingLimits], and for the same
/// reason: this brick is repo-local by construction (it edits the root pubspec
/// and the shared catalogue), so a matrix that cannot be read means the stamp is
/// running somewhere it cannot complete — not that there are no duties.
_DutyMatrix _readDutyMatrix() {
  final File file = File('tooling/legal/duty-matrix.json');
  if (!file.existsSync()) {
    return _DutyMatrix.failed(
      'tooling/legal/duty-matrix.json was not found from the current directory '
      '(${Directory.current.path}). Stamp from the repository root: the market '
      'and audience declarations are resolved against that file, and a market '
      'resolved against a file nobody could open is a market nobody checked.',
    );
  }
  try {
    final Object? decoded = jsonDecode(file.readAsStringSync());
    final Object? duties = (decoded as Map)['duties'];
    if (duties is! List) {
      return _DutyMatrix.failed(
        'tooling/legal/duty-matrix.json has no `duties` array, so no market and '
        'no audience can be resolved against it. Nothing was stamped.',
      );
    }
    return _DutyMatrix.of(
      duties
          .whereType<Map<Object?, Object?>>()
          .map((Map<Object?, Object?> r) => r.cast<String, dynamic>())
          .toList(),
    );
  } catch (e) {
    return _DutyMatrix.failed(
      'tooling/legal/duty-matrix.json could not be read ($e). Nothing was '
      'stamped: a market declaration checked against an unreadable corpus is a '
      'declaration nobody checked.',
    );
  }
}

/// Does [row] name a children's surface that is genuinely in the tree?
///
/// TWO conditions, and neither is sufficient alone. `status == 'implemented'` is
/// a word anybody can type; an `artefact` path proves a file exists but not that
/// the row claims to be done. Together they are the duty matrix's own definition
/// of discharged ("an artefact in this tree discharges it, and the row names
/// that artefact"), which is why this reads the row rather than restating it.
bool _surfaceExists(Map<String, dynamic> row) {
  if (row['status'] != 'implemented') return false;
  final Object? artefact = row['artefact'];
  if (artefact is! String || artefact.trim().isEmpty) return false;
  final String path = artefact.trim();
  return File(path).existsSync() || Directory(path).existsSync();
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
/// The words of a name, lowercased. An intra-word hyphen or apostrophe is part
/// of the word ("E-Book", "Traveler's"); everything else separates.
List<String> _tokens(String s) => s
    .toLowerCase()
    .split(RegExp(r"[^a-z0-9'\-]+"))
    .map((String t) => t.replaceAll(RegExp(r"^['\-]+|['\-]+$"), ''))
    .where((String t) => t.isNotEmpty)
    .toList();

/// Do two names share a word? A COMMON STEM OF AT LEAST FOUR CHARACTERS counts,
/// which is what makes "Subscriptions" similar to "Subscription Tracker" — an
/// exact-equality rule would refuse a plural, and a rule that refuses the
/// obviously-similar case is one people route around rather than obey. Four is
/// the floor at which a shared prefix stops being an accident of the alphabet:
/// "Sub" would marry "Subway" to "Submarine", "Subs" does not reach "Submarine".
bool _sharesToken(String a, String b) {
  for (final String x in _tokens(a)) {
    for (final String y in _tokens(b)) {
      final String shorter = x.length <= y.length ? x : y;
      final String longer = x.length <= y.length ? y : x;
      if (shorter.length >= 4 && longer.startsWith(shorter)) return true;
    }
  }
  return false;
}

/// param-case of a store title, EXACTLY as tooling/ci/assert-store-identity.mjs
/// computes it for an ASCII input: lower-case, every run of characters outside
/// [a-z0-9] becomes one hyphen, and leading and trailing hyphens are dropped.
///
/// Returns null — and pre_gen refuses the stamp — when the title holds any
/// non-ASCII character, or no letter or digit at all. The guard applies Unicode
/// NFKD first (so `é` becomes `e`); Dart's core libraries have no normaliser, and
/// an approximation that disagreed with the guard on one character would stamp
/// a permanent global claim nobody reviewed. A refusal names the fix instead.
String? _snapName(String storeTitle) {
  final StringBuffer out = StringBuffer();
  bool pendingHyphen = false;
  for (final int rune in storeTitle.runes) {
    if (rune > 0x7f) return null;
    final int c = (rune >= 0x41 && rune <= 0x5a) ? rune + 0x20 : rune;
    final bool alnum = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
    if (!alnum) {
      pendingHyphen = true;
      continue;
    }
    if (pendingHyphen && out.isNotEmpty) out.write('-');
    pendingHyphen = false;
    out.writeCharCode(c);
  }
  return out.isEmpty ? null : out.toString();
}

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
    perChannel =
        ((contract as Map)['perChannel'] as Map).cast<String, dynamic>();
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
