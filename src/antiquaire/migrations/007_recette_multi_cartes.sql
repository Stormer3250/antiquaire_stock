-- Une recette peut figurer sur PLUSIEURS cartes.
--
-- La vague 2 l'interdisait pour que « quel prix s'applique » ait une réponse. La règle
-- devient : dans une carte, le prix vient de la tarification active de cette carte ;
-- hors carte, c'est la première carte dans l'ordre d'affichage qui donne le prix, et
-- l'écran dit toujours de laquelle il vient.
--
-- SQLite ne sait pas retirer une contrainte : on recrée la table.
CREATE TABLE menu_items_nouveau (
    id INTEGER PRIMARY KEY,
    menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    cocktail_id INTEGER NOT NULL REFERENCES cocktails(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0
);
INSERT INTO menu_items_nouveau (id, menu_id, cocktail_id, position)
SELECT id, menu_id, cocktail_id, position FROM menu_items;
DROP TABLE menu_items;
ALTER TABLE menu_items_nouveau RENAME TO menu_items;

-- Deux fois la même recette DANS la même carte reste une erreur.
CREATE UNIQUE INDEX idx_menu_items_unique ON menu_items(menu_id, cocktail_id);
CREATE INDEX idx_menu_items_cocktail ON menu_items(cocktail_id);
