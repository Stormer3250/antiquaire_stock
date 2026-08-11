// Barème fiscal : taux éditables + effet sur la dose pour les références réelles.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, pc, parseNum } from '../ui.js';
import { S, reloadMeta, lieuQuery } from '../app.js';

const PARAMS = [
  { key: 'accise', k: 'Droit d’accise · spiritueux', n: 'au hL d’alcool pur', unit: '€/hL AP', d: 0 },
  { key: 'accise_dom', k: 'Droit d’accise · rhum des DOM', n: 'taux réduit, rhum traditionnel des départements d’outre-mer', unit: '€/hL AP', d: 2 },
  { key: 'ss', k: 'Cotisation sécurité sociale', n: 'boissons de plus de 18 % vol.', unit: '€/hL AP', d: 0 },
  { key: 'vin', k: 'Vin tranquille', n: 'au hL de produit fini', unit: '€/hL', d: 2 },
  { key: 'mousseux', k: 'Vin mousseux', n: 'champagnes et effervescents', unit: '€/hL', d: 2 },
  { key: 'biere', k: 'Bière', n: 'au hL et par degré alcoolique', unit: '€/hL/degré', d: 2 },
];

export async function render(el) {
  const refsData = await apiGet(`/api/stock?lieu=${lieuQuery()}`);
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
    <div class="panel">
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

    <div class="panel">
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
  </div>`;

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
