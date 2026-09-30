// ─────────────────────────────────────────────────────────────────────────────
// x509.ts — the DER and X.509 subset App Attest needs: split a certificate into
// the parts a chain check reads, and verify one EC certificate's signature with
// its issuer's key (⏱ 2026-09-29, ADR no.NNN).
//
// WHY HAND-WRITTEN. The chain is Apple's (credential cert → "Apple App
// Attestation CA 1" → the pinned root), every link is ECDSA on P-256 or P-384,
// and WebCrypto verifies both. What WebCrypto lacks is a certificate parser;
// the npm ones pull hundreds of files onto the path of a sign-in decision, and
// this Worker keeps that path dependency-free. So this reads exactly the fields
// the check uses and REFUSES anything it does not understand: multi-byte tags,
// lengths past the input, trailing bytes, an algorithm that is not ECDSA.
// ─────────────────────────────────────────────────────────────────────────────
import { equalBytes, hex } from './bytes';

export class DerError extends Error {}

export interface Tlv {
  tag: number;
  /** The whole element, header included — what a signature covers. */
  raw: Uint8Array;
  /** The contents. */
  value: Uint8Array;
}

export function readTlv(buf: Uint8Array, at = 0): { tlv: Tlv; next: number } {
  if (at + 2 > buf.length) throw new DerError('truncated header');
  const tag = buf[at]!;
  if ((tag & 0x1f) === 0x1f) throw new DerError('multi-byte tag');
  let len = buf[at + 1]!;
  let head = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new DerError('unsupported length form');
    if (at + 2 + n > buf.length) throw new DerError('truncated length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i]!;
    head += n;
  }
  const end = at + head + len;
  if (end > buf.length) throw new DerError('length past input');
  return { tlv: { tag, raw: buf.subarray(at, end), value: buf.subarray(at + head, end) }, next: end };
}

export function children(parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let at = 0;
  while (at < parent.value.length) {
    const { tlv, next } = readTlv(parent.value, at);
    out.push(tlv);
    at = next;
  }
  return out;
}

/** A single top-level element spanning the whole buffer. */
export function readOne(buf: Uint8Array): Tlv {
  const { tlv, next } = readTlv(buf);
  if (next !== buf.length) throw new DerError('trailing bytes');
  return tlv;
}

// The OIDs this file compares, as their DER CONTENT bytes (hex). Compared, never decoded.
export const OID = {
  ecPublicKey: '2a8648ce3d0201', // 1.2.840.10045.2.1
  p256: '2a8648ce3d030107', // 1.2.840.10045.3.1.7
  p384: '2b81040022', // 1.3.132.0.34
  ecdsaSha256: '2a8648ce3d040302', // 1.2.840.10045.4.3.2
  ecdsaSha384: '2a8648ce3d040303', // 1.2.840.10045.4.3.3
  appleAttestNonce: '2a864886f763640802', // 1.2.840.113635.100.8.2
} as const;

export interface Certificate {
  tbs: Uint8Array;
  sigAlg: string;
  signature: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: number;
  notAfter: number;
  spki: Uint8Array;
  curve: 'P-256' | 'P-384';
  /** The uncompressed EC point (0x04 ‖ X ‖ Y). */
  point: Uint8Array;
  /** extnID (hex) → extnValue contents. */
  extensions: Map<string, Uint8Array>;
}

