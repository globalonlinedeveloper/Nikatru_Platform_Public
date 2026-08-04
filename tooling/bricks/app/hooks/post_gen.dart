import 'dart:convert';
import 'dart:io';

import 'package:mason/mason.dart';

import 'brand_assets.dart';

/// After a stamp: (1) append the app to sites/_shared/_data/apps.json (SHOW-1,
/// automated), then (2) print the owner's manual, non-automatable checklist.
void run(HookContext context) {
  final v = context.vars;
  final id = (v['app_id'] ?? '').toString();
  final displayName = (v['display_name'] ?? id).toString();
  final subdomain = (v['subdomain'] ?? '').toString();
  final apiDomain = (v['api_domain'] ?? '').toString();
  final tagline = (v['description'] ?? '').toString();
  final needsBackend = v['needs_backend'] == true;

  // [pipeline S-8] DERIVE, do not blank. `subdomain` is now normally EMPTY —
  // pre_gen refuses a value that disagrees with the convention, so leaving it
  // blank is the expected input. Publishing '' here would put an entry with no
  // url into the public catalogue; `webHost` below already derived correctly,
  // and these two disagreeing is precisely the divergence S-8 exists to stop.
  final webHost = subdomain.isEmpty ? '$id.nikatru.com' : subdomain;

  _appendToAppsJson(
    context,
    id: id,
    name: _shortName(displayName),
    tagline: tagline,
    url: 'https://$webHost',
    // A client-only app has NO API host of its own — it calls the shared
    // platform Worker. Writing `api-<app>.nikatru.com` here would publish a
    // hostname that will never resolve into a PUBLIC catalog ([ADR 020]).
    api: (!needsBackend || apiDomain.isEmpty) ? '' : 'https://$apiDomain',
  );

  _registerInWorkspace(context, id: id);

  // [pipeline S-14] Brand assets are GENERATED, never copied. The brick used to
  // ship Flutter's stock icons and every stamped app inherited them — measured
  // 2026-07-29, all five were byte-identical to `flutter create` output, which is
  // DoD §4-G's "ships the default Flutter icon" reproduced in the template where
  // it lands on all fifty apps at once. The mark is pure arithmetic over app_id
  // and seed_hex, so it obeys [ADR 019]'s NO-IP-PROMPTING rule by using no model
  // at all, and a re-stamp reproduces it byte-for-byte ([3]S-15).
  _writeBrandAssets(context, id: id, seedHex: (v['seed_hex'] ?? '').toString());

  final apiHost = apiDomain.isEmpty ? 'api-$id.nikatru.com' : apiDomain;

  context.logger.info('');
  if (needsBackend) {
    context.logger
      ..success('Stamped $id (apps/$id + services/$id-api). Owner checklist:')
      ..info(
        '  1. Add store metadata for apps/\$id. Web icons were GENERATED '
        'from seed_hex — replace them only if you have real art.',
      )
      // 🔴 THE STEP THAT WAS MISSING, AND ITS ABSENCE COST apps/subly FOUR
      // PLATFORMS — 29 icon files byte-identical to `flutter create`, measured
      // 2026-08-04. Nothing in the old checklist mentioned icons afterwards, so
      // the owner ran the command that writes Flutter's default logo and had no
      // reason to think anything else was needed. `warn` rather than `info` on
      // purpose: this is the one line whose omission stays invisible until a
      // store reviewer sees it.
      //
      // ⚠️ THE MESSAGE NAMES NO APP, and that is [C-10] rather than shyness:
      // comments here are exempt from assert-no-clone-tells.mjs and STRING
      // LITERALS ARE NOT. Shared code that knows which app it is in makes every
      // other app inherit a rule about a product it is not — caught by that
      // guard on the first CI run of this change.
      ..warn(
        '  1a. THE MOMENT YOU ADD NATIVE PLATFORMS, BRAND THEM. '
        '`flutter create . --platforms=android,ios,macos,windows,linux` writes '
        "FLUTTER'S DEFAULT LOGO into every one of them — that is exactly how "
        'the first app in this portfolio came to ship the stock icon on '
        'Android, iOS, macOS and Windows at once. Immediately after, run:  '
        'cd apps/$id && dart run flutter_launcher_icons  '
        '(config + source art are already stamped; CI fails on a stock icon).',
      )
      ..info(
        '  2. ONE COMMAND provisions the backend — create the D1 in apac, '
        'patch APP_DB.database_id, apply the starter migration, and PROVE '
        'all three against the live database:',
      )
      ..info('       node tooling/scripts/provision-backend.mjs $id')
      ..info(
        '     (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID. Do NOT '
        '`source` .claude/secrets.env — it is not a pure env file; extract '
        'the two keys. [pipeline S-12])',
      )
      // [pipeline S-1r] NOT "add DNS". [ADR 006] locked a proxied wildcard
      // `*.nikatru.com`, so a stamped app needs ZERO new DNS — and the old step
      // sent the owner to create a record that already resolves, while the thing
      // actually keeping the app dark went unnamed. Re-measured 2026-08-01 over
      // DNS-over-HTTPS (the system resolver has no egress here): four random
      // labels under nikatru.com all returned the same Cloudflare addresses,
      // while the same labels under two control domains returned no A record at
      // all — so the wildcard is answering, not the resolver being permissive.
      // An unattached host then answers 522, never NXDOMAIN, which is why "it
      // resolves" is not the question worth asking.
      ..info(
        '  3. NO DNS RECORD IS NEEDED — the wildcard *.nikatru.com already '
        'resolves $webHost and $apiHost ([ADR 006]). ATTACHMENT is what is '
        'missing: bind $webHost to the app\'s deployment and $apiHost to this '
        'Worker\'s routes, or both answer 522 while resolving perfectly.',
      )
      ..info(
        '  4. REQUIRED for the web build: add "https://$webHost" to '
        'ALLOWED_ORIGINS in services/platform/wrangler.jsonc and redeploy. '
        'The allowlist is EXACT — omit this and the app silently loses '
        'config + analytics in the browser, with no server-side error.',
      )
      ..info('  5. cd apps/$id && flutter pub get && flutter analyze.')
      ..warn(
        'This app claimed one of the TEN D1 databases the free tier '
        'allows per ACCOUNT (platform_db is another). If it does not really '
        'store user rows, re-stamp with needs_backend=false.',
      );
  } else {
    context.logger
      ..success('Stamped $id (apps/$id — CLIENT-ONLY). Owner checklist:')
      ..info(
        '  1. Add store metadata for apps/\$id. Web icons were GENERATED '
        'from seed_hex — replace them only if you have real art.',
      )
      // 🔴 THE STEP THAT WAS MISSING, AND ITS ABSENCE COST apps/subly FOUR
      // PLATFORMS — 29 icon files byte-identical to `flutter create`, measured
      // 2026-08-04. Nothing in the old checklist mentioned icons afterwards, so
      // the owner ran the command that writes Flutter's default logo and had no
      // reason to think anything else was needed. `warn` rather than `info` on
      // purpose: this is the one line whose omission stays invisible until a
      // store reviewer sees it.
      //
      // ⚠️ THE MESSAGE NAMES NO APP, and that is [C-10] rather than shyness:
      // comments here are exempt from assert-no-clone-tells.mjs and STRING
      // LITERALS ARE NOT. Shared code that knows which app it is in makes every
      // other app inherit a rule about a product it is not — caught by that
      // guard on the first CI run of this change.
      ..warn(
        '  1a. THE MOMENT YOU ADD NATIVE PLATFORMS, BRAND THEM. '
        '`flutter create . --platforms=android,ios,macos,windows,linux` writes '
        "FLUTTER'S DEFAULT LOGO into every one of them — that is exactly how "
        'the first app in this portfolio came to ship the stock icon on '
        'Android, iOS, macOS and Windows at once. Immediately after, run:  '
        'cd apps/$id && dart run flutter_launcher_icons  '
        '(config + source art are already stamped; CI fails on a stock icon).',
      )
      // [pipeline S-1r] Same correction as the backend branch above — see the
      // note there for the measurement. The wildcard makes this a NON-step; the
      // real one is attachment, and saying "add DNS" hid it.
      ..info(
        '  2. NO DNS RECORD IS NEEDED — the wildcard *.nikatru.com already '
        'resolves $webHost ([ADR 006]); ATTACH it to the deployment or it '
        'answers 522 while resolving perfectly. No API host and no D1 '
        'database are needed — this app uses the shared platform Worker.',
      )
      ..info(
        '  3. REQUIRED for the web build: add "https://$webHost" to '
        'ALLOWED_ORIGINS in services/platform/wrangler.jsonc and redeploy. '
        'The allowlist is EXACT — omit this and the app silently loses '
        'config + analytics in the browser, with no server-side error.',
      )
      ..info('  4. cd apps/$id && flutter pub get && flutter analyze.')
      ..info(
        'No Worker, no database, no R2 bucket was stamped. If this app '
        'later needs to store user rows server-side, add them deliberately '
        'rather than re-stamping over local changes.',
      );
  }
}

