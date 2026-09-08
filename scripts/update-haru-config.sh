#!/usr/bin/env bash
# Keep Vault/Haru/Configuration.md's live snapshot current.
# Runs hourly via cron; also run manually after any change to Haru's config.
set -uo pipefail

VAULT="${VAULT:-$HOME/Vault}"
FILE="$VAULT/Haru/Configuration.md"
START='<!-- LIVE-SNAPSHOT-START -->'
END='<!-- LIVE-SNAPSHOT-END -->'

snapshot="$(python3 - <<'PY'
import json, os, socket, subprocess, datetime

home = os.path.expanduser('~')
cfg = {}
try:
    cfg = json.load(open(os.path.join(home, '.config/haru-desktop/config.json')))
except Exception as e:
    print(f'<!-- could not read config.json: {e} -->')

def port_up(port, host='127.0.0.1'):
    try:
        s = socket.create_connection((host, port), timeout=1.5)
        s.close()
        return True
    except OSError:
        return False

def basename(p):
    return os.path.basename(p) if isinstance(p, str) else '—'

lines = []
lines.append('## Live snapshot — as of %s' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M'))
lines.append('')

ai = cfg.get('ai', {})
conv, nudge = ai.get('conversation', {}), ai.get('nudge', {})
emot = ai.get('config', {})
esc = cfg.get('escalate', {}).get('provider', {})
esc_words = cfg.get('escalate', {}).get('minWords', '—')

lines.append('### Brain')
lines.append('')
lines.append('| Role | Provider | Model | Endpoint | Temp |')
lines.append('|---|---|---|---|---|')
for role, c in (('Main conversation', conv), ('Nudges', nudge)):
    lines.append('| %s | `%s` | `%s` | `%s` | %s |' % (role, c.get('provider', '—'), c.get('model', '—'), c.get('endpoint', '—'), c.get('temperature', '—')))
if emot:
    lines.append('| Emotion classifier | `%s` | `%s` | `%s` | %s |' % (emot.get('provider', '—'), emot.get('model', '—'), emot.get('endpoint', '—'), emot.get('temperature', '—')))
if esc:
    lines.append('| Escalation (≥%s words) | `%s` | `%s` | `%s` | %s |' % (esc_words, esc.get('provider', '—'), esc.get('model', '—'), esc.get('endpoint', '—'), esc.get('temperature', '—')))
lines.append('')
lines.append('- Context: `ctx=%s`, `historyChars=%s`, `summaryDays=%s`' % (ai.get('numCtx', '—'), ai.get('historyChars', '—'), ai.get('summaryDays', '—')))
lines.append('')

try:
    out = subprocess.run(['ollama', 'list'], capture_output=True, text=True, timeout=10).stdout
    if out.strip():
        lines.append('### Local Ollama models')
        lines.append('')
        lines.append('```')
        lines.append(out.strip())
        lines.append('```')
        lines.append('')
except Exception:
    pass

v = cfg.get('voice', {})
lines.append('### Voice')
lines.append('')
lines.append('| | |')
lines.append('|---|---|')
lines.append('| Engine | `%s` @ `%s` |' % (v.get('engine', '—'), v.get('endpoint', '—')))
lines.append('| Voice | `%s` (%s) |' % (v.get('voiceId', '—'), basename(v.get('voice', '—'))))
lines.append('| Speed / volume | %s / %s |' % (v.get('speed', '—'), v.get('volume', '—')))
lines.append('| Web enabled / desktop | %s / %s |' % (v.get('webEnabled', '—'), v.get('desktopEnabled', '—')))
lines.append('')

checks = [
    (7860, 'breeze-server (TTS)'),
    (7861, 'breeze-server (alt)'),
    (9880, 'GPT-SoVITS api_v2'),
    (9881, 'asr-server (STT)'),
    (8787, 'web door'),
    (11434, 'ollama (tailscale)'),
    (11435, 'ollama (local)'),
    (11436, 'emotion llama-server'),
]
lines.append('### Services')
lines.append('')
lines.append('| Port | Service | Status |')
lines.append('|---|---|---|')
down = []
for port, name in checks:
    up = port_up(port)
    lines.append('| %s | %s | %s |' % (port, name, 'up' if up else '**DOWN**'))
    if not up:
        down.append('%s (:%s)' % (name, port))
lines.append('')

if down:
    lines.append('### Known issues')
    lines.append('')
    lines.append('- Down: ' + ', '.join(down))
    lines.append('')

print('\n'.join(lines))
PY
)"

if [ -z "$snapshot" ]; then
    echo "snapshot generation failed" >&2
    exit 1
fi

python3 - "$FILE" "$snapshot" <<'PY'
import sys
path, snap = sys.argv[1], sys.argv[2]
start, end = '<!-- LIVE-SNAPSHOT-START -->', '<!-- LIVE-SNAPSHOT-END -->'
with open(path) as f:
    content = f.read()
block = f"{start}\n\n{snap}\n{end}"
if start in content and end in content:
    pre = content.split(start)[0]
    post = content.split(end, 1)[1]
    content = pre + block + post
else:
    content = content.rstrip() + '\n\n' + block + '\n'
with open(path, 'w') as f:
    f.write(content)
print(f"updated {path}")
PY