"""Connexion SQLite et migrations (PRAGMA user_version)."""

import os
import sqlite3
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def data_dir() -> Path:
    d = Path(os.environ.get("ANTIQUAIRE_DATA_DIR", Path.home() / "AntiquaireStock"))
    for sub in ("", "backups", "exports", "logs"):
        (d / sub).mkdir(parents=True, exist_ok=True)
    return d


def connect(db_path: str | Path) -> sqlite3.Connection:
    # check_same_thread=False : FastAPI peut créer et utiliser la connexion depuis
    # deux threads du pool ; chaque requête a SA connexion, jamais partagée.
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def migrate(conn: sqlite3.Connection, migrations_dir: Path = MIGRATIONS_DIR) -> int:
    """Applique les migrations au-dessus de user_version. Échoue fort, jamais à moitié."""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    for path in sorted(migrations_dir.glob("[0-9]*.sql")):
        number = int(path.name.split("_")[0])
        if number <= version:
            continue
        try:
            conn.executescript(path.read_text())  # commits pending txn, runs script
            conn.execute(f"PRAGMA user_version = {number}")
            conn.commit()
        except sqlite3.Error as e:
            conn.rollback()
            raise RuntimeError(f"migration {path.name} a échoué: {e}") from e
        version = number
    return version
