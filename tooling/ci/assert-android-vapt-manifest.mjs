#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-android-vapt-manifest.mjs — open the BUILT release .apk, decode the
// binary AndroidManifest.xml inside it, and refuse the static items of the
// apps.gov.in VAPT checklist that a stock Flutter release build can fail.
//
// Register row: O-APPS-GOV-IN-VAPT-CHECKLIST. The checklist it tracks is the
// research brief pinned at
// pre-prune-2026-09-08:research/factory-review-2026-09-07/X1-apps-gov-in-and-apisetu-brief.md
// (:18, :237-247, :588) in the private corpus.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// apps.gov.in runs a real VAPT (MobSF, Frida, Jadx, Burp, apktool) against a
// published 17-item static plus 3-item dynamic checklist, and only High
// findings block. Each bounce costs another 2-3 working days against the
// owner's upload sitting (2026-10-31). SIX of those items are properties of the
// build that CI can decide once, and every stamped app then inherits the answer.
//
// 🔴 MEASURED 2026-09-14, BEFORE THIS GUARD EXISTED:
//   `git grep -ln "usesCleartextTraffic\|allowBackup" -- tooling/ci` -> nothing.
//   apps/subscriptiontracker/android/app/src/main/AndroidManifest.xml declared
//   NO `android:allowBackup` at all, and an absent allowBackup means TRUE on
//   Android: `adb backup` and cloud backup could lift the app's private files
//   off a device. That is the first finding MobSF prints for a stock Flutter
//   manifest. It was set to false in the same change as this guard.
//
// ── WHY THE BUILT ARTEFACT, NOT THE SOURCE MANIFEST ──────────────────────────
// The source manifest is ONE input to a merge. Every plugin and every AndroidX
// library contributes its own <activity>, <receiver>, <provider> and <service>
// elements, and the VAPT tool reads the MERGED result, which exists only inside
// the .apk. This app's own source declares two receivers; the merged manifest
// read off run 34345368085's .aab additionally carries
// androidx.profileinstaller.ProfileInstallReceiver (store/android-play/
// data-safety.json records it). A source-level check would never have seen it.
// So this guard reads the bytes, like assert-elf-page-alignment.mjs does.
//
// ── WHAT IT ASSERTS (one mutation case per item in the test file) ────────────
//   V1 debuggable      <application android:debuggable> is not true
//   V2 allowBackup     <application android:allowBackup> is EXPLICITLY false
//                      (absent means true)
//   V3 cleartext       <application android:usesCleartextTraffic> is not true,
//                      and is explicitly false when targetSdkVersion < 28 (the
//                      platform default flips to false only from API 28)
//   V4 secrets         no attribute value in the manifest has a credential
//                      shape, and no <meta-data> whose name reads like a
//                      credential carries a literal string value
//   V5 exported        no exported <activity>, <activity-alias>, <service>,
//                      <receiver> or <provider> without a protecting permission,
//                      except a launcher activity whose EVERY intent-filter is
//                      MAIN + LAUNCHER (the one entry point an app must expose),
//                      or — the ONE recorded deep link — VIEW + BROWSABLE on
//                      exactly `com.nikatru.<--app>://auth-callback` (see V5)
//   V6 logging         not a manifest property, so it is checked where it is
//                      decided: `avoid_print` stays at severity error in the one
//                      inherited analysis_options.yaml, and the app's own
//                      TRACKED Kotlin/Java under android/app/src/main calls no
//                      android.util.Log and no println
//
// ⏱ 2026-09-15 · V6 READS TRACKED FILES ONLY (`git ls-files`), and that is the
// fix for its first real run, not an exemption. Build apps run 34966450109 on
// cfafbc67 failed V6 on apps/subscriptiontracker/android/app/src/main/java/io/
// flutter/plugins/GeneratedPluginRegistrant.java — 12 `Log.e` lines, one per
// plugin — a file `flutter build` WRITES and the app's own android/.gitignore
// excludes. PR CI never has it, so the guard was green there and red in the one
// lane that builds. Grading only what git tracks means tool output can never be
// graded as app code, and a hand-written Log call in a tracked file still fails.
// Untracked files that exist are PRINTED, never silently skipped. Where the tree
// is not a git work tree the guard cannot tell app code from generated code and
// REFUSES (exit 2). "No device logging in release" is ALSO held for generated and
// third-party code by R8: apps/<app>/android/app/proguard-rules.pro strips
// android.util.Log calls from the release build (Flutter enables R8 minify for
// release by default and adds that file when it exists).
//
// ── 🔴 WHAT IT DELIBERATELY DOES NOT ASSERT ──────────────────────────────────
// It does not read a `android:networkSecurityConfig` resource. If the manifest
// names one, cleartext policy lives in that XML and not in the attribute, and
// this guard REFUSES (exit 2) rather than judge half of it.
// It does not decompile dex or Dart AOT code for log calls: the app's Dart
// logging is held by the analyzer, and `debugPrint` call sites are COUNTED and
// PRINTED, never failed — MobSF rates logging as info, and inventing a High
// here would fire on an upload the store accepts.
// The dynamic items (Frida, Burp) are not decidable in CI at all.
//
// ── ⚠️ NO aapt2, ON PURPOSE ──────────────────────────────────────────────────
// `aapt2 dump xmltree` would decode the manifest, and build-tools is on the
// runner image but pinned by nothing in this repository. A guard that shells
// out to a tool that may be absent has two failure modes that print alike.
// Binary AXML is a fixed chunk format; it is parsed here directly, with the
// same central-directory zip walk assert-elf-page-alignment.mjs carries.
//
// Usage:  node tooling/ci/assert-android-vapt-manifest.mjs <app-release.apk> --app <app-id> [--repo-root <dir>]
// Exit 0 = every item holds.
// Exit 1 = an item is violated.
// Exit 2 = COVERAGE LOST: nothing was read, or what was read could not be judged.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
// The ONE directory listing in tooling/ci: it skips nested checkouts (see its header).
import { listDir } from './tree-walk.mjs';

