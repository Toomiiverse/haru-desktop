# Elsewhere × Haru: live Willowbrook neighborhood

## Current deployment — 2026-09-29

The user's later instruction, “transfer the world that we created in this session, and put Haru in it,” supersedes the apartment-only boundary below.

- `/elsewhere` and `/world` now serve the authenticated native Elsewhere neighborhood: twelve places, six original residents and Haru. The former player house is Haru's owner-only home, furnished around her gaming, drawing, manga, rest and tea routines. Other homes retain their unique designs and ownership rules. Public places are open to all residents.
- `her.world.neighborhood` is an additive version-1 payload within the existing version-2 save. The original life ID, clock, speed, running state, history, projects, needs and current activity are retained. The six new server residents start fresh; the standalone browser save is never uploaded or read by Haru.
- `elsewhere/neighborhood.mjs` reuses `engine.mjs` local utility rules and `world.mjs` street/doorway geometry. The existing `WorldEngine` remains the only writer and timer. No second daemon, clock or memory database was introduced. New visits become completed events only after travel and activity time finish. Her prompt receives actual location, nearby residents and feelings rather than raw need scores.
- The server client only observes/interpolates received movement, with explicit pause/pace/suggestion commands through the existing controller. It holds the visual scene during dialogue while server life continues, clearly labeled. It never advances local simulation, catches up offline time or automatically retries commands. A paused server stays paused; existing shutdown/long-gap behavior is retained.
- NPC dialogues retain the six illustrated arm/expression-pose atlases, activity-specific openings and custom-only composer gated after all lines. Haru uses her existing server avatar, not new generated artwork. Haru replies use the existing chat/stream request-ID pipeline and Core memory. Optional NPC free text reuses the bounded Venice helper, takes scene context from server state, and uses Haru's saved key only on the server (one in-flight request, eight per minute, no automatic retries). Merely viewing never calls a paid model. No cutscenes, controllable player or private local `.env.local` were transferred.
- `HARU_CORE_MEMORY=on` and the newer `HARU_CORE_STORAGE=on` remain unchanged. Core's authoritative config commits already archive world events; do not restart the retired shadow feed. Her prior 55 world events were preserved, and the Willowbrook arrival was archived exactly once (56 events / 56 distinct references immediately after move-in). Core integrity is `ok`. Provider/persona/key settings match the backup, excluding the ordinary provider pricing-check timestamp refreshed at startup.
- Installed asset/code paths are explicitly allowlisted behind existing sign-in; no secrets/config/server modules are exposed. CSS is same-origin with system-font fallbacks. The pre-existing native Electron apartment renderer is not rebuilt; browser `/world` and `/elsewhere` are the connected neighborhood.

Verification: Electron/test TypeScript compilation; 74 world/web boundary checks; 10 Core world-event checks; current live-save migration + one-day dry-run; standalone engine/provider tests; isolated new desktop/phone UI tests (1440/900/390/320px); original interior regression. No paid model calls were made by tests. Live checks confirm seven residents/walkers, advancing time without a browser, authenticated data/assets/controls, unchanged protected settings and unique move-in memory.

Staging: `/home/toomii/haru-neighborhood-stage-20260929`. Private pre-deployment backup: `/home/toomii/haru-backups/neighborhood-20260929-Eefz2c` (contains `core-before.db`; do not print/download/share it). Source and runtime hashes were checked twice before scoped replacement. `main.js` received only the `elsewhereKey: getVeniceKey` callback; its other newer memory-authority changes were preserved rather than replaced by the whole compiler output.

Rollback safety: prefer a scoped forward fix. **Do not restore the old world runtime against a neighborhood save or rewind Core/config from the backup.** Old world code does not recognize the new public visits and cannot maintain the neighborhood payload. A full rollback requires an explicitly tested compatibility migration that preserves newer history. Restore only UI-specific code if appropriate; leave the neighborhood controller/assets and Core authority intact. Keep unrelated dirty project files untouched.