/// [pipeline S-4] Add the stamped app to the root `workspace:` list.
///
/// 🔴 WITHOUT THIS, `melos run gate` SKIPS THE NEW APP ENTIRELY. The workspace
/// list is what the gate iterates, `apps/subly` is on it because a human typed
/// it there, and the stamper added nothing — so the newest and least-tested app
/// in the repository was the one thing the one-command check did not check. It
/// failed in the direction that looks fine: green tick, nothing examined.
///
/// Idempotent, and deliberately a text edit rather than a YAML round-trip: the
/// root pubspec carries comments that a parse-and-rewrite would silently strip,
/// including the one explaining why the odd `{{#needs_backend}}` directories
/// under `__brick__/` must not be tidied.
void _registerInWorkspace(HookContext context, {required String id}) {
  final file = File('pubspec.yaml');
  if (!file.existsSync()) {
    context.logger.warn(
      'pubspec.yaml not found; skipped workspace registration.',
    );
    return;
  }
  final lines = file.readAsLinesSync();
  final start = lines.indexWhere((l) => l.trimRight() == 'workspace:');
  if (start == -1) {
    context.logger.warn('no `workspace:` block in pubspec.yaml; skipped.');
    return;
  }
  // The block runs until the first line that is not a `  - ` entry.
  var end = start + 1;
  while (end < lines.length && RegExp(r'^  - \S').hasMatch(lines[end])) {
    end++;
  }
  final entry = '  - apps/$id';
  if (lines.sublist(start + 1, end).any((l) => l.trimRight() == entry)) {
    context.logger.info(
      'pubspec.yaml already lists "apps/$id"; left unchanged.',
    );
    return;
  }
  lines.insert(end, entry);
  file.writeAsStringSync('${lines.join('\n')}\n');
  context.logger.success('pubspec.yaml: added "apps/$id" to the workspace.');
}

