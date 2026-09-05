/* Shared late-render harness for the attempt-six corpus.
 *
 * Fires a page mutation AFTER the redaction scan has run, without being able to
 * observe the scan. A content script lives in an isolated world, so nothing the
 * page defines in JS — an expando, a property override, a patched prototype —
 * is visible to it; the only channel that crosses is the DOM.
 *
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
  var DELAY_MS = Number(new URLSearchParams(location.search).get('delay') || 2600);
  var F = window.__fsFixture = {
    kind: kind, fired: false, firedAt: null, cssSeenAt: null,
    delayMs: DELAY_MS, reapplied: 0, timeline: []
  };
  var t0 = Date.now();
  var slot = document.getElementById('slot');

  var tick = setInterval(function () {
    if (F.timeline.length < 400) {
      F.timeline.push([Date.now() - t0, Math.round(window.scrollY)]);
    }
  }, 100);

  function fire() {
    if (F.fired) return;
    F.fired = true;
    F.firedAt = Date.now() - t0;
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
