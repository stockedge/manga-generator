import { box, overlap } from './lettering.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { cropRectangle } from './artwork-crop.mjs';

const round = (value) => Math.round(value * 1000) / 1000;
function savedImage(config, panel, root) {
  if (!root) return null;
  const inside = (relative) => {
    const file = path.resolve(root, relative);
    assert.ok(
      file.startsWith(path.resolve(root) + path.sep),
      'Image escapes workspace',
    );
    return file;
  };
  const file = [
    `${config.assetDir || 'assets/v2'}/panels/${panel.id}.png`,
    panel.storyboardImage,
  ]
    .filter(Boolean)
    .find((candidate) => fs.existsSync(inside(candidate)));
  if (!file) return null;
  const fd = fs.openSync(inside(file), 'r');
  const header = Buffer.alloc(24);
  try {
    assert.equal(fs.readSync(fd, header, 0, 24, 0), 24, 'Truncated PNG');
  } finally {
    fs.closeSync(fd);
  }
  assert.ok(
    header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'Expected PNG',
  );
  assert.equal(
    header.subarray(12, 16).toString(),
    'IHDR',
    'Missing PNG dimensions',
  );
  const width = header.readUInt32BE(16),
    height = header.readUInt32BE(20);
  assert.ok(width > 0 && height > 0, 'Invalid PNG dimensions');
  const crop = cropRectangle(panel.artworkCrop, header);
  return { file, width, height, crop: crop || null };
}

