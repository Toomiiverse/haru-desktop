# Elsewhere full-body portraits

Mode: built-in image generation, one original expression atlas per character, with one targeted registration correction for Jules. Final files: `lina-v1.png`, `theo-v1.png`, `maya-v1.png`, `felix-v1.png`, `jules-v1.png`, `bea-v1.png`, `player-v1.png`. Each PNG is 1536 × 1024, with three 512 × 1024 head-to-toe cells: neutral, warm, guarded. Generated alpha and embedded metadata are preserved; selected outputs are copied unchanged.

These replace the large portraits in conversations, People profiles, the spectator spotlight and My life. Compact neighborhood cards, roster icons and the top bar retain the existing face atlases in `../portraits/`. Full-body expression changes share the existing SVG viewport renderer. Walking map characters and event illustrations are unchanged.

## Inputs

1. Each character's existing original `../portraits/{id}-v2.png` supplies identity and upper-body clothing.
2. Full-body framing reference from the user's `Downloads/FullBodyReferences/3DS - Kouenji Joshi Soccer 3 - Miscellaneous - Character Portraits.zip`: `full body/gr08_209.bctex.00.png` for Lina, Maya and Bea; `full body/gr08_201.bctex.00.png` for Theo, Felix, Jules and the player.
3. Drawing-style reference: `Downloads/FullBodyReferences/3DS - High School DxD (JPN) - Characters - Akeno Himejima/akeno 1.png`.

Reference originals and the archive are untouched. Extracted inspection copies are in ignored, unserved `artifacts/fullbody-reference/`. Reference-game sprites are not bundled with the game.

## Jules registration correction

The initial Jules output crossed the first cell boundary. A built-in edit used that generated PNG as its sole edit target, with this exact prompt:

```text
Use case: identity-preserve.
Image 1 is the EDIT TARGET: the original adult Jules full-body expression atlas.
Change ONLY the horizontal registration and spacing of the three complete character cutouts. Preserve the exact character identity, adult face, hairstyle, skin, outfit, pose, all three expressions, linework, cel shading, transparent alpha and head-to-toe framing.
Keep the canvas 1536 x 1024. It is a game atlas divided into three exact 512-pixel columns. The current first figure extends past x=512; correct this.
Place the ENTIRE first silhouette, including elbow, fingers and both shoes, inside x=52..460. Place the ENTIRE second silhouette inside x=564..972. Place the ENTIRE third silhouette inside x=1076..1484. Center each complete silhouette's bounding box at x=256, x=768, x=1280. If needed reduce ALL three figures by the SAME small amount to fit. Keep all heads and shoe soles inside y=24..1000 at the same vertical baseline.
Leave totally transparent empty gutters around every figure, especially the full-height lines x=511,512,1023,1024. Absolutely no arm, shoe or other piece may cross these cell edges.
Do not add borders, lettering, guides, scenery, checkerboards, ground shadows or a colored background. Do not change the character or expressions. Exactly three full-body adult sprites, neutral / warm smile / guarded, left to right.
```

## Exact generation prompts

Every call used this common prompt followed by its subject line:

