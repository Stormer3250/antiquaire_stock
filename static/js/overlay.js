// Un seul propriétaire de l'attention à la fois.
//
// L'application a quatre surfaces qui prennent l'écran : les modales, la palette ⌘K,
// la visite guidée et « Quoi de neuf ». Sans arbitre, deux d'entre elles peuvent
// s'ouvrir l'une sur l'autre (c'est arrivé au premier lancement). Ce module est cet
// arbitre, et il est le SEUL endroit où la règle est écrite.
//
// Deux catégories :
//   - demandée par l'utilisateur (un clic, une touche) : prioritaire, s'affiche tout
//     de suite et remplace ce qui était là, puisque c'est ce qui vient d'être demandé ;
//   - automatique (« Quoi de neuf », visite proposée) : ne coupe jamais la parole,
//     attend son tour, et une seule du même nom peut patienter.

let current = null;
const waiting = new Map();   // nom -> fonction de démarrage

export function busy() {
  return current !== null;
}

// Surface demandée par l'utilisateur : elle prend la main immédiatement.
export function claim(name) {
  current = name;
}

export function release(name) {
  if (current !== name) return;   // une autre surface a pris la main entre-temps
  current = null;
  const [nom, start] = waiting.entries().next().value || [];
  if (nom) {
    waiting.delete(nom);
    start();
  }
}

// Surface automatique : lancée seulement si l'écran est libre, sinon mise en attente.
export function auto(name, start) {
  const run = () => {
    claim(name);
    start();
  };
  if (busy()) waiting.set(name, run);   // une seule en attente par nom
  else run();
}

export function cancelAuto(name) {
  waiting.delete(name);
}