const NAME = 'assert-android-vapt-manifest';
const ANALYSIS_REL = 'packages/analysis/lib/analysis_options.yaml';

const argv = process.argv.slice(2);
const flagValue = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valueIdx = new Set(['--repo-root', '--app'].map((f) => argv.indexOf(f)).filter((i) => i >= 0).map((i) => i + 1));
const artifacts = argv.filter((a, i) => !a.startsWith('--') && !valueIdx.has(i));
const ROOT = resolve(flagValue('--repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const APP = flagValue('--app');

const problems = [];
const prints = [];

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error(`\n${NAME}: FAILED`);
  process.exit(2);
}

if (artifacts.length !== 1) {
  coverageLost([
    `expected exactly ONE .apk on the command line, got ${artifacts.length}.`,
    'The lane names the artifact it built; an empty argument list is a lane that stopped passing it, not an app',
    'with nothing to check.',
    `Usage: node tooling/ci/${NAME}.mjs <app-release.apk> --app <app-id> [--repo-root <dir>]`,
  ]);
}
if (!APP || !/^[a-z][a-z0-9_]*$/.test(APP)) {
  coverageLost([
    `--app must name the app directory under apps/ (got ${JSON.stringify(APP ?? null)}).`,
    'Item V6 reads that app\'s own native sources; without it the logging item would range over nothing.',
  ]);
}

// ── zip reader ───────────────────────────────────────────────────────────────
// The same refusing central-directory walk as assert-elf-page-alignment.mjs: an
// archive shape it cannot read is COVERAGE LOST, never an empty entry list.
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function zipEntries(buf, rel) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd === -1) coverageLost([`${rel} has no zip end-of-central-directory record — it is not a readable .apk.`]);
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_EOCD64_LOCATOR) {
    coverageLost([`${rel} is a ZIP64 archive and this reader does not implement ZIP64.`]);
  }
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    coverageLost([`${rel} carries ZIP64 sentinel values in its end-of-central-directory record.`]);
  }
  const out = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) {
      coverageLost([`${rel} central directory entry ${n} of ${count} is malformed at offset ${p}.`]);
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readEntry(buf, entry, rel) {
  const o = entry.localOffset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== SIG_LOC) {
    coverageLost([`${rel}: entry "${entry.name}" has no local file header at offset ${o}.`]);
  }
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const raw = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw);
    } catch (e) {
      coverageLost([`${rel}: entry "${entry.name}" would not inflate — ${e.message}.`]);
    }
  }
  coverageLost([`${rel}: entry "${entry.name}" uses zip compression method ${entry.method}, which this reader does not implement.`]);
}

