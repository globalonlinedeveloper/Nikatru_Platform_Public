// ─────────────────────────────────────────────────────────────────────────────
// deploy-globs.mjs — the ONE reading of a deployUnits glob: which paths it claims.
//
// ⏱ MOVED 2026-09-26 (O-SERVICE-KIT-UNBUILT, E-a2) out of
// assert-deploy-triggers-deploy.mjs, AS IT WAS: claimedTree and globClaims are
// byte for byte what that guard held, and it re-exports both, so every importer of
// the old path reads the same function.
//
// WHY A FILE OF ITS OWN. plan-deploy.mjs runs inside the deploy workflows and
// publishes on globClaims, so everything it imports is an input of those deploys:
// assert-deploy-triggers.mjs's import limb holds each deploy unit to the closure of
// the tooling it lists, and `<app>-web` therefore had to claim the WHOLE guard file
// plan-deploy.mjs imported one function from. When that guard began reading the
// app Worker matrix (tooling/ci/worker-set.mjs, and through it
// tooling/platform-register.json), the web deploy would have had to claim the
// Worker register too, and every register edit would have redeployed every app's
// web bundle. The plan now imports only this, and `<app>-web` claims only this.
// ─────────────────────────────────────────────────────────────────────────────
import { posix } from 'node:path';

/** `services/platform/**` claims the TREE `services/platform`. Anything else
 *  claims files, not a tree, and has nothing to walk. */
export function claimedTree(glob) {
  const m = /^([^*?[\]]+)\/\*\*$/.exec(glob);
  return m ? m[1] : null;
}

/**
 * Does `glob` claim the repo-relative path `p`?
 *
 * Three shapes exist in this repository and each is answered exactly:
 * `X/**` (the tree), `X/*.ext` and `X/*` (files directly in X), and a literal
 * path. A glob of any OTHER shape returns `null` — "this reader cannot decide"
 * — and the caller turns that into COVERAGE LOST rather than into a pass. A
 * matcher that silently answers `false` for a shape it does not understand is
 * how a filter that really does claim a path gets reported as not claiming it,
 * and the fix somebody reaches for is deleting the limb.
 */
export function globClaims(glob, p) {
  const tree = claimedTree(glob);
  if (tree !== null) return p === tree || p.startsWith(`${tree}/`);
  const star = /^([^*?[\]]+)\/\*(\.[A-Za-z0-9.]+)?$/.exec(glob);
  if (star) {
    const [, dir, ext] = star;
    if (posix.dirname(p) !== dir) return false;
    return ext === undefined || p.endsWith(ext);
  }
  if (!/[*?[\]]/.test(glob)) return p === glob;
  return null;
}
