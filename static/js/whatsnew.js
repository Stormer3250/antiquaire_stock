// « Quoi de neuf » : s'ouvre une fois par version, et à la demande en cliquant le
// tampon de version en bas de la barre latérale.

import { apiGet } from './api.js';
import { esc, openModal } from './ui.js';

const KEY = 'antiquaire.vuVersion';

// La plus récente en premier. Une entrée par livraison, en français courant.
const NOTES = [
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

export function openWhatsNew() {
  openModal(`
    <div class="modal-head">
      <div class="serif-title">Quoi de neuf</div>
      <button class="modal-x" aria-label="Fermer">×</button>
    </div>
    <div class="modal-body" style="display:flex; flex-direction:column; gap:20px;">
      ${NOTES.map((n) => `
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
  stamp?.addEventListener('click', openWhatsNew);
  try {
    const { version, build } = await apiGet('/api/health');
    const tag = `${version}·${build}`;
    if (localStorage.getItem(KEY) === tag) return;
    localStorage.setItem(KEY, tag);
    openWhatsNew();
  } catch {
    /* hors ligne : rien à annoncer */
  }
}
