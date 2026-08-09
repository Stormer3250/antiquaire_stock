# L'Antiquaire — Cave & comptoir

Gestion de stock, de coûts et de prix pour le bar : cave par lieu, inventaire à la
bouteille, fiches cocktails chiffrées, part fiscale des doses, prix conseillés à la marge
cible, import Excel et sauvegardes automatiques. Tout tourne **sur le Mac du bar**, sans
internet, sans compte, sans abonnement.

## Utilisation quotidienne (personnel)

Double-cliquer le raccourci **« L'Antiquaire »** sur le Bureau — l'application s'ouvre
dans le navigateur. Il n'y a rien à lancer ni à éteindre : le service tourne en
permanence et redémarre tout seul (même après un redémarrage du Mac).

## Installation / mise à jour (mainteneur)

```bash
git clone https://github.com/Stormer3250/antiquaire_stock.git && cd antiquaire_stock
./scripts/setup.sh        # installation complète (uv, dépendances, service, raccourci)
```

Mise à jour :

```bash
git pull && ./scripts/setup.sh
```

Le script est idempotent : il installe `uv` si besoin, synchronise l'environnement Python
verrouillé, (ré)installe le service launchd `com.antiquaire.stock` (port 8765, écoute
uniquement en local) et vérifie que l'application répond.

## Données & sauvegardes

Tout vit dans **`~/AntiquaireStock/`** :

| Dossier | Contenu |
|---|---|
| `stock.db` | la base (SQLite, un seul fichier) |
| `backups/` | instantanés quotidiens `stock-AAAA-MM-JJ.db` (30 jours + 12 mois de « premiers du mois ») |
| `exports/` | exports CSV téléchargés |
| `logs/` | journaux du service |

- **Sauvegarde automatique** chaque nuit ; « Sauvegarder maintenant » dans Configuration.
- **Restaurer** : Configuration → Sauvegardes → Restaurer. L'état courant est d'abord mis
  de côté (`avant-restauration-…`), donc l'opération est annulable.
- Chaque instantané est une **base complète et autonome** : copiable sur une clé USB,
  ouvrable avec n'importe quel outil SQLite.
- **Export CSV** : Configuration → « Exporter en CSV » (toutes les tables + niveaux de stock).

## Démo en ligne (VPS, pas le bar)

Une copie de démonstration tourne sur le serveur : <https://antiquaire.srv1493964.hstgr.cloud>.
Elle n'a rien à voir avec le Mac du bar (base séparée dans un volume Docker).

L'accès est géré par **Command Center** : le navigateur affiche un code court, on l'approuve
depuis le téléphone, et la session obtenue ne donne accès qu'à cette application, pendant
deux heures. Aucun mot de passe à transmettre, rien à configurer ici.

```bash
demo antiquaire_stock                  # allumer (ou l'allumer depuis /access sur le téléphone)
demo antiquaire_stock down             # éteindre, les données restent
python3 scripts/seed_demo.py http://<ip-du-conteneur>:8000   # remplir une base vide
```

Remettre la démo à zéro : `docker compose down -v`, puis `docker compose up -d --build` et le
script de remplissage.

## Développement

```bash
uv sync
uv run uvicorn --factory antiquaire.main:create_app --reload   # http://127.0.0.1:8000
uv run pytest && uv run ruff check .
```

Architecture et décisions : `docs/superpowers/specs/2026-07-31-antiquaire-stock-architecture-design.md`.
Maquette d'origine : `design/Stock Pingouin.dc.html`.
