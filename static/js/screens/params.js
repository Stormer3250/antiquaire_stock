// Paramètres : un seul écran pour la politique de prix, les catégories, le barème
// fiscal, les référentiels et les sauvegardes. Sous-navigation à gauche, un panneau
// à la fois à droite.
//
// Les panneaux 1 à 4 n'écrivent plus en base à chaque champ quitté : ils remplissent un
// brouillon, et une barre collante propose « Enregistrer » ou « Abandonner ». Le
// brouillon survit au changement de panneau (c'est un seul écran) ; quitter l'écran
// demande confirmation (le garde-fou vit dans app.js, via hasDraft()).
//
// Ce qui reste immédiat, parce que ce sont des ACTIONS et non des réglages : créer ou
// supprimer une catégorie, les lieux de stockage (ressource à part, pas un réglage),
// les taux datés du barème, les sauvegardes et l'export.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, pc, parseNum, openModal, closeModal, confirmModal, alertModal } from '../ui.js';
import { S, reloadMeta, refresh, lieuQuery } from '../app.js';

const REGIMES = [
  { value: 'spiritueux', label: 'Spiritueux · accise hL AP' },
  { value: 'vin', label: 'Vin tranquille' },
  { value: 'mousseux', label: 'Vin mousseux' },
  { value: 'biere', label: 'Bière · au degré' },
  { value: 'intermediaire', label: 'Produit intermédiaire' },
  { value: 'aucun', label: 'Sans alcool · non soumis' },
];

const PRICING_FIELDS = [
  { key: 'cible', k: 'Marge cible moyenne', unit: '%', n: 'appliquée par défaut à toutes les catégories', d: 0 },
  { key: 'min', k: 'Marge plancher', unit: '%', n: 'sous ce seuil, le prix passe en alerte', d: 0 },
  { key: 'arrondi', k: 'Arrondi commercial', unit: '€', n: 'pas d’arrondi du prix TTC affiché à la carte', d: 2 },
];

const LISTS = [
  { key: 'fournisseurs', title: 'Fournisseurs', note: 'Proposés à la création d’une référence et à l’import.' },
  { key: 'familles', title: 'Familles de recettes', note: 'Classement des recettes sur une carte.' },
  { key: 'verres', title: 'Verrerie', note: 'Proposée sur chaque fiche cocktail.' },
  { key: 'unites', title: 'Unités des non suivies', note: 'Branche, trait, zeste, pincée… pour les garnitures.' },
];

