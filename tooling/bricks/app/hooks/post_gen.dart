import 'dart:convert';
import 'dart:io';

import 'package:mason/mason.dart';

import 'brand_assets.dart';

/// After a stamp: (1) append the app to catalog/apps.json (SHOW-1, automated),
/// then (2) print the owner's manual, non-automatable checklist.
///
/// 🔴 THE CATALOGUE IS THE PUBLISHED RECORD; THE SITE'S DATA FILE IS DERIVED
/// FROM IT. `sites/_shared/_data/apps.json` is no longer hand-kept — it is
/// generated from `catalog/apps.json`, so this hook writing anywhere else is a
/// row the website never sees.
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

  // [pipeline 10]D-5 — pre_gen owns the split now and writes `short_name` back
  // into the vars mason hands both the templates and this hook, so the
  // catalogue `name` and every `store/*/title.txt` are the SAME string by
  // construction. The fallback is for a hook invoked without pre_gen having run
  // (nothing in this repo does that) and computes nothing of its own.
  _appendToAppsJson(
    context,
    id: id,
    name: (v['short_name'] ?? displayName).toString(),
    tagline: tagline,
    url: 'https://$webHost',
    // A client-only app has NO API host of its own — it calls the shared
    // platform Worker. Writing `api-<app>.nikatru.com` here would publish a
    // hostname that will never resolve into a PUBLIC catalog ([ADR 020]).
    api: (!needsBackend || apiDomain.isEmpty) ? '' : 'https://$apiDomain',
    // [pipeline K-1 · K-16] THE DECLARATION HAS TO OUTLIVE THE STAMP. pre_gen
    // refuses a spec with no market and normalises what survives; if the value
    // stopped there, "every app declares the markets it is offered in" would be
    // true for the length of one command. The catalogue row is where it belongs:
    // it is the public record of what this app IS, and it is the file a person
    // asking "where is this offered, and who to?" already opens.
    markets: (v['markets'] ?? '')
        .toString()
        .split(',')
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList(),
    audience: (v['audience'] ?? '').toString(),
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

  // [pipeline 10]D-5. The listing TEXT is stamped by the templates under
  // `__brick__/apps/{{app_id}}/store/`; the two Play GRAPHICS cannot be, because
  // a template file is text. They are generated here from the same `app_id` +
  // `seed_hex` the icons come from, at the dimensions the channel register
  // declares. Without them a stamped app's android-play tree is INCOMPLETE and
  // `assert-store-metadata.mjs` fails the first CI run after the app joins the
  // catalogue — the factory would be shipping app #2 a red build.
  _writeStoreGraphics(
    context,
    id: id,
    seedHex: (v['seed_hex'] ?? '').toString(),
  );

  // 🔴 THE INTEGRATION HALF OF THE SAME REQUIREMENT, AND IT ONLY BECAME
  // REACHABLE WHEN THE LISTING DID. assert-store-metadata.mjs treats a store
  // metadata TREE as the app's commitment to that channel: an app that carries
  // one and has no `msix_config:` gets packaged by `msix` under its fallback
  // identity `com.flutter.<name>` — a name that belongs to nobody — and the
  // build still succeeds. That was a PRINT for as long as no stamped app had a
  // tree, with the guard's own comment saying "that is the brick work D-5 still
  // owes". The first stamp after the store templates landed turned it into a
  // FAIL, exactly as designed. This is that debt paid.
  _writeMsixConfig(
    context,
    id: id,
    displayName: (v['short_name'] ?? displayName).toString(),
  );

  final apiHost = apiDomain.isEmpty ? 'api-$id.nikatru.com' : apiDomain;

  context.logger.info('');
  if (needsBackend) {
    context.logger
      ..success('Stamped $id (apps/$id + services/$id-api). Owner checklist:')
      // [pipeline 10]D-5. This step USED TO READ "Add store metadata for
      // apps/$id" — the factory instructing its owner to hand-write, per app,
      // the one artefact D-5 says is GENERATED from the spec. It was the
      // clearest statement in the repository that the brick emitted no listing,
      // and it printed on every stamp. The brick now stamps all five store trees
      // and their graphics, so this is a REVIEW step, not an authoring one.
      ..info(
        '  1. Review apps/$id/store/ — five complete store listings were '
        'GENERATED from the spec, and so were the web icons and the Play '
        'graphics. Derived fields (title, short description, the two URLs) are '
        'compared to their source on every CI run: change the spec, not the '
        'copy. Editorial fields (long-description, keywords, search terms) are '
        'yours to sharpen. Replace the generated art only if you have real art.',
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
        '(config + source art are already stamped; CI fails on a stock icon). '
        'THEN, IF YOU ADDED linux: that tool has no Linux target and the Linux '
        'embedder has no icon slot — the icon there is a PACKAGING artefact, so '
        'also run:  node tooling/store/render-linux-icons.mjs --app $id  '
        '(writes linux/packaging/; CI re-derives it and fails on drift).',
      )
      ..info(
        '  2. ONE COMMAND provisions the backend — create the D1 in apac, '
        'patch APP_DB.database_id, apply the starter migration, and PROVE '
        'all three against the live database:',
      )
      ..info('       node tooling/scripts/provision-backend.mjs $id')
      ..info(
        // The "not a pure env file" reason was retired 2026-08-10: the vault is
        // pure KEY=VALUE now and sourcing exits 0. The ADVICE is unchanged, on
        // the reason that outlived it — extracting two keys exposes two, and
        // sourcing exposes forty to everything this command spawns.
        '     (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID. Extract just '
        'those two from .claude/secrets.env rather than sourcing it — least '
        'exposure — and strip the surrounding quotes. [pipeline S-12])',
      )
      // [pipeline S-1r] (absent from the frozen pipeline origin lock by construction — S-1r is a residual of S-1, raised by Private/plans/03-stamper-plan.md after that lock was taken; the lock file is not named here because this file's own phantom-filename limb requires every `*.json` it mentions to exist in the tree) NOT "add DNS". [ADR 006] locked a proxied wildcard
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
      // [pipeline 10]D-5. This step USED TO READ "Add store metadata for
      // apps/$id" — the factory instructing its owner to hand-write, per app,
      // the one artefact D-5 says is GENERATED from the spec. It was the
      // clearest statement in the repository that the brick emitted no listing,
      // and it printed on every stamp. The brick now stamps all five store trees
      // and their graphics, so this is a REVIEW step, not an authoring one.
      ..info(
        '  1. Review apps/$id/store/ — five complete store listings were '
        'GENERATED from the spec, and so were the web icons and the Play '
        'graphics. Derived fields (title, short description, the two URLs) are '
        'compared to their source on every CI run: change the spec, not the '
        'copy. Editorial fields (long-description, keywords, search terms) are '
        'yours to sharpen. Replace the generated art only if you have real art.',
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
        '(config + source art are already stamped; CI fails on a stock icon). '
        'THEN, IF YOU ADDED linux: that tool has no Linux target and the Linux '
        'embedder has no icon slot — the icon there is a PACKAGING artefact, so '
        'also run:  node tooling/store/render-linux-icons.mjs --app $id  '
        '(writes linux/packaging/; CI re-derives it and fails on drift).',
      )
      // [pipeline S-1r] (absent from the frozen pipeline origin lock by construction — S-1r is a residual id, never a pipeline heading) Same correction as the backend branch above — see the
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

/// SHOW-1: append `id` to the shared apps catalog if not already present.
/// Idempotent; leaves the file untouched when the slug already exists.
void _appendToAppsJson(
  HookContext context, {
  required String id,
  required String name,
  required String tagline,
  required String url,
  required String api,
  required List<String> markets,
  required String audience,
}) {
  // The basename is deliberately still `apps.json`. assert-input-contract.mjs
  // allowlists the BASENAMES it scrapes out of these hooks, and the log phrases
  // below are read by assert-stamp-platforms.mjs — both survive the move only
  // because the file is still called apps.json.
  final file = File('catalog/apps.json');

  // 🔴 CREATE IT, DO NOT SKIP. This branch used to `warn` and return, which was
  // defensible while the catalogue was hand-written and therefore always
  // committed: absent meant "wrong working directory", and writing a stray file
  // was worse than doing nothing. It is NOT defensible now. The catalogue is the
  // published record of what this factory ships, and a stamp that SUCCEEDS while
  // the app is never listed is exactly the failure this inversion exists to
  // remove — the stamp reports clean, CI passes, and nikatru.com silently never
  // lists the app. A warning is that failure with a log line in front of it.
  // So the stamp is TOTAL: when it returns, the catalogue lists the app.
  final created = !file.existsSync();
  List<dynamic> rows;
  if (created) {
    rows = <dynamic>[];
  } else {
    final decoded = jsonDecode(file.readAsStringSync());
    if (decoded is! List) {
      // Deliberately NOT repaired by overwriting. An unparseable-as-array
      // catalogue still holds bytes somebody wrote, and replacing them with a
      // fresh one-row array would destroy every other app to publish this one.
      // tooling/ci/assert-catalog-contract.mjs fails the gate on this shape,
      // so the gap is caught rather than carried.
      context.logger.warn(
        'apps.json is not a JSON array; "$id" was NOT added to ${file.path}.',
      );
      return;
    }
    rows = decoded;
  }
  if (rows.any((e) => e is Map && e['slug'] == id)) {
    context.logger.info('apps.json already lists "$id"; left unchanged.');
    return;
  }
  // [ADR 055] The storefront block. DERIVED — see _deriveListings. A null here
  // means the vocabulary could not be read, and the row is written WITHOUT the
  // field rather than with a guessed one: assert-catalog-contract.mjs fails on
  // the absence, so the gap reaches the gate instead of the public catalogue.
  final listings = _deriveListings(context, url: url);
  rows.add(<String, dynamic>{
    'slug': id,
    'name': name,
    'tagline': tagline,
    'url': url,
    'api': api,
    if (listings != null) 'listings': listings,
    'platforms': <String>['web'],
    'markets': markets,
    'audience': audience,
    'status': 'preview',
  });
  file.parent.createSync(recursive: true);
  file.writeAsStringSync('${_encodeCatalogue(rows)}\n');
  context.logger.success(
    created
        ? 'apps.json: created ${file.path} and added "$id" (SHOW-1).'
        : 'apps.json: added "$id" (SHOW-1).',
  );
}

/// [ADR 055] Build the row's `listings` block — the ONE field the storefront's
/// product-page buttons, its `/<store>/apps` collection pages and its
/// `/get/<store>/<slug>` redirects all read.
///
/// 🔴 THE KEY SET IS NOT TYPED HERE, AND THAT IS THE WHOLE POINT. [ADR 055]'s
/// property is that "adding a store becomes data, not code". A literal
/// `{'play': null, 'appstore': null, …}` in this hook would be a SECOND
/// declaration of which storefronts exist, free to drift from the first
/// (tooling/channel-register.json) in the direction that reports clean: a store
/// added to the register would never reach a stamped row, and every guard would
/// stay green because the row it graded was the row this hook wrote. So the keys
/// are the non-null `storefrontKey` values in the register, in its row order,
/// and tooling/ci/assert-catalog-contract.mjs derives the vocabulary it grades
/// against from that same field.
///
/// EVERY VALUE IS `null` EXCEPT THE ONE THE FACTORY ACTUALLY KNOWS. A stamp
/// cannot know a store listing URL — the store issues it, months later, after a
/// review — and inventing a plausible one would publish a link a stranger
/// follows into a 404. The web channel is the exception and it is DERIVED too:
/// the row whose `kind` is `web` is our own site, whose address this hook has
/// already computed as `url`. That makes `listings.web` and `url` two spellings
/// of one fact, so assert-catalog-contract.mjs asserts they are byte-equal.
///
/// Returns null when the register cannot be read or names no storefront. The
/// caller then omits the field entirely rather than publishing a guess — an
/// unanswered question, caught at the gate, beats a wrong answer shipped.
Map<String, dynamic>? _deriveListings(
  HookContext context, {
  required String url,
}) {
  const register = 'tooling/channel-register.json';
  final file = File(register);
  if (!file.existsSync()) {
    context.logger.err(
      'listings: $register is missing, so the [ADR 055] storefront key set '
      'cannot be derived. The row is written WITHOUT `listings` rather than '
      'with a guessed one — tooling/ci/assert-catalog-contract.mjs fails on the '
      'absent field, so this reaches the gate instead of the public catalogue.',
    );
    return null;
  }
  Object? decoded;
  try {
    decoded = jsonDecode(file.readAsStringSync());
  } catch (e) {
    context.logger.err('listings: $register is not valid JSON ($e); `listings` was NOT written.');
    return null;
  }
  final channels = (decoded is Map ? decoded['channels'] : null);
  if (channels is! List) {
    context.logger.err('listings: $register declares no `channels` list; `listings` was NOT written.');
    return null;
  }
  final out = <String, dynamic>{};
  for (final c in channels) {
    if (c is! Map) continue;
    final key = c['storefrontKey'];
    if (key is! String || key.isEmpty) continue; // null = not a storefront.
    // The web row is our own site; every store row is unknown until a real
    // listing URL exists. `kind`, not the key's spelling, decides which — the
    // key is a name the storefront chose and could be renamed in the register.
    out[key] = c['kind'] == 'web' ? url : null;
  }
  if (out.isEmpty) {
    context.logger.err(
      'listings: $register names no `storefrontKey`, so the key set is empty. '
      'An empty `listings` block would satisfy nothing and advertise nothing; '
      'the field was NOT written.',
    );
    return null;
  }
  return out;
}

/// Serialise the catalogue the way the catalogue is actually written.
///
/// 🔴 `JsonEncoder.withIndent('  ')` IS NOT THE FORMAT ON DISK, AND THIS HOOK
/// USED IT. Measured against the committed catalogue: the real file is 235
/// bytes and carries `"platforms": ["web"]` INLINE on one line; the standard
/// encoder expands that array to three lines and produces 247 bytes. So the
/// producer and the bytes it maintains have disagreed all along, and the first
/// stamp of a real app would have reformatted the whole file — which now flows
/// straight through to `sites/_shared/_data/apps.json`, the file the live site
/// reads. This encoder reproduces all 235 bytes exactly (verified against the
/// real file before it was written).
///
/// The rule is: two-space indent, and an array whose elements are ALL scalars
/// stays on one line. Arrays holding maps or lists stay expanded.
///
/// ⚠️ The obvious one-liner for the inline case — `jsonEncode(v).replaceAll(',',
/// ', ')` — is WRONG and its wrongness is invisible on today's data: it rewrites
/// commas inside string values too, turning `["a,b"]` into `["a, b"]`. Both
/// forms agree byte-for-byte on every row in the catalogue today, so a test
/// against the current file cannot tell them apart. Encoding each element and
/// joining is comma-safe by construction.
String _encodeCatalogue(Object? value, [String indent = '']) {
  if (value is List) {
    if (value.every((e) => e is! Map && e is! List)) {
      return '[${value.map(jsonEncode).join(', ')}]';
    }
    final inner = '$indent  ';
    return '[\n${value.map((e) => '$inner${_encodeCatalogue(e, inner)}').join(',\n')}\n$indent]';
  }
  if (value is Map) {
    if (value.isEmpty) return '{}';
    final inner = '$indent  ';
    return '{\n${value.entries.map((e) => '$inner${jsonEncode(e.key)}: '
        '${_encodeCatalogue(e.value, inner)}').join(',\n')}\n$indent}';
  }
  return jsonEncode(value);
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