/// "Lingo — Offline Phrasebook" -> "Lingo". "E-Book Reader" -> "E-Book Reader".
///
/// 🔴 THE SPLIT IS ON A SUBTITLE SEPARATOR, NOT ON "A DASH". `brick.yaml`'s own
/// example is `Lingo — Offline Phrasebook`: the catalogue wants the NAME and the
/// display name carries `<name> <separator> <tagline>`. The separator is a dash
/// **surrounded by whitespace** — that whitespace is the entire signal, and it
/// is what tells a separator apart from a hyphen inside a word.
///
/// The previous spelling was `indexOf(RegExp(r'[—-]'))`. Inside a character
/// class a trailing `-` is a literal, so that matched an ordinary hyphen too,
/// anywhere — and "E-Book Reader" entered the public catalogue as **"E"**. Not a
/// contrived name: hyphens are ordinary in product names (E-Book, Wi-Fi, To-Do,
/// Co-op, Multi-Timer), and the corruption is silent everywhere except the
/// catalogue page a visitor reads.
///
/// En dash is accepted alongside em dash and hyphen because a `–` between spaces
/// is the same authorial gesture; nothing in the input contract prefers one.
String _shortName(String displayName) {
  final trimmed = displayName.trim();
  final separator = RegExp(r'\s+[—–-]\s+').firstMatch(trimmed);
  final base = (separator != null && separator.start > 0)
      ? trimmed.substring(0, separator.start)
      : trimmed;
  return base.trim();
}

