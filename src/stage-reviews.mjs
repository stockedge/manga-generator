import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {
  scopedReview,
  scopedInputs,
  decisionContext,
} from './review-context.mjs';
import {
  twoPhaseReading,
  loadFirstReading,
  validateFirstComparison,
} from './first-reading.mjs';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export function productionMode(c) {
  const mode = c.productionMode ?? 'quality';
  assert.ok(
    ['quality', 'economy'].includes(mode),
    'Use productionMode quality or economy',
  );
  return mode;
}
export const reviewStages = [
  'source',
  'script',
  'storyboard',
  'artwork',
  'lettering',
  'final',
];
const selectedPages = (c, target) =>
  target === 'all'
    ? c.pages
    : c.pages.filter(
        (page) =>
          page.id === target ||
          page.panels.some((panel) => panel.id === target),
      );
export function reviewBoundaries(c, target = 'all') {
  const selected = new Set(
    selectedPages(c, target).flatMap((p) => p.panels.map((a) => a.id)),
  );
  const panels = c.pages.flatMap((p) => p.panels);
  return panels
    .slice(1)
    .flatMap((p, i) =>
      selected.has(p.id) || selected.has(panels[i].id)
        ? [{ from: panels[i].id, to: p.id }]
        : [],
    );
}
export function reviewInputs(c, configFile, stage, target = 'all') {
  const mode = productionMode(c);
  assert.ok(reviewStages.includes(stage), 'Unknown review stage');
  if (scopedReview(c, stage))
    return { ...scopedInputs(c, stage, target), configFile };
  const pages = selectedPages(c, target);
  assert.ok(pages.length, 'Unknown review target');
  /** @type {Record<string, any>} */
  const base = { stage, target, sourceFile: c.sourceFile };
  if (c.productionDecisions?.length) base.decisions = decisionContext(c);
  if (stage === 'script') {
    base.dialoguePolicy = 'source-dialogue-dependencies-v1';
    base.dialogueInstructions =
      'Compare every panel with the full original: retain the question before its answer, the referent before a pronoun, the apology before forgiveness, and the premise before a joke. Check speaker voice, emotional causality and text merged across intervening turns. Do not repair missing context from scene instructions alone. For pass return dialogueReview:{sourceCompared:true,panels:[{panel:panelId,observation:specific source comparison and dialogue dependency evidence}]} for every target panel, including silent panels. Unresolved or image-dependent issues cannot be certified from script alone.';
  }
  if (['storyboard', 'lettering', 'final'].includes(stage)) {
    base.readingPolicy = 'unnumbered-proximity-and-scene-transitions-v2';
    base.requiredTransitions = reviewBoundaries(c, target);
  }
  const files = [c.sourceFile];
  const optionalFiles = [];
  if (stage !== 'source') {
    const scriptPages =
      stage === 'script'
        ? pages.map((page) => ({
            id: page.id,
            purpose: page.purpose,
            expectation: page.expectation,
            section: page.section,
            showcase: page.showcase,
            panels: page.panels.map((panel) => ({
              id: panel.id,
              section: panel.section,
              scene: panel.scene,
              role: panel.role,
              beat: panel.beat,
              state: panel.state,
              transition: panel.transition,
              information: panel.information,
              pause: panel.pause,
              action: panel.action,
              emotion: panel.emotion,
              camera: panel.camera,
              production: panel.production,
              dialogue: panel.dialogue.map((d) => ({
                speaker: d.speaker,
                text: d.text,
                textColumns: d.textColumns,
                ...(d.textSizeRanges === undefined
                  ? {}
                  : { textSizeRanges: d.textSizeRanges }),
              })),
            })),
          }))
        : pages;
    base.script = {
      title: c.title,
      cast: c.cast,
      style: c.style,
      continuity: c.continuity,
      sections: c.sections,
      pages: scriptPages,
    };
    if (
      ['storyboard', 'lettering', 'final'].includes(stage) &&
      target !== 'all'
    ) {
      const selected = new Set(pages.map((p) => p.id)),
        ids = new Set(base.requiredTransitions.flatMap((t) => [t.from, t.to]));
      const context = c.pages.filter(
        (p) => !selected.has(p.id) && p.panels.some((a) => ids.has(a.id)),
      );
      base.boundaryContext = context;
      for (const page of context) {
        files.push(c.workflowDir + '/storyboards/page-' + page.id + '.svg');
        if (stage === 'storyboard')
          files.push(
            c.workflowDir + '/storyboards-unnumbered/page-' + page.id + '.svg',
          );
        if (stage !== 'storyboard') {
          optionalFiles.push(
            c.workflowDir + '/review/page-' + page.id + '.png',
          );
          for (const panel of page.panels)
            optionalFiles.push(c.assetDir + '/panels/' + panel.id + '.png');
        }
      }
    }
    if (stage === 'script') files.push(c.workflowDir + '/source-coverage.json');
    if (['storyboard', 'artwork', 'lettering', 'final'].includes(stage)) {
      files.push(...(c.references || []));
      for (const page of pages) {
        files.push(c.workflowDir + '/storyboards/page-' + page.id + '.svg');
        if (stage === 'storyboard')
          files.push(
            c.workflowDir + '/storyboards-unnumbered/page-' + page.id + '.svg',
            c.workflowDir + '/reading-flow/page-' + page.id + '.svg',
            c.workflowDir + '/reading-flow/page-' + page.id + '.json',
          );
        if (['artwork', 'lettering', 'final'].includes(stage))
          for (const panel of page.panels.filter(
            (panel) =>
              target === 'all' || target === page.id || panel.id === target,
          ))
            files.push(c.assetDir + '/panels/' + panel.id + '.png');
        if (['lettering', 'final'].includes(stage))
          files.push(c.workflowDir + '/review/page-' + page.id + '.png');
      }
    }
    if (stage === 'final')
      files.push(c.outputDir + '/reader.html', c.outputDir + '/pdf/manga.pdf');
  }
  // Preserve legacy fingerprints when no mode was selected explicitly.
  if (c.productionMode !== undefined) base.productionMode = mode;
  if (
    mode === 'economy' &&
    ['storyboard', 'artwork', 'lettering'].includes(stage)
  ) {
    const context = [...pages, ...(base.boundaryContext || [])];
    const actors = new Set();
    const sections = new Set();
    const explicit = new Set();
    for (const page of context) {
      if (page.section) sections.add(page.section);
      for (const file of page.references || []) explicit.add(file);
      for (const panel of page.panels) {
        if (panel.section) sections.add(panel.section);
        for (const id of Object.keys(panel.speakers || {})) actors.add(id);
        for (const d of panel.dialogue || []) actors.add(d.speaker);
        for (const id of Object.keys(panel.production?.hands || {}))
          actors.add(id);
        for (const file of panel.references || []) explicit.add(file);
        for (const file of panel.state?.references || []) explicit.add(file);
      }
    }
    // Shared or unclassified references remain: only unrelated dedicated face sheets are removed.
    const keep = (file) => {
      const owners = Object.entries(c.cast || {}).filter(
        ([, a]) => a.faceDesign?.reference === file,
      );
      return (
        c.referenceRoles?.[file] !== 'identity' ||
        explicit.has(file) ||
        !owners.length ||
        owners.some(([id]) => actors.has(id)) ||
        Object.values(c.sections || {}).some((s) =>
          s.references?.includes(file),
        )
      );
    };
    base.script.cast = Object.fromEntries(
      Object.entries(c.cast || {}).filter(([id]) => actors.has(id)),
    );
    base.script.sections = Object.fromEntries(
      Object.entries(c.sections || {}).filter(([id]) => sections.has(id)),
    );
    base.inputPolicy = 'scoped-settings-v1';
    return {
      base,
      files: [...new Set(files)].filter(keep),
      optionalFiles: [...new Set(optionalFiles)],
      configFile,
    };
  }
  // Configuration is embedded per target so unrelated page edits do not stale a
  // finished panel review. Every file the reviewer receives is hash-checked.
  return {
    base,
    files: [...new Set(files)],
    optionalFiles: [...new Set(optionalFiles)],
    configFile,
  };
}
export function reviewMaterial(
  root,
  c,
  configFile,
  stage,
  target = 'all',
  sourceDocuments = null,
) {
  const input = reviewInputs(c, configFile, stage, target);
  const dependencyFiles = [];
  if (scopedReview(c, stage)) {
    const coverageFile = `${c.workflowDir}/source-coverage.json`;
    for (const file of [c.sourceFile, coverageFile])
      assert.ok(
        path.resolve(root, file).startsWith(path.resolve(root) + path.sep),
        'Source context escapes workspace',
      );
    const source = sourceDocuments
      ? sourceDocuments.source
      : fs.readFileSync(path.resolve(root, c.sourceFile), 'utf8');
    const coverage = sourceDocuments
      ? sourceDocuments.coverage
      : fs.existsSync(path.resolve(root, coverageFile))
        ? JSON.parse(fs.readFileSync(path.resolve(root, coverageFile), 'utf8'))
        : null;
    if (coverage) {
      let end = 0;
      const knownPanels = new Set(
        c.pages.flatMap((page) => page.panels.map((panel) => panel.id)),
      );
      const valid =
        coverage.sourceHash === hash(Buffer.from(source)) &&
        Array.isArray(coverage.spans) &&
        coverage.spans.every((s) => {
          const okay =
            Number.isInteger(s.start) &&
            Number.isInteger(s.end) &&
            s.start === end &&
            s.end > s.start &&
            s.end <= source.length &&
            Array.isArray(s.panels) &&
            s.panels.length &&
            s.panels.every((id) => knownPanels.has(id));
          end = s.end;
          return okay;
        }) &&
        end === source.length;
      const spans = valid
        ? coverage.spans.filter((s) =>
            s.panels.some((id) => input.base.contextPanels.includes(id)),
          )
        : [];
      if (
        spans.length &&
        input.base.contextPanels.every((id) =>
          spans.some((s) => s.panels.includes(id)),
        )
      ) {
        input.base.sourceExcerpts = spans.map((s) => ({
          start: s.start,
          end: s.end,
          text: source.slice(s.start, s.end),
        }));
        input.files = input.files.filter((file) => file !== c.sourceFile);
        dependencyFiles.push(c.sourceFile, coverageFile);
      } else
        input.base.sourceFallback =
          'Full source: coverage is incomplete, stale or missing context panels.';
    } else input.base.sourceFallback = 'Full source: no source coverage map.';
  }
  return { ...input, dependencyFiles };
}

