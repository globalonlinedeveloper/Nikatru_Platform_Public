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
///                         └─▶  apps/<id>/store/{ios,macos}-appstore/terms-of-use-url.txt
///
/// This hook writes the FIRST file in that chain and, once the app is complete,
/// runs `tooling/sites/regen.mjs` (render.mjs first) for the rest. It used to write the catalogue
/// row directly, which is why the listing text and the catalogue agreed: two
/// templates spelled the same words, and no mechanism could tell that apart from
/// a generator. Writing anywhere else in the chain is a row the website never
/// sees, or a listing field nobody can regenerate.
void run(HookContext context) {
  final v = context.vars;
  final id = (v['app_id'] ?? '').toString();
  final displayName = (v['display_name'] ?? id).toString();
  final pagesOrigin = (v['pages_origin'] ?? '').toString();
  final apiDomain = (v['api_domain'] ?? '').toString();
  final tagline = (v['description'] ?? '').toString();
  final needsBackend = v['needs_backend'] == true;

  // O-PRODUCT-RECORD-UNBUILT (G-a, 2026-09-27): THE ORIGIN IS THE SPEC'S, NOT
  // DERIVED. This was `subdomain`, blank by default and derived here as
  // `<id>.nikatru.com` — a host that has served nothing since [ADR 080] deleted
  // the wildcard, and that render.mjs fell back to for the catalogue `origin`.
  // pre_gen now refuses a blank, a *.nikatru.com or a non-*.pages.dev
  // `pages_origin`, so the value reaching this line is the host Cloudflare
  // issued, and it is written as BOTH `hosts.web` and `hosts.pagesOrigin`
  // (tooling/web/pages-origin.mjs --check holds the two equal).
  final webHost = pagesOrigin;

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
  //
  // O-BRICK-STAMPS-WEB-ONLY (D30): THE CLAIM IS WHERE THE APP IS PUBLISHED, NOT
  // WHAT IT BUILDS FOR, and it stays the template's one platform. app.yaml
  // `platforms` is what the catalogue shows, what discovery publishes as
  // operatingSystem, and what generate-well-known.mjs puts in the portfolio's
  // one Apple and one Android app-association file — which refuses a store
  // platform whose bundle id or signing certificate does not exist yet, and a
  // stamp has neither. The first app declares the same claim and builds all
  // six. The native BUILD targets are `_stampNativePlatforms` below;
  // assert-stamp-platforms.mjs holds them to the platforms build-platforms.yml
  // compiles for every workspace app.
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

  // O-BRICK-STAMPS-WEB-ONLY (D30). The five native folders, branded and waived,
  // BEFORE the site chain: render.mjs writes the icon label into the native
  // name fields and the category and export-compliance answers into both
  // Info.plists only where those files exist, so a chain run first would leave
  // them stock. They are build targets, not a published claim (see `claim`).
  _stampNativePlatforms(context, id: id);

  // The site chain runs LAST, over the complete app: render.mjs writes
  // msix_config.display_name only into a pubspec that already has the block
  // `_writeMsixConfig` just wrote, and the chain after it reads what render wrote.
  if (wrote) _runSiteChain(context, id: id);

  final apiHost = apiDomain.isEmpty ? '$id-api.nikatru.com' : apiDomain;
  // The GitHub secret holding this Worker's crash-sink DSN: the name
  // provision-backend.mjs writes as the register row's `dsnSecret`
  // (`GLITCHTIP_DSN_<APP>`; the app-id contract makes the upper-cased id a valid
  // suffix), restated here because the checklist prints before that row exists.
  final dsnSecret = 'GLITCHTIP_DSN_${id.toUpperCase()}';

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
      // 🔴 THESE TWO STEPS USED TO BE THE NATIVE PLATFORMS THEMSELVES, PRINTED.
      // 1a told the owner to run `flutter create` and then brand what it wrote;
      // its absence cost the first app four platforms of the stock icon
      // (measured 2026-08-04). 1b told them to copy two dated waivers and one
      // manifest removal out of that app. All of it is mechanical, so since
      // O-BRICK-STAMPS-WEB-ONLY (D30) `_stampNativePlatforms` does it and these
      // lines say what is left. `warn` on 1b: the hand work it names stays
      // invisible until a store build meets it.
      //
      // ⚠️ THE MESSAGES NAME NO APP, and that is [C-10] rather than shyness:
      // comments here are exempt from assert-no-clone-tells.mjs and STRING
      // LITERALS ARE NOT. Shared code that knows which app it is in makes every
      // other app inherit a rule about a product it is not.
      ..info(
        '  1a. NATIVE PLATFORMS WERE STAMPED: android, ios, macos, windows and '
        'linux, by tooling/kit/stamp-native.mjs — `flutter create` output with '
        'the two dated waivers, the Amazon receiver removal, the splash and the '
        'Linux packaging derived from assets/icon/app_icon_1024.png, and a '
        'PREVIEW PrivacyInfo.xcprivacy per Apple platform. '
        'tooling/kit/stamp-app.mjs then runs the launcher icons; if you stamped '
        'with raw mason, run them yourself:  '
        'cd apps/$id && dart run flutter_launcher_icons  '
        '(CI fails on a stock icon), and check the rest with:  '
        'node tooling/kit/stamp-native.mjs --app $id --check',
      )
      ..warn(
        '  1b. WHAT THE STAMP DOES NOT CARRY, before the first store build: '
        'signing, the entitlements and plist keys each Apple capability needs, '
        'and the manifest hardening assert-android-vapt-manifest.mjs grades on '
        'the built APK. Review android/, ios/ and macos/ against the app that '
        'already ships natively. build-platforms.yml builds every workspace app '
        'on every platform, so from the commit that adds this app its native '
        'targets are compiled weekly.',
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
        'record and the certificate); the web origin $webHost is the Pages '
        'project\'s own host, bound when the project was created. Until the API '
        'host is attached it is NXDOMAIN — [ADR 080] deleted the wildcard '
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
      // Limb 5 CANNOT be stamped: it wants this Worker's crash-sink SECRET
      // delivered to deploy-workers.yml, and only the owner can create that
      // secret (O-E1). So it is a printed step — genuinely manual work, named
      // rather than left to be discovered by a red build.
      //
      // ⏱ 2026-10-01 — rv2-newproduct-004a. This step used to send the owner to
      // add a per-Worker job to deploy-workers.yml and copy an existing one.
      // There has been no such job since O-SERVICE-KIT-UNBUILT: the app-Worker
      // matrix is printed by tooling/ci/worker-set.mjs from the `appWorkers` row
      // provision-backend.mjs step [6] writes at step 2 above, `dsnSecret`
      // included. What is left is the secret and the two lines that deliver it
      // BY NAME (lead ruling Q1: never `secrets: inherit`) — the same two lines
      // provision-backend.mjs prints, and assert-input-contract.mjs fails this
      // file if either stops printing or the retired job step comes back.
      // ⚠️ NAME NO OTHER APP HERE. This string is executable shared code, and
      // [C-10] (tooling/ci/assert-no-clone-tells.mjs) fails the build on shared
      // code that knows which app it is in — it caught the first draft of this
      // line, which said "copy the `subscriptiontracker-api` job". Every stamped app would
      // have inherited an instruction naming a product it is not.
      ..info(
        '  6. REQUIRED before this Worker deploys: its crash-sink SECRET. There '
        'is no deploy job to write — deploy-workers.yml deploys every '
        '`appWorkers` row of tooling/platform-register.json, and step 2 wrote '
        'this one with dsnSecret $dsnSecret. O-E1 (owner): create the GitHub '
        'secret $dsnSecret, holding the DSN of the GlitchTip project of this '
        'app alone, then deliver it BY NAME, never `secrets: inherit`, in the '
        'same change:',
      )
      ..info(
        '       .github/workflows/deploy-workers.yml, under '
        'on.workflow_call.secrets:   $dsnSecret:  (with required: true)',
      )
      ..info(
        '       .github/workflows/ci.yml, in the secrets of the deploy-workers: '
        'call:   $dsnSecret: \${{ secrets.$dsnSecret }}',
      )
      ..info(
        '     Without them the Worker deploys with no crash sink, so every '
        'unhandled error is invisible, and '
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
      // 🔴 THESE TWO STEPS USED TO BE THE NATIVE PLATFORMS THEMSELVES, PRINTED.
      // 1a told the owner to run `flutter create` and then brand what it wrote;
      // its absence cost the first app four platforms of the stock icon
      // (measured 2026-08-04). 1b told them to copy two dated waivers and one
      // manifest removal out of that app. All of it is mechanical, so since
      // O-BRICK-STAMPS-WEB-ONLY (D30) `_stampNativePlatforms` does it and these
      // lines say what is left. `warn` on 1b: the hand work it names stays
      // invisible until a store build meets it.
      //
      // ⚠️ THE MESSAGES NAME NO APP, and that is [C-10] rather than shyness:
      // comments here are exempt from assert-no-clone-tells.mjs and STRING
      // LITERALS ARE NOT. Shared code that knows which app it is in makes every
      // other app inherit a rule about a product it is not.
      ..info(
        '  1a. NATIVE PLATFORMS WERE STAMPED: android, ios, macos, windows and '
        'linux, by tooling/kit/stamp-native.mjs — `flutter create` output with '
        'the two dated waivers, the Amazon receiver removal, the splash and the '
        'Linux packaging derived from assets/icon/app_icon_1024.png, and a '
        'PREVIEW PrivacyInfo.xcprivacy per Apple platform. '
        'tooling/kit/stamp-app.mjs then runs the launcher icons; if you stamped '
        'with raw mason, run them yourself:  '
        'cd apps/$id && dart run flutter_launcher_icons  '
        '(CI fails on a stock icon), and check the rest with:  '
        'node tooling/kit/stamp-native.mjs --app $id --check',
      )
      ..warn(
        '  1b. WHAT THE STAMP DOES NOT CARRY, before the first store build: '
        'signing, the entitlements and plist keys each Apple capability needs, '
        'and the manifest hardening assert-android-vapt-manifest.mjs grades on '
        'the built APK. Review android/, ios/ and macos/ against the app that '
        'already ships natively. build-platforms.yml builds every workspace app '
        'on every platform, so from the commit that adds this app its native '
        'targets are compiled weekly.',
      )
      // [pipeline S-1r] (absent from the frozen pipeline origin lock by construction — S-1r is a residual id, never a pipeline heading) Same correction as the backend branch above — see the
      // note there for the measurement and for the 2026-09-12 correction. DNS is
      // a NON-step either way; the real one is attachment, and saying "add DNS"
      // hid it.
      ..info(
        '  2. NO DNS RECORD TO CREATE BY HAND — the web origin $webHost is the '
        'Pages project\'s own host, issued by Cloudflare when '
        'tooling/web/pages-origin.mjs --apply $id created the project, and '
        'the first deploy-web run fills it. ([ADR 080] deleted the wildcard '
        '*.nikatru.com, so no <id>.nikatru.com name answers.) No API host and '
        'no D1 database are needed — this app uses the shared platform Worker.',
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

/// O-BRICK-STAMPS-WEB-ONLY (D30) — the native platform folders, branded and
/// waived, written by `tooling/kit/stamp-native.mjs`.
///
/// 🔴 A NODE TOOL AND NOT DART HERE, for the reason the site chain is one: the
/// splash, the Linux packaging and the privacy manifest are DERIVED by node
/// generators the guards import to re-derive them, and a second implementation
/// in this hook would be a second idea of what they contain. `flutter create`
/// runs into a temporary directory there, never into `apps/<id>`, which keeps
/// the root `pubspec.lock` and the brick's own test/ untouched.
///
/// Warns rather than throws, for the reason `_writeBrandAssets` does: post_gen
/// runs AFTER the tree is written, so throwing leaves a half-stamped app. A
/// failure is not silent — `tooling/kit/stamp-app.mjs` runs the same tool with
/// `--check` as a post-condition and exits non-zero, and
/// `assert-stamp-platforms.mjs` fails a workspace app that lacks a platform
/// folder build-platforms.yml builds.
void _stampNativePlatforms(HookContext context, {required String id}) {
  final args = <String>['tooling/kit/stamp-native.mjs', '--app', id];
  final result = Process.runSync('node', args, runInShell: Platform.isWindows);
  if (result.exitCode != 0) {
    context.logger.warn(
      'native platforms: `node ${args.join(' ')}` exited ${result.exitCode}, so "$id" is stamped for web '
      'and its native folders are missing or unbranded. Re-run it from the repo root and read what it says.\n'
      '${result.stdout}${result.stderr}',
    );
    return;
  }
  context.logger.success(
    'native platforms: stamped android, ios, macos, windows and linux for "$id" '
    '(tooling/kit/stamp-native.mjs).',
  );
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
/// the derived listing files each store channel the app carries declares. The
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
  // 🔴 THE LISTING URLS ARE READ, NOT TYPED. They are declared once, in
  // tooling/channel-register.json's `storeMetadataContract.portfolioUrls`, and
  // assert-store-metadata.mjs compares every app's rendered
  // privacy-policy-url.txt, support-url.txt and (Apple only)
  // terms-of-use-url.txt back to that block. A literal
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
    ..writeln('# support-url}.txt, and terms-of-use-url.txt in the two Apple channels, are')
    ..writeln('# RENDERED from it. Change a value here, then run:')
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
    ..writeln('  web: $webHost')
    // O-PRODUCT-RECORD-UNBUILT (G-a): the field render.mjs composes the
    // catalogue `origin` from, with no fallback to `web`. The schema requires
    // it, so a declaration written without it fails the render this hook runs.
    ..writeln('  pagesOrigin: $webHost');
  if (apiHost.isNotEmpty) buffer.writeln('  api: $apiHost');
  buffer
    ..writeln()
    ..writeln('platforms:');
  for (final p in platforms) {
    buffer.writeln('  - $p');
  }
  buffer.writeln();
  // O-BRICK-SELLS-NOTHING-IN-A-STORE (12b). The brick depends on the store
  // billing bridge and wires it, so the app declares it — pending, until the
  // owner creates its RevenueCat apps.
  _writeMobileIap(context, buffer, id: id);
  buffer
    // A stamp cannot know a store listing URL — the store issues it, months
    // later, after a review — and inventing a plausible one publishes a link a
    // stranger follows into a 404. An empty block renders every storefront key
    // as null, which is the honest answer.
    ..writeln('listings:')
    ..writeln();
  // O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1). The identity a store console
  // issues to THIS app, on the channel's own sentinel: a stamp cannot know it,
  // and copying another app's would package and submit as that app.
  _writeStoreRecords(context, buffer);
  // ST-R4: the Windows toast activator is OURS, not a console's, so it is its
  // own block (not a stores record id) and written now rather than pending.
  // render.mjs puts it in msix_config and in lib/core/windows_notification_identity.g.dart.
  buffer
    ..writeln('windows:')
    ..writeln('  toastActivatorClsid: ${toastActivatorClsidFor(id)}')
    ..writeln();
  buffer
    ..writeln('legal:')
    ..writeln('  privacyPolicyUrl: ${urls.privacyUrl}')
    ..writeln('  supportUrl: ${urls.supportUrl}')
    ..writeln('  termsUrl: ${urls.termsUrl}')
    // O-PLAY-AI-CONTENT-REPORTING. Required of every app and FALSE at the stamp,
    // matching `AppConfig.generatesAiContent` in the template: a fresh app
    // generates nothing until somebody builds the feature that does, and then
    // both flip together — assert-app-yaml limb 7 refuses them apart.
    ..writeln()
    ..writeln('ai:')
    ..writeln('  generatesContent: false')
    // O-APPLE-PLIST-KEYS-UNRENDERED. Required of every app, false included:
    // render.mjs writes it into ITSAppUsesNonExemptEncryption the day this app
    // grows an Apple target, and assert-app-yaml limb 8 holds a false to the
    // code. A stamp has measured nothing, so its basis says so.
    ..writeln()
    ..writeln('exportCompliance:')
    ..writeln('  usesNonExemptEncryption: false')
    ..writeln('  basis: ${_yamlQuoted(_stampedExportBasis)}');
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

/// Run the site chain, then the release-tag filter, over the COMPLETE app.
///
/// `tooling/sites/regen.mjs` owns the order of the site generators, render.mjs
/// first; the catalogue row, the listing copy, the site feed, the landing
/// payload and the discovery pages are its output. `tooling/kit/stamp-shared.mjs`
/// then writes the app's entries in the shared files OUTSIDE apps/<id>/ — the
/// bundle register's exclusion, the e2e leg register's `apps.<id>` legs and the
/// generated auth allow list (⏱ 2026-10-01, train P43: each was a hand edit, and
/// the bundle one turned ci.yml red on app #2's first commit). `tooling/ci/
/// tag-owner.mjs --write` then regenerates the release lanes' `tags:` filters
/// from the product registers. This hook lists neither the generators nor their
/// order: it runs the CLIs that do.
///
/// Warns rather than throws, for the reason `_writeBrandAssets` does: post_gen
/// runs AFTER the tree is written, so throwing leaves a half-stamped app. A
/// failure is not silent — `tooling/kit/stamp-app.mjs` exits non-zero on the
/// same state through its `--check` post-conditions, and
/// `assert-catalog-contract.mjs`, `assert-store-metadata.mjs` and
/// `assert-app-yaml.mjs` fail on it at the gate.
void _runSiteChain(HookContext context, {required String id}) {
  const commands = <List<String>>[
    <String>['tooling/sites/regen.mjs'],
    <String>['tooling/kit/stamp-shared.mjs'],
    <String>['tooling/ci/tag-owner.mjs', '--write'],
  ];
  for (final args in commands) {
    final result = Process.runSync(
      'node',
      args,
      runInShell: Platform.isWindows,
    );
    if (result.exitCode != 0) {
      final command = 'node ${args.join(' ')}';
      context.logger.warn(
        'site chain: `$command` exited ${result.exitCode}, so "$id" is stamped but the site surface or the '
        'release tag filter may not carry it. Re-run from the repo root:  $command  and read what it says; '
        'then `node tooling/sites/regen.mjs --check`, `node tooling/kit/stamp-shared.mjs --check` and '
        '`node tooling/ci/tag-owner.mjs --check` must all exit 0.\n'
        '${result.stdout}${result.stderr}',
      );
      return;
    }
  }
  context.logger.success(
    'site chain: rendered "$id" (SHOW-1) from apps/$id/app.yaml through tooling/sites/regen.mjs, '
    'wrote its shared-file entries through tooling/kit/stamp-shared.mjs, then tooling/ci/tag-owner.mjs --write.',
  );
}

/// The three portfolio listing URLs from the channel register, or null with the reason
/// logged. Null makes the caller skip writing a declaration at all rather than
/// write one carrying guessed URLs: an unanswered question caught at the gate
/// beats a wrong answer shipped to a store reviewer. `termsUrl` joined the other
/// two on 2026-09-24 (O-APPLE-LISTING-HAS-NO-EULA): app.schema.json requires
/// `legal.termsUrl`, so a declaration written without it would fail the gate.
({String privacyUrl, String supportUrl, String termsUrl})? _portfolioUrls(HookContext context) {
  const register = 'tooling/channel-register.json';
  final file = File(register);
  if (!file.existsSync()) {
    context.logger.err(
      'app.yaml: $register is missing, so the portfolio listing URLs cannot be read and no '
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
  final terms = urls is Map ? urls['termsUrl'] : null;
  if (privacy is! String ||
      privacy.isEmpty ||
      support is! String ||
      support.isEmpty ||
      terms is! String ||
      terms.isEmpty) {
    context.logger.err(
      'app.yaml: $register declares no storeMetadataContract.portfolioUrls.{privacyUrl,supportUrl,termsUrl}; '
      'no declaration was written.',
    );
    return null;
  }
  return (privacyUrl: privacy, supportUrl: support, termsUrl: terms);
}

/// The store channels whose MSIX identity is PER APP: every `kind: "store"` row
/// that declares a `packageIdentity`, or null with the reason logged. Read from
/// the register, never typed here, for the reason `_portfolioUrls` gives.
List<({String channel, Map account})>? _identityChannels(HookContext context) {
  final register = File('tooling/channel-register.json');
  if (!register.existsSync()) {
    context.logger.warn(
      'store identity: tooling/channel-register.json not found; no identity '
      'record and no msix_config written. The app carries a windows-store '
      'listing it cannot package.',
    );
    return null;
  }
  try {
    final decoded = jsonDecode(register.readAsStringSync()) as Map;
    return <({String channel, Map account})>[
      for (final Map row in (decoded['channels'] as List).whereType<Map>())
        if (row['kind'] == 'store' && row['packageIdentity'] is Map)
          (channel: row['id'].toString(), account: row['packageIdentity'] as Map),
    ];
  } catch (e) {
    context.logger.warn(
      'store identity: the channel register did not read ($e); no identity '
      'record and no msix_config written, and CI will say so.',
    );
    return null;
  }
}

/// The store channels that carry a per-app record, read from the app.yaml
/// schema's `stores` properties (tooling/app-yaml/schema/app.schema.json), never
/// typed here: a channel added to the schema is stamped with no edit to this file.
List<String>? _storeRecordChannels(HookContext context) {
  final schema = File('tooling/app-yaml/schema/app.schema.json');
  if (!schema.existsSync()) {
    context.logger.warn(
      'store records: tooling/app-yaml/schema/app.schema.json not found; no '
      'stores block written. CI will say so.',
    );
    return null;
  }
  try {
    final decoded = jsonDecode(schema.readAsStringSync()) as Map;
    final stores = ((decoded['properties'] as Map)['stores'] as Map)['properties'] as Map;
    return <String>[for (final k in stores.keys) k.toString()];
  } catch (e) {
    context.logger.warn(
      'store records: the app.yaml schema did not read ($e); no stores block '
      'written, and CI will say so.',
    );
    return null;
  }
}

/// O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1) — the app's own `stores` record.
///
/// Partner Center issues the MSIX identity per PRODUCT, and nothing about it
/// can be derived from the app id. So a stamp writes the channel's
/// `notYetConfiguredSentinel` into both fields of the new app's record, and the
/// owner replaces them with what Partner Center issues when this app's own name
/// is reserved there. tooling/ci/assert-store-metadata.mjs fails two apps that
/// declare the same issued identityName, and prints this one until it is issued.
///
/// ⏱ 2026-09-26 (O-STORE-RECORDS-ARE-ONE-PER-CHANNEL, 9a): EVERY store channel
/// gets its record, `state: pending` and `declaredOn: null` — nothing issued,
/// nothing sworn in any console. tooling/ci/assert-store-identity.mjs reads one
/// record per (app, channel) and fails an app that lacks one.
void _writeStoreRecords(HookContext context, StringBuffer buffer) {
  final channels = _storeRecordChannels(context);
  if (channels == null || channels.isEmpty) return;
  final sentinels = <String, String>{};
  for (final c in _identityChannels(context) ?? const <({String channel, Map account})>[]) {
    final sentinel = c.account['notYetConfiguredSentinel'];
    if (sentinel is! String || sentinel.isEmpty) {
      context.logger.warn(
        'store identity: channel "${c.channel}" declares no '
        "notYetConfiguredSentinel, so this app's stores.${c.channel} record "
        'carries no identity. CI will say so.',
      );
      continue;
    }
    sentinels[c.channel] = sentinel;
  }
  buffer
    ..writeln('# What each store console issued to THIS app: nothing yet. Every channel is')
    ..writeln('# `state: pending` until its ids are read from the signed-in console, and')
    ..writeln("# `declaredOn` is null until the owner swears this app's declarations there")
    ..writeln('# (then the date they did): a REAL submission is refused while it is null.')
    ..writeln("# Reserve this app's own name in Partner Center, then replace both identity")
    ..writeln('# values with the issued Package/Identity/Name and Package Family Name.')
    ..writeln('stores:');
  for (final channel in channels) {
    buffer.writeln('  $channel:');
    final sentinel = sentinels[channel];
    if (sentinel != null) {
      buffer
        ..writeln('    identityName: $sentinel')
        ..writeln('    packageFamilyName: $sentinel');
    }
    buffer
      ..writeln('    state: pending')
      ..writeln('    declaredOn: null');
  }
  buffer.writeln();
}

/// The Windows toast-activator CLSID for app [id] — DERIVED, so a re-stamp
/// reproduces it byte for byte ([3]S-15) and two app ids never share one.
/// Four FNV-1a passes over `nikatru-toast|<id>|<k>` give 128 bits, laid out as
/// a GUID with the RFC 4122 variant bits and version 8 (custom). The CLSID only
/// has to be unique and stable; it is not a secret.
String toastActivatorClsidFor(String id) {
  String word(int k) {
    int h = 0x811c9dc5;
    for (final int unit in 'nikatru-toast|$id|$k'.codeUnits) {
      h ^= unit;
      h = (h * 0x01000193) & 0xffffffff;
    }
    return h.toRadixString(16).padLeft(8, '0');
  }

  final hex = '${word(0)}${word(1)}${word(2)}${word(3)}'.split('');
  hex[12] = '8';
  hex[16] = '89ab'[int.parse(hex[16], radix: 16) & 3];
  final h = hex.join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
      '${h.substring(16, 20)}-${h.substring(20)}';
}

/// O-BRICK-SELLS-NOTHING-IN-A-STORE (12b) — the app's `billing.mobileIap`,
/// `state: pending`.
///
/// Pending because nothing exists yet: no RevenueCat app (so no
/// `revenuecatAppIds`, which the schema refuses at pending), no key secret and
/// no store product. What IS written is what the owner creates against:
///   · `publicKeySecrets` — the two repository secret NAMES, this app's own
///     (`REVENUECAT_PUBLIC_KEY_{GOOGLE,APPLE}_<ID>`, the id upper-cased with `-`
///     as `_`); render.mjs refuses one name in two apps, because a RevenueCat
///     key belongs to one RevenueCat app;
///   · `storeProducts` — one per plan, in the pattern of the app that already
///     sells in a store (the first `state: live` declaration under apps/), read
///     at stamp time and never typed here. Every id carries THIS app's id as
///     its prefix (the live app's own prefix swapped, or added where it has
///     none): App Store Connect never reuses a product id across the apps of
///     one account, so app #1's `pro_monthly` cannot be app #2's (rv-c23).
/// With no live app to read, no block is written and CI says so: assert-app-yaml
/// limb 6 refuses the bridge dependency without the declaration.
void _writeMobileIap(HookContext context, StringBuffer buffer, {required String id}) {
  final live = _liveStoreProducts(id);
  if (live == null) {
    context.logger.warn(
      'billing: no app under apps/ declares a live billing.mobileIap with '
      'storeProducts, so this app has no product pattern to follow and no '
      'billing block was written. CI will say so (assert-app-yaml limb 6).',
    );
    return;
  }
  final suffix = id.toUpperCase().replaceAll('-', '_');
  final ownPrefix = '${id.replaceAll('-', '_')}_';
  final livePrefix = '${live.app.replaceAll('-', '_')}_';
  buffer
    ..writeln('# O-BRICK-SELLS-NOTHING-IN-A-STORE (12b). Pending: no RevenueCat app exists yet, so no')
    ..writeln('# revenuecatAppIds. The owner creates the two RevenueCat apps (then adds their ids and')
    ..writeln('# flips `state: live`), the two repository secrets named below, and the store products')
    ..writeln("# below (the pattern of ${live.app}'s, read at stamp time).")
    ..writeln('billing:')
    ..writeln('  mobileIap:')
    ..writeln('    provider: revenuecat')
    ..writeln('    entitlementId: pro')
    ..writeln('    state: pending')
    ..writeln('    publicKeySecrets:')
    ..writeln('      android: REVENUECAT_PUBLIC_KEY_GOOGLE_$suffix')
    ..writeln('      ios: REVENUECAT_PUBLIC_KEY_APPLE_$suffix')
    ..writeln('    storeProducts:');
  for (final p in live.products) {
    final productId = p.productId.startsWith(livePrefix)
        ? '$ownPrefix${p.productId.substring(livePrefix.length)}'
        : '$ownPrefix${p.productId}';
    buffer
      ..writeln('      - plan: ${p.plan}')
      ..writeln('        productId: $productId');
  }
  buffer.writeln();
}

/// The `storeProducts` of the first app (by directory name, never [exceptId])
/// whose app.yaml declares `billing.mobileIap` at `state: live`. Read by
/// indentation, the one structure these lines have; null when no app sells yet.
({String app, List<({String plan, String productId})> products})? _liveStoreProducts(String exceptId) {
  final apps = Directory('apps');
  if (!apps.existsSync()) return null;
  final dirs = apps.listSync().whereType<Directory>().toList()
    ..sort((a, b) => a.path.compareTo(b.path));
  for (final dir in dirs) {
    final appId = dir.uri.pathSegments.where((s) => s.isNotEmpty).last;
    if (appId == exceptId) continue;
    final yaml = File('${dir.path}/app.yaml');
    if (!yaml.existsSync()) continue;
    final lines = yaml.readAsLinesSync();
    final at = lines.indexWhere((l) => RegExp(r'^\s+mobileIap:\s*$').hasMatch(l));
    if (at == -1) continue;
    int indentOf(String l) => l.length - l.trimLeft().length;
    final block = <String>[];
    for (var i = at + 1; i < lines.length; i++) {
      final l = lines[i];
      if (l.trim().isEmpty || l.trimLeft().startsWith('#')) continue;
      if (indentOf(l) <= indentOf(lines[at])) break;
      block.add(l);
    }
    if (!block.any((l) => RegExp(r'^\s+state:\s*live\s*$').hasMatch(l))) continue;
    final products = <({String plan, String productId})>[];
    String? plan;
    for (final l in block) {
      final p = RegExp(r'^\s+-\s+plan:\s*(\S+)\s*$').firstMatch(l);
      if (p != null) {
        plan = p.group(1);
        continue;
      }
      final q = RegExp(r'^\s+productId:\s*(\S+)\s*$').firstMatch(l);
      if (q != null && plan != null) {
        products.add((plan: plan, productId: q.group(1)!));
        plan = null;
      }
    }
    if (products.isNotEmpty) return (app: appId, products: products);
  }
  return null;
}

/// The header line, kept in one place so the notice and the app it names cannot
/// disagree.
String _generatedNotice(String id) => 'Generated by the app brick for "$id". Reviewed and edited BY HAND from here on.';

/// Mason renders `{{category.titleCase()}}` into the store templates; this is the
/// same transform for the declaration, so the two cannot spell one category two
/// ways. pre_gen refuses anything outside a closed list of single lowercase
/// words, which is why one capital is the whole job.
String _titleCase(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

/// The `exportCompliance.basis` a stamp writes. `false` at the stamp matches a
/// template that links no cipher package, and limb 8 of assert-app-yaml fails
/// the day one arrives; the words say the answer was not measured for THIS app.
const _stampedExportBasis =
    'Stamped default, not a measurement: re-measure before first Apple upload.';

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

  // 🔴 THE NATIVE HALF, AND IT IS THE HALF THAT WAS MISSING. The native folders
  // come from `flutter create` (`_stampNativePlatforms`), which WRITES
  // FLUTTER'S DEFAULT ICONS. That is exactly how apps/subscriptiontracker ended
  // up shipping the stock logo on four platforms at once (measured 2026-08-04,
  // 29 byte-identical files) while its web icons were correct. Without these
  // sources the stamped `flutter_launcher_icons:` block would point at art
  // nobody generated and fail on first use — and its failure mode is the stock
  // icon quietly surviving. The 1024 master is also what the splash and the
  // Linux packaging derive from, so `_stampNativePlatforms` runs after this.
  // Guarded by tooling/ci/assert-launcher-icons.mjs.
  try {
    final written = writeNativeIconSources(
      iconDir: Directory('apps/$id/assets/icon'),
      appId: id,
      seedHex: seedHex,
    );
    context.logger.success(
      'brand assets: generated ${written.length} native icon source(s) for "$id" '
      '(tooling/kit/stamp-app.mjs runs `dart run flutter_launcher_icons` over them).',
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
///
/// ⏱ 2026-09-25 — "today every field is the sentinel" above stopped being true
/// on 2026-09-22, when the windows-store row took the first app's REAL identity
/// and this function began copying it into every app it stamped
/// (O-SECOND-APP-SIGNS-AS-THE-FIRST). The identity name is PER APP now: each
/// app declares it in its own app.yaml `stores`, tooling/app-yaml/render.mjs
/// renders it into `identity_name`, and a stamp writes the sentinel. Only the
/// account's `publisher` and `publisher_display_name` are read from the row.
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
  final channels = _identityChannels(context);
  if (channels == null) return;
  if (channels.isEmpty) {
    context.logger.info(
      'store identity: no store channel declares a packageIdentity; nothing to stamp.',
    );
    return;
  }
  // One msix_config block packages ONE identity. A second channel declaring a
  // packageIdentity would leave nothing saying which, so nothing is written and
  // the gap is left for CI to name.
  if (channels.length != 1) {
    context.logger.warn(
      'store identity: ${channels.length} store channels declare a '
      'packageIdentity and one msix_config packages one identity; nothing says '
      'which, so msix_config was NOT written.',
    );
    return;
  }
  final channel = channels.single;
  final sentinel = channel.account['notYetConfiguredSentinel'];
  if (sentinel is! String || sentinel.isEmpty) {
    context.logger.warn(
      'store identity: channel "${channel.channel}" declares no '
      'notYetConfiguredSentinel; msix_config NOT written, and CI will say so.',
    );
    return;
  }
  // The ACCOUNT's two facts. The identity name is this app's own and is not
  // read from the row at all: it is the sentinel until Partner Center issues it.
  String field(String key) => (channel.account[key] ?? '').toString();
  try {
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
        '# 🔴 DO NOT EDIT THESE THREE BY HAND. identity_name is rendered from',
      )
      ..writeln(
        '# apps/$id/app.yaml stores.${channel.channel} by tooling/app-yaml/render.mjs;',
      )
      ..writeln(
        '# publisher and publisher_display_name are the account\'s, from the channel',
      )
      ..writeln(
        '# register. tooling/ci/assert-store-metadata.mjs fails the build when this',
      )
      ..writeln(
        '# block and those two disagree. Without the block at all, `msix` packages',
      )
      ..writeln(
        '# under its fallback identity `com.flutter.<name>` — which belongs to',
      )
      ..writeln('# nobody, cannot be submitted, and still builds successfully.')
      ..writeln('#')
      ..writeln(
        "# identity_name stays the sentinel until Partner Center issues this app's",
      )
      ..writeln(
        '# own. There is nothing to derive it from, and an invented value would',
      )
      ..writeln('# publish under an identity we do not own.')
      ..writeln('msix_config:')
      ..writeln('  display_name: $displayName')
      ..writeln('  publisher_display_name: ${field('publisherDisplayName')}')
      ..writeln('  identity_name: $sentinel')
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
      'store identity: stamped msix_config into apps/$id/pubspec.yaml — '
      'identity_name $sentinel, this app\'s own and not yet issued (reserve '
      'its name in Partner Center, then replace the sentinel in apps/$id/app.yaml '
      'stores.${channel.channel}); publisher and publisher_display_name from '
      'channel "${channel.channel}", the one store channel that declares a '
      'packageIdentity (the account\'s).',
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
