#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-store-metadata.mjs — the store listing lives in the repo, is generated
// from the spec, and cannot rot without failing a build.
//
// [pipeline D-5] "Store listing metadata is generated from the spec and lives in
//                 the repo … so a listing can be regenerated, audited, localized
//                 and diffed, and is never hand-typed into a store console as
//                 the only copy."
//
// ── THE CRITERION D-5 SHIPPED WITH COULD NOT FIRE ────────────────────────────
// "A guard fails any app whose apps.json entry CLAIMS A STORE CHANNEL but has no
// metadata tree." No app can ever claim one: post_gen.dart writes
// `'platforms': <String>['web']` as a literal constant and the brick has no
// `platforms` var, so the only value the factory can produce is ["web"], and web
// is not a store channel. Empty antecedent ⇒ vacuously true forever.
//
// ── REQUIRED_COVERAGE IS A RELATIONSHIP, NOT A NUMBER ────────────────────────
// D-5's replacement acceptance: "every app carries apps/<id>/store/<channel>/
// for every channel it declares in [9]R-5's register — one directory per
// declared channel". So the expected set is computed as
//
//     { kind: "store" rows in the register } × { apps in apps.json }
//
// and it GROWS with the register. Add a store channel tomorrow and the coverage
// requirement grows with it; there is no constant anybody can lower. The list of
// files each tree must carry is the register's `storeMetadataContract`, read
// from there rather than declared here — same reasoning that moved `keyKinds`
// out of assert-channel-register.mjs ([pipeline F-2]): a private copy would be
// the second declaration and the first to drift. tooling/release/
// submit-windows-store.mjs reads the same block.
//
// ── MODE-AWARE, BECAUSE THE ACCOUNTS ARE OWNER-GATED ─────────────────────────
// Four of the five store channels have no publisher account and no tree, and
// creating those accounts is OWNER_QUEUE work an agent must never do. Per the
// standing rule (assert-seams-wired.mjs, [pipeline C-6]) a MISSING tree on a
// DEFERRED row PRINTS on every run — a known gap nobody sees becomes permanent.
//
//   tree missing, row served      -> FAIL  (a live store listing nobody can diff)
//   tree missing, row deferred    -> PRINT (owner-gated; the whole set today)
//   tree PRESENT but incomplete   -> FAIL  (this is the case that matters)
//   tree present, field emptied   -> FAIL
//   tree present, field forked from its spec source -> FAIL
//   a tree with no register row   -> FAIL  (a channel renamed out from under it)
//   EVERY expected tree gone      -> COVERAGE LOST
//
// 🔴 THE THIRD LINE IS THE POINT. A guard that only printed would let anyone
// delete apps/subly/store/windows-store/title.txt and stay green — "PRINT
// everything" is how an owner-gated exemption eats the check it was meant to
// scope. What is owner-gated is CREATING a tree, not KEEPING one.
//
// Usage:  node tooling/ci/assert-store-metadata.mjs [repoRoot]
// Exit 0 = every tree that exists is complete and derived; 1 = it is not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = 'tooling/channel-register.json';
const APPS = 'sites/_shared/_data/apps.json';

const problems = [];
const prints = [];
const ok = (m) => console.log(`ok   ${m}`);
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf8') : null);
const isDir = (rel) => existsSync(abs(rel)) && statSync(abs(rel)).isDirectory();

