import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
export function imageFile(file, page = false) {
  const bytes = fs.readFileSync(file);
  assert.ok(
    bytes.length >= 24 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'Expected a PNG image',
  );
  if (page) {
    assert.equal(bytes.readUInt32BE(16), 1024, 'Page PNG must be 1024x1536');
    assert.equal(bytes.readUInt32BE(20), 1536, 'Page PNG must be 1024x1536');
  }
  return bytes;
}
export function createAssets({ config, local, assetDir }) {
  function archive(j) {
    if (!fs.existsSync(local(j.asset)) || !fs.existsSync(local(j.record)))
      return;
    const record = fs.readFileSync(local(j.record)),
      image = fs.readFileSync(local(j.asset));
    const base = `${assetDir}/history/${j.id || 'page-' + j.page}-${hash(Buffer.concat([image, record]))}`;
    fs.mkdirSync(path.dirname(local(base)), { recursive: true });
    /** @type {[string, Buffer][]} */
    const archivedFiles = [
      ['png', image],
      ['json', record],
    ];
    for (const [ext, bytes] of archivedFiles) {
      const target = local(base + '.' + ext);
      if (fs.existsSync(target) && fs.statSync(target).size > 0) {
        assert.ok(
          fs.readFileSync(target).equals(bytes),
          'Corrupt archive: ' + target,
        );
        continue;
      }
      const temporary = target + '.writing';
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, target);
    }
  }
  function saveAsset(j, file, record, options = {}) {
    const image = imageFile(file);
    const candidate = file.replace(/\.png$/, '.json');
    let selected;
    if (file.startsWith(local(assetDir + '/candidates') + path.sep)) {
      assert.ok(fs.existsSync(candidate), 'Candidate metadata missing');
      const c = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      selected = c;
      assert.equal(c.id, j.id, 'Candidate belongs to a different panel');
      assert.equal(
        c.fingerprint,
        j.fingerprint,
        'Stale candidate: generate or register a candidate for the current plan',
      );
      assert.equal(c.imageHash, hash(image), 'Candidate image changed');
    }
    archive(j);
    fs.mkdirSync(path.dirname(local(j.asset)), { recursive: true });
    if (path.resolve(file) !== local(j.asset))
      fs.copyFileSync(file, local(j.asset));
    const meta = {
      ...record,
      renderer:
        options.renderer === undefined
          ? selected?.renderer || 'unspecified'
          : options.renderer,
      model:
        options.model === undefined ? selected?.model || null : options.model,
      reason: options.reason === undefined ? 'not supplied' : options.reason,
      sourceFile: file,
      acceptedAt: new Date().toISOString(),
      acceptedJob: {
        prompt: j.prompt,
        references: j.references.map((f) => ({
          path: f,
          imageHash: fs.existsSync(local(f))
            ? hash(fs.readFileSync(local(f)))
            : null,
          origin: config.assetSources?.[f] || null,
        })),
      },
    };
    fs.writeFileSync(local(j.record), JSON.stringify(meta, null, 2));
    archive(j);
    fs.appendFileSync(
      local(assetDir + '/history.jsonl'),
      JSON.stringify({
        event: 'accept',
        target: j.id || j.page,
        imageHash: meta.imageHash,
        fingerprint: j.fingerprint,
        reason: meta.reason,
        renderer: meta.renderer,
        model: meta.model,
        time: meta.acceptedAt,
      }) + '\n',
    );
  }
  return { archive, saveAsset };
}
