import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createTemporary } from '../src/temporary.mjs';
import { root } from '../src/workspace.mjs';

const temporary = createTemporary('test');
try {
  const mock = path.join(temporary.folder, 'mock-fetch.mjs');
  const episode = `<p class="widget-episodeTitle js-vertical-composition-item">第1話</p>
<div class="widget-episodeBody js-episode-body"><p>もう<ruby><rb>一度</rb><rp>（</rp><rt>鑑定</rt><rp>）</rp></ruby>を使う。</p><p><ruby>祝福<rt>呪い</rt></ruby>と（普通の括弧）。</p><p><ruby>海<rt></rt></ruby> &amp; &lt;tag&gt;<br>次の行</p></div>`;
  fs.writeFileSync(
    mock,
    `globalThis.fetch=async u=>({ok:true,text:async()=>String(u).includes('/episodes/')?${JSON.stringify(episode)}:'<a href="/works/123/episodes/456">第1話</a>'});`,
  );
  const output = path.join(temporary.folder, 'source');
  execFileSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(mock).href,
      path.join(root, 'cli/import-kakuyomu.mjs'),
      'https://kakuyomu.jp/works/123',
      output,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(
    fs.readFileSync(path.join(output, 'original.txt'), 'utf8'),
    'もう一度《鑑定》を使う。\n祝福《呪い》と（普通の括弧）。\n海 & <tag>\n次の行',
  );
  assert.equal(
    fs.readFileSync(path.join(output, 'episode-001.html'), 'utf8'),
    episode,
  );
  const record = JSON.parse(
    fs.readFileSync(path.join(output, 'retrieval.json'), 'utf8'),
  );
  assert.match(record.ruby, /base《reading》/);
  assert.equal(record.episodes.length, 1);
  console.log(
    'Kakuyomu import preserves semantic ruby, base text, ordinary parentheses, entities and raw HTML.',
  );
} finally {
  temporary.cleanup();
}
