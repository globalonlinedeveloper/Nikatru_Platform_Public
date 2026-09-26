#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// dump-aab-permissions.mjs — read the permission set a built Android App Bundle
// actually carries, out of the bytes Play would receive, and prove the reading
// with a second decoder on a second artefact of the same build.
//
// Register row: O-PLAY-DATA-SAFETY-FROM-A-STALE-RUN. Its consumer is
// assert-play-declarations.mjs `--merged-dump <file>` (limb M), which compares
// the set written here to androidPermissions.merged in the app's
// store/android-play/data-safety.json.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// Until this file, `merged.permissions` was typed by hand from ONE decode of ONE
// downloaded .aab (run 34345368085, 2026-09-09), and the record said so: "ONE
// decoder on one artefact where the 2026-08-26 record had two on two". The next
// plugin that added a permission (the billing plugin, com.android.vending.BILLING)
// was then declared in prose as something that "has to be re-taken". A sworn
// list is only as current as its last reading, so every Android build now takes
// the reading, and the declaration is graded against it.
//
// ── HOW IT READS ─────────────────────────────────────────────────────────────
//   1. The .aab: base/manifest/AndroidManifest.xml is NOT binary AXML. It is a
//      serialized aapt2 `XmlNode` protobuf (Resources.proto). The protobuf wire
//      walker below decodes only the four messages a manifest uses: XmlNode,
//      XmlElement, XmlAttribute and the repeated child list.
//   2. The Play .apk of the same job: its AndroidManifest.xml is binary AXML,
//      read by android-zip.mjs (the VAPT guard's decoder).
//   Both sets are the android:name of every <uses-permission>,
//   <uses-permission-sdk-23> and <permission> directly under <manifest>, with an
//   element carrying tools:node="remove" skipped. The two sets must be EQUAL.
//
// ⚠️ NO bundletool AND NO aapt2, ON PURPOSE. Neither is pinned by this repository;
// the reason is in assert-android-vapt-manifest.mjs's header. A dumper that
// shells out to a tool that may be absent cannot tell "tool absent" from "set
// empty", and that ambiguity is what the row exists to remove.
//
// ── EXITS ────────────────────────────────────────────────────────────────────
//   0  both decoders read the same non-empty set; --out is written.
//   1  the .aab and the .apk disagree. Nothing is written: two decoders on two
//      artefacts of one build must not be averaged into a record.
//   2  COVERAGE LOST: a missing argument or file, an archive without its
//      manifest entry, a manifest neither decoder can read, or an EMPTY set (a
//      real Flutter release carries at least INTERNET, so empty is a reader that
//      read nothing, not an app that asks for nothing).
//
// Usage:
//   node tooling/ci/dump-aab-permissions.mjs --aab <app-release.aab> --apk <app-release.apk> \
//     --out <file.json> [--run-id <id>] [--commit <sha>] [--artifact <name>]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { zipEntries, readEntry, decodeAxml, ANDROID_NS } from './android-zip.mjs';

const NAME = 'dump-aab-permissions';
const AAB_ENTRY = 'base/manifest/AndroidManifest.xml';
const TOOLS_NS = 'http://schemas.android.com/tools';
const PERMISSION_TAGS = new Set(['uses-permission', 'uses-permission-sdk-23', 'permission']);
const USAGE = `Usage: node tooling/ci/${NAME}.mjs --aab <app-release.aab> --apk <app-release.apk> --out <file.json> [--run-id <id>] [--commit <sha>] [--artifact <name>]`;

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error(`\n${NAME}: FAILED`);
  process.exit(2);
}

// ── arguments ────────────────────────────────────────────────────────────────
const FLAGS = ['--aab', '--apk', '--out', '--run-id', '--commit', '--artifact'];
const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i += 2) {
  const flag = argv[i];
  if (!FLAGS.includes(flag)) coverageLost([`unknown argument ${JSON.stringify(flag)}.`, USAGE]);
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) coverageLost([`${flag} needs a value.`, USAGE]);
  opts[flag.slice(2)] = value;
}
for (const need of ['aab', 'apk', 'out']) {
  if (!opts[need]) coverageLost([`--${need} is required.`, USAGE]);
}

