// Vue en blocs : cartes de hauteur fixe, grille fluide, mêmes groupes que la table.

import { esc } from './ui.js';
import { applySort } from './sortable.js';

export function blocHtml(r, spec) {
  return `
  <button class="bloc" data-bloc="${r.id}">
    <div class="bloc-nom">${esc(spec.name(r))}</div>
    <div class="bloc-sub">${esc(spec.subtitle(r) || '')}</div>
    <div class="bloc-kpis">
      ${spec.kpis.map((k) => `
      <div class="bloc-kpi">
        <div class="mono-label">${esc(k.label)}</div>
        <div class="kpi-val ${k.tone ? k.tone(r) : ''}">${esc(k.value(r))}</div>
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

// ---------- auto-vérification : `node static/js/blocks.js` ----------

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

if (typeof process !== 'undefined' && /blocks\.m?js$/.test(process.argv?.[1] || '')) demo();
