import { createTemporary } from '../src/temporary.mjs';
import { copyRuntime } from './support.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { root } from '../src/workspace.mjs';
const temporary = createTemporary('test');
const fixture = temporary.folder;
try {
  copyRuntime(root, fixture, [
    'cli/auto.mjs',
    'cli/new-work.mjs',
    'cli/stage-review.mjs',
    'src/project.mjs',
    'src/quality.mjs',
    'src/prompts.mjs',
    'src/face-design.mjs',
    'src/state-history.mjs',
    'src/stage-reviews.mjs',
    'src/review-context.mjs',
    'src/review-progress.mjs',
    'src/cli-output.mjs',
    'src/first-reading.mjs',
    'src/production-preflight.mjs',
    'src/lettering.mjs',
    'src/workspace.mjs',
    'src/runtime-files.mjs',
  ]);
  const run = (args, project) =>
    execFileSync(
      process.execPath,
      [path.join(fixture, 'cli/auto.mjs'), ...args],
      {
        cwd: fixture,
        env: { ...process.env, MANGA_PROJECT: project || '' },
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      },
    );
  const original = path.join(fixture, 'original.txt'),
    text = '一人の店主が手紙を受け取る。\n「また会おう」\n翌朝、店を出た。';
  const digest = (b) => crypto.createHash('sha256').update(b).digest('hex');
  fs.writeFileSync(original, '\uFEFF' + text);
  const expected = `works/auto-${digest(Buffer.from(text)).slice(0, 12)}/workflow.json`;
  assert.match(run(['start', original]), /Prepared:/);
  const full = path.join(fixture, expected),
    first = fs.readFileSync(full);
  assert.equal(
    fs.readFileSync(
      path.join(path.dirname(full), 'source', 'original.txt'),
      'utf8',
    ),
    text,
  );
  assert.equal(JSON.parse(first.toString('utf8')).renderMode, 'panels');
  assert.match(run(['start', original]), /Resume:/);
  assert.deepEqual(fs.readFileSync(full), first, 'Resume overwrote script');
  assert.throws(() => run(['start', original, '--title', 'different']));
  assert.equal(JSON.parse(first.toString('utf8')).productionMode, 'quality');
  assert.throws(() => run(['start', original, '--mode', 'economy']));
  assert.throws(() => run(['start', original, '--mode', 'invalid']));
  const economySource = path.join(fixture, 'economy.txt');
  fs.writeFileSync(economySource, text + '\n節約モードの別作品。');
  assert.match(run(['start', economySource, '--mode', 'economy']), /Prepared:/);
  const economySlug =
    'auto-' + digest(fs.readFileSync(economySource)).slice(0, 12);
  const economyFile = `works/${economySlug}/workflow.json`;
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(fixture, economyFile), 'utf8'))
      .productionMode,
    'economy',
  );
  assert.match(run(['start', economySource, '--mode', 'economy']), /Resume:/);
  const switchMode = (...args) =>
    execFileSync(
      process.execPath,
      [path.join(fixture, 'cli/stage-review.mjs'), 'mode', ...args],
      {
        cwd: fixture,
        env: { ...process.env, MANGA_PROJECT: economyFile },
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
      },
    );
  assert.throws(() => switchMode());
  assert.throws(() => switchMode('invalid'));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(fixture, economyFile), 'utf8'))
      .productionMode,
    'economy',
  );
  assert.match(switchMode('quality'), /Production mode: quality/);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(fixture, economyFile), 'utf8'))
      .productionMode,
    'quality',
  );
  assert.match(run(['start', economySource, '--mode', 'quality']), /Resume:/);
  const empty = path.join(fixture, 'empty.txt');
  fs.writeFileSync(empty, ' ');
  assert.throws(() => run(['start', empty]));
  const invalid = path.join(fixture, 'invalid.txt');
  fs.writeFileSync(invalid, Buffer.from([0xff, 0xfe]));
  assert.throws(() => run(['start', invalid]));
  assert.throws(() => run(['status']));
  assert.throws(() => run(['status'], '../outside.json'));
  assert.equal(
    JSON.parse(run(['status'], expected)).status,
    'needs-script-or-references',
    'Intake cannot be marked complete',
  );
  assert.throws(
    () => run(['finish'], expected),
    'Missing source coverage passed',
  );
  const coverage = path.join(
    path.dirname(full),
    'workflow',
    'source-coverage.json',
  );
  const save = (v) => fs.writeFileSync(coverage, JSON.stringify(v));
  save({
    sourceHash: digest(Buffer.from(text)),
    spans: [
      {
        start: 1,
        end: text.length,
        panels: ['01-1'],
        adaptation: '店主の出発までの出来事を絵で描く',
      },
    ],
  });
  assert.throws(
    () => run(['finish'], expected),
    (e) =>
      String(e instanceof Error && 'stderr' in e ? e.stderr : e).includes(
        'Source coverage has a gap or overlap',
      ),
    'Gap in source coverage passed',
  );
  save({
    sourceHash: digest(Buffer.from(text)),
    spans: [
      {
        start: 0,
        end: text.length,
        panels: ['unknown'],
        adaptation: '店主の出発までの出来事を絵で描く',
      },
    ],
  });
  assert.throws(
    () => run(['finish'], expected),
    (e) =>
      String(e instanceof Error && 'stderr' in e ? e.stderr : e).includes(
        'Coverage needs actual panels',
      ),
    'Nonexistent source panel passed',
  );
  save({
    sourceHash: digest(Buffer.from(text)),
    spans: [
      {
        start: 0,
        end: text.length - 1,
        panels: ['01-1'],
        adaptation: '店主の出発までの出来事を絵で描く',
      },
    ],
  });
  assert.throws(
    () => run(['finish'], expected),
    (e) =>
      String(e instanceof Error && 'stderr' in e ? e.stderr : e).includes(
        'Cover the entire supplied original',
      ),
    'Truncated source coverage passed',
  );
  save({
    sourceHash: digest(Buffer.from(text)),
    spans: [
      {
        start: 0,
        end: text.length,
        panels: ['01-1'],
        adaptation: '店主の出発までの出来事を絵で描く',
      },
    ],
  });
  assert.throws(
    () => run(['finish'], expected),
    (e) =>
      String(e instanceof Error && 'stderr' in e ? e.stderr : e).includes(
        'generation-log.json',
      ),
    'Missing generation evidence passed',
  );
  const logPath = path.join(
    path.dirname(full),
    'workflow',
    'generation-log.json',
  );
  const panelIds = JSON.parse(fs.readFileSync(full, 'utf8')).pages.flatMap(
    (p) => p.panels.map((q) => q.id),
  );
  const writeLog = (r) =>
    fs.writeFileSync(
      logPath,
      JSON.stringify({
        sourceHash: digest(Buffer.from(text)),
        panels: panelIds.map((id) => ({ panel: id, renderer: r })),
      }),
    );
  writeLog('unreviewed-renderer');
  assert.throws(
    () => run(['finish'], expected),
    (e) =>
      String(e instanceof Error && 'stderr' in e ? e.stderr : e).includes(
        'renderer',
      ),
    'Undeclared renderer passed',
  );
  const declared = JSON.parse(fs.readFileSync(full, 'utf8'));
  declared.generation = { renderer: 'unreviewed-renderer' };
  fs.writeFileSync(full, JSON.stringify(declared));
  assert.throws(
    () => run(['finish'], expected),
    (e) =>
      !String(e instanceof Error && 'stderr' in e ? e.stderr : e).includes(
        'renderer',
      ),
    'Declared renderer failed its own check',
  );
  fs.rmSync(logPath);
  fs.appendFileSync(
    path.join(path.dirname(full), 'source', 'original.txt'),
    '変更',
  );
  assert.throws(() => run(['status'], expected), 'Changed original passed');
  assert.ok(
    !fs.existsSync(path.join(path.dirname(full), 'automation.json')),
    'Test falsely completed a work',
  );
  // Isolated status fixture: enforce chunked archive reads and reject corruption.
  fs.writeFileSync(
    path.join(path.dirname(full), 'source', 'original.txt'),
    text,
  );
  fs.writeFileSync(
    path.join(fixture, 'cli/workflow.mjs'),
    "console.log('01: ready');\n",
  );
  fs.writeFileSync(
    path.join(fixture, 'cli/reproduce.mjs'),
    "console.log('fixture reproduction check');\n",
  );
  const archive = path.join(fixture, 'archive.tar.gz'),
    bytes = Buffer.alloc(3 * 1024 * 1024 + 17, 0x5a);
  bytes[bytes.length - 1] = 0x31;
  fs.writeFileSync(archive, bytes);
  const completion = path.join(path.dirname(full), 'automation.json');
  fs.writeFileSync(
    completion,
    JSON.stringify({
      status: 'complete',
      deliverables: { 'archive.tar.gz': digest(bytes) },
    }),
  );
  const guard = path.join(fixture, 'guard-archive-read.mjs');
  fs.writeFileSync(
    guard,
    "import fs from 'node:fs';const read=fs.readFileSync;fs.readFileSync=function(f,...args){if(String(f).endsWith('archive.tar.gz'))throw new Error('Whole archive read forbidden');return read.call(this,f,...args);};\n",
  );
  const guardedStatus = () =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(guard).href,
          path.join(fixture, 'cli/auto.mjs'),
          'status',
        ],
        {
          cwd: fixture,
          env: { ...process.env, MANGA_PROJECT: expected },
          encoding: 'utf8',
          windowsHide: true,
        },
      ),
    );
  assert.equal(
    guardedStatus().status,
    'complete',
    'Chunked hashing must handle multiple chunks and the final short chunk',
  );
  const fd = fs.openSync(archive, 'r+');
  fs.writeSync(fd, Buffer.from([0x32]), 0, 1, bytes.length - 1);
  fs.closeSync(fd);
  assert.equal(
    guardedStatus().status,
    'in-progress',
    'Corrupted archive passed',
  );
  fs.unlinkSync(archive);
  assert.equal(guardedStatus().status, 'in-progress', 'Missing archive passed');
  fs.unlinkSync(completion);
  console.log(
    'PASS: automatic intake, BOM/UTF-8, stable resume, isolated works, explicit selection, coverage gaps, changed-source rejection and chunked archive hash/corruption/missing checks; status stubs are isolated fixtures, no actual work completed',
  );

  const externalSource = path.join(fixture, 'external.txt');
  fs.writeFileSync(externalSource, text + '\nExternal renderer test.');
  assert.match(
    run([
      'start',
      externalSource,
      '--renderer',
      'ComfyUI+Qwen-Image-Edit-2511-FP8',
    ]),
    /Prepared:/,
  );
  const externalId = digest(fs.readFileSync(externalSource)).slice(0, 12);
  const externalBase = path.join(
    fixture,
    'works',
    'auto-' + externalId,
    'workflow',
  );
  const externalRequest = JSON.parse(
    fs.readFileSync(path.join(externalBase, 'automation-request.json'), 'utf8'),
  );
  assert.equal(externalRequest.renderer, 'ComfyUI+Qwen-Image-Edit-2511-FP8');
  assert.equal(
    externalRequest.execution,
    'External renderer: ComfyUI+Qwen-Image-Edit-2511-FP8',
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(externalBase, 'automatic-task.md'), 'utf8'),
    /Codexの実行手順/,
  );
  assert.throws(() =>
    run(['start', externalSource, '--renderer', 'another renderer']),
  );
} finally {
  temporary.cleanup();
}
