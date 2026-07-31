# Antiquaire Stock — Technical Architecture (Approach A)

Date: 2026-07-31
Status: approved direction, pre-implementation
Scope: technical architecture only. UI layout, copy, and visual design come from the
Claude Design spec (imported later) and are deliberately not fixed here.

## 1. What this is

A stock management system for a bar, running entirely on one Mac M4. Multiple staff use
it, always at that Mac. It must behave like an appliance: always on, survives crashes and
reboots, backs itself up, and never asks anyone for technical knowledge after the one-time
install (done by the maintainer).

**v1 scope:** product catalog, current stock levels, stock movements (deliveries, counts,
adjustments), par levels with a "what to order" list, backups/restore, CSV export.

**Non-goals (v1):** POS/till integration, barcode scanning, remote/off-site access,
multi-device access, passwords/authentication, cloud sync.

## 2. Stack

| Piece | Choice | Why |
|---|---|---|
| Language | Python 3.12, managed by `uv` | Reproducible env from lockfile; maintainer already fluent |
| Web framework | FastAPI (sync routes only) | Known pattern (dqw_standalone, Command Center); auto OpenAPI docs |
| Database | SQLite, WAL mode, one file | Single-machine, single-writer; the file IS the backup unit |
| DB access | stdlib `sqlite3`, hand-written SQL | Schema is ~4 tables; SQLAlchemy+Alembic is dead weight here |
| Migrations | numbered `.sql` files + `PRAGMA user_version` runner (~15 lines) | Versioned schema without Alembic |
| Frontend | static HTML/CSS/vanilla JS served by FastAPI, JSON API | No Node, no build step on the Mac; Claude Design HTML drops in directly |
| Process manager | macOS launchd LaunchAgent, `KeepAlive=true`, `RunAtLoad=true` | Starts at login, restarts on crash — the "always-on" requirement, natively |
| Server | uvicorn, 1 worker, bound to `127.0.0.1` | Localhost-only = no auth surface; single worker = single SQLite writer |

No Docker, no PyInstaller, no Node, no external services.

## 3. Repo layout

```
antiquaire_stock/
├── src/antiquaire/
│   ├── main.py          # FastAPI app, startup wiring, static mount
│   ├── db.py            # connection factory (WAL, foreign_keys ON), migration runner
│   ├── migrations/      # 001_init.sql, 002_....sql
│   ├── stock.py         # domain logic: level derivation, order suggestions (pure functions + SQL)
│   ├── backups.py       # snapshot / restore / export / retention
│   └── api.py           # JSON routes (thin: parse → call stock/backups → respond)
├── static/              # index.html, css, js — the whole frontend
├── scripts/
│   ├── setup.sh         # one-shot install/update (idempotent)
│   └── com.antiquaire.stock.plist.tmpl
├── tests/
├── docs/superpowers/specs/
└── pyproject.toml       # deps: fastapi, uvicorn; dev: pytest, ruff
```

Flat by design: one package, five modules. Layering (ports/adapters) is not warranted at
this size — `api.py` thin over `stock.py`/`backups.py` is the only boundary that matters.

## 4. Data model

All data lives outside the repo so `git pull` can never touch it:

```
~/AntiquaireStock/
├── stock.db             # the live database
├── backups/             # stock-YYYY-MM-DD.db snapshots
└── exports/             # CSV export zips
```

A visible home-folder directory (not `~/Library/Application Support`) so a non-technical
person can find it, and Time Machine picks it up by default.

### Tables

```sql
suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  contact TEXT DEFAULT ''            -- free text: phone/email/notes
);

products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,            -- free text w/ UI suggestions (Spirits, Beer, Wine, Soft, Consumables…)
  unit TEXT NOT NULL,                -- 'bottle' | 'can' | 'keg' | 'L' | 'kg' | 'unit'
  supplier_id INTEGER REFERENCES suppliers(id),
  purchase_price REAL,               -- per unit, informational
  par_min REAL,                      -- reorder threshold
  par_target REAL,                   -- level to order back up to
  active INTEGER NOT NULL DEFAULT 1, -- soft delete: keep history intact
  created_at TEXT NOT NULL           -- ISO-8601 UTC
);

staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('delivery','count','adjustment')),
  quantity REAL NOT NULL,            -- delivery/adjustment: signed delta; count: absolute observed level
  staff_id INTEGER REFERENCES staff(id),
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL           -- ISO-8601 UTC
);
```

### The ledger rule

There is **no mutable `quantity` column**. Current level per product is derived:

> latest `count` movement (absolute) + sum of all `delivery`/`adjustment` deltas after it.
> No count yet → sum of all deltas from zero.
> "Latest"/"after" order by `id`, not timestamp — same-second entries stay unambiguous.

One SQL query computes this for all products at once. A bar has a few hundred products
and a few movements a day — computing on read is instant; no cache, no invalidation bugs.

Why a ledger: the #1 disaster scenario is *human error inside the app*. The ledger gives
history, "who did this" (staff picker, no passwords), and correction-by-new-entry instead
of destructive edits. Movements are append-only in the UI (fix a mistake with an
adjustment or a new count); products/suppliers/staff use soft-delete (`active=0`).

### Staff accountability

