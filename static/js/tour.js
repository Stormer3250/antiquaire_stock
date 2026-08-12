// Visite guidée, un jeu d'étapes par écran. Le projecteur est une découpe faite au
// box-shadow : un seul élément couvre la page et laisse un trou sur la cible.
// Reprise du GuidedTour de l'éditeur e-facture, en JS sans framework.

import { auto, claim, release } from './overlay.js';
import { allumer, eteindre, amener } from './spotlight.js';

const SEEN = (ecran) => `antiquaire.tour.${ecran}`;
const AUTO_OFF = 'antiquaire.tour.silence';   // l'utilisateur a demandé qu'on le laisse

// Chaque étape vise un sélecteur déjà présent dans l'écran. Une cible absente est
// simplement sautée : un écran vide ne casse pas la visite.
const STEPS = {
  dash: [
    ['[data-section="valeur"]', 'La valeur de la cave',
      'Le total du stock au prix d’achat HT, pour le lieu choisi en haut à droite. Basculez entre Réserve et Comptoir pour voir la valeur de chacun.'],
    ['.kpi', 'Les quatre repères',
      'Combien de références ont du stock, la marge moyenne de la carte, combien de bouteilles sont passées sous leur seuil, et combien de recettes sont chiffrées.'],
    ['[data-section="impact"]', 'Ce que les hausses d’achat ont fait céder',
      'Les recettes passées sous le plancher de marge au prix pratiqué aujourd’hui, la plus basse en premier, avec l’ingrédient qui pèse le plus dans leur coût. Rien de nouveau en base : on recalcule et on trie.'],
    ['[data-section="commandes"]', 'La cave crie famine',
      'Tout ce qui est tombé sous son seuil d’alerte, groupé par fournisseur, avec la quantité à commander pour revenir au stock cible. Le bouton mène au réglage des seuils.'],
  ],
  refs: [
    ['[data-vb-q]', 'Chercher',
      'Le nom, la marque ou le fournisseur. Les accents et les majuscules n’ont pas d’importance.'],
    ['.vb-views', 'Table ou blocs',
      'Basculez entre la table (colonnes triables, sélection multiple) et les cartes. Tri, groupement par catégorie et import/export vivent dans la même barre.'],
    ['.bloc', 'Une carte, une bouteille',
      'Cliquez la carte (ou la ligne, en vue table) pour ouvrir sa fiche et corriger ses informations sans quitter l’écran.'],
  ],
  inv: [
    ['[data-section="comptage"] .thead', 'Compter',
      'Une ligne par référence. Le niveau de la bouteille entamée d’un côté, le nombre de bouteilles pleines de l’autre.'],
    ['[data-summary]', 'Clôturer',
      'Seules les lignes touchées sont enregistrées : vous pouvez ne compter qu’une partie de la cave et revenir plus tard.'],
  ],
  cocktails: [
    ['.chip-sort', 'Ordonner la carte',
      'Par nom, par prix, par marge ou par date de création. Le tri ne change que l’affichage.'],
    ['[data-ing-add]', 'La recette',
      'Chaque ingrédient est une référence de la cave, en centilitres pour les bouteilles suivies, en unités pour les garnitures. Le coût matière se recalcule à chaque changement.'],
    ['[data-apply]', 'Le prix conseillé',
      'Le prix qui tient la marge cible de la maison compte tenu du coût matière. Le curseur au-dessus permet de s’en écarter, la carte passe en rouge sous le plancher de marge.'],
  ],
  menus: [
    ['[data-menu-nom]', 'Une carte, des recettes',
      'Une carte regroupe des recettes, et une recette peut figurer sur plusieurs cartes. Dans une carte, le prix vient de sa tarification active ; ailleurs, c’est la première carte de la liste qui donne le prix, et l’écran le dit toujours.'],
    ['[data-fiches] .thead', 'Les prix affichés',
      'Ce sont ceux de la tarification consultée à droite, même si elle n’est pas encore appliquée. La marge suit, ce qui permet d’essayer une grille avant de s’y engager.'],
    ['[data-new-tarif]', 'Tarifications',
      'Mêmes recettes, prix différents : une pour l’été, une pour l’happy hour, une en brouillon. « APPL » désigne celle qu’on pratique vraiment, et c’est elle que reprennent le comptoir et les marges.'],
    ['[data-regler]', 'Régler les prix sous contraintes',
      'Prix mini, prix maxi, marge moyenne visée, écart maximal entre la moins chère et la plus chère : le moteur propose un prix par recette, respecte les prix figés, et dit ce qu’il n’a pas pu tenir. Rien n’est enregistré tant que vous n’avez pas appliqué.'],
    ['[data-comparer]', 'Comparer',
      'Deux tarifications côte à côte, prix et marge par recette, écart mis en évidence, plus la moyenne de chacune.'],
  ],
  cave: [
    ['[data-section="seuils"] .thead', 'Seuil et cible',
      'Le seuil déclenche l’alerte, la cible est le stock à reconstituer : la commande suggérée vaut cible moins stock.'],
    ['[data-section="garnitures"]', 'Les garnitures',
      'Ni stock, ni seuil, ni inventaire : zestes, sirops et aromates servent uniquement à chiffrer les recettes, au coût unitaire que vous leur donnez.'],
    ['[data-section="import"]', 'Import de fichier',
      'Un .xlsx ou .csv, déposé ou choisi. Les colonnes se mappent à l’écran, et un fichier à deux colonnes « nom, prix d’achat » suffit à mettre à jour les tarifs.'],
  ],
  bareme: [
    ['[data-section="taux"]', 'Les taux',
      'Le droit d’accise des spiritueux s’applique à l’hectolitre d’alcool pur : dose × degré. Le rhum traditionnel des DOM a son propre taux réduit, à cocher sur la fiche de la bouteille. Le vin et la bière se taxent au volume de produit fini.'],
    ['[data-nouveau-taux]', 'Un taux vaut à partir d’une date',
      'Les droits changent chaque année. Un nouveau taux ne remplace pas l’ancien : il prend effet à sa date, l’ancien couvre la période qu’il a couverte, et re-chiffrer une carte de l’an dernier donne ce qu’elle coûtait l’an dernier.'],
    ['[data-section="effet-dose"]', 'Effet sur la dose',
      'Ce que chaque bouteille paie réellement pour une dose, et la part que cela représente dans son coût matière. Une référence marquée « ne contient pas d’alcool » n’apparaît ici qu’à zéro.'],
  ],
  config: [
    ['[data-section="politique"]', 'Politique de prix',
      'La marge cible sert au calcul des prix conseillés, le plancher déclenche les alertes rouges, l’arrondi fixe le pas des prix affichés.'],
    ['[data-section="categories"]', 'Catégories',
      'Chaque catégorie porte sa dose par défaut, son régime fiscal, sa marge et sa TVA. Une référence peut s’en écarter au cas par cas depuis sa fiche.'],
  ],
};

