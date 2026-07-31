"""Sauvegardes : instantanés VACUUM INTO, rétention, restauration, export CSV."""

import csv
import datetime
import io
import shutil
import sqlite3
import threading
import time
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response

from antiquaire import db
from antiquaire.api import Conn

router = APIRouter()

KEEP_DAILIES = 30
KEEP_MONTHS = 12


def snapshot(db_path: Path, backups_dir: Path, prefix: str = "stock") -> Path:
    """Copie propre et autonome de toute la base — c'est aussi le dump portable."""
    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.date.today().isoformat()
    target = backups_dir / f"{prefix}-{stamp}.db"
    n = 1
    while target.exists():
        n += 1
        target = backups_dir / f"{prefix}-{stamp}-{n}.db"
    conn = db.connect(db_path)
    try:
        conn.execute("VACUUM INTO ?", (str(target),))
    finally:
        conn.close()
    return target


def restore(db_path: Path, snapshot_path: Path) -> None:
    """Restaure un instantané, après avoir mis l'état courant de côté (annulable)."""
    snapshot(db_path, snapshot_path.parent, prefix="avant-restauration")
    # purge les fichiers WAL/SHM pour que la copie soit l'état complet
    for suffix in ("-wal", "-shm"):
        p = Path(str(db_path) + suffix)
        p.unlink(missing_ok=True)
    shutil.copyfile(snapshot_path, db_path)


def prune(backups_dir: Path, today: datetime.date | None = None) -> int:
    today = today or datetime.date.today()
    cutoff = today - datetime.timedelta(days=KEEP_DAILIES - 1)
    month_floor = (today.replace(day=1) - datetime.timedelta(days=365)).replace(day=1)
    removed = 0
    for p in backups_dir.glob("stock-*.db"):
        try:
            d = datetime.date.fromisoformat(p.name[6:16])
        except ValueError:
            continue
        keep = d >= cutoff or (d.day == 1 and d >= month_floor)
        if not keep:
            p.unlink()
            removed += 1
    return removed


EXPORT_TABLES = {
    "references.csv": "SELECT * FROM refs",
    "categories.csv": "SELECT * FROM categories",
    "lieux.csv": "SELECT * FROM locations",
    "mouvements.csv": "SELECT * FROM movements",
    "cocktails.csv": "SELECT * FROM cocktails",
    "cocktail_ingredients.csv": "SELECT * FROM cocktail_ings",
    "imports.csv": "SELECT * FROM imports",
    "reglages.csv": "SELECT * FROM settings",
}


def export_zip(conn: sqlite3.Connection) -> bytes:
    from antiquaire import stock as stock_mod

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, query in EXPORT_TABLES.items():
            rows = conn.execute(query).fetchall()
            out = io.StringIO()
            writer = csv.writer(out, delimiter=";")
            if rows:
                writer.writerow(rows[0].keys())
                writer.writerows([list(r) for r in rows])
            else:
                cols = [d[0] for d in conn.execute(query).description]
                writer.writerow(cols)
            zf.writestr(name, out.getvalue())
        # niveaux dérivés, par lieu
        out = io.StringIO()
        writer = csv.writer(out, delimiter=";")
        writer.writerow(["reference", "lieu", "niveau"])
        refs = {r["id"]: r["nom"] for r in conn.execute("SELECT id, nom FROM refs")}
        for loc in conn.execute("SELECT id, nom FROM locations WHERE active = 1").fetchall():
            for ref_id, niveau in stock_mod.stock_levels(conn, loc["id"]).items():
                writer.writerow([refs.get(ref_id, ref_id), loc["nom"], niveau])
        zf.writestr("niveaux_stock.csv", out.getvalue())
    return buf.getvalue()


# ---------- planificateur ----------


def _daily_loop(db_path: Path) -> None:
    while True:
        try:
            backups_dir = db.data_dir() / "backups"
            today = datetime.date.today().isoformat()
            if not (backups_dir / f"stock-{today}.db").exists():
                snapshot(db_path, backups_dir)
                prune(backups_dir)
        except Exception:  # noqa: BLE001 — le planificateur ne doit jamais mourir
            pass
        time.sleep(3600)


def start_scheduler(db_path: Path) -> None:
    threading.Thread(target=_daily_loop, args=(db_path,), daemon=True).start()


# ---------- routes ----------


def _backups_dir() -> Path:
    return db.data_dir() / "backups"


@router.get("/backups")
def backups_list():
    items = sorted(_backups_dir().glob("*.db"), key=lambda p: p.name, reverse=True)
    return {
        "backups": [
            {
                "name": p.name,
                "size": p.stat().st_size,
                "date": datetime.datetime.fromtimestamp(p.stat().st_mtime).isoformat(
                    timespec="seconds"
                ),
            }
            for p in items
        ]
    }


@router.post("/backups")
def backups_create(request_conn: Conn):
    path = snapshot(
        Path(request_conn.execute("PRAGMA database_list").fetchone()[2]), _backups_dir()
    )
    return {"ok": True, "name": path.name}


@router.post("/backups/{name}/restore")
def backups_restore(name: str, request_conn: Conn):
    target = _backups_dir() / name
    if "/" in name or "\\" in name or not target.is_file():
        raise HTTPException(404, "instantané inconnu")
    db_path = Path(request_conn.execute("PRAGMA database_list").fetchone()[2])
    request_conn.close()
    restore(db_path, target)
    return {"ok": True}


@router.get("/export")
def export(conn: Conn):
    stamp = datetime.date.today().isoformat()
    return Response(
        export_zip(conn),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="antiquaire-export-{stamp}.zip"'},
    )
