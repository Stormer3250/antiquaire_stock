// Configuration : politique de prix, catégories, référentiels, lieux, sauvegardes.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, parseNum, confirmModal, alertModal } from '../ui.js';
import { S, reloadMeta, refresh } from '../app.js';

const REGIMES = [
  { value: 'spiritueux', label: 'Spiritueux · accise hL AP' },
  { value: 'vin', label: 'Vin tranquille' },
  { value: 'mousseux', label: 'Vin mousseux' },
  { value: 'biere', label: 'Bière · au degré' },
  { value: 'intermediaire', label: 'Produit intermédiaire' },
  { value: 'aucun', label: 'Sans alcool · non soumis' },
];

const PRICING_FIELDS = [
  { key: 'cible', k: 'Marge cible moyenne', unit: '%', n: 'appliquée par défaut à toutes les catégories', d: 0 },
  { key: 'min', k: 'Marge plancher', unit: '%', n: 'sous ce seuil, le prix passe en alerte', d: 0 },
  { key: 'arrondi', k: 'Arrondi commercial', unit: '€', n: 'pas d’arrondi du prix TTC affiché à la carte', d: 2 },
];

const LISTS = [
  { key: 'fournisseurs', title: 'Fournisseurs', note: 'Proposés à la création d’une référence et à l’import.' },
  { key: 'familles', title: 'Familles de carte', note: 'Classement des fiches cocktails.' },
  { key: 'verres', title: 'Verrerie', note: 'Proposée sur chaque fiche cocktail.' },
  { key: 'unites', title: 'Unités des non suivies', note: 'Branche, trait, zeste, pincée… pour les garnitures.' },
];

