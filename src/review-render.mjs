import { reviewInputs } from './stage-reviews.mjs';

// Existence is insufficient after insertion/reordering: page IDs can be reused.
// Refresh the exact visual context before either phase snapshots its hashes.
export function refreshStoryboardInputs(config, configFile, target, run) {
  const input = reviewInputs(config, configFile, 'storyboard', target);
  const pages = new Set(
    [...input.base.script.pages, ...(input.base.boundaryContext || [])].map(
      (page) => page.id,
    ),
  );
  run('cli/workflow.mjs', ['plan']);
  for (const page of pages)
    run('cli/export.mjs', [
      config.workflowDir + '/storyboards-unnumbered',
      page,
    ]);
  return [...pages];
}
