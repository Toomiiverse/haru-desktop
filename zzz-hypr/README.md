# zzz-hypr

Hyprland rice pulled from Zenless Zone Zero's site UI: near-black chassis,
acid-green (`#d3fd00`) accent, thick sticker borders, italic condensed type.

## Install

Requires: Anton (or Archivo Black) and JetBrainsMono Nerd Font installed.

```bash
ln -s ~/zzz-hypr/hypr/zzz-colors.conf ~/.config/hypr/zzz-colors.conf
ln -s ~/zzz-hypr/hypr/zzz-theme.conf ~/.config/hypr/zzz-theme.conf
# add to hyprland.conf: source = ~/.config/hypr/zzz-theme.conf

ln -s ~/zzz-hypr/hyprlock.conf ~/.config/hypr/hyprlock.conf
ln -s ~/zzz-hypr/waybar/style.css ~/.config/waybar/style.css
ln -s ~/zzz-hypr/waybar/config.jsonc ~/.config/waybar/config.jsonc
ln -s ~/zzz-hypr/rofi/zzz.rasi ~/.config/rofi/zzz.rasi   # rofi -show drun -theme zzz
ln -s ~/zzz-hypr/kitty/zzz.conf ~/.config/kitty/zzz.conf # include zzz.conf in kitty.conf
ln -s ~/zzz-hypr/mako/config ~/.config/mako/config
```

Skipped for now: full GTK theme, animated marquee text, halftone textures —
add if the static rice feels flat after living with it a week.
