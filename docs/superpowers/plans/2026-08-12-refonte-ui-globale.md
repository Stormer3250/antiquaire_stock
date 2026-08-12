# Refonte UI globale (simplification + harmonisation) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harmonise every screen (except Comptoir) onto one shared language — a frozen control bar, one table skeleton with grouping, a block view, and one live-patch modal per screen — while cutting information density.

**Architecture:** Vanilla-JS hash-routed SPA (`static/js/screens/*` render into `#screen`). We extend the existing `table.js` primitive (sort/selection/summary) with grouping, add two new primitives (`viewbar.js` frozen bar + per-screen view state, `blocks.js` block grid), then rewrite screens onto them phase by phase. Persistence stays 100% write-through: modals live-patch and offer "Rétablir" (restore an open-time snapshot) instead of Save/Cancel. No backend change is needed except none at all — the percent-decimals setting rides the existing opaque `settings.pricing` JSON.

**Tech Stack:** Vanilla ES modules, no build step. FastAPI backend untouched. `node <file>` self-checks (existing pattern in `table.js`), `scripts/check_js.sh` for syntax, Playwright (installed on the box) for screen verification.

## Global Constraints

- **Comptoir (`dash.js`) is untouched.** Zero edits to it.
- Everything stays synchronous write-through: field blur → PATCH → re-render. No client-side pricing math ever (`pricing.py` is the single source of truth).
- French UI copy, French code comments (house style).
- All CSS goes in `static/css/app.css` using existing tokens (`--panel`, `--line`, `--ac`, `--mut`…). No new stylesheet, no radius except existing circles.
- View preference: Block is the default; last-used view remembered **per screen** in `localStorage` (`antiquaire.vue.<screen>`).
- Shared vs independent state: grouping + search shared between table/block views; sort independent per view; advanced filter is **cut** (decided).
- Percentages: rendered via `pc()` which reads the app-wide decimals setting (`pricing.pct_decimales`, 0–2, default 0). Money formatting unchanged.
- Blocks: **fixed-height** cards (not square), responsive grid, anatomy = name / one-line truncated subtitle / 3 KPIs.
- Selection semantics survive: rows hidden by search stay selected ("+N hors filtre"); header checkbox toggles all *visible* rows (existing `table.js` behaviour).
- Branch `feat/refonte-ui`, commit per task, PR to `main` at the end (never direct to main).

### Named deviations from the CR (all agreed in review)

