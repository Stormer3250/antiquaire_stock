import io

import openpyxl
import pytest
from fastapi.testclient import TestClient

from antiquaire import importer
from antiquaire.main import create_app

RESERVE = 1


@pytest.fixture
def client(tmp_path):
    app = create_app(db_path=tmp_path / "imp.db")
    with TestClient(app) as c:
        yield c


def xlsx_bytes(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


CSV = "nom;volume;degre;achat;stock\nGin London Dry;70;41,6;18,40;6\nMezcal espadín;70;45;31,00;2\n"


def test_normalize_accent_case():
    assert importer.normalize("  Mezcal ESPADÍN ") == "mezcal espadin"


def test_inspect_csv():
    ins = importer.inspect_file("cave.csv", CSV.encode())
    assert [c["sample"] for c in ins["columns"]][:2] == ["Gin London Dry", "70"]
    assert ins["row_count"] == 2
    assert ins["token"]


def test_inspect_xlsx():
    data = xlsx_bytes([["nom", "achat"], ["Rhum", 24.9]])
    ins = importer.inspect_file("cave.xlsx", data)
    assert ins["row_count"] == 1
    assert ins["columns"][0]["letter"] == "A"


def test_apply_creates_and_updates(client):
    # existing ref, accent/case variant in the file
    rid = client.post(
        "/api/refs",
        json={
            "nom": "Gin London Dry",
            "categorie_id": 1,
            "vol_cl": 70,
            "abv": 41,
            "achat_ht": 15.0,
            "seuil": 5,
        },
    ).json()["id"]
    ins = client.post(
        "/api/import/inspect", files={"file": ("cave.csv", CSV.encode(), "text/csv")}
    ).json()
    mapping = {"0": "nom", "1": "volume", "2": "degre", "3": "achat", "4": "stock"}
    r = client.post(
        "/api/import/apply",
        json={"token": ins["token"], "mapping": mapping, "location_id": RESERVE, "categorie_id": 1},
    )
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["updated"] == 1 and res["created"] == 1
    rows = {x["nom"]: x for x in client.get("/api/stock").json()["refs"]}
    assert rows["Gin London Dry"]["achat_ht"] == 18.40
    assert rows["Gin London Dry"]["abv"] == 41.6
    assert rows["Gin London Dry"]["stock"] == 6
    assert rows["Gin London Dry"]["seuil"] == 5  # unmapped fields untouched
    assert rows["Mezcal espadín"]["stock"] == 2
    assert rows["Mezcal espadín"]["id"] != rid
    hist = client.get("/api/imports").json()["imports"]
    assert hist[0]["created_count"] == 1 and hist[0]["updated_count"] == 1


def test_apply_reports_bad_lines_but_applies_good_ones(client):
    csv_bad = "nom;achat\nGin;pas-un-prix\nRhum;24,90\n"
    ins = client.post(
        "/api/import/inspect", files={"file": ("x.csv", csv_bad.encode(), "text/csv")}
    ).json()
    r = client.post(
        "/api/import/apply",
        json={
            "token": ins["token"],
            "mapping": {"0": "nom", "1": "achat"},
            "location_id": RESERVE,
            "categorie_id": 1,
        },
    ).json()
    assert r["created"] == 1 and len(r["errors"]) == 1
    assert "ligne 2" in r["errors"][0]


def test_apply_references_only_writes_no_movements(client):
    """Import catalogue seul (pas de colonne stock) : les quantités ne bougent pas."""
    csv_refs = "nom;achat;fournisseur\nGin London Dry;18,40;Dugas\nMezcal espadín;31,00;Dugas\n"
    ins = client.post(
        "/api/import/inspect", files={"file": ("tarif.csv", csv_refs.encode(), "text/csv")}
    ).json()
    r = client.post(
        "/api/import/apply",
        json={
            "token": ins["token"],
            "mapping": {"0": "nom", "1": "achat", "2": "fournisseur"},
            "location_id": RESERVE,
            "categorie_id": 1,
        },
    ).json()
    assert r["created"] == 2 and r["errors"] == []
    assert client.get("/api/movements").json()["movements"] == []
    rows = {x["nom"]: x for x in client.get("/api/stock").json()["refs"]}
    assert rows["Mezcal espadín"]["achat_ht"] == 31.0
    assert rows["Mezcal espadín"]["stock"] == 0


def test_apply_requires_nom_mapping(client):
    ins = client.post(
        "/api/import/inspect", files={"file": ("x.csv", CSV.encode(), "text/csv")}
    ).json()
    r = client.post(
        "/api/import/apply",
        json={
            "token": ins["token"],
            "mapping": {"1": "volume"},
            "location_id": RESERVE,
            "categorie_id": 1,
        },
    )
    assert r.status_code == 422


def test_template_downloads_and_roundtrips(client):
    """Les modèles se téléchargent et repassent tels quels dans l'import."""
    x = client.get("/api/import/template?format=xlsx")
    assert x.status_code == 200
    assert "modele-antiquaire.xlsx" in x.headers["content-disposition"]
    wb = openpyxl.load_workbook(io.BytesIO(x.content))
    assert [c.value for c in wb.active[1]][0] == "Nom"

    c = client.get("/api/import/template?format=csv")
    assert c.status_code == 200 and "Nom;Marque" in c.text

    # le modèle rempli s'importe : en-têtes reconnus par inspect, application ok
    ins = client.post(
        "/api/import/inspect",
        files={"file": ("modele-antiquaire.xlsx", x.content, "application/octet-stream")},
    ).json()
    headers = [col["header"] for col in ins["columns"]]
    assert headers[0] == "Nom" and "Quantité en stock" in headers
    mapping = {
        "0": "nom",
        "1": "marque",
        "3": "volume",
        "4": "degre",
        "5": "achat",
        "6": "stock",
        "7": "fournisseur",
    }
    r = client.post(
        "/api/import/apply",
        json={"token": ins["token"], "mapping": mapping, "location_id": RESERVE, "categorie_id": 1},
    ).json()
    assert r["created"] == 2 and r["errors"] == []


def test_apply_creates_unknown_categories_when_asked(client):
    csv_cats = "nom;categorie\nAberlour 10;Whisky\nAperol;Bitter\nCampari;Bitter\n"
    ins = client.post(
        "/api/import/inspect", files={"file": ("c.csv", csv_cats.encode(), "text/csv")}
    ).json()
    payload = {
        "token": ins["token"],
        "mapping": {"0": "nom", "1": "categorie"},
        "location_id": RESERVE,
        "categorie_id": 1,
    }
    # sans l'option : lignes ignorées
    r = client.post("/api/import/apply", json=payload).json()
    assert r["created"] == 0 and len(r["errors"]) == 3
    # avec l'option : catégories créées une seule fois
    ins = client.post(
        "/api/import/inspect", files={"file": ("c.csv", csv_cats.encode(), "text/csv")}
    ).json()
    payload["token"] = ins["token"]
    payload["create_categories"] = True
    r = client.post("/api/import/apply", json=payload).json()
    assert r["created"] == 3 and r["errors"] == []
    noms = [c["nom"] for c in client.get("/api/state").json()["categories"]]
    assert noms.count("Whisky") == 1 and noms.count("Bitter") == 1


def test_apply_feeds_fournisseur_list(client):
    csv_four = "nom;fournisseur\nGin X;Murgier\nGin Y;dugas\n"  # dugas = déjà connu (casse)
    ins = client.post(
        "/api/import/inspect", files={"file": ("f.csv", csv_four.encode(), "text/csv")}
    ).json()
    client.post(
        "/api/import/apply",
        json={
            "token": ins["token"],
            "mapping": {"0": "nom", "1": "fournisseur"},
            "location_id": RESERVE,
            "categorie_id": 1,
        },
    )
    fours = client.get("/api/state").json()["lists"]["fournisseurs"]
    assert "Murgier" in fours
    assert sum(1 for f in fours if f.lower() == "dugas") == 1  # pas de doublon


def test_apply_unknown_token(client):
    r = client.post(
        "/api/import/apply",
        json={"token": "nope", "mapping": {"0": "nom"}, "location_id": RESERVE, "categorie_id": 1},
    )
    assert r.status_code == 410
