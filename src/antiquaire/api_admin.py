"""Routes cocktails, réglages, catégories et lieux."""

import json
import sqlite3

from fastapi import APIRouter, Body, HTTPException

from antiquaire import pricing, stock
from antiquaire.api import Conn, load_settings, parse_lieu

router = APIRouter()


# ---------- cocktails ----------


def cost_per_cl(ref: dict, cat: dict, rates: dict) -> float:
    """€ pour 1 cl d'une référence suivie, droits compris si nécessaire."""
    return pricing.cost_per_dose(
        ref["achat_ht"],
        ref["vol_cl"],
        1.0,
        droits_inclus=bool(ref["droits_inclus"]),
        regime=pricing.effective_regime(ref, cat),
        abv=ref["abv"],
        rates=rates,
        dom=bool(ref.get("dom", 0)),
    )


def serialize_cocktail(
    conn: sqlite3.Connection, cocktail: dict, settings: dict, levels: dict[int, float]
) -> dict:
    rates, pr = settings["rates"], settings["pricing"]
    ing_rows = conn.execute(
        """SELECT ci.id, ci.ref_id, ci.qty, r.nom, r.suivi, r.unite, r.vol_cl, r.achat_ht,
                  r.abv, r.droits_inclus, r.active, r.alcoolise, r.regime, r.dom,
                  c.regime AS cat_regime, c.nom AS categorie_nom
           FROM cocktail_ings ci
           JOIN refs r ON r.id = ci.ref_id
           JOIN categories c ON c.id = r.categorie_id
           WHERE ci.cocktail_id = ? ORDER BY ci.position, ci.id""",
        (cocktail["id"],),
    ).fetchall()
    ings, cost_lines, feas_lines = [], [], []
    for row in ing_rows:
        r = dict(row)
        r_cat = {"regime": r["cat_regime"]}  # cost_per_cl attend une catégorie à part
        unit_cost = cost_per_cl(r, r_cat, rates) if r["suivi"] else r["achat_ht"]
        line_cost = unit_cost * r["qty"]
        cost_lines.append({"cost_per_unit": unit_cost, "qty": r["qty"]})
        if r["suivi"] and r["qty"] > 0:
            feas_lines.append(
                {
                    "nom": r["nom"],
                    "stock": levels.get(r["ref_id"], 0.0),
                    "vol_cl": r["vol_cl"],
                    "qty_cl": r["qty"],
                }
            )
        ings.append(
            {
                "id": r["id"],
                "ref_id": r["ref_id"],
                "qty": r["qty"],
                "nom": r["nom"],
                "suivi": bool(r["suivi"]),
                "unite": r["unite"],
                "categorie_nom": r["categorie_nom"],
                "ref_active": bool(r["active"]),
                "cost": line_cost,
            }
        )
    cost = pricing.cocktail_cost(cost_lines)
    prix = cocktail["prix_ttc"]
    ht = prix / 1.2
    marge = (ht - cost) / ht * 100 if ht > 0 else 0.0
    feas = pricing.feasibility(feas_lines)
    return {
        "id": cocktail["id"],
        "nom": cocktail["nom"],
        "famille": cocktail["famille"],
        "verre": cocktail["verre"],
        "description": cocktail["description"],
        "created_at": cocktail["created_at"],
        "prix_ttc": prix,
        "ings": ings,
        "cost": cost,
        "prix_ht": ht,
        "marge": marge,
        "tva": prix - ht,
        "ok": marge >= pr["min"],
        "suggested": pricing.suggested_cocktail_price(cost, pr["cible"], pr["arrondi"]),
        "feasibility": {"services": feas[0], "limitant": feas[1]} if feas else None,
    }


@router.get("/cocktails")
def cocktails_list(conn: Conn, lieu: str | None = None):
    settings = load_settings(conn)
    levels = stock.stock_levels(conn, parse_lieu(lieu))
    rows = conn.execute("SELECT * FROM cocktails WHERE active = 1 ORDER BY position, id").fetchall()
    return {"cocktails": [serialize_cocktail(conn, dict(r), settings, levels) for r in rows]}


@router.post("/cocktails")
def cocktail_create(conn: Conn, body: dict = Body(default={})):
    lists = load_settings(conn)["lists"]
    cur = conn.execute(
        "INSERT INTO cocktails (nom, famille, verre, prix_ttc, description, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (
            body.get("nom") or "Nouvelle fiche",
            body.get("famille") or (lists["familles"][0] if lists["familles"] else ""),
            body.get("verre") or (lists["verres"][0] if lists["verres"] else ""),
            body.get("prix_ttc", 14),
            body.get("description", ""),
            stock.now(),
        ),
    )
    conn.commit()
    return {"id": cur.lastrowid}


def get_cocktail_or_404(conn: sqlite3.Connection, cid: int) -> dict:
    row = conn.execute("SELECT * FROM cocktails WHERE id = ? AND active = 1", (cid,)).fetchone()
    if not row:
        raise HTTPException(404, "fiche inconnue")
    return dict(row)