// ── binary AXML ──────────────────────────────────────────────────────────────
// Chunk = u16 type, u16 headerSize, u32 size. Only the chunk types a manifest
// carries are decoded; anything else inside the tree is skipped by its size, and
// a size that does not fit is a refusal, not a truncated tree.
const RES_XML = 0x0003;
const RES_STRING_POOL = 0x0001;
const RES_XML_RESOURCE_MAP = 0x0180;
const RES_XML_START_ELEMENT = 0x0102;
const RES_XML_END_ELEMENT = 0x0103;
const NO_INDEX = 0xffffffff;
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

// The platform's own attribute resource ids (android.R.attr). When a build
// strips attribute NAMES from the string pool, the resource map still carries
// these, so the attribute is identified either way.
const ATTR_BY_ID = new Map([
  [0x01010003, 'name'],
  [0x01010006, 'permission'],
  [0x01010007, 'readPermission'],
  [0x01010008, 'writePermission'],
  [0x0101000f, 'debuggable'],
  [0x01010010, 'exported'],
  [0x01010024, 'value'],
  [0x01010025, 'resource'],
  [0x01010027, 'scheme'],
  [0x01010028, 'host'],
  [0x0101020c, 'minSdkVersion'],
  [0x01010270, 'targetSdkVersion'],
  [0x01010280, 'allowBackup'],
  [0x010104ec, 'usesCleartextTraffic'],
  [0x01010527, 'networkSecurityConfig'],
]);

function decodeLength8(b, p) {
  let n = b[p];
  if (n & 0x80) return [((n & 0x7f) << 8) | b[p + 1], p + 2];
  return [n, p + 1];
}
function decodeLength16(b, p) {
  const n = b.readUInt16LE(p);
  if (n & 0x8000) return [((n & 0x7fff) << 16) | b.readUInt16LE(p + 2), p + 4];
  return [n, p + 2];
}

function stringPool(b, at, rel) {
  const headerSize = b.readUInt16LE(at + 2);
  const count = b.readUInt32LE(at + 8);
  const flags = b.readUInt32LE(at + 16);
  const stringsStart = b.readUInt32LE(at + 20);
  const utf8 = (flags & 0x100) !== 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    let p = at + stringsStart + b.readUInt32LE(at + headerSize + i * 4);
    if (p >= b.length) coverageLost([`${rel}: AndroidManifest.xml string ${i} points past the end of the file.`]);
    if (utf8) {
      [, p] = decodeLength8(b, p); // UTF-16 length, unused
      let len;
      [len, p] = decodeLength8(b, p);
      out.push(b.toString('utf8', p, p + len));
    } else {
      let len;
      [len, p] = decodeLength16(b, p);
      out.push(b.toString('utf16le', p, p + len * 2));
    }
  }
  return out;
}

/** Decode to a tree of { tag, attrs: Map<name, value>, children, parent }. */
function decodeAxml(b, rel) {
  if (b.length < 8 || b.readUInt16LE(0) !== RES_XML) {
    coverageLost([`${rel}: AndroidManifest.xml is not binary AXML (first chunk type 0x${b.length >= 2 ? b.readUInt16LE(0).toString(16) : '?'}).`]);
  }
  let strings = null;
  let resIds = [];
  const root = { tag: '#document', attrs: new Map(), children: [], parent: null };
  let cur = root;
  let p = b.readUInt16LE(2);
  let elements = 0;
  while (p + 8 <= b.length) {
    const type = b.readUInt16LE(p);
    const headerSize = b.readUInt16LE(p + 2);
    const size = b.readUInt32LE(p + 4);
    if (size < 8 || p + size > b.length) coverageLost([`${rel}: AndroidManifest.xml chunk 0x${type.toString(16)} at ${p} declares size ${size}, which does not fit.`]);
    if (type === RES_STRING_POOL) {
      strings = stringPool(b, p, rel);
    } else if (type === RES_XML_RESOURCE_MAP) {
      resIds = [];
      for (let q = p + headerSize; q + 4 <= p + size; q += 4) resIds.push(b.readUInt32LE(q));
    } else if (type === RES_XML_START_ELEMENT) {
      if (!strings) coverageLost([`${rel}: AndroidManifest.xml has an element before its string pool.`]);
      const ext = p + headerSize;
      const tag = strings[b.readUInt32LE(ext + 4)];
      const attrStart = b.readUInt16LE(ext + 8);
      const attrSize = b.readUInt16LE(ext + 10);
      const attrCount = b.readUInt16LE(ext + 12);
      const attrs = new Map();
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize;
        const nsIdx = b.readUInt32LE(a);
        const nameIdx = b.readUInt32LE(a + 4);
        const rawIdx = b.readUInt32LE(a + 8);
        const dataType = b[a + 15];
        const data = b.readUInt32LE(a + 16);
        const ns = nsIdx === NO_INDEX ? '' : strings[nsIdx];
        const byId = nameIdx < resIds.length ? ATTR_BY_ID.get(resIds[nameIdx]) : undefined;
        const name = byId ?? strings[nameIdx];
        let value;
        if (rawIdx !== NO_INDEX) value = strings[rawIdx];
        else if (dataType === 0x12) value = data !== 0;
        else if (dataType === 0x10 || dataType === 0x11) value = data | 0;
        else if (dataType === 0x03) value = strings[data];
        else if (dataType === 0x01) value = `@ref/0x${data.toString(16).padStart(8, '0')}`;
        else value = `#type${dataType}:${data}`;
        attrs.set(ns === ANDROID_NS ? `android:${name}` : name, value);
      }
      const node = { tag, attrs, children: [], parent: cur };
      cur.children.push(node);
      cur = node;
      elements++;
    } else if (type === RES_XML_END_ELEMENT) {
      if (!cur.parent) coverageLost([`${rel}: AndroidManifest.xml closes more elements than it opens.`]);
      cur = cur.parent;
    }
    p += size;
  }
  if (cur !== root) coverageLost([`${rel}: AndroidManifest.xml ends with <${cur.tag}> still open — the file is truncated.`]);
  return { root, elements, strings: strings ?? [] };
}

