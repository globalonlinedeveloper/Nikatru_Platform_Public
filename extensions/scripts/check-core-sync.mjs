/* check-core-sync.mjs — has a tool's vendored core drifted from core/?
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/check-core-sync.mjs fullshot

   The CI half of the vendoring bargain (spec §2.3). Vendoring buys a tool that
   loads unpacked with zero setup and a core adoption that is visible as a diff
   — but it costs the one thing a symlink would have given for free: the copies
   can silently diverge. This is the gate that makes divergence loud.

   IT COMPARES THREE THINGS, NOT TWO

     core/<channel>/x.js   the source of truth
     vendor/core/x.js      the copy that actually ships
     .coremeta.json        the hashes the last sync recorded

   Comparing the metadata against core/ alone would pass a tool whose vendored
   FILE was edited by hand. Comparing the file against the metadata alone would
   pass a tool where both were edited together. So every vendored byte is
   hashed here and checked against both. There is no pair of hand edits that
   passes.

   WHEN THE ONLY DIFFERENCE IS LINE ENDINGS, IT SAYS SO

   A CRLF that sneaks into a vendored file changes its sha256 and fails this
   gate with a diff nobody can see in an editor. .gitattributes declares
   `* text=auto eol=lf` for exactly this reason. Rather than print two hashes
   and let someone lose an afternoon, the mismatch is re-tested against
   LF-normalised bytes and reported as what it is.

   A TOOL THAT VENDORS NO CORE PASSES, AND THAT IS NOT A LOOPHOLE

   ci.yml runs this for every tool in the matrix, including ones with no "core"
   key. Those pass — but an orphan vendor/core/ with no declaration behind it
   FAILS, because that is a directory shipping into a package that nothing
   maintains and nothing updates.

   Exit codes: 0 in sync · 1 drifted · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { Report, parseArgs } from './lib/report.mjs';
import { repoRoot, resolveTool, readJson, walk, sha256 } from './lib/toolinfo.mjs';

const args = parseArgs(process.argv.slice(2));
args.rejectUnknown(['repo-root']);
const root = repoRoot(args);
const tool = resolveTool(root, args.positional[0]);
const r = new Report('check-core-sync · ' + tool.id + ' (' + tool.rel + ')');

const vendorDir = path.join(tool.dirAbs, 'vendor', 'core');
const metaPath = path.join(vendorDir, '.coremeta.json');
const channel = tool.core && tool.core.channel ? String(tool.core.channel) : null;
const hasVendor = fs.existsSync(vendorDir);

/* ---------------- the tool declares no core ---------------- */
if (!channel) {
  if (!hasVendor) {
    r.pass('this tool vendors no core',
      'tool.json declares no "core" channel and there is no vendor/core/ directory — consistent');
    process.exit(r.finish());
  }
  const strays = walk(vendorDir);
  r.fail('vendor/core/ exists but tool.json declares no core channel',
    tool.rel + '/vendor/core/ holds ' + strays.length + ' file(s):\n' +
    strays.slice(0, 10).map(f => '  ' + f).join('\n') + (strays.length > 10 ? '\n  ...' : '') +
    '\nNothing declares them, so sync-core will never update them and this gate cannot grade them —\n' +
    'but package.include may well ship them. Either add "core": { "channel": "v1", "pin": null } to\n' +
    'tool.json and run sync-core, or delete the directory.');
  process.exit(r.finish());
}

/* ---------------- the channel must exist ---------------- */
const channelDir = path.join(root, 'core', channel);
if (!fs.existsSync(channelDir)) {
  r.fail('core/' + channel + '/ exists',
    tool.rel + '/tool.json asks for core channel "' + channel + '", but core/' + channel + '/ is not in\n' +
    'this repository. A declared dependency on a directory that does not exist cannot be graded, and\n' +
    'a gate that cannot grade must not report a pass. Either create the channel, or remove the "core"\n' +
    'key from tool.json.');
  process.exit(r.finish());
}

if (!hasVendor) {
  r.fail('vendor/core/ exists',
    tool.rel + '/tool.json declares core channel "' + channel + '" but ' + tool.rel + '/vendor/core/ has\n' +
    'never been created. Run:  node scripts/sync-core.mjs ' + tool.id);
  process.exit(r.finish());
}

/* ---------------- the metadata ---------------- */
if (!fs.existsSync(metaPath)) {
  r.fail('vendor/core/.coremeta.json exists',
    'vendor/core/ has files but no .coremeta.json, so nothing records which core version they came\n' +
    'from. Files of unknown provenance in a shipped package are exactly what vendoring is supposed to\n' +
    'prevent. Run:  node scripts/sync-core.mjs ' + tool.id);
  process.exit(r.finish());
}
const mp = readJson(metaPath);
if (mp.error) { r.fail('vendor/core/.coremeta.json parses', mp.error); process.exit(r.finish()); }
const meta = mp.value;

