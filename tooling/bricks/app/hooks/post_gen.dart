import 'dart:convert';
import 'dart:io';

import 'package:mason/mason.dart';

import 'brand_assets.dart';

/// After a stamp: (1) write the app's DECLARATION and render the catalogue and
/// its store listing copy from it (SHOW-1, automated), then (2) print the
/// owner's manual, non-automatable checklist.
///
/// 🔴 THE DECLARATION IS THE SOURCE AND EVERYTHING ELSE IS DERIVED FROM IT
/// ([ADR 067] decision 2 — "an app is app.yaml + its own screens"). The chain is
/// one direction only:
///
///     apps/<id>/app.yaml  ──▶  catalog/apps.json  ──▶  sites/_shared/_data/apps.json
///                         └─▶  apps/<id>/store/<channel>/{title,short-description,
///                              category,privacy-policy-url,support-url}.txt
///
/// This hook writes the FIRST file in that chain and runs
/// `tooling/app-yaml/render.mjs` for the rest. It used to write the catalogue
/// row directly, which is why the listing text and the catalogue agreed: two
/// templates spelled the same words, and no mechanism could tell that apart from
/// a generator. Writing anywhere else in the chain is a row the website never
/// sees, or a listing field nobody can regenerate.
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

  // 🔴 THE PLATFORM CLAIM STAYS A DART LITERAL IN THIS FILE. It is written into
  // the app's declaration now rather than straight into the catalogue row, but
  // assert-stamp-platforms.mjs parses the platform entry below out of THIS file
  // and holds it in BOTH directions against the folders the brick stamps and the
  // `flutter build` steps ci.yml runs. Its own header records why: the criterion
  // S-3 shipped with iterated this array, so shrinking it to an empty list made
  // zero builds run, green.
  //
  // ⚠️ AND THAT GUARD READS THIS FILE RAW, COMMENTS AND ALL — it takes the FIRST
  // match in the file. A comment above quoting the pattern therefore BECOMES the
  // claim: written out here in prose, this block measured the claim as EMPTY and
  // failed both directions at once. Do not spell the literal in a comment.
  const Map<String, List<String>> claim = <String, List<String>>{
    'platforms': <String>['web'],
  };

  // [pipeline 10]D-5 — pre_gen owns the split now and writes `short_name` back
  // into the vars mason hands both the templates and this hook, so the
  // catalogue `name` and every `store/*/title.txt` are the SAME string by
  // construction. The fallback is for a hook invoked without pre_gen having run
  // (nothing in this repo does that) and computes nothing of its own.
  final wrote = _writeAppDeclaration(
    context,
    id: id,
    name: (v['short_name'] ?? displayName).toString(),
    // The ICON label, validated by pre_gen and rendered by
    // tooling/app-yaml/render.mjs into the six OS-level name fields. Written
    // into the declaration rather than straight into the platform files for the
    // same reason the catalogue row is: a value that stops at the stamp is a
    // rule that holds for the length of one command.
    iconLabel: (v['icon_label'] ?? '').toString(),
    tagline: tagline,
    category: (v['category'] ?? '').toString(),
    webHost: webHost,
    // A client-only app has NO API host of its own — it calls the shared
    // platform Worker. Writing `api-<app>.nikatru.com` here would publish a
    // hostname that will never resolve into a PUBLIC catalog ([ADR 020]).
    apiHost: (!needsBackend || apiDomain.isEmpty) ? '' : apiDomain,
    platforms: claim['platforms']!,
    // [pipeline K-1 · K-16] THE DECLARATION HAS TO OUTLIVE THE STAMP. pre_gen
    // refuses a spec with no market and normalises what survives; if the value
    // stopped there, "every app declares the markets it is offered in" would be
    // true for the length of one command. The declaration is where it belongs:
    // it is the record of what this app IS, and the catalogue row is rendered
    // from it.
    markets: (v['markets'] ?? '')
        .toString()
        .split(',')
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList(),
    audience: (v['audience'] ?? '').toString(),
  );
  if (wrote) _renderFromDeclarations(context, id: id);

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

  final apiHost = apiDomain.isEmpty ? '$id-api.nikatru.com' : apiDomain;

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
      // 🔴 THE STEP THAT WAS MISSING, AND ITS ABSENCE COST apps/subscriptiontracker FOUR
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
      ..warn(
        '  1b. AND THE MOMENT YOU ADD android OR windows, TWO WAIVERS COME '
        'WITH THEM, AND ON android ONE REMOVAL. `flutter create` writes the '
        'stock template, which carries none of the three, and the first app '
        'in this portfolio needed both waivers the day a '
        'transitive plugin arrived: cloudflare_turnstile pulls '
        'flutter_inappwebview, whose Android side calls '
        'getDefaultProguardFile(proguard-android.txt) — AGP 9 makes that '
        'throw — and whose Windows side includes <experimental/coroutine>, '
        'which the MSVC 14.51 STL makes a hard error. Neither plugin has a '
        'newer release to move to. Copy the two DATED WAIVERS, comments and '
        'all, out of the app that already carries them:  '
        'android/gradle.properties  '
        'android.r8.proguardAndroidTxt.disallowed=false  '
        'windows/CMakeLists.txt  add_compile_definitions('
        '_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS)  '
        'at DIRECTORY scope, above flutter/generated_plugins.cmake.  '
        'THE REMOVAL (2026-09-23): purchases_flutter merges in '
        'com.amazon.device.iap.ResponseReceiver, exported and guarded only by '
        'a permission no app here declares, so any app installed first can '
        'hold that permission and reach it. MobSF reports it and V5 of '
        'assert-android-vapt-manifest.mjs fails the build on it. Copy the '
        'dated tools:node="remove" line for that receiver, and the '
        'xmlns:tools declaration on <manifest>, out of '
        'android/app/src/main/AndroidManifest.xml in the app that already '
        'carries it.  '
        'CORRECTED 2026-09-23: ci.yml builds the Android APKs of every app on '
        'every PR, so a missing Android waiver or removal fails a required '
        'check. Nothing on a PR builds Windows, so a missing Windows waiver '
        'is invisible on every required check and only build-platforms.yml '
        'ever finds out.',
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
      // [pipeline S-1r] (absent from the frozen pipeline origin lock by construction — S-1r is a residual of S-1, raised by Private/pre-minimal-2026-09-08:plans/03-stamper-plan.md after that lock was taken; the lock file is not named here because this file's own phantom-filename limb requires every `*.json` it mentions to exist in the tree) NOT "add DNS". [ADR 006] locked a proxied wildcard
      // `*.nikatru.com`, so a stamped app needed ZERO new DNS, and the old step
      // sent the owner to create a record that already resolved while the thing
      // actually keeping the app dark went unnamed.
      //
      // ⏱ 2026-09-12 — THE STEP IS STILL WRONG, THE REASON IS NOT. [ADR 080] §4
      // DELETED that wildcard, so unregistered names no longer resolve at all.
      // What binds the API host now is this Worker's own `custom_domain: true`
      // route, which writes the DNS record AND the certificate on the first
      // deploy; the web host is bound by its deployment the same way. So there is
      // still nothing to create by hand — but the debugging consequence INVERTED:
      // an unattached host is now NXDOMAIN, and the old reasoning "it resolves, so
      // DNS is not the problem" no longer holds for anything.
      ..info(
        '  3. NO DNS RECORD TO CREATE BY HAND — ATTACHMENT is the step. '
        'Deploying this Worker binds $apiHost itself (custom_domain writes the '
        'record and the certificate); the web deployment binds $webHost. Until '
        'each is attached the name is NXDOMAIN — [ADR 080] deleted the wildcard '
        '*.nikatru.com that used to make every name answer 522.',
      )
      ..info(
        '  4. THE APEX IS ALREADY ALLOWED, so there is usually NOTHING to do here. '
        'Since [ADR 075] this app is served at nikatru.com/$id, so its browser '
        'origin is https://nikatru.com — already in ALLOWED_ORIGINS on the shared '
        'platform Worker and in this app\'s own. ONLY if you will open the app '
        'directly at its *.pages.dev production URL, add that exact origin to '
        'BOTH allowlists and redeploy. The list is EXACT and matches no pattern.',
      )
      ..info('  5. cd apps/$id && flutter pub get && flutter analyze.')
      // [pipeline 11]E-8. The stamped Worker now calls `reportWorkerError` in its
      // `app.onError` and carries `src/lib/error-sink.ts` (added 2026-09-08), so
      // limbs 2, 3 and 4 of assert-worker-error-sink.mjs pass on a fresh stamp.
      // Limb 5 CANNOT be stamped: it wants a job named after this Worker in
      // deploy-workers.yml, and a deploy job for an app that does not exist yet
      // has nothing to deploy. So it is a printed step, like step 4 — the same
      // class of genuinely manual work, named rather than left to be discovered
      // by a red build.
      // ⚠️ NAME NO OTHER APP HERE. This string is executable shared code, and
      // [C-10] (tooling/ci/assert-no-clone-tells.mjs) fails the build on shared
      // code that knows which app it is in — it caught the first draft of this
      // line, which said "copy the `subscriptiontracker-api` job". Every stamped app would
      // have inherited an instruction naming a product it is not.
      ..info(
        '  6. REQUIRED before this Worker deploys: add a `$id-api` job to '
        '.github/workflows/deploy-workers.yml passing --var GLITCHTIP_DSN: and '
        '--var RELEASE:. Copy any existing Worker job in that file. Without it '
        'the crash sink has no DSN and every unhandled error is invisible, and '
        'tooling/ci/assert-worker-error-sink.mjs limb 5 fails the build.',
      )
      ..warn(
        'This app claimed one of the TEN D1 databases the free tier '
        'allows per ACCOUNT (platform_db is another). If it does not really '
        'store user rows, re-stamp with needs_backend=false.',
      )
      // ⏱ 2026-09-08 — the warning above is left as written and its ARITHMETIC IS
      // DEAD: tooling/ceilings.json records `"cloudflare": "workers-paid"` since
      // 2026-09-03, where the ceiling is 50,000 databases. The ADVICE survives on
      // the reasons that outlived the ceiling, which is why this prints beside it
      // rather than replacing it — a printed correction cannot be misread as the
      // original having been right.
      ..warn(
        '  (The "TEN databases" figure above expired on 2026-09-03 — the '
        'account is on Workers Paid. Client-only is still the default for blast '
        'radius, migration cost and YAGNI, not for the ceiling. See '
        'tooling/ci/assert-clone-contract.mjs for the full correction.)',
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
      // 🔴 THE STEP THAT WAS MISSING, AND ITS ABSENCE COST apps/subscriptiontracker FOUR
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
      ..warn(
        '  1b. AND THE MOMENT YOU ADD android OR windows, TWO WAIVERS COME '
        'WITH THEM, AND ON android ONE REMOVAL. `flutter create` writes the '
        'stock template, which carries none of the three, and the first app '
        'in this portfolio needed both waivers the day a '
        'transitive plugin arrived: cloudflare_turnstile pulls '
        'flutter_inappwebview, whose Android side calls '
        'getDefaultProguardFile(proguard-android.txt) — AGP 9 makes that '
        'throw — and whose Windows side includes <experimental/coroutine>, '
        'which the MSVC 14.51 STL makes a hard error. Neither plugin has a '
        'newer release to move to. Copy the two DATED WAIVERS, comments and '
        'all, out of the app that already carries them:  '
        'android/gradle.properties  '
        'android.r8.proguardAndroidTxt.disallowed=false  '
        'windows/CMakeLists.txt  add_compile_definitions('
        '_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS)  '
        'at DIRECTORY scope, above flutter/generated_plugins.cmake.  '
        'THE REMOVAL (2026-09-23): purchases_flutter merges in '
        'com.amazon.device.iap.ResponseReceiver, exported and guarded only by '
        'a permission no app here declares, so any app installed first can '
        'hold that permission and reach it. MobSF reports it and V5 of '
        'assert-android-vapt-manifest.mjs fails the build on it. Copy the '
        'dated tools:node="remove" line for that receiver, and the '
        'xmlns:tools declaration on <manifest>, out of '
        'android/app/src/main/AndroidManifest.xml in the app that already '
        'carries it.  '
        'CORRECTED 2026-09-23: ci.yml builds the Android APKs of every app on '
        'every PR, so a missing Android waiver or removal fails a required '
        'check. Nothing on a PR builds Windows, so a missing Windows waiver '
        'is invisible on every required check and only build-platforms.yml '
        'ever finds out.',
      )
      // [pipeline S-1r] (absent from the frozen pipeline origin lock by construction — S-1r is a residual id, never a pipeline heading) Same correction as the backend branch above — see the
      // note there for the measurement and for the 2026-09-12 correction. DNS is
      // a NON-step either way; the real one is attachment, and saying "add DNS"
      // hid it.
      ..info(
        '  2. NO DNS RECORD TO CREATE BY HAND — ATTACH $webHost to the '
        'deployment and the attachment writes the record. Until then the name is '
        'NXDOMAIN ([ADR 080] deleted the wildcard *.nikatru.com that used to make '
        'every name answer 522). No API host and no D1 database are needed — '
        'this app uses the shared platform Worker.',
      )
      ..info(
        '  3. THE APEX IS ALREADY ALLOWED, so there is usually NOTHING to do here. '
        'Since [ADR 075] this app is served at nikatru.com/$id, so its browser '
        'origin is https://nikatru.com — already in ALLOWED_ORIGINS on the shared '
        'platform Worker and in this app\'s own. ONLY if you will open the app '
        'directly at its *.pages.dev production URL, add that exact origin to '
        'BOTH allowlists and redeploy. The list is EXACT and matches no pattern.',
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
/// list is what the gate iterates, `apps/subscriptiontracker` is on it because a human typed
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

/// [ADR 067] decision 2 — WRITE THE DECLARATION, THEN RENDER FROM IT.
///
/// 🔴 THIS FUNCTION USED TO APPEND A ROW TO `catalog/apps.json`, AND THAT WAS
/// THE DEFECT, NOT THE IMPLEMENTATION. The catalogue is a RENDERING: the site's
/// data file is generated from it, every store listing field is compared to it,
/// and `assert-store-metadata.mjs` opens by quoting the requirement that store
/// listing metadata is "GENERATED from the spec" — while recording, in its own
/// header, that the only tree it had was one a human wrote by hand. A stamp that
/// writes the RENDERING keeps that true: the listing text agreed with the
/// catalogue because two templates spelled the same words, and nothing anywhere
/// could tell that apart from a generator.
///
/// So the stamp now writes `apps/<id>/app.yaml` — the app's own declaration —
/// and calls `tooling/app-yaml/render.mjs`, which writes the catalogue row and
/// the five derived listing files in every store channel the app carries. The
/// stamp is still TOTAL: when it returns, the catalogue lists the app.
///
/// Returns whether the declaration was written; a `false` means the render step
/// is skipped, and the reason has already been logged.
bool _writeAppDeclaration(
  HookContext context, {
  required String id,
  required String name,
  required String iconLabel,
  required String tagline,
  required String category,
  required String webHost,
  required String apiHost,
  required List<String> platforms,
  required List<String> markets,
  required String audience,
}) {
  // 🔴 THE TWO LISTING URLS ARE READ, NOT TYPED. They are declared once, in
  // tooling/channel-register.json's `storeMetadataContract.portfolioUrls`, and
  // assert-store-metadata.mjs compares every app's rendered
  // privacy-policy-url.txt and support-url.txt back to that block. A literal
  // here would be a second declaration and the first to drift — the same
  // reasoning that moved `keyKinds` out of assert-channel-register.mjs.
  final urls = _portfolioUrls(context);
  if (urls == null) return false;

  final buffer = StringBuffer()
    ..writeln('# ${_generatedNotice(id)}')
    ..writeln('#')
    ..writeln('# THIS FILE IS THE SOURCE. catalog/apps.json, the six OS-level icon')
    ..writeln('# label fields, and every')
    ..writeln('# store/<channel>/{title,short-description,category,privacy-policy-url,')
    ..writeln('# support-url}.txt are RENDERED from it. Change a value here, then run:')
    ..writeln('#')
    ..writeln('#     node tooling/app-yaml/render.mjs')
    ..writeln('#')
    ..writeln('# The sworn declarations under store/ are NOT rendered from anything and')
    ..writeln('# never will be: they are statements about the real code of this app.')
    ..writeln()
    ..writeln('id: $id')
    ..writeln('name: ${_yamlQuoted(name)}')
    ..writeln('shortName: ${_yamlQuoted(iconLabel)}')
    ..writeln('tagline: ${_yamlQuoted(tagline)}')
    ..writeln('category: ${_yamlQuoted(_titleCase(category))}')
    // [3]S-7a — a stamp writes `preview`, never `live`. `preview` is a promise
    // nobody has made yet, and assert-catalog-reachable.mjs skips it for exactly
    // that reason while PRINTING how many it skipped.
    ..writeln('status: preview')
    ..writeln()
    ..writeln('hosts:')
    ..writeln('  web: $webHost');
  if (apiHost.isNotEmpty) buffer.writeln('  api: $apiHost');
  buffer
    ..writeln()
    ..writeln('platforms:');
  for (final p in platforms) {
    buffer.writeln('  - $p');
  }
  buffer
    ..writeln()
    // A stamp cannot know a store listing URL — the store issues it, months
    // later, after a review — and inventing a plausible one publishes a link a
    // stranger follows into a 404. An empty block renders every storefront key
    // as null, which is the honest answer.
    ..writeln('listings:')
    ..writeln()
    ..writeln('legal:')
    ..writeln('  privacyPolicyUrl: ${urls.privacyUrl}')
    ..writeln('  supportUrl: ${urls.supportUrl}')
    // O-PLAY-AI-CONTENT-REPORTING. Required of every app and FALSE at the stamp,
    // matching `AppConfig.generatesAiContent` in the template: a fresh app
    // generates nothing until somebody builds the feature that does, and then
    // both flip together — assert-app-yaml limb 7 refuses them apart.
    ..writeln()
    ..writeln('ai:')
    ..writeln('  generatesContent: false');
  if (markets.isNotEmpty) {
    buffer
      ..writeln()
      ..writeln('markets:');
    for (final m in markets) {
      buffer.writeln('  - ${_yamlQuoted(m)}');
    }
  }
  if (audience.isNotEmpty) {
    buffer
      ..writeln()
      ..writeln('audience: ${_yamlQuoted(audience)}');
  }

  final file = File('apps/$id/app.yaml');
  file.parent.createSync(recursive: true);
  file.writeAsStringSync(buffer.toString());
  context.logger.success('app.yaml: wrote ${file.path} — the declaration the catalogue and the listing copy are rendered from.');
  return true;
}

/// Run the renderer. The catalogue row and the listing copy are its output, so a
/// failure here is a stamp that succeeded while the app is listed nowhere —
/// which is precisely the silent gap the inversion exists to remove. It is
/// reported as an ERROR and left for the gate: `assert-catalog-contract.mjs`,
/// `assert-store-metadata.mjs` and `assert-app-yaml.mjs` all fail on the result,
/// so the gap is caught rather than carried.
void _renderFromDeclarations(HookContext context, {required String id}) {
  final result = Process.runSync(
    'node',
    <String>['tooling/app-yaml/render.mjs'],
    runInShell: Platform.isWindows,
  );
  if (result.exitCode != 0) {
    context.logger.err(
      'apps.json: the renderer exited ${result.exitCode}, so "$id" was NOT added to catalog/apps.json '
      'and no listing copy was written. Run `node tooling/app-yaml/render.mjs` and read what it says.\n'
      '${result.stdout}${result.stderr}',
    );
    return;
  }
  context.logger.success('apps.json: added "$id" (SHOW-1) — rendered from apps/$id/app.yaml, with its store listing copy.');
}

/// The two portfolio listing URLs from the channel register, or null with the reason
/// logged. Null makes the caller skip writing a declaration at all rather than
/// write one carrying guessed URLs: an unanswered question caught at the gate
/// beats a wrong answer shipped to a store reviewer.
({String privacyUrl, String supportUrl})? _portfolioUrls(HookContext context) {
  const register = 'tooling/channel-register.json';
  final file = File(register);
  if (!file.existsSync()) {
    context.logger.err(
      'app.yaml: $register is missing, so the two portfolio listing URLs cannot be read and no '
      'declaration was written. They are declared there once and compared back to it by '
      'tooling/ci/assert-store-metadata.mjs; typing them here would be the second declaration.',
    );
    return null;
  }
  Object? decoded;
  try {
    decoded = jsonDecode(file.readAsStringSync());
  } catch (e) {
    context.logger.err('app.yaml: $register is not valid JSON ($e); no declaration was written.');
    return null;
  }
  final contract = decoded is Map ? decoded['storeMetadataContract'] : null;
  final urls = contract is Map ? contract['portfolioUrls'] : null;
  final privacy = urls is Map ? urls['privacyUrl'] : null;
  final support = urls is Map ? urls['supportUrl'] : null;
  if (privacy is! String || privacy.isEmpty || support is! String || support.isEmpty) {
    context.logger.err(
      'app.yaml: $register declares no storeMetadataContract.portfolioUrls.{privacyUrl,supportUrl}; '
      'no declaration was written.',
    );
    return null;
  }
  return (privacyUrl: privacy, supportUrl: support);
}

/// The header line, kept in one place so the notice and the app it names cannot
/// disagree.
String _generatedNotice(String id) => 'Generated by the app brick for "$id". Reviewed and edited BY HAND from here on.';

/// Mason renders `{{category.titleCase()}}` into the store templates; this is the
/// same transform for the declaration, so the two cannot spell one category two
/// ways. pre_gen refuses anything outside a closed list of single lowercase
/// words, which is why one capital is the whole job.
String _titleCase(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

/// A double-quoted YAML scalar. Always quoted, never bare: a listing line is
/// free text and this repo has already paid for `&`, `'`, `/`, `"` and `:`
/// surviving a stamp — `_probe_vars.json`'s description carries all five on
/// purpose. tooling/app-yaml/yaml.mjs reads exactly this escaping.
String _yamlQuoted(String s) {
  final escaped = s.replaceAll(r'\', r'\\').replaceAll('"', r'\"');
  return '"$escaped"';
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
  // is exactly how apps/subscriptiontracker ended up shipping the stock logo on four platforms
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
    // ⏱ 2026-09-22 — KNOWN HAZARD, NOT FIXED HERE (the per-app follow-up).
    // The windows-store row now carries subscriptiontracker's REAL identity,
    // and `identityName` / `publisherDisplayName` are PER-APP. This stamps that
    // one row into EVERY new app, so a new app packages under Subly's identity
    // name, and assert-store-metadata.mjs passes because the copies agree.
    // Until the register can declare an identity per app, set a new app's
    // msix_config back to the PARTNER-CENTER-PENDING sentinel by hand.
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
