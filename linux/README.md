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

### What this line does not run

- **Her voice.** TTS is not part of the laptop version; the engine is left off
  and nothing speech-related starts.
- **A local vision model.** The eyes are hosted, set in **Setup → Showing her
  pictures** (endpoint, provider, model). That is why the brain below is
  **text-only**: a vision projector is reserved at load even when nothing looks
  at a picture, and on a 6 GB card those ~0.87 GB are the difference between a
  Q4 model and a Q3 one.

### Fitting a 9B onto a 6 GB card

Measured on a 6 GB RTX 3060 Laptop, with the desktop on the integrated GPU so
the whole card belongs to Ollama. With no projector, the budget is weights plus
KV and compute — about 0.3 GB — which puts the ceiling at **~6.0 GB of weights**
for a whole-GPU load.

The recipe used here:

```bash
# 1. A Q4_K_M quant of a Qwen3.5-9B heretic (5.6 GB weights).
ollama pull hf.co/mradermacher/Qwen3.5-9B-ultimate-irrefusable-heretic-GGUF:Qwen3.5-9B-ultimate-irrefusable-heretic.Q4_K_M.gguf

# 2. q8_0 KV — halves the cache against f16, nearly lossless, and buys headroom.
#    In the ollama user unit:
#      Environment=OLLAMA_KV_CACHE_TYPE=q8_0

# 3. Build a TEXT-ONLY model from the weights blob alone, so no projector is
#    inherited. `ollama show <pulled> --modelfile` prints two FROM lines: the
#    first is the weights, the second the projector. Keep only the first.
LLM=$(ollama show hf.co/mradermacher/Qwen3.5-9B-ultimate-irrefusable-heretic-GGUF:Qwen3.5-9B-ultimate-irrefusable-heretic.Q4_K_M.gguf --modelfile | grep ^FROM | head -1 | awk '{print $2}')
printf 'FROM %s\nPARAMETER num_gpu 33\n' "$LLM" > Modelfile
ollama create haru-brain -f Modelfile
```

Then point `ai.config.model` and `ai.conversation.model` at `haru-brain`. The
startup log says which it is: `load_tensors: offloaded 33/33 layers to GPU`, and
the app's own line, `the model is 5.6 GB and the card has 6.0 GB — it fits whole`.

Ollama's estimator is the thing to watch, not the card: on both the Q3 and Q4
builds it split the model and left more than 500 MB unused. `num_gpu` is set to
the measured layer count for that reason — check `ollama ps` says `100% GPU`
rather than trusting it. A Q5 (7.7 GB) does not fit at all; a 4B-class
alternative (Gemma 4 E4B, ~4–5 GB) is the fallback if the brain can be smaller.

## Packaging

```bash
npm run package:linux      # AppImage + deb in release/
```

The packaged build ships a SUID sandbox, so it does not pass `--no-sandbox`;
the source install does, because a checkout has no sandbox helper installed.