```text
Use case: stylized-concept.
Asset type: full-body visual-novel character expression atlas for the browser game Elsewhere.
Primary request: create a new HEAD-TO-TOE version of the original adult character in Image 1. Image 1 is the IDENTITY and OUTFIT reference only, not a framing reference; preserve the same face, hair, eyes, skin tone, accessories and charcoal jacket with white piping. Image 2 is a FULL-BODY FRAMING / clean anime sprite reference, not a character or clothing to copy. Image 3 is LINEWORK / cel-shading style guidance only.
Composition: one wide 3:2 PNG, 1536 x 1024, exactly THREE equal 512-pixel-wide columns. Each cell shows ONE COMPLETE standing figure of the SAME adult, from top of hair to soles of BOTH shoes. Left expression: neutral and attentive. Middle: clearly warm friendly smile. Right: mildly guarded or disappointed. Same body pose, outfit, body scale, head position and feet baseline in all three cells; change facial expression only. Center the figures at x=256, 768, 1280; hair top around y=36 and shoe soles around y=980. Keep hair, hands, elbows, legs and both shoes fully inside each column with generous clear side gutters. No overlap. Natural adult anatomy, around seven heads tall, not chibi.
Style: polished 2010s anime visual-novel standing sprite, delicate tapered linework, detailed reflective eyes, layered glossy hair, crisp cel shading with subtle purple-gray shadow planes. Match the original character's established illustration finish.
Background: GENUINELY TRANSPARENT ALPHA outside the three figures, including between feet, hair strands and arms. No colored backdrop, no gradient, no checkerboard drawn into the image, no scenery, no floor shadow.
Constraints: do not crop any head, hand, foot or shoe; do not repeat the bust-only framing of Image 1. Fully clothed everyday adult. No text, labels, cell dividers, watermark, logos, accessories not described or extra people.
```

### lina-v1.png

```text
Subject: Lina Park, adult woman 26, long burgundy-red hair, blue eyes, white geometric hair clip, light warm skin, white high-collared blouse, small crimson ribbon. Extend her charcoal white-piped jacket into a coordinated knee-length pleated charcoal skirt, opaque black tights and simple black loafers. Relaxed standing three-quarter pose with hands loosely clasped in front at waist height.
```

### theo-v1.png

```text
Subject: Theo Brooks, adult man 32, warm brown skin, tousled navy-black hair, amber-brown eyes, masculine face, white buttoned shirt, burgundy tie. Matching straight charcoal trousers, black belt and polished dark brown lace-up shoes. Relaxed upright standing pose, one hand resting in a trouser pocket and the other loose by his side; both complete legs and shoes visible.
```

### maya-v1.png

```text
Subject: Maya Reed, adult woman 29, warm tan skin, long deep-indigo hair with a small white flower clip, green eyes, fully buttoned white blouse and forest-green ribbon. Matching full-length charcoal trousers and practical dark ankle boots. Calm upright standing pose, hands gently folded in front, kind composed posture, both boots fully visible.
```

### felix-v1.png

```text
Subject: Felix Chen, adult man 30, light warm skin, short silver-blue layered hair, blue-gray eyes behind rectangular dark glasses, white buttoned shirt, muted violet tie. Matching tailored charcoal trousers and black lace-up shoes. Reserved standing pose with one hand loosely holding his opposite wrist in front of his waist, both feet fully visible.
```

### jules-v1.png

```text
Subject: Jules Rivera, androgynous nonbinary adult 27, warm tan skin, short asymmetrical purple hair swept to one side, amber eyes, small geometric gold earring, fully buttoned white shirt and narrow burgundy ribbon tie. Matching tailored charcoal trousers and sleek flat black ankle boots. Confident standing pose with one hand lightly on their hip and the other loose at their side; no props.
```

### bea-v1.png

```text
Subject: Bea Williams, visibly older adult woman 64, warm brown skin, silver-gray hair in a low bun with loose wisps, oval reading glasses, gentle violet-brown eyes, visible fine wrinkles and smile lines, mature face and proportions. Ivory high-collared blouse, muted plum neck scarf, charcoal white-piped jacket, matching modest mid-calf skirt, opaque charcoal tights and comfortable low-heeled black shoes. Relaxed upright standing pose, hands loosely folded in front. Preserve her older age, do not make her a young woman.
```

### player-v1.png

```text
Subject: Alex Morgan, androgynous adult 22, light warm skin, short tousled navy-black hair, teal-blue eyes, same original face as Image 1, charcoal white-piped jacket, white shirt and slightly loosened burgundy tie. Matching straight charcoal trousers and comfortable black lace-up ankle boots. Relaxed upright standing pose with one hand in a trouser pocket and the other at their side; no props.
```
