#!/usr/bin/env bash
# Installs the hourly SQLite backup cron job on the VPS.
# Safe to re-run — idempotent.
set -euo pipefail

BACKUP_SCRIPT=/usr/local/bin/opencode-backup.sh
CRON_FILE=/etc/cron.d/opencode-backup

# ── Backup script ────────────────────────────────────────────────────────────
cat > "$BACKUP_SCRIPT" << 'SCRIPT'
#!/bin/bash
# Hourly SQLite backup for opencode-dashboard. Retention: 7 days.
set -euo pipefail

DB_SRC="/var/lib/opencode/opencode.db"
BACKUP_DIR="/var/lib/opencode/backups"
STAMP=$(date +%Y%m%d_%H%M%S)
DEST="${BACKUP_DIR}/opencode_${STAMP}.db"
LOG="/var/log/opencode-backup.log"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_SRC" ]; then
  echo "$(date -Iseconds) ERROR: source database not found: $DB_SRC" | tee -a "$LOG"
  exit 1
fi

cp "$DB_SRC" "$DEST"
echo "$(date -Iseconds) OK: backup saved to $DEST ($(du -h "$DEST" | cut -f1))" | tee -a "$LOG"

# Remove backups older than 7 days
find "$BACKUP_DIR" -name "opencode_*.db" -mtime +7 -delete
echo "$(date -Iseconds) OK: old backups pruned" | tee -a "$LOG"
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