const RATE_FIELDS = [
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

// ---------- le brouillon ----------

const draft = { pricing: {}, rates: {}, lists: {}, categories: new Map() };

export function hasDraft() {
  return !!(Object.keys(draft.pricing).length || Object.keys(draft.rates).length
    || Object.keys(draft.lists).length || draft.categories.size);
}

export function clearDraft() {
  draft.pricing = {};
  draft.rates = {};
  draft.lists = {};
  draft.categories.clear();
}

// valeurs affichées : le brouillon d'abord, l'état enregistré ensuite
const pv = (key) => draft.pricing[key] ?? S.meta.pricing[key];
const rv = (key) => draft.rates[key] ?? S.meta.rates[key];
const lv = (key) => draft.lists[key] ?? S.meta.lists[key];
const cv = (c, key) => draft.categories.get(c.id)?.[key] ?? c[key];

function setCat(id, key, value) {
  const patch = draft.categories.get(id) || {};
  const c = S.meta.categories.find((x) => x.id === id);
  if (value === c[key]) delete patch[key];
  else patch[key] = value;
  if (Object.keys(patch).length) draft.categories.set(id, patch);
  else draft.categories.delete(id);
  peindreBarre();
}

// Un champ ramené à sa valeur enregistrée sort du brouillon : revenir en arrière à la
// main doit faire disparaître la barre, pas laisser croire qu'il reste des changements.
function setScalaire(bucket, key, value, courant) {
  if (Math.abs(value - courant) < 0.0001) delete bucket[key];
  else bucket[key] = value;
  peindreBarre();
}

// ---------- panneaux ----------

const PANES = {
  prix: ['Politique de prix', panePrix],
  categories: ['Catégories', paneCategories],
  bareme: ['Barème fiscal', paneBareme],
  referentiels: ['Référentiels', paneReferentiels],
  sauvegardes: ['Sauvegardes & export', paneSauvegardes],
};

let pane = 'prix';
let host = null;          // le conteneur de l'écran, pour re-peindre la barre

export async function render(el) {
  host = el;
  const parts = (location.hash || '').slice(2).split('/');
  pane = PANES[parts[1]] ? parts[1] : 'prix';

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:216px 1fr; gap:18px; align-items:start;">
    <div class="panel params-nav">
      ${Object.entries(PANES).map(([key, [label]]) => `
      <button data-pane-go="${key}" class="${key === pane ? 'active' : ''}">${esc(label)}</button>`).join('')}
    </div>
    <div>
      <div data-draft></div>
      <div class="stack" data-pane style="gap:18px;"></div>
    </div>
  </div>`;

  el.querySelectorAll('[data-pane-go]').forEach((b) =>
    b.addEventListener('click', () => {
      // changer de panneau ne change pas d'écran : on repose le hash sans relancer le
      // routage, sinon le garde-fou de sortie s'inviterait à chaque clic.
      history.replaceState(null, '', '#/params/' + b.dataset.paneGo);
      render(el);
    })
  );

  await PANES[pane][1](el.querySelector('[data-pane]'));
  peindreBarre();
}

// Le hash courant de l'écran, pour que le garde-fou de app.js repose le bon panneau.
export function hash() {
  return '#/params/' + pane;
}

// ---------- barre collante ----------

function peindreBarre() {
  if (!host) return;
  const zone = host.querySelector('[data-draft]');
  if (!zone) return;
  if (!hasDraft()) { zone.innerHTML = ''; return; }
  zone.innerHTML = `
    <div class="draft-bar" data-draft-bar>
      <span>Modifications non enregistrées</span>
      <div class="row" style="gap:9px;">
        <button class="btn muted" data-abandon>Abandonner</button>
        <button class="btn-solid" data-enregistrer>Enregistrer</button>
      </div>
    </div>`;
  zone.querySelector('[data-abandon]').addEventListener('click', () => {
    clearDraft();
    render(host);
  });
  zone.querySelector('[data-enregistrer]').addEventListener('click', enregistrer);
}

async function enregistrer() {
  const body = {};
  if (Object.keys(draft.pricing).length) body.pricing = { ...draft.pricing };
  if (Object.keys(draft.rates).length) body.rates = { ...draft.rates };
  if (Object.keys(draft.lists).length) body.lists = { ...draft.lists };
  try {
    if (Object.keys(body).length) await apiSend('PATCH', '/api/settings', body);
    for (const [id, patch] of draft.categories) {
      await apiSend('PATCH', `/api/categories/${id}`, patch);
    }
  } catch (e) {
    // le brouillon reste intact : rien de saisi n'est perdu par un échec réseau
    await alertModal({ title: 'Enregistrement impossible', body: e.message });
    return;
  }
  await reloadMeta();     // reloadMeta rejoue setPctDecimales : les % suivent le réglage
  clearDraft();
  await render(host);
}

// ---------- 1. politique de prix ----------

async function panePrix(zone) {
  const decimales = pv('pct_decimales') ?? 0;
  zone.innerHTML = `
    <div class="panel" data-section="politique">
      <div class="panel-head"><div class="serif-title">Politique de prix</div></div>
      <div style="display:grid; grid-template-columns:repeat(3,1fr);">
        ${PRICING_FIELDS.map((f) => `
        <div style="padding:18px 20px; border-right:1px solid var(--line2); display:flex; flex-direction:column; gap:9px;">
          <div class="mono-label" style="color:var(--mut2);">${esc(f.k)}</div>
          <div class="row" style="gap:9px;">
            <input class="input num" data-pricing="${f.key}" value="${num(pv(f.key), f.d)}"
              style="width:88px; font-size:15px;" aria-label="${esc(f.k)}">
            <span class="num" style="font-size:11px; color:var(--mut2);">${f.unit}</span>
          </div>
          <div class="sub pretty">${esc(f.n)}</div>
        </div>`).join('')}
      </div>
    </div>

    <div class="panel" data-section="affichage">
      <div class="panel-head"><div class="serif-title">Affichage</div></div>
      <div class="row spread" style="padding:16px 20px; gap:18px;">
        <div class="cell-main">
          <div style="font-size:13.5px;">Décimales des pourcentages</div>
          <div class="sub pretty">Marges et parts affichées partout dans l’application.</div>
        </div>
        <div class="row" style="gap:12px; flex:0 0 auto;">
          <select class="input" data-pct-decimales style="width:96px;" aria-label="Décimales des pourcentages">
            ${[0, 1, 2].map((d) => `<option value="${d}" ${d === decimales ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
          <span class="num" style="font-size:12px; color:var(--mut2); min-width:70px;">${num(72.46, decimales)} %</span>
        </div>
      </div>
      <div class="panel-foot"><span class="pretty">Zéro décimale se lit d’un coup d’œil ;
        une ou deux servent quand les marges se jouent au dixième de point.</span></div>
    </div>`;

  zone.querySelectorAll('[data-pricing]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('input', () => {
      const v = parseNum(inp.value);
      if (v <= 0) return;
      setScalaire(draft.pricing, inp.dataset.pricing, v, S.meta.pricing[inp.dataset.pricing]);
    });
  });
  zone.querySelector('[data-pct-decimales]').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    setScalaire(draft.pricing, 'pct_decimales', v, S.meta.pricing.pct_decimales ?? 0);
    render(host);   // l'aperçu « 72 % / 72,5 % » suit tout de suite
  });
}

