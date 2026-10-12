# Her face on the phone

One SVG per emotion, served as-is by the web door at `/emotions/<name>.svg`
and crossfaded on the page. The artwork is the supplied Haru emotion pack and
is extended with five expressions derived from neutral: unimpressed, skeptical,
determined, wink and concerned, plus attentive, shy, content, playful, startled,
disappointed, relieved and drowsy. Neutral and these derivatives name their eyes,
ears and tuft with `data-part` attributes for desktop animation. The closed
eye in wink uses `data-blink="false"`.
The thirty-four layered faces also mark fringe, side locks, ear fluff and the heart
tuft with `data-hair`. These follow actual head and ear movement using damped
springs. Fringe masks preserve the drawing at rest and cover gaps in motion.
The desktop renderer reuses Haru's idle breathing and counter-sway, with varied
glance and blink intervals. Eyes lead the head; idle ear flicks usually affect
one ear, while deliberate twitches have a smaller, delayed second-ear response.
Hair retains its momentum between expressions and hangs toward gravity on a tilt.
Each of the 28 arrival expressions plays a reaction from
`src/companion/svgReactions.ts`. The SVG handle also accepts `listening`,
`head-pat`, `curiosity`, `head-shake`, `attention-return`, and `sleep-transition`.
Sleep holds its final pose; another expression or motion cancels it. Reduced
motion cancels all reaction tracks, including held sleep. Relieved eyes are
already closed and are marked `data-blink="false"`.

`SvgAvatarHandle.symbol(name)` plays a temporary mark; `symbol(null)` clears it.
`src/companion/svgSymbols.ts` defines 13 manga marks and `hair-surprise`,
`hair-question`, `hair-spiral`, `hair-heart` and `hair-droop`. Hair marks morph the
actual tuft path with matched contours, squash/stretch and a flexing base that
stays inside the crown. They return to the unmodified SVG. Parent hair physics
continues during the morph. Expression/reaction mappings select them automatically;
manual controls are in the standalone preview. Reduced motion uses a still mark.

Expected files (see `electron/emotions.ts`):

    neutral.svg  happy.svg  excited.svg  sad.svg  angry.svg  annoyed.svg
    surprised.svg  confused.svg  curious.svg  embarrassed.svg  sleepy.svg
    thinking.svg  smug.svg  love.svg
    unimpressed.svg  skeptical.svg  determined.svg  wink.svg  concerned.svg
    attentive.svg  shy.svg  content.svg  playful.svg  startled.svg
    disappointed.svg  relieved.svg  drowsy.svg
    pain.svg  scared.svg  serious.svg  silly.svg  flirty.svg  nervous.svg
    disbelief.svg  rage.svg  disgusted.svg  confident.svg  drunk.svg
    pouty.svg  sick.svg  laughing.svg  snooty.svg  cold.svg  crying.svg
    devious.svg  pensive.svg  triumph.svg

The 20 reference expressions have distinct eyes and ear poses. Their reactions
include giggling, sobbing, trembling, a double-take, a huff, a victory bounce,
and softer pondering, sulking and queasy motion. Animated tears and anger marks
use named `accent-left` and `accent-right` paths. Reduced motion keeps the art
still. No mouth is added; the eyes, ears, head and tuft carry the expression.

A face whose file is missing shows nothing rather than a broken image.
