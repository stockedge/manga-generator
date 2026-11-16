import assert from 'node:assert/strict';
import { box, overlap, segmentEntry, xml } from './lettering.mjs';

// Conservative glyph cells keep optional lettering inside its inspected region.
export function soundEffectBox(effect) {
  assert.ok(effect && typeof effect.text === 'string' && effect.text.trim());
  assert.ok(
    ![...effect.text].some(
      (c) => c.codePointAt(0) < 32 || c.codePointAt(0) === 127,
    ),
    'Sound effect must be one line',
  );
  assert.ok(
    Number.isInteger(effect.fontSize) &&
      effect.fontSize >= 20 &&
      effect.fontSize <= 160,
    'Sound effect fontSize must be an integer from 20 to 160',
  );
  assert.ok(
    [effect.x, effect.y].every(Number.isFinite),
    'Sound effect position must be finite',
  );
  return [
    effect.x,
    effect.y,
    [...effect.text].length * effect.fontSize,
    effect.fontSize * 1.5,
  ];
}

export function validateSoundEffects(panel, tailGeometry) {
  assert.ok(
    panel.soundEffects === undefined || Array.isArray(panel.soundEffects),
    'soundEffects must be an array',
  );
  const [x, y, w, h] = panel.rect;
  const protectedBoxes = [
    ...Object.values(panel.speakers || {}).flatMap((s) =>
      s.face ? [s.face] : [],
    ),
    ...(panel.protected || []),
    ...panel.dialogue.map((d) => box(panel, d)),
  ];
  const accepted = [];
  for (const effect of panel.soundEffects || []) {
    const r = soundEffectBox(effect);
    assert.ok(
      r[0] >= x && r[1] >= y && r[0] + r[2] <= x + w && r[1] + r[3] <= y + h,
      'Sound effect outside panel: ' + panel.id,
    );
    assert.ok(
      ![...protectedBoxes, ...accepted].some((b) => overlap(r, b)),
      'Sound effect covers face, lettering or protected area: ' + panel.id,
    );
    for (const d of panel.dialogue) {
      const t = tailGeometry(panel, d);
      if (t)
        assert.equal(
          segmentEntry(t.base, t.tip, r),
          null,
          'Tail crosses sound effect: ' + panel.id,
        );
      if (t) {
        const points = [t.a || t.base, t.b || t.base, t.tip];
        const left = Math.min(...points.map((p) => p[0])) - 2;
        const top = Math.min(...points.map((p) => p[1])) - 2;
        const right = Math.max(...points.map((p) => p[0])) + 2;
        const bottom = Math.max(...points.map((p) => p[1])) + 2;
        assert.ok(
          !overlap(r, [left, top, right - left, bottom - top]),
          'Tail region touches sound effect: ' + panel.id,
        );
      }
    }
    accepted.push(r);
  }
  return accepted;
}

export function renderSoundEffects(panel) {
  return (panel.soundEffects || [])
    .map((effect) => {
      const [x, y, w] = soundEffectBox(effect);
      return `<text x="${x}" y="${y + effect.fontSize}" font-family="Yu Gothic,Meiryo,sans-serif" font-size="${effect.fontSize}" fill="black" textLength="${w}" lengthAdjust="spacingAndGlyphs">${xml(effect.text)}</text>`;
    })
    .join('');
}
