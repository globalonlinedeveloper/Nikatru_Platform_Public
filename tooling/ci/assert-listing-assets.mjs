#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-listing-assets.mjs — a Play listing needs PICTURES, and until
// 2026-08-04 this repository had none of them and no number describing them.
//
// [pipeline D-5] "store listing metadata is generated from the spec and lives in
//                 the repo … and is never hand-typed into a store console as the
//                 only copy."
//
// ── WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────────
// The listing TEXT has had a guard on every field for months. The two sworn
// declarations got theirs on 2026-08-04. The GRAPHICS — which Google requires to
// publish AT ALL — had neither an artefact nor a requirement:
// `apps/subly/store/android-play/screenshots/README.md` carried a six-row table
// in which every row read "⚠️ UNVERIFIED", under the honest instruction "do not
// fill a number in from memory". That instruction was right and it had been
// obeyed for weeks, which is the problem: an UNVERIFIED table is a placeholder
// that reports the same thing whether anyone is working on it or not.
//
// ── EVERY NUMBER IS THE REGISTER'S, AND EVERY NUMBER CARRIES ITS CITATION ────
// Nothing is declared in this file. The expectations live in
// `tooling/channel-register.json` → `storeMetadataContract.perChannel.<id>
// .graphicAssets`, read from there for the same reason `assert-store-metadata
// .mjs` reads `requiredFiles` from there: a private copy would be the second
// declaration and the first to drift. A dimension that arrives WITHOUT a
// `source` FAILS THE BUILD rather than being enforced — an invented limit fires
// on CORRECT input, and this repo has already rejected its own fixture at 129
// characters against a made-up "120 or fewer".
//
// ── THE PRINT/FAIL SPLIT IS A RELATIONSHIP, NOT A MOOD ──────────────────────
//   asset declared, file missing, row SERVED      -> FAIL
//   asset declared, file missing, row deferred    -> FAIL   ← see below
//   asset present but wrong size/format           -> FAIL
//   screenshots absent, row deferred              -> PRINT
//   screenshots absent, row SERVED                -> FAIL
//   screenshots present without provenance        -> FAIL
//   an asset the metadata contract does not name  -> FAIL
//   a declared limit with no `source`             -> FAIL
//   NOTHING evaluated                             -> COVERAGE LOST
//
// 🔴 THE SECOND LINE IS DELIBERATE AND IT IS WHERE THIS GUARD DIFFERS FROM ITS
// NEIGHBOURS. `assert-store-metadata.mjs` PRINTS a missing tree on a deferred
// row because CREATING a publisher account is owner work an agent must never do.
// The feature graphic and the store icon are not like that: they are produced by
// `node tooling/store/render-play-graphics.mjs` from brand art already in the
// tree, by anybody, in about four seconds, with no account and no secret. There
// is nothing owner-gated about them, so "deferred" would be an exemption
// borrowed from a different problem — and an owner-gated exemption applied where
// it does not belong is exactly how a check stops checking.
//
// SCREENSHOTS ARE GENUINELY DIFFERENT and that is why they print. They can only
// be captured against a LIVE build (see the posture note below), which needs a
// confirmed account, which needs `SUPABASE_SERVICE_ROLE_KEY` — a CI-only secret.
// Failing every build on work only a workflow run can do would block all other
// work and teach somebody to switch this off, so the gap PRINTS with the exact
// command that closes it. [pipeline C-6]'s standing rule.
//
// ── 🔴 THE PROVENANCE CHECK IS THIS GUARD'S TEETH ───────────────────────────
// A PNG carries no evidence of which build it photographed, and that is the only
// question that really matters about a listing screenshot. Until #150 every
// store build of this app was a DEMO build, and a demo build is a DIFFERENT APP
// ON SCREEN — measured 2026-08-04 by capturing one and looking at it:
//
//   · `app_shell.dart` paints an orange banner across every screen reading
//     "Demo data - sample subscriptions, not your account";
//   · `demo_data.dart` fills the board with Netflix, Spotify, Disney+, Adobe CC,
//     1Password and seven more real companies. Two of them are legible in the
//     first frame.
//
// A listing built from that advertises the product as a demo AND puts third-party
// trademarks on a public store page — which Google's own preview-asset page
// tells developers to avoid and which [ADR 019] forbids for any asset we
// produce. No static guard can read a banner out of a PNG. What it CAN do is
// refuse a screenshot whose posture nobody recorded, so a screenshot set must be
// accompanied by the capture script's `CAPTURE.json` saying `posture: "live"`.
//
// ⚠️ WHAT THIS GUARD CANNOT SEE, stated plainly so nobody reads green as safe:
//   · WHETHER A SCREENSHOT IS REPRESENTATIVE. It proves size, format, count and
//     recorded posture. It does not know whether the screens chosen are the ones
//     worth showing, whether the board looks plausible, or whether the app
//     regressed between the capture and today. Google requires screenshots to
//     "demonstrate the actual in-app or in-game experience"; that is a human
//     call and this guard does not make it.
//   · WHETHER THE FEATURE GRAPHIC IS ANY GOOD. Right size, right format, right
//     provenance — not "right".
//   · THE PIXELS. Nothing here decodes an image. It reads the PNG header, which
//     is enough for every question Google states and for none of the ones it
//     does not.
//   · WHETHER THE COMMITTED GRAPHIC IS STILL WHAT ITS GENERATOR RENDERS. That
//     needs Chrome, so it is a separate step —
//     `node tooling/store/render-play-graphics.mjs --check` — which runs in the
//     lane that has a browser rather than beside the static guards.
//
// Usage:  node tooling/ci/assert-listing-assets.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = 'tooling/channel-register.json';
const APPS = 'sites/_shared/_data/apps.json';

