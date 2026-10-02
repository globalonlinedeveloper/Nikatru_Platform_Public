#!/usr/bin/env node
// assert-bundle-locales.mjs — THE LOCALES AN APP SHIPS ARE THE LOCALES IT DECLARES.
//
// ⏱ 2026-10-01 · C-18 / C-20 of the full review (train P38), and the gap it
// closes was measured, not supposed. The app shipped `en` and `ta` (421 keys
// each) while every surface OUTSIDE Dart said English only:
//   · the MSIX manifest declared `languages: en-us`;
//   · the iOS and macOS projects carried `knownRegions = ( en, Base, )` and no
//     `CFBundleLocalizations`, so iOS lists the app under English alone;
//   · Android had no `android:localeConfig`, so the Android 13+ per-app language
//     picker never offered Tamil;
//   · and every one of the 72 store text files was English, with nothing saying
//     whether that was a decision or an omission.
// A Tamil translation the OS cannot select is a translation nobody reaches.
//
// ── WHAT THE ARB SET IS ─────────────────────────────────────────────────────
// The ONE source: the `.arb` files gen-l10n reads, found through the app's own
// `l10n.yaml` (`arb-dir` + `template-arb-file`), never a list typed here. A
// locale is `<prefix>_<locale>.arb`, the prefix being the template's. Adding
// `app_hi.arb` therefore makes every limb below demand Hindi in the same edit.
//
// ── FOUR LIMBS, PER APP IN THE WORKSPACE APP SET ────────────────────────────
//   A · BUNDLES. Each native target that EXISTS declares exactly the ARB set:
//       windows `msix_config.languages`, ios/macos `CFBundleLocalizations` AND
//       the project's `knownRegions` (plus `Base`), android
//       `android:localeConfig` → `res/xml/<name>.xml`. A declared tag matches an
//       ARB locale when it IS that locale or extends it with a region
//       (`en-us` ⊇ `en`), because MSIX requires the region and gen-l10n does not.
//       A target directory that is absent is a PRINT, not a pass: the brick
//       stamps no native trees, and a stamped app grows them later.
//   B · LISTINGS. Every store channel (`store/<channel>/title.txt`) carries a
//       listing in every ARB locale: the flat directory is the TEMPLATE locale,
//       and `store/<channel>/<locale>/title.txt` is that locale's. A missing one
//       must carry a DATED exemption in `store/listing-locales.json` naming the
//       owner row that gates it. Exemptions PRINT on every run and never fail —
//       the house rule for an owner-gated on-switch — but an exemption for a
//       listing that now exists, for a channel or locale that does not, or with
//       no date or row is a finding: a stale waiver reads like a live one.
//   C · THE LAUNCHER LABEL. `android:label` and `CFBundleDisplayName` are an
//       untranslated literal in every locale, so each must be either localised
//       (an `@string/` reference with a `values-<locale>` entry per ARB locale)
//       or the BRAND — app.yaml `shortName`, which tooling/app-yaml/render.mjs
//       renders. The brand exemption holds only while the app's own ARBs treat
//       its name as a brand: every locale's `appTitle` equal to the template's.
//       The day a translator localises `appTitle`, the launcher label is copy,
//       and this limb says so.
//   D · COVERAGE. Zero apps, zero ARBs, or zero targets checked across the whole
//       set is COVERAGE LOST (exit 2), never a clean zero.
//
// Exit codes (AGENTS.md): 0 green · 1 a finding · 2 COVERAGE LOST.
//
// Run:  node tooling/ci/assert-bundle-locales.mjs [repo-root]
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { appSet } from './app-set.mjs';
import { parseYaml } from '../app-yaml/yaml.mjs';

/** The exemption register's name, beside the channel directories it governs. */
export const EXEMPTIONS_FILE = 'listing-locales.json';
const ROW_SHAPE = /^O-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const readIf = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
/** `pt_BR` / `pt-br` → `pt-br`: one comparable form for every surface. */
export const normTag = (t) => String(t).trim().replace(/_/g, '-').toLowerCase();
/** A declared tag covers an ARB locale when it is that locale, or that locale plus subtags. */
export const covers = (declared, arbLocale) => {
  const d = normTag(declared);
  const a = normTag(arbLocale);
  return d === a || d.startsWith(`${a}-`);
};