1. Advanced filter: cut entirely; the bar layout leaves no reserved slot.
2. Save model: live-patch + "Rétablir" (snapshot restore) instead of Save/Cancel. Click-outside just closes — nothing is ever unsaved, so no confirmation prompt.
3. Bar sort control only shows in **block** view (table sorts via its headers; showing both would duplicate).
4. Global header buttons (+ Référence, Réception) stay in the top header — screen bars carry only screen-specific actions.
5. Références blocks have no children; their subtitle is `marque · fournisseur`.
6. Cartes modal: "Rétablir" covers the carte's own fields + composition only. Tarification actions (appliquer/dupliquer/supprimer/régler) are immediate with their own confirms — not revertible.
7. `refmodal.js` survives **only** as the creation form (empty form → POST). Editing always happens in the unified fiche modal.
8. Creation via `+ Nouvelle recette` / `+ Nouvelle carte` POSTs then opens the modal on the new entity (replaces today's inline-editor selection).

---

## Phase 1 — shared primitives

### Task 1: `pc()` reads the app-wide decimals setting

**Files:**
- Modify: `static/js/ui.js:22-24`
- Modify: `static/js/app.js` (boot: push setting into ui.js)
- Test: `node static/js/ui.js` (add a `demo()` self-check, same pattern as `table.js:169-197`)

**Interfaces:**
- Produces: `setPctDecimales(d: number)` exported from `ui.js`; `pc(n, d?)` — when `d` is omitted, uses the configured value.
- Consumes: `S.meta.pricing.pct_decimales` (may be `undefined` on old DBs → default 0).

- [ ] **Step 1: Change `pc` in `ui.js`**

```js
let PCT_D = 0;               // décimales des pourcentages, réglées dans Paramètres
export function setPctDecimales(d) {
  PCT_D = Number.isInteger(d) && d >= 0 && d <= 2 ? d : 0;
}
export function pc(n, d) {
  return num(n, d === undefined ? PCT_D : d) + ' %';
}
```

- [ ] **Step 2: Add self-check at the bottom of `ui.js`** (guarded like `table.js:197` — `if (typeof process !== 'undefined' && /ui\.m?js$/.test(process.argv?.[1] || '')) demo();`)

```js
function demo() {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  assert(pc(72.46) === '72 %', 'défaut : entier');
  setPctDecimales(1);
  assert(pc(72.46) === '72,5 %', 'réglage appliqué');
  assert(pc(72.46, 0) === '72 %', 'un d explicite gagne toujours');
  setPctDecimales(9);
  assert(pc(72.46) === '72 %', 'valeur hors bornes → 0');
  setPctDecimales(0);
}
```

Note: `ui.js` imports `overlay.js` which touches `document` at import time only inside guards — verify `node static/js/ui.js` runs; if `overlay.js` breaks under node, guard its DOM access the same way `ui.js:41` already does.

- [ ] **Step 3: Run `node static/js/ui.js`** — expect silent exit 0. Break an assert to see it fail, restore.

- [ ] **Step 4: Wire boot.** In `app.js`, inside `reloadMeta()` after `S.meta = await apiGet('/api/state');` add:

```js
setPctDecimales(S.meta.pricing.pct_decimales ?? 0);
```

(import `setPctDecimales` from `./ui.js` at the top).

- [ ] **Step 5: Sweep explicit decimals.** `grep -rn "pc(" static/js` — remove the explicit `, 1` / `, 0` second argument from **display** call sites so the setting governs everywhere (keep explicit `d` only where a *label* needs it, e.g. none expected). Money (`eur`, `num`) untouched.

- [ ] **Step 6: `bash scripts/check_js.sh`** — expect pass. Run the app (`uv run uvicorn --factory antiquaire.main:create_app --reload`), spot-check a margin renders `72 %`.

- [ ] **Step 7: Commit** — `feat(ui): pourcentages à décimales réglables via pc()`

---

### Task 2: grouping in `table.js`

**Files:**
- Modify: `static/js/table.js`
- Test: extend `demo()` in `table.js`

**Interfaces:**
- Produces: `spec.group = { on: bool, label: (row) => string }` on `renderTable`/`bindTable`. Collapsed-group state lives in the table state store: `tableState(id).collapsed` (a `Set<string>`), so it survives re-renders and is shared with the block view (Task 4 reads the same Set via `barState`— no: blocks use their own spec but the caller passes the **same Set instance**; see Task 3).

- [ ] **Step 1: Extend state + failing self-check.** In `tableState`, initialise `collapsed: new Set()`. Add to `demo()`:

```js
// groupement : partition stable, groupes repliés exclus du rendu
const st = tableState('g', 'nom');
st.collapsed.add('Rhums');
const all = [{ id: 1, cat: 'Gins' }, { id: 2, cat: 'Rhums' }, { id: 3, cat: 'Gins' }];
const vis = visibleRows(all, { on: true, label: (r) => r.cat }, st.collapsed);
assert(vis.map((r) => r.id).join(',') === '1,3', 'les lignes d’un groupe replié disparaissent');
assert(visibleRows(all, { on: false }, st.collapsed).length === 3, 'groupement éteint : tout passe');
```

- [ ] **Step 2: Run `node static/js/table.js`** — expect FAIL (`visibleRows is not defined`).

- [ ] **Step 3: Implement.** Add and export `visibleRows(rows, group, collapsed)` (pure — filter out rows whose `group.label(r)` is in `collapsed` when `group.on`). In `renderTable`, after sorting: if `spec.group?.on`, walk the sorted rows and emit a section header before each new label:

```js
<div class="tgroup" data-group="${esc(label)}" style="grid-template-columns:1fr;">
  <span class="tgroup-caret">${collapsed.has(label) ? '▸' : '▾'}</span>
  ${esc(label)} <span class="tgroup-n">· ${n}</span>
</div>
```

skipping the member rows of collapsed groups (use `visibleRows` for what `bindTable`'s row handlers see too, so click/tick bindings match the DOM). In `bindTable`, bind `.tgroup` click → toggle label in `state.collapsed` → `rerender()`. Select-all keeps operating on all *filtered* rows (collapse ≠ deselect).

- [ ] **Step 4: CSS.** In `app.css`:

```css
.tgroup { display: grid; align-items: center; padding: 9px 20px; gap: 8px;
  background: var(--panel2); border-bottom: 1px solid var(--line);
  font-family: var(--mono); font-size: 10.5px; letter-spacing: .12em;
  text-transform: uppercase; color: var(--mut2); cursor: pointer; user-select: none; }
.tgroup:hover { color: var(--ink); }
.tgroup-caret { display: inline-block; width: 12px; color: var(--ac); }
.tgroup-n { color: var(--mut3); letter-spacing: 0; }
```

(one grid cell spanning full width — simplest; the caret+label+count sit inline in it).

- [ ] **Step 5: Run `node static/js/table.js`** — expect PASS. `bash scripts/check_js.sh` — pass.

- [ ] **Step 6: Commit** — `feat(table): sections de groupement repliables`

---

### Task 3: `viewbar.js` — frozen bar + per-screen view state

**Files:**
- Create: `static/js/viewbar.js`
- Modify: `static/css/app.css`
- Test: `node static/js/viewbar.js` self-check

**Interfaces:**
- Produces:
  - `barState(screen, { sortB } = {})` → `{ view: 'blocs'|'table', search: '', group: false, collapsed: Set, sortB: { key, dir } }` — one object per screen key, kept in a module Map for the session; `view` alone persists to `localStorage['antiquaire.vue.' + screen]`, default `'blocs'`.
  - `setView(screen, view)` — updates state + localStorage.
  - `renderBar(el, opts)` where `opts = { screen, state, placeholder, sortOptions: [[key,label]…] | null, groupLabel: string | null, actions: [{ key, label, solid? }…], views: bool, onChange: () => void, onAction: (key) => void }`. Renders the bar into `el` and binds events. `views: false` = table-only screen (no toggle, no block sort).
- Consumed by every screen task below. The **same** `state.collapsed` Set is passed to both `renderTable` (`spec.group`) and `renderBlocks` — that is how grouping is shared between views.

- [ ] **Step 1: Failing self-check** (state logic only — rendering is verified visually per screen):

```js
function demo() {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const a = barState('refs');
  assert(a.view === 'blocs', 'bloc par défaut');
  assert(barState('refs') === a, 'même objet pour la session');
  setView('refs', 'table');
  assert(barState('refs').view === 'table', 'bascule mémorisée');
  a.search = 'gin'; a.group = true;
  assert(barState('refs').search === 'gin' && barState('refs').group, 'recherche et groupement partagés');
  const b = barState('cave');
  assert(b.view === 'blocs' && b.search === '', 'chaque écran a le sien');
}
```

`localStorage` doesn't exist under node — shim at module top: `const LS = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} };`

- [ ] **Step 2: Run `node static/js/viewbar.js`** — FAIL (nothing defined).

- [ ] **Step 3: Implement `viewbar.js`:**

```js
// Barre gelée commune à tous les écrans : recherche, tri (vue blocs), groupement,
// actions de création, bascule table/blocs. L'état vit ici, par écran.
import { esc } from './ui.js';
import { icone } from './icons.js';

const LS = typeof localStorage !== 'undefined' ? localStorage : { getItem: () => null, setItem: () => {} };
const ETATS = new Map();

export function barState(screen, { sortB = { key: 'nom', dir: 'asc' } } = {}) {
  if (!ETATS.has(screen)) {
    ETATS.set(screen, {
      view: LS.getItem('antiquaire.vue.' + screen) || 'blocs',
      search: '', group: false, collapsed: new Set(), sortB: { ...sortB },
    });
  }
  return ETATS.get(screen);
}

export function setView(screen, view) {
  barState(screen).view = view;
  LS.setItem('antiquaire.vue.' + screen, view);
}

export function renderBar(el, opts) {
  const st = opts.state;
  const enBlocs = opts.views !== false && st.view === 'blocs';
  el.innerHTML = `
  <div class="vbar">
    <input class="input grow" data-vb-q value="${esc(st.search)}" placeholder="${esc(opts.placeholder || 'Chercher…')}">
    ${enBlocs && opts.sortOptions ? `
      <select class="input" data-vb-sort style="width:170px;">
        ${opts.sortOptions.map(([k, l]) => `
          <option value="${k}" ${st.sortB.key === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select>
      <button class="btn muted" data-vb-dir title="Sens du tri">${st.sortB.dir === 'asc' ? '↑' : '↓'}</button>` : ''}
    ${opts.groupLabel ? `
      <button class="btn ${st.group ? '' : 'muted'}" data-vb-group aria-pressed="${st.group}">
        ${esc(opts.groupLabel)}</button>` : ''}
    ${(opts.actions || []).map((a) => `
      <button class="${a.solid ? 'btn-solid' : 'btn'}" data-vb-act="${a.key}">${esc(a.label)}</button>`).join('')}
    ${opts.views !== false ? `
      <div class="vb-views" role="group" aria-label="Vue">
        <button class="${st.view === 'blocs' ? 'active' : ''}" data-vb-view="blocs" title="Blocs">${icone('cartes', 14)}</button>
        <button class="${st.view === 'table' ? 'active' : ''}" data-vb-view="table" title="Table">${icone('inventaire', 14)}</button>
      </div>` : ''}
  </div>`;

  const q = el.querySelector('[data-vb-q]');
  q.addEventListener('input', () => { st.search = q.value; opts.onChange(); });
  el.querySelector('[data-vb-sort]')?.addEventListener('change', (e) => {
    st.sortB.key = e.target.value; opts.onChange();
  });
  el.querySelector('[data-vb-dir]')?.addEventListener('click', () => {
    st.sortB.dir = st.sortB.dir === 'asc' ? 'desc' : 'asc'; opts.onChange();
  });
  el.querySelector('[data-vb-group]')?.addEventListener('click', () => {
    st.group = !st.group; opts.onChange();
  });
  el.querySelectorAll('[data-vb-view]').forEach((b) =>
    b.addEventListener('click', () => { setView(opts.screen, b.dataset.vbView); opts.onChange(); })
  );
  el.querySelectorAll('[data-vb-act]').forEach((b) =>
    b.addEventListener('click', () => opts.onAction(b.dataset.vbAct))
  );
}
```

Add `demo()` guarded the usual way. **Focus note:** screens re-render fully on each keystroke today (`refs.js:179-182` pattern) and restore caret via the existing trick (`refs.js:230-231`) — copy that restore into each screen's render (it stays the screen's job, not the bar's).

- [ ] **Step 4: CSS:**

```css
.vbar { position: sticky; top: 74px; z-index: 5; display: flex; gap: 10px;
  align-items: center; padding: 10px 0 14px; background: var(--bg); }
.vb-views { display: flex; border: 1px solid var(--line3); }
.vb-views button { width: 34px; height: 34px; display: grid; place-items: center;
  background: transparent; border: none; color: var(--mut3); cursor: pointer; }
.vb-views button.active { background: var(--panel2); color: var(--ac); }
```

(`top: 74px` = header height; check the real header height in dev tools and adjust; the bar must sit flush under the frozen page header. If `--bg` isn't the token name for the page background, use the actual one from `app.css` body rule.)

- [ ] **Step 5: `node static/js/viewbar.js`** — PASS. `bash scripts/check_js.sh` — pass.

- [ ] **Step 6: Commit** — `feat(ui): barre gelée commune (viewbar) et état de vue par écran`

---

### Task 4: `blocks.js` — block grid renderer

**Files:**
- Create: `static/js/blocks.js`
- Modify: `static/css/app.css`
- Test: `node static/js/blocks.js`

**Interfaces:**
- Produces: `renderBlocks(el, spec)` with
  `spec = { rows, name: (r) => string, subtitle: (r) => string, kpis: [{ label, value: (r) => string, tone?: (r) => ''|'ok'|'warn' }, ×3], sortB: { key, dir }, accessors?: { key: (r) => any }, group?: { on, label, collapsed }, onClick: (r) => void, empty: string }`.
  Sorting reuses `applySort` from `sortable.js` with `spec.sortB` (same shape as table sort). Grouping reuses `visibleRows` from `table.js` and renders the same `.tgroup` headers between grid sections.

- [ ] **Step 1: Failing self-check** — pure parts: block HTML shape + grouping partition:

```js
function demo() {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const html = blocHtml(
    { id: 1, nom: '<b>Gin</b>', sub: 'Bombay', a: '3 bt', b: '1,20 €', c: '12,00 €' },
    { name: (r) => r.nom, subtitle: (r) => r.sub,
      kpis: [
        { label: 'Stock', value: (r) => r.a },
        { label: 'Coût unitaire', value: (r) => r.b },
        { label: 'Prix conseillé', value: (r) => r.c, tone: () => 'ok' },
      ] });
  assert(html.includes('&lt;b&gt;'), 'nom échappé');
  assert((html.match(/bloc-kpi\b/g) || []).length === 3, 'trois KPI, toujours');
  assert(html.includes('data-bloc="1"'), 'cliquable par id');
}
```

- [ ] **Step 2: `node static/js/blocks.js`** — FAIL.

- [ ] **Step 3: Implement:**

```js
// Vue en blocs : cartes de hauteur fixe, grille fluide, mêmes groupes que la table.
import { esc } from './ui.js';
import { applySort } from './sortable.js';
import { visibleRows } from './table.js';

export function blocHtml(r, spec) {
  return `
  <button class="bloc" data-bloc="${r.id}">
    <div class="bloc-nom">${esc(spec.name(r))}</div>
    <div class="bloc-sub">${esc(spec.subtitle(r) || '')}</div>
    <div class="bloc-kpis">
      ${spec.kpis.map((k) => `
      <div class="bloc-kpi">
        <div class="mono-label">${esc(k.label)}</div>
        <div class="bloc-kpi-val ${k.tone ? k.tone(r) : ''}">${esc(k.value(r))}</div>
      </div>`).join('')}
    </div>
  </button>`;
}

export function renderBlocks(el, spec) {
  const rows = applySort(spec.rows, spec.sortB, spec.accessors);
  if (!rows.length) { el.innerHTML = spec.empty || '<div class="empty-note">Rien à afficher.</div>'; return; }

  let html = '';
  if (spec.group?.on) {
    const parts = new Map();
    rows.forEach((r) => {
      const g = spec.group.label(r);
      if (!parts.has(g)) parts.set(g, []);
      parts.get(g).push(r);
    });
    for (const [g, membres] of parts) {
      const ferme = spec.group.collapsed.has(g);
      html += `<div class="tgroup" data-group="${esc(g)}">
        <span class="tgroup-caret">${ferme ? '▸' : '▾'}</span>${esc(g)}
        <span class="tgroup-n">· ${membres.length}</span></div>`;
      if (!ferme) html += `<div class="blocs">${membres.map((r) => blocHtml(r, spec)).join('')}</div>`;
    }
  } else {
    html = `<div class="blocs">${rows.map((r) => blocHtml(r, spec)).join('')}</div>`;
  }
  el.innerHTML = html;

  el.querySelectorAll('[data-bloc]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = rows.find((x) => x.id === Number(b.dataset.bloc));
      if (r) spec.onClick(r);
    })
  );
  el.querySelectorAll('.tgroup').forEach((h) =>
    h.addEventListener('click', () => {
      const g = h.dataset.group;
      spec.group.collapsed.has(g) ? spec.group.collapsed.delete(g) : spec.group.collapsed.add(g);
      renderBlocks(el, spec);
    })
  );
}
```

plus the guarded `demo()`. (`visibleRows` import is only needed if we exclude collapsed rows from click lookup — the code above handles collapse in the partition loop, so drop the import if unused.)

- [ ] **Step 4: CSS:**

```css
.blocs { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px; padding: 14px 0; }
.bloc { display: flex; flex-direction: column; gap: 6px; text-align: left;
  height: 148px; padding: 16px 18px; background: var(--panel);
  border: 1px solid var(--line); cursor: pointer; font-family: var(--sans); color: var(--ink); }
.bloc:hover { border-color: var(--line3); background: var(--panel2); }
.bloc-nom { font-family: var(--serif); font-size: 18px; line-height: 1.15;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bloc-sub { font-size: 12px; color: var(--mut3); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.bloc-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
  margin-top: auto; padding-top: 10px; border-top: 1px solid var(--line2); }
.bloc-kpi .mono-label { font-size: 8.5px; color: var(--mut3); }
.bloc-kpi-val { font-family: var(--mono); font-size: 13px; margin-top: 3px; }
.bloc-kpi-val.ok { color: var(--ok-ink); }
.bloc-kpi-val.warn { color: var(--warn-ink); }
```

(check `--ok-ink`/`--warn-ink` exist in `app.css`; otherwise use the tokens `ok-text`/`warn-text` classes use.)

- [ ] **Step 5: `node static/js/blocks.js`** — PASS. `bash scripts/check_js.sh` — pass.

- [ ] **Step 6: Commit** — `feat(ui): vue en blocs (grille, 3 KPI, groupes partagés)`

---

### Task 5: hover checkboxes

**Files:**
- Modify: `static/css/app.css`

- [ ] **Step 1:** Ticks appear on row hover or when the row (or any row) is selected:

```css
.trow .tick input { opacity: 0; transition: opacity .1s; }
.trow:hover .tick input,
.trow.picked .tick input,
.panel:has(.trow.picked) .trow .tick input,
.thead .tick input { opacity: 1; }
```

(`:has` is fine — the bar Mac runs current Safari/Chrome. Keeping all ticks visible once any row is picked avoids hunting for invisible checkboxes mid-selection.)

- [ ] **Step 2:** Visual check on /refs (table view) after Task 6. Commit with Task 6 if trivial, else — `feat(ui): cases à cocher au survol`

---

## Phase 2 — Références (proves the whole pattern)

### Task 6: unified fiche modal (`fiche.js`)

**Files:**
- Create: `static/js/fiche.js`
- Delete: `static/js/screens/product.js` (content moves here)
- Modify: `static/js/refmodal.js` (creation-only: remove edit mode), `static/js/app.js` (route `#/product/:id` → redirect), `static/js/palette.js:78`, `static/js/tour.js:32-38`
- Modify: `static/css/app.css` (modal size L)

**Interfaces:**
- Produces: `openFiche(refId, { onClose } = {})` — fetches `GET /api/refs/:id?lieu=…`, renders the full fiche in a modal (`openModal(html, { width: 980 })`), live-patches, restores on demand. `onClose` fires after the modal closes so the caller re-renders its list.
- Consumes: `openModal/closeModal/confirmModal` from `ui.js`; the fiche layout and bindings from `product.js` (carried over, not rewritten).

Modal structure (the shared skeleton every later modal follows):
1. **Header**: name (editable input) + the 3 block KPIs (Stock · Coût unitaire · Prix conseillé) rendered identically to the block.
2. **Own fields**: the edit form from `refmodal.js` (marque, fournisseur, catégorie, degré, volume, achat HT, seuil, cible, dose…), inline and blur-patching — every value appears **once** (the old fiche's read-only "specs" grid at `product.js:108-115` dies; the editable fields replace it).
3. **Body two-column**: left = part fiscale panel (`product.js:117-123` + `fiscalLines` rendering + droits-inclus checkbox); right = pricing panel carried from `product.js:71-106` (marge slider, waterfall, price box, scénarios) with its existing bindings (`refreshDerived`, `persistMarge`, `bindPriceBox` — `product.js:168-221`).
4. **Footer** (fixed): `Rétablir l'état d'ouverture` (muted) · `Supprimer` (danger) · `Fermer` (solid).

- [ ] **Step 1: Create `fiche.js`.** Skeleton:

```js
export async function openFiche(refId, { onClose } = {}) {
  let p = await apiGet(`/api/refs/${refId}?lieu=${lieuQuery()}`);
  // instantané d'ouverture : ce que « Rétablir » repose, champ à champ
  const avant = {
    nom: p.nom, marque: p.marque, fournisseur: p.fournisseur, categorie_id: p.categorie_id,
    abv: p.abv, vol_cl: p.vol_cl, achat_ht: p.achat_ht, seuil: p.seuil, par_target: p.par_target,
    marge_pct: p.marge, prix_ttc: p.prix_ttc_override, droits_inclus: p.droits_inclus,
  };
  const modal = openModal('<div data-fiche></div>', { width: 980 });
  const zone = modal.querySelector('[data-fiche]');
  let ferme = false;

  async function recharge() { p = await apiGet(`/api/refs/${refId}?lieu=${lieuQuery()}`); paint(); }
  function paint() { zone.innerHTML = ficheHtml(p); bind(); }
  // ficheHtml/bind : contenu de product.js remonté ici (voir structure ci-dessus)
  paint();
}
```

`Rétablir` → `confirmModal({ title: 'Revenir à l'état d'ouverture ?', body: 'Toutes les modifications faites depuis l'ouverture de cette fiche seront annulées.', label: 'Rétablir' })` → `PATCH /api/refs/:id` with `avant` → `recharge()`. `Supprimer` → existing confirm (`product.js:230-238`) then `closeModal(); onClose?.()`. `Fermer` and click-outside → `closeModal(); onClose?.()` (hook `onClose` by wrapping: after `openModal`, `const obs = new MutationObserver(() => { if (!document.querySelector('.modal') && !ferme) { ferme = true; obs.disconnect(); onClose?.(); } }); obs.observe(document.getElementById('modal-root'), { childList: true });` — one observer, covers X/Échap/outside without touching `ui.js`).

Field bindings: reuse the exact blur-patch pattern from `refmodal.js` for identity fields (each blur → `PATCH /api/refs/:id { champ }` → `recharge()`), and carry `product.js`'s pricing bindings verbatim (they already re-render only the derived zone). `marge_pct` PATCH body key (see `cave.js:227-228` uses `marge_pct`; `prix_ttc` for override, `null` to clear — `product.js:182,195-204`).

- [ ] **Step 2: Modal size CSS.** Ensure `.modal` at width 980 stays inside the viewport with visible backdrop: `max-width: calc(100vw - 96px); max-height: calc(100vh - 80px);` and make the body zone `overflow: auto` while header/footer stay fixed (flex column: header, scrollable middle, footer).

- [ ] **Step 3: Rewire the routes.**
  - `app.js`: remove `product` from `SCREENS`/`TITLES` imports and map; in `route()`, if `parts[0] === 'product'` → `location.hash = '#/refs'` and after render `openFiche(Number(parts[1]))` (keeps old deep links alive).
  - `palette.js:78`: `run: () => (r.suivi ? openFiche(r.id, { onClose: refresh }) : openRefModal({ ref: r }))` — wait, deviation 7 says edits go through the fiche: untracked refs have no fiche payload fields? They do (`/api/refs/:id` serves them) but the pricing panel is meaningless. Keep `openRefModal` for untracked here **only if** the fiche breaks on untracked; otherwise `openFiche` for all. Decide at implementation, note the choice in the commit body.
  - `tour.js:32-38`: delete the `product` entry; the refs row-click copy at `tour.js` (refs section, "Cliquez la ligne pour ouvrir sa fiche…") stays true.
  - `refmodal.js`: delete the `ref:`-edit path (keep `suivi`/`onSaved` creation options); grep `openRefModal({ ref` and repoint every call site to `openFiche` (refs.js, cave.js, cocktails.js — cocktails' "create" calls keep `openRefModal`).

- [ ] **Step 4: Delete `static/js/screens/product.js`** once nothing imports it (`grep -rn "product" static/js`).

- [ ] **Step 5: Verify.** `bash scripts/check_js.sh`. Run the app; Playwright drive: open `#/refs`, click a tracked row → modal opens; edit achat HT → prix conseillé updates; Rétablir → values return; Échap closes; old link `#/product/1` lands on refs with the modal open. Screenshot:

```python
# uv run python - <<'EOF'  (server on :8000)
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={'width':1440,'height':900})
    pg.goto('http://127.0.0.1:8000/#/refs'); pg.wait_for_timeout(800)
    pg.locator('.trow').first.click(); pg.wait_for_timeout(600)
    pg.screenshot(path='/tmp/fiche.png'); b.close()
# EOF
```

- [ ] **Step 6: Commit** — `feat(refs): fiche unifiée en modale, écran produit supprimé`

---

### Task 7: Références screen on the shared skeleton

**Files:**
- Modify: `static/js/screens/refs.js`

**Interfaces:**
- Consumes: `barState/renderBar` (Task 3), `renderBlocks` (Task 4), `spec.group` (Task 2), `openFiche` (Task 6).

- [ ] **Step 1: Rework `render`.**
  - Replace the ad-hoc filter row (`refs.js:159-172`) with `renderBar`: `screen: 'refs'`, placeholder unchanged, `sortOptions: [['nom','Nom'],['stock','Stock'],['cout_dose','Coût unitaire'],['prix','Prix conseillé'],['marge_reelle','Marge'],['created_at','Créée le']]`, `groupLabel: 'Grouper par catégorie'`, `actions: [{key:'import',label:'Importer un fichier'},{key:'export',label:'Exporter'}]`, `views: true`.
  - The category `<select>` **dies** (grouping + search replace it); `'__untracked'` filtering dies with it — untracked rows are visible and group under their category.
  - Filtering: `st.search` replaces `F.query` (`F` dies). Same match fields (`refs.js:22-27`).
  - Table view: existing `spec` + `group: { on: st.group, label: (r) => r.categorie_nom, collapsed: st.collapsed }`; `onRowClick: (r) => openFiche(r.id, { onClose: () => render(el) })`.
  - Block view: `renderBlocks(zone, { rows: filtered, name: r => r.nom, subtitle: r => [r.marque, r.fournisseur].filter(Boolean).join(' · '), kpis: [ {label:'Stock', value: fmtStock}, {label:'Coût unitaire', value: r => eur(r.cout_dose)}, {label:'Prix conseillé', value: r => r.suivi ? eur(r.prix) : '—', tone: r => r.suivi && r.marge_reelle < pr.min ? 'warn' : ''} ], sortB: st.sortB, accessors: {}, group: {…same}, onClick: r => openFiche(r.id, { onClose: () => render(el) }), empty: <same copy as table> })`.
  - `onAction`: `'import'` → existing import modal (`refs.js:204-212`); `'export'` → existing exporter (`refs.js:187-203`).
  - Keep: selection/summary/bulk (table view), row action buttons (crayon now also → `openFiche`; delete unchanged), search-caret restore (`refs.js:230-231`).

- [ ] **Step 2: Verify.** `bash scripts/check_js.sh`; Playwright: `#/refs` opens in **blocks** (first run), toggle to table, reload → still table (localStorage); group on → sections in both views, collapse one in table → also collapsed in blocks; search shared across toggle. Screenshots of both views.

- [ ] **Step 3: Commit** — `feat(refs): écran sur le squelette commun (barre, blocs, groupes)`

---

## Phase 3 — Recettes

### Task 8: recette modal (`recettemodal.js`)

**Files:**
- Create: `static/js/recettemodal.js`
- Test: manual + `check_js.sh` (all logic is carried-over bindings; server computes everything)

**Interfaces:**
- Produces: `openRecette(cocktailId, { onClose })` — same contract as `openFiche`.
- Consumes: `GET /api/cocktails?lieu=…` (single recipe read: the list endpoint filtered client-side — there is no `GET /api/cocktails/:id`; fetch the list and `find`, exactly what the screen does today), `PATCH /api/cocktails/:id`, `openRefModal` (ingredient creation), `openModal` L-size from Task 6.

Structure (shared skeleton):
1. **Header**: nom input (serif, as `cocktails.js:118-119`) + 3 KPIs: Coût `eur(c.cost)` · Prix `eur(c.prix_ttc)` · Marge `pc(c.marge)` (tone warn when `!c.ok`).
2. **Own fields**: famille, verre, description (`cocktails.js:121-131`).
3. **Composition zone**: the ingredient rows + steppers + add/create buttons, carried verbatim from `cocktails.js:133-160` and bindings `cocktails.js:282-343`. This is THE composition pattern the carte modal reuses (same row grid: item select · stepper · cost · remove).
4. **Right column** (body is two-column like the fiche): pricing tools from `cocktails.js:163-218` — prix card + slider, "sur quelles cartes" chips, prix conseillé + marge visée + appliquer, prix figé switch, faisabilité.
5. **Footer**: Rétablir · Supprimer · Fermer.

- [ ] **Step 1: Implement.** Same shape as `openFiche`: fetch → `avant` snapshot `{ nom, famille, verre, description, prix_ttc, prix_fixe, marge_pct: c.marge_custom ? c.marge_cible : null, ings: c.ings.map(i => ({ ref_id: i.ref_id, qty: i.qty })) }` → `paint()`/`recharge()` loop; every existing binding carried over but `patch()` now ends in `recharge()` (modal repaint) instead of screen re-render. Rétablir → one `PATCH /api/cocktails/:id` with `avant` (the endpoint accepts all these keys — see `cocktails.js:47-51,273,353,356,360`).

- [ ] **Step 2: Verify** via Playwright: open modal, ± an ingredient → coût matière and header KPIs update; Rétablir → back; delete → confirm → closes and list refreshes.

- [ ] **Step 3: Commit** — `feat(recettes): modale recette (composition + tarification), patch en direct`

### Task 9: Recettes screen (table + blocks)

**Files:**
- Modify: `static/js/screens/cocktails.js` (full rewrite, much smaller)

**Interfaces:**
- Consumes: Tasks 2–4 primitives, `openRecette`.

- [ ] **Step 1: Rewrite.** The master-detail workbench dies. New screen = bar + view zone:
  - Bar: `screen: 'cocktails'`, `sortOptions: [['nom','Nom'],['cost','Coût'],['prix_ttc','Prix'],['marge','Marge'],['created_at','Créée le']]`, `groupLabel: 'Grouper par famille'`, `actions: [{key:'new', label:'+ Nouvelle recette', solid:true}]`.
  - Table columns: Recette (nom + famille/prix-figé sub, as `menus.js:110-115`) · Coût matière `eur(x.cost)` · Prix TTC `eur(x.prix_ttc)` · Marge (`ok-text`/`warn-text` vs `pr.min`) · Créée le + row actions (crayon → `openRecette`, × → delete with the existing confirm copy `cocktails.js:251-254`). `select: true` with the existing picked-summary maths (`cartesSummary`, `cocktails.js:15-31`, reshaped into the standard `summary` + `sum-figs` layout of `refs.js:102-127`).
  - Blocks: name `x.nom`, subtitle = ingredient names — **the list payload must carry them**; check `serialize_cocktail` (`api_menus.py:71-149`): `ings` lines include ref names? If the list already returns `ings` with names, `subtitle: x => x.ings.map(i => i.nom).join(', ')`; if it only has ids, map through the refs list already fetched on this screen (`stockData.refs`). KPIs: Coût · Prix · Marge (warn tone when `!x.ok`).
  - Group axis: `x.famille || 'Sans famille'`.
  - `onClick`/`onRowClick` → `openRecette(x.id, { onClose: () => render(el) })`. `new` action → `POST /api/cocktails {}` → `openRecette(r.id, …)`.

- [ ] **Step 2: Verify** (Playwright, both views + grouping by famille + a full open-edit-close loop). `bash scripts/check_js.sh`.

- [ ] **Step 3: Commit** — `feat(recettes): écran table + blocs sur le squelette commun`

---

## Phase 4 — Cartes

### Task 10: carte modal with two tabs (`cartemodal.js`)

**Files:**
- Create: `static/js/cartemodal.js`
- Modify: `static/css/app.css` (`.modal-tabs`)

**Interfaces:**
- Produces: `openCarte(menuId, { onClose })`.
- Consumes: `GET /api/menus` (find by id — same list-read pattern), all existing menu/tarif endpoints, `openOptimiser`, the compare modal (`menus.js:456-515` — carried over as-is; it stacks on top, which `ui.js`'s single `modal-root` **cannot do** — see Step 2).

Structure:
1. **Header**: nom input + 3 KPIs (Prix moyen · Marge moyenne · Min/Max `${eur(prix_mini)}–${eur(prix_maxi)}`), computed for the **viewed** tarification.
2. **Tabs**: `Composition` | `Tarifications` (`.modal-tabs` under the header; local `let onglet = 'compo'`).
3. **Composition tab**: tarif-being-viewed selector (`<select>` of tarifs, active one marked "appliquée", defaulting to the active one — replaces the third column's "viewing" role) + the recipes table carried from `menus.js:102-174` (price inputs write to viewed tarif or recipe, `menus.js:252-264`; retirer; + Ajouter des recettes → existing `ajouterFiches` modal — **also a stacked modal, same problem as compare**).
4. **Tarifications tab**: the tarif rows + actions carried from `menus.js:178-210` and bindings `menus.js:290-346` (activer/régler/dupliquer/renommer/supprimer/comparer).
5. **Footer**: Rétablir (fields + composition only — named deviation 6) · Supprimer la carte · Fermer.

- [ ] **Step 1: Modal stacking.** `openModal` overwrites `modal-root` — the carte modal would be destroyed by `ajouterFiches`/`renommer`/`comparer`/optimiser. Fix in `ui.js`, minimal: `openModal(html, { width, stack })` — when `stack: true`, append a second `.scrim` to `modal-root` instead of replacing `innerHTML`, and `closeModal()` removes only the **last** scrim (`root().lastElementChild.remove()`), restoring `onEscape` to close-the-top (keep a small stack array of escape handlers). Extend `ui.js` `demo()`-style check by hand-testing; keep the change ≤ 30 lines. All existing single-modal callers behave identically (no `stack` flag → replace, as today).

- [ ] **Step 2: Implement `cartemodal.js`** with the structure above, live-patch + `recharge()` (refetch `/api/menus`, re-find the carte, repaint keeping `onglet` and viewed-tarif selection). Snapshot `avant = { nom, cocktail_ids }`; Rétablir → `PATCH /api/menus/:id` with both.

- [ ] **Step 3: Tabs CSS:**

```css
.modal-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--line); }
.modal-tabs button { padding: 11px 18px; background: transparent; border: none;
  border-bottom: 2px solid transparent; color: var(--mut2); font-family: var(--mono);
  font-size: 11px; letter-spacing: .1em; text-transform: uppercase; cursor: pointer; }
.modal-tabs button.active { color: var(--ink); border-bottom-color: var(--ac); }
```

- [ ] **Step 4: Verify** (Playwright): open carte → composition tab with active tarif prices; switch viewed tarif → prices/KPIs change; tarif tab → duplicate → new tarif appears; compare opens **on top** and closes back to the carte modal; Rétablir restores name + composition.

- [ ] **Step 5: Commit** — `feat(cartes): modale carte à deux onglets (composition, tarifications)`

### Task 11: Cartes screen (table + blocks)

**Files:**
- Modify: `static/js/screens/menus.js` (full rewrite, small)

- [ ] **Step 1: Rewrite.** Bar (`screen: 'menus'`, sort `[['nom','Nom'],['n','Recettes'],['marge_moyenne','Marge moyenne'],['prix_moyen','Prix moyen']]`, no `groupLabel` (a handful of cartes — grouping earns nothing; `groupLabel: null` hides the toggle), action `+ Nouvelle carte` solid). Rows = `data.menus` with accessors reading `m.kpis`. Table columns: Carte (nom + "N recettes" sub) · Prix moyen · Marge moyenne (tone vs `pr.cible`) · Écart (`eur(kpis.ecart)`, sub `mini–maxi`) · Sous plancher (count, warn tone) · actions (× delete, confirm copy `menus.js:369-372`). Blocks: subtitle = recipe names (`m.cocktails.map(c => c.nom).join(', ')` — check the list payload includes `cocktails`; it does, `menus.js:107`), KPIs Prix moyen · Marge moyenne · `Min/Max`. Click → `openCarte`. `new` → `POST /api/menus {nom:'Nouvelle carte'}` → `openCarte(r.id, …)`.

- [ ] **Step 2: Verify + `check_js.sh`.**

- [ ] **Step 3: Commit** — `feat(cartes): écran table + blocs sur le squelette commun`

---

## Phase 5 — Inventaire & Cave (table-only)

### Task 12: Inventaire on the shared bar

**Files:**
- Modify: `static/js/screens/inventory.js`

- [ ] **Step 1:** Keep everything session-related (lieu gate, `sessions`, repaintRow, sticky summary card). Add the bar above the table: `screen: 'inv'`, `views: false`, `groupLabel: 'Grouper par catégorie'`, no actions, search filters `refs` by `nom`/`marque` before render (a hidden-by-search row keeps its session entry — the summary card already counts from `session`, not from visible rows, so partial counting is unaffected). Pass `group` into the row rendering: partition sorted refs and emit `.tgroup` headers (this screen renders rows by hand, `inventory.js:56-77` — reuse the same `.tgroup` markup and `barState('inv').collapsed`; collapsed groups skip their rows). Uniform row/hover styling comes free from `.trow`.

- [ ] **Step 2: Verify** (Playwright): search narrows, grouping collapses, counting + clôture still works end to end (count 2 refs, clôturer, confirm movement applied).

- [ ] **Step 3: Commit** — `feat(inventaire): barre commune, recherche et groupes par catégorie`

### Task 13: Cave on the shared bar; import becomes a modal

**Files:**
- Modify: `static/js/screens/cave.js`

- [ ] **Step 1:** Kill the right column (`cave.js:170-187`). Tables take full width. Bar: `screen: 'cave'`, `views: false`, `groupLabel: 'Grouper par catégorie'` (applies to the suivies table; garnitures keep flat), `actions: [{key:'import', label:'Importer un fichier'},{key:'garniture', label:'+ Garniture'}]`, search filters both tables (nom/marque/fournisseur). `import` action → modal (reuse the exact pattern `refs.js:204-212`) whose body = `mountImportCard` **plus** the historique block (`cave.js:176-186` markup moved inside the modal, under the card). `garniture` → `openRefModal({ suivi: false })` (creation — allowed per deviation 7). Row `data-edit` crayon → `openFiche`. Add `group` to `suiviesSpec`.

- [ ] **Step 2: Verify** (Playwright): both tables full-width, import modal shows dropzone + history, seuil/cible steppers and achat/marge inline edits still blur-patch, group/collapse works.

- [ ] **Step 3: Commit** — `feat(cave): barre commune, import en modale avec historique`

---

## Phase 6 — Paramètres

### Task 14: merge Barème + Configuration into one `params` screen, draft-and-apply

**Files:**
- Create: `static/js/screens/params.js`
- Delete: `static/js/screens/bareme.js`, `static/js/screens/config.js` (content lifted into panes)
- Modify: `static/js/app.js` (NAV/TITLES/SCREENS: one entry `params` "Paramètres" replaces `bareme` + `config`; redirect old hashes), `static/js/palette.js:19-20` (one `['params', 'Paramètres']` entry), `static/js/tour.js` (rename `bareme`/`config` keys to `params` or drop), `static/css/app.css`

**Interfaces:**
- Produces: hash `#/params` (and `#/params/<pane>`); old `#/bareme` → `#/params/bareme`, `#/config` → `#/params`.

Layout: left sub-nav (mono-label buttons) + one pane at a time. Panes, lifted as-is from the two old screens:
1. **Politique de prix** (`config.js` pricing panel) + **Affichage**: the new field — `Décimales des pourcentages` `<select>` 0/1/2 (saves into `pricing.pct_decimales` — the existing `PATCH /api/settings {pricing:{…}}` merges it; zero backend change; on apply also call `setPctDecimales`).
2. **Catégories** (`config.js` categories table — keeps its settings-form rendering, not the shared table language, per CR §8).
3. **Barème fiscal** (`bareme.js` rates panel + effet-sur-la-dose panel; the effet panel refreshes only after apply — stale-during-draft is accepted and noted in a comment).
4. **Référentiels** (`config.js` lists).
5. **Sauvegardes / Export** (`config.js` backups + export section — these are *actions*, not settings: they stay immediate, outside the draft).

Draft-and-apply: panes 1–4 write into a `draft` object instead of PATCHing on blur. A sticky bar appears when `draft` is non-empty:

```js
// le brouillon : { pricing: {...}, rates: {...}, lists: {...}, categories: Map<id, patch> }
// barre collante : « Modifications non enregistrées — Enregistrer / Abandonner »
```

`Enregistrer` → one `PATCH /api/settings` (pricing+rates+lists merged) + one `PATCH` per touched category (existing per-category endpoint — check its path in `api_admin.py`, the config screen's current bindings name it) → `reloadMeta()` → clear draft → re-render. `Abandonner` → drop draft, re-render from `S.meta`. Navigating away with a dirty draft → `confirmModal({ title: 'Quitter sans enregistrer ?', … })` — hook it in `params.js` via `hashchange`? No: simplest is the sub-nav only (pane switches keep the draft — it's one screen); leaving the screen entirely drops the draft silently is NOT acceptable per CR — so intercept in `route()`? Keep it lean: register a `window.confirmLeave` callback? **Decision:** export from `params.js` a `hasDraft()`; in `app.js` `route()`, before switching away from `params` with a dirty draft, `confirmModal` and on refusal restore `location.hash = '#/params'`. ~6 lines in `route()`.

- [ ] **Step 1: Build `params.js`** with the pane registry, sub-nav, draft store, sticky bar, and the lifted pane renderers (copy the rendering code from `config.js`/`bareme.js`, change bindings from PATCH-on-blur to draft-write; backups/export bindings unchanged).

- [ ] **Step 2: Rewire app.js/palette/tour** as listed; delete the two old screen files once `grep -rn "bareme\|screens/config" static/js` is clean.

- [ ] **Step 3: CSS** for the sub-nav + sticky bar:

```css
.params-nav button { display: block; width: 100%; text-align: left; padding: 10px 14px;
  background: transparent; border: none; border-left: 2px solid transparent;
  color: var(--mut); font-family: var(--sans); font-size: 13px; cursor: pointer; }
.params-nav button.active { color: var(--ink); border-left-color: var(--ac); background: var(--panel2); }
.draft-bar { position: sticky; top: 74px; z-index: 6; display: flex; align-items: center;
  justify-content: space-between; gap: 12px; padding: 11px 16px; margin-bottom: 14px;
  background: var(--panel2); border: 1px solid var(--ac); }
```

- [ ] **Step 4: Verify** (Playwright): edit marge cible → sticky bar appears → Abandonner → value back; edit again → Enregistrer → `/api/state` reflects it; decimals setting → a margin elsewhere renders `72,5 %`; old `#/bareme` hash lands on the barème pane; leaving with a dirty draft prompts.

- [ ] **Step 5: Run backend suite** — `uv run pytest` (should be untouched-green) and `uv run ruff check .`.

- [ ] **Step 6: Commit** — `feat(parametres): écran unique barème + configuration, brouillon et appliquer`

---

## Final task: sweep, tour copy, PR

- [ ] `grep -rn "chip-sort\|sortHeader\|F.query\|__untracked" static/js` — dead code from the rewrites deleted (`sortable.js`'s `sortHeader`/`sortState` may lose all callers → delete them and their exports; `applySort`/`bindSort` stay).
- [ ] Update `tour.js` sections whose targets died (recettes/cartes sections point at the old workbench selectors) — retarget to the new bar/blocks/modal or trim.
- [ ] Update `whatsnew.js` entry for the release (house ritual).
- [ ] `bash scripts/check_js.sh` + `uv run pytest` + full Playwright pass over all 7 screens, both views where applicable.
- [ ] PR `feat/refonte-ui` → `main` with before/after screenshots.

## Self-review notes

- CR §2 view-per-screen ✔ (Task 3), §3 skeleton/dictionary ✔ (Tasks 2/3 + per-screen columns), §4 blocks ✔ (Task 4 + per-screen KPIs), §5 shared state ✔ (Task 3; filter cut by decision), §6 modal ✔ (Tasks 6/8/10; save model per review), §7 parity ✔ (inline/mass edit stay table-only), §8 settings ✔ (Task 14), §9 exclusions ✔ (dash untouched).
- Field dictionary: money `eur`, % `pc` (Task 1), status badges (`chip-low`, `ok-text/warn-text`) already uniform; date = `created_at.slice(0,10)` everywhere (existing).
- Type consistency: `barState` shape used identically in Tasks 7/9/11/12/13; `openFiche/openRecette/openCarte` all `(id, { onClose })`.
