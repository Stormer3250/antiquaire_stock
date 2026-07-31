"""Assemblage de l'application : DB, routes API, frontend statique, sauvegardes."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from antiquaire import db
from antiquaire.api import router
from antiquaire.api_admin import router as admin_router

STATIC_DIR = Path(__file__).parent.parent.parent / "static"


def create_app(db_path: str | Path | None = None, with_scheduler: bool | None = None) -> FastAPI:
    if db_path is None:
        db_path = db.data_dir() / "stock.db"
        if with_scheduler is None:
            with_scheduler = True
    conn = db.connect(db_path)
    db.migrate(conn)  # échoue fort : pas de migration, pas de service
    conn.close()

    app = FastAPI(title="L'Antiquaire", docs_url="/docs")
    app.state.db_path = Path(db_path)
    app.include_router(router, prefix="/api")
    app.include_router(admin_router, prefix="/api")
    if STATIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    if with_scheduler:
        from antiquaire import backups

        backups.start_scheduler(app.state.db_path)
    return app
