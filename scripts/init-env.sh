#!/usr/bin/env bash
# Auto-generate .env for new worktrees. Skips if .env already exists.
set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
ENV_FILE="$REPO_ROOT/.env"

# already exists → nothing to do
if [[ -f "$ENV_FILE" ]]; then
  exit 0
fi

echo "[init-env] No .env found — generating isolated config..."

# find main worktree (first entry in worktree list)
MAIN_WORKTREE=$(git worktree list 2>/dev/null | head -1 | awk '{print $1}')
TEMPLATE_ENV="$MAIN_WORKTREE/.env"

if [[ ! -f "$TEMPLATE_ENV" ]]; then
  echo "[init-env] ERROR: template not found at $TEMPLATE_ENV" >&2
  echo "[init-env] Create $TEMPLATE_ENV manually first." >&2
  exit 1
fi

# collect all ports already declared in any worktree .env
used_ports() {
  git worktree list 2>/dev/null | awk '{print $1}' | while read -r wt; do
    [[ -f "$wt/.env" ]] && grep -E '^(SERVER_PORT|WEB_PORT)=' "$wt/.env" | cut -d= -f2 || true
  done
  # also include currently listening ports
  ss -tlnp 2>/dev/null | grep -oP '(?<=:)[0-9]+(?= )' || true
}

find_free_port() {
  local port=$1
  local used
  used=$(used_ports | sort -u)
  while echo "$used" | grep -qx "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

SERVER_PORT=$(find_free_port 3002)
# WEB_PORT must not conflict either
WEB_PORT=$(find_free_port 5173)
# ensure WEB_PORT != SERVER_PORT (edge case)
if [[ "$WEB_PORT" == "$SERVER_PORT" ]]; then
  WEB_PORT=$(find_free_port $((WEB_PORT + 1)))
fi

DB_PATH="$REPO_ROOT/apps/server/data/opencode.db"
mkdir -p "$(dirname "$DB_PATH")"

# derive a unique tmux socket name from the worktree directory name
WT_SLUG=$(basename "$REPO_ROOT" | tr '[:upper:] +/' '[:lower:]---' | cut -c1-40)
TMUX_SOCKET="/tmp/tmux-alf-${WT_SLUG}.sock"

# copy template, override the worktree-specific vars
sed \
  -e "s|^SERVER_PORT=.*|SERVER_PORT=$SERVER_PORT|" \
  -e "s|^WEB_PORT=.*|WEB_PORT=$WEB_PORT|" \
  -e "s|^DATABASE_PATH=.*|DATABASE_PATH=$DB_PATH|" \
  -e "s|^TMUX_SOCKET_PATH=.*|TMUX_SOCKET_PATH=$TMUX_SOCKET|" \
  "$TEMPLATE_ENV" > "$ENV_FILE"

# add TMUX_SOCKET_PATH if template didn't have it
if ! grep -q '^TMUX_SOCKET_PATH=' "$ENV_FILE"; then
  echo "TMUX_SOCKET_PATH=$TMUX_SOCKET" >> "$ENV_FILE"
fi

echo "[init-env] SERVER_PORT=$SERVER_PORT  WEB_PORT=$WEB_PORT"
echo "[init-env] DB  → $DB_PATH"
echo "[init-env] tmux→ $TMUX_SOCKET"