const problems = [];
const prints = [];
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel)) : null);
const isDir = (rel) => existsSync(abs(rel)) && statSync(abs(rel)).isDirectory();

/** Structural failure: every check below quantifies over the missing thing, so
 *  continuing would report "clean" over nothing — the exact defect this guard
 *  exists to remove, in the guard itself. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-listing-assets: FAILED');
  process.exit(1);
}

// ── the register: the only declaration of what a listing needs ──────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'It is the single declaration of every graphic requirement. With it gone this guard would have no',
    'right-hand side and would certify every listing complete forever.',
  ]);
}
let register;
try {
  register = JSON.parse(registerRaw.toString('utf8'));
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}

const contract = register.storeMetadataContract;
if (contract === null || typeof contract !== 'object') {
  coverageLost([`${REGISTER} declares no \`storeMetadataContract\`.`]);
}
const storeRows = (Array.isArray(register.channels) ? register.channels : []).filter((c) => c && c.kind === 'store');
if (storeRows.length === 0) {
  coverageLost([`${REGISTER} declares ZERO \`kind: "store"\` channels — there is no listing to have graphics for.`]);
}

// Which channels state graphic requirements at all. A channel with none is not
// a failure — only Play's requirements have been fetched — but if NO channel
// states any, this guard has nothing to enforce and must say so rather than pass.
const withGraphics = storeRows.filter((r) => contract.perChannel?.[r.id]?.graphicAssets);
if (withGraphics.length === 0) {
  coverageLost([
    `no \`kind: "store"\` channel in ${REGISTER} declares a \`graphicAssets\` block.`,
    'That block IS the requirement. Without one, "the listing graphics are correct" has no right-hand',
    'side and an empty store directory satisfies every check below. If Play\'s block was removed, this',
    'guard did not become unnecessary — it became blind.',
  ]);
}

const appsRaw = read(APPS);
if (appsRaw === null) coverageLost([`${APPS} does not exist — the expected set has no right-hand factor.`]);
let apps;
try {
  apps = JSON.parse(appsRaw.toString('utf8'));
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) coverageLost([`${APPS} carries no app entries.`]);

// ── PNG header, read the same way the generator reads it ────────────────────
// Deliberately the same four fields `tooling/store/chrome-raster.mjs` exposes.
// Two readers with two ideas of "what this file is" is how one of them starts
// certifying the wrong thing.
function pngHeader(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 26 || !SIG.every((v, i) => buf[i] === v)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const h = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), depth: buf[24], colourType: buf[25], bytes: buf.length };
  if (h.width === 0 || h.height === 0) return null;
  let off = 8;
  let tRNS = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'tRNS') tRNS = true;
    if (type === 'IEND') break;
    off += 12 + len;
  }
  // `tRNS` counts. A palette or greyscale PNG carries transparency through that
  // chunk with no alpha channel in the colour type at all — which is exactly
  // what Android's stock ic_launcher.png is, so it is not a theoretical shape.
  h.hasAlpha = h.colourType === 4 || h.colourType === 6 || tRNS;
  return h;
}

/** A declared expectation with no citation. Enforcing it risks rejecting correct
 *  input on an invented number; ignoring it leaves the register claiming a
 *  constraint that does nothing. Fail, and say which. */
const unsourced = (where) =>
  `${REGISTER} ${where} declares dimensions with NO \`source\`. An invented limit fires on CORRECT input — a made-up "120 characters or fewer" once rejected this repo's own fixture at 129 — so this guard will not enforce a number nobody sourced, and will not let the register pretend to constrain an asset it does not. Add the URL and the date the page was read, or remove the expectation.`;