// ---------- 2. catégories ----------

async function paneCategories(zone) {
  const CGRID = 'grid-template-columns:1.4fr .8fr 1.4fr .8fr .8fr .4fr;';
  zone.innerHTML = `
    <div class="panel" data-section="categories">
      <div class="panel-head">
        <div class="serif-title">Catégories de produits</div>
        <button class="btn" data-cat-add>+ Catégorie</button>
      </div>
      <div class="thead" style="${CGRID}">
        <div>Nom</div><div class="c">Dose (cl)</div><div>Régime fiscal</div>
        <div class="c">Marge %</div><div class="c">TVA %</div><div></div>
      </div>
      ${S.meta.categories.map((c) => `
      <div class="trow" style="${CGRID} padding:10px 20px;">
        <input class="input" data-cat="${c.id}:nom" value="${esc(cv(c, 'nom'))}">
        <input class="input num" data-cat="${c.id}:dose_cl" value="${num(cv(c, 'dose_cl'), 0)}">
        <select class="input" data-cat="${c.id}:regime">
          ${REGIMES.map((r) => `<option value="${r.value}" ${r.value === cv(c, 'regime') ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select>
        <input class="input num" data-cat="${c.id}:marge_pct" value="${num(cv(c, 'marge_pct'), 0)}">
        <select class="input" data-cat="${c.id}:tva_pct">
          ${[20, 10, 5.5].map((t) => `<option value="${t}" ${t === cv(c, 'tva_pct') ? 'selected' : ''}>${num(t, t % 1 ? 1 : 0)} %</option>`).join('')}
        </select>
        <button class="icon-btn danger" data-cat-del="${c.id}" style="justify-self:end;" aria-label="Supprimer">×</button>
      </div>`).join('')}
      <div class="panel-foot"><span class="pretty">La dose définit le service au verre ;
        le régime pilote la part fiscale ; marge et TVA nourrissent le prix conseillé.</span></div>
    </div>`;

  const NUMERIQUES = new Set(['dose_cl', 'marge_pct', 'tva_pct']);
  zone.querySelectorAll('[data-cat]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const [id, key] = inp.dataset.cat.split(':');
      const v = NUMERIQUES.has(key) ? parseNum(inp.value) : inp.value.trim();
      if (v === '' || (NUMERIQUES.has(key) && key !== 'marge_pct' && v <= 0)) return;
      setCat(Number(id), key, v);
    });
  });

  // création et suppression restent immédiates : ce sont des actions de structure,
  // pas des champs qu'on retouche avant de valider.
  zone.querySelector('[data-cat-add]').addEventListener('click', async () => {
    try {
      await apiSend('POST', '/api/categories', {
        nom: `Nouvelle catégorie ${S.meta.categories.length + 1}`,
        dose_cl: 5, regime: 'aucun', marge_pct: S.meta.pricing.cible, tva_pct: 20,
        position: S.meta.categories.length,
      });
    } catch (e) { await alertModal({ title: 'Création impossible', body: e.message }); return; }
    await reloadMeta();
    await render(host);
  });
  zone.querySelectorAll('[data-cat-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const c = S.meta.categories.find((x) => x.id === Number(b.dataset.catDel));
      const ok = await confirmModal({
        title: `Supprimer la catégorie ${c.nom} ?`,
        body: 'Les références rattachées basculeront sur la première catégorie.',
      });
      if (!ok) return;
      try {
        await apiSend('DELETE', `/api/categories/${c.id}`);
      } catch (e) { await alertModal({ title: 'Modification refusée', body: e.message }); }
      draft.categories.delete(c.id);
      await reloadMeta();
      await render(host);
    })
  );
}

// ---------- 3. barème fiscal ----------

async function paneBareme(zone) {
  const [refsData, tauxData] = await Promise.all([
    apiGet(`/api/stock?lieu=${lieuQuery()}`),
    apiGet('/api/taux'),
  ]);
  const tracked = refsData.refs.filter((r) => r.suivi);
  // barème antérieur à la migration 002 : on retombe sur le taux métropolitain
  if (S.meta.rates.accise_dom === undefined) S.meta.rates.accise_dom = S.meta.rates.accise;

  // L'effet sur la dose est calculé par le serveur avec les taux ENREGISTRÉS : tant que
  // le brouillon n'est pas appliqué, ce panneau reste sur l'ancien barème. Écart assumé —
  // il se remet à jour dès « Enregistrer ».
  const examples = await Promise.all(
    tracked.slice(0, 6).map((r) => apiGet(`/api/refs/${r.id}?lieu=${lieuQuery()}`))
  );

  zone.innerHTML = `
    <div style="display:grid; grid-template-columns:1.1fr 1fr; gap:18px; align-items:start;">
      <div class="panel" data-section="taux">
        <div class="panel-head"><div class="serif-title">Barème des droits d’alcool</div></div>
        ${RATE_FIELDS.map((p) => `
        <div class="row spread" style="padding:14px 20px; border-bottom:1px solid var(--line2); gap:18px;">
          <div class="cell-main">
            <div style="font-size:13.5px;">${esc(p.k)}</div>
            <div class="sub pretty">${esc(p.n)}</div>
          </div>
          <div class="row" style="gap:9px; flex:0 0 auto;">
            <input class="input num" data-rate="${p.key}" value="${num(rv(p.key), p.d)}"
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
            <div class="num r" style="font-size:12px; color:var(--mut2);">${p.cout_dose > 0 ? pc(t / p.cout_dose * 100) : '—'}</div>
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

  zone.querySelectorAll('[data-rate]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('input', () => {
      const v = parseNum(inp.value);
      if (v <= 0) return;
      setScalaire(draft.rates, inp.dataset.rate, v, S.meta.rates[inp.dataset.rate]);
    });
  });

  zone.querySelector('[data-nouveau-taux]').addEventListener('click', () => nouveauTaux());
  zone.querySelectorAll('[data-del-taux]').forEach((b) =>
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
      await render(host);
    })
  );
}

function nouveauTaux() {
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
    await render(host);
  });
}

// ---------- 4. référentiels ----------

async function paneReferentiels(zone) {
  zone.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:18px;">
      <div class="panel" style="display:flex; flex-direction:column;" data-section="lieux">
        <div class="panel-head" style="padding:14px 18px;">
          <div class="serif-title" style="font-size:16px;">Lieux de stockage</div>
          <button class="btn" data-lieu-add style="padding:4px 10px; font-size:10px;">+ Ajouter</button>
        </div>
        ${S.meta.locations.map((l) => `
        <div class="row" style="padding:9px 18px; border-bottom:1px solid var(--line2);">
          <input class="input grow" data-lieu-nom="${l.id}" value="${esc(l.nom)}">
          <button class="icon-btn danger" data-lieu-del="${l.id}" aria-label="Supprimer">×</button>
        </div>`).join('')}
        <div class="panel-foot"><span class="pretty">Chaque lieu apparaît dans le sélecteur en haut
          de l’écran ; le stock et l’inventaire se tiennent par lieu.</span></div>
      </div>

      ${LISTS.map((l) => `
      <div class="panel" style="display:flex; flex-direction:column;" data-section="liste-${l.key}">
        <div class="panel-head" style="padding:14px 18px;">
          <div class="serif-title" style="font-size:16px;">${esc(l.title)}</div>
          <button class="btn" data-list-add="${l.key}" style="padding:4px 10px; font-size:10px;">+ Ajouter</button>
        </div>
        ${lv(l.key).map((v, i) => `
        <div class="row" style="padding:9px 18px; border-bottom:1px solid var(--line2);">
          <input class="input grow" data-list-item="${l.key}:${i}" value="${esc(v)}">
          <button class="icon-btn danger" data-list-del="${l.key}:${i}" aria-label="Supprimer">×</button>
        </div>`).join('')}
        <div class="panel-foot"><span class="pretty">${esc(l.note)}</span></div>
      </div>`).join('')}
    </div>`;

  // Les lieux sont une ressource à part (leur propre table, leurs propres routes) et
  // non un réglage : ils restent immédiats, comme avant.
  zone.querySelectorAll('[data-lieu-nom]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', async () => {
      const id = Number(inp.dataset.lieuNom);
      const l = S.meta.locations.find((x) => x.id === id);
      const v = inp.value.trim();
      if (!v || v === l.nom) return;
      try {
        await apiSend('PATCH', `/api/locations/${id}`, { nom: v });
      } catch (e) { await alertModal({ title: 'Modification refusée', body: e.message }); }
      await reloadMeta();
      await refresh();
    });
  });
  zone.querySelector('[data-lieu-add]').addEventListener('click', async () => {
    // même geste que les autres listes : la ligne « Nouveau lieu » se renomme sur place
    let nom = 'Nouveau lieu';
    let n = 2;
    while (S.meta.locations.some((l) => l.nom === nom)) nom = `Nouveau lieu ${n++}`;
    try {
      await apiSend('POST', '/api/locations', { nom });
    } catch (e) { await alertModal({ title: 'Modification refusée', body: e.message }); }
    await reloadMeta();
    await refresh();
  });
  zone.querySelectorAll('[data-lieu-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const l = S.meta.locations.find((x) => x.id === Number(b.dataset.lieuDel));
      const ok = await confirmModal({
        title: `Supprimer le lieu ${l.nom} ?`,
        body: 'Son historique de mouvements est conservé ; son stock ne compte plus dans les totaux.',
      });
      if (!ok) return;
      try {
        await apiSend('DELETE', `/api/locations/${l.id}`);
        if (S.lieu === l.id) S.lieu = 'tous';
      } catch (e) { await alertModal({ title: 'Modification refusée', body: e.message }); }
      await reloadMeta();
      await refresh();
    })
  );

  // les listes simples, elles, sont des réglages : elles passent par le brouillon
  const poserListe = (key, items) => {
    const même = JSON.stringify(items) === JSON.stringify(S.meta.lists[key]);
    if (même) delete draft.lists[key];
    else draft.lists[key] = items;
    peindreBarre();
  };
  zone.querySelectorAll('[data-list-item]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('input', () => {
      const [key, i] = inp.dataset.listItem.split(':');
      const v = inp.value.trim();
      if (!v) return;
      const items = [...lv(key)];
      items[Number(i)] = v;
      poserListe(key, items);
    });
  });
  zone.querySelectorAll('[data-list-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const [key, i] = b.dataset.listDel.split(':');
      poserListe(key, lv(key).filter((_, k) => k !== Number(i)));
      render(host);
    })
  );
  zone.querySelectorAll('[data-list-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.listAdd;
      poserListe(key, [...lv(key), 'Nouveau']);
      render(host);
    })
  );
}

