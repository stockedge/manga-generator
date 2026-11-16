import { createTemporary } from '../src/temporary.mjs';
import { copyRuntime } from './support.mjs';
import fs from 'node:fs';
import { defaultQuality, categories } from '../src/quality.mjs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { compactSVG } from '../src/compact-svg.mjs';
import { renderStoryboardSketch } from '../src/storyboard-sketch.mjs';
import { reviewInputs, captureReview } from '../src/stage-reviews.mjs';
import { root as workspaceRoot } from '../src/workspace.mjs';
import { createGenerationJobs } from '../src/generation-jobs.mjs';
import { cropRectangle, renderArtworkImage } from '../src/artwork-crop.mjs';
const temporary = createTemporary('test');
const root = temporary.folder;
copyRuntime(workspaceRoot, root);
fs.cpSync(
  path.join(workspaceRoot, 'works/sample'),
  path.join(root, 'works/sample'),
  { recursive: true },
);
process.chdir(root);
const folder = path.join(root, 'fixture');
fs.mkdirSync(folder);
const relative = path.relative(root, folder).replaceAll('\\', '/');
const file = relative + '/workflow.json';
const run = (...args) =>
  execFileSync(process.execPath, ['cli/workflow.mjs', ...args], {
    cwd: root,
    env: { ...process.env, MANGA_PROJECT: file },
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
// A valid, blank PNG fixture keeps these checks independent of any work's artwork.
function blankPNG(width = 1024, height = 1536) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    const size = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
try {
  const roughSketchFixture = {
    version: 1,
    moment: 'Synthetic held object in one instant',
    primitives: [
      { type: 'line', points: [0, 0, 1, 1] },
      {
        type: 'path',
        commands: [['M', 0.1, 0.2], ['Q', 0.2, 0.3, 0.4, 0.5], ['Z']],
      },
    ],
  };
  const sketchSVG = renderStoryboardSketch(
    roughSketchFixture,
    [24, 24, 976, 300],
    'synthetic-clip',
    { rough: true },
  );
  assert.match(
    sketchSVG,
    /<clipPath id="synthetic-clip"><rect x="24" y="24" width="976" height="300"/,
  );
  assert.match(sketchSVG, /clip-path="url\(#synthetic-clip\)"/);
  assert.match(sketchSVG, /translate\(24 24\) scale\(976 300\)/);
  assert.ok(
    !/<text|href=|style=|<image/.test(sketchSVG),
    'Only structured geometry may enter the underlay',
  );
  assert.equal(
    renderStoryboardSketch(undefined, [24, 24, 976, 300], 'synthetic-clip', {
      rough: true,
    }),
    '',
  );
  assert.equal(
    renderStoryboardSketch(
      roughSketchFixture,
      [24, 24, 976, 300],
      'synthetic-clip',
      { rough: false },
    ),
    '',
  );
  assert.equal(
    renderStoryboardSketch(
      roughSketchFixture,
      [24, 24, 976, 300],
      'synthetic-clip',
      { rough: true, hasArt: true },
    ),
    '',
  );
  for (const bad of [
    null,
    false,
    { ...roughSketchFixture, raw: '<image href="file:///secret"/>' },
    {
      ...roughSketchFixture,
      primitives: [{ type: 'line', points: [0, 0, 1.1, 1] }],
    },
    {
      ...roughSketchFixture,
      primitives: [{ type: 'rect', x: 0.9, y: 0, width: 0.2, height: 0.1 }],
    },
    {
      ...roughSketchFixture,
      primitives: [{ type: 'ellipse', cx: 0, cy: 0.5, rx: 0.1, ry: 0.1 }],
    },
    {
      ...roughSketchFixture,
      primitives: [{ type: 'path', d: 'M0 0', commands: [['M', 0, 0]] }],
    },
    {
      ...roughSketchFixture,
      primitives: [
        {
          type: 'line',
          points: [0, 0, 1, 1],
          stroke: 'url(https://example.invalid)',
        },
      ],
    },
    {
      ...roughSketchFixture,
      primitives: [{ type: 'path', commands: [['L', 0, 0]] }],
    },
    {
      ...roughSketchFixture,
      primitives: Array(129).fill(roughSketchFixture.primitives[0]),
    },
  ])
    assert.throws(() =>
      renderStoryboardSketch(bad, [24, 24, 976, 300], 'synthetic-clip', {
        rough: true,
      }),
    );
  assert.throws(() =>
    renderStoryboardSketch(
      roughSketchFixture,
      [0, 0, 1025, 300],
      'synthetic-clip',
      { rough: true },
    ),
  );
  assert.throws(() =>
    renderStoryboardSketch(
      roughSketchFixture,
      [24, 24, 976, 300],
      'x" onclick="evil',
      { rough: true },
    ),
  );
  const embedded = 'data:image/png;base64,' + blankPNG().toString('base64');
  const embeddedTag = (i) =>
    `<image href="${embedded}" width="1024" height="1536" preserveAspectRatio="none" clip-path="url(#p${i})"/>`;
  const original = `<svg width="1024" height="1536"><defs><clipPath id="p0"/></defs>${embeddedTag(0)}${embeddedTag(1)}</svg>`;
  const compact = compactSVG(original);
  assert.equal((compact.match(/data:image\/png;base64,/g) || []).length, 1);
  assert.ok(
    compact.includes('clip-path="url(#p0)"') &&
      compact.includes('clip-path="url(#p1)"'),
  );
  assert.equal(compactSVG(compact), compact);
  assert.equal(
    Buffer.from(
      compact.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)[1],
      'base64',
    ).compare(blankPNG()),
    0,
  );
  const c = JSON.parse(fs.readFileSync('works/sample/workflow.json', 'utf8'));
  c.title = 'テスト </script> 別作品';
  c.author = '別の作者';
  c.assetDir = relative + '/assets';
  c.workflowDir = relative + '/workflow';
  c.outputDir = relative + '/output';
  c.sourceFile = relative + '/original.txt';
  c.references = [];
  c.renderMode = 'page';
  c.sections = {};
  delete c.pages[0].section;
  c.pages[0].panels[0].dialogue[0].text = '</script>';
  fs.writeFileSync(folder + '/original.txt', '別の原作');
  const save = (v) =>
    fs.writeFileSync(folder + '/workflow.json', JSON.stringify(v));
  save(c);
  run('check');
  const panelCountFixture = (count) => {
    const value = structuredClone(c);
    value.pages[0].panels = Array.from({ length: count }, (_, i) => ({
      id: `count-${i + 1}`,
      order: i + 1,
      role: '反応',
      beat: 'Synthetic silent beat',
      scene: 'Synthetic silent panel',
      rect: [i % 2 ? 24 : 520, 24 + Math.floor(i / 2) * 352, 480, 336],
      speakers: {},
      dialogue: [],
    }));
    return value;
  };
  for (const count of [7, 8]) {
    const value = panelCountFixture(count);
    save(value);
    run('check');
    run('plan');
    const flow = JSON.parse(
      fs.readFileSync(folder + '/workflow/reading-flow/page-01.json', 'utf8'),
    );
    assert.deepEqual(
      flow.panels.map((panel) => panel.id),
      value.pages[0].panels.map((panel) => panel.id),
      'Seven/eight-panel pages must retain every panel in reading order',
    );
  }
  for (const count of [0, 1, 9]) {
    save(panelCountFixture(count));
    assert.throws(() => run('check'), /Each page must have 2 to 8 panels/);
  }
  const overlapping = panelCountFixture(7);
  overlapping.pages[0].panels[1].rect = overlapping.pages[0].panels[0].rect;
  save(overlapping);
  assert.throws(() => run('check'), /Panels overlap/);
  const outside = panelCountFixture(8);
  outside.pages[0].panels[7].rect[0] = 1000;
  save(outside);
  assert.throws(() => run('check'), /Panel outside safe area/);
  save(c);
  run('plan');
  assert.match(run('status'), /pending/);
  assert.throws(() => run('build'));
  const exportFixture = (...args) =>
    execFileSync(
      process.execPath,
      ['cli/export.mjs', relative + '/workflow/storyboards', ...args],
      {
        cwd: root,
        env: { ...process.env, MANGA_PROJECT: file },
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      },
    );
  assert.throws(
    () => exportFixture('png', '01'),
    /Unknown export selection/,
    'A mistaken format word must not silently export zero pages',
  );
  assert.throws(
    () => exportFixture('01', '02'),
    /Use one selection only/,
    'A second selection must not be silently ignored',
  );
  const fails = (edit, message) => {
    const bad = structuredClone(c);
    edit(bad);
    save(bad);
    assert.throws(() => run('check'), message);
    save(c);
  };
  for (const invalid of [
    null,
    false,
    {},
    '<svg/>',
    {
      ...roughSketchFixture,
      primitives: [{ type: 'line', points: [0, 0, 2, 1] }],
    },
  ])
    fails((v) => (v.pages[0].panels[0].storyboardSketch = invalid));
  for (const value of [0, 23, 161, 50.5, '50'])
    fails(
      (v) => (v.pages[0].panels[0].dialogue[0].tailLength = value),
      /tailLength must be/,
    );
  const shortTail = structuredClone(c);
  shortTail.pages[0].panels[0].dialogue[0].tailLength = 50;
  const firstTail = () => {
    const svg = fs.readFileSync(
      folder + '/workflow/storyboards/page-01.svg',
      'utf8',
    );
    const match = svg.match(
      /data-speaker="a" d="M ([\d.e+-]+) ([\d.e+-]+) L ([\d.e+-]+) ([\d.e+-]+) L ([\d.e+-]+) ([\d.e+-]+)"/,
    );
    assert.ok(match, 'Actual speaker tail must be rendered');
    const a = match.slice(1).map(Number);
    return Math.hypot(a[2] - (a[0] + a[4]) / 2, a[3] - (a[1] + a[5]) / 2);
  };
  save(c);
  run('plan');
  const defaultTail = firstTail();
  save(shortTail);
  run('check');
  run('plan');
  assert.ok(
    firstTail() < defaultTail && firstTail() <= 55,
    'Shortening must change rendered tail while retaining face and collision checks',
  );
  save(c);
  const explicit = structuredClone(c),
    speech = explicit.pages[0].panels[0].dialogue[0];
  speech.speaker = 'narration';
  speech.text = 'あいうえおかきくけ\nこさしすせそ';
  speech.textColumns = ['あいうえおかきくけ', 'こさしすせそ'];
  speech.capacity = 4;
  speech.x = 18;
  save(explicit);
  run('check');
  run('plan');
  const explicitFlow = () =>
    JSON.parse(
      fs.readFileSync(folder + '/workflow/reading-flow/page-01.json', 'utf8'),
    ).panels[0].steps[0].rect;
  const expectedRect = [42, 42, 92, 285];
  assert.deepEqual(
    explicitFlow(),
    expectedRect,
    'Explicit semantic columns must set balloon width and longest-column height',
  );
  const explicitSVG = fs.readFileSync(
    folder + '/workflow/storyboards/page-01.svg',
    'utf8',
  );
  assert.match(explicitSVG, />あいうえおかきくけ<\/text>/);
  assert.match(explicitSVG, />こさしすせそ<\/text>/);
  assert.ok(
    explicitSVG.includes('width="92" height="285"'),
    'Glyph columns and balloon box must agree',
  );
  speech.capacity = 14;
  save(explicit);
  run('plan');
  assert.deepEqual(
    explicitFlow(),
    expectedRect,
    'Capacity must not repartition explicit columns',
  );
  speech.textDirection = 'horizontal';
  save(explicit);
  run('check');
  run('plan');
  assert.deepEqual(
    explicitFlow(),
    [42, 42, 270, 106],
    'Horizontal quoted lines must use their longest line width and number of lines for height',
  );
  const horizontalSVG = fs.readFileSync(
    folder + '/workflow/storyboards/page-01.svg',
    'utf8',
  );
  assert.match(
    horizontalSVG,
    /<text x="60" y="76"[^>]*>あいうえおかきくけ<\/text>/,
  );
  assert.match(horizontalSVG, /<text x="60" y="108"[^>]*>こさしすせそ<\/text>/);
  speech.textDirection = 'diagonal';
  save(explicit);
  assert.throws(() => run('check'), /Invalid textDirection/);
  delete speech.textDirection;
  const scriptInput = () =>
    JSON.stringify(reviewInputs(explicit, file, 'script').base);
  const oldScriptInput = scriptInput();
  speech.text = 'あ😀あ\nあ😀あ';
  speech.textColumns = ['あ😀あ', 'あ😀あ'];
  save(explicit);
  run('plan');
  const plainSVG = fs.readFileSync(
    folder + '/workflow/storyboards/page-01.svg',
    'utf8',
  );
  const plainJobs = JSON.parse(
    fs.readFileSync(folder + '/workflow/jobs.json', 'utf8'),
  );
  const plainPanelJobs = JSON.parse(
    fs.readFileSync(folder + '/workflow/panel-jobs.json', 'utf8'),
  );
  const plainInput = scriptInput();
  speech.textSizeRanges = [
    { start: 2, end: 5, fontSize: 22 },
    { start: 5, end: 6, fontSize: 20 },
  ];
  save(explicit);
  run('check');
  run('plan');
  const sizedSVG = fs.readFileSync(
    folder + '/workflow/storyboards/page-01.svg',
    'utf8',
  );
  assert.match(sizedSVG, />あ😀<tspan font-size="22">あ<\/tspan><\/text>/);
  assert.match(
    sizedSVG,
    /><tspan font-size="22">あ😀<\/tspan><tspan font-size="20">あ<\/tspan><\/text>/,
  );
  assert.deepEqual(
    explicitFlow(),
    [42, 42, 92, 123],
    'Shrinking must retain conservative box geometry',
  );
  assert.notEqual(
    scriptInput(),
    plainInput,
    'Partial font formatting must stale script review',
  );
  assert.notDeepEqual(
    JSON.parse(fs.readFileSync(folder + '/workflow/jobs.json', 'utf8')),
    plainJobs,
    'Partial font formatting must change generation fingerprint',
  );
  assert.notDeepEqual(
    JSON.parse(fs.readFileSync(folder + '/workflow/panel-jobs.json', 'utf8')),
    plainPanelJobs,
    'Partial font formatting must change panel generation fingerprint',
  );
  speech.textDirection = 'horizontal';
  save(explicit);
  run('plan');
  assert.match(
    fs.readFileSync(folder + '/workflow/storyboards/page-01.svg', 'utf8'),
    /<text x="60" y="108"[^>]*><tspan font-size="22">あ😀<\/tspan><tspan font-size="20">あ<\/tspan><\/text>/,
  );
  for (const invalid of [
    null,
    [],
    {},
    [{ start: 0, end: 0, fontSize: 22 }],
    [{ start: 0, end: 7, fontSize: 22 }],
    [{ start: -1, end: 1, fontSize: 22 }],
    [{ start: 0.5, end: 1, fontSize: 22 }],
    [
      { start: 1, end: 3, fontSize: 22 },
      { start: 2, end: 4, fontSize: 22 },
    ],
    [
      { start: 3, end: 4, fontSize: 22 },
      { start: 0, end: 1, fontSize: 22 },
    ],
    ...[19, 27, 22.5, '22', null].map((fontSize) => [
      { start: 0, end: 1, fontSize },
    ]),
    [{ start: 0, end: 1, fontSize: 22, unknown: true }],
  ]) {
    speech.textSizeRanges = invalid;
    save(explicit);
    assert.throws(() => run('check'), /textSizeRanges/);
  }
  delete speech.textSizeRanges;
  delete speech.textDirection;
  save(explicit);
  run('plan');
  assert.equal(
    fs.readFileSync(folder + '/workflow/storyboards/page-01.svg', 'utf8'),
    plainSVG,
    'Absent formatting must restore byte-identical SVG',
  );
  assert.equal(
    scriptInput(),
    plainInput,
    'Absent formatting must restore original script review input',
  );
  speech.text = 'あいうえおかきくけ\nこさしすせそ';
  speech.textColumns = ['あいうえおかきくけ', 'こさしすせそ'];
  assert.equal(scriptInput(), oldScriptInput);
  save(c);
  for (const invalid of [
    ['あいうえおかきくけ'],
    ['あいうえおかきくけ', 'こさしすせそ追加'],
    ['あいうえおかきくけ', '', 'こさしすせそ'],
    [],
    ['あいうえおかきくけ', 42],
    'not an array',
  ]) {
    const bad = structuredClone(explicit);
    bad.pages[0].panels[0].dialogue[0].textColumns = invalid;
    save(bad);
    assert.throws(() => run('check'), /textColumns/);
  }
  save(c);
  run('plan');
  fails(
    (c) => (c.pages[0].panels[0].dialogue[0].speaker = 'unknown'),
    /Unknown speaker/,
  );
  fails(
    (c) => delete c.pages[0].panels[0].speakers.a,
    /Missing speaker anchor/,
  );
  fails(
    (c) => (c.pages[0].panels[0].dialogue[0].x = 290),
    /Balloon covers face/,
  );
  const layoutCopy = structuredClone(c);
  c.pages[0].panels[0].dialogue[0].x = 290;
  save(c);
  run('layout', '01');
  assert.equal(
    JSON.parse(fs.readFileSync(folder + '/workflow.json', 'utf8')).pages[0]
      .panels[0].dialogue[0].x,
    290,
    'Layout preview must not save',
  );
  run('layout', '01', '--apply');
  run('check');
  Object.assign(c, layoutCopy);
  save(c);
  const multiple = structuredClone(c);
  multiple.pages.push(structuredClone(multiple.pages[0]));
  multiple.pages[1].id = '02';
  for (const p of multiple.pages[1].panels) p.id = p.id.replace(/^01-/, '02-');
  for (const page of multiple.pages) page.panels[0].dialogue[0].x = 290;
  save(multiple);
  assert.throws(
    () => run('layout', '01', '--apply'),
    'A remaining bad page must still prevent saving',
  );
  run('layout', 'all', '--apply');
  run('check');
  const repaired = JSON.parse(
    fs.readFileSync(folder + '/workflow.json', 'utf8'),
  );
  assert.equal(repaired.pages.length, 2);
  for (const page of repaired.pages)
    assert.notEqual(
      page.panels[0].dialogue[0].x,
      290,
      'All pages must be repaired together',
    );
  save(c);
  fails((c) => {
    const [a, b] = c.pages[0].panels;
    b.rect = a.rect;
    b.speakers.b = structuredClone(a.speakers.a);
  }, /Panels overlap/);
  fails(
    (c) => (c.pages[0].panels[0].dialogue[0].text = 'あ'.repeat(500)),
    /Balloon outside panel/,
  );
  fails((c) => (c.pages[0].panels[0].role = 'unknown'), /narrative role/);
  fails(
    (c) => (c.pages[0].panels[1].id = c.pages[0].panels[0].id),
    /Duplicate panel/,
  );
  fails((c) => {
    const p = c.pages[0].panels[0];
    p.dialogue = [
      { speaker: 'narration', text: '先。', side: 'left' },
      { speaker: 'narration', text: '後。', side: 'right' },
    ];
  }, /Ambiguous dialogue/);
  fails(
    (c) => (c.pages[0].panels[0].protected = [[800, 24, 200, 300]]),
    /protected area/,
  );
  fails(
    (c) => (c.pages[0].panels[0].protected = [[770, 210, 100, 100]]),
    /Tail crosses protected/,
  );
  fails(
    (c) =>
      (c.pages[0].panels[0].speakers.b = {
        anchor: [805, 230],
        face: [800, 220, 10, 20],
      }),
    /Tail crosses face/,
  );
  fails(
    (c) =>
      c.pages[0].panels[0].dialogue.push({
        speaker: 'narration',
        text: '後。',
        side: 'left',
        x: 766,
        dy: 186,
      }),
    /Tail crosses another balloon/,
  );
  fails((c) => {
    const p = c.pages[0].panels[0];
    p.dialogue = [];
    p.speakers.a.anchor = [-1, 0];
  }, /Speaker anchor outside panel/);
  fails((c) => {
    const p = c.pages[0].panels[0];
    p.dialogue = [];
    p.protected = [[24, 24, -1, 20]];
  }, /Invalid protected area/);
  // Trailing fixture bytes change provenance without changing the blank PNG pixels.
  const image = blankPNG();
  const cropPanel = { rect: [24, 40, 800, 200] };
  const uncropped = renderArtworkImage(image, cropPanel);
  assert.equal(
    uncropped,
    `<image href="data:image/png;base64,${image.toString('base64')}" x="24" y="40" width="800" height="200" preserveAspectRatio="xMidYMid meet"/>`,
    'No crop must preserve the old SVG byte-for-byte',
  );
  assert.deepEqual(
    cropRectangle([0, 0, 1024, 1536], image.subarray(0, 24)),
    [0, 0, 1024, 1536],
  );
  const croppedImage = renderArtworkImage(image, {
    ...cropPanel,
    artworkCrop: [100, 200, 800, 400],
  });
  assert.match(
    croppedImage,
    /viewBox="100 200 800 400" preserveAspectRatio="xMidYMid meet" overflow="hidden"/,
  );
  assert.match(croppedImage, /width="1024" height="1536"/);
  assert.match(
    croppedImage,
    /<svg x="100" y="200" width="800" height="400" viewBox="100 200 800 400" overflow="hidden">/,
  );
  assert.doesNotMatch(croppedImage, /preserveAspectRatio="none"|slice/);
  for (const crop of [
    null,
    [0, 0, 2],
    [NaN, 0, 2, 3],
    [0, 0, Infinity, 3],
    [-1, 0, 2, 3],
    [0, 0, 0, 3],
    [1000, 0, 25, 3],
    [0, 1536, 1, 1],
  ])
    assert.throws(() => cropRectangle(crop, image), /artworkCrop/);
  assert.throws(
    () => cropRectangle([0, 0, 1, 1], Buffer.alloc(24)),
    /PNG header/,
  );
  fs.writeFileSync(folder + '/a.png', image);
  fs.writeFileSync(
    folder + '/b.png',
    Buffer.concat([image, Buffer.from('provenance-fixture')]),
  );
  fs.writeFileSync(folder + '/invalid.png', 'not an image');
  assert.throws(
    () => run('accept', '01', relative + '/invalid.png', '--reviewed'),
    /Expected a PNG/,
  );
  fs.writeFileSync(
    folder + '/edit.txt',
    'Image1 is the target. Image2 supplies the held-object shape only. Preserve target acting and composition.',
  );
  const prepareFixture = (...args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          'cli/generation.mjs',
          'prepare-edit',
          c.pages[0].panels[0].id,
          relative + '/a.png',
          relative + '/edit.txt',
          ...args,
        ],
        {
          cwd: root,
          env: { ...process.env, MANGA_PROJECT: file },
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true,
        },
      ),
    );
  const single = prepareFixture(),
    supported = prepareFixture('--reference', relative + '/b.png');
  assert.notEqual(
    single.request,
    supported.request,
    'Supporting material changes the saved edit input identity',
  );
  const request = JSON.parse(
    fs.readFileSync(path.join(root, supported.request), 'utf8'),
  );
  assert.equal(request.references.length, 2);
  assert.equal(request.references[0].original, relative + '/a.png');
  assert.equal(request.references[1].original, relative + '/b.png');
  assert.match(request.references[0].role, /Edit target/);
  assert.match(request.references[1].role, /Supporting edit reference/);
  for (const r of request.references)
    assert.equal(
      fs
        .readFileSync(path.join(root, r.file))
        .compare(fs.readFileSync(path.join(root, r.original))),
      0,
      'Every edit input must be snapshotted byte-for-byte',
    );
  assert.throws(
    () => prepareFixture('--reference'),
    /Use --reference PATH/,
    'Incomplete optional reference must be rejected',
  );
  assert.throws(
    () => prepareFixture('--unexpected', relative + '/b.png'),
    /Unknown edit option/,
  );
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'cli/generation.mjs',
          'prepare',
          c.pages[0].panels[0].id,
          '--reference',
          relative + '/b.png',
        ],
        {
          cwd: root,
          env: { ...process.env, MANGA_PROJECT: file },
          encoding: 'utf8',
          stdio: 'pipe',
          windowsHide: true,
        },
      ),
    /Supporting references are available for prepare-edit only/,
  );
  run('accept', '01', relative + '/a.png', '--reviewed');
  assert.match(run('status'), /stale/);
  assert.throws(() => run('build'));
  assert.throws(() => run('review', '01', '--speakers'));
  run('preview');
  run('review', '01', '--speakers', '--faces', '--order', '--continuity');
  run('build');
  const output = fs.readFileSync(folder + '/output/page-01.svg');
  assert.ok(
    !fs
      .readFileSync(folder + '/output/reader.html', 'utf8')
      .includes('未来の剣聖'),
  );
  assert.ok(
    fs
      .readFileSync(folder + '/output/reader.html', 'utf8')
      .includes('\\u003c/script>'),
  );
  run('accept', '01', relative + '/b.png', '--reviewed');
  assert.match(run('status'), /stale/);
  assert.throws(() => run('build'));
  assert.deepEqual(fs.readFileSync(folder + '/output/page-01.svg'), output);
  fs.writeFileSync(folder + '/original.txt', '改稿');
  assert.match(run('status'), /stale/);
  fs.writeFileSync(folder + '/original.txt', '別の原作');
  run(
    'accept-panel',
    '01-1',
    relative + '/a.png',
    '--reviewed',
    '--reason',
    'Synthetic override',
  );
  assert.throws(
    () => run('use-page', '01-1', '--reason', 'Synthetic page fallback'),
    /Inspect replacement page/,
  );
  assert.throws(
    () => run('use-page', '01-1', '--reviewed'),
    /Record replacement reason/,
  );
  c.pages[0].panels[0].artworkCrop = [0, 0, 1024, 1536];
  save(c);
  const preservedOverride = fs.readFileSync(folder + '/assets/panels/01-1.png');
  const preservedRecord = fs.readFileSync(folder + '/assets/panels/01-1.json');
  assert.throws(
    () =>
      run(
        'use-page',
        '01-1',
        '--reviewed',
        '--reason',
        'Synthetic incompatible crop',
      ),
    /artworkCrop/,
  );
  assert.deepEqual(
    fs.readFileSync(folder + '/assets/panels/01-1.png'),
    preservedOverride,
  );
  assert.deepEqual(
    fs.readFileSync(folder + '/assets/panels/01-1.json'),
    preservedRecord,
  );
  delete c.pages[0].panels[0].artworkCrop;
  save(c);
  run('use-page', '01-1', '--reviewed', '--reason', 'Synthetic page fallback');
  assert.ok(!fs.existsSync(folder + '/assets/panels/01-1.png'));
  assert.ok(
    fs
      .readFileSync(folder + '/assets/history.jsonl', 'utf8')
      .includes('use-page'),
  );
  c.version = 6;
  c.renderMode = 'panels';
  c.sections = {
    present: {
      location: '検証用の店',
      costumes: { a: '白い上着' },
      objects: { item: '古い箱' },
    },
    past: { location: '検証用の過去', costumes: { b: '黒いシャツ' } },
  };
  c.pages[0].section = 'present';
  c.pages[0].panels[1].section = 'past';
  save(c);
  fs.unlinkSync(folder + '/assets/page-01.png');
  fs.unlinkSync(folder + '/assets/page-01.json');
  run('plan');
  const jobs = () =>
    JSON.parse(fs.readFileSync(folder + '/workflow/panel-jobs.json', 'utf8'));
  const planned = jobs();
  assert.ok(planned[0].prompt.includes('白い上着'));
  assert.ok(planned[1].prompt.includes('黒いシャツ'));
  assert.ok(!planned[1].prompt.includes('白い上着'));
  assert.ok(planned[0].prompt.includes('No page layout'));
  assert.match(run('status'), /pending/);
  assert.throws(
    () => run('accept', '01', relative + '/a.png', '--reviewed'),
    /use accept-panel/,
  );
  const candidate = run(
    'candidate-panel',
    '01-1',
    relative + '/a.png',
    '--note',
    '構図A',
    '--renderer',
    'test-fixture',
    '--model',
    'not-a-model',
  )
    .trim()
    .replace('Registered candidate: ', '');
  run('candidate-panel', '01-1', relative + '/b.png', '--note', '構図B');
  const oldRough = fs.readFileSync(
    folder + '/workflow/storyboards/page-01.svg',
  );
  c.pages[0].panels[0].storyboardSketch = structuredClone(roughSketchFixture);
  save(c);
  run('check');
  run('plan');
  const sketchedJob = jobs()[0].fingerprint,
    sketchedRough = fs.readFileSync(
      folder + '/workflow/storyboards/page-01.svg',
      'utf8',
    );
  assert.notEqual(sketchedJob, planned[0].fingerprint);
  assert.equal(jobs()[1].fingerprint, planned[1].fingerprint);
  assert.ok(sketchedRough.includes('id="rough-sketch-0"'));
  assert.ok(sketchedRough.includes('fill="none" stroke="#bbb"'));
  assert.ok(
    sketchedRough.includes('fill="#f5f5f5" stroke="#bbb"'),
    'Other panels retain gray face fill',
  );
  const cleanRough = fs.readFileSync(
      folder + '/workflow/storyboards-unnumbered/page-01.svg',
      'utf8',
    ),
    flowRough = fs.readFileSync(
      folder + '/workflow/reading-flow/page-01.svg',
      'utf8',
    );
  assert.ok(
    cleanRough.includes(
      renderStoryboardSketch(
        roughSketchFixture,
        c.pages[0].panels[0].rect,
        'rough-sketch-0',
        { rough: true },
      ),
    ),
    'Clean first-reading view must retain the structured drawing verbatim',
  );
  assert.doesNotMatch(
    cleanRough,
    /stroke="#bbb"|fill="#999"|fill="#666"|#005eb8|#d04a00/,
  );
  for (const p of c.pages[0].panels) {
    const [x, y, w, h] = p.rect;
    assert.ok(
      cleanRough.includes(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="black" stroke-width="3"/>`,
      ),
    );
    for (const [id, s] of Object.entries(p.speakers || {})) {
      if (s.kind === 'offscreen') continue;
      const label = `<text x="${s.anchor[0] + 10}" y="${s.anchor[1]}" font-size="18">${id}</text>`;
      assert.ok(
        !cleanRough.includes(label),
        'Clean view must omit actor labels',
      );
      assert.ok(
        sketchedRough.includes(label),
        'Numbered storyboard retains actor guides',
      );
      assert.ok(
        flowRough.includes(label),
        'Reading-flow view retains actor guides',
      );
    }
  }
  assert.match(flowRough, /#005eb8/);
  assert.match(sketchedRough, /fill="#999"/);
  assert.match(cleanRough, /<polygon|<path/);
  assert.match(cleanRough, /<text/);
  assert.throws(
    () => run('accept-panel', '01-1', candidate, '--reviewed'),
    /Stale candidate/,
    'Old composition candidate must be rejected',
  );
  c.pages[0].panels[0].storyboardSketch.primitives[0].points[2] = 0.8;
  save(c);
  run('plan');
  assert.notEqual(
    jobs()[0].fingerprint,
    sketchedJob,
    'Geometry-only edit must invalidate panel job',
  );
  delete c.pages[0].panels[0].storyboardSketch;
  save(c);
  run('plan');
  assert.equal(jobs()[0].fingerprint, planned[0].fingerprint);
  assert.deepEqual(
    fs.readFileSync(folder + '/workflow/storyboards/page-01.svg'),
    oldRough,
    'Absent optional field must restore identical rough SVG',
  );

  assert.ok(fs.existsSync(folder + '/assets/candidates/01-1/index.html'));
  const draftPanel = c.pages[0].panels[0],
    draftPath = relative + '/draft-v1.png';
  fs.writeFileSync(path.join(root, draftPath), blankPNG());
  draftPanel.storyboardImage = draftPath;
  save(c);
  assert.throws(() => run('check'), /panel.references/);
  draftPanel.references = [draftPath];
  draftPanel.storyboardSketch = structuredClone(roughSketchFixture);
  save(c);
  run('plan');
  const draftedJob = jobs()[0].fingerprint,
    draftedReview = captureReview(
      root,
      c,
      file,
      'storyboard',
      '01',
    ).fingerprint;
  for (const view of [
    'storyboards',
    'storyboards-unnumbered',
    'reading-flow',
  ]) {
    const drawing = fs.readFileSync(
      folder + `/workflow/${view}/page-01.svg`,
      'utf8',
    );
    assert.ok(drawing.includes(embedded));
    assert.match(drawing, /preserveAspectRatio="xMidYMid meet"/);
    assert.ok(
      !drawing.includes('rough-sketch-0'),
      'PNG visually replaces editable vector fallback',
    );
    assert.match(drawing, /<text/);
    if (view === 'storyboards-unnumbered')
      assert.doesNotMatch(drawing, /stroke="#bbb"|fill="#999"|fill="#666"/);
    else assert.match(drawing, /fill="none" stroke="#bbb"/);
  }
  assert.ok(jobs()[0].references.includes(draftPath));
  const fullDraftSVG = fs.readFileSync(
    folder + '/workflow/storyboards/page-01.svg',
  );
  const preparationJob = JSON.parse(
    fs.readFileSync(folder + '/workflow/panel-jobs.json', 'utf8'),
  ).find((j) => j.id === '01-1');
  for (const ref of preparationJob.references) {
    const target = path.join(root, ref);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, image);
    }
  }
  const preparedComposition = spawnSync(
    process.execPath,
    ['cli/generation.mjs', 'prepare', '01-1'],
    {
      cwd: root,
      env: { ...process.env, MANGA_PROJECT: file },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.equal(preparedComposition.status, 0, preparedComposition.stderr);
  assert.match(
    preparedComposition.stderr,
    /Composition review needed: 01-1:.*未使用面積/,
  );
  assert.ok(JSON.parse(preparedComposition.stdout).request);
  const savedPanelJobs = fs.readFileSync(
    folder + '/workflow/panel-jobs.json',
    'utf8',
  );
  const staleJobs = JSON.parse(savedPanelJobs);
  staleJobs.find((j) => j.id === '01-1').prompt +=
    '\nPLANNED CAMERA CROP for panel 01-1: shoulder';
  fs.writeFileSync(
    folder + '/workflow/panel-jobs.json',
    JSON.stringify(staleJobs),
  );
  const stalePreparation = spawnSync(
    process.execPath,
    ['cli/generation.mjs', 'prepare', '01-1'],
    {
      cwd: root,
      env: { ...process.env, MANGA_PROJECT: file },
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.notEqual(stalePreparation.status, 0);
  assert.match(
    stalePreparation.stderr,
    /Regenerate panel-jobs.json: planned cameraCrop changed/,
  );
  fs.writeFileSync(folder + '/workflow/panel-jobs.json', savedPanelJobs);
  draftPanel.cameraCrop = 'unrecognized';
  save(c);
  assert.throws(() => run('check'), /Unknown planned cameraCrop/);
  delete draftPanel.cameraCrop;
  draftPanel.artworkCrop = [0, 200, 1024, 800];
  save(c);
  assert.notEqual(
    captureReview(root, c, file, 'storyboard', '01').fingerprint,
    draftedReview,
    'Crop must invalidate the review before replan',
  );
  run('plan');
  assert.notEqual(jobs()[0].fingerprint, draftedJob);
  assert.match(
    fs.readFileSync(folder + '/workflow/storyboards/page-01.svg', 'utf8'),
    /viewBox="0 200 1024 800"/,
  );
  draftPanel.artworkCrop = [0, 1000, 1024, 800];
  save(c);
  assert.throws(() => run('check'), /exceeds the source PNG/);
  if (c.renderMode === 'panels' && !draftPanel.storyboardImage) {
    fs.writeFileSync(folder + '/larger-crop-source.png', blankPNG(1024, 2048));
    run(
      'accept-panel',
      draftPanel.id,
      relative + '/larger-crop-source.png',
      '--reviewed',
    );
    run('check');
  }
  delete draftPanel.artworkCrop;
  save(c);
  run('plan');
  assert.equal(jobs()[0].fingerprint, draftedJob);
  assert.deepEqual(
    fs.readFileSync(folder + '/workflow/storyboards/page-01.svg'),
    fullDraftSVG,
  );
  const explicitLayout = relative + '/workflow/panels/page-reference.png';
  fs.writeFileSync(path.join(root, explicitLayout), blankPNG());
  const identityConfig = structuredClone(c);
  identityConfig.renderMode = 'panels';
  identityConfig.pages[0].panels[0].storyboardImage = explicitLayout;
  identityConfig.pages[0].panels[0].references = [explicitLayout];
  const identities = createGenerationJobs({
    config: identityConfig,
    local: (f) => path.join(root, f),
    stateFor: () => ({}),
    svg: () => '',
  });
  const beforeIdentity = identities.panelJob(
    identityConfig.pages[0],
    identityConfig.pages[0].panels[0],
  ).fingerprint;
  fs.writeFileSync(path.join(root, explicitLayout), blankPNG(512, 768));
  assert.notEqual(
    identities.panelJob(
      identityConfig.pages[0],
      identityConfig.pages[0].panels[0],
    ).fingerprint,
    beforeIdentity,
  );
  const otherDraft = relative + '/draft-v2.png';
  fs.writeFileSync(path.join(root, otherDraft), blankPNG());
  for (const modern of [false, true]) {
    const selection = structuredClone(c);
    if (modern) selection.promptPolicy = { version: 2 };
    const selectedPanel = selection.pages[0].panels[0];
    selectedPanel.references = [draftPath, otherDraft];
    const make = createGenerationJobs({
      config: selection,
      local: (f) => path.join(root, f),
      stateFor: () => ({}),
      svg: () => '',
    });
    const first = make.panelJob(selection.pages[0], selectedPanel).fingerprint;
    const firstPage = make.job(selection.pages[0]).fingerprint;
    const firstSfxReview = captureReview(
      root,
      selection,
      file,
      'storyboard',
      selection.pages[0].id,
    ).fingerprint;
    selectedPanel.soundEffects = [
      { text: 'ガンッ', x: 40, y: 300, fontSize: 60 },
    ];
    let lastEffectHash = first;
    for (const change of [{}, { text: 'ドン' }, { x: 60 }, { fontSize: 80 }]) {
      Object.assign(selectedPanel.soundEffects[0], change);
      const currentEffectHash = make.panelJob(
        selection.pages[0],
        selectedPanel,
      ).fingerprint;
      assert.notEqual(
        currentEffectHash,
        lastEffectHash,
        'SFX content/position/size must invalidate material',
      );
      assert.notEqual(make.job(selection.pages[0]).fingerprint, firstPage);
      assert.notEqual(
        captureReview(
          root,
          selection,
          file,
          'storyboard',
          selection.pages[0].id,
        ).fingerprint,
        firstSfxReview,
      );
      lastEffectHash = currentEffectHash;
    }
    delete selectedPanel.soundEffects;
    assert.equal(
      make.panelJob(selection.pages[0], selectedPanel).fingerprint,
      first,
    );
    assert.equal(make.job(selection.pages[0]).fingerprint, firstPage);
    selectedPanel.artworkCrop = [0, 200, 1024, 800];
    const cropped = make.panelJob(selection.pages[0], selectedPanel);
    assert.notEqual(
      cropped.fingerprint,
      first,
      'Crop must invalidate legacy and modern material jobs',
    );
    assert.notEqual(
      make.job(selection.pages[0]).fingerprint,
      firstPage,
      'Crop must invalidate page material jobs even without a rendered layout',
    );
    assert.match(cropped.prompt, /compositor metadata.*NEW artwork/s);
    delete selectedPanel.artworkCrop;
    assert.equal(
      make.panelJob(selection.pages[0], selectedPanel).fingerprint,
      first,
    );
    selectedPanel.storyboardImage = otherDraft;
    assert.notEqual(
      make.panelJob(selection.pages[0], selectedPanel).fingerprint,
      first,
      'Draft selector alone must invalidate both legacy and modern panel jobs',
    );
  }
  fs.appendFileSync(path.join(root, draftPath), 'changed-draft');
  assert.notEqual(
    captureReview(root, c, file, 'storyboard', '01').fingerprint,
    draftedReview,
    'Raw draft mutation must invalidate review before replan',
  );
  run('plan');
  assert.notEqual(jobs()[0].fingerprint, draftedJob);
  assert.notEqual(
    captureReview(root, c, file, 'storyboard', '01').fingerprint,
    draftedReview,
  );
  assert.equal(jobs()[1].fingerprint, planned[1].fingerprint);
  for (const bad of [
    '../outside.png',
    'https://example.invalid/draft.png',
    relative + '/original.txt',
  ]) {
    draftPanel.storyboardImage = bad;
    draftPanel.references = [bad];
    save(c);
    assert.throws(
      () => run('check'),
      /escapes|local project-relative PNG|Expected a PNG/,
    );
  }
  const zeroPNG = blankPNG();
  zeroPNG.writeUInt32BE(0, 16);
  fs.writeFileSync(path.join(root, draftPath), zeroPNG);
  draftPanel.storyboardImage = draftPath;
  draftPanel.references = [draftPath];
  save(c);
  assert.throws(() => run('check'), /positive dimensions/);
  fs.writeFileSync(path.join(root, draftPath), blankPNG());
  delete draftPanel.storyboardImage;
  delete draftPanel.references;
  delete draftPanel.storyboardSketch;
  save(c);
  run('plan');
  assert.equal(jobs()[0].fingerprint, planned[0].fingerprint);
  run(
    'accept-panel',
    '01-1',
    candidate,
    '--reviewed',
    '--reason',
    '検証用に構図Aを選択',
  );
  assert.match(run('status'), /pending/);
  assert.throws(() => run('build'));
  run('accept-panel', '01-2', relative + '/a.png', '--reviewed');
  assert.match(run('status'), /stale/);
  const record = JSON.parse(
    fs.readFileSync(folder + '/assets/panels/01-1.json', 'utf8'),
  );
  assert.equal(record.renderer, 'test-fixture');
  assert.equal(record.model, 'not-a-model');
  assert.ok(record.acceptedJob.prompt.includes('白い上着'));
  run('preview');
  run('review', '01', '--speakers', '--faces', '--order', '--continuity');
  run('build');
  run('layers');
  assert.ok(
    !fs.existsSync(folder + '/assets/page-01.png'),
    'Panel-only build unexpectedly requires a page PNG',
  );
  const art = fs.readFileSync(
      folder + '/output/layers/page-01-artwork.svg',
      'utf8',
    ),
    letters = fs.readFileSync(
      folder + '/output/layers/page-01-lettering.svg',
      'utf8',
    );
  assert.ok(art.includes('data:image/png'));
  assert.ok(!art.includes('<text'));
  assert.ok(!letters.includes('data:image/png'));
  assert.ok(letters.includes('<text'));
  const complete = fs.readFileSync(folder + '/output/page-01.svg');
  for (const args of [
    ['check'],
    ['accept-panel', '01-1', relative + '/a.png', '--reviewed'],
  ]) {
    const result = spawnSync(process.execPath, ['cli/workflow.mjs', ...args], {
      cwd: root,
      env: { ...process.env, MANGA_PROJECT: file },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /構図の要確認.*目視合格/s);
    assert.match(result.stderr, /未使用面積/);
    assert.match(result.stdout, /OK:|Accepted panel/);
  }
  draftPanel.artworkCrop = [0, 200, 1024, 800];
  save(c);
  run('plan');
  assert.throws(
    () => run('preview'),
    /Changed or missing preview material|Stale panel override/,
  );
  fs.writeFileSync(folder + '/smaller-crop-source.png', blankPNG(256, 384));
  const previousCropRecord = fs.readFileSync(
    folder + '/assets/panels/01-1.json',
  );
  assert.throws(
    () =>
      run(
        'accept-panel',
        '01-1',
        relative + '/smaller-crop-source.png',
        '--reviewed',
      ),
    /exceeds the source PNG/,
  );
  assert.deepEqual(
    fs.readFileSync(folder + '/assets/panels/01-1.json'),
    previousCropRecord,
    'Invalid crop adoption must preserve the accepted record',
  );
  assert.deepEqual(
    fs.readFileSync(folder + '/assets/panels/01-1.png'),
    image,
    'Invalid crop adoption must preserve the accepted image',
  );
  run('accept-panel', '01-1', relative + '/a.png', '--reviewed');
  run('preview');
  assert.match(
    fs.readFileSync(folder + '/workflow/review/page-01.svg', 'utf8'),
    /viewBox="0 200 1024 800"/,
  );
  draftPanel.artworkCrop = [0, 1000, 1024, 800];
  save(c);
  assert.throws(() => run('check'), /exceeds the source PNG/);
  delete draftPanel.artworkCrop;
  save(c);
  run('plan');
  run('accept-panel', '01-1', relative + '/a.png', '--reviewed');
  run('preview');
  run('review', '01', '--speakers', '--faces', '--order', '--continuity');
  run('build');
  assert.deepEqual(fs.readFileSync(folder + '/output/page-01.svg'), complete);
  draftPanel.storyboardImage = draftPath;
  draftPanel.references = [draftPath];
  save(c);
  run('plan');
  assert.match(run('status'), /stale/);
  assert.throws(() => run('build'));
  run('accept-panel', '01-1', relative + '/a.png', '--reviewed');
  run('preview');
  run('review', '01', '--speakers', '--faces', '--order', '--continuity');
  run('build');
  run('layers');
  assert.deepEqual(fs.readFileSync(folder + '/output/page-01.svg'), complete);
  assert.equal(
    fs.readFileSync(folder + '/output/layers/page-01-artwork.svg', 'utf8'),
    art,
  );
  assert.equal(
    fs.readFileSync(folder + '/output/layers/page-01-lettering.svg', 'utf8'),
    letters,
  );
  delete draftPanel.storyboardImage;
  delete draftPanel.references;
  c.pages[0].panels[0].storyboardSketch = structuredClone(roughSketchFixture);
  save(c);
  run('plan');
  assert.match(run('status'), /stale/);
  assert.throws(() => run('build'));
  assert.deepEqual(fs.readFileSync(folder + '/output/page-01.svg'), complete);
  run('accept-panel', '01-1', relative + '/a.png', '--reviewed');
  run('preview');
  run('review', '01', '--speakers', '--faces', '--order', '--continuity');
  run('build');
  assert.deepEqual(
    fs.readFileSync(folder + '/output/page-01.svg'),
    complete,
    'Rough sketch must never enter final artwork',
  );
  delete c.pages[0].panels[0].storyboardSketch;
  save(c);
  run('plan');
  run('accept-panel', '01-1', relative + '/a.png', '--reviewed');
  run('preview');
  run('review', '01', '--speakers', '--faces', '--order', '--continuity');
  run('build');

  c.pages[0].panels[1].scene += ' changed';
  save(c);
  run('plan');
  assert.equal(jobs()[0].fingerprint, planned[0].fingerprint);
  assert.notEqual(jobs()[1].fingerprint, planned[1].fingerprint);
  assert.match(run('status'), /stale/);
  assert.throws(() => run('build'));
  assert.deepEqual(fs.readFileSync(folder + '/output/page-01.svg'), complete);
  c.sections.present.costumes.a = '紺の礼服';
  save(c);
  run('plan');
  assert.notEqual(jobs()[0].fingerprint, planned[0].fingerprint);
  assert.throws(
    () => run('accept-panel', '01-1', candidate, '--reviewed'),
    /Stale candidate/,
  );
  fs.writeFileSync(folder + '/workflow/reference.png', image);
  c.sections.present.references = [relative + '/workflow/reference.png'];
  save(c);
  run('plan');
  const referenced = jobs();
  fs.writeFileSync(
    folder + '/workflow/reference.png',
    Buffer.concat([image, Buffer.from('changed-reference')]),
  );
  run('plan');
  assert.notEqual(jobs()[0].fingerprint, referenced[0].fingerprint);
  assert.equal(jobs()[1].fingerprint, referenced[1].fingerprint);
  c.pages[0].section = 'missing';
  save(c);
  assert.throws(() => run('check'), /Unknown story section/);
  c.pages[0].section = 'present';
  c.sections.present.costumes.unknown = 'coat';
  save(c);
  assert.throws(() => run('check'), /Unknown costume actor/);
  delete c.sections.present.costumes.unknown;
  c.sections.present.costumes = 'coat';
  save(c);
  assert.throws(() => run('check'), /must map IDs/);
  // This is synthetic test evidence; it does not certify the blank fixtures as artwork.
  delete c.sections.present.costumes;
  c.version = 7;
  c.quality = structuredClone(defaultQuality);
  save(c);
  run('check');
  run('plan');
  for (const p of c.pages[0].panels)
    run(
      'accept-panel',
      p.id,
      relative + '/a.png',
      '--reviewed',
      '--renderer',
      'test-fixture',
    );
  run('preview');
  run('review', '01', '--speakers', '--faces', '--order', '--continuity');
  assert.throws(() => run('build'));
  run('quality-plan');
  const reports = [];
  for (const p of c.pages[0].panels) {
    const r = JSON.parse(
      fs.readFileSync(
        folder + '/workflow/quality/' + p.id + '.template.json',
        'utf8',
      ),
    );
    r.observation = 'Synthetic fixture to exercise validation only.';
    r.views = { thumbnail: true, native: true, detail: true };
    r.checks = Object.fromEntries(
      categories.map((k) => [
        k,
        { result: 'na', note: 'White fixture; no drawing.' },
      ]),
    );
    reports.push(r);
    fs.writeFileSync(folder + '/report.json', JSON.stringify(r));
    run('quality-review', p.id, relative + '/report.json');
  }
  run('build');
  const qualityComplete = fs.readFileSync(folder + '/output/page-01.svg');
  const bad = structuredClone(reports[0]);
  bad.checks.contact = { result: 'fail', note: 'Fixture contact issue' };
  bad.issues = [
    { category: 'contact', description: 'Fixture open issue', status: 'open' },
  ];
  fs.writeFileSync(folder + '/report.json', JSON.stringify(bad));
  run('quality-review', bad.panel, relative + '/report.json');
  assert.throws(() => run('build'));
  assert.deepEqual(
    fs.readFileSync(folder + '/output/page-01.svg'),
    qualityComplete,
  );
  run('quality-repair', bad.panel);
  assert.match(
    fs.readFileSync(
      folder + '/workflow/quality/' + bad.panel + '.repair.json',
      'utf8',
    ),
    /Fixture contact issue/,
  );
  bad.checks.contact.result = 'pass';
  fs.writeFileSync(folder + '/report.json', JSON.stringify(bad));
  run('quality-review', bad.panel, relative + '/report.json');
  assert.throws(
    () => run('build'),
    'Open issue must block release even if category passes',
  );
  bad.issues = [];
  bad.views.detail = false;
  fs.writeFileSync(folder + '/report.json', JSON.stringify(bad));
  assert.throws(
    () => run('quality-review', bad.panel, relative + '/report.json'),
    /Inspect detail/,
  );
  fs.writeFileSync(folder + '/report.json', JSON.stringify(reports[0]));
  run('quality-review', bad.panel, relative + '/report.json');
  run('build');
  run('accept-panel', bad.panel, relative + '/b.png', '--reviewed');
  run('review', '01', '--speakers', '--faces', '--order', '--continuity');
  assert.throws(
    () => run('quality-review', bad.panel, relative + '/report.json'),
    /Stale quality template/,
  );
  assert.throws(() => run('build'));
  c.quality.drawing.push('New ink direction');
  save(c);
  assert.match(run('status'), /stale/);
  delete c.quality;
  save(c);
  assert.throws(() => run('check'), /Version 7 requires/);
  c.version = 8;
  c.quality = structuredClone(defaultQuality);
  c.references = [relative + '/a.png'];
  c.referenceRoles = { [relative + '/a.png']: 'Synthetic fixture canonical' };
  for (const actor of Object.values(c.cast))
    if (actor.kind !== 'caption')
      actor.faceDesign = {
        traits: ['Fixture eyes', 'Fixture brows', 'Fixture chin'],
        reference: relative + '/a.png',
        settingBasis: 'Synthetic test, no artwork',
      };
  save(c);
  run('plan');
  const facePlan = jobs()[0].fingerprint;
  c.referenceRoles[relative + '/a.png'] = 'Changed synthetic reference role';
  save(c);
  run('plan');
  assert.notEqual(jobs()[0].fingerprint, facePlan);
  for (const p of c.pages[0].panels)
    run(
      'accept-panel',
      p.id,
      relative + '/a.png',
      '--reviewed',
      '--renderer',
      'test-fixture',
    );
  run('preview');
  run('review', '01', '--speakers', '--faces', '--order', '--continuity');
  run('quality-plan');
  for (const p of c.pages[0].panels) {
    const r = JSON.parse(
      fs.readFileSync(
        folder + '/workflow/quality/' + p.id + '.template.json',
        'utf8',
      ),
    );
    r.observation = 'Synthetic face evidence validation only.';
    r.views = { thumbnail: true, native: true, detail: true };
    r.checks = Object.fromEntries(
      categories.map((k) => [
        k,
        { result: 'na', note: 'White synthetic fixture; no artwork.' },
      ]),
    );
    fs.writeFileSync(folder + '/report.json', JSON.stringify(r));
    assert.throws(
      () => run('quality-review', p.id, relative + '/report.json'),
      /Observe each of three/,
    );
    for (const v of Object.values(r.faceIdentity)) {
      v.traits = [
        'Synthetic eyes observation',
        'Synthetic brows observation',
        'Synthetic chin observation',
      ];
      v.expression = 'Synthetic expression observation';
    }
    fs.writeFileSync(folder + '/report.json', JSON.stringify(r));
    run('quality-review', p.id, relative + '/report.json');
  }
  run('build');
  c.cast.a.faceDesign.traits[0] = 'Changed face eyes';
  save(c);
  assert.match(run('status'), /stale/);
  assert.throws(() => run('build'));
  const history = fs.readFileSync(folder + '/assets/history.jsonl', 'utf8');
  const offscreenFixture = structuredClone(c);
  const offscreenPanel = offscreenFixture.pages[0].panels[0];
  offscreenPanel.speakers = {
    a: { kind: 'offscreen', offscreenEdge: 'right' },
  };
  offscreenPanel.dialogue = [
    {
      speaker: 'a',
      text: 'はい',
      side: 'right',
      x: offscreenPanel.rect[2] - 82,
      dy: 12,
    },
  ];
  offscreenPanel.protected = [];
  save(offscreenFixture);
  run('check');
  offscreenPanel.speakers.a.offscreenEdge = 'top';
  save(offscreenFixture);
  assert.throws(() => run('check'), /offscreenEdge/);
  offscreenPanel.speakers.a.offscreenEdge = 'right';
  offscreenPanel.dialogue[0].x = 12;
  save(offscreenFixture);
  assert.throws(() => run('check'), /near its declared panel edge/);
  offscreenPanel.dialogue[0].x = offscreenPanel.rect[2] - 82;
  offscreenPanel.protected = [
    [
      offscreenPanel.rect[0] + offscreenPanel.rect[2] - 14,
      offscreenPanel.rect[1] + 54,
      4,
      12,
    ],
  ];
  save(offscreenFixture);
  assert.throws(() => run('check'), /Tail crosses protected area/);
  save(c);
  assert.ok(history.includes('検証用に構図Aを選択'));
  const sfxFixture = structuredClone(c),
    sfxPanel = sfxFixture.pages[0].panels[0];
  sfxPanel.soundEffects = [
    {
      text: 'ガンッ',
      x: sfxPanel.rect[0] + 10,
      y: sfxPanel.rect[1] + 10,
      fontSize: 80,
    },
  ];
  sfxPanel.speakers = {};
  sfxPanel.dialogue = [];
  sfxPanel.protected = [];
  save(sfxFixture);
  run('plan');
  const sfxStoryboard = fs.readFileSync(
    folder + '/workflow/storyboards/page-' + sfxFixture.pages[0].id + '.svg',
    'utf8',
  );
  assert.ok(sfxStoryboard.includes('ガンッ'));
  sfxPanel.soundEffects[0].x = -10;
  save(sfxFixture);
  assert.throws(() => run('check'), /Sound effect outside panel/);
  save(c);
  assert.ok(
    fs.readdirSync(folder + '/assets/history').some((f) => f.endsWith('.png')),
  );
  console.log(
    'PASS: planning PNG binding, contain rendering, clean guides, final/layer exclusion, raw review and generation invalidation',
  );
  console.log(
    'PASS: optional rough sketches, final exclusion, no-field bytes, sketch job/candidate invalidation, clipping and injection rejection',
  );
  console.log(
    'PASS: arbitrary work, geometry rejection, review gate, replaced image/source invalidation, failed build preserves output',
  );
  console.log(
    'PASS: panel-only composition, section state, independent panel fingerprints, stale candidate rejection, selection history and transparent layers',
  );
  console.log(
    'PASS: required quality evidence, all inspection scales, failed/open issue release gate, repair instructions, stale review and profile invalidation',
  );
  console.log(
    'PASS: face identity review gate, reference-role and face-trait changes invalidate accepted material',
  );
} finally {
  process.chdir(workspaceRoot);
  temporary.cleanup();
}
