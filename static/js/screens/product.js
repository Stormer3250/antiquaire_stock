// Fiche bouteille : specs, part fiscale, curseur de marge + prix manuel, scénarios.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, pc, parseNum, confirmModal } from '../ui.js';
import { S, go, refresh, lieuQuery, lieuLabel } from '../app.js';
import { openRefModal } from '../refmodal.js';

export async function render(el, state) {
  let p;
  try {
    p = await apiGet(`/api/refs/${state.param}?lieu=${lieuQuery()}`);
  } catch {
    el.innerHTML = `<div class="panel"><div class="empty-note">Référence introuvable.
      <a href="#/refs">Retour au registre</a>.</div></div>`;
    return;
  }
  const pr = p.pricing;
  const taxesDose = p.fiscal.accise + p.fiscal.ss;
  // marge affichée pendant le glissement (état local, persistée au relâchement)
  let marge = p.marge;

  const compute = (m) => {
    const ht = p.cout_dose / (1 - m / 100);
    const brut = ht * (1 + p.tva_pct / 100);
    const step = pr.arrondi || 0.5;
    return { ht, brut, ttc: Math.round((Math.round(brut / step) * step) * 100) / 100 };
  };

  function priceBoxHtml() {
    const override = p.prix_ttc_override !== null;
    const c = compute(marge);
    const ttc = override ? p.prix_ttc_override : c.ttc;
    const ht = ttc / (1 + p.tva_pct / 100);
    const reelle = ht > 0 ? (ht - p.cout_dose) / ht * 100 : 0;
    const ok = reelle >= pr.min;
    return `
    <div class="${ok ? 'card-ok' : 'card-warn'}" style="padding:20px; border-width:0 0 1px 0; border-bottom:1px solid var(--line); display:flex; align-items:flex-end; justify-content:space-between; gap:18px;">
      <div style="display:flex; flex-direction:column; gap:6px; min-width:0;">
        <div class="mono-label">${ok
          ? (override ? 'Prix fixé à la main' : 'Prix conseillé TTC arrondi')
          : `Sous le plancher de ${pc(pr.min)}`}</div>
        <div style="font-size:12.5px; color:${ok ? 'var(--ok-mut)' : 'var(--warn-mut)'};">
          Marge réelle ${pc(reelle, 1)} · coût matière ${pc(100 - reelle, 1)}</div>
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
      { k: 'Prix TTC calculé', n: `avant arrondi à ${num(pr.arrondi, 2)} €`, v: eur(c.brut) },
    ];
    return lines.map((w) => `
      <div class="row spread" style="padding:13px 20px; border-bottom:1px solid var(--line2); gap:16px;">
        <div class="cell-main"><div style="font-size:13.5px;">${w.k}</div><div class="sub">${w.n}</div></div>
        <div class="num" style="font-size:13px; color:var(--mut); white-space:nowrap;">${w.v}</div>
      </div>`).join('');
  }

  function rightPanelHtml() {
    const scenarios = [
      { k: `plancher ${num(pr.min, 0)} %`, m: pr.min },
      { k: `cible ${num(pr.cible, 0)} %`, m: pr.cible },
      { k: `premium ${num(Math.min(pr.cible + 5, 92), 0)} %`, m: Math.min(pr.cible + 5, 92) },
    ];
    return `
    <div class="panel-head">
      <div class="serif-title">Prix conseillé · dose de ${num(p.dose_cl, 0)} cl</div>
      <button class="btn muted" data-back>Retour</button>
    </div>
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
        <button data-scenario="${s.m}" style="border:1px solid var(--line); background:transparent; padding:13px; display:flex; flex-direction:column; gap:6px; text-align:left; cursor:pointer;">
          <div class="num" style="font-size:10.5px; color:var(--mut2);">${s.k}</div>
          <div style="font-family:var(--serif); font-size:22px; color:var(--ac2);">${eur(compute(s.m).ttc)}</div>
          <div class="sub">coefficient × ${num(1 / (1 - s.m / 100), 2)}</div>
        </button>`).join('')}
      </div>
    </div>`;
  }

  const specs = [
    { k: 'Format', v: `${num(p.vol_cl, 0)} cl` },
    { k: 'Degré', v: p.abv === 0 ? 'sans alcool' : `${num(p.abv, 1)} % vol.` },
    { k: 'Prix d’achat HT', v: eur(p.achat_ht) },
    { k: `Doses de ${num(p.dose_cl, 0)} cl`, v: `${num(p.doses_par_bouteille, 1)} par bouteille` },
    { k: `Stock (${lieuLabel()})`, v: `${num(p.stock, p.stock % 1 ? 2 : 0)} · seuil ${num(p.seuil, 0)}` },
    { k: 'Valeur immobilisée', v: eur(p.stock * p.achat_ht) },
  ];

  const fiscalLines = [
    { k: 'Alcool pur dans la dose', n: `${num(p.dose_cl, 0)} cl à ${num(p.abv, 1)} % vol.`, v: `${num(p.fiscal.cl_alcool_pur, 2)} cl AP` },
    { k: 'Droit d’accise', n: p.fiscal.regime === 'aucun' ? 'non soumis' : `régime ${p.fiscal.regime}`, v: eur(p.fiscal.accise, 3) },
    { k: 'Cotisation sécurité sociale', n: p.fiscal.ss ? `${num(S.meta.rates.ss, 0)} €/hL AP` : '—', v: eur(p.fiscal.ss, 3) },
    { k: 'Total taxes par dose', n: p.droits_inclus ? 'compris dans le prix d’achat' : 'ajouté au coût matière', v: eur(taxesDose, 3) },
    { k: 'Poids sur le coût matière', n: 'taxes ÷ coût de la dose', v: p.cout_dose > 0 ? pc(taxesDose / p.cout_dose * 100, 1) : '—' },
  ];

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:1fr 1.15fr; gap:18px; align-items:start;">
    <div class="stack">
      <div class="panel" style="padding:22px;">
        <div class="row spread" style="align-items:flex-start; gap:12px;">
          <div class="cell-main">
            <div style="font-family:var(--serif); font-size:25px; line-height:1.15;">${esc(p.nom)}</div>
            <div style="margin-top:4px; font-size:13px; color:var(--mut2);">${esc(p.marque)}${p.fournisseur ? ' · ' + esc(p.fournisseur) : ''}</div>
          </div>
          <div class="row" style="gap:7px; flex:0 0 auto;">
            <button class="btn" data-edit>Éditer</button>
            <button class="btn muted danger" data-remove>Supprimer</button>
          </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px 16px; margin-top:18px;">
          ${specs.map((s) => `
          <div class="field" style="gap:3px;">
            <div class="mono-label" style="font-size:9px;">${esc(s.k)}</div>
            <div style="font-size:13px;">${esc(s.v)}</div>
          </div>`).join('')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="serif-title">Part fiscale de la dose</div>
          <button class="btn" data-bareme>Barème</button>
        </div>
        ${fiscalLines.map((f) => `
        <div class="row spread" style="padding:12px 20px; border-bottom:1px solid var(--line2); gap:14px;">
          <div class="cell-main"><div style="font-size:13px;">${esc(f.k)}</div><div class="sub">${esc(f.n)}</div></div>
          <div class="num" style="font-size:12.5px; color:var(--ac3); white-space:nowrap;">${f.v}</div>
        </div>`).join('')}
        <label class="row" style="padding:14px 20px; gap:9px; cursor:pointer;">
          <input type="checkbox" data-droits ${p.droits_inclus ? 'checked' : ''} style="accent-color:var(--ac);">
          <span style="font-size:12.5px; color:var(--mut);">Droits déjà inclus dans le prix d’achat facturé</span>
        </label>
      </div>
    </div>

    <div class="panel" style="display:flex; flex-direction:column;">${rightPanelHtml()}</div>
  </div>`;

  // ---------- interactions ----------

  const right = el.querySelector('.panel[style*="flex-direction:column"]');

  function refreshDerived() {
    right.querySelector('[data-marge-label]').textContent = pc(marge);
    right.querySelector('[data-coeff]').textContent =
      `coefficient équivalent × ${num(1 / (1 - marge / 100), 2)}`;
    right.querySelector('[data-waterfall]').innerHTML = waterfallHtml();
    right.querySelector('[data-pricebox]').innerHTML = priceBoxHtml();
    bindPriceBox();
  }

  async function persistMarge(m) {
    await apiSend('PATCH', `/api/refs/${p.id}`, { marge_pct: m, prix_ttc: null });
    p.prix_ttc_override = null;
    p.marge = m;
    refreshDerived();
  }

  function bindPriceBox() {
    const input = right.querySelector('[data-price]');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('blur', async () => {
      const v = parseNum(input.value);
      const computed = compute(marge).ttc;
      if (v <= 0 || Math.abs(v - computed) < 0.005) return;
      await apiSend('PATCH', `/api/refs/${p.id}`, { prix_ttc: v });
      p.prix_ttc_override = v;
      refreshDerived();
    });
    const clear = right.querySelector('[data-clear-override]');
    if (clear) clear.addEventListener('click', async () => {
      await apiSend('PATCH', `/api/refs/${p.id}`, { prix_ttc: null });
      p.prix_ttc_override = null;
      refreshDerived();
    });
  }

  const slider = right.querySelector('[data-slider]');
  slider.addEventListener('input', () => {
    marge = Number(slider.value);
    refreshDerived();
  });
  slider.addEventListener('change', () => persistMarge(Number(slider.value)));

  right.querySelectorAll('[data-scenario]').forEach((b) =>
    b.addEventListener('click', async () => {
      marge = Number(b.dataset.scenario);
      slider.value = Math.round(marge);
      await persistMarge(marge);
    })
  );
  bindPriceBox();

  el.querySelector('[data-back]').addEventListener('click', () => go('#/refs'));
  el.querySelector('[data-bareme]').addEventListener('click', () => go('#/bareme'));
  el.querySelector('[data-droits]').addEventListener('change', async (e) => {
    await apiSend('PATCH', `/api/refs/${p.id}`, { droits_inclus: e.target.checked });
    await refresh();
  });
  el.querySelector('[data-edit]').addEventListener('click', () => openRefModal({ ref: p }));
  el.querySelector('[data-remove]').addEventListener('click', async () => {
    const ok = await confirmModal({
      title: `Supprimer ${p.nom} ?`,
      body: 'La référence disparaît de la cave et des listes. Les fiches cocktails qui l’utilisent devront être corrigées.',
    });
    if (!ok) return;
    await apiSend('DELETE', `/api/refs/${p.id}`);
    go('#/refs');
  });
}
