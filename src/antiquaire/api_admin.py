"""Routes cocktails, réglages, catégories et lieux."""

import json
import sqlite3

from fastapi import APIRouter, Body, HTTPException

from antiquaire import pricing, stock
from antiquaire.api import Conn, load_settings, parse_lieu

router = APIRouter()


# ---------- cocktails ----------


def active_prices(conn: sqlite3.Connection) -> dict[int, float]:
    """Prix issus de la tarification active du menu de chaque fiche.

    Seul endroit où la question « quel prix s'applique » est tranchée : tout le reste
    (registre, comptoir, marges) lit à travers, sans savoir que les menus existent.
    """
    rows = conn.execute(
        """SELECT tp.cocktail_id, tp.prix_ttc
           FROM tarif_prix tp JOIN tarifs t ON t.id = tp.tarif_id
           WHERE t.actif = 1"""
    )
    return {r["cocktail_id"]: r["prix_ttc"] for r in rows}


def menu_of(conn: sqlite3.Connection) -> dict[int, tuple[int, str]]:
    rows = conn.execute(
        """SELECT mi.cocktail_id, m.id, m.nom FROM menu_items mi
           JOIN menus m ON m.id = mi.menu_id WHERE m.active = 1"""
    )
    return {r["cocktail_id"]: (r[1], r[2]) for r in rows}


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
    conn: sqlite3.Connection,
    cocktail: dict,
    settings: dict,
    levels: dict[int, float],
    prix_actifs: dict[int, float] | None = None,
    menus: dict[int, tuple[int, str]] | None = None,
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
    prix_actifs = prix_actifs if prix_actifs is not None else {}
    menus = menus if menus is not None else {}
    depuis_tarif = cocktail["id"] in prix_actifs
    prix = prix_actifs.get(cocktail["id"], cocktail["prix_ttc"])
    menu = menus.get(cocktail["id"])
    ht = prix / 1.2
    marge = (ht - cost) / ht * 100 if ht > 0 else 0.0
    feas = pricing.feasibility(feas_lines)
    # marge visée par CETTE fiche : la sienne, sinon celle de la maison
    cible = cocktail["marge_pct"] if cocktail["marge_pct"] is not None else pr["cible"]
    return {
        "id": cocktail["id"],
        "nom": cocktail["nom"],
        "famille": cocktail["famille"],
        "verre": cocktail["verre"],
        "description": cocktail["description"],
        "created_at": cocktail["created_at"],
        "prix_ttc": prix,
        "prix_source": "tarif" if depuis_tarif else "fiche",
        "prix_fiche": cocktail["prix_ttc"],
        "menu_id": menu[0] if menu else None,
        "menu_nom": menu[1] if menu else None,
        "ings": ings,
        "cost": cost,
        "prix_ht": ht,
        "marge": marge,
        "tva": prix - ht,
        "ok": marge >= pr["min"],
        "marge_cible": cible,
        "marge_custom": cocktail["marge_pct"] is not None,
        "prix_fixe": bool(cocktail["prix_fixe"]),
        "suggested": pricing.suggested_cocktail_price(cost, cible, pr["arrondi"]),
        "feasibility": {"services": feas[0], "limitant": feas[1]} if feas else None,
    }


@router.get("/cocktails")
def cocktails_list(conn: Conn, lieu: str | None = None):
    settings = load_settings(conn)
    levels = stock.stock_levels(conn, parse_lieu(lieu))
    prix_actifs, menus = active_prices(conn), menu_of(conn)
    rows = conn.execute("SELECT * FROM cocktails WHERE active = 1 ORDER BY position, id").fetchall()
    return {
        "cocktails": [
            serialize_cocktail(conn, dict(r), settings, levels, prix_actifs, menus) for r in rows
        ]
    }


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
        if k
        in {
            "nom",
            "famille",
            "verre",
            "prix_ttc",
            "description",
            "position",
            "marge_pct",
            "prix_fixe",
        }
    }
    if "prix_fixe" in fields:
        fields["prix_fixe"] = bool(fields["prix_fixe"])
    # Une fiche au menu voit son prix vivre dans la tarification active : on écrit là,
    # sinon le curseur de la fiche modifierait un prix que plus personne ne lit.
    if "prix_ttc" in fields:
        actif = conn.execute(
            """SELECT t.id FROM tarifs t JOIN menu_items mi ON mi.menu_id = t.menu_id
               WHERE mi.cocktail_id = ? AND t.actif = 1""",
            (cid,),
        ).fetchone()
        if actif:
            conn.execute(
                """INSERT INTO tarif_prix (tarif_id, cocktail_id, prix_ttc) VALUES (?, ?, ?)
                   ON CONFLICT(tarif_id, cocktail_id) DO UPDATE SET prix_ttc = excluded.prix_ttc""",
                (actif["id"], cid, float(fields.pop("prix_ttc"))),
            )
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
    # Un taux modifié devient un taux daté d'aujourd'hui : l'ancien reste valable pour
    # la période qu'il a couverte, et rien de ce qui a été chiffré avant ne bouge.
    for code, valeur in (body.pop("rates", None) or {}).items():
        conn.execute(
            """INSERT INTO bareme_taux (code, valeur, effet_le, note, created_at)
               VALUES (?, ?, ?, 'saisi depuis le barème', ?)
               ON CONFLICT(code, effet_le) DO UPDATE SET valeur = excluded.valeur""",
            (code, float(valeur), stock.now()[:10], stock.now()),
        )
    conn.commit()
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
