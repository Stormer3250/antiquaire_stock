import math

from antiquaire import pricing

RATES = {"accise": 1954, "ss": 625, "vin": 3.99, "mousseux": 9.89, "biere": 7.82}


def test_doses_per_bottle():
    assert pricing.doses_per_bottle(70, 5) == 14


def test_fiscal_spiritueux_55():
    f = pricing.fiscal_per_dose("spiritueux", 55, 5, RATES)
    # 5 cl = 0.0005 hL of product, ×55% = 0.000275 hL pure alcohol
    assert math.isclose(f.hlap, 0.000275)
    assert math.isclose(f.accise, 0.000275 * 1954)
    assert math.isclose(f.ss, 0.000275 * 625)  # 55° > 18° ⇒ cotisation SS


def test_fiscal_ss_boundary():
    assert pricing.fiscal_per_dose("spiritueux", 18.0, 5, RATES).ss == 0
    assert pricing.fiscal_per_dose("spiritueux", 18.1, 5, RATES).ss > 0


def test_fiscal_vin_switches_to_mousseux_rate_above_12_4():
    hl = 12 / 100 / 100
    quiet = pricing.fiscal_per_dose("vin", 12.4, 12, RATES)
    sparkling = pricing.fiscal_per_dose("vin", 12.5, 12, RATES)
    assert math.isclose(quiet.accise, hl * 3.99)
    assert math.isclose(sparkling.accise, hl * 9.89)


def test_fiscal_biere_per_degree():
    f = pricing.fiscal_per_dose("biere", 5, 33, RATES)
    assert math.isclose(f.accise, (33 / 100 / 100) * 7.82 * 5)


def test_fiscal_aucun_is_zero():
    f = pricing.fiscal_per_dose("aucun", 40, 5, RATES)
    assert f.accise == 0 and f.ss == 0


def test_cost_per_dose_droits_inclus_vs_not():
    base = pricing.cost_per_dose(
        24.90, 70, 5, droits_inclus=True, regime="spiritueux", abv=55, rates=RATES
    )
    assert math.isclose(base, 24.90 / 14)
    loaded = pricing.cost_per_dose(
        24.90, 70, 5, droits_inclus=False, regime="spiritueux", abv=55, rates=RATES
    )
    assert math.isclose(loaded, 24.90 / 14 + 0.000275 * (1954 + 625))


def test_price_for_margin_and_rounding():
    # cost 2.00, marge 80% → HT 10, TVA 20% → 12.00, arrondi 0.5 → 12.00
    assert pricing.price_for_margin(2.0, 80, 20, 0.5) == 12.0
    # cost 1.79, marge 80 → HT 8.95 → TTC 10.74 → arrondi 0.5 → 10.5
    assert pricing.price_for_margin(1.79, 80, 20, 0.5) == 10.5


def test_real_margin_inverse_of_price():
    cost = 1.7786
    ttc = pricing.price_for_margin(cost, 80, 20, 0.0001)
    assert math.isclose(pricing.real_margin(cost, ttc, 20), 80, abs_tol=0.01)
    assert pricing.real_margin(cost, 0, 20) == 0


def test_cocktail_cost_tracked_untracked_consommable():
    # tracked rhum: 24.90/70 per cl × 4 cl ; untracked zeste: 0.15 × 1 ; consommable 0.35 × 1
    ings = [
        {"cost_per_unit": 24.90 / 70, "qty": 4},
        {"cost_per_unit": 0.15, "qty": 1},
        {"cost_per_unit": 0.35, "qty": 1},
    ]
    assert math.isclose(pricing.cocktail_cost(ings), 24.90 / 70 * 4 + 0.15 + 0.35)


def test_suggested_cocktail_price():
    # cost 3.00, cible 80 → HT 15 → ×1.2 = 18.0
    assert pricing.suggested_cocktail_price(3.0, 80, 0.5) == 18.0


def test_feasibility_limiting_ingredient():
    ings = [
        {"nom": "Rhum", "stock": 8, "vol_cl": 70, "qty_cl": 4},  # 140 services
        {"nom": "Chartreuse", "stock": 2, "vol_cl": 70, "qty_cl": 1.5},  # 93
    ]
    n, limiting = pricing.feasibility(ings)
    assert n == 93 and limiting == "Chartreuse"
    assert pricing.feasibility([]) is None


def test_order_suggestions_groups_and_ceils():
    rows = [
        {"nom": "Gin", "fournisseur": "Dugas", "stock": 2, "seuil": 5, "par_target": 8.5},
        {"nom": "Rhum", "fournisseur": "Dugas", "stock": 6, "seuil": 4, "par_target": 8},
        {"nom": "Chenin", "fournisseur": "Vinifera", "stock": 1, "seuil": 6, "par_target": 12},
    ]
    groups = pricing.order_suggestions(rows)
    assert [g["fournisseur"] for g in groups] == ["Dugas", "Vinifera"]
    assert groups[0]["lines"] == [{"nom": "Gin", "stock": 2, "seuil": 5, "quantite": 7}]
    assert groups[1]["lines"][0]["quantite"] == 11


RATES_DOM = {**RATES, "accise_dom": 903.51}


def test_effective_dose_inherits_then_overrides():
    cat = {"dose_cl": 5, "regime": "spiritueux", "marge_pct": 80}
    assert pricing.effective_dose({"dose_cl": None}, cat) == 5
    assert pricing.effective_dose({"dose_cl": 12}, cat) == 12


def test_effective_regime_cascade():
    cat = {"dose_cl": 5, "regime": "spiritueux", "marge_pct": 80}
    # 1. pas d'alcool : aucun droit, quel que soit le régime de la catégorie
    assert pricing.effective_regime({"alcoolise": 0, "regime": None}, cat) == "aucun"
    # 2. alcoolisé sans précision : régime hérité
    assert pricing.effective_regime({"alcoolise": 1, "regime": None}, cat) == "spiritueux"
    # 3. alcoolisé avec override
    assert pricing.effective_regime({"alcoolise": 1, "regime": "vin"}, cat) == "vin"


