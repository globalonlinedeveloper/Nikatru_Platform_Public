/* check-store-packages.mjs — grade the BUILT store package, not the source it
   was built from.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/check-store-packages.mjs fullshot
     node scripts/check-store-packages.mjs fullshot --dir dist
     node scripts/check-store-packages.mjs --all

   🔴 WHY THIS EXISTS — the source is right and the artifacts are wrong.

   Measured 2026-08-20 by inflating manifest.json out of each of the twelve zips
   in Extension/Full_Screen_Shot/publish/:

     the six -firefox.zip   gecko.id = fullshot@REPLACE-WITH-YOUR-DOMAIN.example
     the six chromium zips  no browser_specific_settings at all  (correct)
     publish/manifest.firefox.json   gecko.id = fullshot@nikatru.com  (correct)

   Every SOURCE-side gate is green and every one of them is right.
   policy-check.mjs compares the overlay's gecko.id to publish/identity.json and
   passes. pack.mjs refuses to write a package with a placeholder id (:478).
   The overlay was corrected on 2026-08-18 and the id derived from identity.json.
   None of that reaches back into a zip built on 2026-08-12 or 2026-08-15, and
   nothing in this repository had ever opened one to look.

   WHY IT MATTERS MORE THAN AN ORDINARY STALE ARTIFACT

   Mozilla's addons-server documentation: an add-on's guid "cannot be restored
   and will forever be unusable for submission". And the placeholder PASSES AMO
   validation rather than being rejected — it is a syntactically valid id on a
   domain nobody owns. So the failure mode is not a rejected upload that somebody
   retries. It is an accepted upload that permanently binds the add-on to an
   identity we do not control, discovered afterwards, with no way back.

   The hazard is precisely one thing: a human uploading one of these files by
   hand. That is why the subject here is the ARTIFACT and not the source.

   ── ⚠️ WHAT THIS GATE CAN AND CANNOT REACH, STATED UP FRONT ────────────────
   🔴 **THE PACKAGE LIMB CANNOT BITE IN CI, AND SAYING SO IS THE POINT.**
   Extension/Full_Screen_Shot/.gitignore ignores `*.zip`, so no store package is
   tracked and a runner's checkout contains none. On a clean clone this gate
   grades zero packages — and it PRINTS that count on every run rather than
   reporting a silent pass, because "0 packages, all clean" and "12 packages, all
   clean" must never print the same way.

   ⚠️ AND THE TWO .gitignore FILES DISAGREE ABOUT THAT, WHICH IS WHY IT WENT
   UNNOTICED. The ROOT .gitignore says, in as many words, that a recursive glob
   over `publish/` zips is "deliberately NOT ignored" — its own words, "each
   release zip is a golden master". (The glob is not written out here: a `*` and
   a `/` adjacent inside a block comment ends the comment, which is exactly how
   the first draft of this file failed to parse.)
   The nested Extension/Full_Screen_Shot/.gitignore ignores `*.zip` outright as a
   build output. The nested file wins for files beneath it, so the root file's
   stated intent has never taken effect and twelve artifacts sit in a directory
   no gate can see. That contradiction is NOT resolved here — tracking 5.5 MB of
   binaries is a decision, not a fix — but it is now written down somewhere that
   is read.

   So the enforcement surface for the package limb is a developer's machine and
   this command. That is the same shape as the platform repo's local-only
   guards, and it is honest about it in its output.

   ── THE FLOOR IS THE TARGET LIST, WHICH IS NEVER EMPTY ─────────────────────
   A gate whose subject is "the zips that happen to be lying around" reports the
   same thing when there are none and when they are all clean. So the subject is
   the TARGETS a tool declares in tool.json — always at least one — and each is
   reported as graded-from-a-package or as having no package present. Zero
   targets is CANNOT RUN, not a pass.

   ── TARGET IS DECIDED BY CONTENT, NEVER BY FILENAME ────────────────────────
   Two packers write into this tree with two naming schemes — pack.mjs writes
   `<id>-<target>.zip` into --out, publish/package.node.js writes
   `<id>-<version>[-firefox].zip` into publish/. A filename is a claim about
   what a file is; the manifest inside it is the fact. A zip whose manifest
   carries `browser_specific_settings.gecko` IS an AMO package whatever it is
   called, and one that does not is a Chrome/Edge package.

   ── AND A PACKAGE IS ALSO GRADED FOR AGE, WHICH WARNS RATHER THAN FAILS ────
   Every limb here grades the bytes that are on disk; until 2026-08-26 none of
   them asked WHEN those bytes were written, so a build predating a source fix
   was certified 5-PASS and a reader concluded the shipping package contained the
   current code. Each package is now also hashed file-by-file against the set
   packagedFiles() selects — the same function scripts/pack.mjs packs from — and
   a mismatch prints a WARN naming what is newer. It is a WARN because opening an
   artifact built earlier is deliberate and supported; see the limb itself for
   why that is a decision and not timidity.

   Exit codes: 0 everything agrees · 1 something disagrees · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, loadAllTools, readJson, packagedFiles, sha256 } from './lib/toolinfo.mjs';
import { readZipEntry, listZipEntries, ZipUnreadable } from './lib/zip.mjs';

/* The placeholder the first Firefox manifest shipped with. Same test
   verify-firefox-package.node.js and pack.mjs apply, deliberately: an id this
   repository would refuse to BUILD must also be one it refuses to have BUILT. */
