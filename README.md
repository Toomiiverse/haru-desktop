# Haru Desktop

A desktop companion foundation built with Electron, React, TypeScript, and Vite.

## Run it

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run dev` for development, or `npm run package` to create a Windows installer.

## Architecture

- `electron/`: native window lifecycle and secure IPC bridge.
- `src/components.tsx`: UI components.
- `src/services/ai.ts`: provider boundary; replace the demonstration provider with Ollama, OpenAI, or xAI adapters.
- `src/types.ts`: shared renderer data contracts.

The UI deliberately has no direct access to secrets or Node APIs. The preload bridge exposes only persisted-setting operations.
