// Export .xlsx de ce qui est affiché : l'écran envoie ses colonnes et ses lignes,
// tri, filtre et sélection déjà appliqués. Ce qu'on voit est ce qu'on obtient.

import { alertModal } from './ui.js';

export async function exporter({ titre, fichier, colonnes, lignes }) {
  if (!lignes.length) {
    await alertModal({ title: 'Rien à exporter', body: 'Le tableau affiché est vide.' });
    return;
  }
  const r = await fetch('/api/export.xlsx', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ titre, fichier, colonnes, lignes }),
  });
  if (!r.ok) {
    await alertModal({ title: 'Export impossible', body: `Le serveur a répondu ${r.status}.` });
    return;
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fichier}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
