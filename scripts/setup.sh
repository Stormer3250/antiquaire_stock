#!/bin/bash
# L'Antiquaire — installation / mise à jour sur le Mac. Idempotent :
# le lancer après chaque `git pull` suffit. Réservé au mainteneur.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HOME/AntiquaireStock"
PLIST_DST="$HOME/Library/LaunchAgents/com.antiquaire.stock.plist"
PORT=8765

echo "── L'Antiquaire · installation depuis $REPO"

# 1. uv (gestionnaire Python) — installé si absent
if ! command -v uv >/dev/null 2>&1; then
  echo "→ installation de uv…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
UV="$(command -v uv)"
echo "→ uv : $UV"

# 2. environnement Python verrouillé
(cd "$REPO" && "$UV" sync)

# 3. dossiers de données (visibles, ramassés par Time Machine)
mkdir -p "$DATA/backups" "$DATA/exports" "$DATA/logs"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "⚠ pas macOS : installation launchd/webloc sautée (mode test)."
  exit 0
fi

# 4. service launchd : démarre au login, redémarre en cas de crash
sed -e "s|__UV__|$UV|g" -e "s|__REPO__|$REPO|g" -e "s|__DATA__|$DATA|g" \
  "$REPO/scripts/com.antiquaire.stock.plist.tmpl" > "$PLIST_DST"
launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl kickstart -k "gui/$(id -u)/com.antiquaire.stock"

# 5. raccourci sur le Bureau pour le personnel
cat > "$HOME/Desktop/L'Antiquaire.webloc" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict><key>URL</key><string>http://127.0.0.1:$PORT</string></dict>
</plist>
EOF

# 6. vérification : le service répond
echo -n "→ démarrage"
for _ in $(seq 1 30); do
  if curl -s "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then
    echo " ✓"
    echo "── Prêt : http://127.0.0.1:$PORT (raccourci « L'Antiquaire » sur le Bureau)"
    echo "   Données : $DATA · Sauvegardes automatiques chaque nuit."
    exit 0
  fi
  echo -n "."
  sleep 1
done
echo
echo "✗ le service ne répond pas — voir $DATA/logs/antiquaire-error.log"
exit 1
