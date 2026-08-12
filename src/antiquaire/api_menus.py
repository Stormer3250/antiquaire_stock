"""Menus et tarifications.

Un menu regroupe des fiches. Une tarification est une liste de prix posée sur ce même
menu : mêmes recettes, prix différents. Une seule tarification par menu est active à la
fois, et c'est elle qui donne le prix réellement pratiqué (voir `api_admin.active_prices`).
"""

import sqlite3

from fastapi import APIRouter, Body, HTTPException

from antiquaire import pricing, stock
from antiquaire.api import Conn, load_settings, parse_lieu
from antiquaire.api_admin import active_prices, menu_of, serialize_cocktail

router = APIRouter()


def get_menu_or_404(conn: sqlite3.Connection, mid: int) -> dict:
    row = conn.execute("SELECT * FROM menus WHERE id = ? AND active = 1", (mid,)).fetchone()
    if not row:
        raise HTTPException(404, "menu inconnu")
    return dict(row)


def get_tarif_or_404(conn: sqlite3.Connection, tid: int) -> dict:
    row = conn.execute("SELECT * FROM tarifs WHERE id = ?", (tid,)).fetchone()
    if not row:
        raise HTTPException(404, "tarification inconnue")
    return dict(row)


def menu_kpis(fiches: list[dict]) -> dict:
    """Ce qu'on veut savoir d'un menu : ce qu'il rapporte, et la dispersion des prix."""
    if not fiches:
        return {"n": 0}
    prix = [f["prix_ttc"] for f in fiches]
    return {
        "n": len(fiches),
        "marge_moyenne": sum(f["marge"] for f in fiches) / len(fiches),
        "prix_moyen": sum(prix) / len(prix),
        "cout_moyen": sum(f["cost"] for f in fiches) / len(fiches),
        "cout_total": sum(f["cost"] for f in fiches),
        "prix_mini": min(prix),
        "prix_maxi": max(prix),
        "ecart": max(prix) - min(prix),
        "sous_plancher": sum(1 for f in fiches if not f["ok"]),
    }


def tarif_rows(conn: sqlite3.Connection, menu_id: int) -> list[dict]:
    out = []
    for t in conn.execute(
        "SELECT * FROM tarifs WHERE menu_id = ? ORDER BY actif DESC, id", (menu_id,)
    ).fetchall():
        prix = {
            str(r["cocktail_id"]): r["prix_ttc"]
            for r in conn.execute(
                "SELECT cocktail_id, prix_ttc FROM tarif_prix WHERE tarif_id = ?", (t["id"],)
            )
        }
        out.append({**dict(t), "actif": bool(t["actif"]), "prix": prix})
    return out


@router.get("/menus")
def menus_list(conn: Conn, lieu: str | None = None):
    settings = load_settings(conn)
    levels = stock.stock_levels(conn, parse_lieu(lieu))
    prix_actifs, menus = active_prices(conn), menu_of(conn)

    def fiche(row: sqlite3.Row) -> dict:
        return serialize_cocktail(conn, dict(row), settings, levels, prix_actifs, menus)

    out = []
    for m in conn.execute("SELECT * FROM menus WHERE active = 1 ORDER BY position, id").fetchall():
        rows = conn.execute(
            """SELECT c.* FROM menu_items mi JOIN cocktails c ON c.id = mi.cocktail_id
               WHERE mi.menu_id = ? AND c.active = 1 ORDER BY mi.position, mi.id""",
            (m["id"],),
        ).fetchall()
        fiches = [fiche(r) for r in rows]
        out.append(
            {
                **dict(m),
                "cocktails": fiches,
                "tarifs": tarif_rows(conn, m["id"]),
                "kpis": menu_kpis(fiches),
            }
        )

    # « hors_menu » n'a plus de sens maintenant qu'une recette peut être sur plusieurs
    # cartes : on renvoie toutes les recettes, l'écran retire celles déjà présentes.
    toutes = conn.execute("SELECT * FROM cocktails WHERE active = 1 ORDER BY nom").fetchall()
    return {"menus": out, "recettes": [fiche(r) for r in toutes]}


