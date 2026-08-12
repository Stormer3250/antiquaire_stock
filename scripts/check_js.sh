#!/usr/bin/env bash
# Contrôle des modules front : syntaxe de chaque fichier, puis les auto-vérifications
# embarquées. L'arborescence est recopiée telle quelle avec un package.json « module »,
# pour que les imports relatifs se résolvent comme dans le navigateur.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp -r static/js "$tmp/js"
echo '{"type":"module"}' > "$tmp/package.json"

count=0
while IFS= read -r f; do
  node --check "$f"
  count=$((count + 1))
done < <(find "$tmp/js" -name '*.js')
echo "syntaxe : $count modules"

for m in sortable table ui; do
  node "$tmp/js/$m.js"
  echo "auto-vérification de $m.js : OK"
done
