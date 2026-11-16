import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export const textCardRenderer =
  'Node.js deterministic white-background encoder';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}

function cardData(width, height) {
  assert.ok(Number.isInteger(width) && width > 0 && width <= 1024);
  assert.ok(Number.isInteger(height) && height > 0 && height <= 1536);
  const header = Buffer.alloc(13),
    pixels = Buffer.alloc((width * 4 + 1) * height, 255);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  for (let y = 0; y < height; y++) pixels[y * (width * 4 + 1)] = 0;
  return {
    header,
    pixels,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="white"/></svg>\n`,
  };
}

export function whiteTextCard(width, height) {
  const { header, pixels, svg } = cardData(width, height);
  return {
    svg,
    png: Buffer.concat([
      signature,
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  };
}

export function validateTextCardEvidence(panel, cast, record, image, read) {
  assert.equal(record.kind, 'typesetting-background');
  assert.equal(record.renderer, textCardRenderer);
  assert.equal(record.model, null);
  assert.equal(
    record.prompt,
    null,
    'A deterministic background has no AI prompt',
  );
  assert.equal(record.promptHash, null);
  assert.deepEqual(record.references, []);
  assert.equal(
    Object.keys(panel.speakers || {}).length,
    0,
    'Text cards cannot contain actors',
  );
  assert.equal(
    (panel.protected || []).length,
    0,
    'Text cards cannot hide protected objects',
  );
  assert.equal(Object.keys(panel.production?.hands || {}).length, 0);
  assert.equal((panel.production?.props || []).length, 0);
  assert.ok(
    panel.dialogue.length > 0 &&
      panel.dialogue.every((d) => cast[d.speaker]?.kind === 'caption'),
    'Text cards contain captions only',
  );
  const { header, pixels, svg } = cardData(panel.rect[2], panel.rect[3]);
  assert.ok(
    typeof record.sourceSvg === 'string' && record.sourceSvg.length > 0,
  );
  const source = Buffer.from(read(record.sourceSvg));
  assert.equal(record.sourceSvgHash, hash(source));
  assert.equal(
    source.toString('utf8').trim(),
    svg.trim(),
    'Only a plain white SVG is a text-card background',
  );
  assert.equal(record.imageHash, hash(image));
  assert.ok(image.length >= 57 && image.subarray(0, 8).equals(signature));
  assert.ok(
    image.subarray(8, 33).equals(chunk('IHDR', header)),
    'Text-card PNG dimensions/format changed',
  );
  const size = image.readUInt32BE(33);
  assert.equal(
    image.length,
    size + 57,
    'Text-card PNG must contain exactly IHDR, IDAT and IEND',
  );
  const compressed = image.subarray(41, 41 + size);
  assert.ok(image.subarray(33, 45 + size).equals(chunk('IDAT', compressed)));
  assert.ok(image.subarray(45 + size).equals(chunk('IEND', Buffer.alloc(0))));
  // Compare decoded pixels so zlib compression differences do not invalidate a white card.
  assert.ok(
    inflateSync(compressed, { maxOutputLength: pixels.length }).equals(pixels),
    'Text-card PNG must be entirely opaque white',
  );
}