@router.post("/menus")
def menu_create(conn: Conn, body: dict = Body(default={})):
    nom = (body.get("nom") or "Nouveau menu").strip()
    cur = conn.execute(
        "INSERT INTO menus (nom, description, created_at) VALUES (?, ?, ?)",
        (nom, body.get("description", ""), stock.now()),
    )
    conn.commit()
    return {"id": cur.lastrowid}


@router.patch("/menus/{mid}")
def menu_patch(mid: int, conn: Conn, body: dict = Body(...)):
    get_menu_or_404(conn, mid)
    fields = {k: v for k, v in body.items() if k in {"nom", "description", "position"}}
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE menus SET {sets} WHERE id = ?", [*fields.values(), mid])
    # cocktail_ids porte l'appartenance ET l'ordre : on réécrit la liste telle quelle.
    # Une recette peut figurer sur plusieurs cartes ; deux fois sur la même, non.
    if "cocktail_ids" in body:
        ids = list(dict.fromkeys(int(x) for x in body["cocktail_ids"]))
        conn.execute("DELETE FROM menu_items WHERE menu_id = ?", (mid,))
        for pos, cid in enumerate(ids):
            conn.execute(
                "INSERT INTO menu_items (menu_id, cocktail_id, position) VALUES (?, ?, ?)",
                (mid, cid, pos),
            )
    conn.commit()
    return {"ok": True}


@router.delete("/menus/{mid}")
def menu_delete(mid: int, conn: Conn):
    get_menu_or_404(conn, mid)
    # suppression réelle : les cascades nettoient items, tarifications et prix.
    # Les fiches, elles, ne bougent pas : elles redeviennent simplement libres.
    conn.execute("DELETE FROM menus WHERE id = ?", (mid,))
    conn.commit()
    return {"ok": True}


@router.post("/menus/{mid}/tarifs")
def tarif_create(mid: int, conn: Conn, body: dict = Body(default={})):
    get_menu_or_404(conn, mid)
    nom = (body.get("nom") or "Nouvelle tarification").strip()
    cur = conn.execute(
        "INSERT INTO tarifs (menu_id, nom, note, created_at) VALUES (?, ?, ?, ?)",
        (mid, nom, body.get("note", ""), stock.now()),
    )
    tid = cur.lastrowid
    source = body.get("from_tarif_id")
    if source:
        src = get_tarif_or_404(conn, int(source))
        if src["menu_id"] != mid:
            raise HTTPException(422, "cette tarification appartient à un autre menu")
        conn.execute(
            """INSERT INTO tarif_prix (tarif_id, cocktail_id, prix_ttc)
               SELECT ?, cocktail_id, prix_ttc FROM tarif_prix WHERE tarif_id = ?""",
            (tid, source),
        )
    else:
        # tarification vide : on part des prix effectifs du moment, sinon l'écran
        # s'ouvre sur une colonne vide et personne ne sait quoi en faire
        prix_actifs = active_prices(conn)
        rows = conn.execute(
            """SELECT c.id, c.prix_ttc FROM menu_items mi JOIN cocktails c ON c.id = mi.cocktail_id
               WHERE mi.menu_id = ?""",
            (mid,),
        ).fetchall()
        for r in rows:
            conn.execute(
                "INSERT INTO tarif_prix (tarif_id, cocktail_id, prix_ttc) VALUES (?, ?, ?)",
                (tid, r["id"], prix_actifs.get(r["id"], r["prix_ttc"])),
            )
    conn.commit()
    return {"id": tid}


@router.patch("/tarifs/{tid}")
def tarif_patch(tid: int, conn: Conn, body: dict = Body(...)):
    tarif = get_tarif_or_404(conn, tid)
    fields = {k: v for k, v in body.items() if k in {"nom", "note"}}
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        conn.execute(f"UPDATE tarifs SET {sets} WHERE id = ?", [*fields.values(), tid])
    if "actif" in body:
        # une seule active par menu : activer l'une désactive ses sœurs, dans la
        # même transaction, pour qu'aucune lecture ne tombe entre les deux
        if body["actif"]:
            conn.execute("UPDATE tarifs SET actif = 0 WHERE menu_id = ?", (tarif["menu_id"],))
        conn.execute("UPDATE tarifs SET actif = ? WHERE id = ?", (bool(body["actif"]), tid))
    if "prix" in body:
        for cid, prix in body["prix"].items():
            conn.execute(
                """INSERT INTO tarif_prix (tarif_id, cocktail_id, prix_ttc) VALUES (?, ?, ?)
                   ON CONFLICT(tarif_id, cocktail_id) DO UPDATE SET prix_ttc = excluded.prix_ttc""",
                (tid, int(cid), float(prix)),
            )
    conn.commit()
    return {"ok": True}


