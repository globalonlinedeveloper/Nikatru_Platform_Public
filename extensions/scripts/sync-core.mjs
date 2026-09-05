/* sync-core.mjs — copy core/<channel> into a tool's vendor/core, with hashes.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/sync-core.mjs fullshot
     node scripts/sync-core.mjs fullshot --dry-run
     node scripts/sync-core.mjs fullshot --prune          (remove strays too)

   Core is VENDORED, NOT LINKED (spec §2.3). The three alternatives were
   rejected for reasons that have not changed: a relative import across the repo
   cannot work because only files inside the tool directory get zipped; symlinks
   need Developer Mode or admin on Windows, are off by default in Git for
   Windows, and Chrome's unpacked loader handles them inconsistently; an npm
   workspace drags node_modules into a runtime with no module resolver.

   So: copy the bytes in, commit them, and hash-verify them. That buys a tool
   directory that loads unpacked with zero setup, core changes visible as a diff
   in the PR that adopts them, per-tool pinning so a core bump never forces
   retesting eight extensions the same afternoon, and a CI gate
   (check-core-sync.mjs) that fails the moment someone hand-edits a vendored
   file.

   NEVER _core/. Chrome refuses to load any package with a root file or
   directory beginning with an underscore — "Filenames starting with '_' are
   reserved for use by the system" — and _locales is the only exception. That is
   why the destination is vendor/core/.

   WHAT THIS DELIBERATELY DOES NOT DO

   Spec §2.3 also describes emitting vendor/core/esm/<mod>.js shims of the form
   `import '../msg.js'; export const msg = globalThis.TX.msg;` for a future
   module-first tool. That is NOT implemented, and the omission is the point:
   the shim has to know each module's namespace object and its export name, and
   core/v1 today contains three modules promoted from templates/tool that attach
   their own globals (the SK-prefixed ones: SKDB, SKJOBS and friends) because
   v1/ns.js does not exist yet.
   Generating those shims would mean guessing a namespace that nothing defines,
   and shipping a file that imports a symbol that is never assigned. An honest
   gap beats a plausible fake — this comes back when ns.js is real.

   Exit codes: 0 synced (or already in sync) · 1 refused · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs, die, EXIT_FAIL } from './lib/report.mjs';
import { repoRoot, resolveTool, readJson, walk, sha256 } from './lib/toolinfo.mjs';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['dry-run', 'prune', 'allow-pin-drift', 'repo-root']);
const root = repoRoot(args);
const tool = resolveTool(root, args.positional[0]);
const dryRun = args.bool('dry-run');

const r = new Report('sync-core · ' + tool.id + ' (' + tool.rel + ')' + (dryRun ? '  [dry run]' : ''));

/* ---------------- what does this tool ask for? ---------------- */
const channel = tool.core && tool.core.channel ? String(tool.core.channel) : null;
if (!channel) {
  die(tool.rel + '/tool.json declares no core channel, so there is nothing to sync.\n' +
    'Add   "core": { "channel": "v1", "pin": null }   to tool.json first — and only once the tool\n' +
    'actually loads a vendored core file, because an empty vendor/core/ in a package is dead weight\n' +
    'that verify-refs reports as unreferenced.');
}

const coreDir = path.join(root, 'core');
const channelDir = path.join(coreDir, channel);
if (!fs.existsSync(channelDir)) {
  die('core/' + channel + '/ does not exist in this repository.\n' +
    tool.rel + '/tool.json asks for channel "' + channel + '". Either create it, or remove the "core"\n' +
    'key from tool.json. A declared channel with no directory behind it is a dependency on something\n' +
    'that does not exist, and every gate downstream would be grading an empty copy.');
}

const cjPath = path.join(coreDir, 'core.json');
const cj = readJson(cjPath);
if (cj.error) die(cj.error);
const coreVersion = cj.value && cj.value.version;
if (typeof coreVersion !== 'string' || !coreVersion) {
  die('core/core.json has no "version" string. The vendored copy records which core it came from, and\n' +
    'that record is the only thing that makes "is this tool on the current core?" answerable.');
}
if (cj.value.channel && cj.value.channel !== channel) {
  r.warn('core/core.json declares channel "' + cj.value.channel + '", this tool asks for "' + channel + '"',
    'Both directories can exist at once — directory-as-major-version is how old tools keep running\n' +
    'unchanged — but check that this tool really means to be on the older channel.');
}

/* ---------------- the pin ---------------- */
/* A pin is a promise that the tool is on a SPECIFIC core version. This repo
   keeps exactly one copy of each channel (core/v1), not a version archive, so
   a pin can only be satisfied when it names the version currently in the tree.
   Syncing anyway would write today's bytes while the metadata claims the pinned
   version — a lie that check-core-sync would then happily confirm. */
const pin = tool.core && tool.core.pin ? String(tool.core.pin) : null;
if (pin && pin !== coreVersion) {
  if (!args.bool('allow-pin-drift')) {
    die(tool.rel + '/tool.json pins core ' + pin + ', but core/core.json is at ' + coreVersion + '.\n' +
      'core/ holds one copy per channel, not a version archive, so the pinned bytes are not available\n' +
      'to copy. Syncing would write ' + coreVersion + ' while recording ' + pin + ', and check-core-sync\n' +
      'would then confirm the lie.\n' +
      'Either set "pin": null to track the head of core/' + channel + ', or set "pin": "' + coreVersion + '"\n' +
      'in the same commit that adopts it — that ceremony is exactly the point of a pin.');
  }
  r.warn('pin drift accepted via --allow-pin-drift', 'pinned ' + pin + ', copying ' + coreVersion);
}

