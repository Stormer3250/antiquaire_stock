# Vague 3 : ergonomie, vocabulaire et mise en lumière

> Retours d'usage après la vague 2. Branche `feat/vague3-ergonomie`, un commit par lot, une PR.

## Ce qui est cassé, et pourquoi

**La visite guidée vise à côté.** Trois symptômes, une seule cause et demie :

1. `paint()` mesure la cible juste après `scrollIntoView({behavior:'smooth'})`, donc **avant** que le défilement ait bougé : le cadre est dessiné à l'ancienne position. C'est l'étape 4 qui « désigne un élément caché ».
2. Le cadre est un `<div>` en position fixe posé par-dessus : il ne suit pas le défilement et n'épouse pas exactement la bordure.
3. `.kpi` désigne quatre blocs, `document.querySelector` n'en prend qu'un ; `.panel:last-child` attrape le mauvais panneau.

**Correction de fond, demandée : la mise en lumière devient une propriété des sections.** Un module `spotlight.js` allume un ou plusieurs éléments et éteint le reste. La découpe est portée **par l'élément lui-même** (`box-shadow` sur la cible), donc elle épouse la bordure au pixel et suit le défilement sans code. Les écrans reçoivent des attributs `data-section="..."` : n'importe quelle fonction future peut demander « éclaire-moi la section des seuils » sans connaître le balisage.

**La position de lecture est perdue à chaque re-rendu.** Vérifié sur Références, Cave et les recettes : défiler à 400 px puis modifier quoi que ce soit ramène la page à 0. Le vidage de `innerHTML` fait retomber la hauteur du document, le navigateur ramène le défilement à zéro, et le contenu revient trop tard. Ce n'est pas le bouton « éditer », c'est tout re-rendu. Correction en un seul endroit : une ancre reprise après re-rendu, sauf lors d'une vraie navigation.

## Le lot

| # | Sujet | Décision |
|---|---|---|
| 1 | Mise en lumière | `spotlight.js` générique, `data-section` sur les blocs, la visite s'en sert |
| 2 | Défilement | ancre conservée au re-rendu, remise à zéro seulement en navigation |
| 3 | Barre latérale | repliée par défaut, épinglable, **icônes** au lieu des numéros |
| 4 | Synthèse de sélection | passe **en haut** de la table |
| 5 | Inventaire | le niveau de la bouteille devient un curseur de 0 à 10 dixièmes |
| 6 | Sélecteur de lieu | visible seulement là où il veut dire quelque chose |
| 7 | Vocabulaire | **Recette**, **Carte**, **Tarification**, partout |
| 8 | Appartenance | une recette peut figurer sur **plusieurs cartes** |
| 9 | Recettes | « + Ingrédient » se distingue de « créer une référence » |
| 10 | Détails | crayon au lieu de « ÉD », interrupteurs maison au lieu des cases natives |

## Point 8 : la règle du prix, revue

La vague 2 interdisait à une recette d'appartenir à deux cartes, faute de quoi « quel prix s'applique » n'avait pas de réponse. L'interdiction saute, la question revient, il faut donc une règle explicite :

- **dans une carte**, le prix d'une recette est celui de la tarification active de cette carte ;
- **hors carte** (registre, comptoir, marges), une recette présente sur plusieurs cartes prend le prix de **la première carte dans l'ordre d'affichage**, et l'écran dit toujours de quelle carte vient le prix ;
- une recette sur aucune carte garde son prix propre.

Déterministe, explicable en une phrase, et visible à l'écran plutôt que devinée.