export async function render(el) {
  const backups = (await apiGet('/api/backups')).backups;
  const pr = S.meta.pricing;

  const CGRID = 'grid-template-columns:1.4fr .8fr 1.4fr .8fr .8fr .4fr;';

  el.innerHTML = `
  <div class="stack" style="gap:18px;">
    <div class="panel">
      <div class="panel-head"><div class="serif-title">Politique de prix</div></div>
      <div style="display:grid; grid-template-columns:repeat(3,1fr);">
        ${PRICING_FIELDS.map((f) => `
        <div style="padding:18px 20px; border-right:1px solid var(--line2); display:flex; flex-direction:column; gap:9px;">
          <div class="mono-label" style="color:var(--mut2);">${esc(f.k)}</div>
          <div class="row" style="gap:9px;">
            <input class="input num" data-pricing="${f.key}" value="${num(pr[f.key], f.d)}"
              style="width:88px; font-size:15px;" aria-label="${esc(f.k)}">
            <span class="num" style="font-size:11px; color:var(--mut2);">${f.unit}</span>
          </div>
          <div class="sub pretty">${esc(f.n)}</div>
        </div>`).join('')}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div class="serif-title">Catégories de produits</div>
        <button class="btn" data-cat-add>+ Catégorie</button>
      </div>
      <div class="thead" style="${CGRID}">
        <div>Nom</div><div class="c">Dose (cl)</div><div>Régime fiscal</div>
        <div class="c">Marge %</div><div class="c">TVA %</div><div></div>
      </div>
      ${S.meta.categories.map((c) => `
      <div class="trow" style="${CGRID} padding:10px 20px;">
        <input class="input" data-cat-nom="${c.id}" value="${esc(c.nom)}">
        <input class="input num" data-cat-dose="${c.id}" value="${num(c.dose_cl, 0)}">
        <select class="input" data-cat-regime="${c.id}">
          ${REGIMES.map((r) => `<option value="${r.value}" ${r.value === c.regime ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select>
        <input class="input num" data-cat-marge="${c.id}" value="${num(c.marge_pct, 0)}">
        <select class="input" data-cat-tva="${c.id}">
          ${[20, 10, 5.5].map((t) => `<option value="${t}" ${t === c.tva_pct ? 'selected' : ''}>${num(t, t % 1 ? 1 : 0)} %</option>`).join('')}
        </select>
        <button class="icon-btn danger" data-cat-del="${c.id}" style="justify-self:end;" aria-label="Supprimer">×</button>
      </div>`).join('')}
      <div class="panel-foot"><span class="pretty">La dose définit le service au verre ;
        le régime pilote la part fiscale ; marge et TVA nourrissent le prix conseillé.</span></div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:18px;">
      <div class="panel" style="display:flex; flex-direction:column;">
        <div class="panel-head" style="padding:14px 18px;">
          <div class="serif-title" style="font-size:16px;">Lieux de stockage</div>
          <button class="btn" data-lieu-add style="padding:4px 10px; font-size:10px;">+ Ajouter</button>
        </div>
        ${S.meta.locations.map((l) => `
        <div class="row" style="padding:9px 18px; border-bottom:1px solid var(--line2);">
          <input class="input grow" data-lieu-nom="${l.id}" value="${esc(l.nom)}">
          <button class="icon-btn danger" data-lieu-del="${l.id}" aria-label="Supprimer">×</button>
        </div>`).join('')}
        <div class="panel-foot"><span class="pretty">Chaque lieu apparaît dans le sélecteur en haut
          de l’écran ; le stock et l’inventaire se tiennent par lieu.</span></div>
      </div>

      ${LISTS.map((l) => `
      <div class="panel" style="display:flex; flex-direction:column;">
        <div class="panel-head" style="padding:14px 18px;">
          <div class="serif-title" style="font-size:16px;">${esc(l.title)}</div>
          <button class="btn" data-list-add="${l.key}" style="padding:4px 10px; font-size:10px;">+ Ajouter</button>
        </div>
        ${S.meta.lists[l.key].map((v, i) => `
        <div class="row" style="padding:9px 18px; border-bottom:1px solid var(--line2);">
          <input class="input grow" data-list-item="${l.key}:${i}" value="${esc(v)}">
          <button class="icon-btn danger" data-list-del="${l.key}:${i}" aria-label="Supprimer">×</button>
        </div>`).join('')}
        <div class="panel-foot"><span class="pretty">${esc(l.note)}</span></div>
      </div>`).join('')}
    </div>

    <div class="panel">
      <div class="panel-head">
        <div class="serif-title">Sauvegardes</div>
        <div class="row" style="gap:9px;">
          <a class="btn muted" href="/api/export" download>Exporter en CSV</a>
          <button class="btn" data-backup-now>Sauvegarder maintenant</button>
        </div>
      </div>
      ${backups.length === 0
        ? `<div class="empty-note">Aucun instantané pour l’instant — la première sauvegarde
            automatique part cette nuit, ou cliquez « Sauvegarder maintenant ».</div>`
        : `<div class="thead" style="grid-template-columns:1fr .6fr .5fr 130px;">
            <div>Instantané</div><div class="r">Date</div><div class="r">Taille</div><div></div>
          </div>
          ${backups.slice(0, 12).map((b) => `
          <div class="trow" style="grid-template-columns:1fr .6fr .5fr 130px; padding:10px 20px;">
            <div class="num" style="font-size:12.5px;">${esc(b.name)}</div>
            <div class="num r" style="font-size:12px; color:var(--mut);">${esc(b.date.replace('T', ' · ').slice(0, 18))}</div>
            <div class="num r" style="font-size:12px; color:var(--mut2);">${num(b.size / 1024, 0)} Ko</div>
            <button class="btn muted" data-restore="${esc(b.name)}" style="justify-self:end; padding:5px 11px; font-size:10px;">Restaurer</button>
          </div>`).join('')}`}
      <div class="panel-foot"><span class="pretty">Sauvegarde automatique chaque nuit dans
        ~/AntiquaireStock/backups — chaque instantané est une base complète, restaurable et
        emportable. Une restauration met d’abord l’état courant de côté.</span></div>
    </div>
  </div>`;

  // ---------- politique de prix ----------

  el.querySelectorAll('[data-pricing]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', async () => {
      const key = inp.dataset.pricing;
      const v = parseNum(inp.value);
      if (v <= 0 || Math.abs(v - pr[key]) < 0.001) return;
      await apiSend('PATCH', '/api/settings', { pricing: { [key]: v } });
      await reloadMeta();
      await refresh();
    });
  });

  // ---------- catégories ----------

  const patchCat = async (id, body) => {
    await apiSend('PATCH', `/api/categories/${id}`, body);
    await reloadMeta();
    await render(el);
  };
  const bindCatInput = (attr, key, numeric) =>
    el.querySelectorAll(`[data-cat-${attr}]`).forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('blur', () => {
        const id = Number(inp.dataset[`cat${attr[0].toUpperCase()}${attr.slice(1)}`]);
        const c = S.meta.categories.find((x) => x.id === id);
        const v = numeric ? parseNum(inp.value) : inp.value.trim();
        if (v !== '' && v !== (numeric ? c[key] : c[key])) patchCat(id, { [key]: v });
      });
    });
  bindCatInput('nom', 'nom', false);
  bindCatInput('dose', 'dose_cl', true);
  bindCatInput('marge', 'marge_pct', true);
  el.querySelectorAll('[data-cat-regime]').forEach((s) =>
    s.addEventListener('change', () => patchCat(Number(s.dataset.catRegime), { regime: s.value }))
  );
  el.querySelectorAll('[data-cat-tva]').forEach((s) =>
    s.addEventListener('change', () => patchCat(Number(s.dataset.catTva), { tva_pct: parseNum(s.value) }))
  );
  el.querySelector('[data-cat-add]').addEventListener('click', async () => {
    await apiSend('POST', '/api/categories', {
      nom: `Nouvelle catégorie ${S.meta.categories.length + 1}`,
      dose_cl: 5, regime: 'aucun', marge_pct: pr.cible, tva_pct: 20,
      position: S.meta.categories.length,
    });
    await reloadMeta();
    await render(el);
  });
  el.querySelectorAll('[data-cat-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const c = S.meta.categories.find((x) => x.id === Number(b.dataset.catDel));
      const ok = await confirmModal({
        title: `Supprimer la catégorie ${c.nom} ?`,
        body: 'Les références rattachées basculeront sur la première catégorie.',
      });
      if (!ok) return;
      try {
        await apiSend('DELETE', `/api/categories/${c.id}`);
      } catch (e) { await alertModal({ title: 'Modification refusée', body: e.message }); }
      await reloadMeta();
      await render(el);
    })
  );

  // ---------- lieux ----------

  el.querySelectorAll('[data-lieu-nom]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', async () => {
      const id = Number(inp.dataset.lieuNom);
      const l = S.meta.locations.find((x) => x.id === id);
      const v = inp.value.trim();
      if (!v || v === l.nom) return;
      await apiSend('PATCH', `/api/locations/${id}`, { nom: v });
      await reloadMeta();
      await refresh();
    });
  });
  el.querySelector('[data-lieu-add]').addEventListener('click', async () => {
    // même geste que les autres listes : la ligne « Nouveau lieu » se renomme sur place
    let nom = 'Nouveau lieu';
    let n = 2;
    while (S.meta.locations.some((l) => l.nom === nom)) nom = `Nouveau lieu ${n++}`;
    try {
      await apiSend('POST', '/api/locations', { nom });
    } catch (e) { await alertModal({ title: 'Modification refusée', body: e.message }); }
    await reloadMeta();
    await refresh();
  });
  el.querySelectorAll('[data-lieu-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const l = S.meta.locations.find((x) => x.id === Number(b.dataset.lieuDel));
      const ok = await confirmModal({
        title: `Supprimer le lieu ${l.nom} ?`,
        body: 'Son historique de mouvements est conservé ; son stock ne compte plus dans les totaux.',
      });
      if (!ok) return;
      try {
        await apiSend('DELETE', `/api/locations/${l.id}`);
        if (S.lieu === l.id) S.lieu = 'tous';
      } catch (e) { await alertModal({ title: 'Modification refusée', body: e.message }); }
      await reloadMeta();
      await refresh();
    })
  );

  // ---------- listes simples ----------

  const saveList = async (key, items) => {
    await apiSend('PATCH', '/api/settings', { lists: { [key]: items } });
    await reloadMeta();
    await render(el);
  };
  el.querySelectorAll('[data-list-item]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', () => {
      const [key, i] = inp.dataset.listItem.split(':');
      const items = [...S.meta.lists[key]];
      const v = inp.value.trim();
      if (!v || v === items[Number(i)]) return;
      items[Number(i)] = v;
      saveList(key, items);
    });
  });
  el.querySelectorAll('[data-list-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const [key, i] = b.dataset.listDel.split(':');
      saveList(key, S.meta.lists[key].filter((_, k) => k !== Number(i)));
    })
  );
  el.querySelectorAll('[data-list-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.listAdd;
      saveList(key, [...S.meta.lists[key], 'Nouveau']);
    })
  );

  // ---------- sauvegardes ----------

  el.querySelector('[data-backup-now]').addEventListener('click', async () => {
    await apiSend('POST', '/api/backups', {});
    await render(el);
  });
  el.querySelectorAll('[data-restore]').forEach((b) =>
    b.addEventListener('click', async () => {
      const name = b.dataset.restore;
      const ok = await confirmModal({
        title: 'Restaurer cet instantané ?',
        body: `La base reviendra à l'état de « ${name} ». L'état actuel est d'abord mis de côté (avant-restauration-…), donc l'opération est annulable.`,
        label: 'Restaurer',
      });
      if (!ok) return;
      await apiSend('POST', `/api/backups/${encodeURIComponent(name)}/restore`, {});
      await reloadMeta();
      await refresh();
    })
  );
}
