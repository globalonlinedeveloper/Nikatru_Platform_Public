#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-landing-payload.mjs — the factory PUBLISHES the render payload its
// landing pages are built from.
//
//     catalog/apps.json                        (the slug set)
//     services/platform/src/app-config-data.json   (the ONE place a price lives)
//     apps/<slug>/store/<channel>/long-description.txt
//                     ──(this script)──▶  catalog/apps-landing.json
//
// ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────
// `sites/nikatru/apps/subly.html` is 9,789 bytes of indexed landing page and
// about 2,000 of them — the About lede, the "What you get" list, and the whole
// Pricing block with REAL PRICES — are rendered from two sources that are NOT
// the catalogue: the rail config and the app's store listing. Measured
// 2026-08-18: run `generate-discovery.mjs` in a tree that has the catalogue but
// neither of those two and it produces subly.html at 7,782 bytes with
// `problems: []`. It does not complain. `readRailConfig` returns null on a
// missing file by explicit design and `storeLede` returns null when no channel
// file exists, so both degrade to a shorter, valid-looking page and exit 0.
//
// That is the shape this repository pays for most often — a producer that
// silently stops carrying what it used to and reports health. It is also what
// blocks the web-presence cutover: the storefront repo holds the catalogue and
// the sites, but it holds NEITHER of the two sources above, so it cannot
// reproduce the page it is about to start serving.
//
// So the factory publishes the PROJECTION it already computes.
//
// ── 🔴 THE PRICE RULE, AND WHERE THE LINE IS ─────────────────────────────────
// `services/platform/src/app-config-data.json` is THE ONE PLACE A PRICE LIVES.
// A second copy of `amount_minor` is how a landing page comes to advertise
// $4.99 while checkout charges something else, which is precisely the defect
// `generate-discovery.mjs` exists to prevent. Therefore:
//
//   · this script NEVER copies the rail config, and never publishes
//     `amount_minor`, `currency_code` or the raw `paywall` object;
//   · it publishes the RENDERED result — `"$4.99"` — which is a projection of
//     `499 + USD + $`. A consumer holding `"$4.99"` cannot disagree with the
//     config about 499, because it never sees 499.
//
// `tooling/ci/assert-render-payload.mjs` enforces both halves, and it does its
// own arithmetic on the rail config rather than importing this script's — the
// recorded reason being assert-discovery-surface.mjs limb G, whose first
// version imported `commerceFor()` and printed `ok — 2 rendered price(s) equal
// what the config declares` over a page quoting $5.99 against a config saying
// 499.
//
// ── WHY IT REUSES THE RENDERER'S OWN PROJECTION RATHER THAN REDERIVING IT ────
// `commerceFor()`, `storeLede()` and `zero()` are imported from
// `generate-discovery.mjs`, the module that DEFINED this projection. A second
// implementation of "flag → reader-facing name" or "amount_minor + code →
// string" would be free to drift from the renderer in the one direction that
// reports clean: both would keep working, and the published payload would stop
// describing the page. The guard's independence (above) is what keeps this
// reuse honest — reuse on the producing side, independent arithmetic on the
// checking side.
//
// ── WHY A SEPARATE FILE AND NOT A FEW MORE FIELDS ON catalog/apps.json ───────
// MEASURED, not argued. `generate-apps-data.mjs` passes EVERY catalogue field
// through to `sites/_shared/_data/apps.json`, deliberately (its header records
// why a projection there would be a behaviour change). Adding `lede` and
// `offerings` to a copy of the catalogue and running that generator's `--check`
// answers:
//
//     ✗ sites/_shared/_data/apps.json has DRIFTED — committed: 235 bytes ·
//       regenerated: 370 bytes
//
// i.e. folding these fields in changes the live site's committed bytes, which is
// the exact contract the catalogue inversion exists to hold. A separate file is
// required, not preferred.
//
// ── WHY IT IS AN ARRAY OF ROWS AND NOT AN OBJECT KEYED BY SLUG ───────────────
// The storefront repo's vendored-catalogue reader refuses anything that is not
// a non-empty JSON array of objects each carrying a unique non-empty string
// `slug`. An object map is rejected at the door. An array of `{slug, …}` rows is
// "keyed by slug" in exactly the sense `catalog/apps.json` already is, and it
// inherits the zero-rows and duplicate-slug refusals for free.
//
// Usage:  node tooling/sites/generate-landing-payload.mjs [root] [--check]
//         (default) writes the payload if its bytes differ
//         --check   renders in memory and DIFFS; exit 1 on drift, writes nothing
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RAIL_CONFIG,
  commerceFor,
  readRailConfig,
  storeLede,
  zero,
} from './generate-discovery.mjs';

