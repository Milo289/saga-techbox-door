#!/bin/bash
# Go back to an earlier version.
#   ./restore.sh              -> list saved versions
#   ./restore.sh works-v1     -> put the code back exactly as it was in that version
# Your live data (data/: status, settings, visitors) is never touched.
# Nothing is lost: your current state is saved first, so you can come back to it.
cd "$(dirname "$0")"
if [ -z "$1" ]; then
  echo "Named versions:"; git tag -l | sed 's/^/  /'
  echo; echo "All saved versions (newest first):"; git log --format='  %h  %ad  %s' --date=format:'%d-%m %H:%M'
  echo; echo "Restore with:  ./restore.sh <name or code>"
  exit 0
fi
git rev-parse --verify -q "$1^{commit}" >/dev/null || { echo "Unknown version: $1  (run ./restore.sh to see the list)"; exit 1; }
git add -A
git diff --cached --quiet || git commit -q -m "Automatic save before restoring $1"
BEFORE=$(git rev-parse --short HEAD)
git restore --source="$1" --staged --worktree :/
git commit -q -m "Restored version $1" && echo "Restored to $1." || echo "Already at $1."
echo "Changed your mind?  ./restore.sh $BEFORE"
echo "Restart the server to use it (Ctrl+C in its terminal, then: ADMIN_PIN=1234 node server.js)."
