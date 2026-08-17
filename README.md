# Haru Desktop

A desktop companion foundation built with Electron, React, TypeScript, and Vite.

## Run it

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run dev` for development, or `npm run package` to create a Windows installer.

## Voice

Haru is silent until an engine is picked in **Setup → Voice**. Everything runs on your
machine; no reply is sent anywhere to be spoken.

**Windows built-in** needs no setup and is the fastest way to hear her, but it is a stock
Microsoft voice, and it hands over no audio — only speech. Her mouth is animated at a
plausible syllable rate rather than driven by what you actually hear. Use it to check the
wiring, not to judge the result.

**GPT-SoVITS** is the one to use if you want her to sound like a particular voice. It
clones from a single short clip, and the same toolchain fine-tunes on a longer recording
when the clone is not close enough.

1. Grab the Windows package from [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) —
   it bundles its own Python.
2. Start the API server (`api_v2.py`); it listens on `9880`.
3. In Setup → Voice, pick GPT-SoVITS, set the endpoint to `http://127.0.0.1:9880`, give
   the full path to a clean 3–10 second reference clip, and type **exactly** what that
   clip says. A transcript that does not match the audio is the single most common
   reason a clone comes out wrong — it is not optional metadata.
4. Press **Test voice**.

To train rather than clone: use the project's own WebUI to slice, transcribe and label a
dataset — ten minutes of clean single-speaker audio is a workable start, an hour is
comfortable — then train the GPT and SoVITS weights and point the API server at the
resulting checkpoints. The app needs no changes; it only ever sees the endpoint.

**Local server (OpenAI API)** covers anything exposing `/v1/audio/speech` —
`openedai-speech` wrapping an XTTS clone, Kokoro-FastAPI, LocalAI. Set the endpoint to
the base URL including `/v1` and the voice to whatever name that server knows.

Adding another engine means one more case in `synthesise` in `electron/voice.ts`; nothing
downstream of it knows which engine produced the audio.

## Speaking to her

Off until an engine is picked in **Setup → Speaking to her**. With it on, a
microphone button appears beside the message box: press it, say your piece, press
it again. The clip is transcribed on this machine, never written to disk, and
dropped as soon as the words come back.

The server borrows the Python that GPT-SoVITS already bundles — that install
carries faster-whisper and a CUDA torch, so there is nothing new to install.

1. Run `electron\start-haru-asr.cmd`. It listens on `9881`.
2. The first request downloads the model (`small.en`, a few hundred MB) and takes
   a minute; every one after that is a fraction of a second.
3. In Setup → Speaking to her, pick **Local server**, then press **Check the
   server**.

Set `HARU_ASR_MODEL` to use a different Whisper size, or `HARU_PYTHON` if
GPT-SoVITS lives somewhere else. The route is OpenAI's
`/v1/audio/transcriptions`, so whisper.cpp's server or anything else speaking it
can be dropped in by changing the endpoint alone.

## Running her on a server

She can live on an always-on machine and be reached from a desktop and a phone,
with the thinking done somewhere else again — a rented GPU, say. Three things
make that work, and a few stop working.

**She still needs a logged-in desktop session.** This is an Electron app: it
opens windows, watches the screen and talks to an audio device. A headless
Windows Server with nobody signed in will not run her; an always-on PC with an
autologin account will.

**The clients are the web version.** Turn it on in Setup → *Reaching her from a
phone*, put a tunnel in front of `127.0.0.1:8787`, then open that URL and install
it — Chrome and Edge offer it from the address bar, iOS from Share → Add to Home
Screen. It gets its own window, its own icon and no address bar, on both.

**What does not come with the repo.** These are hers, not the code's:

- `%APPDATA%\haru-desktop\config.json` — the conversation, her memories, the
  journal, the agenda, her speech corrections. Copy it to carry her across.
- `%APPDATA%\haru-desktop\live2d-models\` — several hundred megabytes.
- GPT-SoVITS and its weights, if you want her voice. A separate install.

**The API keys will not survive the copy.** They are encrypted with Windows
DPAPI, which is tied to the account and the machine that wrote them. They travel
as unreadable noise and have to be typed again in Setup. Nothing warns you — she
simply cannot reach the model until you do.

**Run one of her, not two.** Two installs means two `config.json` files, and they
diverge the moment either is used: the same memory in two versions, with no merge.

### What stops existing

Everything that acts on the machine she runs on now acts on the server, which is
usually not what was wanted:

| Feature | On a server |
| --- | --- |
| Screen watching | watches an idle server desktop |
| Screenshot reactions | the server's screen |
| Open, close, shut down | the server, not yours |
| Game awareness | a server plays nothing |
| The roaming companion window | a screen nobody is looking at |

Setup is desktop-only too. Changing a model, a voice or a key means opening her
window on the server — over remote desktop, or at the machine itself.

## Architecture

- `electron/`: native window lifecycle and secure IPC bridge.
- `electron/voice.ts`: text-to-speech boundary — prepares the text and adapts to each engine's HTTP contract.
- `electron/listen.ts`: speech-to-text boundary — the mirror of `voice.ts`, same HTTP contract in reverse.
- `electron/asr-server.py`: the local Whisper server behind it, run by `start-haru-asr.cmd`.
- `src/companion/microphone.ts`: capture, downsample and WAV encoding for dictation.
- `src/companion/mouth.ts`: playback queue and the amplitude the lip sync is driven from.
- `src/components.tsx`: UI components.
- `src/services/ai.ts`: provider boundary; replace the demonstration provider with Ollama, OpenAI, or xAI adapters.
- `src/types.ts`: shared renderer data contracts.

Speech is synthesised in the main process and played in the companion window, the one
that holds the Live2D model. That is what lets the mouth follow the audio sample by
sample instead of being timed against the text and hoped to line up.

The UI deliberately has no direct access to secrets or Node APIs. The preload bridge exposes only persisted-setting operations.
