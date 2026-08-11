// Menus & tarifications : regrouper des fiches, tenir plusieurs listes de prix sur les
// mêmes recettes, et dire laquelle est celle qu'on pratique.

import { apiGet, apiSend } from '../api.js';
import { esc, eur, num, pc, confirmModal, alertModal, openModal, closeModal } from '../ui.js';
import { S } from '../app.js';
import { renderTable, bindTable, tableState } from '../table.js';

let selMenu = null;    // menu ouvert
let selTarif = null;   // tarification affichée dans la colonne des prix
const T = 'menu-fiches';

function kpisHtml(k, pr) {
  if (!k || !k.n) {
    return `<div class="empty-note">Aucune fiche dans ce menu pour l’instant.</div>`;
  }
  const cases = [
    ['Fiches', String(k.n), ''],
    ['Marge moyenne', pc(k.marge_moyenne, 1), `cible ${pc(pr.cible)}`],
    ['Prix moyen', eur(k.prix_moyen), `coût matière ${eur(k.cout_moyen)}`],
    ['Écart cher / pas cher', eur(k.ecart), `${eur(k.prix_mini)} à ${eur(k.prix_maxi)}`],
  ];
  return `
    <div class="menu-kpis">
      ${cases.map(([l, v, n]) => `
        <div class="kpi">
          <div class="mono-label">${esc(l)}</div>
          <div class="kpi-value">${v}</div>
          <div class="kpi-note">${esc(n)}</div>
        </div>`).join('')}
    </div>
    ${k.sous_plancher
      ? `<div class="menu-alert">${k.sous_plancher} fiche${k.sous_plancher > 1 ? 's' : ''}
          sous le plancher de ${pc(pr.min)}.</div>`
      : ''}`;
}

