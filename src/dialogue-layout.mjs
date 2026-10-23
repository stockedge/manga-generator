import assert from 'node:assert/strict';
import { box, overlap, segmentEntry, createLettering } from './lettering.mjs';
import { readingFlow } from './reading-flow.mjs';
export function findDialogueLayout(page, p, cast) {
  const { tailGeometry } = createLettering(cast);
  const original = structuredClone(p.dialogue),
    bounds = [];
  const pools = original.map((d) => {
    const start = box(p, d),
      items = [];
    for (const capacity of d.textColumns !== undefined
      ? [d.capacity ?? 10]
      : [
          ...new Set([d.capacity ?? 10, 7, 8, 6, 9, 5, 10, 4, 11, 12, 13, 14]),
        ]) {
      const test = { ...d, capacity },
        b = box(p, test),
        maxX = p.rect[2] - b[2] - 12,
        maxY = p.rect[3] - b[3] - 12;
      const xs = new Set([start[0] - p.rect[0], 12, maxX]),
        ys = new Set([start[1] - p.rect[1], 12, maxY]);
      for (let x = 12; x <= maxX; x += 24) xs.add(x);
      for (let y = 12; y <= maxY; y += 24) ys.add(y);
      for (const x of xs)
        for (const dy of ys) {
          const c = { ...test, x, dy },
            r = box(p, c);
          if (x < 0 || dy < 0 || x + b[2] > p.rect[2] || dy + b[3] > p.rect[3])
            continue;
          if (
            Object.values(p.speakers || {}).some(
              (s) => s.face && overlap(r, s.face),
            ) ||
            (p.protected || []).some((a) => overlap(r, a))
          )
            continue;
          let tail;
          try {
            tail = tailGeometry(p, c);
          } catch {
            continue;
          }
          if (
            tail &&
            [
              ...Object.values(p.speakers || {})
                .filter((s) => s.face)
                .map((s) => s.face),
              ...(p.protected || []),
            ].some((a) => segmentEntry(tail.base, tail.tip, a) !== null)
          )
            continue;
          items.push({
            d: c,
            b: r,
            tail,
            score:
              Math.abs(r[0] - start[0]) +
              1.2 * Math.abs(r[1] - start[1]) +
              80 * Math.abs(capacity - (d.capacity ?? 10)),
          });
        }
    }
    return items.sort((a, b) => a.score - b.score);
  });
  let attempts = 0;
  const solve = (i) => {
    if (i === pools.length) {
      const candidate = { ...p, dialogue: bounds.map((v) => v.d) };
      return !readingFlow(
        { ...page, panels: [candidate] },
        box,
      ).panels[0].warnings.some((w) => w.code === 'nonconsecutive-cluster');
    }
    for (const item of pools[i]) {
      if (++attempts > 100000) return false;
      const previous = bounds.at(-1)?.b;
      if (
        previous &&
        !(
          item.b[1] >= previous[1] &&
          (item.b[0] <= previous[0] || item.b[1] >= previous[1] + 80)
        )
      )
        continue;
      if (
        bounds.some(
          (v) =>
            overlap(item.b, v.b) ||
            (item.tail &&
              segmentEntry(item.tail.base, item.tail.tip, v.b) !== null) ||
            (v.tail && segmentEntry(v.tail.base, v.tail.tip, item.b) !== null),
        )
      )
        continue;
      bounds.push(item);
      if (solve(i + 1)) return true;
      bounds.pop();
    }
    return false;
  };
  assert.ok(
    solve(0),
    'No safe dialogue placement found: ' +
      p.id +
      '; revise shot or lettering manually',
  );

  return bounds.map((v) => v.d);
}
