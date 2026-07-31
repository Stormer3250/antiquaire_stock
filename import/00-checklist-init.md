# Initialisation de la cave : mode d'emploi

Fichiers générés depuis `Antiquaire Init.xlsx` (303 lignes), décisions du 2026-07-31.
Le tarif (prix d'achat, PDVC, TVA, degrés) est volontairement exclu pour l'instant.

## Étape 1 : renommer les lieux

Configuration → Lieux de stockage : renommer **Réserve → Cave** et **Comptoir → Haut**.

## Étape 2 : importer les références + stock Cave

Références → « Importer un fichier » → déposer `01-references-stock-cave.xlsx` (298 lignes).

- Les colonnes se mappent toutes seules.
- **Cocher « Créer les catégories inconnues »** : les 14 catégories du fichier
  (Whisky, Liqueur, Vodka, Soft, Bitter, Vins & Champagne, Vermouth, EDV Française,
  Rhum, Gin, Produit Maison, Batch, Amerique Sud, Alimentaire) se créent automatiquement.
- **« Stock compté sur » : Cave.**
- Valider : 298 références créées, 216 stocks Cave posés.
- Les fournisseurs (Murgier, Whisky Lodge, Metro) rejoignent automatiquement la liste.

## Étape 3 : importer le stock Haut

Même écran → déposer `02-stock-haut.xlsx` (154 lignes) → **« Stock compté sur » : Haut** →
valider. (Pas besoin de recocher les catégories : ce fichier n'en contient pas.)

## Étape 4 : créer à la main les 5 garnitures au kilo

Ces produits se pèsent, ils ne se comptent pas : « + Référence » → **Non suivie**,
et ajouter l'unité **kg** dans Configuration → Unités des non suivies.

| Nom | Unité | Fournisseur |
|---|---|---|
| Citron Jaune | kg | Metro |
| Citron Vert | kg | Metro |
| Gingembre | kg | Metro |
| Orange | kg | Metro |
| Pamplemousse | kg | Metro |

## Étape 5 : ménage

- Configuration → Catégories : supprimer les 7 catégories d'origine de l'app
  (Spiritueux, Liqueur*, Vin, Bière, Sirop & maison, Garniture & épices, Consommable)
  si elles ne servent pas — *attention, le fichier a sa propre « Liqueur », déjà créée
  à l'étape 2 si le nom diffère ; sinon elle a été réutilisée telle quelle.
- Garder « Garniture & épices » (les garnitures de l'étape 4 s'y rattachent) et
  « Consommable » si vous voulez chiffrer glace/verrerie dans les fiches cocktails.

## Corrections décidées, déjà appliquées dans les fichiers

- Noms et catégories nettoyés (espaces), « Sirop orgeat » (Produit Maison) renommé
  **Sirop orgeat maison** pour ne pas écraser celui du rayon Soft.
- La Quintinye Vermouth Royal B → catégorie **Vermouth** (était vide).
- Grappa di Bassano → **EDV Française** (catégorie « EDV » orpheline).
- Volumes corrigés : Fever Tree **20 cl** (était 200), Amaretto Adriatico **70 cl**
  (était 450), Armin 10 ans **70 cl** (était 300).

## À reprendre plus tard (avant le chantier tarifs)

1. **23 volumes posés à 70 cl par défaut** — à corriger sur chaque fiche :
   Aperol, Calle 23 Anejo, Campari, Chartreuse Mof Jaune, Château Montifaud XO,
   El Rey Zapoteco Mezcal, El Rey Zapoteco Mezcal Joven, Fee Brothers Celery Bitter,
   Granini, Hibiki, Italicus, Lillet Rouge, Havana Club Smoked, Mezcal Del Maguey
   Chichicapa, Milagro, Nikka Coffey Gin, Nikka Coffey Malt Whisky, Remi Landier
   Napoleon, Scotch Malt Whisky Society 9.104, Tanqueray Lovage, Jameson Black Barrel,
   Genepi Père Chartreux, Liqueur de Noix Chartreux.
2. **Les degrés sont vides sur les 303 lignes** — indispensables pour la part fiscale
   et les prix conseillés (droits non inclus par défaut).
3. Prix d'achat, marges par catégorie, dose par catégorie, régimes fiscaux : à définir
   au moment du chantier tarifs.
4. La colonne « Valeur du stock » du fichier d'origine est fausse (elle multiplie
   TTC × Cave × Haut) — ne pas s'y fier, l'app recalculera.