let active = null;

export function startTour(ecran) {
  const steps = (STEPS[ecran] || []).filter(([sel]) => document.querySelector(sel));
  if (!steps.length || active) return;
  claim('tour');

  const bubble = document.createElement('div');
  bubble.className = 'tour-bubble';
  document.body.append(bubble);
  active = { bubble };
  let i = 0;

  function stop(silence = false) {
    localStorage.setItem(SEEN(ecran), '1');
    // « Passer » vaut pour toute l'application : quelqu'un qui refuse une visite
    // ne veut pas qu'on la lui propose sur les six écrans suivants.
    if (silence) localStorage.setItem(AUTO_OFF, '1');
    eteindre();
    bubble.remove();
    window.removeEventListener('resize', placer);
    window.removeEventListener('scroll', placer, true);
    document.removeEventListener('keydown', keys, true);
    active = null;
    release('tour');
  }

  function keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); stop(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
  }

  function move(d) {
    i += d;
    if (i < 0) i = 0;
    if (i >= steps.length) { stop(); return; }
    paint();
  }

  // La bulle se place à côté de la zone éclairée, et se replace si la page bouge.
  // « La zone » peut être plusieurs blocs (les quatre repères) : on prend leur emprise
  // commune, sinon la bulle vient se poser sur ceux qu'elle est censée montrer.
  let zone = null;
  function emprise() {
    const l = [...document.querySelectorAll('.cc-lit')].map((n) => n.getBoundingClientRect());
    if (!l.length) return zone.getBoundingClientRect();
    return {
      top: Math.min(...l.map((r) => r.top)),
      left: Math.min(...l.map((r) => r.left)),
      right: Math.max(...l.map((r) => r.right)),
      bottom: Math.max(...l.map((r) => r.bottom)),
    };
  }
  function placer() {
    if (!zone) return;
    const r = emprise();
    const dessous = r.bottom + 210 < window.innerHeight;
    bubble.style.top = dessous
      ? `${r.bottom + 14}px`
      : `${Math.max(12, Math.min(r.top - 210, window.innerHeight - 230))}px`;
    bubble.style.left = `${Math.min(Math.max(12, r.left), window.innerWidth - 400)}px`;
  }

  async function paint() {
    const [sel, title, text] = steps[i];
    const cibles = document.querySelectorAll(sel);
    if (!cibles.length) { move(1); return; }
    zone = cibles[0];
    // d'abord amener la zone à l'écran, ATTENDRE que le défilement soit fini,
    // et seulement ensuite éclairer et poser la bulle
    await amener(zone);
    allumer(sel);
    bubble.innerHTML = `
      <div class="tour-step">Étape ${i + 1} sur ${steps.length}</div>
      <div class="serif-title tour-title"></div>
      <div class="tour-text pretty"></div>
      <div class="tour-actions">
        <button class="btn muted" data-skip title="Arrête aussi les visites proposées automatiquement">Passer</button>
        <div class="row" style="gap:8px;">
          ${i > 0 ? '<button class="btn" data-prev>Précédent</button>' : ''}
          <button class="btn-solid" data-next>${i === steps.length - 1 ? 'Terminer' : 'Suivant'}</button>
        </div>
      </div>`;
    bubble.querySelector('.tour-title').textContent = title;
    bubble.querySelector('.tour-text').textContent = text;
    placer();
    bubble.querySelector('[data-skip]').addEventListener('click', () => stop(true));
    bubble.querySelector('[data-next]').addEventListener('click', () => move(1));
    bubble.querySelector('[data-prev]')?.addEventListener('click', () => move(-1));
  }

  window.addEventListener('resize', placer);
  window.addEventListener('scroll', placer, true);
  document.addEventListener('keydown', keys, true);
  paint();
}

