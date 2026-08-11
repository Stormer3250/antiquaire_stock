// Tri de tables : état, en-tête cliquable, comparateur. Aucune dépendance au DOM
// pour la partie calcul, ce qui la rend vérifiable en ligne de commande (voir demo()).

export function sortState(key, dir = 'asc') {
  return { key, dir };
}

// Les valeurs absentes tombent toujours en fin de liste, quel que soit le sens :
// une colonne vide n'est pas « la plus petite », elle n'a pas de valeur.
function compare(a, b) {
  const va = a === undefined ? null : a;
  const vb = b === undefined ? null : b;
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  if (typeof va === 'boolean' || typeof vb === 'boolean') return (va ? 1 : 0) - (vb ? 1 : 0);
  return String(va).localeCompare(String(vb), 'fr', { numeric: true, sensitivity: 'base' });
}

export function applySort(rows, state, accessors = {}) {
  if (!state || !state.key) return rows;
  const value = accessors[state.key] || ((r) => r[state.key]);
  const sign = state.dir === 'desc' ? -1 : 1;
  return [...rows].sort((x, y) => {
    const a = value(x);
    const b = value(y);
    // le signe ne s'applique pas aux absents : ils restent en bas
    if (a === null || a === undefined || b === null || b === undefined) return compare(a, b);
    return sign * compare(a, b);
  });
}

// Cellule d'en-tête cliquable. `align` vaut '' ou 'r' comme dans le reste des tables.
export function sortHeader(label, key, state, { align = '' } = {}) {
  const active = state.key === key;
  const arrow = active ? (state.dir === 'asc' ? '↑' : '↓') : '';
  return `<div class="th-sort ${align} ${active ? 'active' : ''}" data-sort="${key}"
    role="button" tabindex="0" aria-label="Trier par ${label}">${label}<span
    class="th-arrow">${arrow}</span></div>`;
}

export function bindSort(el, state, rerender) {
  el.querySelectorAll('[data-sort]').forEach((h) => {
    const go = () => {
      const key = h.dataset.sort;
      if (state.key === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.key = key; state.dir = 'asc'; }
      rerender();
    };
    h.addEventListener('click', go);
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

// ---------- auto-vérification : `node static/js/sortable.js` ----------

function demo() {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const rows = [
    { nom: 'Zeste', prix: 3 },
    { nom: 'Éclair', prix: 1 },
    { nom: 'amer', prix: null },
    { nom: 'Bière', prix: 2 },
  ];
  const noms = (s) => applySort(rows, s).map((r) => r.nom);

  assert(
    JSON.stringify(noms(sortState('nom'))) === JSON.stringify(['amer', 'Bière', 'Éclair', 'Zeste']),
    'tri alphabétique français : accents et casse ignorés'
  );
  assert(
    JSON.stringify(noms(sortState('nom', 'desc'))) === JSON.stringify(['Zeste', 'Éclair', 'Bière', 'amer']),
    'sens inverse'
  );
  assert(
    JSON.stringify(applySort(rows, sortState('prix')).map((r) => r.prix)) === JSON.stringify([1, 2, 3, null]),
    'valeurs manquantes en fin de liste, ordre croissant'
  );
  assert(
    JSON.stringify(applySort(rows, sortState('prix', 'desc')).map((r) => r.prix)) === JSON.stringify([3, 2, 1, null]),
    'valeurs manquantes en fin de liste, ordre décroissant aussi'
  );
  assert(
    applySort(rows, sortState('cout'), {
      cout: (r) => (r.prix === null ? null : r.prix * 2),
    })[0].prix === 1,
    'accesseur calculé'
  );
  assert(applySort(rows, null)[0].nom === 'Zeste', 'sans état, rien ne bouge');
}

if (typeof process !== 'undefined' && /sortable\.m?js$/.test(process.argv?.[1] || '')) demo();
