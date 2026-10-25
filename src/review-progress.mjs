import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { requireReview, captureReview } from './stage-reviews.mjs';
import { twoPhaseReading, loadFirstReading } from './first-reading.mjs';

export function reviewTargets(c) {
  return [
    'source',
    'script',
    'storyboard',
    'artwork',
    'lettering',
    'final',
  ].flatMap((stage) =>
    (['source', 'script', 'final'].includes(stage)
      ? ['all']
      : stage === 'artwork'
        ? c.pages.flatMap((p) => p.panels.map((a) => a.id))
        : c.pages.map((p) => p.id)
    ).map((target) => ({ stage, target })),
  );
}

export function pendingReviews(root, c, configFile) {
  return reviewTargets(c).flatMap(({ stage, target }) => {
    try {
      requireReview(
        root,
        { ...c, productionReview: { ...c.productionReview, required: true } },
        configFile,
        stage,
        target,
      );
      return [];
    } catch (error) {
      let firstReading = false;
      if (twoPhaseReading(c, stage)) {
        try {
          loadFirstReading(root, c, stage, target);
        } catch {
          firstReading = true;
        }
      }
      return [{ stage, target, firstReading, reason: error.message }];
    }
  });
}

export function designSnapshot(root, c, configFile) {
  const targets = [
    { stage: 'source', target: 'all' },
    { stage: 'script', target: 'all' },
    ...c.pages.map((p) => ({ stage: 'storyboard', target: p.id })),
  ];
  return targets.map(({ stage, target }) => {
    requireReview(
      root,
      { ...c, productionReview: { ...c.productionReview, required: true } },
      configFile,
      stage,
      target,
    );
    return {
      stage,
      target,
      fingerprint: captureReview(root, c, configFile, stage, target)
        .fingerprint,
    };
  });
}

export function requireDesignSeal(root, c, configFile) {
  if (!c.productionReview?.designSealRequired) return;
  const file = path.resolve(root, c.workflowDir, 'design-seal.json');
  assert.ok(
    fs.existsSync(file),
    'Seal approved script/storyboards before drawing: stage-review seal',
  );
  const seal = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(
    seal.status,
    'sealed',
    'Design reopened; revise, review and seal again',
  );
  assert.deepEqual(
    seal.inputs,
    designSnapshot(root, c, configFile),
    'Design changed; revise, review and seal again',
  );
}
