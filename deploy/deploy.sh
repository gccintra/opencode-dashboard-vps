#!/bin/bash
set -e

echo "=== OpenCode Dashboard Deploy ==="

# Pull latest changes
echo "[1/4] Pulling latest changes..."
git pull origin main

# Install dependencies (including pty-worker's Node deps)
echo "[2/4] Installing dependencies..."
bun install

# Build frontend + backend
echo "[3/4] Building..."
bun run build

# Restart the server
echo "[4/4] Restarting server..."
pm2 restart opencode-dashboard || pm2 start ecosystem.config.cjs
pm2 save

echo "=== Deploy complete ==="
echo ""
echo "Check status:"
echo "  pm2 list"
echo "  curl http://localhost:3001/api/health"