/** The l10n.yaml fields the ARB set is derived from; null fields are reported, never guessed. */
function l10nOf(appAbs) {
  const text = readIf(join(appAbs, 'l10n.yaml'));
  if (text === null) return null;
  const field = (name) => text.match(new RegExp(`^${name}:[ \\t]*([^\\s#]+)[ \\t]*$`, 'm'))?.[1] ?? null;
  return { arbDir: field('arb-dir'), templateArb: field('template-arb-file') };
}

/**
 * `{ locales, template, arbs }` or `{ lost }`. `arbs` maps locale → parsed arb, read
 * here once for limb C's `appTitle` comparison.
 */
export function arbSetOf(appAbs, appRel) {
  const cfg = l10nOf(appAbs);
  if (cfg === null) return { lost: `${appRel}/l10n.yaml does not exist, so the app's locale set cannot be derived from what gen-l10n reads.` };
  if (!cfg.arbDir || !cfg.templateArb) {
    return { lost: `${appRel}/l10n.yaml declares no \`arb-dir\` or \`template-arb-file\`, so the locale set cannot be derived from it.` };
  }
  const m = cfg.templateArb.match(/^(.+?)_([A-Za-z]{2,3}(?:_[A-Za-z0-9]+)*)\.arb$/);
  if (!m) return { lost: `${appRel}/l10n.yaml's template \`${cfg.templateArb}\` is not \`<prefix>_<locale>.arb\`, so no other locale's file can be recognised beside it.` };
  const [, prefix, template] = m;
  const dirAbs = join(appAbs, cfg.arbDir);
  if (!isDir(dirAbs)) return { lost: `${appRel}/${cfg.arbDir} (its l10n.yaml \`arb-dir\`) does not exist.` };
  const shape = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_([A-Za-z]{2,3}(?:_[A-Za-z0-9]+)*)\\.arb$`);
  const arbs = new Map();
  for (const name of listDir(dirAbs)) {
    const hit = String(name).match(shape);
    if (!hit) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(join(dirAbs, String(name)), 'utf8'));
    } catch {
      parsed = null; // reported by limb C only if it needs the value; gen-l10n refuses it anyway
    }
    arbs.set(hit[1], parsed);
  }
  if (!arbs.has(template)) return { lost: `${appRel}/${cfg.arbDir}/${cfg.templateArb} (the template arb) does not exist.` };
  return { locales: [...arbs.keys()].sort(), template, arbs };
}

/** Compare one surface's declared tags to the ARB set: missing and extra, both directions. */
function compare(surface, declared, locales, { allow = [] } = {}) {
  const out = [];
  const missing = locales.filter((l) => !declared.some((d) => covers(d, l)));
  const extra = declared.filter((d) => !allow.includes(d) && !locales.some((l) => covers(d, l)));
  if (missing.length) out.push(`${surface} does not declare ${missing.join(', ')} (it declares ${declared.join(', ') || 'nothing'}), so the OS never offers a locale the app ships.`);
  if (extra.length) out.push(`${surface} declares ${extra.join(', ')}, which no arb provides, so the OS offers a locale the app would render in its template language.`);
  return out;
}

/** XML with its comments removed, by a scan rather than a regex replace (CodeQL
 *  #569, js/incomplete-multi-character-sanitization): an unterminated comment drops
 *  the rest, as an XML reader would, and nothing is ever re-joined into a `<!--`. */
const stripXmlComments = (s) => {
  let out = '';
  let i = 0;
  for (;;) {
    const open = s.indexOf('<!--', i);
    if (open === -1) return out + s.slice(i);
    out += s.slice(i, open);
    const close = s.indexOf('-->', open + 4);
    if (close === -1) return out;
    i = close + 3;
  }
};
const plistString = (plist, key) =>
  stripXmlComments(plist).match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1] ?? null;
const plistArray = (plist, key) => {
  const m = stripXmlComments(plist).match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
  return m ? [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1].trim()) : null;
};
const knownRegions = (pbxproj) => {
  const m = pbxproj.match(/knownRegions\s*=\s*\(([^)]*)\)/);
  return m ? m[1].split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean) : null;
};
/** The `<application …>` start tag of a manifest, comments removed. */
const applicationTag = (manifest) => stripXmlComments(manifest).match(/<application\b[^>]*>/)?.[0] ?? null;
const attr = (tag, name) => tag.match(new RegExp(`\\b${name.replace(':', '\\:')}\\s*=\\s*"([^"]*)"`))?.[1] ?? null;
/** `languages:` from the pubspec's `msix_config:` block, comment-stripped; null when absent. */
function msixLanguages(pubspec) {
  const lines = pubspec.split('\n');
  const at = lines.findIndex((l) => /^msix_config:\s*$/.test(l));
  if (at === -1) return { block: false };
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = l.replace(/\s#.*$/, '').match(/^\s+languages:\s*(.+?)\s*$/);
    if (m) return { block: true, tags: m[1].replace(/^["']|["']$/g, '').split(',').map((t) => t.trim()).filter(Boolean) };
  }
  return { block: true, tags: null };
}

/**
 * The whole judgement, pure over a repo root. `today` is injectable so the
 * exemption-date check has a deterministic input in the suite.
 */
export function gradeBundleLocales(root, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const problems = [];
  const lost = [];
  const notes = [];
  const apps = appSet(root);
  if (apps === null) return { problems, lost: [`${join(root, 'pubspec.yaml')} has no readable \`workspace:\` block, so there is no app set to grade.`], notes, checked: 0, graded: [] };
  if (apps.length === 0) return { problems, lost: [`${join(root, 'pubspec.yaml')} declares no \`workspace:\` entry under apps/.`], notes, checked: 0, graded: [] };

  let checked = 0; // bundle surfaces + listing channels + labels actually compared
  const graded = [];
  for (const { id, dir } of apps) {
    const appAbs = join(root, dir);
    const set = arbSetOf(appAbs, dir);
    if (set.lost) {
      lost.push(set.lost);
      continue;
    }
    const { locales, template, arbs } = set;
    graded.push(`${id} [${locales.join(', ')}]`);

    // ── A · BUNDLES ─────────────────────────────────────────────────────────
    const pubspec = readIf(join(appAbs, 'pubspec.yaml'));
    if (isDir(join(appAbs, 'windows'))) {
      const msix = pubspec === null ? { block: false } : msixLanguages(pubspec);
      if (!msix.block) notes.push(`⬜ ${dir}: windows/ exists and pubspec.yaml has no \`msix_config:\` block — no MSIX language list to compare (assert-store-metadata owns whether it should have one).`);
      else if (msix.tags === null) problems.push(`${dir}/pubspec.yaml \`msix_config:\` declares no \`languages:\`, so \`msix\` packages its default and the Store lists one language whatever the app ships. Declare ${locales.join(', ')} (with regions, e.g. en-us).`);
      else {
        checked++;
        problems.push(...compare(`${dir}/pubspec.yaml msix_config.languages`, msix.tags, locales));
        for (const t of msix.tags) {
          if (!/^[a-z]{2,3}-[a-z0-9]{2,8}$/i.test(t)) problems.push(`${dir}/pubspec.yaml msix_config.languages carries "${t}", which is not language-REGION; the MSIX manifest's Resource Language wants both.`);
        }
      }
    } else notes.push(`⬜ ${dir}: no windows/ tree, so no MSIX language list was compared.`);

    for (const os of ['ios', 'macos']) {
      if (!isDir(join(appAbs, os))) {
        notes.push(`⬜ ${dir}: no ${os}/ tree, so no ${os} bundle locales were compared.`);
        continue;
      }
      const plistRel = `${dir}/${os}/Runner/Info.plist`;
      const plist = readIf(join(root, plistRel));
      if (plist === null) lost.push(`${plistRel} does not exist although ${dir}/${os}/ does, so its bundle locales could not be read.`);
      else {
        const declared = plistArray(plist, 'CFBundleLocalizations');
        if (declared === null) problems.push(`${plistRel} declares no \`CFBundleLocalizations\`, so ${os === 'ios' ? 'iOS' : 'macOS'} lists the app under its development region alone. Declare ${locales.join(', ')}.`);
        else {
          checked++;
          problems.push(...compare(`${plistRel} CFBundleLocalizations`, declared, locales));
        }
      }
      const pbxRel = `${dir}/${os}/Runner.xcodeproj/project.pbxproj`;
      const pbx = readIf(join(root, pbxRel));
      if (pbx === null) lost.push(`${pbxRel} does not exist although ${dir}/${os}/ does, so its known regions could not be read.`);
      else {
        const regions = knownRegions(pbx);
        if (regions === null) lost.push(`${pbxRel} has no \`knownRegions = ( … )\` list this guard can read.`);
        else {
          checked++;
          problems.push(...compare(`${pbxRel} knownRegions`, regions, locales, { allow: ['Base'] }));
        }
      }
    }

    const manifestRel = `${dir}/android/app/src/main/AndroidManifest.xml`;
    let appTag = null;
    if (isDir(join(appAbs, 'android'))) {
      const manifest = readIf(join(root, manifestRel));
      appTag = manifest === null ? null : applicationTag(manifest);
      if (appTag === null) lost.push(`${manifestRel} is missing or has no <application> element, so no Android locale config could be read.`);
      else {
        const ref = attr(appTag, 'android:localeConfig');
        const m = ref?.match(/^@xml\/([A-Za-z0-9_]+)$/);
        if (!m) problems.push(`${manifestRel} <application> declares no \`android:localeConfig="@xml/…"\`, so the Android 13+ per-app language picker never offers ${locales.filter((l) => l !== template).join(', ') || 'any other locale'}.`);
        else {
          const xmlRel = `${dir}/android/app/src/main/res/xml/${m[1]}.xml`;
          const xml = readIf(join(root, xmlRel));
          if (xml === null) problems.push(`${manifestRel} points android:localeConfig at @xml/${m[1]}, and ${xmlRel} does not exist — aapt2 fails the build on a dangling resource.`);
          else {
            checked++;
            const declared = [...stripXmlComments(xml).matchAll(/<locale\b[^>]*\bandroid:name\s*=\s*"([^"]*)"/g)].map((x) => x[1]);
            problems.push(...compare(xmlRel, declared, locales));
          }
        }
      }
    } else notes.push(`⬜ ${dir}: no android/ tree, so no Android locale config was compared.`);

    // ── B · LISTINGS ────────────────────────────────────────────────────────
    const storeAbs = join(appAbs, 'store');
    const channels = isDir(storeAbs)
      ? listDir(storeAbs, { withFileTypes: true })
          .filter((de) => de.isDirectory() && existsSync(join(storeAbs, de.name, 'title.txt')))
          .map((de) => de.name)
          .sort()
      : [];
    const regRel = `${dir}/store/${EXEMPTIONS_FILE}`;
    let exemptions = [];
    const regText = readIf(join(root, regRel));
    if (regText !== null) {
      try {
        const doc = JSON.parse(regText);
        if (!Array.isArray(doc?.exemptions)) problems.push(`${regRel} has no \`exemptions\` array.`);
        else exemptions = doc.exemptions;
      } catch (e) {
        problems.push(`${regRel} is not valid JSON (${e.message}), so every exemption in it was unreadable.`);
      }
    }
    if (channels.length === 0) notes.push(`⬜ ${dir}: no store/<channel>/title.txt, so no listing locales were compared.`);
    for (const ch of channels) {
      checked++;
      for (const loc of locales) {
        if (loc === template) continue; // the flat directory IS the template listing
        const has = existsSync(join(storeAbs, ch, loc, 'title.txt'));
        const ex = exemptions.find((e) => e?.channel === ch && e?.locale === loc);
        if (has && ex) {
          problems.push(`${regRel} exempts ${ch}/${loc} and ${dir}/store/${ch}/${loc}/title.txt EXISTS. The waiver is stale — delete it in the same change that added the listing.`);
        } else if (!has && !ex) {
          problems.push(`${dir}/store/${ch} has no ${loc} listing (${ch}/${loc}/title.txt) and ${regRel} carries no dated exemption for it. The app ships ${loc}; either add the listing or record why it waits, with the owner row that gates it.`);
        } else if (ex) {
          notes.push(`👤 OWNER ${dir}/store/${ch}: no ${loc} listing, exempt since ${ex.since} pending ${ex.row} — ${ex.why ?? '(no reason recorded)'}`);
        }
      }
    }
    for (const e of exemptions) {
      const label = `${regRel} exemption ${JSON.stringify({ channel: e?.channel, locale: e?.locale })}`;
      if (!channels.includes(e?.channel)) problems.push(`${label} names a channel with no listing under ${dir}/store/, so it exempts nothing.`);
      else if (!locales.includes(e?.locale) || e?.locale === template) problems.push(`${label} names a locale that is not a non-template arb locale of ${id} (${locales.join(', ')}), so it exempts nothing.`);
      if (typeof e?.since !== 'string' || !DATE_SHAPE.test(e.since) || Number.isNaN(Date.parse(e.since))) problems.push(`${label} carries no \`since\` date (YYYY-MM-DD). An undated waiver cannot be aged, so nobody can tell a decision from a leftover.`);
      else if (e.since > today) problems.push(`${label} is dated ${e.since}, after today (${today}).`);
      if (typeof e?.row !== 'string' || !ROW_SHAPE.test(e.row)) problems.push(`${label} names no owner row (\`O-…\`). A waiver must say what lifts it.`);
      if (typeof e?.why !== 'string' || e.why.trim() === '') problems.push(`${label} carries no \`why\`.`);
    }
    const dupes = exemptions.filter((e, i) => exemptions.findIndex((f) => f?.channel === e?.channel && f?.locale === e?.locale) !== i);
    for (const d of dupes) problems.push(`${regRel} exempts ${d?.channel}/${d?.locale} twice.`);

    // ── C · THE LAUNCHER LABEL ──────────────────────────────────────────────
    let shortName = null;
    try {
      const doc = parseYaml(readFileSync(join(appAbs, 'app.yaml'), 'utf8'));
      shortName = typeof doc?.shortName === 'string' ? doc.shortName : null;
    } catch {
      shortName = null;
    }
    const templateTitle = arbs.get(template)?.appTitle;
    const translatedTitle = locales.filter((l) => l !== template && arbs.get(l)?.appTitle !== templateTitle);
    const labels = [];
    if (appTag !== null) labels.push({ surface: `${manifestRel} android:label`, value: attr(appTag, 'android:label'), os: 'android' });
    for (const os of ['ios', 'macos']) {
      const rel = `${dir}/${os}/Runner/Info.plist`;
      const plist = readIf(join(root, rel));
      if (plist !== null) labels.push({ surface: `${rel} CFBundleDisplayName`, value: plistString(plist, 'CFBundleDisplayName'), os });
    }
    for (const { surface, value, os } of labels) {
      if (value === null) continue; // absent: the OS falls back to the bundle name; render.mjs owns presence
      checked++;
      const ref = value.match(/^@string\/([A-Za-z0-9_]+)$/);
      if (ref && os === 'android') {
        for (const loc of locales) {
          const vdir = loc === template ? 'values' : `values-${loc.replace(/_/g, '-r')}`;
          const strings = readIf(join(appAbs, 'android/app/src/main/res', vdir, 'strings.xml'));
          if (strings === null || !new RegExp(`<string\\s+name="${ref[1]}"`).test(strings)) {
            problems.push(`${surface} is localised as @string/${ref[1]} and res/${vdir}/strings.xml does not define it, so ${loc} shows the default.`);
          }
        }
        continue;
      }
      if (shortName === null || value !== shortName) {
        problems.push(`${surface} is "${value}", an untranslated literal that is not the brand (${dir}/app.yaml shortName: ${shortName ?? 'absent'}). A launcher label is read in every locale; localise it or make it the brand.`);
      } else if (translatedTitle.length) {
        problems.push(`${surface} is the brand "${value}" in every locale, but ${translatedTitle.map((l) => `${l}'s`).join(', ')} appTitle is translated — the app no longer treats its name as a brand, so the launcher label is copy and must be localised for ${translatedTitle.join(', ')}.`);
      }
    }
    if (labels.some((l) => l.value !== null && l.value === shortName) && translatedTitle.length === 0) {
      notes.push(`⬜ ${dir}: the launcher label is the brand "${shortName}" (app.yaml shortName) in every locale — brand-exempt while every arb keeps appTitle "${templateTitle}" untranslated.`);
    }
  }

  if (graded.length > 0 && checked === 0) lost.push('every app was skipped before a single bundle, listing or label was compared.');
  return { problems, lost, notes, checked, graded };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = resolve(process.argv[2] ?? process.cwd());
  const { problems, lost, notes, checked, graded } = gradeBundleLocales(root);
  for (const n of notes) console.log(n);
  if (problems.length) {
    console.error(`\nFAIL ${problems.length} locale declaration problem(s):`);
    for (const p of problems) console.error(`  · ${p}`);
  }
  if (lost.length) {
    console.error('\nFAIL COVERAGE LOST — assert-bundle-locales could not derive what it grades:');
    for (const l of lost) console.error(`  · ${l}`);
  }
  if (problems.length) process.exit(1);
  if (lost.length) coverageLost();
  console.log(`\nassert-bundle-locales: ok — ${checked} surface(s) compared against the arb locales (bundles, listing channels, launcher labels) — every one declares them, is exempt and printed above, or is the brand — across ${graded.length} app(s): ${graded.join(' · ')}`);
}

/** The one COVERAGE LOST stop: exit 2, never 1, which would read as a finding (AGENTS.md
 *  exit-code convention, O-EXIT2-CONVENTION-GAP). A finding outranks it — a run with both
 *  exits 1, so a real defect is never filed as "could not look". */
function coverageLost() {
  process.exit(2);
}
