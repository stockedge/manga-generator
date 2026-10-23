import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

import { root } from '../src/workspace.mjs';
const story = JSON.parse(
  fs.readFileSync(path.join(root, 'story.json'), 'utf8'),
);
const out = path.join(root, 'output');
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c],
  );
function validate() {
  assert.ok(story.pages.length > 0);
  const ids = new Set();
  for (const page of story.pages) {
    assert.match(page.id, /^\d{2}$/);
    assert.ok(!ids.has(page.id), 'Duplicate page ID');
    ids.add(page.id);
    assert.equal(page.panels.length, 3, 'Three panels required');
    if (page.artBands) {
      assert.equal(page.artBands.length, 3);
      for (const [y, h] of page.artBands)
        assert.ok(
          Number.isFinite(y) &&
            Number.isFinite(h) &&
            y >= 0 &&
            h > 0 &&
            y + h <= 1536,
        );
    }
    for (const panel of page.panels) {
      assert.ok(panel.scene && panel.right && panel.left);
      for (const text of [panel.right, panel.left]) {
        assert.ok(
          text.split('\n').length <= 3,
          'At most three lettering lines',
        );
        assert.ok(
          text.split('\n').every((line) => [...line].length <= 18),
          'Lettering exceeds safe width',
        );
      }
    }
  }
}
function prompt(page) {
  return `${story.style}\nCreate ONE portrait manga art page, aspect 2:3. EXACTLY THREE equal-height wide horizontal panels stacked vertically, clear straight borders and narrow white gutters. No subdivisions or extra panels. Each panel reserves its TOP 30 percent as PURE EMPTY WHITE space for separately typeset dialogue: draw all faces, hands and storytelling action BELOW that strip, in lower 70 percent. No balloons. Panel 1 TOP: ${page.panels[0].scene}\nPanel 2 MIDDLE: ${page.panels[1].scene}\nPanel 3 BOTTOM: ${page.panels[2].scene}\nKeep character identities from reference. Each shot should have deliberate emotional acting, varied framing and hand-drawn economical ink. Anatomy and spatial relationships must be coherent. No letters on receipts/newspapers. No page numbers.`;
}
function balloon(text, x, y, caption) {
  const lines = text.split('\n');
  const shape = caption
    ? `<rect x="${x}" y="${y}" width="452" height="90" fill="white" stroke="black" stroke-width="2"/>`
    : `<rect x="${x}" y="${y}" width="452" height="90" rx="40" fill="white" stroke="black" stroke-width="2"/>`;
  return (
    shape +
    `<text font-family="Yu Gothic,Meiryo,sans-serif" font-size="23" fill="black" text-anchor="middle">${lines.map((line, i) => `<tspan x="${x + 226}" y="${y + 52 - (lines.length - 1) * 13 + i * 26}">${escape(line)}</tspan>`).join('')}</text>`
  );
}
function svg(page) {
  const asset = path.join(root, 'assets', `page-${page.id}.png`);
  assert.ok(fs.existsSync(asset), `Missing ${asset}`);
  const art = fs.readFileSync(asset).toString('base64');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536"><defs><image id="art" href="data:image/png;base64,${art}" width="1024" height="1536" preserveAspectRatio="none"/></defs><rect width="1024" height="1536" fill="white"/>${page.panels
    .map((p, i) => {
      const [y, h] = page.artBands?.[i] ?? [i * 512, 512];
      return (
        `<rect x="8" y="${i * 500 + 6}" width="1008" height="486" fill="white" stroke="black" stroke-width="2"/><svg x="12" y="${i * 500 + 108}" width="1000" height="380" viewBox="0 ${y} 1024 ${h}" preserveAspectRatio="xMidYMid meet"><defs><clipPath id="band-${i}"><rect x="0" y="${y}" width="1024" height="${h}"/></clipPath></defs><use href="#art" clip-path="url(#band-${i})"/></svg>` +
        balloon(p.right, 530, i * 500 + 12, p.kind === 'caption') +
        balloon(
          p.left,
          42,
          i * 500 + 12,
          p.kind === 'caption' || p.kind === 'left-caption',
        )
      );
    })
    .join(
      '',
    )}<text x="512" y="1522" text-anchor="middle" font-family="sans-serif" font-size="20">${Number(page.id)}</text></svg>`;
}
validate();
fs.mkdirSync(out, { recursive: true });
const command = process.argv[2] || 'build';
if (command === 'prompts') {
  fs.mkdirSync(path.join(root, 'prompts'), { recursive: true });
  for (const page of story.pages)
    fs.writeFileSync(
      path.join(root, 'prompts', `page-${page.id}.txt`),
      prompt(page),
    );
  console.log(`Saved ${story.pages.length} prompts`);
} else if (command === 'check') {
  assert.equal(escape('<&"\''), '&lt;&amp;&quot;&apos;');
  assert.ok(prompt(story.pages[0]).includes('EXACTLY THREE'));
  assert.ok(balloon('未来の剣聖様', 42, 12, false).includes('未来の剣聖様'));
  console.log(
    `OK: ${story.pages.length} pages / ${story.pages.length * 3} panels, IDs, lettering, escaping and prompt layout`,
  );
} else if (command === 'build') {
  // ponytail: three fixed bands keep lettering deterministic; use per-panel boxes for complex page layouts.
  for (const page of story.pages)
    fs.writeFileSync(path.join(out, `page-${page.id}.svg`), svg(page));
  fs.writeFileSync(
    path.join(out, 'index.html'),
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(story.title)}</title><style>body{margin:0;background:#e9e7e2;color:#222;font-family:"Yu Gothic",sans-serif}header{max-width:800px;margin:32px auto;padding:0 20px}h1{font-size:24px}p{line-height:1.7}main{max-width:900px;margin:auto}img{display:block;width:100%;height:auto;margin:0 auto 24px;background:white}@media print{header{display:none}body{background:white}img{margin:0;max-height:100vh;object-fit:contain;break-after:page}}</style><header><h1>${escape(story.title)}</h1><p>原作：${escape(story.author)} ／ 全8ページ・短縮漫画版</p><p>${escape(story.adaptation)}</p><p>各ページは上から下へ、各コマの台詞は右から左へ読みます。ブラウザの印刷でPDF保存できます。</p><a href="${escape(story.source)}">原作を読む</a></header><main>${story.pages.map((p) => `<img src="page-${p.id}.svg" alt="${escape(p.panels.map((q) => q.right + ' ' + q.left).join(' / '))}" loading="lazy">`).join('')}</main></html>`,
  );
  console.log(`Built ${out}`);
} else throw new Error('Use build, check or prompts');
