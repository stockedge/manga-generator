import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { loadProject } from '../src/project.mjs';
import { imageFile } from '../src/assets.mjs';
import {
  optionalPolicy,
  intakeDraft,
  productionIndex,
  characterCards,
  cardsHTML,
  spreadPlan,
  deliveryPlan,
  generationSummary,
} from '../src/production-assist.mjs';
import { xml } from '../src/lettering.mjs';

const [mode, id, arg] = process.argv.slice(2);
if (!mode || mode === '--help') {
  console.log(
    'Explicit MANGA_PROJECT required. Use index NAME | intake NAME brief.json | cards NAME | spreads NAME [frontMatter] | delivery NAME | external NAME PANEL | return NAME returned.png | edit/mask/fit/layout/psd/unpack/anthology NAME spec.json. Image/PSD helpers require MANGA_PYTHON (Pillow; PSD also psd-tools). All outputs are optional drafts under workflow/assistance/NAME; never publish or accept automatically.',
  );
} else {
  assert.ok(process.env.MANGA_PROJECT, 'Select MANGA_PROJECT explicitly');
  const { config: c, configFile, local, root } = loadProject();
  assert.match(
    id || '',
    /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,
    'Use a new safe output name',
  );
  const directory = local(`${c.workflowDir}/assistance/${id}`);
  assert.ok(
    directory.startsWith(path.dirname(local(configFile)) + path.sep),
    'Assistance must stay within selected work',
  );
  const workRoot = fs.realpathSync(path.dirname(local(configFile)));
  let ancestor = directory;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const resolvedOutput = path.resolve(
    fs.realpathSync(ancestor),
    path.relative(ancestor, directory),
  );
  assert.ok(
    resolvedOutput.startsWith(workRoot + path.sep),
    'Assistance output follows a link outside the selected work',
  );
  const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const read = (f) => {
    const file = local(f);
    assert.ok(
      fs.realpathSync(file).startsWith(fs.realpathSync(root) + path.sep),
      'Input follows a link outside workspace',
    );
    return fs.readFileSync(file);
  };
  const json = (f) => JSON.parse(read(f).toString('utf8'));
  const sourceConfigHash = hash(read(configFile));
  function save(name, value) {
    fs.writeFileSync(
      path.join(directory, name),
      typeof value === 'string' || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value, null, 2) + '\n',
      { flag: 'wx' },
    );
  }
  function png(file) {
    read(file);
    const bytes = imageFile(local(file));
    return {
      bytes,
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      sha256: hash(bytes),
    };
  }
  if (
    ['edit', 'mask', 'fit', 'layout', 'psd', 'unpack', 'anthology'].includes(
      mode,
    )
  ) {
    assert.ok(
      process.env.MANGA_PYTHON,
      'Set MANGA_PYTHON with Pillow; PSD exchange also needs psd-tools',
    );
    execFileSync(
      process.env.MANGA_PYTHON,
      [path.join(root, 'scripts/editor-exchange.py'), mode, id, arg],
      {
        cwd: root,
        env: { ...process.env, MANGA_NODE: process.execPath },
        windowsHide: true,
        stdio: 'inherit',
      },
    );
  } else if (mode === 'return') {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'),
    );
    const ticketEntry = manifest.files.find(
      (f) => f.file === 'edit-ticket.json',
    );
    assert.ok(ticketEntry, 'Missing edit ticket provenance');
    assert.equal(
      hash(fs.readFileSync(path.join(directory, 'edit-ticket.json'))),
      ticketEntry.sha256,
      'Edit ticket changed',
    );
    const ticket = JSON.parse(
      fs.readFileSync(path.join(directory, 'edit-ticket.json'), 'utf8'),
    );
    assert.equal(
      ticket.configHash,
      sourceConfigHash,
      'Work changed during external editing; prepare a new ticket',
    );
    assert.equal(
      hash(read(ticket.original)),
      ticket.originalHash,
      'Original changed during editing',
    );
    assert.equal(
      hash(fs.readFileSync(path.join(directory, 'original.png'))),
      ticket.originalHash,
      'Ticket copy changed',
    );
    const returned = png(arg);
    assert.deepEqual(
      [returned.width, returned.height],
      ticket.size,
      'Returned PNG dimensions changed; plan and re-measure separately',
    );
    const name = 'returned-' + returned.sha256.slice(0, 16) + '.png';
    save(name, returned.bytes);
    save(name + '.json', {
      ...optionalPolicy,
      originalHash: ticket.originalHash,
      imageHash: returned.sha256,
      panel: ticket.panel,
      inspectionRequired: [
        '通常・縮小・詳細を実見',
        '顔・口・手・小道具・文字余白と変更範囲',
        'マスクならalpha/髪/境界/内部穴/半透明',
        '候補登録後に正式採用・座標測定・合成・独立レビュー',
      ],
      nextCommand: [
        'node',
        'cli/workflow.mjs',
        'candidate-panel',
        ticket.panel,
        path.relative(root, path.join(directory, name)).replaceAll('\\', '/'),
        '--note',
        '外部編集の返却候補。未検品・未採用',
      ],
    });
  } else {
    assert.ok(
      ['index', 'intake', 'cards', 'spreads', 'delivery', 'external'].includes(
        mode,
      ),
      'Unknown assistance mode',
    );
    assert.ok(
      !fs.existsSync(directory),
      'Output already exists; use a new name',
    );
    // Validate and read all inputs before creating the draft directory.
    let files = {};
    if (mode === 'index')
      files['index.json'] = productionIndex(c, hash(read(c.sourceFile)));
    if (mode === 'intake')
      files['brief.json'] = intakeDraft(arg ? json(arg) : {});
    if (mode === 'cards') {
      const cards = characterCards(c);
      const images = Object.fromEntries(
        cards
          .filter(
            (card) =>
              card.faceDesign?.reference &&
              fs.existsSync(local(card.faceDesign.reference)),
          )
          .map((card) => [
            card.id,
            'data:image/png;base64,' +
              png(card.faceDesign.reference).bytes.toString('base64'),
          ]),
      );
      files['cards.json'] = cards;
      files['cards.html'] = cardsHTML(cards, images);
    }
    if (mode === 'spreads') {
      const spreads = spreadPlan(c.pages, Number(arg || 0));
      files['spreads.json'] = {
        ...optionalPolicy,
        frontMatter: Number(arg || 0),
        spreads,
        instruction:
          '右綴じ・開始は左頁単独という仮定。前付け・表示単位・実際の見開き画像を確認。自動のめくり効果判定ではない。',
      };
      const images = new Map();
      for (const p of c.pages) {
        const file = `${c.outputDir}/page-${p.id}.png`;
        if (fs.existsSync(local(file))) images.set(p.id, png(file));
      }
      const cell = (item) =>
        item?.page && images.has(item.page)
          ? `<img alt="${xml(item.page)}" src="data:image/png;base64,${images.get(item.page).bytes.toString('base64')}">`
          : `<div>${xml(item?.frontMatter ? '前付け ' + item.frontMatter : item?.page ? '未出力 ' + item.page : '白頁')}</div>`;
      files['spreads.html'] =
        '<!doctype html><html lang="ja"><meta charset="utf-8"><title>見開き候補</title><style>body{background:#ddd;font:16px sans-serif}section{display:grid;grid-template-columns:1fr 1fr;max-width:1200px;margin:24px auto;background:white}img{display:block;width:100%}section>div{padding:24px}</style><p>右綴じの仮配置。画像の意味・先見え・めくりは実読で確認してください。</p>' +
        spreads
          .map((s) => '<section>' + cell(s.left) + cell(s.right) + '</section>')
          .join('');
      files['spread-images.json'] = [...images].map(([page, info]) => ({
        page,
        sha256: info.sha256,
      }));
    }
    if (mode === 'delivery') {
      const pages = c.pages.map((p) => {
        const file = `${c.outputDir}/page-${p.id}.png`,
          info = png(file),
          receipt = json(file + '.render.json');
        assert.equal(
          receipt.pngHash,
          info.sha256,
          'Stale rendered PNG: ' + p.id,
        );
        assert.equal(
          receipt.svgHash,
          hash(read(`${c.outputDir}/page-${p.id}.svg`)),
          'Stale rendered SVG: ' + p.id,
        );
        return {
          id: p.id,
          file,
          sha256: info.sha256,
          bytes: info.bytes.length,
          width: info.width,
          height: info.height,
        };
      });
      files['delivery.json'] = deliveryPlan(pages);
      const logFile = `${c.workflowDir}/generation-log.json`;
      files['credits.json'] = generationSummary(
        fs.existsSync(local(logFile)) ? json(logFile) : null,
      );
      files['credits.md'] =
        '# 非公開の制作履歴索引\n\n実記録の要約。担当・モデル等の未記録値は不明。公開・権利確認は別途必要。\n\n' +
        JSON.stringify(files['credits.json'], null, 2)
          .split('\n')
          .map((line) => '    ' + line)
          .join('\n') +
        '\n';
      files['delivery.md'] =
        '# 非公開の配布準備\n\n未送信・未公開。ページ順と現物ハッシュのみ固定し、公開先の現行条件・許可・実ID・表示を別途確認。\n\n' +
        JSON.stringify(files['delivery.json'], null, 2)
          .split('\n')
          .map((line) => '    ' + line)
          .join('\n') +
        '\n';
    }
    if (mode === 'external') {
      const panel = c.pages.flatMap((p) => p.panels).find((p) => p.id === arg);
      assert.ok(panel, 'Unknown panel');
      assert.match(panel.id, /^[a-zA-Z0-9_-]+$/, 'Invalid panel ID');
      const original = `${c.assetDir}/panels/${panel.id}.png`,
        info = png(original);
      files['original.png'] = info.bytes;
      files['edit-ticket.json'] = {
        ...optionalPolicy,
        panel: panel.id,
        configHash: sourceConfigHash,
        original,
        originalHash: info.sha256,
        size: [info.width, info.height],
        instruction:
          'CLI editで修正候補を別名保存し、returnへ返却できる。外部エディタの画面操作は任意。白地修正や座標指定のalpha補修を一般化せず、人物・背景分離や生成修復の成功は保証しない。返却後も原画像を保持して実見する。',
      };
    }
    fs.mkdirSync(directory, { recursive: true });
    for (const [name, value] of Object.entries(files)) save(name, value);
    save('manifest.json', {
      ...optionalPolicy,
      configHash: sourceConfigHash,
      files: Object.keys(files).map((file) => ({
        file,
        sha256: hash(fs.readFileSync(path.join(directory, file))),
      })),
    });
  }
  assert.equal(
    hash(read(configFile)),
    sourceConfigHash,
    'Canonical configuration changed',
  );
  console.log(JSON.stringify({ directory, mode, ...optionalPolicy }));
}
