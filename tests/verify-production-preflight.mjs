import assert from 'node:assert/strict';
import { inspectProduction } from '../src/production-preflight.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { whiteTextCard } from '../src/text-card.mjs';

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
for (const heldBy of [undefined, null, '', '  ', 0, {}, []]) {
  const invalid = structuredClone(config);
  // @ts-expect-error Negative fixtures intentionally violate heldBy's schema.
  invalid.pages[0].panels[0].production.props[0].heldBy = heldBy;
  const audit = inspectProduction(invalid);
  assert.equal(audit.warnings, 1);
  assert.match(audit.panels[0].issues.join(' '), /heldBy が未記録/);
}
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
const smallSpeaker = structuredClone(config);
smallSpeaker.pages[0].panels[0].speakers.hero.face[3] = 45;
smallSpeaker.pages[0].panels[0].dialogue = [
  { speaker: 'hero', text: 'はい', x: 20, dy: 20 },
];
assert.match(
  inspectProduction(smallSpeaker).panels[0].compositionIssues.join(' '),
  /12%未満/,
);
const narrationPanel = {
  ...panel,
  rect: [0, 0, 976, 400],
  speakers: {},
  production: { ...panel.production, hands: {}, props: [] },
  dialogue: [{ speaker: 'caption', text: '翌日', x: 30, dy: 30 }],
};
const narration = {
  cast: { caption: { kind: 'caption' } },
  pages: [{ id: '01', panels: [narrationPanel] }],
};
assert.equal(
  inspectProduction(narration).panels[0].composition.textOnlyCandidate,
  true,
);
assert.match(
  inspectProduction(narration).panels[0].compositionIssues.join(' '),
  /説明専用候補/,
);
assert.ok(inspectProduction(narration).pages[0].textOnlyAreaFraction > 0.15);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-composition-'));
try {
  fs.mkdirSync(path.join(temporary, 'assets/panels'), { recursive: true });
  fs.writeFileSync(
    path.join(temporary, 'assets/panels/01-1.png'),
    whiteTextCard(800, 400).png,
  );
  const narrow = structuredClone(config);
  narrow.assetDir = 'assets';
  narrow.pages[0].panels[0].rect = [0, 0, 800, 200];
  const before = JSON.stringify(narrow);
  const measured = inspectProduction(narrow, { root: temporary });
  assert.equal(
    JSON.stringify(narrow),
    before,
    'Audit must not alter composition',
  );
  assert.equal(measured.panels[0].composition.containBlankFraction, 0.5);
  assert.match(measured.panels[0].compositionIssues.join(' '), /縦横比/);
  assert.equal(
    inspectProduction(narrow).panels[0].composition.image,
    null,
    'Planning cannot invent native dimensions',
  );
  narrow.pages[0].panels[0].artworkCrop = [0, 100, 800, 200];
  assert.equal(
    inspectProduction(narrow, { root: temporary }).panels[0].composition
      .containBlankFraction,
    0,
  );
  narrow.pages[0].panels[0].artworkCrop = [0, 300, 800, 200];
  assert.match(
    inspectProduction(narrow, {
      root: temporary,
    }).panels[0].compositionIssues.join(' '),
    /素材寸法\/切り出し/,
  );
  fs.writeFileSync(
    path.join(temporary, 'assets/panels/01-1.png'),
    'invalid PNG',
  );
  assert.match(
    inspectProduction(narrow, {
      root: temporary,
    }).panels[0].compositionIssues.join(' '),
    /Truncated PNG/,
  );
} finally {
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('manga-composition-'));
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('Production preflight passed');
