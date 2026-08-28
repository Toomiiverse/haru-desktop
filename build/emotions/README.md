# Her face on the phone

One SVG per emotion, served as-is by the web door at `/emotions/<name>.svg`
and crossfaded on the page. The artwork is the supplied Haru emotion pack and
is not regenerated, redrawn, recoloured or otherwise modified.

Expected files (see `electron/emotions.ts`):

    neutral.svg  happy.svg  excited.svg  sad.svg  angry.svg  annoyed.svg
    surprised.svg  confused.svg  curious.svg  embarrassed.svg  sleepy.svg
    thinking.svg  smug.svg  love.svg

A face whose file is missing shows nothing rather than a broken image.
