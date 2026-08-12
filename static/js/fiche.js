// Fiche unifiée d'une référence, en une seule modale : identité, part fiscale, prix.
//
// Tout s'écrit au fil de l'eau — sortie de champ → PATCH → relecture → repeinture. Aucun
// calcul de prix ici : le serveur donne coût de la dose, prix et marge. Seule exception,
// l'aperçu pendant le glissement du curseur de marge (compute), qui n'est jamais enregistré
// tel quel : le relâchement enregistre la marge et la fiche est relue.

import { apiGet, apiSend } from './api.js';
import { esc, eur, num, pc, parseNum, openModal, closeModal, confirmModal, alertModal } from './ui.js';
import { S, lieuQuery, lieuLabel } from './app.js';

const REGIMES = [
  { value: '', label: 'Hérité de la catégorie' },
  { value: 'spiritueux', label: 'Spiritueux' },
  { value: 'vin', label: 'Vin tranquille' },
  { value: 'mousseux', label: 'Vin mousseux' },
  { value: 'intermediaire', label: 'Produit intermédiaire' },
  { value: 'biere', label: 'Bière' },
];

const CHAMPS_SUIVIE = [
  { key: 'marque', k: 'Marque · origine', ph: 'Del Maguey · Oaxaca' },
  { key: 'vol_cl', k: 'Volume (cl)', ph: '70', num: true },
  { key: 'dose_cl', k: 'Dose (cl)', ph: 'vide = dose de la catégorie', num: true },
  { key: 'abv', k: 'Degré (% vol.)', ph: '45', num: true },
  { key: 'achat_ht', k: 'Prix d’achat HT (€)', ph: '31,00', num: true },
  { key: 'seuil', k: 'Seuil d’alerte', ph: '2', num: true },
  { key: 'par_target', k: 'Stock cible (commande)', ph: '6', num: true },
];

const CHAMPS_GARNITURE = [
  { key: 'marque', k: 'Précision', ph: 'Aromate · brûlé au service' },
  { key: 'achat_ht', k: 'Coût par unité (€)', ph: '0,30', num: true },
];

function options(list, selected) {
  return list.map(
    (o) => `<option value="${esc(o.value)}" ${String(o.value) === String(selected) ? 'selected' : ''}>${esc(o.label)}</option>`
  ).join('');
}

function champHtml(f, valeur) {
  return `<div class="field">
    <div class="mono-label">${esc(f.k)}</div>
    <input class="input ${f.num ? 'num' : ''}" data-f="${f.key}" ${f.num ? 'data-num' : ''}
      data-init="${esc(valeur)}" value="${esc(valeur)}" placeholder="${esc(f.ph)}">
  </div>`;
}

