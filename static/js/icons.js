// Icônes de l'interface, en SVG au trait, écrites à la main.
// Aucune police d'icônes à charger : l'appliance ne doit dépendre d'aucun réseau, et
// dix traits pèsent moins qu'un fichier de police.

const TRAITS = {
  // comptoir : un verre posé
  comptoir: '<path d="M5 4h14l-1.5 7a4 4 0 0 1-4 3h-3a4 4 0 0 1-4-3L5 4Z"/><path d="M12 14v6"/><path d="M8 20h8"/>',
  // références : une bouteille
  references: '<path d="M10 2h4v4l2.5 4a4 4 0 0 1 .5 2v8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-8a4 4 0 0 1 .5-2L10 6V2Z"/><path d="M7.5 13h9"/>',
  // inventaire : une planche à pince
  inventaire: '<path d="M9 3h6v3H9z"/><path d="M15 4.5h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2"/><path d="M8.5 12.5l2 2 4-4.5"/>',
  // recettes : un verre à cocktail
  recettes: '<path d="M4 4h16l-8 8-8-8Z"/><path d="M12 12v7"/><path d="M8 19h8"/><path d="M17 6l3-2"/>',
  // cartes : un carnet ouvert
  cartes: '<path d="M3 5h6a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2H3V5Z"/><path d="M21 5h-6a3 3 0 0 0-3 3v11a2.5 2.5 0 0 1 2.5-2H21V5Z"/>',
  // cave : des caisses
  cave: '<path d="M3 8h8v6H3zM13 8h8v6h-8zM8 15h8v6H8z"/>',
  // barème : une balance
  bareme: '<path d="M12 3v18"/><path d="M6 7h12"/><path d="M6 7l-3 6h6l-3-6Z"/><path d="M18 7l-3 6h6l-3-6Z"/><path d="M8 21h8"/>',
  // configuration : des curseurs
  config: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  // crayon : éditer
  crayon: '<path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="M14.5 5.5l4 4"/>',
  // épingle : garder la barre ouverte
  epingle: '<path d="M12 3v9"/><path d="M8 12h8l2 4H6l2-4Z"/><path d="M12 16v5"/>',
  // chevrons : replier / déplier
  chevrons: '<path d="M13 6l6 6-6 6"/><path d="M5 6l6 6-6 6"/>',
};

export function icone(nom, taille = 18) {
  const d = TRAITS[nom];
  if (!d) return '';
  return `<svg class="ic" width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${d}</svg>`;
}
