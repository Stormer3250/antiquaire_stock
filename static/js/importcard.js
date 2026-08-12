// Carte d'import .xlsx/.csv partagée (Cave & seuils + Références).
// Références seules OU références + stock : le lieu n'est demandé que si une
// colonne « Quantité en stock » est mappée.

import { apiSend } from './api.js';
import { esc, alertModal } from './ui.js';
import { S } from './app.js';

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

const HEADER_GUESS = {
  nom: 'nom', marque: 'marque', categorie: 'categorie', 'catégorie': 'categorie',
  volume: 'volume', vol: 'volume', degre: 'degre', 'degré': 'degre',
  achat: 'achat', prix: 'achat', stock: 'stock', quantite: 'stock', 'quantité': 'stock',
  fournisseur: 'fournisseur',
};

// un seul import en cours à la fois — l'état survit aux re-rendus et aux deux surfaces
const imp = {
  step: 'idle', data: null, mapping: {}, lieu: null, cat: null, result: null,
  createCats: false,
};

function stockMapped() {
  return Object.values(imp.mapping).includes('stock');
}

function cardHtml() {
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
        ${stockMapped()
          ? `<div class="field grow"><div class="mono-label">Stock compté sur</div>
              <select class="input" data-imp-lieu>
                ${S.meta.locations.map((l) => `<option value="${l.id}" ${imp.lieu === l.id ? 'selected' : ''}>${esc(l.nom)}</option>`).join('')}
              </select></div>`
          : `<div class="field grow"><div class="mono-label">Stock</div>
              <div style="font-size:12px; color:var(--mut2); padding:8px 0;" class="pretty">
                Aucune colonne de stock mappée : import des références seulement,
                les quantités ne bougent pas.</div></div>`}
        <div class="field grow"><div class="mono-label">Catégorie des nouveautés</div>
          <select class="input" data-imp-cat>
            ${S.meta.categories.filter((c) => c.nom !== 'Consommable').map((c) => `<option value="${c.id}" ${imp.cat === c.id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}
          </select></div>
      </div>
      <label class="cc-switch">
        <input type="checkbox" data-imp-createcats ${imp.createCats ? 'checked' : ''}>
        <span class="piste"></span>
        <span class="txt">Créer les catégories inconnues (sinon leurs lignes sont ignorées)</span>
      </label>
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
        ${r.created} créée${r.created > 1 ? 's' : ''}.${r.stock_written
          ? ' Quantités reprises et prix conseillés recalculés.'
          : ' Quantités inchangées (import de références).'}</div>
      ${r.errors.length
        ? `<div style="font-size:12px; color:var(--red2);" class="pretty">${r.errors.length} ligne(s) ignorée(s) :<br>${r.errors.slice(0, 6).map(esc).join('<br>')}</div>`
        : ''}
      <button class="btn" data-imp-reset>Nouvel import</button>
    </div>`;
  }
  return `
  <div style="padding:22px 18px; display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center;">
    <div style="font-size:13px; color:var(--mut);" class="pretty">Déposez un .xlsx ou .csv —
      catalogue de références seul, ou avec une colonne de quantités en stock.</div>
    <label class="btn-solid" style="cursor:pointer;">
      Choisir un fichier
      <input type="file" accept=".xlsx,.xls,.csv" data-imp-file style="display:none;">
    </label>
    <div class="num" style="font-size:11px; color:var(--mut2);">
      Modèle prêt à remplir :
      <a href="/api/import/template?format=xlsx" download>.xlsx</a> ·
      <a href="/api/import/template?format=csv" download>.csv</a>
    </div>
  </div>`;
}

// Monte la carte dans `container` ; onApplied() est appelé après chaque import réussi.
export function mountImportCard(container, { onApplied } = {}) {
  // Un seul chemin pour le bouton Parcourir et pour le fichier déposé.
  async function handleFile(chosen) {
    const fd = new FormData();
    fd.append('file', chosen);
    try {
      const data = await apiSend('POST', '/api/import/inspect', fd);
      imp.step = 'mapping';
      imp.data = data;
      imp.lieu = S.lieu !== 'tous' ? S.lieu : S.meta.locations[0]?.id;
      imp.cat = S.meta.categories[0]?.id;
      imp.mapping = {};
      data.columns.forEach((col) => {
        const h = col.header.toLowerCase();
        const hit = Object.keys(HEADER_GUESS).find((g) => h.includes(g));
        imp.mapping[col.key] = hit ? HEADER_GUESS[hit] : '';
      });
      repaint();
    } catch (e) {
      await alertModal({ title: 'Fichier illisible', body: e.message });
    }
  }

  function bind() {
    const file = container.querySelector('[data-imp-file]');
    if (file) {
      file.addEventListener('change', () => {
        if (file.files.length) handleFile(file.files[0]);
      });
      // Glisser-déposer sur toute la carte : même chemin que le bouton.
      ['dragenter', 'dragover'].forEach((ev) =>
        container.addEventListener(ev, (e) => {
          e.preventDefault();
          container.classList.add('drop-hot');
        })
      );
      ['dragleave', 'drop'].forEach((ev) =>
        container.addEventListener(ev, (e) => {
          e.preventDefault();
          container.classList.remove('drop-hot');
        })
      );
      container.addEventListener('drop', (e) => {
        const dropped = e.dataTransfer.files[0];
        if (dropped) handleFile(dropped);
      });
    }
    container.querySelectorAll('[data-imp-map]').forEach((s) =>
      s.addEventListener('change', () => {
        imp.mapping[s.dataset.impMap] = s.value;
        repaint();  // le sélecteur de lieu apparaît/disparaît avec la colonne stock
      })
    );
    const lieuSel = container.querySelector('[data-imp-lieu]');
    if (lieuSel) lieuSel.addEventListener('change', () => { imp.lieu = Number(lieuSel.value); });
    const catSel = container.querySelector('[data-imp-cat]');
    if (catSel) catSel.addEventListener('change', () => { imp.cat = Number(catSel.value); });
    const createCats = container.querySelector('[data-imp-createcats]');
    if (createCats) createCats.addEventListener('change', () => { imp.createCats = createCats.checked; });
    const cancel = container.querySelector('[data-imp-cancel]');
    if (cancel) cancel.addEventListener('click', () => { imp.step = 'idle'; imp.data = null; repaint(); });
    const reset = container.querySelector('[data-imp-reset]');
    if (reset) reset.addEventListener('click', () => { imp.step = 'idle'; imp.result = null; repaint(); });
    const apply = container.querySelector('[data-imp-apply]');
    if (apply) apply.addEventListener('click', async () => {
      const mapping = Object.fromEntries(Object.entries(imp.mapping).filter(([, v]) => v));
      try {
        const result = await apiSend('POST', '/api/import/apply', {
          token: imp.data.token,
          mapping,
          location_id: imp.lieu,
          categorie_id: imp.cat,
          create_categories: imp.createCats,
        });
        imp.result = { ...result, stock_written: stockMapped() };
        imp.step = 'done';
        repaint();
        if (onApplied) await onApplied();
      } catch (e) {
        await alertModal({ title: 'Import impossible', body: e.message });
      }
    });
  }

  function repaint() {
    container.innerHTML = cardHtml();
    bind();
  }

  repaint();
}
