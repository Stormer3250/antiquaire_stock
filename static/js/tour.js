// Visite guidée, un jeu d'étapes par écran. Le projecteur est une découpe faite au
// box-shadow : un seul élément couvre la page et laisse un trou sur la cible.
// Reprise du GuidedTour de l'éditeur e-facture, en JS sans framework.

const SEEN = (ecran) => `antiquaire.tour.${ecran}`;

// Chaque étape vise un sélecteur déjà présent dans l'écran. Une cible absente est
// simplement sautée : un écran vide ne casse pas la visite.
const STEPS = {
  dash: [
    ['.hero', 'La valeur de la cave',
      'Le total du stock au prix d’achat HT, pour le lieu choisi en haut à droite. Basculez entre Réserve et Comptoir pour voir la valeur de chacun.'],
    ['.kpi', 'Les quatre repères',
      'Combien de références ont du stock, la marge moyenne de la carte, combien de bouteilles sont passées sous leur seuil, et combien de fiches sont chiffrées.'],
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
  cave: [
    ['.thead', 'Seuil et cible',
      'Le seuil déclenche l’alerte, la cible est le stock à reconstituer : la commande suggérée vaut cible moins stock.'],
    ['[data-import]', 'Import de fichier',
      'Un .xlsx ou .csv, déposé ou choisi. Les colonnes se mappent à l’écran, et un fichier à deux colonnes « nom, prix d’achat » suffit à mettre à jour les tarifs.'],
  ],
  bareme: [
    ['.panel', 'Les taux',
      'Le droit d’accise des spiritueux s’applique à l’hectolitre d’alcool pur : dose × degré. Le rhum traditionnel des DOM a son propre taux réduit, à cocher sur la fiche de la bouteille. Le vin et la bière se taxent au volume de produit fini.'],
    ['.panel:last-child', 'Effet sur la dose',
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

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  const bubble = document.createElement('div');
  bubble.className = 'tour-bubble';
  document.body.append(overlay, bubble);
  active = { overlay, bubble };
  let i = 0;

  function stop() {
    localStorage.setItem(SEEN(ecran), '1');
    overlay.remove();
    bubble.remove();
    window.removeEventListener('resize', paint);
    document.removeEventListener('keydown', keys, true);
    active = null;
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
        <button class="btn muted" data-skip>Passer</button>
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
    bubble.querySelector('[data-skip]').addEventListener('click', stop);
    bubble.querySelector('[data-next]').addEventListener('click', () => move(1));
    bubble.querySelector('[data-prev]')?.addEventListener('click', () => move(-1));
  }

  overlay.addEventListener('click', stop);
  window.addEventListener('resize', paint);
  document.addEventListener('keydown', keys, true);
  paint();
}

// À la première visite d'un écran seulement : le personnel du bar rencontre
// l'explication une fois, jamais deux.
export function autoTour(ecran) {
  if (!STEPS[ecran] || localStorage.getItem(SEEN(ecran))) return;
  setTimeout(() => startTour(ecran), 600);
}

export function installTour(currentScreen) {
  document.getElementById('btn-tour')?.addEventListener('click', () => {
    const ecran = currentScreen();
    localStorage.removeItem(SEEN(ecran));   // relancer à la demande doit toujours marcher
    startTour(ecran);
  });
}
