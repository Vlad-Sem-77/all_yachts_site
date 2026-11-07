#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
OUT_DIR="${1:-"$ROOT/generated-artifacts"}"

if [[ "$OUT_DIR" != /* ]]; then
  OUT_DIR="$ROOT/$OUT_DIR"
fi

mkdir -p "$OUT_DIR"

package_compose() {
  local source="$1"
  local output="$2"
  local readme="$3"
  cp "$ROOT/$source" "$STAGE/compose.yaml"
  cp "$ROOT/docs/deploy-f.md" "$STAGE/$readme"
  rm -f "$OUT_DIR/$output"
  (cd "$STAGE" && zip -X -q "$OUT_DIR/$output" compose.yaml "$readme")
  mapfile -t archive_files < <(unzip -Z1 "$OUT_DIR/$output")
  if [[ "${archive_files[0]:-}" != "compose.yaml" ]]; then
    echo "Deployment archive must contain compose.yaml at its root: $output" >&2
    exit 1
  fi
  echo "Created Deploy-F archive: $OUT_DIR/$output"
}

package_compose "compose.deploy-f.yaml" "all-yachts-deploy-f-compose.zip" "README.deploy-f.md"
package_compose "compose.deploy-f-migrate.yaml" "all-yachts-deploy-f-migration.zip" "README-migration.md"
