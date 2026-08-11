// Modifier en lot les références retenues : un champ à la fois, appliqué ligne à ligne.
// Volontairement un seul champ par passage : une modale qui change quatre choses d'un
// coup sur trois cents lignes est une modale qu'on regrette.

import { apiSend } from './api.js';
import { esc, openModal, closeModal, alertModal, confirmModal } from './ui.js';
import { S } from './app.js';

const CHAMPS = [
  { key: 'categorie_id', label: 'Catégorie', type: 'categorie' },
  { key: 'marge_pct', label: 'Marge cible (%)', type: 'nombre', ph: '80, vide = marge de la catégorie' },
  { key: 'seuil', label: 'Seuil d’alerte', type: 'nombre', ph: '2' },
  { key: 'par_target', label: 'Stock cible', type: 'nombre', ph: '6' },
  { key: 'fournisseur', label: 'Fournisseur', type: 'liste', options: () => S.meta.lists.fournisseurs },
];

export function openBulkModal({ refs, onDone }) {
  let champ = CHAMPS[0].key;
  let valeur = '';

  const courant = () => CHAMPS.find((c) => c.key === champ);

  function champHtml() {
    const c = courant();
    if (c.type === 'categorie') {
      const cats = S.meta.categories.filter((x) => x.nom !== 'Consommable');
      return `<select class="input" data-valeur>
        ${cats.map((x) => `<option value="${x.id}" ${String(x.id) === String(valeur) ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}
      </select>`;
    }
    if (c.type === 'liste') {
      return `<select class="input" data-valeur>
        ${c.options().map((o) => `<option ${o === valeur ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>`;
    }
    return `<input class="input num" data-valeur value="${esc(valeur)}" placeholder="${esc(c.ph || '')}">`;
  }

  function html() {
    return `
    <div class="modal-head">
      <div class="serif-title">Modifier ${refs.length} référence${refs.length > 1 ? 's' : ''}</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body" style="display:flex; flex-direction:column; gap:14px;">
      <div class="field"><div class="mono-label">Ce que l’on change</div>
        <select class="input" data-champ>
          ${CHAMPS.map((c) => `<option value="${c.key}" ${c.key === champ ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
        </select></div>
      <div class="field"><div class="mono-label">Nouvelle valeur</div>${champHtml()}</div>
      <div class="sub pretty">Appliqué à : ${esc(refs.slice(0, 4).map((r) => r.nom).join(', '))}${refs.length > 4 ? `, et ${refs.length - 4} autre${refs.length - 4 > 1 ? 's' : ''}` : ''}.</div>
    </div>
    <div class="modal-foot">
      <div class="modal-hint">Les prix conseillés se recalculent aussitôt.</div>
      <div class="row">
        <button class="btn muted" data-cancel>Annuler</button>
        <button class="btn-solid" data-go>Appliquer</button>
      </div>
    </div>`;
  }

  function bind(modal) {
    modal.querySelector('[data-champ]').addEventListener('change', (e) => {
      champ = e.target.value;
      valeur = '';
      bind(openModal(html(), { width: 470 }));
    });
    modal.querySelector('[data-valeur]').addEventListener('input', (e) => { valeur = e.target.value; });
    modal.querySelector('[data-valeur]').addEventListener('change', (e) => { valeur = e.target.value; });
    modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
    modal.querySelector('[data-go]').addEventListener('click', appliquer);
  }

  async function appliquer() {
    const c = courant();
    const brut = valeur === '' && c.type !== 'nombre' ? null : valeur;
    let v;
    if (c.type === 'nombre') {
      // vide = revenir à l'héritage (marge de la catégorie), pas zéro
      v = valeur.trim() === ''
        ? (c.key === 'marge_pct' ? null : 0)
        : parseFloat(String(valeur).replace(',', '.'));
      if (v !== null && Number.isNaN(v)) {
        await alertModal({ title: 'Valeur illisible', body: 'Saisissez un nombre.' });
        return;
      }
    } else if (c.type === 'categorie') {
      v = Number(brut ?? S.meta.categories[0].id);
    } else {
      v = brut ?? (c.options()[0] || '');
    }

    const ok = await confirmModal({
      title: `Appliquer à ${refs.length} référence${refs.length > 1 ? 's' : ''} ?`,
      body: `${c.label} devient « ${v === null ? 'valeur de la catégorie' : v} ». L’opération se fait ligne à ligne et ne peut pas être annulée d’un bloc.`,
      label: 'Appliquer',
    });
    if (!ok) return;

    let faits = 0;
    const echecs = [];
    for (const r of refs) {
      try {
        await apiSend('PATCH', `/api/refs/${r.id}`, { [c.key]: v });
        faits += 1;
      } catch (e) {
        echecs.push(`${r.nom} : ${e.message}`);
      }
    }
    closeModal();
    if (echecs.length) {
      await alertModal({
        title: `${faits} modifiée${faits > 1 ? 's' : ''}, ${echecs.length} en échec`,
        body: echecs.slice(0, 5).join(' | '),
      });
    }
    if (onDone) await onDone();
  }

  bind(openModal(html(), { width: 470 }));
}