// Read once and catch the absence: an exists-then-read pair races the file
// (CodeQL js/file-system-race).
function readArtefact(path, kind) {
  const abs = resolve(path);
  try {
    return readFileSync(abs);
  } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'EISDIR' && e.code !== 'ENOTDIR') throw e;
    coverageLost([
      `the ${kind} ${path} does not exist (looked at ${abs}).`,
      'The build step did not produce what this step claims to read, and "nothing to read" is not an empty set.',
    ]);
  }
}

// ── protobuf wire walker ─────────────────────────────────────────────────────
// Wire types 0 (varint), 1 (fixed64), 2 (length-delimited) and 5 (fixed32).
// Groups (3, 4) are deprecated and aapt2 never writes them: a refusal, as is any
// length or varint that runs past its message.
function protoFields(b, start, end, what) {
  const out = [];
  let p = start;
  const varint = () => {
    let value = 0;
    for (let shift = 0; shift < 70; shift += 7) {
      if (p >= end) coverageLost([`${AAB_ENTRY}: a varint in ${what} runs past the end of its message at byte ${p}.`]);
      const byte = b[p++];
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
    }
    coverageLost([`${AAB_ENTRY}: a varint in ${what} is longer than ten bytes at byte ${p}.`]);
  };
  while (p < end) {
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      out.push({ field, wire, value: varint() });
    } else if (wire === 1 || wire === 5) {
      const len = wire === 1 ? 8 : 4;
      if (p + len > end) coverageLost([`${AAB_ENTRY}: a fixed-width field ${field} in ${what} runs past its message.`]);
      out.push({ field, wire, start: p, end: p + len });
      p += len;
    } else if (wire === 2) {
      const len = varint();
      if (p + len > end) coverageLost([`${AAB_ENTRY}: field ${field} in ${what} declares ${len} bytes and only ${end - p} remain.`]);
      out.push({ field, wire, start: p, end: p + len });
      p += len;
    } else {
      coverageLost([`${AAB_ENTRY}: field ${field} in ${what} has wire type ${wire}, which an aapt2 XmlNode never carries.`]);
    }
  }
  return out;
}

const text = (b, f) => b.toString('utf8', f.start, f.end);
function lengthDelimited(f, what) {
  if (f.wire !== 2) coverageLost([`${AAB_ENTRY}: field ${f.field} of ${what} has wire type ${f.wire} where aapt2 writes a length-delimited value — this is not an XmlNode.`]);
  return f;
}

// XmlAttribute: 1 namespace_uri, 2 name, 3 value, 4 source, 5 resource_id, 6 compiled_item.
function protoAttribute(b, f) {
  const attr = { ns: '', name: '', value: '' };
  for (const g of protoFields(b, f.start, f.end, 'an XmlAttribute')) {
    if (g.field === 1) attr.ns = text(b, lengthDelimited(g, 'XmlAttribute'));
    else if (g.field === 2) attr.name = text(b, lengthDelimited(g, 'XmlAttribute'));
    else if (g.field === 3) attr.value = text(b, lengthDelimited(g, 'XmlAttribute'));
  }
  return attr;
}

// XmlNode: 1 element, 2 text, 3 source. XmlElement: 1 namespace_declaration,
// 2 namespace_uri, 3 name, 4 attribute, 5 child (an XmlNode).
function protoNode(b, start, end, depth) {
  if (depth > 64) coverageLost([`${AAB_ENTRY}: elements nest deeper than 64 levels — not a manifest.`]);
  let element = null;
  for (const f of protoFields(b, start, end, 'an XmlNode')) {
    if (f.field !== 1) continue;
    lengthDelimited(f, 'XmlNode');
    element = { tag: '', attrs: [], children: [] };
    for (const g of protoFields(b, f.start, f.end, 'an XmlElement')) {
      if (g.field === 3) element.tag = text(b, lengthDelimited(g, 'XmlElement'));
      else if (g.field === 4) element.attrs.push(protoAttribute(b, lengthDelimited(g, 'XmlElement')));
      else if (g.field === 5) {
        lengthDelimited(g, 'XmlElement');
        const child = protoNode(b, g.start, g.end, depth + 1);
        if (child) element.children.push(child);
      }
    }
  }
  return element;
}

