# Antiquaire Stock, Wave 2: Menus, Tarifications & QoL

Date: 2026-08-11
Status: approved design, pre-implementation
Supersedes nothing. Extends `2026-07-31-antiquaire-stock-architecture-design.md` (v2),
which remains the authority on stack, install, backups and everything not touched here.

## 1. Origin

One week of real use at the bar produced eight pieces of feedback. This document records
what was challenged, what was decided, and the wave that lands as a result. The stack does
not change: Python 3.12 + FastAPI sync routes, SQLite, vanilla ES modules, no build step,
no new runtime dependency.

## 2. The feedback, and what it became

| # | Raw feedback | Verdict |
|---|---|---|
| 1 | Group cocktails into menus, hold several versions of a menu, KPIs per menu/version, a pricing engine with constraints | Built. "Version" is renamed **tarification**. A menu is an ordered set of cocktails; a tarification is a named price list over that same set. Recipes are shared, so changing an ingredient recosts every tarification at once. |
| 2 | Sortable tables, styled searchable dropdowns, ⌘K palette, search for menus and recipes | Built as three shared modules used by every screen. |
| 3 | Select cocktails, see margin KPIs update; per-cocktail margin | Built. Selection + summary bar on every table; bulk edits on Références only. A cocktail can carry its own target margin **or** a pinned price. |
| 4 | Drop the "doses disponibles" KPI | Removed from the Comptoir KPIs and from the hero note. |
| 5 | Doses adjustable (5 cl, 12 cl for wine…) | Partly existed: `dose_cl` lives on the category and Vin is already 12. The real gap is a **per-reference override**, which is what gets built. |
| 6 | Droit d'accise: rum from the French DOM has its own rate | Built as a per-reference "taux réduit DOM" flag plus a second editable rate on the Barème screen. No quota modelling. |
| 7 | Droit d'accise must be deactivatable for soft drinks | Partly existed (`regime='aucun'`, `droits_inclus`), but was not legible. Replaced by an explicit cascade, below. |
| 8 | See the number of references in stock | New KPI on the Comptoir, replacing the dropped one. |

Added to the wave, not in the original feedback:

- **Duplicate and compare tarifications** (the workflow the feature exists for).
- **Impact d'une hausse de prix d'achat**: which cocktails and menus fall under the floor.
- **Excel export of the current view**, honouring sort, filter and selection.
- **Guided tour per screen** and an **algorithm explanation** panel, ported from `xml_editor`.
- **"Quoi de neuf" modal** on version change.
- Hygiene carried over from the other tools: no browser `alert()` (9 exist today), drag &
  drop on the import card, a visible build stamp.

Explicitly **out**: printable customer-facing card, quota modelling for the DOM rate,
alias memory for supplier price files, bulk edits outside Références.

## 3. Domain model additions

### 3.1 References: dose and the fiscal cascade

```sql
ALTER TABLE refs ADD COLUMN dose_cl   REAL;                        -- NULL = dose de la catégorie
ALTER TABLE refs ADD COLUMN alcoolise INTEGER NOT NULL DEFAULT 1;  -- étape 1 de la cascade
ALTER TABLE refs ADD COLUMN regime    TEXT;                        -- NULL = régime de la catégorie
ALTER TABLE refs ADD COLUMN dom       INTEGER NOT NULL DEFAULT 0;  -- rhum DOM, taux réduit
```

`dose_cl` and `regime` follow the `marge_pct` precedent already in the schema: NULL means
"inherit the category". Migration sets `alcoolise = 0` for every existing reference whose
category régime is `aucun`, which is the truthful reading of the current data.

The fiche presents them as a cascade, in this order, each step revealed by the one above:

```
1. Contient de l'alcool ?          Non → aucun droit, les étapes 2 et 3 disparaissent
2. Degré                            ex. 40,0 °
3. Régime fiscal                    hérité de la catégorie (Spiritueux), modifiable ici
   └ Rhum des DOM ?                 n'apparaît que si le régime est « spiritueux »
4. Prix d'achat HT                  ☐ ce prix inclut déjà les droits
```

