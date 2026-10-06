#!/bin/bash
# Save the current version so you can always go back to it.
#   ./save.sh "what you changed"
#   ./save.sh "what you changed" name   -> also gives it a short name, e.g. works-v2
cd "$(dirname "$0")"
MSG="${1:-Saved version}"
git add -A
if git diff --cached --quiet; then echo "Nothing changed since the last saved version."; else git commit -q -m "$MSG" && echo "Saved: $MSG"; fi
if [ -n "$2" ]; then git tag -f "$2" >/dev/null && echo "Named this version: $2"; fi
mkdir -p backups
ZIP="backups/$(date +%Y-%m-%d_%H-%M)${2:+_$2}.zip"
zip -qr "$ZIP" . -x 'backups/*' -x '.git/*' -x 'node_modules/*' -x 'dist/*' && echo "Zip copy (with data): $ZIP"