// ── the two readings ─────────────────────────────────────────────────────────
function permissionsOf(children, attrOf, where) {
  const names = new Set();
  for (const c of children) {
    if (!PERMISSION_TAGS.has(c.tag)) continue;
    if (attrOf(c, TOOLS_NS, 'node') === 'remove') continue;
    const name = attrOf(c, ANDROID_NS, 'name');
    if (typeof name !== 'string' || name === '') {
      coverageLost([`${where}: a <${c.tag}> element carries no readable android:name — the set would silently lose it.`]);
    }
    names.add(name);
  }
  return names;
}

function aabPermissions(path) {
  const buf = readArtefact(path, '.aab');
  const entry = zipEntries(buf, path, coverageLost).find((e) => e.name === AAB_ENTRY);
  if (!entry) {
    coverageLost([
      `${path} has no ${AAB_ENTRY} entry.`,
      'Every Android App Bundle carries its base module manifest there; an archive without it is not the bundle Play receives.',
    ]);
  }
  const bytes = readEntry(buf, entry, path, coverageLost);
  const root = protoNode(bytes, 0, bytes.length, 0);
  if (!root || root.tag !== 'manifest') {
    coverageLost([`${path}: ${AAB_ENTRY} decodes to <${root ? root.tag : 'nothing'}>, not <manifest>.`]);
  }
  const attrOf = (el, ns, name) => el.attrs.find((a) => a.ns === ns && a.name === name)?.value;
  return permissionsOf(root.children, attrOf, `${path}!${AAB_ENTRY}`);
}

function apkPermissions(path) {
  const buf = readArtefact(path, '.apk');
  const entry = zipEntries(buf, path, coverageLost).find((e) => e.name === 'AndroidManifest.xml');
  if (!entry) coverageLost([`${path} has no top-level AndroidManifest.xml entry — it is not an .apk.`]);
  const { root } = decodeAxml(readEntry(buf, entry, path, coverageLost), path, coverageLost);
  const manifest = root.children.find((c) => c.tag === 'manifest');
  if (!manifest) coverageLost([`${path}: AndroidManifest.xml has no <manifest> root element.`]);
  // decodeAxml keys an android attribute as `android:<name>` and any other by its bare name.
  const attrOf = (el, ns, name) => el.attrs.get(ns === ANDROID_NS ? `android:${name}` : name);
  return permissionsOf(manifest.children, attrOf, `${path}!AndroidManifest.xml`);
}

const fromAab = aabPermissions(opts.aab);
const fromApk = apkPermissions(opts.apk);

if (fromAab.size === 0 || fromApk.size === 0) {
  coverageLost([
    `a decoder read ZERO permissions (${opts.aab}: ${fromAab.size}, ${opts.apk}: ${fromApk.size}).`,
    'A Flutter release build carries at least android.permission.INTERNET; an empty set is a reader that read nothing.',
  ]);
}

const onlyAab = [...fromAab].filter((n) => !fromApk.has(n)).sort();
const onlyApk = [...fromApk].filter((n) => !fromAab.has(n)).sort();
if (onlyAab.length || onlyApk.length) {
  console.error('');
  for (const n of onlyAab) console.error(`FAIL ${n} is in the .aab (${opts.aab}) and NOT in the .apk (${opts.apk}).`);
  for (const n of onlyApk) console.error(`FAIL ${n} is in the .apk (${opts.apk}) and NOT in the .aab (${opts.aab}).`);
  console.error('     Two decoders on two artefacts of one build disagree. Nothing is written: find which reading is wrong.');
  console.error(`\n${NAME}: FAILED`);
  process.exit(1);
}

const permissions = [...fromAab].sort();
const record = {
  schema: 1,
  runId: opts['run-id'] ?? null,
  commit: opts.commit ?? null,
  artifact: opts.artifact ?? null,
  entry: AAB_ENTRY,
  method: 'dump-aab-permissions.mjs protobuf + apk AXML cross-check',
  measuredOn: new Date().toISOString().slice(0, 10),
  permissions,
};
const out = resolve(opts.out);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);

console.log(`${NAME}: ${permissions.length} permission(s), the .aab protobuf and the .apk AXML agree — run ${record.runId ?? '(none given)'}, commit ${record.commit ?? '(none given)'}`);
for (const n of permissions) console.log(`   ${n}`);
console.log(`   written to ${opts.out}`);
