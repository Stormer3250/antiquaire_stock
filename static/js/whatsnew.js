// « Quoi de neuf » : s'ouvre une fois par version, et à la demande en cliquant le
// tampon de version en bas de la barre latérale.

import { apiGet } from './api.js';
import { esc, openModal } from './ui.js';
import { auto } from './overlay.js';

const KEY = 'antiquaire.vuBuild';       // date de build déjà vue
const ANCIEN = 'antiquaire.vuVersion';  // clé de la toute première livraison

// La plus récente en premier. Une entrée par livraison, en français courant.
const NOTES = [
  {
    date: '2026-08-12',
    titre: 'Vocabulaire, barre latérale et confort',
    lignes: [
      'Le vocabulaire est fixé : une RECETTE se chiffre, une CARTE regroupe des recettes, une TARIFICATION est une grille de prix posée sur une carte.',
      'Une recette peut désormais figurer sur plusieurs cartes. Dans une carte, le prix vient de sa tarification active ; ailleurs, c’est la première carte de la liste, et l’écran de la recette dit laquelle.',
      'La barre latérale est repliée sur ses icônes et s’ouvre d’un clic, ce qui rend beaucoup de largeur aux tables.',
      'La synthèse d’une sélection s’affiche en haut du tableau, plus en bas.',
      'À l’inventaire, le niveau de la bouteille entamée se règle au curseur, en dixièmes.',
      'Modifier une ligne ne renvoie plus la page en haut : la position de lecture est conservée.',
      'La visite guidée éclaire vraiment la zone dont elle parle, et le sélecteur de lieu a disparu des écrans où il ne voulait rien dire.',
    ],
  },
  {
    date: '2026-08-12',
    titre: 'Menus, tarifications et réglage des prix',
    lignes: [
      'Une carte regroupe des recettes ; une tarification est une grille de prix posée dessus. Mêmes recettes, prix différents, et celle marquée « appliquée » est celle que suivent le comptoir et les marges.',
      'Dupliquer une tarification, en comparer deux côte à côte, et régler les prix sous contraintes : prix mini, prix maxi, marge moyenne visée, écart maximal. Le moteur propose, vous lisez, vous décidez, rien n’est enregistré avant.',
      'Une recette peut viser sa propre marge, ou voir son prix figé : le moteur ne la déplacera pas.',
      'Le comptoir montre les recettes passées sous le plancher de marge, avec l’ingrédient qui pèse le plus dans leur coût.',
      'Le barème est daté : un taux vaut à partir d’une date, l’ancien reste et couvre sa période.',
      'Cocher des lignes affiche une synthèse (valeur, marges, écarts) et permet de modifier les références retenues en une fois. Le tableau affiché s’exporte en .xlsx.',
    ],
  },
  {
    date: '2026-08-11',
    titre: 'Navigation et repères',
    lignes: [
      'Toutes les tables se trient : un clic sur un titre de colonne, un second pour inverser. La date de création est une colonne comme une autre.',
      'Les listes déroulantes sont habillées et gagnent une recherche dès qu’elles dépassent dix choix, accents ignorés.',
      'Ctrl+K (ou ⌘K) ouvre une recherche générale : une bouteille, une fiche, un écran, ou une action à lancer.',
      'Le « ? » en haut de l’écran lance une visite guidée de l’écran courant, avec l’explication des calculs.',
    ],
  },
  {
    date: '2026-08-11',
    titre: 'Droits d’alcool et doses',
    lignes: [
      'La fiche d’une référence pose les questions dans l’ordre : contient-elle de l’alcool, sous quel régime fiscal, rhum des DOM ou non, et enfin si le prix d’achat comprend déjà les droits.',
      'Un soft suivi en stock ne paie plus aucun droit, quelle que soit sa catégorie.',
      'Le taux réduit du rhum traditionnel des DOM est éditable dans le barème.',
      'Chaque référence peut avoir sa propre dose : laissée vide, elle suit sa catégorie.',
      'Le comptoir affiche le nombre de références en stock à la place des doses disponibles.',
      'Plus aucune alerte du navigateur, la carte d’import accepte un fichier déposé, et la version installée est affichée en bas à gauche.',
    ],
  },
];

export function openWhatsNew(notes = NOTES) {
  openModal(`
    <div class="modal-head">
      <div class="serif-title">Quoi de neuf</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body" style="display:flex; flex-direction:column; gap:20px;">
      ${notes.map((n) => `
      <div style="display:flex; flex-direction:column; gap:8px;">
        <div class="mono-label">${esc(n.date)}</div>
        <div class="serif-title" style="font-size:17px;">${esc(n.titre)}</div>
        <ul class="whatsnew-list">
          ${n.lignes.map((l) => `<li>${esc(l)}</li>`).join('')}
        </ul>
      </div>`).join('')}
    </div>`, { width: 560 });
}

export async function installWhatsNew() {
  const stamp = document.getElementById('build-stamp');
  stamp?.addEventListener('click', () => openWhatsNew());
  let build;
  try {
    ({ build } = await apiGet('/api/health'));
  } catch {
    return;   // hors ligne : rien à annoncer
  }

  const vu = localStorage.getItem(KEY);
  // Première ouverture de l'application, ou reprise après l'ancienne clé : on note la
  // version en silence. Annoncer des nouveautés à quelqu'un qui découvre l'outil n'a
  // aucun sens, il n'a rien connu d'autre.
  if (!vu) {
    localStorage.setItem(KEY, build);
    if (!localStorage.getItem(ANCIEN)) return;
    localStorage.removeItem(ANCIEN);
    return;
  }
  if (vu === build) return;

  localStorage.setItem(KEY, build);
  // Seulement ce qui est arrivé depuis la version qu'il avait. Rien de neuf à ses
  // yeux ⇒ aucune fenêtre : une mise à jour technique ne mérite pas une interruption.
  const nouveautes = NOTES.filter((n) => n.date > vu);
  if (!nouveautes.length) return;
  auto('whatsnew', () => openWhatsNew(nouveautes));
}
