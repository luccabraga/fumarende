#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_PATH="$(command -v node)" || { echo "node not found on PATH" >&2; exit 1; }
PLIST_DEST="$HOME/Library/LaunchAgents/com.lucca.fumarende.plist"

if [[ -z "$NODE_PATH" ]]; then
  echo "node not found on PATH" >&2
  exit 1
fi

sed \
  -e "s#__NODE_PATH__#${NODE_PATH}#g" \
  -e "s#__REPO_ROOT__#${REPO_ROOT}#g" \
  "${REPO_ROOT}/scripts/com.lucca.fumarende.plist.template" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "Installed and loaded $PLIST_DEST"
echo "Check status with: launchctl list | grep com.lucca.fumarende"
