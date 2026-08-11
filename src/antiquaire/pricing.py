"""Le moteur d'argent : coûts, fiscalité, marges, prix. Fonctions pures, zéro I/O."""

import math
from typing import NamedTuple


class Fiscal(NamedTuple):
    accise: float
    ss: float
    hlap: float  # hL d'alcool pur dans la dose


def effective_dose(ref: dict, cat: dict) -> float:
    """Dose de la référence, ou celle de sa catégorie si elle n'en fixe pas."""
    return ref["dose_cl"] if ref.get("dose_cl") is not None else cat["dose_cl"]


def effective_regime(ref: dict, cat: dict) -> str:
    """Cascade : pas d'alcool ⇒ aucun droit ; sinon régime propre, sinon catégorie."""
    if not ref.get("alcoolise", 1):
        return "aucun"
    return ref.get("regime") or cat["regime"]


def effective_marge(ref: dict, cat: dict) -> float:
    return ref["marge_pct"] if ref.get("marge_pct") is not None else cat["marge_pct"]


def doses_per_bottle(vol_cl: float, dose_cl: float) -> float:
    return vol_cl / dose_cl if dose_cl else 0.0


def fiscal_per_dose(
    regime: str, abv: float, dose_cl: float, rates: dict, *, dom: bool = False
) -> Fiscal:
    """Droits d'accise + cotisation SS pour UNE dose, selon le régime fiscal."""
    hl = dose_cl / 100 / 100  # cl → L → hL de produit fini
    hlap = hl * abv / 100
    accise = 0.0
    if regime == "spiritueux" and abv > 0:
        # rhum traditionnel des DOM : taux réduit, si le barème le connaît
        taux = rates.get("accise_dom", rates["accise"]) if dom else rates["accise"]
        accise = hlap * taux
    elif regime == "vin":
        accise = hl * (rates["mousseux"] if abv > 12.4 else rates["vin"])
    elif regime in ("mousseux", "intermediaire"):
        accise = hl * rates["mousseux"]
    elif regime == "biere":
        accise = hl * rates["biere"] * abv
    ss = hlap * rates["ss"] if abv > 18 and regime != "aucun" else 0.0
    return Fiscal(accise, ss, hlap)


def cost_per_dose(
    achat_ht: float,
    vol_cl: float,
    dose_cl: float,
    *,
    droits_inclus: bool,
    regime: str,
    abv: float,
    rates: dict,
    dom: bool = False,
) -> float:
    """Coût matière d'une dose. Droits non inclus dans l'achat ⇒ taxes ajoutées."""
    doses = doses_per_bottle(vol_cl, dose_cl)
    base = achat_ht / doses if doses else 0.0
    if droits_inclus:
        return base
    f = fiscal_per_dose(regime, abv, dose_cl, rates, dom=dom)
    return base + f.accise + f.ss


def round_price(value: float, step: float) -> float:
    if step <= 0:
        return value
    return round(round(value / step) * step, 2)


def price_for_margin(cost: float, marge_pct: float, tva_pct: float, step: float) -> float:
    m = min(max(marge_pct, 1), 95)
    ht = cost / (1 - m / 100)
    return round_price(ht * (1 + tva_pct / 100), step)


def real_margin(cost: float, prix_ttc: float, tva_pct: float) -> float:
    ht = prix_ttc / (1 + tva_pct / 100)
    return (ht - cost) / ht * 100 if ht > 0 else 0.0


def cocktail_cost(ings: list[dict]) -> float:
    """Σ coût des lignes: chaque ligne apporte cost_per_unit (€/cl ou €/unité) × qty."""
    return sum(i["cost_per_unit"] * i["qty"] for i in ings)


def suggested_cocktail_price(cost: float, cible_pct: float, step: float) -> float:
    return price_for_margin(cost, cible_pct, 20, step)


def feasibility(ings: list[dict]) -> tuple[int, str] | None:
    """(services possibles, ingrédient limitant) sur les ingrédients suivis, ou None."""
    servings = [
        (math.floor(i["stock"] * i["vol_cl"] / i["qty_cl"]), i["nom"])
        for i in ings
        if i.get("qty_cl", 0) > 0
    ]
    return min(servings) if servings else None


def order_suggestions(rows: list[dict]) -> list[dict]:
    """Références sous seuil, groupées par fournisseur, quantité = ceil(par_target − stock)."""
    groups: dict[str, list[dict]] = {}
    for r in rows:
        if r["stock"] > r["seuil"]:
            continue
        qty = math.ceil(max(r["par_target"] - r["stock"], 0))
        groups.setdefault(r["fournisseur"], []).append(
            {"nom": r["nom"], "stock": r["stock"], "seuil": r["seuil"], "quantite": qty}
        )
    return [{"fournisseur": f, "lines": lines} for f, lines in sorted(groups.items())]


# ---------- moteur de tarification d'un menu ----------


def _marge(cost: float, ttc: float, tva_pct: float) -> float:
    return real_margin(cost, ttc, tva_pct)


