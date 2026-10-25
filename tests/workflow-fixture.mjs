import { createTemporary } from '../src/temporary.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { copyRuntime } from './support.mjs';

// Blank regression material, never artwork or evidence of visual inspection.
function blankPNG() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    const size = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1024);
  header.writeUInt32BE(1536, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((1024 * 3 + 1) * 1536, 255);
  for (let y = 0; y < 1536; y++) rows[y * (1024 * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function captureWorkflow(runtimeRoot) {
  const temporary = createTemporary('test');
  const base = temporary.folder;
  try {
    let folder;
    const hashes = {},
      image = blankPNG();
    const write = (file, data) => {
      const full = path.join(folder, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
    };
    const collect = (dir, prefix) => {
      for (const entry of fs.readdirSync(path.join(folder, dir), {
        withFileTypes: true,
      })) {
        const file = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) collect(file, prefix);
        else if (file !== 'fixture/output/manifest.json')
          hashes[prefix + '/' + file] = crypto
            .createHash('sha256')
            .update(fs.readFileSync(path.join(folder, file)))
            .digest('hex');
      }
    };
    for (const mode of ['page', 'panels'])
      for (const modern of [false, true]) {
        folder = path.join(base, mode + (modern ? '-modern' : '-legacy'));
        copyRuntime(runtimeRoot, folder);
        const c = JSON.parse(
          fs.readFileSync(
            path.join(runtimeRoot, 'works/sample/workflow.json'),
            'utf8',
          ),
        );
        Object.assign(c, {
          renderMode: mode,
          references: ['fixture/reference.png'],
          sourceFile: 'fixture/source.txt',
          workflowDir: 'fixture/workflow',
          assetDir: 'fixture/assets',
          outputDir: 'fixture/output',
        });
        if (modern) c.promptPolicy = { version: 2 };
        c.sections = {
          shop: {
            location: 'small shop',
            costumes: { a: 'white shirt', b: 'black coat' },
            objects: { letter: 'sealed' },
          },
        };
        const page = c.pages[0],
          panel = page.panels[1];
        page.section = 'shop';
        panel.state = {
          costumes: { b: 'white coat' },
          objects: { letter: 'opened' },
        };
        Object.assign(panel.dialogue[0], {
          text: '覚えている。',
          textColumns: ['覚えて', 'いる。'],
          textDirection: 'horizontal',
          textSizeRanges: [{ start: 0, end: 2, fontSize: 22 }],
        });
        write('fixture/workflow.json', JSON.stringify(c));
        write(
          'fixture/source.txt',
          'Synthetic original for refactoring regression.',
        );
        write('fixture/reference.png', image);
        write('blank.png', image);
        const run = (...args) =>
          execFileSync(
            process.execPath,
            [path.join(folder, 'cli/workflow.mjs'), ...args],
            {
              cwd: folder,
              env: { ...process.env, MANGA_PROJECT: 'fixture/workflow.json' },
              encoding: 'utf8',
              stdio: 'pipe',
              windowsHide: true,
            },
          );
        run('plan');
        if (mode === 'page')
          run(
            'accept',
            '01',
            'blank.png',
            '--reviewed',
            '--reason',
            'Synthetic fixture',
          );
        else
          for (const p of page.panels)
            run(
              'accept-panel',
              p.id,
              'blank.png',
              '--reviewed',
              '--reason',
              'Synthetic fixture',
            );
        run('preview');
        run('review', '01', '--speakers', '--faces', '--order', '--continuity');
        run('build');
        run('layers');
        const prefix = mode + (modern ? '-modern' : '-legacy');
        collect('fixture/workflow', prefix);
        collect('fixture/output', prefix);
        hashes[prefix + '/layout'] = crypto
          .createHash('sha256')
          .update(run('layout', 'all'))
          .digest('hex');
      }
    return Object.fromEntries(
      Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)),
    );
  } finally {
    temporary.cleanup();
  }
}
