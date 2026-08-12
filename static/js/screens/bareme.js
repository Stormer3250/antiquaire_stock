// Barème fiscal : taux éditables + effet sur la dose pour les références réelles.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, pc, parseNum, openModal, closeModal, confirmModal, alertModal } from '../ui.js';
import { S, reloadMeta, lieuQuery } from '../app.js';

const PARAMS = [
  { key: 'accise', k: 'Droit d’accise · spiritueux', n: 'au hL d’alcool pur', unit: '€/hL AP', d: 0 },
  { key: 'accise_dom', k: 'Droit d’accise · rhum des DOM', n: 'taux réduit, rhum traditionnel des départements d’outre-mer', unit: '€/hL AP', d: 2 },
  { key: 'ss', k: 'Cotisation sécurité sociale', n: 'boissons de plus de 18 % vol.', unit: '€/hL AP', d: 0 },
  { key: 'vin', k: 'Vin tranquille', n: 'au hL de produit fini', unit: '€/hL', d: 2 },
  { key: 'mousseux', k: 'Vin mousseux', n: 'champagnes et effervescents', unit: '€/hL', d: 2 },
  { key: 'biere', k: 'Bière', n: 'au hL et par degré alcoolique', unit: '€/hL/degré', d: 2 },
];

const LABELS = {
  accise: 'Accise · spiritueux', accise_dom: 'Accise · rhum des DOM',
  ss: 'Cotisation sécurité sociale', vin: 'Vin tranquille',
  mousseux: 'Vin mousseux', biere: 'Bière',
};

