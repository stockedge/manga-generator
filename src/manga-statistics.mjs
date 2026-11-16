// Descriptive planning references, not acceptance criteria or quality scores.
export const mangaReference = {
  source:
    'User-supplied Manga109-s statistics screenshots, 2026-11-16; full definitions unavailable',
  silentFraction: 0.202,
  textMedian: 15,
  speakingTextMedian: 21,
  speakingTextP90: 50,
  speakingTextP95: 62,
  panelsPerSpreadMedian: 10,
  areaPerSpreadMedian: 0.056,
  aspectMedian: 1.09,
  aspectFractions: [0.143, 0.23, 0.15, 0.251, 0.116, 0.11],
  peopleFractions: [0.15, 0.439, 0.307, 0.104],
  singlePersonCropFractions: {
    shoulder: 0.407,
    bust: 0.302,
    waist: 0.125,
    knee: 0.087,
    full: 0.078,
  },
};

export const mangaPlanningGuide =
  'docs/MANGA-STATISTICS.md に従い、原作の意味・動作・応答を先に固定する。' +
  '通常場面は1ページ5コマ前後を初期案の目安にし、見せ場や導入では変える。' +
  '台詞あり1コマ21字・無言約20%は参考値で、文字数上限や無言ノルマにしない。' +
  '会話では話者や反応の寄り、状況説明では引き、物や動作の無言を必要に応じて選ぶ。' +
  '単独人物で切れ位置が決まったコマは cameraCrop に shoulder/bust/waist/knee/full を計画時に記録する。未確定や手元だけのコマは推測で埋めない。' +
  'production-audit の statistics を作画前に読み、偏りの警告を修正するか場面上の理由を残す。' +
  '統計へ近づけるためだけに原文を削除・反復したり、人物やコマを追加しない。';

const histogram = (values, bounds) =>
  bounds.map((bound, i) => ({
    min: i ? bounds[i - 1] + 1 : 0,
    max: Number.isFinite(bound) ? bound : null,
    count: values.filter((v) => v <= bound && (!i || v > bounds[i - 1])).length,
  }));
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p) => {
    if (!sorted.length) return null;
    const at = (sorted.length - 1) * p;
    const lo = Math.floor(at),
      hi = Math.ceil(at);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
  };
  return {
    count: sorted.length,
    median: quantile(0.5),
    p90: quantile(0.9),
    p95: quantile(0.95),
    p25: quantile(0.25),
    p75: quantile(0.75),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
    mean: sorted.length
      ? sorted.reduce((a, b) => a + b, 0) / sorted.length
      : null,
  };
}

