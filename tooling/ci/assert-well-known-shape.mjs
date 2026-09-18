#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-well-known-shape.mjs — the ONE AASA and the ONE assetlinks.json that
// serve every app on the shared apex are correct, or absent for a stated reason.
//
// [ADR 075] moved every app from `<app>.nikatru.com` to `nikatru.com/<app>`, so
// the two association files stopped being per-app. They are ORIGIN-scoped by
// specification — iOS and Android fetch them from the origin and there is no
// path-scoped form of either — which means ONE file now decides deep linking for
// the whole portfolio, and a malformed entry for app #7 breaks universal links
// for app #1. The generator is `tooling/sites/generate-well-known.mjs`; this is
// the check that stops the file being hand-maintained back into that state.
//
// ── WHAT IT IS GUARDING TODAY: AN ABSENCE, AS A MEASURED PAIR ────────────────
// 🔴 THE HARD PART OF THIS GUARD IS THAT THE CORRECT TREE CONTAINS NO FILE.
// Measured 2026-09-09: `catalog/apps.json` holds one app, `platforms: ["web"]`,
// every mobile `listings` key null; `tooling/channel-register.json` serves the
// `web` row alone; no `.well-known` directory exists. Zero apps have a shipped
// mobile identity, and an EMPTY AASA is not a harmless placeholder — Apple
// fetches AASA through its own CDN, so an empty file published now is a cached,
// authoritative "no app claims any path on this origin" that the first REAL file
// has to outlive. So the generator writes nothing.
//
// "Nothing to check" is exactly the state in which a guard rots into a green
// light over an empty set — this corpus's single most repeated defect. So limb A
// does not check a file; it checks a PAIR OF COUNTS: qualifying apps, and files
// under `sites/nikatru/.well-known/`. Zero and zero is the only passing form of
// the empty state, and either half moving alone is a finding:
//
//   qualifying = 0, files = 0  → ok, and the counts are printed
//   qualifying = 0, files > 0  → a hand-written association file (limb A)
//   qualifying > 0, files = 0  → a shipped app with no association file (limb A)
//
// That is the same idiom `sites/nikatru/_headers` uses for `/*.css` — a class
// declared before its first file arrives — applied to files instead of headers,
// and it is what lets the machinery and its guard exist BEFORE the first file.
//
// ── THE LIMBS ────────────────────────────────────────────────────────────────
//   0 COVERAGE  the catalogue exists, parses, and is non-empty; and the run
//               compared something. Exit 2, never 0. (Below.)
//   A  THE MEASURED PAIR — qualifying apps vs files on disk, both directions.
//   B  DRIFT — every file on disk is byte-identical to what the generator plans
//      from the same sources, and no file under `.well-known/` is unowned.
//   C  Every file there is valid JSON. (An AASA that does not parse is a
//      universal-link outage that no other check in this repository would see.)
//   D  The AASA is served WITH NO FILE EXTENSION. `apple-app-site-association`
//      is the exact name iOS fetches; `…​.json` is a 404 to iOS and one of the
//      two commonest ways a first association attempt fails.
//   E  SET EQUALITY, BOTH DIRECTIONS. Every catalogue app with a mobile listing
//      has an entry, and every entry's path components name a slug that exists
//      in the catalogue. One direction alone is half a check: the forward one
//      misses an entry for an app that was deleted (a live claim on a dead
//      path), the reverse one misses an app that shipped without a claim.
//   F  Every AASA entry EXCLUDES `/checkout-return`, and the exclusion comes
//      FIRST. Components match in order and the first hit wins, so an exclusion
//      after an include is dead text that reads exactly like protection. The
//      path is where Paddle sends a returning buyer
//      (`apps/<id>/lib/state/money_providers.dart:71`); a universal link that
//      captured it would throw a paying stranger into an app instead of the page
//      that confirms the payment.
//   G  `assetlinks.json` is a FLAT ARRAY of well-formed statements AND CARRIES
//      NO PATH SCOPING. 🔴 Android has no path-scoped Digital Asset Links: a
//      statement delegates the WHOLE ORIGIN. A `"/"`, `paths` or `pathPrefix`
//      key in this file is not a narrower grant, it is a misunderstanding that
//      silently grants everything — including `/checkout-return`, which limb F
//      protects on the Apple side and which NOTHING here can protect on the
//      Android side. Per-path narrowing lives in the app's own intent filter.
//   H  When the AASA exists, `sites/nikatru/_headers` declares
//      `Content-Type: application/json` for it. An extensionless file is served
//      as `application/octet-stream` by default, and the header file belongs to
//      another unit — so this limb states the obligation on the day it becomes
//      real rather than assuming somebody remembered.
//
// ⚠️ THE SHAPE LIMBS GRADE THE BYTES ON DISK AGAINST THE CATALOGUE, not against
// the generator's rendering. Limb B already asks "did you run the generator";
// asking only that would make every other limb a check on a check, and a bug in
// the generator would pass its own output. C–H re-derive their expectations from
// `catalog/apps.json` and `tooling/sites/apex.mjs` and read the file as a
// stranger's device would.
//
// ⚠️ HOW IT REACHES CI TODAY, STATED RATHER THAN ASSUMED. No workflow job names
// this file — `.github/` belongs to another unit — so
// `tooling/ci/build-enforcement-index.mjs` classifies it `state: TEST`,
// `reachedBy: ci.yml#guard-meta`: it runs in CI because
// `tooling/ci/test/well-known-shape.test.mjs` spawns it against THIS repository
// as its positive control, on the test-runner job. That is a real enforcement
// path, not a gap being papered over — but it is a weaker one than a named job,
// and moving it into a job of its own is the right change the day the first
// association file exists.
//
// Usage:  node tooling/ci/assert-well-known-shape.mjs [repoRoot]
// Exit 0 = green · 1 = a finding · 2 = COVERAGE LOST (checked nothing).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AASA_REL,
  ASSETLINKS_REL,
  CATALOG,
  CHECKOUT_RETURN_PATH,
  SURFACES,
  WELL_KNOWN_DIR,
  mobilePresence,
  planWellKnown,
  wellKnownOnDisk,
} from '../sites/generate-well-known.mjs';
import { APEX_HOST, appBaseHref } from '../sites/apex.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? join(HERE, '..', '..'));