def test_effective_marge_inherits_then_overrides():
    cat = {"dose_cl": 5, "regime": "spiritueux", "marge_pct": 80}
    assert pricing.effective_marge({"marge_pct": None}, cat) == 80
    assert pricing.effective_marge({"marge_pct": 72}, cat) == 72


def test_dom_rate_applies_to_spiritueux_only():
    metro = pricing.fiscal_per_dose("spiritueux", 40, 5, RATES_DOM)
    dom = pricing.fiscal_per_dose("spiritueux", 40, 5, RATES_DOM, dom=True)
    assert math.isclose(dom.accise, metro.hlap * 903.51)
    assert dom.accise < metro.accise
    assert dom.ss == metro.ss  # la cotisation SS n'est pas réduite
    # le drapeau n'a aucun effet hors spiritueux
    vin = pricing.fiscal_per_dose("vin", 12, 12, RATES_DOM)
    vin_dom = pricing.fiscal_per_dose("vin", 12, 12, RATES_DOM, dom=True)
    assert vin.accise == vin_dom.accise


def test_dom_rate_falls_back_when_absent():
    """Un barème antérieur à la migration ne doit pas planter."""
    f = pricing.fiscal_per_dose("spiritueux", 40, 5, RATES, dom=True)
    assert math.isclose(f.accise, f.hlap * 1954)


def test_cost_per_dose_accepts_dom():
    plain = pricing.cost_per_dose(
        30, 70, 5, droits_inclus=False, regime="spiritueux", abv=40, rates=RATES_DOM
    )
    reduced = pricing.cost_per_dose(
        30, 70, 5, droits_inclus=False, regime="spiritueux", abv=40, rates=RATES_DOM, dom=True
    )
    assert reduced < plain


# ---------- moteur de tarification ----------


def lot(*prix, cost=2.0, cible=80.0, verrous=()):
    return [
        {
            "id": i,
            "nom": f"F{i}",
            "cost": cost,
            "marge_cible": cible,
            "tva_pct": 20,
            "prix_actuel": p,
            "verrouille": i in verrous,
        }
        for i, p in enumerate(prix)
    ]


def prix_de(res):
    return [round(li["prix_apres"], 2) for li in res["lines"]]


def test_optimize_sans_contrainte_vise_la_marge_de_chaque_fiche():
    res = pricing.optimize(lot(9.0, 30.0, cost=2.0, cible=80.0), {"arrondi": 0.5})
    # coût 2 € et marge 80 % ⇒ HT 10 €, TTC 12 €
    assert prix_de(res) == [12.0, 12.0]
    assert res["violations"] == []


def test_optimize_borne_par_prix_mini_et_maxi():
    res = pricing.optimize(
        lot(9.0, 9.0, cost=2.0), {"arrondi": 0.5, "prix_min": 14, "prix_max": 20}
    )
    assert prix_de(res) == [14.0, 14.0]
    res = pricing.optimize(lot(9.0, cost=8.0), {"arrondi": 0.5, "prix_max": 20})
    assert prix_de(res) == [20.0]


def test_optimize_resserre_l_ecart():
    items = lot(0, 0, 0, cost=1.0) + lot(0, cost=9.0)
    for i, it in enumerate(items):
        it["id"] = i
    res = pricing.optimize(items, {"arrondi": 0.5, "ecart_max": 3})
    p = prix_de(res)
    assert max(p) - min(p) <= 3.0 + 1e-9


def test_optimize_atteint_la_marge_moyenne_visee():
    items = lot(0, 0, 0, cost=2.0) + lot(0, cost=5.0)
    for i, it in enumerate(items):
        it["id"] = i
    res = pricing.optimize(items, {"arrondi": 0.01, "marge_moyenne": 70})
    marges = [li["marge_apres"] for li in res["lines"]]
    assert abs(sum(marges) / len(marges) - 70) < 0.5
    assert res["violations"] == []


def test_optimize_ne_touche_pas_une_fiche_verrouillee():
    res = pricing.optimize(lot(18.0, 9.0, cost=2.0, verrous={0}), {"arrondi": 0.5})
    assert res["lines"][0]["prix_apres"] == 18.0
    assert res["lines"][0]["verrouille"] is True
    assert res["lines"][1]["prix_apres"] == 12.0


def test_optimize_signale_ce_qu_il_ne_peut_pas_tenir():
    """Une fiche figée hors des bornes rend la contrainte intenable : on le dit."""
    res = pricing.optimize(lot(30.0, 9.0, cost=2.0, verrous={0}), {"arrondi": 0.5, "prix_max": 15})
    assert any("figé" in v for v in res["violations"])
    assert res["lines"][0]["prix_apres"] == 30.0  # on ne la déplace pas pour autant


def test_optimize_signale_une_marge_moyenne_hors_de_portee():
    res = pricing.optimize(
        lot(0, 0, cost=2.0), {"arrondi": 0.5, "marge_moyenne": 95, "prix_max": 12}
    )
    assert any("marge moyenne" in v for v in res["violations"])


def test_optimize_signale_les_fiches_sous_le_plancher():
    res = pricing.optimize(lot(0, cost=5.0), {"arrondi": 0.5, "prix_max": 12, "plancher": 75})
    assert any("plancher" in v for v in res["violations"])


def test_optimize_sur_un_menu_vide():
    res = pricing.optimize([], {"arrondi": 0.5, "marge_moyenne": 80})
    assert res["lines"] == []
    assert res["violations"] == []
