#!/usr/bin/env bash
set -euo pipefail

# Script to auto-update sw_version in config.toml
# Usage: ./scripts/update-sw-version.sh [--commit-hash|--timestamp]
# Default: timestamp

CONFIG_FILE="config.toml"
MODE="${1:-timestamp}"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: $CONFIG_FILE not found" >&2
  exit 1
fi

case "$MODE" in
  --commit-hash)
    # Use short git commit hash if available
    if git rev-parse --git-dir > /dev/null 2>&1; then
      VERSION=$(git rev-parse --short HEAD)
    else
      echo "Warning: Not a git repo, falling back to timestamp" >&2
      VERSION=$(date +%Y-%m-%d-%H%M%S)
    fi
    ;;
  --timestamp|*)
    # Use ISO date + time (e.g., 2025-11-08-143045)
    VERSION=$(date +%Y-%m-%d-%H%M%S)
    ;;
esac

# Update sw_version line in [extra] section
# This uses sed in a portable way (GNU/BSD compatible with backup)
if grep -q '^sw_version' "$CONFIG_FILE"; then
  # Line exists, replace it
  sed -i.bak "s/^sw_version = .*/sw_version = \"$VERSION\"/" "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
  echo "Updated sw_version to: $VERSION"
else
  # Line doesn't exist, append to [extra] section if found
  if grep -q '^\[extra\]' "$CONFIG_FILE"; then
    sed -i.bak "/^\[extra\]/a\\
sw_version = \"$VERSION\"" "$CONFIG_FILE" && rm -f "$CONFIG_FILE.bak"
    echo "Added sw_version = \"$VERSION\" under [extra]"
  else
    echo "Error: [extra] section not found in $CONFIG_FILE" >&2
    exit 1
  fi
fi