/** Fatal on the spot: every check below quantifies over the missing thing, so
 *  continuing would report "clean" over nothing — the defect this guard exists
 *  to remove, in the guard itself. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-store-metadata: FAILED');
  process.exit(1);
}

// ── the register: the only declaration of the expected set ───────────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    '[10]D-5\'s expected set is { store rows } × { apps }. With no register the left factor is',
    'undefined, the product is empty, and this guard would report every listing complete forever.',
  ]);
}
let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`, 'The expected set cannot be computed.']);
}

const channels = Array.isArray(register.channels) ? register.channels : [];
const storeRows = channels.filter((c) => c && c.kind === 'store');
if (storeRows.length === 0) {
  coverageLost([
    `${REGISTER} declares ZERO \`kind: "store"\` channels.`,
    'D-5 is entirely about store listings. With no store row the expected set is empty and this',
    'guard passes by having nothing to check — which is exactly the vacuity D-5 shipped with.',
  ]);
}

const contract = register.storeMetadataContract;
if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
  coverageLost([
    `${REGISTER} declares no \`storeMetadataContract\`.`,
    'That block IS the per-tree file list. Without it "the tree is complete" has no right-hand side,',
    'so an empty directory would satisfy every check below.',
  ]);
}
const requiredFiles = Array.isArray(contract.requiredFiles) ? contract.requiredFiles.filter((f) => typeof f === 'string' && f.trim() !== '') : [];
if (requiredFiles.length === 0) {
  coverageLost([
    `${REGISTER} storeMetadataContract.requiredFiles is missing or empty.`,
    'The per-tree loop below iterates it. Empty, every tree is "complete" in zero comparisons and',
    'the listing this factory submits is whatever somebody last typed into a console.',
  ]);
}
const urlFiles = new Set(Array.isArray(contract.urlFiles) ? contract.urlFiles : []);
const derived = contract.derivedFields ?? {};
const appConfigTemplate = typeof contract.appConfigPath === 'string' ? contract.appConfigPath : null;

// ── the apps: the right factor of the expected set ───────────────────────────
const appsRaw = read(APPS);
if (appsRaw === null) coverageLost([`${APPS} does not exist — the expected set has no right-hand factor.`]);
let apps;
try {
  apps = JSON.parse(appsRaw);
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) {
  coverageLost([
    `${APPS} carries no app entries.`,
    'The expected set is { store rows } × { apps }; with no apps it is empty and this guard reports',
    'perfect coverage over nothing.',
  ]);
}

// ── the expected set ─────────────────────────────────────────────────────────
const expected = [];
for (const row of storeRows) {
  const template = row.storeMetadataDir;
  if (typeof template !== 'string' || !template.includes('{app}')) {
    // assert-channel-register.mjs already fails this; repeating the failure here
    // would be two guards reporting one fault. What matters HERE is that the row
    // contributes no expected tree, which would silently shrink the set.
    problems.push(
      `channel "${row.id}" is a store row with no \`storeMetadataDir\` template, so it contributes ZERO expected metadata trees. The coverage relationship "one directory per declared channel" cannot be evaluated for it, and a store row that expects nothing is a store row this guard does not cover.`,
    );
    continue;
  }
  for (const app of apps) {
    if (typeof app.slug !== 'string' || app.slug === '') continue;
    expected.push({ row, app, dir: template.replace('{app}', app.slug) });
  }
}
if (expected.length === 0) {
  coverageLost([
    `the expected set is EMPTY — ${storeRows.length} store row(s) × ${apps.length} app(s) produced no directory.`,
    'Every per-tree check below has no domain. This is D-5\'s original vacuity wearing a different hat.',
  ]);
}

const present = expected.filter((e) => isDir(e.dir));
if (present.length === 0) {
  coverageLost([
    `${expected.length} store metadata tree(s) are expected and NONE exists on disk.`,
    'One of these is true and both are failures: every tree was deleted, or this scan is reading the',
    'wrong tree. A listing that exists only in a store console is precisely what [10]D-5 forbids —',
    `expected: ${expected.map((e) => e.dir).join(', ')}`,
  ]);
}

// ── orphan trees: a directory no register row declares ───────────────────────
// The other direction of the relationship. Rename a channel id in the register
// and the old tree is instantly unreachable — the register grows a store row
// with no tree AND a tree with no row, and without this the first half only
// PRINTS (deferred) while the second is invisible.
const declaredDirs = new Set(expected.map((e) => e.dir));
for (const app of apps) {
  if (typeof app.slug !== 'string') continue;
  const storeRoot = `apps/${app.slug}/store`;
  if (!isDir(storeRoot)) continue;
  for (const entry of readdirSync(abs(storeRoot), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = posix.join(storeRoot, entry.name);
    if (declaredDirs.has(rel)) continue;
    problems.push(
      `${rel} is a store metadata tree that no \`kind: "store"\` row in ${REGISTER} declares. Either a channel was renamed and its listing left behind — orphaned, unreachable, and still looking maintained — or a tree was created for a channel nobody declared. Declare the channel or delete the tree.`,
    );
  }
}

// ── the spec sources every derived field is compared to ──────────────────────
/** `static const String <name> = '<value>';` — the shape app_config.dart uses.
 *  Parsed, not grepped: the value has to be the one the app actually compiles. */