if (meta.channel !== channel) {
  r.fail('the vendored channel matches tool.json',
    '.coremeta.json says channel "' + meta.channel + '", tool.json asks for "' + channel + '".\n' +
    'Directory-as-major-version means these are different, incompatible APIs. Run sync-core to adopt\n' +
    'the declared channel — and expect to retest, because that is a major version change.');
}

const cj = readJson(path.join(root, 'core', 'core.json'));
if (cj.error) { r.fail('core/core.json parses', cj.error); process.exit(r.finish()); }
const currentVersion = cj.value.version;
const pin = tool.core && tool.core.pin ? String(tool.core.pin) : null;

if (pin) {
  if (meta.coreVersion !== pin) {
    r.fail('the vendored core matches the pin',
      'tool.json pins core ' + pin + ' but vendor/core was synced from ' + meta.coreVersion + '.\n' +
      'Run:  node scripts/sync-core.mjs ' + tool.id);
  } else {
    r.pass('pinned to core ' + pin, currentVersion !== pin
      ? 'core/ is at ' + currentVersion + ' — this tool is deliberately behind, which is what a pin is for'
      : 'which is also the current core');
  }
} else if (meta.coreVersion !== currentVersion) {
  r.fail('the vendored core is current',
    'vendor/core was synced from core ' + meta.coreVersion + ', core/core.json is now at ' + currentVersion + '.\n' +
    'tool.json sets "pin": null, which means this tool tracks the head of core/' + channel + '.\n' +
    'Run:  node scripts/sync-core.mjs ' + tool.id + '\n' +
    'If you did not mean to adopt it yet, pin it instead: "pin": "' + meta.coreVersion + '".');
} else {
  r.pass('vendored core is core ' + currentVersion, 'tracking the head of core/' + channel);
}

/* ---------------- every byte ---------------- */
const sourceFiles = walk(channelDir);
const vendored = walk(vendorDir).filter(f => f !== '.coremeta.json');
const problems = [];
const lf = buf => Buffer.from(buf.toString('binary').replace(/\r\n/g, '\n'), 'binary');

for (const rel of sourceFiles) {
  const srcAbs = path.join(channelDir, rel);
  const dstAbs = path.join(vendorDir, rel);
  const srcHash = sha256(fs.readFileSync(srcAbs));
  if (!fs.existsSync(dstAbs)) {
    problems.push('MISSING   ' + rel + '  — in core/' + channel + ', not in vendor/core. The tool is running an ' +
      'older core than it claims, or a file was deleted by hand.');
    continue;
  }
  const dstBuf = fs.readFileSync(dstAbs);
  const dstHash = sha256(dstBuf);
  if (dstHash !== srcHash) {
    if (sha256(lf(dstBuf)) === sha256(lf(fs.readFileSync(srcAbs)))) {
      problems.push('LINE ENDINGS  ' + rel + '  — the content is identical; only CRLF/LF differs. ' +
        '.gitattributes declares "* text=auto eol=lf" for exactly this. Re-run sync-core, and check ' +
        'that nothing rewrote the file with a Windows-default editor or a PowerShell redirect.');
    } else {
      problems.push('MODIFIED  ' + rel + '  — differs from core/' + channel + '/' + rel + '. A vendored file is a ' +
        'COPY, not a fork: edit core/ and re-sync, or the fix is lost the next time anyone syncs.');
    }
    continue;
  }
  /* The file matches core. Does the recorded hash agree? If not, the metadata
     was edited — which is the half of the attack a two-way check would miss. */
  const recorded = meta.files && meta.files[rel];
  if (recorded && recorded !== srcHash) {
    problems.push('METADATA  ' + rel + '  — the file matches core/ but .coremeta.json records a different hash. ' +
      'The metadata was hand-edited. It is generated; do not edit it.');
  } else if (!recorded) {
    problems.push('UNRECORDED  ' + rel + '  — vendored and correct, but .coremeta.json does not list it. ' +
      'Re-run sync-core so the record is complete.');
  }
}

for (const rel of vendored) {
  if (!sourceFiles.includes(rel)) {
    problems.push('EXTRA     ' + rel + '  — in vendor/core but not in core/' + channel + '. It ships, and nothing ' +
      'maintains it. Run: node scripts/sync-core.mjs ' + tool.id + ' --prune');
  }
}

if (problems.length) {
  r.fail(problems.length + ' vendored file(s) have drifted from core/' + channel,
    problems.join('\n'));
} else {
  r.pass(sourceFiles.length + ' vendored file(s) byte-identical to core/' + channel,
    'and every hash in .coremeta.json agrees');
}

/* REQUIRED COVERAGE. A channel that has become empty would produce zero
   comparisons and a green run. */
if (sourceFiles.length === 0) {
  r.fail('core/' + channel + ' contains files to compare',
    'core/' + channel + '/ is empty, so this gate compared nothing and would have reported a pass over an\n' +
    'empty set — indistinguishable from a tool whose vendored core is perfectly in sync.');
}

process.exit(r.finish());
