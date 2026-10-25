import { createTemporary } from '../src/temporary.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyRuntime } from './support.mjs';
import { root } from '../src/workspace.mjs';
import { referenceManifest, panelPrompt, editPrompt } from '../src/prompts.mjs';
import {
  firstReadingRequest,
  saveFirstReading,
  loadFirstReading,
  validateFirstComparison,
} from '../src/first-reading.mjs';
import { captureReview } from '../src/stage-reviews.mjs';

const temporary = createTemporary('test');
const folder = temporary.folder;
const write = (name, data) => {
  const file = path.join(folder, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof data === 'string' || Buffer.isBuffer(data)
      ? data
      : JSON.stringify(data, null, 2),
  );
};
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
const run = (cli, ...args) =>
  execFileSync(
    process.execPath,
    [path.join(folder, 'cli', cli + '.mjs'), ...args],
    {
      cwd: folder,
      env: { ...process.env, MANGA_PROJECT: 'fixture/workflow.json' },
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    },
  );
try {
  copyRuntime(root, folder);
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'works/sample/workflow.json'), 'utf8'),
  );
  Object.assign(config, {
    promptPolicy: { version: 2 },
    renderMode: 'panels',
    sourceFile: 'fixture/source.txt',
    workflowDir: 'fixture/workflow',
    assetDir: 'fixture/assets',
    outputDir: 'fixture/output',
    references: [
      'fixture/assets/characters.png',
      'fixture/assets/panels/previous.png',
    ],
  });
  const page = config.pages[0],
    panel = page.panels[0];
  config.cast.a.faceDesign = {
    reference: config.references[0],
    traits: ['narrow eyes', 'thick brows', 'square jaw'],
  };
  config.cast.b.description = 'ABSENT_ACTOR_MARKER';
  config.sections = {
    opening: {
      location: 'A garden with a bookshelf',
      costumes: { a: 'white shirt', b: 'ABSENT_COSTUME_MARKER' },
    },
  };
  page.section = 'opening';
  panel.scene = 'A person reads beside a plant and a bookshelf.';
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(1024, 16);
  png.writeUInt32BE(1536, 20);
  write('fixture/source.txt', 'Synthetic test original');
  for (const file of config.references) write(file, png);
  write('fixture/workflow.json', config);
  run('workflow', 'plan');
  const jobs = read('fixture/workflow/panel-jobs.json');
  const job = jobs[0];
  assert.equal(job.promptVersion, 2);
  assert.deepEqual(
    job.referenceManifest.map((r) => r.kind),
    ['identity', 'support', 'layout'],
  );
  assert.ok(
    !job.prompt.includes('ABSENT_ACTOR_MARKER') &&
      !job.prompt.includes('ABSENT_COSTUME_MARKER'),
  );
  assert.match(job.prompt, /plant and a bookshelf/);
  assert.ok(!job.prompt.includes('table, chairs'));
  for (const j of jobs) write(`fixture/workflow/panels/page-${j.id}.png`, png);
  const prepared = JSON.parse(run('generation', 'prepare', panel.id));
  assert.equal(
    prepared.prompt,
    job.prompt,
    'Prepare must not append fixed furniture/background instructions',
  );
  assert.equal(
    read(prepared.request).references[1].kind,
    'support',
    'Accepted art in a panels directory is not a storyboard',
  );
  write('fixture/change.txt', 'Repair the left hand and the cup it touches.');
  const edited = JSON.parse(
    run(
      'generation',
      'prepare-edit',
      panel.id,
      config.references[1],
      'fixture/change.txt',
      '--reference',
      config.references[0],
      '--reference',
      config.references[1],
    ),
  );
  assert.equal(
    edited.references.length,
    2,
    'Final manifest deduplicates target and support',
  );
  assert.equal(edited.referenceManifest[0].kind, 'edit-target');
  assert.equal(edited.referenceManifest[1].index, 2);
  assert.match(edited.prompt, /Image 2: identity/);
  assert.ok(
    !edited.prompt.includes('SCENE DATA'),
    'Editing must not append a fresh-generation prompt',
  );
  const differentModel = JSON.parse(
    run('generation', 'prepare', panel.id, '--model', 'test-model'),
  );
  assert.notEqual(
    differentModel.request,
    prepared.request,
    'Different invocation metadata needs a distinct immutable request',
  );
  assert.deepEqual(
    JSON.parse(run('generation', 'prepare', panel.id)),
    prepared,
    'Repeated preparation is immutable',
  );
  const manifest = referenceManifest(
    config,
    [config.references[1], ...job.references],
    { target: config.references[1], layouts: [job.references[2]] },
  );
  assert.match(
    editPrompt('Change expression', manifest),
    /change request overrides preservation/,
  );
  assert.match(
    panelPrompt(config, page, panel, config.sections.opening, [], manifest),
    /narrow eyes/,
  );

  for (const j of jobs)
    run(
      'workflow',
      'accept-panel',
      j.id,
      path.join(folder, config.references[0]),
      '--reviewed',
      '--reason',
      'Synthetic blank fixture; no artwork quality is certified',
    );
  run('workflow', 'quality-plan');
  const quality = read(`fixture/workflow/quality/${panel.id}.template.json`);
  quality.observation =
    'Synthetic fixture to exercise repair reference ordering only.';
  quality.views = { thumbnail: true, native: true, detail: true };
  for (const check of Object.values(quality.checks)) {
    check.result = 'fail';
    check.note = 'Synthetic repair target';
  }
  write('fixture/quality-response.json', quality);
  run('workflow', 'quality-review', panel.id, 'fixture/quality-response.json');
  run('workflow', 'quality-repair', panel.id);
  const repair = read(`fixture/workflow/quality/${panel.id}.repair.json`);
  assert.equal(repair.referenceManifest[0].kind, 'edit-target');
  assert.equal(repair.references.length, repair.referenceManifest.length);
  assert.match(repair.prompt, /Image 4: layout/);
  assert.ok(!repair.prompt.includes('SCENE DATA'));

  config.referenceRoles = { [config.references[1]]: 'Changed support role' };
  write('fixture/workflow.json', config);
  assert.throws(
    () => run('generation', 'prepare', panel.id),
    'Changed roles require a fresh plan',
  );
  delete config.referenceRoles;
  const detail = 'fixture/assets/detail.png';
  write(detail, png);
  panel.references = [detail];
  config.renderMode = 'page';
  write('fixture/workflow.json', config);
  run('workflow', 'plan');
  const pageJob = read('fixture/workflow/jobs.json')[0];
  assert.equal(pageJob.promptVersion, 2);
  assert.ok(
    pageJob.references.includes(detail),
    'Page generation must include panel-specific references',
  );
  assert.equal(
    pageJob.referenceManifest.find((r) => r.file === detail).kind,
    'support',
  );
  delete panel.references;
  config.renderMode = 'panels';
  write('fixture/workflow.json', config);
  run('workflow', 'plan');

  // This test records synthetic observations; it certifies no real image review.
  config.productionReview = { required: true, readingProtocol: 'two-phase-v1' };
  write('fixture/workflow/storyboards-unnumbered/page-01.png', png);
  const request = firstReadingRequest(folder, config, 'storyboard', '01');
  assert.ok(!JSON.stringify(request).includes(panel.scene));
  assert.ok(
    !Object.hasOwn(request, 'script') &&
      !Object.hasOwn(request, 'predictedOrder'),
  );
  assert.throws(
    () =>
      captureReview(
        folder,
        config,
        'fixture/workflow.json',
        'storyboard',
        '01',
      ),
    /first reading/,
  );
  const response = {
    reviewer: { role: 'subagent', task: 'synthetic-test-only' },
    pages: [
      {
        page: '01',
        scan: 'Top right balloon, then left face, then lower silent reaction.',
        observation:
          'Synthetic location observation, no actual inspection claimed.',
      },
    ],
  };
  saveFirstReading(folder, config, request, response);
  saveFirstReading(folder, config, request, response);
  assert.throws(
    () =>
      saveFirstReading(folder, config, request, {
        ...response,
        pages: [{ ...response.pages[0], scan: 'Rewritten to intended order' }],
      }),
    /immutable/,
  );
  const first = loadFirstReading(folder, config, 'storyboard', '01');
  const comparisonRequest = captureReview(
    folder,
    config,
    'fixture/workflow.json',
    'storyboard',
    '01',
  );
  assert.deepEqual(comparisonRequest.base.firstReading, first.record);
  assert.ok(
    comparisonRequest.files.includes(
      'fixture/workflow/storyboards-unnumbered/page-01.png',
    ),
  );
  write('fixture/workflow.json', config);
  const cliFirst = JSON.parse(
    run('stage-review', 'prepare-reading', 'storyboard', '01'),
  );
  assert.equal(cliFirst.inputs.length, 1);
  assert.ok(
    cliFirst.inputs[0].endsWith('storyboards-unnumbered\\page-01.png') ||
      cliFirst.inputs[0].endsWith('storyboards-unnumbered/page-01.png'),
  );
  write('fixture/first-response.json', {
    ...response,
    request: cliFirst.request,
  });
  run(
    'stage-review',
    'record-reading',
    'storyboard',
    '01',
    'fixture/first-response.json',
  );
  const cliComparison = JSON.parse(
    run('stage-review', 'prepare', 'storyboard', '01'),
  );
  assert.equal(cliComparison.firstReadingHash, first.hash);
  const comparisonResponse = {
    request: cliComparison.request,
    reviewer: response.reviewer,
    status: 'pass',
    observations: ['Synthetic observation one', 'Synthetic observation two'],
    issues: [],
    readingReview: {
      firstReadingHash: first.hash,
      comparison: 'Synthetic saved scan agrees with the synthetic plan.',
      withoutGuides: true,
      observations: [
        'Synthetic natural scan evidence',
        'Synthetic proximity evidence',
      ],
      predictedOrder: page.panels.map((p) => ({
        panel: p.id,
        dialogue: p.dialogue.map((_, i) => i + 1),
      })),
      transitions: page.panels.slice(1).map((p, i) => ({
        from: page.panels[i].id,
        to: p.id,
        observation: 'Synthetic continuity evidence',
      })),
    },
  };
  write('fixture/comparison-response.json', comparisonResponse);
  run(
    'stage-review',
    'record',
    'storyboard',
    '01',
    'fixture/comparison-response.json',
  );
  run('stage-review', 'check', 'storyboard', '01');
  const wrong = structuredClone(comparisonResponse);
  wrong.readingReview.predictedOrder[0].dialogue = [99];
  write('fixture/wrong-response.json', wrong);
  assert.throws(() =>
    run(
      'stage-review',
      'record',
      'storyboard',
      '01',
      'fixture/wrong-response.json',
    ),
  );
  validateFirstComparison(folder, config, 'storyboard', '01', {
    readingReview: {
      firstReadingHash: first.hash,
      comparison: 'Synthetic comparison with the saved scan.',
    },
  });
  assert.throws(
    () =>
      validateFirstComparison(folder, config, 'storyboard', '01', {
        readingReview: { firstReadingHash: 'wrong' },
      }),
    /immutable/,
  );
  write(
    'fixture/workflow/storyboards-unnumbered/page-01.png',
    Buffer.concat([png, Buffer.from('changed')]),
  );
  assert.throws(
    () => saveFirstReading(folder, config, request, response),
    /changed/,
  );
  assert.throws(
    () => loadFirstReading(folder, config, 'storyboard', '01'),
    /first reading/,
  );
  write('fixture/workflow/storyboards-unnumbered/page-01.png', png);
  config.pages[0].panels[0].scene += ' changed';
  assert.throws(
    () => loadFirstReading(folder, config, 'storyboard', '01'),
    /first reading/,
  );
  console.log(
    'Prompt and two-phase reading regression checks passed (synthetic fixtures).',
  );
} finally {
  temporary.cleanup();
}
