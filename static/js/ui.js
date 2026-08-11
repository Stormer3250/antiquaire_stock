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

import { claim, release } from './overlay.js';

const root = () => document.getElementById('modal-root');

// Échap ferme la surface du dessus. Chaque ouvreur dit ici comment il veut être fermé :
// une modale ordinaire disparaît, une confirmation doit en plus répondre « non ».
let onEscape = null;
// le garde-fou permet d'importer ce module hors navigateur (auto-vérifications)
if (typeof document !== 'undefined') document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !onEscape) return;
  // une liste déroulante ouverte se ferme d'abord : Échap vise toujours la surface
  // la plus intérieure, jamais la fenêtre qui la contient
  if (document.querySelector('.cc-sel-panel')) return;
  e.preventDefault();
  const fn = onEscape;
  onEscape = null;
  fn();
}, true);

// Pour les surfaces qui écrivent elles-mêmes dans modal-root (la palette).
export function setEscape(fn) {
  onEscape = fn;
}

export function closeModal() {
  root().innerHTML = '';
  onEscape = null;
  release('modal');
}

export function openModal(html, { width } = {}) {
  claim('modal');
  onEscape = closeModal;
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
    claim('modal');
    onEscape = () => done(false);   // Échap sur une confirmation vaut « non »
    scrim.querySelector('[data-no]').addEventListener('click', () => done(false));
    scrim.querySelector('[data-yes]').addEventListener('click', () => done(true));
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) done(false); });
    // le focus part sur Annuler : Entrée par réflexe ne détruit rien
    scrim.querySelector('[data-no]').focus();
  });
}

export function alertModal({ title, body = '' }) {
  return new Promise((resolve) => {
    root().innerHTML = `
      <div class="scrim"><div class="modal confirm">
        <div style="padding:22px 24px 16px; display:flex; flex-direction:column; gap:9px;">
          <div class="serif-title" style="font-size:20px;">${esc(title)}</div>
          ${body ? `<div style="font-size:13px; color:var(--mut);" class="pretty">${esc(body)}</div>` : ''}
        </div>
        <div style="display:flex; justify-content:flex-end; padding:14px 24px; border-top:1px solid var(--line);">
          <button class="btn-solid" data-ok>Compris</button>
        </div>
      </div></div>`;
    const scrim = root().firstElementChild;
    const done = () => { closeModal(); resolve(); };
    claim('modal');
    onEscape = done;
    scrim.querySelector('[data-ok]').addEventListener('click', done);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) done(); });
    scrim.querySelector('[data-ok]').focus();
  });
}
