-- Dose par référence (NULL = dose de la catégorie) et cascade fiscale explicite.
ALTER TABLE refs ADD COLUMN dose_cl REAL;
ALTER TABLE refs ADD COLUMN alcoolise INTEGER NOT NULL DEFAULT 1;
ALTER TABLE refs ADD COLUMN regime TEXT;
ALTER TABLE refs ADD COLUMN dom INTEGER NOT NULL DEFAULT 0;

-- Reprise de l'existant : une référence dont la catégorie n'a aucun régime
-- fiscal, ou dont le degré est nul, n'est pas alcoolisée.
UPDATE refs SET alcoolise = 0
WHERE abv <= 0
   OR categorie_id IN (SELECT id FROM categories WHERE regime = 'aucun');

-- Taux réduit applicable au rhum traditionnel des DOM, éditable dans le barème.
UPDATE settings
SET value = json_set(value, '$.accise_dom', 903.51)
WHERE key = 'rates';
