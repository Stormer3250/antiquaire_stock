# Wave 2, Phase 2: Navigation, Guided Tour & What's New, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every table sortable on every column including "créé le", every dropdown styled and searchable past ten options, a ⌘K palette, a per-screen guided tour, and a "Quoi de neuf" modal.

**Architecture:** Five self-contained ES modules under `static/js/`, no build step, no dependency. Two of them (`select.js`, `tour.js`) attach themselves to the whole document rather than being called from each screen, because the screens re-render their own `innerHTML` from a dozen different places and a call site would eventually be forgotten.

**Tech Stack:** vanilla ES modules, `MutationObserver`, `localStorage`, existing Blueprint-adjacent CSS in `static/css/app.css`.

## Global Constraints

Same as phase 1: synchronous Python, no new dependency, French UI, no em dashes in copy, no browser `alert`/`confirm`/`prompt`, French commit messages, branch `feat/wave2-phase2` and a PR.

## Deviation from the spec, recorded

The spec called for `table.js`, "one table renderer" used by every screen. The screens each build a different CSS grid inline and re-render from their own handlers; replacing all of them with a generic renderer is a large refactor with real regression risk for zero user-visible gain. Phase 2 instead ships `sortable.js`: sort state, a header cell helper and a comparator, dropped into the existing markup. The user-visible outcome is the one the feedback asked for. Selection (phase 3) will extend the same module.

---

### Task 1: `created_at` on the API rows

Sorting by creation date needs the field to exist in the payload.

**Files:** `src/antiquaire/api.py` (`serialize_ref`), `src/antiquaire/api_admin.py` (`serialize_cocktail`), `tests/test_api.py`, `tests/test_api_cocktails.py`

- [ ] **Step 1: Failing tests**

```python
def test_stock_rows_carry_created_at(client):
    make_ref(client)
    row = client.get("/api/stock").json()["refs"][0]
    assert row["created_at"]
```

```python
def test_cocktail_rows_carry_created_at(client):
    client.post("/api/cocktails", json={})
    assert client.get("/api/cocktails").json()["cocktails"][0]["created_at"]
```

- [ ] **Step 2:** Run both, expect `KeyError`.
- [ ] **Step 3:** Add `"created_at": ref["created_at"]` to the `out` dict in `serialize_ref` and `"created_at": cocktail["created_at"]` to the return of `serialize_cocktail`.
- [ ] **Step 4:** Run, expect PASS, then `uv run pytest` whole.
- [ ] **Step 5:** Commit `feat(api): exposer la date de création des références et des fiches`.

---

### Task 2: `sortable.js`

**Files:** create `static/js/sortable.js`, modify `static/js/screens/refs.js`, `inventory.js`, `cave.js`, `cocktails.js`, `static/css/app.css`

**Produces:**
- `sortState(defaultKey, defaultDir)` returns `{key, dir}`, kept in module scope by each screen so it survives re-renders.
- `sortHeader(label, key, state, {align})` returns the header cell HTML with its arrow.
- `applySort(rows, state, accessors)` returns a sorted copy. `accessors` maps a key to a value function when the row property is not the sort value.
- `bindSort(el, state, rerender)` wires the header clicks: same key flips direction, new key sorts ascending.

Comparison rule: `null`/`undefined` always sort last whatever the direction, numbers numerically, strings with `localeCompare('fr')` so accents order correctly.

- [ ] **Step 1:** Write the module with a `demo()` self-check at the bottom guarded by `import.meta.url`, asserting: numeric ascending, string accent order (`Éclair` before `Zeste`), nulls last in both directions, direction flip.
- [ ] **Step 2:** Run it: `node static/js/sortable.js`, expect no output and exit 0.
- [ ] **Step 3:** Wire Références: sort keys `nom`, `categorie_nom`, `abv`, `stock`, `valeur`, `cout_dose`, `marge_reelle`, `prix`, `created_at`. Default `nom` ascending.
- [ ] **Step 4:** Wire Inventaire and Cave & seuils with their own columns.
- [ ] **Step 5:** Add a sort control to the cocktail list (nom, prix, marge, créé le).
- [ ] **Step 6:** Style `.th-sort` in `app.css`: pointer cursor, hover colour, the arrow in the accent colour when active.
- [ ] **Step 7:** Browser check on the four screens, no console errors.
- [ ] **Step 8:** Commit `feat(ui): toutes les tables triables sur chaque colonne`.

---

### Task 3: `select.js`

**Files:** create `static/js/select.js`, modify `static/js/app.js` (one import), `static/css/app.css`

The native `<select class="input">` stays in the DOM, hidden, and remains the source of truth: every existing `.value` read and `change` listener keeps working untouched. A custom control renders on top, writes into the native element and dispatches a real `change` event.