const PLACEHOLDER_ID = /REPLACE-WITH-YOUR-DOMAIN|\.example$/i;
/* MDN: email-style id, 80 characters or less. */
const GECKO_ID_RE = /^[a-zA-Z0-9\-._]*@[a-zA-Z0-9\-._]+$/;

/* Where a built package can be found. `publish/` is where
   publish/package.node.js writes; `dist/` is where pack.mjs writes and what
   ci.yml and release.yml pass as --out. Both are searched so the gate does not
   depend on which packer last ran. */
const DEFAULT_DIRS = ['publish', 'dist'];

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['dir', 'all', 'repo-root']);
const root = repoRoot(args);

/* 🔴 `--all` HAD NEVER RUN HERE EITHER, AND IT IS IN THIS FILE'S OWN USAGE LINE.
   FOUND AND FIXED 2026-08-22 by running the documented invocation. This is the
   same bug, in the same shape, that check-store-metadata.mjs fixed earlier the
   same day — its note names this file as the second site and this is that fix.
   loadAllTools returns `{ tools, errors, warnings, byId }` — an OBJECT, with no
   `.length` — so `!tools.length` was `!undefined`, always true, and
   `node scripts/check-store-packages.mjs --all` died with
   "CANNOT RUN — no tool resolved — nothing to grade." on a tree holding one
   perfectly good tool. It exits 2 rather than 0, so it never passed over an
   empty subject; but a documented flag that cannot run is a record of a
   capability that does not exist. `errors` is surfaced rather than dropped, on
   lint.mjs's shape and on the sibling's: a tool.json that will not load must
   not read as a tool that is not there. */
let tools;
if (args.bool('all')) {
  const all = loadAllTools(root);
  if (all.errors.length) {
    die('tool.json problems, so the tool set is not the tree:\n' + all.errors.map((e) => '  - ' + e).join('\n'));
  }
  tools = all.tools;
} else {
  tools = [resolveTool(root, args.positional[0])];
}
if (!tools.length) die('no tool resolved — nothing to grade.');

const searchDirs = args.has('dir') && args.get('dir') !== true ? [String(args.get('dir'))] : DEFAULT_DIRS;

const r = new Report('check-store-packages · ' + tools.map(t => t.id).join(', '));

let targetsGraded = 0;
let packagesGraded = 0;
let packagesUnreadable = 0;

