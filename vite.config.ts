import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// strictPort because the Electron side of `npm run dev` hardcodes 5173, in both
// `wait-on tcp:5173` and VITE_DEV_SERVER_URL. Left to its default, Vite quietly
// moves to the next free port when 5173 is taken, and the app comes up split:
// this Vite serving nobody, Electron attached to whatever else holds 5173.
// Failing to start is the honest outcome — the alternative looks like it worked.
// base './' because the built renderer is opened with loadFile, not served. Vite
// defaults to '/', which emits <script src="/assets/…"> — under file:// that is
// the root of the drive rather than the app folder, so nothing loads and the
// window comes up blank with no error worth the name. Dev never shows this: the
// dev server is happy to serve '/assets/…' from its own root, so the packaged
// build is the only place it bites, which is also the build that auto-start uses.
export default defineConfig({ base: './', plugins: [react()], server: { strictPort: true } });
