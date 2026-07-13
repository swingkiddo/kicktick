#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

SERVICE="${1:-all}"
STAGE="dev"
DETACH=""

for arg in "$@"; do
  case "$arg" in
    prod|dev)      STAGE="$arg" ;;
    -d|--detach)   DETACH="-d" ;;
  esac
done

ensure_image() {
  local image="$1"
  if ! docker image inspect "$image" > /dev/null 2>&1; then
    echo "  → Image not found. Building $image..."
    "$SCRIPT_DIR/build.sh" "$2" "$STAGE"
  fi
}

run_frontend() {
  local name="kicktick-frontend"
  local image="kicktick-frontend:${STAGE}"
  ensure_image "$image" "frontend"

  echo "→ Starting $name ($STAGE)..."
  local wallet_mount=""
  [ "$STAGE" = "dev" ] && wallet_mount="-v $PROJECT_DIR/wallets:/app/public/wallets:ro"
  docker run --rm $DETACH \
    --name "$name" \
    -v "$PROJECT_DIR/frontend:/app" \
    $wallet_mount \
    -v /app/node_modules \
    -e VITE_KICKTICK_PROGRAM_ID=LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND \
    -e VITE_SOLANA_RPC_URL=https://api.devnet.solana.com \
    -p 3000:3000 \
    "$image"
}

run_contracts() {
  local name="kicktick-contracts"
  local image="kicktick-contracts:${STAGE}"
  ensure_image "$image" "contracts"

  local vol_solana=""
  local solana_key="$HOME/.config/solana"
  [ -d "$solana_key" ] && vol_solana="-v $solana_key:/home/${USER:-pdpvs}/.config/solana"

  stop_service "$name"

  echo "→ Starting $name ($STAGE)..."
  docker run --rm -d \
    --name "$name" \
    -v "$PROJECT_DIR/kicktick:/workspace" \
    -v kicktick_cargo-cache:/usr/local/cargo/registry \
    -v kicktick_cargo-git-cache:/usr/local/cargo/git \
    $vol_solana \
    "$image" \
    sleep infinity

  echo ""
  echo "Container running. Enter with:"
  echo "  docker exec -it $name bash"
}

run_relayer() {
  local name="kicktick-relayer"
  local image="kicktick-relayer:${STAGE}"
  ensure_image "$image" "relayer"

  local env_file="$PROJECT_DIR/relayer/.env"
  local env_opt=""
  [ -f "$env_file" ] && env_opt="--env-file $env_file"
  local node_env="production"
  local test_mode="false"
  if [ "$STAGE" = "dev" ]; then
    node_env="development"
    test_mode="true"
  fi

  # The CLOB's SQLite store must outlive a disposable container. An explicitly
  # configured CLOB_DB_PATH still wins, but defaults inside the mounted data dir.
  local data_dir="$PROJECT_DIR/relayer/data"
  mkdir -p "$data_dir"
  local db_path="${CLOB_DB_PATH:-/app/data/kicktick-clob.sqlite}"
  local db_env="-e CLOB_DB_PATH=$db_path"

  local vol_solana=""
  local solana_key="$HOME/.config/solana"
  [ -d "$solana_key" ] && vol_solana="-v $solana_key:/root/.config/solana:ro"

  local vol_keypair=""
  [ -f "$PROJECT_DIR/keypair.json" ] && vol_keypair="-v $PROJECT_DIR/keypair.json:/app/keypair.json:ro"

  local logs_dir="$PROJECT_DIR/relayer/logs"
  mkdir -p "$logs_dir"
  local log_file="$logs_dir/relayer-$(date -u +%Y-%m-%dT%H-%M-%S).log"
  echo "  Log file:       $log_file"

  echo "→ Starting $name ($STAGE)..."
  if [ -n "$DETACH" ]; then
    docker run --rm -d \
      --name "$name" \
      $env_opt \
      -e NODE_ENV="$node_env" \
      -e TEST_MODE="$test_mode" \
      $db_env \
      -v "$PROJECT_DIR/relayer:/app" \
      -v /app/node_modules \
      -v "$data_dir:/app/data" \
      $vol_solana \
      $vol_keypair \
      -p 8080:8080 \
      "$image"

    docker logs -f "$name" 2>&1 | tee "$log_file" &
    RELAYER_LOG_PID=$!
    disown "$RELAYER_LOG_PID" 2>/dev/null || true
  else
    docker run --rm \
      --name "$name" \
      $env_opt \
      -e NODE_ENV="$node_env" \
      -e TEST_MODE="$test_mode" \
      $db_env \
      -v "$PROJECT_DIR/relayer:/app" \
      -v /app/node_modules \
      -v "$data_dir:/app/data" \
      $vol_solana \
      $vol_keypair \
      -p 8080:8080 \
      "$image" 2>&1 | tee "$log_file"
  fi
}

run_test_runner() {
  local image="kicktick-relayer:${STAGE}"
  ensure_image "$image" "relayer"
  local env_file="$PROJECT_DIR/relayer/.env"
  local env_opt=""
  [ -f "$env_file" ] && env_opt="--env-file $env_file"
  echo "→ Running test wallet runner ($STAGE)..."
  docker run --rm \
    $env_opt \
    -e TEST_WALLETS_DIR=/app/test-wallets \
    -v "$PROJECT_DIR/relayer:/app" \
    -v /app/node_modules \
    -v "$PROJECT_DIR/wallets:/app/test-wallets:ro" \
    "$image" npm run test:wallets
}

stop_service() {
  local name="$1"
  if docker ps -a -q --filter "name=$name" | grep -q .; then
    echo "  Removing old container $name..."
    docker rm -f "$name" > /dev/null 2>&1 || true
  fi
}

PARALLEL_PIDS=()

cleanup() {
  for pid in "${PARALLEL_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

case "$SERVICE" in
  all)
    stop_service "kicktick-frontend"
    stop_service "kicktick-relayer"
    stop_service "kicktick-contracts"

    if [ -n "$DETACH" ]; then
      run_contracts
      run_frontend
      run_relayer
      echo ""
      echo "All services running. View logs:"
      echo "  docker logs -f kicktick-contracts"
      echo "  docker logs -f kicktick-frontend"
      echo "  docker logs -f kicktick-relayer"
    else
      run_contracts
      run_frontend &
      PARALLEL_PIDS+=($!)
      run_relayer &
      PARALLEL_PIDS+=($!)
      echo "→ All services starting. Press Ctrl+C to stop all."
      wait
    fi
    ;;
  frontend)
    stop_service "kicktick-frontend"
    run_frontend
    ;;
  relayer)
    stop_service "kicktick-relayer"
    run_relayer
    ;;
  contracts)
    run_contracts
    ;;
  test-runner)
    run_test_runner
    ;;
  *)
    echo "Usage: $0 [all|frontend|relayer|contracts|test-runner] [dev|prod] [-d]"
    exit 1
    ;;
esac
