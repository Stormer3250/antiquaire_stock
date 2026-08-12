// Le grand registre : recherche, filtre catégorie, table des références.

import { apiGet, apiSend } from '../api.js';
import { icone } from '../icons.js';
import { esc, eur, num, pc, confirmModal, openModal } from '../ui.js';
import { S, refresh, lieuQuery, fmtStock } from '../app.js';
import { openFiche } from '../fiche.js';
import { mountImportCard } from '../importcard.js';
import { renderTable, bindTable, tableState } from '../table.js';
import { openBulkModal } from '../bulkmodal.js';
import { exporter } from '../export.js';

const F = { query: '', cat: 'Tout' };  // filtres persistants pendant la session
const TABLE = 'refs';                  // tri et sélection vivent dans table.js

const GRID = '2.2fr .9fr .5fr .6fr .8fr .8fr .6fr .8fr 150px';

export async function render(el) {
  const data = await apiGet(`/api/stock?lieu=${lieuQuery()}`);
  const rows = data.refs.filter((r) => r.categorie_nom !== 'Consommable');
  const q = F.query.toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (F.cat === 'Tout'
        || (F.cat === '__untracked' ? !r.suivi : String(r.categorie_id) === F.cat))
      && (q === '' || `${r.nom} ${r.marque} ${r.fournisseur}`.toLowerCase().includes(q))
  );
  const cats = S.meta.categories.filter((c) => c.nom !== 'Consommable');
  const pr = S.meta.pricing;

  const columns = [
    {
      key: 'nom',
      label: 'Référence',
      cell: (r) => `
        <div class="row" style="min-width:0; gap:11px;">
          <div class="status-bar ${r.suivi ? (r.low ? 'low' : 'fine') : 'untracked'}"></div>
          <div class="cell-main">
            <div class="nom">${esc(r.nom)}</div>
            <div class="sub">${esc(r.suivi ? `${r.marque} · ${r.fournisseur}` : `${r.marque} · non suivie · ${r.unite}`)}</div>
          </div>
        </div>`,
    },
    {
      key: 'categorie_nom',
      label: 'Catégorie',
      cell: (r) => `<div style="font-size:12.5px; color:var(--mut);">${esc(r.categorie_nom)}</div>`,
    },
    {
      key: 'abv',
      label: 'Degré',
      align: 'r',
      cell: (r) => `<div class="num r" style="font-size:12px; color:var(--mut);">${r.suivi && r.abv > 0 ? num(r.abv, 1) + '°' : '—'}</div>`,
    },
    {
      key: 'stock',
      label: 'Stock',
      align: 'r',
      cell: (r) => `<div class="num r" style="font-size:12.5px;">${fmtStock(r)}</div>`,
    },
    {
      key: 'valeur',
      label: 'Valeur HT',
      align: 'r',
      cell: (r) => `<div class="num r" style="font-size:12.5px; color:var(--mut);">${r.suivi ? eur(r.valeur) : '—'}</div>`,
    },
    {
      key: 'cout_dose',
      label: 'Coût unitaire',
      align: 'r',
      cell: (r) => `<div class="num r" style="font-size:12.5px; color:var(--mut);">${eur(r.cout_dose)}</div>`,
    },
    {
      key: 'marge_reelle',
      label: 'Marge',
      align: 'r',
      cell: (r) => `<div class="num r" style="font-size:12px;">${r.suivi
        ? `<span class="${r.marge_reelle >= pr.min ? 'ok-text' : 'warn-text'}">${pc(r.marge_reelle)}</span>`
        : '—'}</div>`,
    },
    {
      key: 'prix',
      label: 'Prix conseillé',
      align: 'r',
      cell: (r) => `<div class="num r accent" style="font-size:13px;"
        ${r.override ? 'title="Prix fixé à la main sur la fiche"' : ''}>${r.suivi ? eur(r.prix) + (r.override ? ' ·' : '') : '—'}</div>`,
    },
    {
      key: 'created_at',
      label: 'Créée le',
      align: 'r',
      cell: (r) => `
        <div class="row row-actions" style="gap:5px; justify-self:end;">
          <span class="num created-at">${r.created_at.slice(0, 10)}</span>
          <button class="icon-btn" data-edit="${r.id}" aria-label="Éditer" title="Éditer">${icone('crayon', 15)}</button>
          <button class="icon-btn danger" data-del="${r.id}" aria-label="Supprimer">×</button>
        </div>`,
    },
  ];

  // Ce que mesure la sélection ici : de l'argent immobilisé et de la marge.
  const summary = (picked, _rows, masquees) => {
    const suivies = picked.filter((r) => r.suivi);
    const valeur = suivies.reduce((a, r) => a + (r.valeur || 0), 0);
    const marge = suivies.length
      ? suivies.reduce((a, r) => a + r.marge_reelle, 0) / suivies.length
      : null;
    const cout = suivies.length
      ? suivies.reduce((a, r) => a + r.cout_dose, 0) / suivies.length
      : null;
    const basses = suivies.filter((r) => r.marge_reelle < pr.min).length;
    const sousSeuil = suivies.filter((r) => r.low).length;
    return `
      <div class="sum-figs">
        <span class="sum-count">${picked.length} retenue${picked.length > 1 ? 's' : ''}</span>
        ${masquees ? `<span class="sum-hidden">+ ${masquees} hors filtre, non touchée${masquees > 1 ? 's' : ''}</span>` : ''}
        <span>Valeur HT <b class="num">${eur(valeur)}</b></span>
        <span>Coût unitaire moyen <b class="num">${cout === null ? '—' : eur(cout)}</b></span>
        <span>Marge moyenne <b class="num ${marge !== null && marge < pr.min ? 'warn-text' : ''}">${marge === null ? '—' : pc(marge)}</b></span>
        <span>Sous le plancher <b class="num">${basses}</b></span>
        <span>Sous le seuil <b class="num">${sousSeuil}</b></span>
      </div>
      <div class="row" style="gap:8px;">
        ${picked.length ? '<button class="btn" data-bulk>Modifier la sélection</button>' : ''}
        <button class="btn muted" data-unpick>Tout décocher</button>
      </div>`;
  };

  const spec = {
    id: TABLE,
    defaultSort: 'nom',
    columns,
    rows: filtered,
    universe: rows,   // une ligne masquée par le filtre reste cochée, une ligne supprimée non
    grid: GRID,
    select: true,
    summary,
    empty: rows.length === 0
      ? `<div class="empty-note">Le registre est vide. Créez une référence avec « + Référence »
          en haut, ou cliquez « Importer un fichier » pour charger votre catalogue Excel.</div>`
      : `<div class="empty-note">Aucune référence ne correspond à cette recherche.</div>`,
    foot: `<span>${filtered.length} référence${filtered.length > 1 ? 's' : ''} affichée${filtered.length > 1 ? 's' : ''}</span>
      <span>Prix conseillés TTC · marge cible ${pc(pr.cible)} · « · » = prix fixé à la main</span>`,
    onRowClick: (r) => openFiche(r.id, { onClose: () => render(el) }),
    bindSummary: (bar, picked) => {
      const bulk = bar.querySelector('[data-bulk]');
      if (bulk) {
        bulk.addEventListener('click', () =>
          openBulkModal({ refs: picked, onDone: () => render(el) })
        );
      }
      bar.querySelector('[data-unpick]').addEventListener('click', () => {
        tableState(TABLE).selected.clear();
        render(el);
      });
    },
  };

  el.innerHTML = `
  <div class="row" style="margin-bottom:16px; gap:12px;">
    <input class="input grow" data-q value="${esc(F.query)}" style="padding:11px 14px; font-size:13.5px;"
      placeholder="Chercher une bouteille, une marque, un fournisseur…">
    <div style="width:210px;">
      <select class="input" data-cat>
        <option value="Tout">Toutes catégories</option>
        ${cats.map((c) => `<option value="${c.id}" ${String(c.id) === F.cat ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}
        <option value="__untracked" ${F.cat === '__untracked' ? 'selected' : ''}>Non suivies</option>
      </select>
    </div>
    <button class="btn" data-import style="padding:11px 14px;">Importer un fichier</button>
    <button class="btn" data-export style="padding:11px 14px;">Exporter</button>
  </div>
  <div class="panel" data-table data-section="registre"></div>`;

  const table = el.querySelector('[data-table]');
  renderTable(table, spec);
  bindTable(table, spec, () => render(el));

  el.querySelector('[data-q]').addEventListener('input', (e) => {
    F.query = e.target.value;
    render(el);
  });
  el.querySelector('[data-cat]').addEventListener('change', (e) => {
    F.cat = e.target.value;
    render(el);
  });
  el.querySelector('[data-export]').addEventListener('click', () => {
    // ce qui part dans le fichier est ce qui est à l'écran : tri, filtre et sélection
    const etat = tableState(TABLE);
    const visibles = etat.selected.size
      ? filtered.filter((r) => etat.selected.has(r.id))
      : filtered;
    exporter({
      titre: 'Références',
      fichier: 'references',
      colonnes: ['Référence', 'Marque', 'Catégorie', 'Fournisseur', 'Degré', 'Volume cl',
        'Stock', 'Valeur HT', 'Achat HT', 'Coût unitaire', 'Marge %', 'Prix conseillé', 'Créée le'],
      lignes: visibles.map((r) => [
        r.nom, r.marque, r.categorie_nom, r.fournisseur, r.abv, r.vol_cl,
        r.stock, r.valeur, r.achat_ht, r.cout_dose, r.marge_reelle, r.prix, r.created_at.slice(0, 10),
      ]),
    });
  });
  el.querySelector('[data-import]').addEventListener('click', () => {
    const modal = openModal(`
      <div class="modal-head">
        <div class="serif-title">Importer un fichier</div>
        <button class="modal-x" aria-label="Fermer">×</button>
      </div>
      <div data-import-card></div>`, { width: 480 });
    mountImportCard(modal.querySelector('[data-import-card]'), { onApplied: () => render(el) });
  });
  table.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      openFiche(Number(b.dataset.edit), { onClose: () => render(el) });
    })
  );
  table.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = rows.find((x) => x.id === Number(b.dataset.del));
      const ok = await confirmModal({
        title: `Supprimer ${r.nom} ?`,
        body: 'La référence disparaît de la cave et des listes. Les fiches cocktails qui l’utilisent devront être corrigées.',
      });
      if (!ok) return;
      await apiSend('DELETE', `/api/refs/${r.id}`);
      await refresh();
    })
  );
  const focus = el.querySelector('[data-q]');
  if (F.query) { focus.focus(); focus.setSelectionRange(focus.value.length, focus.value.length); }
}