// À la première visite d'un écran seulement : le personnel du bar rencontre
// l'explication une fois, jamais deux.
export function autoTour(ecran) {
  if (!STEPS[ecran] || localStorage.getItem(SEEN(ecran))) return;
  if (localStorage.getItem(AUTO_OFF)) return;
  setTimeout(() => {
    // l'arbitre décide : si une autre surface occupe l'écran, la visite attend
    // qu'elle se ferme au lieu de s'ouvrir par-dessus.
    if (ecranCourant() !== ecran) return;   // l'utilisateur est déjà parti ailleurs
    auto('tour', () => {
      // l'attente a pu durer : on ne s'ouvre que si l'écran est toujours celui-là
      if (ecranCourant() !== ecran) { release('tour'); return; }
      startTour(ecran);
    });
  }, 600);
}

// Renseigné par app.js : la visite différée ne doit pas s'ouvrir sur un autre écran.
let ecranCourant = () => null;
export function setEcranCourant(fn) {
  ecranCourant = fn;
}

export function installTour(currentScreen) {
  setEcranCourant(currentScreen);
  document.getElementById('btn-tour')?.addEventListener('click', () => {
    const ecran = currentScreen();
    localStorage.removeItem(SEEN(ecran));   // relancer à la demande doit toujours marcher
    localStorage.removeItem(AUTO_OFF);      // et rouvre la porte aux visites proposées
    startTour(ecran);
  });
}
