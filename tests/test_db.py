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
