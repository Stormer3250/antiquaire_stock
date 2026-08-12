// Barre gelée commune à tous les écrans : recherche, tri (vue blocs), groupement,
// actions de création, bascule table/blocs. L'état vit ici, par écran.

import { esc } from './ui.js';
import { icone } from './icons.js';

const LS = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} };
const ETATS = new Map();

export function barState(screen, { sortB = { key: 'nom', dir: 'asc' } } = {}) {
  if (!ETATS.has(screen)) {
    ETATS.set(screen, {
      view: LS.getItem('antiquaire.vue.' + screen) || 'blocs',
      search: '', group: false, collapsed: new Set(), sortB: { ...sortB },
    });
  }
  return ETATS.get(screen);
}

export function setView(screen, view) {
  barState(screen).view = view;
  LS.setItem('antiquaire.vue.' + screen, view);
}

export function renderBar(el, opts) {
  const st = opts.state;
  const enBlocs = opts.views !== false && st.view === 'blocs';
  // La classe et le contenu vont directement sur `el` : un `<div class="vbar">` imbriqué
  // dedans casse le `position: sticky` (son parent immédiat n'a alors plus de rapport
  // direct avec le conteneur défilant `.screen`, et Chrome refuse de le coller).
  el.className = 'vbar';
  el.innerHTML = `
    <input class="input grow" data-vb-q value="${esc(st.search)}" placeholder="${esc(opts.placeholder || 'Chercher…')}">
    ${enBlocs && opts.sortOptions ? `
      <select class="input" data-vb-sort style="width:170px;">
        ${opts.sortOptions.map(([k, l]) => `
          <option value="${k}" ${st.sortB.key === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select>
      <button class="btn muted" data-vb-dir title="Sens du tri">${st.sortB.dir === 'asc' ? '↑' : '↓'}</button>` : ''}
    ${opts.groupLabel ? `
      <button class="btn ${st.group ? '' : 'muted'}" data-vb-group aria-pressed="${st.group}">
        ${esc(opts.groupLabel)}</button>` : ''}
    ${(opts.actions || []).map((a) => `
      <button class="${a.solid ? 'btn-solid' : 'btn'}" data-vb-act="${a.key}">${esc(a.label)}</button>`).join('')}
    ${opts.views !== false ? `
      <div class="vb-views" role="group" aria-label="Vue">
        <button class="${st.view === 'blocs' ? 'active' : ''}" data-vb-view="blocs" title="Blocs">${icone('cartes', 14)}</button>
        <button class="${st.view === 'table' ? 'active' : ''}" data-vb-view="table" title="Table">${icone('inventaire', 14)}</button>
      </div>` : ''}`;

  const q = el.querySelector('[data-vb-q]');
  q.addEventListener('input', () => { st.search = q.value; opts.onChange(); });
  el.querySelector('[data-vb-sort]')?.addEventListener('change', (e) => {
    st.sortB.key = e.target.value; opts.onChange();
  });
  el.querySelector('[data-vb-dir]')?.addEventListener('click', () => {
    st.sortB.dir = st.sortB.dir === 'asc' ? 'desc' : 'asc'; opts.onChange();
  });
  el.querySelector('[data-vb-group]')?.addEventListener('click', () => {
    st.group = !st.group; opts.onChange();
  });
  el.querySelectorAll('[data-vb-view]').forEach((b) =>
    b.addEventListener('click', () => { setView(opts.screen, b.dataset.vbView); opts.onChange(); })
  );
  el.querySelectorAll('[data-vb-act]').forEach((b) =>
    b.addEventListener('click', () => opts.onAction(b.dataset.vbAct))
  );
}

// ---------- auto-vérification : `node static/js/viewbar.js` ----------

function demo() {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  ETATS.clear();

  const a = barState('refs');
  assert(a.view === 'blocs', 'bloc par défaut');
  assert(barState('refs') === a, 'même objet pour la session');
  setView('refs', 'table');
  assert(barState('refs').view === 'table', 'bascule mémorisée');
  a.search = 'gin'; a.group = true;
  assert(barState('refs').search === 'gin' && barState('refs').group, 'recherche et groupement partagés');
  const b = barState('cave');
  assert(b.view === 'blocs' && b.search === '', 'chaque écran a le sien');
}

if (typeof process !== 'undefined' && /viewbar\.m?js$/.test(process.argv?.[1] || '')) demo();
