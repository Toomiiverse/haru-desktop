# Elsewhere

A playable browser life simulator in a top-down, handheld-anime-inspired pixel town. Shape a character's adult life through daily activities, consequential choices, career progress, skills, and relationships while neighbors pursue their own lives.

This is a personal-use project planned for Haru. The supplied interior pack is used under its included non-commercial license; credits are retained.

The overworld uses the supplied `PixelTopWorld` assets: LimeZu's Serene Village terrain/buildings and Screen Smith's Townspeople sprites. Seven distinct pixel characters face four directions and animate along the streets. The expanded map has twelve clickable destinations: five public places, your house, and six separate NPC houses with distinct silhouettes, roof styles and gardens. Source images are copied unchanged; credits, licenses and the NPC pack's AI-generation disclosure are in [assets/world/README.md](assets/world/README.md), also linked inside the game.

Conversations use high-resolution upper-body anime portraits with three expressions above the pixel world. **People**, the spectator spotlight and **My life** retain complete full-body figures; small cards use face thumbnails. Pixel outfits represent the cast rather than exactly matching the illustrations. Life choices, autonomous goals/memories and existing saves are preserved. Character cutscenes are currently disabled; their artwork is retained. Artwork and prompts are in [assets/fullbody/README.md](assets/fullbody/README.md); Downloads originals are untouched.

## Play

Click/tap a building to inspect its furnished pixel-art cutaway, activities and actual indoor residents. The park opens a close garden view. NPC conversations show their actual interior or the nearest outdoor place, not their planned destination or the whole map. The earlier original painted backgrounds remain in `assets/backgrounds/` for artwork reference; no reference-game screenshots are bundled.

Requires Node.js 24 or newer. Core gameplay and activity-based NPC openings need no packages, accounts, API keys, or paid services. Optional custom AI conversation and the artwork-creation command use your Venice API key and credits.

On Windows, double-click **Start Elsewhere.cmd**. It opens the game in your default browser; keep the server window open while playing. Or run these commands in PowerShell from this folder:

```powershell
npm.cmd start
```

Open <http://127.0.0.1:4173>. Stop the server with Ctrl+C. To select another port, set `$env:PORT = '4174'` before running `npm.cmd start`. The double-click launcher always uses port 4173.

## How it works

### Haru's server-owned neighborhood

