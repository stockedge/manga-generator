import { defaultQuality } from '../src/quality.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { checkpoint } from '../src/state-history.mjs';
import { root } from '../src/workspace.mjs';
const [slug, title, ...rest] = process.argv.slice(2);
assert.match(slug || '', /^[a-z][a-z0-9-]{0,63}$/, 'Use a lowercase work ID');
assert.ok(
  title && !title.startsWith('--'),
  'Usage: node cli/new-work.mjs WORK-ID TITLE [SOURCE-TEXT-FILE] [--renderer NAME]',
);
const source = rest[0] && !rest[0].startsWith('--') ? rest[0] : undefined;
const flagArgs = rest.slice(source ? 1 : 0);
let renderer = null;
for (let i = 0; i < flagArgs.length; i++) {
  assert.equal(flagArgs[i], '--renderer', 'Unknown option: ' + flagArgs[i]);
  assert.ok(
    flagArgs[i + 1] !== undefined && !flagArgs[i + 1].startsWith('--'),
    'Missing value: --renderer',
  );
  renderer = flagArgs[++i];
}
const base = 'works/' + slug;
assert.ok(
  !fs.existsSync(path.join(root, base)),
  'Work already exists; refusing to overwrite',
);
const original = source
  ? fs.readFileSync(path.resolve(source), 'utf8')
  : 'ここに原作本文を保存してください。';
const config = {
  version: 7,
  quality: structuredClone(defaultQuality),
  ...(renderer ? { generation: { renderer } } : {}),
  renderMode: 'panels',
  productionPreflight: { required: true },
  narrativeDesign: {
    version: 1,
    direction: 'right-to-left, top-to-bottom',
    rules: [
      'one beat per panel',
      'speech groups and faces are planned together',
      'scene and time boundaries receive a visual or caption anchor',
      'page-end question and next-page answer are reviewed, not forced',
    ],
  },
  sections: {
    opening: {
      summary: '場面の状況を原作から確定する',
      location: '舞台を確定する',
      costumes: { a: '衣装を確定する', b: '衣装を確定する' },
      objects: {},
    },
  },
  assetSources: {},
  title,
  author: '',
  sourceFile: base + '/source/original.txt',
  style:
    'Monochrome hand-inked manga, varied line weight, restrained expression, sparse backgrounds, no photorealism or surface microtexture.',
  cast: {
    a: { name: '人物A', description: '原作に合わせて外見と衣服を確定する' },
    b: { name: '人物B', description: '人物Aと区別できるシルエットにする' },
    narration: { kind: 'caption', name: '地の文' },
  },
  references: [base + '/assets/characters.png'],
  assetDir: base + '/assets',
  workflowDir: base + '/workflow',
  outputDir: base + '/output',
  pages: [
    {
      id: '01',
      section: 'opening',
      purpose: '原作から漫画脚本を作成し、この雛形を置き換える',
      expectation: '誰が何を望み、何が起こるか',
      panels: [
        {
          id: '01-1',
          order: 1,
          role: '提示',
          beat: '状況',
          rect: [24, 24, 976, 650],
          scene: '原作に合わせて場面を指定する',
          production: {
            moment: '原作の一瞬を確定',
            before: '直前の状態を確定',
            after: '直後の状態を確定',
            hands: { a: { left: '左手を確定', right: '右手を確定' } },
            props: [],
          },
          speakers: { a: { anchor: [350, 360], face: [290, 260, 120, 160] } },
          dialogue: [
            { speaker: 'a', text: 'セリフを確定する。', side: 'right' },
          ],
        },
        {
          id: '01-2',
          order: 2,
          role: '反応',
          beat: '反応',
          rect: [24, 698, 976, 650],
          scene: '相手の反応を描く',
          production: {
            moment: '返答の瞬間を確定',
            before: '直前の状態を確定',
            after: '直後の状態を確定',
            hands: { b: { left: '左手を確定', right: '右手を確定' } },
            props: [],
          },
          speakers: { b: { anchor: [350, 1034], face: [290, 934, 120, 160] } },
          dialogue: [
            { speaker: 'b', text: '相手の返答を確定する。', side: 'right' },
          ],
        },
      ],
    },
  ],
};
config.version = 8;
Object.assign(config, {
  promptPolicy: { version: 2 },
  productionReview: {
    readingProtocol: 'two-phase-v1',
    required: true,
    reviewer: 'subagent',
    stages: ['source', 'script', 'storyboard', 'artwork', 'lettering', 'final'],
  },
  referenceRoles: {
    [base + '/assets/characters.png']:
      'Canonical face geometry and drawing method; define three distinguishing face traits for each actor.',
  },
});
for (const actor of Object.values(config.cast))
  if (actor.kind !== 'caption')
    actor.faceDesign = {
      traits: [
        '目の形とまぶたを原作・漫画設定から確定する',
        '眉の太さ・長さ・目との距離を確定する',
        '頬・顎・鼻など識別できる輪郭を確定する',
      ],
      reference: base + '/assets/characters.png',
      settingBasis: '原作の指定と漫画用に補った顔設定を区別して記入する',
    };
for (const dir of ['source', 'assets', 'workflow', 'output'])
  fs.mkdirSync(path.join(root, base, dir), { recursive: true });
fs.writeFileSync(path.join(root, config.sourceFile), original);
fs.writeFileSync(
  path.join(root, base, 'workflow.json'),
  JSON.stringify(config, null, 2),
);
checkpoint(root, path.join(root, base), 'created work');
console.log(
  `Created ${base}/workflow.json; edit the script and cast, then set MANGA_PROJECT to this path.`,
);
