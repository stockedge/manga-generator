import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  createTemporary,
  cleanupTemporary,
  removeTemporary,
  cacheRoot,
} from '../src/temporary.mjs';

const active = createTemporary('test');
const stale = createTemporary('test');
const linked = createTemporary('test');
try {
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { createTemporary } from ${JSON.stringify(new URL('../src/temporary.mjs', import.meta.url).href)}; console.log(createTemporary('test').folder); throw new Error('setup failed');`,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, MANGA_KEEP_TEST_TMP: '0' },
    },
  );
  assert.notEqual(child.status, 0);
  assert.ok(
    !fs.existsSync(child.stdout.trim()),
    'Setup failure must clean its test cache on exit',
  );
  const owner = path.join(stale.folder, '.owner.json');
  const marker = JSON.parse(fs.readFileSync(owner, 'utf8'));
  marker.createdAt -= 2 * 86400000;
  fs.writeFileSync(owner, JSON.stringify(marker));
  cleanupTemporary();
  assert.ok(fs.existsSync(stale.folder), 'Active owner must survive');
  marker.pid = 2147483647;
  marker.childPid = process.pid;
  fs.writeFileSync(owner, JSON.stringify(marker));
  cleanupTemporary();
  assert.ok(fs.existsSync(stale.folder), 'Active browser must survive');
  delete marker.childPid;
  fs.writeFileSync(owner, JSON.stringify(marker));
  assert.ok(cleanupTemporary().includes(stale.folder));
  assert.ok(!fs.existsSync(stale.folder));
  assert.ok(fs.existsSync(active.folder));
  assert.throws(
    () => removeTemporary(path.dirname(cacheRoot)),
    /outside cache/,
  );
  fs.symlinkSync(
    active.folder,
    path.join(linked.folder, 'redirect'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.throws(() => removeTemporary(linked.folder), /redirected/);
  assert.ok(fs.existsSync(active.folder), 'Link target must survive');
  fs.unlinkSync(path.join(linked.folder, 'redirect'));
  active.cleanup();
  assert.ok(!fs.existsSync(active.folder));
  console.log(
    'PASS: temporary cleanup preserves active owners, browser children, redirected paths and outside paths; reclaims stale owned cache',
  );
} finally {
  active.cleanup();
  stale.cleanup();
  linked.cleanup();
}
