// Visite guidée, un jeu d'étapes par écran. Le projecteur est une découpe faite au
// box-shadow : un seul élément couvre la page et laisse un trou sur la cible.
// Reprise du GuidedTour de l'éditeur e-facture, en JS sans framework.

import { auto, claim, release } from './overlay.js';

const SEEN = (ecran) => `antiquaire.tour.${ecran}`;
const AUTO_OFF = 'antiquaire.tour.silence';   // l'utilisateur a demandé qu'on le laisse

// Chaque étape vise un sélecteur déjà présent dans l'écran. Une cible absente est
// simplement sautée : un écran vide ne casse pas la visite.
const STEPS = {
  dash: [
    ['.hero', 'La valeur de la cave',
      'Le total du stock au prix d’achat HT, pour le lieu choisi en haut à droite. Basculez entre Réserve et Comptoir pour voir la valeur de chacun.'],
    ['.kpi', 'Les quatre repères',
      'Combien de références ont du stock, la marge moyenne de la carte, combien de bouteilles sont passées sous leur seuil, et combien de fiches sont chiffrées.'],
    ['.panel:last-child', 'Ce que les hausses d’achat ont fait céder',
      'Les fiches passées sous le plancher de marge au prix pratiqué aujourd’hui, la plus basse en premier, avec l’ingrédient qui pèse le plus dans leur coût. Rien de nouveau en base : on recalcule et on trie.'],
    ['[data-goto-cave]', 'La cave crie famine',
      'Tout ce qui est tombé sous son seuil d’alerte, groupé par fournisseur, avec la quantité à commander pour revenir au stock cible. Le bouton mène au réglage des seuils.'],
  ],
  refs: [
    ['[data-q]', 'Chercher',
      'Le nom, la marque ou le fournisseur. Les accents et les majuscules n’ont pas d’importance.'],
    ['.thead', 'Trier',
      'Chaque colonne est cliquable : un clic trie, un second inverse le sens. La dernière colonne trie par date de création.'],
    ['.trow', 'Une ligne, une bouteille',
      'Le trait de couleur à gauche dit l’état du stock. Cliquez la ligne pour ouvrir sa fiche, « ÉD » pour corriger ses informations sans quitter l’écran.'],
  ],
  product: [
    ['[data-price]', 'Le prix conseillé',
      'Calculé à partir du coût de la dose et de la marge visée, puis arrondi au pas défini dans Configuration. Saisir un prix à la main le fige : un bouton apparaît pour revenir au calcul.'],
    ['.waterfall, .panel', 'Comment on arrive là',
      'Prix d’achat divisé par le nombre de doses, plus les droits d’accise et la cotisation sécurité sociale si le prix d’achat ne les contient pas déjà. Cela donne le coût d’une dose. Le prix de vente HT vaut ce coût divisé par (1 moins la marge), puis la TVA s’ajoute.'],
  ],
  inv: [
    ['.thead', 'Compter',
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
    ['[data-menu-nom]', 'Un menu, des fiches',
      'Un menu regroupe des fiches. Une fiche n’appartient qu’à un seul menu : c’est ce qui permet de dire sans ambiguïté quel prix s’applique à elle.'],
    ['[data-fiches] .thead', 'Les prix affichés',
      'Ce sont ceux de la tarification consultée à droite, même si elle n’est pas encore appliquée. La marge suit, ce qui permet d’essayer une grille avant de s’y engager.'],
    ['[data-new-tarif]', 'Tarifications',
      'Mêmes recettes, prix différents : une pour l’été, une pour l’happy hour, une en brouillon. « APPL » désigne celle qu’on pratique vraiment, et c’est elle que reprennent le comptoir et les marges.'],
    ['[data-regler]', 'Régler les prix sous contraintes',
      'Prix mini, prix maxi, marge moyenne visée, écart maximal entre la moins chère et la plus chère : le moteur propose un prix par fiche, respecte les prix figés, et dit ce qu’il n’a pas pu tenir. Rien n’est enregistré tant que vous n’avez pas appliqué.'],
    ['[data-comparer]', 'Comparer',
      'Deux tarifications côte à côte, prix et marge par fiche, écart mis en évidence, plus la moyenne de chacune.'],
  ],
  cave: [
    ['.thead', 'Seuil et cible',
      'Le seuil déclenche l’alerte, la cible est le stock à reconstituer : la commande suggérée vaut cible moins stock.'],
    ['[data-import]', 'Import de fichier',
      'Un .xlsx ou .csv, déposé ou choisi. Les colonnes se mappent à l’écran, et un fichier à deux colonnes « nom, prix d’achat » suffit à mettre à jour les tarifs.'],
  ],
  bareme: [
    ['.panel', 'Les taux',
      'Le droit d’accise des spiritueux s’applique à l’hectolitre d’alcool pur : dose × degré. Le rhum traditionnel des DOM a son propre taux réduit, à cocher sur la fiche de la bouteille. Le vin et la bière se taxent au volume de produit fini.'],
    ['[data-nouveau-taux]', 'Un taux vaut à partir d’une date',
      'Les droits changent chaque année. Un nouveau taux ne remplace pas l’ancien : il prend effet à sa date, l’ancien couvre la période qu’il a couverte, et re-chiffrer une carte de l’an dernier donne ce qu’elle coûtait l’an dernier.'],
    ['.panel:nth-of-type(2)', 'Effet sur la dose',
      'Ce que chaque bouteille paie réellement pour une dose, et la part que cela représente dans son coût matière. Une référence marquée « ne contient pas d’alcool » n’apparaît ici qu’à zéro.'],
  ],
  config: [
    ['.panel', 'Politique de prix',
      'La marge cible sert au calcul des prix conseillés, le plancher déclenche les alertes rouges, l’arrondi fixe le pas des prix affichés.'],
    ['.panel:nth-of-type(2)', 'Catégories',
      'Chaque catégorie porte sa dose par défaut, son régime fiscal, sa marge et sa TVA. Une référence peut s’en écarter au cas par cas depuis sa fiche.'],
  ],
};

let active = null;

export function startTour(ecran) {
  const steps = (STEPS[ecran] || []).filter(([sel]) => document.querySelector(sel));
  if (!steps.length || active) return;
  claim('tour');

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  const bubble = document.createElement('div');
  bubble.className = 'tour-bubble';
  document.body.append(overlay, bubble);
  active = { overlay, bubble };
  let i = 0;

  function stop(silence = false) {
    localStorage.setItem(SEEN(ecran), '1');
    // « Passer » vaut pour toute l'application : quelqu'un qui refuse une visite
    // ne veut pas qu'on la lui propose sur les six écrans suivants.
    if (silence) localStorage.setItem(AUTO_OFF, '1');
    overlay.remove();
    bubble.remove();
    window.removeEventListener('resize', paint);
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

  function paint() {
    const [sel, title, text] = steps[i];
    const target = document.querySelector(sel);
    if (!target) { move(1); return; }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const r = target.getBoundingClientRect();
    const pad = 6;
    Object.assign(overlay.style, {
      top: `${r.top - pad}px`,
      left: `${r.left - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
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
    // sous la cible si la place le permet, au-dessus sinon
    const below = r.bottom + 190 < window.innerHeight;
    bubble.style.top = below ? `${r.bottom + 14}px` : `${Math.max(12, r.top - 200)}px`;
    bubble.style.left = `${Math.min(Math.max(12, r.left), window.innerWidth - 400)}px`;
    bubble.querySelector('[data-skip]').addEventListener('click', () => stop(true));
    bubble.querySelector('[data-next]').addEventListener('click', () => move(1));
    bubble.querySelector('[data-prev]')?.addEventListener('click', () => move(-1));
  }

  overlay.addEventListener('click', () => stop());
  window.addEventListener('resize', paint);
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
