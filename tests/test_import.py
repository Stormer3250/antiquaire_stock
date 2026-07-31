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


def test_apply_unknown_token(client):
    r = client.post(
        "/api/import/apply",
        json={"token": "nope", "mapping": {"0": "nom"}, "location_id": RESERVE, "categorie_id": 1},
    )
    assert r.status_code == 410
