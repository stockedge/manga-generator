import assert from 'node:assert/strict';
import { inspectProduction } from '../src/production-preflight.mjs';

const panel = {
  id: '01-1',
  rect: [0, 0, 800, 400],
  dialogue: [],
  speakers: { hero: { face: [500, 100, 80, 80] } },
  production: {
    moment: '杖を構える',
    before: '杖は鞄の中',
    after: '杖を握ったまま進む',
    hands: { hero: { left: '空手', right: 'wandを握る' } },
    props: [
      {
        id: 'wand',
        before: '鞄内',
        during: '右手で保持',
        after: '右手で保持',
        heldBy: 'hero.right',
      },
    ],
  },
};
const config = { cast: { hero: {} }, pages: [{ id: '01', panels: [panel] }] };
assert.equal(inspectProduction(config).warnings, 0);
const impossible = structuredClone(config);
impossible.pages[0].panels[0].production.props.push({
  id: 'bottle',
  before: '鞄内',
  during: '右手で保持',
  after: '右手で保持',
  heldBy: 'hero.right',
});
assert.match(
  inspectProduction(impossible).panels[0].issues.join(' '),
  /同時に割り当て/,
);
const missing = structuredClone(config);
delete missing.pages[0].panels[0].production;
assert.equal(inspectProduction(missing).warnings, 1);
const tiny = structuredClone(config);
tiny.pages[0].panels[0].speakers.hero.face[3] = 25;
assert.match(inspectProduction(tiny).panels[0].issues.join(' '), /40px未満/);
console.log('Production preflight passed');
