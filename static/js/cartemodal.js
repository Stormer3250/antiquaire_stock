// Modale unifiée d'une carte : sa composition d'un côté, ses tarifications de l'autre.
//
// Même moule que fiche.js / recettemodal.js : ouverture → instantané « avant » → écriture
// au fil de l'eau → relecture (`recharge`) → repeinture (`paint`). Il n'y a pas de
// GET /api/menus/:id : on relit la liste et on y cherche la carte, comme l'écran.
//
// Deux nouveautés par rapport aux deux fiches précédentes :
//   - des onglets (`onglet`), conservés par la relecture, comme la tarification consultée ;
//   - des sous-modales EMPILÉES (`stack: true` de ui.js) : ajouter des recettes, renommer,
//     comparer, régler les prix s'ouvrent PAR-DESSUS et laissent la carte en place dessous.
//     Les confirmations et alertes, elles, restent destructrices (elles écrivent tout
//     modal-root) : on pose `dialogue = true` et on rouvre la carte après, comme ailleurs.

import { apiGet, apiSend } from './api.js';
import { esc, eur, num, pc, parseNum, openModal, closeModal, confirmModal, alertModal } from './ui.js';
import { S } from './app.js';
import { renderTable, bindTable, tableState } from './table.js';
import { openOptimiser } from './optimiser.js';

const T = 'carte-recettes';

