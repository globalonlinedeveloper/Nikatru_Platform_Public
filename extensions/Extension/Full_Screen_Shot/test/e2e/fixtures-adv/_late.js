/* Shared late-render harness for the attempt-six corpus.
 *
 * Fires a page mutation AFTER the redaction scan has run, without being able to
 * observe the scan. A content script lives in an isolated world, so nothing the
 * page defines in JS — an expando, a property override, a patched prototype —
 * is visible to it; the only channel that crosses is the DOM.
 *
 * ── THE TRIGGER, REPAIRED 2026-09-19 — `after-scan`, and it is the default ──
 * The timed trigger below it DID NOT REPRODUCE: adversarial-claim.mjs recorded
 * `L3 inconclusive run — not graded — setup=false legible=true` on late-swap,
 * i.e. the swap never fired while the capture ran, and a shape that does not
 * reproduce cannot be graded by anybody. The repair takes the timing out.
 *
 * The DOM DOES say when the scan is over, and it says it through an element the
 * fixture owns. content/capture.js runs collectPIIBoxes ONCE, before its frame
 * loop, and at the top of the SECOND frame (i === 1) calls hideFixedElements(),
 * which writes `visibility: hidden !important` into the inline style of every
 * position:fixed element on the page. Nothing earlier in a capture writes that
 * property on a page element (every `setProperty('visibility', 'hidden'` in
 * content/ is at or after that call). So this harness puts one small fixed
 * element on the page — `#fs-late-hook` — and fires the moment its style says
 * hidden: strictly after the scan, after frames 0 and 1, and before frame 2 is
 * grabbed (the capture awaits a frame and its settle delay first). The slot
 * each fixture fills sits below 1600px, so it is first in view at frame 2.
 *
 * It depends on the capture's `hideFixed` setting, which defaults on and which
 * the suites never touch, and on the page being taller than one viewport. If
 * either stops holding the hook never fires, `fired` stays false, and the
 * grader's setup check goes RED rather than inconclusive: a harness that did
 * not reproduce has to be loud now that the shape is graded.
 *
 * `?trigger=timed` restores the old behaviour below, for comparison.
 *
 * ── THE TIMED TRIGGER, as it stood before 2026-09-19 ──
 * The marker used is `<style id="__fullshot-css">`, which content/capture.js
 * appends to documentElement at the top of a capture (injectCaptureCss, line
 * 163, invoked at 1626). That is BEFORE the pre-scroll phase and therefore
 * before collectPIIBoxes, so it says "a capture has begun", not "the scan is
 * done". DELAY_MS waits out the pre-scroll phase.
 *
 * Because the timing is approximate, the fixture reports everything the grader
 * needs to decide whether the run proved anything: `fired`, `firedAt`, and the
 * scroll timeline. The grader's rule is that a finding requires fired === true
 * AND scan.matched === 0 (proof the scan ran first — otherwise the paragraph
 * would have matched) AND the marker colour surviving into the delivered PNG.
 * Any other combination is reported inconclusive and is not graded.
 */
function fsLateFixture(kind, apply) {
  var q = new URLSearchParams(location.search);
  var TRIGGER = q.get('trigger') === 'timed' ? 'timed' : 'after-scan';
  var DELAY_MS = Number(q.get('delay') || 2600);
  var F = window.__fsFixture = {
    kind: kind, trigger: TRIGGER, fired: false, firedAt: null, firedScrollY: null,
    cssSeenAt: null, delayMs: DELAY_MS, reapplied: 0, slotTop: null, timeline: []
  };
  var t0 = Date.now();
  var slot = document.getElementById('slot');
  try { F.slotTop = Math.round(slot.getBoundingClientRect().top + window.scrollY); } catch (_) {}

  var tick = setInterval(function () {
    if (F.timeline.length < 400) {
      F.timeline.push([Date.now() - t0, Math.round(window.scrollY)]);
    }
  }, 100);

  function fire() {
    if (F.fired) return;
    F.fired = true;
    F.firedAt = Date.now() - t0;
    F.firedScrollY = Math.round(window.scrollY);
    apply(slot);
    /* Re-apply for the rest of the capture. A capture that re-lays-out the page
       (inline unroll, virtual list unroll) can replace subtrees wholesale; the
       shape under test is content that is PRESENT WHEN THE FRAME IS TAKEN, so
       it has to stay present for every remaining frame. */
    var keep = setInterval(function () {
      apply(slot); F.reapplied++;
      if (Date.now() - t0 > 180000) clearInterval(keep);
    }, 120);
  }

  if (TRIGGER === 'after-scan') {
    var hook = document.createElement('div');
    hook.id = 'fs-late-hook';
    hook.setAttribute('aria-hidden', 'true');
    /* Page-coloured and 6px square: it is furniture, not content. */
    hook.style.cssText = 'position:fixed;right:0;bottom:0;width:6px;height:6px;background:#fbfbfd';
    document.body.appendChild(hook);
    new MutationObserver(function (recs, obs) {
      if (hook.style.getPropertyValue('visibility') === 'hidden') {
        obs.disconnect();
        F.cssSeenAt = Date.now() - t0;
        fire();
      }
    }).observe(hook, { attributes: true, attributeFilter: ['style'] });
    setTimeout(function () { clearInterval(tick); }, 200000);
    return;
  }

  function armed() {
    F.cssSeenAt = Date.now() - t0;
    setTimeout(fire, DELAY_MS);
  }

  if (document.getElementById('__fullshot-css')) armed();
  else {
    new MutationObserver(function (recs, obs) {
      for (var i = 0; i < recs.length; i++) {
        var added = recs[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType === 1 && n.id === '__fullshot-css') { obs.disconnect(); armed(); return; }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* Belt and braces: if the capture never announces itself (a future rename of
     the style id would do that silently), fall back to a wall clock so the run
     still produces an answer rather than a mystery. The grader can tell the two
     apart from `cssSeenAt`. */
  setTimeout(function () { if (!F.fired) fire(); }, 20000);
  setTimeout(function () { clearInterval(tick); }, 200000);
}
