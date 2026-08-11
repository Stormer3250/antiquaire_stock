-- Dose par référence (NULL = dose de la catégorie) et cascade fiscale explicite.
ALTER TABLE refs ADD COLUMN dose_cl REAL;
ALTER TABLE refs ADD COLUMN alcoolise INTEGER NOT NULL DEFAULT 1;
ALTER TABLE refs ADD COLUMN regime TEXT;
ALTER TABLE refs ADD COLUMN dom INTEGER NOT NULL DEFAULT 0;

-- Reprise de l'existant : une référence dont la catégorie n'a aucun régime
-- fiscal n'est pas alcoolisée. Un degré vide n'est PAS un critère : c'est une
-- donnée manquante, pas une déclaration d'absence d'alcool (et les droits sont
-- de toute façon nuls tant que le degré vaut zéro).
UPDATE refs SET alcoolise = 0
WHERE categorie_id IN (SELECT id FROM categories WHERE regime = 'aucun');

-- Taux réduit applicable au rhum traditionnel des DOM, éditable dans le barème.
UPDATE settings
SET value = json_set(value, '$.accise_dom', 903.51)
WHERE key = 'rates';