export async function render(el) {
  const data = await apiGet('/api/menus');
  const menus = data.menus;
  const pr = S.meta.pricing;
  const menu = menus.find((m) => m.id === selMenu) || menus[0] || null;
  selMenu = menu ? menu.id : null;

  const tarifs = menu ? menu.tarifs : [];
  const actif = tarifs.find((t) => t.actif) || null;
  let tarif = tarifs.find((t) => t.id === selTarif) || actif || tarifs[0] || null;
  selTarif = tarif ? tarif.id : null;

  const rafraichir = () => render(el);

  // ---------- colonne des menus ----------

  const menusHtml = `
  <div class="panel">
    <div style="padding:14px 18px; border-bottom:1px solid var(--line);" class="mono-label">
      Menus · ${menus.length}</div>
    ${menus.map((m) => `
    <div class="row" style="border-left:2px solid ${menu && m.id === menu.id ? 'var(--ac)' : 'transparent'};
      border-bottom:1px solid var(--line2); background:${menu && m.id === menu.id ? 'var(--panel2)' : 'transparent'}; gap:0;">
      <button data-menu="${m.id}" style="flex:1; min-width:0; text-align:left; padding:13px 8px 13px 16px;
        background:transparent; border:none; color:${menu && m.id === menu.id ? 'var(--ink)' : 'var(--mut)'};
        font-family:var(--sans); cursor:pointer;">
        <div style="font-size:13.5px;">${esc(m.nom)}</div>
        <div class="num" style="margin-top:3px; font-size:11px; color:${menu && m.id === menu.id ? 'var(--ac)' : 'var(--mut3)'};">
          ${m.kpis.n || 0} fiche${(m.kpis.n || 0) > 1 ? 's' : ''}${m.kpis.n ? ` · marge ${pc(m.kpis.marge_moyenne)}` : ''}</div>
      </button>
      <button class="icon-btn danger" data-del-menu="${m.id}" style="margin-right:10px; background:transparent;"
        aria-label="Supprimer">×</button>
    </div>`).join('')}
    <button data-new-menu style="display:block; width:100%; padding:13px 18px; background:transparent; border:none;
      color:var(--ac); text-align:left; font-family:var(--mono); font-size:11px; letter-spacing:.1em;
      text-transform:uppercase; cursor:pointer;">+ Nouveau menu</button>
  </div>`;

  if (!menu) {
    el.innerHTML = `
    <div style="display:grid; grid-template-columns:266px 1fr; gap:18px; align-items:start;">
      ${menusHtml}
      <div class="panel"><div class="empty-note">Créez un menu pour regrouper des fiches et
        leur poser une ou plusieurs tarifications.</div></div>
    </div>`;
    lierMenus(el, menus, rafraichir);
    return;
  }

  // ---------- table des fiches du menu ----------

  const prixDe = (c) => (tarif && tarif.prix[String(c.id)] !== undefined
    ? tarif.prix[String(c.id)]
    : c.prix_ttc);

  // La marge affichée suit le prix de la tarification consultée, pas celui pratiqué :
  // c'est tout l'intérêt de regarder une tarification qui n'est pas encore active.
  const margeDe = (c) => {
    const ht = prixDe(c) / 1.2;
    return ht > 0 ? ((ht - c.cost) / ht) * 100 : 0;
  };

  const spec = {
    id: T,
    defaultSort: 'nom',
    grid: '2fr .9fr .8fr .8fr .8fr 40px',
    select: true,
    rows: menu.cocktails,
    accessors: { prix_ttc: prixDe, marge: margeDe },
    columns: [
      {
        key: 'nom',
        label: 'Fiche',
        cell: (c) => `<div class="cell-main"><div class="nom">${esc(c.nom)}</div>
          <div class="sub">${esc(c.famille || '')}${c.prix_fixe ? ' · prix figé' : ''}</div></div>`,
      },
      {
        key: 'cost',
        label: 'Coût matière',
        align: 'r',
        cell: (c) => `<div class="num r" style="font-size:12.5px; color:var(--mut);">${eur(c.cost)}</div>`,
      },
      {
        key: 'prix_ttc',
        label: 'Prix TTC',
        align: 'r',
        cell: (c) => `<input class="input num" data-prix="${c.id}" value="${num(prixDe(c), 2)}"
          aria-label="Prix de ${esc(c.nom)}" style="max-width:96px; justify-self:end;"
          ${c.prix_fixe ? 'title="Prix figé sur la fiche"' : ''}>`,
      },
      {
        key: 'marge',
        label: 'Marge',
        align: 'r',
        cell: (c) => {
          const m = margeDe(c);
          return `<div class="num r" style="font-size:12.5px;"><span class="${m >= pr.min ? 'ok-text' : 'warn-text'}">${pc(m, 1)}</span></div>`;
        },
      },
      {
        key: 'marge_cible',
        label: 'Cible',
        align: 'r',
        cell: (c) => `<div class="num r" style="font-size:11.5px; color:var(--mut3);">${pc(c.marge_cible)}${c.marge_custom ? ' ·' : ''}</div>`,
      },
      {
        key: 'retirer',
        label: '',
        sortable: false,
        cell: (c) => `<button class="icon-btn danger" data-retirer="${c.id}"
          aria-label="Retirer du menu" title="Retirer du menu">×</button>`,
      },
    ],
    summary: (picked) => {
      const moy = (f) => picked.reduce((a, x) => a + f(x), 0) / picked.length;
      const prix = picked.map(prixDe);
      return `
      <div class="sum-figs">
        <span class="sum-count">${picked.length} retenue${picked.length > 1 ? 's' : ''}</span>
        <span>Marge moyenne <b class="num">${pc(moy(margeDe), 1)}</b></span>
        <span>Prix moyen <b class="num">${eur(moy(prixDe))}</b></span>
        <span>Coût matière moyen <b class="num">${eur(moy((x) => x.cost))}</b></span>
        <span>Écart <b class="num">${eur(Math.max(...prix) - Math.min(...prix))}</b></span>
      </div>
      <div class="row"><button class="btn muted" data-unpick>Tout décocher</button></div>`;
    },
    bindSummary: (bar) => {
      bar.querySelector('[data-unpick]').addEventListener('click', () => {
        tableState(T).selected.clear();
        rafraichir();
      });
    },
    empty: `<div class="empty-note">Ce menu ne contient aucune fiche. Ajoutez-en avec
      « + Ajouter des fiches ».</div>`,
  };

  // ---------- colonne des tarifications ----------

  const tarifsHtml = `
  <div class="panel">
    <div class="panel-head">
      <div class="serif-title">Tarifications</div>
      <button class="btn" data-new-tarif>+ Nouvelle</button>
    </div>
    ${tarifs.length === 0
      ? `<div class="empty-note">Aucune tarification : le menu applique le prix propre à
          chaque fiche. Créez-en une pour poser une grille de prix.</div>`
      : tarifs.map((t) => `
      <div class="tarif-row ${t.id === selTarif ? 'on' : ''}">
        <button data-tarif="${t.id}" class="tarif-pick">
          <div class="row" style="gap:8px; align-items:baseline;">
            <span style="font-size:13.5px;">${esc(t.nom)}</span>
            ${t.actif ? '<span class="chip-actif">APPLIQUÉE</span>' : ''}
          </div>
          <div class="num" style="margin-top:3px; font-size:11px; color:var(--mut3);">
            créée le ${esc(t.created_at.slice(0, 10))} · ${Object.keys(t.prix).length} prix</div>
        </button>
        <div class="tarif-actions">
          ${t.actif ? '' : `<button class="icon-btn" data-activer="${t.id}" title="Appliquer cette tarification">APPL</button>`}
          <button class="icon-btn" data-dupliquer="${t.id}" title="Dupliquer">DUP</button>
          <button class="icon-btn" data-renommer="${t.id}" title="Renommer">REN</button>
          <button class="icon-btn danger" data-del-tarif="${t.id}" title="Supprimer">×</button>
        </div>
      </div>`).join('')}
    ${tarifs.length > 1
      ? `<div style="padding:12px 18px; border-top:1px solid var(--line);">
          <button class="btn" data-comparer style="width:100%;">Comparer deux tarifications</button>
        </div>`
      : ''}
  </div>`;

  el.innerHTML = `
  <div style="display:grid; grid-template-columns:266px 1fr 300px; gap:18px; align-items:start;">
    ${menusHtml}
    <div class="stack" style="gap:16px;">
      <div class="panel" style="padding:18px 20px; display:flex; flex-direction:column; gap:14px;">
        <input class="input" data-menu-nom value="${esc(menu.nom)}"
          style="font-family:var(--serif); font-size:24px; padding:6px 9px;">
        ${kpisHtml(menu.kpis, pr)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div class="serif-title">Fiches du menu</div>
          <div class="row" style="gap:9px; align-items:center;">
            <span class="mono-label" style="color:var(--mut3);">
              ${tarif ? `prix de « ${esc(tarif.nom)} »${tarif.actif ? '' : ', non appliquée'}` : 'prix propres aux fiches'}</span>
            <button class="btn" data-ajouter>+ Ajouter des fiches</button>
          </div>
        </div>
        <div data-fiches></div>
      </div>
    </div>
    ${tarifsHtml}
  </div>`;

  lierMenus(el, menus, rafraichir);

  const fichesEl = el.querySelector('[data-fiches]');
  renderTable(fichesEl, spec);
  bindTable(fichesEl, spec, rafraichir);

  el.querySelector('[data-menu-nom]').addEventListener('blur', async (e) => {
    const v = e.target.value.trim();
    if (v && v !== menu.nom) {
      await apiSend('PATCH', `/api/menus/${menu.id}`, { nom: v });
      await rafraichir();
    }
  });

  // prix : écrit dans la tarification consultée, ou sur la fiche s'il n'y en a aucune
  fichesEl.querySelectorAll('[data-prix]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    inp.addEventListener('blur', async () => {
      const cid = Number(inp.dataset.prix);
      const v = parseFloat(inp.value.replace(',', '.'));
      if (Number.isNaN(v)) { await rafraichir(); return; }
      const c = menu.cocktails.find((x) => x.id === cid);
      if (Math.abs(v - prixDe(c)) < 0.005) return;
      if (tarif) await apiSend('PATCH', `/api/tarifs/${tarif.id}`, { prix: { [cid]: v } });
      else await apiSend('PATCH', `/api/cocktails/${cid}`, { prix_ttc: v });
      await rafraichir();
    });
  });

  fichesEl.querySelectorAll('[data-retirer]').forEach((b) =>
    b.addEventListener('click', async () => {
      const reste = menu.cocktails.filter((c) => c.id !== Number(b.dataset.retirer));
      await apiSend('PATCH', `/api/menus/${menu.id}`, { cocktail_ids: reste.map((c) => c.id) });
      await rafraichir();
    })
  );

  el.querySelector('[data-ajouter]').addEventListener('click', () =>
    ajouterFiches(menu, data.hors_menu, rafraichir)
  );

  // ---------- tarifications ----------

  el.querySelectorAll('[data-tarif]').forEach((b) =>
    b.addEventListener('click', () => { selTarif = Number(b.dataset.tarif); rafraichir(); })
  );
  el.querySelector('[data-new-tarif]').addEventListener('click', async () => {
    const r = await apiSend('POST', `/api/menus/${menu.id}/tarifs`, { nom: 'Nouvelle tarification' });
    selTarif = r.id;
    await rafraichir();
  });
  el.querySelectorAll('[data-activer]').forEach((b) =>
    b.addEventListener('click', async () => {
      await apiSend('PATCH', `/api/tarifs/${b.dataset.activer}`, { actif: true });
      selTarif = Number(b.dataset.activer);
      await rafraichir();
    })
  );
  el.querySelectorAll('[data-dupliquer]').forEach((b) =>
    b.addEventListener('click', async () => {
      const src = tarifs.find((t) => t.id === Number(b.dataset.dupliquer));
      const r = await apiSend('POST', `/api/menus/${menu.id}/tarifs`, {
        nom: `${src.nom} (copie)`,
        from_tarif_id: src.id,
      });
      selTarif = r.id;
      await rafraichir();
    })
  );
  el.querySelectorAll('[data-renommer]').forEach((b) =>
    b.addEventListener('click', () => {
      const t = tarifs.find((x) => x.id === Number(b.dataset.renommer));
      renommer(t, rafraichir);
    })
  );
  el.querySelectorAll('[data-del-tarif]').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = tarifs.find((x) => x.id === Number(b.dataset.delTarif));
      const ok = await confirmModal({
        title: `Supprimer « ${t.nom} » ?`,
        body: t.actif
          ? 'C’est la tarification appliquée : les fiches reviendront à leur prix propre.'
          : 'Ses prix seront perdus. Les autres tarifications ne bougent pas.',
      });
      if (!ok) return;
      await apiSend('DELETE', `/api/tarifs/${t.id}`);
      selTarif = null;
      await rafraichir();
    })
  );
  el.querySelector('[data-comparer]')?.addEventListener('click', () =>
    comparer(menu, tarifs, pr)
  );
}

