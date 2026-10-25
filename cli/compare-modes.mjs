import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root } from '../src/workspace.mjs';
import { reviewMaterial } from '../src/stage-reviews.mjs';
import { reviewTargets } from '../src/review-progress.mjs';

const args = process.argv.slice(2);
assert.ok(
  !args.length || (args.length === 2 && args[0] === '--output'),
  'Use compare-modes [--output REPORT.json]',
);
const output = path.resolve(
  root,
  args[1] || 'docs/metrics/production-mode-comparison.json',
);
assert.ok(
  output.startsWith(root + path.sep),
  'Save comparison inside workspace',
);
const empty = () => ({
  scriptAndSourceCharacters: 0,
  otherTextCharacters: 0,
  imageInputs: 0,
  availableImageInputs: 0,
  pdfInputs: 0,
  fullSourceFallbacks: 0,
  reviewCalls: 0,
});
const versions = {
  quality: (c) => ({ ...c, productionMode: 'quality' }),
  previousEconomy: (c) => ({
    ...c,
    productionMode: 'economy',
    reviewPolicy: undefined,
  }),
  economy: (c) => ({
    ...c,
    productionMode: 'economy',
    reviewPolicy: { version: 3 },
  }),
};
const totals = Object.fromEntries(
  Object.keys(versions).map((key) => [key, empty()]),
);
const cache = new Map();
const existence = new Map();
const exists = (file) => {
  const full = path.resolve(root, file),
    directory = path.dirname(full);
  if (!existence.has(directory))
    existence.set(
      directory,
      fs.existsSync(directory) ? new Set(fs.readdirSync(directory)) : new Set(),
    );
  return existence.get(directory).has(path.basename(full));
};
const chars = (file) => {
  if (!cache.has(file))
    cache.set(
      file,
      fs.existsSync(path.resolve(root, file))
        ? fs.readFileSync(path.resolve(root, file), 'utf8').length
        : 0,
    );
  return cache.get(file);
};
const rows = [];
for (const entry of fs.readdirSync(path.join(root, 'works'), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory() || ['sample', 'qwen-r18-trial'].includes(entry.name))
    continue;
  const file = `works/${entry.name}/workflow.json`;
  if (!fs.existsSync(path.resolve(root, file))) continue;
  const original = JSON.parse(
    fs.readFileSync(path.resolve(root, file), 'utf8'),
  );
  if (
    !original.pages?.length ||
    !original.sourceFile ||
    !fs.existsSync(path.resolve(root, original.sourceFile))
  )
    continue;
  const result = {
    work: entry.name,
    pages: original.pages.length,
    panels: original.pages.flatMap((p) => p.panels).length,
    modes: {},
    simulatedDialogueEdit: {},
  };
  const stages = reviewTargets(original);
  const coverageFile = path.resolve(
    root,
    original.workflowDir,
    'source-coverage.json',
  );
  const documents = {
    source: fs.readFileSync(path.resolve(root, original.sourceFile), 'utf8'),
    coverage: fs.existsSync(coverageFile)
      ? JSON.parse(fs.readFileSync(coverageFile, 'utf8'))
      : null,
  };
  const middle = original.pages
    .flatMap((p) => p.panels)
    .filter((p) => p.dialogue.length);
  const editedId = middle[Math.floor(middle.length / 2)]?.id;
  for (const [version, configure] of Object.entries(versions)) {
    const c = configure(original),
      count = empty(),
      stageCounts = {};
    const changed = structuredClone(c);
    if (editedId)
      changed.pages
        .flatMap((p) => p.panels)
        .find((p) => p.id === editedId).dialogue[0].text += '〔比較用の変更〕';
    let affected = 0;
    for (const { stage, target } of stages) {
      const input = reviewMaterial(root, c, file, stage, target, documents);
      count.reviewCalls++;
      count.scriptAndSourceCharacters +=
        JSON.stringify(input.base).length +
        (input.files.includes(c.sourceFile) ? chars(c.sourceFile) : 0);
      if (input.base.sourceFallback) count.fullSourceFallbacks++;
      const files = [...new Set([...input.files, ...input.optionalFiles])];
      for (const name of files) {
        if (/\.(png|jpe?g|webp)$/i.test(name)) {
          count.imageInputs++;
          if (exists(name)) count.availableImageInputs++;
        } else if (/\.pdf$/i.test(name)) count.pdfInputs++;
        else if (name !== c.sourceFile && /\.json$/i.test(name))
          count.otherTextCharacters += chars(name);
      }
      const changedInput = reviewMaterial(
        root,
        changed,
        file,
        stage,
        target,
        documents,
      );
      if (JSON.stringify(input) !== JSON.stringify(changedInput)) {
        affected++;
        stageCounts[stage] = (stageCounts[stage] || 0) + 1;
      }
    }
    result.modes[version] = count;
    result.simulatedDialogueEdit[version] = {
      panel: editedId,
      affectedReviews: affected,
      stages: stageCounts,
    };
    for (const key of Object.keys(count)) totals[version][key] += count[key];
  }
  rows.push(result);
  process.stderr.write(`Compared ${rows.length}: ${entry.name}\n`);
}
const reduction = (before, after) =>
  before ? +((100 * (before - after)) / before).toFixed(2) : 0;
const report = {
  measuredAt: new Date().toISOString(),
  workCount: rows.length,
  measurement:
    'Deterministic planned review input sizes, not billed tokens or a new manga production run',
  assumptions: [
    'Each source/script/final review once, artwork per panel, storyboard/lettering per page.',
    'Same current works, source and saved files for all modes; no production files modified.',
    'Image-only first readings, their responses, generation, reasoning, output, cache and repair retries are excluded.',
    'Other text counts JSON inputs only; raw SVG/HTML markup and embedded binary data are excluded.',
    'Unavailable image paths are counted separately from available inputs.',
    'Simulated edit compares request material, not a claim that a reviewer ran.',
  ],
  totals,
  simulatedDialogueEdits: Object.fromEntries(
    Object.keys(versions).map((version) => [
      version,
      rows.reduce(
        (sum, row) => sum + row.simulatedDialogueEdit[version].affectedReviews,
        0,
      ),
    ]),
  ),
  reductions: {
    comparableScriptAndSourcePct: reduction(
      totals.quality.scriptAndSourceCharacters,
      totals.economy.scriptAndSourceCharacters,
    ),
    previousEconomyScriptAndSourcePct: reduction(
      totals.quality.scriptAndSourceCharacters,
      totals.previousEconomy.scriptAndSourceCharacters,
    ),
    jsonAndSourceTextPct: reduction(
      totals.quality.scriptAndSourceCharacters +
        totals.quality.otherTextCharacters,
      totals.economy.scriptAndSourceCharacters +
        totals.economy.otherTextCharacters,
    ),
    imageInputCountPct: reduction(
      totals.quality.imageInputs,
      totals.economy.imageInputs,
    ),
  },
  rows,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      report: path.relative(root, output),
      works: rows.length,
      reductions: report.reductions,
      totals,
    },
    null,
    2,
  ),
);
