import assert from 'node:assert/strict';
import {
  validateSoundEffects,
  renderSoundEffects,
} from '../src/sound-effects.mjs';
const panel = {
  id: 'test',
  rect: [16, 16, 600, 500],
  speakers: { a: { face: [400, 40, 80, 100] } },
  protected: [[200, 200, 80, 80]],
  dialogue: [],
  soundEffects: [{ text: 'ガンッ', x: 30, y: 30, fontSize: 80 }],
};
assert.equal(validateSoundEffects(panel, () => null).length, 1);
assert.match(renderSoundEffects(panel), /font-size="80"/);
assert.equal(renderSoundEffects({ ...panel, soundEffects: undefined }), '');
for (const effect of [
  { text: 'ガンッ', x: 500, y: 30, fontSize: 80 },
  { text: 'ガン', x: 200, y: 180, fontSize: 80 },
  { text: 'ガン', x: 400, y: 40, fontSize: 80 },
  { text: 'a\nb', x: 30, y: 30, fontSize: 80 },
  { text: 'a', x: 30, y: 30, fontSize: NaN },
])
  assert.throws(() =>
    validateSoundEffects({ ...panel, soundEffects: [effect] }, () => null),
  );
assert.throws(() =>
  validateSoundEffects(
    { ...panel, soundEffects: [panel.soundEffects[0], panel.soundEffects[0]] },
    () => null,
  ),
);
assert.throws(
  () =>
    validateSoundEffects(
      { ...panel, dialogue: [{ text: 'a', x: 450, dy: 300 }] },
      () => ({ base: [20, 60], tip: [350, 60] }),
    ),
  /Tail crosses sound effect/,
);
assert.match(
  renderSoundEffects({
    ...panel,
    soundEffects: [{ text: '<&', x: 30, y: 30, fontSize: 20 }],
  }),
  /&lt;&amp;/,
);
assert.throws(
  () =>
    validateSoundEffects(
      { ...panel, dialogue: [{ text: 'a', x: 450, dy: 300 }] },
      () => ({ base: [20, 29], a: [20, 22], b: [20, 36], tip: [350, 29] }),
    ),
  /Tail region touches/,
);
console.log(
  'OK: optional sound effects, bounds, protected regions, overlap, tail collision and escaping',
);
