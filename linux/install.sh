#!/usr/bin/env bash
# Install the Linux side of Haru for a source checkout: the systemd user unit,
# the launcher, and a menu entry. The unit is a template — the checkout's real
# path, electron binary and home are substituted in as it is written, because
# systemd runs with its own environment and cannot be told to guess.
#
#   ./linux/install.sh              # installs the checkout this script is in
#   ./linux/install.sh /path/to/app # installs another checkout
#
# It does not install Node, Electron or the model server; run `npm install`
# (and have Ollama up) first. Nothing here needs root.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="${1:-$(dirname "$here")}"
app="$(cd "$app" && pwd)"
electron="$app/node_modules/.bin/electron"

if [ ! -x "$electron" ]; then
  echo "No electron at $electron — run npm install in $app first." >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd is not here; install the unit by hand from linux/haru.service." >&2
  exit 1
fi

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
bin_dir="$HOME/.local/bin"
menu_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$unit_dir" "$bin_dir" "$menu_dir"

sub() {
  sed -e "s|__APP_DIR__|$app|g" \
      -e "s|__ELECTRON__|$electron|g" \
      -e "s|__HOME__|$HOME|g" "$1"
}

sub "$here/haru.service" > "$unit_dir/haru.service"
sub "$here/haru" > "$bin_dir/haru"
chmod 755 "$bin_dir/haru"
sub "$here/haru.desktop" > "$menu_dir/haru.desktop"

systemctl --user daemon-reload
systemctl --user enable --now haru.service

echo "Haru is installed:"
echo "  unit      $unit_dir/haru.service"
echo "  launcher  $bin_dir/haru"
echo "  menu      $menu_dir/haru.desktop"
echo
echo "Her logs are in the journal: journalctl --user -u haru.service -f"
