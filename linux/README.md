# Haru on Linux

The Linux branch of Haru. Everything below is done by the app itself now —
there is no PowerShell, no `cmd`, no Windows location service in the path for
the features that made sense here.

## Running from a checkout

```bash
npm install
npm run build
./linux/install.sh
```

That writes a systemd **user** unit, a launcher at `~/.local/bin/haru`, and a
menu entry, then enables and starts her. Nothing needs root. Her logs go to the
journal, which rotates them:

```bash
journalctl --user -u haru.service -f
```

`~/.local/bin/haru` starts her, or surfaces her window if she is already
running.

## What works, and how

| Feature | Linux |
|---|---|
| Seeing which program you are in | `hyprctl -j activewindow` |
| Noticing something go fullscreen | the same, `fullscreen` on the active window |
| Ducking her voice while she talks | `wpctl` (PipeWire), or `pactl` where it is absent |
| Opening / closing programs | freedesktop `.desktop` entries, launched with `gio` |
| Shutting down, restarting, sleeping, locking | `shutdown`, `systemctl`, `loginctl` |
| Standing aside for a game | the foreground window, matched the same way as Windows |

The startup report says which of these are available and, for any that are not,
which tool is missing:

```
[capabilities] 1 of 5 platform features are off on linux:
[capabilities]   a location fix — needs the GeoClue location portal, which is not wired yet
```

**A location fix is still off.** The Windows path uses the WinRT geolocator; the
Linux equivalent is the GeoClue portal, which needs a session portal client this
app does not carry. She says so rather than guessing from a third-party IP
lookup nobody asked for.

## The model, and the battery

Ollama's model residency follows the power source. On mains she is held
resident (`keep_alive: -1`), as before; on battery she is released five minutes
after a request, so the discrete card can go back to sleep between
conversations. Override either with `HARU_OLLAMA_KEEP_ALIVE` — seconds, or a
duration such as `10m`, or `0` to unload between turns on a machine that shares
the card. The choice is logged at startup and whenever the plug moves.

If her model is larger than the card's memory — a 9B on a 6 GB laptop GPU, say
— Ollama spills layers to CPU and the card stays awake even at `keep_alive: -1`.
A model that fits is the single biggest saving on a laptop.

## Packaging

```bash
npm run package:linux      # AppImage + deb in release/
```

The packaged build ships a SUID sandbox, so it does not pass `--no-sandbox`;
the source install does, because a checkout has no sandbox helper installed.
