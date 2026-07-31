"""Routes JSON. Fines : parse → stock/pricing → réponse. La logique vit ailleurs."""

import json
import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from antiquaire import db, pricing, stock

router = APIRouter()


def get_conn(request: Request) -> Iterator[sqlite3.Connection]:
    conn = db.connect(request.app.state.db_path)
    try:
        yield conn
    finally:
        conn.close()


Conn = Annotated[sqlite3.Connection, Depends(get_conn)]


# ---------- helpers ----------


def load_settings(conn: sqlite3.Connection) -> dict:
    return {
        r["key"]: json.loads(r["value"]) for r in conn.execute("SELECT key, value FROM settings")
    }


def load_categories(conn: sqlite3.Connection) -> dict[int, dict]:
    rows = conn.execute("SELECT * FROM categories WHERE active = 1 ORDER BY position, id")
    return {r["id"]: dict(r) for r in rows}


def parse_lieu(lieu: str | None) -> int | None:
    if lieu in (None, "", "tous"):
        return None
    return int(lieu)


def effective_marge(ref: dict, cat: dict) -> float:
    return ref["marge_pct"] if ref["marge_pct"] is not None else cat["marge_pct"]


def serialize_ref(ref: dict, cat: dict, settings: dict, niveau: float) -> dict:
    """Une ligne du grand registre, avec tout le calcul prix/marge fait côté serveur."""
    suivi = bool(ref["suivi"])
    out = {
        "id": ref["id"],
        "nom": ref["nom"],
        "marque": ref["marque"],
        "categorie_id": ref["categorie_id"],
        "categorie_nom": cat["nom"],
        "fournisseur": ref["fournisseur"],
        "vol_cl": ref["vol_cl"],
        "abv": ref["abv"],
        "achat_ht": ref["achat_ht"],
        "seuil": ref["seuil"],
        "par_target": ref["par_target"],
        "droits_inclus": bool(ref["droits_inclus"]),
        "suivi": suivi,
        "unite": ref["unite"],
        "marge": effective_marge(ref, cat),
        "marge_custom": ref["marge_pct"] is not None,
        "dose_cl": cat["dose_cl"],
    }
    if not suivi:
        out.update(
            {
                "stock": None,
                "valeur": None,
                "cout_dose": ref["achat_ht"],
                "prix": None,
                "marge_reelle": None,
                "override": False,
                "low": False,
            }
        )
        return out
    pr, rates = settings["pricing"], settings["rates"]
    cost = pricing.cost_per_dose(
        ref["achat_ht"],
        ref["vol_cl"],
        cat["dose_cl"],
        droits_inclus=bool(ref["droits_inclus"]),
        regime=cat["regime"],
        abv=ref["abv"],
        rates=rates,
    )
    override = ref["prix_ttc"] is not None
    prix = (
        ref["prix_ttc"]
        if override
        else pricing.price_for_margin(cost, out["marge"], cat["tva_pct"], pr["arrondi"])
    )
    out.update(
        {
            "stock": niveau,
            "valeur": niveau * ref["achat_ht"],
            "cout_dose": cost,
            "prix": prix,
            "marge_reelle": pricing.real_margin(cost, prix, cat["tva_pct"]),
            "override": override,
            "low": niveau <= ref["seuil"],
        }
    )
    return out


def stock_rows(conn: sqlite3.Connection, lieu: int | None) -> list[dict]:
    settings = load_settings(conn)
    cats = load_categories(conn)
    levels = stock.stock_levels(conn, lieu)
    refs = conn.execute("SELECT * FROM refs WHERE active = 1 ORDER BY nom").fetchall()
    all_cats = {
        r["id"]: dict(r) for r in conn.execute("SELECT * FROM categories")
    }  # inclut inactives pour ne jamais planter une ref orpheline
    return [
        serialize_ref(
            dict(r),
            cats.get(r["categorie_id"], all_cats[r["categorie_id"]]),
            settings,
            levels.get(r["id"], 0.0),
        )
        for r in refs
    ]


def get_ref_or_404(conn: sqlite3.Connection, ref_id: int) -> dict:
    row = conn.execute("SELECT * FROM refs WHERE id = ? AND active = 1", (ref_id,)).fetchone()
    if not row:
        raise HTTPException(404, "référence inconnue")
    return dict(row)


# ---------- bootstrap / stock / orders ----------


@router.get("/state")
def api_state(conn: Conn):
    settings = load_settings(conn)
    return {
        "pricing": settings["pricing"],
        "rates": settings["rates"],
        "lists": settings["lists"],
        "categories": list(load_categories(conn).values()),
        "locations": [
            dict(r)
            for r in conn.execute("SELECT * FROM locations WHERE active = 1 ORDER BY position, id")
        ],
    }


@router.get("/stock")
def api_stock(conn: Conn, lieu: str | None = None):
    return {"refs": stock_rows(conn, parse_lieu(lieu))}


