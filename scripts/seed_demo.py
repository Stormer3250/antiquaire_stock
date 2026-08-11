"""Remplit une base VIDE avec les fichiers de `import/` — la démo, sans cliquer.

Reprend les étapes 1, 2, 3 et 6 de import/00-checklist-init.md (les garnitures au kilo
et le ménage des catégories d'origine restent à faire à la main).

    python3 scripts/seed_demo.py http://172.21.0.2:8000
"""

import json
import mimetypes
import sys
import urllib.request
import uuid
from pathlib import Path

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
IMPORT_DIR = Path(__file__).parent.parent / "import"

# même correspondance d'en-têtes que static/js/importcard.js
HEADER_GUESS = {
    "nom": "nom",
    "marque": "marque",
    "categorie": "categorie",
    "catégorie": "categorie",
    "volume": "volume",
    "vol": "volume",
    "degre": "degre",
    "degré": "degre",
    "achat": "achat",
    "prix": "achat",
    "stock": "stock",
    "quantite": "stock",
    "quantité": "stock",
    "fournisseur": "fournisseur",
}


def call(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def upload(path: Path):
    boundary = uuid.uuid4().hex
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    body = b"".join(
        [
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
            f'filename="{path.name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode(),
            path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    req = urllib.request.Request(BASE + "/api/import/inspect", data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def import_file(name: str, location_id: int, categorie_id: int, create_categories=False):
    data = upload(IMPORT_DIR / name)
    mapping = {}
    for col in data["columns"]:
        h = col["header"].lower()
        hit = next((g for g in HEADER_GUESS if g in h), None)
        if hit:
            mapping[col["key"]] = HEADER_GUESS[hit]
    result = call(
        "POST",
        "/api/import/apply",
        {
            "token": data["token"],
            "mapping": mapping,
            "location_id": location_id,
            "categorie_id": categorie_id,
            "create_categories": create_categories,
        },
    )
    print(
        f"{name}: {result.get('created')} créées, {result.get('updated')} mises à jour, "
        f"{len(result.get('errors', []))} erreurs"
    )
    for err in result.get("errors", [])[:5]:
        print("   ", err)


state = call("GET", "/api/state")
if any(loc["nom"] == "Cave" for loc in state["locations"]):
    sys.exit("déjà initialisée — repartez d'une base vide")

# étape 1 : les lieux du bar
for loc, nouveau in (("Réserve", "Cave"), ("Comptoir", "Haut")):
    lid = next(x["id"] for x in state["locations"] if x["nom"] == loc)
    call("PATCH", f"/api/locations/{lid}", {"nom": nouveau})
state = call("GET", "/api/state")
lieux = {x["nom"]: x["id"] for x in state["locations"]}
cat_defaut = state["categories"][0]["id"]

import_file("01-references-stock-cave.xlsx", lieux["Cave"], cat_defaut, create_categories=True)
import_file("02-stock-haut.xlsx", lieux["Haut"], cat_defaut)
import_file("03-tarifs.xlsx", lieux["Cave"], cat_defaut)
