// Réglage des prix d'une tarification : on saisit des contraintes, on lit une
// proposition, on décide. Rien n'est écrit tant que « Appliquer » n'a pas été cliqué,
// et la proposition dit aussi ce qu'elle n'a pas pu tenir.

import { apiSend } from './api.js';
import { esc, eur, pc, openModal, closeModal, alertModal } from './ui.js';

const CHAMPS = [
  { key: 'prix_min', label: 'Prix mini (€)', ph: 'ex. 9' },
  { key: 'prix_max', label: 'Prix maxi (€)', ph: 'ex. 18' },
  { key: 'marge_moyenne', label: 'Marge moyenne visée (%)', ph: 'ex. 82' },
  { key: 'ecart_max', label: 'Écart maxi cher / pas cher (€)', ph: 'ex. 5' },
];

export function openOptimiser({ tarif, onApplied }) {
  const valeurs = {};

  function formulaire() {
    return `
    <div class="modal-head">
      <div class="serif-title">Régler les prix de « ${esc(tarif.nom)} »</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body grid2">
      ${CHAMPS.map((c) => `
      <div class="field">
        <div class="mono-label">${esc(c.label)}</div>
        <input class="input num" data-c="${c.key}" value="${valeurs[c.key] ?? ''}"
          placeholder="${esc(c.ph)}">
      </div>`).join('')}
    </div>
    <div class="modal-foot">
      <div class="modal-hint">Laissez vide ce que vous ne voulez pas contraindre. Les recettes
        au prix figé ne bougeront pas.</div>
      <div class="row">
        <button class="btn muted" data-cancel>Annuler</button>
        <button class="btn-solid" data-go>Calculer</button>
      </div>
    </div>`;
  }

  // La page de résultat annonce d'abord le verdict, puis le détail : c'est dans cet
  // ordre qu'on décide, pas en lisant quarante lignes pour se faire une idée.
  function resultat(r) {
    const s = r.resume;
    const fleche = (d) => (Math.abs(d) < 0.005 ? '' : d > 0 ? 'hausse' : 'baisse');
    return `
    <div class="modal-head">
      <div class="serif-title">Proposition pour « ${esc(tarif.nom)} »</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body" style="display:flex; flex-direction:column; gap:14px;">
      <div class="${r.violations.length ? 'card-warn' : 'card-ok'}" style="padding:16px 18px;">
        <div style="font-size:14px; line-height:1.6;">
          <b>${s.n} recette${s.n > 1 ? 's' : ''}, ${s.changees} prix change${s.changees > 1 ? 'nt' : ''}.</b><br>
          Marge moyenne ${pc(s.marge_avant, 1)} → <b>${pc(s.marge_apres, 1)}</b> ·
          écart ${eur(s.ecart_avant)} → <b>${eur(s.ecart_apres)}</b> ·
          ${s.sous_plancher
            ? `<b class="warn-text">${s.sous_plancher} sous le plancher</b>`
            : 'aucune sous le plancher'}
        </div>
        ${r.violations.length ? `
        <div style="margin-top:11px; display:flex; flex-direction:column; gap:5px;">
          ${r.violations.map((v) => `<div class="warn-text" style="font-size:12.5px;">Non tenu : ${esc(v)}</div>`).join('')}
        </div>` : ''}
      </div>
      <div style="max-height:44vh; overflow:auto;">
        <div class="cmp-row cmp-head">
          <div class="mono-label">Recette</div>
          <div class="mono-label r">Aujourd’hui</div>
          <div class="mono-label r">Proposé</div>
          <div class="mono-label r">Écart</div>
        </div>
        ${r.lines.map((li) => `
        <div class="cmp-row">
          <div class="cell-main"><div class="nom">${esc(li.nom)}${li.verrouille ? ' · figé' : ''}</div>
            <div class="sub">coût ${eur(li.cost)}</div></div>
          <div class="num r">${eur(li.prix_avant)}<span class="cmp-marge">${pc(li.marge_avant, 1)}</span></div>
          <div class="num r">${eur(li.prix_apres)}<span class="cmp-marge">${pc(li.marge_apres, 1)}</span></div>
          <div class="num r ${li.delta > 0 ? 'ok-text' : li.delta < 0 ? 'warn-text' : ''}">
            ${Math.abs(li.delta) < 0.005 ? '—' : (li.delta > 0 ? '+' : '') + eur(li.delta)}
            <span class="cmp-marge">${esc(fleche(li.delta))}</span></div>
        </div>`).join('')}
      </div>
    </div>
    <div class="modal-foot">
      <div class="modal-hint">Rien n’est enregistré tant que vous n’avez pas appliqué.</div>
      <div class="row">
        <button class="btn muted" data-retour>Modifier les contraintes</button>
        <button class="btn-solid" data-appliquer ${s.changees ? '' : 'disabled'}
          style="${s.changees ? '' : 'opacity:.45; cursor:default;'}">Appliquer ces prix</button>
      </div>
    </div>`;
  }

  function monterFormulaire() {
    const modal = openModal(formulaire(), { width: 520 });
    modal.querySelectorAll('[data-c]').forEach((inp) =>
      inp.addEventListener('input', () => { valeurs[inp.dataset.c] = inp.value; })
    );
    modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
    modal.querySelector('[data-go]').addEventListener('click', async () => {
      const body = {};
      for (const c of CHAMPS) {
        const v = String(valeurs[c.key] ?? '').trim();
        if (v === '') continue;
        const n = parseFloat(v.replace(',', '.'));
        if (Number.isNaN(n)) {
          await alertModal({ title: 'Valeur illisible', body: `${c.label} : saisissez un nombre.` });
          return;
        }
        body[c.key] = n;
      }
      const r = await apiSend('POST', `/api/tarifs/${tarif.id}/optimiser`, body);
      monterResultat(r);
    });
  }

  function monterResultat(r) {
    const modal = openModal(resultat(r), { width: 760 });
    modal.querySelector('[data-retour]').addEventListener('click', monterFormulaire);
    const btn = modal.querySelector('[data-appliquer]');
    if (!r.resume.changees) return;
    btn.addEventListener('click', async () => {
      const prix = {};
      r.lines.filter((li) => !li.verrouille).forEach((li) => { prix[li.id] = li.prix_apres; });
      await apiSend('PATCH', `/api/tarifs/${tarif.id}`, { prix });
      closeModal();
      if (onApplied) await onApplied();
    });
  }

  monterFormulaire();
}
