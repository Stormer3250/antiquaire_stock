// Recettes : liste, éditeur, coût matière, marge, faisabilité.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, pc, confirmModal, alertModal } from '../ui.js';
import { S, refresh, lieuQuery, lieuLabel } from '../app.js';
import { openRefModal } from '../refmodal.js';
import { applySort, bindSort } from '../sortable.js';
import { tableState } from '../table.js';

let sel = null;                    // recette ouverte dans l'éditeur
const T = 'recettes';              // tri et recettes cochées, tenus par table.js

// Ce que l'on veut savoir d'un paquet de recettes : ce qu'il rapporte et à quel point
// ses prix sont dispersés. C'est la même mesure que la phase des menus reprendra.
function cartesSummary(picked) {
  const moy = (f) => picked.reduce((a, x) => a + f(x), 0) / picked.length;
  const prix = picked.map((x) => x.prix_ttc);
  const bas = Math.min(...prix);
  const haut = Math.max(...prix);
  return `
  <div class="table-summary" style="flex-direction:column; align-items:stretch; gap:9px;">
    <div class="sum-figs" style="flex-direction:column; gap:7px;">
      <span class="sum-count">${picked.length} recette${picked.length > 1 ? 's' : ''} retenue${picked.length > 1 ? 's' : ''}</span>
      <span>Marge moyenne <b class="num">${pc(moy((x) => x.marge))}</b></span>
      <span>Prix moyen <b class="num">${eur(moy((x) => x.prix_ttc))}</b></span>
      <span>Coût matière moyen <b class="num">${eur(moy((x) => x.cost))}</b></span>
      <span>De <b class="num">${eur(bas)}</b> à <b class="num">${eur(haut)}</b>, écart <b class="num">${eur(haut - bas)}</b></span>
    </div>
    <button class="btn muted" data-unpick>Tout décocher</button>
  </div>`;
}

