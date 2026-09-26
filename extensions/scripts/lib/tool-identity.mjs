/* tool-identity.mjs — a tool's Firefox add-on id, and whether an identity value
   is still the template's placeholder. One implementation, imported by every
   script that needs either answer.

   Row: O-NEW-TOOL-HAS-NO-FIREFOX-IDENTITY.

   WHY ONE FILE. Until 2026-09-25 the add-on id <slug>@<ownerDomain> was built in
   four places — the template's publish/pack.mjs, check-store-packages.mjs,
   policy-check.mjs, and the template's publish/bump-version.mjs — and the
   placeholder test was written five different ways, one of which matched only
   REPLACE-WITH-YOUR-DOMAIN. AMO fixes an add-on's id at FIRST SIGNING, so the
   question "what id does this tool ship" is asked here and nowhere else.

   NOT MOVED HERE, ON PURPOSE: the template's publish/verify-firefox-package.node.js
   recomputes the id itself (`wantId`). It is the independent check of a built
   package; a verifier that called the producer's function would agree with the
   producer's bug.

   The house values (owner domain, support address, privacy pattern, homepage)
   are in tooling/house-identity.json, read by readHouseIdentity() below and
   graded by tooling/ci/assert-house-identity.mjs. */
import fs from 'node:fs';
import path from 'node:path';
import { mergePatch } from './merge-patch.mjs';

/** The Firefox add-on id a tool's publish/identity.json implies. */
export function geckoIdFor(identity) {
  return String(identity.slug) + '@' + String(identity.ownerDomain);
}

/** True when an identity VALUE (a domain, an add-on id, an address, a URL) is
 *  empty or still the template's placeholder. The slot token anywhere, or the
 *  reserved documentation domain at a host boundary — two tests, never one
 *  alternation (policy-check.mjs's CodeQL #48 note). */
