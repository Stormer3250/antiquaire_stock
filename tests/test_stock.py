import sqlite3

import pytest

from antiquaire import stock


@pytest.fixture
def ref_id(conn):
    cur = conn.execute(
        "INSERT INTO refs (nom, categorie_id, created_at) VALUES ('Gin', 1, '2026-01-01')"
    )
    conn.commit()
    return cur.lastrowid


RESERVE, COMPTOIR = 1, 2


def test_deltas_from_zero(conn, ref_id):
    stock.record_movements(
        conn,
        [
            {"ref_id": ref_id, "location_id": RESERVE, "type": "reception", "quantity": 6},
            {"ref_id": ref_id, "location_id": RESERVE, "type": "ajustement", "quantity": -1},
        ],
        source="manuel",
    )
    assert stock.stock_levels(conn, RESERVE)[ref_id] == 5


def test_comptage_resets_then_deltas_apply(conn, ref_id):
    stock.record_movements(
        conn,
        [{"ref_id": ref_id, "location_id": RESERVE, "type": "reception", "quantity": 10}],
        source="manuel",
    )
    stock.record_movements(
        conn,
        [{"ref_id": ref_id, "location_id": RESERVE, "type": "comptage", "quantity": 4.75}],
        source="inventaire",
    )
    stock.record_movements(
        conn,
        [{"ref_id": ref_id, "location_id": RESERVE, "type": "reception", "quantity": 6}],
        source="manuel",
    )
    assert stock.stock_levels(conn, RESERVE)[ref_id] == 10.75


def test_per_lieu_isolation_and_total(conn, ref_id):
    stock.record_movements(
        conn,
        [
            {"ref_id": ref_id, "location_id": RESERVE, "type": "comptage", "quantity": 6},
            {"ref_id": ref_id, "location_id": COMPTOIR, "type": "comptage", "quantity": 1.5},
        ],
        source="inventaire",
    )
    assert stock.stock_levels(conn, RESERVE)[ref_id] == 6
    assert stock.stock_levels(conn, COMPTOIR)[ref_id] == 1.5
    assert stock.stock_levels(conn)[ref_id] == 7.5


def test_id_order_beats_timestamp(conn, ref_id):
    # comptage inserted AFTER a reception but with an earlier timestamp still wins by id
    conn.execute(
        "INSERT INTO movements (ref_id, location_id, type, quantity, created_at)"
        " VALUES (?, ?, 'reception', 3, '2026-07-30T00:00:00')",
        (ref_id, RESERVE),
    )
    conn.execute(
        "INSERT INTO movements (ref_id, location_id, type, quantity, created_at)"
        " VALUES (?, ?, 'comptage', 2, '2026-01-01T00:00:00')",
        (ref_id, RESERVE),
    )
    conn.commit()
    assert stock.stock_levels(conn, RESERVE)[ref_id] == 2


def test_bulk_is_atomic(conn, ref_id):
    with pytest.raises(sqlite3.IntegrityError):
        stock.record_movements(
            conn,
            [
                {"ref_id": ref_id, "location_id": RESERVE, "type": "reception", "quantity": 5},
                {"ref_id": 9999, "location_id": RESERVE, "type": "reception", "quantity": 1},
            ],
            source="manuel",
        )
    assert stock.stock_levels(conn, RESERVE).get(ref_id, 0) == 0


def test_history_filters(conn, ref_id):
    stock.record_movements(
        conn,
        [
            {"ref_id": ref_id, "location_id": RESERVE, "type": "reception", "quantity": 2},
            {"ref_id": ref_id, "location_id": COMPTOIR, "type": "ajustement", "quantity": -1},
        ],
        source="manuel",
    )
    hist = stock.movement_history(conn, ref_id=ref_id, location_id=COMPTOIR)
    assert len(hist) == 1 and hist[0]["type"] == "ajustement"
