// Inventaire : par lieu, comptage partiel autorisé, une bouteille ouverte max par référence.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, confirmModal } from '../ui.js';
import { S, go, refresh } from '../app.js';
import { sortState, applySort, sortHeader, bindSort } from '../sortable.js';

const SORT = sortState('nom');

const LEVELS = [
  { v: 0, label: 'vide' },
  { v: 0.25, label: '¼' },
  { v: 0.5, label: '½' },
  { v: 0.75, label: '¾' },
  { v: 1, label: 'pleine' },
];

// session de comptage en cours, par lieu : Map<refId, {level, fulls}>
const sessions = {};

export async function render(el) {
  if (S.lieu === 'tous') {
    el.innerHTML = `
    <div class="panel" style="max-width:560px;">
      <div class="panel-head"><div class="serif-title">Choisir le lieu à compter</div></div>
      <div class="empty-note">L’inventaire se compte lieu par lieu — vous pouvez ne compter
        qu’une partie des références, seules les lignes touchées seront enregistrées.</div>
      <div class="row" style="padding:0 20px 20px; gap:10px;">
        ${S.meta.locations.map((l) => `<button class="btn" data-pick="${l.id}">${esc(l.nom)}</button>`).join('')}
      </div>
    </div>`;
    el.querySelectorAll('[data-pick]').forEach((b) =>
      b.addEventListener('click', async () => {
        S.lieu = Number(b.dataset.pick);
        await refresh();
      })
    );
    return;
  }

  const lieuId = S.lieu;
  const lieuNom = S.meta.locations.find((l) => l.id === lieuId)?.nom || '';
  const refs = applySort(
    (await apiGet(`/api/stock?lieu=${lieuId}`)).refs.filter((r) => r.suivi), SORT
  );
  const session = (sessions[lieuId] ||= new Map());

  const countedOf = (t) => t.fulls + (t.level ?? 0);

  function summary() {
    let value = 0;
    for (const [id, t] of session) {
      const r = refs.find((x) => x.id === id);
      if (r) value += countedOf(t) * r.achat_ht;
    }
    return { count: session.size, value };
  }

  function rowHtml(r) {
    const t = session.get(r.id);
    return `
    <div class="trow" style="grid-template-columns:2fr 1.6fr .8fr .8fr;" data-row="${r.id}">
      <div class="cell-main">
        <div class="nom">${esc(r.nom)}</div>
        <div class="sub">${esc(r.marque)} · théorique ${num(r.stock, r.stock % 1 ? 2 : 0)}</div>
      </div>
      <div class="row" style="gap:5px;">
        ${LEVELS.map((l) => `
        <button data-level="${l.v}" class="level-btn ${t && t.level === l.v ? 'on' : ''}">${l.label}</button>`).join('')}
      </div>
      <div class="stepper" style="justify-content:flex-end;">
        <button data-minus>–</button>
        <span class="val">${t ? num(t.fulls, 0) : '·'}</span>
        <button data-plus>+</button>
      </div>
      <div class="num r" style="font-size:12.5px; color:${t ? 'var(--ac2)' : 'var(--mut3)'};">
        ${t ? num(countedOf(t), 2) : 'non compté'}</div>
    </div>`;
  }

  function summaryHtml() {
    const s = summary();
    return `
    <div class="mono-label" style="color:var(--ok-label);">Comptage en cours · ${esc(lieuNom)}</div>
    <div style="font-family:var(--serif); font-size:36px; line-height:1;">${eur(s.value)}</div>
    <div style="font-size:12.5px; color:var(--ok-mut);">${s.count} référence${s.count > 1 ? 's' : ''} comptée${s.count > 1 ? 's' : ''}
      sur ${refs.length} · les lignes non touchées gardent leur stock théorique.</div>
    <button class="btn-solid" data-close ${s.count ? '' : 'disabled'}
      style="${s.count ? '' : 'opacity:.45; cursor:default;'}">Clôturer l’inventaire</button>`;
  }

  if (refs.length === 0) {
    el.innerHTML = `<div class="panel"><div class="empty-note">Aucune référence suivie à compter.
      Créez des références depuis « + Référence » ou importez un fichier.</div></div>`;
    return;
  }

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:1fr 300px; gap:18px; align-items:start;">
    <div class="panel">
      <div class="thead" style="grid-template-columns:2fr 1.6fr .8fr .8fr;">
        ${sortHeader('Référence', 'nom', SORT)}
        <div>Niveau de la bouteille ouverte</div>
        ${sortHeader('Théorique', 'stock', SORT, { align: 'r' })}
        <div class="r">Compté</div>
      </div>
      <div data-rows>${refs.map(rowHtml).join('')}</div>
    </div>
    <div class="card-ok" style="padding:20px; display:flex; flex-direction:column; gap:14px; position:sticky; top:90px;" data-summary>
      ${summaryHtml()}
    </div>
  </div>`;

  bindSort(el, SORT, () => render(el));

  const rowsEl = el.querySelector('[data-rows]');
  const summaryEl = el.querySelector('[data-summary]');

  function touch(refId) {
    if (!session.has(refId)) {
      const r = refs.find((x) => x.id === refId);
      // point de départ : théorique arrondi vers le bas, bouteille ouverte « vide »
      session.set(refId, { level: 0, fulls: Math.max(0, Math.floor(r.stock)) });
    }
    return session.get(refId);
  }

  function repaintRow(refId) {
    const node = rowsEl.querySelector(`[data-row="${refId}"]`);
    const tmp = document.createElement('div');
    tmp.innerHTML = rowHtml(refs.find((x) => x.id === refId));
    node.replaceWith(tmp.firstElementChild);
    bindRow(rowsEl.querySelector(`[data-row="${refId}"]`));
    summaryEl.innerHTML = summaryHtml();
    bindClose();
  }

  function bindRow(node) {
    const refId = Number(node.dataset.row);
    node.querySelectorAll('[data-level]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = touch(refId);
        t.level = Number(b.dataset.level);
        repaintRow(refId);
      })
    );
    node.querySelector('[data-minus]').addEventListener('click', () => {
      const t = touch(refId);
      t.fulls = Math.max(0, t.fulls - 1);
      repaintRow(refId);
    });
    node.querySelector('[data-plus]').addEventListener('click', () => {
      const t = touch(refId);
      t.fulls += 1;
      repaintRow(refId);
    });
  }

  function bindClose() {
    const b = summaryEl.querySelector('[data-close]');
    b.addEventListener('click', async () => {
      if (!session.size) return;
      const ok = await confirmModal({
        title: 'Clôturer l’inventaire ?',
        body: `Les quantités comptées remplacent le stock théorique de ${session.size} référence(s) sur « ${lieuNom} ». Les autres ne bougent pas.`,
        label: 'Clôturer',
      });
      if (!ok) return;
      await apiSend('POST', '/api/movements/bulk', {
        location_id: lieuId,
        source: 'inventaire',
        lines: [...session.entries()].map(([refId, t]) => ({
          ref_id: refId,
          type: 'comptage',
          quantity: countedOf(t),
        })),
      });
      session.clear();
      go('#/dash');
    });
  }

  rowsEl.querySelectorAll('[data-row]').forEach(bindRow);
  bindClose();
}
