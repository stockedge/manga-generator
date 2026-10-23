import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { loadProject } from '../src/project.mjs';
const { root, config, configFile, local } = loadProject();
import {
  firstReadingRequest,
  saveFirstReading,
  validateFirstComparison,
} from '../src/first-reading.mjs';
import {
  captureReview,
  requireReview,
  validateReadingReview,
  validateDialogueReview,
} from '../src/stage-reviews.mjs';
const [mode, stage, target = 'all', input] = process.argv.slice(2);
const folder = config.workflowDir + '/stage-reviews';
fs.mkdirSync(local(folder), { recursive: true });
if (mode === 'enable') {
  config.productionReview = {
    required: true,
    reviewer: 'subagent',
    stages: ['source', 'script', 'storyboard', 'artwork', 'lettering', 'final'],
  };
  fs.writeFileSync(local(configFile), JSON.stringify(config, null, 2));
  console.log(
    'Enabled actual subagent review requirements; existing reviews have not been fabricated.',
  );
} else if (mode === 'prepare-reading') {
  const request = firstReadingRequest(root, config, stage, target);
  const file =
    folder + '/requests/first-reading-' + request.fingerprint + '.json';
  fs.mkdirSync(path.dirname(local(file)), { recursive: true });
  if (!fs.existsSync(local(file)))
    fs.writeFileSync(local(file), JSON.stringify(request, null, 2), {
      flag: 'wx',
    });
  console.log(
    JSON.stringify(
      {
        request: file,
        inputs: request.images.map((image) => local(image.file)),
        instructions:
          'A real subagent first inspects ONLY these unnumbered images. Do not read the source, script, configuration or flow guides yet. Return {request,reviewer:{role:"subagent",task:"actual task name"},pages:[{page:"01",scan:"Natural scan in sequence: image locations and quoted dialogue, including silent reactions",observation:"Specific proximity/acting evidence; ambiguity, skipped answers and unreadable text if present"}]}. Do not infer expected panel IDs or correct your scan to match a plan. This is an observation, not a pass certificate.',
      },
      null,
      2,
    ),
  );
} else if (mode === 'record-reading') {
  assert.ok(input, 'Use record-reading STAGE TARGET RESPONSE.json');
  const response = JSON.parse(fs.readFileSync(local(input), 'utf8'));
  const request = JSON.parse(fs.readFileSync(local(response.request), 'utf8'));
  assert.equal(request.stage, stage);
  assert.equal(request.target, target);
  saveFirstReading(root, config, request, response);
  console.log('Saved immutable image-only first reading');
} else if (mode === 'prepare') {
  const request = captureReview(root, config, configFile, stage, target);
  const file =
    folder +
    '/requests/' +
    stage +
    '-' +
    target +
    '-' +
    request.fingerprint +
    '.json';
  fs.mkdirSync(path.dirname(local(file)), { recursive: true });
  if (!fs.existsSync(local(file)))
    fs.writeFileSync(local(file), JSON.stringify(request, null, 2), {
      flag: 'wx',
    });
  console.log(
    JSON.stringify(
      {
        request: file,
        inputs: request.files.map((file) => local(file)),
        requiredTransitions: request.base.requiredTransitions,
        ...(request.base.firstReading
          ? {
              firstReading: request.base.firstReading,
              firstReadingHash: request.base.firstReadingHash,
              comparisonInstructions:
                'Compare the immutable natural scan above with the intended script and order. Keep the original scan unchanged. Return readingReview.firstReadingHash and readingReview.comparison explaining agreements, skips and ambiguities; unresolved differences require changes-requested.',
            }
          : {}),
        unavailableBoundaryImages: request.optionalFiles.filter(
          (f) => request.entries[f] === null,
        ),
        instructions:
          'A real subagent must read source/script and inspect applicable images. First inspect unnumbered images without flow overlays; record the order a reader would naturally predict, considering proximity clusters, whole conversation rows, faces and gestures. Then compare with intended order. Inspect scene/time/place/flashback and action/object transitions, including adjacent pages. Required transitions include incoming and outgoing boundary context. Every required pair must be recorded exactly once; zero pairs use []. Some adjacent actual images may not exist yet: inspect the provided plan, explicitly record that limitation, and never certify an unavailable image. Creating those images later stales this review. Do not pass unresolved skips or abrupt unexplained changes. Return request, reviewer:{role:subagent,task:actual task name}, status:pass or changes-requested, observations:[specific observations], issues:[{problem,location,resolved:false}]. For storyboard/lettering/final pass include readingReview:{withoutGuides:true,predictedOrder:[{panel:panelId,dialogue:[1,2,...]}] for EVERY target panel, observations:[specific natural-scan and proximity evidence], transitions:[{from:panelId,to:panelId,observation:actual continuity evidence}]}. Empty dialogue panels use []. This records actual inspection, not a blinded experiment or an automatic readability guarantee. Do not claim inspection from command success.',
      },
      null,
      2,
    ),
  );
} else if (mode === 'record') {
  assert.ok(input, 'Use record STAGE TARGET RESPONSE.json');
  const response = JSON.parse(fs.readFileSync(local(input), 'utf8'));
  const request = JSON.parse(fs.readFileSync(local(response.request), 'utf8'));
  const current = captureReview(root, config, configFile, stage, target);
  assert.equal(request.base.stage, stage);
  assert.equal(request.base.target, target);
  assert.equal(
    request.fingerprint,
    current.fingerprint,
    'Reviewed inputs changed; request a fresh review',
  );
  assert.ok(
    response.reviewer?.role === 'subagent' && response.reviewer.task,
    'Record an actual subagent task',
  );
  assert.ok(['pass', 'changes-requested'].includes(response.status));
  assert.ok(
    Array.isArray(response.observations) && response.observations.length >= 2,
    'Save specific review observations',
  );
  assert.ok(Array.isArray(response.issues));
  if (response.status === 'pass')
    assert.ok(
      response.issues.every((issue) => issue.resolved === true),
      'Unresolved review issues',
    );
  validateDialogueReview(config, stage, target, response);
  validateReadingReview(config, stage, target, response);
  validateFirstComparison(root, config, stage, target, response);
  const record = {
    ...response,
    fingerprint: current.fingerprint,
    recordedAt: new Date().toISOString(),
  };
  const archive =
    folder +
    '/history/' +
    stage +
    '-' +
    target +
    '-' +
    crypto.randomUUID() +
    '.json';
  fs.mkdirSync(path.dirname(local(archive)), { recursive: true });
  fs.writeFileSync(local(archive), JSON.stringify(record, null, 2), {
    flag: 'wx',
  });
  fs.writeFileSync(
    local(folder + '/' + stage + '-' + target + '.json'),
    JSON.stringify(record, null, 2),
  );
  console.log('Recorded ' + stage + '/' + target + ': ' + record.status);
} else if (mode === 'check') {
  if (!config.productionReview?.required)
    console.log(
      'Subagent review gate is not enabled for this existing work; no review was certified.',
    );
  else {
    requireReview(root, config, configFile, stage, target);
    console.log('Current subagent review: ' + stage + '/' + target);
  }
} else
  throw new Error(
    'Use enable | prepare-reading STAGE [TARGET] | record-reading STAGE TARGET RESPONSE.json | prepare STAGE [TARGET] | record STAGE TARGET RESPONSE.json | check STAGE [TARGET]',
  );
