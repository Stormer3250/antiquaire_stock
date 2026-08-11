import pytest
from fastapi.testclient import TestClient

from antiquaire.main import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(db_path=tmp_path / "menus.db")
    with TestClient(app) as c:
        yield c


def fiche(client, nom, prix):
    cid = client.post("/api/cocktails", json={}).json()["id"]
    client.patch(f"/api/cocktails/{cid}", json={"nom": nom, "prix_ttc": prix})
    return cid


def test_menu_holds_its_cocktails_in_order(client):
    a, b = fiche(client, "Negroni", 14), fiche(client, "Spritz", 11)
    mid = client.post("/api/menus", json={"nom": "Carte principale"}).json()["id"]
    client.patch(f"/api/menus/{mid}", json={"cocktail_ids": [b, a]})
    menu = client.get("/api/menus").json()["menus"][0]
    assert [c["nom"] for c in menu["cocktails"]] == ["Spritz", "Negroni"]
    assert client.get("/api/menus").json()["hors_menu"] == []


def test_a_cocktail_cannot_join_two_menus(client):
    a = fiche(client, "Negroni", 14)
    m1 = client.post("/api/menus", json={"nom": "Carte"}).json()["id"]
    m2 = client.post("/api/menus", json={"nom": "Été"}).json()["id"]
    client.patch(f"/api/menus/{m1}", json={"cocktail_ids": [a]})
    r = client.patch(f"/api/menus/{m2}", json={"cocktail_ids": [a]})
    assert r.status_code == 422
    assert "autre menu" in r.json()["detail"]
    # le premier menu n'a pas été abîmé au passage
    menus = {m["nom"]: m for m in client.get("/api/menus").json()["menus"]}
    assert len(menus["Carte"]["cocktails"]) == 1
    assert menus["Été"]["cocktails"] == []


def test_activating_a_tarification_deactivates_its_siblings(client):
    a = fiche(client, "Negroni", 14)
    mid = client.post("/api/menus", json={"nom": "Carte"}).json()["id"]
    client.patch(f"/api/menus/{mid}", json={"cocktail_ids": [a]})
    t1 = client.post(f"/api/menus/{mid}/tarifs", json={"nom": "Hiver"}).json()["id"]
    t2 = client.post(f"/api/menus/{mid}/tarifs", json={"nom": "Été"}).json()["id"]
    client.patch(f"/api/tarifs/{t1}", json={"actif": True})
    client.patch(f"/api/tarifs/{t2}", json={"actif": True})
    tarifs = {t["id"]: t["actif"] for t in client.get("/api/menus").json()["menus"][0]["tarifs"]}
    assert tarifs == {t1: False, t2: True}


def test_a_new_tarification_starts_from_the_current_prices(client):
    a = fiche(client, "Negroni", 14)
    mid = client.post("/api/menus", json={"nom": "Carte"}).json()["id"]
    client.patch(f"/api/menus/{mid}", json={"cocktail_ids": [a]})
    tid = client.post(f"/api/menus/{mid}/tarifs", json={"nom": "Été"}).json()["id"]
    tarif = client.get("/api/menus").json()["menus"][0]["tarifs"][0]
    assert tarif["id"] == tid
    assert tarif["prix"][str(a)] == 14


def test_duplicating_copies_the_prices_and_stays_inactive(client):
    a, b = fiche(client, "Negroni", 14), fiche(client, "Spritz", 11)
    mid = client.post("/api/menus", json={"nom": "Carte"}).json()["id"]
    client.patch(f"/api/menus/{mid}", json={"cocktail_ids": [a, b]})
    t1 = client.post(f"/api/menus/{mid}/tarifs", json={"nom": "Hiver"}).json()["id"]
    client.patch(f"/api/tarifs/{t1}", json={"prix": {str(a): 15.5, str(b): 12.0}, "actif": True})
    t2 = client.post(
        f"/api/menus/{mid}/tarifs", json={"nom": "Happy hour", "from_tarif_id": t1}
    ).json()["id"]
    tarifs = {t["id"]: t for t in client.get("/api/menus").json()["menus"][0]["tarifs"]}
    assert tarifs[t2]["prix"] == {str(a): 15.5, str(b): 12.0}
    assert tarifs[t2]["actif"] is False
    assert tarifs[t1]["actif"] is True

    # et les deux vivent leur vie : modifier la copie ne touche pas l'originale
    client.patch(f"/api/tarifs/{t2}", json={"prix": {str(a): 9.0}})
    tarifs = {t["id"]: t for t in client.get("/api/menus").json()["menus"][0]["tarifs"]}
    assert tarifs[t2]["prix"][str(a)] == 9.0
    assert tarifs[t1]["prix"][str(a)] == 15.5


def test_menu_kpis(client):
    a, b = fiche(client, "Negroni", 20), fiche(client, "Spritz", 10)
    mid = client.post("/api/menus", json={"nom": "Carte"}).json()["id"]
    client.patch(f"/api/menus/{mid}", json={"cocktail_ids": [a, b]})
    k = client.get("/api/menus").json()["menus"][0]["kpis"]
    assert k["n"] == 2
    assert k["prix_moyen"] == 15
    assert k["prix_mini"] == 10
    assert k["prix_maxi"] == 20
    assert k["ecart"] == 10


def test_deleting_a_menu_frees_its_cocktails(client):
    a = fiche(client, "Negroni", 14)
    mid = client.post("/api/menus", json={"nom": "Carte"}).json()["id"]
    client.patch(f"/api/menus/{mid}", json={"cocktail_ids": [a]})
    tid = client.post(f"/api/menus/{mid}/tarifs", json={"nom": "Été"}).json()["id"]
    client.patch(f"/api/tarifs/{tid}", json={"prix": {str(a): 16.0}, "actif": True})
    client.delete(f"/api/menus/{mid}")
    data = client.get("/api/menus").json()
    assert data["menus"] == []
    assert [c["nom"] for c in data["hors_menu"]] == ["Negroni"]
    # la fiche retrouve son prix propre, pas celui de la tarification supprimée
    assert client.get("/api/cocktails").json()["cocktails"][0]["prix_ttc"] == 14


def test_unknown_menu_and_tarif_are_404(client):
    assert client.patch("/api/menus/999", json={"nom": "x"}).status_code == 404
    assert client.patch("/api/tarifs/999", json={"nom": "x"}).status_code == 404
    assert client.delete("/api/menus/999").status_code == 404
