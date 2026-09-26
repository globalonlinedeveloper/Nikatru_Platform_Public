// ─────────────────────────────────────────────────────────────────────────────
// android-zip.mjs — the zip walk and the binary-AXML decoder the Android guards
// share. MOVED here from assert-android-vapt-manifest.mjs (O-PLAY-DATA-SAFETY-
// FROM-A-STALE-RUN), unchanged in behaviour, because a second reader of the same
// artefacts now needs them: tooling/ci/dump-aab-permissions.mjs cross-checks the
// Play .apk's AXML manifest against the .aab's protobuf one.
//
// 🔴 EVERY REFUSAL GOES THROUGH THE CALLER'S `refuse(lines)`. Each guard owns its
// own COVERAGE LOST line (its name, its exit code); this file only says what could
// not be read. `refuse` is expected to exit; if it returns, the call throws, so an
// archive shape nothing can read never becomes an empty entry list.
//
// ⚠️ NO aapt2, ON PURPOSE — the reason is in assert-android-vapt-manifest.mjs's
// header: build-tools is on the runner image but pinned by nothing in this
// repository, and a guard that shells out to a tool that may be absent has two
// failure modes that print alike.
// ─────────────────────────────────────────────────────────────────────────────
import { inflateRawSync } from 'node:zlib';

const refuser = (refuse) => (lines) => {
  refuse(lines);
  throw new Error(lines[0]);
};

// ── zip reader ───────────────────────────────────────────────────────────────
// The same refusing central-directory walk as assert-elf-page-alignment.mjs: an
// archive shape it cannot read is COVERAGE LOST, never an empty entry list.
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export function zipEntries(buf, rel, refuse) {
  const fail = refuser(refuse);
  let eocd = -1;
  const floor = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd === -1) fail([`${rel} has no zip end-of-central-directory record — it is not a readable .apk.`]);
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_EOCD64_LOCATOR) {
    fail([`${rel} is a ZIP64 archive and this reader does not implement ZIP64.`]);
  }
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    fail([`${rel} carries ZIP64 sentinel values in its end-of-central-directory record.`]);
  }
  const out = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) {
      fail([`${rel} central directory entry ${n} of ${count} is malformed at offset ${p}.`]);
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

export function readEntry(buf, entry, rel, refuse) {
  const fail = refuser(refuse);
  const o = entry.localOffset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== SIG_LOC) {
    fail([`${rel}: entry "${entry.name}" has no local file header at offset ${o}.`]);
  }
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const raw = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw);
    } catch (e) {
      fail([`${rel}: entry "${entry.name}" would not inflate — ${e.message}.`]);
    }
  }
  fail([`${rel}: entry "${entry.name}" uses zip compression method ${entry.method}, which this reader does not implement.`]);
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
export const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

// The platform's own attribute resource ids (android.R.attr). When a build
// strips attribute NAMES from the string pool, the resource map still carries
// these, so the attribute is identified either way.
const ATTR_BY_ID = new Map([
  [0x01010003, 'name'],
  [0x01010006, 'permission'],
  [0x01010007, 'readPermission'],
  [0x01010008, 'writePermission'],
  [0x01010009, 'protectionLevel'],
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

function stringPool(b, at, rel, fail) {
  const headerSize = b.readUInt16LE(at + 2);
  const count = b.readUInt32LE(at + 8);
  const flags = b.readUInt32LE(at + 16);
  const stringsStart = b.readUInt32LE(at + 20);
  const utf8 = (flags & 0x100) !== 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    let p = at + stringsStart + b.readUInt32LE(at + headerSize + i * 4);
    if (p >= b.length) fail([`${rel}: AndroidManifest.xml string ${i} points past the end of the file.`]);
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
export function decodeAxml(b, rel, refuse) {
  const fail = refuser(refuse);
  if (b.length < 8 || b.readUInt16LE(0) !== RES_XML) {
    fail([`${rel}: AndroidManifest.xml is not binary AXML (first chunk type 0x${b.length >= 2 ? b.readUInt16LE(0).toString(16) : '?'}).`]);
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
    if (size < 8 || p + size > b.length) fail([`${rel}: AndroidManifest.xml chunk 0x${type.toString(16)} at ${p} declares size ${size}, which does not fit.`]);
    if (type === RES_STRING_POOL) {
      strings = stringPool(b, p, rel, fail);
    } else if (type === RES_XML_RESOURCE_MAP) {
      resIds = [];
      for (let q = p + headerSize; q + 4 <= p + size; q += 4) resIds.push(b.readUInt32LE(q));
    } else if (type === RES_XML_START_ELEMENT) {
      if (!strings) fail([`${rel}: AndroidManifest.xml has an element before its string pool.`]);
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
      if (!cur.parent) fail([`${rel}: AndroidManifest.xml closes more elements than it opens.`]);
      cur = cur.parent;
    }
    p += size;
  }
  if (cur !== root) fail([`${rel}: AndroidManifest.xml ends with <${cur.tag}> still open — the file is truncated.`]);
  return { root, elements, strings: strings ?? [] };
}