// These are planning warnings. A human still checks the actual unnumbered page.
/** @param {any} config @param {{root?: string}} [options] */
export function inspectProduction(config, { root } = {}) {
  const panels = config.pages.flatMap((page) =>
    page.panels.map((panel) => {
      const [x, y, width, height] = panel.rect;
      const boxes = panel.dialogue.map((dialogue) => box(panel, dialogue));
      const issues = [];
      const compositionIssues = [];
      const reservedArea = boxes.reduce((sum, b) => sum + b[2] * b[3], 0);
      const visibleActors = Object.entries(panel.speakers || {}).filter(
        ([actor, s]) =>
          config.cast[actor]?.kind !== 'caption' && s.kind !== 'offscreen',
      );
      const faceHeightFractions = Object.fromEntries(
        visibleActors
          .filter(([, s]) => s.face)
          .map(([actor, s]) => [actor, round(s.face[3] / height)]),
      );
      for (const [actor, fraction] of Object.entries(faceHeightFractions))
        if (fraction < 0.12 && panel.dialogue.some((d) => d.speaker === actor))
          compositionIssues.push(
            `${actor} の予定顔高がコマ高の12%未満。表情の大きさを縮小ページで確認`,
          );
      const textOnlyCandidate =
        panel.dialogue.length > 0 &&
        panel.dialogue.every(
          (d) => config.cast[d.speaker]?.kind === 'caption',
        ) &&
        !visibleActors.length &&
        !(panel.protected || []).length &&
        !(panel.production?.props || []).length;
      if (textOnlyCandidate && width * height > 1024 * 1536 * 0.15)
        compositionIssues.push(
          '説明専用候補がページの15%超。文字だけの大コマが必要か、隣接コマとの統合を検討',
        );
      let image = null;
      try {
        image = savedImage(config, panel, root);
      } catch (error) {
        compositionIssues.push(
          '素材寸法/切り出しを確認できない: ' + error.message,
        );
      }
      let containBlankFraction = null;
      if (image) {
        const [, , iw, ih] = image.crop || [0, 0, image.width, image.height];
        const scale = Math.min(width / iw, height / ih);
        containBlankFraction = round(
          1 - (iw * ih * scale * scale) / (width * height),
        );
        if (containBlankFraction > 0.2)
          compositionIssues.push(
            `素材の縦横比による未使用面積が${Math.round(containBlankFraction * 100)}%。コマ比・切り出し・構図を再検討`,
          );
      }
      if (reservedArea > width * height * 0.38)
        issues.push(
          '文字の予約面積がコマの38%を超える。台詞・コマ割り・構図を再検討',
        );
      for (const [actor, speaker] of Object.entries(panel.speakers || {})) {
        if (speaker.face && speaker.face[3] < 40)
          issues.push(
            `${actor} の予定顔高が40px未満。表情が読めるショットか確認`,
          );
      }
      const framing = panel.production;
      if (!framing) {
        issues.push('動作の瞬間・前後・左右の手・小道具状態が未記録');
      } else {
        for (const key of ['moment', 'before', 'after'])
          if (!framing[key]?.trim() || /確定|TODO|未定/.test(framing[key]))
            issues.push(`production.${key} が未記録`);
        for (const [actor, speaker] of Object.entries(panel.speakers || {})) {
          if (
            speaker.kind === 'offscreen' ||
            config.cast[actor]?.kind === 'caption'
          )
            continue;
          const hands = framing.hands?.[actor];
          if (
            !hands ||
            !['left', 'right'].every(
              (hand) =>
                typeof hands[hand] === 'string' &&
                hands[hand].trim() &&
                !/確定|TODO|未定/.test(hands[hand]),
            )
          )
            issues.push(`${actor} の左右の手の状態が未記録`);
        }
        if (!Array.isArray(framing.props))
          issues.push('production.props が未記録（小道具なしなら空配列）');
        else {
          const occupied = new Map();
          for (const prop of framing.props) {
            if (
              !prop.id?.trim() ||
              !['before', 'during', 'after'].every((key) => prop[key]?.trim())
            )
              issues.push('小道具のID・前・現在・後の状態が不足');
            if (typeof prop.heldBy !== 'string' || !prop.heldBy.trim())
              issues.push(
                `${prop.id || '小道具'} の heldBy が未記録（手にない場合は none）`,
              );
            else if (prop.heldBy !== 'none') {
              const [actor, hand, extra] = prop.heldBy.split('.');
              if (
                extra ||
                !['left', 'right'].includes(hand) ||
                !framing.hands?.[actor]
              )
                issues.push(`${prop.id || '小道具'} の heldBy が無効`);
              else {
                if (!framing.hands[actor][hand]?.includes(prop.id))
                  issues.push(
                    `${actor}.${hand} に ${prop.id} が記載されていない`,
                  );
                if (occupied.has(prop.heldBy))
                  issues.push(
                    `${prop.heldBy} に ${occupied.get(prop.heldBy)} と ${prop.id} が同時に割り当てられている。把持方法を確認`,
                  );
                occupied.set(prop.heldBy, prop.id);
              }
            }
          }
        }
      }
      for (const b of boxes) {
        if (
          b[0] < x ||
          b[1] < y ||
          b[0] + b[2] > x + width ||
          b[1] + b[3] > y + height
        )
          issues.push('吹き出しがコマ外へはみ出す');
        for (const speaker of Object.values(panel.speakers || {}))
          if (speaker.face && overlap(b, speaker.face))
            issues.push('予定吹き出しと顔が重なる');
      }
      return {
        page: page.id,
        panel: panel.id,
        reservedFraction:
          Math.round((reservedArea / (width * height)) * 100) / 100,
        composition: {
          faceHeightFractions,
          textOnlyCandidate,
          image,
          containBlankFraction,
        },
        compositionIssues,
        issues,
      };
    }),
  );
  const pages = config.pages.map((page) => {
    const entries = panels.filter((p) => p.page === page.id);
    const area = page.panels.reduce((sum, p) => sum + p.rect[2] * p.rect[3], 0);
    const panelAreaFraction = round(area / (1024 * 1536));
    const measured = entries.every((p) => p.composition.image !== null);
    const placedImageAreaFraction = measured
      ? round(
          page.panels.reduce(
            (sum, p, i) =>
              sum +
              p.rect[2] *
                p.rect[3] *
                (1 - entries[i].composition.containBlankFraction),
            0,
          ) /
            (1024 * 1536),
        )
      : null;
    const textOnlyAreaFraction = round(
      page.panels.reduce(
        (sum, p, i) =>
          sum +
          (entries[i].composition.textOnlyCandidate
            ? p.rect[2] * p.rect[3]
            : 0),
        0,
      ) /
        (1024 * 1536),
    );
    const issues = [];
    if (panelAreaFraction < 0.65)
      issues.push('コマ配置面積がページの65%未満。余韻か未使用領域かを実見');
    if (
      placedImageAreaFraction !== null &&
      panelAreaFraction - placedImageAreaFraction > 0.2
    )
      issues.push(
        '縦横比の不一致でページの20%超が未使用。人物の縮小とページ密度を再検討',
      );
    return {
      page: page.id,
      panelAreaFraction,
      placedImageAreaFraction,
      textOnlyAreaFraction,
      issues,
    };
  });
  return {
    panels,
    pages,
    warnings: panels.filter(
      (p) => p.issues.length || p.compositionIssues.length,
    ).length,
    structuralWarnings: panels.filter((p) => p.issues.length).length,
    compositionWarnings:
      panels.filter((p) => p.compositionIssues.length).length +
      pages.filter((p) => p.issues.length).length,
  };
}