const walk = (n, fn) => { fn(n); for (const c of n.children) walk(c, fn); };
const isTrue = (v) => v === true || v === 'true';
const isFalse = (v) => v === false || v === 'false';

// ── the artefact ─────────────────────────────────────────────────────────────
const rel = artifacts[0];
const abs = resolve(ROOT, rel);
if (!existsSync(abs) || !statSync(abs).isFile()) {
  coverageLost([
    `${rel} does not exist (looked at ${abs}).`,
    'The build step did not produce what this step claims to check, and "nothing to check" is not a pass.',
  ]);
}
const zipBuf = readFileSync(abs);
const manifestEntry = zipEntries(zipBuf, rel).find((e) => e.name === 'AndroidManifest.xml');
if (!manifestEntry) {
  coverageLost([
    `${rel} has no top-level AndroidManifest.xml entry.`,
    'Every .apk carries one. (An .aab carries a PROTOBUF manifest at base/manifest/ instead, which this reader does',
    'not decode — pass the .apk the same build produced.)',
  ]);
}
const { root, elements, strings } = decodeAxml(readEntry(zipBuf, manifestEntry, rel), rel);
const manifest = root.children.find((n) => n.tag === 'manifest');
const application = manifest && manifest.children.find((n) => n.tag === 'application');
if (!manifest || !application) {
  coverageLost([
    `${rel}: decoded ${elements} element(s) and found ${manifest ? 'no <application>' : 'no <manifest> root'}.`,
    'A manifest this guard cannot find the application element in is one whose six items went unjudged.',
  ]);
}
const usesSdk = manifest.children.find((n) => n.tag === 'uses-sdk');
const targetSdk = usesSdk ? usesSdk.attrs.get('android:targetSdkVersion') : undefined;
if (!Number.isInteger(targetSdk)) {
  coverageLost([
    `${rel}: <uses-sdk android:targetSdkVersion> is ${JSON.stringify(targetSdk ?? null)}, not an integer.`,
    'Items V3 and V5 both turn on the platform defaults of the target SDK; without it neither can be decided.',
  ]);
}
const pkg = manifest.attrs.get('package');

// ── V1 debuggable ────────────────────────────────────────────────────────────
if (isTrue(application.attrs.get('android:debuggable'))) {
  problems.push(`V1 debuggable — <application android:debuggable="true">. A debuggable release lets anyone attach a debugger and read the process (MobSF: high).`);
}

// ── V2 allowBackup ───────────────────────────────────────────────────────────
const allowBackup = application.attrs.get('android:allowBackup');
if (!isFalse(allowBackup)) {
  problems.push(
    `V2 allowBackup — <application android:allowBackup> is ${allowBackup === undefined ? 'ABSENT, which Android reads as TRUE' : JSON.stringify(allowBackup)}. ` +
      'Set android:allowBackup="false" in apps/<app>/android/app/src/main/AndroidManifest.xml: a backup lifts the app\'s private files off the device.',
  );
}

