import json
import sqlite3

import pytest

from antiquaire import db


def test_fresh_db_reaches_head_with_seeds(conn):
    assert conn.execute("PRAGMA user_version").fetchone()[0] >= 1
    cats = [r["nom"] for r in conn.execute("SELECT nom FROM categories ORDER BY position")]
    assert cats[0] == "Spiritueux" and "Consommable" in cats
    lieux = [r["nom"] for r in conn.execute("SELECT nom FROM locations ORDER BY position")]
    assert lieux == ["Réserve", "Comptoir"]
    keys = {r["key"] for r in conn.execute("SELECT key FROM settings")}
    assert keys == {"pricing", "rates", "lists"}


def test_migrate_is_idempotent(conn):
    v1 = db.migrate(conn)
    v2 = db.migrate(conn)
    assert v1 == v2


def _base_v1(tmp_path):
    """Une base au schéma d'origine, avec des migrations en retard."""
    import shutil

    staged = tmp_path / "migrations"
    staged.mkdir()
    shutil.copy(db.MIGRATIONS_DIR / "001_init.sql", staged)
    c = db.connect(tmp_path / "stock.db")
    db.migrate(c, staged)
    return c, staged


def test_une_migration_qui_echoue_ne_laisse_rien_derriere(tmp_path):
    """Tout ou rien : un script qui casse au milieu ne doit pas laisser sa moitié faite.

    Sans le BEGIN explicite, executescript auto-commite chaque instruction et la
    table ci-dessous survivrait, avec user_version resté à 1 : base irréparable.
    """
    c, staged = _base_v1(tmp_path)
    (staged / "002_cassee.sql").write_text(
        "CREATE TABLE moitie_faite (x);\nSELECT colonne_qui_n_existe_pas;\n"
    )

    with pytest.raises(RuntimeError, match="002_cassee"):
        db.migrate(c, staged)

    tables = {r["name"] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "moitie_faite" not in tables
    assert c.execute("PRAGMA user_version").fetchone()[0] == 1
    c.close()


def test_en_attente_detecte_une_base_en_retard(tmp_path, conn):
    c, _ = _base_v1(tmp_path)
    assert db.en_attente(c) is True  # base v1 face aux migrations livrées
    assert db.en_attente(conn) is False  # déjà à jour
    c.close()


def test_une_base_neuve_ne_declenche_pas_de_sauvegarde(tmp_path):
    c = db.connect(tmp_path / "neuve.db")
    assert db.en_attente(c) is False  # version 0 : rien à perdre
    c.close()


def test_la_base_est_sauvegardee_avant_migration(tmp_path):
    """Mise à jour d'une base peuplée : un instantané d'avant existe et est complet."""
    from antiquaire.main import create_app

    c, _ = _base_v1(tmp_path)
    c.execute("INSERT INTO cocktails (nom, created_at) VALUES ('Negroni', '2026-01-01')")
    c.commit()
    c.close()

    create_app(db_path=tmp_path / "stock.db", with_scheduler=False)

    avant = list((tmp_path / "backups").glob("avant-migration-*.db"))
    assert len(avant) == 1
    sauvegarde = db.connect(avant[0])
    assert sauvegarde.execute("PRAGMA user_version").fetchone()[0] == 1  # l'état d'AVANT
    assert sauvegarde.execute("SELECT nom FROM cocktails").fetchone()[0] == "Negroni"
    sauvegarde.close()


def test_foreign_keys_enforced(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO movements (ref_id, location_id, type, quantity, created_at)"
            " VALUES (999, 1, 'reception', 1, '2026-01-01T00:00:00')"
        )


def test_migration_002_adds_dose_and_fiscal_columns(conn):
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(refs)")}
    assert {"dose_cl", "alcoolise", "regime", "dom"} <= cols


def test_migration_002_adds_dom_rate(conn):
    rates = json.loads(conn.execute("SELECT value FROM settings WHERE key = 'rates'").fetchone()[0])
    assert rates["accise_dom"] == 903.51


def test_migration_002_backfills_alcoolise(tmp_path):
    """Le rattrapage : l'existant sans alcool sort alcoolise = 0, le reste à 1."""
    import shutil

    staged = tmp_path / "migrations"
    staged.mkdir()
    shutil.copy(db.MIGRATIONS_DIR / "001_init.sql", staged)
    c = db.connect(tmp_path / "backfill.db")
    db.migrate(c, staged)  # état d'avant la vague 2

    spirit = c.execute("SELECT id FROM categories WHERE regime = 'spiritueux'").fetchone()[0]
    aucun = c.execute("SELECT id FROM categories WHERE regime = 'aucun'").fetchone()[0]
    c.executemany(
        "INSERT INTO refs (nom, categorie_id, abv, created_at) VALUES (?, ?, ?, '2026-01-01')",
        [("Rhum", spirit, 40.0), ("Sirop", aucun, 0.0), ("Eau plate", spirit, 0.0)],
    )
    c.commit()

    shutil.copy(db.MIGRATIONS_DIR / "002_dose_fiscal.sql", staged)
    db.migrate(c, staged)

    rows = {r["nom"]: r["alcoolise"] for r in c.execute("SELECT nom, alcoolise FROM refs")}
    assert rows["Rhum"] == 1
    assert rows["Sirop"] == 0  # catégorie sans régime fiscal
    assert rows["Eau plate"] == 1  # degré vide = donnée manquante, pas un soft
    c.close()


def test_migration_005_menus(conn):
    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"menus", "menu_items", "tarifs", "tarif_prix"} <= tables


def test_a_recipe_can_appear_on_several_cartes(conn):
    """Depuis la 007 : plusieurs cartes, oui ; deux fois la même carte, non."""
    conn.execute("INSERT INTO menus (nom, created_at) VALUES ('Carte', '2026-01-01')")
    conn.execute("INSERT INTO menus (nom, created_at) VALUES ('Été', '2026-01-01')")
    conn.execute("INSERT INTO cocktails (nom, created_at) VALUES ('Negroni', '2026-01-01')")
    conn.execute("INSERT INTO menu_items (menu_id, cocktail_id) VALUES (1, 1)")
    conn.execute("INSERT INTO menu_items (menu_id, cocktail_id) VALUES (2, 1)")
    assert conn.execute("SELECT count(*) FROM menu_items").fetchone()[0] == 2
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO menu_items (menu_id, cocktail_id) VALUES (1, 1)")


def test_deleting_a_menu_keeps_its_cocktails(conn):
    conn.execute("INSERT INTO menus (nom, created_at) VALUES ('Carte', '2026-01-01')")
    conn.execute("INSERT INTO cocktails (nom, created_at) VALUES ('Negroni', '2026-01-01')")
    conn.execute("INSERT INTO menu_items (menu_id, cocktail_id) VALUES (1, 1)")
    conn.execute("INSERT INTO tarifs (menu_id, nom, created_at) VALUES (1, 'Été', '2026-01-01')")
    conn.execute("INSERT INTO tarif_prix (tarif_id, cocktail_id, prix_ttc) VALUES (1, 1, 14)")
    conn.commit()
    conn.execute("DELETE FROM menus WHERE id = 1")
    conn.commit()
    assert conn.execute("SELECT count(*) FROM cocktails").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM menu_items").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM tarifs").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM tarif_prix").fetchone()[0] == 0
