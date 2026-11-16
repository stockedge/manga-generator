import assert from 'node:assert/strict';

export function cropRectangle(crop, bytes) {
  if (crop === undefined) return undefined;
  assert.ok(
    Array.isArray(crop) && crop.length === 4 && crop.every(Number.isFinite),
    'artworkCrop must contain four finite native-pixel coordinates',
  );
  const [x, y, width, height] = crop;
  assert.ok(
    x >= 0 && y >= 0 && width > 0 && height > 0,
    'Invalid artworkCrop rectangle',
  );
  if (bytes !== undefined) {
    assert.ok(
      bytes.length >= 24 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'artworkCrop requires a PNG header',
    );
    assert.ok(
      x + width <= bytes.readUInt32BE(16) &&
        y + height <= bytes.readUInt32BE(20),
      'artworkCrop exceeds the source PNG',
    );
  }
  return crop;
}

export function renderArtworkImage(bytes, panel) {
  const [x, y, width, height] = panel.rect;
  const href = 'data:image/png;base64,' + bytes.toString('base64');
  const crop = cropRectangle(panel.artworkCrop, bytes);
  if (!crop)
    return `<image href="${href}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
  const [sx, sy, sw, sh] = crop;
  // The inner viewport also clips source pixels that would leak into meet's letterbox bands.
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${crop.join(' ')}" preserveAspectRatio="xMidYMid meet" overflow="hidden"><svg x="${sx}" y="${sy}" width="${sw}" height="${sh}" viewBox="${crop.join(' ')}" overflow="hidden"><image href="${href}" width="${bytes.readUInt32BE(16)}" height="${bytes.readUInt32BE(20)}"/></svg></svg>`;
}
