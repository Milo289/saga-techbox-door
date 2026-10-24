#!/bin/bash
# Dubbelklik dit bestand (Mac) om alles te laten testen. De uitkomst komt in een map op je bureaublad.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is nodig voor de test. Haal het op via https://nodejs.org (de LTS-versie), installeer het en dubbelklik dit bestand opnieuw."
  read -r -p "Druk op Enter om te sluiten" _; exit 1
fi
node tools/zelftest/run.js "$@"
echo
read -r -p "Klaar. Druk op Enter om te sluiten" _
