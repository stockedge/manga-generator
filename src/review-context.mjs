import assert from 'node:assert/strict';

export const scopedReview = (c, stage) =>
  c.productionMode === 'economy' &&
  c.reviewPolicy?.version === 3 &&
  ['storyboard', 'artwork', 'lettering'].includes(stage);

export function reviewContext(c, stage, target) {
  const all = c.pages.flatMap((page) =>
    page.panels.map((panel) => ({ page, panel })),
  );
  const selected = all.filter(
    ({ page, panel }) =>
      target === 'all' ||
      (stage === 'artwork'
        ? panel.id === target || page.id === target
        : page.id === target),
  );
  assert.ok(selected.length, 'Unknown review target');
  const ids = new Set(selected.map(({ panel }) => panel.id));
  const context = new Set(ids);
  for (let i = 0; i < all.length; i++)
    if (ids.has(all[i].panel.id)) {
      if (i) context.add(all[i - 1].panel.id);
      if (i + 1 < all.length) context.add(all[i + 1].panel.id);
    }
  // Explicit distant dependencies are transitive; cycles terminate in the set.
  for (const id of context) {
    const entry = all.find(({ panel }) => panel.id === id);
    assert.ok(entry, 'Unknown review dependency: ' + id);
    for (const dependency of entry.panel.reviewDependencies || []) {
      assert.ok(
        all.some(({ panel }) => panel.id === dependency),
        'Unknown review dependency: ' + dependency,
      );
      context.add(dependency);
    }
  }
  const entries = all.filter(({ panel }) => context.has(panel.id));
  const pages = c.pages
    .filter((page) => selected.some((e) => e.page.id === page.id))
    .map((page) => ({
      ...page,
      panels: page.panels.filter((panel) => ids.has(panel.id)),
    }));
  const boundaryContext = c.pages
    .map((page) => ({
      ...page,
      panels: page.panels.filter(
        (panel) => context.has(panel.id) && !ids.has(panel.id),
      ),
    }))
    .filter((page) => page.panels.length);
  const actors = new Set(
    entries.flatMap(({ panel }) => [
      ...Object.keys(panel.speakers || {}),
      ...panel.dialogue.map((d) => d.speaker),
      ...Object.keys(panel.production?.hands || {}),
    ]),
  );
  const sections = new Set(
    entries
      .map(({ page, panel }) => panel.section || page.section)
      .filter(Boolean),
  );
  return {
    ids,
    context,
    entries,
    pages,
    boundaryContext,
    cast: Object.fromEntries(
      Object.entries(c.cast || {}).filter(([id]) => actors.has(id)),
    ),
    sections: Object.fromEntries(
      Object.entries(c.sections || {}).filter(([id]) => sections.has(id)),
    ),
  };
}

export function decisionContext(c, context = null) {
  const records = c.productionDecisions || [];
  const seen = new Set();
  for (const d of records) {
    assert.ok(
      d.id &&
        !seen.has(d.id) &&
        typeof d.text === 'string' &&
        d.text.trim() &&
        typeof d.reason === 'string' &&
        d.reason.trim(),
      'Decisions need unique id, text and reason',
    );
    seen.add(d.id);
    assert.ok(
      ['preference', 'rejected', 'continuity'].includes(d.kind),
      'Unknown decision kind',
    );
    for (const key of Object.keys(d.scope || {})) {
      assert.ok(
        ['panels', 'pages', 'actors', 'sections'].includes(key) &&
          Array.isArray(d.scope[key]),
        'Unknown decision scope',
      );
      const known =
        key === 'panels'
          ? c.pages.flatMap((p) => p.panels.map((a) => a.id))
          : key === 'pages'
            ? c.pages.map((p) => p.id)
            : Object.keys(c[key === 'actors' ? 'cast' : 'sections'] || {});
      assert.ok(
        d.scope[key].length && d.scope[key].every((id) => known.includes(id)),
        'Unknown decision scope target',
      );
    }
  }
  if (!context) return records;
  return records.filter(
    (d) =>
      !Object.keys(d.scope || {}).length ||
      d.scope.panels?.some((id) => context.context.has(id)) ||
      d.scope.pages?.some((id) =>
        context.entries.some((e) => e.page.id === id),
      ) ||
      d.scope.actors?.some((id) => Object.hasOwn(context.cast, id)) ||
      d.scope.sections?.some((id) => Object.hasOwn(context.sections, id)),
  );
}

/** @returns {{base: Record<string, any>, files: string[], optionalFiles: string[]}} */
export function scopedInputs(c, stage, target) {
  const context = reviewContext(c, stage, target);
  const files = [],
    optionalFiles = [],
    explicit = new Set();
  const add = (file, optional = false) =>
    (optional ? optionalFiles : files).push(file);
  for (const { page, panel } of context.entries) {
    for (const file of [
      ...(page.references || []),
      ...(panel.references || []),
      ...(panel.state?.references || []),
      ...(c.sections?.[panel.section || page.section]?.references || []),
    ])
      explicit.add(file);
    if (stage === 'artwork')
      add(`${c.assetDir}/panels/${panel.id}.png`, !context.ids.has(panel.id));
  }
  const refs = [
    ...new Set([
      ...(c.references || []),
      ...explicit,
      ...Object.values(context.cast)
        .map((a) => a.faceDesign?.reference)
        .filter(Boolean),
    ]),
  ];
  for (const file of refs) {
    const owners = Object.entries(c.cast || {}).filter(
      ([, a]) => a.faceDesign?.reference === file,
    );
    if (
      explicit.has(file) ||
      c.referenceRoles?.[file] !== 'identity' ||
      !owners.length ||
      owners.some(([id]) => Object.hasOwn(context.cast, id))
    )
      add(file);
  }
  if (stage !== 'artwork') {
    for (const page of context.pages) {
      if (stage === 'storyboard') {
        add(`${c.workflowDir}/storyboards-unnumbered/page-${page.id}.png`);
        add(`${c.workflowDir}/reading-flow/page-${page.id}.json`);
      } else add(`${c.workflowDir}/review/page-${page.id}.png`);
    }
    for (const page of context.boundaryContext)
      if (!context.pages.some((p) => p.id === page.id))
        add(
          stage === 'storyboard'
            ? `${c.workflowDir}/storyboards-unnumbered/page-${page.id}.png`
            : `${c.workflowDir}/review/page-${page.id}.png`,
          true,
        );
  }
  const all = c.pages.flatMap((p) => p.panels);
  const transitions = all
    .slice(1)
    .flatMap((p, i) =>
      context.ids.has(p.id) || context.ids.has(all[i].id)
        ? [{ from: all[i].id, to: p.id }]
        : [],
    );
  return {
    base: {
      stage,
      target,
      productionMode: 'economy',
      inputPolicy: 'scoped-context-v3',
      sourceFile: c.sourceFile,
      script: {
        title: c.title,
        cast: context.cast,
        sections: context.sections,
        style: c.style,
        continuity: c.continuity,
        pages: context.pages,
      },
      boundaryContext: context.boundaryContext,
      decisions: decisionContext(c, context),
      ...(stage === 'artwork'
        ? {}
        : {
            requiredTransitions: transitions,
            readingPolicy: 'unnumbered-proximity-and-scene-transitions-v2',
          }),
      contextPanels: [...context.context],
    },
    files: [c.sourceFile, ...new Set(files)],
    optionalFiles: [...new Set(optionalFiles)],
  };
}
