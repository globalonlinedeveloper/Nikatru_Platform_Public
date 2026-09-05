/* zip.mjs — read ONE named entry out of a store package.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

   The name is the one the spec's §1.2 `scripts/lib/` list already reserves
   (report.mjs's header notes it is not itself on that list, and names this file
   among the three that are). This is the first thing to occupy it.

   WHY THIS IS NARROW, AND WHY verify-refs.mjs KEEPS ITS OWN READER

   verify-refs.mjs's `readZipOrDie` decodes EVERY entry, verifies every CRC-32,
   detects duplicate names and builds a Map of the whole archive — because its
   question is "does every reference in this package resolve inside it". That is
   a different question from "what does this package's manifest.json say", and
   the second does not need the first's cost or its failure modes.

   So this is deliberately not a refactor of that file into a shared reader. Two
   readers exist and this comment is the record of it: one grades an archive,
   one answers a question about a single entry. What is NOT duplicated is the
   judgement — both refuse rather than guess, for the same stated reason.

   IT REFUSES RATHER THAN RETURNING NOTHING

   `null` is returned for exactly one condition: the archive is readable and the
   entry is not in it. Every other failure THROWS with a sentence, because "this
   file is not a zip" and "this zip has no manifest" are different answers, and a
   reader that flattens them into the same empty result makes a gate that reads
   an unreadable file report the same thing as one that read it and found it
   clean. That is the defect this whole family of scripts exists to refuse. */

import fs from 'node:fs';
import zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;

export class ZipUnreadable extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipUnreadable';
  }
}

/**
 * The entry named `want`, decompressed, or `null` if the archive does not
 * contain it. Throws ZipUnreadable if the archive cannot be read at all.
 *
 * @param {string} abs   absolute path to the .zip
 * @param {string} want  exact entry name, e.g. 'manifest.json'
 * @returns {Buffer|null}
 */
/**
 * Every entry NAME in the archive's central directory, in stored order.
 *
 * 🔴 ADDED 2026-08-20 SO A CHECK CAN RANGE OVER `_locales/<lang>/messages.json`
 * WITHOUT KNOWING THE LANGUAGE LIST. The alternative — reading `default_locale`
 * and checking only that one — grades the locale the developer speaks and ships
 * the other 54 unread, which is the shape of a scan that reports on a subset and
 * names the whole.
 *
 * It re-walks the same central directory `readZipEntry` does rather than sharing
 * a cursor: the walk is 12 lines, and a shared mutable position between two
 * exported readers is a bug that only appears when both are called.
 *
 * @param {string} abs   absolute path to the .zip
 * @returns {string[]}   entry names; directory entries included as stored
 */
export function listZipEntries(abs) {
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch (e) {
    throw new ZipUnreadable('cannot read ' + abs + ': ' + e.code + ' — ' + e.message);
  }
  if (buf.length < 22) {
    throw new ZipUnreadable(abs + ' is ' + buf.length + ' byte(s) long — too short to be a zip at all.');
  }
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) {
    throw new ZipUnreadable(abs + ' has no end-of-central-directory record, so it is not a readable zip.');
  }
  const count = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const cdSize = buf.readUInt32LE(eocd + 12);
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    throw new ZipUnreadable(abs + ' uses zip64 extensions, which this reader does not implement.');
  }
  if (cdOff + cdSize > buf.length) {
    throw new ZipUnreadable(abs + ' declares a central directory past the end of the file. The archive is truncated.');
  }
  const names = [];
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) {
      throw new ZipUnreadable(abs + ': central-directory entry ' + n + ' of ' + count +
        ' does not start with the expected signature at byte ' + p + '. The archive is malformed.');
    }
    const nameLen = buf.readUInt16LE(p + 28);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return names;
}

export function readZipEntry(abs, want) {
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch (e) {
    throw new ZipUnreadable('cannot read ' + abs + ': ' + e.code + ' — ' + e.message);
  }
  if (buf.length < 22) {
    throw new ZipUnreadable(abs + ' is ' + buf.length + ' byte(s) long — too short to be a zip at all.');
  }

  /* Scanned backwards because a zip may carry a trailing comment. */
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) {
    throw new ZipUnreadable(abs + ' has no end-of-central-directory record, so it is not a readable zip — ' +
      'truncated, empty, or another format wearing a .zip name.');
  }

  const count = buf.readUInt16LE(eocd + 10);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const cdSize = buf.readUInt32LE(eocd + 12);
  /* zip64 escape values. A store package is never that big, and mis-reading one
     would grade a prefix of the archive while reporting on all of it. */
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    throw new ZipUnreadable(abs + ' uses zip64 extensions, which this reader does not implement.');
  }
  if (cdOff + cdSize > buf.length) {
    throw new ZipUnreadable(abs + ' declares a central directory at ' + cdOff + '+' + cdSize +
      ' bytes, past the end of a ' + buf.length + '-byte file. The archive is truncated.');
  }

  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) {
      throw new ZipUnreadable(abs + ': central-directory entry ' + n + ' of ' + count +
        ' does not start with the expected signature at byte ' + p + '. The archive is malformed.');
    }
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === want) {
      if (lho + 30 > buf.length) {
        throw new ZipUnreadable(abs + ': entry "' + name + '" points at byte ' + lho + ', past the end of the file.');
      }
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const raw = buf.subarray(start, start + csize);
      if (raw.length !== csize) {
        throw new ZipUnreadable(abs + ': entry "' + name + '" declares ' + csize +
          ' compressed byte(s) but only ' + raw.length + ' are present. The archive is truncated.');
      }
      if (method === 0) return Buffer.from(raw);
      if (method === 8) {
        try { return zlib.inflateRawSync(raw); }
        catch (e) { throw new ZipUnreadable(abs + ': entry "' + name + '" does not inflate: ' + e.message + '.'); }
      }
      throw new ZipUnreadable(abs + ': entry "' + name + '" uses compression method ' + method +
        '. Only stored (0) and deflate (8) are written by any packer in this repository.');
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return null;
}
