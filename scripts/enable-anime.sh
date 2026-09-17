#!/usr/bin/env bash
# Switch on "let's watch Naruto" (electron/anime.ts) on this box.
#
# Haru's store is electron-store: it reads config.json once at start and writes
# it back whole, so the file is only safe to edit while she is stopped. This
# stops her, writes the three keys the link needs, and starts her again. The
# Jellyfin key is copied out of Jellyfin's own database (it keeps its keys
# there, not in a file); Sonarr's and Prowlarr's are read from their config.xml
# at call time and need nothing here.
#
# Run as toomii:  ~/haru-desktop/scripts/enable-anime.sh
set -euo pipefail

CONFIG="$HOME/.config/haru-desktop/config.json"
JELLYFIN_DB="/opt/jellyfin/config/data/jellyfin.db"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ -r "$JELLYFIN_DB" ] || { echo "cannot read $JELLYFIN_DB" >&2; exit 1; }
[ -w "$CONFIG" ] || { echo "cannot write $CONFIG" >&2; exit 1; }

echo "stopping haru.service"
systemctl --user stop haru.service

cp -p "$CONFIG" "$CONFIG.before-anime-$STAMP"
echo "backup at $CONFIG.before-anime-$STAMP"

python3 - "$CONFIG" "$JELLYFIN_DB" <<'PY'
import json, os, shutil, sqlite3, sys, tempfile
config_path, db_path = sys.argv[1], sys.argv[2]
# A copy, so Jellyfin's own connection is not disturbed.
tmp = tempfile.mkdtemp()
shutil.copy(db_path, tmp)
db = sqlite3.connect(os.path.join(tmp, 'jellyfin.db'))
key = db.execute("select AccessToken from ApiKeys where Name='Haru_Anime'").fetchone()
user = db.execute("select Id from Users order by LastActivityDate desc limit 1").fetchone()
db.close(); shutil.rmtree(tmp)
if not key or not user: sys.exit('no Haru_Anime key or no user in Jellyfin')
config = json.load(open(config_path))
config['jellyfin'] = {'url': 'http://127.0.0.1:8096', 'userId': user[0].lower()}
# plain: says outright it is not encrypted — the same trade as her other keys on this headless box.
config['jellyfinApiKey'] = 'plain:' + key[0]
anime = config.get('anime') if isinstance(config.get('anime'), dict) else {}
anime['enabled'] = True
anime.setdefault('linkUrl', 'http://100.123.135.10:8096')
config['anime'] = anime
out = config_path + '.tmp'
json.dump(config, open(out, 'w'), indent=2)
os.replace(out, config_path)
print('config: jellyfin url/userId, jellyfinApiKey and anime.enabled written')
PY

echo "starting haru.service"
systemctl --user start haru.service
sleep 4
systemctl --user is-active haru.service && echo "up — ask her: let's watch some Made in Abyss"