// ---------- liaisons communes à la colonne des menus ----------

function lierMenus(el, menus, rafraichir) {
  el.querySelectorAll('[data-menu]').forEach((b) =>
    b.addEventListener('click', () => {
      selMenu = Number(b.dataset.menu);
      selTarif = null;
      tableState('menu-fiches').selected.clear();
      rafraichir();
    })
  );
  el.querySelector('[data-new-menu]').addEventListener('click', async () => {
    const r = await apiSend('POST', '/api/menus', { nom: 'Nouveau menu' });
    selMenu = r.id;
    selTarif = null;
    await rafraichir();
  });
  el.querySelectorAll('[data-del-menu]').forEach((b) =>
    b.addEventListener('click', async () => {
      const m = menus.find((x) => x.id === Number(b.dataset.delMenu));
      const ok = await confirmModal({
        title: `Supprimer le menu « ${m.nom} » ?`,
        body: 'Ses tarifications disparaissent. Les fiches, elles, sont conservées et redeviennent libres.',
      });
      if (!ok) return;
      await apiSend('DELETE', `/api/menus/${m.id}`);
      selMenu = null;
      await rafraichir();
    })
  );
}

// ---------- ajouter des fiches ----------

function ajouterFiches(menu, libres, rafraichir) {
  if (!libres.length) {
    alertModal({
      title: 'Aucune fiche disponible',
      body: 'Toutes les fiches appartiennent déjà à un menu. Retirez-en une de son menu, ou créez une nouvelle fiche depuis Cartes & recettes.',
    });
    return;
  }
  const modal = openModal(`
    <div class="modal-head">
      <div class="serif-title">Ajouter des fiches</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body" style="max-height:52vh; overflow:auto; display:flex; flex-direction:column; gap:2px;">
      ${libres.map((c) => `
      <label class="row" style="gap:10px; padding:8px 4px; cursor:pointer; border-bottom:1px solid var(--line2);">
        <input type="checkbox" data-add="${c.id}" style="accent-color:var(--ac);">
        <span style="flex:1; font-size:13px;">${esc(c.nom)}</span>
        <span class="num" style="font-size:12px; color:var(--mut3);">${eur(c.prix_ttc)}</span>
      </label>`).join('')}
    </div>
    <div class="modal-foot">
      <div class="modal-hint">Seules les fiches n’appartenant à aucun menu sont proposées.</div>
      <div class="row">
        <button class="btn muted" data-cancel>Annuler</button>
        <button class="btn-solid" data-ok>Ajouter</button>
      </div>
    </div>`, { width: 480 });

  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
  modal.querySelector('[data-ok]').addEventListener('click', async () => {
    const ids = [...modal.querySelectorAll('[data-add]:checked')].map((n) => Number(n.dataset.add));
    closeModal();
    if (!ids.length) return;
    await apiSend('PATCH', `/api/menus/${menu.id}`, {
      cocktail_ids: [...menu.cocktails.map((c) => c.id), ...ids],
    });
    await rafraichir();
  });
}

