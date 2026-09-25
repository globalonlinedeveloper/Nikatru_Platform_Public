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
    },
  };
  return { ok: true, payload };
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
