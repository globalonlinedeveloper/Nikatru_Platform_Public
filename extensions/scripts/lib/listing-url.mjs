/* listing-url.mjs — the hosts a store listing URL must never point at.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

   ⏱ 2026-09-29 (EXL-13). FullShot's store/_shared/support-url.txt was the
   public code repository's GitHub issues page. A listing URL on a code host is
   a user-facing link into the repository, and it 404s the day that repository
   goes private. Two readers hold the rule: check-store-metadata.mjs (every URL
   file under the shared listing directory) and amo-metadata.mjs (the
   support_url it sends to AMO on a first submit). */

/* A hostname is refused when it IS one of these or ends in "." + one of them. */
export const CODE_HOSTS = Object.freeze(['github.com', 'github.io', 'githubusercontent.com']);

/** The code host a URL points at, or null. An unparseable URL is null here —
 *  the https-shape limbs that call this already refuse it by name. */
export function codeHostOf(url) {
  let host;
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return null; }
  return CODE_HOSTS.find((h) => host === h || host.endsWith('.' + h)) ? host : null;
}
