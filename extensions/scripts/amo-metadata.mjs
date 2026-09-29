#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// amo-metadata.mjs — the listing AMO's first submit carries, built from the
// tool's own files and refused while any of them is unfit to send.
//
// ⏱ 2026-09-24 (EXT-3, O-AMO-FIRST-SUBMIT-SENDS-NO-METADATA). `web-ext sign
// --channel listed` creates the listing on a first submit, and until this file
// the lane passed it no `--amo-metadata` at all: AMO then has a version and no
// summary, no categories and no licence, and its own API refuses a listed
// version without them — "To create a listed version from an upload ... certain
// metadata must be defined - a version `license`, an add-on `name`, an add-on
// `summary`, and add-on categories for each app the version is compatible
// with" (PRIMARY_SOURCES.addonsApi, fetched 2026-09-24).
//
// EVERY FIELD IS READ FROM A FILE THE REPOSITORY ALREADY GRADES:
//   name, summary, description, categories, tags  ← store/firefox/*.txt
//                                                    (check-store-metadata.mjs)
//   slug, support_email, homepage                  ← publish/identity.json
//   support_url                                    ← store/_shared/support-url.txt
//   version.custom_license                         ← LICENSE (lib/licence.mjs)
//   version.approval_notes                         ← store/firefox/reviewer-notes.txt
//   version.compatibility                          ← the Firefox overlay (tool.json
//                                                    targets.firefox.overlay): "android"
//                                                    only when it declares gecko_android
// web-ext merges `version.upload` in itself (lib/util/submit-addon.js,
// `doNewAddonSubmit`, in the tooling/web-ext island), so this payload never
// names an upload.
//
// 🔴 IT REFUSES, IT NEVER FILLS IN. A LICENSE whose Required Notice is still a
// placeholder, an empty reviewer note, a category AMO has no slug for: each is
// exit 1 with the reason, because AMO fixes a listing's first shape at the first
// submit and a placeholder sent there is a public listing that says so.
//
// Usage:
//   node extensions/scripts/amo-metadata.mjs --tool <id> --print     the payload, as JSON, on stdout
//   node extensions/scripts/amo-metadata.mjs --tool <id> --out <file>
// Exit 0 = built; 1 = refused (the reason is printed).
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { requiredNotice } from './lib/licence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The extensions root: toolinfo's `repoRoot` default, and what tool dirs are relative to. */
const EXTENSIONS_ROOT = path.resolve(HERE, '..');

export const PRIMARY_SOURCES = Object.freeze({
  addonsApi: 'https://mozilla.github.io/addons-server/topics/api/addons.html',
  categories: 'https://mozilla.github.io/addons-server/topics/api/categories.html',
});

/** The locale every translated field is keyed on. The tool's `default_locale` is
 *  `en`; AMO's translated fields are keyed by AMO locale codes. */
export const AMO_LOCALE = 'en-US';

/**
 * AMO's extension category slugs, by the name the listing file carries. The
 * fifteen extension categories as listed at PRIMARY_SOURCES.categories, fetched
 * 2026-09-24. A category.txt line outside this table is REFUSED: AMO takes
 * `categories.firefox` as an array of these slugs, and a name it does not know
 * fails the submit after the upload has been spent.
 */
export const AMO_CATEGORY_SLUGS = Object.freeze({
  'Alerts & Updates': 'alerts-updates',
  Appearance: 'appearance',
  Bookmarks: 'bookmarks',
  'Download Management': 'download-management',
  'Feeds, News & Blogging': 'feeds-news-blogging',
  'Games & Entertainment': 'games-entertainment',
  'Language Support': 'language-support',
  'Photos, Music & Videos': 'photos-music-videos',
  'Privacy & Security': 'privacy-security',
  'Search Tools': 'search-tools',
  Shopping: 'shopping',
  'Social & Communication': 'social-communication',
  Tabs: 'tabs',
  'Web Development': 'web-development',
  Other: 'other',
});

/** AMO's summary cap, as store/firefox/README.md records it (extensionworkshop). */
const SUMMARY_MAX = 250;

