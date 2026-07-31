// Aides d'interface : formats fr-FR, échappement, modales.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function eur(n, d = 2) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €';
}

export function num(n, d) {
  const v = Number.isFinite(n) ? n : 0;
  return v.toLocaleString('fr-FR', {
    minimumFractionDigits: d ?? 0,
    maximumFractionDigits: d === undefined ? 1 : d,
  });
}

export function pc(n, d = 0) {
  return num(n, d) + ' %';
}

export function parseNum(v) {
  const n = parseFloat(String(v).replace(',', '.').replace(/\s/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

// ---------- modales ----------

const root = () => document.getElementById('modal-root');

export function closeModal() {
  root().innerHTML = '';
}

export function openModal(html, { width } = {}) {
  root().innerHTML = `<div class="scrim"><div class="modal"${width ? ` style="width:${width}px"` : ''}>${html}</div></div>`;
  const scrim = root().firstElementChild;
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeModal(); });
  const x = scrim.querySelector('.modal-x');
  if (x) x.addEventListener('click', closeModal);
  const first = scrim.querySelector('input, select, textarea');
  if (first) first.focus();
  return scrim.querySelector('.modal');
}

export function confirmModal({ title, body, label = 'Supprimer' }) {
  return new Promise((resolve) => {
    root().innerHTML = `
      <div class="scrim"><div class="modal confirm">
        <div style="padding:22px 24px 16px; display:flex; flex-direction:column; gap:9px;">
          <div class="serif-title" style="font-size:20px;">${esc(title)}</div>
          <div style="font-size:13px; color:var(--mut);" class="pretty">${esc(body)}</div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:9px; padding:14px 24px; border-top:1px solid var(--line);">
          <button class="btn muted" data-no>Annuler</button>
          <button class="btn-solid danger" data-yes>${esc(label)}</button>
        </div>
      </div></div>`;
    const scrim = root().firstElementChild;
    const done = (v) => { closeModal(); resolve(v); };
    scrim.querySelector('[data-no]').addEventListener('click', () => done(false));
    scrim.querySelector('[data-yes]').addEventListener('click', () => done(true));
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) done(false); });
    // le focus part sur Annuler : Entrée par réflexe ne détruit rien
    scrim.querySelector('[data-no]').focus();
  });
}