**Decision:** `droits_inclus` stays a separate, last step, deliberately *not* folded into
the cascade. It answers a supplier-invoice question ("does my invoice already contain the
duty?"), not a fiscal one ("does this product owe duty?"). Merging them was considered and
rejected: it would make a reference at 0 € of duty ambiguous between "exempt" and "already
paid". It is relabelled and moved next to the purchase price so the distinction is visible
without explanation. Under the four steps, the fiche shows the resulting duty per dose live.

### 3.2 Cocktails: own margin or pinned price

```sql
ALTER TABLE cocktails ADD COLUMN marge_pct REAL;                       -- NULL = cible maison
ALTER TABLE cocktails ADD COLUMN prix_fixe INTEGER NOT NULL DEFAULT 0;
```

`prix_fixe` does double duty: it is the "signature at 18 € whatever the margin" pin *and*
the optimizer's lock. One flag rather than two, because in practice they are the same
statement.

### 3.3 Menus and tarifications

```sql
CREATE TABLE menus (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE menu_items (
    id INTEGER PRIMARY KEY,
    menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    cocktail_id INTEGER NOT NULL UNIQUE REFERENCES cocktails(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE tarifs (
    id INTEGER PRIMARY KEY,
    menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    actif INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE tarif_prix (
    id INTEGER PRIMARY KEY,
    tarif_id INTEGER NOT NULL REFERENCES tarifs(id) ON DELETE CASCADE,
    cocktail_id INTEGER NOT NULL REFERENCES cocktails(id) ON DELETE CASCADE,
    prix_ttc REAL NOT NULL,
    UNIQUE (tarif_id, cocktail_id)
);
```

Three rules keep this cheap and unambiguous:

1. **A cocktail belongs to at most one menu** (`menu_items.cocktail_id UNIQUE`). Without
   it, "which price is active" has no answer for a cocktail sitting in two menus, and
   every read becomes a conflict resolution. Moving a cocktail between menus is a normal
   operation; being in two at once is not.
2. **Effective price** of a cocktail = its row in the active tarification of its menu, else
   `cocktails.prix_ttc`. Cocktails outside any menu behave exactly as they do today. This
   is one helper in `api.py`; no value is mirrored or duplicated.
3. **Exactly one tarification per menu is `actif`**, enforced on write (activating one
   deactivates the siblings in the same transaction). A menu with no tarification falls
   back to rule 2's second branch, so a half-built menu never blanks the Comptoir.

Editing a price on the cocktail fiche writes to the active tarification when the cocktail
belongs to a menu, and to `cocktails.prix_ttc` otherwise. The UI states which.

Deleting a menu leaves its cocktails alone (cascade hits `menu_items`, not `cocktails`).

## 4. The pricing engine

One new pure function in `pricing.py`, no I/O, no new dependency:

```python
def optimize(items: list[dict], constraints: dict) -> dict
```

`items`: one entry per cocktail with `id`, `nom`, `cost`, `marge_cible` (own or house),
`tva_pct`, `prix_actuel`, `verrouille` (`prix_fixe`).
`constraints`: `prix_min`, `prix_max`, `marge_moyenne`, `ecart_max`, `arrondi`,
`plancher`, all optional; absent means unconstrained.

Algorithm, in order:

1. Seed each unlocked cocktail at `price_for_margin(cost, marge_cible, tva, arrondi)`.
2. Clamp into `[prix_min, prix_max]`.
3. If `max - min > ecart_max`, pull the extremes toward the mean until the spread fits
   (locked cocktails count toward the spread but never move).
4. If `marge_moyenne` is set, find a single multiplier on the HT prices by bisection so the
   mean realised margin hits the target, re-clamping and re-rounding at each iteration.
   Monotone in one scalar, so bisection converges; 40 iterations is ample and bounded.
5. Round to `arrondi`.
6. Return `{lines: [...], violations: [...]}` where each line carries the proposed price,
   its margin and its delta, and `violations` **names every constraint that could not be
   satisfied and why** (typically: locks plus a floor make the requested average
   impossible). Silently returning a best effort was rejected.

**Decision:** bisection over a scalar, not a solver. The constraint set is small and the
objective is a single mean; adding an LP dependency to a no-dependency appliance would buy
nothing measurable.

The result is written into a **draft tarification** and reviewed before it applies. The
review page is verdict-first, the pattern proven in `excel_form_filler`:

```
12 fiches · 9 prix changent · marge moyenne 82,4 % → 84,1 %
écart 6,00 € → 4,50 € · 0 fiche sous le plancher
```

then the before/after table, then Appliquer / Annuler. Nothing is written until accepted.

**Impact d'une hausse de prix d'achat** reuses the same machinery in reverse: recompute
every cocktail at current costs and list those whose realised margin has fallen under the
floor, grouped by menu, with the reference responsible. No new data, no new table.

## 5. Interface

### 5.1 New screen: 08 Menus & tarifications

Left column: the menus. Centre: the selected menu's cocktails in order, with cost, price,
margin, and a tick box per row. Right: the tarifications of that menu, the active one
marked, with Dupliquer, Comparer and Optimiser.

- **Dupliquer**: copies the price rows into a new tarification, named and inactive.
- **Comparer**: two tarifications side by side, price and margin per cocktail, deltas
  highlighted, plus the menu-level aggregate for each.
- **Optimiser**: the constraints form, then the verdict-first proposal above.

Menu-level KPIs, always visible: number of cocktails, average margin, cheapest and
dearest, spread, average material cost, total material cost. No sales-weighted margin: the
app holds no sales volumes, and inventing weights would be worse than showing none.

### 5.2 Shared modules

| Module | Job |
|---|---|
| `static/js/table.js` | One table renderer: sortable on every column including "créé le", tick boxes, live summary bar over the selection. Used by Références, Inventaire, Cartes & recettes, Menus. Sort and selection persist for the session, per screen, in module state like the existing `F` filter objects. |
| `static/js/select.js` | Styled dropdown replacing every raw `<select class="input">`, keyboard-navigable, with a search field as soon as the list exceeds 10 options. |
| `static/js/palette.js` | ⌘K (and Ctrl+K): screens, references, cocktails, menus, tarifications, plus the four frequent actions (Nouvelle référence, Réception, Nouvelle fiche, Importer un fichier). Matching is accent- and case-insensitive, reusing the normalisation the importer already applies to names. |
| `static/js/tour.js` | Per-screen guided tour: spotlight by box-shadow cutout, steps targeted by `[data-tour]` attributes, ported from `xml_editor`'s `GuidedTour.tsx` to vanilla JS. A `?` button in the header starts the current screen's tour; it also auto-runs once per screen, tracked in `localStorage`. Screens with a non-obvious computation (Barème fiscal, the fiche's cost breakdown, the optimizer) get an "Comment c'est calculé" step that explains the formula in plain French. |
| `static/js/whatsnew.js` | "Quoi de neuf" modal, driven by a dated list of entries in the module. Shown when the stored seen-version is behind the app version; reopenable by clicking the build stamp in the footer. |

### 5.3 Existing screens

- **Comptoir**: "Doses disponibles" removed from the KPIs and from the hero note;
  "Références en stock" takes its place.
- **Références**: bulk actions over the ticked rows: catégorie, marge cible, seuil,
  fournisseur. Confirmation states how many rows are affected.
- **Fiche bouteille**: the fiscal cascade, the dose override, the live duty per dose.
- **Barème fiscal**: the DOM reduced rate, editable next to the standard one. The default
  is written into the migration but is presented as editable and dated, because the rate is
  a legal figure that must be auditable rather than trusted.
- **Everywhere**: the 9 `alert()` calls become in-app modals (`ui.js` gains `alertModal`)
  or inline field errors; the import card accepts a dropped file; the footer carries
  version and build date.

## 6. API surface (additions)

```
GET    /api/menus                      liste + tarifications + KPIs
POST   /api/menus                      création
PATCH  /api/menus/{id}                 nom, description, ordre des cocktails
DELETE /api/menus/{id}
POST   /api/menus/{id}/tarifs          création (vide ou duplication d'une existante)
PATCH  /api/tarifs/{id}                nom, note, actif, prix ligne à ligne
DELETE /api/tarifs/{id}
POST   /api/tarifs/{id}/optimiser      contraintes → proposition (n'écrit rien)
GET    /api/impact                     hausses de coût → fiches sous le plancher
GET    /api/export.xlsx                export de la vue courante
```

`/api/tarifs/{id}/optimiser` deliberately returns a proposal and writes nothing; applying
it is a normal `PATCH` of the tarification's prices. That keeps the endpoint pure and makes
the review gate impossible to bypass by accident.

## 7. Testing

The existing suite is 54 tests; this wave adds, at minimum:

- `pricing.optimize`: each constraint alone, constraints in combination, locked cocktails,
  an impossible set (asserting the violation is reported rather than silently absorbed),
  rounding stability, and an empty menu.
- The fiscal cascade: `alcoolise = 0` yields zero duty whatever the category régime; a
  per-reference régime overrides the category's; the DOM flag applies the reduced rate only
  to spiritueux; `droits_inclus` still suppresses the addition.
- Dose inheritance: NULL falls back to the category, a value overrides it, and the cost per
  dose follows.
- Effective price resolution: cocktail in a menu with an active tarification, in a menu
  without one, and in no menu.
- `menu_items.cocktail_id` uniqueness is enforced.
- Migration: existing references with an `aucun` category régime come out `alcoolise = 0`.

## 8. Delivery

Five phases, one PR each, each deployed to the Mac and to the VPS demo as it lands.

1. **Quick wins**: #4, #8, per-reference dose (#5), DOM rate (#6), the fiscal cascade (#7),
   plus the hygiene batch (alerts, drag & drop, build stamp).
2. **Navigation**: `table.js` sorting, `select.js`, `palette.js` (⌘K).
3. **Selection**: summary bars everywhere, bulk edits on Références, per-cocktail margin
   and pinned price.
4. **Menus & tarifications**: model, screen, active tarification, duplicate, compare.
5. **The engine**: constraints, optimizer, verdict-first proposal, impact d'une hausse,
   Excel export.

The tour and the "Quoi de neuf" modal are built in phase 2 (they belong with the
navigation work) and extended by each later phase with its own steps and entry.

If phase 4 grows teeth, comparison ships as a 4b rather than delaying the engine.

## 9. Decisions log

| Question | Decided | Why |
|---|---|---|
| What differs between two versions of a menu? | Prices only, and they are called **tarifications** | "Same ingredients, different prices" was the actual need. Snapshot copies would fork recipes and make a cost change invisible to older versions. |
| Where does the real price live? | The active tarification of the cocktail's menu, falling back to `cocktails.prix_ttc` | One source of truth, no mirroring, existing screens keep working through one helper. |
| Can a cocktail sit in two menus? | No | Otherwise "the active price" is undefined. |
| Optimizer output | A proposal, reviewed then applied | Money. A gate the user cannot bypass by accident is worth the extra click. |
| Solver | Bisection on one scalar | The objective is a single mean; an LP dependency in a zero-dependency appliance buys nothing. |
| `droits_inclus` folded into the cascade? | No, kept separate and moved next to the price | It is an invoice question, not a fiscal one. Merging makes "0 € of duty" ambiguous. |
| Dose location | Per reference, inheriting the category | 300 references should not all need filling; the exceptions are the magnums and the 4,5 L. |
| DOM quota | Not modelled | The data is not held, and the invoice already reflects the applicable rate. |
| Per-cocktail override | Target margin **or** a pinned price, one `prix_fixe` flag | The pin and the optimizer lock are the same statement. |
| Bulk edits | Références only | That is where 300-row drudgery lives; cocktails and menus are edited one at a time by nature. |
| Weighted margin per menu | Omitted | No sales volumes are held; inventing weights would be worse than showing none. |
| Printable card | Out of this wave | The physical card is produced elsewhere. |
| Alias memory for price files | Out of this wave | Wanted, but it is its own feature with its own review surface. |
