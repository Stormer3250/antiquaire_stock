# Wave 2, Phase 4: Menus & Tarifications, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Group cocktails into menus, hold several price lists (tarifications) over the same menu, make one of them the price the bar actually charges, and be able to duplicate and compare them.

**Architecture:** Four tables and one new router module. The one idea that keeps this cheap: **no price is ever mirrored**. A cocktail's effective price is read through a single resolver (`active_prices`), so the register, the dashboard, the margins and the cocktail screen all follow a tarification change without any of them knowing tarifications exist.

**Tech Stack:** unchanged.

## Global Constraints

As phases 1 to 3: synchronous Python, no new dependency, French UI, no em dashes in copy, no browser dialogs, French commits, branch `feat/wave2-phase4`, PR, green CI before merge. Attention-taking surfaces go through `overlay.js`. Tables use `table.js`.

---

### Task 1: Schema

**Files:** `src/antiquaire/migrations/005_menus.sql`, `tests/test_db.py`

The four tables are in the spec, section 3.3, and land verbatim. Three rules ride with them:

1. `menu_items.cocktail_id` is UNIQUE: a cocktail belongs to at most one menu, otherwise "which price is active" has no answer.
2. Exactly one tarification per menu carries `actif = 1`, enforced on write, not by a constraint (SQLite has no partial unique index worth the trouble here).
3. Deleting a menu cascades to `menu_items`, `tarifs` and `tarif_prix`, never to `cocktails`.

- [ ] Failing test: the four tables exist, `menu_items.cocktail_id` is unique, deleting a menu leaves its cocktails alone.
- [ ] Write the migration, run, commit.

---

### Task 2: The price resolver

**Files:** `src/antiquaire/api_admin.py`, `tests/test_api_cocktails.py`

```python
def active_prices(conn) -> dict[int, float]:
    """Prix venant de la tarification active du menu de chaque fiche."""
```

`serialize_cocktail` takes the map and resolves `prix = map.get(id, cocktail["prix_ttc"])`, and exposes `prix_source` (`"tarif"` or `"fiche"`) plus `menu_id` / `menu_nom` so the screens can say where the number comes from. `PATCH /api/cocktails/{id}` with `prix_ttc` writes into the active tarification when the cocktail belongs to a menu that has one, and into `cocktails.prix_ttc` otherwise.

- [ ] Failing tests: the three resolution cases; editing the price of a cocktail in a menu moves the tarification row and leaves `cocktails.prix_ttc` untouched.
- [ ] Implement, run, commit.

---

### Task 3: The menus API

**Files:** create `src/antiquaire/api_menus.py`, register in `src/antiquaire/main.py`, `tests/test_api_menus.py` (new)

```
GET    /api/menus                    menus + leurs tarifications + KPIs + fiches hors menu
POST   /api/menus                    {nom}
PATCH  /api/menus/{id}               nom, description, cocktail_ids (appartenance ET ordre)
DELETE /api/menus/{id}
POST   /api/menus/{id}/tarifs        {nom, from_tarif_id?}  vide ou dupliquée
PATCH  /api/tarifs/{id}              nom, note, actif, prix {cocktail_id: prix}
DELETE /api/tarifs/{id}
```

KPIs per menu, computed server-side from the same serializer the cocktail screen uses: number of fiches, average margin, average price, average material cost, cheapest, dearest, spread.

- [ ] Failing tests: create a menu, add cocktails, a cocktail cannot join two menus, activating a tarification deactivates its siblings, duplicating copies the prices, deleting a menu keeps the cocktails, KPIs match a hand computation.
- [ ] Implement, run, commit.

---

### Task 4: The screen

**Files:** create `static/js/screens/menus.js`, modify `static/js/app.js` (nav, titles, routes), `static/js/palette.js`, `static/js/tour.js`, `static/css/app.css`

Three columns: the menus, the selected menu's cocktails with their price and margin, and its tarifications.

- The cocktail table uses `table.js`, with selection and the same summary as Cartes & recettes.
- Prices are editable per line, writing into the tarification being viewed.
- Actions on a tarification: activer, dupliquer, renommer, supprimer, comparer.
- **Comparer** puts two tarifications side by side: price and margin per cocktail, the delta highlighted, and the menu aggregate for each.
- Adding a cocktail to the menu picks from the fiches that belong to no menu yet, which is the UNIQUE rule made visible rather than an error message.

- [ ] Build the screen, add nav entry 08, the palette entries, the tour steps.
- [ ] Browser check, commit.

---

### Task 5: Ship

- [ ] `uv run pytest` bare, `ruff check`, `ruff format --check`, `./scripts/check_js.sh`.
- [ ] Playwright over the nine screens, zero `pageerror`.
- [ ] Push, PR, green CI, merge, `docker compose up -d --build`.
- [ ] Mac: `git pull && ./scripts/setup.sh`.