@router.patch("/cocktails/{cid}")
def cocktail_patch(cid: int, conn: Conn, body: dict = Body(...)):
    get_cocktail_or_404(conn, cid)
    fields = {
        k: v
        for k, v in body.items()
        if k in {"nom", "famille", "verre", "prix_ttc", "description", "position"}
    }
    try:
        if fields:
            sets = ", ".join(f"{k} = ?" for k in fields)
            conn.execute(f"UPDATE cocktails SET {sets} WHERE id = ?", [*fields.values(), cid])
        if "ings" in body:
            conn.execute("DELETE FROM cocktail_ings WHERE cocktail_id = ?", (cid,))
            for pos, ing in enumerate(body["ings"]):
                conn.execute(
                    "INSERT INTO cocktail_ings (cocktail_id, ref_id, qty, position)"
                    " VALUES (?, ?, ?, ?)",
                    (cid, ing["ref_id"], float(ing.get("qty", 0)), pos),
                )
        conn.commit()
    except (sqlite3.IntegrityError, KeyError, TypeError, ValueError) as e:
        conn.rollback()
        raise HTTPException(422, f"ingrédient invalide: {e}") from e
    return {"ok": True}


@router.delete("/cocktails/{cid}")
def cocktail_delete(cid: int, conn: Conn):
    get_cocktail_or_404(conn, cid)
    conn.execute("UPDATE cocktails SET active = 0 WHERE id = ?", (cid,))
    conn.commit()
    return {"ok": True}


# ---------- réglages ----------


@router.patch("/settings")
def settings_patch(conn: Conn, body: dict = Body(...)):
    current = load_settings(conn)
    for key in ("pricing", "rates", "lists"):
        if key in body:
            if not isinstance(body[key], dict):
                raise HTTPException(422, f"{key} doit être un objet")
            current[key] = {**current[key], **body[key]}
            conn.execute(
                "UPDATE settings SET value = ? WHERE key = ?", (json.dumps(current[key]), key)
            )
    conn.commit()
    return {"ok": True}


# ---------- catégories ----------

CAT_FIELDS = {"nom", "dose_cl", "regime", "marge_pct", "tva_pct", "position"}


@router.post("/categories")
def category_create(conn: Conn, body: dict = Body(...)):
    if not body.get("nom"):
        raise HTTPException(422, "nom obligatoire")
    fields = {k: v for k, v in body.items() if k in CAT_FIELDS}
    cols = ", ".join(fields)
    marks = ", ".join("?" for _ in fields)
    try:
        cur = conn.execute(
            f"INSERT INTO categories ({cols}) VALUES ({marks})", list(fields.values())
        )
        conn.commit()
    except sqlite3.IntegrityError as e:
        raise HTTPException(422, f"catégorie invalide: {e}") from e
    return {"id": cur.lastrowid}


@router.patch("/categories/{cat_id}")
def category_patch(cat_id: int, conn: Conn, body: dict = Body(...)):
    fields = {k: v for k, v in body.items() if k in CAT_FIELDS}
    if not fields:
        raise HTTPException(422, "aucun champ modifiable")
    sets = ", ".join(f"{k} = ?" for k in fields)
    try:
        conn.execute(f"UPDATE categories SET {sets} WHERE id = ?", [*fields.values(), cat_id])
        conn.commit()
    except sqlite3.IntegrityError as e:
        raise HTTPException(422, f"catégorie invalide: {e}") from e
    return {"ok": True}


@router.delete("/categories/{cat_id}")
def category_delete(cat_id: int, conn: Conn):
    """Suppression douce ; les références rattachées basculent sur la première catégorie."""
    fallback = conn.execute(
        "SELECT id FROM categories WHERE active = 1 AND id != ? ORDER BY position, id LIMIT 1",
        (cat_id,),
    ).fetchone()
    if not fallback:
        raise HTTPException(422, "impossible de supprimer la dernière catégorie")
    conn.execute("UPDATE refs SET categorie_id = ? WHERE categorie_id = ?", (fallback[0], cat_id))
    conn.execute("UPDATE categories SET active = 0 WHERE id = ?", (cat_id,))
    conn.commit()
    return {"ok": True}


# ---------- lieux ----------


@router.post("/locations")
def location_create(conn: Conn, body: dict = Body(...)):
    if not body.get("nom"):
        raise HTTPException(422, "nom obligatoire")
    try:
        cur = conn.execute(
            "INSERT INTO locations (nom, position) VALUES (?,"
            " (SELECT COALESCE(MAX(position), 0) + 1 FROM locations))",
            (body["nom"],),
        )
        conn.commit()
    except sqlite3.IntegrityError as e:
        raise HTTPException(422, f"lieu invalide: {e}") from e
    return {"id": cur.lastrowid}


@router.patch("/locations/{loc_id}")
def location_patch(loc_id: int, conn: Conn, body: dict = Body(...)):
    if not body.get("nom"):
        raise HTTPException(422, "nom obligatoire")
    try:
        conn.execute("UPDATE locations SET nom = ? WHERE id = ?", (body["nom"], loc_id))
        conn.commit()
    except sqlite3.IntegrityError as e:
        raise HTTPException(422, f"lieu invalide: {e}") from e
    return {"ok": True}


@router.delete("/locations/{loc_id}")
def location_delete(loc_id: int, conn: Conn):
    remaining = conn.execute(
        "SELECT count(*) FROM locations WHERE active = 1 AND id != ?", (loc_id,)
    ).fetchone()[0]
    if remaining < 1:
        raise HTTPException(422, "il faut garder au moins un lieu")
    conn.execute("UPDATE locations SET active = 0 WHERE id = ?", (loc_id,))
    conn.commit()
    return {"ok": True}
