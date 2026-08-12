// L'Antiquaire — coquille : routage, barre latérale, en-tête, état partagé.

import { apiGet } from './api.js';
import { esc, pc, num } from './ui.js';
import * as dash from './screens/dash.js';
import * as refs from './screens/refs.js';
import * as product from './screens/product.js';
import * as inv from './screens/inventory.js';
import * as cocktails from './screens/cocktails.js';
import * as menus from './screens/menus.js';
import * as cave from './screens/cave.js';
import * as bareme from './screens/bareme.js';
import * as config from './screens/config.js';
import { openReception } from './reception.js';
import { openRefModal } from './refmodal.js';
import { installSelectUpgrader } from './select.js';
import { installPalette } from './palette.js';
import { installTour, autoTour } from './tour.js';
import { installWhatsNew } from './whatsnew.js';
import { icone } from './icons.js';

export const S = {
  meta: null,          // /api/state : pricing, rates, lists, categories, locations
  lieu: 'tous',        // 'tous' ou id numérique de lieu
  screen: 'dash',
  param: null,         // ex. id de référence pour la fiche
};

const NAV = [
  { key: 'dash', label: 'Comptoir', ic: 'comptoir' },
  { key: 'refs', label: 'Références', ic: 'references' },
  { key: 'inv', label: 'Inventaire', ic: 'inventaire' },
  { key: 'cocktails', label: 'Recettes', ic: 'recettes' },
  { key: 'menus', label: 'Cartes & tarifications', ic: 'cartes' },
  { key: 'cave', label: 'Cave & seuils', ic: 'cave' },
  { key: 'bareme', label: 'Barème fiscal', ic: 'bareme' },
  { key: 'config', label: 'Configuration', ic: 'config' },
];

// Barre latérale : repliée par défaut pour rendre la largeur aux tables, dépliée au
// survol, et épinglable pour qui préfère l'avoir en permanence.
const EPINGLE = 'antiquaire.navEpinglee';
const ICONE_EPINGLE = icone('chevrons', 15);

function appliquerEpingle() {
  const on = localStorage.getItem(EPINGLE) === '1';
  document.body.classList.toggle('nav-epinglee', on);
  const b = document.getElementById('btn-epingle');
  if (b) {
    b.classList.toggle('on', on);
    b.title = on ? 'Replier la barre' : 'Déplier la barre';
    b.setAttribute('aria-pressed', String(on));
  }
}

const SCREENS = { dash, refs, product, inv, cocktails, menus, cave, bareme, config };

const TITLES = {
  dash: ['Bonsoir, le comptoir est ouvert', 'Valeur de la cave, commandes et marges des cartes'],
  refs: ['Le grand registre', 'Références suivies et non suivies'],
  product: ['Fiche bouteille', 'Coût de revient, part fiscale et prix conseillé'],
  inv: ['Inventaire', 'Comptage à la bouteille · niveau de l’entamée en dixièmes'],
  cocktails: ['Recettes', 'Saisie des recettes, coût matière et marge'],
  menus: ['Cartes & tarifications', 'Regrouper les recettes, tenir plusieurs grilles de prix'],
  cave: ['Cave & seuils', 'Maintien du stock, garnitures et import de fichier'],
  bareme: ['Barème fiscal', 'Droits d’accise et cotisation sécurité sociale'],
  config: ['Configuration', 'Politique de prix, catégories et référentiels'],
};

export async function reloadMeta() {
  S.meta = await apiGet('/api/state');
}

export function lieuQuery() {
  return S.lieu === 'tous' ? 'tous' : String(S.lieu);
}

export function lieuLabel() {
  if (S.lieu === 'tous') return 'tous lieux';
  const loc = S.meta.locations.find((l) => l.id === S.lieu);
  return loc ? loc.nom : 'tous lieux';
}

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

export async function refresh() {
  await route();
}

