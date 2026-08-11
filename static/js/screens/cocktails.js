// Cartes & recettes : liste des fiches, éditeur, coût matière, marge, faisabilité.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, pc, confirmModal, alertModal } from '../ui.js';
import { S, refresh, lieuQuery, lieuLabel } from '../app.js';
import { openRefModal } from '../refmodal.js';

let sel = null;  // fiche sélectionnée (persiste pendant la session)

export async function render(el) {
  const [cocktailsData, stockData] = await Promise.all([
    apiGet(`/api/cocktails?lieu=${lieuQuery()}`),
    apiGet(`/api/stock`),
  ]);
  const cocktails = cocktailsData.cocktails;
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
    <div style="padding:14px 18px; border-bottom:1px solid var(--line);" class="mono-label">
      Carte · ${cocktails.length} fiche${cocktails.length > 1 ? 's' : ''}</div>
    ${cocktails.map((x) => `
    <div class="row" style="border-left:2px solid ${c && x.id === c.id ? 'var(--ac)' : 'transparent'};
      border-bottom:1px solid var(--line2); background:${c && x.id === c.id ? 'var(--panel2)' : 'transparent'}; gap:0;">
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
      text-transform:uppercase; cursor:pointer;">+ Nouvelle fiche</button>
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
      `<option value="__new">+ Créer une référence suivie…</option>`,
      `<option value="__newuntracked">+ Créer une garniture non suivie…</option>`,
    ].join('');
  }

  const doseLabel = (i) => {
    const r = refs.find((x) => x.id === i.ref_id);
    if (!r) return num(i.qty, 1);
    return r.suivi ? `${num(i.qty, 1)} cl` : `${num(i.qty, 0)} ${r.unite}`;
  };

  const editorHtml = c === null
    ? `<div class="panel"><div class="empty-note">Aucune fiche à la carte. Créez la première
        avec « + Nouvelle fiche » à gauche.</div></div>`
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
      <div class="row wrap" style="gap:8px; flex:1; min-width:0;">
        <button class="btn" data-ing-add style="border-style:dashed;">+ Ingrédient</button>
        <button class="btn muted" data-new-tracked style="border-style:dashed;">+ Référence suivie</button>
        <button class="btn muted" data-new-untracked style="border-style:dashed;">+ Garniture</button>
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
        <div class="mono-label">${c.ok ? 'Prix carte TTC' : `Sous le plancher ${pc(pr.min)}`}</div>
        <div style="font-family:var(--serif); font-size:38px; line-height:1;">${eur(c.prix_ttc)}</div>
      </div>
      <input type="range" min="8" max="30" step="0.5" value="${c.prix_ttc}" data-price style="width:100%;">
      ${[
        { k: 'Prix HT', v: eur(c.prix_ht) },
        { k: 'Coût matière', v: `${eur(c.cost)} · ${pc(c.prix_ht > 0 ? c.cost / c.prix_ht * 100 : 0, 1)}` },
        { k: 'Marge brute', v: `${eur(c.prix_ht - c.cost)} · ${pc(c.marge, 1)}` },
        { k: 'TVA collectée', v: eur(c.tva) },
      ].map((m) => `
      <div class="row spread" style="padding-top:11px; border-top:1px solid ${c.ok ? '#2C3D1B' : '#402825'};">
        <div style="font-size:13px; color:${c.ok ? '#B4CFA0' : 'var(--warn-mut)'};">${m.k}</div>
        <div class="num" style="font-size:13px;">${m.v}</div>
      </div>`).join('')}
    </div>
    <div class="panel" style="padding:20px; display:flex; flex-direction:column; gap:11px;">
      <div class="mono-label" style="color:var(--mut2);">Prix conseillé</div>
      <div style="font-size:13px; color:var(--mut);" class="pretty">Pour tenir la marge cible de
        ${pc(pr.cible)}, cette fiche se vend <span class="accent">${eur(c.suggested)}</span>.</div>
      <button class="btn" data-apply style="margin-top:4px;">Appliquer ce prix</button>
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

  el.querySelectorAll('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => { sel = Number(b.dataset.pick); render(el); })
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const x = cocktails.find((y) => y.id === Number(b.dataset.del));
      const ok = await confirmModal({
        title: `Supprimer « ${x.nom} » ?`,
        body: 'La fiche et son chiffrage seront perdus.',
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
        body: 'Créez une référence suivie avant d’ajouter un ingrédient à une fiche.',
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

  const priceSlider = el.querySelector('[data-price]');
  priceSlider.addEventListener('change', () => patch({ prix_ttc: Number(priceSlider.value) }));
  el.querySelector('[data-apply]').addEventListener('click', () => patch({ prix_ttc: c.suggested }));
}
