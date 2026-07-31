// Cave & seuils : maintien du stock, garnitures non suivies, import de fichier.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, parseNum, confirmModal } from '../ui.js';
import { S, refresh, lieuQuery, fmtStock } from '../app.js';
import { openRefModal } from '../refmodal.js';

const GRID = 'grid-template-columns:2fr .7fr 1fr 1fr 1fr .8fr .8fr 66px;';
const UGRID = 'grid-template-columns:2fr 1fr 1fr 1fr 66px;';

// état de l'import en cours (survit aux re-rendus de l'écran)
const imp = { step: 'idle', data: null, mapping: {}, lieu: null, cat: null, result: null };

const IMP_FIELDS = [
  { value: '', label: 'Ignorer cette colonne' },
  { value: 'nom', label: 'Nom de la référence' },
  { value: 'marque', label: 'Marque / domaine' },
  { value: 'categorie', label: 'Catégorie' },
  { value: 'volume', label: 'Volume (cl)' },
  { value: 'degre', label: 'Degré (% vol.)' },
  { value: 'achat', label: 'Prix d’achat HT' },
  { value: 'stock', label: 'Quantité en stock' },
  { value: 'fournisseur', label: 'Fournisseur' },
];

export async function render(el) {
  const [stockData, importsData] = await Promise.all([
    apiGet(`/api/stock?lieu=${lieuQuery()}`),
    apiGet('/api/imports'),
  ]);
  const tracked = stockData.refs.filter((r) => r.suivi);
  const untracked = stockData.refs.filter((r) => !r.suivi && r.categorie_nom !== 'Consommable');
  const low = tracked.filter((r) => r.low).length;

  const patchRef = async (id, body) => {
    await apiSend('PATCH', `/api/refs/${id}`, body);
    await render(el);
  };

  const trackedBody = tracked.length === 0
    ? `<div class="empty-note">Aucune référence suivie — créez-en avec « + Référence » ou déposez un fichier ci-contre.</div>`
    : tracked.map((r) => `
    <div class="trow" style="${GRID} padding:11px 20px;">
      <div class="cell-main">
        <div class="nom">${esc(r.nom)}</div>
        <div class="sub">${esc(r.marque)}${r.fournisseur ? ' · ' + esc(r.fournisseur) : ''}</div>
      </div>
      <div class="num r" style="font-size:12.5px;">${fmtStock(r)}</div>
      <div class="stepper" data-seuil="${r.id}">
        <button data-dir="-1">–</button><span class="val">${num(r.seuil, 0)}</span><button data-dir="1">+</button>
      </div>
      <div class="stepper" data-par="${r.id}">
        <button data-dir="-1">–</button><span class="val">${num(r.par_target, 0)}</span><button data-dir="1">+</button>
      </div>
      <input class="input num" data-achat="${r.id}" value="${num(r.achat_ht, 2)}" aria-label="Prix d'achat">
      <input class="input num" data-marge="${r.id}" value="${num(r.marge, 0)}" aria-label="Marge">
      ${r.low
        ? '<div class="chip-low">SOUS SEUIL</div>'
        : '<div class="num r" style="font-size:10.5px; color:var(--ok-ink); justify-self:end;">suffisant</div>'}
      <div class="row" style="gap:5px; justify-self:end;">
        <button class="icon-btn" data-edit="${r.id}" aria-label="Éditer">ÉD</button>
        <button class="icon-btn danger" data-del="${r.id}" aria-label="Supprimer">×</button>
      </div>
    </div>`).join('');

  const untrackedBody = untracked.length === 0
    ? `<div class="empty-note">Aucune garniture — elles servent uniquement à chiffrer les fiches cocktails.</div>`
    : untracked.map((r) => {
      return `
    <div class="trow" style="${UGRID} padding:11px 20px;">
      <div class="cell-main">
        <div class="nom">${esc(r.nom)}</div>
        <div class="sub">${esc(r.marque)}</div>
      </div>
      <div style="font-size:12.5px; color:var(--mut);">${esc(r.unite)}</div>
      <div class="num r accent" style="font-size:12.5px;">${eur(r.cout_dose)}</div>
      <div class="num r" style="font-size:12px; color:var(--mut2);">—</div>
      <div class="row" style="gap:5px; justify-self:end;">
        <button class="icon-btn" data-edit="${r.id}" aria-label="Éditer">ÉD</button>
        <button class="icon-btn danger" data-del="${r.id}" aria-label="Supprimer">×</button>
      </div>
    </div>`;
    }).join('');

  // ---------- carte import ----------

  function importCard() {
    if (imp.step === 'mapping' && imp.data) {
      const d = imp.data;
      return `
      <div class="row spread" style="padding:16px 18px 0;">
        <div style="font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(d.filename)}</div>
        <button class="btn muted" data-imp-cancel style="padding:4px 9px; font-size:10px;">Annuler</button>
      </div>
      <div style="padding:14px 18px; display:flex; flex-direction:column; gap:9px;">
        <div class="mono-label">Correspondance des colonnes</div>
        ${d.columns.map((col) => `
        <div style="display:grid; grid-template-columns:1fr 1.1fr; gap:9px; align-items:center;">
          <div class="num" style="font-size:11.5px; color:var(--mut);" title="${esc(col.sample)}">
            Colonne ${col.letter}${col.header ? ' · ' + esc(col.header) : ''}</div>
          <select class="input" data-imp-map="${col.key}">
            ${IMP_FIELDS.map((f) => `<option value="${f.value}" ${imp.mapping[col.key] === f.value ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
          </select>
        </div>`).join('')}
        <div class="row" style="gap:9px; margin-top:5px;">
          <div class="field grow"><div class="mono-label">Stock compté sur</div>
            <select class="input" data-imp-lieu>
              ${S.meta.locations.map((l) => `<option value="${l.id}" ${imp.lieu === l.id ? 'selected' : ''}>${esc(l.nom)}</option>`).join('')}
            </select></div>
          <div class="field grow"><div class="mono-label">Catégorie des nouveautés</div>
            <select class="input" data-imp-cat>
              ${S.meta.categories.filter((c) => c.nom !== 'Consommable').map((c) => `<option value="${c.id}" ${imp.cat === c.id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}
            </select></div>
        </div>
        <div style="border-top:1px solid var(--line2); padding-top:12px; display:flex; flex-direction:column; gap:7px;">
          <div class="mono-label">Aperçu · ${d.row_count} ligne${d.row_count > 1 ? 's' : ''} lue${d.row_count > 1 ? 's' : ''}</div>
          ${d.preview.map((row) => `
          <div class="row spread" style="font-size:12.5px; gap:10px;">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(row[0] ?? '')}</span>
            <span class="num" style="color:var(--mut2); flex:0 0 auto;">${esc(row.slice(1, 4).filter(Boolean).join(' · '))}</span>
          </div>`).join('')}
        </div>
        <button class="btn-solid" data-imp-apply style="margin-top:6px;">Valider l’import</button>
      </div>`;
    }
    if (imp.step === 'done' && imp.result) {
      const r = imp.result;
      return `
      <div style="padding:22px 18px; display:flex; flex-direction:column; gap:11px;">
        <div style="font-family:var(--serif); font-size:22px;" class="accent">Import appliqué</div>
        <div style="font-size:13px; color:var(--mut);" class="pretty">
          ${r.updated} référence${r.updated > 1 ? 's' : ''} mise${r.updated > 1 ? 's' : ''} à jour,
          ${r.created} créée${r.created > 1 ? 's' : ''}. Prix d’achat et quantités repris,
          prix conseillés recalculés.</div>
        ${r.errors.length
          ? `<div style="font-size:12px; color:var(--red2);" class="pretty">${r.errors.length} ligne(s) ignorée(s) :<br>${r.errors.slice(0, 6).map(esc).join('<br>')}</div>`
          : ''}
        <button class="btn" data-imp-reset>Nouvel import</button>
      </div>`;
    }
    return `
    <div style="padding:22px 18px; display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center;">
      <div style="font-size:13px; color:var(--mut);" class="pretty">Déposez un .xlsx ou .csv pour
        mettre à jour les références et les quantités en stock.</div>
      <label class="btn-solid" style="cursor:pointer;">
        Choisir un fichier
        <input type="file" accept=".xlsx,.xls,.csv" data-imp-file style="display:none;">
      </label>
    </div>`;
  }

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:1fr 320px; gap:18px; align-items:start;">
    <div class="stack" style="gap:18px;">
      <div class="panel">
        <div class="panel-head">
          <div class="serif-title">Maintien du stock</div>
          <div style="font-size:12.5px; color:var(--mut3);">Seuil d’alerte, stock cible, prix d’achat et marge</div>
        </div>
        <div class="thead" style="${GRID}">
          <div>Référence</div><div class="r">Stock</div><div class="c">Seuil</div><div class="c">Cible</div>
          <div class="c">Achat HT</div><div class="c">Marge %</div><div class="r">Statut</div><div></div>
        </div>
        ${trackedBody}
        <div class="panel-foot">
          <span>Modifier un prix d’achat recalcule aussitôt le coût par dose et le prix conseillé.</span>
          <span>${tracked.length} références · ${low} sous seuil</span>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="serif-title">Références non suivies</div>
          <button class="btn" data-new-untracked>+ Garniture</button>
        </div>
        <div class="thead" style="${UGRID}">
          <div>Garniture, épice, aromate</div><div>Unité</div><div class="r">Coût unitaire</div><div class="r"></div><div></div>
        </div>
        ${untrackedBody}
        <div class="panel-foot"><span class="pretty">Ni stock, ni seuil, ni inventaire : ces références
          servent uniquement à chiffrer les fiches cocktails.</span></div>
      </div>
    </div>

    <div class="stack" style="gap:14px;">
      <div class="panel">
        <div style="padding:15px 18px; border-bottom:1px solid var(--line);" class="serif-title">
          Mise à jour par fichier</div>
        <div data-import-card>${importCard()}</div>
      </div>
      <div class="panel" style="padding:18px; display:flex; flex-direction:column; gap:10px;">
        <div class="mono-label" style="color:var(--mut2);">Historique des imports</div>
        ${importsData.imports.length === 0
          ? '<div style="font-size:12.5px; color:var(--mut3);">Aucun import pour l’instant.</div>'
          : importsData.imports.slice(0, 6).map((h) => `
          <div class="row spread" style="gap:10px;">
            <div style="font-size:12.5px; color:var(--mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(h.filename)}</div>
            <div class="num" style="font-size:11.5px; color:var(--mut3); flex:0 0 auto;">
              ${esc(h.created_at.slice(0, 10))} · ${h.line_count} lignes</div>
          </div>`).join('')}
      </div>
    </div>
  </div>`;

  // ---------- liaisons table ----------

  el.querySelectorAll('[data-seuil]').forEach((n) =>
    n.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const r = tracked.find((x) => x.id === Number(n.dataset.seuil));
        patchRef(r.id, { seuil: Math.max(0, r.seuil + Number(b.dataset.dir)) });
      })
    )
  );
  el.querySelectorAll('[data-par]').forEach((n) =>
    n.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const r = tracked.find((x) => x.id === Number(n.dataset.par));
        patchRef(r.id, { par_target: Math.max(0, r.par_target + Number(b.dataset.dir)) });
      })
    )
  );
  const blurPatch = (attr, key, transform) =>
    el.querySelectorAll(`[data-${attr}]`).forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('blur', () => {
        const id = Number(inp.dataset[attr]);
        const r = stockData.refs.find((x) => x.id === id);
        const v = parseNum(inp.value);
        if (v > 0 && Math.abs(v - (attr === 'achat' ? r.achat_ht : r.marge)) > 0.001) {
          patchRef(id, { [key]: transform ? transform(v) : v });
        }
      });
    });
  blurPatch('achat', 'achat_ht');
  blurPatch('marge', 'marge_pct');

  el.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () =>
      openRefModal({ ref: stockData.refs.find((x) => x.id === Number(b.dataset.edit)) })
    )
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = stockData.refs.find((x) => x.id === Number(b.dataset.del));
      const ok = await confirmModal({
        title: `Supprimer ${r.nom} ?`,
        body: 'La référence disparaît de la cave et des listes. Les fiches cocktails qui l’utilisent devront être corrigées.',
      });
      if (!ok) return;
      await apiSend('DELETE', `/api/refs/${r.id}`);
      await refresh();
    })
  );
  el.querySelector('[data-new-untracked]').addEventListener('click', () =>
    openRefModal({ suivi: false })
  );

  // ---------- liaisons import ----------

  const card = el.querySelector('[data-import-card]');

  function bindImportCard() {
    const file = card.querySelector('[data-imp-file]');
    if (file) {
      file.addEventListener('change', async () => {
        if (!file.files.length) return;
        const fd = new FormData();
        fd.append('file', file.files[0]);
        try {
          const data = await apiSend('POST', '/api/import/inspect', fd);
          imp.step = 'mapping';
          imp.data = data;
          imp.lieu = S.lieu !== 'tous' ? S.lieu : S.meta.locations[0]?.id;
          imp.cat = S.meta.categories[0]?.id;
          // pré-remplissage : en-têtes reconnues
          imp.mapping = {};
          const guess = { nom: 'nom', marque: 'marque', categorie: 'categorie', volume: 'volume', 'degre': 'degre', 'degré': 'degre', achat: 'achat', prix: 'achat', stock: 'stock', 'quantite': 'stock', 'quantité': 'stock', fournisseur: 'fournisseur' };
          data.columns.forEach((col) => {
            const h = col.header.toLowerCase();
            imp.mapping[col.key] = Object.keys(guess).find((g) => h.includes(g)) ? guess[Object.keys(guess).find((g) => h.includes(g))] : '';
          });
          repaint();
        } catch (e) {
          alert(`Fichier illisible : ${e.message}`);
        }
      });
    }
    card.querySelectorAll('[data-imp-map]').forEach((s) =>
      s.addEventListener('change', () => { imp.mapping[s.dataset.impMap] = s.value; })
    );
    const lieuSel = card.querySelector('[data-imp-lieu]');
    if (lieuSel) lieuSel.addEventListener('change', () => { imp.lieu = Number(lieuSel.value); });
    const catSel = card.querySelector('[data-imp-cat]');
    if (catSel) catSel.addEventListener('change', () => { imp.cat = Number(catSel.value); });
    const cancel = card.querySelector('[data-imp-cancel]');
    if (cancel) cancel.addEventListener('click', () => { imp.step = 'idle'; imp.data = null; repaint(); });
    const reset = card.querySelector('[data-imp-reset]');
    if (reset) reset.addEventListener('click', () => { imp.step = 'idle'; imp.result = null; render(el); });
    const apply = card.querySelector('[data-imp-apply]');
    if (apply) apply.addEventListener('click', async () => {
      const mapping = Object.fromEntries(
        Object.entries(imp.mapping).filter(([, v]) => v)
      );
      try {
        imp.result = await apiSend('POST', '/api/import/apply', {
          token: imp.data.token,
          mapping,
          location_id: imp.lieu,
          categorie_id: imp.cat,
        });
        imp.step = 'done';
        await render(el);
      } catch (e) {
        alert(`Import impossible : ${e.message}`);
      }
    });
  }

  function repaint() {
    card.innerHTML = importCard();
    bindImportCard();
  }

  bindImportCard();
}