function time(t: Tlv): number {
  const s = new TextDecoder().decode(t.value);
  let m: RegExpMatchArray | null;
  if (t.tag === 0x17 && (m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    const yy = Number(m[1]);
    return Date.UTC(yy < 50 ? 2000 + yy : 1900 + yy, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  if (t.tag === 0x18 && (m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  throw new DerError('unsupported time');
}

export function parseCertificate(der: Uint8Array): Certificate {
  const cert = readOne(der);
  if (cert.tag !== 0x30) throw new DerError('certificate is not a SEQUENCE');
  const [tbsT, algT, sigT, ...rest] = children(cert);
  if (!tbsT || !algT || !sigT || rest.length) throw new DerError('certificate shape');
  const alg = children(algT)[0];
  if (!alg || alg.tag !== 0x06) throw new DerError('signature algorithm');
  if (sigT.tag !== 0x03 || sigT.value[0] !== 0) throw new DerError('signature BIT STRING');

  const tbs = children(tbsT);
  let i = 0;
  if (tbs[i]?.tag === 0xa0) i++; // [0] version
  i++; // serialNumber
  const innerAlg = tbs[i++];
  const issuer = tbs[i++];
  const validity = tbs[i++];
  const subject = tbs[i++];
  const spki = tbs[i++];
  if (!innerAlg || !issuer || !validity || !subject || !spki) throw new DerError('tbsCertificate shape');
  const innerOid = children(innerAlg)[0];
  if (!innerOid || !equalBytes(innerOid.value, alg.value)) throw new DerError('signature algorithms disagree');
  const [nb, na] = children(validity);
  if (!nb || !na) throw new DerError('validity');

  const [spkiAlg, spkiBits] = children(spki);
  if (!spkiAlg || !spkiBits || spkiBits.tag !== 0x03 || spkiBits.value[0] !== 0) throw new DerError('subjectPublicKeyInfo');
  const [kind, params] = children(spkiAlg);
  if (!kind || hex(kind.value) !== OID.ecPublicKey || !params) throw new DerError('not an EC key');
  const curveOid = hex(params.value);
  const curve = curveOid === OID.p256 ? 'P-256' : curveOid === OID.p384 ? 'P-384' : null;
  if (!curve) throw new DerError('unsupported curve');

  const extensions = new Map<string, Uint8Array>();
  for (; i < tbs.length; i++) {
    if (tbs[i]!.tag !== 0xa3) continue;
    const seq = children(tbs[i]!)[0];
    if (!seq) throw new DerError('extensions');
    for (const ext of children(seq)) {
      const parts = children(ext);
      const id = parts[0];
      const val = parts[parts.length - 1];
      if (!id || id.tag !== 0x06 || !val || val.tag !== 0x04) throw new DerError('extension shape');
      extensions.set(hex(id.value), val.value);
    }
  }

  return {
    tbs: tbsT.raw,
    sigAlg: hex(alg.value),
    signature: sigT.value.subarray(1),
    issuer: issuer.raw,
    subject: subject.raw,
    notBefore: time(nb),
    notAfter: time(na),
    spki: spki.raw,
    curve,
    point: spkiBits.value.subarray(1),
    extensions,
  };
}

/** DER ECDSA-Sig-Value → the fixed-width r ‖ s WebCrypto verifies. */
export function ecdsaDerToRaw(der: Uint8Array, size: 32 | 48): Uint8Array {
  const seq = readOne(der);
  const parts = children(seq);
  if (seq.tag !== 0x30 || parts.length !== 2 || parts.some((p) => p.tag !== 0x02)) throw new DerError('ECDSA signature shape');
  const out = new Uint8Array(size * 2);
  parts.forEach((p, k) => {
    let v = p.value;
    while (v.length > 1 && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new DerError('ECDSA integer too long');
    out.set(v, k * size + (size - v.length));
  });
  return out;
}

export function importEcKey(cert: Pick<Certificate, 'spki' | 'curve'>): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', cert.spki, { name: 'ECDSA', namedCurve: cert.curve }, false, ['verify']);
}

/** `child` names `parent` as issuer, is inside both validity windows at `now`, and carries parent's signature. */
export async function issuedBy(child: Certificate, parent: Certificate, now: number): Promise<boolean> {
  if (!equalBytes(child.issuer, parent.subject)) return false;
  for (const c of [child, parent]) if (now < c.notBefore || now > c.notAfter) return false;
  const hash = child.sigAlg === OID.ecdsaSha256 ? 'SHA-256' : child.sigAlg === OID.ecdsaSha384 ? 'SHA-384' : null;
  if (!hash) return false;
  try {
    const raw = ecdsaDerToRaw(child.signature, parent.curve === 'P-256' ? 32 : 48);
    return await crypto.subtle.verify({ name: 'ECDSA', hash }, await importEcKey(parent), raw, child.tbs);
  } catch {
    return false;
  }
}

/** PEM (one certificate) → DER. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}