function dartConst(text, name) {
  const m = text.match(new RegExp(`static\\s+const\\s+String\\s+${name}\\s*=\\s*'([^']*)'\\s*;`));
  return m ? m[1] : null;
}

function specValue(app, spec) {
  if (spec.source === 'apps.json') {
    const v = app[spec.field];
    return typeof v === 'string' && v.trim() !== '' ? { value: v.trim() } : { gap: `${APPS} entry "${app.slug}" has no \`${spec.field}\`` };
  }
  if (spec.source === 'appConfig') {
    if (!appConfigTemplate) return { gap: 'storeMetadataContract.appConfigPath is not declared' };
    const rel = appConfigTemplate.replace('{app}', app.slug);
    const text = read(rel);
    if (text === null) return { gap: `${rel} does not exist` };
    const v = dartConst(text, spec.field);
    return v ? { value: v } : { gap: `${rel} declares no \`static const String ${spec.field}\`` };
  }
  return { gap: `unknown derivation source "${spec.source}"` };
}

// ── per tree ─────────────────────────────────────────────────────────────────
let treesChecked = 0;
let filesChecked = 0;
let derivedChecked = 0;

for (const { row, app, dir } of expected) {
  const extraFiles = (contract.perChannel?.[row.id]?.additionalFiles ?? []).filter((f) => typeof f === 'string');
  const maxLines = contract.perChannel?.[row.id]?.maxLines ?? {};

  if (!isDir(dir)) {
    if (row.served === true) {
      problems.push(
        `channel "${row.id}" is SERVED and app "${app.slug}" carries no metadata tree at ${dir}. A live store listing whose only copy is in the console cannot be regenerated, audited, localized or diffed — [10]D-5 exists for exactly that.`,
      );
    } else {
      prints.push(
        `NO TREE (deferred): ${dir} — channel "${row.id}" is served: false and blocked on OWNER_QUEUE ${row.ownerQueue ?? '(unnamed)'}. Creating a publisher account is owner work, so this prints rather than blocking every build on it.`,
      );
    }
    continue;
  }
  treesChecked++;

  for (const rel of [...requiredFiles, ...extraFiles]) {
    const p = posix.join(dir, rel);
    const text = read(p);
    if (text === null) {
      problems.push(`${p} is missing. ${REGISTER} storeMetadataContract requires it in every store metadata tree.`);
      continue;
    }
    if (text.trim() === '') {
      problems.push(
        `${p} is EMPTY. An emptied listing field passes every "does the file exist" check and submits a blank — which is the difference between a tree that exists and a listing that is there.`,
      );
      continue;
    }
    filesChecked++;

    if (urlFiles.has(rel)) {
      const url = text.trim();
      if (!/^https:\/\/[^\s]+$/.test(url)) {
        problems.push(
          `${p} is not a single absolute https URL: ${JSON.stringify(url)}. Microsoft Store Policy 10.5.1 requires a working privacy-policy URL in Partner Center for any product accessing personal information; a relative or malformed one fails review.`,
        );
      }
    }

    // The ONE numeric limit, and it arrives from the register with its citation.
    const limit = maxLines[rel];
    if (limit && Number.isInteger(limit.max)) {
      const entries = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
      if (entries.length > limit.max) {
        problems.push(`${p} has ${entries.length} entries and the limit is ${limit.max}. Source: ${limit.source ?? '(no source recorded — a limit without one must not be enforced)'}`);
      }
    }

    // GENERATED FROM THE SPEC, checked rather than asserted in a README.
    const spec = derived[rel];
    if (spec && typeof spec === 'object' && typeof spec.source === 'string') {
      const got = specValue(app, spec);
      if (got.gap) {
        prints.push(`CANNOT DERIVE ${p} — ${got.gap}. The field is present and non-empty; it just could not be compared to its spec source.`);
      } else {
        derivedChecked++;
        if (text.trim() !== got.value) {
          problems.push(
            `${p} has forked from its spec source. It reads ${JSON.stringify(text.trim())}; ${spec.source}:${spec.field} says ${JSON.stringify(got.value)}. [10]D-5: the listing is GENERATED from the spec — edit the spec, not the copy, or the two disagree and the store gets whichever is submitted last.`,
          );
        }
      }
    }
  }
}