export const CATALOGUE = 'catalog/apps.json';
export const PAYLOAD = 'catalog/apps-landing.json';

/** The files this script MUST have read for its output to mean anything. A
 *  publisher that produced a payload without opening the rail config produced a
 *  price-free payload, and a price-free payload renders a price-free page while
 *  every byte-comparison downstream keeps agreeing with it. */
export const REQUIRED_SOURCES = [CATALOGUE, RAIL_CONFIG];

/** UTF-8 BOM. PowerShell 5.1 writes one from `Out-File -Encoding utf8` and from
 *  `Set-Content`, and this repository has already shipped a BOM inside a git
 *  commit subject by exactly that route. A BOM in front of a JSON array is not
 *  cosmetic: `JSON.parse` THROWS on it, so a BOM'd payload is an unreadable
 *  payload for every consumer — and the one place it would surface is a
 *  storefront build, in another repository, after the bytes had already been
 *  vendored. Refused on the way in and never written on the way out. */
const BOM = '﻿';

/** Read a text file and REFUSE a BOM rather than silently tolerating it.
 *  Returns `{ text }` or `{ bom: true }`. */
function readNoBom(path) {
  const text = readFileSync(path, 'utf8');
  if (text.startsWith(BOM)) return { bom: true, text: null };
  return { bom: false, text };
}

/* ------------------------------------------------------------------ */
/* Plan                                                               */

/**
 * Read the catalogue, the rail config and each app's store listing, and render
 * the payload. Returns `{ contents, rows, notes, problems }`; `contents` is null
 * when `problems` is non-empty.
 *
 * 🔴 EVERY REFUSAL BELOW IS A CASE WHERE THIS SCRIPT COULD HAVE PRODUCED
 * SOMETHING INSTEAD. That is the whole design: the failure this exists to
 * prevent is not a crash, it is a shorter file that parses.
 *
 *   · catalogue absent / malformed / empty / duplicate slugs
 *         — the same five refusals `generate-apps-data.mjs` makes, for the same
 *           reason, over the same file.
 *   · RAIL CONFIG ABSENT
 *         — `readRailConfig` answers `null` for a missing file BY DESIGN, which
 *           is right for a renderer (a tree with no rail still has pages) and
 *           wrong for the publisher OF the price projection. Publishing a
 *           payload with no offerings in it is publishing the silent
 *           degradation, in a file, to another repository.
 *   · a BOM on any input
 *         — see BOM above.
 *   · any problem raised by `commerceFor` (an unnamed feature flag, an offering
 *     this factory will not put a price on)
 *         — inherited unchanged. A rendered price is a number a stranger is
 *           asked to pay; there is no best-effort branch for it here either.
 */
