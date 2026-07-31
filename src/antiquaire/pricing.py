"""Le moteur d'argent : coûts, fiscalité, marges, prix. Fonctions pures, zéro I/O."""

import math
from typing import NamedTuple


class Fiscal(NamedTuple):
    accise: float
    ss: float
    hlap: float  # hL d'alcool pur dans la dose


def doses_per_bottle(vol_cl: float, dose_cl: float) -> float:
    return vol_cl / dose_cl if dose_cl else 0.0


def fiscal_per_dose(regime: str, abv: float, dose_cl: float, rates: dict) -> Fiscal:
    """Droits d'accise + cotisation SS pour UNE dose, selon le régime fiscal."""
    hl = dose_cl / 100 / 100  # cl → L → hL de produit fini
    hlap = hl * abv / 100
    accise = 0.0
    if regime == "spiritueux" and abv > 0:
        accise = hlap * rates["accise"]
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
) -> float:
    """Coût matière d'une dose. Droits non inclus dans l'achat ⇒ taxes ajoutées."""
    doses = doses_per_bottle(vol_cl, dose_cl)
    base = achat_ht / doses if doses else 0.0
    if droits_inclus:
        return base
    f = fiscal_per_dose(regime, abv, dose_cl, rates)
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