// ── V3 cleartext ─────────────────────────────────────────────────────────────
const cleartext = application.attrs.get('android:usesCleartextTraffic');
const nsc = application.attrs.get('android:networkSecurityConfig');
if (isTrue(cleartext)) {
  problems.push('V3 cleartext — <application android:usesCleartextTraffic="true">. Every HTTP request may leave the device unencrypted.');
} else if (cleartext === undefined && targetSdk < 28) {
  problems.push(`V3 cleartext — usesCleartextTraffic is absent and targetSdkVersion is ${targetSdk}; below 28 the platform default is TRUE. Declare it false.`);
}
if (nsc !== undefined) {
  coverageLost([
    `${rel}: <application android:networkSecurityConfig="${nsc}"> is set, so cleartext policy lives in that XML resource.`,
    'This guard does not decode resources, and judging only the attribute would pass a config that permits cleartext.',
    'Extend the guard to read res/xml before shipping a network security config.',
  ]);
}

// ── V4 secrets ───────────────────────────────────────────────────────────────
// Shapes, not entropy: an entropy test fires on every obfuscated class name.
const SECRET_SHAPES = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['Stripe secret key', /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}/],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
  ['GitHub token', /\bgh[pousr]_[0-9A-Za-z]{36,}/],
  ['PEM private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['URL with embedded credentials', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i],
];
const SECRET_NAME = /(?:secret|api[_.-]?key|apikey|token|password|passwd|private[_.-]?key|client[_.-]?secret|dsn)/i;
let attrValuesScanned = 0;
walk(root, (n) => {
  for (const [k, v] of n.attrs) {
    if (typeof v !== 'string') continue;
    attrValuesScanned++;
    for (const [label, re] of SECRET_SHAPES) {
      if (re.test(v)) problems.push(`V4 secrets — <${n.tag} ${k}> has the shape of a ${label}. A manifest is plain text to apktool.`);
    }
  }
  if (n.tag === 'meta-data') {
    const mdName = n.attrs.get('android:name');
    const mdValue = n.attrs.get('android:value');
    if (typeof mdName === 'string' && SECRET_NAME.test(mdName) && typeof mdValue === 'string' && mdValue.length >= 8) {
      problems.push(`V4 secrets — <meta-data android:name="${mdName}"> carries a literal ${mdValue.length}-character value. A credential-named value in the manifest is readable by anyone holding the .apk.`);
    }
  }
});
if (attrValuesScanned === 0) {
  coverageLost([`${rel}: ${elements} element(s) decoded and ZERO string attribute values scanned — the secret item ranged over nothing.`]);
}

