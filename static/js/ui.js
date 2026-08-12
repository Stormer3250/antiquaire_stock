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

let PCT_D = 0;               // décimales des pourcentages, réglées dans Paramètres

export function setPctDecimales(d) {
  PCT_D = Number.isInteger(d) && d >= 0 && d <= 2 ? d : 0;
}

export function pc(n, d) {
  return num(n, d === undefined ? PCT_D : d) + ' %';
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
// Les modales peuvent s'empiler (`openModal(html, { stack: true })`) : d'où une pile de
// gestionnaires, dont le dernier est toujours la surface visible du dessus.
let escapes = [];
// le garde-fou permet d'importer ce module hors navigateur (auto-vérifications)
if (typeof document !== 'undefined') document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !escapes.length) return;
  // une liste déroulante ouverte se ferme d'abord : Échap vise toujours la surface
  // la plus intérieure, jamais la fenêtre qui la contient
  if (document.querySelector('.cc-sel-panel')) return;
  e.preventDefault();
  // on ne dépile PAS ici : c'est `closeModal` qui dépile, et tout gestionnaire finit par
  // lui (la palette, les confirmations comprises). Dépiler des deux côtés retirerait le
  // gestionnaire de la surface du dessous, qu'Échap ne fermerait plus.
  escapes[escapes.length - 1]();
}, true);

// Pour les surfaces qui écrivent elles-mêmes dans modal-root (la palette, les
// confirmations) : elles remplacent tout ce qui était ouvert, la pile comprise.
export function setEscape(fn) {
  escapes = fn ? [fn] : [];
}

export function closeModal() {
  const r = root();
  escapes.pop();
  // pile : on ne retire que la surface du dessus, celle du dessous reste en place
  if (r.childElementCount > 1) { r.lastElementChild.remove(); return; }
  r.innerHTML = '';
  release('modal');
}

export function openModal(html, { width, stack } = {}) {
  claim('modal');
  const surface = `<div class="scrim"><div class="modal"${width ? ` style="width:${width}px"` : ''}>${html}</div></div>`;
  if (stack) { root().insertAdjacentHTML('beforeend', surface); escapes.push(closeModal); }
  else { root().innerHTML = surface; escapes = [closeModal]; }
  const scrim = root().lastElementChild;
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeModal(); });
  const x = scrim.querySelector('.modal-x');
  if (x) x.addEventListener('click', closeModal);
  const first = scrim.querySelector('input, select, textarea');
  if (first) first.focus();
  return scrim.querySelector('.modal');
}

// Confirmations et alertes restent DESTRUCTRICES : elles écrivent tout modal-root et
// balaient donc la pile. C'est le contrat en place partout (fiche.js, recettemodal.js) —
// on pose `dialogue = true`, et on rouvre sa propre modale après. Les empiler aussi
// obligerait à défaire ce réflexe dans chaque appelant, pour un gain nul : une question
// bloquante n'a rien à laisser visible derrière elle.
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
    setEscape(() => done(false));   // Échap sur une confirmation vaut « non »
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
    setEscape(done);
    scrim.querySelector('[data-ok]').addEventListener('click', done);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) done(); });
    scrim.querySelector('[data-ok]').focus();
  });
}

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

if (typeof process !== 'undefined' && /ui\.m?js$/.test(process.argv?.[1] || '')) demo();
