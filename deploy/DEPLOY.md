# OpenCode Dashboard — Deploy Info

## URLs

| Ambiente | URL |
|----------|-----|
| Produção | `https://gcsoftware.tech` |
| HTTP (redireciona) | `http://gcsoftware.tech` → `https://gcsoftware.tech` |

## Verificar se está no ar

```bash
# Status geral dos serviços
pm2 status
systemctl status nginx --no-pager

# Teste rápido dos endpoints
curl -sk https://gcsoftware.tech/api/health
curl -sk -o /dev/null -w "%{http_code}" https://gcsoftware.tech/
```

## Arquitetura

```
Internet (HTTPS)
    │
    ▼
nginx :80/:443 (proxy reverso + SSL)
    │
    ▼
Elysia (Bun) :3001 (API + frontend estático + WebSocket)
    │
    ├─► /api/* → rotas API (auth, sessions, projects, tasks, etc.)
    ├─► /terminal/* → WebSocket (xterm.js PTY)
    ├─► /* → arquivos estáticos (dist/) + SPA fallback (index.html)
    └─► PWA assets: manifest.webmanifest, sw.js, icons
```

## Serviços

| Serviço | Gerenciador | Comando status |
|---------|-------------|----------------|
| App (prod) | pm2 | `pm2 status` |
| App (dev) | pm2 | `pm2 status` |
| nginx | systemd | `systemctl status nginx` |
| SSL auto-renew | certbot.timer | `systemctl status certbot.timer` |

## Comandos úteis

```bash
# Status dos ambientes
pm2 status

# Logs
pm2 logs opencode-dashboard --lines 50         # produção
pm2 logs opencode-dashboard-dev --lines 50     # dev

# Logs do nginx
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Reiniciar
pm2 restart opencode-dashboard          # produção
pm2 restart opencode-dashboard-dev      # dev

# Reiniciar o nginx
systemctl reload nginx

# Ver portas em uso
ss -tlnp | grep -E "3001|3002|:80 |:443 "
```

## Ambientes PM2

| Ambiente | Nome PM2 | Porta | DB | Modo |
|----------|----------|-------|-----|------|
| Produção | `opencode-dashboard` | 3001 | `data/opencode.db` | build (dist/) |
| Dev | `opencode-dashboard-dev` | 3002 | `data/opencode_dev.db` | `--watch` (src/) |

Configuração em `ecosystem.config.cjs`.

## Deploy de atualizações

```bash
cd /root/code_projects/opencode-dashboard

# 1. Puxar código novo
git pull origin main

# 2. Instalar dependências (se necessário)
bun install

# 3. Build (frontend + backend)
bun run build

# 4. Reiniciar produção (dev faz --watch, não precisa)
pm2 restart opencode-dashboard
```

## Estrutura de arquivos relevantes

```
/root/code_projects/opencode-dashboard/
├── apps/
│   ├── web/                          # Frontend React + Vite
│   │   ├── dist/                     # Build de produção
│   │   │   ├── index.html
│   │   │   ├── manifest.webmanifest   # PWA manifest
│   │   │   ├── sw.js                 # Service Worker (Workbox)
│   │   │   ├── icon-192.png          # PWA ícone 192x192
│   │   │   ├── icon-512.png          # PWA ícone 512x512
│   │   │   └── assets/               # JS/CSS bundle
│   │   └── public/
│   │       ├── icon.svg
│   │       ├── icon-192.png
│   │       └── icon-512.png
│   └── server/                       # Backend Elysia
│       └── dist/                     # Build do servidor
├── data/                             # SQLite databases
│   ├── opencode.db                   # Produção
│   └── opencode_dev.db               # Desenvolvimento
├── deploy/
│   ├── DEPLOY.md
│   └── nginx/
│       └── opencode-dashboard.conf   # Template de config nginx
├── logs/                             # Logs do PM2 (prod + dev separados)
├── ecosystem.config.cjs              # Config do PM2 (prod + dev)
└── bun.lock
```

## Configuração do nginx

Arquivo ativo: `/etc/nginx/sites-available/opencode-dashboard`

```bash
# Testar sintaxe da config antes de recarregar
nginx -t

# Recarregar sem derrubar conexões
systemctl reload nginx

# Reiniciar completamente
systemctl restart nginx
```

## SSL / Certificado

```bash
# Verificar quando expira
certbot certificates

# Renovar manualmente (o timer faz automático)
certbot renew

# Forçar renovação
certbot renew --force-renewal
```

## PM2 — Auto-start no boot

```bash
# Já configurado. Para verificar:
systemctl status pm2-root

# Se precisar reconfigurar:
pm2 startup systemd -u root
pm2 save
```

## Database

SQLite file-based. Bancos separados por ambiente:

| Ambiente | Arquivo |
|----------|---------|
| Produção | `data/opencode.db` |
| Desenvolvimento | `data/opencode_dev.db` |

```bash
# Tamanho e timestamp
ls -la data/

# Inspecionar
bun -e "import {Database} from 'bun:sqlite'; const db = new Database('data/opencode.db'); console.log(db.query('SELECT * FROM projects').all()); db.close()"
```

## Variáveis de ambiente

Configuradas em `ecosystem.config.cjs` (por ambiente):

| Variável | Prod | Dev |
|----------|------|-----|
| `NODE_ENV` | `production` | `development` |
| `SERVER_PORT` | `3001` | `3002` |
| `DATABASE_PATH` | `./data/opencode.db` | `./data/opencode_dev.db` |

Variáveis sensíveis (devem estar no ambiente shell antes do `pm2 start`):
- `AUTH_PASSWORD` — senha de login do dashboard
- `JWT_SECRET` — chave de assinatura dos tokens JWT
