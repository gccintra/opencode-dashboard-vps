# OpenCode Dashboard — Launch Checklist

> **Status:** [ ] Complete
> **Target:** VPS production environment
> **Last Updated:** 2026-06-05

---

## Pre-Launch Verification

### Environment

- [ ] `.env` file created with strong `AUTH_PASSWORD` (min 16 chars)
- [ ] `JWT_SECRET` is a random string (use `openssl rand -base64 32`)
- [ ] `GITHUB_TOKEN` configured (if using GitHub sync)
- [ ] `SERVER_PORT` set to 3001 (default)
- [ ] No `.env` file committed to git

### Firewall

- [ ] `ufw` enabled and active
- [ ] Port 22 (SSH) allowed
- [ ] Port 80 (HTTP) allowed
- [ ] Port 443 (HTTPS) allowed
- [ ] Port 3001 **NOT** exposed publicly (localhost only)

### SSL

- [ ] HTTPS loads with valid certificate (green padlock in browser)
- [ ] HTTP → HTTPS redirect working
- [ ] `certbot renew --dry-run` succeeds
- [ ] HSTS header present in response

### Process Management

- [ ] PM2 running: `pm2 list` shows `opencode-dashboard` as `online`
- [ ] `pm2 startup` configured for boot auto-start
- [ ] `pm2 save` executed after configuration
- [ ] Log rotation configured (10MB max, retain 5 files)

### Nginx

- [ ] Config syntax valid: `nginx -t`
- [ ] nginx running: `systemctl status nginx`
- [ ] WebSocket upgrade headers present in `/terminal/` location
- [ ] Gzip compression enabled
- [ ] Security headers present (HSTS, X-Content-Type-Options, X-Frame-Options)

### DNS

- [ ] A record for domain → VPS IP
- [ ] DNS propagation verified: `dig example.com`
- [ ] Both HTTP and HTTPS resolve to the dashboard

### Backup

- [ ] SQLite database backup cron job configured:
  ```cron
  0 2 * * * cp /opt/opencode-dashboard/data/opencode.db /opt/backups/opencode-$(date +\%Y\%m\%d).db
  ```
- [ ] Backup directory exists and is writable
- [ ] At least one manual backup taken before launch

---

## Smoke Test Flows

Execute each flow manually in production. Mark each as [x] when verified.

### Flow 1: Project CRUD

**Path:** Login → Create Project → Edit → Delete

- [ ] Navigate to https://example.com → redirected to login
- [ ] Enter correct password → redirected to /projects
- [ ] Click "New Project" → fill name, directory, description
- [ ] Project appears in the list
- [ ] Edit project: change name → verify name updated
- [ ] Delete project: confirm → project removed from list

### Flow 2: Terminal Session

**Path:** Open opencode session → type commands → see output

- [ ] Click on a project → "New Session" button
- [ ] Terminal opens with xterm.js rendered
- [ ] Type `ls` → directory listing appears
- [ ] Type `pwd` → current directory shown
- [ ] Resize browser window → terminal resizes (FitAddon)
- [ ] Close session → session removed from sidebar

### Flow 3: Multi-Session

**Path:** Open 3 sessions in different projects → switch between them

- [ ] Open session in Project A
- [ ] Open session in Project B
- [ ] Open session in Project C
- [ ] Sidebar shows all 3 sessions with status badges
- [ ] Click session in Project A → terminal shows that session
- [ ] Click session in Project B → terminal switches correctly
- [ ] Status badges update (active/waiting) in real-time

### Flow 4: Emergency Root Terminal

**Path:** Open emergency terminal → execute commands → close

- [ ] Click "Emergency Terminal" button in header
- [ ] Warning/confirmation dialog appears
- [ ] Confirm → root terminal opens
- [ ] Visual indicator shows ⚠️ Root / red border
- [ ] Type `ls /` → system root directory listed
- [ ] Close emergency terminal → session removed

### Flow 5: Kanban Board

**Path:** Create task → move to In Progress → link GitHub → move to Done

- [ ] Navigate to /tasks → Kanban board visible
- [ ] Click "Add Task" in Backlog column
- [ ] Fill title, description → task card appears
- [ ] Drag card to "In Progress" column
- [ ] Card stays in new column after refresh
- [ ] Link GitHub issue (if repo connected) → badge appears
- [ ] Drag card to "Done" column

### Flow 6: GitHub Sync

**Path:** Project with linked repo → see issues in kanban

- [ ] Create project with `githubRepo` configured
- [ ] Navigate to Kanban board
- [ ] GitHub issues appear as cards with 🐙 badge
- [ ] Issue number visible (e.g., "🐙 Issue #42")
- [ ] Local tasks and GitHub issues distinguishable by badge

### Flow 7: Agent Panel

**Path:** Panel shows active agents → click focuses session → Ctrl+K search

- [ ] Open 2+ terminal sessions
- [ ] Agent panel shows cards for each active session
- [ ] Each card shows: name, project, status, uptime
- [ ] Click agent card → focuses corresponding terminal
- [ ] Ctrl+K → search bar appears → type to filter agents
- [ ] "Waiting" agents sorted to top

### Flow 8: Project Configuration

**Path:** Open project settings → toggle skills on/off