export async function openCarte(menuId, { onClose } = {}) {
  let recettes = [];      // toutes les recettes, pour « Ajouter des recettes »

  async function chargeMenu() {
    const data = await apiGet('/api/menus');
    recettes = data.recettes;
    return data.menus.find((m) => m.id === menuId) || null;
  }

  let menu;
  try {
    menu = await chargeMenu();
  } catch (e) {
    await alertModal({ title: 'Carte indisponible', body: e.message });
    onClose?.();
    return;
  }
  if (!menu) {
    await alertModal({ title: 'Carte introuvable', body: 'Elle a peut-être été supprimée.' });
    onClose?.();
    return;
  }

  // instantané d'ouverture : ce que « Rétablir » repose, en un seul PATCH.
  // Les actions sur les tarifications (appliquer, régler, dupliquer, renommer, supprimer)
  // sont immédiates, chacune avec sa propre confirmation : elles ne sont PAS couvertes
  // par Rétablir — écart assumé, une grille de prix ne se défait pas par surprise.
  const avant = { nom: menu.nom, cocktail_ids: menu.cocktails.map((c) => c.id) };

  let onglet = 'compo';
  let selTarif = (menu.tarifs.find((t) => t.actif) || menu.tarifs[0] || {}).id ?? null;
  let modal = null;
  let zone = null;
  let ferme = false;
  let dialogue = false;   // une confirmation/alerte occupe la pile : ce n'est pas une fermeture

  const obs = new MutationObserver(() => {
    if (dialogue || ferme || document.querySelector('.modal')) return;
    ferme = true;
    obs.disconnect();
    onClose?.();
  });
  obs.observe(document.getElementById('modal-root'), { childList: true });

  function termine() {
    if (ferme) return;
    ferme = true;
    obs.disconnect();
    closeModal();
    onClose?.();
  }

  // ---------- lecture des prix ----------

  const tarifCourant = () => menu.tarifs.find((t) => t.id === selTarif) || null;

  const prixDe = (c) => {
    const t = tarifCourant();
    return t && t.prix[String(c.id)] !== undefined ? t.prix[String(c.id)] : c.prix_ttc;
  };

  // La marge affichée suit le prix de la tarification consultée, pas celui pratiqué :
  // c'est tout l'intérêt de regarder une tarification qui n'est pas encore active.
  const margeDe = (c) => {
    const ht = prixDe(c) / 1.2;
    return ht > 0 ? ((ht - c.cost) / ht) * 100 : 0;
  };

  // ---------- rendu ----------

  // Les KPI de l'API (menu.kpis) ne connaissent que la tarification APPLIQUÉE : on
  // recalcule ici pour celle qu'on consulte, sinon l'en-tête ment dès qu'on en regarde
  // une autre. Simple présentation, rien n'est écrit.
  function kpisHtml() {
    const cs = menu.cocktails;
    const moy = (f) => cs.reduce((a, x) => a + f(x), 0) / cs.length;
    const prix = cs.map(prixDe);
    const marge = cs.length ? moy(margeDe) : 0;
    const kpis = cs.length
      ? [
        { l: 'Prix moyen', v: eur(moy(prixDe)), t: '' },
        { l: 'Marge moyenne', v: pc(marge), t: marge >= S.meta.pricing.min ? 'ok' : 'warn' },
        { l: 'Min / max', v: `${eur(Math.min(...prix))}–${eur(Math.max(...prix))}`, t: '' },
      ]
      : [
        { l: 'Prix moyen', v: '—', t: '' },
        { l: 'Marge moyenne', v: '—', t: '' },
        { l: 'Min / max', v: '—', t: '' },
      ];
    // un peu plus large que les autres fiches : « 12,00 €–15,00 € » ne doit pas se couper
    return `<div class="bloc-kpis fiche-kpis" style="width:440px;">
      ${kpis.map((k) => `<div class="bloc-kpi">
        <div class="mono-label">${esc(k.l)}</div>
        <div class="kpi-val ${k.t}">${esc(k.v)}</div>
      </div>`).join('')}
    </div>`;
  }

  function tarifSpec() {
    const pr = S.meta.pricing;
    return {
      id: T,
      defaultSort: 'nom',
      grid: '2fr .9fr .8fr .8fr .8fr 40px',
      select: true,
      rows: menu.cocktails,
      accessors: { prix_ttc: prixDe, marge: margeDe },
      columns: [
        {
          key: 'nom',
          label: 'Recette',
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
            ${c.prix_fixe ? 'title="Prix figé sur la recette"' : ''}>`,
        },
        {
          key: 'marge',
          label: 'Marge',
          align: 'r',
          cell: (c) => {
            const m = margeDe(c);
            return `<div class="num r" style="font-size:12.5px;"><span class="${m >= pr.min ? 'ok-text' : 'warn-text'}">${pc(m)}</span></div>`;
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
            aria-label="Retirer de la carte" title="Retirer de la carte">×</button>`,
        },
      ],
      summary: (picked) => {
        const moy = (f) => picked.reduce((a, x) => a + f(x), 0) / picked.length;
        const prix = picked.map(prixDe);
        return `
        <div class="sum-figs">
          <span class="sum-count">${picked.length} retenue${picked.length > 1 ? 's' : ''}</span>
          <span>Marge moyenne <b class="num">${pc(moy(margeDe))}</b></span>
          <span>Prix moyen <b class="num">${eur(moy(prixDe))}</b></span>
          <span>Coût matière moyen <b class="num">${eur(moy((x) => x.cost))}</b></span>
          <span>Écart <b class="num">${eur(Math.max(...prix) - Math.min(...prix))}</b></span>
        </div>
        <div class="row"><button class="btn muted" data-unpick>Tout décocher</button></div>`;
      },
      bindSummary: (bar) => {
        bar.querySelector('[data-unpick]').addEventListener('click', () => {
          tableState(T).selected.clear();
          paint();
        });
      },
      empty: `<div class="empty-note">Cette carte ne contient aucune recette. Ajoutez-en
        avec « + Ajouter des recettes ».</div>`,
    };
  }

  function compositionHtml() {
    const t = tarifCourant();
    return `
    <div class="panel">
      <div class="panel-head">
        <div class="serif-title">Recettes de la carte</div>
        <div class="row" style="gap:9px; align-items:center;">
          ${menu.tarifs.length
            ? `<span class="mono-label" style="color:var(--mut3);">Prix affichés</span>
               <select class="input" data-vue-tarif style="max-width:230px;">
                 ${menu.tarifs.map((x) => `<option value="${x.id}" ${x.id === selTarif ? 'selected' : ''}
                   >${esc(x.nom)}${x.actif ? ' · appliquée' : ''}</option>`).join('')}
               </select>`
            : `<span class="mono-label" style="color:var(--mut3);">prix propres aux recettes</span>`}
          <button class="btn" data-ajouter>+ Ajouter des recettes</button>
        </div>
      </div>
      <div data-fiches></div>
    </div>
    ${t && !t.actif
      ? `<div class="sub pretty" style="padding-top:10px;">« ${esc(t.nom)} » n’est pas appliquée :
          ces prix ne sont pas ceux pratiqués aujourd’hui.</div>`
      : ''}`;
  }

  function tarifsHtml() {
    return `
    <div class="panel">
      <div class="panel-head">
        <div class="serif-title">Tarifications</div>
        <button class="btn" data-new-tarif>+ Nouvelle</button>
      </div>
      ${menu.tarifs.length === 0
        ? `<div class="empty-note">Aucune tarification : la carte applique le prix propre à
            chaque recette. Créez-en une pour poser une grille de prix.</div>`
        : menu.tarifs.map((t) => `
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
            <button class="icon-btn" data-regler="${t.id}" title="Régler les prix sous contraintes">RÉG</button>
            <button class="icon-btn" data-dupliquer="${t.id}" title="Dupliquer">DUP</button>
            <button class="icon-btn" data-renommer="${t.id}" title="Renommer">REN</button>
            <button class="icon-btn danger" data-del-tarif="${t.id}" title="Supprimer">×</button>
          </div>
        </div>`).join('')}
      ${menu.tarifs.length > 1
        ? `<div style="padding:12px 18px; border-top:1px solid var(--line);">
            <button class="btn" data-comparer style="width:100%;">Comparer deux tarifications</button>
          </div>`
        : ''}
    </div>
    <div class="sub pretty" style="padding-top:10px;">Une seule tarification est appliquée à la
      fois : c’est elle qui donne le prix pratiqué. Les autres se regardent et se comparent
      sans rien changer.</div>`;
  }

  function carteHtml() {
    return `
    <div class="fiche-head">
      <div class="fiche-titre">
        <input class="input fiche-nom" data-nom value="${esc(menu.nom)}" aria-label="Nom de la carte">
      </div>
      ${kpisHtml()}
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-tabs">
      <button data-onglet="compo" class="${onglet === 'compo' ? 'active' : ''}">Composition</button>
      <button data-onglet="tarifs" class="${onglet === 'tarifs' ? 'active' : ''}">Tarifications</button>
    </div>
    <div class="fiche-corps">
      <div style="padding:18px 22px 22px;">
        ${onglet === 'compo' ? compositionHtml() : tarifsHtml()}
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn muted" data-restore>Rétablir l’état d’ouverture</button>
      <div class="row" style="gap:9px;">
        <button class="btn muted danger" data-remove>Supprimer la carte</button>
        <button class="btn-solid" data-close>Fermer</button>
      </div>
    </div>`;
  }

  // ---------- écriture ----------

  async function recharge() {
    let frais;
    try {
      frais = await chargeMenu();
    } catch (e) {
      dialogue = true;
      await alertModal({ title: 'Carte indisponible', body: e.message });
      dialogue = false;
      termine();
      return;
    }
    if (!frais) {
      dialogue = true;
      await alertModal({ title: 'Carte introuvable', body: 'Elle a peut-être été supprimée.' });
      dialogue = false;
      termine();
      return;
    }
    menu = frais;
    // la tarification consultée peut avoir disparu : on retombe sur l'appliquée
    if (!menu.tarifs.some((t) => t.id === selTarif)) {
      selTarif = (menu.tarifs.find((t) => t.actif) || menu.tarifs[0] || {}).id ?? null;
    }
    paint();
  }

  async function patchMenu(body) {
    try {
      await apiSend('PATCH', `/api/menus/${menuId}`, body);
    } catch (e) {
      await echec('Enregistrement impossible', e);
    }
    await recharge();
  }

  // Un appel réseau qui échoue laisserait l'écran nu : l'alerte a remplacé la carte dans
  // la pile. On prévient, puis on repose la carte.
  async function echec(titre, e) {
    dialogue = true;
    await alertModal({ title: titre, body: e.message });
    ouvre();
    dialogue = false;
  }

  function paint() {
    zone.innerHTML = carteHtml();
    bind();
  }

  function ouvre() {
    modal = openModal('<div data-fiche></div>', { width: 1080 });
    modal.classList.add('fiche');
    zone = modal.querySelector('[data-fiche]');
    paint();
  }

  async function retablir() {
    dialogue = true;
    const ok = await confirmModal({
      title: 'Revenir à l’état d’ouverture ?',
      body: 'Le nom et la composition reviennent à ce qu’ils étaient. Les tarifications, elles, ne bougent pas : elles ont été modifiées séparément.',
      label: 'Rétablir',
    });
    ouvre();                       // la confirmation a remplacé la carte : on la rouvre
    dialogue = false;
    if (ok) await patchMenu(avant);
  }

  async function supprimer() {
    dialogue = true;
    const ok = await confirmModal({
      title: `Supprimer la carte « ${menu.nom} » ?`,
      body: 'Ses tarifications disparaissent. Les recettes, elles, sont conservées : elles restent sur leurs autres cartes, ou reprennent leur prix propre.',
    });
    if (!ok) { ouvre(); dialogue = false; return; }
    try {
      await apiSend('DELETE', `/api/menus/${menuId}`);
    } catch (e) {
      await echec('Suppression impossible', e);
      return;
    }
    dialogue = false;
    termine();
  }

  // ---------- sous-modales empilées ----------

  async function ajouterFiches() {
    const libres = recettes.filter((c) => !menu.cocktails.some((x) => x.id === c.id));
    if (!libres.length) {
      dialogue = true;
      await alertModal({
        title: 'Aucune recette disponible',
        body: 'Toutes les recettes figurent déjà sur cette carte. Créez-en une nouvelle depuis l’écran Recettes.',
      });
      ouvre();
      dialogue = false;
      return;
    }
    const sous = openModal(`
      <div class="modal-head">
        <div class="serif-title">Ajouter des recettes</div>
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
        <div class="modal-hint">Une recette peut figurer sur plusieurs cartes : seules celles déjà sur celle-ci sont masquées.</div>
        <div class="row">
          <button class="btn muted" data-cancel>Annuler</button>
          <button class="btn-solid" data-ok>Ajouter</button>
        </div>
      </div>`, { width: 480, stack: true });

    sous.querySelector('[data-cancel]').addEventListener('click', closeModal);
    sous.querySelector('[data-ok]').addEventListener('click', async () => {
      const ids = [...sous.querySelectorAll('[data-add]:checked')].map((n) => Number(n.dataset.add));
      closeModal();
      if (!ids.length) return;
      await patchMenu({ cocktail_ids: [...menu.cocktails.map((c) => c.id), ...ids] });
    });
  }

  function renommer(tarif) {
    const sous = openModal(`
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
      </div>`, { width: 420, stack: true });
    sous.querySelector('[data-cancel]').addEventListener('click', closeModal);
    sous.querySelector('[data-ok]').addEventListener('click', async () => {
      const nom = sous.querySelector('[data-nom]').value.trim() || tarif.nom;
      const note = sous.querySelector('[data-note]').value.trim();
      closeModal();
      await patchTarif(tarif.id, { nom, note });
    });
  }

  function comparer() {
    const pr = S.meta.pricing;
    const tarifs = menu.tarifs;
    let a = tarifs[0].id;
    let b = tarifs[1].id;
    let posee = false;

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
          <div class="num r">${eur(pa)}<span class="cmp-marge">${pc(margeDans(ta, c))}</span></div>
          <div class="num r">${eur(pb)}<span class="cmp-marge">${pc(margeDans(tb, c))}</span></div>
          <div class="num r ${d > 0 ? 'ok-text' : d < 0 ? 'warn-text' : ''}">${d === 0 ? '—' : (d > 0 ? '+' : '') + eur(d)}</div>
        </div>`;
      }).join('');
      const bilan = (t) => `${pc(moyenne(t, margeDans))} · ${eur(moyenne(t, prixDans))}`;
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
        <div style="max-height:46vh; overflow:auto;">${lignes || '<div class="empty-note">Carte vide.</div>'}</div>
        <div class="cmp-row cmp-foot">
          <div class="mono-label">Marge moyenne · prix moyen</div>
          <div class="num r">${bilan(ta)}</div>
          <div class="num r">${bilan(tb)}</div>
          <div class="num r">${pc(moyenne(tb, margeDans) - moyenne(ta, margeDans))}</div>
        </div>
        <div class="sub pretty">Plancher de marge de la maison : ${pc(pr.min)}.</div>
      </div>`;
    }

    // changer de tarification remonte la fenêtre : elle REMPLACE la sienne, sinon on
    // empilerait un voile de plus à chaque coup d'œil
    function monte() {
      if (posee) closeModal();
      posee = true;
      const sous = openModal(html(), { width: 720, stack: true });
      sous.querySelector('[data-a]').addEventListener('change', (e) => { a = Number(e.target.value); monte(); });
      sous.querySelector('[data-b]').addEventListener('change', (e) => { b = Number(e.target.value); monte(); });
    }
    monte();
  }

  // ---------- liaisons ----------

  async function patchTarif(tid, body) {
    try {
      await apiSend('PATCH', `/api/tarifs/${tid}`, body);
    } catch (e) {
      await echec('Enregistrement impossible', e);
    }
    await recharge();
  }

  function bindCompo() {
    const fichesEl = zone.querySelector('[data-fiches]');
    const spec = tarifSpec();
    renderTable(fichesEl, spec);
    bindTable(fichesEl, spec, paint);

    const vue = zone.querySelector('[data-vue-tarif]');
    if (vue) vue.addEventListener('change', () => { selTarif = Number(vue.value); paint(); });

    // prix : écrit dans la tarification consultée, ou sur la recette s'il n'y en a aucune
    fichesEl.querySelectorAll('[data-prix]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('blur', async () => {
        const cid = Number(inp.dataset.prix);
        // parseNum, pas parseFloat : au-dessus de mille, num() sépare les milliers par une
        // espace fine insécable — parseFloat lisait « 1 500,00 » comme 1 et écrasait le prix
        const brut = inp.value.trim();
        const v = parseNum(brut);
        if (!brut || v <= 0) { await recharge(); return; }
        const c = menu.cocktails.find((x) => x.id === cid);
        if (!c || Math.abs(v - prixDe(c)) < 0.005) return;
        const t = tarifCourant();
        if (t) await patchTarif(t.id, { prix: { [cid]: v } });
        else {
          try {
            await apiSend('PATCH', `/api/cocktails/${cid}`, { prix_ttc: v });
          } catch (e) {
            await echec('Enregistrement impossible', e);
          }
          await recharge();
        }
      });
    });

    fichesEl.querySelectorAll('[data-retirer]').forEach((b) =>
      b.addEventListener('click', () => {
        const reste = menu.cocktails.filter((c) => c.id !== Number(b.dataset.retirer));
        patchMenu({ cocktail_ids: reste.map((c) => c.id) });
      })
    );

    zone.querySelector('[data-ajouter]').addEventListener('click', ajouterFiches);
  }

  function bindTarifs() {
    zone.querySelectorAll('[data-tarif]').forEach((b) =>
      b.addEventListener('click', () => { selTarif = Number(b.dataset.tarif); paint(); })
    );
    zone.querySelector('[data-new-tarif]').addEventListener('click', async () => {
      let r;
      try {
        r = await apiSend('POST', `/api/menus/${menuId}/tarifs`, { nom: 'Nouvelle tarification' });
      } catch (e) {
        await echec('Création impossible', e);
        return;
      }
      selTarif = r.id;
      await recharge();
    });
    zone.querySelectorAll('[data-activer]').forEach((b) =>
      b.addEventListener('click', async () => {
        selTarif = Number(b.dataset.activer);
        await patchTarif(selTarif, { actif: true });
      })
    );
    zone.querySelectorAll('[data-regler]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = menu.tarifs.find((x) => x.id === Number(b.dataset.regler));
        selTarif = t.id;
        paint();                     // celle qu'on règle devient celle qu'on consulte
        openOptimiser({ tarif: t, onApplied: recharge, stack: true });
      })
    );
    zone.querySelectorAll('[data-dupliquer]').forEach((b) =>
      b.addEventListener('click', async () => {
        const src = menu.tarifs.find((t) => t.id === Number(b.dataset.dupliquer));
        let r;
        try {
          r = await apiSend('POST', `/api/menus/${menuId}/tarifs`, {
            nom: `${src.nom} (copie)`,
            from_tarif_id: src.id,
          });
        } catch (e) {
          await echec('Duplication impossible', e);
          return;
        }
        selTarif = r.id;
        await recharge();
      })
    );
    zone.querySelectorAll('[data-renommer]').forEach((b) =>
      b.addEventListener('click', () => renommer(menu.tarifs.find((x) => x.id === Number(b.dataset.renommer))))
    );
    zone.querySelectorAll('[data-del-tarif]').forEach((b) =>
      b.addEventListener('click', async () => {
        const t = menu.tarifs.find((x) => x.id === Number(b.dataset.delTarif));
        dialogue = true;
        const ok = await confirmModal({
          title: `Supprimer « ${t.nom} » ?`,
          body: t.actif
            ? 'C’est la tarification appliquée : les recettes reviendront à leur prix propre.'
            : 'Ses prix seront perdus. Les autres tarifications ne bougent pas.',
        });
        ouvre();                     // la confirmation a remplacé la carte : on la rouvre
        dialogue = false;
        if (!ok) return;
        try {
          await apiSend('DELETE', `/api/tarifs/${t.id}`);
        } catch (e) {
          await echec('Suppression impossible', e);
          return;
        }
        if (selTarif === t.id) selTarif = null;
        await recharge();
      })
    );
    zone.querySelector('[data-comparer]')?.addEventListener('click', comparer);
  }

  function bind() {
    const nomInput = zone.querySelector('[data-nom]');
    nomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nomInput.blur(); });
    nomInput.addEventListener('blur', () => {
      const v = nomInput.value.trim();
      if (!v) { nomInput.value = menu.nom; return; }
      if (v !== menu.nom) patchMenu({ nom: v });
    });

    zone.querySelectorAll('[data-onglet]').forEach((b) =>
      b.addEventListener('click', () => { onglet = b.dataset.onglet; paint(); })
    );

    if (onglet === 'compo') bindCompo();
    else bindTarifs();

    zone.querySelector('.modal-x').addEventListener('click', termine);
    zone.querySelector('[data-close]').addEventListener('click', termine);
    zone.querySelector('[data-restore]').addEventListener('click', retablir);
    zone.querySelector('[data-remove]').addEventListener('click', supprimer);
  }

  ouvre();
}