@router.get("/orders")
def api_orders(conn: Conn, lieu: str | None = None):
    rows = [r for r in stock_rows(conn, parse_lieu(lieu)) if r["suivi"]]
    return {"groups": pricing.order_suggestions(rows)}


# ---------- refs ----------

REF_FIELDS = {
    "nom",
    "marque",
    "categorie_id",
    "fournisseur",
    "vol_cl",
    "abv",
    "achat_ht",
    "marge_pct",
    "prix_ttc",
    "seuil",
    "par_target",
    "droits_inclus",
    "suivi",
    "unite",
}


@router.post("/refs")
def create_ref(conn: Conn, body: dict = Body(...)):
    if not body.get("nom"):
        raise HTTPException(422, "nom obligatoire")
    if not conn.execute(
        "SELECT 1 FROM categories WHERE id = ?", (body.get("categorie_id"),)
    ).fetchone():
        raise HTTPException(422, "catégorie inconnue")
    fields = {k: v for k, v in body.items() if k in REF_FIELDS}
    fields.setdefault("suivi", True)
    fields["droits_inclus"] = bool(fields.get("droits_inclus", False))
    cols = ", ".join(fields)
    marks = ", ".join("?" for _ in fields)
    cur = conn.execute(
        f"INSERT INTO refs ({cols}, created_at) VALUES ({marks}, ?)",
        [*fields.values(), stock.now()],
    )
    conn.commit()
    return {"id": cur.lastrowid}


@router.patch("/refs/{ref_id}")
def patch_ref(ref_id: int, conn: Conn, body: dict = Body(...)):
    get_ref_or_404(conn, ref_id)
    fields = {k: v for k, v in body.items() if k in REF_FIELDS}
    if not fields:
        raise HTTPException(422, "aucun champ modifiable")
    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE refs SET {sets} WHERE id = ?", [*fields.values(), ref_id])
    conn.commit()
    return {"ok": True}


@router.delete("/refs/{ref_id}")
def delete_ref(ref_id: int, conn: Conn):
    get_ref_or_404(conn, ref_id)
    conn.execute("UPDATE refs SET active = 0 WHERE id = ?", (ref_id,))
    conn.commit()
    return {"ok": True}


@router.get("/refs/{ref_id}")
def fiche(ref_id: int, conn: Conn, lieu: str | None = None):
    ref = get_ref_or_404(conn, ref_id)
    settings = load_settings(conn)
    cat = dict(
        conn.execute("SELECT * FROM categories WHERE id = ?", (ref["categorie_id"],)).fetchone()
    )
    lieu_id = parse_lieu(lieu)
    niveau = stock.stock_levels(conn, lieu_id).get(ref_id, 0.0)
    base = serialize_ref(ref, cat, settings, niveau)
    f = pricing.fiscal_per_dose(cat["regime"], ref["abv"], cat["dose_cl"], settings["rates"])
    doses = pricing.doses_per_bottle(ref["vol_cl"], cat["dose_cl"])
    base.update(
        {
            "doses_par_bouteille": doses,
            "cout_dose_base": ref["achat_ht"] / doses if doses else 0.0,
            "fiscal": {
                "accise": f.accise,
                "ss": f.ss,
                "cl_alcool_pur": f.hlap * 100000,
                "regime": cat["regime"],
            },
            "prix_ttc_override": ref["prix_ttc"],
            "tva_pct": cat["tva_pct"],
            "pricing": settings["pricing"],
            "stock_total": stock.stock_levels(conn).get(ref_id, 0.0),
        }
    )
    return base


# ---------- movements ----------


@router.post("/movements/bulk")
def movements_bulk(conn: Conn, body: dict = Body(...)):
    lieu = body.get("location_id")
    lines = body.get("lines", [])
    if not lieu or not lines:
        raise HTTPException(422, "location_id et lines obligatoires")
    try:
        count = stock.record_movements(
            conn,
            [
                {
                    "ref_id": ln["ref_id"],
                    "location_id": lieu,
                    "type": ln["type"],
                    "quantity": float(ln["quantity"]),
                    "note": ln.get("note", ""),
                }
                for ln in lines
            ],
            source=body.get("source", "manuel"),
        )
    except (KeyError, ValueError, TypeError) as e:
        raise HTTPException(422, f"ligne invalide: {e}") from e
    except sqlite3.IntegrityError as e:
        raise HTTPException(422, f"référence ou lieu inconnu: {e}") from e
    return {"ok": True, "count": count}


@router.get("/movements")
def movements_list(conn: Conn, ref: int | None = None, lieu: str | None = None, limit: int = 50):
    return {
        "movements": stock.movement_history(
            conn, ref_id=ref, location_id=parse_lieu(lieu), limit=limit
        )
    }


# ---------- health ----------


@router.get("/health")
def health(conn: Conn):
    db_ok = conn.execute("SELECT count(*) FROM settings").fetchone()[0] >= 3
    return {"ok": True, "db_ok": db_ok, "last_backup_at": None}
