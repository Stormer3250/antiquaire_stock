"""Le registre des mouvements : le stock est dérivé, jamais stocké."""

import sqlite3
from datetime import UTC, datetime

VALID_TYPES = {"reception", "comptage", "ajustement"}


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def stock_levels(conn: sqlite3.Connection, location_id: int | None = None) -> dict[int, float]:
    """Niveau par référence : dernier comptage (par id) + deltas postérieurs.

    location_id None ⇒ somme sur tous les lieux.
    """
    where, params = "", []
    if location_id is not None:
        where, params = "WHERE location_id = ?", [location_id]
    rows = conn.execute(
        f"SELECT ref_id, location_id, type, quantity FROM movements {where} ORDER BY id",
        params,
    )
    # ponytail: fold in Python — a bar logs a few movements a day, SQL windowing is overkill
    per_lieu: dict[tuple[int, int], float] = {}
    for r in rows:
        key = (r["ref_id"], r["location_id"])
        if r["type"] == "comptage":
            per_lieu[key] = r["quantity"]
        else:
            per_lieu[key] = per_lieu.get(key, 0.0) + r["quantity"]
    totals: dict[int, float] = {}
    for (ref_id, _), qty in per_lieu.items():
        totals[ref_id] = totals.get(ref_id, 0.0) + qty
    return totals


def record_movements(conn: sqlite3.Connection, lines: list[dict], *, source: str) -> int:
    """Insertion atomique d'un lot de mouvements. Une ligne mauvaise = tout annulé."""
    ts = now()
    try:
        for line in lines:
            if line["type"] not in VALID_TYPES:
                raise ValueError(f"type de mouvement inconnu: {line['type']}")
            conn.execute(
                "INSERT INTO movements (ref_id, location_id, type, quantity, source, note,"
                " created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    line["ref_id"],
                    line["location_id"],
                    line["type"],
                    line["quantity"],
                    source,
                    line.get("note", ""),
                    ts,
                ),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return len(lines)


def movement_history(
    conn: sqlite3.Connection,
    ref_id: int | None = None,
    location_id: int | None = None,
    limit: int = 50,
) -> list[dict]:
    clauses, params = [], []
    if ref_id is not None:
        clauses.append("ref_id = ?")
        params.append(ref_id)
    if location_id is not None:
        clauses.append("location_id = ?")
        params.append(location_id)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM movements {where} ORDER BY id DESC LIMIT ?", [*params, limit]
    ).fetchall()
    return [dict(r) for r in rows]