function renommer(tarif, rafraichir) {
  const modal = openModal(`
    <div class="modal-head">
      <div class="serif-title">Renommer la tarification</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
      <div class="field"><div class="mono-label">Nom</div>
        <input class="input" data-nom value="${esc(tarif.nom)}"></div>
      <div class="field"><div class="mono-label">Note</div>
        <input class="input" data-note value="${esc(tarif.note)}"
          placeholder="ex. saison, happy hour, essai"></div>
    </div>
    <div class="modal-foot">
      <div class="modal-hint"></div>
      <div class="row">
        <button class="btn muted" data-cancel>Annuler</button>
        <button class="btn-solid" data-ok>Enregistrer</button>
      </div>
    </div>`, { width: 420 });
  modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
  modal.querySelector('[data-ok]').addEventListener('click', async () => {
    const nom = modal.querySelector('[data-nom]').value.trim() || tarif.nom;
    const note = modal.querySelector('[data-note]').value.trim();
    closeModal();
    await apiSend('PATCH', `/api/tarifs/${tarif.id}`, { nom, note });
    await rafraichir();
  });
}

// ---------- comparer ----------

function comparer(menu, tarifs, pr) {
  let a = tarifs[0].id;
  let b = tarifs[1].id;

  const prixDans = (t, c) => (t.prix[String(c.id)] !== undefined ? t.prix[String(c.id)] : c.prix_ttc);
  const margeDans = (t, c) => {
    const ht = prixDans(t, c) / 1.2;
    return ht > 0 ? ((ht - c.cost) / ht) * 100 : 0;
  };
  const moyenne = (t, f) => menu.cocktails.reduce((s, c) => s + f(t, c), 0) / (menu.cocktails.length || 1);

  function html() {
    const ta = tarifs.find((t) => t.id === a);
    const tb = tarifs.find((t) => t.id === b);
    const opts = (sel) => tarifs.map((t) =>
      `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.nom)}${t.actif ? ' (appliquée)' : ''}</option>`).join('');
    const lignes = menu.cocktails.map((c) => {
      const pa = prixDans(ta, c);
      const pb = prixDans(tb, c);
      const d = pb - pa;
      return `
      <div class="cmp-row">
        <div class="cell-main"><div class="nom">${esc(c.nom)}</div>
          <div class="sub">coût ${eur(c.cost)}</div></div>
        <div class="num r">${eur(pa)}<span class="cmp-marge">${pc(margeDans(ta, c), 1)}</span></div>
        <div class="num r">${eur(pb)}<span class="cmp-marge">${pc(margeDans(tb, c), 1)}</span></div>
        <div class="num r ${d > 0 ? 'ok-text' : d < 0 ? 'warn-text' : ''}">${d === 0 ? '—' : (d > 0 ? '+' : '') + eur(d)}</div>
      </div>`;
    }).join('');
    const bilan = (t) => `${pc(moyenne(t, margeDans), 1)} · ${eur(moyenne(t, prixDans))}`;
    return `
    <div class="modal-head">
      <div class="serif-title">Comparer deux tarifications</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
      <div class="cmp-row cmp-head">
        <div></div>
        <div><select class="input" data-a>${opts(a)}</select></div>
        <div><select class="input" data-b>${opts(b)}</select></div>
        <div class="mono-label r">Écart</div>
      </div>
      <div style="max-height:46vh; overflow:auto;">${lignes || '<div class="empty-note">Menu vide.</div>'}</div>
      <div class="cmp-row cmp-foot">
        <div class="mono-label">Marge moyenne · prix moyen</div>
        <div class="num r">${bilan(ta)}</div>
        <div class="num r">${bilan(tb)}</div>
        <div class="num r">${pc(moyenne(tb, margeDans) - moyenne(ta, margeDans), 1)}</div>
      </div>
      <div class="sub pretty">Plancher de marge de la maison : ${pc(pr.min)}.</div>
    </div>`;
  }

  function monte() {
    const modal = openModal(html(), { width: 720 });
    modal.querySelector('[data-a]').addEventListener('change', (e) => { a = Number(e.target.value); monte(); });
    modal.querySelector('[data-b]').addEventListener('change', (e) => { b = Number(e.target.value); monte(); });
  }
  monte();
}
