/* SKELETON — the guard that stops a packaging script dropping _locales.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED (a .mjs under _locales/, excluded by the
   packaging allowlist and by the packaging never-list). It makes no network
   calls and has no dependencies.

   WHY THIS FILE EXISTS

   The reference implementation ships _locales/en/messages.json and packages it
   into exactly zero of its store zips, because its packaging allowlist is
   ['.', 'content', 'icons', 'pages', 'popup'] and nobody noticed the omission.
   Worse, its COMPLIANCE-CHECKLIST records "no '_*' paths in the zip" as a
   PASSING check — so the omission is certified, and the next maintainer who
   fixes the packaging script will be told by the documentation that they broke
   it.

   Silently dropping a directory is invisible in every other tier: the node sim
   reads the tree, the browser smoke test loads the tree, and the zip is the
   only place the directory is missing. The failure only appears at upload, and
   it is not a degradation — once `default_locale` is set, Chrome REFUSES to
   load an extension whose default catalogue is absent ("Catalog file is missing
   for locale") and rejects the upload outright.

   So the rule is not "remember to include _locales". The rule is that the
   packaging script cannot finish without calling this, and this throws.

   HOW TO USE IT, from publish/package.node.js (or any packaging script):

       import { assertLocalesInPackage } from '../_locales/package-guard.mjs';
       ...
       // entries = every path inside the zip, read back FROM the written zip,
       // forward-slashed, relative to the zip root.
       assertLocalesInPackage(entries, { root: EXTENSION_ROOT });

   Read the entries BACK OUT of the finished archive, never from the list you
   intended to write. The whole class of bug this guards against is "the list
   and the archive disagreed".
*/
'use strict';

import fs from 'node:fs';
import path from 'node:path';

const MESSAGES = 'messages.json';

function readManifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
}

/* Every locale directory that exists on disk. */
function localesOnDisk(root) {
  const dir = path.join(root, '_locales');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names
    .filter(n => { try { return fs.statSync(path.join(dir, n)).isDirectory(); } catch (_) { return false; } })
    .filter(n => { try { fs.accessSync(path.join(dir, n, MESSAGES)); return true; } catch (_) { return false; } })
    .sort();
}

/* Every __MSG_key__ reference anywhere in the manifest, at any depth. */
export function manifestMessageKeys(manifest) {
  const out = new Set();
  (function walk(v) {
    if (typeof v === 'string') {
      const re = /__MSG_([A-Za-z0-9_@]+)__/g;
      let m;
      while ((m = re.exec(v))) out.add(m[1]);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k]); }
  })(manifest);
  return out;
}

/* THE GUARD.

   `entries` is the list of paths inside the package, read back from the written
   archive. `opts.root` is the extension folder those paths were built from.

   Throws on the first violation, with a message that names the file. It never
   warns and never returns a "mostly fine" — a package that cannot load is not a
   partial success. */
export function assertLocalesInPackage(entries, opts) {
  const root = (opts && opts.root) || process.cwd();
  const list = Array.from(entries || []).map(e => String(e).replace(/\\/g, '/').replace(/^\.\//, ''));
  const have = new Set(list);
  const manifest = readManifest(root);
  const dflt = manifest.default_locale;
  const onDisk = localesOnDisk(root);

  /* 1. manifest.json must be at the ROOT of the archive. A zip made by
        right-clicking the folder in Windows Explorer nests everything under
        My_Tool/, and the store rejects it with "Manifest file is missing or
        unreadable" — the single most common first-upload failure. Checked here
        because a nested archive also nests _locales, which is the same bug
        wearing a different hat. */
  if (!have.has('manifest.json')) {
    throw new Error('PACKAGE: manifest.json is not at the root of the archive. ' +
      'Entries begin: ' + list.slice(0, 3).join(', ') + '. ' +
      'Zip the CONTENTS of the extension folder, not the folder itself.');
  }

  /* 2. default_locale and _locales/ imply each other, in both directions. */
  if (dflt && onDisk.length === 0) {
    throw new Error('PACKAGE: manifest declares "default_locale": "' + dflt +
      '" but there is no _locales/ directory on disk. Chrome refuses to load this.');
  }
  if (!dflt && onDisk.length > 0) {
    throw new Error('PACKAGE: _locales/ exists on disk (' + onDisk.join(', ') +
      ') but the manifest declares no "default_locale". Every __MSG_ reference would render literally.');
  }
  if (!dflt) return { locales: 0, keys: 0 };   // a tool with no i18n at all: nothing to guard

  /* 3. THE ONE THIS FILE IS NAMED AFTER: the default catalogue must be IN the
        archive. This is the assertion the reference implementation does not
        have, and the reason its _locales has never shipped. */
  const defaultEntry = '_locales/' + dflt + '/' + MESSAGES;
  if (!have.has(defaultEntry)) {
    throw new Error('PACKAGE: "default_locale" is "' + dflt + '" but ' + defaultEntry +
      ' is NOT in the archive. Chrome rejects this at upload with "Catalog file is missing for locale". ' +
      'Add {dir:"_locales", recursive:true, exts:[".json"]} to the packaging allowlist.');
  }

  /* 4. Every locale on disk is in the archive. An allowlist that catches the
        default locale but drops the other 54 ships an extension that is English
        for everyone, which no test tier can see. */
  const missing = onDisk.filter(l => !have.has('_locales/' + l + '/' + MESSAGES));
  if (missing.length) {
    throw new Error('PACKAGE: ' + missing.length + ' of ' + onDisk.length +
      ' locale catalogues are on disk but not in the archive: ' + missing.slice(0, 8).join(', ') +
      (missing.length > 8 ? ', …' : ''));
  }

  /* 5. Nothing in the archive claims to be a locale that is not one. */
  const packagedLocales = list
    .filter(p => p.startsWith('_locales/'))
    .map(p => p.split('/')[1]);
  const strays = list.filter(p => p.startsWith('_locales/') && !/^_locales\/[A-Za-z0-9_]+\/messages\.json$/.test(p));
  if (strays.length) {
    throw new Error('PACKAGE: _locales/ carries ' + strays.length + ' entr' + (strays.length === 1 ? 'y' : 'ies') +
      ' that are not a locale catalogue: ' + strays.slice(0, 5).join(', ') +
      '. The generator and this guard are build-time .mjs files and must not ship.');
  }

  /* 6. Every __MSG_ reference in the PACKAGED manifest resolves in the PACKAGED
        default catalogue. A renamed key is otherwise a literal "__MSG_appName__"
        in the store listing. */
  const keys = manifestMessageKeys(manifest);
  let catalogue;
  try { catalogue = JSON.parse(fs.readFileSync(path.join(root, '_locales', dflt, MESSAGES), 'utf8')); }
  catch (e) { throw new Error('PACKAGE: the default catalogue does not parse: ' + e.message); }
  const unresolved = Array.from(keys).filter(k => !Object.prototype.hasOwnProperty.call(catalogue, k));
  if (unresolved.length) {
    throw new Error('PACKAGE: the manifest references ' + unresolved.length +
      ' message key(s) that are not in _locales/' + dflt + '/' + MESSAGES + ': ' + unresolved.join(', '));
  }

  return { locales: new Set(packagedLocales).size, keys: keys.size, defaultLocale: dflt };
}

export default assertLocalesInPackage;
