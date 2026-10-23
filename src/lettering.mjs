import assert from 'node:assert/strict';
export const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c],
  );
export const overlap = (a, b) =>
  a[0] < b[0] + b[2] &&
  b[0] < a[0] + a[2] &&
  a[1] < b[1] + b[3] &&
  b[1] < a[1] + a[3];
export function columns(text, count = 10) {
  const result = [];
  let line = '';
  for (const c of text.replace(/\n/g, '')) {
    // Closing punctuation stays with the preceding column even at the capacity boundary.
    if ([...line].length >= count && !'。、！？）」』…'.includes(c)) {
      result.push(line);
      line = '';
    }
    line += c;
  }
  if (line) result.push(line);
  return result;
}
export function speechColumns(speech) {
  if (speech.textColumns === undefined)
    return columns(speech.text, speech.capacity ?? 10);
  assert.ok(
    Array.isArray(speech.textColumns) &&
      speech.textColumns.length > 0 &&
      speech.textColumns.every(
        (s) => typeof s === 'string' && s.trim().length > 0,
      ),
    'textColumns must be a nonempty array of nonempty strings',
  );
  assert.equal(
    speech.textColumns.join(''),
    speech.text.replace(/\n/g, ''),
    'textColumns must preserve the complete dialogue text',
  );
  return speech.textColumns;
}
export function box(panel, speech) {
  const lines = speechColumns(speech);
  validateTextSizeRanges(speech);
  assert.ok(
    speech.textDirection === undefined ||
      ['vertical', 'horizontal'].includes(speech.textDirection),
    'Invalid textDirection',
  );
  const horizontal = speech.textDirection === 'horizontal';
  const longest = Math.max(...lines.map((s) => [...s].length));
  const width = horizontal ? longest * 26 + 36 : lines.length * 28 + 36;
  const height = horizontal ? lines.length * 32 + 42 : longest * 27 + 42;
  const [x, y, w] = panel.rect;
  return [
    speech.x === undefined
      ? speech.side === 'right'
        ? x + w - width - 18
        : x + 18
      : x + speech.x,
    y + (speech.dy ?? 18),
    width,
    height,
  ];
}
export function validateTextSizeRanges(speech) {
  if (speech.textSizeRanges === undefined) return;
  assert.ok(
    Array.isArray(speech.textSizeRanges) && speech.textSizeRanges.length > 0,
    'textSizeRanges must be a nonempty array',
  );
  const length = [...speech.text.replace(/\n/g, '')].length;
  let previousEnd = 0;
  for (const range of speech.textSizeRanges) {
    assert.ok(
      range &&
        typeof range === 'object' &&
        !Array.isArray(range) &&
        Object.keys(range).every((k) =>
          ['start', 'end', 'fontSize'].includes(k),
        ),
      'Invalid textSizeRanges entry',
    );
    const { start, end, fontSize } = range;
    assert.ok(
      Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= previousEnd &&
        start < end &&
        end <= length,
      'textSizeRanges must be sorted, nonoverlapping Unicode code point ranges within text',
    );
    assert.ok(
      Number.isInteger(fontSize) && fontSize >= 20 && fontSize <= 26,
      'textSizeRanges fontSize must be an integer from 20 to 26',
    );
    previousEnd = end;
  }
}
export function sizedText(text, speech, offset) {
  if (speech.textSizeRanges === undefined) return xml(text);
  const chars = [...text];
  const cuts = [
    0,
    chars.length,
    ...speech.textSizeRanges
      .flatMap((r) => [r.start - offset, r.end - offset])
      .filter((n) => n > 0 && n < chars.length),
  ].sort((a, b) => a - b);
  const points = [...new Set(cuts)];
  return points
    .slice(0, -1)
    .map((start, i) => {
      const end = points[i + 1];
      const range = speech.textSizeRanges.find(
        (r) => r.start <= offset + start && offset + start < r.end,
      );
      const content = xml(chars.slice(start, end).join(''));
      return range
        ? `<tspan font-size="${range.fontSize}">${content}</tspan>`
        : content;
    })
    .join('');
}
export function segmentEntry(a, b, rect) {
  let low = 0,
    high = 1;
  for (let axis = 0; axis < 2; axis++) {
    const delta = b[axis] - a[axis],
      min = rect[axis],
      max = min + rect[axis + 2];
    if (delta === 0) {
      if (a[axis] < min || a[axis] > max) return null;
      continue;
    }
    const t1 = (min - a[axis]) / delta,
      t2 = (max - a[axis]) / delta;
    low = Math.max(low, Math.min(t1, t2));
    high = Math.min(high, Math.max(t1, t2));
    if (low > high) return null;
  }
  return low;
}
export function createLettering(cast) {
  const caption = (id) => cast[id]?.kind === 'caption';
  function tailGeometry(panel, d) {
    const speaker = panel.speakers?.[d.speaker];
    if (caption(d.speaker) || speaker?.kind === 'offscreen') return null;
    assert.ok(
      speaker?.anchor,
      'Missing speaker anchor: ' + panel.id + '/' + d.speaker,
    );
    const [x, y, w, h] = box(panel, d),
      cx = x + w / 2,
      cy = y + h / 2;
    const [tx, ty] = speaker.anchor,
      dx = tx - cx,
      dy = ty - cy;
    const scale = Math.min(
      dx === 0 ? Infinity : w / 2 / Math.abs(dx),
      dy === 0 ? Infinity : h / 2 / Math.abs(dy),
    );
    assert.ok(scale < 1, 'Speaker anchor inside balloon: ' + panel.id);
    const bx = cx + dx * scale,
      by = cy + dy * scale;
    const length = Math.hypot(tx - bx, ty - by),
      ux = (tx - bx) / length,
      uy = (ty - by) / length;
    const faceEntry = speaker.face
      ? segmentEntry([bx, by], [tx, ty], speaker.face)
      : null;
    const reach = Math.max(
      0,
      Math.min(
        d.tailLength ?? 160,
        length - 28,
        faceEntry === null ? Infinity : length * faceEntry - 6,
      ),
    );
    const tip = [bx + ux * reach, by + uy * reach];
    const horizontal = Math.abs(bx - x) < 1 || Math.abs(bx - x - w) < 1;
    return {
      base: [bx, by],
      tip,
      a: [
        bx - (horizontal ? 0 : 7) - ux * 4,
        by - (horizontal ? 7 : 0) - uy * 4,
      ],
      b: [
        bx + (horizontal ? 0 : 7) - ux * 4,
        by + (horizontal ? 7 : 0) - uy * 4,
      ],
    };
  }
  function balloon(panel, d) {
    const [x, y, w, h] = box(panel, d),
      lines = speechColumns(d);
    const isCaption = caption(d.speaker);
    const t = tailGeometry(panel, d);
    const tail = t
      ? `<path data-speaker="${d.speaker}" d="M ${t.a.join(' ')} L ${t.tip.join(' ')} L ${t.b.join(' ')}" fill="white" stroke="black" stroke-width="2"/>`
      : '';
    const shape = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${isCaption ? '' : `rx="${Math.min(34, w / 3)}"`} fill="white" stroke="black" stroke-width="2"/>`;
    let offset = 0;
    const content = lines.map((text) => {
      const result = sizedText(text, d, offset);
      offset += [...text].length;
      return result;
    });
    if (d.textDirection === 'horizontal')
      return (
        tail +
        shape +
        lines
          .map(
            (text, i) =>
              `<text x="${x + 18}" y="${y + 34 + i * 32}" font-family="Meiryo,MS Gothic,sans-serif" font-size="26" fill="black">${content[i]}</text>`,
          )
          .join('')
      );
    return (
      tail +
      shape +
      lines
        .map(
          (text, i) =>
            `<text x="${x + w - 24 - i * 28}" y="${y + 22}" font-family="Meiryo,MS Gothic,sans-serif" font-size="26" fill="black" style="writing-mode:vertical-rl;text-orientation:upright">${content[i]}</text>`,
        )
        .join('')
    );
  }
  function balloonMask(panel, d) {
    const [x, y, w, h] = box(panel, d),
      radius = Math.min(34, w / 3);
    const t = tailGeometry(panel, d);
    const tail = t
      ? `<path d="M ${t.a.join(' ')} L ${t.tip.join(' ')} L ${t.b.join(' ')} Z" fill="white" stroke="white" stroke-width="6" stroke-linejoin="round"/>`
      : '';
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="white" stroke="white" stroke-width="6"/>${tail}`;
  }
  return { tailGeometry, balloon, balloonMask };
}
