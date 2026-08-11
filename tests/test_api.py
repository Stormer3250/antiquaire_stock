import pytest
from fastapi.testclient import TestClient

from antiquaire.main import create_app

RESERVE, COMPTOIR = 1, 2


@pytest.fixture
def client(tmp_path):
    app = create_app(db_path=tmp_path / "api.db")
    with TestClient(app) as c:
        yield c


def make_ref(client, **over):
    body = {
        "nom": "Rhum agricole blanc 55°",
        "marque": "Neisson · Martinique",
        "categorie_id": 1,
        "fournisseur": "Dugas",
        "vol_cl": 70,
        "abv": 55,
        "achat_ht": 24.90,
        "seuil": 4,
        "par_target": 8,
        "droits_inclus": True,
    }
    body.update(over)
    r = client.post("/api/refs", json=body)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_state_bootstrap(client):
    s = client.get("/api/state").json()
    assert s["pricing"]["cible"] == 80
    assert s["rates"]["accise"] == 1954
    assert len(s["categories"]) == 7
    assert [loc["nom"] for loc in s["locations"]] == ["Réserve", "Comptoir"]
    assert "Dugas" in s["lists"]["fournisseurs"]


def test_ref_appears_in_stock_with_computed_price(client):
    make_ref(client)
    rows = client.get("/api/stock").json()["refs"]
    assert len(rows) == 1
    r = rows[0]
    assert r["stock"] == 0
    assert r["cout_dose"] == pytest.approx(24.90 / 14)
    # marge 80 (cat), TVA 20, arrondi 0.5 → 1.7786/0.2*1.2 = 10.6714... → 10.5
    assert r["prix"] == 10.5
    assert r["low"] is True  # 0 <= seuil 4


def test_droits_non_inclus_raises_cost(client):
    rid = make_ref(client, droits_inclus=False)
    row = next(x for x in client.get("/api/stock").json()["refs"] if x["id"] == rid)
    assert row["cout_dose"] == pytest.approx(24.90 / 14 + 0.000275 * (1954 + 625))


def test_prix_ttc_override_wins_and_flags_margin(client):
    rid = make_ref(client)
    r = client.patch(f"/api/refs/{rid}", json={"prix_ttc": 9.0})
    assert r.status_code == 200
    row = next(x for x in client.get("/api/stock").json()["refs"] if x["id"] == rid)
    assert row["prix"] == 9.0 and row["override"] is True
    assert row["marge_reelle"] < 80
    client.patch(f"/api/refs/{rid}", json={"prix_ttc": None})
    row = next(x for x in client.get("/api/stock").json()["refs"] if x["id"] == rid)
    assert row["override"] is False and row["prix"] == 10.5


def test_movements_bulk_updates_levels_per_lieu(client):
    rid = make_ref(client)
    r = client.post(
        "/api/movements/bulk",
        json={
            "location_id": RESERVE,
            "source": "manuel",
            "lines": [{"ref_id": rid, "type": "reception", "quantity": 6}],
        },
    )
    assert r.status_code == 200
    assert client.get(f"/api/stock?lieu={RESERVE}").json()["refs"][0]["stock"] == 6
    assert client.get(f"/api/stock?lieu={COMPTOIR}").json()["refs"][0]["stock"] == 0
    assert client.get("/api/stock").json()["refs"][0]["stock"] == 6


def test_orders_grouped_with_quantities(client):
    make_ref(client)  # stock 0 <= seuil 4, par 8 → commander 8
    make_ref(client, nom="Chenin", fournisseur="Vinifera", seuil=6, par_target=12)
    groups = client.get("/api/orders").json()["groups"]
    assert [g["fournisseur"] for g in groups] == ["Dugas", "Vinifera"]
    assert groups[0]["lines"][0]["quantite"] == 8


def test_fiche_payload(client):
    rid = make_ref(client, droits_inclus=False)
    p = client.get(f"/api/refs/{rid}").json()
    assert p["nom"].startswith("Rhum")
    assert p["doses_par_bouteille"] == 14
    assert p["fiscal"]["accise"] == pytest.approx(0.000275 * 1954)
    assert p["fiscal"]["ss"] == pytest.approx(0.000275 * 625)
    assert p["cout_dose"] == pytest.approx(24.90 / 14 + 0.000275 * 2579)
    assert p["marge"] == 80 and p["tva_pct"] == 20


def test_soft_delete_hides_but_keeps_history(client):
    rid = make_ref(client)
    client.post(
        "/api/movements/bulk",
        json={
            "location_id": RESERVE,
            "source": "manuel",
            "lines": [{"ref_id": rid, "type": "reception", "quantity": 2}],
        },
    )
    assert client.delete(f"/api/refs/{rid}").status_code == 200
    assert client.get("/api/stock").json()["refs"] == []
    assert len(client.get(f"/api/movements?ref={rid}").json()["movements"]) == 1


def test_untracked_ref_has_no_stock_price(client):
    rid = make_ref(client, nom="Zeste", suivi=False, unite="zeste", achat_ht=0.15, categorie_id=6)
    row = next(x for x in client.get("/api/stock").json()["refs"] if x["id"] == rid)
    assert row["suivi"] is False and row["stock"] is None and row["prix"] is None


def test_health(client):
    h = client.get("/api/health").json()
    assert h["ok"] is True and h["db_ok"] is True


