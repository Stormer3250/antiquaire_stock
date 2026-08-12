// Cave & seuils : maintien du stock, garnitures non suivies, import de fichier.

import { apiGet, apiSend } from '../api.js';
import { icone } from '../icons.js';
import { esc, eur, num, parseNum, confirmModal } from '../ui.js';
import { S, refresh, lieuQuery, fmtStock } from '../app.js';
import { openRefModal } from '../refmodal.js';
import { mountImportCard } from '../importcard.js';
import { renderTable, bindTable, tableState } from '../table.js';
import { openBulkModal } from '../bulkmodal.js';

const T_SUIVIES = 'cave-suivies';
const T_GARNITURES = 'cave-garnitures';

const GRID = '2fr .7fr 1fr 1fr 1fr .8fr .8fr 66px';
const UGRID = '2fr 1fr 1fr 1fr 66px';

export async function render(el) {
  const [stockData, importsData] = await Promise.all([
    apiGet(`/api/stock?lieu=${lieuQuery()}`),
    apiGet('/api/imports'),
  ]);
  const tracked = stockData.refs.filter((r) => r.suivi);
  const untracked = stockData.refs.filter((r) => !r.suivi && r.categorie_nom !== 'Consommable');
  const low = tracked.filter((r) => r.low).length;

  const patchRef = async (id, body) => {
    await apiSend('PATCH', `/api/refs/${id}`, body);
    await render(el);
  };

  const suiviesSpec = {
    id: T_SUIVIES,
    defaultSort: 'nom',
    grid: GRID,
    select: true,
    rows: tracked,
    columns: [
      {
        key: 'nom',
        label: 'Référence',
        cell: (r) => `
          <div class="cell-main">
            <div class="nom">${esc(r.nom)}</div>
            <div class="sub">${esc(r.marque)}${r.fournisseur ? ' · ' + esc(r.fournisseur) : ''}</div>
          </div>`,
      },
      { key: 'stock', label: 'Stock', align: 'r',
        cell: (r) => `<div class="num r" style="font-size:12.5px;">${fmtStock(r)}</div>` },
      { key: 'seuil', label: 'Seuil', align: 'c',
        cell: (r) => `<div class="stepper" data-seuil="${r.id}">
          <button data-dir="-1">–</button><span class="val">${num(r.seuil, 0)}</span><button data-dir="1">+</button></div>` },
      { key: 'par_target', label: 'Cible', align: 'c',
        cell: (r) => `<div class="stepper" data-par="${r.id}">
          <button data-dir="-1">–</button><span class="val">${num(r.par_target, 0)}</span><button data-dir="1">+</button></div>` },
      { key: 'achat_ht', label: 'Achat HT', align: 'c',
        cell: (r) => `<input class="input num" data-achat="${r.id}" value="${num(r.achat_ht, 2)}" aria-label="Prix d'achat">` },
      { key: 'marge', label: 'Marge %', align: 'c',
        cell: (r) => `<input class="input num" data-marge="${r.id}" value="${num(r.marge, 0)}" aria-label="Marge">` },
      { key: 'low', label: 'Statut', align: 'r',
        cell: (r) => (r.low
          ? '<div class="chip-low">SOUS SEUIL</div>'
          : '<div class="num r" style="font-size:10.5px; color:var(--ok-ink); justify-self:end;">suffisant</div>') },
      { key: 'actions', label: '', sortable: false,
        cell: (r) => `<div class="row" style="gap:5px; justify-self:end;">
          <button class="icon-btn" data-edit="${r.id}" aria-label="Éditer" title="Éditer">${icone('crayon', 15)}</button>
          <button class="icon-btn danger" data-del="${r.id}" aria-label="Supprimer">×</button></div>` },
    ],
    // Ici la question est « qu'est-ce que je dois racheter, et pour combien ».
    summary: (picked, _rows, masquees) => {
      const valeur = picked.reduce((a, r) => a + (r.valeur || 0), 0);
      const sous = picked.filter((r) => r.low).length;
      const aCommander = picked.reduce(
        (a, r) => a + (r.stock <= r.seuil ? Math.ceil(Math.max(r.par_target - r.stock, 0)) : 0), 0
      );
      const cout = picked.reduce((a, r) => a + (r.stock <= r.seuil
        ? Math.ceil(Math.max(r.par_target - r.stock, 0)) * r.achat_ht : 0), 0);
      return `
        <div class="sum-figs">
          <span class="sum-count">${picked.length} retenue${picked.length > 1 ? 's' : ''}</span>
          ${masquees ? `<span class="sum-hidden">+ ${masquees} hors filtre</span>` : ''}
          <span>Valeur HT <b class="num">${eur(valeur)}</b></span>
          <span>Sous le seuil <b class="num">${sous}</b></span>
          <span>À commander <b class="num">${aCommander} bouteille${aCommander > 1 ? 's' : ''}</b></span>
          <span>Coût du réassort <b class="num">${eur(cout)}</b></span>
        </div>
        <div class="row" style="gap:8px;">
          ${picked.length ? '<button class="btn" data-bulk>Modifier la sélection</button>' : ''}
          <button class="btn muted" data-unpick>Tout décocher</button>
        </div>`;
    },
    bindSummary: (bar, picked) => {
      bar.querySelector('[data-bulk]')?.addEventListener('click', () =>
        openBulkModal({ refs: picked, onDone: () => render(el) })
      );
      bar.querySelector('[data-unpick]').addEventListener('click', () => {
        tableState(T_SUIVIES).selected.clear();
        render(el);
      });
    },
    empty: `<div class="empty-note">Aucune référence suivie : créez-en avec « + Référence »
      ou déposez un fichier ci-contre.</div>`,
    foot: `<span>Modifier un prix d’achat recalcule aussitôt le coût par dose et le prix conseillé.</span>
      <span>${tracked.length} références · ${low} sous seuil</span>`,
  };

  const garnituresSpec = {
    id: T_GARNITURES,
    defaultSort: 'nom',
    grid: UGRID,
    select: true,
    rows: untracked,
    columns: [
      {
        key: 'nom',
        label: 'Garniture, épice, aromate',
        cell: (r) => `<div class="cell-main"><div class="nom">${esc(r.nom)}</div>
          <div class="sub">${esc(r.marque)}</div></div>`,
      },
      { key: 'unite', label: 'Unité',
        cell: (r) => `<div style="font-size:12.5px; color:var(--mut);">${esc(r.unite)}</div>` },
      { key: 'cout_dose', label: 'Coût unitaire', align: 'r',
        cell: (r) => `<div class="num r accent" style="font-size:12.5px;">${eur(r.cout_dose)}</div>` },
      { key: 'created_at', label: 'Créée le', align: 'r',
        cell: (r) => `<div class="num r created-at">${r.created_at.slice(0, 10)}</div>` },
      { key: 'actions', label: '', sortable: false,
        cell: (r) => `<div class="row" style="gap:5px; justify-self:end;">
          <button class="icon-btn" data-edit="${r.id}" aria-label="Éditer" title="Éditer">${icone('crayon', 15)}</button>
          <button class="icon-btn danger" data-del="${r.id}" aria-label="Supprimer">×</button></div>` },
    ],
    summary: (picked) => `
      <div class="sum-figs">
        <span class="sum-count">${picked.length} retenue${picked.length > 1 ? 's' : ''}</span>
        <span>Coût unitaire cumulé <b class="num">${eur(picked.reduce((a, r) => a + r.cout_dose, 0))}</b></span>
        <span>Coût moyen <b class="num">${eur(picked.reduce((a, r) => a + r.cout_dose, 0) / picked.length)}</b></span>
      </div>
      <div class="row"><button class="btn muted" data-unpick>Tout décocher</button></div>`,
    bindSummary: (bar) => {
      bar.querySelector('[data-unpick]').addEventListener('click', () => {
        tableState(T_GARNITURES).selected.clear();
        render(el);
      });
    },
    empty: `<div class="empty-note">Aucune garniture : elles servent uniquement à chiffrer
      les recettes.</div>`,
    foot: `<span class="pretty">Ni stock, ni seuil, ni inventaire : ces références servent
      uniquement à chiffrer les recettes.</span>`,
  };

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:1fr 320px; gap:18px; align-items:start;">
    <div class="stack" style="gap:18px;">
      <div class="panel">
        <div class="panel-head">
          <div class="serif-title">Maintien du stock</div>
          <div style="font-size:12.5px; color:var(--mut3);">Seuil d’alerte, stock cible, prix d’achat et marge</div>
        </div>
        <div data-suivies data-section="seuils"></div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="serif-title">Références non suivies</div>
          <button class="btn" data-new-untracked>+ Garniture</button>
        </div>
        <div data-garnitures data-section="garnitures"></div>
      </div>
    </div>

    <div class="stack" style="gap:14px;">
      <div class="panel" data-section="import">
        <div style="padding:15px 18px; border-bottom:1px solid var(--line);" class="serif-title">
          Mise à jour par fichier</div>
        <div data-import-card></div>
      </div>
      <div class="panel" style="padding:18px; display:flex; flex-direction:column; gap:10px;">
        <div class="mono-label" style="color:var(--mut2);">Historique des imports</div>
        ${importsData.imports.length === 0
          ? '<div style="font-size:12.5px; color:var(--mut3);">Aucun import pour l’instant.</div>'
          : importsData.imports.slice(0, 6).map((h) => `
          <div class="row spread" style="gap:10px;">
            <div style="font-size:12.5px; color:var(--mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(h.filename)}</div>
            <div class="num" style="font-size:11.5px; color:var(--mut3); flex:0 0 auto;">
              ${esc(h.created_at.slice(0, 10))} · ${h.line_count} lignes</div>
          </div>`).join('')}
      </div>
    </div>
  </div>`;

  // ---------- liaisons table ----------

  const suiviesEl = el.querySelector('[data-suivies]');
  const garnituresEl = el.querySelector('[data-garnitures]');
  renderTable(suiviesEl, suiviesSpec);
  bindTable(suiviesEl, suiviesSpec, () => render(el));
  renderTable(garnituresEl, garnituresSpec);
  bindTable(garnituresEl, garnituresSpec, () => render(el));

  el.querySelectorAll('[data-seuil]').forEach((n) =>
    n.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const r = tracked.find((x) => x.id === Number(n.dataset.seuil));
        patchRef(r.id, { seuil: Math.max(0, r.seuil + Number(b.dataset.dir)) });
      })
    )
  );
  el.querySelectorAll('[data-par]').forEach((n) =>
    n.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const r = tracked.find((x) => x.id === Number(n.dataset.par));
        patchRef(r.id, { par_target: Math.max(0, r.par_target + Number(b.dataset.dir)) });
      })
    )
  );
  const blurPatch = (attr, key, transform) =>
    el.querySelectorAll(`[data-${attr}]`).forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('blur', () => {
        const id = Number(inp.dataset[attr]);
        const r = stockData.refs.find((x) => x.id === id);
        const v = parseNum(inp.value);
        if (v > 0 && Math.abs(v - (attr === 'achat' ? r.achat_ht : r.marge)) > 0.001) {
          patchRef(id, { [key]: transform ? transform(v) : v });
        }
      });
    });
  blurPatch('achat', 'achat_ht');
  blurPatch('marge', 'marge_pct');

  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () =>
      openRefModal({ ref: stockData.refs.find((x) => x.id === Number(b.dataset.edit)) })
    )
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = stockData.refs.find((x) => x.id === Number(b.dataset.del));
      const ok = await confirmModal({
        title: `Supprimer ${r.nom} ?`,
        body: 'La référence disparaît de la cave et des listes. Les recettes qui l’utilisent devront être corrigées.',
      });
      if (!ok) return;
      await apiSend('DELETE', `/api/refs/${r.id}`);
      await refresh();
    })
  );
  el.querySelector('[data-new-untracked]').addEventListener('click', () =>
    openRefModal({ suivi: false })
  );

  // ---------- carte import (module partagé) ----------

  mountImportCard(el.querySelector('[data-import-card]'), { onApplied: () => render(el) });
}