/* ---------------- plan ---------------- */
const sourceFiles = walk(channelDir);
if (sourceFiles.length === 0) {
  die('core/' + channel + '/ exists but contains no files. Nothing to vendor, and a sync that copies\n' +
    'zero files would leave a .coremeta.json claiming an empty core is correct.');
}

const vendorDir = path.join(tool.dirAbs, 'vendor', 'core');
const metaPath = path.join(vendorDir, '.coremeta.json');
const oldMeta = fs.existsSync(metaPath) ? readJson(metaPath).value : null;
const oldFiles = oldMeta && oldMeta.files ? Object.keys(oldMeta.files) : [];

const added = [], updated = [], unchanged = [];
const hashes = {};
for (const rel of sourceFiles) {
  const src = fs.readFileSync(path.join(channelDir, rel));
  hashes[rel] = sha256(src);
  const destAbs = path.join(vendorDir, rel);
  if (!fs.existsSync(destAbs)) added.push(rel);
  else if (sha256(fs.readFileSync(destAbs)) !== hashes[rel]) updated.push(rel);
  else unchanged.push(rel);
}

/* Files this sync would remove: only ones a PREVIOUS sync put there. Anything
   else in vendor/core is a stray somebody added by hand, and deleting a file
   nobody asked this script to own is not a decision a script gets to make. */
const removed = oldFiles.filter(f => !sourceFiles.includes(f));
const present = fs.existsSync(vendorDir) ? walk(vendorDir).filter(f => f !== '.coremeta.json') : [];
const strays = present.filter(f => !sourceFiles.includes(f) && !oldFiles.includes(f));

r.note('core/' + channel + ' v' + coreVersion + ' -> ' + tool.rel + '/vendor/core/');
r.note(sourceFiles.length + ' source file(s): ' + added.length + ' new · ' + updated.length + ' changed · ' +
  unchanged.length + ' unchanged' + (removed.length ? ' · ' + removed.length + ' to remove' : ''));
for (const f of added) r.note('  + ' + f);
for (const f of updated) r.note('  ~ ' + f);
for (const f of removed) r.note('  - ' + f + '  (gone from core/' + channel + ')');

if (strays.length) {
  if (!args.bool('prune')) {
    r.fail('vendor/core contains ' + strays.length + ' file(s) this script did not put there',
      strays.map(f => '  ' + f).join('\n') +
      '\nThey are not in core/' + channel + ' and not in the previous .coremeta.json, so they were added by\n' +
      'hand. Deleting a file nobody asked this script to own is not a decision a script gets to make.\n' +
      'Move them out, or re-run with --prune to delete them.');
    process.exit(EXIT_FAIL);
  }
  r.warn('--prune will delete ' + strays.length + ' stray file(s)', strays.map(f => '  ' + f).join('\n'));
}

/* Surface what core itself says about the modules being copied. core.json
   records a caveat per module; a tool adopting a module whose own metadata says
   it is not drop-in vendorable should read that before, not after. */
{
  const mods = (cj.value && cj.value.modules) || {};
  const caveats = sourceFiles
    .map(rel => [channel + '/' + rel, mods[channel + '/' + rel]])
    .filter(([, m]) => m && m.caveat)
    .map(([k, m]) => '  ' + k + ': ' + m.caveat);
  if (caveats.length) {
    r.warn('core/core.json records caveats on ' + caveats.length + ' of the module(s) being vendored',
      caveats.join('\n') + '\nThese are core\'s own words about its own state, not this script\'s opinion.');
  }
}

if (dryRun) {
  r.pass('dry run — nothing was written');
  process.exit(r.finish());
}

/* ---------------- write ---------------- */
try {
  for (const rel of sourceFiles) {
    const destAbs = path.join(vendorDir, rel);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(path.join(channelDir, rel), destAbs);
  }
  for (const rel of removed) {
    const abs = path.join(vendorDir, rel);
    if (fs.existsSync(abs)) fs.rmSync(abs);
  }
  if (args.bool('prune')) for (const rel of strays) {
    const abs = path.join(vendorDir, rel);
    if (fs.existsSync(abs)) fs.rmSync(abs);
  }

  /* Empty directories left behind by a removal are not an error, but they are
     noise in a `git status` that nothing explains. */
  (function pruneEmpty(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) {
        pruneEmpty(abs);
        if (fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
      }
    }
  })(vendorDir);

  const meta = {
    README: 'GENERATED by scripts/sync-core.mjs. Do not hand-edit this file or anything beside it: ' +
      'check-core-sync.mjs compares every vendored byte against core/ AND against the hashes recorded ' +
      'here, so editing both to match still fails against core/.',
    channel,
    coreVersion,
    pin: pin || null,
    syncedAt: new Date().toISOString().slice(0, 10),
    files: hashes
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
} catch (e) {
  r.fail('writing vendor/core', e.message);
  process.exit(EXIT_FAIL);
}

r.pass('vendored ' + sourceFiles.length + ' file(s) from core/' + channel + ' v' + coreVersion,
  'hashes written to ' + tool.rel + '/vendor/core/.coremeta.json');
r.note('vendor/core/ IS COMMITTED — that is what makes the adoption visible as a diff in this PR,');
r.note('and what lets someone clone the repo and load the extension unpacked with no setup at all.');
if (added.length || updated.length || removed.length) {
  r.note('Now run the tool\'s own sims before you commit: a core change is N outages at once,');
  r.note('and this script has only proved the bytes copied, never that they still work here.');
}

process.exit(r.finish());
