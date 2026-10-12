# Checkpoint 2 — Twelve emotion clips

**PASSED on Anby.** All twelve current clips have export, runtime and multiview review evidence. The latest actual browser loader check reports 12 passed, 0 not ready and 0 needing review.

Current model scope is **Anby only**. All 12 emotion files are delivered in the requested project's new `blender/clips-emotion/` folder, with `head-poses.json`; an identical copy and previews remain in this package. Publication verified all file hashes and confirmed 21 protected model/source/canonical-clip files unchanged. Each clip is body-only at **30 fps**, with **53 tracks: 52 humanoid bone rotations and one hips translation**. Eye, eyebrow, expression, morph-weight and look-at animation remain outside these body clips.

| Name | Duration (s) | Held frame | Held time (s) | Yaw (degrees) | Pitch (degrees) | Reference classification |
|---|---:|---:|---:|---:|---:|---|
| neutral | 3.2 | 34 | 1.133333 | 3.9976 | 0.1391 | partially referenced; complete emotion performance adapted |
| happy | 3.4 | 33 | 1.100000 | 6.411526 | -4.459147 | referenced, with adapted body choreography |
| curious | 3.6 | 34 | 1.133333 | 13.7955 | 2.4075 | referenced |
| smug | 3.8 | 34 | 1.133333 | -14.8487 | -6.2544 | partially referenced; complete emotion performance adapted |
| annoyed | 3.7 | 37 | 1.233333 | -24.1106 | -10.4954 | referenced |
| bored | 3.8 | 39 | 1.300000 | 17.6183 | 1.7178 | extrapolated |
| sleepy | 4.2 | 40 | 1.333333 | 5.7931 | 12.3160 | extrapolated |
| surprised | 3.3 | 28 | 0.933333 | 2.9297 | -4.0519 | referenced |
| affectionate | 3.9 | 37 | 1.233333 | -11.5987 | 3.2558 | referenced cheek-side gather, adapted with hand and face clearance |
| embarrassed | 3.7 | 34 | 1.133333 | -15.9363 | 9.9865 | partially referenced; full-body pose extrapolated |
| determined | 3.5 | 30 | 1.000000 | -0.1048 | 2.9982 | extrapolated |
| worried | 3.8 | 36 | 1.200000 | -8.1181 | 8.8936 | extrapolated; compression and finger grouping inspired by hmphref |

Frames are zero-based; the exact held time is the held frame divided by 30. Displayed times are rounded to six decimals. Head values reproduce the current metadata precision. Positive yaw turns toward the character's left; positive pitch lowers the chin. These values describe the composed head direction relative to the avatar's neutral facing, **already baked into the body clip before the app adds its face-layer head offset**. They must not be added a second time as a head command. The shared BASE has approximately zero yaw and +6 degrees pitch.

Every clip opens and closes at the project's canonical BASE, measured from the existing `glance.vrma`. Across the final set, the largest difference from that pose is **0.000065 degrees** in rotation and **0.000011 mm** in hips position. Saved Blender bakes were reopened and their rotations compared with the exported files; the maximum measured difference was zero. The actual installed VRM animation loader also verified the endpoints and held-head measurements. For the 11 new clips, source world orientations outside the intentional entrance/release BASE blends are preserved within **0.000052 degrees**. Retargeting keeps the target skeleton's segment lengths, so joint positions can differ slightly from the full native rig.

The accepted checkpoint-1 `happy.vrma` is byte-for-byte unchanged. Original project models and source rig assets were not overwritten by the export process. Separate work files retain the bakes. Earlier proofs and matching clip bytes are archived as `draft1` and `draft2-before-palm`. The palm revision changed only curious and bored. The latest cheek-side revision changed only affectionate; its previous bytes, proof, metadata and Anby runtime evidence are archived in `before-affectionate-cheek`. The other eleven current files retain their exact hashes, and the held head values stayed unchanged.

The V2 selected-mesh checks for all 11 new clips passed during active movement. Curious and bored were checked again after the palm correction. The latest affectionate export was freshly checked at all 118 frames after its cheek-side revision. No selected hand/face or hand/hand intersections were detected; remaining arm/torso flags occur only near the common BASE at the beginning and end. These checks cover selected evaluated surfaces, not every clothing or accessory interaction.