export function captureReview(root, c, configFile, stage, target = 'all') {
  const { dependencyFiles, ...input } = reviewMaterial(
    root,
    c,
    configFile,
    stage,
    target,
  );
  if (twoPhaseReading(c, stage)) {
    const first = loadFirstReading(root, c, stage, target);
    Object.assign(input.base, {
      readingProtocol: 'two-phase-v1',
      firstReading: first.record,
      firstReadingHash: first.hash,
    });
    input.files.push(first.file);
    const pages =
      target === 'all'
        ? c.pages
        : c.pages.filter(
            (page) =>
              page.id === target || page.panels.some((p) => p.id === target),
          );
    input.files.push(
      ...pages.map((page) =>
        stage === 'storyboard'
          ? `${c.workflowDir}/storyboards-unnumbered/page-${page.id}.png`
          : stage === 'final'
            ? `${c.outputDir}/page-${page.id}.png`
            : `${c.workflowDir}/review/page-${page.id}.png`,
      ),
    );
  }
  const optional = new Set(input.optionalFiles);
  const entries = Object.fromEntries(
    [
      ...new Set([...input.files, ...input.optionalFiles, ...dependencyFiles]),
    ].map((name) => {
      const file = path.resolve(root, name);
      assert.ok(
        file.startsWith(path.resolve(root) + path.sep),
        'Review file escapes workspace',
      );
      if (optional.has(name) && !fs.existsSync(file)) return [name, null];
      assert.ok(fs.existsSync(file), 'Missing review input: ' + name);
      return [name, hash(fs.readFileSync(file))];
    }),
  );
  return {
    ...input,
    files: [
      ...new Set([
        ...input.files,
        ...input.optionalFiles.filter((f) => entries[f] !== null),
      ]),
    ],
    entries,
    fingerprint: hash(JSON.stringify({ base: input.base, entries })),
  };
}
export function requireReview(root, c, configFile, stage, target = 'all') {
  if (!c.productionReview?.required) return;
  const current = captureReview(root, c, configFile, stage, target);
  const file = path.resolve(
    root,
    c.workflowDir,
    'stage-reviews',
    stage + '-' + target + '.json',
  );
  assert.ok(
    fs.existsSync(file),
    'Missing subagent review: ' + stage + '/' + target,
  );
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(
    record.fingerprint,
    current.fingerprint,
    'Stale subagent review: ' + stage + '/' + target,
  );
  assert.equal(
    record.status,
    'pass',
    'Subagent requested changes: ' + stage + '/' + target,
  );
  assert.ok(
    Array.isArray(record.issues) &&
      record.issues.every((issue) => issue.resolved === true),
    'Unresolved subagent review issues',
  );
  assert.ok(
    Array.isArray(record.observations) && record.observations.length >= 2,
    'Missing specific review observations',
  );
  assert.ok(
    record.reviewer?.task && record.reviewer?.role === 'subagent',
    'Missing actual subagent identity',
  );
  validateDialogueReview(c, stage, target, record);
  validateReadingReview(c, stage, target, record);
  validateFirstComparison(root, c, stage, target, record);
}

