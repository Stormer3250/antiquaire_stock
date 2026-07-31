// Le grand registre : recherche, filtre catégorie, table des références.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, pc, confirmModal } from '../ui.js';
import { S, go, refresh, lieuQuery, fmtStock } from '../app.js';
import { openRefModal } from '../refmodal.js';

const F = { query: '', cat: 'Tout' };  // filtres persistants pendant la session

const GRID = 'grid-template-columns:2.2fr .9fr .6fr .7fr .9fr .9fr .7fr .9fr 66px;';

export async function render(el) {
  const data = await apiGet(`/api/stock?lieu=${lieuQuery()}`);
  const rows = data.refs.filter((r) => r.categorie_nom !== 'Consommable');
  const q = F.query.toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (F.cat === 'Tout'
        || (F.cat === '__untracked' ? !r.suivi : String(r.categorie_id) === F.cat))
      && (q === '' || `${r.nom} ${r.marque} ${r.fournisseur}`.toLowerCase().includes(q))
  );
  const cats = S.meta.categories.filter((c) => c.nom !== 'Consommable');
  const pr = S.meta.pricing;

  const body = rows.length === 0
    ? `<div class="empty-note">Le registre est vide. Créez une référence avec « + Référence »
        en haut, ou importez votre fichier Excel depuis <a href="#/cave">Cave &amp; seuils</a>.</div>`
    : filtered.length === 0
      ? `<div class="empty-note">Aucune référence ne correspond à cette recherche.</div>`
      : filtered.map((r) => `
      <div class="trow" style="${GRID}">
        <div class="row" data-open="${r.id}" style="cursor:pointer; min-width:0; gap:11px;">
          <div class="status-bar ${r.suivi ? (r.low ? 'low' : 'fine') : 'untracked'}"></div>
          <div class="cell-main">
            <div class="nom">${esc(r.nom)}</div>
            <div class="sub">${esc(r.suivi ? `${r.marque} · ${r.fournisseur}` : `${r.marque} · non suivie · ${r.unite}`)}</div>
          </div>
        </div>
        <div style="font-size:12.5px; color:var(--mut);">${esc(r.categorie_nom)}</div>
        <div class="num r" style="font-size:12px; color:var(--mut);">${r.suivi && r.abv > 0 ? num(r.abv, 1) + '°' : '—'}</div>
        <div class="num r" style="font-size:12.5px;">${fmtStock(r)}</div>
        <div class="num r" style="font-size:12.5px; color:var(--mut);">${r.suivi ? eur(r.valeur) : '—'}</div>
        <div class="num r" style="font-size:12.5px; color:var(--mut);">${eur(r.cout_dose)}</div>
        <div class="num r" style="font-size:12px;">${r.suivi ? `<span class="${r.marge_reelle >= pr.min ? 'ok-text' : 'warn-text'}">${pc(r.marge_reelle)}</span>` : '—'}</div>
        <div class="num r accent" style="font-size:13px;" ${r.override ? 'title="Prix fixé à la main sur la fiche"' : ''}>${r.suivi ? eur(r.prix) + (r.override ? ' ·' : '') : '—'}</div>
        <div class="row" style="gap:5px; justify-self:end;">
          <button class="icon-btn" data-edit="${r.id}" aria-label="Éditer">ÉD</button>
          <button class="icon-btn danger" data-del="${r.id}" aria-label="Supprimer">×</button>
        </div>
      </div>`).join('');

  el.innerHTML = `
  <div class="row" style="margin-bottom:16px; gap:12px;">
    <input class="input grow" data-q value="${esc(F.query)}" style="padding:11px 14px; font-size:13.5px;"
      placeholder="Chercher une bouteille, une marque, un fournisseur…">
    <div style="width:210px;">
      <select class="input" data-cat>
        <option value="Tout">Toutes catégories</option>
        ${cats.map((c) => `<option value="${c.id}" ${String(c.id) === F.cat ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}
        <option value="__untracked" ${F.cat === '__untracked' ? 'selected' : ''}>Non suivies</option>
      </select>
    </div>
  </div>
  <div class="panel">
    <div class="thead" style="${GRID}">
      <div>Référence</div><div>Catégorie</div><div class="r">Degré</div><div class="r">Stock</div>
      <div class="r">Valeur HT</div><div class="r">Coût unitaire</div><div class="r">Marge</div>
      <div class="r">Prix conseillé</div><div></div>
    </div>
    ${body}
    <div class="panel-foot">
      <span>${filtered.length} référence${filtered.length > 1 ? 's' : ''} affichée${filtered.length > 1 ? 's' : ''}</span>
      <span>Prix conseillés TTC · marge cible ${pc(pr.cible)} · « · » = prix fixé à la main</span>
    </div>
  </div>`;

  el.querySelector('[data-q]').addEventListener('input', (e) => {
    F.query = e.target.value;
    render(el);
  });
  el.querySelector('[data-cat]').addEventListener('change', (e) => {
    F.cat = e.target.value;
    render(el);
  });
  el.querySelectorAll('[data-open]').forEach((n) =>
    n.addEventListener('click', () => {
      const r = rows.find((x) => x.id === Number(n.dataset.open));
      if (r.suivi) go(`#/product/${r.id}`);
      else openRefModal({ ref: r });
    })
  );
  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      openRefModal({ ref: rows.find((x) => x.id === Number(b.dataset.edit)) });
    })
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = rows.find((x) => x.id === Number(b.dataset.del));
      const ok = await confirmModal({
        title: `Supprimer ${r.nom} ?`,
        body: 'La référence disparaît de la cave et des listes. Les fiches cocktails qui l’utilisent devront être corrigées.',
      });
      if (!ok) return;
      await apiSend('DELETE', `/api/refs/${r.id}`);
      await refresh();
    })
  );
  const focus = el.querySelector('[data-q]');
  if (F.query) { focus.focus(); focus.setSelectionRange(focus.value.length, focus.value.length); }
}
