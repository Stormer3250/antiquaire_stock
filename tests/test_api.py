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