for (const tool of tools) {
  /* ---------------- the identity every AMO package must carry ---------------- */
  const idRel = 'publish/identity.json';
  const idAbs = path.join(tool.dirAbs, idRel);
  let derivedGeckoId = null;
  if (fs.existsSync(idAbs)) {
    const p = readJson(idAbs);
    if (p.error) {
      r.fail(tool.rel + '/' + idRel + ' parses', p.error);
    } else if (p.value && typeof p.value.slug === 'string' && typeof p.value.ownerDomain === 'string' &&
               p.value.slug && p.value.ownerDomain) {
      derivedGeckoId = p.value.slug + '@' + p.value.ownerDomain;
    }
  }

  /* ---------------- the floor: the targets this tool declares ---------------- */
  const targets = (tool.targets && typeof tool.targets === 'object' && !Array.isArray(tool.targets))
    ? Object.keys(tool.targets)
    : [];
  if (!targets.length) {
    die(tool.rel + '/tool.json declares no `targets`, so this gate has no subject for it.\n' +
      'A tool with no target ships to no store, and grading its packages would range over nothing.');
  }

  /* ---------------- find every package, decide what it is by content --------
     🔴 A DIRECTORY NAME IS RESOLVED AGAINST BOTH ROOTS, BECAUSE THE TWO PACKERS
     DISAGREE ABOUT WHICH ROOT IT MEANS. `publish/package.node.js` writes into
     the TOOL's publish/; `pack.mjs --out dist` is invoked from the repository
     root by ci.yml and release.yml and writes `dist/` THERE, which is what
     `verify-refs.mjs --zip dist/<id>-<target>.zip` then reads. Resolving against
     only one of them is how this gate first ran: it reported "no built package
     found" over a directory holding two, and exited 0. A search that misses its
     subject and prints a clean line is the exact failure this file exists for,
     so both roots are searched and an absolute --dir is honoured as given. */
  const found = [];
  const seen = new Set();
  for (const dir of searchDirs) {
    const roots = path.isAbsolute(dir) ? [dir] : [path.join(tool.dirAbs, dir), path.join(root, dir)];
    for (const abs of roots) {
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
      for (const name of fs.readdirSync(abs).filter(n => n.toLowerCase().endsWith('.zip')).sort()) {
        found.push({ rel: path.relative(root, path.join(abs, name)).split(path.sep).join('/'), abs: path.join(abs, name), name });
      }
    }
  }

  /* ---------------- the file set THIS TREE would pack ----------------------
     The ruler the freshness limb below measures each package against. Derived
     once per tool, because it is a property of the tree and not of any zip.

     🔴 IT IS packagedFiles(), THE FUNCTION scripts/pack.mjs ITSELF CALLS
     (pack.mjs:387), NOT A SECOND READING OF package.include/exclude. A private
     copy of those rules here would be the second declaration of what ships and
     therefore the first one to be wrong — and it would be wrong in the
     direction that matters, reporting "fresh" over a file the packer selects
     and this gate does not know about. NOT_A_SCANNER'S RULE, WHICH THIS REPO
     LEARNED EXPENSIVELY: find the existing helper before writing a rival. */
  const pack = packagedFiles(root, tool);

  /* THE LIMB'S OWN COVERAGE SELF-CHECK — AND IT IS A FAIL, WHILE STALENESS
     BELOW IS ONLY A WARN. Those are two different questions and they deserve
     two different volumes. "This package is old" is a fact about an artifact,
     and opening an old artifact on purpose is what `--dir` is for. "I compared
     zero files" is this check NOT RUNNING, and a freshness check that examined
     nothing must never be reachable from the word "fresh" — an empty subject
     that prints clean is the exact defect the whole header above is about.

     Reachable, and therefore testable: any tool.json whose package.include
     patterns have stopped matching, in a tree with no _locales/ to be unioned
     in by the unconditional collector. That is the same rot pack.mjs's FLOOR 1
     refuses to write a zip over, arriving here one build later — the zip it
     refused to overwrite is still on disk, and something has to grade it. */
  if (found.length && pack.files.length === 0) {
    r.fail('the freshness limb has a file set to compare packages against',
      'package.include in ' + tool.rel + '/tool.json selects ZERO files from ' + tool.rel + '/, so there is\n' +
      'nothing to hash a package against and every freshness verdict below would be computed over an\n' +
      'empty set. An empty comparison does not mean "the package matches the tree" — it means this limb\n' +
      'did not run, and it must not be able to say "fresh" from here.\n' +
      'Check the patterns against the tree: paths are relative to ' + tool.rel + '/ and a directory prefix\n' +
      'needs its trailing slash ("pages/" not "pages").');
  }

  const perTarget = new Map(targets.map(t => [t, 0]));

  for (const pkg of found) {
    let raw;
    try {
      raw = readZipEntry(pkg.abs, 'manifest.json');
    } catch (e) {
      if (!(e instanceof ZipUnreadable)) throw e;
      packagesUnreadable++;
      r.fail(pkg.rel + ' is a readable zip', e.message + '\n' +
        'A package this gate cannot open must not be reported as one it graded.');
      continue;
    }
    if (raw === null) {
      packagesUnreadable++;
      r.fail(pkg.rel + ' contains a manifest.json',
        'The archive opened but has no manifest.json entry, so it is not a store package at all —\n' +
        'and nothing about its identity could be read.');
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(raw.toString('utf8'));
    } catch (e) {
      packagesUnreadable++;
      r.fail(pkg.rel + ' manifest.json parses', 'inside the zip: ' + e.message);
      continue;
    }
    packagesGraded++;

    const gecko = ((manifest.browser_specific_settings || {}).gecko) || null;
    const isFirefox = gecko !== null;
    const target = isFirefox ? 'firefox' : 'chromium';
    if (perTarget.has(target)) perTarget.set(target, perTarget.get(target) + 1);

    if (isFirefox) {
      const gid = String(gecko.id || '');
      if (!gid) {
        r.fail(pkg.rel + ' carries a gecko.id',
          'browser_specific_settings.gecko is present with no `id`. AMO requires one to sign an MV3\n' +
          'add-on, and a package without it cannot be submitted.');
      } else if (PLACEHOLDER_ID.test(gid)) {
        r.fail(pkg.rel + ' gecko.id is not the placeholder',
          'the built package carries gecko.id "' + gid + '".\n' +
          'THIS PACKAGE MUST NOT BE UPLOADED TO AMO. The id is a placeholder on a domain nobody owns,\n' +
          'and it PASSES AMO validation rather than being rejected — so the upload would succeed and\n' +
          'bind the add-on to that identity permanently. Mozilla: a guid "cannot be restored and will\n' +
          'forever be unusable for submission".\n' +
          (derivedGeckoId ? 'The source is already correct — ' + tool.rel + '/publish/manifest.firefox.json\n' +
            'and ' + idRel + ' both imply "' + derivedGeckoId + '". This file simply predates that fix.\n' : '') +
          'FIX: delete this stale artifact and rebuild. Nothing reads it, and a package that cannot be\n' +
          'uploaded has no use that its presence beside uploadable ones does not endanger.');
      } else if (!GECKO_ID_RE.test(gid)) {
        r.fail(pkg.rel + " gecko.id matches Mozilla's email-style format",
          'found "' + gid + '", which is not <local>@<domain>.');
      } else if (gid.length > 80) {
        r.fail(pkg.rel + ' gecko.id is 80 characters or less', 'found ' + gid.length + ' characters.');
      } else if (derivedGeckoId && gid !== derivedGeckoId) {
        r.fail(pkg.rel + ' gecko.id agrees with ' + idRel,
          'the package carries "' + gid + '" and ' + idRel + ' implies "' + derivedGeckoId + '".\n' +
          'Both look real, so no placeholder test catches this, and AMO fixes whichever reaches it\n' +
          'FIRST — permanently. The package was built before the identity changed, or from a tree that\n' +
          'is not this one.');
      } else {
        r.pass(pkg.rel + ' gecko.id', gid + (derivedGeckoId ? ' — agrees with ' + idRel : ''));
      }
      if ('update_url' in gecko) {
        r.fail(pkg.rel + ' has no gecko.update_url',
          'a listed AMO add-on must not self-host updates, and this package declares update_url.');
      }
    } else {
      /* The Chrome/Edge package. The same bytes go to both stores, so a
         Firefox-only key here is shipped twice. */

      /* 🔴 A LISTED EXTENSION MUST NOT SELF-HOST ITS UPDATES, AND ONLY THE
         FIREFOX HALF SAID SO. The gecko branch above has refused
         `gecko.update_url` since it was written; the Chromium half had no
         equivalent, so a top-level `update_url` would ship unremarked to BOTH
         Chrome and Edge. An upload carrying it is refused at review, which
         costs a submission slot rather than failing here.
         developer.chrome.com/docs/extensions/reference/manifest/update-url
         (fetched 2026-08-20). */
      if ('update_url' in manifest) {
        r.fail(pkg.rel + ' has no top-level update_url',
          'this is the Chromium package — the identical file goes to Chrome Web Store AND Edge\n' +
          'Add-ons — and it declares update_url, which a store-listed extension must not do.\n' +
          'developer.chrome.com/docs/extensions/reference/manifest/update-url (fetched 2026-08-20).');
      }

      if ('browser_specific_settings' in manifest) {
        r.fail(pkg.rel + ' carries no browser_specific_settings',
          'this is the Chromium package — the identical file is uploaded to Chrome Web Store AND\n' +
          'Edge Add-ons — and it declares a Firefox-only key.');
      } else {
        r.pass(pkg.rel + ' is a clean Chromium package', 'no Firefox-only keys; v' + (manifest.version || '?'));
      }

      /* 🔴 THE SHARED PACKAGE MUST NOT NAME ONE OF THE TWO BROWSERS IT SHIPS TO.
         These identical bytes go to Chrome Web Store AND Edge Add-ons, so a
         store-listing field reading "... for Chrome" is correct in one listing
         and wrong in the other, to a user who cannot tell why. It is the same
         defect as the Edge listing that told users to open `chrome://` — one
         layer down, in bytes rather than prose.

         ⚠️ RESOLVED THROUGH EVERY PACKAGED LOCALE, NOT `default_locale`.
         name/short_name/description are `__MSG_*__` placeholders here, and the
         store resolves them in the READER's language. Grading only `en` would
         check the language the developer speaks and ship the other 54 unread.

         ⚠️ AND IT READS `message`, NEVER `description`. Measured 2026-08-20:
         55 of 55 locale files contain the word "chrome" — every one of them in a
         `description`, which is TRANSLATOR GUIDANCE and is never shown to a
         user. A grep over these files would fire 55 times and be wrong 55 times.
         That is this repository's own recorded lesson: assert on parsed
         structure, never by grepping prose. */
      const LOCALISED = ['name', 'short_name', 'description'];
      const placeholders = LOCALISED
        .map((k) => ({ field: k, key: /^__MSG_(.+)__$/.exec(String(manifest[k] || ''))?.[1] || null }))
        .filter((x) => x.key !== null);
      if (placeholders.length > 0) {
        let localeFiles = [];
        try {
          localeFiles = listZipEntries(pkg.abs).filter((n) => /^_locales\/[^/]+\/messages\.json$/.test(n));
        } catch (e) {
          localeFiles = [];
        }
        if (localeFiles.length === 0) {
          r.fail(pkg.rel + ' resolves its __MSG_ manifest fields',
            'the manifest localises ' + placeholders.map((x) => x.field).join(', ') + ' but the package carries NO\n' +
            '_locales/<lang>/messages.json. Every field below would be graded over an empty set, which reads\n' +
            'exactly like a clean package.');
        } else {
          const offenders = [];
          for (const rel of localeFiles) {
            let msgs = null;
            try { msgs = JSON.parse(readZipEntry(pkg.abs, rel).toString('utf8')); }
            catch { continue; }
            const lang = rel.split('/')[1];
            for (const ph of placeholders) {
              const val = msgs?.[ph.key]?.message;
              if (typeof val === 'string' && /chrome/i.test(val)) offenders.push(lang + ' ' + ph.field + ': "' + val.slice(0, 60) + '"');
            }
          }
          if (offenders.length > 0) {
            r.fail(pkg.rel + ' names no browser in its localised store fields',
              offenders.length + ' resolved value(s) name Chrome. The SAME bytes are uploaded to Edge\n' +
              'Add-ons, where that sentence is wrong for the reader:\n  ' + offenders.slice(0, 8).join('\n  '));
          } else {
            r.pass(pkg.rel + ' names no browser in its localised store fields',
              placeholders.length + ' field(s) resolved across ' + localeFiles.length + ' locale(s)');
          }
        }
      }
    }

    /* A package whose version is not the tool's current one is by definition a
       thing that can be uploaded by mistake. Not fatal — old artifacts are
       allowed to exist — but never silent. */
    if (tool.manifest && manifest.version && manifest.version !== tool.manifest.version) {
      r.warn(pkg.rel + ' is v' + manifest.version + ', the tree is v' + tool.manifest.version,
        'a stale artifact sitting beside a current one is the thing that gets uploaded by hand.');
    }

    /* ------------- FRESHNESS: IS THIS PACKAGE THE TREE, OR A PHOTOGRAPH OF IT? --
       🔴 ADDED 2026-08-26. EVERY LIMB ABOVE GRADES WHATEVER IS ON DISK AND NOT
       ONE OF THEM ASKS HOW OLD IT IS. Measured the same day on this tree:
       dist/fullshot-chromium.zip and dist/fullshot-firefox.zip predated two
       privacy fixes — content/capture.js, pages/history.js, pages/result.js and
       all 55 locale catalogues differed from the tree — and this gate printed
       five PASS lines and exited 0 over them. A reader who sees 5-PASS concludes
       that the shipping package contains the current code. That inference was
       unsound, and nothing in the output said so.

       IT ASKS ABOUT CONTENT, NEVER ABOUT TIMESTAMPS. An mtime answers "was this
       file touched", which a fresh clone and a `cp -r` both answer yes to over a
       byte-identical tree, and which a restored file answers no to after a real
       edit. A hash answers the question actually being asked. mtimes ARE printed
       below — but only to NAME which file is newer, after the hashes have
       already disagreed, never to decide that they have.

       🔴 IT WARNS. IT MUST NOT FAIL, AND THAT IS A DESIGN DECISION RATHER THAN
       TIMIDITY. Grading a package built earlier is a SUPPORTED use of this
       command — `--dir` exists so that yesterday's artifact can be opened and
       read — so a red lane here would punish the thing the command is for, and a
       gate that is red on its own documented invocation is a gate people stop
       running. Staleness therefore prints a loud WARN naming what is newer than
       the package, and leaves the exit code exactly as the identity limbs above
       left it. Those limbs fail; this one tells you what you are looking at.

       THE FIREFOX MANIFEST IS DELIBERATELY NOT COMPARED, AND THAT IS NOT A HOLE.
       pack.mjs ships the chromium manifest byte for byte and BUILDS the Firefox
       one by applying targets.firefox.overlay as an RFC 7386 merge patch, so
       those packaged bytes are SUPPOSED to differ from manifest.json on disk.
       Comparing them would report every Firefox package ever built as stale,
       and a warning that is wrong every time is one nobody reads the third time.
       The part of that manifest a stale package gets wrong — the identity — is
       already graded above, against publish/identity.json. */
    if (pack.files.length > 0) {
      let entryNames = null;
      try { entryNames = new Set(listZipEntries(pkg.abs)); }
      catch (e) { if (!(e instanceof ZipUnreadable)) throw e; }

      if (entryNames === null) {
        /* The manifest read above succeeded, so this is not "an unreadable
           archive" — it is one that stopped being readable between two reads.
           Reported rather than skipped, for the reason the whole file states:
           a check that could not look must not print like one that looked. */
        r.warn(pkg.rel + ' could not be listed for a freshness comparison',
          'its manifest.json was read but its central directory would not enumerate, so nothing below\n' +
          'is known about whether this package carries the current code.');
      } else {
        /* Firefox: see the merge-patch paragraph above. Chromium ships the
           manifest verbatim, so there it is compared like any other file. */
        const skipRel = isFirefox ? tool.manifestRel : null;
        const differs = [], absent = [], unreadable = [];
        let compared = 0;
        for (const rel of pack.files) {
          if (rel === skipRel) continue;
          if (!entryNames.has(rel)) { absent.push(rel); continue; }
          let inZip;
          try { inZip = readZipEntry(pkg.abs, rel); }
          catch (e) {
            if (!(e instanceof ZipUnreadable)) throw e;
            unreadable.push(rel);
            continue;
          }
          if (inZip === null) { absent.push(rel); continue; }
          compared++;
          if (sha256(inZip) !== sha256(fs.readFileSync(path.join(tool.dirAbs, rel)))) differs.push(rel);
        }

        /* mtimes, used for NAMING ONLY — the verdict is already decided by the
           hashes above. A file that cannot be stat'd contributes no timestamp
           rather than a zero, which would sort to the front and name the wrong
           file as the newest thing the package has missed. */
        const mtimeOf = (abs) => { try { return fs.statSync(abs).mtimeMs; } catch { return null; } };
        const newestOf = (list) => {
          let best = null;
          for (const rel of list) {
            const ms = mtimeOf(path.join(tool.dirAbs, rel));
            if (ms !== null && (best === null || ms > best.ms)) best = { rel, ms };
          }
          return best;
        };
        const iso = (ms) => (ms === null ? 'unknown' : new Date(ms).toISOString());
        const some = (list) => list.slice(0, 6).map(f => '    ' + f).join('\n') +
          (list.length > 6 ? '\n    ...and ' + (list.length - 6) + ' more' : '');

        if (compared === 0) {
          /* NOT "fresh". The ruler itself is fine — that is the coverage
             self-check above, and it did not fire — so this is a statement about
             THIS package: it and the tree have no file in common, which is what
             a package for another tool, for another version's file set, or a
             hand-assembled archive looks like from here. */
          r.warn(pkg.rel + ' shares no file with the tree that would pack it',
            'none of the ' + pack.files.length + ' file(s) package.include selects from ' + tool.rel + '/ is present in\n' +
            'this archive, so NOTHING about its freshness was measured — do not read the lines above as\n' +
            'saying it carries the current code. It carries some other file set entirely.');
        } else if (differs.length === 0 && absent.length === 0 && unreadable.length === 0) {
          r.pass(pkg.rel + ' carries this tree\'s bytes',
            compared + ' packaged file(s) hashed, every one identical to ' + tool.rel + '/');
        } else {
          const newest = newestOf([...differs, ...absent]);
          const pkgMs = mtimeOf(pkg.abs);

          /* 🔴 WHERE THE PACKAGE LIVES CHANGES WHAT "OUT OF DATE" MEANS, AND
             GETTING THAT BACKWARDS WOULD MAKE THIS FILE CAUSE THE HARM IT EXISTS
             TO PREVENT. A zip in the tool's publish/ is a GOLDEN MASTER —
             .gitignore's own words, quoted in pack.mjs §4: "the exact artifact a
             store received, and what pack.mjs diffs the next build against". It
             is SUPPOSED to freeze at the version it shipped and to stop matching
             the tree the moment the tree moves on, so "rebuild over it" is the
             one instruction that must never be printed about it: the next build
             would overwrite the only local record of what the store actually
             holds, and the dropped-file floor would then be diffing against
             itself. Everywhere else — dist/, a scratch --dir — a package is a
             BUILD OUTPUT, and a build output that no longer matches its source
             is simply old and should be rebuilt. Same measurement, same
             loudness, opposite advice. */
          const isGolden = path.dirname(pkg.abs) === path.join(tool.dirAbs, 'publish');

          const evidence =
            (differs.length ? differs.length + ' packaged file(s) DIFFER from the tree:\n' + some(differs) + '\n' : '') +
            (absent.length ? absent.length + ' file(s) the tree would pack are NOT IN this archive:\n' + some(absent) + '\n' : '') +
            (unreadable.length ? unreadable.length + ' entry/entries could not be inflated and were not compared:\n' + some(unreadable) + '\n' : '') +
            (newest ? 'newest differing file: ' + newest.rel + '  ' + iso(newest.ms) + '\n' : '') +
            'this package:          ' + iso(pkgMs) + '\n' +
            (newest && pkgMs !== null && newest.ms < pkgMs
              ? 'NOTE: nothing that differs is NEWER than this package, so the difference is not an edit\n' +
                'made after the build. This archive was built from a different tree, or by another packer.\n'
              : '') +
            '(The verdict is the hashes. Those two timestamps are printed to name what is newer, not to\n' +
            'decide that anything is.)\n';

          if (isGolden) {
            r.warn(pkg.rel + ' is a RELEASE artifact and is NOT this tree',
              '🔴 A WARN AND NOT A FAILURE, AND HERE NOT EVEN A DEFECT: a package in ' + tool.rel + '/publish/ is a\n' +
              'golden master — the bytes a store received — so it is MEANT to stop matching the tree. This\n' +
              'line exists so that nobody reads the PASS lines above as saying it carries the current code.\n' +
              evidence +
              'DO NOT REBUILD OVER IT. It is the only local record of what was shipped, and pack.mjs diffs\n' +
              'the next build against it to catch a dropped file. Build into dist/ instead.');
          } else {
            r.warn(pkg.rel + ' is STALE — it was built from a tree that is no longer this one',
              '🔴 A WARN AND NOT A FAILURE, ON PURPOSE: grading an artifact you built earlier is what this\n' +
              'command is for, and `--dir` exists to do it. It is loud because the PASS lines above say\n' +
              'nothing whatever about age, and five of them beside a stale zip read as "the package that\n' +
              'ships contains the current code".\n' +
              evidence +
              'FIX: rebuild before anyone uploads this — node scripts/pack.mjs ' + tool.id +
              ' --target ' + target + ' --out dist');
          }
        }
      }
    }
  }

  /* ---------------- every target is accounted for, present or not ----------- */
  for (const [target, n] of perTarget) {
    targetsGraded++;
    if (n === 0) {
      r.note('target "' + target + '" (' + tool.rel + '): no built package found in ' + searchDirs.join('/') +
        ' — nothing to grade for it in this checkout.');
    } else {
      r.pass('target "' + target + '" — ' + n + ' package(s) graded', tool.rel);
    }
  }
}