function renderShell() {
  const navKey = S.screen === 'product' ? 'refs' : S.screen;
  document.getElementById('nav').innerHTML = NAV.map(
    (n) => `
    <button class="${n.key === navKey ? 'active' : ''}" data-nav="${n.key}"
      title="${esc(n.label)}" aria-label="${esc(n.label)}">
      ${icone(n.ic)}<span class="lib">${esc(n.label)}</span>
    </button>`
  ).join('');
  document.querySelectorAll('#nav [data-nav]').forEach((b) =>
    b.addEventListener('click', () => go('#/' + b.dataset.nav))
  );

  const [title, sub] = TITLES[S.screen] || TITLES.dash;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent = sub;

  const pr = S.meta.pricing;
  document.getElementById('marge-note').textContent =
    `Cible ${pc(pr.cible)} · plancher ${pc(pr.min)}`;

  // Un lieu de stock n'a aucun sens sur les recettes, les cartes, le barème ou les
  // réglages : on ne montre le sélecteur que là où il change quelque chose.
  const AVEC_LIEU = new Set(['dash', 'refs', 'inv', 'cave', 'product']);
  const seg = document.getElementById('lieu-seg');
  seg.hidden = !AVEC_LIEU.has(S.screen);
  if (seg.hidden) { seg.innerHTML = ''; return; }
  const items = [{ id: 'tous', nom: 'Tous' }, ...S.meta.locations.map((l) => ({ id: l.id, nom: l.nom }))];
  seg.innerHTML = items.map(
    (it) => `<button class="${String(S.lieu) === String(it.id) ? 'active' : ''}"
      data-lieu="${it.id}">${esc(it.nom)}</button>`
  ).join('');
  seg.querySelectorAll('[data-lieu]').forEach((b) =>
    b.addEventListener('click', async () => {
      S.lieu = b.dataset.lieu === 'tous' ? 'tous' : Number(b.dataset.lieu);
      await route();
    })
  );
}

// ---------- garder la position de lecture ----------
//
// Un écran se re-génère en vidant son conteneur : la hauteur du document retombe, le
// navigateur ramène le défilement à zéro, et le contenu revient trop tard. Résultat,
// modifier une ligne au milieu d'une longue table renvoyait tout en haut. On garde donc
// une ancre, et on la repose après re-rendu. Une VRAIE navigation, elle, doit bien
// repartir du haut : d'où le drapeau.
let ancre = 0;
let ancreLe = 0;
let navigation = false;

window.addEventListener('scroll', () => {
  if (navigation) return;
  // Un retour à zéro n'efface PAS l'ancre : c'est presque toujours le navigateur qui
  // rogne le défilement parce que le document vient de rapetisser, pas l'utilisateur
  // qui remonte. Le premier piège de cette correction était là.
  if (window.scrollY > 0) {
    ancre = window.scrollY;
    ancreLe = performance.now();
  }
}, { passive: true });

function installerAncre() {
  new MutationObserver(() => {
    if (navigation || ancre <= 0 || window.scrollY > 0) return;
    if (performance.now() - ancreLe > 1500) return;   // trop vieux : c'était voulu
    if (document.body.scrollHeight >= ancre + window.innerHeight) window.scrollTo(0, ancre);
  }).observe(document.getElementById('screen'), { childList: true, subtree: true });
}

async function route() {
  const parts = (location.hash || '#/dash').slice(2).split('/');
  const change = parts[0] !== S.screen || (parts[1] ? Number(parts[1]) : null) !== S.param;
  if (change) {
    navigation = true;
    ancre = 0;
    window.scrollTo(0, 0);
    setTimeout(() => { navigation = false; }, 120);
  }
  S.screen = SCREENS[parts[0]] ? parts[0] : 'dash';
  S.param = parts[1] ? Number(parts[1]) : null;
  renderShell();
  const el = document.getElementById('screen');
  el.innerHTML = '';
  await SCREENS[S.screen].render(el, S);
  autoTour(S.screen);
}

async function boot() {
  await reloadMeta();
  installerAncre();
  appliquerEpingle();
  document.getElementById('btn-epingle').innerHTML = ICONE_EPINGLE;
  document.getElementById('btn-epingle').addEventListener('click', () => {
    localStorage.setItem(EPINGLE, localStorage.getItem(EPINGLE) === '1' ? '0' : '1');
    appliquerEpingle();
  });
  installSelectUpgrader();
  installPalette();
  installTour(() => S.screen);
  document.getElementById('btn-reception').addEventListener('click', () => openReception());
  document.getElementById('btn-new-ref').addEventListener('click', () => openRefModal());
  window.addEventListener('hashchange', route);
  await route();
  // Quelle version tourne ici : le Mac et la démo ne mentent plus.
  apiGet('/api/health').then((h) => {
    const stamp = document.getElementById('build-stamp');
    stamp.textContent = `v${h.version} · ${h.build}`;
    stamp.title = 'Quoi de neuf';
  }).catch(() => {});
  await installWhatsNew();
}

boot();

// petit utilitaire partagé par les écrans
export function fmtStock(row) {
  if (!row.suivi) return '—';
  const unit = row.dose_cl > 5 || row.categorie_nom.startsWith('Sirop') ? ' u.' : ' bt';
  return num(row.stock, row.stock % 1 ? 2 : 0) + unit;
}