// ── the scan ────────────────────────────────────────────────────────────────
let assetsChecked = 0;
let screenshotsChecked = 0;
let treesSeen = 0;

for (const row of withGraphics) {
  const g = contract.perChannel[row.id].graphicAssets;
  const template = row.storeMetadataDir;
  if (typeof template !== 'string' || !template.includes('{app}')) {
    problems.push(
      `channel "${row.id}" declares \`graphicAssets\` but has no \`storeMetadataDir\` template, so it contributes ZERO expected directories and every graphic check for it ranges over nothing.`,
    );
    continue;
  }

  // The cross-reference. `additionalFiles`/`requiredFiles` is what makes
  // assert-store-metadata.mjs require a file to be present and non-empty; an
  // asset declared ONLY in graphicAssets has one guard holding it, and one guard
  // is how a listing asset gets deleted while the tree still reports complete.
  const named = new Set([
    ...(Array.isArray(contract.requiredFiles) ? contract.requiredFiles : []),
    ...(contract.perChannel[row.id].additionalFiles ?? []),
  ]);

  const assets = g.assets ?? {};
  if (Object.keys(assets).filter((k) => k !== '_why').length === 0) {
    coverageLost([
      `channel "${row.id}" declares a \`graphicAssets\` block with an EMPTY \`assets\` map.`,
      'The per-asset loop below iterates it. Empty, every listing graphic is "correct" in zero',
      'comparisons — and Play refuses to publish a listing without a feature graphic and an icon, so',
      'this would report ready while the submission could not be saved.',
    ]);
  }

  for (const app of apps) {
    if (typeof app.slug !== 'string' || app.slug === '') continue;
    const dir = template.replace('{app}', app.slug);
    if (!isDir(dir)) {
      // assert-store-metadata.mjs owns the "is there a tree at all" question and
      // already prints or fails on it. Repeating the verdict here would be two
      // guards reporting one fault; what matters HERE is that this app
      // contributes no graphic checks, which is recorded rather than silent.
      prints.push(`NO TREE: ${dir} — app "${app.slug}" has no metadata tree for channel "${row.id}", so no graphic could be checked for it. assert-store-metadata.mjs owns that verdict.`);
      continue;
    }
    treesSeen++;

    // ── the fixed-size assets ───────────────────────────────────────────────
    for (const [name, spec] of Object.entries(assets)) {
      if (name === '_why') continue;
      const rel = posix.join(dir, name);

      if (!named.has(name)) {
        problems.push(
          `${rel} is declared in graphicAssets but is NOT named in \`requiredFiles\` or perChannel["${row.id}"].additionalFiles. Only that list makes assert-store-metadata.mjs require the file to exist, so as declared it is held by this guard alone — delete it and one guard notices, which is one too few for an asset Play will not publish without.`,
        );
      }
      if (typeof spec.source !== 'string' || spec.source.trim() === '') {
        problems.push(unsourced(`storeMetadataContract.perChannel["${row.id}"].graphicAssets.assets["${name}"]`));
        continue;
      }
      // A contract naming a generator nobody wrote is a mechanism that fails on
      // first use, and its failure mode is the asset never being regenerated.
      // Same reasoning as assert-launcher-icons.mjs limb 6.
      if (typeof spec.generatedBy === 'string' && !existsSync(abs(spec.generatedBy))) {
        problems.push(`${REGISTER} says ${name} is generated by \`${spec.generatedBy}\`, and that file does not exist. The asset then has no way to be regenerated when the brand changes, which is the whole reason it is generated rather than drawn.`);
      }

      const buf = read(rel);
      if (buf === null) {
        problems.push(
          `${rel} is MISSING. Google: "${spec.source.split('verbatim:')[1]?.trim() ?? spec.source}". Nothing about this asset is owner-gated — it is produced from brand art already in this tree by \`node ${spec.generatedBy ?? 'tooling/store/render-play-graphics.mjs'}\` in seconds, with no account and no secret.`,
        );
        continue;
      }
      const h = pngHeader(buf);
      if (h === null) {
        problems.push(`${rel} is not a readable PNG (${buf.length} bytes). Present is not the same as valid: a truncated or empty file passes an existence check and is refused at upload.`);
        continue;
      }
      assetsChecked++;

      if (Number.isInteger(spec.width) && Number.isInteger(spec.height) && (h.width !== spec.width || h.height !== spec.height)) {
        problems.push(`${rel} is ${h.width}x${h.height} and Play requires exactly ${spec.width}x${spec.height}. Source: ${spec.source}`);
      }
      // 🔴 IN THE DIRECTION THIS ASSET DECLARES, not against a house rule. Play
      // wants the feature graphic WITHOUT alpha and the icon WITH it; a single
      // shared answer would be wrong for one of them every time.
      if (typeof spec.alpha === 'boolean' && h.hasAlpha !== spec.alpha) {
        problems.push(
          spec.alpha
            ? `${rel} has NO alpha channel (PNG colour type ${h.colourType}) and Play requires a "32-bit PNG (with alpha)". Source: ${spec.source}`
            : `${rel} HAS an alpha channel (PNG colour type ${h.colourType}) and Play requires a "24-bit PNG (no alpha)". Source: ${spec.source}`,
        );
      }
      if (Number.isInteger(spec.maxBytes) && h.bytes > spec.maxBytes) {
        problems.push(`${rel} is ${h.bytes} bytes and Play's maximum is ${spec.maxBytes}. Source: ${spec.source}`);
      }
    }

    // ── the screenshot set ──────────────────────────────────────────────────
    const s = g.screenshots;
    if (!s || typeof s !== 'object') continue;
    if (typeof s.source !== 'string' || s.source.trim() === '') {
      problems.push(unsourced(`storeMetadataContract.perChannel["${row.id}"].graphicAssets.screenshots`));
      continue;
    }
    const shotDir = posix.join(dir, s.dir ?? 'screenshots');
    if (typeof s.capturedBy === 'string' && !existsSync(abs(s.capturedBy))) {
      problems.push(`${REGISTER} says screenshots are captured by \`${s.capturedBy}\`, and that file does not exist. Without it the set cannot be regenerated, and a screenshot set nobody can regenerate is stale the first time the UI changes — silently, because no store console watches a repository.`);
    }
    if (!isDir(shotDir)) {
      problems.push(`${shotDir} does not exist. The slot itself is part of the listing contract — losing the directory loses the record that this channel needs screenshots at all.`);
      continue;
    }

    const shots = listDir(abs(shotDir)).filter((f) => f.toLowerCase().endsWith('.png')).sort();

    if (shots.length === 0) {
      const why =
        `${shotDir} holds NO screenshots, and Play will not publish a listing without at least ` +
        `${s.minCount}. This is the ONE listing asset that cannot be produced on the owner's machine: it ` +
        `must be captured against a LIVE build (a demo build paints "Demo data - sample subscriptions, ` +
        `not your account" over every screen and seeds twelve third-party trademarks), a live build needs ` +
        `a confirmed account, and that needs SUPABASE_SERVICE_ROLE_KEY — a CI-only secret. Close it with ` +
        `the \`store-screenshots\` workflow, or locally with those secrets: node ${s.capturedBy}`;
      if (row.served === true) {
        problems.push(`channel "${row.id}" is SERVED and ${why}`);
      } else {
        prints.push(`NO SCREENSHOTS (blocked on a CI run, OWNER_QUEUE ${row.ownerQueue ?? '(unnamed)'}): ${why}`);
      }
      continue;
    }

    // 🔴 PROVENANCE FIRST. A screenshot with no recorded posture is the one
    // failure this guard exists to make impossible, and it must fail even when
    // every dimension is perfect — a demo capture is exactly the right size.
    if (typeof s.provenanceFile === 'string') {
      const provRel = posix.join(shotDir, s.provenanceFile);
      const provBuf = read(provRel);
      if (provBuf === null) {
        problems.push(
          `${shotDir} holds ${shots.length} screenshot(s) and no ${s.provenanceFile}. A PNG carries no evidence of which BUILD it photographed, and that is the only question that matters here: until #150 every store build of this app was a demo build, whose every screen carries a "Demo data" banner and whose board is twelve third-party trademarks. \`${s.capturedBy}\` writes this file on a live run and refuses to write demo output into this directory at all — so screenshots without it were put here by hand, and nobody can say what they show.`,
        );
      } else {
        let prov;
        try {
          prov = JSON.parse(provBuf.toString('utf8'));
        } catch (e) {
          problems.push(`${provRel} is not valid JSON — ${e.message}. The provenance record is unreadable, so the posture of these screenshots is unknown.`);
          prov = null;
        }
        if (prov && prov.posture !== 'live') {
          problems.push(
            `${provRel} records posture ${JSON.stringify(prov.posture ?? null)}, not "live". These screenshots photographed a build that is not the one users get. A demo capture is exactly the right SIZE, which is why size checks alone would pass it.`,
          );
        }
      }
    }

    if (Number.isInteger(s.minCount) && shots.length < s.minCount) {
      problems.push(`${shotDir} holds ${shots.length} screenshot(s) and Play requires at least ${s.minCount}. Source: ${s.source}`);
    }
    if (Number.isInteger(s.maxCount) && shots.length > s.maxCount) {
      problems.push(`${shotDir} holds ${shots.length} screenshot(s) and Play accepts at most ${s.maxCount} per device type. Source: ${s.source}`);
    }
    if (Number.isInteger(s.recommendedCount) && shots.length < s.recommendedCount) {
      prints.push(`${shotDir} holds ${shots.length} screenshot(s); Google recommends at least ${s.recommendedCount} at 1080px+ to be eligible for the large-format recommendation surfaces. Not a publish blocker — a reach one.`);
    }

    for (const f of shots) {
      const rel = posix.join(shotDir, f);
      const buf = read(rel);
      const h = pngHeader(buf);
      if (h === null) {
        problems.push(`${rel} is not a readable PNG (${buf.length} bytes).`);
        continue;
      }
      screenshotsChecked++;
      const min = Math.min(h.width, h.height);
      const max = Math.max(h.width, h.height);
      if (Number.isInteger(s.minSide) && min < s.minSide) {
        problems.push(`${rel} is ${h.width}x${h.height}; Play's "Minimum dimension" is ${s.minSide}px. Source: ${s.source}`);
      }
      if (Number.isInteger(s.maxSide) && max > s.maxSide) {
        problems.push(`${rel} is ${h.width}x${h.height}; Play's "Maximum dimension" is ${s.maxSide}px. Source: ${s.source}`);
      }
      // The constraint that is easy to miss and trivially violated by a tall
      // phone: a 1080x2400 capture (a 20:9 handset) is 2.22:1 and is REFUSED,
      // while 1080x1920 is 1.78:1 and is fine.
      if (Number.isFinite(s.maxAspectRatio) && max > min * s.maxAspectRatio) {
        problems.push(
          `${rel} is ${h.width}x${h.height} — a ratio of ${(max / min).toFixed(2)}:1. Play: "The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension." Source: ${s.source}`,
        );
      }
      if (typeof s.alpha === 'boolean' && h.hasAlpha !== s.alpha && !s.alpha) {
        problems.push(`${rel} HAS an alpha channel (PNG colour type ${h.colourType}) and Play requires a "24-bit PNG (no alpha)". Source: ${s.source}`);
      }
    }
  }
}

