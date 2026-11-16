import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createTemporary } from '../src/temporary.mjs';
import { copyRuntime } from './support.mjs';
import { root } from '../src/workspace.mjs';
import {
  intakeDraft,
  spreadPlan,
  characterCards,
  cardsHTML,
  deliveryPlan,
  generationSummary,
} from '../src/production-assist.mjs';
const draft = intakeDraft({
  title: 'Known',
  theme: 'Maybe',
  tentative: ['theme'],
});
assert.deepEqual(draft.confirmed, { title: 'Known' });
assert.deepEqual(draft.tentative, { theme: 'Maybe' });
assert.ok(!draft.unknown.includes('title'));
assert.throws(() => intakeDraft({ unknown: true }));
assert.throws(() => intakeDraft({ title: 2 }));
assert.deepEqual(spreadPlan([{ id: '01' }, { id: '02' }, { id: '03' }]), [
  { right: null, left: { page: '01' } },
  { right: { page: '02' }, left: { page: '03' } },
]);
assert.deepEqual(spreadPlan([{ id: '01' }, { id: '02' }], 1)[1], {
  right: { page: '01' },
  left: { page: '02' },
});
assert.throws(() => spreadPlan([], 0.5));
const cards = characterCards({
  cast: { a: { name: '<actor>' }, n: { kind: 'caption' } },
});
assert.equal(cards.length, 1);
assert.equal(cards[0].age, null);
assert.ok(!cardsHTML(cards).includes('<actor>'));
assert.equal(generationSummary(null).panels.length, 0);
const temp = createTemporary('test');
copyRuntime(root, temp.folder);
const w = path.join(temp.folder, 'works', 'fixture');
fs.mkdirSync(w, { recursive: true });
const bytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1sAAAAASUVORK5CYII=',
  'base64',
);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const config = {
  workflowDir: 'works/fixture/workflow',
  assetDir: 'works/fixture/assets',
  outputDir: 'works/fixture/output',
  sourceFile: 'works/fixture/source.txt',
  cast: { a: { name: 'Actor' } },
  pages: [
    {
      id: '01',
      purpose: 'fixture',
      expectation: 'next',
      panels: [
        { id: 'p1', rect: [16, 16, 900, 500], scene: 'fixture', dialogue: [] },
      ],
    },
  ],
};
fs.mkdirSync(w + '/assets/panels', { recursive: true });
fs.mkdirSync(w + '/output');
fs.writeFileSync(w + '/assets/panels/p1.png', bytes);
fs.writeFileSync(w + '/source.txt', 'source');
fs.writeFileSync(w + '/workflow.json', JSON.stringify(config));
fs.writeFileSync(w + '/output/page-01.png', bytes);
fs.writeFileSync(w + '/output/page-01.svg', '<svg/>');
fs.writeFileSync(
  w + '/output/page-01.png.render.json',
  JSON.stringify({ pngHash: sha(bytes), svgHash: sha(Buffer.from('<svg/>')) }),
);
const run = (...args) =>
  execFileSync(process.execPath, ['cli/assist.mjs', ...args], {
    cwd: temp.folder,
    env: { ...process.env, MANGA_PROJECT: 'works/fixture/workflow.json' },
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe',
  });
