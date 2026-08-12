// Mise en lumière : allumer une ou plusieurs zones, éteindre le reste.
//
// La découpe est portée PAR L'ÉLÉMENT ÉCLAIRÉ (une ombre portée démesurée qui noircit
// tout le pourtour), et non par un cadre flottant posé par-dessus. Deux ennuis
// disparaissent d'eux-mêmes : la zone épouse la bordure au pixel près, et elle suit le
// défilement sans une ligne de code.
//
// Utilisable par n'importe quelle fonction, pas seulement la visite guidée :
//   allumer('[data-section="seuils"]')            // une section nommée
//   allumer(['.kpi'])                             // les quatre blocs d'un coup
//   eteindre()

const CLASSE = 'cc-lit';
let allumes = [];

// Un sélecteur peut désigner plusieurs éléments : on les allume tous, sinon
// « éclaire les quatre repères » n'en éclaire qu'un.
function resoudre(cible) {
  const sels = Array.isArray(cible) ? cible : [cible];
  const out = [];
  for (const sel of sels) {
    if (sel instanceof Element) out.push(sel);
    else document.querySelectorAll(sel).forEach((n) => out.push(n));
  }
  return out;
}

export function allumer(cible) {
  eteindre();
  allumes = resoudre(cible);
  if (!allumes.length) return [];
  document.body.classList.add('cc-dim');
  allumes.forEach((n) => n.classList.add(CLASSE));
  // plusieurs zones éclairées : seule la première porte la découpe, les suivantes se
  // contentent de passer au-dessus du voile, sinon les ombres s'additionnent
  allumes.slice(1).forEach((n) => n.classList.add('cc-lit-secondaire'));
  return allumes;
}

export function eteindre() {
  allumes.forEach((n) => n.classList.remove(CLASSE, 'cc-lit-secondaire'));
  allumes = [];
  document.body.classList.remove('cc-dim');
}

export function estAllume() {
  return allumes.length > 0;
}

// Amène la zone dans le champ de vision et attend que le défilement soit VRAIMENT
// terminé. C'est ce qui manquait à la visite guidée : elle mesurait la cible pendant
// que la page défilait encore, et dessinait le cadre à l'ancienne place.
export function amener(el) {
  return new Promise((resolve) => {
    const r = el.getBoundingClientRect();
    const dedans = r.top >= 60 && r.bottom <= window.innerHeight - 40;
    if (dedans) { resolve(); return; }
    // C'est `#screen` (`.screen { overflow: auto }`) qui défile réellement, pas la
    // fenêtre : scrollIntoView() agit dessus, donc c'est son scrollTop qu'il faut
    // surveiller pour savoir quand le défilement est fini.
    const conteneur = el.closest('.screen') || document.scrollingElement;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    let dernier = null;
    let stables = 0;
    const tic = () => {
      const y = conteneur.scrollTop;
      stables = y === dernier ? stables + 1 : 0;
      dernier = y;
      if (stables >= 3) resolve();          // trois frames sans bouger : c'est fini
      else requestAnimationFrame(tic);
    };
    requestAnimationFrame(tic);
    setTimeout(resolve, 900);               // filet : un défilement bloqué ne fige rien
  });
}
