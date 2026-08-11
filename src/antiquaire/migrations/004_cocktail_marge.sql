-- Une fiche peut porter sa propre marge cible, ou voir son prix figé à la main.
-- prix_fixe sert deux fois : le prix « signature » qu'on ne discute pas, et le verrou
-- que l'optimiseur de tarification devra respecter.
ALTER TABLE cocktails ADD COLUMN marge_pct REAL;                        -- NULL = cible maison
ALTER TABLE cocktails ADD COLUMN prix_fixe INTEGER NOT NULL DEFAULT 0;
