import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTemporary } from '../src/temporary.mjs';
import {
  productionMode,
  reviewInputs,
  captureReview,
} from '../src/stage-reviews.mjs';

const c = {
  outputDir: 'output',
  sourceFile: 'original.txt',
  workflowDir: 'workflow',
  assetDir: 'assets',
  cast: {
    a: { faceDesign: { reference: 'a.png' } },
    b: { faceDesign: { reference: 'b.png' } },
  },
  sections: { now: { location: 'room' }, later: { location: 'station' } },
  references: ['a.png', 'b.png', 'style.png'],
  referenceRoles: { 'a.png': 'identity', 'b.png': 'identity' },
  pages: [
    {
      id: '01',
      section: 'now',
      panels: [{ id: '01-1', speakers: { a: {} }, dialogue: [] }],
    },
    {
      id: '02',
      section: 'later',
      panels: [{ id: '02-1', speakers: { b: {} }, dialogue: [] }],
    },
  ],
};
const input = (config, stage = 'artwork') =>
  reviewInputs(config, 'workflow.json', stage, '01');
assert.equal(productionMode(c), 'quality');
assert.throws(() => productionMode({ productionMode: 'cheap' }));
const legacy = input(c);
assert.equal(legacy.base.productionMode, undefined);
assert.deepEqual(legacy.base.script.cast, c.cast);
const economy = { ...c, productionMode: 'economy' };
const scoped = input(economy);
assert.deepEqual(Object.keys(scoped.base.script.cast), ['a']);
assert.deepEqual(Object.keys(scoped.base.script.sections), ['now']);
assert.ok(scoped.files.includes('original.txt'));
assert.ok(scoped.files.includes('style.png'));
assert.ok(!scoped.files.includes('b.png'));
assert.ok(
  JSON.stringify(scoped).length <
    JSON.stringify(input({ ...c, productionMode: 'quality' })).length,
);
for (const stage of ['source', 'script', 'final']) {
  const full = input(economy, stage);
  assert.ok(full.files.includes('original.txt'));
  if (stage !== 'source') assert.deepEqual(full.base.script.cast, c.cast);
}
const boundary = input(economy, 'storyboard');
assert.deepEqual(Object.keys(boundary.base.script.cast), ['a', 'b']);
assert.ok(boundary.files.includes('b.png'));
const shared = structuredClone(economy);
shared.referenceRoles['b.png'] = 'Face and drawing style';
assert.ok(input(shared).files.includes('b.png'));
const explicit = structuredClone(economy);
explicit.pages[0].references = ['b.png'];
assert.ok(input(explicit).files.includes('b.png'));
const unrelated = structuredClone(economy);
unrelated.cast.b.extra = 'unrelated edit';
assert.deepEqual(input(unrelated), scoped);
const changed = structuredClone(economy);
changed.cast.a.extra = 'identity changed';
assert.notDeepEqual(input(changed), scoped);
const temporary = createTemporary('test');
try {
  // Text placeholders exercise hashing only; these are not inspected manga images.
  for (const file of legacy.files) {
    const full = path.join(temporary.folder, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'mechanical hashing fixture');
  }
  const capture = (config) =>
    captureReview(temporary.folder, config, 'workflow.json', 'artwork', '01')
      .fingerprint;
  const before = capture(economy);
  assert.equal(capture(unrelated), before);
  assert.notEqual(capture(changed), before);
  assert.notEqual(capture({ ...c, productionMode: 'quality' }), before);
  fs.writeFileSync(
    path.join(temporary.folder, 'b.png'),
    'unrelated reference edit',
  );
  assert.equal(capture(economy), before);
  fs.writeFileSync(
    path.join(temporary.folder, 'a.png'),
    'relevant reference edit',
  );
  assert.notEqual(capture(economy), before);
} finally {
  temporary.cleanup();
}
console.log(
  'OK: production modes, scoped inputs, boundaries and relevant invalidation',
);
