#!/usr/bin/env bash
# Installs the hourly SQLite backup cron job on the VPS.
# Safe to re-run — idempotent.
#
# Usage:
#   sudo ./scripts/setup-cron.sh
#   sudo DB_PATH=/custom/path/opencode.db BACKUP_DIR=/custom/backups ./scripts/setup-cron.sh
set -euo pipefail

DB_PATH="${DB_PATH:-}"
BACKUP_DIR="${BACKUP_DIR:-}"
BACKUP_SCRIPT=/usr/local/bin/opencode-backup.sh
CRON_FILE=/etc/cron.d/opencode-backup

if [ -z "$DB_PATH" ]; then
  # Derive from DATABASE_PATH in the .env next to this script
  ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
  if [ -f "$ENV_FILE" ]; then
    DB_PATH=$(grep '^DATABASE_PATH=' "$ENV_FILE" | cut -d= -f2-)
  fi
fi

if [ -z "$DB_PATH" ]; then
  echo "ERROR: DB_PATH not set and DATABASE_PATH not found in .env" >&2
  echo "Usage: DB_PATH=/var/lib/opencode/opencode.db $0" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$(dirname "$DB_PATH")/backups}"

echo "[setup-cron] DB_PATH=$DB_PATH"
echo "[setup-cron] BACKUP_DIR=$BACKUP_DIR"

# ── Backup script ────────────────────────────────────────────────────────────
cat > "$BACKUP_SCRIPT" << SCRIPT
#!/bin/bash
set -euo pipefail

DB_SRC="$DB_PATH"
BACKUP_DIR="$BACKUP_DIR"
STAMP=\$(date +%Y%m%d_%H%M%S)
DEST="\${BACKUP_DIR}/opencode_\${STAMP}.db"
LOG="/var/log/opencode-backup.log"

mkdir -p "\$BACKUP_DIR"

if [ ! -f "\$DB_SRC" ]; then
  echo "\$(date -Iseconds) ERROR: source database not found: \$DB_SRC" | tee -a "\$LOG"
  exit 1
fi

cp "\$DB_SRC" "\$DEST"
echo "\$(date -Iseconds) OK: backup saved to \$DEST (\$(du -h "\$DEST" | cut -f1))" | tee -a "\$LOG"

find "\$BACKUP_DIR" -name "opencode_*.db" -mtime +7 -delete
echo "\$(date -Iseconds) OK: old backups pruned" | tee -a "\$LOG"
SCRIPT

chmod +x "$BACKUP_SCRIPT"
echo "[setup-cron] installed $BACKUP_SCRIPT"

# ── Cron entry ───────────────────────────────────────────────────────────────
cat > "$CRON_FILE" << 'CRON'
# Hourly SQLite backup for opencode-dashboard
0 * * * * root /usr/local/bin/opencode-backup.sh
CRON

echo "[setup-cron] installed $CRON_FILE"

# ── Smoke test ───────────────────────────────────────────────────────────────
echo "[setup-cron] running smoke test..."
"$BACKUP_SCRIPT"
echo "[setup-cron] done — backup log:"
tail -3 /var/log/opencode-backup.log
