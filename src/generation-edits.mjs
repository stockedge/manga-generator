import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export function validateGenerationEdit(record, read, seen = new Set()) {
  if (!record.externalEdit) return;
  const edit = record.externalEdit;
  assert.ok(!seen.has(edit.parentRecord), 'Cyclic external edit provenance');
  seen.add(edit.parentRecord);
  const bytes = read(edit.parentRecord);
  assert.equal(
    hash(bytes),
    edit.parentRecordHash,
    'External edit parent record changed',
  );
  const parent = JSON.parse(bytes.toString('utf8'));
  assert.equal(
    hash(read(edit.inputImage)),
    parent.imageHash,
    'External edit input changed',
  );
  assert.equal(
    edit.inputHash,
    parent.imageHash,
    'External edit parent image mismatch',
  );
  assert.equal(
    edit.outputHash,
    record.imageHash,
    'External edit output mismatch',
  );
  assert.equal(
    hash(Buffer.from(edit.instruction)),
    edit.instructionHash,
    'External edit instruction changed',
  );
  assert.equal(edit.renderer, 'external pixel editor');
  for (const key of [
    'renderer',
    'model',
    'prompt',
    'promptHash',
    'sourceHash',
    'references',
  ])
    assert.deepEqual(
      record[key],
      parent[key],
      'External edit changed original generation evidence: ' + key,
    );
  validateGenerationEdit(parent, read, seen);
}