Local sources/tests live in `C:\Users\Tommy PC\elsewhere` and `C:\Users\Tommy PC\haru-neighborhood-20260929`. Run `node neighborhood-ui-smoke.mjs` with `PLAYWRIGHT_MODULE` and `HARU_BUILD` pointing to the staged compiler output; all network/model replies are mocked.

## Historical apartment-only integration (superseded)

The user selected **Haru's existing apartment first; preserve the standalone neighborhood**.

## Boundary

- Local Elsewhere adds a same-tab `Haru ↗` link to `https://haruserver.tail6da04d.ts.net/elsewhere` (HTTPS origin checked before deployment).
- Haru serves its existing login at that path when signed out; login reloads the same path. The world API, controls, session cookies, CSP and server binding retain their existing authentication boundaries.
- `/elsewhere` uses the same `worldPage` renderer and `/api/world` / `/api/world/control` controller as `/world`. It is not a new simulation, iframe, memory store, public proxy or configurable provider client.
- The six local residents and `elsewhere.life.v1` never cross the boundary. Browser Back returns to the standalone app. No automatic commands, uploads, pace changes, catch-up, paid requests, or changes to persona/model routing.
- Chat remains Haru's existing `/` page, with its history and memory. No new Haru chat implementation or Venice NPC chat connection.
- Core memory remains **on**. The previous `her.world` event importer is unchanged.

## UI behavior

Shared room client now shows a connection panel with a last-check time, loading placeholders, empty-journal state, offline/stale labeling, refresh, and sign-in recovery. Failed controls disable writes until a successful authoritative read. Commands are not retried automatically. Late reads cannot undo a newer control. Expired authentication stops polling. No added animations.

This retains Haru's current apartment artwork, clock, routines, offline-time policy and world planner. It does not port Willowbrook or create server NPCs. The Electron React bundle is not rebuilt during this deployment; only the two relevant server modules are compiled/copied. Existing desktop-source compatibility is tested for its next ordinary build.

## Verification

- Electron and test TypeScript compilation pass.
- 70 world/web-server tests pass, including signed-out login, protected API/controls, no world mutation on open, original controller sharing and missing-world 404.
- Existing `scripts/check-world-ui.cjs`: synthetic phone and embedded desktop checks pass.
- `elsewhere/haru-ui-smoke.mjs`: isolated Edge, intercepts every Haru-host request; no live authentication/model calls. Covers save isolation, two-tab authority, failed writes, stale-read races, offline/reconnect, expired auth, loading/empty state, reduced motion and 1440/900/390/320px. Screenshots in `elsewhere/artifacts/haru-*.png` inspected.
- New notice text contrast: muted 6.23:1, primary 15.72:1.
- Known unrelated failure: `npm.cmd test` in Elsewhere has an outdated portrait expectation at `engine.test.mjs:232` (expects the old full-body atlas crop after the earlier four-pose artwork change). Venice/dialogue API checks pass. No claims of a fully green standalone suite.

Run the browser check with `PLAYWRIGHT_MODULE` pointing at the installed Playwright module and `HARU_BUILD` at the staged `dist-test/electron` directory (or copied `compiled` directory), then `node haru-ui-smoke.mjs` from Elsewhere.

## Deployment / rollback

Staging: `/home/toomii/haru-browser-stage-20260929`.

Backups: `/home/toomii/haru-backups/browser-connection-20260929` (private directory; configuration backup contains secrets and must not be printed or downloaded).

`deploy.cjs` guards original hashes and Core memory mode, backs up the three source/test files and two runtime JS files, then copies only those files and restarts `haru.service`. No dependency installation, broad build, service-config change or memory-database write.

Rollback only those five named code files from the backup and restart `haru.service`. **Do not restore config-before.json or rewind memory databases** during normal rollback; doing so would discard newer state. Remove the local Haru navigation line if retiring the route. Leave unrelated dirty app files alone.
