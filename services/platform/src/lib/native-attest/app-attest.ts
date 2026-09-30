// ─────────────────────────────────────────────────────────────────────────────
// app-attest.ts — Apple App Attest (DeviceCheck), server side: verify a KEY's
// attestation once, when the install registers it, and an ASSERTION on every
// sign-in call after that (⏱ 2026-09-29, ADR no.NNN).
//
// The steps are Apple's own, "Validating apps that connect to your server"
// (developer.apple.com/documentation/devicecheck), numbered as there:
//
//   ATTESTATION (once per key)
//     1  x5c[0] (the credential cert) chains through x5c[1] to the PINNED
//        Apple App Attestation Root CA, each link inside its validity window;
//     2  clientDataHash = SHA-256(clientData) — clientData is the protocol's
//        binding (binding.ts), so the key is tied to a server challenge;
//     3  nonce = SHA-256(authData ‖ clientDataHash);
//     4  the credential cert's 1.2.840.113635.100.8.2 extension carries nonce;
//     5  SHA-256(the credential cert's public key point) is the keyId;
//     6  authData.rpIdHash is SHA-256("<TEAM ID>.<bundle id>");
//     7  authData.counter is 0;
//     8  aaguid is "appattest" + 7 NULs (production), or "appattestdevelop"
//        only where development keys are allowed (the sandbox);
//     9  authData's credentialId is the keyId.
//   ASSERTION (every op)
//     nonce = SHA-256(authenticatorData ‖ SHA-256(clientData)); the stored key's
//     ECDSA signature over nonce verifies; rpIdHash is the App ID's; and the
//     counter is GREATER than the last one stored — the caller persists it with
//     a compare-and-set, so two replays of one assertion cannot both pass.
//
// The root is pinned here, not fetched: its self-signature was checked when it
// was committed (SHA-256 fingerprint below), and it expires 2045-03-15.
// ─────────────────────────────────────────────────────────────────────────────
import { bytesAt, decodeCbor, type Cbor } from './cbor';
import { concat, equalBytes, sha256 } from './bytes';
import { ecdsaDerToRaw, issuedBy, OID, parseCertificate, pemToDer, readOne, children, type Certificate } from './x509';

/**
 * Apple App Attestation Root CA, from
 * https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem.
 * SHA-256 fingerprint 1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32,
 * valid 2020-03-18 to 2045-03-15; self-signature verified before commit.
 */
export const APPLE_APP_ATTEST_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

const AAGUID_PRODUCTION = new TextEncoder().encode('appattest\0\0\0\0\0\0\0');
const AAGUID_DEVELOPMENT = new TextEncoder().encode('appattestdevelop');

export interface AppAttestPolicy {
  /** `<TEAM ID>.<bundle id>` — the App ID whose SHA-256 is the rpIdHash. */
  appId: string;
  /** Accept `appattestdevelop` keys (sandbox only). */
  allowDevelopment: boolean;
  /** The trust anchor, DER. Production passes the pinned Apple root; a test passes its own. */
  rootDer: Uint8Array;
  now: number;
}

export type AttestationResult = { ok: true; spki: Uint8Array } | { ok: false; why: string };

