# Wave 2, Phase 1: Doses, Fiscal Cascade & Hygiene, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fiscal treatment of a reference explicit and correct (alcohol yes/no, régime, rum from the DOM, duties already paid), let each reference carry its own dose, replace the "doses disponibles" KPI with a reference count, and clear the three hygiene debts (browser `alert()`, no drag & drop, no build stamp).

**Architecture:** Nothing structural moves. One new SQL migration adds four columns to `refs` and one rate to `settings`. Three small pure functions join `pricing.py` and become the single place the cascade is resolved, so every caller (the register, the fiche, the cocktail cost, the barème) picks it up at once. The frontend gains one shared `alertModal` and one small drag & drop handler.

**Tech Stack:** Python 3.12, FastAPI sync routes, stdlib `sqlite3`, pytest. Frontend: vanilla ES modules, no build step, no new dependency.

## Global Constraints

- **Everything synchronous.** No `async`/`await` anywhere in `src/`.
- **No new runtime dependency.** `openpyxl` remains the only non-stdlib import outside FastAPI/uvicorn.
- **Migrations are numbered `.sql` files** in `src/antiquaire/migrations/`, applied by `db.migrate` above `PRAGMA user_version`. Never edit `001_init.sql`.
- **UI language is French.** No em dashes in user-facing copy: use a colon or a comma.
- **No browser `alert()`, `confirm()` or `prompt()`.** Modals come from `static/js/ui.js`.
- **French commit messages**, matching the existing log (`feat: …`, `fix: …`).
- **Land via a branch and a PR** to `main`. Branch name: `feat/wave2-phase1`.
- The pure-function rule in `pricing.py` holds: dict in, number out, zero I/O.

---

### Task 1: Migration and the schema columns

**Files:**
- Create: `src/antiquaire/migrations/002_dose_fiscal.sql`
- Test: `tests/test_db.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `refs.dose_cl REAL NULL`, `refs.alcoolise INTEGER NOT NULL DEFAULT 1`, `refs.regime TEXT NULL`, `refs.dom INTEGER NOT NULL DEFAULT 0`, and the `accise_dom` key inside the `rates` settings JSON.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_db.py`:

```python
def test_migration_002_adds_dose_and_fiscal_columns(conn):
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(refs)")}
    assert {"dose_cl", "alcoolise", "regime", "dom"} <= cols


def test_migration_002_adds_dom_rate(conn):
    import json

    rates = json.loads(
        conn.execute("SELECT value FROM settings WHERE key = 'rates'").fetchone()[0]
    )
    assert rates["accise_dom"] == 903.51


def test_migration_002_backfills_alcoolise(tmp_path):
    """Le rattrapage : l'existant sans alcool sort alcoolise = 0, le reste à 1."""
    import shutil

    staged = tmp_path / "migrations"
    staged.mkdir()
    shutil.copy(db.MIGRATIONS_DIR / "001_init.sql", staged)
    c = db.connect(tmp_path / "backfill.db")
    db.migrate(c, staged)  # état d'avant la vague 2

    spirit = c.execute("SELECT id FROM categories WHERE regime = 'spiritueux'").fetchone()[0]
    aucun = c.execute("SELECT id FROM categories WHERE regime = 'aucun'").fetchone()[0]
    c.executemany(
        "INSERT INTO refs (nom, categorie_id, abv, created_at) VALUES (?, ?, ?, '2026-01-01')",
        [("Rhum", spirit, 40.0), ("Sirop", aucun, 0.0), ("Eau plate", spirit, 0.0)],
    )
    c.commit()

    shutil.copy(db.MIGRATIONS_DIR / "002_dose_fiscal.sql", staged)
    db.migrate(c, staged)

    rows = {r["nom"]: r["alcoolise"] for r in c.execute("SELECT nom, alcoolise FROM refs")}
    assert rows["Rhum"] == 1
    assert rows["Sirop"] == 0       # catégorie sans régime fiscal
    assert rows["Eau plate"] == 0   # degré nul
    c.close()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_db.py -v`
Expected: FAIL, the columns do not exist and `accise_dom` is missing.

- [ ] **Step 3: Write the migration**

Create `src/antiquaire/migrations/002_dose_fiscal.sql`:

```sql
-- Dose par référence (NULL = dose de la catégorie) et cascade fiscale explicite.
ALTER TABLE refs ADD COLUMN dose_cl REAL;
ALTER TABLE refs ADD COLUMN alcoolise INTEGER NOT NULL DEFAULT 1;
ALTER TABLE refs ADD COLUMN regime TEXT;
ALTER TABLE refs ADD COLUMN dom INTEGER NOT NULL DEFAULT 0;

-- Reprise de l'existant : une référence dont la catégorie n'a aucun régime
-- fiscal, ou dont le degré est nul, n'est pas alcoolisée.
UPDATE refs SET alcoolise = 0
WHERE abv <= 0
   OR categorie_id IN (SELECT id FROM categories WHERE regime = 'aucun');

-- Taux réduit applicable au rhum traditionnel des DOM, éditable dans le barème.
UPDATE settings
SET value = json_set(value, '$.accise_dom', 903.51)
WHERE key = 'rates';
```