Lightweight only: the UI has a "who's working" picker; every movement stores `staff_id`.
No logins, no passwords, no permissions — everyone can do everything.

## 5. API surface

JSON under `/api`, static frontend at `/`. Sync `def` routes, one uvicorn worker,
one request = one transaction (`with conn:`).

```
GET    /api/stock                     # all active products + derived level + below-par flag
GET    /api/orders                    # below-par products grouped by supplier, qty = par_target − level
POST   /api/movements                 # {product_id, type, quantity, staff_id?, note?}
POST   /api/movements/bulk            # a full count session or multi-line delivery, one transaction
GET    /api/movements?product_id=&limit=   # history

GET/POST/PATCH /api/products[/{id}]  # PATCH includes active=false (soft delete)
GET/POST/PATCH /api/suppliers[/{id}]
GET/POST/PATCH /api/staff[/{id}]

GET    /api/backups                   # list snapshots (name, date, size)
POST   /api/backups                   # snapshot now
POST   /api/backups/{name}/restore    # see restore flow
GET    /api/export                    # streams zip of per-table CSVs
GET    /api/health                    # {ok, db_ok, last_backup_at}  — used by setup.sh verify
```

Order math (`par_target − level` for products with `level < par_min`, grouped by
supplier) is a pure function in `stock.py`, unit-tested directly.

## 6. Backups & restore

- **Nightly snapshot** at 04:00 local: `VACUUM INTO '~/AntiquaireStock/backups/stock-YYYY-MM-DD.db'`.
  `VACUUM INTO` is SQLite's built-in "write a clean, defragmented copy" — safe on a live
  DB, and the output is a complete standalone database: **the snapshot IS the restorable
  dump**, openable by any SQLite tool anywhere.
- **Scheduler:** a daemon thread in the app process (checks hourly whether today's
  snapshot exists; also snapshots on startup if today's is missing). The app is always-on
  via launchd, so an in-process thread is sufficient — no second plist, no cron.
- **Retention:** keep the last 30 daily snapshots + the first snapshot of each month for
  12 months. Pruning runs after each snapshot.
- **Restore flow (UI-driven):** pick a snapshot → app snapshots the *current* DB first
  (`pre-restore-<timestamp>.db`) → closes connections → copies snapshot over `stock.db`
  → reopens. A restore can therefore always be undone.
- **CSV export:** one zip with `products.csv`, `suppliers.csv`, `staff.csv`,
  `movements.csv`, `stock_levels.csv` (the derived view) — the data is never hostage to
  the app.

## 7. Install, run, update (maintainer-only)

`scripts/setup.sh`, idempotent:

1. Install `uv` if missing; `uv sync` (pinned Python + locked deps).
2. Render the LaunchAgent plist (`com.antiquaire.stock`) → `~/Library/LaunchAgents/`,
   `launchctl bootstrap`. `KeepAlive` + `RunAtLoad`; stdout/err → `~/AntiquaireStock/logs/`.
3. Drop `Stock Bar.webloc` (→ `http://127.0.0.1:8765`) on the Desktop — the staff-facing
   "app icon"; double-click opens the default browser.
4. Verify: poll `/api/health` until ok, print result.

**Update** = `git pull && ./scripts/setup.sh` (re-syncs deps, re-renders plist,
`launchctl kickstart -k` to restart). Migrations run automatically at app startup.

Port `8765` fixed, bound to `127.0.0.1` only — nothing is reachable from the network,
which is the entire security model (plus: no secrets exist in this app).

## 8. Error handling & reliability

- launchd restarts the process on any crash (`KeepAlive`); logs land in
  `~/AntiquaireStock/logs/` for post-mortem.
- SQLite in WAL mode, `foreign_keys=ON`, one writer (single worker) — no lock contention.
- Every write endpoint is one transaction; partial bulk writes (count sessions) roll back
  whole.
- Migration runner refuses to start the app on a failed migration (fail loud, launchd
  keeps retrying, log says why) rather than running on a half-migrated schema.
- Frontend shows a plain "reload the page" banner when `fetch` fails — the realistic
  failure is the 1-second launchd restart window.

## 9. Testing

`pytest`, no network, temp-file SQLite per test:

- **Domain math:** level derivation (counts vs deltas ordering, no-count-yet, same-timestamp
  edges), order suggestions (below par, grouping, target math).
- **API:** FastAPI `TestClient` over the real app with a temp DB — CRUD, bulk count
  atomicity (one bad line rolls back all), soft-delete behaviour.
- **Backups:** snapshot → mutate → restore roundtrip equals pre-mutation state; retention
  pruning keeps exactly the right set; export zip contains all tables.
- **Migrations:** fresh DB reaches latest version; runner is idempotent.

CI: GitHub Actions running `ruff` + `pytest` on pushes/PRs (Linux runner is fine — nothing
here is macOS-specific except the plist, which is a template file).

## 10. What the design spec may add later

The Claude Design import defines pages, flows, and copy (likely French UI). It may add
functions on top of this base (e.g. a guided count flow, delivery quick-entry). The
architecture absorbs those as new frontend pages + at most new endpoints over the same
four tables. Anything requiring new aggregates (recipes, cocktail costing, sales) is a
new design conversation, not silent scope growth.
