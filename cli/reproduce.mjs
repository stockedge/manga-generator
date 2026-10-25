import { runtimeFiles } from '../src/runtime-files.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pack } from '../src/archive.mjs';

import { root } from '../src/workspace.mjs';
process.chdir(root);
const digest = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (file, ...args) =>
  execFileSync(process.execPath, [file, ...args], {
    stdio: 'inherit',
    windowsHide: true,
  });
import { loadProject } from '../src/project.mjs';
const { config, configFile } = loadProject();
const output = config.outputDir || 'output-v2';
const lockFile = configFile.replace(/\.json$/, '.lock.json');
const files = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? files(dir + '/' + e.name) : [dir + '/' + e.name],
    );
const hashes = (names) =>
  Object.fromEntries([...new Set(names)].sort().map((f) => [f, digest(f)]));
function verify(entries) {
  for (const [f, expected] of Object.entries(entries)) {
    assert.ok(
      !path.isAbsolute(f) && !f.split(/[\\/]/).includes('..'),
      'Unsafe package path',
    );
    assert.ok(fs.existsSync(f), 'Missing saved input: ' + f);
    assert.equal(digest(f), expected, 'Changed saved input/output: ' + f);
  }
}
const command = process.argv[2] || 'reproduce';
if (command === 'freeze') {
  run('cli/workflow.mjs', 'check');
  run('cli/workflow.mjs', 'build');
  if (fs.existsSync(output + '/layers')) run('cli/workflow.mjs', 'layers');
  const refs = ['jobs.json', 'panel-jobs.json']
    .flatMap((name) =>
      JSON.parse(
        fs.readFileSync(
          (config.workflowDir || 'workflow') + '/' + name,
          'utf8',
        ),
      ),
    )
    .flatMap((j) =>
      j.references.filter(
        (f) => !f.startsWith((config.workflowDir || 'workflow') + '/'),
      ),
    );
  const generationLog =
    (config.workflowDir || 'workflow') + '/reaction-generation.json';
  const actualRefs = fs.existsSync(generationLog)
    ? JSON.parse(fs.readFileSync(generationLog, 'utf8')).generated.flatMap(
        (j) => j.references,
      )
    : [];
  // Review renders are derivatives, not production inputs; retain their source and review records.
  const productionFiles = files(config.workflowDir || 'workflow').filter(
    (f) =>
      !(
        /\/review\/page-\d{2}\.(svg|png)$/.test(f) ||
        (f.includes('/quality/') && f.endsWith('.png'))
      ),
  );
  const inputs = [
    configFile,
    'package.json',
    'LICENSE',
    'works/sample/workflow.json',
    config.sourceFile || 'source/original.txt',
    'REPRODUCE.md',
    'README.md',
    'AGENTS.md',
    ...runtimeFiles(root),
    ...files('docs'),
    ...refs,
    ...actualRefs,
    ...files(config.assetDir || 'assets/v2').filter(
      (file) =>
        process.argv.includes('--full-history') ||
        !/\/(?:history|candidates)\//.test(
          file.slice((config.assetDir || 'assets/v2').length),
        ),
    ),
    ...productionFiles,
  ];
  const outputs = files(output).filter((f) => /\.(svg|html|png|pdf)$/.test(f));
  fs.writeFileSync(
    lockFile,
    JSON.stringify(
      {
        version: 1,
        packageScope: process.argv.includes('--full-history')
          ? 'production'
          : 'distribution',
        node: process.version,
        platform: process.platform,
        config: configFile,
        output,
        inputs: hashes(inputs),
        outputs: hashes(outputs),
        note: 'AI output is frozen as accepted assets. SVG/HTML hashes are reproducible; stored PNG is the visual reference. New image generation is not deterministic.',
      },
      null,
      2,
    ),
  );
  console.log('Saved exact inputs and outputs in ' + lockFile);
} else {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  verify(lock.inputs);
  if (command === 'reproduce') {
    run('cli/workflow.mjs', 'check');
    run('cli/workflow.mjs', 'build');
    if (
      Object.keys(lock.outputs).some((f) => f.startsWith(output + '/layers/'))
    )
      run('cli/workflow.mjs', 'layers');
    verify(
      Object.fromEntries(
        Object.entries(lock.outputs).filter(([f]) => /\.(svg|html)$/.test(f)),
      ),
    );
    run('tests/verify-workflow.mjs');
    console.log('PASS: frozen inputs rebuilt identical SVG and HTML');
  } else if (command === 'bundle') {
    verify(lock.outputs);
    const destination = path.join(
      root,
      'releases',
      path.basename(path.dirname(configFile)) +
        '-v' +
        config.version +
        '-' +
        digest(lockFile).slice(0, 8),
    );
    if (process.argv.includes('--compressed')) {
      const archive = destination + '.tar.gz';
      await pack(archive, {
        ...lock.inputs,
        ...lock.outputs,
        [lockFile]: digest(lockFile),
      });
      console.log('Verified portable archive: ' + archive);
      process.exit(0);
    }
    assert.ok(
      !fs.existsSync(destination),
      'Release exists; preserve it and choose a new version',
    );
    for (const file of [
      ...new Set([
        ...Object.keys(lock.inputs),
        ...Object.keys(lock.outputs),
        lockFile,
      ]),
    ]) {
      const target = path.join(destination, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
    // Run from the copy to prove that no original absolute paths are needed.
    execFileSync(
      process.execPath,
      [path.join(destination, 'cli/reproduce.mjs'), 'reproduce'],
      { cwd: destination, stdio: 'inherit', windowsHide: true },
    );
    console.log('Verified portable release: ' + destination);
  } else if (command === 'check') {
    verify(lock.outputs);
    console.log('PASS: all saved input and output hashes match');
  } else throw new Error('Use freeze | reproduce | bundle | check');
}
