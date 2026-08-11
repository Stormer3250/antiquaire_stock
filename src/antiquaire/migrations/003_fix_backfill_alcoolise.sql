-- Correction du rattrapage de la 002 : elle éteignait « alcoolise » sur les
-- références au degré vide. Or un degré manquant est une donnée à saisir, pas
-- un soft. On rallume tout ce qui appartient à une catégorie fiscalement
-- alcoolisée ; les vrais softs (catégorie « aucun ») restent éteints.
UPDATE refs SET alcoolise = 1
WHERE alcoolise = 0
  AND categorie_id IN (SELECT id FROM categories WHERE regime <> 'aucun');
