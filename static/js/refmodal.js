// Modale de création / édition d'une référence (suivie ou non suivie).

import { apiSend } from './api.js';
import { esc, num, parseNum, openModal, closeModal } from './ui.js';
import { S, refresh } from './app.js';

function options(list, selected) {
  return list.map(
    (o) => `<option value="${esc(o.value)}" ${String(o.value) === String(selected) ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('');
}

function fieldHtml(f, value) {
  return `<div class="field">
    <div class="mono-label">${esc(f.k)}</div>
    <input class="input ${f.num ? 'num' : ''}" data-f="${f.key}"
      value="${esc(value ?? '')}" placeholder="${esc(f.ph)}">
  </div>`;
}

// ref: null (création) ou ligne de /api/stock (édition)
// onSaved(refId) : rappel après enregistrement ; suivi : type par défaut
export function openRefModal({ ref = null, suivi = true, onSaved = null } = {}) {
  const edit = !!ref;
  const catOptions = () =>
    S.meta.categories
      .filter((c) => !['Consommable', 'Garniture & épices'].includes(c.nom))
      .map((c) => ({ value: c.id, label: c.nom }));

  const state = {
    suivi: edit ? ref.suivi : suivi,
    cat: edit ? ref.categorie_id : null,
    four: edit ? ref.fournisseur : (S.meta.lists.fournisseurs[0] || ''),
    unite: edit ? ref.unite : (S.meta.lists.unites[0] || 'pièce'),
    droits: edit ? ref.droits_inclus : false,
    vals: {},
  };

  function fields() {
    return state.suivi
      ? [
          { key: 'nom', k: 'Nom de la référence', ph: 'Mezcal espadín' },
          { key: 'marque', k: 'Marque · origine', ph: 'Del Maguey · Oaxaca' },
          { key: 'vol_cl', k: 'Volume (cl)', ph: '70', num: true },
          { key: 'abv', k: 'Degré (% vol.)', ph: '45', num: true },
          { key: 'achat_ht', k: 'Prix d’achat HT (€)', ph: '31,00', num: true },
          { key: 'seuil', k: 'Seuil d’alerte', ph: '2', num: true },
          { key: 'par_target', k: 'Stock cible (commande)', ph: '6', num: true },
        ]
      : [
          { key: 'nom', k: 'Nom', ph: 'Romarin frais' },
          { key: 'marque', k: 'Précision', ph: 'Aromate · brûlé au service' },
          { key: 'achat_ht', k: 'Coût par unité (€)', ph: '0,30', num: true },
        ];
  }

  function currentValue(key) {
    if (key in state.vals) return state.vals[key];
    if (!edit) return '';
    const v = ref[key];
    if (v === null || v === undefined) return '';
    return typeof v === 'number' ? num(v, v % 1 ? 2 : 0) : v;
  }

  function html() {
    const f = fields();
    return `
    <div class="modal-head">
      <div class="serif-title">${edit ? 'Éditer la référence' : state.suivi ? 'Nouvelle référence suivie' : 'Nouvelle garniture non suivie'}</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="row" style="padding:18px 22px; border-bottom:1px solid var(--line2);">
      <div class="mono-label grow">Type de référence</div>
      <div class="seg">
        <button data-type="1" class="${state.suivi ? 'active' : ''}">Suivie en stock</button>
        <button data-type="0" class="${state.suivi ? '' : 'active'}">Non suivie</button>
      </div>
    </div>
    <div class="modal-body grid2">
      ${f.map((x) => fieldHtml(x, currentValue(x.key))).join('')}
      ${state.suivi
        ? `<div class="field"><div class="mono-label">Catégorie</div>
             <select class="input" data-cat>${options(catOptions(), state.cat ?? catOptions()[0]?.value)}</select></div>`
        : `<div class="field"><div class="mono-label">Unité</div>
             <select class="input" data-unite>${options(S.meta.lists.unites.map((u) => ({ value: u, label: u })), state.unite)}</select></div>`}
      <div class="field"><div class="mono-label">Fournisseur</div>
        <select class="input" data-four>${options(S.meta.lists.fournisseurs.map((x) => ({ value: x, label: x })), state.four)}</select></div>
      ${state.suivi
        ? `<label class="row" style="gap:9px; align-self:end; padding-bottom:8px; cursor:pointer;">
             <input type="checkbox" data-droits ${state.droits ? 'checked' : ''} style="accent-color:var(--ac);">
             <span style="font-size:12.5px; color:var(--mut);">Droits d’alcool déjà inclus dans le prix d’achat</span>
           </label>`
        : ''}
    </div>
    <div class="modal-foot">
      <div class="modal-hint">${edit
        ? 'Les modifications se répercutent sur les fiches cocktails et les prix conseillés.'
        : state.suivi
          ? 'Créée avec un stock à zéro sur chaque lieu — passez une réception pour la remplir.'
          : 'Aucun stock, aucun seuil : la garniture sert uniquement au chiffrage des fiches.'}</div>
      <div class="row">
        <button class="btn muted" data-cancel>Annuler</button>
        <button class="btn-solid" data-save>${edit ? 'Enregistrer' : 'Créer'}</button>
      </div>
    </div>`;
  }

  function bind(modal) {
    modal.querySelectorAll('[data-f]').forEach((inp) =>
      inp.addEventListener('input', () => { state.vals[inp.dataset.f] = inp.value; })
    );
    modal.querySelectorAll('[data-type]').forEach((b) =>
      b.addEventListener('click', () => {
        state.suivi = b.dataset.type === '1';
        rerender();
      })
    );
    const cat = modal.querySelector('[data-cat]');
    if (cat) cat.addEventListener('change', () => { state.cat = Number(cat.value); });
    const un = modal.querySelector('[data-unite]');
    if (un) un.addEventListener('change', () => { state.unite = un.value; });
    modal.querySelector('[data-four]').addEventListener('change', (e) => { state.four = e.target.value; });
    const dr = modal.querySelector('[data-droits]');
    if (dr) dr.addEventListener('change', () => { state.droits = dr.checked; });
    modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
    modal.querySelector('[data-save]').addEventListener('click', save);
  }

  function rerender() {
    bind(openModal(html()));
  }

  async function save() {
    const get = (k) => state.vals[k] ?? (edit ? ref[k] : '');
    const body = {
      nom: String(get('nom') || '').trim(),
      marque: String(get('marque') || '').trim(),
      fournisseur: state.four,
      suivi: state.suivi,
    };
    if (!body.nom) { alert('Le nom est obligatoire.'); return; }
    if (state.suivi) {
      body.categorie_id = state.cat ?? catOptions()[0]?.value;
      body.vol_cl = parseNum(get('vol_cl')) || 70;
      body.abv = parseNum(get('abv'));
      body.achat_ht = parseNum(get('achat_ht'));
      body.seuil = parseNum(get('seuil'));
      body.par_target = parseNum(get('par_target'));
      body.droits_inclus = state.droits;
      body.unite = 'pièce';
    } else {
      const garniture = S.meta.categories.find((c) => c.nom === 'Garniture & épices');
      body.categorie_id = garniture ? garniture.id : S.meta.categories[0].id;
      body.achat_ht = parseNum(get('achat_ht'));
      body.unite = state.unite;
      body.vol_cl = 1;
      body.abv = 0;
      body.seuil = 0;
      body.par_target = 0;
      body.droits_inclus = true;
    }
    try {
      let id;
      if (edit) {
        await apiSend('PATCH', `/api/refs/${ref.id}`, body);
        id = ref.id;
      } else {
        id = (await apiSend('POST', '/api/refs', body)).id;
      }
      closeModal();
      if (onSaved) await onSaved(id);
      else await refresh();
    } catch (e) {
      alert(`Enregistrement impossible : ${e.message}`);
    }
  }

  rerender();
}
