#!/usr/bin/env bash
# Diagnose why ./deploy.sh up triggers "shell level (1000) too high".
# Read-only — does not modify anything.

echo "=== current shell ==="
echo "SHLVL  = ${SHLVL:-unset}"
echo "BASHPID= ${BASHPID:-unset}"
echo "PPID   = ${PPID:-unset}"
echo ""

echo "=== env vars containing SHLVL or BASH_ENV ==="
env | grep -iE "SHLVL|BASH_ENV|^ENV=" || echo "(none)"
echo ""

echo "=== rc files present ==="
ls -la /root/.bashrc /root/.profile /root/.bash_profile /etc/bash.bashrc /etc/profile 2>&1 | grep -v "No such" | head
echo ""

echo "=== SHLVL references in rc / profile files ==="
HITS=0
for f in /root/.bashrc /root/.profile /root/.bash_profile /etc/bash.bashrc /etc/profile /etc/profile.d/*.sh; do
  if [ -f "$f" ]; then
    matches=$(grep -nH "SHLVL" "$f" 2>/dev/null)
    if [ -n "$matches" ]; then
      echo "$matches"
      HITS=$((HITS+1))
    fi
  fi
done
[ "$HITS" -eq 0 ] && echo "(no SHLVL refs in rc files)"
echo ""

echo "=== ulimits ==="
ulimit -a
echo ""

echo "=== systemd cgroup limits for this shell ==="
cat /proc/self/cgroup 2>/dev/null | head -5
echo "pids.max:    $(cat /sys/fs/cgroup/pids.max 2>/dev/null || echo unknown)"
echo "pids.current:$(cat /sys/fs/cgroup/pids.current 2>/dev/null || echo unknown)"
echo ""

echo "=== process count ==="
echo "Total: $(ps -e --no-headers | wc -l)"
echo "Root:  $(ps -e --no-headers -u root | wc -l)"
echo ""

echo "=== bash version ==="
bash --version | head -1
echo ""

echo "=== test 1: spawn a normal sub-bash and report its SHLVL ==="
bash -c 'echo "  sub-bash SHLVL=$SHLVL"' 2>&1 | head -3
echo ""

echo "=== test 2: spawn bash --noprofile --norc and report its SHLVL ==="
bash --noprofile --norc -c 'echo "  noprofile/norc SHLVL=$SHLVL"' 2>&1 | head -3
echo ""

echo "=== test 3: try to fork docker info ==="
docker info 2>&1 | head -5
echo ""

echo "=== test 4: try the exact thing deploy.sh does first ==="
echo 'cd $(dirname $0) && pwd test:'
( cd "$(dirname "${BASH_SOURCE[0]}")" && pwd ) 2>&1
echo ""

echo "=== done ==="
