import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadProject } from '../src/project.mjs';
const { root, local } = loadProject();
import { compactSVG } from '../src/compact-svg.mjs';

for (const relative of process.argv.slice(2)) {
  const file = local(relative);
  assert.ok(
    !file.startsWith(path.join(root, 'releases') + path.sep),
    'Preserve immutable releases',
  );
  assert.ok(file.endsWith('.svg'), 'Expected SVG');
  const before = fs.readFileSync(file, 'utf8'),
    after = compactSVG(before);
  if (after !== before) fs.writeFileSync(file, after);
  console.log(
    relative +
      ': ' +
      Math.round((before.length - after.length) / 1048576) +
      ' MiB saved',
  );
}
