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

### Fitting a 9B onto a 6 GB card

Measured on a 6 GB RTX 3060 Laptop, running the desktop on the integrated GPU so
the whole card belongs to Ollama. The budget that matters is not the weights
alone: a vision projector is reserved at load (worst case ~870 MB), plus the KV
cache and compute buffer, so weights must be ≤ ~5.2 GB to keep tools and vision.

The recipe used here:

```bash
# 1. A Q3_K_L quant of a Qwen3.5-9B heretic, with its Q8 vision projector.
ollama pull hf.co/mradermacher/Qwen3.5-9B-ultimate-irrefusable-heretic-GGUF:Qwen3.5-9B-ultimate-irrefusable-heretic.Q3_K_L.gguf

# 2. q8_0 KV — halves the cache against f16, nearly lossless, and buys the
#    headroom for the last layers. In the ollama user unit:
#      Environment=OLLAMA_KV_CACHE_TYPE=q8_0

# 3. Ollama's own estimator is conservative: it split this model 28/33 and left
#    500 MB unused. Bake the measured layer count in so it loads whole.
cat > Modelfile <<'EOF'
FROM hf.co/mradermacher/Qwen3.5-9B-ultimate-irrefusable-heretic-GGUF:Qwen3.5-9B-ultimate-irrefusable-heretic.Q3_K_L.gguf
PARAMETER num_gpu 33
EOF
ollama create haru-heretic -f Modelfile
```

Then point `ai.config.model` and `ai.conversation.model` at `haru-heretic`. The
startup log says which it is: `load_tensors: offloaded 33/33 layers to GPU`, and
the app's own line, `the model is 5.4 GB and the card has 6.0 GB — it fits whole`.

The same math rules out more than it lets in: a 9B at Q4 (~5.7 GB) is a layer or
two short even with the projector at Q8, and a 9B at IQ2 (4.9 GB) fits whole but
costs more in quality than Q3_K_L costs in layers. A 4B-class multimodal model
(Gemma 4 E4B, ~4–5 GB) is the comfortable alternative when the brain can be
smaller.

## Packaging

```bash
npm run package:linux      # AppImage + deb in release/
```

The packaged build ships a SUID sandbox, so it does not pass `--no-sandbox`;
the source install does, because a checkout has no sandbox helper installed.
