import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { root } from '../src/workspace.mjs';
import { captureReview } from '../src/stage-reviews.mjs';
import { executeReview } from '../src/review-runner.mjs';

const [configFile, panel] = process.argv.slice(2);
assert.ok(
  configFile && panel,
  'Use measure-review WORKFLOW.json PANEL; this runs two real independent reviews',
);
assert.equal(
  process.env.MANGA_PROJECT,
  configFile,
  'Set MANGA_PROJECT explicitly to the measured work',
);
const configPath = path.resolve(root, configFile);
assert.ok(configPath.startsWith(root + path.sep), 'Work escapes workspace');
const original = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const directory = 'tmp/review-comparison-' + crypto.randomUUID();
fs.mkdirSync(path.resolve(root, directory), { recursive: true });
const reportFile = path.resolve(
  root,
  'docs/metrics/measured-review-comparison.json',
);
const report = {
  work: configFile,
  panel,
  stage: 'artwork',
  kind: 'Actual paired isolated reviewer runs on the same saved panel; no production acceptance or review record is changed',
  order: ['quality', 'economy'],
  limitations: [
    'One sample, one run per mode; output and reasoning vary.',
    'Cache warmth may differ; input and cached tokens are reported separately.',
    'This excludes script, generation, lettering, final review, repairs and other production stages.',
  ],
  runs: [],
};
try {
  for (const mode of report.order) {
    const c = {
      ...original,
      productionMode: mode,
      reviewPolicy: { version: 3 },
    };
    const request = captureReview(root, c, configFile, 'artwork', panel);
    const file = `${directory}/request-${mode}.json`;
    fs.writeFileSync(
      path.resolve(root, file),
      JSON.stringify(request, null, 2),
      { flag: 'wx' },
    );
    const startedAt = new Date().toISOString();
    const result = executeReview(
      root,
      { ...c, workflowDir: directory },
      {
        request: file,
        instructions:
          'Inspect the actual target panel and supplied references. Compare identity, acting, hands, props and scene continuity with the provided script, source and decisions. The context may include adjacent panels; inspect them where supplied. Do not claim inspection of unavailable images. Return {request,reviewer:{role:"subagent",task:"actual task"},status:"pass" or "changes-requested",observations:[at least two specific observations],issues:[{problem,location,resolved:false}]}. Do not create or edit production approvals. Return JSON only.',
      },
    );
    const execution = JSON.parse(
      fs.readFileSync(path.resolve(root, result.log), 'utf8'),
    );
    const usage = {};
    for (const turn of execution.usage)
      for (const [key, value] of Object.entries(turn))
        if (typeof value === 'number') usage[key] = (usage[key] || 0) + value;
    report.runs.push({
      mode,
      startedAt,
      completedAt: new Date().toISOString(),
      promptCharacters: execution.promptCharacters,
      imageCount: execution.imageCount,
      responseStatus: result.response.status,
      usage,
      usageMeasured: execution.usageMeasured,
      response: result.file,
      log: result.log,
    });
    console.log(JSON.stringify(report.runs.at(-1)));
  }
  if (report.runs.every((run) => run.usageMeasured)) {
    const [quality, economy] = report.runs;
    report['inputReductionPct'] =
      (100 * (quality.usage.input_tokens - economy.usage.input_tokens)) /
      quality.usage.input_tokens;
    const q = quality.usage.input_tokens + quality.usage.output_tokens,
      e = economy.usage.input_tokens + economy.usage.output_tokens;
    report['inputAndOutputReductionPct'] = (100 * (q - e)) / q;
  }
} catch (error) {
  report['error'] = error.message;
  process.exitCode = 1;
} finally {
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log('Measurement saved: ' + path.relative(root, reportFile));
}
