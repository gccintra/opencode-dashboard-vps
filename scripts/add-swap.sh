#!/usr/bin/env bash
# Creates a 4 GiB swap file at /swapfile2 for OOM headroom.
# Run once as root on the VPS. Safe to re-run (skips if already active).
set -euo pipefail

SWAPFILE=/swapfile2
SIZE_GB=4

if swapon --show | grep -q "$SWAPFILE"; then
  echo "[swap] $SWAPFILE already active — nothing to do"
  exit 0
fi

if [ ! -f "$SWAPFILE" ]; then
  echo "[swap] allocating ${SIZE_GB}G at $SWAPFILE ..."
  fallocate -l "${SIZE_GB}G" "$SWAPFILE"
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE"
fi

swapon "$SWAPFILE"
echo "[swap] enabled $SWAPFILE ($(free -h | grep Swap))"

# Persist across reboots
if ! grep -q "$SWAPFILE" /etc/fstab; then
  echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab
  echo "[swap] added to /etc/fstab"
fi
