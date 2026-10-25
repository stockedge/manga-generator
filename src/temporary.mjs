import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

export const cacheRoot = path.resolve(
  process.env.MANGA_CACHE_DIR ||
    path.join(
      process.env.LOCALAPPDATA || os.tmpdir(),
      'manga-generator',
      'cache',
    ),
);
function safeTree(folder) {
  const stat = fs.lstatSync(folder);
  assert.ok(
    !stat.isSymbolicLink(),
    'Refuse redirected temporary path: ' + folder,
  );
  if (stat.isDirectory())
    for (const name of fs.readdirSync(folder))
      safeTree(path.join(folder, name));
}
function safeRoot() {
  for (let current = cacheRoot; ; current = path.dirname(current)) {
    if (fs.existsSync(current))
      assert.ok(
        !fs.lstatSync(current).isSymbolicLink(),
        'Refuse redirected cache root',
      );
    if (current === path.dirname(current)) break;
  }
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}
export function removeTemporary(folder) {
  safeRoot();
  assert.equal(
    path.dirname(path.resolve(folder)),
    cacheRoot,
    'Temporary path outside cache',
  );
  assert.match(path.basename(folder), /^(test|browser)-[0-9a-f-]{36}$/);
  if (!fs.existsSync(folder)) return;
  safeTree(folder);
  const marker = JSON.parse(
    fs.readFileSync(path.join(folder, '.owner.json'), 'utf8'),
  );
  assert.equal(marker.version, 1);
  assert.equal(marker.host, os.hostname());
  if (marker.pid !== process.pid && alive(marker.pid)) return;
  if (marker.childPid && alive(marker.childPid)) return;
  fs.rmSync(folder, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
export function cleanupTemporary() {
  safeRoot();
  const removed = [];
  if (!fs.existsSync(cacheRoot)) return removed;
  for (const name of fs.readdirSync(cacheRoot)) {
    if (!/^(test|browser)-[0-9a-f-]{36}$/.test(name)) continue;
    const folder = path.join(cacheRoot, name);
    try {
      if (fs.lstatSync(folder).isSymbolicLink()) continue;
      const file = path.join(folder, '.owner.json');
      if (fs.lstatSync(file).isSymbolicLink()) continue;
      const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        marker.version !== 1 ||
        marker.host !== os.hostname() ||
        !Number.isFinite(marker.createdAt) ||
        Date.now() - marker.createdAt < 86400000 ||
        alive(marker.pid)
      )
        continue;
      removeTemporary(folder);
      if (!fs.existsSync(folder)) removed.push(folder);
    } catch (error) {
      console.warn(
        'Temporary cache retained: ' + folder + ' (' + error.message + ')',
      );
    }
  }
  return removed;
}
export function createTemporary(kind) {
  assert.ok(['test', 'browser'].includes(kind));
  cleanupTemporary();
  fs.mkdirSync(cacheRoot, { recursive: true });
  const folder = path.join(cacheRoot, kind + '-' + crypto.randomUUID());
  fs.mkdirSync(folder);
  const marker = {
    version: 1,
    host: os.hostname(),
    pid: process.pid,
    createdAt: Date.now(),
  };
  const setChild = (childPid) =>
    fs.writeFileSync(
      path.join(folder, '.owner.json'),
      JSON.stringify({ ...marker, childPid }),
    );
  setChild(null);
  const cleanup = () => {
    if (kind === 'test') process.removeListener('exit', cleanup);
    if (kind === 'test' && process.env.MANGA_KEEP_TEST_TMP === '1') {
      console.warn('Test fixture retained: ' + folder);
      return;
    }
    try {
      removeTemporary(folder);
    } catch (error) {
      console.warn(
        'Temporary cache retained: ' + folder + ' (' + error.message + ')',
      );
    }
  };
  if (kind === 'test') process.once('exit', cleanup);
  return { folder, cleanup, setChild };
}
