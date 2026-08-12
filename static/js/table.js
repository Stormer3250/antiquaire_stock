// Rendu de table : colonnes, tri, sélection, barre de synthèse.
//
// Chaque écran décrivait sa table à la main, en dupliquant la grille CSS, l'en-tête et
// la boucle de lignes. Ce module tient le tout, et surtout : cocher une case ne
// redessine que la ligne et la barre de synthèse, jamais l'écran. Sur trois cents
// références, la différence se voit.
//
// L'état (tri, lignes cochées) vit ici, indexé par identifiant de table : c'est ce qui
// remplace les variables globales que chaque écran déclarait de son côté.

import { applySort } from './sortable.js';
import { esc } from './ui.js';

const STORE = new Map();

export function tableState(id, defaultSortKey = null, defaultDir = 'asc') {
  if (!STORE.has(id)) {
    STORE.set(id, { sort: { key: defaultSortKey, dir: defaultDir }, selected: new Set() });
  }
  return STORE.get(id);
}

function headCell(col, state) {
  const align = col.align || '';
  if (col.sortable === false) return `<div class="${align}">${esc(col.label || '')}</div>`;
  const active = state.sort.key === col.key;
  const arrow = active ? (state.sort.dir === 'asc' ? '↑' : '↓') : '';
  return `<div class="th-sort ${align} ${active ? 'active' : ''}" data-sort="${esc(col.key)}"
    role="button" tabindex="0" aria-label="Trier par ${esc(col.label || col.key)}"
    >${esc(col.label || '')}<span class="th-arrow">${arrow}</span></div>`;
}

function cellHtml(col, row) {
  if (col.cell) return col.cell(row);
  const v = row[col.key];
  return `<div class="${col.align || ''}">${esc(v ?? '')}</div>`;
}

/**
 * spec : { id, columns, rows, grid, select, summary, empty, foot, rowClass, onRowClick }
 * - columns : [{ key, label, align, sortable, cell(row) }]
 * - grid    : la valeur de grid-template-columns SANS la colonne de sélection
 * - select  : true pour la colonne à cocher et la barre de synthèse
 * - summary : (lignesCochees, toutesLignes) => HTML de la barre
 * Renvoie les lignes effectivement affichées, dans l'ordre affiché.
 */
export function renderTable(el, spec) {
  const state = tableState(spec.id, spec.defaultSort);
  const rows = applySort(spec.rows, state.sort, spec.accessors);
  // Une ligne SUPPRIMÉE ne reste pas cochée en coulisses. Une ligne simplement masquée
  // par un filtre, si : filtrer pour vérifier quelque chose ne doit pas détruire une
  // sélection en cours. `universe` = toutes les lignes existantes, filtre non appliqué.
  const vivantes = new Set((spec.universe || spec.rows).map((r) => r.id));
  [...state.selected].forEach((id) => {
    if (!vivantes.has(id)) state.selected.delete(id);
  });

  const grid = spec.select ? `34px ${spec.grid}` : spec.grid;
  const allOn = rows.length > 0 && rows.every((r) => state.selected.has(r.id));

  const head = `
    <div class="thead" style="grid-template-columns:${grid};">
      ${spec.select ? `<label class="tick"><input type="checkbox" data-all ${allOn ? 'checked' : ''}
        aria-label="Tout cocher"></label>` : ''}
      ${spec.columns.map((c) => headCell(c, state)).join('')}
    </div>`;

  const body = rows.length === 0
    ? (spec.empty || '<div class="empty-note">Rien à afficher.</div>')
    : rows.map((r) => `
      <div class="trow ${spec.rowClass ? spec.rowClass(r) : ''} ${state.selected.has(r.id) ? 'picked' : ''}"
        style="grid-template-columns:${grid};" data-row="${r.id}">
        ${spec.select ? `<label class="tick"><input type="checkbox" data-tick="${r.id}"
          ${state.selected.has(r.id) ? 'checked' : ''} aria-label="Cocher cette ligne"></label>` : ''}
        ${spec.columns.map((c) => cellHtml(c, r)).join('')}
      </div>`).join('');

  // La synthèse est posée AVANT l'en-tête : ce que l'on vient de cocher se lit tout de
  // suite, sans descendre au bas d'une table de trois cents lignes.
  el.innerHTML = `
    ${spec.select ? '<div class="table-summary" data-summary hidden></div>' : ''}
    ${head}${body}
    ${spec.foot ? `<div class="panel-foot">${spec.foot}</div>` : ''}`;

  paintSummary(el, spec, rows, state);
  return rows;
}