/// [pipeline 10]D-5 — the MSIX packaging identity, from its ONE declaration.
///
/// The values are READ from `tooling/channel-register.json` rather than written
/// into the brick's pubspec template, for the reason the register's own row
/// gives: an identity that lives in two places is how the wrong one ships, and
/// an MSIX published under the wrong identity cannot be taken back. Today every
/// field is the `PARTNER-CENTER-PENDING` sentinel, so a stamped app packages
/// nothing real and `assert-store-metadata.mjs` PRINTS "not yet configured"
/// instead of failing — which is the honest state until OWNER_QUEUE A-2.
///
/// Idempotent, and a text append rather than a YAML round-trip: the stamped
/// pubspec carries comments a parse-and-rewrite would strip, same as
/// `_registerInWorkspace`.
void _writeMsixConfig(
  HookContext context, {
  required String id,
  required String displayName,
}) {
  final file = File('apps/$id/pubspec.yaml');
  if (!file.existsSync()) {
    context.logger.warn(
      'apps/$id/pubspec.yaml not found; msix_config skipped.',
    );
    return;
  }
  final existing = file.readAsStringSync();
  if (existing.contains(RegExp(r'^msix_config:', multiLine: true))) {
    context.logger.info(
      'apps/$id/pubspec.yaml already has msix_config; left unchanged.',
    );
    return;
  }
  final register = File('tooling/channel-register.json');
  if (!register.existsSync()) {
    context.logger.warn(
      'store identity: tooling/channel-register.json not found; msix_config NOT '
      'written. The app carries a windows-store listing it cannot package.',
    );
    return;
  }
  try {
    final decoded = jsonDecode(register.readAsStringSync()) as Map;
    final rows = (decoded['channels'] as List).whereType<Map>().where(
          (r) => r['kind'] == 'store' && r['packageIdentity'] is Map,
        );
    if (rows.isEmpty) {
      context.logger.info(
        'store identity: no store channel declares a packageIdentity; nothing to stamp.',
      );
      return;
    }
    final identity = rows.first['packageIdentity'] as Map;
    String field(String key) => (identity[key] ?? '').toString();
    final buffer = StringBuffer(existing.endsWith('\n') ? '' : '\n')
      ..writeln()
      ..writeln(
        '# ─────────────────────────────────────────────────────────────────────────────',
      )
      ..writeln(
        '# MSIX PACKAGING IDENTITY — stamped from tooling/channel-register.json',
      )
      ..writeln(
        '# ─────────────────────────────────────────────────────────────────────────────',
      )
      ..writeln(
        '# 🔴 DO NOT EDIT THESE THREE BY HAND. The register is the single declaration',
      )
      ..writeln(
        '# and tooling/ci/assert-store-metadata.mjs fails the build when this block and',
      )
      ..writeln(
        '# that row disagree. Without the block at all, `msix` packages under its',
      )
      ..writeln(
        '# fallback identity `com.flutter.<name>` — which belongs to nobody, cannot be',
      )
      ..writeln('# submitted, and still builds successfully.')
      ..writeln('#')
      ..writeln(
        '# The sentinel values are assigned by Partner Center after OWNER_QUEUE A-2.',
      )
      ..writeln(
        '# There is nothing to derive them from, and an invented value would publish',
      )
      ..writeln('# under an identity we do not own.')
      ..writeln('msix_config:')
      ..writeln('  display_name: $displayName')
      ..writeln('  publisher_display_name: ${field('publisherDisplayName')}')
      ..writeln('  identity_name: ${field('identityName')}')
      ..writeln('  publisher: ${field('publisher')}')
      ..writeln(
        '  # The Store re-signs the submitted package, so nothing here holds or needs a',
      )
      ..writeln(
        '  # certificate and `msix` skips signing entirely. Flipping this to false',
      )
      ..writeln('  # silently re-introduces a test certificate nobody owns.')
      ..writeln('  store: true')
      ..writeln(
        '  # The release lane has already run `flutter build windows --release`; letting',
      )
      ..writeln(
        '  # msix build again would package a DIFFERENT build from the one CI proved.',
      )
      ..writeln('  build_windows: false')
      ..writeln('  architecture: x64')
      ..writeln('  languages: en-us')
      ..writeln('  capabilities: internetClient')
      ..writeln('  output_path: build/windows/msix');
    file.writeAsStringSync(existing + buffer.toString());
    context.logger.success(
      'store identity: stamped msix_config into apps/$id/pubspec.yaml from the '
      'channel register (identity is PARTNER-CENTER-PENDING until A-2).',
    );
  } catch (e) {
    context.logger.warn(
      'store identity: msix_config NOT written ($e). The app carries a '
      'windows-store listing it cannot package, and CI will say so.',
    );
  }
}

