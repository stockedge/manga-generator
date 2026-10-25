import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {
  scopedReview,
  reviewContext,
  decisionContext,
} from './review-context.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const twoPhaseReading = (c, stage) =>
  c.productionReview?.readingProtocol === 'two-phase-v1' &&
  ['storyboard', 'lettering', 'final'].includes(stage);
const pagesFor = (c, target) =>
  target === 'all'
    ? c.pages
    : c.pages.filter(
        (page) =>
          page.id === target || page.panels.some((p) => p.id === target),
      );
const resolve = (root, name) => {
  const file = path.resolve(root, name);
  assert.ok(
    file.startsWith(path.resolve(root) + path.sep),
    'Reading input escapes workspace',
  );
  return file;
};

export function firstReadingRequest(root, c, stage, target = 'all') {
  assert.ok(
    twoPhaseReading(c, stage),
    'Two-phase reading is not enabled for this stage',
  );
  const pages = pagesFor(c, target);
  assert.ok(pages.length, 'Unknown reading target');
  const images = pages.map((page) => {
    const file =
      stage === 'storyboard'
        ? `${c.workflowDir}/storyboards-unnumbered/page-${page.id}.png`
        : stage === 'final'
          ? `${c.outputDir}/page-${page.id}.png`
          : `${c.workflowDir}/review/page-${page.id}.png`;
    assert.ok(
      fs.existsSync(resolve(root, file)),
      'Export current unnumbered reading image: ' + file,
    );
    return {
      page: page.id,
      file,
      hash: hash(fs.readFileSync(resolve(root, file))),
    };
  });
  // Bind to the current plan without supplying its script or intended order.
  const scoped = scopedReview(c, stage)
    ? reviewContext(c, stage, target)
    : null;
  const contextHash = hash(
    JSON.stringify(
      scoped
        ? {
            pages: scoped.pages,
            boundaryContext: scoped.boundaryContext,
            cast: scoped.cast,
            sections: scoped.sections,
            style: c.style,
            continuity: c.continuity,
            decisions: decisionContext(c, scoped),
          }
        : {
            pages,
            cast: c.cast,
            sections: c.sections,
            style: c.style,
            continuity: c.continuity,
          },
    ) + fs.readFileSync(resolve(root, c.sourceFile)),
  );
  const base = { stage, target, protocol: 'two-phase-v1', images, contextHash };
  return { ...base, fingerprint: hash(JSON.stringify(base)) };
}

const recordFile = (c, request) =>
  `${c.workflowDir}/stage-reviews/first-reading/${request.stage}-${request.target}-${request.fingerprint}.json`;

export function saveFirstReading(root, c, request, response) {
  const current = firstReadingRequest(root, c, request.stage, request.target);
  assert.deepEqual(
    request,
    current,
    'First-reading inputs changed; prepare again',
  );
  assert.ok(
    response.reviewer?.role === 'subagent' && response.reviewer.task,
    'Record an actual subagent task',
  );
  assert.ok(
    Array.isArray(response.pages) &&
      response.pages.length === request.images.length,
    'Record the natural scan of every page',
  );
  for (const image of request.images) {
    const matches = response.pages.filter((p) => p.page === image.page);
    assert.equal(matches.length, 1, 'Missing or duplicate first-read page');
    const page = matches[0];
    assert.ok(
      typeof page.scan === 'string' && page.scan.trim(),
      'Describe the actual scan using locations and quoted text, without intended panel IDs',
    );
    assert.ok(
      typeof page.observation === 'string' && page.observation.trim(),
      'Record ambiguity, skipped answers and unreadable text, or evidence of clear flow',
    );
  }
  const record = {
    fingerprint: request.fingerprint,
    reviewer: response.reviewer,
    pages: response.pages,
  };
  const file = resolve(root, recordFile(c, request));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file))
    assert.deepEqual(
      JSON.parse(fs.readFileSync(file, 'utf8')),
      record,
      'First observation is immutable; fix the page and request a new reading',
    );
  else fs.writeFileSync(file, JSON.stringify(record, null, 2), { flag: 'wx' });
  return record;
}

export function loadFirstReading(root, c, stage, target = 'all') {
  const request = firstReadingRequest(root, c, stage, target);
  const name = recordFile(c, request);
  assert.ok(
    fs.existsSync(resolve(root, name)),
    'Record image-only first reading before preparing the comparison review',
  );
  const record = JSON.parse(fs.readFileSync(resolve(root, name), 'utf8'));
  assert.equal(
    record.fingerprint,
    request.fingerprint,
    'Stale first-reading record',
  );
  return {
    file: name,
    record,
    hash: hash(fs.readFileSync(resolve(root, name))),
  };
}

export function validateFirstComparison(root, c, stage, target, response) {
  if (!twoPhaseReading(c, stage)) return;
  const first = loadFirstReading(root, c, stage, target);
  assert.equal(
    response.readingReview?.firstReadingHash,
    first.hash,
    'Comparison must reference the immutable first observation',
  );
  assert.ok(
    typeof response.readingReview?.comparison === 'string' &&
      response.readingReview.comparison.trim(),
    'Compare the saved natural scan with the intended order; never replace the first observation',
  );
}
