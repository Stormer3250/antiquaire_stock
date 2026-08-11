#!/usr/bin/env bash
# Contrôle des modules front : syntaxe de chaque fichier, puis les auto-vérifications
# des modules qui en portent une. Node ne sait analyser un module ES que si le fichier
# porte l'extension .mjs, d'où la copie.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

count=0
while IFS= read -r f; do
  cp "$f" "$tmp/$(echo "$f" | tr '/' '_')x.mjs"
  count=$((count + 1))
done < <(find static/js -name '*.js')
for f in "$tmp"/*.mjs; do node --check "$f"; done
echo "syntaxe : $count modules"

# auto-vérifications embarquées
cp static/js/sortable.js "$tmp/sortable.mjs" && node "$tmp/sortable.mjs"
echo "auto-vérification de sortable.js : OK"
