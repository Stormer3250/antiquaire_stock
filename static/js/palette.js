// Palette ⌘K : chercher une référence, une fiche, un écran, ou lancer une action.
// Les données sont chargées à l'ouverture, pas à chaque frappe.

import { apiGet, apiSend } from './api.js';
import { esc, closeModal, setEscape } from './ui.js';
import { normalise } from './select.js';
import { go } from './app.js';
import { claim, release } from './overlay.js';
import { openReception } from './reception.js';
import { openRefModal } from './refmodal.js';

const ECRANS = [
  ['dash', 'Comptoir'],
  ['refs', 'Références'],
  ['inv', 'Inventaire'],
  ['cocktails', 'Cartes & recettes'],
  ['menus', 'Menus & tarifications'],
  ['cave', 'Cave & seuils'],
  ['bareme', 'Barème fiscal'],
  ['config', 'Configuration'],
];

let open = false;

async function collect() {
  const items = ECRANS.map(([key, label]) => ({
    kind: 'Écran',
    label,
    hint: '',
    run: () => go('#/' + key),
  }));
  items.push(
    { kind: 'Action', label: 'Nouvelle référence', hint: '', run: () => openRefModal() },
    { kind: 'Action', label: 'Réception', hint: 'entrée de stock', run: () => openReception() },
    {
      kind: 'Action',
      label: 'Nouvelle fiche cocktail',
      hint: '',
      run: async () => {
        await apiSend('POST', '/api/cocktails', {});
        go('#/cocktails');
      },
    },
    {
      kind: 'Action',
      label: 'Importer un fichier',
      hint: 'depuis Cave & seuils',
      run: () => go('#/cave'),
    }
  );

  const [stock, cocktails, menus] = await Promise.all([
    apiGet('/api/stock').catch(() => ({ refs: [] })),
    apiGet('/api/cocktails').catch(() => ({ cocktails: [] })),
    apiGet('/api/menus').catch(() => ({ menus: [] })),
  ]);
  menus.menus.forEach((m) => {
    items.push({
      kind: 'Menu',
      label: m.nom,
      hint: `${m.kpis.n || 0} fiches`,
      run: () => go('#/menus'),
    });
    m.tarifs.forEach((t) =>
      items.push({
        kind: 'Tarification',
        label: t.nom,
        hint: `${m.nom}${t.actif ? ' · appliquée' : ''}`,
        run: () => go('#/menus'),
      })
    );
  });
  stock.refs.forEach((r) =>
    items.push({
      kind: 'Référence',
      label: r.nom,
      hint: [r.marque, r.categorie_nom].filter(Boolean).join(' · '),
      run: () => (r.suivi ? go(`#/product/${r.id}`) : openRefModal({ ref: r })),
    })
  );
  cocktails.cocktails.forEach((c) =>
    items.push({
      kind: 'Fiche',
      label: c.nom,
      hint: c.famille,
      run: () => go('#/cocktails'),
    })
  );
  return items;
}

export async function openPalette() {
  if (open) return;
  open = true;
  claim('palette');   // ouverte à la demande : elle passe devant tout le reste
  const root = document.getElementById('modal-root');
  const items = await collect();
  let shown = [];
  let cursor = 0;

  root.innerHTML = `
    <div class="scrim palette-scrim">
      <div class="palette">
        <input class="palette-input" placeholder="Chercher une bouteille, une fiche, un écran…"
          aria-label="Recherche" autocomplete="off">
        <div class="palette-list"></div>
        <div class="palette-foot">
          <span>↑ ↓ pour circuler · Entrée pour ouvrir · Échap pour fermer</span>
          <span>${items.length} entrées</span>
        </div>
      </div>
    </div>`;
  const scrim = root.firstElementChild;
  const input = scrim.querySelector('.palette-input');
  const list = scrim.querySelector('.palette-list');

  function close() {
    open = false;
    closeModal();
    release('palette');
    document.removeEventListener('keydown', keys, true);
  }

  function paint() {
    const q = normalise(input.value);
    shown = (q
      ? items.filter((it) => normalise(`${it.label} ${it.hint} ${it.kind}`).includes(q))
      : items
    ).slice(0, 40);
    if (cursor >= shown.length) cursor = Math.max(0, shown.length - 1);
    list.innerHTML = shown.length
      ? shown.map((it, k) => `
        <div class="palette-row ${k === cursor ? 'on' : ''}" data-k="${k}">
          <span class="palette-kind">${esc(it.kind)}</span>
          <span class="palette-label">${esc(it.label)}</span>
          <span class="palette-hint">${esc(it.hint)}</span>
        </div>`).join('')
      : `<div class="palette-empty">Rien ne correspond à « ${esc(input.value)} ».</div>`;
    list.querySelectorAll('.palette-row').forEach((n) =>
      n.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(Number(n.dataset.k));
      })
    );
  }

  function pick(k) {
    const it = shown[k];
    if (!it) return;
    close();
    it.run();
  }

  function keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursor = Math.min(cursor + 1, shown.length - 1);
      paint();
      list.querySelector('.palette-row.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      paint();
      list.querySelector('.palette-row.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); pick(cursor); }
  }

  setEscape(close);   // remplace le gestionnaire de la modale que la palette recouvre
  input.addEventListener('input', () => { cursor = 0; paint(); });
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', keys, true);
  paint();
  input.focus();
}

export function installPalette() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    }
  });
  document.getElementById('btn-palette')?.addEventListener('click', () => openPalette());
}
