// Cave & seuils : maintien du stock, garnitures non suivies, import de fichier.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, parseNum, confirmModal } from '../ui.js';
import { S, refresh, lieuQuery, fmtStock } from '../app.js';
import { openRefModal } from '../refmodal.js';
import { mountImportCard } from '../importcard.js';

const GRID = 'grid-template-columns:2fr .7fr 1fr 1fr 1fr .8fr .8fr 66px;';
const UGRID = 'grid-template-columns:2fr 1fr 1fr 1fr 66px;';

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

  const trackedBody = tracked.length === 0
    ? `<div class="empty-note">Aucune référence suivie — créez-en avec « + Référence » ou déposez un fichier ci-contre.</div>`
    : tracked.map((r) => `
    <div class="trow" style="${GRID} padding:11px 20px;">
      <div class="cell-main">
        <div class="nom">${esc(r.nom)}</div>
        <div class="sub">${esc(r.marque)}${r.fournisseur ? ' · ' + esc(r.fournisseur) : ''}</div>
      </div>
      <div class="num r" style="font-size:12.5px;">${fmtStock(r)}</div>
      <div class="stepper" data-seuil="${r.id}">
        <button data-dir="-1">–</button><span class="val">${num(r.seuil, 0)}</span><button data-dir="1">+</button>
      </div>
      <div class="stepper" data-par="${r.id}">
        <button data-dir="-1">–</button><span class="val">${num(r.par_target, 0)}</span><button data-dir="1">+</button>
      </div>
      <input class="input num" data-achat="${r.id}" value="${num(r.achat_ht, 2)}" aria-label="Prix d'achat">
      <input class="input num" data-marge="${r.id}" value="${num(r.marge, 0)}" aria-label="Marge">
      ${r.low
        ? '<div class="chip-low">SOUS SEUIL</div>'
        : '<div class="num r" style="font-size:10.5px; color:var(--ok-ink); justify-self:end;">suffisant</div>'}
      <div class="row" style="gap:5px; justify-self:end;">
        <button class="icon-btn" data-edit="${r.id}" aria-label="Éditer">ÉD</button>
        <button class="icon-btn danger" data-del="${r.id}" aria-label="Supprimer">×</button>
      </div>
    </div>`).join('');

  const untrackedBody = untracked.length === 0
    ? `<div class="empty-note">Aucune garniture — elles servent uniquement à chiffrer les fiches cocktails.</div>`
    : untracked.map((r) => {
      return `
    <div class="trow" style="${UGRID} padding:11px 20px;">
      <div class="cell-main">
        <div class="nom">${esc(r.nom)}</div>
        <div class="sub">${esc(r.marque)}</div>
      </div>
      <div style="font-size:12.5px; color:var(--mut);">${esc(r.unite)}</div>
      <div class="num r accent" style="font-size:12.5px;">${eur(r.cout_dose)}</div>
      <div class="num r" style="font-size:12px; color:var(--mut2);">—</div>
      <div class="row" style="gap:5px; justify-self:end;">
        <button class="icon-btn" data-edit="${r.id}" aria-label="Éditer">ÉD</button>
        <button class="icon-btn danger" data-del="${r.id}" aria-label="Supprimer">×</button>
      </div>
    </div>`;
    }).join('');

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:1fr 320px; gap:18px; align-items:start;">
    <div class="stack" style="gap:18px;">
      <div class="panel">
        <div class="panel-head">
          <div class="serif-title">Maintien du stock</div>
          <div style="font-size:12.5px; color:var(--mut3);">Seuil d’alerte, stock cible, prix d’achat et marge</div>
        </div>
        <div class="thead" style="${GRID}">
          <div>Référence</div><div class="r">Stock</div><div class="c">Seuil</div><div class="c">Cible</div>
          <div class="c">Achat HT</div><div class="c">Marge %</div><div class="r">Statut</div><div></div>
        </div>
        ${trackedBody}
        <div class="panel-foot">
          <span>Modifier un prix d’achat recalcule aussitôt le coût par dose et le prix conseillé.</span>
          <span>${tracked.length} références · ${low} sous seuil</span>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="serif-title">Références non suivies</div>
          <button class="btn" data-new-untracked>+ Garniture</button>
        </div>
        <div class="thead" style="${UGRID}">
          <div>Garniture, épice, aromate</div><div>Unité</div><div class="r">Coût unitaire</div><div class="r"></div><div></div>
        </div>
        ${untrackedBody}
        <div class="panel-foot"><span class="pretty">Ni stock, ni seuil, ni inventaire : ces références
          servent uniquement à chiffrer les fiches cocktails.</span></div>
      </div>
    </div>

    <div class="stack" style="gap:14px;">
      <div class="panel">
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
        body: 'La référence disparaît de la cave et des listes. Les fiches cocktails qui l’utilisent devront être corrigées.',
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
