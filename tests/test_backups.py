import datetime
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from antiquaire import backups, db
from antiquaire.main import create_app


def test_snapshot_restore_roundtrip(tmp_path):
    db_path = tmp_path / "s.db"
    conn = db.connect(db_path)
    db.migrate(conn)
    conn.execute("INSERT INTO refs (nom, categorie_id, created_at) VALUES ('A', 1, 'x')")
    conn.commit()
    snap = backups.snapshot(db_path, tmp_path / "backups")
    assert snap.exists() and snap.name.startswith("stock-")
    conn.execute("DELETE FROM refs")
    conn.commit()
    conn.close()
    backups.restore(db_path, snap)
    conn2 = db.connect(db_path)
    assert conn2.execute("SELECT count(*) FROM refs").fetchone()[0] == 1
    # pre-restore safety snapshot was taken
    assert any(p.name.startswith("avant-restauration-") for p in (tmp_path / "backups").iterdir())
    conn2.close()


def test_snapshot_collision_suffix(tmp_path):
    db_path = tmp_path / "s.db"
    conn = db.connect(db_path)
    db.migrate(conn)
    conn.close()
    a = backups.snapshot(db_path, tmp_path / "b")
    b = backups.snapshot(db_path, tmp_path / "b")
    assert a != b and b.exists()


def test_prune_keeps_30_dailies_plus_monthly_firsts(tmp_path):
    bdir = tmp_path / "b"
    bdir.mkdir()
    today = datetime.date(2026, 7, 31)
    for i in range(100):
        d = today - datetime.timedelta(days=i)
        (bdir / f"stock-{d.isoformat()}.db").write_bytes(b"x")
    backups.prune(bdir, today=today)
    names = sorted(p.name for p in bdir.iterdir())
    recent_cutoff = today - datetime.timedelta(days=29)
    for p in bdir.iterdir():
        d = datetime.date.fromisoformat(p.name[6:16])
        assert d >= recent_cutoff or d.day == 1
    # firsts of covered months survive
    assert "stock-2026-05-01.db" in names and "stock-2026-06-01.db" in names


def test_export_zip_contains_all_tables(tmp_path):
    conn = db.connect(tmp_path / "e.db")
    db.migrate(conn)
    data = backups.export_zip(conn)
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = set(zf.namelist())
    for expected in (
        "references.csv",
        "categories.csv",
        "lieux.csv",
        "mouvements.csv",
        "cocktails.csv",
        "cocktail_ingredients.csv",
        "imports.csv",
        "reglages.csv",
        "niveaux_stock.csv",
    ):
        assert expected in names
    conn.close()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTIQUAIRE_DATA_DIR", str(tmp_path / "data"))
    app = create_app(db_path=tmp_path / "api.db")
    with TestClient(app) as c:
        yield c


def test_backup_routes(client):
    r = client.post("/api/backups")
    assert r.status_code == 200
    listing = client.get("/api/backups").json()["backups"]
    assert len(listing) == 1 and listing[0]["name"].startswith("stock-")
    r = client.post(f"/api/backups/{listing[0]['name']}/restore")
    assert r.status_code == 200
    r = client.post("/api/backups/../../etc/passwd/restore")
    assert r.status_code in (404, 422)
    assert client.get("/api/export").status_code == 200
    assert client.get("/api/health").json()["last_backup_at"] is not None
