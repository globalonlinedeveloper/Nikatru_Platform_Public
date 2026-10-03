#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// custom-listings.mjs — the DRY RUN for an app's Play custom store listings,
// Apple custom product pages and promotional-text calendar. [lane aso-listings]
//
// Reads apps/<app>/aso/custom-listings.json and apps/<app>/aso/promo-calendar.json
// and prints, per entry, the exact payload it would be created with: the store's
// language code (tooling/store/listing-languages.json, through storeLanguage()),
// each text field, the screenshot set and its CAPTURE.json, the targeting.
//
// IT SENDS NOTHING. It has no network code and no credential: creating a custom
// listing is a console step (a lead step), and publishing one is the owner's
// approval at the publish sitting (ADR 031). So the one thing this tool decides
// is whether a run WOULD publish: an entry with `publish: true`, or a calendar
// entry live today, is a publish, and the run exits 1 unless `--publish` was
// passed — the flag is the record that the owner approved it, not a switch that
// makes anything happen.
//
// Usage: node tooling/store/custom-listings.mjs [--app <id>] [--today YYYY-MM-DD] [--publish] [--json]
// Exit:  0 nothing here would publish (or --publish was passed) · 1 a publish
//        without --publish, or an entry this tool cannot build · 2 COVERAGE LOST
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_ROOT, readJsonOrNull, storeLanguage } from './listing-locales.mjs';

/** Every payload the data describes, and which of them would publish. */
export function buildPayloads(root, app, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const read = (rel) => {
    const abs = join(root, rel);
    return readJsonOrNull(abs);
  };
  const cl = read(`apps/${app}/aso/custom-listings.json`);
  const pc = read(`apps/${app}/aso/promo-calendar.json`);
  if (cl === null || pc === null) return { coverage: `apps/${app}/aso/custom-listings.json and promo-calendar.json must both exist (the app brick emits them).` };
  const payloads = [];
  const problems = [];
  for (const e of cl.listings ?? []) {
    let language = null;
    try {
      language = storeLanguage(e.channel, e.locale, { root });
    } catch (err) {
      problems.push(`${e.id}: ${err.message}`);
    }
    const manifest = e.screenshotSet && existsSync(join(root, e.screenshotSet, 'CAPTURE.json')) ? `${e.screenshotSet}/CAPTURE.json` : null;
    payloads.push({
      kind: e.channel === 'android-play' ? 'play.customStoreListing' : 'appStoreConnect.appCustomProductPage',
      id: e.id,
      channel: e.channel,
      language,
      audience: e.audience,
      targeting: e.targeting ?? null,
      fields: e.fields ?? {},
      screenshots: { set: e.screenshotSet ?? null, manifest: manifest ?? 'PENDING — no CAPTURE.json; the set is not captured' },
      publishes: e.publish === true,
    });
  }
  for (const e of pc.entries ?? []) {
    const live = e.from <= today && today <= e.to;
    for (const ch of e.channels ?? []) {
      for (const [locale, text] of Object.entries(e.text ?? {})) {
        let language = null;
        try {
          language = storeLanguage(ch, locale, { root });
        } catch (err) {
          problems.push(`promo ${e.id}: ${err.message}`);
        }
        payloads.push({ kind: 'appStoreConnect.appStoreVersionLocalization.promotionalText', id: `${e.id}/${ch}/${locale}`, channel: ch, language, window: [e.from, e.to], fields: { promotionalText: text }, publishes: live });
      }
    }
  }
  return { coverage: null, payloads, problems };
}

if (process.argv[1] && process.argv[1].endsWith('custom-listings.mjs')) {
  const argv = process.argv.slice(2);
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : null);
  const app = opt('--app') ?? 'subscriptiontracker';
  const today = opt('--today') ?? new Date().toISOString().slice(0, 10);
  // A typo here (`2026-1015`, `foo`) would compare as a string, find no live entry and exit 0: the publish
  // refusal would switch itself off. So a --today that is not a real YYYY-MM-DD day is COVERAGE LOST.
  const day = new Date(`${today}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== today) {
    console.error(`custom-listings: COVERAGE LOST — --today ${JSON.stringify(today)} is not a real YYYY-MM-DD date.`);
    process.exit(2);
  }
  const PUBLISH = argv.includes('--publish');
  const r = buildPayloads(DEFAULT_ROOT, app, { today });
  if (r.coverage) {
    console.error(`custom-listings: COVERAGE LOST — ${r.coverage}`);
    process.exit(2);
  }
  if (argv.includes('--json')) console.log(JSON.stringify(r.payloads, null, 2));
  else {
    console.log(`custom-listings: DRY RUN for ${app} on ${today} — nothing is sent anywhere; this tool has no network code.`);
    for (const p of r.payloads) {
      console.log(`\n${p.publishes ? '🔴 WOULD PUBLISH' : '→ draft'}  ${p.kind}  ${p.id}`);
      console.log(JSON.stringify(p, null, 2).replace(/^/gm, '    '));
    }
  }
  for (const p of r.problems) console.error(`FAIL ${p}`);
  const publishing = r.payloads.filter((p) => p.publishes);
  if (publishing.length && !PUBLISH) {
    console.error(`\ncustom-listings: REFUSING — ${publishing.length} payload(s) would publish (${publishing.map((p) => p.id).join(', ')}) and --publish was not passed. Publishing is the owner's approval at the publish sitting (ADR 031): set the entry's publish: false, or pass --publish only when that approval is given.`);
    process.exit(1);
  }
  if (r.problems.length) process.exit(1);
  console.log(`\ncustom-listings: OK — ${r.payloads.length} payload(s), ${publishing.length} publishing${PUBLISH ? ' (approved by --publish; still a console step)' : ''}.`);
}