export function planLandingPayload(root) {
  const problems = [];
  const notes = [];
  const nothing = { contents: null, rows: [], notes, problems };

  const cataloguePath = join(root, ...CATALOGUE.split('/'));
  if (!existsSync(cataloguePath)) {
    problems.push(
      `${CATALOGUE} does not exist. It is the published catalogue whose slugs this payload is keyed on; ` +
        `without it there is no app set to project, and writing an empty payload would take the About, ` +
        `feature and pricing blocks off every generated landing page while every byte comparison ` +
        `downstream went on agreeing.`,
    );
    return nothing;
  }

  const catalogueRead = readNoBom(cataloguePath);
  if (catalogueRead.bom) {
    problems.push(
      `${CATALOGUE} starts with a UTF-8 BOM. JSON.parse throws on it, so the catalogue is unreadable to ` +
        `every consumer; rewrite it without one (a Node write, or a bash heredoc — never PowerShell's ` +
        `Out-File -Encoding utf8, which is where this repository's BOMs have come from).`,
    );
    return nothing;
  }

  let catalogue;
  try {
    catalogue = JSON.parse(catalogueRead.text);
  } catch (err) {
    problems.push(`${CATALOGUE} is not valid JSON: ${err.message}`);
    return nothing;
  }
  if (!Array.isArray(catalogue)) {
    problems.push(`${CATALOGUE} must be a JSON array of app rows; found ${typeof catalogue}.`);
    return nothing;
  }
  if (catalogue.length === 0) {
    problems.push(
      `${CATALOGUE} contains zero rows. Refusing to write an empty ${PAYLOAD}: a consumer that vendored ` +
        `it would render every landing page with no About, no features and no prices, and nothing would fail.`,
    );
    return nothing;
  }

  const seen = new Set();
  catalogue.forEach((row, i) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      problems.push(`${CATALOGUE}[${i}] is not an object.`);
      return;
    }
    if (typeof row.slug !== 'string' || row.slug.trim() === '') {
      problems.push(`${CATALOGUE}[${i}] has no non-empty string "slug".`);
      return;
    }
    if (seen.has(row.slug)) problems.push(`${CATALOGUE} lists slug "${row.slug}" more than once.`);
    seen.add(row.slug);
  });
  if (problems.length) return nothing;

  // ── the rail config: PRESENT, or refuse ───────────────────────────────────
  const railPath = join(root, ...RAIL_CONFIG.split('/'));
  if (!existsSync(railPath)) {
    problems.push(
      `${RAIL_CONFIG} does not exist. It is the ONE place a price lives in this repository and this script ` +
        `publishes the projection of it. readRailConfig() answers null for a missing file by design — right ` +
        `for a renderer, wrong for the publisher of the price projection, because the result would be a ` +
        `well-formed payload with no offerings in it and a landing page with no prices on it.`,
    );
    return nothing;
  }
  if (readNoBom(railPath).bom) {
    problems.push(`${RAIL_CONFIG} starts with a UTF-8 BOM; JSON.parse throws on it. Rewrite it without one.`);
    return nothing;
  }

  const rail = readRailConfig(root, problems);
  if (problems.length) return nothing;
  if (rail === null) {
    problems.push(`${RAIL_CONFIG} could not be read as an object.`);
    return nothing;
  }

  // ── project one row per catalogue row ─────────────────────────────────────
  const rows = [];
  for (const app of catalogue) {
    const { features, offerings, paywallEnabled } = commerceFor(rail, app.slug, problems);
    const lede = storeLede(root, app.slug);

    if (lede) {
      const ledePath = join(root, ...lede.source.split('/'));
      if (readNoBom(ledePath).bom) {
        problems.push(
          `${lede.source} starts with a UTF-8 BOM, so its first paragraph would carry an invisible ` +
            `character onto a public page. Rewrite it without one.`,
        );
      }
    } else {
      notes.push(
        `${app.slug} — no store listing under apps/${app.slug}/store/*/long-description.txt, so its row ` +
          `carries no "lede" and its landing page will have no About paragraphs.`,
      );
    }
    if (offerings.length === 0) {
      notes.push(
        `${app.slug} — ${RAIL_CONFIG} declares no offering for it, so its row carries no prices and its ` +
          `landing page will have no Pricing block.`,
      );
    }

    // 🔴 KEY ORDER IS PART OF THE OUTPUT. The payload is compared BYTE-WISE by
    // its drift check and by the storefront's vendor-currency check, so the
    // order is written here once and never left to whichever branch ran last.
    const row = { slug: app.slug };
    if (lede) row.lede = lede.paragraphs;
    if (features.length) row.features = features.map((f) => ({ title: f.title, blurb: f.blurb }));
    // Always present, even when false: `checkoutOpen` selects which of two
    // sentences the renderer prints, and an ABSENT key and `false` must not be
    // the same thing to a consumer that has to choose one.
    row.checkoutOpen = paywallEnabled;
    if (offerings.length) {
      row.currencies = [...new Set(offerings.map((o) => o.code))];
      row.zeroAmount = zero(offerings[0].code);
      row.offerings = offerings.map((o) => ({
        id: o.id,
        amount: o.amount,
        termHeading: o.term.heading,
        termUnit: o.term.unit,
        termRenews: o.term.renews,
        trialDays: o.trialDays,
      }));
    }
    rows.push(row);
  }
  if (problems.length) return nothing;

  const contents = `${JSON.stringify(rows, null, 2)}\n`;
  if (contents.startsWith(BOM)) {
    // Unreachable through JSON.stringify, and asserted anyway: this is the one
    // function that decides what bytes leave the factory.
    problems.push(`refusing to write ${PAYLOAD} with a leading BOM.`);
    return nothing;
  }
  return { contents, rows, notes, problems };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                */

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const positional = argv.find((a) => !a.startsWith('--'));
  const root = resolve(positional ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

  const { contents, rows, notes, problems } = planLandingPayload(root);
  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s) building the landing payload:`);
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }
  for (const n of notes) console.log(`    note ${n}`);

  const target = join(root, ...PAYLOAD.split('/'));
  const currentRaw = existsSync(target) ? readFileSync(target, 'utf8') : null;
  const currentHasBom = currentRaw !== null && currentRaw.startsWith(BOM);
  const current = currentHasBom ? currentRaw.slice(BOM.length) : currentRaw;

  const priced = rows.filter((r) => Array.isArray(r.offerings) && r.offerings.length).length;
  const summary = `${rows.length} row(s), ${priced} priced, ${Buffer.byteLength(contents)} bytes`;

  if (check) {
    if (currentHasBom) {
      console.error(`✗ ${PAYLOAD} starts with a UTF-8 BOM.`);
      console.error(`    JSON.parse throws on a leading BOM, so this payload is unreadable to every consumer`);
      console.error(`    that vendors it. This script never writes one; something else rewrote the file.`);
      console.error(`    Regenerate it:  node tooling/sites/generate-landing-payload.mjs`);
      process.exit(1);
    }
    if (current === contents) {
      console.log(`ok  ${PAYLOAD} matches its sources — ${summary}`);
      process.exit(0);
    }
    console.error(`✗ ${PAYLOAD} has DRIFTED from ${REQUIRED_SOURCES.join(' + ')} + the store listings.`);
    if (current === null) {
      console.error(`    the file does not exist; this script produces it. Run without --check.`);
    } else {
      console.error(
        `    committed: ${Buffer.byteLength(current)} bytes · regenerated: ${Buffer.byteLength(contents)} bytes`,
      );
      const a = current.split('\n');
      const b = contents.split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          console.error(`    first difference at line ${i + 1}:`);
          console.error(`      committed:   ${a[i] === undefined ? '<end of file>' : JSON.stringify(a[i])}`);
          console.error(`      regenerated: ${b[i] === undefined ? '<end of file>' : JSON.stringify(b[i])}`);
          break;
        }
      }
    }
    console.error(`    ${PAYLOAD} is GENERATED. Do not hand-edit it — change the source and re-run:`);
    console.error(`      node tooling/sites/generate-landing-payload.mjs`);
    process.exit(1);
  }

  if (current === contents && !currentHasBom) {
    console.log(`ok  ${PAYLOAD} already current — ${summary}`);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
    console.log(`    wrote ${PAYLOAD} — ${summary}`);
  }
}