Note on `json_set`: SQLite ships the JSON1 extension by default in the Python builds we use; `tests/test_db.py` proves it works here rather than assuming it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_db.py -v`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `uv run pytest`
Expected: PASS, 54 existing tests unaffected (new columns have defaults).

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/wave2-phase1
git add src/antiquaire/migrations/002_dose_fiscal.sql tests/test_db.py
git commit -m "feat(schema): dose par référence, cascade fiscale et taux DOM"
```

---

### Task 2: The cascade in `pricing.py`

**Files:**
- Modify: `src/antiquaire/pricing.py`
- Test: `tests/test_pricing.py`

**Interfaces:**
- Consumes: the columns from Task 1.
- Produces, all pure and importable as `pricing.<name>`:
  - `effective_dose(ref: dict, cat: dict) -> float`
  - `effective_regime(ref: dict, cat: dict) -> str`
  - `effective_marge(ref: dict, cat: dict) -> float`
  - `fiscal_per_dose(regime, abv, dose_cl, rates, *, dom: bool = False) -> Fiscal`
  - `cost_per_dose(..., dom: bool = False)` (new keyword-only argument, defaulted)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_pricing.py`:

```python
RATES_DOM = {**RATES, "accise_dom": 903.51}


def test_effective_dose_inherits_then_overrides():
    cat = {"dose_cl": 5, "regime": "spiritueux", "marge_pct": 80}
    assert pricing.effective_dose({"dose_cl": None}, cat) == 5
    assert pricing.effective_dose({"dose_cl": 12}, cat) == 12


def test_effective_regime_cascade():
    cat = {"dose_cl": 5, "regime": "spiritueux", "marge_pct": 80}
    # 1. pas d'alcool : aucun droit, quel que soit le régime de la catégorie
    assert pricing.effective_regime({"alcoolise": 0, "regime": None}, cat) == "aucun"
    # 2. alcoolisé sans précision : régime hérité
    assert pricing.effective_regime({"alcoolise": 1, "regime": None}, cat) == "spiritueux"
    # 3. alcoolisé avec override
    assert pricing.effective_regime({"alcoolise": 1, "regime": "vin"}, cat) == "vin"


def test_effective_marge_inherits_then_overrides():
    cat = {"dose_cl": 5, "regime": "spiritueux", "marge_pct": 80}
    assert pricing.effective_marge({"marge_pct": None}, cat) == 80
    assert pricing.effective_marge({"marge_pct": 72}, cat) == 72


def test_dom_rate_applies_to_spiritueux_only():
    metro = pricing.fiscal_per_dose("spiritueux", 40, 5, RATES_DOM)
    dom = pricing.fiscal_per_dose("spiritueux", 40, 5, RATES_DOM, dom=True)
    assert math.isclose(dom.accise, metro.hlap * 903.51)
    assert dom.accise < metro.accise
    assert dom.ss == metro.ss  # la cotisation SS n'est pas réduite
    # le drapeau n'a aucun effet hors spiritueux
    vin = pricing.fiscal_per_dose("vin", 12, 12, RATES_DOM)
    vin_dom = pricing.fiscal_per_dose("vin", 12, 12, RATES_DOM, dom=True)
    assert vin.accise == vin_dom.accise


def test_dom_rate_falls_back_when_absent():
    """Un barème antérieur à la migration ne doit pas planter."""
    f = pricing.fiscal_per_dose("spiritueux", 40, 5, RATES, dom=True)
    assert math.isclose(f.accise, f.hlap * 1954)


def test_cost_per_dose_accepts_dom():
    plain = pricing.cost_per_dose(
        30, 70, 5, droits_inclus=False, regime="spiritueux", abv=40, rates=RATES_DOM
    )
    reduced = pricing.cost_per_dose(
        30, 70, 5, droits_inclus=False, regime="spiritueux", abv=40, rates=RATES_DOM, dom=True
    )
    assert reduced < plain
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_pricing.py -v`
Expected: FAIL with `AttributeError: module 'antiquaire.pricing' has no attribute 'effective_dose'` and an unexpected-keyword error on `dom`.

- [ ] **Step 3: Implement**

In `src/antiquaire/pricing.py`, add above `doses_per_bottle`:

```python
def effective_dose(ref: dict, cat: dict) -> float:
    """Dose de la référence, ou celle de sa catégorie si elle n'en fixe pas."""
    return ref["dose_cl"] if ref.get("dose_cl") is not None else cat["dose_cl"]


def effective_regime(ref: dict, cat: dict) -> str:
    """Cascade : pas d'alcool ⇒ aucun droit ; sinon régime propre, sinon catégorie."""
    if not ref.get("alcoolise", 1):
        return "aucun"
    return ref.get("regime") or cat["regime"]


def effective_marge(ref: dict, cat: dict) -> float:
    return ref["marge_pct"] if ref.get("marge_pct") is not None else cat["marge_pct"]