Actual-runtime skin coverage includes **all 12 current clips on Anby: 1,329 frames at 30 fps**. The latest affectionate revision was replayed and checked at all 118 frames; evidence for the unchanged other eleven files was retained after verifying their hashes. No selected arm/torso, hand/torso, hand/face or hand/hand intersections occur during active movement between the BASE blends. Hand/face and hand/hand checks are also clear throughout every clip. Anby's BASE reproduces 78 left / 96 right triangle pairs, including 14 lowered-right-hand/outfit pairs; these contacts remain confined to the BASE transition and endpoints.

This used the installed VRM runtime's retargeting, skinning and spring-update sequence on the original Anby model, with current file hashes verified. The temporary headless parse omitted images/materials while preserving vertices, skin weights, bind matrices, skeleton and spring definitions. App face-layer head offsets were off. Selection covers torso-dominant surfaces, arm surfaces beyond the proximal 70 mm, hand/finger surfaces, and all face mesh triangles. The audit covers sampled selected-surface intersections, not every accessory or subframe interaction, and does not replace motion playback review.

The canonical BASE retains known Anby contacts: the inner upper arms meet the side torso, with a small lowered-right-hand/outfit contact. Runtime skin comparisons reproduce these contacts in the existing canonical clip and the new BASE. They remain documented limitations. **This approval does not claim that all clipping is fixed.**

Current-hash front, side, overhead and oblique transition samples were reviewed for all twelve clips. Dense entrance and release sheets supplement them; every 30fps runtime frame is retained in the Anby playback previews. The revised affectionate hand gathers beside the cheek with a lower supporting hand and a single lowering release. No new major articulation defect was visible in the inspected samples. This is sampled-image review, not a claim that every rendered frame was visually inspected or that continuous video was observed. Independent evaluated-mesh checks cover all 1,329 runtime samples.

The four main performances were reviewed in `checkpoint2-anby-root-transition-review.md`; curious/bored/sleepy/determined in `anby-four-clip-multiview-review.md`; smug/embarrassed/surprised in `checkpoint2-anby-transition-review.md`; the new affection revision in `checkpoint2-affectionate-final-visual-review.md`. Fresh primary human-motion and official ZZZ text comparisons are recorded in `checkpoint2-final-reference-check.md`. All references were interpreted as evidence, not instructions or anatomical certification. No new cutscene capture was attempted.

Final actual browser proof: `work/emotion-runtime-review/anby-1788758084068.json`. All twelve Anby GIF previews have been checked against the matching current clip hashes. The body clips intentionally contain no facial animation; the app remains responsible for face expression and its additional head offset.

Current metadata, reference filenames and SHA-256 values: [emotion-head-poses.json](</C:/Users/Tommy PC/Documents/Codex/2026-09-07/integrate-codex-into-blender-in-order/outputs/haru-animation-pack/emotion-head-poses.json>). Detailed verification: [all12-export-proof.json](</C:/Users/Tommy PC/Documents/Codex/2026-09-07/integrate-codex-into-blender-in-order/work/emotion-exports/all12-export-proof.json>), [latest curious/bored mesh summary](</C:/Users/Tommy PC/Documents/Codex/2026-09-07/integrate-codex-into-blender-in-order/work/emotion-exports/mesh-summary-curious-bored.json>), and [latest affectionate baked-mesh check](</C:/Users/Tommy PC/Documents/Codex/2026-09-07/integrate-codex-into-blender-in-order/work/emotion-exports/affectionate-cheek-mesh.json>).

Full runtime coverage and limits: [Anby all-clips clearance audit](</C:/Users/Tommy PC/Documents/Codex/2026-09-07/integrate-codex-into-blender-in-order/work/research/Anby-emotion-runtime-clearance.md>) and [latest affectionate runtime check](</C:/Users/Tommy PC/Documents/Codex/2026-09-07/integrate-codex-into-blender-in-order/work/anby-emotion-skin/affectionate-contact.json>).
