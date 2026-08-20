# Haru Desktop

A desktop companion built with Electron, React, TypeScript, and Vite.

## Run it

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run dev` for development, or `npm run package` to create a Windows installer.

Chat runs against [Ollama](https://ollama.com) on your own machine. Point the
Setup drawer at your endpoint, name a model you have pulled, and use Test
connection to confirm — it lists what Ollama actually has, which is the quickest
way to catch a model-name typo.

## Architecture

- `electron/main.ts`: window lifecycle, secure IPC, the Ollama call and its tool
  loop, and the reminder scheduler.
- `electron/dates.ts`: date and time resolution, kept free of electron imports so
  the logic can be exercised directly in plain Node.
- `src/components.tsx`: UI components.
- `src/services/ai.ts`: provider boundary. `ollamaProvider` routes through the
  preload bridge; `demoProvider` is the fallback outside Electron.
- `src/types.ts`: shared renderer data contracts.

The renderer has no direct access to secrets, Node APIs, or the network. Every
capability it has — settings, chat history, the AI call, kept items, alerts, the
Live2D model, and the companion window — arrives through the preload bridge.

## How reminders work

Anything the user asks to be reminded of goes through a `create_kept_item` tool
call, executed in the main process against electron-store, so it is saved rather
than merely described. Dates are resolved in code from the user's own wording
rather than by the model, which was reliably a day out.

A poll in the main process fires a desktop notification when an item comes due.
All-day items surface at 9am instead of midnight. Items already overdue by more
than 15 minutes when Haru starts are marked off silently, so launching after a
week away does not fire a backlog.
