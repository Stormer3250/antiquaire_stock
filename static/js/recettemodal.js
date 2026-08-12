// Modale unifiée d'une recette : identité, composition, tarification, faisabilité.
//
// Même moule que fiche.js : ouverture → instantané « avant » → patch au fil de l'eau →
// relecture → repeinture. Il n'y a pas de GET /api/cocktails/:id : on relit la liste
// filtrée par lieu et on cherche dedans, comme le fait l'écran recettes aujourd'hui.

import { apiGet, apiSend } from './api.js';
import { esc, eur, num, pc, openModal, closeModal, confirmModal, alertModal } from './ui.js';
import { S, lieuQuery, lieuLabel } from './app.js';
import { openRefModal } from './refmodal.js';

export async function openRecette(cocktailId, { onClose } = {}) {
  let refs = [];

  // Pas d'endpoint dédié : on relit la liste (comme l'écran) et on y cherche la recette.
  async function chargeCocktail() {
    const [data, stockData] = await Promise.all([
      apiGet(`/api/cocktails?lieu=${lieuQuery()}`),
      apiGet('/api/stock'),
    ]);
    refs = stockData.refs;
    return data.cocktails.find((x) => x.id === cocktailId) || null;
  }

  let c;
  try {
    c = await chargeCocktail();
  } catch (e) {
    await alertModal({ title: 'Recette indisponible', body: e.message });
    onClose?.();
    return;
  }
  if (!c) {
    await alertModal({ title: 'Recette introuvable', body: 'Elle a peut-être été supprimée.' });
    onClose?.();
    return;
  }

  // instantané d'ouverture : ce que « Rétablir » repose, en un seul PATCH
  const avant = {
    nom: c.nom,
    famille: c.famille,
    verre: c.verre,
    description: c.description,
    prix_ttc: c.prix_ttc,
    prix_fixe: c.prix_fixe,
    marge_pct: c.marge_custom ? c.marge_cible : null,
    ings: c.ings.map((i) => ({ ref_id: i.ref_id, qty: i.qty })),
  };

  let modal = null;
  let zone = null;
  let ferme = false;
  let dialogue = false;   // une confirmation/alerte/sous-modale occupe la pile

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

  // ---------- rendu ----------

  function kpisHtml() {
    const tone = c.ok ? 'ok' : 'warn';
    const kpis = [
      { l: 'Coût matière', v: eur(c.cost) },
      { l: 'Prix TTC', v: eur(c.prix_ttc) },
      { l: 'Marge', v: pc(c.marge) },
    ];
    return `<div class="bloc-kpis fiche-kpis">
      ${kpis.map((k) => `<div class="bloc-kpi">
        <div class="mono-label">${esc(k.l)}</div>
        <div class="kpi-val ${tone}">${esc(k.v)}</div>
      </div>`).join('')}
    </div>`;
  }

  function ingOptions(current) {
    const tracked = refs.filter((r) => r.suivi);
    const untracked = refs.filter((r) => !r.suivi && r.categorie_nom !== 'Consommable');
    const conso = refs.filter((r) => r.categorie_nom === 'Consommable');
    const opt = (r, label) =>
      `<option value="${r.id}" ${r.id === current ? 'selected' : ''}>${esc(label)}</option>`;
    return [
      ...tracked.map((r) => opt(r, r.nom)),
      ...untracked.map((r) => opt(r, `${r.nom} · ${r.unite}`)),
      ...conso.map((r) => opt(r, r.nom)),
      `<option disabled>──────────</option>`,
      `<option value="__new">Créer une référence suivie…</option>`,
      `<option value="__newuntracked">Créer une garniture…</option>`,
    ].join('');
  }

  function doseLabel(i) {
    const r = refs.find((x) => x.id === i.ref_id);
    if (!r) return num(i.qty, 1);
    return r.suivi ? `${num(i.qty, 1)} cl` : `${num(i.qty, 0)} ${r.unite}`;
  }

  function compositionHtml() {
    return `
    <div class="thead" style="grid-template-columns:2fr 1.4fr .8fr .5fr; padding:11px 20px;">
      <div>Ingrédient</div><div class="c">Quantité</div><div class="r">Coût</div><div></div>
    </div>
    ${c.ings.map((i, idx) => `
    <div class="trow" style="grid-template-columns:2fr 1.4fr .8fr .5fr; padding:10px 20px;">
      <select class="input" data-ing-ref="${idx}">${ingOptions(i.ref_id)}</select>
      <div class="stepper">
        <button data-ing-minus="${idx}">–</button>
        <span class="val" style="min-width:76px;">${doseLabel(i)}</span>
        <button data-ing-plus="${idx}">+</button>
      </div>
      <div class="num r" style="font-size:12.5px;">${eur(i.cost)}</div>
      <button class="icon-btn danger" data-ing-del="${idx}" style="justify-self:end;" aria-label="Retirer">×</button>
    </div>`).join('')}
    <div class="row spread" style="padding:13px 20px; align-items:flex-start; gap:14px;">
      <div class="stack" style="gap:8px; flex:1; min-width:0;">
        <button class="btn-solid" data-ing-add>+ Ajouter un ingrédient</button>
        <div class="row wrap creer-ref" style="gap:8px;">
          <span class="mono-label">Pas encore en cave ?</span>
          <button class="btn muted" data-new-tracked>Créer une référence suivie</button>
          <button class="btn muted" data-new-untracked>Créer une garniture</button>
        </div>
      </div>
      <div class="row" style="gap:12px; align-items:baseline; flex:0 0 auto; white-space:nowrap;">
        <span style="font-size:12.5px; color:var(--mut2);">Coût matière</span>
        <span class="num accent" style="font-size:15px;">${eur(c.cost)}</span>
      </div>
    </div>`;
  }

  function pricingHtml() {
    const pr = S.meta.pricing;
    return `
    <div class="${c.ok ? 'card-ok' : 'card-warn'}" style="padding:22px; display:flex; flex-direction:column; gap:16px;">
      <div class="row spread" style="align-items:baseline;">
        <div class="mono-label">${c.ok ? 'Prix TTC' : `Sous le plancher ${pc(pr.min)}`}</div>
        <div style="font-family:var(--serif); font-size:38px; line-height:1;">${eur(c.prix_ttc)}</div>
      </div>
      <input type="range" min="8" max="30" step="0.5" value="${c.prix_ttc}" data-price style="width:100%;">
      ${[
        { k: 'Prix HT', v: eur(c.prix_ht) },
        { k: 'Coût matière', v: `${eur(c.cost)} · ${pc(c.prix_ht > 0 ? c.cost / c.prix_ht * 100 : 0)}` },
        { k: 'Marge brute', v: `${eur(c.prix_ht - c.cost)} · ${pc(c.marge)}` },
        { k: 'TVA collectée', v: eur(c.tva) },
      ].map((m) => `
      <div class="row spread" style="padding-top:11px; border-top:1px solid ${c.ok ? '#2C3D1B' : '#402825'};">
        <div style="font-size:13px; color:${c.ok ? '#B4CFA0' : 'var(--warn-mut)'};">${m.k}</div>
        <div class="num" style="font-size:13px;">${m.v}</div>
      </div>`).join('')}
    </div>
    <div class="panel" style="padding:18px 20px; display:flex; flex-direction:column; gap:8px;">
      <div class="mono-label" style="color:var(--mut2);">Sur quelles cartes</div>
      ${c.cartes && c.cartes.length
        ? `<div class="row wrap" style="gap:6px;">${c.cartes.map((x, i) => `
            <span class="chip-carte ${i === 0 ? 'premiere' : ''}"
              title="${i === 0 ? 'C’est cette carte qui donne le prix affiché ailleurs' : ''}">${esc(x.nom)}</span>`).join('')}</div>
           ${c.cartes.length > 1
             ? `<div class="sub pretty">Hors carte, c’est « ${esc(c.cartes[0].nom)} » qui donne le prix.</div>`
             : ''}`
        : `<div class="sub pretty">Sur aucune carte : cette recette applique son prix propre.</div>`}
    </div>
    <div class="panel" style="padding:20px; display:flex; flex-direction:column; gap:11px;">
      <div class="mono-label" style="color:var(--mut2);">Prix conseillé</div>
      <div style="font-size:13px; color:var(--mut);" class="pretty">Pour tenir la marge
        ${c.marge_custom ? 'propre à cette recette' : 'cible de la maison'} de
        ${pc(c.marge_cible)}, elle se vend <span class="accent">${eur(c.suggested)}</span>.</div>
      <div class="row" style="gap:10px; align-items:flex-end;">
        <div class="field grow"><div class="mono-label">Marge visée par cette recette</div>
          <input class="input num" data-marge value="${c.marge_custom ? num(c.marge_cible, 0) : ''}"
            placeholder="${num(pr.cible, 0)} · cible maison" aria-label="Marge visée"></div>
        <button class="btn" data-apply>Appliquer ce prix</button>
      </div>
      <label class="cc-switch" style="padding-top:4px;">
        <input type="checkbox" data-fixe ${c.prix_fixe ? 'checked' : ''}>
        <span class="piste"></span>
        <span class="txt">Prix figé : le réglage d’ensemble d’une carte ne le déplacera pas</span>
      </label>
    </div>
    <div class="panel" style="padding:20px; display:flex; flex-direction:column; gap:10px;">
      <div class="mono-label" style="color:var(--mut2);">Faisabilité au stock</div>
      <div style="font-family:var(--serif); font-size:26px;" class="accent">
        ${c.feasibility ? `${num(c.feasibility.services, 0)} services` : '—'}</div>
      <div style="font-size:13px; color:var(--mut);" class="pretty">
        ${c.feasibility
          ? `Facteur limitant : ${esc(c.feasibility.limitant)}, sur ${esc(lieuLabel())}.`
          : 'Ajoutez un ingrédient suivi pour estimer la faisabilité.'}</div>
    </div>`;
  }

  function ficheHtml() {
    return `
    <div class="fiche-head">
      <div class="fiche-titre">
        <input class="input fiche-nom" data-nom value="${esc(c.nom)}" aria-label="Nom de la recette">
      </div>
      ${kpisHtml()}
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="fiche-corps">
      <div class="modal-body grid2">
        <div class="field"><div class="mono-label">Famille</div>
          <select class="input" data-famille>
            ${S.meta.lists.familles.map((f) => `<option ${f === c.famille ? 'selected' : ''}>${esc(f)}</option>`).join('')}
          </select></div>
        <div class="field"><div class="mono-label">Verre</div>
          <select class="input" data-verre>
            ${S.meta.lists.verres.map((v) => `<option ${v === c.verre ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select></div>
        <div class="field" style="grid-column:1 / -1;"><div class="mono-label">Description</div>
          <textarea class="input" data-desc rows="2" placeholder="Description pour la carte…">${esc(c.description)}</textarea></div>
      </div>
      <div class="fiche-deux">
        <div class="panel">${compositionHtml()}</div>
        <div class="stack" style="gap:14px;">${pricingHtml()}</div>
      </div>
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
    let frais;
    try {
      frais = await chargeCocktail();
    } catch (e) {
      dialogue = true;
      await alertModal({ title: 'Recette indisponible', body: e.message });
      dialogue = false;
      termine();
      return;
    }
    if (!frais) {
      dialogue = true;
      await alertModal({ title: 'Recette introuvable', body: 'Elle a peut-être été supprimée.' });
      dialogue = false;
      termine();
      return;
    }
    c = frais;
    paint();
  }

  async function patch(body) {
    try {
      await apiSend('PATCH', `/api/cocktails/${cocktailId}`, body);
    } catch (e) {
      await echec('Enregistrement impossible', e);
    }
    await recharge();
  }

  const patchIngs = (ings) => patch({ ings: ings.map((i) => ({ ref_id: i.ref_id, qty: i.qty })) });

  // Un appel réseau qui échoue laisserait l'écran nu : l'alerte a remplacé la fiche
  // dans la pile. On prévient, puis on repose la fiche.
  async function echec(titre, e) {
    dialogue = true;
    await alertModal({ title: titre, body: e.message });
    ouvre();
    dialogue = false;
  }

  function paint() {
    zone.innerHTML = ficheHtml();
    bind();
  }

  function ouvre() {
    modal = openModal('<div data-fiche></div>', { width: 1120 });
    modal.classList.add('fiche');
    zone = modal.querySelector('[data-fiche]');
    paint();
  }

  async function retablir() {
    dialogue = true;
    const ok = await confirmModal({
      title: 'Revenir à l’état d’ouverture ?',
      body: 'Toutes les modifications faites depuis l’ouverture de cette recette seront annulées.',
      label: 'Rétablir',
    });
    ouvre();                       // la confirmation a remplacé la fiche : on la rouvre
    dialogue = false;
    if (ok) await patch(avant);
  }

  async function supprimer() {
    dialogue = true;
    const ok = await confirmModal({
      title: `Supprimer « ${c.nom} » ?`,
      body: 'La recette et son chiffrage seront perdus. Elle disparaît des cartes où elle figure.',
    });
    if (!ok) { ouvre(); dialogue = false; return; }
    try {
      await apiSend('DELETE', `/api/cocktails/${cocktailId}`);
    } catch (e) {
      await echec('Suppression impossible', e);
      return;
    }
    dialogue = false;
    termine();
  }

  // openRefModal remplace tout modal-root le temps qu'elle est ouverte : on suspend la
  // détection de fermeture, et on rouvre la fiche dès qu'elle rend la main (créée ou non).
  function creerRef(suivi, onId) {
    dialogue = true;
    openRefModal({
      suivi,
      onSaved: async (id) => {
        ouvre();
        dialogue = false;
        await onId(id);
      },
      onClose: () => {
        ouvre();
        dialogue = false;
      },
    });
  }

  // ---------- liaisons ----------

  function bind() {
    const nomInput = zone.querySelector('[data-nom]');
    nomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nomInput.blur(); });
    nomInput.addEventListener('blur', () => {
      const v = nomInput.value.trim();
      if (!v) { nomInput.value = c.nom; return; }
      if (v !== c.nom) patch({ nom: v });
    });

    const desc = zone.querySelector('[data-desc]');
    desc.addEventListener('blur', () => {
      if (desc.value !== c.description) patch({ description: desc.value });
    });

    zone.querySelector('[data-famille]').addEventListener('change', (e) => patch({ famille: e.target.value }));
    zone.querySelector('[data-verre]').addEventListener('change', (e) => patch({ verre: e.target.value }));

    zone.querySelectorAll('[data-ing-ref]').forEach((s) =>
      s.addEventListener('change', () => {
        const idx = Number(s.dataset.ingRef);
        if (s.value === '__new' || s.value === '__newuntracked') {
          creerRef(s.value === '__new', async (id) => {
            const ings = [...c.ings];
            ings[idx] = { ...ings[idx], ref_id: id };
            await patchIngs(ings);
          });
          return;
        }
        const ings = [...c.ings];
        ings[idx] = { ...ings[idx], ref_id: Number(s.value) };
        patchIngs(ings);
      })
    );
    const stepFor = (i) => {
      const r = refs.find((x) => x.id === i.ref_id);
      return r && r.suivi ? 0.5 : 1;
    };
    zone.querySelectorAll('[data-ing-minus]').forEach((b) =>
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.ingMinus);
        const ings = [...c.ings];
        ings[idx] = { ...ings[idx], qty: Math.max(0, Math.round((ings[idx].qty - stepFor(ings[idx])) * 10) / 10) };
        patchIngs(ings);
      })
    );
    zone.querySelectorAll('[data-ing-plus]').forEach((b) =>
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.ingPlus);
        const ings = [...c.ings];
        ings[idx] = { ...ings[idx], qty: Math.round((ings[idx].qty + stepFor(ings[idx])) * 10) / 10 };
        patchIngs(ings);
      })
    );
    zone.querySelectorAll('[data-ing-del]').forEach((b) =>
      b.addEventListener('click', () => {
        const ings = c.ings.filter((_, k) => k !== Number(b.dataset.ingDel));
        patchIngs(ings);
      })
    );
    zone.querySelector('[data-ing-add]').addEventListener('click', async () => {
      const first = refs.find((r) => r.suivi);
      if (!first) {
        dialogue = true;
        await alertModal({
          title: 'Aucune référence suivie',
          body: 'Créez une référence suivie avant d’ajouter un ingrédient à cette recette.',
        });
        ouvre();
        dialogue = false;
        return;
      }
      patchIngs([...c.ings, { ref_id: first.id, qty: 2 }]);
    });
    zone.querySelector('[data-new-tracked]').addEventListener('click', () =>
      creerRef(true, (id) => patchIngs([...c.ings, { ref_id: id, qty: 2 }]))
    );
    zone.querySelector('[data-new-untracked]').addEventListener('click', () =>
      creerRef(false, (id) => patchIngs([...c.ings, { ref_id: id, qty: 1 }]))
    );

    const margeInput = zone.querySelector('[data-marge]');
    margeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') margeInput.blur(); });
    margeInput.addEventListener('blur', () => {
      const v = margeInput.value.trim();
      // vide = revenir à la cible de la maison
      const marge = v === '' ? null : Number(v.replace(',', '.'));
      if (marge !== null && Number.isNaN(marge)) { margeInput.value = ''; return; }
      if (marge === (c.marge_custom ? c.marge_cible : null)) return;
      patch({ marge_pct: marge });
    });
    zone.querySelector('[data-fixe]').addEventListener('change', (e) => patch({ prix_fixe: e.target.checked }));

    const priceSlider = zone.querySelector('[data-price]');
    priceSlider.addEventListener('change', () => patch({ prix_ttc: Number(priceSlider.value) }));
    zone.querySelector('[data-apply]').addEventListener('click', () => patch({ prix_ttc: c.suggested }));

    zone.querySelector('.modal-x').addEventListener('click', termine);
    zone.querySelector('[data-close]').addEventListener('click', termine);
    zone.querySelector('[data-restore]').addEventListener('click', retablir);
    zone.querySelector('[data-remove]').addEventListener('click', supprimer);
  }

  ouvre();
}
