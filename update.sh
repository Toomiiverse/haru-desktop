#!/usr/bin/env bash
# Pull, rebuild, restart her — the whole update, on a machine with no desktop.
#
# She runs on a virtual display because a server has no real one, and detached
# from any shell because a server outlives the session that started her. Both are
# easy to forget by hand, and forgetting either is how she quietly dies at the
# next logout.
set -euo pipefail

cd "$(dirname "$0")"
DISPLAY_NUM="${HARU_DISPLAY:-:99}"
LOG="${HARU_LOG:-$HOME/haru.log}"

echo "==> pulling"
git pull --ff-only

echo "==> installing anything new"
npm install --include=dev --no-audit --no-fund

echo "==> building"
npm run build

echo "==> making sure there is a display"
pgrep -f "Xvfb ${DISPLAY_NUM}" >/dev/null || {
  setsid nohup Xvfb "${DISPLAY_NUM}" -screen 0 1280x800x24 >/dev/null 2>&1 < /dev/null &
  sleep 2
}

echo "==> stopping her"
pkill -f "electron \." || true
# Waited out rather than slept past.
#
# Electron holds a single-instance lock in its user data directory and does not
# let go until the main process is actually gone. Start the new one while the old
# one still has it and the new one cannot get it, quits itself on purpose, and
# the update ends with nobody running — silently, because everything up to that
# point succeeded. One second was a guess; this is the same guess with a ceiling
# and a check, and it usually returns in far less.
for _ in $(seq 1 20); do
  pgrep -f "electron \." >/dev/null || break
  sleep 0.5
done
if pgrep -f "electron \." >/dev/null; then
  echo "    she did not stop on her own after ten seconds — insisting"
  pkill -9 -f "electron \." || true
  sleep 1
fi

echo "==> starting her"
# --password-store=basic because a headless box has no keyring, and without it
# no API key can be saved at all.
setsid nohup env DISPLAY="${DISPLAY_NUM}" npm start -- \
  --password-store=basic --no-sandbox >"${LOG}" 2>&1 < /dev/null &

sleep 8
echo "==> she says:"
tail -6 "${LOG}" | sed 's/^/    /'

# Informational only. The web door is off unless it has been turned on in her
# settings, so 000 here is a perfectly ordinary answer and cannot be the test of
# whether the update worked.
echo "==> web door:"
printf '    %s\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/ || echo 000)"

# This is the test, and it is loud on purpose.
#
# Nothing else starts her any more, so an update that quietly finishes with her
# not running is the one failure nobody notices — until she stops answering on
# Discord hours later and it looks like a different problem entirely.
echo "==> still running:"
if pgrep -f "electron \." >/dev/null; then
  printf '    yes\n'
else
  printf '    NO — she did not come back up. The last of %s:\n' "${LOG}"
  tail -20 "${LOG}" | sed 's/^/    /'
  exit 1
fi
