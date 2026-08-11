// Réception de marchandise : lieu + lignes (référence, quantité) → mouvements 'reception'.

import { apiGet, apiSend } from './api.js';
import { esc, num, openModal, closeModal, alertModal } from './ui.js';
import { S, refresh } from './app.js';

export async function openReception() {
  const all = (await apiGet('/api/stock')).refs.filter((r) => r.suivi);
  const state = {
    lieu: S.lieu !== 'tous' ? S.lieu : (S.meta.locations[0]?.id ?? null),
    lines: [],          // {ref, qty}
    query: '',
  };

  function matches() {
    const q = state.query.toLowerCase().trim();
    if (!q) return [];
    return all
      .filter((r) => !state.lines.some((l) => l.ref.id === r.id))
      .filter((r) => `${r.nom} ${r.marque} ${r.fournisseur}`.toLowerCase().includes(q))
      .slice(0, 6);
  }

  function html() {
    const found = matches();
    return `
    <div class="modal-head">
      <div class="serif-title">Réception de marchandise</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body" style="display:flex; flex-direction:column; gap:14px;">
      <div class="row">
        <div class="field grow"><div class="mono-label">Lieu de réception</div>
          <select class="input" data-lieu>
            ${S.meta.locations.map((l) => `<option value="${l.id}" ${l.id === state.lieu ? 'selected' : ''}>${esc(l.nom)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <div class="mono-label">Ajouter une référence</div>
        <input class="input" data-q value="${esc(state.query)}"
          placeholder="Chercher une bouteille, une marque, un fournisseur…">
      </div>
      ${found.length
        ? `<div class="panel">${found.map((r) => `
            <button data-add="${r.id}" style="display:flex; width:100%; align-items:center; gap:12px; padding:10px 14px; background:transparent; border:none; border-bottom:1px solid var(--line2); color:var(--ink); font-family:var(--sans); font-size:13px; cursor:pointer; text-align:left;">
              <span class="grow">${esc(r.nom)}</span>
              <span class="sub">${esc(r.fournisseur)}</span>
            </button>`).join('')}</div>`
        : ''}
      ${state.lines.length
        ? `<div class="panel">
            <div class="thead" style="grid-template-columns:1fr 130px 40px;">
              <div>Référence</div><div class="c">Quantité reçue</div><div></div>
            </div>
            ${state.lines.map((l, i) => `
            <div class="trow" style="grid-template-columns:1fr 130px 40px;">
              <div class="cell-main"><div class="nom">${esc(l.ref.nom)}</div>
                <div class="sub">${esc(l.ref.marque)}</div></div>
              <div class="stepper">
                <button data-minus="${i}">–</button>
                <span class="val">${num(l.qty, 0)}</span>
                <button data-plus="${i}">+</button>
              </div>
              <button class="icon-btn danger" data-del="${i}" aria-label="Retirer">×</button>
            </div>`).join('')}
          </div>`
        : `<div class="empty-note">Cherchez une référence ci-dessus, puis ajustez les quantités reçues.</div>`}
    </div>
    <div class="modal-foot">
      <div class="modal-hint">Chaque ligne devient un mouvement de réception dans le registre.</div>
      <div class="row">
        <button class="btn muted" data-cancel>Annuler</button>
        <button class="btn-solid" data-save ${state.lines.length ? '' : 'disabled'}>Valider la réception</button>
      </div>
    </div>`;
  }

  function bind(modal) {
    const q = modal.querySelector('[data-q]');
    q.addEventListener('input', () => {
      state.query = q.value;
      rerender(true);
    });
    modal.querySelector('[data-lieu]').addEventListener('change', (e) => {
      state.lieu = Number(e.target.value);
    });
    modal.querySelectorAll('[data-add]').forEach((b) =>
      b.addEventListener('click', () => {
        const ref = all.find((r) => r.id === Number(b.dataset.add));
        state.lines.push({ ref, qty: 1 });
        state.query = '';
        rerender();
      })
    );
    modal.querySelectorAll('[data-minus]').forEach((b) =>
      b.addEventListener('click', () => {
        const l = state.lines[Number(b.dataset.minus)];
        l.qty = Math.max(1, l.qty - 1);
        rerender();
      })
    );
    modal.querySelectorAll('[data-plus]').forEach((b) =>
      b.addEventListener('click', () => {
        state.lines[Number(b.dataset.plus)].qty += 1;
        rerender();
      })
    );
    modal.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        state.lines.splice(Number(b.dataset.del), 1);
        rerender();
      })
    );
    modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
    modal.querySelector('[data-save]').addEventListener('click', save);
  }

  function rerender(keepFocus = false) {
    const modal = openModal(html());
    bind(modal);
    if (keepFocus) {
      const q = modal.querySelector('[data-q]');
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
  }

  async function save() {
    try {
      await apiSend('POST', '/api/movements/bulk', {
        location_id: state.lieu,
        source: 'manuel',
        lines: state.lines.map((l) => ({ ref_id: l.ref.id, type: 'reception', quantity: l.qty })),
      });
      closeModal();
      await refresh();
    } catch (e) {
      await alertModal({ title: 'Réception impossible', body: e.message });
    }
  }

  rerender();
}
