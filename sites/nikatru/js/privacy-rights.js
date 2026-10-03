// nikatru.com /privacy-rights — the DPDP rights request form (lane dpdp-rights, Do 2).
// The same two jobs js/report.js does for /support, no network of its own (the
// form posts same-origin to /api/report, which forwards a `privacy-request`):
//   1. on submit, fill the time the form was open and a one-time key;
//   2. after the redirect back, say what happened, from the query the Pages
//      Function put there. Nothing is read from or written to storage.
(function () {
  'use strict';
  var form = document.querySelector('form.rights');
  if (!form) return;
  var opened = Date.now();
  form.addEventListener('submit', function () {
    document.getElementById('request-elapsed').value = String(Date.now() - opened);
    var key = document.getElementById('request-key');
    if (!key.value) key.value = 'site-pr-' + opened.toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  });
  var params = new URLSearchParams(window.location.search);
  var outcome = params.get('request');
  if (!outcome) return;
  var messages = {
    sent: 'Thank you. Check your email and open the link we sent to confirm your request. We act on it only after you do.',
    limited: 'Too many requests came from your network in the last hour. Please try again later, or email support@nikatru.com.',
    'too-large': 'That request is too long. Please shorten it, or email support@nikatru.com.',
    invalid: 'Please give your email address, and for a correction or a complaint say what is wrong, then try again.',
    failed: 'Your request could not be sent. Please email support@nikatru.com instead.'
  };
  var box = document.getElementById('request-outcome');
  box.textContent = messages[outcome] || messages.failed;
  box.hidden = false;
})();
