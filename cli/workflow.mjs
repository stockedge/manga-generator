import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

import { loadProject } from '../src/project.mjs';
const { root, config, configFile, local } = loadProject();
import { qualityGate } from '../src/quality.mjs';
import { validateFaceDesign } from '../src/face-design.mjs';
import {
  readingFlow,
  flowOverlay,
  narrativePlan,
} from '../src/reading-flow.mjs';
import { requireReview } from '../src/stage-reviews.mjs';
import { requireDesignSeal } from '../src/review-progress.mjs';
import { renderStoryboardSketch } from '../src/storyboard-sketch.mjs';

import {
  columns,
  box,
  xml,
  overlap,
  segmentEntry,
  createLettering,
} from '../src/lettering.mjs';
import { resolveStoryState } from '../src/story-state.mjs';
import { createGenerationJobs } from '../src/generation-jobs.mjs';
import { imageFile, createAssets } from '../src/assets.mjs';
import { findDialogueLayout } from '../src/dialogue-layout.mjs';
validateFaceDesign(config, local);

const cast = config.cast;
assert.ok(cast && Object.keys(cast).length, 'Define the work cast');
for (const id of Object.keys(cast))
  assert.match(id, /^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Invalid cast ID');
const caption = (id) => cast[id]?.kind === 'caption';
for (const p of [
  config.workflowDir || 'workflow',
  config.assetDir || 'assets/v2',
  config.outputDir || 'output-v2',
  ...(config.references || []),
])
  local(p);
const workflowDir = config.workflowDir || 'workflow';
const assetDir = config.assetDir || 'assets/v2';
const dir = path.join(root, workflowDir);
const output = path.join(root, config.outputDir || 'output-v2');
const panelsOnly = config.renderMode === 'panels';
assert.ok(
  config.renderMode === undefined ||
    ['page', 'panels'].includes(config.renderMode),
  'Unknown renderMode',
);

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

const { tailGeometry, balloon, balloonMask } = createLettering(cast);
const stateFor = (page, p) => resolveStoryState(config, page, p, local);
const { prompt, job, panelJob, layoutReference } = createGenerationJobs({
  config,
  local,
  stateFor,
  svg,
});
const { archive, saveAsset } = createAssets({ config, local, assetDir });
function validate(data = config) {
  assert.ok(Array.isArray(data.pages) && data.pages.length, 'No pages');
  const panelIds = new Set();
  const ids = new Set();
  for (const page of data.pages) {
    if (data.version >= 3) {
      assert.ok(page.expectation?.length, 'Missing reader expectation');
      page.panels.forEach((p) =>
        assert.ok(
          [
            '提示',
            '始動',
            '反応',
            '期待',
            '転換',
            '決定',
            '余韻',
            '笑い',
          ].includes(p.role),
          'Missing narrative role',
        ),
      );
    }
    if (
      page.showcase !== undefined &&
      page.showcase !== null &&
      page.showcase !== ''
    )
      assert.ok(
        page.panels.some((p) => p.id === page.showcase),
        'Unknown showcase panel: ' + page.id,
      );
    assert.match(page.id, /^\d{2}$/);
    assert.ok(!ids.has(page.id));
    ids.add(page.id);
    assert.ok(page.panels.length >= 2 && page.panels.length <= 6);
    page.panels.forEach((p, i) => {
      stateFor(page, p);
      assert.match(p.id, /^[a-zA-Z0-9_-]+$/);
      assert.ok(!panelIds.has(p.id), 'Duplicate panel ID');
      panelIds.add(p.id);
      const [x, y, w, h] = p.rect;
      if (p.storyboardSketch !== undefined)
        renderStoryboardSketch(p.storyboardSketch, p.rect, 'validate-sketch', {
          rough: true,
        });
      for (const [id, a] of Object.entries(p.speakers || {})) {
        assert.ok(Object.hasOwn(cast, id), 'Unknown actor');
        if (a.kind !== 'offscreen') {
          assert.ok(
            a.anchor?.length === 2 && a.anchor.every(Number.isFinite),
            'Invalid anchor',
          );
          assert.ok(
            a.anchor[0] >= x &&
              a.anchor[0] <= x + w &&
              a.anchor[1] >= y &&
              a.anchor[1] <= y + h,
            'Speaker anchor outside panel',
          );
          assert.ok(
            a.kind === 'head' ||
              (a.face?.length === 4 &&
                a.face.every(Number.isFinite) &&
                a.face[2] > 0 &&
                a.face[3] > 0),
            'Visible speaker needs face bounds',
          );
          if (a.face)
            assert.ok(
              a.face[0] >= x &&
                a.face[1] >= y &&
                a.face[0] + a.face[2] <= x + w &&
                a.face[1] + a.face[3] <= y + h,
              'Face outside panel',
            );
        }
      }
      assert.ok(
        [x, y, w, h].every(Number.isFinite) &&
          x >= 16 &&
          y >= 16 &&
          w > 0 &&
          h > 0 &&
          x + w <= 1008 &&
          y + h <= 1464,
        'Panel outside safe area',
      );
      assert.equal(p.order, i + 1);
      for (const q of page.panels.slice(0, i))
        assert.ok(!overlap(p.rect, q.rect), 'Panels overlap');
      if (i) {
        const prev = page.panels[i - 1].rect;
        assert.ok(
          y > prev[1] || (y === prev[1] && x < prev[0]),
          'Reading order must be top to bottom, right to left',
        );
      }
      for (const r of p.protected || [])
        assert.ok(
          r.length === 4 &&
            r.every(Number.isFinite) &&
            r[2] > 0 &&
            r[3] > 0 &&
            r[0] >= x &&
            r[1] >= y &&
            r[0] + r[2] <= x + w &&
            r[1] + r[3] <= y + h,
          'Invalid protected area: ' + p.id,
        );
      const bounds = p.dialogue.map((d) => {
        if (d.tailLength !== undefined)
          assert.ok(
            Number.isInteger(d.tailLength) &&
              d.tailLength >= 24 &&
              d.tailLength <= 160,
            'tailLength must be an integer from 24 to 160',
          );
        assert.ok(
          Object.hasOwn(cast, d.speaker),
          'Unknown speaker: ' + d.speaker,
        );
        assert.ok(d.text.length && ['right', 'left'].includes(d.side));
        if (caption(d.speaker))
          assert.ok(
            !/^(?:お読みいただき|ご(?:愛読|読了))ありがとうございます[。！!]*$/.test(
              d.text.replace(/[\s、,]/g, ''),
            ),
            'Reader acknowledgement belongs in source records, not manga dialogue: ' +
              p.id,
          );
        assert.ok(
          Number.isInteger(d.capacity ?? 10) &&
            (d.capacity ?? 10) >= 4 &&
            (d.capacity ?? 10) <= 14,
        );
        const b = box(p, d);
        assert.ok(
          b[0] >= x &&
            b[1] >= y &&
            b[0] + b[2] <= x + w &&
            b[1] + b[3] <= y + h,
          `Balloon outside panel ${p.id}: ${JSON.stringify(b)} within ${JSON.stringify(p.rect)}`,
        );
        if (data.version >= 4) {
          assert.ok(
            caption(d.speaker) || p.speakers?.[d.speaker],
            'Missing speaker anchor',
          );
          for (const s of Object.values(p.speakers || {})) {
            if (s.face)
              assert.ok(!overlap(b, s.face), 'Balloon covers face: ' + p.id);
            if (s.anchor)
              assert.ok(
                s.anchor[0] >= x &&
                  s.anchor[0] <= x + w &&
                  s.anchor[1] >= y &&
                  s.anchor[1] <= y + h,
                'Speaker anchor outside panel',
              );
          }
          const t = tailGeometry(p, d);
          if (t)
            for (const s of Object.values(p.speakers || {}))
              if (s.face)
                assert.equal(
                  segmentEntry(t.base, t.tip, s.face),
                  null,
                  'Tail crosses face: ' + p.id,
                );
        }
        for (const r of p.protected || []) {
          assert.ok(
            r.length === 4 && r.every(Number.isFinite) && r[2] > 0 && r[3] > 0,
            'Invalid protected area',
          );
          assert.ok(!overlap(b, r), 'Balloon covers protected area: ' + p.id);
        }
        return b;
      });
      if (data.version >= 5)
        bounds.forEach((b, j) => {
          if (j) {
            const a = bounds[j - 1];
            assert.ok(
              b[1] >= a[1] && (b[0] <= a[0] || b[1] >= a[1] + 80),
              'Ambiguous dialogue reading order: ' + p.id,
            );
          }
          const t = tailGeometry(p, p.dialogue[j]);
          if (t) {
            for (const [k, r] of bounds.entries())
              if (k !== j)
                assert.equal(
                  segmentEntry(t.base, t.tip, r),
                  null,
                  'Tail crosses another balloon: ' + p.id,
                );
            for (const r of p.protected || [])
              assert.equal(
                segmentEntry(t.base, t.tip, r),
                null,
                'Tail crosses protected area: ' + p.id,
              );
          }
        });
      bounds.forEach((b, j) =>
        bounds
          .slice(0, j)
          .forEach((c) =>
            assert.ok(!overlap(b, c), 'Balloons overlap: ' + p.id),
          ),
      );
    });
  }
}

function svg(page, art, rough = false, layer = 'all', guides = true) {
  const provenance = art
    ? JSON.parse(
        fs.readFileSync(
          path.join(root, assetDir, `page-${page.id}.json`),
          'utf8',
        ),
      )
    : null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">${layer === 'all' ? '<rect width="1024" height="1536" fill="white"/>' : ''}${art && layer !== 'lettering' ? `<defs><image id="page-source" href="data:image/png;base64,${art}" width="1024" height="1536" preserveAspectRatio="none"/></defs>` : ''}${page.panels
    .map((p, i) => {
      const [x, y, w, h] = p.rect;
      const [sx, sy, sw, sh] = provenance?.sourceRects?.[i] ?? p.rect;
      // ponytail: contain keeps anatomy undistorted; draw a new panel when the aspect mismatch wastes too much space.
      const picture = art
        ? `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${sx} ${sy} ${sw} ${sh}" preserveAspectRatio="xMidYMid meet"><defs><clipPath id="p${i}"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}"/></clipPath></defs><use href="#page-source" clip-path="url(#p${i})"/></svg>`
        : Object.entries(p.speakers || {})
            .map(([id, s]) =>
              s.kind === 'offscreen'
                ? ''
                : `${s.face ? `<rect x="${s.face[0]}" y="${s.face[1]}" width="${s.face[2]}" height="${s.face[3]}" fill="${rough && !art && p.storyboardSketch ? 'none' : '#f5f5f5'}" stroke="#bbb"/>` : ''}<circle cx="${s.anchor[0]}" cy="${s.anchor[1]}" r="5" fill="#999"/><text x="${s.anchor[0] + 10}" y="${s.anchor[1]}" font-size="18">${xml(id)}</text>`,
            )
            .join('');
      const override = path.join(root, assetDir, 'panels', `${p.id}.png`);
      const record = path.join(root, assetDir, 'panels', `${p.id}.json`);
      let material = picture;
      if ((art || (panelsOnly && !rough)) && fs.existsSync(override)) {
        assert.ok(fs.existsSync(record), 'Panel override has no review record');
        const r = JSON.parse(fs.readFileSync(record, 'utf8'));
        assert.equal(
          r.fingerprint,
          panelJob(page, p).fingerprint,
          'Stale panel override',
        );
        assert.equal(
          r.imageHash,
          hash(fs.readFileSync(override)),
          'Panel image modified after review',
        );
        material = `<image href="data:image/png;base64,${fs.readFileSync(override).toString('base64')}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
      }
      if (rough && !art && p.storyboardSketch)
        material =
          renderStoryboardSketch(
            p.storyboardSketch,
            p.rect,
            'rough-sketch-' + i,
            { rough: true },
          ) + material;
      if (panelsOnly && !rough)
        assert.ok(fs.existsSync(override), 'Missing panel artwork: ' + p.id);
      const lettering =
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="black" stroke-width="3"/>` +
        (layer === 'artwork'
          ? ''
          : p.dialogue.map((d) => balloonMask(p, d)).join('')) +
        p.dialogue.map((d) => balloon(p, d)).join('');
      return (
        (layer === 'lettering' ? '' : material) +
        (layer === 'artwork' ? '' : lettering) +
        (rough && guides
          ? `<text x="${x + 12}" y="${y + h - 14}" font-size="18" fill="#666">${p.order} / ${xml(p.beat)}</text>`
          : '')
      );
    })
    .join(
      '',
    )}${layer === 'artwork' ? '' : `<text x="512" y="1500" text-anchor="middle" font-family="sans-serif" font-size="20">${Number(page.id)}</text>`}</svg>`;
}

function materialJobs(page) {
  return [
    ...(panelsOnly ? [] : [job(page)]),
    ...page.panels
      .filter(
        (p) =>
          panelsOnly ||
          fs.existsSync(path.join(root, assetDir, 'panels', p.id + '.png')),
      )
      .map((p) => panelJob(page, p)),
  ];
}
function assetStatus(j) {
  if (!fs.existsSync(local(j.asset)) || !fs.existsSync(local(j.record)))
    return 'pending';
  const r = JSON.parse(fs.readFileSync(local(j.record), 'utf8'));
  if (
    j.references
      .filter((f) => !layoutReference(f))
      .some((f) => !fs.existsSync(local(f)))
  )
    return 'pending';
  return r.reviewed &&
    r.fingerprint === j.fingerprint &&
    r.imageHash === hash(fs.readFileSync(local(j.asset)))
    ? 'ready'
    : 'stale';
}
function materialStatus(page) {
  const statuses = materialJobs(page).map(assetStatus);
  return statuses.includes('pending')
    ? 'pending'
    : statuses.includes('stale')
      ? 'stale'
      : 'ready';
}
function reviewFingerprint(page) {
  if (!panelsOnly)
    return hash(
      JSON.stringify(page) +
        hash(fs.readFileSync(local(job(page).asset))) +
        hash(fs.readFileSync(local(job(page).record))) +
        page.panels
          .map((p) => {
            const f = path.join(root, assetDir, 'panels', p.id + '.png');
            return fs.existsSync(f) ? hash(fs.readFileSync(f)) : '';
          })
          .join(''),
    );
  return hash(
    JSON.stringify(page) +
      materialJobs(page)
        .map(
          (j) =>
            hash(fs.readFileSync(local(j.asset))) +
            hash(fs.readFileSync(local(j.record))),
        )
        .join(''),
  );
}
function status(page) {
  const materials = materialStatus(page);
  if (materials !== 'ready') return materials;
  const reviewFile = path.join(root, assetDir, `page-${page.id}.review.json`);
  const aligned =
    config.version < 5 ||
    (fs.existsSync(reviewFile) &&
      JSON.parse(fs.readFileSync(reviewFile, 'utf8')).fingerprint ===
        reviewFingerprint(page));
  return aligned && quality.ready(page) ? 'ready' : 'stale';
}

const artFor = (page) =>
  panelsOnly
    ? null
    : fs.readFileSync(local(job(page).asset)).toString('base64');
const quality = qualityGate({
  config,
  local,
  assetDir,
  dir,
  material: materialStatus,
  job: panelJob,
  compose: (page, folder) => {
    let result = svg(page, artFor(page));
    for (const j of materialJobs(page))
      result = result.replaceAll(
        'data:image/png;base64,' +
          fs.readFileSync(local(j.asset)).toString('base64'),
        xml(path.relative(folder, local(j.asset)).replaceAll('\\', '/')),
      );
    return result;
  },
});
const option = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  assert.ok(
    process.argv[i + 1] && !process.argv[i + 1].startsWith('--'),
    'Missing --' + name + ' value',
  );
  return process.argv[i + 1];
};

const command = process.argv[2] || 'plan';
if (command !== 'layout') validate();
if (command === 'layout') {
  const selectedPages =
    process.argv[3] === 'all'
      ? config.pages
      : config.pages.filter((p) => p.id === process.argv[3]);
  assert.ok(selectedPages.length, 'Unknown page');
  const changes = [];
  for (const page of selectedPages)
    for (const p of page.panels) {
      p.dialogue = findDialogueLayout(page, p, cast);

      changes.push({
        panel: p.id,
        dialogue: p.dialogue.map((d) => ({
          x: d.x,
          dy: d.dy,
          capacity: d.capacity,
        })),
      });
    }
  validate();
  if (process.argv.includes('--apply'))
    fs.writeFileSync(local(configFile), JSON.stringify(config, null, 2));
  console.log(
    JSON.stringify(
      { applied: process.argv.includes('--apply'), changes },
      null,
      2,
    ),
  );
} else if (command === 'check') {
  assert.equal(xml('<&'), '&lt;&amp;');
  assert.deepEqual(columns('あいうえお。', 5), ['あいうえお。']);
  assert.deepEqual(columns('あいうえおか', 5), ['あいうえお', 'か']);
  console.log(
    `OK: ${config.pages.length} pages, ${config.pages.reduce((n, p) => n + p.panels.length, 0)} panels; geometry, speakers and typography`,
  );
} else if (command === 'plan') {
  fs.mkdirSync(path.join(dir, 'reading-flow'), { recursive: true });
  const flow = config.pages.map((page) => readingFlow(page, box));
  fs.writeFileSync(
    path.join(dir, 'narrative-plan.json'),
    JSON.stringify(narrativePlan(config), null, 2),
  );
  fs.writeFileSync(
    path.join(dir, 'reading-flow', 'plan.json'),
    JSON.stringify(flow, null, 2),
  );
  for (const page of config.pages) {
    const currentFlow = flow.find((item) => item.page === page.id);
    fs.writeFileSync(
      path.join(dir, 'reading-flow', `page-${page.id}.svg`),
      flowOverlay(svg(page, null, true), currentFlow),
    );
    fs.writeFileSync(
      path.join(dir, 'reading-flow', `page-${page.id}.json`),
      JSON.stringify(currentFlow, null, 2),
    );
  }
  fs.writeFileSync(
    path.join(dir, 'reading-flow', 'index.html'),
    `<!doctype html><html lang="ja"><meta charset="utf-8"><title>セリフの視線誘導計画</title><style>body{font-family:Meiryo;background:#ddd}img{display:block;width:min(90vw,800px);margin:20px auto}</style><p>青線・番号はセリフの順番、橙線は脚本に記録した視線の計画。自動診断は目視確認の代わりではありません。</p>${config.pages.map((page) => `<img src="page-${page.id}.svg" alt="${page.id}">`).join('')}</html>`,
  );
  fs.mkdirSync(path.join(dir, 'storyboards'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'storyboards-unnumbered'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'panels'), { recursive: true });
  for (const page of config.pages)
    fs.writeFileSync(
      path.join(dir, 'storyboards-unnumbered', `page-${page.id}.svg`),
      svg(page, null, true, 'all', false),
    );
  fs.writeFileSync(
    path.join(dir, 'storyboards-unnumbered', 'index.html'),
    `<!doctype html><html lang="ja"><meta charset="utf-8"><title>読順確認用ネーム</title><style>body{background:#ddd}img{display:block;width:min(90vw,800px);margin:20px auto}</style>${config.pages.map((p) => `<img src="page-${p.id}.svg" alt="ページ ${xml(p.id)}">`).join('')}</html>`,
  );
  for (const page of config.pages) {
    fs.writeFileSync(
      path.join(dir, 'storyboards', `page-${page.id}.svg`),
      svg(page, null, true),
    );
    fs.writeFileSync(
      path.join(dir, 'prompts', `page-${page.id}.txt`),
      prompt(page),
    );
    fs.writeFileSync(
      path.join(dir, 'prompts', `page-${page.id}-baked.txt`),
      prompt(page, true),
    );
  }
  for (const page of config.pages)
    for (const p of page.panels) {
      const [x, y, w, h] = p.rect;
      fs.writeFileSync(
        path.join(dir, 'panels', `page-${p.id}.svg`),
        svg({ ...page, panels: [p] }, null, true).replace(
          'width="1024" height="1536" viewBox="0 0 1024 1536"',
          `width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"`,
        ),
      );
    }
  fs.writeFileSync(
    path.join(dir, 'jobs.json'),
    JSON.stringify(config.pages.map(job), null, 2),
  );
  fs.writeFileSync(
    path.join(dir, 'panel-jobs.json'),
    JSON.stringify(
      config.pages.flatMap((page) => page.panels.map((p) => panelJob(page, p))),
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, 'story-memory.json'),
    JSON.stringify(
      {
        cast,
        sections: config.sections || {},
        panels: config.pages.flatMap((page) =>
          page.panels.map((p) => ({
            id: p.id,
            section: p.section ?? page.section ?? null,
            state: stateFor(page, p),
          })),
        ),
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, 'storyboards', 'index.html'),
    `<html lang="ja"><meta charset="utf-8"><title>ネーム</title><style>body{background:#ddd}img{display:block;width:min(90vw,800px);margin:20px auto}</style>${config.pages.map((p) => `<img src="page-${p.id}.svg" alt="${xml(p.purpose)}">`).join('')}</html>`,
  );
  console.log(
    'Saved storyboards, exact dialogue, both prompt modes, render jobs',
  );
} else if (command === 'candidate-panel') {
  const page = config.pages.find((page) =>
    page.panels.some((p) => p.id === process.argv[3]),
  );
  assert.ok(page, 'Unknown panel');
  const p = page.panels.find((p) => p.id === process.argv[3]),
    j = panelJob(page, p),
    file = path.resolve(process.argv[4]),
    image = imageFile(file);
  const base = `${assetDir}/candidates/${p.id}/${hash(image)}-${j.fingerprint.slice(0, 12)}`;
  fs.mkdirSync(path.dirname(local(base)), { recursive: true });
  if (!fs.existsSync(local(base + '.png'))) {
    fs.writeFileSync(local(base + '.png'), image);
    fs.writeFileSync(
      local(base + '.json'),
      JSON.stringify(
        {
          id: p.id,
          fingerprint: j.fingerprint,
          imageHash: hash(image),
          note: option('note', ''),
          renderer: option('renderer', 'unspecified'),
          model: option('model', null),
          references: j.references,
          prompt: j.prompt,
          sourceFile: file,
          registeredAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }
  const folder = path.dirname(local(base));
  const entries = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      file: f,
      record: JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')),
    }));
  fs.writeFileSync(
    path.join(folder, 'index.html'),
    `<!doctype html><html lang="ja"><meta charset="utf-8"><title>${xml(p.id)} 候補</title><style>body{font-family:Meiryo,sans-serif}article{display:inline-block;width:45%;margin:2%}img{max-width:100%}</style>${entries.map(({ file, record: r }) => `<article><img src="${xml(file.replace(/\.json$/, '.png'))}" alt="${xml(r.note)}"><p>${xml(r.note)} / ${r.fingerprint === j.fingerprint ? '現在の計画' : '古い計画'}</p><code>${xml(file.replace(/\.json$/, '.png'))}</code></article>`).join('')}</html>`,
  );
  console.log('Registered candidate: ' + base + '.png');
} else if (command === 'accept-panel') {
  const page = config.pages.find((page) =>
    page.panels.some((p) => p.id === process.argv[3]),
  );
  assert.ok(page, 'Unknown panel');
  const p = page.panels.find((p) => p.id === process.argv[3]);
  const j = panelJob(page, p);
  const file = path.resolve(process.argv[4]);
  imageFile(file);
  assert.ok(
    process.argv.includes('--reviewed'),
    'Inspect panel before --reviewed',
  );
  saveAsset(
    j,
    file,
    {
      fingerprint: j.fingerprint,
      imageHash: hash(fs.readFileSync(file)),
      reviewed: true,
    },
    {
      renderer: option('renderer', undefined),
      model: option('model', undefined),
      reason: option('reason', undefined),
    },
  );
  console.log(`Accepted panel ${p.id}`);
} else if (command === 'accept') {
  assert.ok(
    !panelsOnly,
    'This work uses panel assets; use accept-panel for each panel',
  );
  const page = config.pages.find((p) => p.id === process.argv[3]);
  assert.ok(page, 'Unknown page');
  const file = path.resolve(process.argv[4]);
  assert.ok(fs.existsSync(file), 'Generated file missing');
  imageFile(file, true);
  assert.ok(
    process.argv.includes('--reviewed'),
    'Inspect image before using --reviewed',
  );
  const sourceArg = process.argv.indexOf('--source-rects');
  const sourceRects =
    sourceArg < 0
      ? page.panels.map((p) => p.rect)
      : JSON.parse(process.argv[sourceArg + 1]);
  assert.equal(
    sourceRects.length,
    page.panels.length,
    'Source panel count does not match plan',
  );
  sourceRects.forEach((b) => {
    assert.ok(b.length === 4 && b.every(Number.isFinite));
    const [x, y, w, h] = b;
    assert.ok(
      x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1024 && y + h <= 1536,
      'Source rectangle out of bounds',
    );
  });
  const j = job(page);
  saveAsset(
    j,
    file,
    {
      fingerprint: j.fingerprint,
      imageHash: hash(fs.readFileSync(file)),
      sourceRects,
      reviewed: true,
    },
    {
      renderer: option('renderer', undefined),
      model: option('model', undefined),
      reason: option('reason', undefined),
    },
  );
  console.log(`Accepted ${page.id}`);
} else if (command === 'use-page') {
  assert.ok(!panelsOnly, 'use-page requires page render mode');
  const page = config.pages.find((page) =>
    page.panels.some((p) => p.id === process.argv[3]),
  );
  assert.ok(page, 'Unknown panel');
  const p = page.panels.find((p) => p.id === process.argv[3]),
    j = panelJob(page, p);
  assert.ok(
    process.argv.includes('--reviewed'),
    'Inspect replacement page before removing override',
  );
  assert.equal(
    assetStatus(job(page)),
    'ready',
    'Accept replacement page first',
  );
  assert.ok(
    fs.existsSync(local(j.asset)) && fs.existsSync(local(j.record)),
    'No override to archive',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(local(j.record), 'utf8')).imageHash,
    hash(fs.readFileSync(local(j.asset))),
    'Override changed before archiving',
  );
  const reason = option('reason', '');
  assert.ok(reason.trim(), 'Record replacement reason');
  archive(j);
  fs.unlinkSync(local(j.asset));
  fs.unlinkSync(local(j.record));
  fs.appendFileSync(
    local(assetDir + '/history.jsonl'),
    JSON.stringify({
      event: 'use-page',
      target: p.id,
      reason,
      time: new Date().toISOString(),
    }) + '\n',
  );
  console.log('Archived override; using reviewed page artwork: ' + p.id);
} else if (command === 'review') {
  const page = config.pages.find((p) => p.id === process.argv[3]);
  assert.ok(page, 'Unknown page');
  for (const flag of ['--speakers', '--faces', '--order', '--continuity'])
    assert.ok(
      process.argv.includes(flag),
      'Inspect actual composed page and confirm ' + flag,
    );
  assert.equal(
    materialStatus(page),
    'ready',
    'Changed or missing artwork: accept current materials before review',
  );
  fs.writeFileSync(
    path.join(root, assetDir, `page-${page.id}.review.json`),
    JSON.stringify(
      {
        fingerprint: reviewFingerprint(page),
        checks: ['speakers', 'faces', 'order', 'continuity'],
        reviewedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log('Alignment review saved: ' + page.id);
} else if (command === 'preview') {
  const pages = process.argv[3]
    ? config.pages.filter((p) => p.id === process.argv[3])
    : config.pages;
  assert.ok(pages.length, 'Unknown preview page');
  for (const p of pages)
    assert.equal(
      materialStatus(p),
      'ready',
      'Changed or missing preview material: ' + p.id,
    );
  const preview = path.join(dir, 'review');
  fs.mkdirSync(preview, { recursive: true });
  for (const p of pages)
    fs.writeFileSync(path.join(preview, `page-${p.id}.svg`), svg(p, artFor(p)));
  console.log('Review composed SVGs in ' + preview);
} else if (command === 'quality-plan') {
  quality.plan();
  console.log(
    'Inspect thumbnail/native/detail views in ' + dir + '/quality/index.html',
  );
} else if (command === 'quality-review' || command === 'quality-repair') {
  const page = config.pages.find((page) =>
    page.panels.some((p) => p.id === process.argv[3]),
  );
  assert.ok(page, 'Unknown panel');
  const p = page.panels.find((p) => p.id === process.argv[3]);
  if (command === 'quality-review')
    quality.review(page, p, path.resolve(process.argv[4]));
  else quality.repair(page, p);
} else if (command === 'layers') {
  for (const p of config.pages)
    assert.equal(status(p), 'ready', 'Review before layer export: ' + p.id);
  const layers = path.join(output, 'layers');
  fs.mkdirSync(layers, { recursive: true });
  for (const p of config.pages)
    for (const layer of ['artwork', 'lettering'])
      fs.writeFileSync(
        path.join(layers, `page-${p.id}-${layer}.svg`),
        svg(p, artFor(p), false, layer),
      );
  console.log(
    'Saved aligned, transparent artwork/lettering SVG layers in ' + layers,
  );
} else if (command === 'status') {
  console.log(config.pages.map((p) => `${p.id}: ${status(p)}`).join('\n'));
} else if (command === 'build') {
  requireDesignSeal(root, config, configFile);
  requireReview(root, config, configFile, 'source');
  requireReview(root, config, configFile, 'script');
  for (const page of config.pages) {
    requireReview(root, config, configFile, 'storyboard', page.id);
    for (const panel of page.panels)
      requireReview(root, config, configFile, 'artwork', panel.id);
    requireReview(root, config, configFile, 'lettering', page.id);
  }
  for (const page of config.pages)
    assert.equal(
      status(page),
      'ready',
      `Page ${page.id} pending or changed: regenerate/review before build`,
    );
  fs.mkdirSync(output, { recursive: true });
  for (const page of config.pages) {
    assert.equal(
      status(page),
      'ready',
      `Page ${page.id} pending or changed: regenerate/review before build`,
    );
    fs.writeFileSync(
      path.join(output, `page-${page.id}.svg`),
      svg(page, artFor(page)),
    );
  }
  const manifest = config.pages.map((p) => ({
    id: p.id,
    materials: materialJobs(p).map((j) => ({
      asset: j.asset,
      fingerprint: j.fingerprint,
      imageHash: hash(fs.readFileSync(local(j.asset))),
      placementHash: hash(fs.readFileSync(local(j.record))),
    })),
    svgHash: hash(fs.readFileSync(path.join(output, `page-${p.id}.svg`))),
  }));
  fs.writeFileSync(
    path.join(output, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(output, 'reader.html'),
    fs
      .readFileSync(path.join(root, 'templates', 'reader.html'), 'utf8')
      .replaceAll('{{TITLE}}', xml(config.title))
      .replaceAll('{{AUTHOR}}', xml(config.author || ''))
      .replace(
        '{{PAGES}}',
        JSON.stringify(
          config.pages.map((p) => ({
            id: p.id,
            alt: p.panels
              .flatMap((q) => q.dialogue.map((d) => d.text))
              .join(' / '),
          })),
        ).replaceAll('<', '\\u003c'),
      ),
  );
  fs.writeFileSync(
    path.join(output, 'index.html'),
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(config.title)} 改訂版</title><style>body{background:#e7e5e0;margin:0;font-family:Meiryo,sans-serif}header{max-width:850px;margin:28px auto;padding:20px}h1{font-size:24px}main{max-width:950px;margin:auto}img{width:100%;display:block;margin-bottom:26px}@media print{header{display:none}img{height:100vh;object-fit:contain;break-after:page}}</style><header><h1>${xml(config.title)} — 改訂版</h1><p>原作：${xml(config.author || '')} ／ 右から左、上から下へ。セリフとコマ割りを先に確定して制作。</p><a href="${path.relative(output, path.join(dir, 'storyboards', 'index.html')).replaceAll('\\', '/')}">制作前のネーム</a> · <a href="reader.html">1ページずつ読む</a></header><main>${config.pages.map((p) => `<img src="page-${p.id}.svg" alt="${xml(p.panels.flatMap((q) => q.dialogue.map((d) => `${d.speaker}: ${d.text.replace(/\n/g, '')}`)).join(' / '))}">`).join('')}</main></html>`,
  );
  console.log(
    `Built ${config.pages.length} pages and reproducibility manifest`,
  );
} else
  throw new Error(
    'Use plan | check | layout PAGE [--apply] | candidate-panel ID FILE [--note TEXT] | accept PAGE FILE --reviewed | accept-panel ID FILE --reviewed | use-page ID --reviewed --reason TEXT | preview [PAGE] | review PAGE --speakers --faces --order --continuity | quality-plan | quality-review ID JSON | quality-repair ID | status | build | layers',
  );