// ── the scan must still be comparing something ───────────────────────────────
if (treesChecked > 0 && filesChecked === 0) {
  coverageLost([
    `${treesChecked} metadata tree(s) exist and ZERO files inside them were read.`,
    'Every field check above ran over an empty set and reported the listings complete.',
  ]);
}
if (treesChecked > 0 && Object.keys(derived).filter((k) => k !== '_why').length > 0 && derivedChecked === 0) {
  coverageLost([
    `${treesChecked} metadata tree(s) exist, ${Object.keys(derived).length - 1} derived field(s) are declared, and NOT ONE comparison ran.`,
    '"Generated from the spec" is D-5\'s headline. With no comparison reaching a spec source, the',
    'listing and the app can say different things and this guard cannot tell.',
  ]);
}

// ── the MSIX package identity: declared once, packaged from that declaration ─
// The register row's own notes say the identity is THIS row's field. That is a
// claim about data, and until it is compared to what `msix` actually packages it
// is a claim about prose. tooling/release/submit-windows-store.mjs re-checks the
// same thing independently and on purpose: a release path that trusts a check it
// did not run is not a release path.
/** Flat scalar keys of a pubspec's `msix_config:` block. Self-checking: a block
 *  that parses to nothing is reported, never assumed absent. */
function msixConfig(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^msix_config:\s*$/.test(l));
  if (at === -1) return null;
  const out = {};
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break;
    const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const IDENTITY_FIELDS = [
  ['identityName', 'identity_name'],
  ['publisherDisplayName', 'publisher_display_name'],
  ['publisher', 'publisher'],
];