// ── V5 exported components ───────────────────────────────────────────────────
const COMPONENTS = new Set(['activity', 'activity-alias', 'service', 'receiver', 'provider']);
const appPermission = application.attrs.get('android:permission');
// ⏱ 2026-09-23 · THE ONE RECORDED DEEP LINK — the auth callback, and why it is
// not a hole. Sign-up confirmation, OAuth, identity linking and password reset
// all end with gotrue redirecting the browser to
// `com.nikatru.<app id>://auth-callback?nk_auth=<flow>&code=…`; the launcher
// activity must take that VIEW intent or a native user can never finish any of
// them. What another app on the device gains by starting it: nothing — the
// `code` is a PKCE code, and exchanging it needs the verifier this installation
// generated and kept (gotrue's code_verifier storage). A forged URL fails the
// exchange; it cannot sign anyone in. So the exemption is EXACT: action VIEW
// only, categories BROWSABLE (+ DEFAULT) only, <data> naming this app's scheme
// and host `auth-callback` and nothing else — no other scheme, no http(s), no
// path wildcards. Any other deep link still fails here, and is still a decision
// to record with its reason. The scheme's single source is
// `authCallbackScheme()` in packages/auth_supabase/lib/src/auth_redirect.dart;
// tooling/ci/assert-auth-callbacks.mjs holds the SOURCE manifest to it.
const AUTH_CALLBACK_SCHEME = `com.nikatru.${APP}`;
const AUTH_CALLBACK_HOST = 'auth-callback';
const kidsOf = (f, tag) => f.children.filter((x) => x.tag === tag);
const namesOf = (f, tag) => kidsOf(f, tag).map((x) => x.attrs.get('android:name'));
const isLauncherFilter = (f) => {
  const actions = namesOf(f, 'action');
  const others = f.children.filter((x) => x.tag !== 'action' && x.tag !== 'category');
  return actions.length === 1 && actions[0] === 'android.intent.action.MAIN' && namesOf(f, 'category').includes('android.intent.category.LAUNCHER') && others.length === 0;
};
const isAuthCallbackFilter = (f) => {
  const actions = namesOf(f, 'action');
  const cats = namesOf(f, 'category');
  const datas = kidsOf(f, 'data');
  const others = f.children.filter((x) => !['action', 'category', 'data'].includes(x.tag));
  // <data> elements in one filter COMBINE (every scheme × every host), so each
  // must name only this scheme and this host, and together they must name both.
  const dataExact = datas.every((d) =>
    [...d.attrs.keys()].every((k) => k === 'android:scheme' || k === 'android:host') &&
    [undefined, AUTH_CALLBACK_SCHEME].includes(d.attrs.get('android:scheme')) &&
    [undefined, AUTH_CALLBACK_HOST].includes(d.attrs.get('android:host')));
  return (
    actions.length === 1 && actions[0] === 'android.intent.action.VIEW' &&
    cats.includes('android.intent.category.BROWSABLE') &&
    cats.every((c) => c === 'android.intent.category.BROWSABLE' || c === 'android.intent.category.DEFAULT') &&
    others.length === 0 && datas.length > 0 && dataExact &&
    datas.some((d) => d.attrs.get('android:scheme') === AUTH_CALLBACK_SCHEME) &&
    datas.some((d) => d.attrs.get('android:host') === AUTH_CALLBACK_HOST)
  );
};
const exportedSeen = [];
let componentCount = 0;
for (const c of application.children.filter((n) => COMPONENTS.has(n.tag))) {
  componentCount++;
  const name = c.attrs.get('android:name') ?? '(unnamed)';
  const filters = c.children.filter((n) => n.tag === 'intent-filter');
  const exp = c.attrs.get('android:exported');
  // Absent `exported`: before API 31 a component with an intent-filter is
  // exported; a provider is exported by default only at targetSdk <= 16.
  const exported = isTrue(exp) || (exp === undefined && (c.tag === 'provider' ? targetSdk <= 16 : filters.length > 0));
  if (!exported) continue;
  const perm = c.attrs.get('android:permission') ?? appPermission;
  const protectedBy = perm
    ? `permission ${perm}`
    : c.tag === 'provider' && c.attrs.get('android:readPermission') && c.attrs.get('android:writePermission')
      ? 'read + write permissions'
      : null;
  const isActivity = c.tag === 'activity' || c.tag === 'activity-alias';
  const takesAuthCallback = isActivity && filters.some(isAuthCallbackFilter);
  const isLauncher =
    isActivity &&
    filters.some(isLauncherFilter) &&
    filters.every((f) => isLauncherFilter(f) || isAuthCallbackFilter(f));
  const launcherLabel = takesAuthCallback
    ? `launcher entry point + auth callback ${AUTH_CALLBACK_SCHEME}://${AUTH_CALLBACK_HOST}`
    : 'launcher entry point';
  exportedSeen.push(`${c.tag} ${name} — ${protectedBy ?? (isLauncher ? launcherLabel : 'UNPROTECTED')}`);
  if (!protectedBy && !isLauncher) {
    problems.push(
      `V5 exported — <${c.tag} android:name="${name}"> is exported${isTrue(exp) ? '' : ' (implicitly, by its intent-filter)'} with no protecting permission. ` +
        'Any app on the device can start or bind it. Set android:exported="false", or protect it with a signature permission; ' +
        'a BROWSABLE deep-link entry point is a decision to record in this guard with its reason, not a silent pass.',
    );
  }
}
if (componentCount === 0) {
  coverageLost([`${rel}: <application> holds ZERO components. A Flutter app always has its activity; the exported item ranged over nothing.`]);
}

