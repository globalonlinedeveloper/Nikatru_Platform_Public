// nikatru.com /help/ and /help/fullshot/ — search over the generated index
// (lane help-search). Without this script every article is on the page and
// every "Ask us" opens the report form with category "question"; with it,
// typing narrows the articles to the ranked matches and every "Ask us" carries
// the query too (js/report.js puts it in the description, editable). Same-origin
// only: the index is /help/index.en.json and the ranker /js/help-search.mjs
// (tooling/help/search.mjs, written as built). The query never leaves the page
// unless the person sends the report. Nothing is stored.
import { search } from '/js/help-search.mjs';

const form = document.querySelector('form.help-search');
const input = document.getElementById('help-q');
const count = document.getElementById('help-count');
const asks = [...document.querySelectorAll('#help-ask, .ask-link')];
const articles = [...document.querySelectorAll('.help-article')];
const sections = [...document.querySelectorAll('.help-scope')];
const scopes = (form?.dataset.scopes ?? '').split(',').filter(Boolean);

let index = null;
fetch('/help/index.en.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => {
    index = j;
    if (input.value) update();
  })
  .catch(() => {});

function update() {
  const q = input.value.trim();
  const base = '/support?category=question';
  const href = q ? `${base}&q=${encodeURIComponent(q.slice(0, 200))}#report-a-problem` : `${base}#report-a-problem`;
  for (const a of asks) a.href = href;
  if (!index || q === '') {
    for (const a of articles) a.hidden = false;
    for (const s of sections) s.hidden = false;
    count.textContent = '';
    return;
  }
  const hits = search(index, q, { scopes, limit: 8 });
  const rank = new Map(hits.map((h, i) => [h.id, i]));
  for (const a of articles) a.hidden = !rank.has(a.dataset.id);
  for (const s of sections) s.hidden = !s.querySelector('.help-article:not([hidden])');
  count.textContent = hits.length ? `${hits.length} matching article${hits.length === 1 ? '' : 's'}` : 'No matching article. Ask us below.';
}

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  update();
});
input?.addEventListener('input', update);
