# Haru’s apartment

Open **World** on desktop, **World ↗** on mobile web, or **Her → Little World**
in the iOS app. The authenticated `/world` page is shared across all three.
Existing TestFlight build 75 loads the current server page; use its reload button
or leave and reopen Little World after a server update.

The playable setting is one room in a modern, futuristic cyberpunk apartment.
The isometric cutaway has a dual-monitor gaming desk, RGB desktop tower,
mechanical keyboard, mouse, drawing tablet, gaming chair, low bed, cat plush,
original anime posters, manga and figures, a tea table, speaker and rainy neon
city window. The city is scenery. There are no outdoor trips or NPC visits in
this version.

## Exploring the room

- Tap a furniture marker or its named button to inspect it and suggest an activity.
  Markers also work with Tab and Enter/Space. **Look closer** zooms into the
  selected part of the room; **Whole room** restores the cutaway.
- Choose **Neon**, **Warm** or **Night** lighting. This is saved with her world.
- Pause/resume, choose real-time/12×/60× pace, or skip 30 world minutes while paused.
  Skipped events cannot become nudges. Her game clock is distinct from real time.
- Give her a focus: her choice, gaming, reading, creative work or unwinding.
- Suggestions queue behind the current activity. She moves between furniture
  before starting; project counts change only when an activity finishes.
- **Her autonomy** contains the existing local-model planning switch.

Her indoor routines include the fictional racer *Neon Circuit*, fictional anime
*Afterlight*, the fictional manga mystery *The Midnight Tram*, digital city
sketches, rearranging figures, tea, synthwave, watching the window, naps and sleep.
These are simulated activities with authored reaction lines and persistent
progress. They do not launch real games, stream anime, play audio or create image
files. Her on-screen position and sleeping indicator follow the simulation.

## Saved state and migration

`electron/world.ts` owns rules, seeded choices and validation. Save version 2 adds
room position, lighting and gaming/anime/collection totals. The earlier version 1
neighbourhood save migrates once on startup: dates, elapsed game time, running
state, speed, project totals, inventory, relationships, planner budget and recent
journal history are retained. Old garden/inventory/relationship fields are kept
as history and do not progress in the room. Unsupported focus values become
“her choice”; unfinished trips and queued outdoor visits are cleared without
recording them as completed. A move-home journal entry marks the transition.
Unknown versions and damaged saves are refused and left intact.

- `electron/world-engine.ts` is the single-writer controller and local planner.
- `electron/world-room.ts` draws the room as SVG, without external assets.
- `electron/world-page.ts` serves the responsive interface and shared controls.
- `src/WorldPage.tsx` embeds that page through the desktop preload bridge.
- `electron/main.ts` saves `her.world` through HaruStore and ticks every ten seconds,
  even with the viewer closed. A restart rebases time. Gaps over one real minute
  do not manufacture an offline history.
- `GET /api/world` and `POST /api/world/control` require the existing login. Mutations
  require JSON and validated commands. Haru’s full blank-slate reset clears the
  world; there is no separate world reset route.

## Planning and nudges

The planner only uses the configured loopback Ollama model, with no hosted
fallback or redirects. It has a 4,096-token context, 100 output tokens, a 20-second
abort deadline, at most six attempts per real Australia/Perth day and at least
20 real minutes between attempts. Failures count. Chat, speech and other
foreground/autonomous work hold planning. Stale model results cannot undo a user
control or overwrite simulation progress. The model selects a valid activity;
it cannot edit inventory, state or outcomes. No Astra calls are used.

Her own-life prompt labels this as a virtual apartment. Only completed reading,
sketch-album, gaming and anime milestones may become nudge candidates. Routine
activities, skipped time and pre-migration neighbourhood events do not trigger
fresh room nudges. Candidates expire after six real hours and retain the existing
relevance, repetition, quiet-hour, feedback and phone-budget rules. Outgoing text
must explicitly preserve the virtual setting. This update does not enable phone
notifications.

## Verification and rollback

`npm test` covers migration and corrupt saves, movement and completion, persistence,
room-only activities, month-long progress, controls, planner budgets, cancellation,
virtual provenance and authenticated HTTP routes.

`DISPLAY=:99 node_modules/.bin/electron scripts/check-world-ui.cjs --no-sandbox`
checks actual phone/desktop rendering, small-screen overflow, furniture markers,
keyboard selection, close-up views, lighting, reloads, failed saves and controls,
using synthetic state rather than the live world. It saves screenshots to a
printed temporary directory.

Deployment evidence and backups are under `/home/toomii/haru-backups/apartment-*`.
Version 1 code cannot read version 2 saves: to roll back, stop Haru, restore the
previous compiled app, and restore only `her.world` from `config-before.json`.
Restoring the entire configuration would also rewind unrelated activity.
