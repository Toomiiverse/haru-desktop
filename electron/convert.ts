// Turning one kind of file into another.
//
// Scoped to pictures, and deliberately. Documents and video mean shipping
// ffmpeg or LibreOffice — hundreds of megabytes, a licence to think about, and a
// binary that has to be found at runtime in a packaged app. Pictures need none
// of that: Electron already carries an image codec, because Chromium is one.
//
// The case that prompted this was "change that picture into an icon", which
// Windows will not do from a PNG and which no built-in tool covers — so the ICO
// encoder below is the point of the module rather than an extra.

import fs from 'node:fs';
import path from 'node:path';
import { nativeImage, type NativeImage } from 'electron';

export type Format = 'png' | 'jpg' | 'ico' | 'bmp';

export const FORMATS: Format[] = ['png', 'jpg', 'ico', 'bmp'];

/** What Chromium will decode. Anything else is refused by name, not by failing. */
const READABLE = /\.(png|jpe?g|bmp|ico|webp|gif|tiff?|avif)$/i;

export function canRead(file: string): boolean {
  return READABLE.test(file);
}

export function normaliseFormat(wanted: string): Format | null {
  const asked = (wanted ?? '').trim().toLowerCase().replace(/^\./, '');
  if (asked === 'jpeg') return 'jpg';
  if (asked === 'icon') return 'ico';
  return (FORMATS as string[]).includes(asked) ? asked as Format : null;
}

/**
 * The sizes Windows actually asks an icon for.
 *
 * All of them in the one file, because Windows picks per context — 16 in the
 * title bar, 32 on the desktop, 256 in a large-icon folder view — and an icon
 * carrying only one of them gets a smeared upscale everywhere else. This is the
 * whole reason renaming a .png to .ico does not work.
 */
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * A single icon image in the old BITMAPINFOHEADER form.
 *
 * Every size is written this way, which is not what the modern advice says and
 * is what the decoders actually accept. Written as PNGs throughout — the Vista
 * era's addition to the format — the file loaded happily in Chromium and in
 * System.Drawing, and WIC, the decoder Explorer itself uses, rejected the whole
 * thing as corrupt. Bitmaps below 256 and a PNG at 256 got it accepted, but WIC
 * then silently dropped the 256 frame and reported six images instead of seven.
 * Bitmaps throughout is the only arrangement all three read completely.
 *
 * It costs size: 364KB against 2KB, almost all of it the 256 frame, which is
 * uncompressed by definition. For an icon written once and read forever that is
 * the right side of the trade.
 *
 * Two oddities of the bitmap, both load-bearing. The declared height is twice
 * the real one, because the header describes the colour image and a
 * transparency mask stacked together. And the rows run bottom-up, because this
 * is a DIB and always has been.
 */
export function encodeBmpEntry(size: number, bgra: Buffer): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);          // header size
  header.writeInt32LE(size, 4);         // width
  header.writeInt32LE(size * 2, 8);     // height: image + mask
  header.writeUInt16LE(1, 12);          // planes
  header.writeUInt16LE(32, 14);         // bits per pixel
  header.writeUInt32LE(0, 16);          // BI_RGB, uncompressed

  // The mask is one bit per pixel, each row padded to four bytes. Left as zeros
  // throughout: with a real alpha channel every pixel is already "not masked",
  // and the mask is vestigial. It cannot be omitted, only zeroed.
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    // Bottom-up: the last row of the picture is the first row of the file.
    bgra.copy(pixels, y * size * 4, (size - 1 - y) * size * 4, (size - y) * size * 4);
  }
  header.writeUInt32LE(pixels.length + mask.length, 20);
  return Buffer.concat([header, pixels, mask]);
}

