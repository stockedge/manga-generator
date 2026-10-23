import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { trackState } from './state-history.mjs';
import { root } from './workspace.mjs';
export { root };
export function local(file) {
  assert.ok(
    typeof file === 'string' && file.length && !path.isAbsolute(file),
    'Project paths must be relative',
  );
  const resolved = path.resolve(root, file);
  assert.ok(
    resolved.startsWith(root + path.sep),
    'Project path escapes workspace',
  );
  return resolved;
}
export function loadProject(
  configFile = process.env.MANGA_PROJECT || 'works/kensei/workflow.json',
) {
  trackState(root, configFile);
  const config = JSON.parse(fs.readFileSync(local(configFile), 'utf8'));
  return { root, config, configFile, local };
}