const readIf = (abs) => (fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').replace(/^﻿/, '') : null);
const valueLines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));

/** The tool directory whose tool.json declares `id`, relative to the extensions root. */
function toolDir(root, id) {
  const ext = path.join(root, 'Extension');
  if (!fs.existsSync(ext)) return null;
  for (const d of fs.readdirSync(ext)) {
    const tj = path.join(ext, d, 'tool.json');
    if (!fs.existsSync(tj)) continue;
    try {
      if (JSON.parse(fs.readFileSync(tj, 'utf8')).id === id) return path.join(ext, d);
    } catch {
      /* an unparseable tool.json is another gate's finding; it is not this id */
    }
  }
  return null;
}

/**
 * Build the `--amo-metadata` payload for one tool.
 * @param {{ toolId: string, root?: string }} args  root = the extensions root
 * @returns {{ ok: true, payload: object } | { ok: false, why: string[] }}
 */
export function buildAmoMetadata({ toolId, root = EXTENSIONS_ROOT }) {
  const why = [];
  const dir = toolDir(root, toolId);
  if (dir === null) return { ok: false, why: [`no Extension/*/tool.json under ${root} declares id "${toolId}".`] };
  const rel = (p) => path.relative(root, path.join(dir, p)).split(path.sep).join('/');
  const tool = JSON.parse(fs.readFileSync(path.join(dir, 'tool.json'), 'utf8'));
  const row = tool?.storeMetadata?.stores?.firefox;
  if (typeof row?.dir !== 'string') return { ok: false, why: [`${rel('tool.json')} declares no storeMetadata.stores.firefox.dir.`] };
  const ffDir = row.dir.replace(/\/+$/, '');
  const text = (p, label) => {
    const t = readIf(path.join(dir, p));
    if (t === null || t.trim() === '') {
      why.push(`${rel(p)} is ${t === null ? 'absent' : 'empty'} — it is the listing's ${label}.`);
      return null;
    }
    return t.trim();
  };

  const name = text(`${ffDir}/title.txt`, 'name');
  const summary = text(`${ffDir}/short-description.txt`, 'summary');
  const description = text(`${ffDir}/long-description.txt`, 'description');
  const categoryText = text(`${ffDir}/category.txt`, 'categories');
  const tagsText = readIf(path.join(dir, ffDir, 'tags.txt'));
  const approvalNotes = text(`${ffDir}/reviewer-notes.txt`, 'reviewer notes (version.approval_notes)');
  const licenceText = text('LICENSE', 'licence (version.custom_license)');

  if (summary !== null && [...summary].length > SUMMARY_MAX) {
    why.push(`${rel(`${ffDir}/short-description.txt`)} is ${[...summary].length} characters; AMO's summary takes ${SUMMARY_MAX}.`);
  }
  const categories = [];
  for (const c of categoryText === null ? [] : valueLines(categoryText)) {
    const slug = AMO_CATEGORY_SLUGS[c];
    if (slug === undefined) why.push(`${rel(`${ffDir}/category.txt`)} names "${c}", which is not an AMO extension category (${PRIMARY_SOURCES.categories}).`);
    else categories.push(slug);
  }

  let licenceName = null;
  if (licenceText !== null) {
    const notice = requiredNotice(licenceText);
    if (!notice.ok) why.push(`${rel('LICENSE')} ${notice.why} AMO would publish it as this listing's Custom License.`);
    const heading = licenceText.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => /\bLicen[sc]e\b.*\d/.test(l));
    if (heading === undefined) why.push(`${rel('LICENSE')} has no heading naming the licence and its version, which AMO's custom_license.name needs.`);
    else licenceName = heading;
  }

  /* ⏱ 2026-09-29 (rv2 EXB-11): the apps the listing is offered on, named rather
     than left to AMO's default, and derived from the package: Firefox for Android
     only when the overlay declares gecko_android, which
     publish/verify-firefox-package.node.js allows only for a tool with an Android
     e2e leg. AMO's version create takes "an array of applications, where min/max
     versions from the manifest, or defaults, will be used" (PRIMARY_SOURCES.addonsApi). */
  let compatibility = null;
  const overlayRel = tool?.targets?.firefox?.overlay;
  const overlayText = typeof overlayRel === 'string' ? readIf(path.join(dir, overlayRel)) : null;
  try {
    const bss = overlayText === null ? null : JSON.parse(overlayText).browser_specific_settings;
    if (bss === null || typeof bss !== 'object') why.push(`${rel(String(overlayRel))} carries no browser_specific_settings, so the listing's apps cannot be derived.`);
    else compatibility = 'gecko_android' in bss ? ['firefox', 'android'] : ['firefox'];
  } catch (e) {
    why.push(`${rel(String(overlayRel))} does not parse — ${e.message}`);
  }

  let identity = null;
  const idText = readIf(path.join(dir, 'publish', 'identity.json'));
  try {
    identity = idText === null ? null : JSON.parse(idText);
  } catch (e) {
    why.push(`${rel('publish/identity.json')} does not parse — ${e.message}`);
  }
  if (identity === null && idText === null) why.push(`${rel('publish/identity.json')} is absent — it holds the slug and the support email.`);
  for (const k of ['slug', 'supportEmail']) {
    if (identity !== null && (typeof identity[k] !== 'string' || identity[k].trim() === '' || /[<⟨]/.test(identity[k]))) {
      why.push(`${rel('publish/identity.json')} \`${k}\` is ${JSON.stringify(identity?.[k])}, not a value AMO can take.`);
    }
  }
  const sharedDir = tool?.storeMetadata?.sharedDir;
  const supportUrl = typeof sharedDir === 'string' ? valueLines(readIf(path.join(dir, sharedDir, 'support-url.txt')) ?? '')[0] ?? null : null;

  if (why.length) return { ok: false, why };

  const tr = (v) => ({ [AMO_LOCALE]: v });
  const payload = {
    slug: identity.slug,
    default_locale: AMO_LOCALE,
    name: tr(name),
    summary: tr(summary),
    description: tr(description),
    categories: { firefox: categories },
    ...(tagsText === null ? {} : { tags: valueLines(tagsText) }),
    support_email: tr(identity.supportEmail),
    ...(supportUrl && /^https:\/\//.test(supportUrl) ? { support_url: tr(supportUrl) } : {}),
    ...(typeof identity.homepageUrl === 'string' && /^https:\/\//.test(identity.homepageUrl) ? { homepage: tr(identity.homepageUrl) } : {}),
    version: {
      custom_license: { name: tr(licenceName), text: tr(licenceText) },
      approval_notes: approvalNotes,
      compatibility,
    },
  };
  return { ok: true, payload };
}

/* ⏱ 2026-09-29 (rv2 EXL-12, O-AMO-FIRST-SUBMIT-SENDS-NO-SCREENSHOTS-OR-POLICY):
   the two things the payload above cannot carry, because AMO takes neither on
   the add-on create. "Image files cannot be uploaded as JSON" — a preview is a
   multipart POST to …/addon/<id>/previews/, one per image — and the privacy
   policy is the TEXT of a translated field PATCHed to …/addon/<id>/eula_policy/
   (PRIMARY_SOURCES.addonsApi, fetched 2026-09-29). publish-amo.mjs sends both
   after the sign; this builds them from files the repository grades:
     previews        ← store/_shared/screenshots/*.png (check-listing-assets.mjs)
     privacy_policy  ← publish/PRIVACY-POLICY.html, the policy's SOURCE, as text,
                       closed by the served URL (store/_shared/privacy-policy-url.txt,
                       held equal to publish/identity.json by check-store-metadata.mjs)
   Refused, never filled in: no screenshot, no policy source, or a URL that is not
   https, is exit 1 — a public listing without them is the defect. */

/** The policy page as plain text: headings, paragraphs and list items as lines,
 *  tags gone, the few entities the page uses decoded. AMO renders this field as
 *  text; markup sent into it is shown as markup. */
export function policyText(html) {
  const body = (/<body[^>]*>([\s\S]*?)<\/body>/i.exec(html) || [null, html])[1]
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const text = body
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(h[1-6]|p|li|ul|ol|div|table|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return text.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The previews and the privacy-policy text the first submit's listing needs.
 * @param {{ toolId: string, root?: string }} args  root = the extensions root
 * @returns {{ ok: true, previews: string[], privacyPolicy: object, policyUrl: string } | { ok: false, why: string[] }}
 */
export function buildAmoListingAssets({ toolId, root = EXTENSIONS_ROOT }) {
  const dir = toolDir(root, toolId);
  if (dir === null) return { ok: false, why: [`no Extension/*/tool.json under ${root} declares id "${toolId}".`] };
  const rel = (p) => path.relative(root, path.join(dir, p)).split(path.sep).join('/');
  const tool = JSON.parse(fs.readFileSync(path.join(dir, 'tool.json'), 'utf8'));
  const sharedDir = tool?.storeMetadata?.sharedDir;
  if (typeof sharedDir !== 'string') return { ok: false, why: [`${rel('tool.json')} declares no storeMetadata.sharedDir.`] };
  const why = [];
  const shotsRel = `${sharedDir}/screenshots`;
  const shotsAbs = path.join(dir, shotsRel);
  const previews = fs.existsSync(shotsAbs)
    ? fs.readdirSync(shotsAbs).filter((f) => /\.png$/i.test(f)).sort().map((f) => path.join(shotsAbs, f))
    : [];
  if (!previews.length) why.push(`${rel(shotsRel)} holds no .png — the listing would go public with no screenshots.`);
  const policyUrl = valueLines(readIf(path.join(dir, sharedDir, 'privacy-policy-url.txt')) ?? '')[0] ?? null;
  if (!policyUrl || !/^https:\/\//.test(policyUrl)) why.push(`${rel(`${sharedDir}/privacy-policy-url.txt`)} names no https URL (${JSON.stringify(policyUrl)}).`);
  const html = readIf(path.join(dir, 'publish', 'PRIVACY-POLICY.html'));
  const text = html === null ? '' : policyText(html);
  if (html === null) why.push(`${rel('publish/PRIVACY-POLICY.html')} is absent — it is the policy's source.`);
  else if (text.length < 200 || /[<⟨]\s*(TODO|FILL|REPLACE)/i.test(text)) why.push(`${rel('publish/PRIVACY-POLICY.html')} renders to ${text.length} characters of text, or carries a placeholder — not a policy AMO can publish.`);
  if (why.length) return { ok: false, why };
  return {
    ok: true,
    previews,
    policyUrl,
    privacyPolicy: { [AMO_LOCALE]: `${text}\n\nThis policy is also published at ${policyUrl}` },
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const opt = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const toolId = opt('tool');
  const out = opt('out');
  if (toolId === null || (out === null && !argv.includes('--print'))) {
    console.error('usage: node extensions/scripts/amo-metadata.mjs --tool <id> (--print | --out <file>) [--repo-root <extensions dir>]');
    process.exit(1);
  }
  // `--repo-root` is the extensions directory, as it is for every scripts/ gate (lib/toolinfo.mjs).
  const r = buildAmoMetadata({ toolId, ...(opt('repo-root') === null ? {} : { root: path.resolve(opt('repo-root')) }) });
  if (!r.ok) {
    for (const l of r.why) console.error(`FAIL ${l}`);
    console.error('\namo-metadata: REFUSED — nothing to send to addons.mozilla.org until every line above is fixed.');
    process.exit(1);
  }
  const json = `${JSON.stringify(r.payload, null, 2)}\n`;
  if (out !== null) {
    fs.writeFileSync(out, json);
    console.error(`amo-metadata: wrote ${out} — fields ${Object.keys(r.payload).join(', ')}; version.${Object.keys(r.payload.version).join(', version.')}`);
  }
  if (argv.includes('--print')) process.stdout.write(json);
}