# ---------- cascade fiscale & dose par référence ----------


def spirit_cat(client):
    return next(
        c for c in client.get("/api/state").json()["categories"] if c["regime"] == "spiritueux"
    )


def test_soft_drink_pays_no_duty_whatever_the_category(client):
    """Une référence non alcoolisée rangée dans Spiritueux ne paie aucun droit."""
    rid = client.post(
        "/api/refs",
        json={
            "nom": "Tonic maison",
            "categorie_id": spirit_cat(client)["id"],
            "vol_cl": 20,
            "abv": 0,
            "achat_ht": 1.20,
            "alcoolise": False,
        },
    ).json()["id"]
    fiche = client.get(f"/api/refs/{rid}").json()
    assert fiche["alcoolise"] is False
    assert fiche["regime"] == "aucun"
    assert fiche["fiscal"]["accise"] == 0
    assert fiche["fiscal"]["ss"] == 0
    assert fiche["cout_dose"] == fiche["cout_dose_base"]


def test_reference_regime_overrides_its_category(client):
    rid = client.post(
        "/api/refs",
        json={
            "nom": "Vermouth maison",
            "categorie_id": spirit_cat(client)["id"],
            "vol_cl": 75,
            "abv": 16,
            "achat_ht": 12.0,
            "regime": "intermediaire",
        },
    ).json()["id"]
    fiche = client.get(f"/api/refs/{rid}").json()
    assert fiche["regime"] == "intermediaire"
    assert fiche["regime_custom"] is True


def test_dom_flag_lowers_the_duty(client):
    body = {
        "nom": "Rhum agricole",
        "categorie_id": spirit_cat(client)["id"],
        "vol_cl": 70,
        "abv": 50,
        "achat_ht": 25.0,
    }
    metro_id = client.post("/api/refs", json=body).json()["id"]
    metro = client.get(f"/api/refs/{metro_id}").json()
    dom_id = client.post("/api/refs", json={**body, "nom": "Rhum DOM", "dom": True}).json()["id"]
    dom = client.get(f"/api/refs/{dom_id}").json()
    assert dom["dom"] is True
    assert dom["fiscal"]["accise"] < metro["fiscal"]["accise"]
    assert dom["cout_dose"] < metro["cout_dose"]


def test_reference_dose_overrides_the_category(client):
    rid = client.post(
        "/api/refs",
        json={
            "nom": "Magnum de rhum",
            "categorie_id": spirit_cat(client)["id"],
            "vol_cl": 450,
            "abv": 40,
            "achat_ht": 86.20,
            "dose_cl": 4,
        },
    ).json()["id"]
    fiche = client.get(f"/api/refs/{rid}").json()
    assert fiche["dose_cl"] == 4
    assert fiche["dose_custom"] is True
    assert fiche["doses_par_bouteille"] == 450 / 4


def test_health_carries_the_build_stamp(client):
    h = client.get("/api/health").json()
    assert h["version"]
    assert len(h["build"]) == 10  # AAAA-MM-JJ


def test_stock_rows_carry_created_at(client):
    make_ref(client)
    row = client.get("/api/stock").json()["refs"][0]
    assert row["created_at"]


# ---------- barème daté ----------


def test_rates_come_from_the_dated_bareme(client):
    taux = {t["code"]: t for t in client.get("/api/taux").json()["taux"]}
    assert taux["accise"]["valeur"] == 1954
    assert taux["accise"]["effet_le"] == "2000-01-01"


def test_a_new_rate_applies_from_its_date_and_keeps_the_old_one(client):
    client.post(
        "/api/taux",
        json={"code": "accise", "valeur": 2100, "effet_le": "2026-01-01", "note": "LF 2026"},
    )
    # le taux courant est le plus récent entré en vigueur
    assert client.get("/api/state").json()["rates"]["accise"] == 2100
    # l'ancien reste consultable, et s'applique toujours à sa période
    hist = [t for t in client.get("/api/taux").json()["taux"] if t["code"] == "accise"]
    assert len(hist) == 2
    assert client.get("/api/state?le=2025-06-01").json()["rates"]["accise"] == 1954
    assert client.get("/api/state?le=2026-06-01").json()["rates"]["accise"] == 2100


def test_a_future_rate_does_not_apply_yet(client):
    client.post("/api/taux", json={"code": "accise", "valeur": 3000, "effet_le": "2099-01-01"})
    assert client.get("/api/state").json()["rates"]["accise"] == 1954


def test_a_dated_rate_changes_the_duty_of_a_reference(client):
    rid = make_ref(client)
    avant = client.get(f"/api/refs/{rid}").json()["fiscal"]["accise"]
    client.post("/api/taux", json={"code": "accise", "valeur": 3908, "effet_le": "2020-01-01"})
    apres = client.get(f"/api/refs/{rid}").json()["fiscal"]["accise"]
    assert abs(apres - 2 * avant) < 1e-6


def test_deleting_a_rate_falls_back_to_the_previous_one(client):
    r = client.post("/api/taux", json={"code": "accise", "valeur": 2100, "effet_le": "2026-01-01"})
    assert client.get("/api/state").json()["rates"]["accise"] == 2100
    client.delete(f"/api/taux/{r.json()['id']}")
    assert client.get("/api/state").json()["rates"]["accise"] == 1954
