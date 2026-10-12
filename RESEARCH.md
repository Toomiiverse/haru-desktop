# Research notes

## 2026-09-12 — BOOTH desktop-companion survey

| Item | What | Verdict for Haru |
|---|---|---|
| [MateEngine](https://booth.pm/en/items/7504707) ¥1,500 / [GitHub free](https://github.com/shinyflvre/Mate-Engine) | Unity desktop pet. VRM 0.x+1.x, taskbar/window sitting, drag, dance-to-music, chibi, head+eye tracking, Steam Workshop mods, local AI chat. AGPL v3 + custom "MateProv2". | Feature yardstick only. Unity C# + AGPL — nothing liftable. |
| [VRM on Desktop v0.2.0](https://booth.pm/en/items/6488104) free | Electron (`win32-x64` electron-packager zip) that plays `.vrma` on a VRM, VRoid Hub login, multi-monitor, file association. Closed source, no redistribution. | Closest sibling to our stack; proves Electron + VRMA ships. Nothing to reuse. |
| [HoloWaifu 2.2](https://booth.pm/en/items/8345972) free | Windows AI-companion overlay, bring-your-own VRM, cloud AI required, 316 MB. Closed. | Direct concept competitor. Skip. |
| [Synaptic AI Pro](https://booth.pm/en/items/7668392) ¥6,500–12,500 | Claude/Gemini → Unity/Blender natural-language bridge, 350 ops, VRM export. | We already have this for free: `blender/claude_addon.py` + `blender/bridge.py`. Skip. |

Found on the way:

- **[VRoid Project 7 free .vrma](https://vroid.booth.pm/items/5512385)** — show-full-body, greeting, peace, shoot, spin, model-pose, squat. Spec-authored, so a known-good target for `blender/clips.py` output (bone set, hips translation, rest convention). Terms (full readme in `blender/clips-vroid/`): commercial OK with credit `Animation credits to pixiv Inc.'s VRoid Project`; **"distributing these motions or their alterations … in a way that can be rigged or extracted" is prohibited** — so neither the originals nor retargeted copies can go in this public repo or ship inside the app bundle. `blender/clips-vroid/` is gitignored; local Blender reference only. (ARPAHLS/avatar redistributes them anyway — their problem, not a precedent.) Loads with zero code via a `clips.json` beside the .vrm.
- **[ARPAHLS/avatar](https://github.com/arpahls/avatar)** — MIT, Electron + three.js + VRMA. Read it: nothing to lift. Haru already has the frameless/transparent/alwaysOnTop window (`electron/main.ts:7011`), a better lipsync (`mouth.ts` drives from its own TTS with a compressor; theirs is raw system-audio amplitude), and the same mixer/crossfade flow as their `useVrmAnimation`. Two idioms worth filing: `session.setDisplayMediaRequestHandler(..., {audio:'loopback'})` for prompt-free system-audio capture (dance-to-music, if ever), and a loopback-only bearer-token HTTP/WS/MCP bus (`play_animation`, `set_avatar`) for driving the avatar from an external agent.
