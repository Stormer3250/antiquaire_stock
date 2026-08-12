// Recettes : liste, coût matière, marge, faisabilité. L'édition vit dans recettemodal.js.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, pc, confirmModal } from '../ui.js';
import { S, refresh, lieuQuery } from '../app.js';
import { openRecette } from '../recettemodal.js';
import { renderTable, bindTable, tableState } from '../table.js';
import { renderBlocks } from '../blocks.js';
import { barState, renderBar } from '../viewbar.js';

const TABLE = 'recettes';              // tri et sélection (vue table) vivent dans table.js
const SORT_OPTIONS = [
  ['nom', 'Nom'], ['cost', 'Coût'], ['prix_ttc', 'Prix'], ['marge', 'Marge'], ['created_at', 'Créée le'],
];

const GRID = '2fr .9fr .8fr .8fr .8fr 40px';

export async function render(el) {
  const st = barState('cocktails');
  const [cocktailsData, stockData] = await Promise.all([
    apiGet(`/api/cocktails?lieu=${lieuQuery()}`),
    apiGet('/api/stock'),
  ]);
  const rows = cocktailsData.cocktails;
  const refs = stockData.refs;
  const q = st.search.toLowerCase();
  const filtered = rows.filter(
    (x) => q === '' || `${x.nom} ${x.description || ''}`.toLowerCase().includes(q)
  );
  const pr = S.meta.pricing;

  const subtitleOf = (x) =>
    x.ings.map((i) => i.nom || refs.find((r) => r.id === i.ref_id)?.nom).filter(Boolean).join(', ');

  const columns = [
    {
      key: 'nom',
      label: 'Recette',
      cell: (x) => `<div class="cell-main"><div class="nom">${esc(x.nom)}</div>
        <div class="sub">${esc(x.famille || '')}${x.prix_fixe ? ' · prix figé' : ''}</div></div>`,
    },
    {
      key: 'cost',
      label: 'Coût matière',
      align: 'r',
      cell: (x) => `<div class="num r" style="font-size:12.5px; color:var(--mut);">${eur(x.cost)}</div>`,
    },
    {
      key: 'prix_ttc',
      label: 'Prix TTC',
      align: 'r',
      cell: (x) => `<div class="num r" style="font-size:13px;">${eur(x.prix_ttc)}</div>`,
    },
    {
      key: 'marge',
      label: 'Marge',
      align: 'r',
      cell: (x) => `<div class="num r" style="font-size:12px;">
        <span class="${x.marge >= pr.min ? 'ok-text' : 'warn-text'}">${pc(x.marge)}</span></div>`,
    },
    {
      key: 'created_at',
      label: 'Créée le',
      align: 'r',
      cell: (x) => `
        <div class="row row-actions" style="gap:5px; justify-self:end;">
          <span class="num created-at">${x.created_at.slice(0, 10)}</span>
          <button class="icon-btn danger" data-del="${x.id}" aria-label="Supprimer">×</button>
        </div>`,
    },
  ];

  // Ce que l'on veut savoir d'un paquet de recettes : ce qu'il rapporte et à quel point
  // ses prix sont dispersés.
  const summary = (picked, _rows, masquees) => {
    const moy = (f) => picked.reduce((a, x) => a + f(x), 0) / picked.length;
    const prix = picked.map((x) => x.prix_ttc);
    const bas = Math.min(...prix);
    const haut = Math.max(...prix);
    return `
      <div class="sum-figs">
        <span class="sum-count">${picked.length} recette${picked.length > 1 ? 's' : ''} retenue${picked.length > 1 ? 's' : ''}</span>
        ${masquees ? `<span class="sum-hidden">+ ${masquees} hors filtre, non touchée${masquees > 1 ? 's' : ''}</span>` : ''}
        <span>Marge moyenne <b class="num">${pc(moy((x) => x.marge))}</b></span>
        <span>Prix moyen <b class="num">${eur(moy((x) => x.prix_ttc))}</b></span>
        <span>Coût matière moyen <b class="num">${eur(moy((x) => x.cost))}</b></span>
        <span>De <b class="num">${eur(bas)}</b> à <b class="num">${eur(haut)}</b>, écart <b class="num">${eur(haut - bas)}</b></span>
      </div>
      <div class="row" style="gap:8px;">
        <button class="btn muted" data-unpick>Tout décocher</button>
      </div>`;
  };

  const emptyNote = rows.length === 0
    ? `<div class="empty-note">Aucune recette. Créez la première avec « + Nouvelle recette » en haut.</div>`
    : `<div class="empty-note">Aucune recette ne correspond à cette recherche.</div>`;

  const group = { on: st.group, label: (x) => x.famille || 'Sans famille', collapsed: st.collapsed };

  const spec = {
    id: TABLE,
    defaultSort: 'nom',
    columns,
    rows: filtered,
    universe: rows,   // une ligne masquée par le filtre reste cochée, une ligne supprimée non
    grid: GRID,
    select: true,
    summary,
    empty: emptyNote,
    group,
    foot: `<span>${filtered.length} recette${filtered.length > 1 ? 's' : ''} affichée${filtered.length > 1 ? 's' : ''}</span>
      <span>marge cible ${pc(pr.cible)}</span>`,
    onRowClick: (x) => openRecette(x.id, { onClose: () => render(el) }),
    bindSummary: (bar) => {
      bar.querySelector('[data-unpick]').addEventListener('click', () => {
        tableState(TABLE).selected.clear();
        render(el);
      });
    },
  };

  el.innerHTML = `
  <div data-bar></div>
  <div data-content></div>`;

  renderBar(el.querySelector('[data-bar]'), {
    screen: 'cocktails',
    state: st,
    placeholder: 'Chercher une recette…',
    sortOptions: SORT_OPTIONS,
    groupLabel: 'Grouper par famille',
    actions: [{ key: 'new', label: '+ Nouvelle recette', solid: true }],
    views: true,
    onChange: () => render(el),
    onAction: async (key) => {
      if (key === 'new') {
        const r = await apiSend('POST', '/api/cocktails', {});
        openRecette(r.id, { onClose: () => render(el) });
      }
    },
  });

  const content = el.querySelector('[data-content]');
  if (st.view === 'table') {
    content.innerHTML = '<div class="panel" data-table data-section="recettes"></div>';
    const table = content.querySelector('[data-table]');
    renderTable(table, spec);
    bindTable(table, spec, () => render(el));
    table.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        const x = rows.find((y) => y.id === Number(b.dataset.del));
        const ok = await confirmModal({
          title: `Supprimer « ${x.nom} » ?`,
          body: 'La recette et son chiffrage seront perdus. Elle disparaît des cartes où elle figure.',
        });
        if (!ok) return;
        await apiSend('DELETE', `/api/cocktails/${x.id}`);
        await refresh();
      })
    );
  } else {
    content.innerHTML = '<div data-blocks data-section="recettes"></div>';
    renderBlocks(content.querySelector('[data-blocks]'), {
      rows: filtered,
      name: (x) => x.nom,
      subtitle: subtitleOf,
      kpis: [
        { label: 'Coût matière', value: (x) => eur(x.cost), tone: (x) => (x.ok ? '' : 'warn') },
        { label: 'Prix TTC', value: (x) => eur(x.prix_ttc), tone: (x) => (x.ok ? '' : 'warn') },
        { label: 'Marge', value: (x) => pc(x.marge), tone: (x) => (x.ok ? '' : 'warn') },
      ],
      sortB: st.sortB,
      accessors: {},
      group,
      onClick: (x) => openRecette(x.id, { onClose: () => render(el) }),
      empty: emptyNote,
    });
  }

  const focus = el.querySelector('[data-vb-q]');
  if (st.search) { focus.focus(); focus.setSelectionRange(focus.value.length, focus.value.length); }
}
