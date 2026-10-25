import { createTemporary } from '../src/temporary.mjs';
import { gunzipSync } from 'node:zlib';
import { copyRuntime } from './support.mjs';
import { root as workspaceRoot } from '../src/workspace.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  checkpoint,
  listStates,
  extractState,
  compressStates,
  readState,
} from '../src/state-history.mjs';
import {
  readingFlow,
  flowOverlay,
  narrativePlan,
} from '../src/reading-flow.mjs';
import {
  captureReview,
  requireReview,
  validateReadingReview,
  validateDialogueReview,
} from '../src/stage-reviews.mjs';
const temporary = createTemporary('test');
const root = temporary.folder;
try {
  const work = path.join(root, 'works', 'example');
  fs.mkdirSync(path.join(work, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(work, 'workflow.json'), 'first layout');
  fs.writeFileSync(
    path.join(work, 'assets', 'candidate.bin'),
    'original bytes',
  );
  fs.writeFileSync(
    path.join(work, 'assets', 'reference.bin'),
    'original bytes',
  );
  fs.writeFileSync(path.join(root, 'pipeline.mjs'), 'original common code');
  fs.writeFileSync(path.join(root, 'reader.html'), 'reader template');
  fs.mkdirSync(path.join(root, 'templates'));
  fs.writeFileSync(
    path.join(root, 'templates', 'reader.html'),
    'runtime reader',
  );
  fs.writeFileSync(path.join(root, 'export-pdf.py'), 'PDF exporter');
  const first = checkpoint(root, work, 'before edit');
  assert.equal(
    checkpoint(root, work, 'unchanged').id,
    first.id,
    'Identical content must reuse a state',
  );
  const realReaddir = fs.readdirSync,
    realLstat = fs.lstatSync;
  // The fixture overrides only the string-path/Dirent overload used by checkpoint.
  fs.readdirSync = /** @type {typeof fs.readdirSync} */ (
    (folder, options) => {
      const entries = realReaddir(folder, options);
      if (!options?.withFileTypes) return entries;
      if (
        options?.withFileTypes &&
        [path.join(work, 'assets'), path.join(root, 'templates')].includes(
          folder,
        )
      )
        return entries.map(
          (entry) =>
            new Proxy(Object(entry), {
              get(target, key) {
                return key === 'isSymbolicLink'
                  ? () => true
                  : key === 'isFile'
                    ? () => false
                    : Reflect.get(target, key);
              },
            }),
        );
      return entries;
    }
  );
  try {
    assert.equal(
      checkpoint(root, work, 'cloud dirent misclassification').id,
      first.id,
      'Regular cloud files must retain identical bytes despite link-like Dirent',
    );
    // @ts-expect-error Deliberately replace the overloaded Node API with a link-only test double.
    fs.lstatSync = (file) =>
      file === path.join(work, 'assets', 'candidate.bin')
        ? { isSymbolicLink: () => true }
        : realLstat(file);
    assert.throws(
      () => checkpoint(root, work, 'actual path link'),
      /refuses symbolic links/,
      'Path-level links must remain refused',
    );
  } finally {
    fs.readdirSync = realReaddir;
    // @ts-expect-error Restore the API after the deliberate test override.
    fs.lstatSync = realLstat;
  }
  const manifestFile = path.join(
    root,
    '.manga-history',
    'states',
    'example',
    first.id + '.json.gz',
  );
  const originalBytes = gunzipSync(fs.readFileSync(manifestFile));
  const original = readState(manifestFile);
  const legacy = manifestFile.slice(0, -3);
  fs.writeFileSync(legacy, originalBytes);
  assert.equal(listStates(root, work).length, 1);
  fs.writeFileSync(manifestFile, 'broken gzip');
  assert.throws(() => compressStates(root, work));
  assert.deepEqual(fs.readFileSync(legacy), originalBytes);
  fs.unlinkSync(manifestFile);
  const realLink = fs.linkSync;
  fs.linkSync = () => {
    throw new Error('Synthetic publish failure');
  };
  try {
    assert.throws(() => compressStates(root, work), /publish failure/);
    assert.deepEqual(fs.readFileSync(legacy), originalBytes);
    assert.ok(!fs.existsSync(manifestFile));
  } finally {
    fs.linkSync = realLink;
  }
  extractState(root, work, first.id, path.join(root, 'legacy-restored'));
  const compressed = compressStates(root, work);
  assert.equal(compressed.files, 1);
  assert.ok(!fs.existsSync(legacy));
  assert.deepEqual(gunzipSync(fs.readFileSync(manifestFile)), originalBytes);
  assert.equal(compressStates(root, work).files, 0);
  assert.equal(
    original.entries['works/example/assets/candidate.bin'].hash,
    original.entries['works/example/assets/reference.bin'].hash,
  );
  fs.writeFileSync(path.join(work, 'workflow.json'), 'second layout');
  fs.writeFileSync(path.join(work, 'assets', 'candidate.bin'), 'edited bytes');
  fs.unlinkSync(path.join(work, 'assets', 'reference.bin'));
  const originalRename = fs.renameSync;
  let lockedAttempts = 0;
  fs.renameSync = (source, destination) => {
    if (String(destination).endsWith('cache.json') && lockedAttempts++ < 2) {
      throw Object.assign(new Error('Synthetic transient Windows file lock'), {
        code: 'EPERM',
      });
    }
    return originalRename(source, destination);
  };
  let second;
  try {
    second = checkpoint(root, work, 'after edit');
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(
    lockedAttempts,
    3,
    'Transient lock must retry the same cache replacement',
  );
  assert.notEqual(second.id, first.id);
  const restored = path.join(root, 'restored');
  extractState(root, work, first.id, restored);
  assert.equal(
    fs.readFileSync(path.join(restored, 'works/example/workflow.json'), 'utf8'),
    'first layout',
  );
  assert.equal(
    fs.readFileSync(
      path.join(restored, 'works/example/assets/candidate.bin'),
      'utf8',
    ),
    'original bytes',
  );
  assert.ok(
    fs.existsSync(path.join(restored, 'works/example/assets/reference.bin')),
    'Deleted material must be recoverable',
  );
  assert.equal(
    fs.readFileSync(path.join(restored, 'reader.html'), 'utf8'),
    'reader template',
  );
  assert.equal(
    fs.readFileSync(path.join(restored, 'export-pdf.py'), 'utf8'),
    'PDF exporter',
  );
  assert.throws(
    () => extractState(root, work, first.id, work),
    /NEW directory/,
  );
  const moduleURL = pathToFileURL(path.resolve('src/state-history.mjs')).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import fs from 'node:fs'; import {trackState} from ${JSON.stringify(moduleURL)}; trackState(${JSON.stringify(root)},'works/example/workflow.json'); fs.writeFileSync(${JSON.stringify(path.join(work, 'workflow.json'))},'partial failed edit'); throw new Error('intentional failure');`,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.notEqual(child.status, 0);
  const states = listStates(root, work);
  assert.equal(states.length, 3);
  const partial = path.join(root, 'partial');
  extractState(root, work, states.at(-1).id, partial);
  assert.equal(
    fs.readFileSync(path.join(partial, 'works/example/workflow.json'), 'utf8'),
    'partial failed edit',
  );
  const hash = original.entries['works/example/assets/candidate.bin'].hash;
  fs.writeFileSync(
    path.join(root, '.manga-history', 'objects', hash.slice(0, 2), hash),
    'corrupt',
  );
  const rejected = path.join(root, 'rejected');
  assert.throws(
    () => extractState(root, work, first.id, rejected),
    /Damaged history object/,
  );
  assert.ok(!fs.existsSync(rejected));
  const panel = {
    id: '01-1',
    rect: [24, 24, 976, 650],
    speakers: {},
    dialogue: [
      { speaker: 'a', text: 'first' },
      { speaker: 'b', text: 'second' },
    ],
  };
  const flow = readingFlow({ id: '01', panels: [panel] }, (_p, d) =>
    d.speaker === 'a' ? [24, 24, 100, 200] : [800, 110, 100, 200],
  );
  assert.equal(flow.panels[0].warnings.length, 1);
  assert.equal(flow.status, 'planning-guide-not-reviewed');
  const clustered = {
    id: '04-2',
    rect: [24, 756, 976, 708],
    dialogue: [
      { speaker: 'a', text: 'question' },
      { speaker: 'b', text: 'answer' },
      { speaker: 'a', text: 'response' },
    ],
  };
  const boxes = [
    [844, 886, 148, 204],
    [42, 906, 64, 258],
    [804, 1096, 148, 204],
  ];
  const clusteredFlow = readingFlow(
    { id: '04', panels: [clustered] },
    (_p, d) => boxes[clustered.dialogue.indexOf(d)],
  );
  const proximity = clusteredFlow.panels[0].warnings.find(
    (w) => w.code === 'nonconsecutive-cluster',
  );
  assert.ok(
    proximity,
    'A six-pixel nonconsecutive right cluster must flag the skipped distant reply',
  );
  assert.equal(proximity.expected, 2);
  assert.equal(proximity.competing, 3);
  assert.equal(proximity.competingGap, 6);
  const sequentialFlow = readingFlow(
    { id: '04', panels: [clustered] },
    (_p, d) =>
      [
        [800, 24, 90, 140],
        [660, 24, 90, 140],
        [520, 24, 90, 140],
      ][clustered.dialogue.indexOf(d)],
  );
  assert.ok(
    !sequentialFlow.panels[0].warnings.some(
      (w) => w.code === 'nonconsecutive-cluster',
    ),
    'Adjacent right-to-left chain must not be called a skipped-reply cluster',
  );
  const scanConfig = { pages: [{ id: '04', panels: [clustered] }] },
    scanRecord = {
      status: 'pass',
      readingReview: {
        withoutGuides: true,
        predictedOrder: [{ panel: '04-2', dialogue: [1, 2, 3] }],
        observations: [
          'Synthetic natural-scan evidence.',
          'Synthetic proximity evidence, not real artwork.',
        ],
        transitions: [],
      },
    };
  validateReadingReview(scanConfig, 'lettering', '04', scanRecord);
  scanRecord.readingReview.predictedOrder[0].dialogue = [1, 3, 2];
  assert.throws(
    () => validateReadingReview(scanConfig, 'lettering', '04', scanRecord),
    /Natural reading differs/,
  );
  scanRecord.readingReview.predictedOrder[0].dialogue = [1, 2, 3];
  scanRecord.readingReview.withoutGuides = false;
  assert.throws(
    () => validateReadingReview(scanConfig, 'lettering', '04', scanRecord),
    /without numbered guides/,
  );
  const transitions = narrativePlan({
    sections: { now: { location: 'room' }, memory: { location: 'garden' } },
    pages: [
      {
        id: '01',
        panels: [
          {
            id: '01-1',
            section: 'now',
            rect: [24, 24, 976, 650],
            speakers: { a: { anchor: [300, 300] }, b: { anchor: [700, 300] } },
          },
        ],
      },
      {
        id: '02',
        panels: [
          {
            id: '02-1',
            section: 'memory',
            rect: [24, 24, 976, 650],
            speakers: { a: { anchor: [700, 300] }, b: { anchor: [300, 300] } },
          },
        ],
      },
    ],
  });
  assert.equal(transitions.transitions[0].pageBoundary, true);
  assert.equal(
    transitions.transitions[0].warnings.length,
    2,
    'Changed setting and actor-side reversal both need independent transition inspection',
  );
  const boundaryConfig = {
    pages: [
      { id: '01', panels: [{ id: 'a', rect: [0, 0, 100, 100], dialogue: [] }] },
      {
        id: '02',
        panels: [
          { id: 'b', rect: [0, 0, 100, 100], dialogue: [] },
          { id: 'c', rect: [0, 0, 100, 100], dialogue: [] },
        ],
      },
    ],
  };
  const boundaryRecord = {
    status: 'pass',
    readingReview: {
      withoutGuides: true,
      predictedOrder: [
        { panel: 'a', dialogue: [] },
        { panel: 'b', dialogue: [] },
        { panel: 'c', dialogue: [] },
      ],
      observations: [
        'Synthetic silent-panel scan.',
        'Synthetic boundary coverage.',
      ],
      transitions: [
        { from: 'a', to: 'b', observation: 'Synthetic page boundary.' },
        { from: 'b', to: 'c', observation: 'Synthetic same-page boundary.' },
      ],
    },
  };
  validateReadingReview(boundaryConfig, 'final', 'all', boundaryRecord);
  const rejectedTransition = (ts) =>
    assert.throws(() =>
      validateReadingReview(boundaryConfig, 'final', 'all', {
        ...boundaryRecord,
        readingReview: { ...boundaryRecord.readingReview, transitions: ts },
      }),
    );
  rejectedTransition(boundaryRecord.readingReview.transitions.slice(0, 1));
  rejectedTransition([
    { from: 'nonexistent', to: 'b', observation: 'bad' },
    boundaryRecord.readingReview.transitions[1],
  ]);
  rejectedTransition([
    boundaryRecord.readingReview.transitions[0],
    boundaryRecord.readingReview.transitions[0],
  ]);
  const solo = {
    pages: [{ id: '01', panels: [boundaryConfig.pages[0].panels[0]] }],
  };
  validateReadingReview(solo, 'final', 'all', {
    ...boundaryRecord,
    readingReview: {
      ...boundaryRecord.readingReview,
      predictedOrder: [{ panel: 'a', dialogue: [] }],
      transitions: [],
    },
  });
  const localRecord = {
    ...boundaryRecord,
    readingReview: {
      ...boundaryRecord.readingReview,
      predictedOrder: [
        { panel: 'b', dialogue: [] },
        { panel: 'c', dialogue: [] },
      ],
    },
  };
  validateReadingReview(boundaryConfig, 'lettering', '02', localRecord);
  const stateConfig = {
    sections: {
      room: {
        location: 'room',
        time: 'morning',
        objects: { cup: 'full', book: 'closed' },
      },
    },
    pages: [
      {
        id: '01',
        section: 'room',
        panels: [
          { id: 'a', rect: [0, 0, 100, 100], scene: 'inside', action: 'wait' },
          {
            id: 'b',
            rect: [0, 0, 100, 100],
            scene: 'garden',
            action: 'read',
            state: {
              location: 'garden',
              time: 'night',
              objects: { book: 'open' },
            },
          },
        ],
      },
    ],
  };
  const stateTransition = narrativePlan(stateConfig).transitions[0];
  assert.equal(stateTransition.kind, 'state-change');
  assert.equal(stateTransition.after.setting.location, 'garden');
  assert.equal(stateTransition.after.setting.time, 'night');
  assert.equal(stateTransition.after.setting.objects.cup, 'full');
  assert.equal(stateTransition.after.setting.objects.book, 'open');
  assert.equal(stateTransition.after.scene, 'garden');
  assert.equal(stateTransition.warnings.length, 1);
  flow.panels[0].intent = { gazes: [{ from: [1, 2, 3], to: [4, 5] }] };
  assert.throws(() => flowOverlay('<svg></svg>', flow), /Invalid planned gaze/);
  // Synthetic review records test gates only; no artwork inspection is claimed.
  fs.mkdirSync(path.join(work, 'workflow', 'stage-reviews'), {
    recursive: true,
  });
  fs.writeFileSync(path.join(work, 'source.txt'), 'story');
  fs.writeFileSync(path.join(work, 'workflow', 'source-coverage.json'), '{}');
  const c = {
    productionReview: { required: true },
    sourceFile: 'works/example/source.txt',
    workflowDir: 'works/example/workflow',
    pages: [
      {
        id: '01',
        panels: [
          {
            id: '01-1',
            scene: 's',
            dialogue: [{ speaker: 'a', text: 'one', x: 30 }],
          },
        ],
      },
    ],
  };
  assert.throws(
    () => requireReview(root, c, 'works/example/workflow.json', 'script'),
    /Missing subagent review/,
  );
  const request = captureReview(
    root,
    c,
    'works/example/workflow.json',
    'script',
  );
  assert.equal(request.base.dialoguePolicy, 'source-dialogue-dependencies-v1');
  const dialogueReview = {
    sourceCompared: true,
    panels: [
      {
        panel: '01-1',
        observation:
          'Synthetic source comparison and reply dependency; no actual story reviewed.',
      },
    ],
  };
  validateDialogueReview(c, 'script', 'all', {
    status: 'pass',
    dialogueReview,
  });
  assert.throws(
    () => validateDialogueReview(c, 'script', 'all', { status: 'pass' }),
    /full original/,
  );
  assert.throws(
    () =>
      validateDialogueReview(c, 'script', 'all', {
        status: 'pass',
        dialogueReview: { ...dialogueReview, panels: [] },
      }),
    /every target panel/,
  );
  assert.throws(
    () =>
      validateDialogueReview(c, 'script', 'all', {
        status: 'pass',
        dialogueReview: {
          ...dialogueReview,
          panels: [{ panel: 'wrong', observation: 'bad' }],
        },
      }),
    /Missing or duplicate/,
  );
  assert.throws(
    () =>
      validateDialogueReview(c, 'script', 'all', {
        status: 'pass',
        dialogueReview: {
          ...dialogueReview,
          panels: [{ panel: '01-1', observation: ' ' }],
        },
      }),
    /Missing or duplicate/,
  );
  const reviewFile = path.join(
    work,
    'workflow',
    'stage-reviews',
    'script-all.json',
  );
  fs.writeFileSync(
    reviewFile,
    JSON.stringify({
      fingerprint: request.fingerprint,
      status: 'changes-requested',
      reviewer: { role: 'subagent', task: 'synthetic-test' },
    }),
  );
  assert.throws(
    () => requireReview(root, c, 'works/example/workflow.json', 'script'),
    /requested changes/,
  );
  fs.writeFileSync(
    reviewFile,
    JSON.stringify({
      fingerprint: request.fingerprint,
      status: 'pass',
      reviewer: { role: 'subagent', task: 'synthetic-test' },
      issues: [],
      observations: [
        'Synthetic gate observation.',
        'No artwork inspection claimed.',
      ],
      dialogueReview,
    }),
  );
  requireReview(root, c, 'works/example/workflow.json', 'script');
  c.pages[0].panels[0].dialogue[0].x = 90;
  requireReview(root, c, 'works/example/workflow.json', 'script');
  c.pages[0].panels[0].dialogue[0].textColumns = ['o', 'ne'];
  assert.throws(
    () => requireReview(root, c, 'works/example/workflow.json', 'script'),
    /Stale subagent review/,
  );
  delete c.pages[0].panels[0].dialogue[0].textColumns;
  /** @type {[Record<string, unknown>, string][]} */
  const scriptChanges = [
    [c.pages[0], 'showcase'],
    [c.pages[0].panels[0], 'transition'],
    [c.pages[0].panels[0], 'information'],
    [c.pages[0].panels[0], 'pause'],
    [c.pages[0].panels[0], 'section'],
  ];
  for (const [object, key] of scriptChanges) {
    object[key] =
      key === 'transition'
        ? { bridge: 'next day', settingBasis: 'source' }
        : 'changed';
    assert.throws(
      () => requireReview(root, c, 'works/example/workflow.json', 'script'),
      /Stale subagent review/,
    );
    delete object[key];
  }
  const neighborWork = path.join(root, 'neighbor');
  for (const folder of [
    'storyboards',
    'storyboards-unnumbered',
    'reading-flow',
    'review',
    'assets/panels',
  ])
    fs.mkdirSync(path.join(neighborWork, folder), { recursive: true });
  for (const id of ['01', '02']) {
    fs.writeFileSync(
      path.join(neighborWork, 'storyboards', 'page-' + id + '.svg'),
      '<svg/>',
    );
    fs.writeFileSync(
      path.join(neighborWork, 'storyboards-unnumbered', 'page-' + id + '.svg'),
      '<svg/>',
    );
    fs.writeFileSync(
      path.join(neighborWork, 'reading-flow', 'page-' + id + '.svg'),
      '<svg/>',
    );
    fs.writeFileSync(
      path.join(neighborWork, 'reading-flow', 'page-' + id + '.json'),
      '{}',
    );
  }
  const neighborConfig = {
    ...boundaryConfig,
    sourceFile: c.sourceFile,
    workflowDir: 'neighbor',
    assetDir: 'neighbor/assets',
    sections: {},
  };
  const neighborFirst = captureReview(
    root,
    neighborConfig,
    'cfg',
    'storyboard',
    '02',
  );
  neighborConfig.pages[0].panels[0].action = 'changed incoming action';
  assert.notEqual(
    captureReview(root, neighborConfig, 'cfg', 'storyboard', '02').fingerprint,
    neighborFirst.fingerprint,
  );
  delete neighborConfig.pages[0].panels[0].action;
  fs.writeFileSync(
    path.join(neighborWork, 'storyboards', 'page-01.svg'),
    '<svg>changed previous visual</svg>',
  );
  assert.notEqual(
    captureReview(root, neighborConfig, 'cfg', 'storyboard', '02').fingerprint,
    neighborFirst.fingerprint,
  );
  fs.writeFileSync(
    path.join(neighborWork, 'storyboards', 'page-01.svg'),
    '<svg/>',
  );
  fs.writeFileSync(
    path.join(neighborWork, 'storyboards-unnumbered', 'page-01.svg'),
    '<svg>changed unnumbered visual</svg>',
  );
  assert.notEqual(
    captureReview(root, neighborConfig, 'cfg', 'storyboard', '02').fingerprint,
    neighborFirst.fingerprint,
  );
  fs.writeFileSync(
    path.join(neighborWork, 'review', 'page-02.png'),
    'synthetic image',
  );
  for (const id of ['b', 'c'])
    fs.writeFileSync(
      path.join(neighborWork, 'assets', 'panels', id + '.png'),
      'synthetic image',
    );
  const missingNeighbor = captureReview(
    root,
    neighborConfig,
    'cfg',
    'lettering',
    '02',
  );
  assert.equal(missingNeighbor.entries['neighbor/review/page-01.png'], null);
  fs.writeFileSync(
    path.join(neighborWork, 'review', 'page-01.png'),
    'new synthetic neighbor image',
  );
  const presentNeighbor = captureReview(
    root,
    neighborConfig,
    'cfg',
    'lettering',
    '02',
  );
  assert.notEqual(missingNeighbor.fingerprint, presentNeighbor.fingerprint);
  assert.ok(presentNeighbor.files.includes('neighbor/review/page-01.png'));
  c.pages[0].panels[0].dialogue[0].text = 'different';
  assert.throws(
    () => requireReview(root, c, 'works/example/workflow.json', 'script'),
    /Stale subagent review/,
  );
  copyRuntime(workspaceRoot, root);
  fs.writeFileSync(path.join(work, 'workflow.json'), JSON.stringify(c));
  const cli = (...args) =>
    spawnSync(
      process.execPath,
      [path.join(root, 'cli/stage-review.mjs'), ...args],
      {
        cwd: root,
        env: { ...process.env, MANGA_PROJECT: 'works/example/workflow.json' },
        encoding: 'utf8',
        windowsHide: true,
      },
    );
  const prepared = cli('prepare', 'script', 'all');
  assert.equal(prepared.status, 0, prepared.stderr);
  const savedRequest = JSON.parse(prepared.stdout).request;
  const response = {
    request: savedRequest,
    reviewer: { role: 'subagent', task: 'synthetic-cli-test' },
    status: 'changes-requested',
    observations: [
      'Synthetic regression evidence only.',
      'No story or artwork was visually reviewed.',
    ],
    issues: [{ problem: 'test issue', location: '01-1', resolved: false }],
  };
  fs.writeFileSync(path.join(work, 'response.json'), JSON.stringify(response));
  const recorded = cli(
    'record',
    'script',
    'all',
    'works/example/response.json',
  );
  assert.equal(recorded.status, 0, recorded.stderr);
  response.status = 'pass';
  fs.writeFileSync(path.join(work, 'response.json'), JSON.stringify(response));
  assert.notEqual(
    cli('record', 'script', 'all', 'works/example/response.json').status,
    0,
  );
  response.issues = [];
  fs.writeFileSync(path.join(work, 'response.json'), JSON.stringify(response));
  assert.notEqual(
    cli('record', 'script', 'all', 'works/example/response.json').status,
    0,
    'A script pass without source dialogue observations must be rejected',
  );
  response.dialogueReview = dialogueReview;
  fs.writeFileSync(path.join(work, 'response.json'), JSON.stringify(response));
  const accepted = cli(
    'record',
    'script',
    'all',
    'works/example/response.json',
  );
  assert.equal(accepted.status, 0, accepted.stderr);
  c.pages[0].panels[0].dialogue[0].text = 'new edit after request';
  fs.writeFileSync(path.join(work, 'workflow.json'), JSON.stringify(c));
  assert.notEqual(
    cli('record', 'script', 'all', 'works/example/response.json').status,
    0,
    'Stale response must be rejected',
  );
  console.log(
    'PASS: immutable intermediate state, deduplicated material, deleted-file recovery, failed-command checkpoint, overwrite refusal, corruption rejection, reading-flow warning',
  );
} finally {
  temporary.cleanup();
}
