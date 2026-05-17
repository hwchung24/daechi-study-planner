#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/diagrams"
OUT="$ROOT/docs/diagrams/png"
mkdir -p "$OUT"

MMDC=(npx --yes @mermaid-js/mermaid-cli@11.4.0 -w 2400 -H 1800 -b transparent)

for f in "$SRC"/*.mmd; do
  base="$(basename "$f" .mmd)"
  echo "→ $base.png"
  "${MMDC[@]}" -i "$f" -o "$OUT/$base.png"
done

echo "Done. PNG files:"
ls -la "$OUT"