export function mangaStatistics(config) {
  const panels = config.pages.flatMap((page) =>
    page.panels.map((p) => {
      const [, , w, h] = p.rect;
      const pageArea = (page.width || 1024) * (page.height || 1536);
      const actors =
        p.speakers == null
          ? null
          : Object.entries(p.speakers)
              .filter(
                ([id, s]) =>
                  config.cast?.[id]?.kind !== 'caption' &&
                  s.kind !== 'offscreen',
              )
              .map(([id]) => id);
      return {
        page: page.id,
        panel: p.id,
        textCharacters: (p.dialogue || []).reduce(
          (n, d) => n + [...d.text.replace(/\s/gu, '')].length,
          0,
        ),
        areaPerSpread:
          Number.isFinite(w * h) && w > 0 && h > 0
            ? (w * h) / (2 * pageArea)
            : null,
        aspect: Number.isFinite(w / h) && w > 0 && h > 0 ? w / h : null,
        registeredVisiblePeople: actors?.length ?? null,
        cameraCrop:
          actors?.length === 1 &&
          Object.hasOwn(mangaReference.singlePersonCropFractions, p.cameraCrop)
            ? p.cameraCrop
            : null,
      };
    }),
  );
  const warnings = [];
  const warn = (code, entries, message) =>
    warnings.push({
      code,
      panels: entries.map((p) => p.panel),
      pages: [...new Set(entries.map((p) => p.page))],
      message,
    });
  for (const panel of panels)
    if (panel.textCharacters > 100)
      warn(
        'very-dense-panel',
        [panel],
        '100字超が1コマに集中。原作の意味と話者順を保ち、情報の分割や文字領域を検討（字数上限ではない）',
      );
  // Three consecutive panels is a review heuristic, not a Manga109 threshold.
  for (let i = 0; i + 2 < panels.length; i++) {
    const run = panels.slice(i, i + 3);
    if (
      run.every((p) => p.textCharacters > 50) &&
      (!i || panels[i - 1].textCharacters <= 50)
    ) {
      let end = i + 3;
      while (end < panels.length && panels[end].textCharacters > 50) end++;
      warn(
        'dense-text-run',
        panels.slice(i, end),
        '50字超のコマが3つ以上連続。意味・話者・応答を保ち、絵で示すかコマを分ける候補を検討',
      );
    }
    if (
      run.every((p) => p.cameraCrop && p.cameraCrop === run[0].cameraCrop) &&
      (!i || panels[i - 1].cameraCrop !== run[0].cameraCrop)
    ) {
      let end = i + 3;
      while (
        end < panels.length &&
        panels[end].cameraCrop === run[0].cameraCrop
      )
        end++;
      warn(
        'repeated-crop',
        panels.slice(i, end),
        '単独人物の同じショットが3つ以上連続。演技や情報に必要な反復か確認',
      );
    }
  }
  const counts = config.pages.map((p) => p.panels.length);
  if (counts.length >= 4 && counts.every((n) => n === counts[0]))
    warn(
      'uniform-page-count',
      panels,
      '4ページ以上でコマ数が同じ。場面・時間・感情に応じた強弱があるか確認（同数を禁止しない）',
    );
  if (panels.length >= 12 && panels.every((p) => p.textCharacters > 0))
    warn(
      'no-silent-panel',
      panels,
      '12コマ以上すべてに文字がある。絵だけで伝わる動作や反応を検討（無言を強制しない）',
    );
  if (
    panels.length >= 12 &&
    panels.filter((p) => p.aspect !== null && p.aspect > 2.6).length /
      panels.length >
      0.5
  )
    warn(
      'wide-panel-dominance',
      panels,
      '半数超が縦横比2.6超の横長コマ。会話の往復や寄りを左右のコマに分ける候補を検討（横長を禁止しない）',
    );
  const single = panels.filter((p) => p.registeredVisiblePeople === 1);
  const crops = Object.fromEntries(
    Object.keys(mangaReference.singlePersonCropFractions).map((k) => [
      k,
      single.filter((p) => p.cameraCrop === k).length,
    ]),
  );
  return {
    reference: mangaReference,
    definitions: {
      text: 'Dialogue and captions, Unicode code points excluding whitespace; punctuation included, sound effects excluded. Not verified against dataset counting rules.',
      geometry:
        'Rectangular panel metadata; spread area is twice one page area. No inferred physical spread pairing.',
      people:
        'Registered visible speakers, including head-only actors; captions/offscreen voices excluded. Empty speakers means zero registered, not verified absence of people.',
      crop: 'Explicit planned cameraCrop on single registered-person panels only. Free-form camera and face rectangles are not classified; unknown remains unknown.',
      warnings:
        'Advisory heuristics; not statistical significance, hard limits, or automatic repair. Source meaning and actual visual review take precedence.',
    },
    totalPanels: panels.length,
    text: {
      ...summary(panels.map((p) => p.textCharacters)),
      speaking: summary(
        panels.filter((p) => p.textCharacters > 0).map((p) => p.textCharacters),
      ),
      silentFraction: panels.length
        ? panels.filter((p) => !p.textCharacters).length / panels.length
        : null,
      bins: histogram(
        panels.map((p) => p.textCharacters),
        [0, 5, 10, 20, 30, 50, 100, Infinity],
      ),
    },
    textPerPage: summary(
      config.pages.map((page) =>
        panels
          .filter((p) => p.page === page.id)
          .reduce((n, p) => n + p.textCharacters, 0),
      ),
    ),
    physicalSpreads: null,
    panelsPerPage: summary(counts),
    areaPerSpread: summary(
      panels.map((p) => p.areaPerSpread).filter((v) => v !== null),
    ),
    aspect: {
      ...summary(panels.map((p) => p.aspect).filter((v) => v !== null)),
      bins: [0.5, 0.85, 1.15, 1.8, 2.6, Infinity].map((max, i, edges) => ({
        min: i ? edges[i - 1] : 0,
        max: Number.isFinite(max) ? max : null,
        count: panels.filter(
          (p) =>
            p.aspect !== null &&
            p.aspect >= (i ? edges[i - 1] : 0) &&
            p.aspect < max,
        ).length,
      })),
    },
    people: {
      bins: [0, 1, 2, 3].map((n) => ({
        people: n === 3 ? '3+' : String(n),
        count: panels.filter(
          (p) =>
            p.registeredVisiblePeople !== null &&
            (n === 3
              ? p.registeredVisiblePeople >= 3
              : p.registeredVisiblePeople === n),
        ).length,
      })),
      unknown: panels.filter((p) => p.registeredVisiblePeople === null).length,
    },
    singlePersonCrop: {
      eligible: single.length,
      known: single.filter((p) => p.cameraCrop).length,
      unknown: single.filter((p) => !p.cameraCrop).length,
      counts: crops,
    },
    panels,
    warnings,
  };
}