const HEADERS_REL = 'sites/nikatru/_headers';

/** The AASA name with an extension — the wrong name, kept as a constant so limb
 *  D compares against something derived from the right one rather than a second
 *  spelling of it. */
const AASA_WRONG_REL = `${AASA_REL}.json`;

const read = (root, rel) => readFileSync(join(root, ...rel.split('/')), 'utf8');

/** Every component's path string in one `details` entry, in order. */
const componentPaths = (detail) =>
  (Array.isArray(detail?.components) ? detail.components : []).map((c) => (c && typeof c === 'object' ? c['/'] : undefined));

/**
 * Grade a tree. Exported so the test can drive it in-process as well as spawn
 * it, and so a caller can distinguish the three outcomes without parsing text.
 *
 * @returns {{problems: string[], lost: string[], notes: string[], measured: object}}
 */
export function gradeWellKnown(root) {
  const problems = [];
  const lost = [];
  const notes = [];

  let plan;
  try {
    plan = planWellKnown(root);
  } catch (e) {
    lost.push(`the generator threw while planning (${String(e.message).split('\n')[0]}), so nothing was compared.`);
    return { problems, lost, notes, measured: { comparisons: 0 } };
  }

  // ── 0 COVERAGE ─────────────────────────────────────────────────────────────
  if (!plan.catalogUsable) {
    for (const p of plan.problems) lost.push(p);
    lost.push(`without ${CATALOG} every limb below quantifies over an empty world and passes without checking one app.`);
    return { problems, lost, notes, measured: { comparisons: plan.comparisons } };
  }

  const onDisk = wellKnownOnDisk(root);
  const qualifying = plan.qualifying;
  // Each (app × surface) qualification decision, plus each file actually found.
  const comparisons = plan.comparisons + onDisk.length;
  if (comparisons === 0) {
    lost.push(`${CATALOG} parsed but no app/surface pair was graded and no file was read, so this run is evidence of nothing.`);
    return { problems, lost, notes, measured: { comparisons } };
  }

  // A generator problem is a finding here, not a crash: a half-declared app is
  // exactly what limb A would otherwise report as "0 qualifying" and pass.
  for (const p of plan.problems) problems.push(`limb A (the measured pair) — ${p}`);

  // ── A THE MEASURED PAIR ────────────────────────────────────────────────────
  if (qualifying.length === 0 && onDisk.length > 0) {
    problems.push(
      `limb A (the measured pair) — ${onDisk.length} file(s) exist under ${WELL_KNOWN_DIR}/ (${onDisk.join(', ')}) ` +
        'while ZERO apps qualify for one. Nothing in the catalogue declares a mobile presence with an identity behind it, ' +
        'so no association file can have been generated from it: this file was hand-written or left behind. It is not ' +
        'harmless — Apple caches an association answer through its own CDN, so an empty or invented file published now is ' +
        'an authoritative "no app claims this origin" the first real file has to outlive.',
    );
  }
  if (qualifying.length > 0 && onDisk.length === 0) {
    const who = qualifying.map((q) => `${q.slug}/${q.surface}`).join(', ');
    problems.push(
      `limb A (the measured pair) — ${qualifying.length} app/surface pair(s) qualify (${who}) and NO file exists under ` +
        `${WELL_KNOWN_DIR}/. A shipped mobile app with no association file has universal links that silently fall back to ` +
        'the browser. Run `node tooling/sites/generate-well-known.mjs`.',
    );
  }

  // ── B DRIFT, AND UNOWNED FILES ─────────────────────────────────────────────
  for (const [rel, want] of plan.files) {
    if (!onDisk.includes(rel)) {
      problems.push(`limb B (drift) — ${rel} is planned from ${CATALOG} but is not on disk. Run the generator.`);
      continue;
    }
    const have = read(root, rel);
    if (have !== want) {
      problems.push(
        `limb B (drift) — ${rel} differs from what the generator plans from the same sources ` +
          `(${have.length} byte(s) on disk, ${want.length} planned). These files are GENERATED; a hand edit to one of ` +
          'them is an edit to every app\'s deep linking at once.',
      );
    }
  }
  for (const rel of onDisk) {
    if (!plan.files.has(rel)) {
      problems.push(
        `limb B (drift) — ${rel} is under ${WELL_KNOWN_DIR}/ and no generator owns it. Association files are derived ` +
          'from the catalogue; a file nothing derives is a claim about this origin that nobody can regenerate or review.',
      );
    }
  }

  // ── C VALID JSON ───────────────────────────────────────────────────────────
  const parsed = new Map();
  for (const rel of onDisk) {
    try {
      parsed.set(rel, JSON.parse(read(root, rel)));
    } catch (e) {
      problems.push(
        `limb C (JSON) — ${rel} is not valid JSON (${String(e.message).split('\n')[0]}). iOS and Android both treat an ` +
          'unparseable association document as "no association", so this is an outage for every app on the origin.',
      );
    }
  }

  // ── D THE AASA NAME CARRIES NO EXTENSION ───────────────────────────────────
  // One loop, not two: an earlier draft tested `…​.json` explicitly AND swept for
  // near-misses, and reported the same file twice. The sweep is the general form
  // — `.json` is only the commonest of the near-misses — so it is the one kept.
  const AASA_NAME = AASA_REL.split('/').pop();
  for (const rel of onDisk) {
    const name = rel.split('/').pop();
    if (name.startsWith(AASA_NAME) && name !== AASA_NAME) {
      problems.push(
        `limb D (extension) — ${rel} is not the name iOS fetches. It fetches ${AASA_NAME} EXACTLY, with NO extension; ` +
          `${rel === AASA_WRONG_REL ? 'the .json spelling' : 'a near-miss'} is a 404 to the only client that reads it.`,
      );
    }
  }

  // ── E SET EQUALITY, BOTH DIRECTIONS ────────────────────────────────────────
  const catalogSlugs = new Set(plan.catalog.map((r) => r?.slug).filter((s) => typeof s === 'string'));
  const iosSurface = SURFACES.find((s) => s.id === 'ios');
  const androidSurface = SURFACES.find((s) => s.id === 'android');
  const wantIos = new Set(plan.catalog.filter((r) => mobilePresence(r, iosSurface).length > 0).map((r) => r.slug));
  const wantAndroid = new Set(plan.catalog.filter((r) => mobilePresence(r, androidSurface).length > 0).map((r) => r.slug));

  const aasa = parsed.get(AASA_REL);
  if (aasa !== undefined) {
    const details = aasa?.applinks?.details;
    if (!Array.isArray(details)) {
      problems.push(`limb E (shape) — ${AASA_REL} has no \`applinks.details\` array; nothing in it claims a path, whatever else it says.`);
    } else {
      const claimed = new Set();
      details.forEach((detail, i) => {
        const at = `${AASA_REL} details[${i}]`;
        const appIDs = detail?.appIDs;
        if (!Array.isArray(appIDs) || appIDs.length === 0 || appIDs.some((a) => typeof a !== 'string' || !/^[A-Z0-9]{10}\./.test(a))) {
          problems.push(`limb E (shape) — ${at} has no usable \`appIDs\` (each is <10-character team id>.<bundle id>).`);
        }
        const paths = componentPaths(detail);
        const includes = paths.filter((_, j) => detail.components[j]?.exclude !== true);
        if (includes.length === 0) {
          problems.push(`limb E (shape) — ${at} includes no path at all: every component is an exclusion, so the entry claims nothing.`);
        }
        for (const p of includes) {
          const m = typeof p === 'string' ? /^\/([a-z0-9][a-z0-9-]*)\/\*$/.exec(p) : null;
          if (!m) {
            problems.push(
              `limb E (shape) — ${at} includes the component ${JSON.stringify(p)}, which is not the one shape this origin ` +
                'allows: `/<slug>/*`, an app scoped to its own path. Anything wider claims another app\'s paths, the ' +
                'marketing pages or the legal archive, on a shared origin.',
            );
            continue;
          }
          if (!catalogSlugs.has(m[1])) {
            problems.push(
              `limb E (set equality) — ${at} claims ${JSON.stringify(p)} but "${m[1]}" is not a slug in ${CATALOG}. ` +
                'A live claim on a path no app serves outlives the app that was deleted.',
            );
            continue;
          }
          claimed.add(m[1]);
        }
      });
      for (const slug of wantIos) {
        if (!claimed.has(slug)) {
          problems.push(
            `limb E (set equality) — ${slug} declares an iOS presence in ${CATALOG} but no entry in ${AASA_REL} claims ` +
              `${appBaseHref(slug)}*. Missing from a portfolio-wide file is a failure only that one app's users see.`,
          );
        }
      }
    }
  }

  // ── F THE CHECKOUT-RETURN EXCLUSION, AND ITS POSITION ──────────────────────
  if (aasa !== undefined && Array.isArray(aasa?.applinks?.details)) {
    aasa.applinks.details.forEach((detail, i) => {
      const at = `${AASA_REL} details[${i}]`;
      const components = Array.isArray(detail?.components) ? detail.components : [];
      const idx = components.findIndex((c) => c && c['/'] === CHECKOUT_RETURN_PATH && c.exclude === true);
      if (idx === -1) {
        problems.push(
          `limb F (checkout-return) — ${at} does not exclude ${CHECKOUT_RETURN_PATH}. That is where Paddle sends a ` +
            'returning buyer; a universal link that captured it would throw a stranger who has just paid into an app ' +
            'instead of the page that confirms the payment.',
        );
        return;
      }
      const firstInclude = components.findIndex((c) => c && c.exclude !== true);
      if (firstInclude !== -1 && firstInclude < idx) {
        problems.push(
          `limb F (checkout-return) — ${at} excludes ${CHECKOUT_RETURN_PATH} at component ${idx}, AFTER an including ` +
            `component at ${firstInclude}. AASA matches components in order and takes the first hit, so an exclusion ` +
            'behind an include is dead text that reads exactly like protection.',
        );
      }
    });
  }

  // ── G ANDROID: FLAT ARRAY, NO PATH SCOPING ─────────────────────────────────
  const links = parsed.get(ASSETLINKS_REL);
  if (links !== undefined) {
    if (!Array.isArray(links)) {
      problems.push(
        `limb G (android) — ${ASSETLINKS_REL} is not a JSON ARRAY. Digital Asset Links is a flat list of statements; ` +
          'an object here is not read at all.',
      );
    } else {
      const packages = new Set();
      links.forEach((st, i) => {
        const at = `${ASSETLINKS_REL}[${i}]`;
        const rel = st?.relation;
        if (!Array.isArray(rel) || !rel.includes('delegate_permission/common.handle_all_urls')) {
          problems.push(`limb G (android) — ${at} does not declare the relation delegate_permission/common.handle_all_urls, so it verifies nothing.`);
        }
        const t = st?.target ?? {};
        if (t.namespace !== 'android_app') problems.push(`limb G (android) — ${at}.target.namespace is ${JSON.stringify(t.namespace)}, not "android_app".`);
        if (typeof t.package_name !== 'string' || !t.package_name.includes('.')) {
          problems.push(`limb G (android) — ${at}.target.package_name is not an applicationId.`);
        } else {
          packages.add(t.package_name);
        }
        const fps = t.sha256_cert_fingerprints;
        if (!Array.isArray(fps) || fps.length === 0 || fps.some((f) => typeof f !== 'string' || !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f))) {
          problems.push(
            `limb G (android) — ${at}.target.sha256_cert_fingerprints is not a non-empty list of 32 colon-separated ` +
              'uppercase hex octets. Under Play App Signing this must be the APP SIGNING certificate; the upload ' +
              'certificate pinned in tooling/channel-register.json validates as JSON and fails on every device.',
          );
        }
        // 🔴 THE ASYMMETRY, ASSERTED RATHER THAN ASSUMED AWAY.
        for (const key of ['/', 'paths', 'pathPrefix', 'include', 'exclude', 'components']) {
          if (Object.prototype.hasOwnProperty.call(st ?? {}, key) || Object.prototype.hasOwnProperty.call(t, key)) {
            problems.push(
              `limb G (android) — ${at} carries a "${key}" key. THERE IS NO PATH-SCOPED DIGITAL ASSET LINKS: a statement ` +
                `delegates ALL of ${APEX_HOST} to the app named, and a path key here narrows nothing while reading exactly ` +
                'like it does. Per-path narrowing belongs in the app\'s own intent filter (android:pathPrefix).',
            );
          }
        }
      });
      if (wantAndroid.size > 0 && packages.size === 0) {
        problems.push(`limb G (android) — ${wantAndroid.size} app(s) declare an Android presence and ${ASSETLINKS_REL} names no package.`);
      }
      if (packages.size > 0) {
        notes.push(
          `${packages.size} Android package(s) are verified for ALL of ${APEX_HOST} — including /checkout-return, ` +
            '/pricing and the dated legal archive. That is what Digital Asset Links grants; the app\'s intent filter is ' +
            'the only place it can be narrowed.',
        );
      }
    }
  }

  // ── H THE CONTENT TYPE OF AN EXTENSIONLESS FILE ────────────────────────────
  if (onDisk.includes(AASA_REL)) {
    const headersPath = join(root, ...HEADERS_REL.split('/'));
    const headers = existsSync(headersPath) ? readFileSync(headersPath, 'utf8') : '';
    const declares = /^\/\.well-known\/apple-app-site-association\s*$/m.test(headers) && /Content-Type:\s*application\/json/i.test(headers);
    if (!declares) {
      problems.push(
        `limb H (content type) — ${AASA_REL} exists but ${HEADERS_REL} does not declare ` +
          '`/.well-known/apple-app-site-association` with `Content-Type: application/json`. An extensionless file is ' +
          'served as application/octet-stream by default, which is the second of the two commonest ways a first ' +
          'association attempt fails.',
      );
    }
  }

  return {
    problems,
    lost,
    notes,
    measured: {
      comparisons,
      apps: plan.catalog.length,
      presence: plan.presence.length,
      qualifying: qualifying.length,
      files: onDisk.length,
      wantIos: wantIos.size,
      wantAndroid: wantAndroid.size,
    },
  };
}

