#!/usr/bin/env bash
# Switches speech to speech on for this box: writes the evi block and a fresh
# hook secret into config.json (stop → backup → edit → start, since the running
# app rewrites config.json on its own).
#
#   scripts/install-evi.sh <hume config id> [hook url]
#
# The config id comes from scripts/evi-config.mjs. The hook URL is where Hume
# reaches this box — the Tailscale Funnel path on 8443 by default. The secret
# is made here and never leaves config.json: the app hands it to Hume at the
# start of every call, and Hume hands it back at the hook.
set -euo pipefail
config_id=${1:?Hume EVI config id}
url=${2:-https://haruserver.tail6da04d.ts.net:8443/api/evi/chat/completions}
cfg_dir=~/.config/haru-desktop
cfg=$cfg_dir/config.json
secret=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

systemctl --user stop haru.service
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
cp "$cfg" "$cfg.before-evi-$stamp"
node - "$cfg" "$config_id" "$url" "$secret" <<'JS'
const fs = require('fs');
const [cfg, configId, publicUrl, secret] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
const was = c.evi || {};
c.evi = { ...was, enabled: true, configId, publicUrl, voiceId: was.voiceId || 'c84f5efd-f6ab-40d4-9a47-23f27cfaa524', dailyMinutesCap: typeof was.dailyMinutesCap === 'number' ? was.dailyMinutesCap : 60 };
// The app's own no-keyring fallback form (see encryptSecret in main.ts).
c.eviClmSecret = 'plain:' + secret;
fs.writeFileSync(cfg, JSON.stringify(c, null, 2));
console.log('evi =', JSON.stringify({ ...c.evi, usage: undefined }));
JS
systemctl --user start haru.service
echo "Backup: $cfg.before-evi-$stamp"
echo "Now: ~/haru-desktop/scripts/update-haru-config.sh, then check ~/haru.log for '[evi] ready'."
