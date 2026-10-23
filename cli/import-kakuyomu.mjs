import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const [input, directory] = process.argv.slice(2);
const url = new URL(input);
assert.equal(url.hostname, 'kakuyomu.jp');
const id = url.pathname.match(/\/(?:my\/)?works\/(\d+)/)?.[1];
assert.ok(id, 'Expected a Kakuyomu work URL');
assert.ok(directory, 'Specify a staging output directory');
fs.mkdirSync(directory, { recursive: true });
const get = async (u) => {
  const r = await fetch(u);
  assert.ok(r.ok, `Cannot retrieve ${u}: ${r.status}`);
  return r.text();
};
const decode = (t) =>
  t
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) =>
      String.fromCodePoint(
        n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n),
      ),
    )
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/g,
      (_, n) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[n],
    );
const homepage = await get(`https://kakuyomu.jp/works/${id}`);
fs.writeFileSync(path.join(directory, 'work.html'), homepage);
const episodes = [
  ...new Set(
    [...homepage.matchAll(new RegExp(`/works/${id}/episodes/\\d+`, 'g'))].map(
      (m) => 'https://kakuyomu.jp' + m[0],
    ),
  ),
];
assert.ok(
  episodes.length,
  'No public episodes; authenticated draft text is not available through public fetch',
);
const parts = [];
for (const [i, u] of episodes.entries()) {
  const html = await get(u);
  fs.writeFileSync(
    path.join(directory, `episode-${String(i + 1).padStart(3, '0')}.html`),
    html,
  );
  const body = html.match(
    /<div class="widget-episodeBody js-episode-body"[^>]*>([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(body, 'Episode body unavailable: ' + u);
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) =>
    decode(
      m[1]
        .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/g, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, ''),
    ),
  );
  assert.ok(
    paragraphs.some((t) => t.trim()),
    'Empty episode',
  );
  const title = decode(
    html
      .match(
        /<p class="widget-episodeTitle js-vertical-composition-item">([\s\S]*?)<\/p>/,
      )?.[1]
      ?.replace(/<[^>]*>/g, '') || `Episode ${i + 1}`,
  );
  parts.push({ url: u, title, text: paragraphs.join('\n') });
}
const text = parts
  .map((p) => (episodes.length > 1 ? `【${p.title}】\n${p.text}` : p.text))
  .join('\n\n');
fs.writeFileSync(path.join(directory, 'original.txt'), text);
fs.writeFileSync(
  path.join(directory, 'retrieval.json'),
  JSON.stringify(
    {
      work: `https://kakuyomu.jp/works/${id}`,
      requested: input,
      retrievedAt: new Date().toISOString(),
      scope: 'All public episodes linked in work table of contents',
      episodes: parts.map(({ text, ...p }) => ({ ...p, length: text.length })),
      ruby: 'Ruby readings omitted; base text retained',
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      episodes: episodes.length,
      characters: text.length,
      file: path.join(directory, 'original.txt'),
    },
    null,
    2,
  ),
);