/// [pipeline 10]D-5 — the store listing GRAPHICS, generated from the spec.
///
/// GENERIC OVER THE REGISTER, never over `android-play`: every `kind: "store"`
/// row that declares `graphicAssets.assets` gets its files written into that
/// row's own `storeMetadataDir`. Play is the only channel that declares any
/// today; naming it here would mean that the day a second channel publishes its
/// dimensions, the stamp would keep emitting one channel's graphics and the
/// guard would fail on the other with nothing in the factory to fix.
///
/// Warns rather than throws, for the reason `_writeBrandAssets` does: post_gen
/// runs AFTER the tree is written, so throwing here leaves a half-stamped app —
/// the half-state [3]S-13's refusal exists to prevent. The gap is not silent:
/// `tooling/ci/assert-store-metadata.mjs` fails on a store tree missing a file
/// the contract requires.
void _writeStoreGraphics(
  HookContext context, {
  required String id,
  required String seedHex,
}) {
  final register = File('tooling/channel-register.json');
  if (!register.existsSync()) {
    context.logger.warn(
      'store graphics: tooling/channel-register.json not found from '
      '${Directory.current.path}; listing graphics NOT written.',
    );
    return;
  }
  try {
    final decoded = jsonDecode(register.readAsStringSync()) as Map;
    final contract = decoded['storeMetadataContract'] as Map;
    final perChannel = contract['perChannel'] as Map;
    final channels = (decoded['channels'] as List).whereType<Map>();

    var total = 0;
    for (final Map row in channels) {
      if (row['kind'] != 'store') continue;
      final Object? dirTemplate = row['storeMetadataDir'];
      if (dirTemplate is! String || !dirTemplate.contains('{app}')) continue;
      final Object? per = perChannel[row['id']];
      if (per is! Map) continue;
      final Object? graphics = per['graphicAssets'];
      if (graphics is! Map) continue;
      final Object? assets = graphics['assets'];
      if (assets is! Map) continue;

      final written = writeStoreGraphics(
        storeDir: Directory(dirTemplate.replaceAll('{app}', id)),
        appId: id,
        seedHex: seedHex,
        assetSpecs: assets.cast<String, Object?>(),
      );
      total += written.length;
    }
    if (total == 0) {
      // Said out loud rather than passed over: zero is the number a broken read
      // produces, and it is indistinguishable from "no channel declares any"
      // unless somebody names which one it was.
      context.logger.warn(
        'store graphics: the channel register declares NO `graphicAssets` for '
        'any store channel, so none were generated. If a channel does declare '
        'them, this read is broken.',
      );
    } else {
      context.logger.success(
        'store graphics: generated $total listing graphic(s) for "$id" from '
        'seed #$seedHex, at the dimensions the channel register declares.',
      );
    }
  } catch (e) {
    context.logger.warn(
      'store graphics: generation failed ($e); listing graphics NOT written. '
      'The stamped store tree is incomplete and CI will say so.',
    );
  }
}
