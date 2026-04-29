# kuiperAI — Production Deployment (DigitalOcean + Caddy)

End-to-end guide for deploying the multi-user kuiperAI platform on a
fresh DigitalOcean droplet with automatic HTTPS via Caddy + Let's
Encrypt.

The repo also has a dev `docker-compose.yml` at root for local
development — this `deploy/` folder is the **production** companion.
Both are independent.

---

## 1. What's in this folder

| File | Purpose |
|---|---|
| `Caddyfile` | Reverse proxy + auto HTTPS for the Next.js container |
| `docker-compose.prod.yml` | 4-service stack: caddy + app + mysql + redis |
| `.env.prod.example` | Annotated template for secrets/config (copy → `.env.prod`) |
| `deploy.sh` | CLI wrapper around docker compose: bootstrap / up / down / logs / status / update / backup / init-secrets |
| `DEPLOYMENT.md` | This document |

---

## 2. Recommended droplet sizing

For a 10-user team with active AI generation workloads:

| Resource | Spec | Notes |
|---|---|---|
| Plan | **Basic Premium AMD — 4 vCPU / 8 GB / 160 GB SSD** | ~$48/month. Tencent / OpenAI / FAL providers do most of the AI work, but Bull Board workers + MySQL + node still want headroom. Drop to 2 vCPU / 4 GB ($24) if you accept slower task processing. |
| Region | Nearest your team | Latency-driven |
| OS | Ubuntu 22.04 LTS x64 | Other distros work but bootstrap targets apt |
| Backups | Enable (+20%) | $9.60/month, weekly automated snapshots |
| Firewall (DO panel) | Allow 22, 80, 443 | The bootstrap script also runs `ufw allow` |

**Storage notes:**
- MySQL + Redis live on docker volumes inside `/var/lib/docker`.
- Default storage backend is **R2** (Cloudflare object storage). The
  Next.js app does NOT store videos / images on the droplet — they live
  in your R2 bucket, which is unbounded.
- To run with on-disk storage instead, set `STORAGE_TYPE=local` in
  `.env.prod`. You'll then want a Volume attached for the
  `kuiper-multiuser_app-data` mount.

---

## 3. Step 1 — DNS

Once the droplet exists, copy its public IPv4 and add an A record:

```
Type   Name      Value          TTL
A      kuiper    <droplet-ip>   300
```

Wait until `dig +short kuiper.example.com` returns the droplet IP.
**Do this before Step 5** — Caddy needs the A record live to obtain
the certificate.

---

## 4. Step 2 — SSH in and bootstrap the host

```bash
ssh root@<droplet-ip>

# Clone the repo
git clone https://github.com/waoowaooAI/waoowaoo.git /opt/kuiperAI
cd /opt/kuiperAI

# Switch to the active feature branch (Phase 11 work-in-progress).
# Once Phase 11 lands on main, change this to: git checkout main
git checkout feature/phase-11

cd deploy
./deploy.sh bootstrap
```

`bootstrap` is idempotent — it just installs Docker + the compose plugin
and opens UFW. Re-running it is safe.

---

## 5. Step 3 — Generate + configure secrets

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod

# Generate strong values for everything that needs randomness:
./deploy.sh init-secrets >> .env.prod
nano .env.prod   # edit DOMAIN, CADDY_EMAIL, NEXTAUTH_URL, ADMIN_USERNAME, R2 creds...
```

The `init-secrets` subcommand emits:
```
NEXTAUTH_SECRET=<64 hex>
CRON_SECRET=<32 hex>
INTERNAL_TASK_TOKEN=<32 hex>
API_ENCRYPTION_KEY=<64 hex>     ← treat as if it were the master key (do not rotate without re-encryption)
MYSQL_ROOT_PASSWORD=<48 hex>
ADMIN_PASSWORD=<20-char base64>
```

You still need to set by hand:
- `DOMAIN` — e.g. `kuiper.example.com`
- `CADDY_EMAIL` — for Let's Encrypt registration
- `NEXTAUTH_URL` — must equal `https://${DOMAIN}` exactly
- `ADMIN_USERNAME` — your bootstrap admin login (e.g. `admin`)
- `ADMIN_EMAIL` — optional, recommended
- R2 creds OR set `STORAGE_TYPE=local`

---

## 6. Step 4 — Bring up the stack

```bash
./deploy.sh up
```

The script:

1. Builds the Next.js + workers image (~5–10 minutes first time).
2. Starts MySQL → waits for healthy.
3. Starts Redis → waits for healthy.
4. Starts the app container, which runs:
   - `prisma db push` — applies the multi-user schema
   - `migrate-user-role-to-member.ts --apply` — backfills any legacy
     `role='user'` rows
   - `bootstrap-admin.ts` — creates the initial admin from
     `ADMIN_USERNAME` / `ADMIN_PASSWORD` and prints a fresh invite code
   - `npm run start` — Next.js + Bull Board workers
5. Starts Caddy → negotiates Let's Encrypt cert on first HTTPS request.

Wait until you see:
```
Stack is up and healthy.
App:   https://kuiper.example.com
Admin: https://kuiper.example.com/zh/admin/users
```

Visit the URL, log in with your `ADMIN_USERNAME` / `ADMIN_PASSWORD`,
**immediately change the password from your profile**, then issue
invite codes for the team via `/admin/invites`.

---

## 7. Day-2 operations