/** Verifies an attestation object for `keyId` (the raw 32-byte key identifier). */
export async function verifyAttestation(
  attestation: Uint8Array,
  keyId: Uint8Array,
  clientDataHash: Uint8Array,
  policy: AppAttestPolicy,
): Promise<AttestationResult> {
  let obj: Cbor;
  try {
    obj = decodeCbor(attestation);
  } catch {
    return { ok: false, why: 'not CBOR' };
  }
  if (!(obj instanceof Map) || obj.get('fmt') !== 'apple-appattest') return { ok: false, why: 'fmt' };
  const authData = bytesAt(obj, 'authData');
  const stmt = obj.get('attStmt');
  const x5c = stmt instanceof Map ? stmt.get('x5c') : null;
  if (!authData || !Array.isArray(x5c) || x5c.length !== 2 || !x5c.every((c) => c instanceof Uint8Array)) {
    return { ok: false, why: 'shape' };
  }

  // 1 — the chain, to the pinned root.
  let leaf: Certificate;
  let intermediate: Certificate;
  let root: Certificate;
  try {
    leaf = parseCertificate(x5c[0] as Uint8Array);
    intermediate = parseCertificate(x5c[1] as Uint8Array);
    root = parseCertificate(policy.rootDer);
  } catch {
    return { ok: false, why: 'certificate' };
  }
  if (!(await issuedBy(intermediate, root, policy.now)) || !(await issuedBy(leaf, intermediate, policy.now))) {
    return { ok: false, why: 'chain' };
  }

  // 2-4 — the nonce the credential cert carries.
  const nonce = await sha256(concat(authData, clientDataHash));
  const ext = leaf.extensions.get(OID.appleAttestNonce);
  let carried: Uint8Array | null = null;
  try {
    if (ext) {
      const tagged = children(readOne(ext))[0];
      const octets = tagged && tagged.tag === 0xa1 ? children(tagged)[0] : null;
      carried = octets && octets.tag === 0x04 ? octets.value : null;
    }
  } catch {
    carried = null;
  }
  if (!carried || !equalBytes(carried, nonce)) return { ok: false, why: 'nonce' };

  // 5 — the key is the one named.
  if (leaf.curve !== 'P-256' || !equalBytes(await sha256(leaf.point), keyId)) return { ok: false, why: 'keyId' };

  // 6-9 — authData.
  if (authData.length < 55) return { ok: false, why: 'authData' };
  if (!equalBytes(authData.subarray(0, 32), await sha256(policy.appId))) return { ok: false, why: 'rpIdHash' };
  const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
  if (counter !== 0) return { ok: false, why: 'counter' };
  const aaguid = authData.subarray(37, 53);
  const aaguidOk = equalBytes(aaguid, AAGUID_PRODUCTION) || (policy.allowDevelopment && equalBytes(aaguid, AAGUID_DEVELOPMENT));
  if (!aaguidOk) return { ok: false, why: 'aaguid' };
  const credLen = (authData[53]! << 8) | authData[54]!;
  if (authData.length < 55 + credLen || !equalBytes(authData.subarray(55, 55 + credLen), keyId)) {
    return { ok: false, why: 'credentialId' };
  }
  return { ok: true, spki: leaf.spki };
}

export type AssertionResult = { ok: true; counter: number } | { ok: false; why: string };

/** Verifies an assertion with a registered key. The caller enforces `counter > stored` atomically. */
export async function verifyAssertion(
  assertion: Uint8Array,
  spki: Uint8Array,
  clientDataHash: Uint8Array,
  appId: string,
  storedCounter: number,
): Promise<AssertionResult> {
  let obj: Cbor;
  try {
    obj = decodeCbor(assertion);
  } catch {
    return { ok: false, why: 'not CBOR' };
  }
  const signature = bytesAt(obj, 'signature');
  const authData = bytesAt(obj, 'authenticatorData');
  if (!signature || !authData || authData.length < 37) return { ok: false, why: 'shape' };
  if (!equalBytes(authData.subarray(0, 32), await sha256(appId))) return { ok: false, why: 'rpIdHash' };
  const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
  if (counter <= storedCounter) return { ok: false, why: 'counter' };
  const nonce = await sha256(concat(authData, clientDataHash));
  try {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, ecdsaDerToRaw(signature, 32), nonce);
    return ok ? { ok: true, counter } : { ok: false, why: 'signature' };
  } catch {
    return { ok: false, why: 'signature' };
  }
}

let appleRoot: Uint8Array | null = null;
/** The pinned root, DER, decoded once per isolate. */
export function appleRootDer(): Uint8Array {
  return (appleRoot ??= pemToDer(APPLE_APP_ATTEST_ROOT_PEM));
}