/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const { problems, lost, notes, measured } = gradeWellKnown(ROOT);

  if (lost.length) {
    console.error('✗ COVERAGE LOST — limb 0 (the catalogue) refused: assert-well-known-shape graded nothing it could stand behind:');
    for (const l of lost) console.error(`    ${l}`);
    console.error('    One AASA and one assetlinks.json serve every app on this origin; a run over an empty catalogue');
    console.error('    satisfies every limb below without reading one app.');
    coverageLost();
  }

  for (const n of notes) console.log(`note ${n}`);

  if (problems.length) {
    const firstLimb = /^limb [A-H][^—]*/.exec(problems[0])?.[0]?.trim() ?? 'limb A';
    console.error(`✗ ${firstLimb} refused — ${problems.length} finding(s) in the origin-wide association files:`);
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }

  const shape =
    measured.files === 0
      ? `NOTHING DECLARED AND NOTHING PUBLISHED — 0 qualifying app/surface pair(s), 0 file(s) under ${WELL_KNOWN_DIR}/. ` +
        'The pair is the assertion: either half moving alone is a finding.'
      : `${measured.qualifying} qualifying app/surface pair(s), ${measured.files} file(s) under ${WELL_KNOWN_DIR}/, graded on limbs B–H.`;
  console.log(
    `assert-well-known-shape: ok — ${measured.apps} catalogue app(s), ${measured.presence} mobile presence claim(s), ` +
      `${measured.comparisons} comparison(s). ${shape}`,
  );
}

/** The one COVERAGE LOST stop: each could-not-look branch above prints its own reason and ends
 *  here, so the run exits 2 — never 1, which would read as a finding (AGENTS.md exit-code
 *  convention, O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-well-known-shape.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost() {
  process.exit(2);
}