export async function render(el) {
  const [cocktailsData, stockData] = await Promise.all([
    apiGet(`/api/cocktails?lieu=${lieuQuery()}`),
    apiGet(`/api/stock`),
  ]);
  const state = tableState(T, 'nom');
  const SORT = state.sort;
  const cocktails = applySort(cocktailsData.cocktails, SORT);
  const picked = cocktails.filter((x) => state.selected.has(x.id));
  const refs = stockData.refs;
  const pr = S.meta.pricing;
  const c = cocktails.find((x) => x.id === sel) || cocktails[0] || null;
  sel = c ? c.id : null;

  const patch = async (body) => {
    await apiSend('PATCH', `/api/cocktails/${c.id}`, body);
    await render(el);
  };
  const patchIngs = (ings) => patch({ ings: ings.map((i) => ({ ref_id: i.ref_id, qty: i.qty })) });

  // ---------- colonne liste ----------

  const listHtml = `
  <div class="panel">
    <div style="padding:14px 18px; border-bottom:1px solid var(--line); display:flex;
      flex-direction:column; gap:9px;">
      <div class="mono-label">Recettes · ${cocktails.length}</div>
      <div class="row" style="gap:6px; flex-wrap:wrap;">
        ${[['nom', 'Nom'], ['prix_ttc', 'Prix'], ['marge', 'Marge'], ['created_at', 'Créée le']]
          .map(([k, label]) => `<button class="chip-sort ${SORT.key === k ? 'active' : ''}"
            data-sort="${k}">${label}${SORT.key === k ? (SORT.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button>`)
          .join('')}
      </div>
    </div>
    ${cocktails.map((x) => `
    <div class="row" style="border-left:2px solid ${c && x.id === c.id ? 'var(--ac)' : 'transparent'};
      border-bottom:1px solid var(--line2); background:${c && x.id === c.id ? 'var(--panel2)' : 'transparent'}; gap:0;">
      <label class="tick" style="padding-left:10px;"><input type="checkbox" data-tick="${x.id}"
        ${state.selected.has(x.id) ? 'checked' : ''} aria-label="Retenir cette recette"></label>
      <button data-pick="${x.id}" style="flex:1; min-width:0; text-align:left; padding:13px 8px 13px 16px;
        background:transparent; border:none; color:${c && x.id === c.id ? 'var(--ink)' : 'var(--mut)'};
        font-family:var(--sans); cursor:pointer;">
        <div style="font-size:13.5px;">${esc(x.nom)}</div>
        <div class="num" style="margin-top:3px; font-size:11px; color:${c && x.id === c.id ? 'var(--ac)' : 'var(--mut3)'};">
          ${eur(x.prix_ttc)} · marge ${pc(x.marge)}</div>
      </button>
      <button class="icon-btn danger" data-del="${x.id}" style="margin-right:10px; background:transparent;" aria-label="Supprimer">×</button>
    </div>`).join('')}
    <button data-new style="display:block; width:100%; padding:13px 18px; background:transparent; border:none;
      color:var(--ac); text-align:left; font-family:var(--mono); font-size:11px; letter-spacing:.1em;
      text-transform:uppercase; cursor:pointer;">+ Nouvelle recette</button>
    ${picked.length ? cartesSummary(picked) : ''}
  </div>`;

  // ---------- éditeur ----------

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

  const doseLabel = (i) => {
    const r = refs.find((x) => x.id === i.ref_id);
    if (!r) return num(i.qty, 1);
    return r.suivi ? `${num(i.qty, 1)} cl` : `${num(i.qty, 0)} ${r.unite}`;
  };

  const editorHtml = c === null
    ? `<div class="panel"><div class="empty-note">Aucune recette. Créez la première
        avec « + Nouvelle recette » à gauche.</div></div>`
    : `
  <div class="panel">
    <div style="padding:20px 22px 16px; border-bottom:1px solid var(--line); display:flex; flex-direction:column; gap:12px;">
      <div class="row">
        <input class="input grow" data-nom value="${esc(c.nom)}"
          style="font-family:var(--serif); font-size:26px; padding:8px 10px;">
      </div>
      <div class="row">
        <div class="field grow"><div class="mono-label">Famille</div>
          <select class="input" data-famille>
            ${S.meta.lists.familles.map((f) => `<option ${f === c.famille ? 'selected' : ''}>${esc(f)}</option>`).join('')}
          </select></div>
        <div class="field grow"><div class="mono-label">Verre</div>
          <select class="input" data-verre>
            ${S.meta.lists.verres.map((v) => `<option ${v === c.verre ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select></div>
      </div>
      <textarea class="input" data-desc rows="2" placeholder="Description pour la carte…">${esc(c.description)}</textarea>
    </div>
    <div class="thead" style="grid-template-columns:2fr 1.4fr .8fr .5fr; padding:11px 22px;">
      <div>Ingrédient</div><div class="c">Quantité</div><div class="r">Coût</div><div></div>
    </div>
    ${c.ings.map((i, idx) => `
    <div class="trow" style="grid-template-columns:2fr 1.4fr .8fr .5fr; padding:10px 22px;">
      <select class="input" data-ing-ref="${idx}">${ingOptions(i.ref_id)}</select>
      <div class="stepper">
        <button data-ing-minus="${idx}">–</button>
        <span class="val" style="min-width:76px;">${doseLabel(i)}</span>
        <button data-ing-plus="${idx}">+</button>
      </div>
      <div class="num r" style="font-size:12.5px;">${eur(i.cost)}</div>
      <button class="icon-btn danger" data-ing-del="${idx}" style="justify-self:end;" aria-label="Retirer">×</button>
    </div>`).join('')}
    <div class="row spread" style="padding:13px 22px; align-items:flex-start; gap:14px;">
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
    </div>
  </div>`;

  const rightHtml = c === null ? '' : `
  <div class="stack" style="gap:14px;">
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
    </div>
  </div>`;

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:266px 1fr; gap:18px; align-items:start;">
    ${listHtml}
    <div style="display:grid; grid-template-columns:1.35fr 1fr; gap:18px; align-items:start;">
      ${editorHtml}
      ${rightHtml}
    </div>
  </div>`;

  // ---------- liaisons ----------

  bindSort(el, SORT, () => render(el));
  el.querySelectorAll('[data-tick]').forEach((box) =>
    box.addEventListener('change', () => {
      const id = Number(box.dataset.tick);
      if (box.checked) state.selected.add(id);
      else state.selected.delete(id);
      render(el);
    })
  );
  el.querySelector('[data-unpick]')?.addEventListener('click', () => {
    state.selected.clear();
    render(el);
  });
  el.querySelectorAll('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => { sel = Number(b.dataset.pick); render(el); })
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const x = cocktails.find((y) => y.id === Number(b.dataset.del));
      const ok = await confirmModal({
        title: `Supprimer « ${x.nom} » ?`,
        body: 'La recette et son chiffrage seront perdus. Elle disparaît des cartes où elle figure.',
      });
      if (!ok) return;
      await apiSend('DELETE', `/api/cocktails/${x.id}`);
      if (sel === x.id) sel = null;
      await render(el);
    })
  );
  el.querySelector('[data-new]').addEventListener('click', async () => {
    const r = await apiSend('POST', '/api/cocktails', {});
    sel = r.id;
    await render(el);
  });

  if (!c) return;

  const onBlurPatch = (selctor, key) => {
    const n = el.querySelector(selctor);
    n.addEventListener('blur', () => {
      const v = n.value.trim();
      if (v !== c[key]) patch({ [key]: v });
    });
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter' && n.tagName === 'INPUT') n.blur(); });
  };
  onBlurPatch('[data-nom]', 'nom');
  onBlurPatch('[data-desc]', 'description');
  el.querySelector('[data-famille]').addEventListener('change', (e) => patch({ famille: e.target.value }));
  el.querySelector('[data-verre]').addEventListener('change', (e) => patch({ verre: e.target.value }));

  el.querySelectorAll('[data-ing-ref]').forEach((s) =>
    s.addEventListener('change', () => {
      const idx = Number(s.dataset.ingRef);
      if (s.value === '__new' || s.value === '__newuntracked') {
        openRefModal({
          suivi: s.value === '__new',
          onSaved: async (id) => {
            const ings = [...c.ings];
            ings[idx] = { ...ings[idx], ref_id: id };
            await patchIngs(ings);
          },
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
  el.querySelectorAll('[data-ing-minus]').forEach((b) =>
    b.addEventListener('click', () => {
      const idx = Number(b.dataset.ingMinus);
      const ings = [...c.ings];
      ings[idx] = { ...ings[idx], qty: Math.max(0, Math.round((ings[idx].qty - stepFor(ings[idx])) * 10) / 10) };
      patchIngs(ings);
    })
  );
  el.querySelectorAll('[data-ing-plus]').forEach((b) =>
    b.addEventListener('click', () => {
      const idx = Number(b.dataset.ingPlus);
      const ings = [...c.ings];
      ings[idx] = { ...ings[idx], qty: Math.round((ings[idx].qty + stepFor(ings[idx])) * 10) / 10 };
      patchIngs(ings);
    })
  );
  el.querySelectorAll('[data-ing-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const ings = c.ings.filter((_, k) => k !== Number(b.dataset.ingDel));
      patchIngs(ings);
    })
  );
  el.querySelector('[data-ing-add]').addEventListener('click', async () => {
    const first = refs.find((r) => r.suivi);
    if (!first) {
      await alertModal({
        title: 'Aucune référence suivie',
        body: 'Créez une référence suivie avant d’ajouter un ingrédient à une recette.',
      });
      return;
    }
    patchIngs([...c.ings, { ref_id: first.id, qty: 2 }]);
  });
  el.querySelector('[data-new-tracked]').addEventListener('click', () =>
    openRefModal({ suivi: true, onSaved: (id) => patchIngs([...c.ings, { ref_id: id, qty: 2 }]) })
  );
  el.querySelector('[data-new-untracked]').addEventListener('click', () =>
    openRefModal({ suivi: false, onSaved: (id) => patchIngs([...c.ings, { ref_id: id, qty: 1 }]) })
  );

  const margeInput = el.querySelector('[data-marge]');
  margeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') margeInput.blur(); });
  margeInput.addEventListener('blur', () => {
    const v = margeInput.value.trim();
    // vide = revenir à la cible de la maison
    const marge = v === '' ? null : Number(v.replace(',', '.'));
    if (marge !== null && Number.isNaN(marge)) { margeInput.value = ''; return; }
    if (marge === (c.marge_custom ? c.marge_cible : null)) return;
    patch({ marge_pct: marge });
  });
  el.querySelector('[data-fixe]').addEventListener('change', (e) =>
    patch({ prix_fixe: e.target.checked })
  );

  const priceSlider = el.querySelector('[data-price]');
  priceSlider.addEventListener('change', () => patch({ prix_ttc: Number(priceSlider.value) }));
  el.querySelector('[data-apply]').addEventListener('click', () => patch({ prix_ttc: c.suggested }));
}
