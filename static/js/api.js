// Enrobage fetch : JSON, erreurs visibles, bannière de reconnexion.

const banner = () => document.getElementById('banner');

function showBanner(msg) {
  banner().textContent = msg;
  banner().hidden = false;
}

export function hideBanner() {
  banner().hidden = true;
}

export async function apiGet(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    hideBanner();
    return await r.json();
  } catch (e) {
    showBanner('Connexion au service perdue — rechargez la page dans un instant.');
    throw e;
  }
}

export async function apiSend(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    let detail = `erreur ${r.status}`;
    try { detail = (await r.json()).detail || detail; } catch { /* corps non JSON */ }
    throw new Error(detail);
  }
  hideBanner();
  return r.json();
}
