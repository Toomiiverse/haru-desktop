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
sleep 1

echo "==> starting her"
# --password-store=basic because a headless box has no keyring, and without it
# no API key can be saved at all.
setsid nohup env DISPLAY="${DISPLAY_NUM}" npm start -- \
  --password-store=basic --no-sandbox >"${LOG}" 2>&1 < /dev/null &

sleep 8
echo "==> she says:"
tail -6 "${LOG}" | sed 's/^/    /'

echo "==> web door:"
printf '    %s\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/ || echo 000)"
