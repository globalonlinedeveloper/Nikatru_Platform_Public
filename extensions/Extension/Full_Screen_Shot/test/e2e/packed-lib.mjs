/* ============================================================================
   packed-lib.mjs — the PACKED extension, with ONE asserted manifest delta, for
   the suites written 2026-09-24 (EXT-5: network-audit.mjs, gecko-smoke.mjs,
   real-copy.mjs, gecko-clipboard.mjs). A library, not a suite: the e2e-suite
   step classifies any .mjs another file imports as a library.

   WHY NOT claim-lib.mjs prepareTestExtension(). That copies the SOURCE tree —
   test/, publish/, i18n/ and all — and rewrites the manifest freely. These
   suites make claims about what SHIPS (the network a packaged page reaches, the
   clipboard a packaged page writes, the Firefox add-on AMO would receive), so
   they run what `node scripts/pack.mjs fullshot --target <t>` builds, unpacked,
   with exactly three manifest additions a test driver needs and a user does
   not:
     + "tabs"                      the driver finds and focuses the test tab;
     + host_permissions <all_urls> the driver has no toolbar click to grant
                                   activeTab with;
     + "clipboardRead"             the suites READ BACK what a copy wrote.
   Never "clipboardWrite": whether the shipped manifest's copy works WITHOUT it
   is one of the questions being asked.

   REFUSED WITH EXIT 2 (COVERAGE LOST, not a finding), before any browser starts:
     · a manifest delta outside that allow-list, in either direction;
     · any non-manifest file whose bytes differ from the zip pack.mjs wrote.
   Either means the suite would be grading something other than the package.
   ========================================================================== */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXT_DIR = path.resolve(__dirname, '..', '..');
const EXTENSIONS_ROOT = path.resolve(EXT_DIR, '..', '..');
const TOOL_ID = 'fullshot';

/* The allow-list, as data: key -> the value it must hold after the delta. */
export const DELTA = Object.freeze({
  permissionsAdded: ['tabs', 'clipboardRead'],
  host_permissions: ['<all_urls>']
});

export function coverageLost(msg) {
  console.log('COVERAGE LOST — ' + msg);
  process.exit(2);
}

/* Central-directory zip reader: name -> Buffer. Enough for pack.mjs's output
   (stored or deflated, no zip64), and nothing here trusts a local header. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) coverageLost(file + ' has no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) coverageLost(file + ': central directory entry ' + n + ' is malformed');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + size);
    if (!name.endsWith('/')) out.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

const sha = b => crypto.createHash('sha256').update(b).digest('hex');

function walkFiles(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...walkFiles(dir, rel));
    else out.push(rel);
  }
  return out;
}

/* Packs `target` ('chromium' | 'firefox') into a fresh temp dir, applies the
   delta to <out>/unpacked-<target>/manifest.json, proves the tree is the zip
   plus the delta, and returns { dir, zip, manifest, packedManifest }. */
