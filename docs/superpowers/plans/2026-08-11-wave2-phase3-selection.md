# Wave 2, Phase 3: Table Renderer, Selection & Per-Cocktail Margin, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Tick rows on any table and watch the KPIs follow, edit a batch of references in one gesture, and let a cocktail carry its own target margin or a pinned price.

**Architecture:** Opens with the extraction agreed after phase 2: a real `table.js` renderer that owns columns, sorting, selection and the summary bar, and repaints only what changed instead of the whole screen. Per-table state lives in that module, keyed by table id, which is what finally removes the per-screen globals (`F`, `SORT`, `USORT`, `sel`). Backend work is one migration and one serializer change.

**Tech Stack:** unchanged. Vanilla ES modules, no build, sync FastAPI, SQLite.

## Global Constraints

As phases 1 and 2: synchronous Python, no new dependency, French UI, no em dashes in copy, no browser `alert`/`confirm`/`prompt`, French commits, branch `feat/wave2-phase3` and a PR. Every attention-taking surface goes through `overlay.js`.

## Deviation from the phase 2 answer, recorded

I proposed two modules, `table.js` and `screen.js`. Shipping one: the only state phase 3 needs to survive a re-render is per-table (sort, selection), and that belongs inside the table module keyed by table id. A separate state container with one consumer would be an abstraction with a single implementation. If cross-screen state appears later (a selection carried into the menu editor), it gets extracted then, from a real second consumer.

---

### Task 1: `table.js`

**Files:** create `static/js/table.js`, modify `static/js/sortable.js` (keep the comparator, drop the header helper once nothing uses it), `static/css/app.css`

**Produces:**
- `tableState(id, defaultSortKey)` returns the persistent `{sort, selected}` for that table.
- `renderTable(el, spec)` where spec is `{id, columns, rows, grid, select, summary, empty, foot, rowClass, onRowClick}`.
  - `columns`: `[{key, label, align, sortable, cell(row)}]`, `cell` returning an HTML string so screens keep full control of what a cell looks like.
  - `select: true` adds the tick column, the header "all" box, and calls `summary(selectedRows, allRows)` for the bar under the table.
  - Ticking a box repaints **only** the row class and the summary, never the table.
- `bindTable(el, spec)` wires sorting, ticking and row clicks; screens still bind their own per-cell handlers afterwards, exactly as today.

- [ ] **Step 1:** Write the module with a `demo()` self-check covering: selection survives a re-render, "select all" respects the current filter, untick-all clears the summary, and a column with no `cell` falls back to the raw value.
- [ ] **Step 2:** `node static/js/table.js`, expect silence.
- [ ] **Step 3:** Migrate Références to it, deleting the local `GRID` string, the `F`/`SORT` globals and the hand-written `thead`/`trow` markup.
- [ ] **Step 4:** Browser check: sort, filter, search, edit and delete still behave.
- [ ] **Step 5:** Commit `feat(ui): un vrai rendu de table, tri et sélection compris`.

---

### Task 2: Selection and its summary everywhere

**Files:** `static/js/screens/refs.js`, `cave.js`, `inventory.js`, `cocktails.js`

The summary is computed per screen because each one measures different things:

| Écran | Ce que la barre affiche |
|---|---|
| Références | lignes retenues, valeur HT totale, coût unitaire moyen, marge moyenne, combien sous le seuil |
| Cave & seuils | lignes retenues, valeur HT, combien sous le seuil, total à commander |
| Inventaire | lignes retenues, combien déjà comptées, valeur comptée |
| Cartes & recettes | fiches retenues, marge moyenne, prix moyen, coût matière moyen, écart entre la moins chère et la plus chère |

The cocktail summary is the one the feedback asked for and the one phase 5 will reuse for menus.

- [ ] **Step 1:** Références first, with the four figures above.
- [ ] **Step 2:** Cave, Inventaire, cocktails.
- [ ] **Step 3:** Style the bar: sticky at the bottom of its panel, appearing only when something is ticked.
- [ ] **Step 4:** Browser check on each screen.
- [ ] **Step 5:** Commit `feat(ui): barre de synthèse sur la sélection, écran par écran`.

---

### Task 3: Bulk edits on Références

**Files:** `static/js/screens/refs.js`, `static/js/bulkmodal.js` (new)

Actions on the ticked rows: catégorie, marge cible, seuil, fournisseur. One modal, one field at a time, applying `PATCH /api/refs/{id}` per row. The confirmation states how many rows are affected, and the result says how many succeeded.

- [ ] **Step 1:** Write the modal.
- [ ] **Step 2:** Wire the "Modifier la sélection" button into the summary bar.
- [ ] **Step 3:** Browser check: change the supplier on three rows, confirm the table reflects it.
- [ ] **Step 4:** Commit `feat(ui): modifier en lot les références retenues`.

---

### Task 4: Per-cocktail margin or pinned price

**Files:** `src/antiquaire/migrations/004_cocktail_marge.sql`, `src/antiquaire/api_admin.py`, `tests/test_api_cocktails.py`, `static/js/screens/cocktails.js`

```sql
ALTER TABLE cocktails ADD COLUMN marge_pct REAL;                        -- NULL = cible maison
ALTER TABLE cocktails ADD COLUMN prix_fixe INTEGER NOT NULL DEFAULT 0;  -- prix figé, verrou de l'optimiseur
```

`serialize_cocktail` gains `marge_cible` (own or house), `marge_custom`, `prix_fixe`, and computes `suggested` from the cocktail's own target rather than the house one. `COCKTAIL_FIELDS` accepts both.

- [ ] **Step 1:** Failing tests: a cocktail with its own target gets a different suggested price; a pinned cocktail reports `prix_fixe: true`; NULL still inherits the house target.
- [ ] **Step 2:** Run, expect failure.
- [ ] **Step 3:** Migration, serializer, patch fields.
- [ ] **Step 4:** Run, expect pass, then the whole suite.
- [ ] **Step 5:** UI on the cocktail fiche: a margin field next to the suggested price with "cible maison" as its placeholder, and a padlock to pin the price. The pin is the same flag the phase 5 optimizer will honour, said so in the copy.
- [ ] **Step 6:** Commit `feat(cocktails): marge propre ou prix figé par fiche`.

---

### Task 5: Ship

- [ ] `uv run pytest` bare, `uv run ruff check .`, `uv run ruff format --check .`, `./scripts/check_js.sh`.
- [ ] Playwright over the seven screens, zero `pageerror`.
- [ ] Push, PR, wait for green CI, merge, `docker compose up -d --build`.
- [ ] Tell the user the Mac needs `git pull && ./scripts/setup.sh`.
