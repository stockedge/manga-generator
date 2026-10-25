import { createTemporary } from '../src/temporary.mjs';
import { copyRuntime } from './support.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { root } from '../src/workspace.mjs';
import { local } from '../src/project.mjs';
import {
  columns,
  speechColumns,
  box,
  segmentEntry,
  overlap,
  createLettering,
} from '../src/lettering.mjs';
import { findDialogueLayout } from '../src/dialogue-layout.mjs';
import { resolveStoryState } from '../src/story-state.mjs';
import { resolvedNarrativeState } from '../src/reading-flow.mjs';
import { captureWorkflow } from './workflow-fixture.mjs';

assert.deepEqual(columns('あいうえお。', 5), ['あいうえお。']);
assert.deepEqual(columns('😀あいう', 2), ['😀あ', 'いう']);
assert.throws(
  () => speechColumns({ text: '全文', textColumns: ['全'] }),
  /complete dialogue/,
);
const cast = { a: {}, n: { kind: 'caption' } },
  page = { section: 'shop' };
const config = {
  cast,
  sections: {
    shop: {
      costumes: { a: 'white' },
      objects: { letter: 'sealed' },
      location: 'shop',
    },
  },
};
const panel = {
  id: '01-1',
  rect: [24, 24, 976, 650],
  speakers: { a: { anchor: [100, 300], face: [60, 250, 80, 100] } },
  state: { costumes: { a: 'black' }, objects: { letter: 'opened' } },
  dialogue: [{ speaker: 'a', text: '😀あい', side: 'right' }],
};
const expectedState = {
  costumes: { a: 'black' },
  objects: { letter: 'opened' },
  location: 'shop',
};
assert.deepEqual(resolveStoryState(config, page, panel, local), expectedState);
assert.deepEqual(resolvedNarrativeState(config, page, panel), expectedState);
assert.equal(config.sections.shop.objects.letter, 'sealed');
assert.throws(
  () =>
    resolveStoryState(config, page, { ...panel, section: 'missing' }, local),
  /Unknown story section/,
);
assert.throws(
  () =>
    resolveStoryState(
      config,
      page,
      { ...panel, state: { costumes: { missing: 'coat' } } },
      local,
    ),
  /Unknown costume actor/,
);
assert.throws(
  () =>
    resolveStoryState(
      config,
      page,
      { ...panel, state: { references: ['../escape'] } },
      local,
    ),
  /escapes workspace/,
);
assert.deepEqual(box(panel, panel.dialogue[0]).slice(2), [64, 123]);
assert.deepEqual(
  box(panel, { ...panel.dialogue[0], textDirection: 'horizontal' }).slice(2),
  [114, 74],
);
assert.equal(overlap([0, 0, 10, 10], [10, 0, 10, 10]), false);
assert.equal(segmentEntry([0, 5], [20, 5], [10, 0, 10, 10]), 0.5);
assert.equal(segmentEntry([0, 20], [20, 20], [10, 0, 10, 10]), null);
const lettering = createLettering(cast);
assert.equal(lettering.tailGeometry(panel, { speaker: 'n' }), null);
const tail = lettering.tailGeometry(panel, panel.dialogue[0]);
assert.equal(segmentEntry(tail.base, tail.tip, panel.speakers.a.face), null);
const before = structuredClone(panel);
const dialogue = findDialogueLayout(page, panel, cast);
assert.deepEqual(panel, before, 'Placement search must not mutate its input');
assert.equal(dialogue[0].text, panel.dialogue[0].text);
assert.throws(
  () => findDialogueLayout(page, { ...panel, rect: [0, 0, 10, 10] }, cast),
  /No safe dialogue placement/,
);

// Importing computation/project modules must not require a selected work or save history.
const modules = [
  'project',
  'lettering',
  'dialogue-layout',
  'story-state',
  'generation-jobs',
  'assets',
];
execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `import assert from 'node:assert/strict'; const listeners=process.listenerCount('exit');
   for(const url of ${JSON.stringify(modules.map((name) => pathToFileURL(path.join(root, 'src', name + '.mjs')).href))}) await import(url);
   assert.equal(process.listenerCount('exit'),listeners);`,
  ],
  {
    env: {
      ...process.env,
      MANGA_PROJECT: 'works/nonexistent-refactor-test/workflow.json',
    },
    stdio: 'pipe',
    windowsHide: true,
  },
);
const temporary = createTemporary('test');
const folder = temporary.folder;
try {
  fs.writeFileSync(path.join(folder, 'workflow.json'), '{}');
  copyRuntime(root, folder);
  const projectURL = pathToFileURL(path.join(folder, 'src/project.mjs')).href;
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import assert from "node:assert/strict"; import { loadProject } from ' +
        JSON.stringify(projectURL) +
        '; assert.deepEqual(loadProject("workflow.json").config, {}); assert.equal(loadProject("workflow.json").configFile,"workflow.json");',
    ],
    { windowsHide: true },
  );

  // Recorded from the pre-extraction runtime; never refresh from the implementation under test.
  const expected = JSON.parse(
    fs.readFileSync(
      path.join(root, 'tests/fixtures/workflow-refactor.json'),
      'utf8',
    ),
  );
  assert.deepEqual(captureWorkflow(root), expected);
} finally {
  temporary.cleanup();
}
console.log(
  'PASS: pure lettering/layout, validated shared story state, explicit project loading, pre-refactor SVG/HTML/jobs/fingerprints/layout parity in four modes',
);