A `MutationObserver` on `document.body` upgrades any select that appears, so no screen needs to call anything.
`// ponytail: observer global, suffisant à cette échelle ; passer à un appel par écran si le DOM grossit.`

Behaviour: click opens a panel; a search field appears when there are more than ten options; typing filters; arrows move; Enter selects; Escape closes; clicking outside closes. `aria-expanded` on the trigger, `role="listbox"` on the panel.

- [ ] **Step 1:** Write the module.
- [ ] **Step 2:** Import it once in `app.js` and call `installSelectUpgrader()` in `boot()`.
- [ ] **Step 3:** Style `.cc-sel*` in `app.css`, matching the existing `.input` border, background and mono label treatment.
- [ ] **Step 4:** Browser check: the category filter on Références, the ingredient picker on a cocktail fiche (long list, search appears), the reference modal, the import mapping selects. Confirm each still fires its existing handler.
- [ ] **Step 5:** Commit `feat(ui): sélecteurs maison avec recherche au-delà de dix choix`.

---

### Task 4: `palette.js`, the ⌘K box

**Files:** create `static/js/palette.js`, modify `static/js/app.js`, `static/index.html`, `static/css/app.css`

Opens on ⌘K or Ctrl+K, and from a discreet trigger in the top bar. Sources: the seven screens, every reference, every cocktail, and four actions (Nouvelle référence, Réception, Nouvelle fiche, Importer un fichier). Data is fetched when the palette opens, not on every keystroke.

Matching strips accents and case, the same normalisation the importer applies to names, so "creme" finds "Crème". Results are grouped by kind, arrows move, Enter runs.

- [ ] **Step 1:** Write the module.
- [ ] **Step 2:** Wire the key handler and the top bar trigger in `app.js` / `index.html`.
- [ ] **Step 3:** Style in `app.css`, reusing the `.scrim` and `.modal` vocabulary.
- [ ] **Step 4:** Browser check: open with the keyboard, type an accent-stripped fragment, land on the right fiche.
- [ ] **Step 5:** Commit `feat(ui): palette de recherche et d'actions (⌘K)`.

---

### Task 5: `tour.js`, the guided tour

**Files:** create `static/js/tour.js`, modify `static/js/app.js`, `static/index.html`, `static/css/app.css`

Ported from `xml_editor`'s `GuidedTour.tsx`: a spotlight cut out of a full-page overlay with `box-shadow`, steps targeted by CSS selector, a bubble positioned next to the target, Précédent / Suivant / Terminer.

Steps are defined per screen. Screens whose numbers are not self-evident get a step that explains the calculation in plain French: the fiche's cost waterfall, the Barème's duty per dose, and the Comptoir's margin figures.

A `?` button in the top bar starts the current screen's tour. Each screen also auto-runs once, tracked per screen in `localStorage` (`antiquaire.tour.<écran>`), so the bar staff meet each screen's explanation the first time they land on it and never again.

- [ ] **Step 1:** Write the module with the step tables for the seven screens.
- [ ] **Step 2:** Add the `?` button and wire it plus the auto-run into `route()`.
- [ ] **Step 3:** Style the overlay, the bubble and its buttons.
- [ ] **Step 4:** Browser check: run the tour on Comptoir, Références and Barème, confirm the spotlight lands on the right blocks and that a missing target is skipped rather than crashing.
- [ ] **Step 5:** Commit `feat(ui): visite guidée par écran, avec l'explication des calculs`.

---

### Task 6: `whatsnew.js`

**Files:** create `static/js/whatsnew.js`, modify `static/js/app.js`, `static/css/app.css`

A dated list of entries lives in the module. The modal opens automatically when the stored seen-version differs from the running version from `/api/health`, and on demand by clicking the build stamp in the sidebar footer.

Entries for this wave: phase 1 (fiscal cascade, per-reference dose, DOM rate, references count, no more browser alerts, drag & drop) and phase 2 (sorting, searchable dropdowns, ⌘K, guided tour).

- [ ] **Step 1:** Write the module.
- [ ] **Step 2:** Wire the auto-open and the build-stamp click in `app.js`.
- [ ] **Step 3:** Style it as an ordinary modal.
- [ ] **Step 4:** Browser check: clear `localStorage`, reload, the modal appears once; reload again, it does not.
- [ ] **Step 5:** Commit `feat(ui): modale « Quoi de neuf » au changement de version`.

---

### Task 7: Ship

- [ ] **Step 1:** `uv run pytest` bare, then `uv run ruff check .`.
- [ ] **Step 2:** `node --check` every file under `static/js` (copy to `.mjs` first, the checker needs the extension).
- [ ] **Step 3:** Playwright pass over the seven screens, asserting zero `pageerror`.
- [ ] **Step 4:** Push, PR, merge, `docker compose up -d --build`, verify the demo.
- [ ] **Step 5:** Tell the user the Mac needs `git pull && ./scripts/setup.sh`.
