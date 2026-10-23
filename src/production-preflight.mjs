import { box, overlap } from './lettering.mjs';

// These are planning warnings. A human still checks the actual unnumbered page.
export function inspectProduction(config) {
  const panels = config.pages.flatMap((page) =>
    page.panels.map((panel) => {
      const [x, y, width, height] = panel.rect;
      const boxes = panel.dialogue.map((dialogue) => box(panel, dialogue));
      const issues = [];
      const reservedArea = boxes.reduce((sum, b) => sum + b[2] * b[3], 0);
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
            if (prop.heldBy === undefined)
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
        issues,
      };
    }),
  );
  return { panels, warnings: panels.filter((p) => p.issues.length).length };
}
