import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { root } from '../src/workspace.mjs';
import { createTemporary } from '../src/temporary.mjs';
import { copyRuntime } from './support.mjs';
import {
  captureReview,
  reviewInputs,
  reviewMaterial,
} from '../src/stage-reviews.mjs';
import { decisionContext, reviewContext } from '../src/review-context.mjs';
import {
  pendingReviews,
  reviewTargets,
  designSnapshot,
  requireDesignSeal,
} from '../src/review-progress.mjs';
import { firstReadingRequest } from '../src/first-reading.mjs';
import { createGenerationJobs } from '../src/generation-jobs.mjs';
import {
  reviewPacket,
  packetPrompt,
  executeReview,
} from '../src/review-runner.mjs';

// All review responses below are synthetic gate fixtures, not manga certification.
const temporary = createTemporary('test');
const folder = temporary.folder;
const configFile = 'works/fixture/workflow.json';
const write = (name, value) => {
  const full = path.join(folder, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    typeof value === 'string' || Buffer.isBuffer(value)
      ? value
      : JSON.stringify(value),
  );
};
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
try {
  copyRuntime(root, folder);
  const c = {
    title: 'Synthetic isolation and dependency tests',
    productionMode: 'economy',
    reviewPolicy: { version: 3 },
    productionReview: { required: true, designSealRequired: true },
    sourceFile: 'works/fixture/source/original.txt',
    workflowDir: 'works/fixture/workflow',
    assetDir: 'works/fixture/assets',
    outputDir: 'works/fixture/output',
    references: ['works/fixture/assets/a.png', 'works/fixture/assets/b.png'],
    cast: {
      a: { name: 'A', faceDesign: { reference: 'works/fixture/assets/a.png' } },
      b: { name: 'B', faceDesign: { reference: 'works/fixture/assets/b.png' } },
    },
    referenceRoles: {
      'works/fixture/assets/a.png': 'identity',
      'works/fixture/assets/b.png': 'identity',
    },
    sections: {
      opening: { location: 'room' },
      ending: { location: 'station' },
    },
    pages: Array.from({ length: 6 }, (_, i) => ({
      id: '0' + (i + 1),
      section: i < 3 ? 'opening' : 'ending',
      panels: Array.from({ length: 2 }, (_, j) => ({
        id: `${i + 1}-${j + 1}`,
        scene: 'scene',
        reviewDependencies: [],
        speakers: { [i < 3 ? 'a' : 'b']: {} },
        dialogue: [{ speaker: i < 3 ? 'a' : 'b', text: 'A fixture line.' }],
        rect: [0, j * 700, 1000, 700],
      })),
    })),
    productionDecisions: [
      {
        id: 'taste',
        kind: 'preference',
        text: 'Keep the plain shirt.',
        reason: 'User preference',
        scope: { actors: ['a'] },
      },
    ],
  };
  const all = c.pages.flatMap((p) => p.panels);
  const chunks = all.map((p) => p.id + ': story premise and response.\n');
  const source = chunks.join('');
  write(c.sourceFile, source);
  let end = 0;
  const coverage = {
    sourceHash: hash(source),
    spans: chunks.map((text, i) => {
      const span = { start: end, end: end + text.length, panels: [all[i].id] };
      end += text.length;
      return span;
    }),
  };
  write(c.workflowDir + '/source-coverage.json', coverage);
  for (const stage of [
    'source',
    'script',
    'storyboard',
    'artwork',
    'lettering',
    'final',
  ]) {
    const input = reviewInputs(
      { ...c, productionMode: 'quality' },
      configFile,
      stage,
    );
    for (const file of [...input.files, ...input.optionalFiles])
      if (!fs.existsSync(path.join(folder, file)))
        write(file, 'synthetic file bytes');
  }
  for (const page of c.pages) {
    write(
      `${c.workflowDir}/storyboards-unnumbered/page-${page.id}.png`,
      'synthetic PNG placeholder',
    );
    write(`${c.workflowDir}/reading-flow/page-${page.id}.json`, []);
  }
  const material = reviewMaterial(folder, c, configFile, 'artwork', '3-1');
  const jobs = createGenerationJobs({
    config: { ...c, renderMode: 'panels' },
    local: (file) => path.join(folder, file),
    stateFor: () => ({}),
    svg: () => '<svg/>',
  });
  assert.match(
    jobs.panelJob(c.pages[2], c.pages[2].panels[0]).prompt,
    /Keep the plain shirt/,
  );
  assert.ok(
    !jobs
      .panelJob(c.pages[5], c.pages[5].panels[0])
      .prompt.includes('Keep the plain shirt'),
  );
  assert.deepEqual(
    material.base.script.pages[0].panels.map((p) => p.id),
    ['3-1'],
  );
  assert.deepEqual(material.base.contextPanels, ['3-1', '2-2', '3-2']);
  assert.equal(material.base.sourceExcerpts.length, 3);
  assert.ok(!material.files.includes(c.sourceFile));
  assert.ok(material.dependencyFiles.includes(c.sourceFile));
  assert.equal(material.base.decisions[0].id, 'taste');
  assert.equal(
    reviewMaterial(folder, c, configFile, 'artwork', '6-1').base.decisions
      .length,
    0,
  );
  const distant = structuredClone(c);
  distant.pages[2].panels[0].reviewDependencies = ['1-1'];
  distant.pages[0].panels[0].reviewDependencies = ['3-1'];
  assert.ok(reviewContext(distant, 'artwork', '3-1').context.has('1-1'));
  distant.pages[0].panels[0].reviewDependencies = ['missing'];
  assert.throws(() => reviewContext(distant, 'artwork', '3-1'));
  assert.throws(() =>
    decisionContext({
      ...c,
      productionDecisions: [
        { ...c.productionDecisions[0], scope: { actors: ['missing'] } },
      ],
    }),
  );
  const fallback = (data) => {
    write(c.workflowDir + '/source-coverage.json', data);
    assert.ok(
      reviewMaterial(folder, c, configFile, 'artwork', '3-1').files.includes(
        c.sourceFile,
      ),
    );
  };
  fallback({ ...coverage, sourceHash: 'stale' });
  fallback({ ...coverage, spans: coverage.spans.slice(1) });
  write(c.workflowDir + '/source-coverage.json', coverage);
  for (const { stage, target } of reviewTargets(c)) {
    const request = captureReview(folder, c, configFile, stage, target);
    const panels = c.pages
      .filter((p) => target === 'all' || p.id === target)
      .flatMap((p) => p.panels);
    const response = {
      fingerprint: request.fingerprint,
      reviewer: { role: 'subagent', task: 'synthetic-fixture-only' },
      status: 'pass',
      observations: ['synthetic observation one', 'synthetic observation two'],
      issues: [],
      ...(stage === 'script'
        ? {
            dialogueReview: {
              sourceCompared: true,
              panels: panels.map((p) => ({
                panel: p.id,
                observation: 'synthetic dependency',
              })),
            },
          }
        : {}),
      ...(['storyboard', 'lettering', 'final'].includes(stage)
        ? {
            readingReview: {
              withoutGuides: true,
              observations: ['synthetic scan', 'synthetic transition'],
              predictedOrder: panels.map((p) => ({
                panel: p.id,
                dialogue: [1],
              })),
              transitions: request.base.requiredTransitions.map((t) => ({
                ...t,
                observation: 'synthetic connection',
              })),
            },
          }
        : {}),
    };
    write(`${c.workflowDir}/stage-reviews/${stage}-${target}.json`, response);
  }
  assert.deepEqual(pendingReviews(folder, c, configFile), []);
  const changed = structuredClone(c);
  changed.pages[2].panels[0].dialogue[0].text = 'Changed question.';
  const affected = pendingReviews(folder, changed, configFile);
  assert.ok(affected.some((t) => t.stage === 'script'));
  assert.ok(affected.some((t) => t.stage === 'final'));
  assert.deepEqual(
    affected.filter((t) => t.stage === 'artwork').map((t) => t.target),
    ['2-2', '3-1', '3-2'],
  );
  assert.ok(!affected.some((t) => t.target === '06'));
  const dependent = structuredClone(c);
  dependent.pages[5].panels[0].reviewDependencies = ['3-1'];
  assert.notEqual(
    captureReview(folder, dependent, configFile, 'artwork', '6-1').fingerprint,
    captureReview(folder, c, configFile, 'artwork', '6-1').fingerprint,
  );
  const dependentChanged = structuredClone(dependent);
  dependentChanged.pages[2].panels[0].dialogue[0].text =
    'Changed distant premise.';
  assert.notEqual(
    captureReview(folder, dependentChanged, configFile, 'artwork', '6-1')
      .fingerprint,
    captureReview(folder, dependent, configFile, 'artwork', '6-1').fingerprint,
  );
  write(c.workflowDir + '/design-seal.json', {
    status: 'sealed',
    inputs: designSnapshot(folder, c, configFile),
  });
  requireDesignSeal(folder, c, configFile);
  assert.throws(() => requireDesignSeal(folder, changed, configFile));
  const blind = {
    ...c,
    productionReview: {
      ...c.productionReview,
      readingProtocol: 'two-phase-v1',
    },
  };
  const first = firstReadingRequest(folder, blind, 'storyboard', '01');
  const other = structuredClone(blind);
  other.cast.b.name = 'unrelated';
  assert.equal(
    firstReadingRequest(folder, other, 'storyboard', '01').fingerprint,
    first.fingerprint,
  );
  const blindRequest = c.workflowDir + '/blind.json';
  write(blindRequest, first);
  const blindPacket = reviewPacket(folder, {
    request: blindRequest,
    instructions: 'Inspect images only.',
  });
  assert.ok(!packetPrompt(blindPacket).includes('Keep the plain shirt'));
  assert.ok(!packetPrompt(blindPacket).includes(source));
  write(configFile, c);
  const cli = (...args) =>
    execFileSync(
      process.execPath,
      [path.join(folder, 'cli/stage-review.mjs'), ...args],
      {
        cwd: folder,
        env: { ...process.env, MANGA_PROJECT: configFile },
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      },
    );
  const short = JSON.parse(cli('prepare', 'artwork', '3-1'));
  assert.ok(short.details && !short.inputs);
  const full = JSON.parse(cli('prepare', 'artwork', '3-1', '--verbose'));
  assert.equal(read(short.details).request, full.request);
  assert.ok(JSON.stringify(short).length < JSON.stringify(full).length);
  cli('reopen', 'Fix the acting');
  assert.throws(() => requireDesignSeal(folder, c, configFile));
  cli('seal');
  requireDesignSeal(folder, c, configFile);
  const decisionFile = 'works/fixture/decision.json';
  write(decisionFile, {
    id: 'rejected',
    kind: 'rejected',
    text: 'Avoid the first pose.',
    reason: 'Hand hid the letter.',
    scope: { panels: ['3-1'] },
  });
  cli('decision', decisionFile);
  assert.equal(read(configFile).productionDecisions.length, 2);
  // A subprocess adapter validates transport, not an actual AI review.
  const adapterFile = path.join(folder, 'fixture-adapter.mjs');
  fs.writeFileSync(
    adapterFile,
    `import fs from 'node:fs';
const job=JSON.parse(fs.readFileSync(0,'utf8'));
const packet=JSON.parse(fs.readFileSync(job.packet,'utf8'));
if(process.env.CODEX_THREAD_ID || process.env.MANGA_PROJECT) process.exit(9);
fs.writeFileSync(job.output,JSON.stringify({request:packet.request,reviewer:{role:'subagent',task:packet.task},status:'changes-requested',observations:['synthetic transport only','no visual inspection'],issues:[]}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:123,output_tokens:45}}));`,
  );
  const adapter = {
    protocol: 'packet-v1',
    command: process.execPath,
    args: [adapterFile],
  };
  const parentThread = process.env.CODEX_THREAD_ID;
  process.env.CODEX_THREAD_ID = 'parent-chat-secret';
  const runResult = executeReview(
    folder,
    { ...c, reviewRunner: adapter },
    full,
  );
  if (parentThread === undefined) delete process.env.CODEX_THREAD_ID;
  else process.env.CODEX_THREAD_ID = parentThread;
  assert.equal(runResult.response.status, 'changes-requested');
  assert.equal(read(runResult.log).history, 'none');
  assert.equal(read(runResult.log).usage[0].input_tokens, 123);
  assert.ok(
    !fs
      .readFileSync(
        path.join(
          folder,
          runResult.log.replace('execution.json', 'prompt.txt'),
        ),
        'utf8',
      )
      .includes('parent-chat-secret'),
  );
  assert.throws(() =>
    executeReview(
      folder,
      { ...c, reviewRunner: { ...adapter, args: [adapterFile, 'resume'] } },
      full,
    ),
  );
  const runnerConfig = read(configFile);
  runnerConfig.reviewRunner = adapter;
  write(configFile, runnerConfig);
  assert.throws(() =>
    execFileSync(
      process.execPath,
      [path.join(folder, 'cli/review-run.mjs'), 'source', 'all'],
      {
        cwd: folder,
        env: { ...process.env, MANGA_PROJECT: configFile },
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      },
    ),
  );
  assert.equal(
    read(`${c.workflowDir}/stage-reviews/source-all.json`).status,
    'changes-requested',
  );
  // Isolate stdout testing from review gates; this never certifies production material.
  write(configFile, {
    ...c,
    productionReview: { required: false, designSealRequired: false },
  });
  write(`${c.workflowDir}/panel-jobs.json`, [
    {
      id: '3-1',
      fingerprint: 'synthetic-job',
      prompt: 'Exact saved generation prompt',
      references: c.references,
    },
  ]);
  const generation = (...args) =>
    execFileSync(
      process.execPath,
      [path.join(folder, 'cli/generation.mjs'), 'prepare', '3-1', ...args],
      {
        cwd: folder,
        env: { ...process.env, MANGA_PROJECT: configFile },
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      },
    );
  const shortGeneration = JSON.parse(generation());
  assert.ok(shortGeneration.details && !shortGeneration.prompt);
  const verboseGeneration = JSON.parse(generation('--verbose'));
  assert.equal(read(shortGeneration.details).prompt, verboseGeneration.prompt);
  assert.equal(read(shortGeneration.request).prompt, verboseGeneration.prompt);
  console.log(
    'PASS: scoped source fallback, distant dependencies, delta review queue, design seal/reopen, decisions, compact logs, image-only isolation and fresh-process adapter (synthetic fixtures)',
  );
} finally {
  temporary.cleanup();
}
