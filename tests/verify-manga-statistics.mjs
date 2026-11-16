import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTemporary } from '../src/temporary.mjs';
import { mangaStatistics } from '../src/manga-statistics.mjs';
import { reviewInputs } from '../src/stage-reviews.mjs';
import { createGenerationJobs } from '../src/generation-jobs.mjs';

const panel = (id, text = '', extras = {}) => ({
  id,
  rect: [0, 0, 1024, 1536],
  dialogue: text ? [{ speaker: 'a', text }] : [],
  speakers: { a: { kind: 'head' } },
  ...extras,
});
const config = {
  cast: { a: {}, n: { kind: 'caption' } },
  pages: [
    {
      id: '01',
      panels: [
        panel('a', '😀あ \n。'),
        panel('b', '', { speakers: { n: {}, a: { kind: 'offscreen' } } }),
        panel('c', 'a'.repeat(62), { cameraCrop: 'bust' }),
      ],
    },
  ],
};
const before = structuredClone(config);
const stats = mangaStatistics(config);
assert.equal(stats.panels[0].textCharacters, 3);
assert.equal(stats.panels[0].areaPerSpread, 0.5);
assert.equal(stats.text.silentFraction, 1 / 3);
assert.equal(stats.text.max, 62);
assert.equal(stats.textPerPage.median, 65);
assert.equal(
  stats.aspect.bins.reduce((n, b) => n + b.count, 0),
  3,
);
assert.equal(stats.physicalSpreads, null);
assert.deepEqual(
  stats.people.bins.map((b) => b.count),
  [1, 2, 0, 0],
);
assert.equal(stats.singlePersonCrop.known, 1);
assert.equal(stats.singlePersonCrop.unknown, 1);
assert.deepEqual(config, before, 'Audit must not rewrite planning');
assert.equal(mangaStatistics({ pages: [] }).text.median, null);
const unknown = mangaStatistics({
  pages: [
    { id: 'x', panels: [{ id: 'x', rect: [0, 0, 10, 10], dialogue: [] }] },
  ],
});
assert.equal(unknown.people.unknown, 1);
const consecutive = {
  cast: { a: {} },
  pages: Array.from({ length: 4 }, (_, i) => ({
    id: String(i),
    panels: Array.from({ length: 3 }, (_, j) =>
      panel(`${i}-${j}`, '字'.repeat(51), { cameraCrop: 'bust' }),
    ),
  })),
};
assert.deepEqual(
  mangaStatistics(consecutive).warnings.map((w) => w.code),
  ['dense-text-run', 'repeated-crop', 'uniform-page-count', 'no-silent-panel'],
);
assert.equal(
  mangaStatistics({
    ...consecutive,
    pages: consecutive.pages.slice(0, 1),
  }).warnings.some((w) => w.code === 'uniform-page-count'),
  false,
);
for (const [count, expected] of [
  [100, false],
  [101, true],
]) {
  const input = {
    cast: { a: {} },
    pages: [{ id: 'one', panels: [panel('one', '字'.repeat(Number(count)))] }],
  };
  assert.equal(
    mangaStatistics(input).warnings.some((w) => w.code === 'very-dense-panel'),
    expected,
  );
}
assert.equal(
  mangaStatistics(consecutive).warnings.find((w) => w.code === 'dense-text-run')
    .panels.length,
  12,
);
assert.equal(
  mangaStatistics(consecutive)
    .warnings.find((w) => w.code === 'repeated-crop')
    .panels.at(-1),
  '3-2',
);
const wide = structuredClone(consecutive);
for (const page of wide.pages)
  for (const p of page.panels) p.rect = [0, 0, 900, 300];
assert.ok(
  mangaStatistics(wide).warnings.some((w) => w.code === 'wide-panel-dominance'),
);
const boundary = structuredClone(consecutive);
boundary.pages[0].panels[1].dialogue[0].text = '字'.repeat(50);
assert.equal(
  mangaStatistics(boundary).warnings.find((w) => w.code === 'dense-text-run')
    .panels[0],
  '0-2',
);
const temporary = createTemporary('test');
fs.writeFileSync(path.join(temporary.folder, 'source.txt'), 'Synthetic source');
for (const modern of [false, true])
  for (const renderMode of ['panels', 'page']) {
    /** @type {any} */
    const c = {
      ...structuredClone(config),
      sourceFile: 'source.txt',
      renderMode,
      references: [],
      style: 'ink',
      ...(modern ? { promptPolicy: { version: 2 } } : {}),
    };
    c.pages[0].panels[0].camera = 'face and shoulders';
    const jobs = createGenerationJobs({
      config: c,
      local: (f) => path.join(temporary.folder, f),
      stateFor: () => ({}),
      svg: () => '',
    });
    const old = jobs.panelJob(c.pages[0], c.pages[0].panels[0]);
    c.pages[0].panels[0].cameraCrop = 'shoulder';
    const changed = jobs.panelJob(c.pages[0], c.pages[0].panels[0]);
    assert.notEqual(old.fingerprint, changed.fingerprint);
    assert.match(changed.prompt, /shoulder/);
    c.pages[0].panels[1].cameraCrop = 'full';
    delete c.pages[0].panels[2].cameraCrop;
    /** @type {any} */
    const pageJob = jobs.job(c.pages[0]);
    const pagePrompt = pageJob.prompt;
    assert.match(pagePrompt, /PLANNED CAMERA CROP for panel a: shoulder/);
    assert.match(pagePrompt, /PLANNED CAMERA CROP for panel b: full/);
    assert.equal(
      pagePrompt.includes('PLANNED CAMERA CROP for panel c:'),
      false,
    );

    assert.equal(
      reviewInputs(c, 'test.json', 'script').base.script.pages[0].panels[0]
        .cameraCrop,
      'shoulder',
    );
  }
temporary.cleanup();
console.log(
  'PASS: descriptive statistics, denominators, unknowns, advisory boundaries, no mutation and shot fingerprint invalidation',
);