// ── the scan must still be reaching the tree ────────────────────────────────
if (treesSeen === 0) {
  coverageLost([
    'not one store metadata tree was found for any channel declaring graphic requirements.',
    'Every check above ranged over nothing. Either the trees moved or the register templates did.',
  ]);
}
if (assetsChecked === 0) {
  coverageLost([
    `${treesSeen} tree(s) were read and ZERO listing graphics were measured.`,
    'The register names assets the trees do not carry, or every asset lost its `source` and was skipped.',
    'Both report every listing graphic correct by never measuring one — and Play refuses to publish a',
    'listing with no feature graphic and no icon, so this would read ready while the submission could',
    'not be saved.',
  ]);
}

// ── report ──────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (a gap nobody sees becomes permanent) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
  console.log('');
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  Google requires a feature graphic, an app icon and at least two screenshots to publish a');
  console.error('  listing AT ALL. Regenerate the graphics with `node tooling/store/render-play-graphics.mjs`.');
  console.error('\nassert-listing-assets: FAILED');
  process.exitCode = 1;
} else {
  console.log(
    `ok   REQUIRED_COVERAGE — ${withGraphics.length} channel(s) declaring graphic requirements × ${apps.length} app(s); ` +
      `${treesSeen} tree(s) read, ${assetsChecked} fixed-size asset(s) measured, ${screenshotsChecked} screenshot(s) measured`,
  );
  console.log('ok   every dimension enforced came from the register WITH a citation; an unsourced one fails');
  console.log('     rather than being applied, and an unsourced one cannot be added without its URL and date');
  console.log('   ⚠️ CANNOT SEE: whether a screenshot is REPRESENTATIVE of the app, or whether the feature');
  console.log('      graphic is any good. Size, format, count and RECORDED posture are all this proves — the');
  console.log('      pixels are never decoded. "Demonstrates the actual in-app experience" is a human call.');
  console.log('   ⚠️ CANNOT SEE: whether a committed graphic is still what its generator renders. That needs');
  console.log('      a browser: `node tooling/store/render-play-graphics.mjs --check`, in the lane that has one.');
  console.log('\nassert-listing-assets: ok');
}