if (targetsGraded === 0) {
  die('zero targets were graded across ' + tools.length + ' tool(s).\n' +
    'The subject set is empty, so a pass here would mean nothing.');
}

r.blank();
r.note(packagesGraded + ' store package(s) opened and graded, ' + packagesUnreadable + ' unreadable, across ' +
  targetsGraded + ' declared target(s).');
if (packagesGraded === 0) {
  /* ⚠️ THIS WORDING WAS CORRECTED 2026-08-20, LATER THE SAME DAY IT WAS WRITTEN.
     It used to say "store packages are gitignored (*.zip), so a CI checkout has
     none" — true when written and false a few hours later, because the
     .gitignore contradiction was fixed and `publish/*.zip` is now deliberately
     tracked. The reason a checkout has none is no longer the ignore rule; it is
     that there are ZERO RELEASES, so no golden master exists to commit yet. A
     message that explains an absence with a reason that has stopped being the
     reason is worse than one that just states the absence. */
  r.note('⚠️ ZERO PACKAGES WERE PRESENT, so this run proved nothing about any artifact.');
  r.note('   `publish/*.zip` IS tracked (deliberately — scripts/pack.mjs diffs the next build against the last');
  r.note('   released package to catch a dropped file). There are simply no releases yet, so there is nothing');
  r.note('   committed to grade. Until the first one, this limb bites only where the artifacts are: a developer');
  r.note('   machine after a build, or the `package` job, which grades the zip it just built. Read this line');
  r.note('   rather than the exit code.');
}

process.exit(r.finish());
