# OpenCode Dashboard — Deployment Guide

Step-by-step guide to deploy OpenCode Dashboard on a VPS.

---

## Prerequisites

- **OS:** Ubuntu 24.04 LTS (or Debian 12)
- **Node.js:** 18 LTS (required for `apps/pty-worker` — Bun 1.3.14 is **incompatible** with node-pty)
- **Bun:** 1.3+ ([install guide](https://bun.sh/docs/installation))
- **nginx:** `apt install nginx`
- **certbot:** `apt install certbot python3-certbot-nginx`
- **PM2:** `npm install -g pm2`
- **git:** `apt install git`
- **Domain:** pointed to your VPS IP (A record)

### Install Node 18 LTS

```bash
# Ubuntu 24.04
apt update && apt install -y nodejs npm
node --version  # v18.19.1

# If you need a newer 18.x via NodeSource:
# curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
# apt install -y nodejs
```

### Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
# Restart your shell or source ~/.bashrc
```

### Install PM2

```bash
npm install -g pm2
```

---

## 1. DNS Configuration

Point your domain to your VPS IP address:

- Add an **A record**: `example.com` → `YOUR_VPS_IP`
- Optionally add `www` as CNAME → `example.com`

Verify DNS propagation:

```bash
dig example.com +short
# Should return your VPS IP
```

---

## 2. Clone & Setup

```bash
git clone https://github.com/YOUR_USER/opencode-dashboard.git /opt/opencode-dashboard
cd /opt/opencode-dashboard
```

### 3. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
AUTH_PASSWORD=your-strong-password-here
JWT_SECRET=$(openssl rand -base64 32)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx  # optional, for GitHub sync
SERVER_PORT=3001
```

---

## 4. Build

```bash
bun install
bun run build
```

This builds:

- `apps/web/dist/` — frontend static assets (minified JS, CSS, HTML)
- `apps/server/dist/` — backend JavaScript (Bun-compatible)

---

## 5. Firewall

Only expose ports 80 and 443:

```bash
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw enable
ufw status
```

**Important:** Never expose port 3001 directly. The Bun server only listens on `localhost`.

---

## 6. Nginx Configuration

### 6.1 Install the config

```bash
cp deploy/nginx/opencode-dashboard.conf /etc/nginx/sites-available/opencode-dashboard

# Edit the domain name in the config:
sed -i 's/example.com/YOUR_DOMAIN/g' /etc/nginx/sites-available/opencode-dashboard
```

### 6.2 Enable the site

```bash
ln -s /etc/nginx/sites-available/opencode-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default  # Remove default site

# Test config syntax
nginx -t

# Reload nginx
systemctl reload nginx
```

### 6.3 SSL with Let's Encrypt

```bash
# Issue certificate (interactive — follow prompts)
certbot --nginx -d example.com

# Verify auto-renewal
certbot renew --dry-run
```

---

## 7. PM2 Setup

### 7.1 Start the server

```bash
cd /opt/opencode-dashboard
pm2 start ecosystem.config.cjs
pm2 save
```

### 7.2 Enable auto-start on boot

```bash
pm2 startup
# Follow the printed instructions (usually copy-paste a sudo command)

pm2 save
```

### 7.3 Verify

```bash
pm2 list
pm2 logs opencode-dashboard --lines 20
curl http://localhost:3001/api/health
# → {"status":"ok","timestamp":"..."}
```

---

## 8. Health Check

After deployment, verify:

```bash
# API health check
curl https://example.com/api/health

# WebSocket endpoint
curl -I https://example.com/terminal/test

# Frontend loads
curl -I https://example.com/
```

---

## 9. Deploy Updates

Use the deploy script:

```bash
cd /opt/opencode-dashboard
chmod +x deploy/deploy.sh
./deploy/deploy.sh
```

Or manually:

```bash
git pull origin main
bun install
bun run build
pm2 restart opencode-dashboard
```

---

## 10. Troubleshooting

### Logs

| Service      | Log Location                       | Command                             |
| ------------ | ---------------------------------- | ----------------------------------- |
| PM2 (app)    | `./logs/out.log`, `./logs/err.log` | `pm2 logs opencode-dashboard`       |
| nginx access | `/var/log/nginx/access.log`        | `tail -f /var/log/nginx/access.log` |
| nginx error  | `/var/log/nginx/error.log`         | `tail -f /var/log/nginx/error.log`  |
| certbot      | `/var/log/letsencrypt/`            | `certbot certificates`              |

### Common Issues

1. **pty-worker fails to start** — Ensure Node 18 is installed: `node --version` should show v18.x
2. **nginx 502 Bad Gateway** — Check if the Bun server is running: `pm2 list`, `curl localhost:3001/api/health`
3. **SSL certificate expired** — Run `certbot renew --force-renewal`
4. **Port 3001 in use** — Check with `lsof -i :3001` and kill the old process
5. **Database locked** — Restart PM2: `pm2 restart opencode-dashboard`