@router.delete("/tarifs/{tid}")
def tarif_delete(tid: int, conn: Conn):
    get_tarif_or_404(conn, tid)
    conn.execute("DELETE FROM tarifs WHERE id = ?", (tid,))
    conn.commit()
    return {"ok": True}


CONTRAINTES = {"prix_min", "prix_max", "marge_moyenne", "ecart_max", "arrondi", "plancher"}


def fiches_du_menu(conn: sqlite3.Connection, menu_id: int, lieu: str | None = None) -> list[dict]:
    settings = load_settings(conn)
    levels = stock.stock_levels(conn, parse_lieu(lieu))
    prix_actifs, menus = active_prices(conn), menu_of(conn)
    rows = conn.execute(
        """SELECT c.* FROM menu_items mi JOIN cocktails c ON c.id = mi.cocktail_id
           WHERE mi.menu_id = ? AND c.active = 1 ORDER BY mi.position, mi.id""",
        (menu_id,),
    ).fetchall()
    return [serialize_cocktail(conn, dict(r), settings, levels, prix_actifs, menus) for r in rows]


@router.post("/tarifs/{tid}/optimiser")
def tarif_optimiser(tid: int, conn: Conn, body: dict = Body(default={})):
    """Propose des prix. N'écrit RIEN : appliquer est un PATCH ordinaire, décidé après
    lecture. C'est ce qui rend le garde-fou impossible à contourner par distraction."""
    tarif = get_tarif_or_404(conn, tid)
    settings = load_settings(conn)
    pr = settings["pricing"]
    prix_tarif = {
        r["cocktail_id"]: r["prix_ttc"]
        for r in conn.execute(
            "SELECT cocktail_id, prix_ttc FROM tarif_prix WHERE tarif_id = ?", (tid,)
        )
    }
    contraintes = {k: v for k, v in body.items() if k in CONTRAINTES and v not in (None, "")}
    contraintes.setdefault("arrondi", pr["arrondi"])
    contraintes.setdefault("plancher", pr["min"])

    items = [
        {
            "id": f["id"],
            "nom": f["nom"],
            "cost": f["cost"],
            "marge_cible": f["marge_cible"],
            "tva_pct": 20,
            "prix_actuel": prix_tarif.get(f["id"], f["prix_ttc"]),
            "verrouille": f["prix_fixe"],
        }
        for f in fiches_du_menu(conn, tarif["menu_id"])
    ]
    return {"tarif": {"id": tid, "nom": tarif["nom"]}, **pricing.optimize(items, contraintes)}


@router.get("/impact")
def impact(conn: Conn):
    """Quelles fiches sont passées sous le plancher au prix qu'on pratique aujourd'hui,
    et quel ingrédient y pèse le plus. Aucune donnée nouvelle : on recalcule et on trie."""
    settings = load_settings(conn)
    plancher = settings["pricing"]["min"]
    levels = stock.stock_levels(conn, None)
    prix_actifs, menus = active_prices(conn), menu_of(conn)
    rows = conn.execute("SELECT * FROM cocktails WHERE active = 1").fetchall()

    touchees = []
    for r in rows:
        f = serialize_cocktail(conn, dict(r), settings, levels, prix_actifs, menus)
        if f["marge"] >= plancher:
            continue
        pire = max(f["ings"], key=lambda i: i["cost"], default=None)
        touchees.append(
            {
                "id": f["id"],
                "nom": f["nom"],
                "menu_id": f["menu_id"],
                "menu_nom": f["menu_nom"],
                "prix_ttc": f["prix_ttc"],
                "cost": f["cost"],
                "marge": f["marge"],
                "marge_cible": f["marge_cible"],
                "prix_conseille": f["suggested"],
                "ingredient_lourd": pire["nom"] if pire else None,
                "part_ingredient": (pire["cost"] / f["cost"] * 100) if pire and f["cost"] else 0,
            }
        )
    touchees.sort(key=lambda x: x["marge"])
    return {"plancher": plancher, "fiches": touchees}
