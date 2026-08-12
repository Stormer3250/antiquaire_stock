// Cartes : liste des cartes, leurs KPI agrégés (marge, prix, écart). La composition et
// les tarifications de chacune vivent dans la modale (cartemodal.js).

import { apiGet, apiSend } from '../api.js';
import { esc, eur, pc, confirmModal } from '../ui.js';
import { S } from '../app.js';
import { openCarte } from '../cartemodal.js';
import { renderTable, bindTable } from '../table.js';
import { renderBlocks } from '../blocks.js';
import { barState, renderBar } from '../viewbar.js';

const TABLE = 'menus';
const SORT_OPTIONS = [
  ['nom', 'Nom'], ['n', 'Recettes'], ['marge_moyenne', 'Marge moyenne'], ['prix_moyen', 'Prix moyen'],
];

const GRID = '2fr .8fr .8fr .9fr .8fr';

export async function render(el) {
  const st = barState('menus');
  const data = await apiGet('/api/menus');
  const rows = data.menus;
  const q = st.search.toLowerCase();
  const filtered = rows.filter((m) => q === '' || m.nom.toLowerCase().includes(q));
  const pr = S.meta.pricing;

  // Les KPI viennent groupés sous m.kpis : un accesseur par clé de tri/colonne calculée.
  const accessors = {
    n: (m) => m.kpis.n || 0,
    marge_moyenne: (m) => m.kpis.marge_moyenne || 0,
    prix_moyen: (m) => m.kpis.prix_moyen || 0,
    ecart: (m) => m.kpis.ecart || 0,
    sous_plancher: (m) => m.kpis.sous_plancher || 0,
  };

  const subtitleOf = (m) => m.cocktails.map((c) => c.nom).join(', ');

  const columns = [
    {
      key: 'nom',
      label: 'Carte',
      cell: (m) => `<div class="cell-main"><div class="nom">${esc(m.nom)}</div>
        <div class="sub">${m.kpis.n || 0} recette${(m.kpis.n || 0) > 1 ? 's' : ''}</div></div>`,
    },
    {
      key: 'prix_moyen',
      label: 'Prix moyen',
      align: 'r',
      cell: (m) => `<div class="num r" style="font-size:13px;">${m.kpis.n ? eur(m.kpis.prix_moyen) : '—'}</div>`,
    },
    {
      key: 'marge_moyenne',
      label: 'Marge moyenne',
      align: 'r',
      cell: (m) => `<div class="num r" style="font-size:12.5px;">${m.kpis.n
        ? `<span class="${m.kpis.marge_moyenne >= pr.cible ? 'ok-text' : 'warn-text'}">${pc(m.kpis.marge_moyenne)}</span>`
        : '—'}</div>`,
    },
    {
      key: 'ecart',
      label: 'Écart',
      align: 'r',
      cell: (m) => (m.kpis.n
        ? `<div class="num r" style="font-size:12.5px;">${eur(m.kpis.ecart)}
            <div class="sub">${eur(m.kpis.prix_mini)}–${eur(m.kpis.prix_maxi)}</div></div>`
        : `<div class="num r" style="font-size:12.5px; color:var(--mut);">—</div>`),
    },
    {
      key: 'sous_plancher',
      label: 'Sous plancher',
      align: 'r',
      cell: (m) => `
        <div class="row row-actions" style="gap:5px; justify-self:end;">
          <span class="num ${m.kpis.sous_plancher > 0 ? 'warn-text' : ''}"
            >${m.kpis.n ? m.kpis.sous_plancher : '—'}</span>
          <button class="icon-btn danger" data-del="${m.id}" aria-label="Supprimer">×</button>
        </div>`,
    },
  ];

  const emptyNote = rows.length === 0
    ? `<div class="empty-note">Aucune carte. Créez la première avec « + Nouvelle carte » en haut.</div>`
    : `<div class="empty-note">Aucune carte ne correspond à cette recherche.</div>`;

  const spec = {
    id: TABLE,
    defaultSort: 'nom',
    columns,
    rows: filtered,
    universe: rows,
    grid: GRID,
    accessors,
    empty: emptyNote,
    foot: `<span>${filtered.length} carte${filtered.length > 1 ? 's' : ''} affichée${filtered.length > 1 ? 's' : ''}</span>
      <span>marge cible ${pc(pr.cible)}</span>`,
    onRowClick: (m) => openCarte(m.id, { onClose: () => render(el) }),
  };

  el.innerHTML = `
  <div data-bar></div>
  <div data-content></div>`;

  renderBar(el.querySelector('[data-bar]'), {
    screen: 'menus',
    state: st,
    placeholder: 'Chercher une carte…',
    sortOptions: SORT_OPTIONS,
    groupLabel: null,     // une poignée de cartes : le groupement n'apporte rien
    actions: [{ key: 'new', label: '+ Nouvelle carte', solid: true }],
    views: true,
    onChange: () => render(el),
    onAction: async (key) => {
      if (key === 'new') {
        const r = await apiSend('POST', '/api/menus', { nom: 'Nouvelle carte' });
        openCarte(r.id, { onClose: () => render(el) });
      }
    },
  });

  const content = el.querySelector('[data-content]');
  if (st.view === 'table') {
    content.innerHTML = '<div class="panel" data-table data-section="menus"></div>';
    const table = content.querySelector('[data-table]');
    renderTable(table, spec);
    bindTable(table, spec, () => render(el));
    table.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        const m = rows.find((x) => x.id === Number(b.dataset.del));
        const ok = await confirmModal({
          title: `Supprimer la carte « ${m.nom} » ?`,
          body: 'Ses tarifications disparaissent. Les recettes, elles, sont conservées : elles restent sur leurs autres cartes, ou reprennent leur prix propre.',
        });
        if (!ok) return;
        await apiSend('DELETE', `/api/menus/${m.id}`);
        await render(el);
      })
    );
  } else {
    content.innerHTML = '<div data-blocks data-section="menus"></div>';
    renderBlocks(content.querySelector('[data-blocks]'), {
      rows: filtered,
      name: (m) => m.nom,
      subtitle: subtitleOf,
      kpis: [
        { label: 'Prix moyen', value: (m) => (m.kpis.n ? eur(m.kpis.prix_moyen) : '—') },
        {
          label: 'Marge moyenne',
          value: (m) => (m.kpis.n ? pc(m.kpis.marge_moyenne) : '—'),
          tone: (m) => (m.kpis.n && m.kpis.marge_moyenne < pr.cible ? 'warn' : ''),
        },
        { label: 'Min/Max', value: (m) => (m.kpis.n ? `${eur(m.kpis.prix_mini)}–${eur(m.kpis.prix_maxi)}` : '—') },
      ],
      sortB: st.sortB,
      accessors,
      onClick: (m) => openCarte(m.id, { onClose: () => render(el) }),
      empty: emptyNote,
    });
  }

  const focus = el.querySelector('[data-vb-q]');
  if (st.search) { focus.focus(); focus.setSelectionRange(focus.value.length, focus.value.length); }
}
