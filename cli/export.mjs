import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createTemporary } from '../src/temporary.mjs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

import { root } from '../src/workspace.mjs';
const chrome =
  process.env.MANGA_BROWSER ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((p) => fs.existsSync(p));
assert.ok(chrome, 'Set MANGA_BROWSER to a Chrome or Edge executable');
import { loadProject } from '../src/project.mjs';
const { config: configured } = loadProject();
const selected = process.argv[2] || 'output';
const targetDir =
  selected === 'current'
    ? configured.outputDir || 'output-v2'
    : selected === 'storyboards'
      ? (configured.workflowDir || 'workflow') + '/storyboards'
      : selected;
const story =
  targetDir === 'output'
    ? JSON.parse(fs.readFileSync(path.join(root, 'story.json'), 'utf8'))
    : configured;
const items = targetDir.endsWith('/panels')
  ? story.pages.flatMap((p) =>
      p.panels.map((q) => ({ id: q.id, width: q.rect[2], height: q.rect[3] })),
    )
  : story.pages;
const scaleAt = process.argv.indexOf('--scale'),
  scale = scaleAt < 0 ? 1 : Number(process.argv[scaleAt + 1]);
assert.ok([0.25, 1, 2].includes(scale), 'Use --scale 0.25, 1 or 2');
async function screenshot(args, file, width, height, temporary) {
  const child = spawn(chrome, args, { stdio: 'ignore', windowsHide: true });
  temporary.setChild(child.pid);
  let failure,
    exited = false,
    closed = false;
  const stopped = new Promise((resolve) =>
    child.once('close', () => {
      closed = true;
      resolve(undefined);
    }),
  );
  child.on('error', (error) => {
    failure = error;
  });
  child.on('exit', (code, signal) => {
    exited = true;
    if (code && !signal) failure = new Error('Browser exited with ' + code);
  });
  const start = Date.now();
  try {
    while (Date.now() - start < 45000) {
      if (fs.existsSync(file)) {
        let bytes;
        try {
          bytes = fs.readFileSync(file);
        } catch (error) {
          if (!['EBUSY', 'EACCES', 'EPERM'].includes(error.code)) throw error;
        }
        if (
          bytes &&
          bytes.length >= 32 &&
          bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          bytes.subarray(-8, -4).equals(Buffer.from('IEND'))
        ) {
          assert.equal(bytes.readUInt32BE(16), width);
          assert.equal(bytes.readUInt32BE(20), height);
          return bytes;
        }
      }
      if (failure) throw failure;
      if (exited && !fs.existsSync(file))
        throw new Error('Browser produced no complete screenshot');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Browser screenshot timed out');
  } finally {
    if (!closed) child.kill();
    await Promise.race([
      stopped,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    if (!closed) child.unref();
    else temporary.cleanup();
  }
}
const selection = process.argv[3]?.startsWith('--') ? null : process.argv[3];
assert.ok(
  !selection || items.some((p) => p.id === selection),
  'Unknown export selection: ' + selection,
);
const extra = process.argv.slice(selection === null ? 3 : 4);
assert.ok(
  extra.length === 0 || (extra.length === 2 && extra[0] === '--scale'),
  'Use one selection only, followed optionally by --scale 0.25, 1 or 2',
);
for (const page of items.filter((p) => !selection || p.id === selection)) {
  const width = Math.round((page.width || 1024) * scale),
    height = Math.round((page.height || 1536) * scale);
  const input = path.join(root, targetDir, `page-${page.id}.svg`);
  const output = path.join(
    root,
    targetDir,
    `page-${page.id}${scale === 1 ? '' : '-' + scale + 'x'}.png`,
  );
  const cache = createTemporary('browser');
  const temporary = path.join(cache.folder, 'screenshot.png');
  // A complete fresh screenshot is the result; Chrome shutdown is not.
  const bytes = await screenshot(
    [
      '--headless',
      '--disable-gpu',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      `--user-data-dir=${path.join(cache.folder, 'profile')}`,
      `--window-size=${page.width || 1024},${page.height || 1536}`,
      `--force-device-scale-factor=${scale}`,
      `--screenshot=${temporary}`,
      pathToFileURL(input).href,
    ],
    temporary,
    width,
    height,
    cache,
  );
  const staging = output + '.' + path.basename(cache.folder) + '.tmp.png';
  try {
    fs.writeFileSync(staging, bytes, { flag: 'wx' });
    fs.renameSync(staging, output);
  } finally {
    fs.rmSync(staging, { force: true });
  }
  console.log(`Exported page ${page.id}`);
}
