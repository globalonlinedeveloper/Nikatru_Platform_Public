/* zip-time.mjs — the ONE timestamp every package in this family is written with.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

   A fixed timestamp is the whole determinism story: same inputs, same bytes, so
   a rebuild that changes the file is a change in the CODE and can be diffed.
   The value is 1 Jan 2026, 00:00, in the MS-DOS date/time encoding a zip local
   and central header carry (date = (year-1980)<<9 | month<<5 | day; time 0).

   Until 2026-09-19 it was written out three times: scripts/pack.mjs,
   templates/tool/publish/pack.mjs and Extension/Full_Screen_Shot/publish/
   package.node.js, with comments saying the copies could not disagree while
   nothing compared them. The first two now import it from here.
   package.node.js is CommonJS and keeps its own copy; the value of that copy
   is compared with this one by tooling/ci/test/extensions-shared-constants.test.mjs. */

export const DOS_TIME = 0x0000;
export const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