export async function render(el) {
  const [refsData, tauxData] = await Promise.all([
    apiGet(`/api/stock?lieu=${lieuQuery()}`),
    apiGet('/api/taux'),
  ]);
  const tracked = refsData.refs.filter((r) => r.suivi);
  const rates = S.meta.rates;
  // barème antérieur à la migration 002 : on retombe sur le taux métropolitain
  if (rates.accise_dom === undefined) rates.accise_dom = rates.accise;

  // effet par dose, calculé sur les références réelles via la fiche
  const examples = await Promise.all(
    tracked.slice(0, 6).map((r) => apiGet(`/api/refs/${r.id}?lieu=${lieuQuery()}`))
  );

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:1.1fr 1fr; gap:18px; align-items:start;">
    <div class="panel" data-section="taux">
      <div class="panel-head"><div class="serif-title">Barème des droits d’alcool</div></div>
      ${PARAMS.map((p) => `
      <div class="row spread" style="padding:14px 20px; border-bottom:1px solid var(--line2); gap:18px;">
        <div class="cell-main">
          <div style="font-size:13.5px;">${esc(p.k)}</div>
          <div class="sub pretty">${esc(p.n)}</div>
        </div>
        <div class="row" style="gap:9px; flex:0 0 auto;">
          <input class="input num" data-rate="${p.key}" value="${num(rates[p.key], p.d)}"
            style="width:92px; font-size:13px;" aria-label="${esc(p.k)}">
          <span class="num" style="font-size:11px; color:var(--mut2); min-width:78px;">${p.unit}</span>
        </div>
      </div>`).join('')}
      <div class="panel-foot"><span class="pretty">Ces taux alimentent la part fiscale des fiches
        et le coût des références dont les droits ne sont pas inclus dans l’achat.</span></div>
    </div>

    <div class="panel" data-section="effet-dose">
      <div class="panel-head"><div class="serif-title">Effet sur la dose</div></div>
      ${examples.length === 0
        ? `<div class="empty-note">Créez des références suivies pour voir l’effet du barème sur leurs doses.</div>`
        : examples.map((p) => {
          const t = p.fiscal.accise + p.fiscal.ss;
          return `
        <div style="display:grid; grid-template-columns:1.5fr .8fr .8fr; gap:12px; align-items:center; padding:12px 20px; border-bottom:1px solid var(--line2);">
          <div class="cell-main">
            <div class="nom" style="font-size:13px;">${esc(p.nom)}</div>
            <div class="sub">${num(p.dose_cl, 0)} cl à ${num(p.abv, 1)} % vol.</div>
          </div>
          <div class="num r" style="font-size:12.5px; color:var(--ac3);">${eur(t, 3)}</div>
          <div class="num r" style="font-size:12px; color:var(--mut2);">${p.cout_dose > 0 ? pc(t / p.cout_dose * 100, 1) : '—'}</div>
        </div>`;
        }).join('')}
      <div class="panel-foot"><span>Taxe par dose</span><span>part du coût matière</span></div>
    </div>

    <div class="panel" style="grid-column:1 / -1;" data-section="historique-taux">
      <div class="panel-head">
        <div>
          <div class="serif-title">Historique du barème</div>
          <div style="font-size:12.5px; color:var(--mut3); margin-top:3px;">Un taux vaut
            à partir d’une date : re-chiffrer une carte de l’an dernier donne ce qu’elle
            coûtait l’an dernier.</div>
        </div>
        <button class="btn" data-nouveau-taux>+ Nouveau taux</button>
      </div>
      <div class="thead" style="grid-template-columns:1.6fr .8fr .8fr 1.4fr 60px;">
        <div>Taux</div><div class="r">Valeur</div><div class="r">À partir du</div>
        <div>Note</div><div></div>
      </div>
      ${tauxData.taux.map((x) => {
        const courant = tauxData.courants[x.code] === x.valeur;
        return `
        <div class="trow" style="grid-template-columns:1.6fr .8fr .8fr 1.4fr 60px; padding:9px 20px;">
          <div style="font-size:12.5px;">${esc(LABELS[x.code] || x.code)}
            ${courant ? '<span class="chip-actif" style="margin-left:6px;">EN VIGUEUR</span>' : ''}</div>
          <div class="num r" style="font-size:12.5px;">${num(x.valeur, 2)}</div>
          <div class="num r" style="font-size:12px; color:var(--mut);">${esc(x.effet_le)}</div>
          <div style="font-size:11.5px; color:var(--mut3);">${esc(x.note)}</div>
          <button class="icon-btn danger" data-del-taux="${x.id}" style="justify-self:end;"
            aria-label="Supprimer ce taux">×</button>
        </div>`;
      }).join('')}
      <div class="panel-foot"><span class="pretty">Modifier une valeur en haut de page crée
        un taux valable à partir d’aujourd’hui : l’ancien reste, et couvre sa période.</span></div>
    </div>
  </div>`;

  el.querySelector('[data-nouveau-taux]').addEventListener('click', () => nouveauTaux(el));
  el.querySelectorAll('[data-del-taux]').forEach((b) =>
    b.addEventListener('click', async () => {
      const x = tauxData.taux.find((y) => y.id === Number(b.dataset.delTaux));
      const ok = await confirmModal({
        title: `Supprimer ce taux du ${x.effet_le} ?`,
        body: 'Le taux précédent reprendra effet pour cette période.',
      });
      if (!ok) return;
      try {
        await apiSend('DELETE', `/api/taux/${x.id}`);
      } catch (e) {
        await alertModal({ title: 'Suppression refusée', body: e.message });
      }
      await reloadMeta();
      await render(el);
    })
  );

  el.querySelectorAll('[data-rate]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', async () => {
      const key = inp.dataset.rate;
      const v = parseNum(inp.value);
      if (v <= 0 || Math.abs(v - rates[key]) < 0.001) return;
      await apiSend('PATCH', '/api/settings', { rates: { [key]: v } });
      await reloadMeta();
      await render(el);
    });
  });
}


function nouveauTaux(el) {
  const modal = openModal(`
    <div class="modal-head">
      <div class="serif-title">Nouveau taux</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
      <div class="field"><div class="mono-label">Taux</div>
        <select class="input" data-code>
          ${Object.entries(LABELS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select></div>
      <div class="field"><div class="mono-label">Valeur</div>
        <input class="input num" data-valeur placeholder="ex. 2100"></div>
      <div class="field"><div class="mono-label">À partir du</div>
        <input class="input" type="date" data-effet></div>
      <div class="field"><div class="mono-label">Note</div>
        <input class="input" data-note placeholder="ex. loi de finances 2027"></div>
    </div>
    <div class="modal-foot">
      <div class="modal-hint">Une date future est acceptée : le taux s’appliquera le jour venu.</div>
      <div class="row">
        <button class="btn muted" data-cancel>Annuler</button>
        <button class="btn-solid" data-ok>Enregistrer</button>
      </div>
    </div>`, { width: 460 });

  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
  modal.querySelector('[data-ok]').addEventListener('click', async () => {
    const valeur = parseNum(modal.querySelector('[data-valeur]').value);
    const effet = modal.querySelector('[data-effet]').value;
    if (valeur <= 0 || !effet) {
      await alertModal({
        title: 'Il manque quelque chose',
        body: 'Une valeur strictement positive et une date de prise d’effet sont nécessaires.',
      });
      return;
    }
    try {
      await apiSend('POST', '/api/taux', {
        code: modal.querySelector('[data-code]').value,
        valeur,
        effet_le: effet,
        note: modal.querySelector('[data-note]').value.trim(),
      });
    } catch (e) {
      await alertModal({ title: 'Enregistrement impossible', body: e.message });
      return;
    }
    closeModal();
    await reloadMeta();
    await render(el);
  });
}