/// SHOW-1: append `id` to the shared apps catalog if not already present.
/// Idempotent; leaves the file untouched when the slug already exists.
void _appendToAppsJson(
  HookContext context, {
  required String id,
  required String name,
  required String tagline,
  required String url,
  required String api,
}) {
  final file = File('sites/_shared/_data/apps.json');
  if (!file.existsSync()) {
    context.logger.warn(
      'apps.json not found at ${file.path}; skipped SHOW-1 append.',
    );
    return;
  }
  final decoded = jsonDecode(file.readAsStringSync());
  if (decoded is! List) {
    context.logger.warn('apps.json is not a JSON array; skipped.');
    return;
  }
  if (decoded.any((e) => e is Map && e['slug'] == id)) {
    context.logger.info('apps.json already lists "$id"; left unchanged.');
    return;
  }
  decoded.add(<String, dynamic>{
    'slug': id,
    'name': name,
    'tagline': tagline,
    'url': url,
    'api': api,
    'platforms': <String>['web'],
    'status': 'preview',
  });
  const encoder = JsonEncoder.withIndent('  ');
  file.writeAsStringSync('${encoder.convert(decoded)}\n');
  context.logger.success('apps.json: added "$id" (SHOW-1).');
}

/// [pipeline S-14] Generate the app's web icons from its spec.
///
/// Warns rather than throws: post_gen runs AFTER the tree is written, so a
/// failure here would leave a half-stamped app, which is exactly the half-state
/// [3]S-13's refusal exists to prevent. The missing assets are not silent — the
/// `app_brick` lane's brand-asset guard fails on them, so the gap surfaces at the
/// gate rather than in a store review.
void _writeBrandAssets(
  HookContext context, {
  required String id,
  required String seedHex,
}) {
  final webDir = Directory('apps/$id/web');
  try {
    final written = writeWebBrandAssets(
      webDir: webDir,
      appId: id,
      seedHex: seedHex,
    );
    context.logger.success(
      'brand assets: generated ${written.length} icon(s) for "$id" from seed #$seedHex.',
    );
  } catch (e) {
    context.logger.warn(
      'brand assets: generation failed ($e); icons NOT written.',
    );
  }

  // 🔴 THE NATIVE HALF, AND IT IS THE HALF THAT WAS MISSING. The brick stamps
  // `web/` only; the owner adds android/ios/macos/windows/linux with
  // `flutter create . --platforms=…`, which WRITES FLUTTER'S DEFAULT ICONS. That
  // is exactly how apps/subly ended up shipping the stock logo on four platforms
  // at once (measured 2026-08-04, 29 byte-identical files) while its web icons
  // were correct. Without these sources the stamped `flutter_launcher_icons:`
  // block would point at art nobody generated and fail on first use — and its
  // failure mode is the stock icon quietly surviving.
  // Guarded by tooling/ci/assert-launcher-icons.mjs.
  try {
    final written = writeNativeIconSources(
      iconDir: Directory('apps/$id/assets/icon'),
      appId: id,
      seedHex: seedHex,
    );
    context.logger.success(
      'brand assets: generated ${written.length} native icon source(s) for "$id" '
      '(run `dart run flutter_launcher_icons` after adding platforms).',
    );
  } catch (e) {
    context.logger.warn(
      'brand assets: native icon sources failed ($e); NOT written. The app '
      'would take Flutter\'s default launcher icon on every native platform.',
    );
  }
}
