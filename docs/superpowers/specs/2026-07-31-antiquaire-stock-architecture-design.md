# Antiquaire Stock — Technical & Functional Spec (v2)

Date: 2026-07-31 (v2 — same day, after Claude Design import)
Status: approved architecture + design-derived functional scope, pre-implementation
Design source: `design/Stock Pingouin.dc.html` (project "Gestion de stock speakeasy au
pingouin"). The embedded script in that file is the authoritative UX/visual reference;
this document records the *decisions* — where the two disagree, this document wins.

## 1. What this is

"Le Pingouin" — stock, costing and pricing management for a speakeasy bar, running
entirely on one Mac M4, used by multiple staff at that Mac, French UI. It behaves like an
appliance: always on, survives crashes and reboots, backs itself up, and never asks anyone
for technical knowledge after the one-time install (done by the maintainer).

The heart of the app is the **pricing engine**: purchase price → cost per dose → fiscal
share → suggested price at a target margin, for single bottles and for cocktail recipes.

**Non-goals (v1):** POS/till integration, barcode scanning, remote/off-site access,
multi-device access, passwords/authentication, cloud sync, bottle photos.

## 2. Stack (unchanged from v1, one addition)

| Piece | Choice | Why |
|---|---|---|
| Language | Python 3.12, managed by `uv` | Reproducible env from lockfile |
| Web framework | FastAPI (sync routes only) | Known pattern; auto OpenAPI docs |
| Database | SQLite, WAL mode, one file | Single-machine, single-writer; the file IS the backup unit |
| DB access | stdlib `sqlite3`, hand-written SQL | Small schema; no ORM |
| Migrations | numbered `.sql` files + `PRAGMA user_version` runner | Versioned schema without Alembic |
| Excel import | `openpyxl` (pure-Python xlsx reader) | The one new dependency; CSV via stdlib `csv` |
| Frontend | static HTML/CSS/vanilla JS served by FastAPI, JSON API | No Node, no build step; design HTML restyled in |
| Fonts | Playfair Display, IBM Plex Sans, IBM Plex Mono — **vendored locally** | The design pulls Google Fonts; the appliance must not depend on the network |
| Process manager | launchd LaunchAgent, `KeepAlive` + `RunAtLoad` | Always-on, crash-restart, boot-start |
| Server | uvicorn, 1 worker, `127.0.0.1:8765` | Localhost-only = the whole security model |

No Docker, no PyInstaller, no Node, no external services.

## 3. Screens (from the design, with agreed deltas)

1. **Comptoir** (dashboard) — cave value (achat HT), doses count, KPIs, menu margins.
   *Delta:* the low-stock panel becomes the **order list**: grouped by fournisseur, each
   line shows suggested quantity = `par_target − stock` (rounded up).
2. **Références** — searchable/filterable table: stock, value, cost/dose, margin,
   suggested price; row actions edit/delete; click-through to the fiche.
3. **Fiche bouteille** — specs, fiscal breakdown per dose, margin slider (60–92),
   price waterfall (cost → HT → TVA → TTC rounded), scenarios plancher/cible/premium.
   *Delta:* no photo placeholder — the block is removed.
4. **Inventaire** — per-lieu session, partial counts allowed: pick the lieu, count what
   you see (¼/½/¾ open-bottle buttons + full-bottle steppers); *Clôturer* writes count
   movements **only for touched refs**. At most one open bottle per ref per lieu.
5. **Cartes & recettes** — cocktail list + recipe editor (famille, verre, description,
   ingredients with steppers), cost matière, price slider, margin breakdown, suggested
   price + "Appliquer", stock feasibility (limiting ingredient).
6. **Cave & seuils** — per-ref seuil steppers, editable achat/marge inline, untracked
   garnitures table, **file import** (.xlsx/.csv → column mapping → preview → apply +
   import history). *Delta:* also shows par_target (editable) next to seuil.
7. **Barème fiscal** — editable rates: accise spiritueux (€/hL AP), cotisation SS
   (€/hL AP, >18°), vin, mousseux, bière (€/hL/degré); per-dose examples.
8. **Configuration** — pricing policy (marge cible, plancher, arrondi), categories table
   (nom, dose cl, régime fiscal, marge, TVA), simple lists (lieux, fournisseurs,
   familles, verres, unités). *Delta:* plus a **Sauvegardes** card: snapshot now, list +
   restore snapshots, download CSV export zip.

**Réception** (agreed addition, not in the design): a light flow — pick lieu, pick refs,
+ quantities, validate — recorded as delivery movements. Entry point: a "Réception" button in the header next to
"+ Référence"; visually it reuses the modal/table language of the design.

Header: site switcher (Tous + lieux), "+ Référence" (create modal, tracked/untracked
toggle). The "Chef barman" badge is decorative only — **no staff tracking**.

## 4. Domain model & rules

### Tracked vs untracked references

- **Suivie** (tracked): has stock per lieu, seuil, par_target, inventory presence.
- **Non suivie** (garniture/épice): no stock, no seuil; exists only to cost recipes;
  priced per unit (branche, trait, zeste…).
- **Consommable** (category): untracked; flat cost charged per recipe serving.
  *Design bug fixed:* the mock charges consumables `achat × qty` with qty 0 (= free);
  we default qty to 1 so the cost actually counts.

### Stock = ledger, per location

No mutable quantity column. `movements(ref, lieu, type, quantity)` append-only:

- `reception` — signed delta (deliveries)
- `ajustement` — signed delta (corrections, breakage)
- `comptage` — absolute observed level (inventory close, import stock column)

Current stock per (ref, lieu) = latest `comptage` + sum of later deltas (ordered by `id`,
not timestamp). No comptage yet → sum of deltas from zero. "Tous" = sum over lieux.
Quantities are REAL: open bottles count fractionally (0.25/0.5/0.75).

### Pricing engine (per dose)

```
doses_par_bouteille = vol_cl / dose_cl(categorie)
cout_dose           = achat_ht / doses_par_bouteille  (+ taxes_dose si droits NON inclus)
prix_ht             = cout_dose / (1 − marge/100)
prix_ttc            = arrondi_commercial(prix_ht × (1 + tva/100))
marge_reelle(ttc)   = (ht − cout_dose) / ht × 100
```

- `marge` per ref defaults to its category's marge; overridable per ref.
- **Fiscal:** each ref has `droits_inclus` (default **true** = wholesaler invoice already
  carries the duty; fiscal panel is then analytics only). When **false** (bought duty-free
  / en suspension), `taxes_dose = accise + cotisation_SS` computed per régime and degree
  is **added to cout_dose** before margin.
- Tax math per dose (from the design, verified formulas): spiritueux → hL-of-pure-alcohol
  × rate; vin/mousseux/intermédiaire → hL of product × rate; bière → hL × rate × degree;
  cotisation SS only above 18° vol.
- Cocktails: cost matière = Σ ingredient costs (tracked: cost/cl × cl; untracked:
  unit price × qty; consommable: unit price × qty). Menu TVA fixed at 20 %.
  Suggested price = arrondi(cost / (1 − cible/100) × 1.20). Feasibility = min over
  tracked ingredients of `floor(stock × vol / cl_needed)`.

### Ordering

Alert when `stock ≤ seuil`. Order suggestion = `ceil(par_target − stock)` per ref below
seuil, grouped by fournisseur, shown on the Comptoir panel.

## 5. Schema

Data lives outside the repo in `~/AntiquaireStock/` (stock.db, backups/, exports/,
logs/) — visible for a non-technical restore, Time Machine picks it up.

```sql
locations   (id, nom UNIQUE, position, active)        -- lieux; rename-safe (stock refs id)
categories  (id, nom UNIQUE, dose_cl, regime, marge_pct, tva_pct, position, active)
             -- regime IN ('spiritueux','vin','mousseux','biere','intermediaire','aucun')
refs        (id, nom, marque, categorie_id→categories, fournisseur TEXT,
             vol_cl, abv, achat_ht, marge_pct NULL,    -- NULL = category default
             seuil, par_target, droits_inclus DEFAULT 1,
             suivi DEFAULT 1, unite TEXT,              -- unite for untracked
             active DEFAULT 1, created_at)
movements   (id, ref_id→refs, location_id→locations,
             type IN ('reception','comptage','ajustement'), quantity REAL,
             source TEXT,                              -- 'inventaire' | 'import' | 'manuel'
             note TEXT, created_at)
cocktails   (id, nom, famille, verre, prix_ttc, description, position, active, created_at)
cocktail_ings (id, cocktail_id→cocktails ON DELETE CASCADE, ref_id→refs,
             qty REAL, position)                       -- cl if tracked, unités otherwise
imports     (id, filename, line_count, created_count, updated_count, created_at)
settings    (key PRIMARY KEY, value JSON)              -- pricing{cible,min,arrondi},
                                                       -- rates{accise,ss,vin,mousseux,biere},
                                                       -- lists{fournisseurs,familles,verres,unites}
```

Soft-delete everywhere (`active=0`) so history and recipes never dangle; deleting a ref
used by cocktails warns (as the design's confirm dialog says) but keeps the rows.
Fournisseurs/familles/verres/unités are plain string lists in settings — the design
treats them as such; refs store `fournisseur` as text. Lieux are a real table because
movements reference them.

## 6. API surface

JSON under `/api`, static frontend at `/`. One request = one transaction.

```
GET    /api/state                       # bootstrap: settings, categories, lieux, lists
GET    /api/stock?lieu=                 # refs + derived stock + pricing + alert flags
GET    /api/orders                      # below-seuil grouped by fournisseur w/ suggested qty
GET    /api/refs/{id}                   # fiche: specs, fiscal breakdown, waterfall inputs
POST/PATCH /api/refs[/{id}]             # create/edit (tracked & untracked), soft delete
POST   /api/movements/bulk              # réception, ajustements, inventory clôture
                                        #   {lieu, source, lines:[{ref, type, quantity}]} — atomic
GET    /api/movements?ref=&lieu=&limit=
GET/POST/PATCH/DELETE /api/cocktails[/{id}]   # incl. ingredients (full-recipe PUT semantics)
GET/PATCH /api/settings                 # pricing, rates, lists
GET/POST/PATCH /api/categories[/{id}]
GET/POST/PATCH /api/locations[/{id}]
POST   /api/import/inspect              # upload file → sheet columns + preview rows
POST   /api/import/apply                # column mapping → upsert refs/stock, history row
GET    /api/imports                     # history
GET    /api/backups · POST /api/backups · POST /api/backups/{name}/restore
GET    /api/export                      # zip of per-table CSVs
GET    /api/health                      # {ok, db_ok, last_backup_at}
```

Pricing/fiscal/feasibility math lives in pure functions (`pricing.py`), unit-tested
directly; routes are thin.

### Import semantics

Match rows to refs by normalized `nom` (case/accent-insensitive). Mapped columns may
include nom, marque, catégorie, volume, degré, achat, stock, fournisseur. Existing refs
are updated (only mapped fields); unknown noms create refs (default seuil/par). A mapped
`stock` column writes `comptage` movements to a lieu chosen at apply time. Every apply
records an `imports` row; the whole apply is one transaction.

## 7. Backups & restore (unchanged from v1)

Nightly 04:00 `VACUUM INTO ~/AntiquaireStock/backups/stock-YYYY-MM-DD.db` from an
in-process daemon thread (hourly check + on-startup catch-up). Retention: last 30 dailies
+ first-of-month for 12 months. Restore (from the Sauvegardes card): pre-restore snapshot
→ swap file → reopen. CSV export zip of all tables. The snapshot IS the portable dump.

## 8. Install, run, update (unchanged from v1)

`scripts/setup.sh` (idempotent): install uv if missing → `uv sync` → render + bootstrap
LaunchAgent `com.antiquaire.stock` → Desktop shortcut `Le Pingouin.webloc` →
poll `/api/health`. Update = `git pull && ./scripts/setup.sh`. Migrations run at startup;
a failed migration refuses to serve (fail loud, launchd retries, log says why).

## 9. Error handling & reliability

- launchd restarts on crash; logs in `~/AntiquaireStock/logs/`.
- WAL, `foreign_keys=ON`, single writer; bulk writes atomic (a bad inventory line rolls
  back the whole clôture).
- Import files parsed defensively: bad cells → per-line errors in the preview, never a
  crash; apply refuses if the mapping lacks `nom`.
- Frontend: failed fetch → plain reload banner (covers the ~1 s launchd restart window).

## 10. Testing

`pytest`, temp SQLite per test, no network:

- **pricing.py**: cost/dose, margin ↔ price round-trips, arrondi, fiscal per régime
  (spiritueux/vin/mousseux/bière/aucun, SS >18° boundary), droits_inclus on/off,
  cocktail cost incl. untracked + consommable defaults, feasibility limiting factor.
- **Ledger**: per-lieu derivation (comptage + later deltas, id-ordered), fractional
  counts, partial inventory (untouched refs keep theoretical), "Tous" aggregation.
- **API**: CRUD + soft-delete, bulk atomicity, orders grouping/quantities.
- **Import**: mapping to update/create, accent-insensitive matching, stock→comptage,
  malformed file handling, history rows.
- **Backups**: snapshot/restore round-trip, retention pruning, export zip completeness.
- **Migrations**: fresh DB reaches head; runner idempotent.

CI: GitHub Actions, `ruff` + `pytest` on Linux.

## 11. Decisions log (what was challenged and chosen)

| Question | Decision |
|---|---|
| Baseline need | Nothing exists today; tool = full control from zero |
| Users/devices | Multiple staff, one Mac, no remote |
| Launch UX | Always-on launchd service + browser shortcut |
| Ship path | Maintainer installs/updates by hand; nothing compiled |
| Backups | Local dated snapshots + CSV export + portable dumps |
| Per-location stock | **Real** (Réserve/Comptoir, editable lieux) |
| Stock in | **Light réception flow** (delivery movements) |
| Ordering | **Seuil + par_target order list** grouped by fournisseur |
| Staff accountability | **Dropped** — single persona, badge decorative |
| Import formats | **.xlsx + .csv** with mapping UI (openpyxl) |
| Photos | **Dropped**, no placeholder |
| Fiscal → pricing | **Per-ref `droits_inclus` toggle** (default: included ⇒ analytics only) |
| Inventory | **Per lieu, partial allowed**, 1 open bottle/ref/lieu, clôture = touched refs only |