export async function openFiche(refId, { onClose } = {}) {
  let p;
  try {
    p = await apiGet(`/api/refs/${refId}?lieu=${lieuQuery()}`);
  } catch {
    await alertModal({ title: 'Référence introuvable', body: 'Elle a peut-être été supprimée.' });
    onClose?.();
    return;
  }

  // instantané d'ouverture : ce que « Rétablir » repose, champ à champ
  const avant = {
    nom: p.nom, marque: p.marque, fournisseur: p.fournisseur, categorie_id: p.categorie_id,
    abv: p.abv, vol_cl: p.vol_cl, achat_ht: p.achat_ht, seuil: p.seuil, par_target: p.par_target,
    unite: p.unite, alcoolise: p.alcoolise, dom: p.dom, droits_inclus: p.droits_inclus,
    dose_cl: p.dose_custom ? p.dose_cl : null,
    regime: p.regime_custom ? p.regime : null,
    marge_pct: p.marge_custom ? p.marge : null,
    prix_ttc: p.prix_ttc_override,
  };

  let marge = p.marge;          // marge affichée pendant le glissement du curseur
  let modal = null;
  let zone = null;
  let ferme = false;
  let dialogue = false;         // une confirmation occupe la pile : ce n'est pas une fermeture

  // Une confirmation écrase la modale ouverte ; l'observateur ne doit pas prendre cela
  // pour une fermeture, d'où le drapeau ci-dessus.
  const obs = new MutationObserver(() => {
    if (dialogue || ferme || document.querySelector('.modal')) return;
    ferme = true;
    obs.disconnect();
    onClose?.();
  });
  obs.observe(document.getElementById('modal-root'), { childList: true });

  function termine() {
    if (ferme) return;
    ferme = true;
    obs.disconnect();
    closeModal();
    onClose?.();
  }

  // ---------- calcul d'aperçu (curseur seulement) ----------

  const compute = (m) => {
    const ht = p.cout_dose / (1 - m / 100);
    const brut = ht * (1 + p.tva_pct / 100);
    const step = p.pricing.arrondi || 0.5;
    return { ht, brut, ttc: Math.round((Math.round(brut / step) * step) * 100) / 100 };
  };

  // ---------- rendu ----------

  function valeurChamp(key, f) {
    if (key === 'dose_cl' && !p.dose_custom) return '';
    const v = p[key];
    if (v === null || v === undefined) return '';
    return f.num && typeof v === 'number' ? num(v, v % 1 ? 2 : 0) : String(v);
  }

  function kpisHtml() {
    const sousPlancher = p.marge_reelle < p.pricing.min;
    const kpis = [
      { l: `Stock (${lieuLabel()})`, v: `${num(p.stock, p.stock % 1 ? 2 : 0)} · seuil ${num(p.seuil, 0)}`, t: p.low ? 'warn' : '' },
      { l: 'Coût unitaire', v: eur(p.cout_dose, 3), t: '' },
      { l: 'Prix conseillé', v: eur(p.prix), t: sousPlancher ? 'warn' : 'ok' },
    ];
    return `<div class="bloc-kpis fiche-kpis">
      ${kpis.map((k) => `<div class="bloc-kpi">
        <div class="mono-label">${esc(k.l)}</div>
        <div class="kpi-val ${k.t}">${esc(k.v)}</div>
      </div>`).join('')}
    </div>`;
  }

  function champsHtml() {
    const liste = p.suivi ? CHAMPS_SUIVIE : CHAMPS_GARNITURE;
    const cats = S.meta.categories
      .filter((c) => !['Consommable', 'Garniture & épices'].includes(c.nom))
      .map((c) => ({ value: c.id, label: c.nom }));
    return `
      ${liste.map((f) => champHtml(f, valeurChamp(f.key, f))).join('')}
      ${p.suivi
        ? `<div class="field"><div class="mono-label">Catégorie</div>
             <select class="input" data-cat>${options(cats, p.categorie_id)}</select></div>`
        : `<div class="field"><div class="mono-label">Unité</div>
             <select class="input" data-unite>${options(S.meta.lists.unites.map((u) => ({ value: u, label: u })), p.unite)}</select></div>`}
      <div class="field"><div class="mono-label">Fournisseur</div>
        <select class="input" data-four>${options(S.meta.lists.fournisseurs.map((x) => ({ value: x, label: x })), p.fournisseur)}</select></div>`;
  }

  function fiscalHtml() {
    const taxesDose = p.fiscal.accise + p.fiscal.ss;
    const lignes = [
      { k: 'Alcool pur dans la dose', n: `${num(p.dose_cl, 0)} cl à ${num(p.abv, 1)} % vol.`, v: `${num(p.fiscal.cl_alcool_pur, 2)} cl AP` },
      { k: 'Droit d’accise', n: p.fiscal.regime === 'aucun' ? 'non soumis' : `régime ${p.fiscal.regime}`, v: eur(p.fiscal.accise, 3) },
      { k: 'Cotisation sécurité sociale', n: p.fiscal.ss ? `${num(S.meta.rates.ss, 0)} €/hL AP` : '—', v: eur(p.fiscal.ss, 3) },
      { k: 'Total taxes par dose', n: p.droits_inclus ? 'compris dans le prix d’achat' : 'ajouté au coût matière', v: eur(taxesDose, 3) },
      { k: 'Poids sur le coût matière', n: 'taxes ÷ coût de la dose', v: p.cout_dose > 0 ? pc(taxesDose / p.cout_dose * 100) : '—' },
    ];
    return `
    <div class="panel-head"><div class="serif-title">Part fiscale de la dose</div></div>
    ${lignes.map((f) => `
      <div class="row spread" style="padding:12px 20px; border-bottom:1px solid var(--line2); gap:14px;">
        <div class="cell-main"><div style="font-size:13px;">${esc(f.k)}</div><div class="sub">${esc(f.n)}</div></div>
        <div class="num" style="font-size:12.5px; color:var(--ac3); white-space:nowrap;">${f.v}</div>
      </div>`).join('')}
    <div class="field" style="padding:16px 20px; gap:10px;">
      <label class="cc-switch"><input type="checkbox" data-alcoolise ${p.alcoolise ? 'checked' : ''}>
        <span class="piste"></span><span class="txt">Cette référence contient de l’alcool</span></label>
      ${p.alcoolise ? `
      <div class="field"><div class="mono-label">Régime fiscal</div>
        <select class="input" data-regime>${REGIMES.map((r) => `<option value="${r.value}" ${r.value === (p.regime_custom ? p.regime : '') ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
      ${p.regime === 'spiritueux' ? `
      <label class="cc-switch"><input type="checkbox" data-dom ${p.dom ? 'checked' : ''}>
        <span class="piste"></span><span class="txt">Rhum des DOM : taux d’accise réduit</span></label>` : ''}
      <label class="cc-switch"><input type="checkbox" data-droits ${p.droits_inclus ? 'checked' : ''}>
        <span class="piste"></span><span class="txt">Droits déjà inclus dans le prix d’achat facturé</span></label>` : `
      <div class="sub pretty">Aucun droit d’accise ni cotisation : la référence est chiffrée
        au seul prix d’achat.</div>`}
    </div>`;
  }

  function priceBoxHtml() {
    const override = p.prix_ttc_override !== null;
    const c = compute(marge);
    const ttc = override ? p.prix_ttc_override : c.ttc;
    const ht = ttc / (1 + p.tva_pct / 100);
    const reelle = ht > 0 ? (ht - p.cout_dose) / ht * 100 : 0;
    const ok = reelle >= p.pricing.min;
    return `
    <div class="${ok ? 'card-ok' : 'card-warn'}" style="padding:20px; border-width:0 0 1px 0; border-bottom:1px solid var(--line); display:flex; align-items:flex-end; justify-content:space-between; gap:18px;">
      <div style="display:flex; flex-direction:column; gap:6px; min-width:0;">
        <div class="mono-label">${ok
          ? (override ? 'Prix fixé à la main' : 'Prix conseillé TTC arrondi')
          : `Sous le plancher de ${pc(p.pricing.min)}`}</div>
        <div style="font-size:12.5px; color:${ok ? 'var(--ok-mut)' : 'var(--warn-mut)'};">
          Marge réelle ${pc(reelle)} · coût matière ${pc(100 - reelle)}</div>
        ${override
          ? `<button class="btn muted" data-clear-override style="align-self:flex-start; margin-top:4px;">Revenir au prix calculé</button>`
          : ''}
      </div>
      <div class="row" style="gap:10px; align-items:baseline; flex:0 0 auto;">
        <input class="input num" data-price value="${num(ttc, 2)}"
          style="width:110px; font-size:20px; padding:8px 10px;" aria-label="Prix TTC">
        <span class="mono-label" style="font-size:11px;">€ TTC</span>
      </div>
    </div>`;
  }

  function waterfallHtml() {
    const c = compute(marge);
    const lines = [
      { k: 'Coût de la dose', n: `achat HT ÷ ${num(p.doses_par_bouteille, 1)} doses${p.droits_inclus ? '' : ' + taxes'}`, v: eur(p.cout_dose, 3) },
      { k: 'Prix de vente HT', n: `coût ÷ (1 − marge de ${num(marge, 0)} %)`, v: eur(c.ht) },
      { k: 'TVA sur place', n: `${num(p.tva_pct, 0)} % · ${esc(p.categorie_nom)}`, v: eur(c.ht * p.tva_pct / 100) },
      { k: 'Prix TTC calculé', n: `avant arrondi à ${num(p.pricing.arrondi, 2)} €`, v: eur(c.brut) },
    ];
    return lines.map((w) => `
      <div class="row spread" style="padding:13px 20px; border-bottom:1px solid var(--line2); gap:16px;">
        <div class="cell-main"><div style="font-size:13.5px;">${w.k}</div><div class="sub">${w.n}</div></div>
        <div class="num" style="font-size:13px; color:var(--mut); white-space:nowrap;">${w.v}</div>
      </div>`).join('');
  }

  function prixHtml() {
    const pr = p.pricing;
    const scenarios = [
      { k: `plancher ${num(pr.min, 0)} %`, m: pr.min },
      { k: `cible ${num(pr.cible, 0)} %`, m: pr.cible },
      { k: `premium ${num(Math.min(pr.cible + 5, 92), 0)} %`, m: Math.min(pr.cible + 5, 92) },
    ];
    return `
    <div class="panel-head"><div class="serif-title">Prix conseillé · dose de ${num(p.dose_cl, 0)} cl</div></div>
    <div style="padding:20px; display:flex; flex-direction:column; gap:13px; border-bottom:1px solid var(--line);">
      <div class="row spread" style="align-items:baseline;">
        <div class="mono-label" style="color:var(--mut2);">Marge brute visée</div>
        <div class="num" style="font-size:15px; color:var(--ac);" data-marge-label>${pc(marge)}</div>
      </div>
      <input type="range" min="60" max="92" step="1" value="${Math.round(marge)}" data-slider style="width:100%;">
      <div class="row spread num" style="font-size:10.5px; color:var(--mut3);">
        <span>plancher maison ${pc(pr.min)}</span>
        <span data-coeff>coefficient équivalent × ${num(1 / (1 - marge / 100), 2)}</span>
      </div>
    </div>
    <div data-waterfall>${waterfallHtml()}</div>
    <div data-pricebox>${priceBoxHtml()}</div>
    <div style="padding:16px 20px;">
      <div class="mono-label" style="margin-bottom:11px;">Scénarios de marge</div>
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px;">
        ${scenarios.map((s) => `
        <button data-scenario="${s.m}" class="scenario-btn">
          <div class="num" style="font-size:10.5px; color:var(--mut2);">${s.k}</div>
          <div style="font-family:var(--serif); font-size:22px; color:var(--ac2);">${eur(compute(s.m).ttc)}</div>
          <div class="sub">coefficient × ${num(1 / (1 - s.m / 100), 2)}</div>
        </button>`).join('')}
      </div>
    </div>`;
  }

  function ficheHtml() {
    return `
    <div class="fiche-head">
      <div class="fiche-titre">
        <input class="input fiche-nom" data-f="nom" data-init="${esc(p.nom)}" value="${esc(p.nom)}"
          aria-label="Nom de la référence">
        ${p.suivi ? '' : '<div class="mono-label">Référence non suivie en stock</div>'}
      </div>
      ${p.suivi ? kpisHtml() : ''}
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="fiche-corps">
      <div class="modal-body grid2">${champsHtml()}</div>
      ${p.suivi ? `
      <div class="fiche-deux">
        <div class="panel">${fiscalHtml()}</div>
        <div class="panel" data-right style="display:flex; flex-direction:column;">${prixHtml()}</div>
      </div>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn muted" data-restore>Rétablir l’état d’ouverture</button>
      <div class="row" style="gap:9px;">
        <button class="btn muted danger" data-remove>Supprimer</button>
        <button class="btn-solid" data-close>Fermer</button>
      </div>
    </div>`;
  }

  // ---------- écriture ----------

  async function recharge() {
    p = await apiGet(`/api/refs/${refId}?lieu=${lieuQuery()}`);
    marge = p.marge;
    paint();
  }

  async function patch(body) {
    try {
      await apiSend('PATCH', `/api/refs/${refId}`, body);
    } catch (e) {
      dialogue = true;
      await alertModal({ title: 'Enregistrement impossible', body: e.message });
      ouvre();
      dialogue = false;
    }
    await recharge();
  }

  function paint() {
    zone.innerHTML = ficheHtml();
    bind();
  }

  function ouvre() {
    modal = openModal('<div data-fiche></div>', { width: 980 });
    modal.classList.add('fiche');
    zone = modal.querySelector('[data-fiche]');
    paint();
  }

  async function retablir() {
    dialogue = true;
    const ok = await confirmModal({
      title: 'Revenir à l’état d’ouverture ?',
      body: 'Toutes les modifications faites depuis l’ouverture de cette fiche seront annulées.',
      label: 'Rétablir',
    });
    ouvre();                       // la confirmation a remplacé la fiche : on la rouvre
    dialogue = false;
    if (ok) await patch(avant);
  }

  async function supprimer() {
    dialogue = true;
    const ok = await confirmModal({
      title: `Supprimer ${p.nom} ?`,
      body: 'La référence disparaît de la cave et des listes. Les recettes qui l’utilisent devront être corrigées.',
    });
    if (!ok) { ouvre(); dialogue = false; return; }
    await apiSend('DELETE', `/api/refs/${refId}`);
    dialogue = false;
    termine();
  }

  // ---------- liaisons ----------

  function bindPriceBox() {
    const input = zone.querySelector('[data-price]');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('blur', async () => {
      const v = parseNum(input.value);
      const computed = compute(marge).ttc;
      if (v <= 0 || Math.abs(v - computed) < 0.005) return;
      await patch({ prix_ttc: v });
    });
    const clear = zone.querySelector('[data-clear-override]');
    if (clear) clear.addEventListener('click', () => patch({ prix_ttc: null }));
  }

  // pendant le glissement, seule la zone dérivée bouge : rien n'est encore enregistré
  function refreshDerived() {
    zone.querySelector('[data-marge-label]').textContent = pc(marge);
    zone.querySelector('[data-coeff]').textContent =
      `coefficient équivalent × ${num(1 / (1 - marge / 100), 2)}`;
    zone.querySelector('[data-waterfall]').innerHTML = waterfallHtml();
    zone.querySelector('[data-pricebox]').innerHTML = priceBoxHtml();
    bindPriceBox();
  }

  function bind() {
    zone.querySelectorAll('[data-f]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('blur', () => {
        const brut = inp.value.trim();
        if (brut === inp.dataset.init) return;
        const key = inp.dataset.f;
        if (key === 'nom' && !brut) { inp.value = inp.dataset.init; return; }
        const vide = key === 'dose_cl' ? null : 0;   // une dose vide = celle de la catégorie
        const v = 'num' in inp.dataset ? (brut === '' ? vide : parseNum(brut)) : brut;
        patch({ [key]: v });
      });
    });

    const cat = zone.querySelector('[data-cat]');
    if (cat) cat.addEventListener('change', () => patch({ categorie_id: Number(cat.value) }));
    const unite = zone.querySelector('[data-unite]');
    if (unite) unite.addEventListener('change', () => patch({ unite: unite.value }));
    zone.querySelector('[data-four]').addEventListener('change', (e) => patch({ fournisseur: e.target.value }));

    const al = zone.querySelector('[data-alcoolise]');
    if (al) al.addEventListener('change', () => patch({ alcoolise: al.checked }));
    const rg = zone.querySelector('[data-regime]');
    if (rg) rg.addEventListener('change', () => patch({ regime: rg.value || null }));
    const dm = zone.querySelector('[data-dom]');
    if (dm) dm.addEventListener('change', () => patch({ dom: dm.checked }));
    const dr = zone.querySelector('[data-droits]');
    if (dr) dr.addEventListener('change', () => patch({ droits_inclus: dr.checked }));

    const slider = zone.querySelector('[data-slider]');
    if (slider) {
      slider.addEventListener('input', () => { marge = Number(slider.value); refreshDerived(); });
      slider.addEventListener('change', () => patch({ marge_pct: Number(slider.value), prix_ttc: null }));
      zone.querySelectorAll('[data-scenario]').forEach((b) =>
        b.addEventListener('click', () => patch({ marge_pct: Number(b.dataset.scenario), prix_ttc: null }))
      );
      bindPriceBox();
    }

    zone.querySelector('.modal-x').addEventListener('click', termine);
    zone.querySelector('[data-close]').addEventListener('click', termine);
    zone.querySelector('[data-restore]').addEventListener('click', retablir);
    zone.querySelector('[data-remove]').addEventListener('click', supprimer);
  }

  ouvre();
}
