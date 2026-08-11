-- Barème daté. Les taux d'accise changent chaque année : un taux n'est pas un nombre,
-- c'est un nombre valable à partir d'une date. Sans cela, re-chiffrer une carte de
-- l'an dernier donne un résultat faux, et personne ne peut le vérifier.
CREATE TABLE bareme_taux (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    valeur REAL NOT NULL,
    effet_le TEXT NOT NULL,              -- AAAA-MM-JJ
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (code, effet_le)
);
CREATE INDEX idx_bareme_code ON bareme_taux(code, effet_le);

-- Reprise des taux en place. On les fait valoir « depuis toujours » : c'est la seule
-- chose vraie, ils sont les seuls que nos registres aient jamais connus.
INSERT INTO bareme_taux (code, valeur, effet_le, note, created_at)
SELECT 'accise', json_extract(value, '$.accise'), '2000-01-01', 'barème initial', '2026-08-11'
FROM settings WHERE key = 'rates' AND json_extract(value, '$.accise') IS NOT NULL;
INSERT INTO bareme_taux (code, valeur, effet_le, note, created_at)
SELECT 'accise_dom', json_extract(value, '$.accise_dom'), '2000-01-01', 'barème initial', '2026-08-11'
FROM settings WHERE key = 'rates' AND json_extract(value, '$.accise_dom') IS NOT NULL;
INSERT INTO bareme_taux (code, valeur, effet_le, note, created_at)
SELECT 'ss', json_extract(value, '$.ss'), '2000-01-01', 'barème initial', '2026-08-11'
FROM settings WHERE key = 'rates' AND json_extract(value, '$.ss') IS NOT NULL;
INSERT INTO bareme_taux (code, valeur, effet_le, note, created_at)
SELECT 'vin', json_extract(value, '$.vin'), '2000-01-01', 'barème initial', '2026-08-11'
FROM settings WHERE key = 'rates' AND json_extract(value, '$.vin') IS NOT NULL;
INSERT INTO bareme_taux (code, valeur, effet_le, note, created_at)
SELECT 'mousseux', json_extract(value, '$.mousseux'), '2000-01-01', 'barème initial', '2026-08-11'
FROM settings WHERE key = 'rates' AND json_extract(value, '$.mousseux') IS NOT NULL;
INSERT INTO bareme_taux (code, valeur, effet_le, note, created_at)
SELECT 'biere', json_extract(value, '$.biere'), '2000-01-01', 'barème initial', '2026-08-11'
FROM settings WHERE key = 'rates' AND json_extract(value, '$.biere') IS NOT NULL;
