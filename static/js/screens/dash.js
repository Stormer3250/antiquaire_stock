// Comptoir : valeur de la cave, KPIs, commandes fournisseurs, marges de la carte.

import { apiGet } from '../api.js';
import { esc, eur, num, pc } from '../ui.js';
import { S, go, lieuQuery, lieuLabel } from '../app.js';

export async function render(el) {
  const [stockData, ordersData, cocktailsData, impactData] = await Promise.all([
    apiGet(`/api/stock?lieu=${lieuQuery()}`),
    apiGet(`/api/orders?lieu=${lieuQuery()}`),
    apiGet(`/api/cocktails?lieu=${lieuQuery()}`),
    apiGet('/api/impact'),
  ]);
  const refs = stockData.refs.filter((r) => r.suivi);
  const cocktails = cocktailsData.cocktails;
  const pr = S.meta.pricing;

  const totalValue = refs.reduce((a, r) => a + (r.valeur || 0), 0);
  const enStock = refs.filter((r) => r.stock > 0).length;
  const lowCount = refs.filter((r) => r.low).length;
  const avgMarge = cocktails.length
    ? cocktails.reduce((a, c) => a + c.marge, 0) / cocktails.length
    : 0;

  const kpis = [
    {
      label: 'Références en stock',
      value: String(enStock),
      note: `sur ${refs.length} référence${refs.length > 1 ? 's' : ''} suivie${refs.length > 1 ? 's' : ''}`,
    },
    cocktails.length
      ? { label: 'Marge moyenne carte', value: pc(avgMarge, 1), note: `cible ${pc(pr.cible)}, plancher ${pc(pr.min)}` }
      : { label: 'Marge moyenne carte', value: '—', note: 'aucune fiche cocktail pour l’instant' },
    { label: 'Seuils franchis', value: String(lowCount), note: 'références sous leur seuil d’alerte' },
    { label: 'Fiches à la carte', value: String(cocktails.length), note: 'recettes chiffrées et à jour' },
  ];

  const groups = ordersData.groups;
  const orderPanel = refs.length === 0
    ? `<div class="empty-note">Aucune référence suivie pour l’instant — créez-en une avec
        « + Référence » ou importez un fichier depuis <a href="#/cave">Cave &amp; seuils</a>.</div>`
    : groups.length === 0
      ? `<div class="empty-note">Rien à commander : toutes les références sont au-dessus de leur seuil.</div>`
      : groups.map((g) => `
        <div style="padding:12px 20px 4px;" class="mono-label">${esc(g.fournisseur || 'Sans fournisseur')}</div>
        ${g.lines.map((l) => `
        <div class="trow" style="grid-template-columns:5px 1fr auto;">
          <div class="status-bar low" style="height:32px;"></div>
          <div class="cell-main">
            <div class="nom">${esc(l.nom)}</div>
            <div class="sub">reste ${num(l.stock, l.stock % 1 ? 2 : 0)} · seuil ${num(l.seuil, 0)}</div>
          </div>
          <div class="num accent" style="font-size:12.5px;">commander ${num(l.quantite, 0)}</div>
        </div>`).join('')}`).join('');

  // Ce que les hausses de prix d'achat ont fait aux fiches : rien de nouveau en base,
  // on recalcule au prix pratiqué aujourd'hui et on ne montre que ce qui a lâché.
  const impact = impactData.fiches;
  const impactPanel = impact.length === 0
    ? `<div class="empty-note">Aucune fiche sous le plancher de ${pc(impactData.plancher)} :
        les hausses de prix d’achat n’ont encore rien fait céder.</div>`
    : impact.slice(0, 8).map((f) => `
      <div class="trow" style="grid-template-columns:5px 1fr auto; padding:11px 20px;">
        <div class="status-bar low" style="height:34px;"></div>
        <div class="cell-main">
          <div class="nom">${esc(f.nom)}</div>
          <div class="sub">${esc(f.menu_nom || 'hors menu')}${f.ingredient_lourd
            ? ` · ${esc(f.ingredient_lourd)} pèse ${pc(f.part_ingredient)} du coût` : ''}</div>
        </div>
        <div style="text-align:right;">
          <div class="num warn-text" style="font-size:12.5px;">${pc(f.marge, 1)}</div>
          <div class="num" style="font-size:11px; color:var(--mut3);">
            ${eur(f.prix_ttc)} → ${eur(f.prix_conseille)}</div>
        </div>
      </div>`).join('');

  const marginsPanel = cocktails.length === 0
    ? `<div class="empty-note">Les fiches de <a href="#/cocktails">Cartes &amp; recettes</a> apparaîtront ici avec leur marge.</div>`
    : cocktails.map((c) => `
      <div style="padding:12px 20px; border-bottom:1px solid var(--line2); display:flex; flex-direction:column; gap:7px;">
        <div class="row spread" style="align-items:baseline;">
          <div style="font-size:13.5px;">${esc(c.nom)}</div>
          <div class="num" style="font-size:12px; color:${c.ok ? 'var(--mut)' : 'var(--red2)'};">
            ${eur(c.prix_ttc)} · ${pc(c.marge)}</div>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, Math.round(c.marge)))}%;"></div></div>
      </div>`).join('');

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:1.15fr 1fr; gap:16px; align-items:stretch;">
    <div class="hero">
      <div class="mono-label">Valeur de la cave · prix d’achat HT · ${esc(lieuLabel())}</div>
      <div class="hero-value">${eur(totalValue, 0)}</div>
      <div class="hero-note">${enStock} référence${enStock > 1 ? 's' : ''} en stock,
        sur ${refs.length} suivie${refs.length > 1 ? 's' : ''}.</div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      ${kpis.map((k) => `
      <div class="kpi">
        <div class="mono-label">${esc(k.label)}</div>
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-note">${esc(k.note)}</div>
      </div>`).join('')}
    </div>
  </div>

  <div style="display:grid; grid-template-columns:1.35fr 1fr; gap:16px; margin-top:16px;">
    <div class="panel">
      <div class="panel-head">
        <div class="serif-title">La cave crie famine</div>
        <button class="btn" data-goto-cave>Régler les seuils</button>
      </div>
      ${orderPanel}
    </div>
    <div class="panel" style="display:flex; flex-direction:column;">
      <div class="panel-head">
        <div class="serif-title">Marge par fiche</div>
        <div class="num" style="font-size:10.5px; color:var(--mut3);">plancher ${pc(pr.min)}</div>
      </div>
      ${marginsPanel}
    </div>
  </div>

  <div class="panel" style="margin-top:16px;">
    <div class="panel-head">
      <div class="serif-title">Ce que les hausses d’achat ont fait céder</div>
      <div class="num" style="font-size:10.5px; color:var(--mut3);">
        ${impact.length} fiche${impact.length > 1 ? 's' : ''} sous le plancher de ${pc(impactData.plancher)}</div>
    </div>
    ${impactPanel}
  </div>`;

  el.querySelector('[data-goto-cave]').addEventListener('click', () => go('#/cave'));
}
