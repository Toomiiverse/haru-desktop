# Haru desktop UI review — 18 September 2026

Reviewed the running Electron Study screen, the main renderer source, and the redesigned browser previews. Scope: the desktop workspace, not the floating avatar or AI behavior.

## Visual assessment

Subjective score: **before 5.5 / 10; redesigned 8.5 / 10**. These scores describe the inspected screens, not a full accessibility certification.

| Category | Before | After | Finding / resolution |
|---|---:|---:|---|
| Visual hierarchy | 5 | 9 | Seven equally weighted top tabs became grouped sidebar navigation, with one clear heading per page. Chat has the main surface; Plans can be hidden. |
| Typography | 5 | 8 | Small spaced monospace labels gave way to system UI text, larger page titles and readable body copy. The invalid remote font import was removed. |
| Depth and layering | 6 | 9 | Warm rose/light and plum/dark surfaces replace competing background glows; restrained borders distinguish navigation, content and supporting information. |
| Interactive states | 6 | 9 | Visible selected navigation, focus rings, pressed/hover/disabled states, and native disclosures. Removed the Enable alerts button that had no handler. |
| Responsiveness | 5 | 8 | A fixed 780px body minimum became a compact navigation rail and an optional small-screen Plans overlay. Study stacks and settings fields collapse. |
| Accessibility | 5 | 8 | Navigation uses aria-current; icon controls have accessible names. Text tokens pass contrast checks. Existing legacy forms still merit a dedicated complete accessibility audit. |
| Motion | 7 | 9 | Brief state transitions only; workspace animations and transitions honor reduced motion. |

## Top three improvements

1. **Navigation hierarchy.** Seven tabs and a connection claim competed in one strip. Group daily activity and personal settings, with the title in the workspace.

   Before: `<nav className="tabs" role="tablist">...</nav>`

   After: `<nav className="app-nav" aria-label="Main navigation">... aria-current="page" ...</nav>`

2. **Conversation priority.** The calendar was permanently attached to chat. Let the user choose a focused conversation while retaining all calendar views and task actions.

   Before: `<div className="haru-body">`

   After: `<div className={showPlans ? 'haru-body' : 'haru-body plans-hidden'}>` with an accessible Plans toggle.

3. **Settings organization.** A long undifferentiated list became five native, keyboard-operable groups. Closed groups stay mounted so their save hooks and values remain intact.

   Before: `<VoiceField/><ListenField/><SearchField/>...`

   After: `<details className="settings-group"><summary>Voice & listening</summary><VoiceField/><ListenField/></details>`

## Verification

- Production build and TypeScript checks pass. Existing Vite configuration and large avatar bundle warnings remain.
- Start the preview with `npx vite --host 127.0.0.1 --port 5184`, then run `node tmp/ui-review.cjs`. The check uses the bundled Playwright runtime and covers all seven pages, demo chat submission, settings disclosures, Plans visibility, viewport overflow at 1240/980/640/390px, the keyboard skip link and reduced motion. All 64 checked text/background token pairs meet 4.5:1 contrast. It uses the existing browser demo provider and does not send messages to the real AI service.
- Screenshots inspected in both themes, including populated chat, Study, Settings and compact layouts.
- No model, memory, backend, calendar or voice configuration changed as part of the redesign.
- The build is installed in dist. A live-window refresh was attempted but Windows input failed with `GetCursorPos failed: Access is denied. (0x80070005)`. The redesigned live Electron screen could not be verified in this session; reload the main window or reopen Haru to load it.

## Review files

- `output/ui/haru-light.png` — light chat preview.
- `output/ui/haru-dark.png` — dark chat preview.
- `output/ui/haru-study.png` — Study preview.
- `output/ui/haru-settings.png` — Settings preview.
- `tmp/ui-before-2026-09-18/` — copies of the files before this redesign, including prior uncommitted work.
