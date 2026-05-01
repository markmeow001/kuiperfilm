# Production Hardening Checklist

These tasks were on the deferred backlog when the **2026-05-01 OOM**
incident took the droplet down for ~30 minutes. Implementing them
prevents repeat incidents, protects user data, and makes future
deploys observable.

## What happened on 2026-05-01 OOM

Build 32 (Next.js production rebuild after merging 11+ feature
commits) ran on a 1vCPU/2GB Basic droplet. With kuiper-app + mysql +
redis + caddy already using ~1.8GB, the build needed another
1.5-2GB for webpack + type-check. The kernel page-thrashed the 4GB
swap partition, drove disk I/O to 270MB/s, drove the 1m load average
above 70, and made SSH unreachable for ~25 minutes. Recovery
required (and ultimately the user upgraded the droplet to
2vCPU/4GB).

Root cause: **memory shortage**, not CPU.

## P0 — Backup (the loudest miss this incident exposed)

We had **no MySQL backup**. If InnoDB had truly corrupted during
the swap thrash, the entire user / project / character / panel
dataset would be lost.

### Set up nightly MySQL backups

```bash
# 1. Add R2 backup creds to .env.prod.
# Var names are R2_BACKUP_* (NOT R2_*) — intentionally distinct from
# the main app's R2_ACCESS_KEY_ID. Issue a separate API token in the
# Cloudflare dashboard scoped only to R2_BACKUP_BUCKET; that way a
# leaked main token can't reach (or delete) backups.
R2_BACKUP_BUCKET=kuiperfilm-backups
R2_BACKUP_ACCESS_KEY_ID=<scoped-token-id>
R2_BACKUP_SECRET_ACCESS_KEY=<scoped-token-secret>
R2_BACKUP_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com

# 2. Install aws CLI on the droplet (R2 talks S3 protocol)
apt-get install -y awscli

# 3. Smoke-test
cd /opt/kuiperAI/deploy
./db-backup.sh

# 4. Add to root crontab (daily at 03:00 UTC)
crontab -e
# Append:
# 0 3 * * * cd /opt/kuiperAI/deploy && ./db-backup.sh >> /var/log/kuiper-backup.log 2>&1
```

The script:
- runs `mysqldump --single-transaction` so it doesn't lock writes
- pipes through gzip directly (no uncompressed copy on disk — saves IO)
- uploads to R2
- keeps the 14 most recent local copies

### Take a DO snapshot before risky operations

DO disk-level snapshots work even when the OS is unreachable. Use
them as a "panic button" before:
- droplet resize
- major schema migration
- prisma db push that touches existing tables
- migration scripts that mutate production data

UI: DO panel → Droplet → Snapshots → Take Snapshot. Cost ~$0.06/GB/mo
— delete after the risky operation succeeds.

## P0 — Resource monitoring (so we see thrash before SSH dies)

### Run swap-monitor.sh every 5 min

```bash
crontab -e
# Append:
# */5 * * * * /opt/kuiperAI/deploy/swap-monitor.sh >> /var/log/swap-monitor.log 2>&1
```

When swap > 80% AND pswpin/out > 50MB/30s, the script exits non-zero.
Pipe stderr to a webhook / email / DO event log to wake an admin.

### Run deploy-prep.sh before every ./deploy.sh up

```bash
cd /opt/kuiperAI/deploy
./deploy-prep.sh         # docker prune + RAM/disk/load check
./deploy.sh up
```

`deploy-prep.sh --check` exits non-zero if disk < 5GB free, RAM +
swap free < 2GB, or 1m load > vCPU × 4. Use as a CI gate.

## P1 — Lock down access

### SSH key-only login (kill password auth)

```bash
# 1. Verify your key is in /root/.ssh/authorized_keys
ssh root@<droplet-ip> 'cat ~/.ssh/authorized_keys | wc -l'   # > 0

# 2. Edit /etc/ssh/sshd_config:
PasswordAuthentication no
PermitRootLogin prohibit-password
ChallengeResponseAuthentication no

# 3. systemctl reload sshd

# 4. Open a NEW terminal and verify you can still log in
#    BEFORE closing the current session
```

### BULL_BOARD basic auth

The bull-board admin queue panel runs on port 3010 with no
authentication. The code already supports basic auth — just set the
env vars:

```bash
# Add to .env.prod:
BULL_BOARD_USER=admin
BULL_BOARD_PASSWORD=<long-random-string>
```

Restart kuiper-app:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  restart kuiper-app
```

## P1 — DO monitoring alerts

DO panel → Monitoring → Alerts. Recommended thresholds for a
2vCPU/4GB droplet:

- CPU > 80% for 10 min   → email
- Memory > 85% for 5 min → email + SMS
- Disk > 90%             → email

Without these, the only signal is "the site is down".

## P2 — Build observability

Long-term, run Next.js production builds in **GitHub Actions**, not on
the droplet. Push the resulting Docker image to GHCR; the droplet
just `docker pull && docker compose up`. Benefits:
- Zero CPU / memory pressure on the droplet during build
- Build is reproducible + has artefacts
- Deploy is 30 seconds instead of 5-25 minutes

This is the right shape for a real production setup — current
build-on-droplet is "demo speed".

---

Owner: Session B (Anthropic CLI), 2026-05-01.
Triggered by: build 32 OOM, droplet upgrade pending.
