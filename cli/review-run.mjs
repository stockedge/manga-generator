import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { loadProject } from '../src/project.mjs';
import { executeReview } from '../src/review-runner.mjs';
import { pendingReviews } from '../src/review-progress.mjs';
import { twoPhaseReading, loadFirstReading } from '../src/first-reading.mjs';
import { emitResult } from '../src/cli-output.mjs';
const { root, config, configFile, local } = loadProject();
const [stage, target = 'all'] = process.argv.slice(2);
const run = (...args) =>
  execFileSync(
    process.execPath,
    [path.join(root, 'cli/stage-review.mjs'), ...args],
    {
      cwd: root,
      env: { ...process.env, MANGA_PROJECT: configFile },
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    },
  );
const tasks =
  stage === 'pending'
    ? pendingReviews(root, config, configFile)
    : [{ stage, target }];
assert.ok(
  tasks.every((t) =>
    [
      'source',
      'script',
      'storyboard',
      'artwork',
      'lettering',
      'final',
    ].includes(t.stage),
  ),
  'Use review-run STAGE TARGET | pending',
);
const completed = [];
for (const task of tasks) {
  const dispatch = (first) => {
    const prepared = JSON.parse(
      run(
        first ? 'prepare-reading' : 'prepare',
        task.stage,
        task.target,
        '--verbose',
      ),
    );
    const result = executeReview(root, config, prepared);
    // The normal record command checks current hashes, required observations and all gates.
    run(
      first ? 'record-reading' : 'record',
      task.stage,
      task.target,
      result.file,
    );
    assert.ok(
      first || result.response.status === 'pass',
      'Review requested changes; see ' + result.file,
    );
    return result;
  };
  if (twoPhaseReading(config, task.stage)) {
    let missing = false;
    try {
      loadFirstReading(root, config, task.stage, task.target);
    } catch {
      missing = true;
    }
    if (missing) dispatch(true);
  }
  const result = dispatch(false);
  completed.push({ ...task, response: result.file, log: result.log });
}
emitResult(config, local, { status: 'reviewed', completed });
// File is retained for automation callers even when stdout is abbreviated.
fs.accessSync(local(configFile));