let identitiesChecked = 0;
for (const row of storeRows) {
  const identity = row.packageIdentity;
  if (identity === undefined || identity === null) continue; // only rows that claim one
  const sentinel = identity.notYetConfiguredSentinel;
  if (typeof sentinel !== 'string' || sentinel.trim() === '') {
    problems.push(
      `channel "${row.id}" declares a \`packageIdentity\` with no \`notYetConfiguredSentinel\`. Without it nothing can tell a Partner-Center placeholder from a real value, so a placeholder would validate as configured and a package would be built under an identity that does not exist.`,
    );
    continue;
  }
  for (const app of apps) {
    const pubspecRel = `apps/${app.slug}/pubspec.yaml`;
    const pubspecText = read(pubspecRel);
    if (pubspecText === null) continue;
    const cfg = msixConfig(pubspecText);
    if (cfg === null) {
      // 🔴 THE SAME ASYMMETRY AS THE TREES, AND FOR THE SAME REASON. An app that
      // already carries this channel's metadata tree has committed to the
      // channel, so a DELETED msix_config is a regression: `msix` silently falls
      // back to `com.flutter.<name>`, an identity that belongs to nobody, and
      // packaging keeps succeeding. An app with no tree never had one — that is
      // the brick work D-5 still owes — and prints.
      // Mutation-proven 2026-08-01: before this split, deleting the whole
      // msix_config block from apps/subly/pubspec.yaml exited 0.
      const committed = isDir(String(row.storeMetadataDir ?? '').replace('{app}', app.slug));
      const msg = `${pubspecRel} declares no \`msix_config:\` block while app "${app.slug}" carries channel "${row.id}"'s metadata tree. \`msix\` then packages under its fallback identity \`com.flutter.<name>\` — which belongs to nobody, cannot be submitted, and makes [13]T-5's Windows cancelAll a no-op — and the build still succeeds.`;
      if (committed) problems.push(msg);
      else
        prints.push(
          `NO msix_config: ${pubspecRel} — app "${app.slug}" declares no MSIX packaging block and carries no ${row.id} metadata tree either, so channel "${row.id}"'s package identity is not applied to it. Stamped apps do not get one yet; that is [10]D-5's remaining brick work.`,
        );
      continue;
    }
    if (Object.keys(cfg).length === 0) {
      coverageLost([
        `${pubspecRel} has an \`msix_config:\` block that parsed to ZERO keys.`,
        'The reader has stopped reaching the block, so every identity comparison below compares',
        'undefined to undefined and agrees.',
      ]);
    }
    let pending = 0;
    let configured = 0;
    for (const [regField, yamlField] of IDENTITY_FIELDS) {
      const declaredValue = identity[regField];
      const packaged = cfg[yamlField];
      if (typeof declaredValue !== 'string' || declaredValue.trim() === '') {
        problems.push(`channel "${row.id}" packageIdentity.${regField} is missing or empty in ${REGISTER}. The register is the SINGLE declaration of this identity ([pipeline F-2]); an absent field is a hole, not a placeholder.`);
        continue;
      }
      if (packaged === undefined) {
        problems.push(`${pubspecRel} msix_config.${yamlField} is absent while ${REGISTER} declares packageIdentity.${regField}. \`msix\` would package a different identity from the one the register documents, and only one of the two can ship.`);
        continue;
      }
      identitiesChecked++;
      if (declaredValue !== packaged) {
        problems.push(
          `package identity DISAGREES for app "${app.slug}": ${REGISTER} says ${regField} = ${JSON.stringify(declaredValue)}, ${pubspecRel} says ${yamlField} = ${JSON.stringify(packaged)}. Two copies of an identity is how the wrong one ships, and an MSIX published under the wrong identity cannot be taken back.`,
        );
        continue;
      }
      if (declaredValue.includes(sentinel)) pending++;
      else configured++;
    }
    if (pending > 0 && configured > 0) {
      problems.push(
        `package identity for app "${app.slug}" on channel "${row.id}" is HALF configured — ${configured} real value(s) and ${pending} still ${sentinel}. It packages cleanly and submits under a name that is part real and part placeholder.`,
      );
    } else if (pending > 0) {
      prints.push(
        `PACKAGE IDENTITY NOT YET CONFIGURED — app "${app.slug}", channel "${row.id}": all ${pending} field(s) are ${sentinel}. Partner Center assigns them after OWNER_QUEUE ${row.ownerQueue ?? '(unnamed)'}; there is nothing to derive them from and an invented value would publish under an identity we do not own.`,
      );
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (owner-gated; a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
  console.log('');
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-store-metadata: FAILED');
  process.exitCode = 1;
} else {
  ok(
    `REQUIRED_COVERAGE — ${storeRows.length} store channel(s) × ${apps.length} app(s) = ${expected.length} expected tree(s); ` +
      `${treesChecked} present and complete, ${expected.length - treesChecked} printed as owner-gated gaps`,
  );
  ok(`${filesChecked} listing field(s) non-empty, ${derivedChecked} of them compared to their spec source, ${identitiesChecked} package-identity field(s) agree`);
  console.log('\nassert-store-metadata: ok');
}
