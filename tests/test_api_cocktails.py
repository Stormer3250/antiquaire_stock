import pytest
from fastapi.testclient import TestClient

from antiquaire.main import create_app

RESERVE = 1


@pytest.fixture
def client(tmp_path):
    app = create_app(db_path=tmp_path / "api.db")
    with TestClient(app) as c:
        yield c


@pytest.fixture
def rhum(client):
    r = client.post(
        "/api/refs",
        json={
            "nom": "Rhum blanc",
            "categorie_id": 1,
            "vol_cl": 70,
            "abv": 55,
            "achat_ht": 24.90,
            "droits_inclus": True,
            "seuil": 2,
        },
    )
    rid = r.json()["id"]
    client.post(
        "/api/movements/bulk",
        json={
            "location_id": RESERVE,
            "source": "manuel",
            "lines": [{"ref_id": rid, "type": "comptage", "quantity": 8}],
        },
    )
    return rid


@pytest.fixture
def zeste(client):
    return client.post(
        "/api/refs",
        json={
            "nom": "Zeste",
            "categorie_id": 6,
            "suivi": False,
            "unite": "zeste",
            "achat_ht": 0.15,
        },
    ).json()["id"]


def test_cocktail_lifecycle_and_costing(client, rhum, zeste):
    cid = client.post("/api/cocktails", json={"nom": "Ti punch"}).json()["id"]
    r = client.patch(
        f"/api/cocktails/{cid}",
        json={
            "prix_ttc": 12,
            "ings": [{"ref_id": rhum, "qty": 4}, {"ref_id": zeste, "qty": 1}],
        },
    )
    assert r.status_code == 200
    c = next(x for x in client.get("/api/cocktails").json()["cocktails"] if x["id"] == cid)
    expected_cost = 24.90 / 70 * 4 + 0.15
    assert c["cost"] == pytest.approx(expected_cost)
    assert c["marge"] == pytest.approx((12 / 1.2 - expected_cost) / (12 / 1.2) * 100)
    # feasibility: 8 bottles × 70cl / 4cl = 140 services, limitant = rhum
    assert c["feasibility"] == {"services": 140, "limitant": "Rhum blanc"}
    assert c["suggested"] == pytest.approx(round(round((expected_cost / 0.2 * 1.2) / 0.5) * 0.5, 2))


def test_cocktail_delete_soft(client):
    cid = client.post("/api/cocktails", json={"nom": "X"}).json()["id"]
    assert client.delete(f"/api/cocktails/{cid}").status_code == 200
    assert all(c["id"] != cid for c in client.get("/api/cocktails").json()["cocktails"])


def test_settings_patch_merges_per_key(client):
    r = client.patch("/api/settings", json={"pricing": {"cible": 82}})
    assert r.status_code == 200
    s = client.get("/api/state").json()
    assert s["pricing"]["cible"] == 82
    assert s["pricing"]["min"] == 75  # untouched sibling survives
    assert s["rates"]["accise"] == 1954


def test_category_crud_and_delete_reassigns(client, rhum):
    cid = client.post(
        "/api/categories", json={"nom": "Mezcal", "dose_cl": 5, "regime": "spiritueux"}
    ).json()["id"]
    client.patch(f"/api/refs/{rhum}", json={"categorie_id": cid})
    assert client.delete(f"/api/categories/{cid}").status_code == 200
    row = next(x for x in client.get("/api/stock").json()["refs"] if x["id"] == rhum)
    assert row["categorie_nom"] == "Spiritueux"  # reassigned to first active


def test_location_guard_last_active(client):
    assert client.delete("/api/locations/1").status_code == 200
    assert client.delete("/api/locations/2").status_code == 422  # last one stays


def test_location_create_and_rename(client):
    lid = client.post("/api/locations", json={"nom": "Cave du bas"}).json()["id"]
    client.patch(f"/api/locations/{lid}", json={"nom": "Cave"})
    noms = [loc["nom"] for loc in client.get("/api/state").json()["locations"]]
    assert "Cave" in noms and "Cave du bas" not in noms


def test_cocktail_cost_respects_the_reference_cascade(client):
    """Le coût d'une fiche suit alcoolise/dom, pas seulement le régime de catégorie."""
    spirit = next(
        c for c in client.get("/api/state").json()["categories"] if c["regime"] == "spiritueux"
    )
    base = {
        "nom": "Rhum test",
        "categorie_id": spirit["id"],
        "vol_cl": 70,
        "abv": 50,
        "achat_ht": 25.0,
    }
    plain = client.post("/api/refs", json=base).json()["id"]
    dom = client.post("/api/refs", json={**base, "nom": "Rhum DOM test", "dom": True}).json()["id"]

    def cost_of(ref_id):
        cid = client.post("/api/cocktails", json={}).json()["id"]
        client.patch(f"/api/cocktails/{cid}", json={"ings": [{"ref_id": ref_id, "qty": 5}]})
        return next(
            c for c in client.get("/api/cocktails").json()["cocktails"] if c["id"] == cid
        )["cost"]

    assert cost_of(dom) < cost_of(plain)
