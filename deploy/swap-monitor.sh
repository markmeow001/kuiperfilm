#!/usr/bin/env bash
#
# Swap thrashing detector — alerts before the box becomes unreachable.
#
# What "thrashing" looks like:
#   - swap usage > 80% AND swap deltas every 30s > 50MB
#   - i.e. kernel is paging in/out faster than the working set fits
#
# This script samples /proc/vmstat twice 30s apart and shouts if the
# deltas look like thrashing. Cron it every 5 min; pipe to admin Slack
# / email / DO event log when it does fire.
#
# Usage:
#   ./swap-monitor.sh                  # one-shot, prints + exits
#   ./swap-monitor.sh --json           # machine-readable
#
# Cron (every 5 min):
#   */5 * * * * /opt/kuiperAI/deploy/swap-monitor.sh >> /var/log/swap-monitor.log 2>&1

set -euo pipefail

mode="text"
[[ "${1:-}" == "--json" ]] && mode="json"

# Sample 1
PSWPIN_1="$(awk '/^pswpin/{print $2}' /proc/vmstat)"
PSWPOUT_1="$(awk '/^pswpout/{print $2}' /proc/vmstat)"
SWAP_USED_1="$(free -m | awk '/^Swap:/{print $3}')"
SWAP_TOTAL="$(free -m | awk '/^Swap:/{print $2}')"

sleep 30

# Sample 2
PSWPIN_2="$(awk '/^pswpin/{print $2}' /proc/vmstat)"
PSWPOUT_2="$(awk '/^pswpout/{print $2}' /proc/vmstat)"
SWAP_USED_2="$(free -m | awk '/^Swap:/{print $3}')"
RAM_AVAIL="$(free -m | awk '/^Mem:/{print $7}')"
LOAD_1M="$(awk '{print $1}' /proc/loadavg)"

# Deltas
PSWPIN_DELTA=$((PSWPIN_2 - PSWPIN_1))
PSWPOUT_DELTA=$((PSWPOUT_2 - PSWPOUT_1))

# Each "page" = 4KB; convert to MB/30s
PSWPIN_MB=$((PSWPIN_DELTA * 4 / 1024))
PSWPOUT_MB=$((PSWPOUT_DELTA * 4 / 1024))

# Thrash heuristic: swap > 80% AND delta > 50MB/30s either direction
SWAP_PCT=0
if [[ "${SWAP_TOTAL}" -gt 0 ]]; then
  SWAP_PCT=$((SWAP_USED_2 * 100 / SWAP_TOTAL))
fi
THRASHING="false"
if [[ "${SWAP_PCT}" -gt 80 && ( "${PSWPIN_MB}" -gt 50 || "${PSWPOUT_MB}" -gt 50 ) ]]; then
  THRASHING="true"
fi

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ "${mode}" == "json" ]]; then
  printf '{"ts":"%s","swap_used_mb":%d,"swap_total_mb":%d,"swap_pct":%d,"pswpin_mb_30s":%d,"pswpout_mb_30s":%d,"ram_avail_mb":%d,"load_1m":%s,"thrashing":%s}\n' \
    "${TS}" "${SWAP_USED_2}" "${SWAP_TOTAL}" "${SWAP_PCT}" \
    "${PSWPIN_MB}" "${PSWPOUT_MB}" "${RAM_AVAIL}" "${LOAD_1M}" "${THRASHING}"
else
  if [[ "${THRASHING}" == "true" ]]; then
    printf '[%s] ⚠ THRASHING: swap=%d/%dMB (%d%%), pswpin=%dMB/30s, pswpout=%dMB/30s, RAM avail=%dMB, load=%s\n' \
      "${TS}" "${SWAP_USED_2}" "${SWAP_TOTAL}" "${SWAP_PCT}" \
      "${PSWPIN_MB}" "${PSWPOUT_MB}" "${RAM_AVAIL}" "${LOAD_1M}"
    exit 1
  else
    printf '[%s] ok: swap=%d/%dMB (%d%%), pswpin=%dMB/30s, pswpout=%dMB/30s, RAM avail=%dMB, load=%s\n' \
      "${TS}" "${SWAP_USED_2}" "${SWAP_TOTAL}" "${SWAP_PCT}" \
      "${PSWPIN_MB}" "${PSWPOUT_MB}" "${RAM_AVAIL}" "${LOAD_1M}"
  fi
fi