- [ ] Navigate to project detail page
- [ ] Click "Settings" or "Configure" tab
- [ ] Skills list visible with toggle switches
- [ ] Toggle a skill off → setting persisted
- [ ] Toggle a skill on → setting persisted
- [ ] Refresh page → settings unchanged

### Flow 9: File Browser & Editor

**Path:** Navigate tree → open file → edit → save

- [ ] Open project with files
- [ ] File tree visible in sidebar or dedicated panel
- [ ] Expand directories → nested files appear (lazy loading)
- [ ] Click a `.ts` or `.tsx` file → opens in code editor
- [ ] Editor shows syntax highlighting
- [ ] Make changes → "Save" button
- [ ] Verify changes written to disk

### Flow 10: Reconnection

**Path:** Close browser → reopen → session still running → buffer restored

- [ ] Open a terminal session, type several commands
- [ ] Close browser tab completely
- [ ] Open new browser tab → navigate to dashboard
- [ ] Reconnect to the same session
- [ ] Previous terminal output is visible (buffer restored)
- [ ] Session state (active/waiting/finished) is correct

---

## Mobile QA (375px Viewport)

Test in Chrome DevTools Device Toolbar (iPhone SE / 375px width) or on actual device.

### Login Page

- [ ] Layout fits 375px without horizontal scroll
- [ ] Input field is properly sized for touch
- [ ] Virtual keyboard does not break layout
- [ ] "Sign In" button is full-width and tappable (min 44px height)

### Project List

- [ ] Cards/rows are touch-friendly (min 44px tap target)
- [ ] Scrolling is smooth
- [ ] No horizontal overflow
- [ ] Create/Edit buttons accessible without pinch-zoom

### Kanban Board

- [ ] Columns display as horizontal scroll or stacked vertically
- [ ] Cards are tappable
- [ ] Touch drag-and-drop works (or fallback buttons available)
- [ ] No content cut off at edges

### Terminal

- [ ] Terminal input works with virtual keyboard
- [ ] Auto-scroll follows output
- [ ] Keyboard does not permanently obscure terminal view
- [ ] On-screen keyboard "Done"/"Return" sends input

### Agent Panel

- [ ] Cards stack vertically
- [ ] Card height accommodates all info without truncation
- [ ] Tap targets large enough (44x44px)

### File Browser

- [ ] Full-screen mode with back button
- [ ] Tree nodes expandable with touch
- [ ] Editor area is scrollable
- [ ] "Save" button accessible without zooming

### Settings

- [ ] Toggle switches are large enough (min 44x44px)
- [ ] Labels readable without horizontal scroll
- [ ] Form inputs sized for touch keyboards

---

## Performance Benchmarks

Target performance metrics for production. These are NOT automated tests — verify manually or with DevTools.

| Scenario                               | Target                        | Status |
| -------------------------------------- | ----------------------------- | ------ |
| Initial page load (cold cache)         | < 3 seconds on 4G             | [ ]    |
| Initial page load (warm cache)         | < 1 second                    | [ ]    |
| 5 simultaneous terminal sessions       | No lag, no dropped keystrokes | [ ]    |
| Kanban with 50+ cards                  | Scroll at 60fps               | [ ]    |
| File tree with 1000+ files             | Lazy load, no freeze          | [ ]    |
| Memory usage with 5 sessions           | < 500MB total for Bun process | [ ]    |
| WebSocket reconnect after network drop | < 3 seconds                   | [ ]    |
| Production bundle size (JS + CSS)      | < 200KB gzipped               | [ ]    |

### How to Check Bundle Size

```bash
ls -lh apps/web/dist/assets/*.js apps/web/dist/assets/*.css
gzip -c apps/web/dist/assets/*.js | wc -c
```

### How to Check Memory

```bash
pm2 list  # shows memory per process
htop -p $(pgrep -f "bun.*dist/index.js")
```

---

## Rollback Plan

If the deployment fails or critical bugs are discovered post-launch:

### Quick Rollback (same server)

```bash
cd /opt/opencode-dashboard
git checkout <previous-stable-tag-or-commit>
bun install
bun run build
pm2 restart opencode-dashboard
pm2 logs opencode-dashboard --lines 20
```

### Emergency Stop

```bash
pm2 stop opencode-dashboard
# Server is down but not removed from PM2 list
```

### Database Restore

```bash
pm2 stop opencode-dashboard
cp /opt/backups/opencode-YYYYMMDD.db /opt/opencode-dashboard/data/opencode.db
pm2 start opencode-dashboard
```

---

## Post-Launch Monitoring (First 24 Hours)

- [ ] Monitor PM2 logs for errors: `pm2 logs opencode-dashboard --err --lines 50`
- [ ] Monitor disk space: `df -h`
- [ ] Monitor memory: `pm2 list` (check `memory` column)
- [ ] Check nginx error log: `tail -f /var/log/nginx/error.log`
- [ ] Verify SSL certificate expiry: `certbot certificates`
- [ ] Take a fresh database backup

---

## Known Issues (Pre-Launch)

> Document issues discovered during smoke tests that are acceptable for MVP launch but should be tracked for future sprints.

| Issue                      | Severity | Notes |
| -------------------------- | -------- | ----- |
| _TBD during smoke testing_ | —        | —     |