```bash
./deploy.sh status     # container + per-service health
./deploy.sh logs       # tail caddy + app + mysql + redis
./deploy.sh update     # git pull + rebuild + restart
./deploy.sh down       # stop everything (data preserved)
./deploy.sh backup     # mysqldump + tar volumes into deploy/backups/
```

### Backups

`deploy.sh backup` produces two artifacts per run:

- `backups/mysql-<TS>.sql.gz` — full logical dump (~MB)
- `backups/volumes-<TS>.tar.gz` — Caddy state + app uploads (if local storage)

Schedule via cron:

```cron
# /etc/cron.d/kuiper-backup
30 3 * * * root cd /opt/kuiperAI/deploy && ./deploy.sh backup >>/var/log/kuiper-backup.log 2>&1
# Keep last 14 days
40 3 * * * root find /opt/kuiperAI/deploy/backups -mtime +14 -delete
```

For off-host backup, pipe each new file into `aws s3 cp` or
`rclone copy`.

### Restoring from a backup

```bash
# Stop the app + restore the SQL dump into MySQL
./deploy.sh down
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d mysql
gunzip -c backups/mysql-<TS>.sql.gz \
  | docker exec -i kuiper-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" "${MYSQL_DATABASE}"
./deploy.sh up
```

For volume restore, untar `volumes-<TS>.tar.gz` over the named volume
mount paths.

### Logs

App + worker logs go through Pino in JSON to stdout (captured by
Docker). Caddy access logs rotate in the `caddy-logs` volume:

```bash
docker exec kuiper-caddy tail -f /var/log/caddy/access.log
```

Set `LOG_LEVEL=DEBUG` in `.env.prod` and `./deploy.sh up -d app` to
crank verbosity temporarily.

---

## 8. Common problems

### Caddy can't get a certificate

```
"obtain failed: ... too many certificates already issued"
```

You hit the Let's Encrypt rate limit (50 certs/week per registered
domain). Use a different subdomain, wait a week, or test with the
staging endpoint by adding to the global block in `Caddyfile`:

```
acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
```

### `NEXTAUTH_SECRET must be 32+ chars`

Compose refuses to start with a weak secret. Run
`openssl rand -hex 32` and paste the output (or use `init-secrets`).

### Port 80/443 already in use

Some droplet images have nginx running:

```bash
systemctl stop nginx && systemctl disable nginx
```

### `prisma db push` errors with "table already exists" on upgrade

You're upgrading from a pre-multi-user kuiperAI install. The
`db push` command itself is idempotent — but if the schema deviates
significantly, you may need to `--accept-data-loss` (CAREFUL — this
drops columns the new schema doesn't define). Inspect the diff with
`prisma migrate diff` before committing.

### "I logged in but I'm not admin"

Most likely the bootstrap admin already exists with the wrong role,
or your account was registered through an open signup before
multi-user shipped (so it has `role='user'`). Two fixes:

```bash
# Promote your account to admin manually
docker exec -it kuiper-mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" -e \
  "UPDATE kuiper.user SET role='admin' WHERE name='your-username';"

# Or rotate the bootstrap admin's invite to bring up a fresh admin
docker exec kuiper-app npx tsx scripts/bootstrap-admin.ts --rotate-invite
```

---

## 9. Hardening checklist (do before letting your team in)

- [ ] Change the bootstrap admin password from the seeded value
- [ ] Issue individual invite codes per teammate (don't share the
      bootstrap admin login)
- [ ] Disable root SSH password login: set
      `PasswordAuthentication no` in `/etc/ssh/sshd_config`,
      `systemctl restart ssh`
- [ ] Schedule the cron backup
- [ ] Enable DigitalOcean monitoring alerts (CPU / disk / bandwidth)
- [ ] Verify HTTPS A+ rating: https://www.ssllabs.com/ssltest/
- [ ] Set up off-host backup destination
- [ ] If exposing `/admin/queues` (Bull Board), set
      `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` in `.env.prod` so
      basic auth gates it

---

## 10. Architecture overview

```
                        Internet (80/443)
                            │
                            ▼
                ┌────────────────────────┐
                │       Caddy            │
                │  (Lets Encrypt auto)   │
                │  Caddyfile mounted ro  │
                └───────┬────────────────┘
                        │ http://app:3000
                        ▼
        ┌───────────────────────────────────┐
        │         kuiperAI app              │
        │  Next.js 15 + NextAuth + Prisma   │
        │  + Bull Board workers (port 3010) │
        │                                   │
        │  on first boot:                   │
        │   prisma db push                  │
        │   migrate-user-role-to-member     │
        │   bootstrap-admin                 │
        └─────┬──────────────────┬──────────┘
              │                  │
              ▼                  ▼
   ┌─────────────────┐  ┌─────────────────┐
   │    MySQL 8.0    │  │   Redis 7       │
   │  (kuiper db)    │  │  (BullMQ queues)│
   │  internal only  │  │  internal only  │
   └────────┬────────┘  └────────┬────────┘
            │                    │
            ▼                    ▼
      mysql-data            redis-data
      (named volume)        (named volume)
```

All four containers share `kuiper-network` (private bridge). Only Caddy
publishes ports to the host. MySQL + Redis are reachable only by name
from inside the network.

---

*Generated as part of the multi-user K6 phase. See MULTI_USER_HANDOFF.md
at the repo root for the broader feature context.*
