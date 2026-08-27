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

**She can reach the phone when nothing of hers is open.** Web push, so a
reminder she is chasing, the journal ask, or a thought of her own lands on the
lock screen, and tapping it opens the installed app on the conversation. On an
iPhone this only works from the installed version — Share → Add to Home Screen,
open her from there — because iOS offers push to installed web apps only
(16.4 or newer). Then tap the bell in her top bar and let her. The same bell
holds the preferences: which kinds of interruption are allowed, and the quiet
hours (11pm–8am unless changed) in her timezone during which the phone is left
alone. Several phones can subscribe; each is turned off from its own bell, or
dies on its own when revoked — she notices the refusal and drops it.

There is nothing to configure on the server side: the signing keys make
themselves on first use and live in her config, the private half encrypted the
way every other credential is. The messages go out sealed to the phone, so the
push service in the middle (Apple's, for an iPhone) ferries them unread. She
does not push what she would not say: the same spacing, silencing and mood
gates that stop her pestering in chat stop her pestering the lock screen.

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

### Talking to her from a terminal

`scripts/haru.cjs` is a client for the web door above — not a second Haru, and
deliberately not trying to be one. Everything worth having stays on her side: one
config.json, one transcript, one set of memories, one mood. Ask her something
from a laptop and it lands in the same conversation you left on the desk, because
it is the same conversation.

It needs nothing installed. Node's own fetch, Node's own readline, no build step.

```
haru --login          sign in once; she remembers the machine for 90 days
haru "what's on"      ask and exit
haru                  a prompt to keep typing into
haru --agenda         what is still on the list
haru knowledge …      her stored knowledge
echo "..." | haru     piped in counts as asking
```

### Her stored knowledge

Separate from memory. Memory answers *what she remembers about you*; knowledge
answers *what information she has access to* — documents she has been given to
read, and can look things up in instead of guessing. The two stay apart: memory
lives in `config.json` as today, knowledge lives in a second file,
`knowledge.json`, beside it.

Giving her a document to read:

```
haru knowledge ingest ~/haru/server.md
```

That file is extracted (markdown, text, JSON or PDF), split into chunks, embedded
with the local model and stored. The same file again is a no-op — a changed file
is re-ingested, the old chunks are marked stale rather than deleted, and a
`version` counter on the document is bumped so her answers can tell old from new.

Then she can be asked about it:

```
haru knowledge search "what linux is the server running"
haru knowledge stats
haru knowledge delete haru/server.md
haru knowledge reindex
```

### An Obsidian vault as her knowledge

If you keep your notes in Obsidian, point her at the vault once and it becomes
her knowledge base — a whole folder of markdown, indexed and kept current:

```
haru knowledge vault /path/to/your/vault
```

It walks the vault (skipping `.obsidian/`, `.trash/`, templates and attachments),
reads each note's frontmatter into its metadata, cleans `[[wikilinks]]` so notes
read naturally, and files each note under a category drawn from its folder
(`Projects/` → projects, `Personal/` → personal, `Daily/` → journal, and so on,
overridable by a `category:`/`type:` field in the note itself). Each chunk's
source is the note's path relative to the vault root, so a note that changes is
re-ingested in place — version bumped, old chunks marked stale — and a note
deleted from the vault stops surfacing but stays as history.

The first sync embeds every chunk once (background, never blocks a chat; make
sure `nomic-embed-text` is pulled on the Ollama host first). After that the vault
re-syncs itself hourly — new, changed and deleted notes are picked up with no
command and no re-embedding of notes that have not changed.

Inside a conversation she looks in the vault the same way she looks anywhere
else: the `look_up_knowledge` tool finds the relevant notes and answers with
their source and date.

Inside a conversation she reaches it herself with the `look_up_knowledge` tool,
the way she reaches the web with `search_web`. What is retrieved comes back to
her with its source, its date and a confidence, and she is told to prefer the
most recently updated source when they conflict — so a stale "the server runs
Ubuntu" loses to a current "it runs Arch Linux" instead of arguing with it.

## Knowledge architecture

- `electron/knowledge.ts`: the store — chunk and document records, categories,
  the `knowledge.json` file, content hashing, and the ingest/update/delete
  logic (a changed file supersedes its own old chunks rather than duplicating).
- `electron/chunking.ts`: splitting a document into chunks — markdown-aware, so
  headings, lists, code blocks and tables are kept together rather than cut at
  arbitrary character counts, with configurable size and overlap.
- `electron/embeddings.ts`: the embedding boundary — an `Embedder` interface
  with an Ollama implementation (the default) and an OpenAI-shaped one, plus an
  in-memory cache so a repeated query or a chunk already embedded is never
  embedded twice.
- `electron/ingestion.ts`: the pipeline — pick an extractor by file type, read
  the text, clean it, chunk it, embed it, store it. New file types are one more
  extractor.
- `electron/retrieval.ts`: hybrid search — vector similarity plus keyword
  matching (so "nomic-embed-text" or a file name is found even when the
  embeddings are weak), filtered by category or source, then reranked by
  semantic score, keyword overlap, recency, confidence and any category or
  source boost.
- `electron/context.ts`: turns the retrieved chunks into the prompt — deduped,
  grouped by document, capped in size, each with its source, category, version,
  section, updated date and confidence.
- `electron/retrieveContext.ts`: `retrieveContext(query)` — the one door that
  can reach both memory (`selectMemories`) and knowledge, keeping the two
  systems separate underneath.
- `electron/obsidian.ts`: the vault ingestor — walking an Obsidian vault,
  parsing YAML frontmatter, cleaning wikilinks, mapping folders to categories,
  and diffing the vault against the store so the hourly sync adds, updates and
  removes only what actually changed.

The whole layer is optional and off unless a document is given to her. Embedding
happens through the same Ollama endpoint she already talks to, so there is no new
database, no new service and no new dependency.

## Memory architecture

Her memory of you lives in `config.json` as `memories` and `memory.sessions`,
and it is a lifecycle, not a pile:

- **Observe → extract → classify**: the `remember_about_user` tool hands the
  model's candidates to `memory.ts`, where the worthiness gate (`isWorthRemembering`)
  rejects what is true of anyone, true of nowhere, true only of now, or an
  instruction not to mention something. What survives is scored: **confidence**
  from how it was learned (explicit 0.9, inferred 0.55, activity 0.45) and how
  often it has held up (repeats add evidence, capped at 0.98); **importance**
  from what it is (preferences and relationships 0.8+, medication and project
  facts high, video/game trivia near zero) independent of recency.
- **Retrieve**: each message selects memories by relevance — semantic similarity
  (the same Ollama embedder the knowledge layer uses, refreshed in the
  background; keyword overlap as fallback) weighted by importance, confidence
  and a recency half-life that is ten years for what matters and six weeks for
  trivia. Preferences, relationships and anything of importance 0.8+ are always
  offered. A record of the last retrieval (query, entries, each factor) is kept
  for the inspector in the profile drawer.
- **Consolidate**: once after boot and then daily, duplicates and near-duplicates
  merge — by keyword overlap, or semantic similarity so "nagged" and "corrected"
  can be seen as the same stance — and contradictions are flagged with the older
  claim's confidence reduced. Merges keep provenance: `mergedFrom` ids and the
  evidence log survive, nothing is destroyed.
- **Decay and forget**: low-importance memories drift DORMANT after two idle
  half-lives, ARCHIVED after four, forgotten after six; high-importance ones
  never move on their own. Every departure — decay, consolidation, supersession,
  pruning at the 60-memory cap — is written to the forgetting log, so forgetting
  is explainable from the profile drawer, not silent. Pruning itself uses the
  lifecycle score and never evicts preferences, relationships, high-importance
  records or deliberately archived ones.
- **Episodic**: each finished day becomes a one-line summary (backfilled for any
  day that was missed when the model was down or the app was closed), and a
  second pass promotes up to three important events a day into memory. Raw
  transcripts are kept 90 days and then rolled into summaries only.
- **Activity**: raw telemetry is never stored; the `haunts` list holds places,
  not noise — valueless entries expire after a week, telemetry-shaped keys
  after a day, and a place is only promoted to memory after it shows a pattern
  (repeated visits or a stay spread across days).
- **Memory blocks**: a Letta-inspired context layer on top of the engine —
  labelled, character-limited, agent-editable blocks (`persona`, `human`,
  `preferences`, `relationship`, `current_project`, `working_state`) rendered
  into the prompt with their description and live `chars_current`/`chars_limit`
  budget. Blocks are views, not a second database: values are derived from the
  engine on every render, and the model edits them through `core_memory_append`
  / `core_memory_replace`, which route the content through the same governance
  as everything else (worthiness gate, dedup, confidence starting at 0.55 for
  model proposals, supersession on replace). LLM proposes, Haru decides. The
  `persona` block is read-only to the model — it mirrors the character
  configuration, which only the user edits. Budget cuts are never silent: the
  log reports every trim, and consolidation comes before truncation.

All of it sits behind `electron/store.ts`, the only module that reads or writes
the store files. The facade is deliberately small — typed accessors, atomic
writes, backups before any schema migration, corruption recovery, schema
versioning, and Windows ACL hardening — so the JSON backing (config.json +
knowledge.json) can later be replaced with SQLite, Postgres, a vector store or a
graph database without touching any caller. No such move is planned until JSON
demonstrably stops being enough; until then, no new database, no new service.

Carrying her to another machine: `scripts/export-personality.cjs` writes the
personality state without the diary — chat archives and check-in notes are
stripped unless asked for, machine keys and secrets never leave.

Put it on your path with a symlink and it behaves like any other command:

```sh
chmod +x scripts/haru.cjs
ln -s "$PWD/scripts/haru.cjs" ~/.local/bin/haru
haru --login
```

Signing in asks to be remembered, which matters more than it sounds: a plain
session lasts twelve hours and lives only in her memory, so it dies with every
restart and every update, and the sign-in route is rate limited on purpose.
A remembered device lasts ninety days and is written into her config — it shows
up in Setup beside the phones, and can be taken away from there like any other.

The token is kept in `~/.config/haru/cli.json`, written 0600. `HARU_URL`
overrides where she is, for pointing at a tunnel instead of localhost.

The web door has to be switched on in her settings for any of this to work; it
is the same door, and it is shut by default.

### Getting a new version onto another machine

The server updates itself: `./update.sh` pulls, installs, builds and restarts her
under Xvfb. That needs a checkout and a toolchain, which a laptop running the
packaged app does not have — so the packaged app checks a feed on launch and once
a day after that, downloads a newer version on its own, and installs it the next
time she is closed. She is never restarted out from under you. **Setup → Starting
up** shows which version is running and whether one is waiting.

The server can host that feed, but it cannot build it: a signed Windows installer
needs Windows and the Trusted Signing account. Cut releases on the desktop.

1. **Raise `version` in `package.json`.** `electron-updater` compares versions and
   nothing else. Publish 0.1.0 twice and every machine correctly decides there is
   nothing new — this is the first thing to check when an update does not arrive.
2. Set all four `HARU_SIGN_*` variables. An unsigned build is blocked outright by
   Smart App Control, and the publisher name is also what an update is verified
   against on the way in — a mismatch there is accepted at signing time and only
   surfaces later, as an update that will not install.
3. `npm run package -- --publish always`.

By default that publishes to this repository's GitHub releases, which is the
least to keep working: HTTPS, hosting and integrity all already exist, and
nothing has to stay reachable at home. Set `GH_TOKEN` to a token that can write
releases.

To serve it yourself instead, set `HARU_UPDATE_URL` to the directory that will
hold the files — the same variable decides where the build is published and where
it later looks, so the two cannot drift apart. Then copy `latest.yml`, the `.exe`
and its `.blockmap` out of `release/` to whatever serves that URL. Any static
file server does; it does not want to be behind her web login, which is why she
does not serve it herself.

The build prints which feed it was cut for. A build published to the wrong place
is otherwise indistinguishable from a good one until nothing updates.

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
- `electron/attachments.ts`: files that travel with a message — staging, what she can
  still see, and how a file that is not a picture becomes words.
- `electron/asides.ts`: everything she says without being spoken to — kept in its own
  log rather than the transcript, and fed back to her as a short-lived note.
- `electron/voice.ts`: text-to-speech boundary — prepares the text and adapts to each engine's HTTP contract.
- `electron/listen.ts`: speech-to-text boundary — the mirror of `voice.ts`, same HTTP contract in reverse.
- `electron/asr-server.py`: the local Whisper server behind it, run by `start-haru-asr.cmd`.
- `src/companion/microphone.ts`: capture, downsample and WAV encoding for dictation.
- `src/companion/mouth.ts`: playback queue and the amplitude the lip sync is driven from.
- `src/components.tsx`: UI components.
- `src/services/ai.ts`: provider boundary; replace the demonstration provider with Ollama, OpenAI, or xAI adapters.
- `src/types.ts`: shared renderer data contracts.

Attaching a file does not send it. The paperclip, a drag onto the conversation and Ctrl+V
all do the same thing: copy the file, put a chip in the box, and stop. Nothing is read and
no model is called until you press Send, so you can pick the file first and decide what to
ask afterwards, and several can ride on one message.

On Send the attachment travels *with* the message through the ordinary chat path, which
already has her character, the conversation, her tools and her memory. A picture goes to
the hosted model as an image — she is looking at it, not at a caption of it — and rides
along on later turns too, for three attachment-bearing messages or half an hour, whichever
runs out first. That bound is the cost: every attached picture is billed and leaves the
machine. With no hosted model set up, or with something secret-shaped in the conversation,
it stays here and is read into words by the local vision model instead, and she says so.

Screenshots and the screen she watches are untouched by all of that. They never leave the
machine.

Her unprompted remarks — about the screen, a screenshot, the tab you just opened, the
list she is chasing you about — do not go in the chat. They go to the **Asides** tab, and
the split is made in the main process, so nothing that speaks up on its own can reach the
transcript. The chat is what was actually said between you; that is also what is fed back
to the model, and what the day is summarised from. She is not left blind to her own
voice: the last quarter of an hour of it rides along beside your next message as a note,
so answering something she said out loud still makes sense to her, and the day's remarks
are handed back to her before she writes another one so she does not make the same point
twice. Notes expire. Messages did not, which is how a morning of her narrating a game
became the bulk of what she thought you had been talking about.

Speech is synthesised in the main process and played in the companion window, the one
that holds the Live2D model. That is what lets the mouth follow the audio sample by
sample instead of being timed against the text and hoped to line up.

The UI deliberately has no direct access to secrets or Node APIs. The preload bridge exposes only persisted-setting operations.