def optimize(items: list[dict], constraints: dict) -> dict:
    """Propose un prix par fiche sous contraintes. Ne décide rien, ne récrit rien.

    `items` : id, nom, cost, marge_cible, tva_pct, prix_actuel, verrouille.
    `constraints` : prix_min, prix_max, marge_moyenne, ecart_max, arrondi, plancher.
    Toutes facultatives ; absente signifie « pas de contrainte ».

    Renvoie {lines, resume, violations}. `violations` nomme ce qui n'a PAS pu être tenu :
    rendre un résultat approché en silence serait pire que le dire.
    """
    step = constraints.get("arrondi") or 0
    pmin = constraints.get("prix_min")
    pmax = constraints.get("prix_max")
    ecart_max = constraints.get("ecart_max")
    cible_moy = constraints.get("marge_moyenne")
    plancher = constraints.get("plancher")

    def clamp(p: float) -> float:
        if pmin is not None:
            p = max(p, pmin)
        if pmax is not None:
            p = min(p, pmax)
        return round_price(p, step)

    prix: dict = {}
    for it in items:
        if it.get("verrouille"):
            prix[it["id"]] = it["prix_actuel"]  # figée : on n'y touche pas
        else:
            prix[it["id"]] = clamp(
                price_for_margin(it["cost"], it["marge_cible"], it["tva_pct"], step)
            )

    libres = [it for it in items if not it.get("verrouille")]

    # 2. resserrer l'écart entre la moins chère et la plus chère
    if ecart_max is not None and items:
        for _ in range(12):
            vals = list(prix.values())
            span = max(vals) - min(vals)
            if span <= ecart_max + 1e-9 or not libres:
                break
            milieu = sum(vals) / len(vals)
            facteur = ecart_max / span if span else 1
            for it in libres:
                prix[it["id"]] = clamp(milieu + (prix[it["id"]] - milieu) * facteur)

    # 3. viser la marge moyenne : un seul multiplicateur sur les prix HT, trouvé par
    # dichotomie. La marge moyenne croît avec le multiplicateur, donc ça converge.
    def moyenne_avec(facteur: float) -> float:
        total = 0.0
        for it in items:
            p = prix[it["id"]] if it.get("verrouille") else clamp(prix[it["id"]] * facteur)
            total += _marge(it["cost"], p, it["tva_pct"])
        return total / len(items)

    if cible_moy is not None and items and libres:
        bas, haut = 0.2, 5.0
        for _ in range(40):
            milieu = (bas + haut) / 2
            if moyenne_avec(milieu) < cible_moy:
                bas = milieu
            else:
                haut = milieu
        facteur = (bas + haut) / 2
        for it in libres:
            prix[it["id"]] = clamp(prix[it["id"]] * facteur)

    lines = []
    for it in items:
        avant, apres = it["prix_actuel"], prix[it["id"]]
        lines.append(
            {
                "id": it["id"],
                "nom": it["nom"],
                "cost": it["cost"],
                "verrouille": bool(it.get("verrouille")),
                "prix_avant": avant,
                "prix_apres": apres,
                "delta": apres - avant,
                "marge_avant": _marge(it["cost"], avant, it["tva_pct"]),
                "marge_apres": _marge(it["cost"], apres, it["tva_pct"]),
            }
        )

    violations = []
    figees_hors_bornes = [
        li["nom"]
        for li in lines
        if li["verrouille"]
        and (
            (pmin is not None and li["prix_apres"] < pmin)
            or (pmax is not None and li["prix_apres"] > pmax)
        )
    ]
    if figees_hors_bornes:
        violations.append("prix figé hors des bornes demandées : " + ", ".join(figees_hors_bornes))
    if lines:
        vals = [li["prix_apres"] for li in lines]
        span = max(vals) - min(vals)
        if ecart_max is not None and span > ecart_max + 0.01:
            violations.append(
                f"écart maximal de {ecart_max:.2f} € impossible à tenir, il reste {span:.2f} €"
            )
        moyenne = sum(li["marge_apres"] for li in lines) / len(lines)
        if cible_moy is not None and abs(moyenne - cible_moy) > 0.5:
            violations.append(
                f"marge moyenne visée de {cible_moy:.1f} % hors de portée, "
                f"le meilleur possible est {moyenne:.1f} %"
            )
        basses = [
            li["nom"] for li in lines if plancher is not None and li["marge_apres"] < plancher
        ]
        if basses:
            violations.append("sous le plancher de marge : " + ", ".join(basses))

    resume = {"n": len(lines), "changees": sum(1 for li in lines if abs(li["delta"]) >= 0.01)}
    if lines:
        vals = [li["prix_apres"] for li in lines]
        avants = [li["prix_avant"] for li in lines]
        resume.update(
            {
                "marge_avant": sum(li["marge_avant"] for li in lines) / len(lines),
                "marge_apres": sum(li["marge_apres"] for li in lines) / len(lines),
                "ecart_avant": max(avants) - min(avants),
                "ecart_apres": max(vals) - min(vals),
                "prix_moyen_apres": sum(vals) / len(vals),
                "sous_plancher": sum(
                    1 for li in lines if plancher is not None and li["marge_apres"] < plancher
                ),
            }
        )
    return {"lines": lines, "resume": resume, "violations": violations}
