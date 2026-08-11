// L'Antiquaire — coquille : routage, barre latérale, en-tête, état partagé.

import { apiGet } from './api.js';
import { esc, pc, num } from './ui.js';
import * as dash from './screens/dash.js';
import * as refs from './screens/refs.js';
import * as product from './screens/product.js';
import * as inv from './screens/inventory.js';
import * as cocktails from './screens/cocktails.js';
import * as cave from './screens/cave.js';
import * as bareme from './screens/bareme.js';
import * as config from './screens/config.js';
import { openReception } from './reception.js';
import { openRefModal } from './refmodal.js';
import { installSelectUpgrader } from './select.js';
import { installPalette } from './palette.js';

export const S = {
  meta: null,          // /api/state : pricing, rates, lists, categories, locations
  lieu: 'tous',        // 'tous' ou id numérique de lieu
  screen: 'dash',
  param: null,         // ex. id de référence pour la fiche
};

const NAV = [
  { key: 'dash', label: 'Comptoir', num: '01' },
  { key: 'refs', label: 'Références', num: '02' },
  { key: 'inv', label: 'Inventaire', num: '03' },
  { key: 'cocktails', label: 'Cartes & recettes', num: '04' },
  { key: 'cave', label: 'Cave & seuils', num: '05' },
  { key: 'bareme', label: 'Barème fiscal', num: '06' },
  { key: 'config', label: 'Configuration', num: '07' },
];

const SCREENS = { dash, refs, product, inv, cocktails, cave, bareme, config };

const TITLES = {
  dash: ['Bonsoir, le comptoir est ouvert', 'Valeur de la cave, commandes et marges de la carte'],
  refs: ['Le grand registre', 'Références suivies et non suivies'],
  product: ['Fiche bouteille', 'Coût de revient, part fiscale et prix conseillé'],
  inv: ['Inventaire', 'Comptage à la bouteille · vide, ¼, ½, ¾, pleine'],
  cocktails: ['Cartes & recettes', 'Saisie des fiches, coût matière et marge'],
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
    <button class="${n.key === navKey ? 'active' : ''}" data-nav="${n.key}">
      <span class="num">${n.num}</span><span>${esc(n.label)}</span>
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

  const seg = document.getElementById('lieu-seg');
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

async function route() {
  const parts = (location.hash || '#/dash').slice(2).split('/');
  S.screen = SCREENS[parts[0]] ? parts[0] : 'dash';
  S.param = parts[1] ? Number(parts[1]) : null;
  renderShell();
  const el = document.getElementById('screen');
  el.innerHTML = '';
  await SCREENS[S.screen].render(el, S);
}

async function boot() {
  await reloadMeta();
  installSelectUpgrader();
  installPalette();
  document.getElementById('btn-reception').addEventListener('click', () => openReception());
  document.getElementById('btn-new-ref').addEventListener('click', () => openRefModal());
  window.addEventListener('hashchange', route);
  await route();
  // Quelle version tourne ici : le Mac et la démo ne mentent plus.
  apiGet('/api/health').then((h) => {
    document.getElementById('build-stamp').textContent = `v${h.version} · ${h.build}`;
  }).catch(() => {});
}

boot();

// petit utilitaire partagé par les écrans
export function fmtStock(row) {
  if (!row.suivi) return '—';
  const unit = row.dose_cl > 5 || row.categorie_nom.startsWith('Sirop') ? ' u.' : ' bt';
  return num(row.stock, row.stock % 1 ? 2 : 0) + unit;
}
