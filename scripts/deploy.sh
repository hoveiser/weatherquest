#!/usr/bin/env bash
#
# Deploy WeatherQuest to GenLayer StudioNet.
#
# StudioNet is GASLESS — you do NOT need GEN to deploy. (Note: funding quest
# escrow via `create_quest`/`deposit` still needs GEN in the account balance,
# but deployment itself is free.)
#
# Usage:
#   ./scripts/deploy.sh
#
# It reads GENLAYER_PRIVATE_KEY from your environment (or .env) and prints the
# new contract address at the end. Copy that into frontend/.env.local as
# VITE_CONTRACT_ADDRESS and set VITE_ONCHAIN=true to drive the live UI.
#
set -euo pipefail

# --- Resolve repo root (this script lives in <root>/scripts) -----------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTRACT="contracts/weatherquest.py"
NETWORK="studionet"
KEY_NAME="wq-deployer"

# --- Load the private key -----------------------------------------------------
# Prefer an already-exported GENLAYER_PRIVATE_KEY; otherwise read it from .env.
if [ -z "${GENLAYER_PRIVATE_KEY:-}" ] && [ -f ".env" ]; then
  echo "Loading GENLAYER_PRIVATE_KEY from .env ..."
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
: "${GENLAYER_PRIVATE_KEY:?Set GENLAYER_PRIVATE_KEY (env or .env) before deploying.}"

# --- Preflight: contract must pass the GenVM linter ---------------------------
if command -v genvm-lint >/dev/null 2>&1; then
  echo "Linting $CONTRACT ..."
  genvm-lint check "$CONTRACT"
fi

# --- Ensure the CLI is targeting StudioNet ------------------------------------
echo "Selecting network: $NETWORK ..."
genlayer network set "$NETWORK"

# --- Import (or refresh) the deployer account from the private key ------------
# A keystore password is required by the CLI. Pass your own via
# GENLAYER_KEY_PASSWORD, or the default below for a throwaway local key.
KEY_PASSWORD="${GENLAYER_KEY_PASSWORD:-wqlocalpass}"
if genlayer account list 2>/dev/null | grep -q "$KEY_NAME"; then
  echo "Account '$KEY_NAME' already imported."
else
  echo "Importing account '$KEY_NAME' from GENLAYER_PRIVATE_KEY ..."
  genlayer account import --name "$KEY_NAME" --private-key "$GENLAYER_PRIVATE_KEY" --password "$KEY_PASSWORD"
fi
genlayer account use "$KEY_NAME"

# --- Deploy -------------------------------------------------------------------
echo "Deploying $CONTRACT to $NETWORK ..."
echo "$KEY_PASSWORD" | genlayer deploy --contract "$CONTRACT"

echo
echo "Done. Read the 'Contract Address' line above, then wire it into the UI:"
echo "  echo 'VITE_CONTRACT_ADDRESS=0x....' > frontend/.env.local"
echo "  echo 'VITE_ONCHAIN=true'           >> frontend/.env.local"
