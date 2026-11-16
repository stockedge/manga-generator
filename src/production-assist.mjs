import assert from 'node:assert/strict';
import { xml } from './lettering.mjs';

export const optionalPolicy = {
  optional: true,
  productionAdopted: false,
  readyToPublish: false,
  conditions: [
    '原作・脚本・設定・採用素材を正本として維持する。補助資料を原作の代わりにしない。',
    '候補は実画像と原作を照合し、正式採用・座標確認・独立レビューを別途行う。',
    '完成済み作品の再生成、公開、契約、モデル切替を自動実行しない。',
  ],
};

/** @param {Record<string, any>} [known] */
export function intakeDraft(known = {}) {
  const fields = [
    'format',
    'theme',
    'synopsis',
    'characters',
    'length',
    'colour',
    'title',
  ];
  assert.ok(known && typeof known === 'object' && !Array.isArray(known));
  assert.ok(
    Object.keys(known).every((k) => fields.includes(k) || k === 'tentative'),
    'Unknown brief field',
  );
  for (const key of fields)
    assert.ok(
      known[key] === undefined || typeof known[key] === 'string',
      'Brief fields must be strings',
    );
  assert.ok(
    known.tentative === undefined ||
      (Array.isArray(known.tentative) &&
        known.tentative.every((k) => fields.includes(k))),
    'Invalid tentative fields',
  );
  const confirmed = Object.fromEntries(
    fields
      .filter((k) => known[k]?.trim() && !known.tentative?.includes(k))
      .map((k) => [k, known[k]]),
  );
  const tentative = Object.fromEntries(
    (known.tentative || [])
      .filter((k) => known[k]?.trim())
      .map((k) => [k, known[k]]),
  );
  return {
    ...optionalPolicy,
    confirmed,
    tentative,
    unknown: fields.filter((k) => !known[k]?.trim()),
    instruction:
      '原作なしで相談を希望した場合だけ利用。既知事項は再質問しない。未回答は不明のまま、提案は仮案として具体案を示す。番号・自由文・質問省略を認め、原作持込にはこの質問を強制しない。',
  };
}

export function productionIndex(config, sourceHash) {
  return {
    ...optionalPolicy,
    sourceHash,
    sourceFile: config.sourceFile,
    title: config.title,
    basisLabels: ['原文明言', '制作側の解釈', '漫画用補足', '不明'],
    pages: config.pages.map((p) => ({
      page: p.id,
      purpose: p.purpose,
      expectation: p.expectation,
      showcase: p.showcase,
      panels: p.panels.map((q) => ({
        panel: q.id,
        role: q.role,
        scene: q.scene,
        camera: q.camera,
        action: q.action,
        emotion: q.emotion,
        dialogue: q.dialogue.map((d) => ({ speaker: d.speaker, text: d.text })),
        production: q.production,
      })),
    })),
    instruction:
      '概要・節目・役割・口調は全文へ戻れる補助索引。意味・因果・時系列・問い返答・感情と、許容されるテーマ解釈を別々に照合する。',
  };
}

export function characterCards(config) {
  return Object.entries(config.cast)
    .filter(([, a]) => a.kind !== 'caption')
    .map(([id, a]) => ({
      id,
      name: a.name || id,
      description: a.description ?? null,
      invariants: a.invariants ?? null,
      faceDesign: a.faceDesign ?? null,
      sourceBasis: a.settingBasis ?? null,
      age: a.age ?? null,
      height: a.height ?? null,
      role: a.role ?? null,
      note: '未記入は不明。数値・役割の原作根拠は別途照合。顔正本を維持し、衣装・演技・背面・背景資料は必要時だけ追加。',
    }));
}

export function cardsHTML(cards, images = {}) {
  for (const image of Object.values(images))
    assert.match(
      image,
      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/,
      'Cards accept only embedded PNG references',
    );
  return (
    '<!doctype html><html lang="ja"><meta charset="utf-8"><title>人物資料の索引</title><style>body{font:16px sans-serif;max-width:900px;margin:24px auto}article{border:1px solid #aaa;padding:16px;margin:16px}pre{white-space:pre-wrap;line-height:1.6}</style>' +
    cards
      .map(
        (a) =>
          `<article><h2>${xml(a.name)}</h2>${images[a.id] ? `<img style="max-width:100%;max-height:360px;object-fit:contain" alt="顔の正本資料" src="${images[a.id]}">` : ''}<pre>${xml(JSON.stringify(a, null, 2))}</pre></article>`,
      )
      .join('') +
    '</html>'
  );
}

export function spreadPlan(pages, frontMatter = 0) {
  assert.ok(
    Number.isInteger(frontMatter) && frontMatter >= 0 && frontMatter <= 100,
    'Invalid front matter count',
  );
  assert.equal(
    new Set(pages.map((p) => p.id)).size,
    pages.length,
    'Duplicate page',
  );
  const sequence = [
    ...Array.from({ length: frontMatter }, (_, i) => ({ frontMatter: i + 1 })),
    ...pages.map((p) => ({ page: p.id })),
  ];
  if (!sequence.length) return [];
  const spreads = [{ right: null, left: sequence[0] }];
  for (let i = 1; i < sequence.length; i += 2)
    spreads.push({ right: sequence[i], left: sequence[i + 1] ?? null });
  return spreads;
}

export function deliveryPlan(pages) {
  assert.ok(pages.length, 'No pages');
  assert.equal(
    new Set(pages.map((p) => p.id)).size,
    pages.length,
    'Duplicate page',
  );
  for (const p of pages)
    assert.ok(
      typeof p.id === 'string' &&
        /^[a-f0-9]{64}$/.test(p.sha256) &&
        p.bytes > 0,
      'Invalid page evidence',
    );
  return {
    ...optionalPolicy,
    pages,
    totalBytes: pages.reduce((n, p) => n + p.bytes, 0),
    x: pages.map((p, i) => ({
      localId: 'page-' + p.id,
      page: p.id,
      replyToLocalId: i ? 'page-' + pages[i - 1].id : null,
      imageHash: p.sha256,
      actualPostId: null,
      uploaded: false,
    })),
    beforePublication: {
      x: [
        '現行の画像条件・返信権限・自己返信可否',
        '明示的な公開指示',
        '親の実投稿IDと表示・再開確認',
      ],
      pixiv: [
        '現行の容量・寸法条件',
        'AI分類・年齢制限・公開範囲・権利条件',
        '実UIの受理と表示',
      ],
      other: ['投稿先の公式要件を別途確認'],
    },
    kindle: {
      bodyPages: pages.length,
      readingDirection: 'right-to-left',
      cover: '別途用意・確認',
      format:
        'Kindle Create等への入力を別途確認。KPF/KCBを作成したとは扱わない。',
    },
  };
}

export function generationSummary(log) {
  return {
    ...optionalPolicy,
    sourceHash: log?.sourceHash ?? null,
    panels: (log?.panels || []).map((p) => ({
      panel: p.panel,
      renderer: p.renderer ?? null,
      model: p.model ?? null,
      kind: p.kind ?? null,
      promptHash: p.promptHash ?? null,
      imageHash: p.imageHash ?? null,
      referenceCount: Array.isArray(p.references) ? p.references.length : null,
      reusedFrom: p.reusedFrom ?? null,
    })),
    note: '実記録の索引。未記録モデル・費用・人の手描き・権利帰属を推測しない。公開前に個人情報・素材の由来を別途確認。',
  };
}
