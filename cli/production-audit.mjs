import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { root } from '../src/workspace.mjs';
import { inspectProduction } from '../src/production-preflight.mjs';

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const inside = (relative) => {
  const file = path.resolve(root, relative);
  assert.ok(file.startsWith(root + path.sep), 'Path escapes workspace');
  return file;
};
const exists = (file) => fs.existsSync(inside(file));
function work(relative) {
  const config = read(inside(relative));
  const panels = config.pages.flatMap((p) => p.panels);
  const asset = config.assetDir;
  const saved = panels.filter(
    (p) =>
      exists(`${asset}/panels/${p.id}.png`) &&
      exists(`${asset}/panels/${p.id}.json`),
  );
  const pagesWithAllMaterials = config.pages.filter((page) =>
    page.panels.every((p) => saved.some((s) => s.id === p.id)),
  ).length;
  const reviewDir = `${config.workflowDir}/stage-reviews`;
  const countRecorded = (stage, targets) =>
    targets.filter((target) => {
      const file = `${reviewDir}/${stage}-${target}.json`;
      return exists(file) && read(inside(file)).status === 'pass';
    }).length;
  const completeFile = path.join(path.dirname(relative), 'automation.json');
  const completion = exists(completeFile) ? read(inside(completeFile)) : null;
  const lockFile = relative.replace(/\.json$/, '.lock.json');
  const lock =
    completion?.status === 'complete' && exists(lockFile)
      ? read(inside(lockFile))
      : null;
  const currentConfigMatchesCompletion = Boolean(
    lock &&
    lock.inputs?.[relative] ===
      crypto
        .createHash('sha256')
        .update(fs.readFileSync(inside(relative)))
        .digest('hex'),
  );
  const audit = inspectProduction(config);
  const sampleBytes = saved.reduce(
    (sum, p) => sum + fs.statSync(inside(`${asset}/panels/${p.id}.png`)).size,
    0,
  );
  return {
    project: relative,
    pages: config.pages.length,
    panels: panels.length,
    savedMaterials: saved.length,
    pagesWithAllMaterials,
    recordedReviews: {
      source: countRecorded('source', ['all']),
      script: countRecorded('script', ['all']),
      storyboard: countRecorded(
        'storyboard',
        config.pages.map((p) => p.id),
      ),
      artwork: countRecorded(
        'artwork',
        panels.map((p) => p.id),
      ),
      lettering: countRecorded(
        'lettering',
        config.pages.map((p) => p.id),
      ),
      final: countRecorded('final', ['all']),
    },
    completionRecorded: completion?.status === 'complete',
    currentConfigMatchesCompletion,
    estimatedRemainingPanelBytes: saved.length
      ? Math.ceil((sampleBytes / saved.length) * (panels.length - saved.length))
      : null,
    preflightWarnings: audit.warnings,
    preflight: audit.panels.filter((p) => p.issues.length),
    note: 'Saved materials and recorded reviews are presence counts, not current visual or hash verification. Config matching is not full package verification. The size estimate covers panel PNGs only.',
  };
}
function disk() {
  try {
    const s = fs.statfsSync(root, { bigint: true });
    return {
      freeBytes: String(s.bavail * s.bsize),
      totalBytes: String(s.blocks * s.bsize),
    };
  } catch {
    return { freeBytes: null, totalBytes: null };
  }
}
const [mode, target] = process.argv.slice(2);
if (mode === 'work') {
  const file = target || process.env.MANGA_PROJECT;
  assert.ok(file, 'Specify WORKFLOW.json or MANGA_PROJECT');
  console.log(JSON.stringify({ disk: disk(), work: work(file) }, null, 2));
} else if (mode === 'collection') {
  assert.match(target || '', /^[a-zA-Z0-9_-]+$/, 'Specify author ID');
  const manifest = read(inside(`collections/${target}/manifest.json`));
  const works = manifest.works
    .filter((w) => w.config)
    .map((w) => ({
      title: w.title,
      ...work(w.config),
    }));
  console.log(
    JSON.stringify(
      {
        disk: disk(),
        selected: manifest.works.length,
        completeRecorded: works.filter((w) => w.completionRecorded).length,
        currentConfigMatchesCompletion: works.filter(
          (w) => w.currentConfigMatchesCompletion,
        ).length,
        works,
      },
      null,
      2,
    ),
  );
} else
  throw new Error(
    'Use: production-audit work [WORKFLOW.json] | collection AUTHOR',
  );