/**
 * An ICO file, built by hand.
 *
 * The format is a six-byte header, then a sixteen-byte directory entry per
 * image, then the images themselves, each a bitmap for the reasons above.
 */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const usable = images.filter(image => image.png.length > 0);
  if (!usable.length) throw new Error('nothing to put in the icon');
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // 1 = icon, 2 would be a cursor
  header.writeUInt16LE(usable.length, 4);

  const directory = Buffer.alloc(16 * usable.length);
  let offset = header.length + directory.length;
  usable.forEach((image, index) => {
    const at = index * 16;
    // 256 is written as 0. A byte cannot hold 256, and the format predates
    // anyone needing it to.
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, at);
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1);
    directory.writeUInt8(0, at + 2);     // palette size, unused at 32bpp
    directory.writeUInt8(0, at + 3);     // reserved
    directory.writeUInt16LE(1, at + 4);  // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(image.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.png.length;
  });

  return Buffer.concat([header, directory, ...usable.map(image => image.png)]);
}

/**
 * A name that does not quietly destroy the original.
 *
 * Converting a.png to png would otherwise write a.png over itself, and a
 * conversion that eats its input is not a conversion. Numbered rather than
 * overwritten for the same reason.
 */
export function outputPath(source: string, format: Format, exists = fs.existsSync): string {
  const directory = path.dirname(source);
  const base = path.basename(source, path.extname(source));
  let candidate = path.join(directory, `${base}.${format}`);
  let counter = 2;
  while (exists(candidate) && path.resolve(candidate) !== path.resolve(source)) {
    candidate = path.join(directory, `${base} (${counter}).${format}`);
    counter++;
  }
  // The one case the loop cannot fix: same name, same extension.
  if (path.resolve(candidate) === path.resolve(source)) {
    candidate = path.join(directory, `${base} (converted).${format}`);
  }
  return candidate;
}

/**
 * One icon image, in whichever encoding that size is allowed to use.
 *
 * A bitmap at every size. See encodeBmpEntry for why the PNG form, which would
 * be far smaller, is not used.
 */
function iconImage(image: NativeImage, size: number): Buffer {
  // Good quality: this is the difference between a readable 16px icon and a
  // grey smudge, and it is one resize on one small image.
  const scaled = image.resize({ width: size, height: size, quality: 'best' });
  return encodeBmpEntry(size, scaled.toBitmap());
}

export type Converted = { path: string; format: Format; bytes: number; note?: string };

/**
 * Converts a picture and says where it went.
 *
 * The path back is the point: it is what the user opens, and telling them "done"
 * without it leaves them hunting through a folder for a file they did not name.
 */
export function convertImage(source: string, wanted: Format, quality = 92): Converted {
  if (!fs.existsSync(source)) throw new Error(`there is no file at ${source}`);
  if (!canRead(source)) throw new Error(`${path.extname(source) || 'that'} is not a picture I can open`);
  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error('that file would not open as a picture — it may be damaged, or not really an image');

  const destination = outputPath(source, wanted);
  let data: Buffer;
  let note: string | undefined;

  if (wanted === 'ico') {
    const { width, height } = image.getSize();
    // Squared first: an icon is square by definition, and a wide picture squashed
    // into one looks broken in a way that is easy to blame on the conversion.
    const square = width === height ? image : image.crop({
      x: Math.max(0, Math.round((width - Math.min(width, height)) / 2)),
      y: Math.max(0, Math.round((height - Math.min(width, height)) / 2)),
      width: Math.min(width, height),
      height: Math.min(width, height),
    });
    if (width !== height) note = `it was ${width}×${height}, so I took a square out of the middle`;
    // Never upscaled past what the source has: a 64px picture blown up to 256
    // adds no detail and triples the file.
    const largest = Math.min(square.getSize().width, 256);
    const sizes = ICON_SIZES.filter(size => size <= Math.max(16, largest));
    data = encodeIco(sizes.map(size => ({ size, png: iconImage(square, size) })));
  } else if (wanted === 'jpg') {
    data = image.toJPEG(Math.max(1, Math.min(100, Math.round(quality))));
    note = 'jpg has no transparency, so anything see-through is now black';
  } else if (wanted === 'bmp') {
    data = image.toBitmap();
  } else {
    data = image.toPNG();
  }

  if (!data.length) throw new Error('the conversion produced an empty file');
  fs.writeFileSync(destination, data);
  return { path: destination, format: wanted, bytes: data.length, note };
}
