// ─────────────────────────────────────────────────────────────────────────────
// sign.mjs — Ed25519 over THE EXACT MANIFEST BYTES, and [pipeline 7]P-10's
// refusal: no production pack is signed before key custody is drill-proven.
//
// 🔴 P-10's ORIGINAL ACCEPTANCE IS DROPPED, NOT SATISFIED. It demanded "a
// recorded restore-FROM-SHARES drill". [ADR 022] (LOCKED 2026-07-27) states in as
// many words that **Shamir splitting is NOT required** — there are no shares and
// there never will be, because splitting puts a tool dependency in the restore
// path, which is the same trap [ADR 021] and F-7b exist to remove. The custody
// model is two copies that fail differently: `.claude/pack-signing.seed` (and
// therefore the Drive backup) and a printed paper copy. A criterion naming an
// artifact a locked decision abolished is permanently unsatisfiable; correct the
// evidence, not the decision.
//
// WHAT REPLACES IT, and it is red today by design: the sign step refuses a
// PRODUCTION key_id unless a dated restore-drill record exists for that key id.
// No such record exists anywhere in the tree, which is exactly what makes it
// worth writing.
//
// 🔴 WHY THE REFUSAL LIVES HERE AND NOT IN CI. The seed must never reach a
// runner. CI signs with a derived TEST key, so a CI-side assertion could never go
// red on the two failures that would strand every user — a seed that no longer
// matches pinned `k1`, or a signer writing different bytes than it signed. Those
// need the local canary, and the canary is owner-run. What CI CAN do is print the
// gap on every run, which assert-publish-gate.mjs does.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** DER prefixes for a raw 32-byte Ed25519 seed / public key. RFC 8410. */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** The CI/test signing seed, DERIVED rather than committed.
 *
 *  A committed 32-byte base64 string is a credential-shaped literal in a public
 *  repository: gitleaks' non-provider patterns are off, so it would not be caught,
 *  and a reader cannot tell a throwaway from a real one by looking. Deriving it
 *  from a fixed label means the repository holds no key material at all while the
 *  keypair stays byte-identical on every machine — which is what makes the frozen
 *  fixture's SIGNATURE reproducible (Ed25519 is deterministic: same key, same
 *  message, same 64 bytes). */
export const TEST_KEY_ID = 'test-k1';
export const testSeed = () => createHash('sha256').update('nikatru-content-pipeline-test-key-v1').digest();

export function keyPairFromSeed(seed) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) {
    throw new Error(`sign REFUSED — an Ed25519 seed is exactly 32 bytes; got ${Buffer.isBuffer(seed) ? seed.length : typeof seed}. A seed pasted in the wrong encoding is still a non-empty string and still LOOKS like a key.`);
  }
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const publicKey = createPublicKey(privateKey);
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length);
  return { privateKey, publicKey, publicKeyBase64: Buffer.from(raw).toString('base64') };
}

/** Verify a raw 64-byte signature against a base64 raw 32-byte public key — the
 *  same encoding `kContentPackPublicKeys` pins and `Ed25519PackVerifier` decodes,
 *  so a round-trip here is a round-trip through the client's own contract. */
export function verifyWithPinnedKey(publicKeyBase64, message, signature) {
  const raw = Buffer.from(publicKeyBase64, 'base64');
  if (raw.length !== 32) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
    return edVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

export const DRILL_RECORD_REL = 'tooling/legal/pack-key-drills.json';

/**
 * [pipeline 7]P-10. `{ ok, reason, record }` for a key id.
 *
 * A key id this file does not list as production is not gated — the test key is
 * not custody-relevant and pretending otherwise would make the refusal fire on
 * the one path CI can exercise, which is how a guard gets switched off.
 */
export function drillStatus(repoRoot, keyId) {
  const path = join(repoRoot, DRILL_RECORD_REL);
  if (!existsSync(path)) {
    return { ok: false, production: true, reason: `${DRILL_RECORD_REL} does not exist, so no key has a drill record and every production key id is unsigned-able` };
  }
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const production = (doc.productionKeyIds ?? []).includes(keyId);
  if (!production) return { ok: true, production: false, reason: `"${keyId}" is not a production key id` };
  const record = (doc.drills ?? []).find((d) => d.key_id === keyId);
  if (!record) return { ok: false, production: true, reason: `no drill record for production key "${keyId}"` };
  const d = record.drilled_on;
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return {
      ok: false,
      production: true,
      record,
      reason:
        `the drill record for production key "${keyId}" carries drilled_on = ${JSON.stringify(d)}. ` +
        'A restore drill that has not happened is indistinguishable from one nobody dated, and both mean the ' +
        'same thing: nobody has proven the stored copies can produce a signature pinned k1 accepts. [ADR 022]',
    };
  }
  return { ok: true, production: true, record, reason: `drilled ${d}` };
}

/**
 * Sign `manifestBytes` and write `manifest.sig`.
 *
 * @param {object} o
 * @param {string} o.outDir       the pack directory
 * @param {Buffer} o.manifestBytes THE BYTES ON DISK — never a re-serialisation
 * @param {string} o.keyId
 * @param {Buffer} o.seed
 * @param {string} o.repoRoot
 */
export function signPack({ outDir, manifestBytes, keyId, seed, repoRoot }) {
  const status = drillStatus(repoRoot, keyId);
  if (!status.ok) {
    throw new Error(
      `sign REFUSED — ${status.reason}\n` +
        '  [ADR 022] custody is TWO COPIES THAT FAIL DIFFERENTLY: .claude/pack-signing.seed (and therefore the\n' +
        '  Drive backup) and a printed paper copy. Neither is proven until a restore drill has produced a\n' +
        `  signature the pinned key accepts and the date is recorded in ${DRILL_RECORD_REL}.\n` +
        '  There are NO SHAMIR SHARES and there is no restore-from-shares drill to run — [ADR 022] abolished them.',
    );
  }
  const { privateKey, publicKeyBase64 } = keyPairFromSeed(seed);
  const signature = edSign(null, manifestBytes, privateKey);
  // Verify what we just produced against the bytes as they will be READ, not as
  // they were passed in. Cheap, and it is the only place a byte-drift between
  // "written" and "signed" can be caught without a client.
  const onDisk = readFileSync(join(outDir, 'manifest.json'));
  if (!verifyWithPinnedKey(publicKeyBase64, onDisk, signature)) {
    throw new Error('sign REFUSED — the signature does not verify against manifest.json AS WRITTEN. The signer and the writer disagree about the bytes, which produces a pack that verifies here and fails on every client.');
  }
  writeFileSync(join(outDir, 'manifest.sig'), signature);
  return { signature, publicKeyBase64, keyId };
}