export function validateDialogueReview(c, stage, target, record) {
  if (stage !== 'script' || record.status !== 'pass') return;
  const review = record.dialogueReview;
  assert.equal(
    review?.sourceCompared,
    true,
    'Compare dialogue selection and dependencies with the full original',
  );
  const panels = selectedPages(c, target).flatMap((page) => page.panels);
  assert.ok(
    Array.isArray(review.panels) && review.panels.length === panels.length,
    'Record source dialogue review for every target panel',
  );
  for (const panel of panels) {
    const matches = review.panels.filter((item) => item.panel === panel.id);
    assert.ok(
      matches.length === 1 &&
        typeof matches[0].observation === 'string' &&
        matches[0].observation.trim(),
      'Missing or duplicate dialogue observation: ' + panel.id,
    );
  }
}

export function validateReadingReview(c, stage, target, record) {
  if (
    !['storyboard', 'lettering', 'final'].includes(stage) ||
    record.status !== 'pass'
  )
    return;
  const r = record.readingReview;
  assert.equal(
    r?.withoutGuides,
    true,
    'Inspect reading order without numbered guides first',
  );
  assert.ok(
    Array.isArray(r.observations) && r.observations.length >= 2,
    'Record natural reading and proximity observations',
  );
  const expected = reviewBoundaries(c, target);
  assert.ok(
    Array.isArray(r.transitions) &&
      r.transitions.length === expected.length &&
      r.transitions.every(
        (t) =>
          t.from &&
          t.to &&
          typeof t.observation === 'string' &&
          t.observation.trim(),
      ),
    'Record every real scene/action transition, including continuous scenes',
  );
  for (const pair of expected)
    assert.equal(
      r.transitions.filter((t) => t.from === pair.from && t.to === pair.to)
        .length,
      1,
      'Missing or duplicate transition: ' + pair.from + ' -> ' + pair.to,
    );
  const panels = (
    target === 'all'
      ? c.pages
      : c.pages.filter(
          (p) => p.id === target || p.panels.some((a) => a.id === target),
        )
  ).flatMap((p) => p.panels);
  assert.ok(
    Array.isArray(r.predictedOrder) &&
      r.predictedOrder.length === panels.length,
    'Record predicted reading order for every target panel',
  );
  for (const p of panels) {
    const matches = r.predictedOrder.filter((a) => a.panel === p.id);
    assert.equal(
      matches.length,
      1,
      'Missing or duplicate predicted panel: ' + p.id,
    );
    assert.deepEqual(
      matches[0].dialogue,
      p.dialogue.map((_, i) => i + 1),
      'Natural reading differs from intended order: ' + p.id,
    );
  }
}
