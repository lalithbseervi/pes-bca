#!/usr/bin/env bash
# Generate data/<subject>.json files from Supabase fileStore rows, grouped by subject
set -euo pipefail

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"

OUT_DIR="data"
mkdir -p "$OUT_DIR"

# Determine API proxy base:
# - use API_PROXY_BASE if set
# - else if PAGES_URL/CF_PAGES present or SUPABASE_URL looks like pages.dev use production proxy
# - otherwise default to localhost for local dev
PROXY_BASE="${API_PROXY_BASE:-}"
if [ -z "$PROXY_BASE" ]; then
  if [ -n "${PAGES_URL:-}" ] || [ -n "${CF_PAGES:-}" ] || echo "${SUPABASE_URL}" | grep -qE "pages\.dev"; then
    PROXY_BASE="https://cors-proxy.devpages.workers.dev"
  else
    PROXY_BASE="http://localhost:8787"
  fi
fi

# normalize (remove trailing slash if any)
PROXY_BASE="${PROXY_BASE%/}"

echo "Using API proxy base: $PROXY_BASE" >&2

API_URL="${SUPABASE_URL%/}/rest/v1/fileStore?select=id,filename,resource_type,unit,storage_key,subject,link_title&order=subject,unit,resource_type,filename"

# fetch rows (will exit non-zero on HTTP error)
resp=$(curl -sS -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" "$API_URL")

# For each subject group, emit data/<subject>.json with { units: [...] } shape
echo "$resp" \
  | jq -c --arg proxy "$PROXY_BASE" '
      group_by(.subject)[] 
      | {
          subject: (.[0].subject // "misc"),
          units: (
            group_by(.unit)
            | map({
                unit: ((.[0].unit // "misc")|tostring),
                groups: (
                  group_by(.resource_type)
                  | map({
                      type: (.[0].resource_type // "misc"),
                      files: map({
                        id: .id,
                        filename: .filename,
                        url: ($proxy + "/api/resources/" + .id + "/stream"),
                        storage_key: .storage_key,
                        linkTitle: (.link_title // null)
                      })
                    })
                )
              })
            )
        }' \
  | while read -r line; do
      subj=$(echo "$line" | jq -r '.subject')
      out="${OUT_DIR}/${subj}.json"
      echo "$line" | jq '{ units: .units }' > "$out"
      echo "Wrote $out"
    done

# If no rows returned, still ensure at least an empty misc file
if [ -z "$(ls -A "$OUT_DIR" 2>/dev/null)" ]; then
  echo '{"units":[]}' > "${OUT_DIR}/misc.json"
  echo "Wrote ${OUT_DIR}/misc.json (empty)"
fi