export function packedExtension(target) {
  if (target !== 'chromium' && target !== 'firefox') coverageLost('packedExtension(' + JSON.stringify(target) + ')');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fullshot-packed-' + target + '-'));
  const r = spawnSync(process.execPath, [path.join(EXTENSIONS_ROOT, 'scripts', 'pack.mjs'), TOOL_ID, '--target', target, '--out', out],
    { cwd: EXTENSIONS_ROOT, encoding: 'utf8' });
  if (r.status !== 0) coverageLost('scripts/pack.mjs ' + TOOL_ID + ' --target ' + target + ' exited ' + r.status + '\n' + (r.stdout || '') + (r.stderr || ''));
  const zip = path.join(out, TOOL_ID + '-' + target + '.zip');
  const dir = path.join(out, 'unpacked-' + target);
  if (!fs.existsSync(zip) || !fs.existsSync(dir)) coverageLost('pack.mjs wrote neither ' + zip + ' nor ' + dir);

  const entries = readZip(zip);
  const packedManifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  const mf = JSON.parse(JSON.stringify(packedManifest));
  mf.permissions = [...(mf.permissions || [])];
  for (const p of DELTA.permissionsAdded) if (!mf.permissions.includes(p)) mf.permissions.push(p);
  mf.host_permissions = [...DELTA.host_permissions];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mf, null, 2) + '\n');

  /* The delta, re-derived from the two manifests and compared with the list. */
  const keys = new Set([...Object.keys(packedManifest), ...Object.keys(mf)]);
  const changed = [...keys].filter(k => JSON.stringify(packedManifest[k]) !== JSON.stringify(mf[k])).sort();
  const want = ['host_permissions', 'permissions'];
  if (changed.join(',') !== want.join(',')) coverageLost('the manifest delta touches ' + changed.join(', ') + '; the allow-list is ' + want.join(', '));
  const added = mf.permissions.filter(p => !(packedManifest.permissions || []).includes(p));
  const removed = (packedManifest.permissions || []).filter(p => !mf.permissions.includes(p));
  if (removed.length || added.some(p => !DELTA.permissionsAdded.includes(p)) || added.includes('clipboardWrite')) {
    coverageLost('the permission delta is +' + added.join(',+') + (removed.length ? ' -' + removed.join(',-') : '') +
      '; only +' + DELTA.permissionsAdded.join(',+') + ' is allowed, and never clipboardWrite');
  }
  if (packedManifest.host_permissions !== undefined) coverageLost('the packed manifest already declares host_permissions; the delta would hide a change to it');

  /* Every other file: the zip's bytes, exactly, and nothing extra on disk. */
  const onDisk = walkFiles(dir).filter(f => f !== 'manifest.json').sort();
  const inZip = [...entries.keys()].filter(f => f !== 'manifest.json').sort();
  if (onDisk.join('\n') !== inZip.join('\n')) coverageLost('unpacked-' + target + ' and the zip hold different file sets');
  for (const f of inZip) {
    if (sha(fs.readFileSync(path.join(dir, f))) !== sha(entries.get(f))) coverageLost(f + ' differs from the packed zip');
  }
  console.log('packed ' + target + ': ' + inZip.length + ' file(s) byte-identical to ' + path.basename(zip) +
    '; manifest delta +' + added.join(' +') + ' +host_permissions <all_urls>');
  return { dir, zip, out, manifest: mf, packedManifest };
}

/* A CSP-violation and network-API recorder, installed into an extension page
   before its own scripts run. Every suite that opens a packaged page carries
   it, because the page CSP is enforced by the browser and nothing else sees a
   violation: a dropped stylesheet or a refused image prints nothing. */
export const PAGE_RECORDER = `(() => {
  if (window.__fsRec) return;
  const rec = window.__fsRec = { csp: [], net: [] };
  document.addEventListener('securitypolicyviolation', e => {
    rec.csp.push({ directive: e.effectiveDirective || e.violatedDirective, uri: String(e.blockedURI || ''), sample: String(e.sample || '').slice(0, 80) });
  }, true);
  const note = (api, arg) => { rec.net.push({ api, arg: String(arg == null ? '' : (arg.url || arg)).slice(0, 200) }); };
  const wrapFn = (obj, name, label) => {
    const orig = obj && obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (a) { note(label, a); return orig.apply(this, arguments); };
  };
  const wrapCtor = (name) => {
    const Orig = window[name];
    if (typeof Orig !== 'function') return;
    const W = function (a) { note(name, a); return Reflect.construct(Orig, arguments, new.target || Orig); };
    W.prototype = Orig.prototype;
    window[name] = W;
  };
  wrapFn(window, 'fetch', 'fetch');
  if (window.XMLHttpRequest) wrapFn(XMLHttpRequest.prototype, 'open', 'XMLHttpRequest');
  if (window.navigator) wrapFn(navigator, 'sendBeacon', 'sendBeacon');
  ['WebSocket', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'SharedWorker'].forEach(wrapCtor);
})();`;
