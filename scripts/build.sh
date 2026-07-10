#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

SERVICE="${1:-all}"
STAGE="${2:-dev}"

USER_ID=$(id -u)
GROUP_ID=$(id -g)
USER_NAME=$(whoami)

build_contracts() {
  echo "→ Building kicktick-contracts:${STAGE}"
  docker build \
    --build-arg USER_ID="$USER_ID" \
    --build-arg GROUP_ID="$GROUP_ID" \
    --build-arg USER_NAME="$USER_NAME" \
    -t "kicktick-contracts:${STAGE}" \
    -f "$PROJECT_DIR/kicktick/Dockerfile" \
    "$PROJECT_DIR/kicktick"
}

build_frontend() {
  copy_generated_idl
  echo "→ Building kicktick-frontend:${STAGE}"
  docker build \
    --target "$STAGE" \
    -t "kicktick-frontend:${STAGE}" \
    -f "$PROJECT_DIR/frontend/Dockerfile" \
    "$PROJECT_DIR/frontend"
}

build_relayer() {
  echo "→ Building kicktick-relayer:${STAGE}"
  copy_generated_idl
  docker build \
    --target "$STAGE" \
    -t "kicktick-relayer:${STAGE}" \
    -f "$PROJECT_DIR/relayer/Dockerfile" \
    "$PROJECT_DIR/relayer"
}

copy_generated_idl() {
  local idl_src="$PROJECT_DIR/kicktick/target/idl/kicktick.json"
  local relayer_idl="$PROJECT_DIR/relayer/src/idl/kicktick.json"
  local frontend_idl="$PROJECT_DIR/frontend/public/idl/kicktick.json"
  if [ -f "$idl_src" ]; then
    mkdir -p "$(dirname "$relayer_idl")" "$(dirname "$frontend_idl")"
    cp "$idl_src" "$relayer_idl"
    cp "$idl_src" "$frontend_idl"
    echo "  IDL copied into relayer and frontend build contexts"
  else
    echo "  ⚠ IDL not found at kicktick/target/idl/kicktick.json — run './scripts/build.sh contracts' first"
  fi
}

case "$SERVICE" in
  all)       build_contracts; build_frontend; build_relayer ;;
  contracts) build_contracts ;;
  frontend)  build_frontend ;;
  relayer)   build_relayer ;;
  *)
    echo "Usage: $0 [all|contracts|frontend|relayer] [dev|prod]"
    exit 1
    ;;
esac

echo "✓ Done"
