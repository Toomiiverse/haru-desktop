/** A bounded, opaque working copy; the user's original file is never modified. */
export async function wardrobeImage(blob: Blob): Promise<{ image: string; width: number; height: number }> {
  if (blob.size > 20 * 1024 * 1024) throw Error('Choose a picture smaller than 20 MB.');
  const picture = await createImageBitmap(blob);
  try {
    if (picture.width > 16384 || picture.height > 16384) throw Error('Choose a picture no larger than 16,384 pixels per side.');
    const scale = Math.min(1, 1536 / Math.max(picture.width, picture.height));
    const width = Math.max(64, Math.round(picture.width * scale / 8) * 8), height = Math.max(64, Math.round(picture.height * scale / 8) * 8);
    const work = document.createElement('canvas'); work.width = width; work.height = height;
    const context = work.getContext('2d')!;
    context.fillStyle = 'white'; context.fillRect(0, 0, width, height);
    context.drawImage(picture, 0, 0, width, height);
    return { image: work.toDataURL('image/png'), width, height };
  } finally { picture.close(); }
}