const original = fs.readFileSync(w + '/workflow.json');
for (const mode of ['index', 'intake', 'cards', 'spreads']) run(mode, mode);
assert.throws(
  () => run('delivery', 'unready'),
  /Page is not ready|AssertionError/,
);
assert.ok(!fs.existsSync(w + '/workflow/assistance/unready'));
assert.throws(() => run('cards', 'cards'));
assert.throws(() => run('cards', '../escape'));
run('external', 'edit', 'p1');
run('return', 'edit', 'works/fixture/assets/panels/p1.png');
assert.throws(() =>
  run('return', 'edit', 'works/fixture/assets/panels/p1.png'),
);
assert.deepEqual(fs.readFileSync(w + '/workflow.json'), original);
run('external', 'changed-config', 'p1');
fs.writeFileSync(
  w + '/workflow.json',
  JSON.stringify({ ...config, title: 'changed' }),
);
assert.throws(
  () => run('return', 'changed-config', 'works/fixture/assets/panels/p1.png'),
  /Work changed/,
);
fs.writeFileSync(w + '/workflow.json', original);
run('external', 'changed-copy', 'p1');
fs.appendFileSync(
  w + '/workflow/assistance/changed-copy/original.png',
  'changed',
);
assert.throws(
  () => run('return', 'changed-copy', 'works/fixture/assets/panels/p1.png'),
  /Ticket copy changed/,
);
run('external', 'changed-ticket', 'p1');
fs.appendFileSync(
  w + '/workflow/assistance/changed-ticket/edit-ticket.json',
  ' ',
);
assert.throws(
  () => run('return', 'changed-ticket', 'works/fixture/assets/panels/p1.png'),
  /Edit ticket changed/,
);
fs.mkdirSync(path.join(temp.folder, 'outside'));
fs.symlinkSync(
  path.join(temp.folder, 'outside'),
  w + '/workflow/assistance/link',
  'junction',
);
assert.throws(() => run('index', 'link'), /link outside|symbolic links/);
fs.unlinkSync(w + '/workflow/assistance/link');
const outsidePNG = createTemporary('test');
fs.writeFileSync(path.join(outsidePNG.folder, 'other.png'), bytes);
fs.symlinkSync(
  outsidePNG.folder,
  path.join(temp.folder, 'outside-png'),
  'junction',
);
run('external', 'linked-input', 'p1');
assert.throws(
  () => run('return', 'linked-input', 'outside-png/other.png'),
  /Input follows a link outside workspace/,
);
fs.unlinkSync(path.join(temp.folder, 'outside-png'));
outsidePNG.cleanup();
const plan = deliveryPlan([
  { id: '1', sha256: 'a'.repeat(64), bytes: 1 },
  { id: '2', sha256: 'b'.repeat(64), bytes: 1 },
]);
assert.equal(plan.x[1].replyToLocalId, 'page-1');
assert.equal(plan.x[1].actualPostId, null);
assert.equal(plan.readyToPublish, false);
assert.throws(() => deliveryPlan([plan.pages[0], plan.pages[0]]));
fs.writeFileSync(w + '/output/page-01.png.render.json', '{}');
assert.throws(() => run('delivery', 'stale'));
assert.ok(!fs.existsSync(w + '/workflow/assistance/stale'));
if (process.env.MANGA_PYTHON) {
  execFileSync(
    process.env.MANGA_PYTHON,
    [
      '-c',
      "from PIL import Image; Image.new('RGBA',(20,20),(255,0,0,255)).save('works/fixture/red.png'); im=Image.new('RGBA',(20,20),(0,0,0,0)); im.putpixel((10,10),(0,0,255,128)); im.save('works/fixture/alpha.png')",
    ],
    { cwd: temp.folder, windowsHide: true },
  );
  const spec = (name, value) => {
    const file = 'works/fixture/' + name + '.json';
    fs.writeFileSync(path.join(temp.folder, file), JSON.stringify(value));
    return file;
  };
  execFileSync(
    process.env.MANGA_PYTHON,
    [
      '-c',
      "from PIL import Image,ImageDraw; im=Image.new('RGBA',(20,20),'white'); ImageDraw.Draw(im).line((3,10,13,10),fill='black'); im.save('works/fixture/stray.png')",
    ],
    { cwd: temp.folder, windowsHide: true },
  );
  run(
    'edit',
    'white-edit',
    spec('white-edit', {
      source: 'works/fixture/stray.png',
      reason: 'Remove injected stray line in white space',
      operations: [{ kind: 'white', rect: [2, 8, 15, 5] }],
    }),
  );
  const whiteEdit = JSON.parse(
    fs.readFileSync(w + '/workflow/assistance/white-edit/result.json', 'utf8'),
  ).result;
  assert.equal(whiteEdit.changedPixels, 11);
  assert.equal(whiteEdit.outsideRequestedRegionsChangedPixels, 0);
  assert.equal(whiteEdit.sourceUnchanged, true);
  execFileSync(
    process.env.MANGA_PYTHON,
    [
      '-c',
      "from PIL import Image; assert Image.open('works/fixture/workflow/assistance/white-edit/edited.png').getextrema()==((255,255),)*4",
    ],
    { cwd: temp.folder, windowsHide: true },
  );
  for (const [name, operation] of [
    ['edge', { kind: 'white', rect: [3, 10, 11, 1] }],
    ['bounds', { kind: 'white', rect: [-1, 0, 2, 2] }],
    ['alpha-value', { kind: 'alpha', rect: [0, 0, 2, 2], value: 256 }],
  ])
    assert.throws(() =>
      run(
        'edit',
        'invalid-' + name,
        spec('invalid-' + name, {
          source: 'works/fixture/stray.png',
          reason: 'negative fixture',
          operations: [operation],
        }),
      ),
    );
  run(
    'edit',
    'alpha-edit',
    spec('alpha-edit', {
      source: 'works/fixture/alpha.png',
      reason: 'Restore colour and alpha inside one explicit mask region',
      operations: [
        {
          kind: 'alpha',
          rect: [9, 9, 3, 3],
          value: 255,
          restoreFrom: 'works/fixture/red.png',
        },
      ],
    }),
  );
  const alphaEdit = JSON.parse(
    fs.readFileSync(w + '/workflow/assistance/alpha-edit/result.json', 'utf8'),
  ).result;
  assert.equal(alphaEdit.changedPixels, 9);
  assert.equal(alphaEdit.outsideRequestedRegionsChangedPixels, 0);
  execFileSync(
    process.env.MANGA_PYTHON,
    [
      '-c',
      "from PIL import Image; im=Image.open('works/fixture/workflow/assistance/alpha-edit/edited.png'); assert im.getpixel((10,10))==(255,0,0,255); assert im.getpixel((0,0))==(0,0,0,0)",
    ],
    { cwd: temp.folder, windowsHide: true },
  );
  execFileSync(
    process.env.MANGA_PYTHON,
    [
      '-c',
      [
        'import runpy, sys, json, hashlib',
        'from pathlib import Path',
        'from unittest.mock import patch',
        'from PIL import Image',
        "spec=Path('works/fixture/snapshot.json')",
        "spec.write_text(json.dumps({'source':'works/fixture/red.png','size':[20,20],'method':'contain','reason':'snapshot regression'}),encoding='utf-8')",
        'captured=spec.read_bytes()',
        "source=Path('works/fixture/red.png'); source_bytes=source.read_bytes()",
        "config=Path('works/fixture/workflow.json'); config_bytes=config.read_bytes()",
        'original_read=Path.read_bytes; original_open=Image.open',
        'def read_once(p):',
        '    data=original_read(p)',
        "    if p.resolve()==spec.resolve(): p.write_text('{}',encoding='utf-8')",
        '    return data',
        'def decode_snapshot(file,*args,**kwargs):',
        "    Image.new('RGBA',(20,20),'blue').save(source)",
        '    return original_open(file,*args,**kwargs)',
        "sys.argv=['scripts/editor-exchange.py','fit','snapshot','works/fixture/snapshot.json']",
        "with patch.object(Path,'read_bytes',read_once), patch.object(Image,'open',decode_snapshot): runpy.run_path('scripts/editor-exchange.py',run_name='__main__')",
        "manifest=json.loads(Path('works/fixture/workflow/assistance/snapshot/result.json').read_text(encoding='utf-8'))",
        "assert manifest['inputs']['works/fixture/snapshot.json']==hashlib.sha256(captured).hexdigest()",
        "assert manifest['inputs']['works/fixture/red.png']==hashlib.sha256(source_bytes).hexdigest()",
        "assert original_open('works/fixture/workflow/assistance/snapshot/fitted.png').getpixel((0,0))==(255,0,0,255)",
        'source.write_bytes(source_bytes)',
        'spec.write_bytes(captured)',
        'def change_config(p):',
        '    data=original_read(p)',
        "    if p.resolve()==config.resolve(): p.write_bytes(config_bytes+b' ')",
        '    return data',
        "sys.argv=['scripts/editor-exchange.py','fit','changed-config-snapshot','works/fixture/snapshot.json']",
        'try:',
        "    with patch.object(Path,'read_bytes',change_config): runpy.run_path('scripts/editor-exchange.py',run_name='__main__')",
        "    raise RuntimeError('Changed configuration was accepted')",
        'except AssertionError as error:',
        "    assert 'Canonical configuration changed' in str(error)",
        'finally: config.write_bytes(config_bytes)',
      ].join('\n'),
    ],
    {
      cwd: temp.folder,
      env: { ...process.env, MANGA_PROJECT: 'works/fixture/workflow.json' },
      windowsHide: true,
    },
  );
  run(
    'mask',
    'mask',
    spec('mask', {
      source: 'works/fixture/red.png',
      candidate: 'works/fixture/alpha.png',
    }),
  );
  run('external', 'different-size', 'p1');
  assert.throws(
    () => run('return', 'different-size', 'works/fixture/red.png'),
    /dimensions changed/,
  );
  run('external', 'changed-source', 'p1');
  fs.appendFileSync(w + '/assets/panels/p1.png', 'changed');
  assert.throws(
    () => run('return', 'changed-source', 'works/fixture/red.png'),
    /Original changed/,
  );
  fs.writeFileSync(w + '/assets/panels/p1.png', bytes);
  const metrics = JSON.parse(
    fs.readFileSync(w + '/workflow/assistance/mask/result.json', 'utf8'),
  ).result;
  assert.equal(metrics.transparentPixels, 399);
  assert.equal(metrics.partialAlphaPixels, 1);
  assert.equal(metrics.usableMask, null);
  run(
    'fit',
    'fit',
    spec('fit', {
      source: 'works/fixture/red.png',
      size: [20, 30],
      method: 'contain',
      reason: 'fixture',
    }),
  );
  assert.throws(() =>
    run(
      'fit',
      'no-reason',
      spec('no-reason', {
        source: 'works/fixture/red.png',
        size: [20, 30],
        method: 'crop',
      }),
    ),
  );
  const hasPSD = (() => {
    try {
      execFileSync(process.env.MANGA_PYTHON, ['-c', 'import psd_tools'], {
        stdio: 'pipe',
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  })();
  if (hasPSD) {
    execFileSync(
      process.env.MANGA_PYTHON,
      [
        '-c',
        "from PIL import Image; Image.new('RGB',(1000,8000),'white').save('works/fixture/tall.png')",
      ],
      { cwd: temp.folder, windowsHide: true },
    );
    assert.throws(
      () =>
        run(
          'fit',
          'opposing-aspects',
          spec('opposing-aspects', {
            source: 'works/fixture/tall.png',
            size: [8000, 1000],
            method: 'crop',
            reason: 'budget regression',
          }),
        ),
      /budget|Invalid size/,
    );
    const psdAvailable =
      spawnSync(process.env.MANGA_PYTHON, ['-c', 'import psd_tools'], {
        windowsHide: true,
        stdio: 'pipe',
      }).status === 0;
    if (psdAvailable) {
      execFileSync(
        process.env.MANGA_PYTHON,
        [
          '-c',
          "from PIL import Image; Image.new('RGBA',(5000,5000),'white').save('works/fixture/budget-layer.png')",
        ],
        { cwd: temp.folder, windowsHide: true },
      );
      assert.throws(
        () =>
          run(
            'psd',
            'over-budget',
            spec('over-budget', {
              size: [5000, 5000],
              layers: Array.from({ length: 3 }, (_, i) => ({
                name: 'layer-' + i,
                file: 'works/fixture/budget-layer.png',
              })),
            }),
          ),
        /PSD layer pixel budget/,
      );

      run(
        'psd',
        'psd',
        spec('psd', {
          size: [20, 20],
          layers: [
            { name: 'Background', file: 'works/fixture/red.png' },
            { name: 'Foreground', file: 'works/fixture/alpha.png' },
          ],
        }),
      );
      run(
        'unpack',
        'unpack',
        spec('unpack', {
          source: 'works/fixture/workflow/assistance/psd/layers.psd',
        }),
      );
      const layers = JSON.parse(
        fs.readFileSync(w + '/workflow/assistance/unpack/result.json', 'utf8'),
      ).result.layers;
      execFileSync(
        process.env.MANGA_PYTHON,
        [
          '-c',
          "from psd_tools import PSDImage; p=PSDImage.open('works/fixture/workflow/assistance/psd/layers.psd'); p[1].fill_opacity=128; p.save('works/fixture/unsupported.psd')",
        ],
        { cwd: temp.folder, windowsHide: true },
      );
      assert.throws(
        () =>
          run(
            'unpack',
            'unsupported',
            spec('unsupported', { source: 'works/fixture/unsupported.psd' }),
          ),
        /fill opacity/,
      );
      assert.deepEqual(
        layers.map((x) => x.name),
        ['Background', 'Foreground'],
      );
      execFileSync(
        process.env.MANGA_PYTHON,
        [
          '-c',
          "from psd_tools import PSDImage; from PIL import Image; p=PSDImage.open('works/fixture/workflow/assistance/psd/layers.psd'); p[1].update_mask(Image.new('L',(20,20),128)); p.save('works/fixture/masked.psd')",
        ],
        { cwd: temp.folder, windowsHide: true },
      );
      run(
        'unpack',
        'masked',
        spec('masked', { source: 'works/fixture/masked.psd' }),
      );
      execFileSync(
        process.env.MANGA_PYTHON,
        [
          '-c',
          "from PIL import Image; im=Image.open('works/fixture/workflow/assistance/masked/layer-01.png').convert('RGBA'); assert im.getpixel((10,10))[3]==128",
        ],
        { cwd: temp.folder, windowsHide: true },
      );
      execFileSync(
        process.env.MANGA_PYTHON,
        [
          '-c',
          "from PIL import Image; a=Image.open('works/fixture/red.png').convert('RGBA'); b=Image.open('works/fixture/alpha.png').convert('RGBA'); expected=Image.alpha_composite(a,b); actual=Image.open('works/fixture/workflow/assistance/unpack/composite.png').convert('RGBA'); assert expected.tobytes()==actual.tobytes()",
        ],
        { cwd: temp.folder, windowsHide: true },
      );
    } else
      console.log(
        'SKIP: PSD subset (psd-tools unavailable); Pillow checks still run',
      );
  } else
    console.log(
      'SKIP: PSD tests (psd-tools unavailable); Pillow tests continue',
    );
  config.pages[0].panels = Array.from({ length: 4 }, (_, i) => ({
    id: 'p' + i,
    rect: [16, 16 + i * 340, 900, 320],
    dialogue: [],
    scene: 'fixture',
  }));
  fs.writeFileSync(w + '/workflow.json', JSON.stringify(config));
  const groups = config.pages[0].panels
    .map(
      (p, i) =>
        `<svg x="16" y="${p.rect[1]}" width="900" height="320"><image href="data:image/png;base64,${bytes.toString('base64')}" width="20" height="20"/></svg><rect x="16" y="${p.rect[1]}" width="900" height="320" fill="none" stroke="black" stroke-width="3"/><text x="40" y="${p.rect[1] + 50}" font-size="26">body-${i}</text>`,
    )
    .join('');
  fs.writeFileSync(
    w + '/output/page-01.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536">${groups}<text y="1500">1</text></svg>`,
  );
  for (const variant of ['equal', 'title', 'frameless', 'diagonal', 'edge']) {
    run(
      'layout',
      'layout-' + variant,
      spec('layout-' + variant, {
        page: '01',
        variant,
        title: 'Test title',
        sourceSnapshotOnly: true,
      }),
    );
    const svg = fs.readFileSync(
      w + '/workflow/assistance/layout-' + variant + '/page-01.svg',
      'utf8',
    );
    assert.equal((svg.match(/data:image\/png;base64,/g) || []).length, 4);
    for (let i = 0; i < 4; i++) assert.ok(svg.includes('body-' + i));
    assert.equal(svg.includes('Test title'), variant === 'title');
  }
  execFileSync(
    process.env.MANGA_PYTHON,
    [
      '-c',
      "import xml.etree.ElementTree as E; ns={'s':'http://www.w3.org/2000/svg'}; r=E.parse('works/fixture/workflow/assistance/layout-equal/page-01.svg').getroot(); frames=r.findall('s:rect',ns); assert len(frames)==4; assert [float(x.get('x')) for x in frames]==[24]*4; assert [float(x.get('y')) for x in frames]==[24,382,740,1098]; assert all(x.get('width')=='976' for x in frames); assert not any(g.findall('s:rect',ns) for g in r.findall('s:g',ns))",
    ],
    { cwd: temp.folder, windowsHide: true },
  );
  assert.throws(() =>
    run(
      'layout',
      'stale-layout',
      spec('stale-layout', { page: '01', variant: 'equal' }),
    ),
  );
  execFileSync(
    process.env.MANGA_PYTHON,
    [
      '-c',
      "import json,tarfile,io,hashlib; data=json.dumps({'title':'Frozen','author':'Author','pages':[{'id':'01'},{'id':'02'}]}).encode(); name='works/fixture/frozen.tar.gz'; t=tarfile.open(name,'w:gz'); info=tarfile.TarInfo('works/fixture/workflow.json'); info.size=len(data); t.addfile(info,io.BytesIO(data)); t.close(); sha=hashlib.sha256(open(name,'rb').read()).hexdigest(); open('works/fixture/automation.json','w').write(json.dumps({'status':'complete','deliverables':{name:sha}}))",
    ],
    { cwd: temp.folder, windowsHide: true },
  );
  run(
    'anthology',
    'anthology',
    spec('anthology', {
      completions: ['works/fixture/automation.json'],
      frontMatter: 3,
    }),
  );
  const anthology = JSON.parse(
    fs.readFileSync(w + '/workflow/assistance/anthology/result.json', 'utf8'),
  ).result;
  assert.equal(anthology.totalPlannedPages, 5);
  assert.equal(anthology.chapters[0].title, 'Frozen');
  assert.equal(anthology.chapters[0].author, 'Author');
  assert.equal(anthology.chapters[0].pageIds.length, 2);
} else
  console.log(
    'SKIP: optional Pillow/psd-tools exchange; set MANGA_PYTHON to validate',
  );
temp.cleanup();
console.log(
  'OK: optional drafts, known/tentative split, cards escaping, spreads, provenance, offline queue, stale/duplicate refusal and PNG roundtrip',
);
