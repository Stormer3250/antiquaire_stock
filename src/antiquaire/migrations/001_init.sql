CREATE TABLE locations (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL UNIQUE,
    dose_cl REAL NOT NULL DEFAULT 5,
    regime TEXT NOT NULL DEFAULT 'aucun'
        CHECK (regime IN ('spiritueux','vin','mousseux','biere','intermediaire','aucun')),
    marge_pct REAL NOT NULL DEFAULT 80,
    tva_pct REAL NOT NULL DEFAULT 20,
    position INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE refs (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    marque TEXT NOT NULL DEFAULT '',
    categorie_id INTEGER NOT NULL REFERENCES categories(id),
    fournisseur TEXT NOT NULL DEFAULT '',
    vol_cl REAL NOT NULL DEFAULT 70,
    abv REAL NOT NULL DEFAULT 0,
    achat_ht REAL NOT NULL DEFAULT 0,
    marge_pct REAL,                 -- NULL = category default
    prix_ttc REAL,                  -- manual override; NULL = computed
    seuil REAL NOT NULL DEFAULT 0,
    par_target REAL NOT NULL DEFAULT 0,
    droits_inclus INTEGER NOT NULL DEFAULT 0,
    suivi INTEGER NOT NULL DEFAULT 1,
    unite TEXT NOT NULL DEFAULT 'pièce',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE movements (
    id INTEGER PRIMARY KEY,
    ref_id INTEGER NOT NULL REFERENCES refs(id),
    location_id INTEGER NOT NULL REFERENCES locations(id),
    type TEXT NOT NULL CHECK (type IN ('reception','comptage','ajustement')),
    quantity REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'manuel',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX idx_movements_ref_loc ON movements(ref_id, location_id, id);

CREATE TABLE cocktails (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    famille TEXT NOT NULL DEFAULT '',
    verre TEXT NOT NULL DEFAULT '',
    prix_ttc REAL NOT NULL DEFAULT 14,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE cocktail_ings (
    id INTEGER PRIMARY KEY,
    cocktail_id INTEGER NOT NULL REFERENCES cocktails(id) ON DELETE CASCADE,
    ref_id INTEGER NOT NULL REFERENCES refs(id),
    qty REAL NOT NULL DEFAULT 0,    -- cl if ref suivi, unités otherwise
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    filename TEXT NOT NULL,
    line_count INTEGER NOT NULL DEFAULT 0,
    created_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL            -- JSON
);

INSERT INTO locations (nom, position) VALUES ('Réserve', 0), ('Comptoir', 1);

INSERT INTO categories (nom, dose_cl, regime, marge_pct, tva_pct, position) VALUES
    ('Spiritueux', 5, 'spiritueux', 80, 20, 0),
    ('Liqueur', 5, 'spiritueux', 80, 20, 1),
    ('Vin', 12, 'vin', 78, 20, 2),
    ('Bière', 33, 'biere', 76, 20, 3),
    ('Sirop & maison', 3, 'aucun', 85, 10, 4),
    ('Garniture & épices', 1, 'aucun', 85, 20, 5),
    ('Consommable', 1, 'aucun', 80, 20, 6);

INSERT INTO settings (key, value) VALUES
    ('pricing', '{"cible": 80, "min": 75, "arrondi": 0.5}'),
    ('rates', '{"accise": 1954, "ss": 625, "vin": 3.99, "mousseux": 9.89, "biere": 7.82}'),
    ('lists', '{"fournisseurs": ["Dugas", "Maison du Whisky", "Vinifera", "Bièropholie", "Marché", "Metro", "Maison"], "familles": ["Signature", "Classique", "Au verre", "Sans alcool"], "verres": ["Coupe givrée", "Old fashioned", "Highball", "Flûte", "Nick & Nora"], "unites": ["branche", "trait", "zeste", "pincée", "pièce", "feuille"]}');
