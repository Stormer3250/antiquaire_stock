// Sélecteurs maison : le <select> natif reste dans le DOM, masqué, et garde le rôle de
// source de vérité. Toutes les liaisons existantes (.value, l'événement « change »)
// continuent donc de fonctionner sans être touchées : on ne fait que poser une commande
// habillée par-dessus, avec une recherche dès qu'il y a beaucoup de choix.

const SEARCH_FROM = 10;   // au-delà de dix options, un champ de recherche apparaît

export function normalise(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function optionsOf(sel) {
  return [...sel.options].map((o, i) => ({ i, label: o.textContent, value: o.value }));
}

function upgrade(sel) {
  if (sel.dataset.ccSel) return;
  sel.dataset.ccSel = '1';

  const wrap = document.createElement('div');
  wrap.className = 'cc-sel';
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add('cc-sel-native');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cc-sel-trigger input';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  wrap.appendChild(trigger);

  let panel = null;
  let cursor = 0;

  const label = () => sel.options[sel.selectedIndex]?.textContent ?? '';
  const paintTrigger = () => {
    trigger.innerHTML = `<span class="cc-sel-label"></span><span class="cc-sel-caret">▾</span>`;
    trigger.firstElementChild.textContent = label();
    trigger.disabled = sel.disabled;
  };
  paintTrigger();

  function close() {
    if (!panel) return;
    panel.remove();
    panel = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onOutside, true);
  }

  function onOutside(e) {
    if (!wrap.contains(e.target)) close();
  }

  function choose(index) {
    sel.selectedIndex = index;
    paintTrigger();
    close();
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    trigger.focus();
  }

  function paintList(filter = '') {
    const list = panel.querySelector('.cc-sel-list');
    const q = normalise(filter);
    const shown = optionsOf(sel).filter((o) => !q || normalise(o.label).includes(q));
    if (cursor >= shown.length) cursor = Math.max(0, shown.length - 1);
    list.innerHTML = shown.length
      ? shown.map((o, k) => `<div class="cc-sel-opt ${k === cursor ? 'on' : ''}
          ${o.i === sel.selectedIndex ? 'sel' : ''}" role="option" data-i="${o.i}"></div>`).join('')
      : `<div class="cc-sel-empty">Aucun choix ne correspond.</div>`;
    // textContent plutôt qu'interpolation : une option peut contenir n'importe quoi
    [...list.querySelectorAll('.cc-sel-opt')].forEach((n, k) => {
      n.textContent = shown[k].label;
    });
    list.querySelectorAll('.cc-sel-opt').forEach((n) =>
      n.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(Number(n.dataset.i));
      })
    );
    return shown;
  }

  function open() {
    if (panel || sel.disabled) return;
    cursor = Math.max(0, sel.selectedIndex);
    panel = document.createElement('div');
    panel.className = 'cc-sel-panel';
    panel.setAttribute('role', 'listbox');
    const many = sel.options.length > SEARCH_FROM;
    panel.innerHTML = `
      ${many ? '<input class="cc-sel-search input" placeholder="Chercher…" aria-label="Chercher">' : ''}
      <div class="cc-sel-list"></div>`;
    wrap.appendChild(panel);
    trigger.setAttribute('aria-expanded', 'true');
    let shown = paintList();

    const move = (d) => {
      cursor = Math.min(Math.max(cursor + d, 0), shown.length - 1);
      shown = paintList(search ? search.value : '');
      panel.querySelector('.cc-sel-opt.on')?.scrollIntoView({ block: 'nearest' });
    };

    const search = panel.querySelector('.cc-sel-search');
    if (search) {
      search.addEventListener('input', () => { cursor = 0; shown = paintList(search.value); });
      search.focus();
    }
    panel.addEventListener('keydown', keys);
    trigger.addEventListener('keydown', keys);
    document.addEventListener('mousedown', onOutside, true);

    function keys(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (shown[cursor]) choose(shown[cursor].i);
      } else if (e.key === 'Escape') { e.preventDefault(); close(); trigger.focus(); }
    }
  }

  trigger.addEventListener('click', () => (panel ? close() : open()));
  trigger.addEventListener('keydown', (e) => {
    if (!panel && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open();
    }
  });
  // si du code met à jour le select directement, la commande suit
  sel.addEventListener('change', paintTrigger);
}

export function upgradeSelects(root = document) {
  root.querySelectorAll('select.input:not([data-cc-sel])').forEach(upgrade);
}

// Les écrans réécrivent leur innerHTML depuis une douzaine d'endroits : un observateur
// global évite d'oublier un appel quelque part.
// ponytail: observateur sur tout le body, largement suffisant à cette échelle ;
// passer à un appel par écran si le DOM devient gros.
export function installSelectUpgrader() {
  upgradeSelects();
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;          // une seule passe par frame, pas une par mutation
    pending = true;
    requestAnimationFrame(() => { pending = false; upgradeSelects(); });
  }).observe(document.body, { childList: true, subtree: true });
}