// ── V6 logging, where it is decided ──────────────────────────────────────────
const analysisAbs = join(ROOT, ANALYSIS_REL);
if (!existsSync(analysisAbs)) {
  coverageLost([`${ANALYSIS_REL} does not exist, so the one inherited analyzer config that refuses print() could not be read.`]);
}
if (!/^\s+avoid_print:\s*error\s*$/m.test(readFileSync(analysisAbs, 'utf8'))) {
  problems.push(`V6 logging — ${ANALYSIS_REL} no longer raises avoid_print to severity error, so a print() in Dart code reaches device logs in a release build.`);
}
const nativeRoot = join(ROOT, 'apps', APP, 'android', 'app', 'src', 'main');
const nativeRel = `apps/${APP}/android/app/src/main`;
const onDisk = [];
const collect = (dir) => {
  for (const e of listDir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (/\.(kt|java)$/.test(e.name)) onDisk.push(p);
  }
};
for (const sub of ['kotlin', 'java']) if (existsSync(join(nativeRoot, sub))) collect(join(nativeRoot, sub));
const lsFiles = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--', `${nativeRel}/kotlin`, `${nativeRel}/java`], { encoding: 'utf8' });
if (lsFiles.status !== 0) {
  coverageLost([
    `git ls-files could not list the tracked native sources under ${nativeRel} (exit ${lsFiles.status}).`,
    'V6 grades only TRACKED Kotlin/Java, so that generated tool output (Flutter\'s GeneratedPluginRegistrant.java)',
    'is never read as app code. Outside a git work tree it cannot tell the two apart, and it will not guess.',
    String(lsFiles.stderr || '').trim().split('\n')[0] ?? '',
  ]);
}
const trackedSet = new Set(
  lsFiles.stdout.split('\0').filter((p) => /\.(kt|java)$/.test(p)).map((p) => resolve(ROOT, p)),
);
const nativeFiles = onDisk.filter((p) => trackedSet.has(resolve(p)));
for (const p of onDisk) {
  if (!trackedSet.has(resolve(p))) {
    prints.push(`V6 not graded, UNTRACKED: ${relative(ROOT, p).split(sep).join('/')} — generated or local output git does not track (release builds strip android.util.Log via R8).`);
  }
}
if (nativeFiles.length === 0) {
  coverageLost([
    `apps/${APP}/android/app/src/main holds no TRACKED .kt or .java file (${onDisk.length} on disk).`,
    'Every Flutter Android app declares its MainActivity there; finding none means --app names the wrong directory.',
  ]);
}
const LOG_CALL = /\b(?:android\.util\.)?Log\.(?:v|d|i|w|e|wtf)\s*\(|\bprintln\s*\(|System\.(?:out|err)\.print/;
for (const f of nativeFiles) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (!/^\s*(?:\/\/|\*)/.test(line) && LOG_CALL.test(line)) {
      problems.push(`V6 logging — ${relative(ROOT, f).split(sep).join('/')}:${i + 1} writes to the device log: ${line.trim()}`);
    }
  });
}
let debugPrints = 0;
const dartRoots = [join(ROOT, 'apps', APP, 'lib'), join(ROOT, 'packages')];
const countDart = (dir) => {
  for (const e of listDir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test' || e.name.startsWith('.') || e.name === 'build') continue;
      countDart(p);
    } else if (e.name.endsWith('.dart')) {
      debugPrints += (readFileSync(p, 'utf8').match(/\bdebugPrint\s*\(/g) || []).length;
    }
  }
};
for (const d of dartRoots) if (existsSync(d)) countDart(d);
prints.push(`${debugPrints} debugPrint( call site(s) in apps/${APP}/lib and packages/ — counted, not judged: debugPrint reaches logcat in release, and MobSF rates logging as info, not high.`);

// ── report ───────────────────────────────────────────────────────────────────
console.log(`${NAME}: ${rel}`);
console.log(`   package ${pkg ?? '(none)'} · targetSdkVersion ${targetSdk} · ${elements} element(s) · ${strings.length} string(s) · ${componentCount} component(s)`);
for (const e of exportedSeen) console.log(`   exported: ${e}`);
console.log(`   ${nativeFiles.length} native source file(s) read for log calls`);
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('');
  console.error('  apps.gov.in runs MobSF over this exact file; each of these is a finding it prints. Register row');
  console.error('  O-APPS-GOV-IN-VAPT-CHECKLIST.');
  console.error(`\n${NAME}: FAILED`);
  process.exit(1);
}

console.log('');
console.log(`${NAME}: OK — V1 debuggable, V2 allowBackup, V3 cleartext, V4 secrets (${attrValuesScanned} value(s)), V5 exported (${exportedSeen.length} exported, all protected or the launcher), V6 logging`);
