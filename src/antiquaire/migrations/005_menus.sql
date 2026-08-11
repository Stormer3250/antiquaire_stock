-- Menus et tarifications.
-- Un menu regroupe des fiches ; une tarification est une liste de prix posée sur ce
-- même menu. Les recettes sont partagées : changer un ingrédient re-chiffre toutes les
-- tarifications d'un coup. Aucun prix n'est recopié ailleurs.

CREATE TABLE menus (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

-- cocktail_id UNIQUE : une fiche appartient à un menu au plus. Sans cette règle,
-- « quel est son prix actif » n'a pas de réponse.
CREATE TABLE menu_items (
    id INTEGER PRIMARY KEY,
    menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    cocktail_id INTEGER NOT NULL UNIQUE REFERENCES cocktails(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tarifs (
    id INTEGER PRIMARY KEY,
    menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    actif INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX idx_tarifs_menu ON tarifs(menu_id, actif);

CREATE TABLE tarif_prix (
    id INTEGER PRIMARY KEY,
    tarif_id INTEGER NOT NULL REFERENCES tarifs(id) ON DELETE CASCADE,
    cocktail_id INTEGER NOT NULL REFERENCES cocktails(id) ON DELETE CASCADE,
    prix_ttc REAL NOT NULL,
    UNIQUE (tarif_id, cocktail_id)
);