function paintSummary(el, spec, rows, state) {
  const bar = el.querySelector('[data-summary]');
  if (!bar || !spec.summary) return;
  const picked = rows.filter((r) => state.selected.has(r.id));
  // cochées mais masquées par le filtre courant : la barre le dit, et les actions
  // ne portent que sur ce qui est visible
  const masquees = state.selected.size - picked.length;
  if (!picked.length && !masquees) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  bar.innerHTML = spec.summary(picked, rows, masquees);
  if (spec.bindSummary) spec.bindSummary(bar, picked);
}

export function bindTable(el, spec, rerender) {
  const state = tableState(spec.id, spec.defaultSort);
  const rows = applySort(spec.rows, state.sort, spec.accessors);

  el.querySelectorAll('[data-sort]').forEach((h) => {
    const go = () => {
      const key = h.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort.key = key; state.sort.dir = 'asc'; }
      rerender();
    };
    h.addEventListener('click', go);
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  // Cocher ne redessine ni la table ni l'écran : la ligne change de classe, la barre
  // de synthèse est recalculée, c'est tout.
  const refreshRow = (id) => {
    const node = el.querySelector(`[data-row="${id}"]`);
    if (node) node.classList.toggle('picked', state.selected.has(id));
  };

  el.querySelectorAll('[data-tick]').forEach((box) =>
    box.addEventListener('change', () => {
      const id = Number(box.dataset.tick);
      if (box.checked) state.selected.add(id);
      else state.selected.delete(id);
      refreshRow(id);
      const all = el.querySelector('[data-all]');
      if (all) all.checked = rows.length > 0 && rows.every((r) => state.selected.has(r.id));
      paintSummary(el, spec, rows, state);
    })
  );

  const all = el.querySelector('[data-all]');
  if (all) {
    all.addEventListener('change', () => {
      rows.forEach((r) => (all.checked ? state.selected.add(r.id) : state.selected.delete(r.id)));
      el.querySelectorAll('[data-tick]').forEach((b) => { b.checked = all.checked; });
      rows.forEach((r) => refreshRow(r.id));
      paintSummary(el, spec, rows, state);
    });
  }

  if (spec.onRowClick) {
    el.querySelectorAll('[data-row]').forEach((node) =>
      node.addEventListener('click', (e) => {
        if (e.target.closest('.tick, button, input, select, .cc-sel')) return;
        const row = rows.find((r) => r.id === Number(node.dataset.row));
        if (row) spec.onRowClick(row);
      })
    );
  }
}

export function clearSelection(id) {
  STORE.get(id)?.selected.clear();
}

// ---------- auto-vérification : `node static/js/table.js` ----------

function demo() {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  STORE.clear();

  const s = tableState('t', 'nom');
  assert(s.sort.key === 'nom' && s.selected.size === 0, 'état initial');
  s.selected.add(1);
  assert(tableState('t').selected.has(1), 'l’état survit à un second appel, donc à un re-rendu');
  assert(tableState('u', 'prix').selected.size === 0, 'chaque table a le sien');

  // une ligne qui disparaît du jeu affiché ne reste pas cochée en coulisses
  const state = tableState('v', 'nom');
  state.selected.add(1);
  state.selected.add(2);
  const rows = [{ id: 2, nom: 'B' }];
  const ids = new Set(rows.map((r) => r.id));
  [...state.selected].forEach((id) => { if (!ids.has(id)) state.selected.delete(id); });
  assert(state.selected.size === 1 && state.selected.has(2), 'purge des cochées absentes');

  clearSelection('t');
  assert(tableState('t').selected.size === 0, 'clearSelection vide bien');

  // colonne sans « cell » : la valeur brute, échappée
  assert(cellHtml({ key: 'nom' }, { nom: '<b>x</b>' }).includes('&lt;b&gt;'), 'échappement par défaut');
  assert(cellHtml({ key: 'nom', cell: (r) => `<i>${r.nom}</i>` }, { nom: 'y' }) === '<i>y</i>',
    'cellule sur mesure');
}

if (typeof process !== 'undefined' && /table\.m?js$/.test(process.argv?.[1] || '')) demo();