```

Change `fiscal_per_dose`'s signature and its spiritueux branch:

```python
def fiscal_per_dose(
    regime: str, abv: float, dose_cl: float, rates: dict, *, dom: bool = False
) -> Fiscal:
    """Droits d'accise + cotisation SS pour UNE dose, selon le régime fiscal."""
    hl = dose_cl / 100 / 100  # cl → L → hL de produit fini
    hlap = hl * abv / 100
    accise = 0.0
    if regime == "spiritueux" and abv > 0:
        # rhum traditionnel des DOM : taux réduit, si le barème le connaît
        taux = rates.get("accise_dom", rates["accise"]) if dom else rates["accise"]
        accise = hlap * taux
```

The rest of the function is unchanged. Then thread the flag through `cost_per_dose`:

```python
def cost_per_dose(
    achat_ht: float,
    vol_cl: float,
    dose_cl: float,
    *,
    droits_inclus: bool,
    regime: str,
    abv: float,
    rates: dict,
    dom: bool = False,
) -> float:
    """Coût matière d'une dose. Droits non inclus dans l'achat ⇒ taxes ajoutées."""
    doses = doses_per_bottle(vol_cl, dose_cl)
    base = achat_ht / doses if doses else 0.0
    if droits_inclus:
        return base
    f = fiscal_per_dose(regime, abv, dose_cl, rates, dom=dom)
    return base + f.accise + f.ss
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_pricing.py -v`
Expected: PASS, including the pre-existing tests, since `dom` is keyword-only and defaulted.

- [ ] **Step 5: Commit**

```bash
git add src/antiquaire/pricing.py tests/test_pricing.py
git commit -m "feat(pricing): cascade dose/régime et taux réduit DOM"
```

---

### Task 3: Wire the cascade into every read path

**Files:**
- Modify: `src/antiquaire/api.py` (`effective_marge`, `serialize_ref`, `REF_FIELDS`, `fiche`)
- Modify: `src/antiquaire/api_admin.py` (`cost_per_cl`, the ingredient SQL in `serialize_cocktail`)
- Test: `tests/test_api.py`, `tests/test_api_cocktails.py`

**Interfaces:**
- Consumes: `pricing.effective_dose`, `pricing.effective_regime`, `pricing.effective_marge` from Task 2.
- Produces: `/api/stock` rows and `/api/refs/{id}` gain `alcoolise` (bool), `regime` (the resolved string), `regime_custom` (bool), `dom` (bool), `dose_cl` (the resolved dose) and `dose_custom` (bool). `PATCH`/`POST /api/refs` accept `dose_cl`, `alcoolise`, `regime`, `dom`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_api.py` (follow the file's existing client fixture and helpers):

```python
def test_soft_drink_pays_no_duty_whatever_the_category(client):
    """Une référence non alcoolisée rangée dans Spiritueux ne paie aucun droit."""
    spirit = next(c for c in client.get("/api/state").json()["categories"]
                  if c["regime"] == "spiritueux")
    rid = client.post("/api/refs", json={
        "nom": "Tonic maison", "categorie_id": spirit["id"], "vol_cl": 20,
        "abv": 0, "achat_ht": 1.20, "alcoolise": False,
    }).json()["id"]
    fiche = client.get(f"/api/refs/{rid}").json()
    assert fiche["alcoolise"] is False
    assert fiche["regime"] == "aucun"
    assert fiche["fiscal"]["accise"] == 0
    assert fiche["fiscal"]["ss"] == 0
    assert fiche["cout_dose"] == fiche["cout_dose_base"]


def test_reference_regime_overrides_its_category(client):
    spirit = next(c for c in client.get("/api/state").json()["categories"]
                  if c["regime"] == "spiritueux")
    rid = client.post("/api/refs", json={
        "nom": "Vermouth maison", "categorie_id": spirit["id"], "vol_cl": 75,
        "abv": 16, "achat_ht": 12.0, "regime": "intermediaire",
    }).json()["id"]
    fiche = client.get(f"/api/refs/{rid}").json()
    assert fiche["regime"] == "intermediaire"
    assert fiche["regime_custom"] is True


def test_dom_flag_lowers_the_duty(client):
    spirit = next(c for c in client.get("/api/state").json()["categories"]
                  if c["regime"] == "spiritueux")
    body = {"nom": "Rhum agricole", "categorie_id": spirit["id"], "vol_cl": 70,
            "abv": 50, "achat_ht": 25.0}
    metro = client.get(f"/api/refs/{client.post('/api/refs', json=body).json()['id']}").json()
    rid = client.post("/api/refs", json={**body, "nom": "Rhum DOM", "dom": True}).json()["id"]
    dom = client.get(f"/api/refs/{rid}").json()
    assert dom["dom"] is True
    assert dom["fiscal"]["accise"] < metro["fiscal"]["accise"]
    assert dom["cout_dose"] < metro["cout_dose"]


def test_reference_dose_overrides_the_category(client):
    spirit = next(c for c in client.get("/api/state").json()["categories"]
                  if c["regime"] == "spiritueux")
    rid = client.post("/api/refs", json={
        "nom": "Magnum de rhum", "categorie_id": spirit["id"], "vol_cl": 450,
        "abv": 40, "achat_ht": 86.20, "dose_cl": 4,
    }).json()["id"]
    fiche = client.get(f"/api/refs/{rid}").json()
    assert fiche["dose_cl"] == 4
    assert fiche["dose_custom"] is True
    assert fiche["doses_par_bouteille"] == 450 / 4
```

Append to `tests/test_api_cocktails.py`:

```python
def test_cocktail_cost_respects_the_reference_cascade(client):
    """Le coût d'une fiche suit alcoolise/dom, pas seulement le régime de catégorie."""
    spirit = next(c for c in client.get("/api/state").json()["categories"]
                  if c["regime"] == "spiritueux")
    base = {"nom": "Rhum test", "categorie_id": spirit["id"], "vol_cl": 70,
            "abv": 50, "achat_ht": 25.0}
    plain = client.post("/api/refs", json=base).json()["id"]
    dom = client.post("/api/refs", json={**base, "nom": "Rhum DOM test", "dom": True}).json()["id"]

    def cost_of(ref_id):
        cid = client.post("/api/cocktails", json={}).json()["id"]
        client.patch(f"/api/cocktails/{cid}", json={"ings": [{"ref_id": ref_id, "qty": 5}]})
        return next(c for c in client.get("/api/cocktails").json()["cocktails"]
                    if c["id"] == cid)["cost"]

    assert cost_of(dom) < cost_of(plain)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_api.py tests/test_api_cocktails.py -v`
Expected: FAIL, the new fields are absent and `dose_cl` is rejected by `REF_FIELDS`.

- [ ] **Step 3: Implement in `api.py`**

Delete the local `effective_marge` definition and import the shared one. At the top of `serialize_ref`, resolve the cascade once:

```python
def serialize_ref(ref: dict, cat: dict, settings: dict, niveau: float) -> dict:
    """Une ligne du grand registre, avec tout le calcul prix/marge fait côté serveur."""
    suivi = bool(ref["suivi"])
    dose = pricing.effective_dose(ref, cat)
    regime = pricing.effective_regime(ref, cat)
    out = {
        ...                                   # champs existants inchangés
        "marge": pricing.effective_marge(ref, cat),
        "marge_custom": ref["marge_pct"] is not None,
        "dose_cl": dose,
        "dose_custom": ref["dose_cl"] is not None,
        "alcoolise": bool(ref["alcoolise"]),
        "regime": regime,
        "regime_custom": ref["regime"] is not None,
        "dom": bool(ref["dom"]),
    }
```

Replace `cat["dose_cl"]` with `dose` and `cat["regime"]` with `regime` in the `cost_per_dose` call, and pass `dom=bool(ref["dom"])`. Add the four names to `REF_FIELDS`:

```python
REF_FIELDS = {
    ...,
    "dose_cl",
    "alcoolise",
    "regime",
    "dom",
}
```

In `create_ref`, coerce the two booleans next to the existing `droits_inclus` line:

```python
    fields["droits_inclus"] = bool(fields.get("droits_inclus", False))
    fields["alcoolise"] = bool(fields.get("alcoolise", True))
    fields["dom"] = bool(fields.get("dom", False))
```

In `patch_ref`, coerce whichever of the three booleans are present:

```python
    for key in ("droits_inclus", "alcoolise", "dom"):
        if key in fields:
            fields[key] = bool(fields[key])
```

In `fiche`, use the resolved values rather than the category's:

```python
    base = serialize_ref(ref, cat, settings, niveau)
    f = pricing.fiscal_per_dose(
        base["regime"], ref["abv"], base["dose_cl"], settings["rates"], dom=bool(ref["dom"])
    )
    doses = pricing.doses_per_bottle(ref["vol_cl"], base["dose_cl"])
```

and drop `"regime": cat["regime"]` from the `fiscal` sub-dict, since `regime` now lives at the top level (update `static/js/screens/product.js` if it reads `p.fiscal.regime`; check with `grep -rn "fiscal.regime" static/`).

- [ ] **Step 4: Implement in `api_admin.py`**

Extend the ingredient query so the cascade columns come back with the row, and honour them in `cost_per_cl`:

```python
def cost_per_cl(ref: dict, cat: dict, rates: dict) -> float:
    """€ pour 1 cl d'une référence suivie, droits compris si nécessaire."""
    return pricing.cost_per_dose(
        ref["achat_ht"],
        ref["vol_cl"],
        1.0,
        droits_inclus=bool(ref["droits_inclus"]),
        regime=pricing.effective_regime(ref, cat),
        abv=ref["abv"],
        rates=rates,
        dom=bool(ref.get("dom", 0)),
    )
```

In `serialize_cocktail`, the SELECT gains three columns:

```sql
        """SELECT ci.id, ci.ref_id, ci.qty, r.nom, r.suivi, r.unite, r.vol_cl, r.achat_ht,
                  r.abv, r.droits_inclus, r.active, r.alcoolise, r.regime, r.dom,
                  c.regime AS cat_regime, c.nom AS categorie_nom
           FROM cocktail_ings ci
           ...
```

`cost_per_cl(r, r, rates)` is called with the same dict for ref and cat, so give that dict the key `effective_regime` expects by mapping the category régime in:

```python
        r = dict(row)
        r_cat = {"regime": r["cat_regime"]}
        unit_cost = cost_per_cl(r, r_cat, rates) if r["suivi"] else r["achat_ht"]
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest -v`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add src/antiquaire/api.py src/antiquaire/api_admin.py tests/test_api.py tests/test_api_cocktails.py
git commit -m "feat(api): la cascade fiscale et la dose par référence pilotent tous les calculs"
```

---

### Task 4: The cascade in the reference modal

**Files:**
- Modify: `static/js/refmodal.js`
- Test: manual, via the Playwright recipe at the end of this plan.

**Interfaces:**
- Consumes: the fields accepted by `POST`/`PATCH /api/refs` from Task 3.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the cascade state**

In `openRefModal`, extend `state`:

```js
  const state = {
    suivi: edit ? ref.suivi : suivi,
    cat: edit ? ref.categorie_id : null,
    four: edit ? ref.fournisseur : (S.meta.lists.fournisseurs[0] || ''),
    unite: edit ? ref.unite : (S.meta.lists.unites[0] || 'pièce'),
    droits: edit ? ref.droits_inclus : false,
    alcoolise: edit ? ref.alcoolise !== false : true,
    regime: edit && ref.regime_custom ? ref.regime : '',   // '' = hérité de la catégorie
    dom: edit ? !!ref.dom : false,
    vals: {},
  };
```

- [ ] **Step 2: Render the cascade**

Add this helper inside `openRefModal`, above `html()`:

```js
  const REGIMES = [
    { value: '', label: 'Hérité de la catégorie' },
    { value: 'spiritueux', label: 'Spiritueux' },
    { value: 'vin', label: 'Vin tranquille' },
    { value: 'mousseux', label: 'Vin mousseux' },
    { value: 'intermediaire', label: 'Produit intermédiaire' },
    { value: 'biere', label: 'Bière' },
  ];

  // Cascade fiscale : 1. alcool ? 2. degré 3. régime (+ DOM) 4. droits déjà payés.
  function fiscalHtml() {
    if (!state.suivi) return '';
    const catRegime = (S.meta.categories.find((c) => c.id === state.cat) || {}).regime;
    const effectif = state.regime || catRegime || 'aucun';
    return `
    <div class="field" style="grid-column:1 / -1; gap:10px;">
      <div class="mono-label">Droits d’alcool</div>
      <label class="row" style="gap:9px; cursor:pointer;">
        <input type="checkbox" data-alcoolise ${state.alcoolise ? 'checked' : ''} style="accent-color:var(--ac);">
        <span style="font-size:12.5px; color:var(--mut);">Cette référence contient de l’alcool</span>
      </label>
      ${state.alcoolise ? `
      <div class="row" style="gap:12px; align-items:flex-end;">
        <div class="field grow"><div class="mono-label">Régime fiscal</div>
          <select class="input" data-regime>
            ${REGIMES.map((r) => `<option value="${r.value}" ${r.value === state.regime ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
          </select></div>
      </div>
      ${effectif === 'spiritueux' ? `
      <label class="row" style="gap:9px; cursor:pointer;">
        <input type="checkbox" data-dom ${state.dom ? 'checked' : ''} style="accent-color:var(--ac);">
        <span style="font-size:12.5px; color:var(--mut);">Rhum des DOM : taux d’accise réduit</span>
      </label>` : ''}
      <label class="row" style="gap:9px; cursor:pointer;">
        <input type="checkbox" data-droits ${state.droits ? 'checked' : ''} style="accent-color:var(--ac);">
        <span style="font-size:12.5px; color:var(--mut);">Le prix d’achat ci-dessus inclut déjà les droits</span>
      </label>` : `
      <div class="sub pretty">Aucun droit d’accise ni cotisation : la référence est chiffrée
        au seul prix d’achat.</div>`}
    </div>`;
  }
```

Replace the existing standalone `droits` checkbox block in `html()` with `${fiscalHtml()}`, and add the dose field to the tracked-reference field list:

```js
          { key: 'vol_cl', k: 'Volume (cl)', ph: '70', num: true },
          { key: 'dose_cl', k: 'Dose (cl)', ph: 'vide = dose de la catégorie', num: true },
```

- [ ] **Step 3: Bind the new controls**

Inside `bind(modal)`, next to the existing `data-droits` binding:

```js
    const al = modal.querySelector('[data-alcoolise]');
    if (al) al.addEventListener('change', () => { state.alcoolise = al.checked; rerender(); });
    const rg = modal.querySelector('[data-regime]');
    if (rg) rg.addEventListener('change', () => { state.regime = rg.value; rerender(); });
    const dm = modal.querySelector('[data-dom]');
    if (dm) dm.addEventListener('change', () => { state.dom = dm.checked; });
```

`rerender()` on the first two is deliberate: they reveal or hide the steps below them.

- [ ] **Step 4: Send the new fields**

In `save()`, inside the `if (state.suivi)` branch:

```js
      body.droits_inclus = state.droits;
      body.alcoolise = state.alcoolise;
      body.regime = state.regime || null;
      body.dom = state.alcoolise && state.dom;
      const dose = parseNum(get('dose_cl'));
      body.dose_cl = dose > 0 ? dose : null;
```

and in the untracked branch, keep garnitures out of the fiscal world:

```js
      body.droits_inclus = true;
      body.alcoolise = false;
```

- [ ] **Step 5: Verify in the browser**

Run the app (`uv run uvicorn antiquaire.main:app --port 8765`), open a tracked reference, untick "contient de l'alcool", save, reopen: the régime row is gone and the fiche shows no duty. Tick it back with régime Spiritueux: the DOM checkbox appears.

- [ ] **Step 6: Commit**

```bash
git add static/js/refmodal.js
git commit -m "feat(ui): cascade des droits d'alcool et dose sur la fiche référence"
```

---

### Task 5: The DOM rate on the Barème screen

**Files:**
- Modify: `static/js/screens/bareme.js`

**Interfaces:**
- Consumes: `rates.accise_dom` from Task 1, `PATCH /api/settings` (already exists).
- Produces: nothing.

- [ ] **Step 1: Add the row**

In `PARAMS`, immediately after the `accise` entry:

```js
  { key: 'accise_dom', k: 'Droit d’accise · rhum des DOM', n: 'taux réduit, rhum traditionnel des départements d’outre-mer', unit: '€/hL AP', d: 2 },
```

- [ ] **Step 2: Guard against an older barème**

The screen reads `rates[p.key]`; a database migrated before Task 1 would render `NaN`. In `render`, right after `const rates = S.meta.rates;`:

```js
  // barème antérieur à la migration 002 : on retombe sur le taux métropolitain
  if (rates.accise_dom === undefined) rates.accise_dom = rates.accise;
```

- [ ] **Step 3: Verify in the browser**

Open Barème fiscal: six rows, the DOM rate showing 903,51. Change it to 900, reload the page, confirm it stuck and that a DOM-flagged reference's duty moved.

- [ ] **Step 4: Commit**

```bash
git add static/js/screens/bareme.js
git commit -m "feat(ui): taux d'accise réduit des DOM dans le barème"
```

---

### Task 6: Comptoir KPIs, out with the doses, in with the references

**Files:**
- Modify: `static/js/screens/dash.js`

**Interfaces:**
- Consumes: `/api/stock` rows (unchanged).
- Produces: nothing.

- [ ] **Step 1: Remove the doses computation**

Delete the `doses` constant:

```js
  const doses = refs
    .filter((r) => regimes[r.categorie_id] === 'spiritueux')
    .reduce((a, r) => a + r.stock * (r.vol_cl / 5), 0);
```

and the now-unused `regimes` map on the line above it.

- [ ] **Step 2: Swap the KPI**

Replace the first entry of `kpis` with:

```js
    {
      label: 'Références en stock',
      value: String(refs.filter((r) => r.stock > 0).length),
      note: `sur ${refs.length} référence${refs.length > 1 ? 's' : ''} suivie${refs.length > 1 ? 's' : ''}`,
    },
```

- [ ] **Step 3: Fix the hero note**

Replace the `hero-note` line, which also quoted the doses:

```js
      <div class="hero-note">${refs.filter((r) => r.stock > 0).length} référence${refs.filter((r) => r.stock > 0).length > 1 ? 's' : ''} en stock,
        sur ${refs.length} suivie${refs.length > 1 ? 's' : ''}.</div>
```

- [ ] **Step 4: Verify in the browser**

Open Comptoir: no mention of doses anywhere, the first KPI counts references with stock above zero.

- [ ] **Step 5: Commit**

```bash
git add static/js/screens/dash.js
git commit -m "feat(ui): le comptoir compte les références en stock, plus les doses"
```

---

### Task 7: Kill the nine browser alerts

**Files:**
- Modify: `static/js/ui.js` (add `alertModal`)
- Modify: `static/js/refmodal.js:141,174`, `static/js/importcard.js:142,178`, `static/js/screens/cocktails.js:253`, `static/js/screens/config.js:195,222,237`, `static/js/reception.js:139`

**Interfaces:**
- Consumes: `openModal`, `closeModal`, `esc` from `ui.js`.
- Produces: `alertModal({title, body}) -> Promise<void>`, exported from `static/js/ui.js`.

- [ ] **Step 1: Write `alertModal`**

Append to `static/js/ui.js`, modelled on `confirmModal` so the two look identical:

```js
export function alertModal({ title, body = '' }) {
  return new Promise((resolve) => {
    root().innerHTML = `
      <div class="scrim"><div class="modal confirm">
        <div style="padding:22px 24px 16px; display:flex; flex-direction:column; gap:9px;">
          <div class="serif-title" style="font-size:20px;">${esc(title)}</div>
          ${body ? `<div style="font-size:13px; color:var(--mut);" class="pretty">${esc(body)}</div>` : ''}
        </div>
        <div style="display:flex; justify-content:flex-end; padding:14px 24px; border-top:1px solid var(--line);">
          <button class="btn-solid" data-ok>Compris</button>
        </div>
      </div></div>`;
    const scrim = root().firstElementChild;
    const done = () => { closeModal(); resolve(); };
    scrim.querySelector('[data-ok]').addEventListener('click', done);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) done(); });
    scrim.querySelector('[data-ok]').focus();
  });
}
```

- [ ] **Step 2: Replace the calls**

Each call site imports `alertModal` from `ui.js` (adjust the relative path: `./ui.js` at the root of `static/js`, `../ui.js` under `screens/`) and becomes an `await`. The nine, verbatim:

| File:line | Was | Becomes |
|---|---|---|
| `refmodal.js:141` | `alert('Le nom est obligatoire.')` | `await alertModal({ title: 'Nom manquant', body: 'Une référence doit porter un nom.' })` |
| `refmodal.js:174` | `alert(\`Enregistrement impossible : ${e.message}\`)` | `await alertModal({ title: 'Enregistrement impossible', body: e.message })` |
| `importcard.js:142` | `alert(\`Fichier illisible : ${e.message}\`)` | `await alertModal({ title: 'Fichier illisible', body: e.message })` |
| `importcard.js:178` | `alert(\`Import impossible : ${e.message}\`)` | `await alertModal({ title: 'Import impossible', body: e.message })` |
| `cocktails.js:253` | `alert('Créez d’abord une référence suivie.')` | `await alertModal({ title: 'Aucune référence suivie', body: 'Créez une référence suivie avant d’ajouter un ingrédient à une fiche.' })` |
| `config.js:195` | `alert(e.message)` | `await alertModal({ title: 'Modification refusée', body: e.message })` |
| `config.js:222` | `alert(e.message)` | `await alertModal({ title: 'Modification refusée', body: e.message })` |
| `config.js:237` | `alert(e.message)` | `await alertModal({ title: 'Modification refusée', body: e.message })` |
| `reception.js:139` | `alert(\`Réception impossible : ${e.message}\`)` | `await alertModal({ title: 'Réception impossible', body: e.message })` |

`refmodal.js:141` sits in `save()`, which is already `async`, so `await` is legal. Check each enclosing function is `async` before adding `await`; if one is not, make it `async` (all nine are event handlers or already-async functions, so nothing awaits their return).

- [ ] **Step 3: Verify none remain**

Run: `grep -rn "alert(\|confirm(\|prompt(" static/js/ | grep -v "alertModal\|confirmModal"`
Expected: no output.

- [ ] **Step 4: Verify in the browser**

Trigger one: open the reference modal, clear the name, click Créer. An in-app modal appears, dismissible with the button, the Escape-equivalent scrim click, and focus already on Compris.

- [ ] **Step 5: Commit**

```bash
git add static/js/ui.js static/js/refmodal.js static/js/importcard.js static/js/reception.js static/js/screens/cocktails.js static/js/screens/config.js
git commit -m "fix(ui): plus aucune alerte navigateur, modales maison partout"
```

---

### Task 8: Drag & drop on the import card

**Files:**
- Modify: `static/js/importcard.js`
- Modify: `static/css/app.css` (one class)

**Interfaces:**
- Consumes: the existing file-handling function in `importcard.js` (the one the `<input type="file">` change handler calls).
- Produces: nothing.

- [ ] **Step 1: Read the current wiring**

Run: `grep -n "type=\"file\"\|addEventListener('change'\|function " static/js/importcard.js`
Identify the element that wraps the file input (the drop target) and the function that receives the chosen `File`. The steps below call them `zone` and `handleFile(file)`; use the real names.

- [ ] **Step 2: Add the drop handling**

Where the change handler is bound:

```js
  // Glisser-déposer : même chemin que le bouton Parcourir.
  ['dragenter', 'dragover'].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add('drop-hot');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove('drop-hot');
    })
  );
  zone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
```

- [ ] **Step 3: Add the highlight style**

Append to `static/css/app.css`:

```css
/* zone de dépôt survolée par un fichier */
.drop-hot { border-color: var(--ac); background: var(--panel2); }
```

- [ ] **Step 4: Verify in the browser**

Drag `import/03-tarifs.xlsx` onto the import card: the border turns accent, dropping it runs the same preview as picking it through the button.

- [ ] **Step 5: Commit**

```bash
git add static/js/importcard.js static/css/app.css
git commit -m "feat(import): la carte d'import accepte un fichier déposé"
```

---

### Task 9: Build stamp in the footer

**Files:**
- Modify: `src/antiquaire/api.py` (the `health` route)
- Modify: `static/index.html`
- Modify: `static/js/app.js`
- Modify: `static/css/app.css`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `importlib.metadata.version` (stdlib), the git commit date via a build-time-free fallback.
- Produces: `GET /api/health` gains `version` (string) and `build` (ISO date string). `app.js` renders them into `#build-stamp`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_api.py`:

```python
def test_health_carries_the_build_stamp(client):
    h = client.get("/api/health").json()
    assert h["version"]
    assert len(h["build"]) == 10  # AAAA-MM-JJ
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest tests/test_api.py::test_health_carries_the_build_stamp -v`
Expected: FAIL with `KeyError: 'version'`.

- [ ] **Step 3: Implement**

In `src/antiquaire/api.py`, above the `health` route:

```python
def build_stamp() -> tuple[str, str]:
    """Version du paquet + date du fichier le plus récent de l'application.

    Pas de git à l'exécution : l'appliance tourne depuis un dossier déployé,
    la date de modification du code est l'information honnête et disponible.
    """
    import datetime
    from importlib.metadata import PackageNotFoundError, version as pkg_version

    try:
        v = pkg_version("antiquaire-stock")
    except PackageNotFoundError:
        v = "dev"
    src = Path(__file__).parent
    newest = max(p.stat().st_mtime for p in src.rglob("*.py"))
    return v, datetime.date.fromtimestamp(newest).isoformat()
```

Add `from pathlib import Path` to the imports if absent, then in `health`:

```python
    v, build = build_stamp()
    return {"ok": True, "db_ok": db_ok, "last_backup_at": last, "version": v, "build": build}
```

Confirm the distribution name with `grep -n "^name" pyproject.toml` and use it verbatim in `pkg_version`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/test_api.py::test_health_carries_the_build_stamp -v`
Expected: PASS.

- [ ] **Step 5: Render it**

In `static/index.html`, inside `.side-foot`, after the existing margin line:

```html
      <div class="build-stamp" id="build-stamp"></div>
```

In `static/js/app.js`, at the end of `boot()`:

```js
  // Quelle version tourne ici : le Mac et la démo ne mentent plus.
  apiGet('/api/health').then((h) => {
    document.getElementById('build-stamp').textContent = `v${h.version} · ${h.build}`;
  }).catch(() => {});
```

In `static/css/app.css`:

```css
.build-stamp {
  margin-top: 10px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .08em;
  color: var(--mut3);
}
```

- [ ] **Step 6: Verify in the browser**

The sidebar footer shows `v1.0.0 · 2026-08-11`.

- [ ] **Step 7: Run the whole suite and commit**

Run: `uv run pytest`
Expected: PASS.

```bash
git add src/antiquaire/api.py static/index.html static/js/app.js static/css/app.css tests/test_api.py
git commit -m "feat(ops): version et date de build visibles dans l'application"
```

---

### Task 10: Ship

**Files:**
- Modify: `import/00-checklist-init.md` (a short note on the new fiscal cascade)

- [ ] **Step 1: Run the full suite bare**

Run: `uv run pytest`
Expected: PASS. Do not pipe the output; a pipeline hides the exit code.

- [ ] **Step 2: Lint**

Run: `uv run ruff check . && uv run ruff format --check .`
Expected: clean. Run `uv run ruff format .` and re-commit if it reformats anything.

- [ ] **Step 3: Note the change for the bar**

Append to `import/00-checklist-init.md`, under a new heading:

```markdown
## Droits d'alcool, depuis la vague 2

Chaque référence répond maintenant à quatre questions, dans cet ordre, sur sa fiche :
contient-elle de l'alcool, à quel degré, sous quel régime fiscal (hérité de la catégorie
sauf indication contraire, avec le taux réduit des DOM pour le rhum traditionnel), et
enfin si le prix d'achat inclut déjà les droits. Une référence non alcoolisée ne paie
aucun droit, quelle que soit sa catégorie.

La dose se règle aussi par référence : laissée vide, elle suit la catégorie.
```

- [ ] **Step 4: Push and open the PR**

```bash
git add import/00-checklist-init.md
git commit -m "docs: la cascade des droits d'alcool dans la checklist"
git push -u origin feat/wave2-phase1
gh pr create --title "Vague 2 · phase 1 : doses, cascade fiscale, hygiène" --body "..."
```

- [ ] **Step 5: Deploy the demo after merge**

```bash
cd /root/antiquaire_stock && git checkout main && git pull
docker compose up -d --build
```

Then confirm `https://antiquaire.srv1493964.hstgr.cloud` shows the new build stamp, and tell the user the Mac needs `git pull && ./scripts/setup.sh` (this wave touches `src/`).

---

## Verification recipe (browser)

The box has Playwright and Chromium; drive them with the Command Center venv:

```bash
/root/command-center/.venv/bin/python - <<'PY'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto("http://127.0.0.1:8765/#/refs")
    pg.wait_for_timeout(800)
    pg.screenshot(path="/tmp/claude-0/refs.png", full_page=True)
    b.close()
PY
```

## Self-review notes

- Every spec item in Phase 1 of section 8 maps to a task: #4 and #8 to Task 6, #5 to Tasks 1-4, #6 to Tasks 1, 2, 4, 5, #7 to Tasks 1-4, hygiene to Tasks 7, 8, 9.
- `effective_marge` moves from `api.py` to `pricing.py` in Task 2 and is consumed in Task 3; no other module imports it (verified with `grep -rn "effective_marge" src/`).
- The `dom` argument is keyword-only and defaulted everywhere it appears, so the 54 existing tests keep passing without edits.