Choose **Haru ↗** in the navigation, or open [Elsewhere × Haru](https://haruserver.tail6da04d.ts.net/elsewhere). Sign in with your existing Haru web login if asked. Willowbrook's twelve places, original art, separate homes and six autonomous neighbors now share Haru's persistent server world. Haru is the seventh resident; the former player house becomes her gaming/drawing, manga, rest and tea home. Her current cat-eared avatar is reused, with a distinct atlas sprite; no new Haru illustration was generated.

The handoff opens in the same tab, stopping Elsewhere's local clock. Your standalone `elsewhere.life.v1` save remains on this device; its personal-life progress is not uploaded. Use your browser's Back button to return. Haru's clock, old apartment journal, projects, current task, provider routing and memory are preserved; the six server residents begin new lives in the transferred world. No controllable player is added.

The server owns every decision and arrival even when no browser is open. Follow any resident, inspect buildings, or suggest Haru's next activity; she finishes her current task first. Her home and the six other homes are owner-only; the five public places are available to all. Pause/pace controls affect the shared server world. A conversation holds only the visual scene, clearly marked “server life continues”; use Pause world to stop time globally. Opening a view never ticks or saves. Offline controls are disabled and no commands retry automatically. Existing shutdown/long-gap rules remain: downtime is not replayed as invented experiences.

Haru's Core memory remains on, including the newer SQLite storage authority. Completed world events and her real conversations use that existing store. The in-box Haru reply calls her normal chat pipeline with a deduplicated request ID. The six other residents retain local decision-making and activity-specific openings; their optional custom replies use the existing Venice GLM helper and Haru's saved Venice key, server-side only. Those NPC replies are encounter-only, disclosed before sending, bounded and rate-limited. No local `.env.local`, credentials or private conversation data are bundled with the game assets. The old apartment renderer remains available to existing native desktop code; `/world` and `/elsewhere` show Willowbrook.

### Standalone neighborhood

- Visit locations, choose activities, and balance your needs, money, skills, and relationships.
- Resolve life choices and advance time to see consequences unfold.
- Click/tap any NPC outdoors, in a room, or on a resident card to open dialogue. There are no player movement controls or proximity requirements. A detailed anime portrait appears above the bottom dialogue box; the world and NPC walkers freeze. Each resident has unique openings for walking, resting, eating, socializing and their own work. Lina can also choose to paint by the park pond.
- **Continue** or **E** advances the NPC's lines. After the final line, **Reply** unlocks **Write my own reply inside the same dialogue box**. There are no preset response buttons or separate reply panel. While the NPC is speaking, the input does not exist; after an AI response, acknowledge that response before typing again. **Leave**, Escape or Close returns to the world.
- The six neighbors use four static illustrated arm/expression poses: attentive, happy, surprised and thoughtful. They swap instantly without floating the whole body. Reduced-motion preferences also remove the opening entrance. **Log & profile** contains the encounter lines, goals and saved NPC memories; **Spend time** uses the normal two-hour activity.
- Progress autosaves in this browser on this address. Clearing site data removes that save; another browser or port has a separate save.
- **My life** offers JSON export/restore, home improvements, and a **Turn 23** (next birthday) button. Aging summarizes a year of income and living costs. Daily actions and birthdays are separate, so there is no rush.
- Pause / play / 3× controls advance the neighborhood between your actions. The world pauses for decisions and conversations, and while the tab is hidden.
- **Spectate** opens a large view even while your next life choice is waiting. NPCs walk to doorways, enter buildings and reappear at the entrance when leaving. Indoor counts appear by building labels. A roster portrait follows that resident, including into their actual room; **Town overview** returns to the streets. Pause / 1× / 3× controls travel and the clock. Building inspection and conversation pause the world.
- Passive spectating leaves your character's needs, savings, age, and pending choice unchanged. Explicit activities such as **Spend time** still affect relationships and social needs. The neighborhood clock, NPC needs, goals, memories, and friendships continue and autosave. **Back to my life** restores the normal play speed. Reduced-motion preferences replace animated travel with stops and disable decorative animations.

NPCs use **local utility AI**: needs, personality, and goals score their next action, and memories influence interactions. Movement, simulation, portrait motion and authored openings stay local. Only explicitly sent custom messages call a language model. The simulation runs while you play, not as a background service when the page is closed.

## Character dialogue and custom AI replies

The JRPG view follows your `CharacterTopPixelStillShownReference`: a detailed illustrated bust over a crisp, location-specific pixel scene, with a semi-opaque bottom dialogue box spanning 90% of the viewport. `encounterFor` and `ACTIVITY_DIALOGUE` supply activity-aware lines and expressions. Continue reads the next line; Reply unlocks the embedded composer after the last line. The textbox expands only while replying, including on narrow phones. The opening slide/fade runs once; static arm/expression poses swap immediately. World pixels and high-resolution UI scale independently. In standalone mode, **Log & profile** holds history and encounter actions. Reduced motion disables the entrance animation.

## Separate homes and public places

Each resident owns a different detached building and authored floor plan, not an apartment in a shared residence:

- Lina: coral-roofed atelier house, open easels and sketch nook, separate sleeping wing.
- Theo: broad red-roofed breakfast cottage, coffee kitchen and conversation lounge.
- Maya: small green-roofed garden cottage, potting room and leafy sunroom.
- Felix: narrow blue-roofed townhouse, private library and research desk.
- Jules: narrow red-roofed workshop house, fabrication area and organized market stockroom.
- Bea: green-roofed storybook bungalow, reading parlor, keepsakes and tea corner.

Only the owner can enter a private home; your house follows the same rule. Public café, studio, library, park and market are open to everyone. Inspection is an observer view and never moves your character or bypasses these rules. **Spend time** with somebody at a private home meets them in the public park instead. Old version-1 saves that placed NPCs at the player's home are normalized to their individual homes after validation. Travel and indoor occupancy are presentation state, rebuilt on loading; gameplay saves keep the existing format.

Rooms use the supplied Modern Interiors tiles arranged according to `RoomReference`, with unique shapes, partitions and furnishings. A static floor plan and accessible resident list remain usable if an atlas fails. This version shows residents at their indoor activity spot; it does not add furniture editing or room-by-room indoor pathfinding.

## Custom AI replies

Custom replies use **Venice · GLM 4.7 Flash**, API ID `zai-org-glm-4.7-flash` (not the WAI image model). The local server loads `VENICE_API_KEY` from `.env.local` on startup. Your existing Venice key can be used; restart Elsewhere after editing it. Keys never enter browser code, browser storage, requests from the browser, or game saves. No additional key entry is required in-game.

Only pressing **Send to AI** starts a paid inference request. Opening a character, advancing lines, typing and spectating never call Venice. The form discloses that a send shares your message, player name, selected NPC's personality/actual setting/current activity/needs/goal/thought, up to three memories and eight recent spoken lines with Venice. The full save, real account information, other residents' memories, local files and artwork are not sent. Do not type passwords or other secrets.

Messages are limited to 280 characters; replies have a 320-token cap. The local server permits one in-flight request and at most eight custom sends per minute, with a 45-second provider timeout. There are no tools, web searches, automatic retries, model fallbacks or autonomous paid conversations. A pending reply shows a loading state and can be cancelled; closing the dialogue also cancels waiting and ignores late responses. Cancellation/timeouts can still consume provider credits. Errors retain your draft and display a focused error message. You can edit and resend or leave the conversation.

AI dialogue is **encounter-only**: it does not change affinity, needs, currency, progression or saved memories. The model cannot execute actions. Use normal life activities to develop relationships. This is a local single-player endpoint, protected by strict origin/host checks, bounded JSON inputs, response escaping and an explicit static-file allowlist; it is not intended for public deployment.

The model and request contract were checked on 2026-09-29 against the [Venice text model catalog](https://api.venice.ai/api/v1/models?type=text) and [chat completion documentation](https://docs.venice.ai/api-reference/endpoint/chat/completions). Automated checks mock replies; they do not spend credits.

## Character events — currently disabled

Character cutscenes, random triggers and replay controls have been removed from gameplay at your request. The seven existing event illustrations are retained in `assets/events/` for possible later use; conversations never request them. The new `lina-park-v1.png` started as a Venice Anime (WAI) draft and received an explicitly approved built-in image edit to restore Lina's burgundy hair. All prompt and provenance details are in [assets/events/README.md](assets/events/README.md). Reference originals and game saves are unchanged.

## Artwork creation: Venice Anime (WAI)

Future artwork drafts can be generated with Venice's **Anime (WAI)** model,
API ID `wai-Illustrious`, using the local `venice.mjs` authoring command.
This does not add player-facing image generation, change NPC autonomy, or regenerate
existing images. It is separate from the optional custom text conversation above.

### One-time setup

Create an inference-capable key in [Venice API settings](https://venice.ai/settings/api).
Enter it in the project's `.env.local` file as `VENICE_API_KEY=your-key`.
If that file is missing, copy `.env.example` to `.env.local` first. Never paste
the key into chat, source code, prompts, browser storage or a saved game.
The key file is git-ignored and is not served by the local game server.

From this project folder in PowerShell, verify the key and current WAI availability:

```powershell
npm.cmd run art -- --check
```

This only checks API access and model metadata; it does not generate an image.
It reports the catalog's current per-image USD price without printing your key
or account balances. Generation uses Venice credits; no account top-up, purchase,
automatic retries or fallback to another model is performed by this tool.

### Preview, then generate

```powershell
# No key, network call or credits needed for this preview:
npm.cmd run art -- --prompt "An original anime village café at sunset, warm painted background, no lettering" --size 1152x768

# Add --generate only when ready to send the prompt and use Venice credits:
npm.cmd run art -- --prompt "An original anime village café at sunset, warm painted background, no lettering" --size 1152x768 --generate
```

For a longer prompt, use `--prompt-file prompt.txt` instead of `--prompt`.
WAI prompts are limited to 1500 characters. The command accepts sides from
256–1280 pixels in multiples of 16; the default is 1024×1024. For a standing
character draft, use 768×1152. One PNG is requested with 25 steps and safe mode
enabled. Generation information embedded by Venice is preserved.

Each generation reserves a new `artifacts/venice-*` directory, containing
`request.json` and, on success, `image.png`. No current asset is overwritten or
automatically imported. If a request fails, its folder/manifest may remain for
review; a timeout may still have consumed credits, so check Venice before retrying.
Only the supplied prompt and generation settings are sent—not saves, NPC memories,
local artwork or Downloads references. Prompts are also saved in the local manifest
and may be embedded in the PNG; do not put secrets in them.

WAI's current catalog does **not** support style-reference uploads. This first
integration is text-to-image, not reference editing, automatic character matching,
background removal or sprite-sheet assembly. The existing portraits are registered
1536×1024 expression atlases; WAI drafts are not drop-in replacements. Review a
draft's appearance, framing, transparency and dimensions before explicitly importing
it into the appropriate asset folder and renderer mapping.

API contract and capabilities checked on 2026-09-29 against
[Venice's WAI model page](https://venice.ai/models/wai-illustrious),
[image generation reference](https://docs.venice.ai/api-reference/endpoint/image/generate),
[live image model catalog](https://api.venice.ai/api/v1/models?type=image), and
[key access endpoint](https://docs.venice.ai/api-reference/endpoint/api_keys/rate_limits).
Automated integration tests use mocked image responses and spend no credits.

## Check

```powershell
npm.cmd test
```

The game uses native browser modules and a Node standard-library server with no dependencies. The server listens only on this computer and serves an explicit list of game files.

Optional browser regressions require Playwright and Edge. With the server running, run `node ui-smoke.mjs`, `node dialogue-ui-smoke.mjs` and `node interior-ui-smoke.mjs`; `PLAYWRIGHT_MODULE` may point to an installed module. They use disposable browser contexts and mocked AI, preserving the user's save and spending no inference credits. Checks cover the full life loop, walking and homes, all profile assets, activity-specific openings, gated in-box replies, absence of cutscenes, body animation/reduced motion, errors/cancellation, focus and responsive layouts. Screenshots go to `artifacts/`. The interface optionally uses Google Fonts with system fallbacks.

`node neighborhood-ui-smoke.mjs` checks the new connected neighborhood with a synthetic server snapshot and mocked replies. Set `HARU_BUILD` to the staged compiled Haru modules (defaults to `../haru-neighborhood-20260929/runtime` in this workspace). It checks seven residents, twelve places, gated dialogue, the two chat routes, save isolation, offline/auth recovery and 1440/900/390/320px layouts without live inference. The older `haru-ui-smoke.mjs` is the prior apartment-view regression, not the new neighborhood contract.

Walking follows the current fixed street layout; it is a visual representation of each resident's hourly decisions. New building placement would need an updated route graph. Existing version-1 saves are validated and legacy home locations are normalized on loading.

This first playable version covers an adult-life slice. It does not include a full childhood-to-old-age simulation, 3D, house-building tools or multiplayer. Its title, interface, cast and story artwork are original; the pixel-world art is licensed third-party material credited above. This is an independent prototype, not affiliated with Pokémon or Nintendo.