// ---------- 5. sauvegardes & export ----------

async function paneSauvegardes(zone) {
  const backups = (await apiGet('/api/backups')).backups;
  zone.innerHTML = `
    <div class="panel" data-section="sauvegardes">
      <div class="panel-head">
        <div class="serif-title">Sauvegardes</div>
        <div class="row" style="gap:9px;">
          <a class="btn muted" href="/api/export" download>Exporter en CSV</a>
          <button class="btn" data-backup-now>Sauvegarder maintenant</button>
        </div>
      </div>
      ${backups.length === 0
        ? `<div class="empty-note">Aucun instantané pour l’instant — la première sauvegarde
            automatique part cette nuit, ou cliquez « Sauvegarder maintenant ».</div>`
        : `<div class="thead" style="grid-template-columns:1fr .6fr .5fr 130px;">
            <div>Instantané</div><div class="r">Date</div><div class="r">Taille</div><div></div>
          </div>
          ${backups.slice(0, 12).map((b) => `
          <div class="trow" style="grid-template-columns:1fr .6fr .5fr 130px; padding:10px 20px;">
            <div class="num" style="font-size:12.5px;">${esc(b.name)}</div>
            <div class="num r" style="font-size:12px; color:var(--mut);">${esc(b.date.replace('T', ' · ').slice(0, 18))}</div>
            <div class="num r" style="font-size:12px; color:var(--mut2);">${num(b.size / 1024, 0)} Ko</div>
            <button class="btn muted" data-restore="${esc(b.name)}" style="justify-self:end; padding:5px 11px; font-size:10px;">Restaurer</button>
          </div>`).join('')}`}
      <div class="panel-foot"><span class="pretty">Sauvegarde automatique chaque nuit dans
        ~/AntiquaireStock/backups — chaque instantané est une base complète, restaurable et
        emportable. Une restauration met d’abord l’état courant de côté.</span></div>
    </div>`;

  // Sauvegarder, exporter, restaurer sont des actions : immédiates, hors brouillon.
  zone.querySelector('[data-backup-now]').addEventListener('click', async () => {
    try {
      await apiSend('POST', '/api/backups', {});
    } catch (e) { await alertModal({ title: 'Sauvegarde impossible', body: e.message }); }
    await render(host);
  });
  zone.querySelectorAll('[data-restore]').forEach((b) =>
    b.addEventListener('click', async () => {
      const name = b.dataset.restore;
      const ok = await confirmModal({
        title: 'Restaurer cet instantané ?',
        body: `La base reviendra à l'état de « ${name} ». L'état actuel est d'abord mis de côté (avant-restauration-…), donc l'opération est annulable.`,
        label: 'Restaurer',
      });
      if (!ok) return;
      try {
        await apiSend('POST', `/api/backups/${encodeURIComponent(name)}/restore`, {});
      } catch (e) { await alertModal({ title: 'Restauration impossible', body: e.message }); return; }
      clearDraft();   // la base a changé sous les pieds du brouillon
      await reloadMeta();
      await refresh();
    })
  );
}