export function isPlaceholderValue(value) {
  const s = String(value ?? '');
  if (s === '') return true;
  if (/REPLACE/i.test(s)) return true;
  if (/\.example(?:$|[/@:?#])/i.test(s)) return true;
  return false;
}

/** True when an identity's ownerDomain — the half of the add-on id nobody but
 *  the owner can choose — is empty or a placeholder. */
export function isPlaceholderIdentity(identity) {
  if (identity === null || typeof identity !== 'object') return true;
  return isPlaceholderValue(identity.ownerDomain);
}

/** The identity fields that appear in a store listing, in the order a reader
 *  checks them. check-catalog.mjs refuses a placeholder in any of them. */
export const LISTED_IDENTITY_FIELDS = ['ownerDomain', 'supportEmail', 'privacyPolicyUrl'];

/** The house identity, flattened to plain values, from
 *  <publicRoot>/tooling/house-identity.json. Returns { error } when it cannot be
 *  read; never a partial object. */
export function readHouseIdentity(publicRoot) {
  const rel = 'tooling/house-identity.json';
  const abs = path.join(publicRoot, rel);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { return { rel, error: rel + ' could not be read: ' + String(e && e.message).split('\n')[0] }; }
  const out = {};
  for (const f of ['ownerDomain', 'supportEmail', 'privacyPolicyUrlPattern', 'homepageUrl']) {
    const v = raw && raw[f] && raw[f].value;
    if (typeof v !== 'string' || v === '') return { rel, error: rel + ' ' + f + '.value is not a non-empty string' };
    out[f] = v;
  }
  return { rel, value: out };
}

/** The publish/identity.json a new tool with slug `slug` carries: the house
 *  values with {slug} expanded. */
export function identityFromHouse(house, slug) {
  return {
    slug,
    ownerDomain: house.ownerDomain,
    supportEmail: house.supportEmail,
    privacyPolicyUrl: house.privacyPolicyUrlPattern.split('{slug}').join(slug),
    homepageUrl: house.homepageUrl,
  };
}

/* RFC 7386 mergePatch is lib/merge-patch.mjs's, the one implementation
   scripts/pack.mjs also imports. Until 2026-09-25 (F-b) a verbatim copy stood
   here, compared with pack.mjs's as code; it is re-exported under the same name
   so this module's readers are unchanged. */
export { mergePatch };

function readJsonFile(abs) {
  try { return { value: JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^﻿/, '')) }; }
  catch (e) { return { error: String(e && e.message).split('\n')[0] }; }
}

/**
 * The listing id of `storeKey` when the store's target manifest DECLARES it.
 *
 * AMO reads the add-on id from the package's manifest, so on a store whose target
 * manifest (manifest.json with the target's overlay merged over it, RFC 7386)
 * carries `browser_specific_settings.gecko.id`, the listing id is not a fact the
 * store issues: it is geckoIdFor(publish/identity.json), and the manifest must
 * say the same. A store whose target manifest declares no such id (Chrome, Edge)
 * has a store-issued listing id, which only its dashboard knows.
 *
 * @param {object} o
 * @param {object} o.tool      the parsed tool.json
 * @param {string} o.storeKey  a key of tool.storeMetadata.stores
 * @param {string} o.root      the tool's own directory (the one holding tool.json)
 * @returns {null | { listingId: string|null, manifestId: string, identityId: string|null, manifest: string, problem: string|null }}
 *   null: the target manifest declares no add-on id, so the id is store-issued.
 *   problem non-null: the manifest declares one and it cannot be taken as the
 *   listing id (no identity.json, a placeholder, or two different values).
 */
export function derivedListingId({ tool, storeKey, root }) {
  const store = tool && tool.storeMetadata && tool.storeMetadata.stores && tool.storeMetadata.stores[storeKey];
  if (!store || typeof store !== 'object') {
    return { listingId: null, manifestId: '', identityId: null, manifest: '', problem: 'tool.json declares no storeMetadata.stores.' + storeKey };
  }
  const target = store.target;
  if (typeof target !== 'string' || target === '') {
    return { listingId: null, manifestId: '', identityId: null, manifest: '', problem: 'storeMetadata.stores.' + storeKey + ' names no build target, so which manifest it ships cannot be read' };
  }
  const manifestRel = typeof tool.manifest === 'string' && tool.manifest ? tool.manifest : 'manifest.json';
  const base = readJsonFile(path.join(root, manifestRel));
  if (base.error) {
    return { listingId: null, manifestId: '', identityId: null, manifest: manifestRel, problem: manifestRel + ' could not be read: ' + base.error };
  }
  const targetDecl = tool.targets && tool.targets[target];
  const overlayRel = targetDecl && typeof targetDecl.overlay === 'string' && targetDecl.overlay ? targetDecl.overlay : null;
  let merged = base.value;
  let described = manifestRel;
  if (overlayRel) {
    const ov = readJsonFile(path.join(root, overlayRel));
    if (ov.error) {
      return { listingId: null, manifestId: '', identityId: null, manifest: overlayRel, problem: overlayRel + ' could not be read: ' + ov.error };
    }
    merged = mergePatch(base.value, ov.value);
    described = manifestRel + ' + ' + overlayRel;
  }
  const bss = merged && merged.browser_specific_settings;
  const gecko = bss && typeof bss === 'object' ? bss.gecko : undefined;
  const manifestId = gecko && typeof gecko === 'object' && typeof gecko.id === 'string' ? gecko.id : '';
  if (manifestId === '') return null;

  const idRel = 'publish/identity.json';
  const id = readJsonFile(path.join(root, idRel));
  if (id.error || id.value === null || typeof id.value !== 'object') {
    return { listingId: null, manifestId, identityId: null, manifest: described,
      problem: described + ' declares the add-on id "' + manifestId + '", and ' + idRel + ' ' +
        (id.error ? 'could not be read (' + id.error + ')' : 'is not an object') + ', so the id cannot be derived' };
  }
  const identityId = geckoIdFor(id.value);
  if (isPlaceholderIdentity(id.value) || isPlaceholderValue(manifestId)) {
    return { listingId: null, manifestId, identityId, manifest: described,
      problem: 'the add-on id is a placeholder (' + described + ' says "' + manifestId + '", ' + idRel + ' implies "' + identityId + '")' };
  }
  if (manifestId !== identityId) {
    return { listingId: null, manifestId, identityId, manifest: described,
      problem: described + ' declares the add-on id "' + manifestId + '" and ' + idRel + ' implies "' + identityId + '": two values for one id' };
  }
  return { listingId: identityId, manifestId, identityId, manifest: described, problem: null };
}
