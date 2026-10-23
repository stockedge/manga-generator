import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const run = (...args) =>
  execFileSync(process.execPath, ['cli/workflow.mjs', ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
import { loadProject } from '../src/project.mjs';
const { config, configFile, root } = loadProject();
process.chdir(root);
const outputDir = config.outputDir || 'output-v2';
const before = fs.readFileSync(outputDir + '/manifest.json', 'utf8');
run('build');
assert.equal(
  fs.readFileSync(outputDir + '/manifest.json', 'utf8'),
  before,
  'Repeated build changed output hashes',
);
const original = fs.readFileSync(configFile, 'utf8');
const output = fs.readFileSync(
  outputDir + '/page-' + config.pages[0].id + '.svg',
  'utf8',
);
try {
  const changed = JSON.parse(original);
  changed.pages[0].purpose += ' altered';
  fs.writeFileSync(configFile, JSON.stringify(changed));
  assert.match(run('status'), new RegExp(config.pages[0].id + ': stale'));
  assert.throws(() => run('build'));
  assert.equal(
    fs.readFileSync(outputDir + '/page-' + config.pages[0].id + '.svg', 'utf8'),
    output,
    'Failed build overwrote output',
  );
} finally {
  fs.writeFileSync(configFile, original);
}
assert.ok(
  run('status')
    .split('\n')
    .filter(Boolean)
    .every((s) => s.endsWith('ready')),
);
/** @type {Record<string, {src?: string, disabled?: boolean, click?: () => void, addEventListener(event: string, fn: () => void): void}>} */
const elements = Object.fromEntries(
  ['page', 'next', 'prev', 'position'].map((id) => [
    id,
    {
      addEventListener(event, fn) {
        this[event] = fn;
      },
    },
  ]),
);
const viewer = fs.readFileSync(outputDir + '/reader.html', 'utf8');
vm.runInNewContext(viewer.match(/<script>([\s\S]*?)<\/script>/)[1], {
  document: { getElementById: (id) => elements[id], addEventListener() {} },
  window: { scrollTo() {} },
});
assert.equal(elements.page.src, 'page-' + config.pages[0].id + '.svg');
assert.ok(elements.prev.disabled);
if (config.pages.length > 1) {
  elements.next.click();
  assert.equal(elements.page.src, 'page-' + config.pages[1].id + '.svg');
  elements.prev.click();
  assert.equal(elements.page.src, 'page-' + config.pages[0].id + '.svg');
}
for (let i = 0; i < config.pages.length + 1; i++) elements.next.click();
assert.ok(elements.next.disabled);
assert.equal(elements.page.src, 'page-' + config.pages.at(-1).id + '.svg');
console.log(
  'PASS: repeatable output, changed plan blocked before writes, reader boundaries',
);
