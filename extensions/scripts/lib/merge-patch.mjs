/* merge-patch.mjs — RFC 7386, the one implementation.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

   Moved here verbatim from scripts/pack.mjs on 2026-09-25 (F-b), because
   pack.mjs exports nothing and packs a tool when it is loaded, so no second
   reader could import it. Its importers: scripts/pack.mjs (the Firefox overlay
   applied at build), lib/tool-identity.mjs (the add-on id read off the merged
   manifest), and templates/tool/publish/pack.mjs plus its two verifiers (a
   stamped tool's own Firefox build). Full_Screen_Shot's CommonJS
   publish/package.node.js keeps a copy and compares it with this one as code
   (mergePatchDrift). */

/* RFC 7386 §2, all of it: a null member DELETES, an object member merges
   recursively, anything else replaces. Arrays replace wholesale — which is what
   lets an overlay state background.scripts at all. */
export function mergePatch(base, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (base !== null && typeof base === 'object' && !Array.isArray(base)) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) delete out[key];
    else out[key] = mergePatch(out[key], patch[key]);
  }
  return out;
}
