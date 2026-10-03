// nikatru.com /support — "Report a problem" (lane feedback-intake, Do 9).
// Two jobs, no network of its own (the form posts same-origin to /api/report):
//   1. on submit, fill the time the form was open and a one-time key, which the
//      intake uses against scripted posts and against a double submit;
//   2. after the redirect back, say what happened, from the query the Pages
//      Function put there. Nothing is read from or written to storage.
(function () {
  'use strict';
  var form = document.querySelector('form.report');
  if (!form) return;
  var opened = Date.now();
  form.addEventListener('submit', function () {
    document.getElementById('report-elapsed').value = String(Date.now() - opened);
    var key = document.getElementById('report-key');
    if (!key.value) key.value = 'site-' + opened.toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  });
  var params = new URLSearchParams(window.location.search);
  var outcome = params.get('report');
  if (!outcome) return;
  var messages = {
    sent: 'Thank you. Your report was sent. Your report number is ',
    limited: 'Too many reports came from your network in the last hour. Please try again later, or email support@nikatru.com.',
    'too-large': 'That report is too long. Please shorten it, or email support@nikatru.com.',
    invalid: 'Please describe the problem and try again.',
    failed: 'Your report could not be sent. Please email support@nikatru.com instead.'
  };
  var box = document.getElementById('report-outcome');
  var text = messages[outcome] || messages.failed;
  if (outcome === 'sent') text += (params.get('id') || '').replace(/[^A-Z0-9-]/g, '') + '.';
  box.textContent = text;
  box.hidden = false;
})();
