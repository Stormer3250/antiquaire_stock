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
    rates = json.loads(
        conn.execute("SELECT value FROM settings WHERE key = 'rates'").fetchone()[0]
    )
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
    assert rows["Sirop"] == 0       # catégorie sans régime fiscal
    assert rows["Eau plate"] == 0   # degré nul
    c.close()
